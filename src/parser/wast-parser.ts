// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/wast-parser.h, src/wast-parser.cc
// Copyright 2017 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * WAT/WAST parser.
 *
 * Converts a token stream from {@link WastLexer} into a {@link Module} IR
 * (for `.wat` files) or a {@link WastScript} (for `.wast` files).
 */

import type { Location, WabtError } from '../core/error.ts';
import { ErrorLevel } from '../core/error.ts';
import { Result, combineResults } from '../core/result.ts';
import { Opcode, PREFIX_MISC, PREFIX_SIMD, PREFIX_THREADS } from '../core/opcode.ts';
import { Type } from '../core/types.ts';
import {
  varIndex, varName, BLOCK_TYPE_VOID, blockTypeValue,
  makeModule, sigEquals,
  ExternalKind,
  type Var, type BlockType, type Const, type FuncSignature, type LocalDecl,
  type TypeEntry, type Func, type Global, type Memory, type Table, type Tag,
  type ElemSegment, type DataSegment, type Import, type Export, type Module,
  type Expr, type Limits,
  constI32, constI64, constF32, constF64, constV128,
  type ConstExpr, type NopExpr, type UnreachableExpr, type ReturnExpr,
  type DropExpr, type SelectExpr, type BlockExpr, type LoopExpr, type IfExpr,
  type BrExpr, type BrIfExpr, type BrTableExpr,
  type BrOnNullExpr, type BrOnNonNullExpr,
  type LocalGetExpr, type LocalSetExpr, type LocalTeeExpr,
  type GlobalGetExpr, type GlobalSetExpr,
  type UnaryExpr, type BinaryExpr, type CompareExpr, type ConvertExpr,
  type TernaryExpr, type QuaternaryExpr,
  type LoadExpr, type StoreExpr,
  type MemorySizeExpr, type MemoryGrowExpr, type MemoryCopyExpr,
  type MemoryFillExpr, type MemoryInitExpr, type DataDropExpr,
  type CallExpr, type CallIndirectExpr, type CallRefExpr,
  type ReturnCallExpr, type ReturnCallIndirectExpr, type ReturnCallRefExpr,
  type RefNullExpr, type RefIsNullExpr, type RefFuncExpr, type RefAsNonNullExpr,
  type TableGetExpr, type TableSetExpr, type TableGrowExpr, type TableSizeExpr,
  type TableFillExpr, type TableCopyExpr, type TableInitExpr, type ElemDropExpr,
  type ThrowExpr, type ThrowRefExpr, type RethrowExpr,
  type AtomicLoadExpr, type AtomicStoreExpr, type AtomicRmwExpr,
  type AtomicRmwCmpxchgExpr, type AtomicWaitExpr, type AtomicNotifyExpr,
  type AtomicFenceExpr,
  type SimdLaneOpExpr, type SimdShuffleOpExpr, type SimdLoadLaneExpr,
  type SimdStoreLaneExpr,
} from '../ir/ir.ts';
import { LexerSource } from './lexer-source.ts';
import { WastLexer } from './wast-lexer.ts';
import {
  TokenType, LiteralType,
  type Token, type LiteralToken, type OpcodeToken, type StringToken,
  type TypeToken, type RefKindToken,
} from './token.ts';
import { LiteralType as CoreLiteralType } from '../core/literal.ts';

// ---------------------------------------------------------------------------
// WAST Script types
// ---------------------------------------------------------------------------

/** A single invoke or get action in a WAST script. */
export type WastAction =
  | { readonly kind: 'invoke'; readonly name: string | null; readonly field: string; readonly args: Const[]; readonly loc: Location }
  | { readonly kind: 'get'; readonly name: string | null; readonly field: string; readonly loc: Location };

/** An expected return value in assert_return — may include nan patterns. */
export type ExpectedConst =
  | { readonly kind: 'value'; readonly value: Const }
  | { readonly kind: 'nan:canonical'; readonly valType: Type }
  | { readonly kind: 'nan:arithmetic'; readonly valType: Type }
  | { readonly kind: 'ref.null'; readonly refType: Type }
  | { readonly kind: 'ref.func' }
  | { readonly kind: 'ref.extern'; readonly value: number };

/** A module in a WAST script — text, binary, or quoted. */
export type WastScriptModule =
  | { readonly kind: 'text'; readonly name: string | null; readonly module: Module; readonly loc: Location }
  | { readonly kind: 'binary'; readonly name: string | null; readonly data: Uint8Array; readonly loc: Location }
  | { readonly kind: 'quote'; readonly name: string | null; readonly source: string; readonly loc: Location };

/** A command in a WAST script. */
export type WastCommand =
  | { readonly kind: 'module'; readonly scriptModule: WastScriptModule }
  | { readonly kind: 'action'; readonly action: WastAction }
  | { readonly kind: 'assert_return'; readonly action: WastAction; readonly expected: ExpectedConst[]; readonly loc: Location }
  | { readonly kind: 'assert_trap'; readonly action: WastAction; readonly text: string; readonly loc: Location }
  | { readonly kind: 'assert_exception'; readonly action: WastAction; readonly loc: Location }
  | { readonly kind: 'assert_exhaustion'; readonly action: WastAction; readonly text: string; readonly loc: Location }
  | { readonly kind: 'assert_invalid'; readonly scriptModule: WastScriptModule; readonly text: string; readonly loc: Location }
  | { readonly kind: 'assert_malformed'; readonly scriptModule: WastScriptModule; readonly text: string; readonly loc: Location }
  | { readonly kind: 'assert_unlinkable'; readonly scriptModule: WastScriptModule; readonly text: string; readonly loc: Location }
  | { readonly kind: 'register'; readonly name: string; readonly as: string | null; readonly loc: Location };

/** A parsed WAST script. */
export interface WastScript {
  readonly filename: string;
  readonly commands: WastCommand[];
}

// ---------------------------------------------------------------------------
// Helper classification functions
// ---------------------------------------------------------------------------

function isPlainInstr(tt: TokenType): boolean {
  switch (tt) {
    case TokenType.Unreachable: case TokenType.Nop: case TokenType.Drop:
    case TokenType.Select: case TokenType.Br: case TokenType.BrIf:
    case TokenType.BrOnNonNull: case TokenType.BrOnNull: case TokenType.BrTable:
    case TokenType.Return: case TokenType.ReturnCall: case TokenType.ReturnCallIndirect:
    case TokenType.ReturnCallRef: case TokenType.Call: case TokenType.CallIndirect:
    case TokenType.CallRef: case TokenType.LocalGet: case TokenType.LocalSet:
    case TokenType.LocalTee: case TokenType.GlobalGet: case TokenType.GlobalSet:
    case TokenType.Load: case TokenType.Store: case TokenType.Const:
    case TokenType.Unary: case TokenType.Binary: case TokenType.Quaternary:
    case TokenType.Compare: case TokenType.Convert:
    case TokenType.MemoryCopy: case TokenType.DataDrop: case TokenType.MemoryFill:
    case TokenType.MemoryGrow: case TokenType.MemoryInit: case TokenType.MemorySize:
    case TokenType.TableCopy: case TokenType.ElemDrop: case TokenType.TableInit:
    case TokenType.TableGet: case TokenType.TableSet: case TokenType.TableGrow:
    case TokenType.TableSize: case TokenType.TableFill:
    case TokenType.Throw: case TokenType.ThrowRef: case TokenType.Rethrow:
    case TokenType.RefAsNonNull: case TokenType.RefFunc: case TokenType.RefNull:
    case TokenType.RefIsNull: case TokenType.AtomicLoad: case TokenType.AtomicStore:
    case TokenType.AtomicRmw: case TokenType.AtomicRmwCmpxchg: case TokenType.AtomicNotify:
    case TokenType.AtomicFence: case TokenType.AtomicWait:
    case TokenType.Ternary: case TokenType.SimdLaneOp: case TokenType.SimdLoadLane:
    case TokenType.SimdStoreLane: case TokenType.SimdShuffleOp:
      return true;
    default:
      return false;
  }
}

function isBlockInstr(tt: TokenType): boolean {
  switch (tt) {
    case TokenType.Block: case TokenType.Loop: case TokenType.If:
    case TokenType.Try: case TokenType.TryTable:
      return true;
    default:
      return false;
  }
}

function isInstr(tt: TokenType, next: TokenType): boolean {
  if (isPlainInstr(tt) || isBlockInstr(tt)) return true;
  if (tt === TokenType.Lpar && (isPlainInstr(next) || isBlockInstr(next))) return true;
  return false;
}

function isModuleField(tt0: TokenType, tt1: TokenType): boolean {
  if (tt0 !== TokenType.Lpar) return false;
  switch (tt1) {
    case TokenType.Func: case TokenType.Function: case TokenType.Type: case TokenType.Import:
    case TokenType.Export: case TokenType.Global: case TokenType.Memory:
    case TokenType.Table: case TokenType.Start: case TokenType.Data:
    case TokenType.Elem: case TokenType.Tag:
      return true;
    default:
      return false;
  }
}

function isCommand(tt0: TokenType, tt1: TokenType): boolean {
  if (tt0 !== TokenType.Lpar) return false;
  switch (tt1) {
    case TokenType.Module: case TokenType.Register: case TokenType.Invoke:
    case TokenType.Get: case TokenType.AssertReturn: case TokenType.AssertTrap:
    case TokenType.AssertException: case TokenType.AssertExhaustion:
    case TokenType.AssertInvalid: case TokenType.AssertMalformed:
    case TokenType.AssertUnlinkable:
      return true;
    default:
      return isModuleField(tt0, tt1);
  }
}

// ---------------------------------------------------------------------------
// String / literal helpers
// ---------------------------------------------------------------------------

/** Decode WAT string token text (including surrounding quotes) into a byte array. */
function decodeStringToken(text: string): Uint8Array {
  // strip surrounding quotes
  if (text.startsWith('"')) text = text.slice(1);
  if (text.endsWith('"')) text = text.slice(0, -1);
  const bytes: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text.charCodeAt(i);
    if (ch === 0x5c) { // backslash
      i++;
      const e = text.charCodeAt(i);
      switch (e) {
        case 0x74: bytes.push(0x09); i++; break; // \t
        case 0x6e: bytes.push(0x0a); i++; break; // \n
        case 0x72: bytes.push(0x0d); i++; break; // \r
        case 0x22: bytes.push(0x22); i++; break; // \"
        case 0x27: bytes.push(0x27); i++; break; // \'
        case 0x5c: bytes.push(0x5c); i++; break; // \\
        case 0x75: { // \u{XXXX}
          i += 2; // skip 'u{'
          let scalar = 0;
          while (i < text.length && text[i] !== '}') {
            scalar = (scalar << 4) | parseInt(text[i]!, 16);
            i++;
          }
          i++; // skip '}'
          // encode scalar as UTF-8
          if (scalar < 0x80) bytes.push(scalar);
          else if (scalar < 0x800) { bytes.push(0xc0 | (scalar >> 6)); bytes.push(0x80 | (scalar & 0x3f)); }
          else if (scalar < 0x10000) { bytes.push(0xe0 | (scalar >> 12)); bytes.push(0x80 | ((scalar >> 6) & 0x3f)); bytes.push(0x80 | (scalar & 0x3f)); }
          else { bytes.push(0xf0 | (scalar >> 18)); bytes.push(0x80 | ((scalar >> 12) & 0x3f)); bytes.push(0x80 | ((scalar >> 6) & 0x3f)); bytes.push(0x80 | (scalar & 0x3f)); }
          break;
        }
        default: { // hex escape
          const hi = parseInt(text[i]!, 16);
          i++;
          const lo = parseInt(text[i]!, 16);
          i++;
          bytes.push((hi << 4) | lo);
        }
      }
    } else {
      bytes.push(ch);
      i++;
    }
  }
  return new Uint8Array(bytes);
}

/** Strip surrounding quotes and resolve escapes for a WAT string, returning text. */
function decodeStringText(raw: string): string {
  return new TextDecoder().decode(decodeStringToken(raw));
}

/** Parse a NAT/INT token text to a 64-bit unsigned integer (as bigint). Returns null on failure. */
function parseNatText(text: string): bigint | null {
  try {
    if (text.startsWith('0x') || text.startsWith('-0x') || text.startsWith('+0x')) {
      return BigInt(text.replace('_', ''));
    }
    return BigInt(text.replace('_', ''));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Operand stack helpers for linear instruction parsing
// ---------------------------------------------------------------------------

/** How many operands a plain instruction pops from the stack (-1 = variable). */
function instrInputCount(tt: TokenType): number {
  switch (tt) {
    case TokenType.Unreachable: case TokenType.Nop: case TokenType.AtomicFence:
    case TokenType.Const: case TokenType.LocalGet: case TokenType.GlobalGet:
    case TokenType.RefNull: case TokenType.RefFunc: case TokenType.MemorySize:
    case TokenType.TableSize:
      return 0;
    case TokenType.Drop: case TokenType.LocalSet: case TokenType.LocalTee:
    case TokenType.GlobalSet: case TokenType.Unary: case TokenType.Convert:
    case TokenType.RefIsNull: case TokenType.RefAsNonNull: case TokenType.MemoryGrow:
    case TokenType.TableGet: case TokenType.DataDrop: case TokenType.ElemDrop:
    case TokenType.ThrowRef:
      return 1;
    case TokenType.Binary: case TokenType.Compare: case TokenType.Load:
    case TokenType.AtomicLoad: case TokenType.BrIf: case TokenType.BrOnNull:
    case TokenType.BrOnNonNull: case TokenType.TableSet: case TokenType.TableGrow:
    case TokenType.Store: case TokenType.AtomicNotify:
      return 2;
    case TokenType.Select: case TokenType.MemoryFill: case TokenType.TableFill:
    case TokenType.AtomicStore: case TokenType.AtomicWait: case TokenType.AtomicRmw:
      return 3;
    case TokenType.AtomicRmwCmpxchg: case TokenType.SimdStoreLane:
      return 4; // approx
    case TokenType.MemoryCopy: case TokenType.TableCopy: case TokenType.MemoryInit:
    case TokenType.TableInit:
      return 3;
    case TokenType.Ternary: case TokenType.SimdShuffleOp:
      return 3;
    // variable arity
    case TokenType.Return: case TokenType.Br: case TokenType.BrTable:
    case TokenType.Call: case TokenType.CallIndirect: case TokenType.CallRef:
    case TokenType.ReturnCall: case TokenType.ReturnCallIndirect: case TokenType.ReturnCallRef:
    case TokenType.Throw:
      return -1;
    default:
      return 0;
  }
}

/** Whether a plain instruction pushes a value onto the stack. */
function instrProducesValue(tt: TokenType): boolean {
  switch (tt) {
    case TokenType.Const: case TokenType.LocalGet: case TokenType.GlobalGet:
    case TokenType.RefNull: case TokenType.RefFunc: case TokenType.MemorySize:
    case TokenType.TableSize: case TokenType.Unary: case TokenType.Convert:
    case TokenType.Binary: case TokenType.Compare: case TokenType.Load:
    case TokenType.AtomicLoad: case TokenType.RefIsNull: case TokenType.RefAsNonNull:
    case TokenType.LocalTee: case TokenType.MemoryGrow: case TokenType.TableGet:
    case TokenType.TableGrow: case TokenType.Select: case TokenType.AtomicNotify:
    case TokenType.AtomicWait: case TokenType.AtomicRmw: case TokenType.AtomicRmwCmpxchg:
    case TokenType.SimdLaneOp: case TokenType.SimdShuffleOp: case TokenType.Ternary:
    case TokenType.Quaternary:
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// ExprCtx — operand stack context for expression building
// ---------------------------------------------------------------------------

interface ExprCtx {
  stack: Expr[];
  stmts: Expr[];
}

function newCtx(): ExprCtx { return { stack: [], stmts: [] }; }

/** Pop `n` operands from stack (right-to-left order: last-in first-out). */
function popN(ctx: ExprCtx, n: number, fallback: Location): Expr[] {
  const nop = (): NopExpr => ({ kind: 'nop', loc: fallback });
  const result: Expr[] = [];
  for (let i = 0; i < n; i++) {
    result.unshift(ctx.stack.pop() ?? nop());
  }
  return result;
}

/** Flush remaining stack items as sequential statements (for end-of-block). */
function flushStack(ctx: ExprCtx): void {
  while (ctx.stack.length > 0) {
    const e = ctx.stack.pop()!;
    ctx.stmts.push(e);
  }
}

// ---------------------------------------------------------------------------
// WastParser
// ---------------------------------------------------------------------------

export class WastParser {
  private tokens: readonly Token[];
  private pos = 0;
  readonly errors: WabtError[] = [];

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  // -------------------------------------------------------------------------
  // Token stream
  // -------------------------------------------------------------------------

  private peek(n = 0): TokenType {
    return this.tokens[this.pos + n]?.tokenType ?? TokenType.Eof;
  }

  private peekToken(n = 0): Token {
    const t = this.tokens[this.pos + n];
    if (t !== undefined) return t;
    const last = this.tokens[this.tokens.length - 1];
    return last ?? { tokenType: TokenType.Eof, loc: { filename: '', line: 1, column: 1, offset: 0 } };
  }

  private loc(): Location { return this.peekToken().loc; }

  private consume(): Token {
    const t = this.tokens[this.pos];
    if (t !== undefined) { this.pos++; return t; }
    return this.peekToken();
  }

  private drop(): void { if (this.pos < this.tokens.length) this.pos++; }

  private match(tt: TokenType): boolean {
    if (this.peek() === tt) { this.pos++; return true; }
    return false;
  }

  private matchLpar(tt: TokenType): boolean {
    if (this.peek() === TokenType.Lpar && this.peek(1) === tt) {
      this.pos += 2; return true;
    }
    return false;
  }

  private expect(tt: TokenType): Result {
    if (this.match(tt)) return Result.Ok;
    this.error(this.loc(), `expected ${tokenName(tt)}, got ${tokenName(this.peek())}`);
    return Result.Error;
  }

  private expectLpar(tt: TokenType): Result {
    if (this.matchLpar(tt)) return Result.Ok;
    this.error(this.loc(), `expected '(' ${tokenName(tt)}`);
    return Result.Error;
  }

  private peekMatchVar(): boolean {
    const tt = this.peek();
    return tt === TokenType.Var || tt === TokenType.Nat || tt === TokenType.Int;
  }

  private peekIsInstr(): boolean {
    return isInstr(this.peek(), this.peek(1));
  }

  private peekIsModuleField(): boolean {
    return isModuleField(this.peek(), this.peek(1));
  }

  // -------------------------------------------------------------------------
  // Error reporting
  // -------------------------------------------------------------------------

  private error(loc: Location, msg: string): void {
    this.errors.push({ loc, message: msg, level: ErrorLevel.Error });
  }

  private ok(): boolean {
    return !this.errors.some((e) => e.level === ErrorLevel.Error);
  }

  // -------------------------------------------------------------------------
  // Synchronize (error recovery)
  // -------------------------------------------------------------------------

  private synchronizeToModuleField(): Result {
    while (this.peek() !== TokenType.Eof) {
      if (this.peekIsModuleField()) return Result.Ok;
      this.drop();
    }
    return Result.Error;
  }

  // -------------------------------------------------------------------------
  // Utility parsers
  // -------------------------------------------------------------------------

  parseVar(): Var | null {
    const tt = this.peek();
    if (tt === TokenType.Var) {
      const tok = this.consume() as StringToken;
      return varName(tok.text);
    }
    if (tt === TokenType.Nat || tt === TokenType.Int) {
      const tok = this.consume() as LiteralToken;
      const n = parseNatText(tok.literal.text);
      if (n === null) { this.error(tok.loc, `invalid index: ${tok.literal.text}`); return null; }
      return varIndex(Number(n));
    }
    this.error(this.loc(), 'expected var (name or index)');
    return null;
  }

  parseVarOpt(defaultVar: Var): Var {
    if (this.peekMatchVar()) {
      return this.parseVar() ?? defaultVar;
    }
    return defaultVar;
  }

  parseBindVarOpt(): string {
    if (this.peek() === TokenType.Var) {
      return (this.consume() as StringToken).text;
    }
    return '';
  }

  /** Parse an optional `(type $name)` type annotation. Returns the var or null. */
  private parseTypeUseOpt(): Var | null {
    if (this.matchLpar(TokenType.Type)) {
      const v = this.parseVar();
      this.expect(TokenType.Rpar);
      return v;
    }
    return null;
  }

  /** Parse zero or more `(param ...)` groups and return types + name bindings. */
  private parseParams(paramTypes: Type[], bindings: Map<string, number>): Result {
    while (this.matchLpar(TokenType.Param)) {
      if (this.peek() === TokenType.Var) {
        const name = (this.consume() as StringToken).text;
        const t = this.parseValueType();
        if (t === null) { this.expect(TokenType.Rpar); return Result.Error; }
        bindings.set(name, paramTypes.length);
        paramTypes.push(t);
      } else {
        while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
          const t = this.parseValueType();
          if (t === null) break;
          paramTypes.push(t);
        }
      }
      if (this.expect(TokenType.Rpar) !== Result.Ok) return Result.Error;
    }
    return Result.Ok;
  }

  /** Parse zero or more `(result ...)` groups. */
  private parseResults(resultTypes: Type[]): Result {
    while (this.matchLpar(TokenType.Result)) {
      while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
        const t = this.parseValueType();
        if (t === null) break;
        resultTypes.push(t);
      }
      if (this.expect(TokenType.Rpar) !== Result.Ok) return Result.Error;
    }
    return Result.Ok;
  }

  /** Parse a function signature: `(param ...)* (result ...)*` */
  parseFuncSignature(): { sig: FuncSignature; bindings: Map<string, number> } {
    const params: Type[] = [];
    const results: Type[] = [];
    const bindings = new Map<string, number>();
    this.parseParams(params, bindings);
    this.parseResults(results);
    return { sig: { params, results }, bindings };
  }

  /** Parse a value type token. Returns null on failure. */
  parseValueType(): Type | null {
    const tt = this.peek();
    if (tt === TokenType.ValueType) {
      const tok = this.consume() as TypeToken;
      return tok.valueType;
    }
    if (tt === TokenType.Func) {
      // func ref kind used as value type in some contexts
      const tok = this.consume() as RefKindToken;
      return tok.refType;
    }
    if (tt === TokenType.Extern) {
      const tok = this.consume() as RefKindToken;
      return tok.refType;
    }
    if (tt === TokenType.Ref) {
      return this.parseRefType();
    }
    this.error(this.loc(), `expected value type, got ${tokenName(tt)}`);
    return null;
  }

  /** Parse a ref type: `ref null? funcref/externref/...` */
  private parseRefType(): Type | null {
    // consume 'ref'
    this.drop();
    const isNull = this.match(TokenType.Null);
    const tt = this.peek();
    if (tt === TokenType.Func) { this.drop(); return isNull ? Type.FuncRef : Type.FuncRef; }
    if (tt === TokenType.Extern) { this.drop(); return isNull ? Type.ExternRef : Type.ExternRef; }
    if (tt === TokenType.Exn) { this.drop(); return Type.ExnRef; }
    if (tt === TokenType.ValueType) {
      const tok = this.consume() as TypeToken;
      return tok.valueType;
    }
    this.error(this.loc(), 'expected ref kind');
    return null;
  }

  /** Parse limits: `N` or `N M` optionally followed by `shared`. */
  parseLimits(): Limits | null {
    const is64 = this.match(TokenType.I64X2); // actually this is wrong, check index type
    const initTok = this.peekToken();
    if (this.peek() !== TokenType.Nat && this.peek() !== TokenType.Int) {
      this.error(this.loc(), 'expected limit initial value');
      return null;
    }
    const initText = (this.consume() as LiteralToken).literal.text;
    const initN = parseNatText(initText);
    if (initN === null) { this.error(initTok.loc, 'invalid limit'); return null; }
    const initial = Number(initN);
    let max: number | undefined;
    const isShared = false;
    if (this.peek() === TokenType.Nat || this.peek() === TokenType.Int) {
      const maxText = (this.consume() as LiteralToken).literal.text;
      const maxN = parseNatText(maxText);
      if (maxN !== null) max = Number(maxN);
    }
    const shared = this.match(TokenType.Shared);
    return max !== undefined
      ? { initial, max, isShared: shared, is64: false }
      : { initial, isShared: shared, is64: false };
  }

  /** Parse a quoted string token and return its text content (without quotes). */
  parseQuotedText(): string | null {
    if (this.peek() !== TokenType.Text) {
      this.error(this.loc(), 'expected string');
      return null;
    }
    const tok = this.consume() as StringToken;
    return decodeStringText(tok.text);
  }

  /** Parse raw quoted string bytes (for data segments). */
  private parseTextList(): Uint8Array {
    const chunks: Uint8Array[] = [];
    while (this.peek() === TokenType.Text) {
      const tok = this.consume() as StringToken;
      chunks.push(decodeStringToken(tok.text));
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  /** Parse `offset=N` if present. Returns 0n if not. */
  private parseOffsetOpt(): bigint {
    if (this.peek() === TokenType.OffsetEqNat) {
      const tok = this.consume() as StringToken;
      const n = parseNatText(tok.text);
      return n !== null ? n : 0n;
    }
    return 0n;
  }

  /** Parse `align=N` if present. Returns 0 if not (caller uses natural align). */
  private parseAlignOpt(): number {
    if (this.peek() === TokenType.AlignEqNat) {
      const tok = this.consume() as StringToken;
      const n = parseNatText(tok.text);
      return n !== null ? Number(n) : 0;
    }
    return 0;
  }

  /** Parse inline imports `(import "mod" "field")` if present. Returns null if not found. */
  private parseInlineImport(): { moduleName: string; fieldName: string } | null {
    if (!this.matchLpar(TokenType.Import)) return null;
    const moduleName = this.parseQuotedText() ?? '';
    const fieldName = this.parseQuotedText() ?? '';
    this.expect(TokenType.Rpar);
    return { moduleName, fieldName };
  }

  /** Parse zero or more inline exports `(export "name")`. */
  private parseInlineExports(kind: ExternalKind, module: Module, itemIdx: number): void {
    while (this.matchLpar(TokenType.Export)) {
      const name = this.parseQuotedText() ?? '';
      this.expect(TokenType.Rpar);
      module.exports.push({ name, kind, var: varIndex(itemIdx) });
    }
  }

  /** Parse an `(offset expr)` expression or bare expr for offset field of data/elem. */
  private parseOffsetExpr(ctx: ExprCtx): Result {
    if (this.matchLpar(TokenType.Offset)) {
      const r = this.parseInstrList(ctx);
      this.expect(TokenType.Rpar);
      return r;
    }
    return this.parseInstrList(ctx);
  }

  // -------------------------------------------------------------------------
  // Module field parsers
  // -------------------------------------------------------------------------

  parseModule(): Module {
    const module = makeModule();
    if (this.matchLpar(TokenType.Module)) {
      module.name = this.parseBindVarOpt();
      this.parseModuleFieldList(module);
      this.expect(TokenType.Rpar);
    } else if (this.peekIsModuleField()) {
      this.parseModuleFieldList(module);
    }
    this.expect(TokenType.Eof);
    return module;
  }

  private parseModuleFieldList(module: Module): void {
    while (this.peekIsModuleField()) {
      if (this.parseModuleField(module) !== Result.Ok) {
        this.synchronizeToModuleField();
      }
    }
  }

  private parseModuleField(module: Module): Result {
    const tt1 = this.peek(1);
    switch (tt1) {
      case TokenType.Type:   return this.parseTypeModuleField(module);
      case TokenType.Import: return this.parseImportModuleField(module);
      case TokenType.Export: return this.parseExportModuleField(module);
      case TokenType.Func: case TokenType.Function: return this.parseFuncModuleField(module);
      case TokenType.Global: return this.parseGlobalModuleField(module);
      case TokenType.Memory: return this.parseMemoryModuleField(module);
      case TokenType.Table:  return this.parseTableModuleField(module);
      case TokenType.Start:  return this.parseStartModuleField(module);
      case TokenType.Data:   return this.parseDataModuleField(module);
      case TokenType.Elem:   return this.parseElemModuleField(module);
      case TokenType.Tag:    return this.parseTagModuleField(module);
      default:
        this.error(this.loc(), 'unknown module field');
        return Result.Error;
    }
  }

  private parseTypeModuleField(module: Module): Result {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Type) !== Result.Ok) return Result.Error;
    const name = this.parseBindVarOpt();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (!this.match(TokenType.Func)) {
      this.error(this.loc(), 'expected func in type');
      return Result.Error;
    }
    const { sig } = this.parseFuncSignature();
    const entry: TypeEntry = { kind: 'func', name, sig, loc };
    this.expect(TokenType.Rpar);
    this.expect(TokenType.Rpar);
    module.types.push(entry);
    return Result.Ok;
  }

  private parseImportModuleField(module: Module): Result {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Import) !== Result.Ok) return Result.Error;
    const moduleName = this.parseQuotedText() ?? '';
    const fieldName = this.parseQuotedText() ?? '';
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;

    const tt = this.peek();
    let imp: Import;

    if (tt === TokenType.Func || tt === TokenType.Function) {
      this.drop();
      const name = this.parseBindVarOpt();
      const typeVar = this.parseTypeUseOpt();
      const { sig, bindings } = this.parseFuncSignature();
      const func: Func = { name, loc, typeVar: typeVar ?? varIndex(0), sig, localDecls: [], body: [], tailcall: false };
      imp = { kind: ExternalKind.Func, module: moduleName, field: fieldName, func };
      module.imports.push(imp);
      module.numFuncImports++;
    } else if (tt === TokenType.Table) {
      this.drop();
      const name = this.parseBindVarOpt();
      const limits = this.parseLimits() ?? { initial: 0, isShared: false, is64: false };
      const elemType = this.parseValueType() ?? Type.FuncRef;
      const table: Table = { name, loc, elemType, limits, init: [] };
      imp = { kind: ExternalKind.Table, module: moduleName, field: fieldName, table };
      module.imports.push(imp);
      module.numTableImports++;
    } else if (tt === TokenType.Memory) {
      this.drop();
      const name = this.parseBindVarOpt();
      const limits = this.parseLimits() ?? { initial: 0, isShared: false, is64: false };
      const memory: Memory = { name, loc, limits };
      imp = { kind: ExternalKind.Memory, module: moduleName, field: fieldName, memory };
      module.imports.push(imp);
      module.numMemoryImports++;
    } else if (tt === TokenType.Global) {
      this.drop();
      const name = this.parseBindVarOpt();
      const { type, isMut } = this.parseGlobalType();
      const global: Global = { name, loc, type, mutable: isMut, init: [] };
      imp = { kind: ExternalKind.Global, module: moduleName, field: fieldName, global };
      module.imports.push(imp);
      module.numGlobalImports++;
    } else if (tt === TokenType.Tag) {
      this.drop();
      const name = this.parseBindVarOpt();
      const { sig } = this.parseFuncSignature();
      const tag: Tag = { name, loc, sig };
      imp = { kind: ExternalKind.Tag, module: moduleName, field: fieldName, tag };
      module.imports.push(imp);
      module.numTagImports++;
    } else {
      this.error(this.loc(), 'expected import kind (func/table/memory/global/tag)');
      return Result.Error;
    }

    this.expect(TokenType.Rpar); // inner
    this.expect(TokenType.Rpar); // outer
    return Result.Ok;
  }

  private parseExportModuleField(module: Module): Result {
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Export) !== Result.Ok) return Result.Error;
    const name = this.parseQuotedText() ?? '';
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    const tt = this.peek();
    let kind: ExternalKind;
    switch (tt) {
      case TokenType.Func: case TokenType.Function: kind = ExternalKind.Func; break;
      case TokenType.Table: kind = ExternalKind.Table; break;
      case TokenType.Memory: kind = ExternalKind.Memory; break;
      case TokenType.Global: kind = ExternalKind.Global; break;
      case TokenType.Tag: kind = ExternalKind.Tag; break;
      default:
        this.error(this.loc(), 'expected export kind');
        return Result.Error;
    }
    this.drop();
    const v = this.parseVar();
    this.expect(TokenType.Rpar);
    this.expect(TokenType.Rpar);
    if (v !== null) module.exports.push({ name, kind, var: v });
    return Result.Ok;
  }

  private parseFuncModuleField(module: Module): Result {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.peek() !== TokenType.Func && this.peek() !== TokenType.Function) {
      this.error(this.loc(), 'expected func');
      return Result.Error;
    }
    this.drop();
    const name = this.parseBindVarOpt();
    const funcIdx = module.numFuncImports + module.funcs.length;

    // Inline exports
    while (this.matchLpar(TokenType.Export)) {
      const expName = this.parseQuotedText() ?? '';
      this.expect(TokenType.Rpar);
      module.exports.push({ name: expName, kind: ExternalKind.Func, var: varIndex(funcIdx) });
    }

    // Inline import?
    const inlineImp = this.parseInlineImport();
    const typeVar = this.parseTypeUseOpt();
    const { sig, bindings } = this.parseFuncSignature();

    if (inlineImp !== null) {
      // This is an imported function declared as (func (import ...) ...)
      const func: Func = { name, loc, typeVar: typeVar ?? varIndex(0), sig, localDecls: [], body: [], tailcall: false };
      const imp: Import = {
        kind: ExternalKind.Func,
        module: inlineImp.moduleName,
        field: inlineImp.fieldName,
        func,
      };
      module.imports.push(imp);
      module.numFuncImports++;
    } else {
      const localDecls: LocalDecl[] = [];
      // Parse locals
      while (this.matchLpar(TokenType.Local)) {
        if (this.peek() === TokenType.Var) {
          this.drop(); // skip named local identifier
          const t = this.parseValueType();
          if (t !== null) localDecls.push({ type: t, count: 1 });
        } else {
          while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
            const t = this.parseValueType();
            if (t !== null) localDecls.push({ type: t, count: 1 });
            else break;
          }
        }
        this.expect(TokenType.Rpar);
      }

      const body: Expr[] = [];
      this.parseInstrListInto(body);

      const func: Func = { name, loc, typeVar: typeVar ?? varIndex(0), sig, localDecls, body, tailcall: false };
      module.funcs.push(func);
    }

    this.expect(TokenType.Rpar);
    return Result.Ok;
  }

  private parseGlobalType(): { type: Type; isMut: boolean } {
    if (this.matchLpar(TokenType.Mut)) {
      const t = this.parseValueType() ?? Type.I32;
      this.expect(TokenType.Rpar);
      return { type: t, isMut: true };
    }
    const t = this.parseValueType() ?? Type.I32;
    return { type: t, isMut: false };
  }

  private parseGlobalModuleField(module: Module): Result {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Global) !== Result.Ok) return Result.Error;
    const name = this.parseBindVarOpt();
    const globalIdx = module.numGlobalImports + module.globals.length;

    while (this.matchLpar(TokenType.Export)) {
      const expName = this.parseQuotedText() ?? '';
      this.expect(TokenType.Rpar);
      module.exports.push({ name: expName, kind: ExternalKind.Global, var: varIndex(globalIdx) });
    }

    const inlineImp = this.parseInlineImport();
    const { type, isMut } = this.parseGlobalType();

    if (inlineImp !== null) {
      const global: Global = { name, loc, type, mutable: isMut, init: [] };
      const imp: Import = { kind: ExternalKind.Global, module: inlineImp.moduleName, field: inlineImp.fieldName, global };
      module.imports.push(imp);
      module.numGlobalImports++;
    } else {
      const init: Expr[] = [];
      this.parseInstrListInto(init);
      const global: Global = { name, loc, type, mutable: isMut, init };
      module.globals.push(global);
    }

    this.expect(TokenType.Rpar);
    return Result.Ok;
  }

  private parseMemoryModuleField(module: Module): Result {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Memory) !== Result.Ok) return Result.Error;
    const name = this.parseBindVarOpt();
    const memIdx = module.numMemoryImports + module.memories.length;

    while (this.matchLpar(TokenType.Export)) {
      const expName = this.parseQuotedText() ?? '';
      this.expect(TokenType.Rpar);
      module.exports.push({ name: expName, kind: ExternalKind.Memory, var: varIndex(memIdx) });
    }

    const inlineImp = this.parseInlineImport();

    if (inlineImp !== null) {
      const limits = this.parseLimits() ?? { initial: 0, isShared: false, is64: false };
      const memory: Memory = { name, loc, limits };
      const imp: Import = { kind: ExternalKind.Memory, module: inlineImp.moduleName, field: inlineImp.fieldName, memory };
      module.imports.push(imp);
      module.numMemoryImports++;
    } else if (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.Data) {
      // Inline data segment
      this.drop(); this.drop();
      const data = this.parseTextList();
      this.expect(TokenType.Rpar);
      const pages = Math.ceil(data.length / 65536);
      const limits: Limits = { initial: pages, isShared: false, is64: false };
      const memory: Memory = { name, loc, limits };
      module.memories.push(memory);
      // Add data segment at offset 0
      const offsetExpr: Expr = { kind: 'const', value: constI32(0), loc } as ConstExpr;
      module.dataSegments.push({ name: '', kind: 'active', memoryVar: varIndex(memIdx), offset: [offsetExpr], data, loc });
    } else {
      const limits = this.parseLimits() ?? { initial: 0, isShared: false, is64: false };
      const memory: Memory = { name, loc, limits };
      module.memories.push(memory);
    }

    this.expect(TokenType.Rpar);
    return Result.Ok;
  }

  private parseTableModuleField(module: Module): Result {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Table) !== Result.Ok) return Result.Error;
    const name = this.parseBindVarOpt();
    const tableIdx = module.numTableImports + module.tables.length;

    while (this.matchLpar(TokenType.Export)) {
      const expName = this.parseQuotedText() ?? '';
      this.expect(TokenType.Rpar);
      module.exports.push({ name: expName, kind: ExternalKind.Table, var: varIndex(tableIdx) });
    }

    const inlineImp = this.parseInlineImport();

    if (inlineImp !== null) {
      const limits = this.parseLimits() ?? { initial: 0, isShared: false, is64: false };
      const elemType = this.parseValueType() ?? Type.FuncRef;
      const table: Table = { name, loc, elemType, limits, init: [] };
      const imp: Import = { kind: ExternalKind.Table, module: inlineImp.moduleName, field: inlineImp.fieldName, table };
      module.imports.push(imp);
      module.numTableImports++;
    } else {
      const tt = this.peek();
      const isElemRef = tt === TokenType.ValueType || tt === TokenType.Func || tt === TokenType.Extern || tt === TokenType.Ref;
      if (isElemRef) {
        // `(table elemtype (elem ...))` — inline elem
        const elemType = this.parseValueType() ?? Type.FuncRef;
        if (this.matchLpar(TokenType.Elem)) {
          const refs: Expr[] = [];
          while (this.peekMatchVar()) {
            const v = this.parseVar();
            if (v !== null) {
              refs.push({ kind: 'ref.func', func: v, loc } as RefFuncExpr);
            }
          }
          this.expect(TokenType.Rpar);
          const limits: Limits = { initial: refs.length, max: refs.length, isShared: false, is64: false };
          const table: Table = { name, loc, elemType, limits, init: [] };
          module.tables.push(table);
          // Add elem segment
          const offsetExpr: Expr = { kind: 'const', value: constI32(0), loc } as ConstExpr;
          module.elemSegments.push({ name: '', kind: 'active', tableVar: varIndex(tableIdx), offset: [offsetExpr], elemType, elemExprs: refs.map(r => [r]), loc });
        } else {
          const limits = this.parseLimits() ?? { initial: 0, isShared: false, is64: false };
          const table: Table = { name, loc, elemType, limits, init: [] };
          module.tables.push(table);
        }
      } else {
        // `(table N M? reftype)` or `(table N M?)`
        const limits = this.parseLimits() ?? { initial: 0, isShared: false, is64: false };
        const elemType = this.parseValueType() ?? Type.FuncRef;
        const table: Table = { name, loc, elemType, limits, init: [] };
        module.tables.push(table);
      }
    }

    this.expect(TokenType.Rpar);
    return Result.Ok;
  }

  private parseStartModuleField(module: Module): Result {
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Start) !== Result.Ok) return Result.Error;
    const v = this.parseVar();
    this.expect(TokenType.Rpar);
    if (v !== null) module.start = v;
    return Result.Ok;
  }

  private parseDataModuleField(module: Module): Result {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Data) !== Result.Ok) return Result.Error;
    const name = this.parseBindVarOpt();

    let memVar: Var = varIndex(0);
    let offset: Expr[] = [];
    let kind: 'active' | 'passive' = 'passive';

    if (this.matchLpar(TokenType.Memory)) {
      // (memory $id) (offset expr)
      const v = this.parseVar();
      if (v !== null) memVar = v;
      this.expect(TokenType.Rpar);
      const ctx = newCtx();
      this.parseOffsetExpr(ctx);
      flushStack(ctx);
      offset = ctx.stmts;
      kind = 'active';
    } else if (this.peekMatchVar()) {
      const v = this.parseVar();
      if (v !== null) memVar = v;
      const ctx = newCtx();
      this.parseOffsetExpr(ctx);
      flushStack(ctx);
      offset = ctx.stmts;
      kind = 'active';
    } else if (this.matchLpar(TokenType.Offset)) {
      const ctx = newCtx();
      this.parseInstrListInto(offset);
      this.expect(TokenType.Rpar);
      kind = 'active';
    } else if (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.Const) {
      // bare inline offset expr like (i32.const 0)
      const ctx = newCtx();
      this.parseInstrListInto(offset);
      if (offset.length > 0) kind = 'active';
    }

    const data = this.parseTextList();
    this.expect(TokenType.Rpar);

    if (kind === 'active') {
      module.dataSegments.push({ name, kind, memoryVar: memVar, offset, data, loc });
    } else {
      module.dataSegments.push({ name, kind: 'passive', memoryVar: varIndex(0), offset: [], data, loc });
    }
    return Result.Ok;
  }

  private parseElemModuleField(module: Module): Result {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Elem) !== Result.Ok) return Result.Error;
    const name = this.parseBindVarOpt();

    let tableVar: Var = varIndex(0);
    let offset: Expr[] = [];
    let elemType: Type = Type.FuncRef;
    const inits: Expr[][] = [];
    let kind: 'active' | 'passive' | 'declared' = 'passive';

    if (this.matchLpar(TokenType.Table)) {
      const v = this.parseVar();
      if (v !== null) tableVar = v;
      this.expect(TokenType.Rpar);
      const ctx = newCtx();
      this.parseOffsetExpr(ctx);
      flushStack(ctx);
      offset = ctx.stmts;
      kind = 'active';
    } else if (this.peekMatchVar()) {
      const v = this.parseVar();
      if (v !== null) tableVar = v;
      // Now expect offset expression
      const ctx = newCtx();
      if (this.matchLpar(TokenType.Offset)) {
        this.parseInstrListInto(offset);
        this.expect(TokenType.Rpar);
      } else {
        this.parseInstrListInto(offset);
      }
      kind = 'active';
    } else if (this.match(TokenType.Declare)) {
      kind = 'declared';
    }

    // Parse optional elem type or funcref
    if (this.match(TokenType.Func) || (this.peek() === TokenType.Func && this.peek() === TokenType.Function)) {
      elemType = Type.FuncRef;
      while (this.peekMatchVar()) {
        const v = this.parseVar();
        if (v !== null) inits.push([{ kind: 'ref.func', func: v, loc } as RefFuncExpr]);
      }
    } else if (this.peek() === TokenType.ValueType || this.peek() === TokenType.Ref) {
      elemType = this.parseValueType() ?? Type.FuncRef;
      // Parse elem expressions
      while (this.matchLpar(TokenType.Item)) {
        const itemExprs: Expr[] = [];
        this.parseInstrListInto(itemExprs);
        this.expect(TokenType.Rpar);
        inits.push(itemExprs);
      }
    } else {
      // Legacy: just var list
      while (this.peekMatchVar()) {
        const v = this.parseVar();
        if (v !== null) inits.push([{ kind: 'ref.func', func: v, loc } as RefFuncExpr]);
      }
    }

    this.expect(TokenType.Rpar);

    if (kind === 'active') {
      module.elemSegments.push({ name, kind, tableVar, offset, elemType, elemExprs: inits, loc });
    } else if (kind === 'declared') {
      module.elemSegments.push({ name, kind, tableVar: varIndex(0), offset: [], elemType, elemExprs: inits, loc });
    } else {
      module.elemSegments.push({ name, kind: 'passive', tableVar: varIndex(0), offset: [], elemType, elemExprs: inits, loc });
    }
    return Result.Ok;
  }

  private parseTagModuleField(module: Module): Result {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Tag) !== Result.Ok) return Result.Error;
    const name = this.parseBindVarOpt();
    const inlineImp = this.parseInlineImport();
    const { sig } = this.parseFuncSignature();
    const tag: Tag = { name, loc, sig };

    if (inlineImp !== null) {
      const imp: Import = { kind: ExternalKind.Tag, module: inlineImp.moduleName, field: inlineImp.fieldName, tag };
      module.imports.push(imp);
      module.numTagImports++;
    } else {
      module.tags.push(tag);
    }

    this.expect(TokenType.Rpar);
    return Result.Ok;
  }

  // -------------------------------------------------------------------------
  // Expression / instruction parsing
  // -------------------------------------------------------------------------

  /** Parse a list of instructions into `outExprs`, handling both forms. */
  parseInstrList(ctx: ExprCtx): Result {
    while (this.peekIsInstr()) {
      if (this.parseOneInstr(ctx) !== Result.Ok) break;
    }
    return Result.Ok;
  }

  /** Convenience: parse instructions into a flat expr array (flushes stack). */
  parseInstrListInto(outExprs: Expr[]): void {
    const ctx = newCtx();
    this.parseInstrList(ctx);
    flushStack(ctx);
    outExprs.push(...ctx.stmts);
  }

  private parseOneInstr(ctx: ExprCtx): Result {
    if (this.peek() === TokenType.Lpar) {
      // folded expression
      const next = this.peek(1);
      if (isPlainInstr(next) || isBlockInstr(next)) {
        return this.parseFoldedInstr(ctx);
      }
      return Result.Error;
    }
    if (isBlockInstr(this.peek())) return this.parseLinearBlockInstr(ctx);
    if (isPlainInstr(this.peek())) return this.parseLinearPlainInstr(ctx);
    return Result.Error;
  }

  // -------------------------------------------------------------------------
  // Folded instruction parsing
  // -------------------------------------------------------------------------

  private parseFoldedInstr(ctx: ExprCtx): Result {
    this.drop(); // consume '('
    const loc = this.loc();
    const tt = this.peek();

    if (isBlockInstr(tt)) {
      return this.parseFoldedBlockInstr(ctx);
    }

    // Folded plain instruction
    const tok = this.consume();
    const tt2 = tok.tokenType;
    const innerCtx = newCtx();

    // Parse sub-expressions (operands)
    while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof && this.peekIsInstr()) {
      this.parseOneInstr(innerCtx);
    }
    // collect sub-expression results into their stack
    flushStack(innerCtx);

    const expr = this.buildPlainExpr(tok, loc, innerCtx.stmts);
    if (this.expect(TokenType.Rpar) !== Result.Ok) return Result.Error;

    if (expr !== null) {
      if (instrProducesValue(tt2)) {
        ctx.stack.push(expr);
      } else {
        ctx.stmts.push(expr);
      }
    }
    return Result.Ok;
  }

  private parseFoldedBlockInstr(ctx: ExprCtx): Result {
    const loc = this.loc();
    const tt = this.peek();
    this.drop();

    if (tt === TokenType.Block || tt === TokenType.Loop) {
      const label = this.parseBindVarOpt();
      const blockType = this.parseBlockType();

      const bodyCtx = newCtx();
      this.parseInstrList(bodyCtx);
      flushStack(bodyCtx);

      this.expect(TokenType.Rpar);

      const hasValue = blockType.kind !== 'void';
      const node: BlockExpr | LoopExpr = tt === TokenType.Block
        ? { kind: 'block', label, blockType, body: bodyCtx.stmts, loc }
        : { kind: 'loop', label, blockType, body: bodyCtx.stmts, loc };
      if (hasValue) ctx.stack.push(node); else ctx.stmts.push(node);
      return Result.Ok;
    }

    if (tt === TokenType.If) {
      const label = this.parseBindVarOpt();
      const blockType = this.parseBlockType();

      // Optional condition in folded form: if it's a paren-expr, it's the cond
      let cond: Expr | undefined;
      if (this.peek() === TokenType.Lpar && this.peek(1) !== TokenType.Then && this.peek(1) !== TokenType.Else) {
        if (isPlainInstr(this.peek(1)) || isBlockInstr(this.peek(1))) {
          const condCtx = newCtx();
          this.parseFoldedInstr(condCtx);
          flushStack(condCtx);
          cond = condCtx.stmts[0] ?? condCtx.stack[0];
        }
      }
      if (cond === undefined && ctx.stack.length > 0) {
        cond = ctx.stack.pop();
      }

      // then branch
      const then_: Expr[] = [];
      if (this.matchLpar(TokenType.Then)) {
        this.parseInstrListInto(then_);
        this.expect(TokenType.Rpar);
      } else {
        this.parseInstrListInto(then_);
      }

      // else branch
      const else_: Expr[] = [];
      if (this.matchLpar(TokenType.Else)) {
        this.parseInstrListInto(else_);
        this.expect(TokenType.Rpar);
      }

      this.expect(TokenType.Rpar);

      const condExpr: Expr = cond ?? ({ kind: 'nop', loc } as NopExpr);
      const node: IfExpr = { kind: 'if', label, blockType, cond: condExpr, then_, else_, loc };
      const hasValue = blockType.kind !== 'void';
      if (hasValue) ctx.stack.push(node); else ctx.stmts.push(node);
      return Result.Ok;
    }

    // Try / TryTable — simplified
    if (tt === TokenType.Try || tt === TokenType.TryTable) {
      const label = this.parseBindVarOpt();
      const blockType = this.parseBlockType();
      const bodyCtx = newCtx();
      this.parseInstrList(bodyCtx);
      flushStack(bodyCtx);
      this.expect(TokenType.Rpar);
      const node: BlockExpr = { kind: 'block', label, blockType, body: bodyCtx.stmts, loc };
      const hasValue = blockType.kind !== 'void';
      if (hasValue) ctx.stack.push(node); else ctx.stmts.push(node);
      return Result.Ok;
    }

    this.error(loc, 'unexpected block instr');
    return Result.Error;
  }

  // -------------------------------------------------------------------------
  // Linear instruction parsing
  // -------------------------------------------------------------------------

  private parseLinearBlockInstr(ctx: ExprCtx): Result {
    const loc = this.loc();
    const tt = this.peek();
    this.drop();

    if (tt === TokenType.Block || tt === TokenType.Loop) {
      const label = this.parseBindVarOpt();
      const blockType = this.parseBlockType();
      const bodyCtx = newCtx();
      this.parseInstrList(bodyCtx);
      this.expect(TokenType.End);
      // optional label
      if (this.peek() === TokenType.Var) this.drop();
      flushStack(bodyCtx);
      const node: BlockExpr | LoopExpr = tt === TokenType.Block
        ? { kind: 'block', label, blockType, body: bodyCtx.stmts, loc }
        : { kind: 'loop', label, blockType, body: bodyCtx.stmts, loc };
      const hasValue = blockType.kind !== 'void';
      if (hasValue) ctx.stack.push(node); else ctx.stmts.push(node);
      return Result.Ok;
    }

    if (tt === TokenType.If) {
      const label = this.parseBindVarOpt();
      const blockType = this.parseBlockType();
      const cond = ctx.stack.pop();

      const then_: Expr[] = [];
      const then_Ctx = newCtx();
      this.parseInstrList(then_Ctx);

      const else_: Expr[] = [];
      if (this.match(TokenType.Else)) {
        if (this.peek() === TokenType.Var) this.drop();
        flushStack(then_Ctx);
        then_.push(...then_Ctx.stmts);
        const else_Ctx = newCtx();
        this.parseInstrList(else_Ctx);
        flushStack(else_Ctx);
        else_.push(...else_Ctx.stmts);
      } else {
        flushStack(then_Ctx);
        then_.push(...then_Ctx.stmts);
      }

      this.expect(TokenType.End);
      if (this.peek() === TokenType.Var) this.drop();

      const condExpr2: Expr = cond ?? ({ kind: 'nop', loc } as NopExpr);
      const node: IfExpr = { kind: 'if', label, blockType, cond: condExpr2, then_, else_, loc };
      const hasValue = blockType.kind !== 'void';
      if (hasValue) ctx.stack.push(node); else ctx.stmts.push(node);
      return Result.Ok;
    }

    // Try / TryTable  simplified
    if (tt === TokenType.Try || tt === TokenType.TryTable) {
      const label = this.parseBindVarOpt();
      const blockType = this.parseBlockType();
      const bodyCtx = newCtx();
      this.parseInstrList(bodyCtx);
      // skip to matching end
      let depth = 1;
      while (this.peek() !== TokenType.Eof) {
        const cur = this.peek();
        if (isBlockInstr(cur)) depth++;
        else if (cur === TokenType.End) { depth--; if (depth === 0) break; }
        this.drop();
      }
      this.expect(TokenType.End);
      flushStack(bodyCtx);
      const node: BlockExpr = { kind: 'block', label, blockType, body: bodyCtx.stmts, loc };
      const hasValue = blockType.kind !== 'void';
      if (hasValue) ctx.stack.push(node); else ctx.stmts.push(node);
      return Result.Ok;
    }

    this.error(loc, 'unexpected block instr');
    return Result.Error;
  }

  private parseLinearPlainInstr(ctx: ExprCtx): Result {
    const loc = this.loc();
    const tok = this.consume();
    const tt = tok.tokenType;
    const nInputs = instrInputCount(tt);

    let operands: Expr[];
    if (nInputs === -1) {
      // variable arity — consume all stack items
      operands = [...ctx.stack];
      ctx.stack.length = 0;
    } else {
      operands = popN(ctx, nInputs, loc);
    }

    const expr = this.buildPlainExpr(tok, loc, operands);
    if (expr === null) return Result.Error;

    if (instrProducesValue(tt)) {
      ctx.stack.push(expr);
    } else {
      ctx.stmts.push(expr);
    }
    return Result.Ok;
  }

  // -------------------------------------------------------------------------
  // Build plain expression from token + operands
  // -------------------------------------------------------------------------

  private buildPlainExpr(tok: Token, loc: Location, operands: Expr[]): Expr | null {
    const tt = tok.tokenType;
    const op0 = (): Expr => operands[0] ?? ({ kind: 'nop', loc } as NopExpr);
    const op1 = (): Expr => operands[1] ?? ({ kind: 'nop', loc } as NopExpr);
    const op2 = (): Expr => operands[2] ?? ({ kind: 'nop', loc } as NopExpr);
    const op3 = (): Expr => operands[3] ?? ({ kind: 'nop', loc } as NopExpr);

    switch (tt) {
      case TokenType.Unreachable: return { kind: 'unreachable', loc } as UnreachableExpr;
      case TokenType.Nop: return { kind: 'nop', loc } as NopExpr;
      case TokenType.Drop: return { kind: 'drop', value: op0(), loc } as DropExpr;
      case TokenType.Select: {
        const resultType: Type[] = [];
        if (this.matchLpar(TokenType.Result)) {
          while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
            const t = this.parseValueType();
            if (t !== null) resultType.push(t);
          }
          this.expect(TokenType.Rpar);
        }
        return { kind: 'select', val1: op0(), val2: op1(), cond: op2(), resultType, loc } as SelectExpr;
      }
      case TokenType.Return: return { kind: 'return', value: operands[0], loc } as ReturnExpr;
      case TokenType.Br: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'br', target: v, value: operands[0], loc } as BrExpr;
      }
      case TokenType.BrIf: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'br_if', target: v, cond: op0(), value: operands[1], loc } as BrIfExpr;
      }
      case TokenType.BrOnNull: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'br_on_null', target: v, value: op0(), loc } as BrOnNullExpr;
      }
      case TokenType.BrOnNonNull: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'br_on_non_null', target: v, value: op0(), loc } as BrOnNonNullExpr;
      }
      case TokenType.BrTable: {
        const targets: Var[] = [];
        while (this.peekMatchVar()) {
          const v = this.parseVar();
          if (v !== null) targets.push(v);
        }
        const defaultTarget = targets.pop() ?? varIndex(0);
        return { kind: 'br_table', targets, defaultTarget, value: op0(), loc } as BrTableExpr;
      }
      case TokenType.Call: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'call', func: v, args: operands, loc } as CallExpr;
      }
      case TokenType.CallIndirect: {
        const tableVar = this.parseVarOpt(varIndex(0));
        const typeVar = this.parseTypeUseOpt();
        const { sig } = this.parseFuncSignature();
        const callee = operands[operands.length - 1] ?? ({ kind: 'nop', loc } as NopExpr);
        const args = operands.slice(0, -1);
        return { kind: 'call_indirect', table: tableVar, sig, typeVar: typeVar ?? varIndex(0), args, callee, loc } as CallIndirectExpr;
      }
      case TokenType.CallRef: {
        const v = this.parseVar();
        if (v === null) return null;
        const callee = operands[operands.length - 1] ?? ({ kind: 'nop', loc } as NopExpr);
        const args = operands.slice(0, -1);
        return { kind: 'call_ref', sigType: v, args, callee, loc } as CallRefExpr;
      }
      case TokenType.ReturnCall: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'return_call', func: v, args: operands, loc } as ReturnCallExpr;
      }
      case TokenType.ReturnCallIndirect: {
        const tableVar = this.parseVarOpt(varIndex(0));
        const typeVar = this.parseTypeUseOpt();
        const { sig } = this.parseFuncSignature();
        const callee = operands[operands.length - 1] ?? ({ kind: 'nop', loc } as NopExpr);
        const args = operands.slice(0, -1);
        return { kind: 'return_call_indirect', sig, typeVar: typeVar ?? varIndex(0), table: tableVar, args, callee, loc } as ReturnCallIndirectExpr;
      }
      case TokenType.ReturnCallRef: {
        const v = this.parseVar();
        if (v === null) return null;
        const callee = operands[operands.length - 1] ?? ({ kind: 'nop', loc } as NopExpr);
        const args = operands.slice(0, -1);
        return { kind: 'return_call_ref', sigType: v, args, callee, loc } as ReturnCallRefExpr;
      }
      case TokenType.LocalGet: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'local.get', var: v, loc } as LocalGetExpr;
      }
      case TokenType.LocalSet: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'local.set', var: v, value: op0(), loc } as LocalSetExpr;
      }
      case TokenType.LocalTee: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'local.tee', var: v, value: op0(), loc } as LocalTeeExpr;
      }
      case TokenType.GlobalGet: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'global.get', var: v, loc } as GlobalGetExpr;
      }
      case TokenType.GlobalSet: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'global.set', var: v, value: op0(), loc } as GlobalSetExpr;
      }

      case TokenType.Const: {
        const c = this.parseConst((tok as OpcodeToken).opcode as unknown as number);
        if (c === null) return null;
        return { kind: 'const', value: c, loc } as ConstExpr;
      }

      case TokenType.Load: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return { kind: 'load', opcode: op as unknown as Opcode, memidx, offset, align, address: op0(), loc } as LoadExpr;
      }
      case TokenType.Store: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return { kind: 'store', opcode: op as unknown as Opcode, memidx, offset, align, address: op0(), value: op1(), loc } as StoreExpr;
      }

      case TokenType.MemorySize: {
        const memidx = this.parseMemidxOpt(loc);
        return { kind: 'memory.size', memidx, loc } as MemorySizeExpr;
      }
      case TokenType.MemoryGrow: {
        const memidx = this.parseMemidxOpt(loc);
        return { kind: 'memory.grow', memidx, delta: op0(), loc } as MemoryGrowExpr;
      }
      case TokenType.MemoryCopy: {
        const destMemidx = this.parseMemidxOpt(loc);
        const srcMemidx = this.parseMemidxOpt(loc);
        return { kind: 'memory.copy', destMemidx, srcMemidx, dest: op0(), src: op1(), size: op2(), loc } as MemoryCopyExpr;
      }
      case TokenType.MemoryFill: {
        const memidx = this.parseMemidxOpt(loc);
        return { kind: 'memory.fill', memidx, dest: op0(), value: op1(), size: op2(), loc } as MemoryFillExpr;
      }
      case TokenType.MemoryInit: {
        const segment = this.parseVar() ?? varIndex(0);
        const memidx = this.parseMemidxOpt(loc);
        return { kind: 'memory.init', segment, memidx, dest: op0(), src: op1(), size: op2(), loc } as MemoryInitExpr;
      }
      case TokenType.DataDrop: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'data.drop', segment: v, loc } as DataDropExpr;
      }

      case TokenType.TableGet: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'table.get', table: v, index: op0(), loc } as TableGetExpr;
      }
      case TokenType.TableSet: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'table.set', table: v, index: op0(), value: op1(), loc } as TableSetExpr;
      }
      case TokenType.TableGrow: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'table.grow', table: v, initValue: op0(), delta: op1(), loc } as TableGrowExpr;
      }
      case TokenType.TableSize: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'table.size', table: v, loc } as TableSizeExpr;
      }
      case TokenType.TableFill: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'table.fill', table: v, start: op0(), value: op1(), size: op2(), loc } as TableFillExpr;
      }
      case TokenType.TableCopy: {
        const dst = this.parseVar() ?? varIndex(0);
        const src = this.parseVar() ?? varIndex(0);
        return { kind: 'table.copy', dst, src, dest: op0(), srcOffset: op1(), size: op2(), loc } as TableCopyExpr;
      }
      case TokenType.TableInit: {
        const segment = this.parseVar() ?? varIndex(0);
        const table = this.parseVar() ?? varIndex(0);
        return { kind: 'table.init', segment, table, dest: op0(), src: op1(), size: op2(), loc } as TableInitExpr;
      }
      case TokenType.ElemDrop: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'elem.drop', segment: v, loc } as ElemDropExpr;
      }

      case TokenType.RefNull: {
        const t = this.parseValueType() ?? Type.FuncRef;
        return { kind: 'ref.null', refType: varName(typeToName(t)), loc } as RefNullExpr;
      }
      case TokenType.RefIsNull: return { kind: 'ref.is_null', value: op0(), loc } as RefIsNullExpr;
      case TokenType.RefFunc: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'ref.func', func: v, loc } as RefFuncExpr;
      }
      case TokenType.RefAsNonNull: return { kind: 'ref.as_non_null', value: op0(), loc } as RefAsNonNullExpr;

      case TokenType.Throw: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'throw', tag: v, args: operands, loc } as ThrowExpr;
      }
      case TokenType.ThrowRef: return { kind: 'throw_ref', exnref: op0(), loc } as ThrowRefExpr;
      case TokenType.Rethrow: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'rethrow', depth: v, loc } as RethrowExpr;
      }

      case TokenType.Unary: {
        const op = (tok as OpcodeToken).opcode;
        return { kind: 'unary', opcode: op, operand: op0(), loc } as UnaryExpr;
      }
      case TokenType.Binary: {
        const op = (tok as OpcodeToken).opcode;
        return { kind: 'binary', opcode: op, left: op0(), right: op1(), loc } as BinaryExpr;
      }
      case TokenType.Compare: {
        const op = (tok as OpcodeToken).opcode;
        return { kind: 'compare', opcode: op, left: op0(), right: op1(), loc } as CompareExpr;
      }
      case TokenType.Convert: {
        const op = (tok as OpcodeToken).opcode;
        return { kind: 'convert', opcode: op, operand: op0(), loc } as ConvertExpr;
      }
      case TokenType.Ternary: {
        const op = (tok as OpcodeToken).opcode;
        return { kind: 'ternary', opcode: op, a: op0(), b: op1(), c: op2(), loc } as TernaryExpr;
      }
      case TokenType.Quaternary: {
        const op = (tok as OpcodeToken).opcode;
        return { kind: 'quaternary', opcode: op, a: op0(), b: op1(), c: op2(), d: op3(), loc } as QuaternaryExpr;
      }

      case TokenType.AtomicFence: return { kind: 'atomic_fence', consistencyModel: 0, loc } as AtomicFenceExpr;
      case TokenType.AtomicLoad: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return { kind: 'atomic_load', opcode: op as unknown as Opcode, memidx, offset, align, address: op0(), loc } as AtomicLoadExpr;
      }
      case TokenType.AtomicStore: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return { kind: 'atomic_store', opcode: op as unknown as Opcode, memidx, offset, align, address: op0(), value: op1(), loc } as AtomicStoreExpr;
      }
      case TokenType.AtomicRmw: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return { kind: 'atomic_rmw', opcode: op as unknown as Opcode, memidx, offset, align, address: op0(), value: op1(), loc } as AtomicRmwExpr;
      }
      case TokenType.AtomicRmwCmpxchg: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return { kind: 'atomic_rmw_cmpxchg', opcode: op as unknown as Opcode, memidx, offset, align, address: op0(), expected: op1(), replacement: op2(), loc } as AtomicRmwCmpxchgExpr;
      }
      case TokenType.AtomicNotify: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return { kind: 'atomic_notify', opcode: op as unknown as Opcode, memidx, offset, align, address: op0(), count: op1(), loc } as AtomicNotifyExpr;
      }
      case TokenType.AtomicWait: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return { kind: 'atomic_wait', opcode: op as unknown as Opcode, memidx, offset, align, address: op0(), expected: op1(), timeout: op2(), loc } as AtomicWaitExpr;
      }

      case TokenType.SimdLaneOp: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const lane = this.parseSimdLane();
        return { kind: 'simd_lane_op', opcode: op as unknown as Opcode, lane, operand: op0(), loc } as SimdLaneOpExpr;
      }
      case TokenType.SimdShuffleOp: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const laneArr = new Uint8Array(16);
        for (let i = 0; i < 16; i++) {
          if (this.peek() === TokenType.Nat || this.peek() === TokenType.Int) {
            const t = (this.consume() as LiteralToken).literal.text;
            laneArr[i] = Number(parseNatText(t) ?? 0n);
          }
        }
        return { kind: 'simd_shuffle', opcode: op as unknown as Opcode, lanes: laneArr, left: op0(), right: op1(), loc } as SimdShuffleOpExpr;
      }
      case TokenType.SimdLoadLane: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        const lane = this.parseSimdLane();
        return { kind: 'simd_load_lane', opcode: op as unknown as Opcode, memidx, offset, align, lane, address: op0(), vec: op1(), loc } as SimdLoadLaneExpr;
      }
      case TokenType.SimdStoreLane: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        const lane = this.parseSimdLane();
        return { kind: 'simd_store_lane', opcode: op as unknown as Opcode, memidx, offset, align, lane, address: op0(), vec: op1(), loc } as SimdStoreLaneExpr;
      }

      default:
        this.error(loc, `unhandled instruction: ${tokenName(tt)}`);
        return null;
    }
  }

  // -------------------------------------------------------------------------
  // Const parsing (for i32.const, i64.const, f32.const, f64.const)
  // -------------------------------------------------------------------------

  private parseConst(opcode: number): Const | null {
    const loc = this.loc();
    // Map from opcode to type
    const type = constOpcodeType(opcode);
    const tok = this.peekToken();

    if (type === Type.I32) {
      const n = this.parseNatOrInt();
      if (n === null) { this.error(loc, 'expected i32 constant'); return null; }
      return constI32(Number(BigInt.asIntN(32, n)));
    }
    if (type === Type.I64) {
      const n = this.parseNatOrInt();
      if (n === null) { this.error(loc, 'expected i64 constant'); return null; }
      return constI64(BigInt.asIntN(64, n));
    }
    if (type === Type.F32) {
      const bits = this.parseFloatBits(32);
      if (bits === null) { this.error(loc, 'expected f32 constant'); return null; }
      return constF32(bits);
    }
    if (type === Type.F64) {
      const bits = this.parseFloatBits(64);
      if (bits === null) { this.error(loc, 'expected f64 constant'); return null; }
      return constF64(BigInt(bits));
    }
    this.error(loc, 'unknown const type');
    return null;
  }

  private parseNatOrInt(): bigint | null {
    const tt = this.peek();
    if (tt !== TokenType.Nat && tt !== TokenType.Int) return null;
    const tok = this.consume() as LiteralToken;
    return parseNatText(tok.literal.text);
  }

  private parseFloatBits(width: 32 | 64): number | null {
    const tt = this.peek();
    if (tt === TokenType.Float) {
      const tok = this.consume() as LiteralToken;
      return parseFloatLiteralBits(tok.literal, width);
    }
    if (tt === TokenType.Nat || tt === TokenType.Int) {
      const tok = this.consume() as LiteralToken;
      const n = parseNatText(tok.literal.text);
      if (n === null) return null;
      return Number(n);
    }
    if (tt === TokenType.NanArithmetic) {
      this.drop();
      return width === 32 ? 0x7fc00000 : 0x7ff8000000000000;
    }
    if (tt === TokenType.NanCanonical) {
      this.drop();
      return width === 32 ? 0x7fc00000 : 0x7ff8000000000000;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Block type parsing
  // -------------------------------------------------------------------------

  private parseBlockType(): BlockType {
    // Optional `(type $id)` followed by optional `(result ...)`
    if (this.matchLpar(TokenType.Result)) {
      const types: Type[] = [];
      while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
        const t = this.parseValueType();
        if (t !== null) types.push(t); else break;
      }
      this.expect(TokenType.Rpar);
      if (types.length === 1) return blockTypeValue(types[0]!);
      if (types.length === 0) return BLOCK_TYPE_VOID;
      // multi-value: use func_type index (simplified: use first type)
      return blockTypeValue(types[0]!);
    }
    // Also allow `(type N)` for explicit func type index
    if (this.matchLpar(TokenType.Type)) {
      const v = this.parseVar();
      this.expect(TokenType.Rpar);
      if (v !== null && v.kind === 'index') return { kind: 'func_type', typeIdx: v.value };
    }
    return BLOCK_TYPE_VOID;
  }

  // -------------------------------------------------------------------------
  // Memory index parsing
  // -------------------------------------------------------------------------

  private parseMemidxOpt(loc: Location): Var {
    if (this.matchLpar(TokenType.Memory)) {
      const v = this.parseVar() ?? varIndex(0);
      this.expect(TokenType.Rpar);
      return v;
    }
    return varIndex(0);
  }

  private parseSimdLane(): number {
    if (this.peek() === TokenType.Nat || this.peek() === TokenType.Int) {
      const tok = this.consume() as LiteralToken;
      const n = parseNatText(tok.literal.text);
      return n !== null ? Number(n) : 0;
    }
    return 0;
  }

  // -------------------------------------------------------------------------
  // WAST script parsing
  // -------------------------------------------------------------------------

  parseScript(): WastScript {
    const commands: WastCommand[] = [];
    const filename = this.peekToken().loc.filename;

    // Handle inline module (no script commands)
    if (this.peekIsModuleField()) {
      const module = makeModule();
      this.parseModuleFieldList(module);
      commands.push({ kind: 'module', scriptModule: { kind: 'text', name: null, module, loc: this.peekToken().loc } });
    } else {
      while (isCommand(this.peek(), this.peek(1))) {
        const cmd = this.parseCommand();
        if (cmd !== null) commands.push(cmd);
      }
    }

    this.expect(TokenType.Eof);
    return { filename, commands };
  }

  private parseCommand(): WastCommand | null {
    const loc = this.loc();
    const tt1 = this.peek(1);

    switch (tt1) {
      case TokenType.Module: {
        const sm = this.parseScriptModule();
        if (sm === null) return null;
        return { kind: 'module', scriptModule: sm };
      }
      case TokenType.Register: {
        this.drop(); this.drop(); // '(' 'register'
        const name = this.parseQuotedText() ?? '';
        const as_ = this.peek() === TokenType.Var ? (this.consume() as StringToken).text : null;
        this.expect(TokenType.Rpar);
        return { kind: 'register', name, as: as_, loc };
      }
      case TokenType.Invoke: case TokenType.Get: {
        const action = this.parseAction();
        if (action === null) return null;
        return { kind: 'action', action };
      }
      case TokenType.AssertReturn: {
        this.drop(); this.drop();
        const action = this.parseAction();
        if (action === null) { this.expect(TokenType.Rpar); return null; }
        const expected: ExpectedConst[] = [];
        while (this.peek() === TokenType.Lpar) {
          const e = this.parseExpectedConst();
          if (e !== null) expected.push(e);
          else break;
        }
        this.expect(TokenType.Rpar);
        return { kind: 'assert_return', action, expected, loc };
      }
      case TokenType.AssertTrap: {
        this.drop(); this.drop();
        // could be action or module
        if (this.peek() === TokenType.Lpar && (this.peek(1) === TokenType.Invoke || this.peek(1) === TokenType.Get)) {
          const action = this.parseAction();
          if (action === null) { this.expect(TokenType.Rpar); return null; }
          const text = this.parseQuotedText() ?? '';
          this.expect(TokenType.Rpar);
          return { kind: 'assert_trap', action, text, loc };
        }
        const sm = this.parseScriptModule();
        const text = this.parseQuotedText() ?? '';
        this.expect(TokenType.Rpar);
        if (sm === null) return null;
        return { kind: 'assert_invalid', scriptModule: sm, text, loc };
      }
      case TokenType.AssertException: {
        this.drop(); this.drop();
        const action = this.parseAction();
        this.expect(TokenType.Rpar);
        if (action === null) return null;
        return { kind: 'assert_exception', action, loc };
      }
      case TokenType.AssertExhaustion: {
        this.drop(); this.drop();
        const action = this.parseAction();
        if (action === null) { this.expect(TokenType.Rpar); return null; }
        const text = this.parseQuotedText() ?? '';
        this.expect(TokenType.Rpar);
        return { kind: 'assert_exhaustion', action, text, loc };
      }
      case TokenType.AssertInvalid: {
        this.drop(); this.drop();
        const sm = this.parseScriptModule();
        const text = this.parseQuotedText() ?? '';
        this.expect(TokenType.Rpar);
        if (sm === null) return null;
        return { kind: 'assert_invalid', scriptModule: sm, text, loc };
      }
      case TokenType.AssertMalformed: {
        this.drop(); this.drop();
        const sm = this.parseScriptModule();
        const text = this.parseQuotedText() ?? '';
        this.expect(TokenType.Rpar);
        if (sm === null) return null;
        return { kind: 'assert_malformed', scriptModule: sm, text, loc };
      }
      case TokenType.AssertUnlinkable: {
        this.drop(); this.drop();
        const sm = this.parseScriptModule();
        const text = this.parseQuotedText() ?? '';
        this.expect(TokenType.Rpar);
        if (sm === null) return null;
        return { kind: 'assert_unlinkable', scriptModule: sm, text, loc };
      }
      default:
        // Could be an inline module field
        if (this.peekIsModuleField()) {
          const module = makeModule();
          this.parseModuleFieldList(module);
          return { kind: 'module', scriptModule: { kind: 'text', name: null, module, loc } };
        }
        this.error(loc, `unexpected command: ${tokenName(tt1)}`);
        this.drop(); this.drop();
        return null;
    }
  }

  private parseScriptModule(): WastScriptModule | null {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return null;
    if (this.expect(TokenType.Module) !== Result.Ok) return null;
    const name = this.parseBindVarOpt() || null;

    if (this.match(TokenType.Bin)) {
      const data = this.parseTextList();
      this.expect(TokenType.Rpar);
      return { kind: 'binary', name, data, loc };
    }
    if (this.match(TokenType.Quote)) {
      const source = this.parseQuotedText() ?? '';
      this.expect(TokenType.Rpar);
      return { kind: 'quote', name, source, loc };
    }

    const module = makeModule();
    module.name = name ?? '';
    this.parseModuleFieldList(module);
    this.expect(TokenType.Rpar);
    return { kind: 'text', name, module, loc };
  }

  private parseAction(): WastAction | null {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return null;
    const tt = this.peek();

    if (tt === TokenType.Invoke) {
      this.drop();
      const name = this.peek() === TokenType.Var ? (this.consume() as StringToken).text : null;
      const field = this.parseQuotedText() ?? '';
      const args: Const[] = [];
      while (this.peek() === TokenType.Lpar) {
        const c = this.parseConstExprArg();
        if (c !== null) args.push(c);
        else break;
      }
      this.expect(TokenType.Rpar);
      return { kind: 'invoke', name, field, args, loc };
    }

    if (tt === TokenType.Get) {
      this.drop();
      const name = this.peek() === TokenType.Var ? (this.consume() as StringToken).text : null;
      const field = this.parseQuotedText() ?? '';
      this.expect(TokenType.Rpar);
      return { kind: 'get', name, field, loc };
    }

    this.error(loc, 'expected invoke or get action');
    return null;
  }

  /** Parse a const expr like `(i32.const 42)` for action args. */
  private parseConstExprArg(): Const | null {
    if (this.expect(TokenType.Lpar) !== Result.Ok) return null;
    if (this.peek() !== TokenType.Const) {
      this.error(this.loc(), 'expected const instr');
      // skip to rpar
      while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) this.drop();
      this.expect(TokenType.Rpar);
      return null;
    }
    const tok = this.consume() as OpcodeToken;
    const c = this.parseConst(tok.opcode as unknown as number);
    this.expect(TokenType.Rpar);
    return c;
  }

  /** Parse an expected-return value like `(i32.const 42)` or `(f32.const nan:canonical)`. */
  private parseExpectedConst(): ExpectedConst | null {
    if (this.peek() !== TokenType.Lpar) return null;
    const savedPos = this.pos;
    this.drop(); // consume '('

    if (this.peek() === TokenType.Const) {
      const tok = this.consume() as OpcodeToken;
      const opcode = tok.opcode as unknown as number;
      const type = constOpcodeType(opcode);

      // Check for nan:canonical / nan:arithmetic
      if (type === Type.F32 || type === Type.F64) {
        if (this.peek() === TokenType.NanCanonical) {
          this.drop();
          this.expect(TokenType.Rpar);
          return { kind: 'nan:canonical', valType: type };
        }
        if (this.peek() === TokenType.NanArithmetic) {
          this.drop();
          this.expect(TokenType.Rpar);
          return { kind: 'nan:arithmetic', valType: type };
        }
      }

      const c = this.parseConst(opcode);
      this.expect(TokenType.Rpar);
      if (c === null) return null;
      return { kind: 'value', value: c };
    }

    if (this.peek() === TokenType.RefNull) {
      this.drop();
      const t = this.parseValueType() ?? Type.FuncRef;
      this.expect(TokenType.Rpar);
      return { kind: 'ref.null', refType: t };
    }

    if (this.peek() === TokenType.RefFunc) {
      this.drop();
      this.expect(TokenType.Rpar);
      return { kind: 'ref.func' };
    }

    // Not an expected value — restore position
    this.pos = savedPos;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenName(tt: TokenType): string {
  switch (tt) {
    case TokenType.Lpar: return '(';
    case TokenType.Rpar: return ')';
    case TokenType.Eof: return 'EOF';
    case TokenType.Module: return 'module';
    case TokenType.Function: return 'func';
    case TokenType.Type: return 'type';
    case TokenType.Import: return 'import';
    case TokenType.Export: return 'export';
    case TokenType.Global: return 'global';
    case TokenType.Memory: return 'memory';
    case TokenType.Table: return 'table';
    case TokenType.Start: return 'start';
    case TokenType.Data: return 'data';
    case TokenType.Elem: return 'elem';
    case TokenType.Const: return 'CONST';
    case TokenType.Param: return 'param';
    case TokenType.Result: return 'result';
    case TokenType.Local: return 'local';
    case TokenType.End: return 'end';
    case TokenType.Else: return 'else';
    case TokenType.Then: return 'then';
    case TokenType.Invoke: return 'invoke';
    case TokenType.Register: return 'register';
    case TokenType.AssertReturn: return 'assert_return';
    default: return `<token:${tt}>`;
  }
}

/** Map a const opcode to its value type. */
function constOpcodeType(opcode: number): Type {
  switch (opcode) {
    case Opcode.I32Const: return Type.I32;
    case Opcode.I64Const: return Type.I64;
    case Opcode.F32Const: return Type.F32;
    case Opcode.F64Const: return Type.F64;
    default:
      // V128 const uses SIMD prefix
      return Type.V128;
  }
}

/** Map a Type to its WAT keyword string. */
function typeToName(t: Type): string {
  switch (t) {
    case Type.FuncRef: return 'funcref';
    case Type.ExternRef: return 'externref';
    case Type.ExnRef: return 'exnref';
    default: return 'funcref';
  }
}

/** Parse a float literal (LiteralToken) to its bit pattern. */
function parseFloatLiteralBits(lit: { literalType: LiteralType; text: string }, width: 32 | 64): number | null {
  const { literalType, text } = lit;
  if (literalType === LiteralType.Infinity) {
    const neg = text.startsWith('-');
    if (width === 32) return neg ? 0xff800000 : 0x7f800000;
    return neg ? 0xfff0000000000000 : 0x7ff0000000000000;
  }
  if (literalType === LiteralType.Nan) {
    if (text.includes(':')) {
      // nan:0xHHH — payload
      const payloadStr = text.split(':')[1] ?? '0x0';
      const payload = Number(BigInt(payloadStr));
      if (width === 32) return 0x7f800000 | (payload & 0x3fffff);
      return 0x7ff0000000000000 | (payload & 0x000fffffffffffff);
    }
    // canonical nan
    if (width === 32) return 0x7fc00000;
    return 0x7ff8000000000000;
  }
  if (literalType === LiteralType.Float || literalType === LiteralType.Hexfloat) {
    const v = parseFloat(text.replace(/_/g, ''));
    if (width === 32) {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setFloat32(0, v, true);
      return new DataView(buf).getUint32(0, true);
    }
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, v, true);
    const lo = new DataView(buf).getUint32(0, true);
    const hi = new DataView(buf).getUint32(4, true);
    return (hi * 0x100000000 + lo);
  }
  // integer literal used as float bits
  const n = parseNatText(text);
  if (n === null) return null;
  return Number(n);
}

// ---------------------------------------------------------------------------
// Top-level exported parse functions
// ---------------------------------------------------------------------------

export interface ParseWatResult {
  readonly module: Module;
  readonly errors: WabtError[];
}

export interface ParseWastResult {
  readonly script: WastScript;
  readonly errors: WabtError[];
}

/** Parse a WAT text file into a Module IR. */
export function parseWatModule(src: LexerSource | string): ParseWatResult {
  const lexer = new WastLexer(src);
  const tokens = lexer.tokenize();
  const parser = new WastParser(tokens);
  const module = parser.parseModule();
  const errors = [...lexer.errors, ...parser.errors];
  return { module, errors };
}

/** Parse a WAST script file into a WastScript. */
export function parseWastScript(src: LexerSource | string): ParseWastResult {
  const lexer = new WastLexer(src);
  const tokens = lexer.tokenize();
  const parser = new WastParser(tokens);
  const script = parser.parseScript();
  const errors = [...lexer.errors, ...parser.errors];
  return { script, errors };
}
