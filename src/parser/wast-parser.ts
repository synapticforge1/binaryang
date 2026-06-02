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
import { Result } from '../core/result.ts';
import { GcOpcode, Opcode } from '../core/opcode.ts';
import { Type } from '../core/types.ts';
import {
  type ArrayGetExpr,
  type ArrayLenExpr,
  type ArrayNewDataExpr,
  type ArrayNewDefaultExpr,
  type ArrayNewElemExpr,
  type ArrayNewExpr,
  type ArrayNewFixedExpr,
  type ArraySetExpr,
  type AtomicFenceExpr,
  type AtomicLoadExpr,
  type AtomicNotifyExpr,
  type AtomicRmwCmpxchgExpr,
  type AtomicRmwExpr,
  type AtomicStoreExpr,
  type AtomicWaitExpr,
  type BinaryExpr,
  BLOCK_TYPE_VOID,
  type BlockExpr,
  type BlockType,
  blockTypeValue,
  type BrExpr,
  type BrIfExpr,
  type BrOnNonNullExpr,
  type BrOnNullExpr,
  type BrTableExpr,
  type CallExpr,
  type CallIndirectExpr,
  type CallRefExpr,
  type Catch,
  CatchKind,
  type CompareExpr,
  type Const,
  type ConstExpr,
  constF32,
  constF64,
  constI32,
  constI64,
  constV128,
  type ConvertExpr,
  type DataDropExpr,
  type DropExpr,
  type ElemDropExpr,
  type Expr,
  ExternalKind,
  type Field,
  type Func,
  type FuncSignature,
  type Global,
  type GlobalGetExpr,
  type GlobalSetExpr,
  type I31GetExpr,
  type IfExpr,
  type Import,
  type Limits,
  type LoadExpr,
  type LocalDecl,
  type LocalGetExpr,
  type LocalSetExpr,
  type LocalTeeExpr,
  type LoopExpr,
  makeModule,
  type Memory,
  type MemoryCopyExpr,
  type MemoryFillExpr,
  type MemoryGrowExpr,
  type MemoryInitExpr,
  type MemorySizeExpr,
  type Module,
  type NopExpr,
  type QuaternaryExpr,
  type RefAsNonNullExpr,
  type RefCastExpr,
  type RefEqExpr,
  type RefFuncExpr,
  type RefI31Expr,
  type RefIsNullExpr,
  type RefNullExpr,
  type RefTestExpr,
  type RethrowExpr,
  type ReturnCallExpr,
  type ReturnCallIndirectExpr,
  type ReturnCallRefExpr,
  type ReturnExpr,
  type SelectExpr,
  type SimdLaneOpExpr,
  type SimdLoadLaneExpr,
  type SimdShuffleOpExpr,
  type SimdStoreLaneExpr,
  type StoreExpr,
  type StructGetExpr,
  type StructNewDefaultExpr,
  type StructNewExpr,
  type StructSetExpr,
  type Table,
  type TableCatch,
  type TableCopyExpr,
  type TableFillExpr,
  type TableGetExpr,
  type TableGrowExpr,
  type TableInitExpr,
  type TableSetExpr,
  type TableSizeExpr,
  type Tag,
  type TernaryExpr,
  type ThrowExpr,
  type ThrowRefExpr,
  type TryExpr,
  type TryTableExpr,
  type TypeEntry,
  type UnaryExpr,
  type UnreachableExpr,
  type Var,
  varIndex,
  varName,
} from '../ir/ir.ts';
import { LexerSource } from './lexer-source.ts';
import { WastLexer } from './wast-lexer.ts';
import {
  type LiteralToken,
  LiteralType,
  type OpcodeToken,
  type RefKindToken,
  type StringToken,
  type Token,
  TokenType,
  type TypeToken,
} from './token.ts';

// ---------------------------------------------------------------------------
// WAST Script types
// ---------------------------------------------------------------------------

/** A single invoke or get action in a WAST script. */
export type WastAction =
  | {
    readonly kind: 'invoke';
    readonly name: string | null;
    readonly field: string;
    readonly args: Const[];
    readonly loc: Location;
  }
  | {
    readonly kind: 'get';
    readonly name: string | null;
    readonly field: string;
    readonly loc: Location;
  };

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
  | {
    readonly kind: 'text';
    readonly name: string | null;
    readonly module: Module;
    readonly loc: Location;
  }
  | {
    readonly kind: 'binary';
    readonly name: string | null;
    readonly data: Uint8Array;
    readonly loc: Location;
  }
  | {
    readonly kind: 'quote';
    readonly name: string | null;
    readonly source: string;
    readonly loc: Location;
  };

/** A command in a WAST script. */
export type WastCommand =
  | { readonly kind: 'module'; readonly scriptModule: WastScriptModule }
  | { readonly kind: 'action'; readonly action: WastAction }
  | {
    readonly kind: 'assert_return';
    readonly action: WastAction;
    readonly expected: ExpectedConst[];
    readonly loc: Location;
  }
  | {
    readonly kind: 'assert_trap';
    readonly action: WastAction;
    readonly text: string;
    readonly loc: Location;
  }
  | { readonly kind: 'assert_exception'; readonly action: WastAction; readonly loc: Location }
  | {
    readonly kind: 'assert_exhaustion';
    readonly action: WastAction;
    readonly text: string;
    readonly loc: Location;
  }
  | {
    readonly kind: 'assert_invalid';
    readonly scriptModule: WastScriptModule;
    readonly text: string;
    readonly loc: Location;
  }
  | {
    readonly kind: 'assert_malformed';
    readonly scriptModule: WastScriptModule;
    readonly text: string;
    readonly loc: Location;
  }
  | {
    readonly kind: 'assert_unlinkable';
    readonly scriptModule: WastScriptModule;
    readonly text: string;
    readonly loc: Location;
  }
  | {
    readonly kind: 'register';
    readonly name: string;
    readonly as: string | null;
    readonly loc: Location;
  };

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
    case TokenType.Unreachable:
    case TokenType.Nop:
    case TokenType.Drop:
    case TokenType.Select:
    case TokenType.Br:
    case TokenType.BrIf:
    case TokenType.BrOnNonNull:
    case TokenType.BrOnNull:
    case TokenType.BrTable:
    case TokenType.Return:
    case TokenType.ReturnCall:
    case TokenType.ReturnCallIndirect:
    case TokenType.ReturnCallRef:
    case TokenType.Call:
    case TokenType.CallIndirect:
    case TokenType.CallRef:
    case TokenType.LocalGet:
    case TokenType.LocalSet:
    case TokenType.LocalTee:
    case TokenType.GlobalGet:
    case TokenType.GlobalSet:
    case TokenType.Load:
    case TokenType.Store:
    case TokenType.Const:
    case TokenType.Unary:
    case TokenType.Binary:
    case TokenType.Quaternary:
    case TokenType.Compare:
    case TokenType.Convert:
    case TokenType.MemoryCopy:
    case TokenType.DataDrop:
    case TokenType.MemoryFill:
    case TokenType.MemoryGrow:
    case TokenType.MemoryInit:
    case TokenType.MemorySize:
    case TokenType.TableCopy:
    case TokenType.ElemDrop:
    case TokenType.TableInit:
    case TokenType.TableGet:
    case TokenType.TableSet:
    case TokenType.TableGrow:
    case TokenType.TableSize:
    case TokenType.TableFill:
    case TokenType.Throw:
    case TokenType.ThrowRef:
    case TokenType.Rethrow:
    case TokenType.RefAsNonNull:
    case TokenType.RefFunc:
    case TokenType.RefNull:
    case TokenType.RefIsNull:
    case TokenType.RefEq:
    case TokenType.RefI31:
    case TokenType.I31Get:
    case TokenType.StructNew:
    case TokenType.StructNewDefault:
    case TokenType.StructGet:
    case TokenType.StructSet:
    case TokenType.ArrayNew:
    case TokenType.ArrayNewDefault:
    case TokenType.ArrayNewFixed:
    case TokenType.ArrayNewData:
    case TokenType.ArrayNewElem:
    case TokenType.ArrayGet:
    case TokenType.ArraySet:
    case TokenType.ArrayLen:
    case TokenType.RefTest:
    case TokenType.RefCast:
    case TokenType.AtomicLoad:
    case TokenType.AtomicStore:
    case TokenType.AtomicRmw:
    case TokenType.AtomicRmwCmpxchg:
    case TokenType.AtomicNotify:
    case TokenType.AtomicFence:
    case TokenType.AtomicWait:
    case TokenType.Ternary:
    case TokenType.SimdLaneOp:
    case TokenType.SimdLoadLane:
    case TokenType.SimdStoreLane:
    case TokenType.SimdShuffleOp:
      return true;
    default:
      return false;
  }
}

function isBlockInstr(tt: TokenType): boolean {
  switch (tt) {
    case TokenType.Block:
    case TokenType.Loop:
    case TokenType.If:
    case TokenType.Try:
    case TokenType.TryTable:
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
    case TokenType.Func:
    case TokenType.Function:
    case TokenType.Type:
    case TokenType.Import:
    case TokenType.Export:
    case TokenType.Global:
    case TokenType.Memory:
    case TokenType.Table:
    case TokenType.Start:
    case TokenType.Data:
    case TokenType.Elem:
    case TokenType.Tag:
      return true;
    default:
      return false;
  }
}

function isCommand(tt0: TokenType, tt1: TokenType): boolean {
  if (tt0 !== TokenType.Lpar) return false;
  switch (tt1) {
    case TokenType.Module:
    case TokenType.Register:
    case TokenType.Invoke:
    case TokenType.Get:
    case TokenType.AssertReturn:
    case TokenType.AssertTrap:
    case TokenType.AssertException:
    case TokenType.AssertExhaustion:
    case TokenType.AssertInvalid:
    case TokenType.AssertMalformed:
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
        case 0x74:
          bytes.push(0x09);
          i++;
          break; // \t
        case 0x6e:
          bytes.push(0x0a);
          i++;
          break; // \n
        case 0x72:
          bytes.push(0x0d);
          i++;
          break; // \r
        case 0x22:
          bytes.push(0x22);
          i++;
          break; // \"
        case 0x27:
          bytes.push(0x27);
          i++;
          break; // \'
        case 0x5c:
          bytes.push(0x5c);
          i++;
          break; // \\
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
          else if (scalar < 0x800) {
            bytes.push(0xc0 | (scalar >> 6));
            bytes.push(0x80 | (scalar & 0x3f));
          } else if (scalar < 0x10000) {
            bytes.push(0xe0 | (scalar >> 12));
            bytes.push(0x80 | ((scalar >> 6) & 0x3f));
            bytes.push(0x80 | (scalar & 0x3f));
          } else {
            bytes.push(0xf0 | (scalar >> 18));
            bytes.push(0x80 | ((scalar >> 12) & 0x3f));
            bytes.push(0x80 | ((scalar >> 6) & 0x3f));
            bytes.push(0x80 | (scalar & 0x3f));
          }
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
/** Whether a token is one of the four `try_table` catch-clause keywords. */
function isCatchKeyword(tt: TokenType): boolean {
  return tt === TokenType.Catch || tt === TokenType.CatchRef ||
    tt === TokenType.CatchAll || tt === TokenType.CatchAllRef;
}

/**
 * Whether a token starts a sub-block of the legacy `(try ...)` syntax:
 * `do`, `catch`, `catch_all`, or `delegate`.
 */
function isTryLegacySubBlock(tt: TokenType): boolean {
  return tt === TokenType.Do || tt === TokenType.Catch ||
    tt === TokenType.CatchAll || tt === TokenType.Delegate;
}

function instrInputCount(tt: TokenType): number {
  switch (tt) {
    case TokenType.Unreachable:
    case TokenType.Nop:
    case TokenType.AtomicFence:
    case TokenType.Const:
    case TokenType.LocalGet:
    case TokenType.GlobalGet:
    case TokenType.RefNull:
    case TokenType.RefFunc:
    case TokenType.MemorySize:
    case TokenType.TableSize:
      return 0;
    case TokenType.Drop:
    case TokenType.LocalSet:
    case TokenType.LocalTee:
    case TokenType.GlobalSet:
    case TokenType.Unary:
    case TokenType.Convert:
    case TokenType.RefIsNull:
    case TokenType.RefAsNonNull:
    case TokenType.RefI31:
    case TokenType.I31Get:
    case TokenType.StructGet:
    case TokenType.ArrayNewDefault:
    case TokenType.ArrayLen:
    case TokenType.RefTest:
    case TokenType.RefCast:
    case TokenType.MemoryGrow:
    case TokenType.TableGet:
    case TokenType.DataDrop:
    case TokenType.ElemDrop:
    case TokenType.ThrowRef:
      return 1;
    case TokenType.Load:
    case TokenType.AtomicLoad:
      // load/atomic_load: single operand (the address). Earlier this group
      // was listed at arity 2 alongside binary/compare/store, which silently
      // dropped the address on the floor as a Nop when the load appeared
      // in linear (non-folded) WAT. Caught by the Phase 7 bridge tests
      // 2026-05-25.
      return 1;
    case TokenType.Binary:
    case TokenType.Compare:
    case TokenType.BrIf:
    case TokenType.BrOnNull:
    case TokenType.BrOnNonNull:
    case TokenType.TableSet:
    case TokenType.TableGrow:
    case TokenType.Store:
    case TokenType.AtomicNotify:
    case TokenType.SimdLoadLane:
    case TokenType.SimdStoreLane:
    case TokenType.SimdShuffleOp:
    case TokenType.RefEq:
    case TokenType.StructSet:
    case TokenType.ArrayNew:
    case TokenType.ArrayNewData:
    case TokenType.ArrayNewElem:
    case TokenType.ArrayGet:
      // simd_shuffle: 2 v128 operands (left, right).
      // simd_load_lane / simd_store_lane: address + vec.
      // ref.eq: left + right (both eqref).
      // struct.set: ref + value.
      // array.new: init + length.
      // array.new_data / array.new_elem: offset + length.
      // array.get: ref + index.
      return 2;
    case TokenType.Select:
    case TokenType.MemoryFill:
    case TokenType.TableFill:
    case TokenType.AtomicStore:
    case TokenType.AtomicWait:
    case TokenType.AtomicRmw:
    case TokenType.ArraySet:
      return 3;
    case TokenType.AtomicRmwCmpxchg:
      return 4;
    case TokenType.MemoryCopy:
    case TokenType.TableCopy:
    case TokenType.MemoryInit:
    case TokenType.TableInit:
      return 3;
    case TokenType.Ternary:
      return 3;
    // variable arity
    case TokenType.Return:
    case TokenType.Br:
    case TokenType.BrTable:
    case TokenType.Call:
    case TokenType.CallIndirect:
    case TokenType.CallRef:
    case TokenType.StructNew:
    case TokenType.ArrayNewFixed:
    case TokenType.ReturnCall:
    case TokenType.ReturnCallIndirect:
    case TokenType.ReturnCallRef:
    case TokenType.Throw:
      return -1;
    default:
      return 0;
  }
}

/**
 * Like {@link instrInputCount}, but for tokens whose stack arity depends on
 * the specific opcode (not just the token type). SIMD lane ops are the
 * only such case so far: `*.extract_lane` takes 1 operand (the vec),
 * `*.replace_lane` takes 2 (vec + scalar). Falls back to the token-type
 * lookup otherwise.
 */
function instrInputCountForTok(tok: Token): number {
  if (tok.tokenType === TokenType.SimdLaneOp) {
    const op = (tok as OpcodeToken).opcode as unknown as number;
    return isReplaceLaneOpcode(op) ? 2 : 1;
  }
  return instrInputCount(tok.tokenType);
}

/**
 * The six SIMD `*.replace_lane` opcodes (i8x16 / i16x8 / i32x4 / i64x2 /
 * f32x4 / f64x2). All others under TokenType.SimdLaneOp are extract_lane.
 */
function isReplaceLaneOpcode(op: number): boolean {
  switch (op) {
    case 0xfd17: // i8x16.replace_lane
    case 0xfd1a: // i16x8.replace_lane
    case 0xfd1c: // i32x4.replace_lane
    case 0xfd1e: // i64x2.replace_lane
    case 0xfd20: // f32x4.replace_lane
    case 0xfd22: // f64x2.replace_lane
      return true;
    default:
      return false;
  }
}

/** Whether a plain instruction pushes a value onto the stack. */
function instrProducesValue(tt: TokenType): boolean {
  switch (tt) {
    case TokenType.Const:
    case TokenType.LocalGet:
    case TokenType.GlobalGet:
    case TokenType.RefNull:
    case TokenType.RefFunc:
    case TokenType.MemorySize:
    case TokenType.TableSize:
    case TokenType.Unary:
    case TokenType.Convert:
    case TokenType.Binary:
    case TokenType.Compare:
    case TokenType.Load:
    case TokenType.AtomicLoad:
    case TokenType.RefIsNull:
    case TokenType.RefAsNonNull:
    case TokenType.RefEq:
    case TokenType.RefI31:
    case TokenType.I31Get:
    case TokenType.StructNew:
    case TokenType.StructNewDefault:
    case TokenType.StructGet:
    case TokenType.ArrayNew:
    case TokenType.ArrayNewDefault:
    case TokenType.ArrayNewFixed:
    case TokenType.ArrayNewData:
    case TokenType.ArrayNewElem:
    case TokenType.ArrayGet:
    case TokenType.ArrayLen:
    case TokenType.RefTest:
    case TokenType.RefCast:
    case TokenType.LocalTee:
    case TokenType.MemoryGrow:
    case TokenType.TableGet:
    case TokenType.TableGrow:
    case TokenType.Select:
    case TokenType.AtomicNotify:
    case TokenType.AtomicWait:
    case TokenType.AtomicRmw:
    case TokenType.AtomicRmwCmpxchg:
    case TokenType.SimdLaneOp:
    case TokenType.SimdShuffleOp:
    case TokenType.Ternary:
    case TokenType.Quaternary:
    // Calls produce a value (1+ results in WASM 2.0; 0 results for void
    // funcs). The parser can't know the callee's signature at this point,
    // so the conservative "push to stack" path is correct in both cases:
    //   - If the call has a result and it's nested inside another expr,
    //     it's available as an operand.
    //   - If the call is at statement position (no consumer), flushStack
    //     at the containing scope moves it to stmts unchanged.
    //   - If the call is void, the stack just gets a non-pop, then
    //     flushStack moves it to stmts. The binary encodes it as a plain
    //     `call` opcode; runtime stack state is governed by the actual sig.
    // Previously these fell through to `default: return false`, which
    // pushed every nested call to stmts directly. flushStack then
    // appended whatever was on stack AFTER stmts, scrambling operand
    // order whenever a call appeared next to another sub-expr — e.g.
    // `(i32.store (i32.const 100) (call $f))` parsed with address +
    // value swapped, writing the store value to the wrong address.
    case TokenType.Call:
    case TokenType.CallIndirect:
    case TokenType.CallRef:
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

function newCtx(): ExprCtx {
  return { stack: [], stmts: [] };
}

/** Pop `n` operands from stack (right-to-left order: last-in first-out). */
function popN(ctx: ExprCtx, n: number, fallback: Location): Expr[] {
  const nop = (): NopExpr => ({ kind: 'nop', loc: fallback });
  const result: Expr[] = [];
  for (let i = 0; i < n; i++) {
    result.unshift(ctx.stack.pop() ?? nop());
  }
  return result;
}

/**
 * Flush remaining stack items as sequential statements (for end-of-block).
 *
 * Preserves order: stack `[a, b, c]` (a pushed first, c on top) flushes to
 * `stmts` as `[a, b, c]`. An earlier version popped from the stack one at a
 * time, which reversed the order — invisible for the most common case
 * (single value on top of the stack at end-of-block) but produced wrong
 * operand bindings in folded expressions like
 * `(i32.sub (local.get $a) (local.get $b))`, where left/right got swapped.
 * Fixed 2026-05-25 — reported by wasmtk's wabt-ts 1.0.4 migration.
 */
function flushStack(ctx: ExprCtx): void {
  for (const e of ctx.stack) ctx.stmts.push(e);
  ctx.stack.length = 0;
}

/**
 * Commit `expr` as a statement, first draining any values still on the
 * operand stack into `stmts` so source order is preserved.
 *
 * A value-producing instruction at statement position (most importantly a
 * void `call`, which the parser can't distinguish from a value-returning
 * call without the callee's signature) gets pushed onto `ctx.stack` rather
 * than `ctx.stmts`. If it is never consumed as an operand, it lingers on the
 * stack until the enclosing block's end-of-body `flushStack` — which appends
 * it AFTER every genuine statement, scrambling order. Concretely,
 * `(call $f) (local.set $x …) (return …)` would emit the call last, turning
 * a side-effecting call into dead code after the `return`.
 *
 * The deficit-fill in `parseFoldedInstr` / `parseLinearPlainInstr` already
 * pops whatever operands the current instruction consumes BEFORE this point,
 * so any leftover stack values are genuinely in statement position and
 * sequenced before `expr`. Flushing them here keeps that order.
 *
 * Fixed 2026-05-30 — reported via wasmtk's shared-heap stdlib track: a folded
 * `sideEffectingCall(); … return X;` pattern silently sank the call past the
 * return. Regression tests in tests/parser/stmt_order.test.ts.
 */
function pushStmt(ctx: ExprCtx, expr: Expr): void {
  for (const e of ctx.stack) ctx.stmts.push(e);
  ctx.stack.length = 0;
  ctx.stmts.push(expr);
}

// ---------------------------------------------------------------------------
// WastParser
// ---------------------------------------------------------------------------

/**
 * Recursive-descent parser for WebAssembly text format (WAT) and the spec
 * test format (WAST). Construct with a tokenized source; call
 * `parseModule()` for a single module or `parseScript()` for a WAST script
 * of `assert_*` directives. Errors accumulate in the public `errors` array.
 *
 * Prefer the {@link parseWatModule} / {@link parseWastScript} helpers in
 * most cases; instantiate `WastParser` directly only if you need to peek
 * at parser state mid-parse.
 */
export class WastParser {
  private tokens: readonly Token[];
  private pos = 0;
  readonly errors: WabtError[] = [];

  /**
   * Lexically scoped local-name → slot-index map for the function currently
   * being parsed. Params occupy slots `0..numParams-1`, locals continue from
   * `numParams`. Populated by `parseFuncModuleField` before parsing the
   * function body, and read by `buildPlainExpr` when it sees a name-based
   * `local.get` / `local.set` / `local.tee` so it can produce an index-var
   * directly (instead of leaving a name-var that the bridge / writer can't
   * resolve without a separate pass).
   */
  private localScope: Map<string, number> | null = null;

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
    return last ??
      { tokenType: TokenType.Eof, loc: { filename: '', line: 1, column: 1, offset: 0 } };
  }

  private loc(): Location {
    return this.peekToken().loc;
  }

  private consume(): Token {
    const t = this.tokens[this.pos];
    if (t !== undefined) {
      this.pos++;
      return t;
    }
    return this.peekToken();
  }

  private drop(): void {
    if (this.pos < this.tokens.length) this.pos++;
  }

  private match(tt: TokenType): boolean {
    if (this.peek() === tt) {
      this.pos++;
      return true;
    }
    return false;
  }

  private matchLpar(tt: TokenType): boolean {
    if (this.peek() === TokenType.Lpar && this.peek(1) === tt) {
      this.pos += 2;
      return true;
    }
    return false;
  }

  private expect(tt: TokenType): Result {
    if (this.match(tt)) return Result.Ok;
    this.error(this.loc(), `expected ${tokenName(tt)}, got ${tokenName(this.peek())}`);
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

  /**
   * Convert a name-based local var into an index-based one using the
   * current function's local scope (params + named locals). If the name is
   * not in scope or the var is already an index, returns the input
   * unchanged — the validator will surface the unresolved reference.
   */
  private resolveLocal(v: Var): Var {
    if (v.kind === 'index') return v;
    const idx = this.localScope?.get(v.name);
    if (idx === undefined) return v;
    return varIndex(idx);
  }

  parseVar(): Var | null {
    const tt = this.peek();
    if (tt === TokenType.Var) {
      const tok = this.consume() as StringToken;
      return varName(tok.text);
    }
    if (tt === TokenType.Nat || tt === TokenType.Int) {
      const tok = this.consume() as LiteralToken;
      const n = parseNatText(tok.literal.text);
      if (n === null) {
        this.error(tok.loc, `invalid index: ${tok.literal.text}`);
        return null;
      }
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
        if (t === null) {
          this.expect(TokenType.Rpar);
          return Result.Error;
        }
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
    // GC typed-reference parenthesized form: `(ref $T)` or `(ref null $T)`.
    // Wabt-ts's flat `Type[]` IR can't faithfully carry the heap-type index
    // for typed refs — the binary writer currently emits the abstract
    // supertype byte (structref / arrayref / anyref) instead. The parser
    // accepts the syntax so module definitions that mention typed refs in
    // param / result / local slots round-trip through the parser; full
    // typed-ref IR support is a deferred refactor (FuncSignature.params
    // → ValueType[] with concrete heap-type metadata).
    if (tt === TokenType.Lpar && this.peek(1) === TokenType.Ref) {
      this.drop(); // (
      this.drop(); // ref
      this.match(TokenType.Null); // optional `null` keyword — currently ignored
      // The next token is either a refkind keyword (func/extern/etc.) — already
      // a complete Type — or a Var pointing at a user-defined heap type.
      let result: Type;
      const inner = this.peek();
      if (inner === TokenType.Var) {
        // Concrete typed ref `(ref $T)` — drop the var and use StructRef as
        // the coarse placeholder. Future typed-ref IR will carry $T's index.
        this.drop();
        result = Type.StructRef;
      } else if (
        inner === TokenType.ValueType || inner === TokenType.Func || inner === TokenType.Extern
      ) {
        // `(ref any)` / `(ref i31)` / `(ref func)` / `(ref extern)` / etc.
        const inner2 = this.parseValueType();
        result = inner2 ?? Type.AnyRef;
      } else if (inner === TokenType.Nat) {
        // `(ref 0)` — numeric heap-type index, drop and coarse to StructRef.
        this.drop();
        result = Type.StructRef;
      } else {
        this.error(this.loc(), `unexpected token in (ref ...): ${tokenName(inner)}`);
        return null;
      }
      this.expect(TokenType.Rpar);
      return result;
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
    if (tt === TokenType.Func) {
      this.drop();
      return isNull ? Type.FuncRef : Type.FuncRef;
    }
    if (tt === TokenType.Extern) {
      this.drop();
      return isNull ? Type.ExternRef : Type.ExternRef;
    }
    if (tt === TokenType.Exn) {
      this.drop();
      return Type.ExnRef;
    }
    if (tt === TokenType.ValueType) {
      const tok = this.consume() as TypeToken;
      return tok.valueType;
    }
    this.error(this.loc(), 'expected ref kind');
    return null;
  }

  /**
   * Parse the heap-type immediate that follows `ref.test` / `ref.cast`. The
   * syntax is `(ref [null] H)` where H is either an abstract-heap-type
   * keyword (`any` / `eq` / `i31` / `struct` / `array` / `func` / `extern`
   * / `none` / `nofunc` / `noextern`) or a user-defined type ref
   * (`$T` or a numeric index).
   *
   * Returns `{ heapType, nullable }` — the heap type is encoded as a
   * {@link Var} (name-form for keywords + user names; index-form for
   * numeric indices). Returns null on parse error.
   */
  private parseRefImmediate(): { heapType: Var; nullable: boolean } | null {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return null;
    if (this.peek() !== TokenType.Ref) {
      this.error(loc, 'expected (ref ...) for heap-type immediate');
      return null;
    }
    this.drop(); // 'ref'
    const nullable = this.match(TokenType.Null);

    const tt = this.peek();
    let heapType: Var;
    if (tt === TokenType.Var) {
      // `(ref $T)` or `(ref null $T)` — user-defined type.
      const tok = this.consume() as StringToken;
      heapType = varName(tok.text);
    } else if (tt === TokenType.Nat) {
      // `(ref 3)` — numeric type index.
      const tok = this.consume() as LiteralToken;
      const n = parseNatText(tok.literal.text);
      heapType = varIndex(Number(n ?? 0n));
    } else if (tt === TokenType.Func) {
      // `(ref func)` — abstract heap type for funcref.
      this.drop();
      heapType = varName('func');
    } else if (tt === TokenType.Extern) {
      this.drop();
      heapType = varName('extern');
    } else if (tt === TokenType.Exn) {
      this.drop();
      heapType = varName('exn');
    } else if (tt === TokenType.Struct) {
      // `(ref struct)` — bare `struct` keyword has its own token type.
      this.drop();
      heapType = varName('struct');
    } else if (tt === TokenType.Array) {
      // `(ref array)` — same, bare `array` keyword.
      this.drop();
      heapType = varName('array');
    } else if (tt === TokenType.ValueType) {
      // `(ref anyref)` / `(ref i31ref)` etc. — strip the `ref` suffix to get
      // the abstract heap-type name binaryen-ts expects.
      const tok = this.consume() as TypeToken;
      const name = abstractHeapTypeNameForValType(tok.valueType);
      if (name === null) {
        this.error(
          loc,
          `unsupported heap type for ref.test/ref.cast: 0x${tok.valueType.toString(16)}`,
        );
        return null;
      }
      heapType = varName(name);
    } else {
      this.error(loc, `expected heap type after (ref [null] ...), got ${tokenName(tt)}`);
      return null;
    }
    if (this.expect(TokenType.Rpar) !== Result.Ok) return null;
    return { heapType, nullable };
  }

  /** Parse limits: `N` or `N M` optionally followed by `shared`. */
  parseLimits(): Limits | null {
    const _is64 = this.match(TokenType.I64X2); // actually this is wrong, check index type
    const initTok = this.peekToken();
    if (this.peek() !== TokenType.Nat && this.peek() !== TokenType.Int) {
      this.error(this.loc(), 'expected limit initial value');
      return null;
    }
    const initText = (this.consume() as LiteralToken).literal.text;
    const initN = parseNatText(initText);
    if (initN === null) {
      this.error(initTok.loc, 'invalid limit');
      return null;
    }
    const initial = Number(initN);
    let max: number | undefined;
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
      case TokenType.Type:
        return this.parseTypeModuleField(module);
      case TokenType.Import:
        return this.parseImportModuleField(module);
      case TokenType.Export:
        return this.parseExportModuleField(module);
      case TokenType.Func:
      case TokenType.Function:
        return this.parseFuncModuleField(module);
      case TokenType.Global:
        return this.parseGlobalModuleField(module);
      case TokenType.Memory:
        return this.parseMemoryModuleField(module);
      case TokenType.Table:
        return this.parseTableModuleField(module);
      case TokenType.Start:
        return this.parseStartModuleField(module);
      case TokenType.Data:
        return this.parseDataModuleField(module);
      case TokenType.Elem:
        return this.parseElemModuleField(module);
      case TokenType.Tag:
        return this.parseTagModuleField(module);
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

    const kindTok = this.peek();
    let entry: TypeEntry;
    if (kindTok === TokenType.Func) {
      this.drop();
      const { sig } = this.parseFuncSignature();
      entry = { kind: 'func', name, sig, loc };
    } else if (kindTok === TokenType.Struct) {
      this.drop();
      const fields = this.parseStructFields();
      entry = { kind: 'struct', name, fields, loc };
    } else if (kindTok === TokenType.Array) {
      this.drop();
      const field = this.parseArrayField();
      entry = { kind: 'array', name, field, loc };
    } else {
      this.error(this.loc(), 'expected func, struct, or array in type');
      return Result.Error;
    }
    this.expect(TokenType.Rpar);
    this.expect(TokenType.Rpar);
    module.types.push(entry);
    return Result.Ok;
  }

  /**
   * Parse the body of a struct type:
   *   (field $name mut? value-type)        — named single field
   *   (field        mut? value-type)       — anonymous single field
   *   (field        type1 type2 type3)     — multi-field shorthand (all anonymous, immutable)
   *
   * Multiple `(field ...)` groups concatenate into one field list, in source
   * order. Field indices count fields, not field groups.
   */
  private parseStructFields(): Field[] {
    const fields: Field[] = [];
    while (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.Field) {
      this.drop(); // (
      this.drop(); // field
      // Optional bind-var only applies when followed by a SINGLE field; if
      // multiple types follow with no name, they're anonymous.
      const name = this.parseBindVarOpt();
      if (name !== '') {
        const { mutable, type } = this.parseFieldType();
        fields.push({ name, type, mutable });
      } else {
        // Either anonymous single field with optional `(mut ...)` wrapper,
        // OR multi-field shorthand (all immutable, no name).
        while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
          const { mutable, type } = this.parseFieldType();
          fields.push({ name: '', type, mutable });
        }
      }
      this.expect(TokenType.Rpar);
    }
    return fields;
  }

  /**
   * Parse the body of an array type:
   *   (field mut? value-type)
   *   (mut? value-type)
   */
  private parseArrayField(): Field {
    if (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.Field) {
      this.drop(); // (
      this.drop(); // field
      const { mutable, type } = this.parseFieldType();
      this.expect(TokenType.Rpar);
      return { name: '', type, mutable };
    }
    const { mutable, type } = this.parseFieldType();
    return { name: '', type, mutable };
  }

  /**
   * Parse `mut? value-type`. The `mut` form is `(mut value-type)`; the bare
   * form is just a value-type.
   */
  private parseFieldType(): { mutable: boolean; type: Type } {
    if (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.Mut) {
      this.drop(); // (
      this.drop(); // mut
      const t = this.parseValueType() ?? Type.I32;
      this.expect(TokenType.Rpar);
      return { mutable: true, type: t };
    }
    return { mutable: false, type: this.parseValueType() ?? Type.I32 };
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
      const { sig } = this.parseFuncSignature();
      const func: Func = {
        name,
        loc,
        typeVar: typeVar ?? varIndex(0),
        sig,
        localDecls: [],
        body: [],
        tailcall: false,
      };
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
      case TokenType.Func:
      case TokenType.Function:
        kind = ExternalKind.Func;
        break;
      case TokenType.Table:
        kind = ExternalKind.Table;
        break;
      case TokenType.Memory:
        kind = ExternalKind.Memory;
        break;
      case TokenType.Global:
        kind = ExternalKind.Global;
        break;
      case TokenType.Tag:
        kind = ExternalKind.Tag;
        break;
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
      const func: Func = {
        name,
        loc,
        typeVar: typeVar ?? varIndex(0),
        sig,
        localDecls: [],
        body: [],
        tailcall: false,
      };
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

      // Build the function-local scope (params first, then locals) so that
      // `local.get $name` / `local.set $name` / `local.tee $name` inside the
      // body resolve to slot indices at parse time. Without this the IR
      // carries unresolved name-vars that downstream consumers (bridge,
      // binary writer) can't disambiguate from globally-scoped names.
      const scope = new Map<string, number>(bindings);
      let slot = sig.params.length;

      // Parse locals
      while (this.matchLpar(TokenType.Local)) {
        if (this.peek() === TokenType.Var) {
          const nameTok = this.consume() as StringToken;
          const t = this.parseValueType();
          if (t !== null) {
            // `nameTok.text` includes the leading `$` to match the param
            // binding convention from `parseParams`.
            scope.set(nameTok.text, slot);
            slot++;
            localDecls.push({ type: t, count: 1 });
          }
        } else {
          while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
            const t = this.parseValueType();
            if (t !== null) {
              slot++;
              localDecls.push({ type: t, count: 1 });
            } else break;
          }
        }
        this.expect(TokenType.Rpar);
      }

      const savedScope = this.localScope;
      this.localScope = scope;
      const body: Expr[] = [];
      this.parseInstrListInto(body);
      this.localScope = savedScope;

      const func: Func = {
        name,
        loc,
        typeVar: typeVar ?? varIndex(0),
        sig,
        localDecls,
        body,
        tailcall: false,
      };
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
      const imp: Import = {
        kind: ExternalKind.Global,
        module: inlineImp.moduleName,
        field: inlineImp.fieldName,
        global,
      };
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
      const imp: Import = {
        kind: ExternalKind.Memory,
        module: inlineImp.moduleName,
        field: inlineImp.fieldName,
        memory,
      };
      module.imports.push(imp);
      module.numMemoryImports++;
    } else if (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.Data) {
      // Inline data segment
      this.drop();
      this.drop();
      const data = this.parseTextList();
      this.expect(TokenType.Rpar);
      const pages = Math.ceil(data.length / 65536);
      const limits: Limits = { initial: pages, isShared: false, is64: false };
      const memory: Memory = { name, loc, limits };
      module.memories.push(memory);
      // Add data segment at offset 0
      const offsetExpr: Expr = { kind: 'const', value: constI32(0), loc } as ConstExpr;
      module.dataSegments.push({
        name: '',
        kind: 'active',
        memoryVar: varIndex(memIdx),
        offset: [offsetExpr],
        data,
        loc,
      });
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
      const imp: Import = {
        kind: ExternalKind.Table,
        module: inlineImp.moduleName,
        field: inlineImp.fieldName,
        table,
      };
      module.imports.push(imp);
      module.numTableImports++;
    } else {
      const tt = this.peek();
      const isElemRef = tt === TokenType.ValueType || tt === TokenType.Func ||
        tt === TokenType.Extern || tt === TokenType.Ref;
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
          const limits: Limits = {
            initial: refs.length,
            max: refs.length,
            isShared: false,
            is64: false,
          };
          const table: Table = { name, loc, elemType, limits, init: [] };
          module.tables.push(table);
          // Add elem segment
          const offsetExpr: Expr = { kind: 'const', value: constI32(0), loc } as ConstExpr;
          module.elemSegments.push({
            name: '',
            kind: 'active',
            tableVar: varIndex(tableIdx),
            offset: [offsetExpr],
            elemType,
            elemExprs: refs.map((r) => [r]),
            loc,
          });
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
      this.parseInstrListInto(offset);
      this.expect(TokenType.Rpar);
      kind = 'active';
    } else if (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.Const) {
      // bare inline offset expr like (i32.const 0)
      this.parseInstrListInto(offset);
      if (offset.length > 0) kind = 'active';
    }

    const data = this.parseTextList();
    this.expect(TokenType.Rpar);

    if (kind === 'active') {
      module.dataSegments.push({ name, kind, memoryVar: memVar, offset, data, loc });
    } else {
      module.dataSegments.push({
        name,
        kind: 'passive',
        memoryVar: varIndex(0),
        offset: [],
        data,
        loc,
      });
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
      if (this.matchLpar(TokenType.Offset)) {
        this.parseInstrListInto(offset);
        this.expect(TokenType.Rpar);
      } else {
        this.parseInstrListInto(offset);
      }
      kind = 'active';
    } else if (this.match(TokenType.Declare)) {
      kind = 'declared';
    } else if (
      this.peek() === TokenType.Lpar &&
      this.peek(1) !== TokenType.Item
    ) {
      // Bare offset expression: `(elem (i32.const 0) $f1 $f2)`.
      // The `(...)` after elem (when it's not `(table ...)`, `(offset ...)`,
      // or `(item ...)`) is a const expression giving the offset for an
      // active segment on table 0. wasmtk's wasic emits this shape
      // pervasively; previously the parser fell through all branches and
      // failed at "expected ), got (" inside the elem.
      const ctx = newCtx();
      this.parseOffsetExpr(ctx);
      flushStack(ctx);
      offset = ctx.stmts;
      kind = 'active';
    }

    // Parse optional elem type or funcref
    if (
      this.match(TokenType.Func) ||
      (this.peek() === TokenType.Func && this.peek() === TokenType.Function)
    ) {
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
      module.elemSegments.push({
        name,
        kind,
        tableVar: varIndex(0),
        offset: [],
        elemType,
        elemExprs: inits,
        loc,
      });
    } else {
      module.elemSegments.push({
        name,
        kind: 'passive',
        tableVar: varIndex(0),
        offset: [],
        elemType,
        elemExprs: inits,
        loc,
      });
    }
    return Result.Ok;
  }

  private parseTagModuleField(module: Module): Result {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Tag) !== Result.Ok) return Result.Error;
    const name = this.parseBindVarOpt();
    const tagIdx = module.numTagImports + module.tags.length;

    while (this.matchLpar(TokenType.Export)) {
      const expName = this.parseQuotedText() ?? '';
      this.expect(TokenType.Rpar);
      module.exports.push({ name: expName, kind: ExternalKind.Tag, var: varIndex(tagIdx) });
    }

    const inlineImp = this.parseInlineImport();
    const { sig } = this.parseFuncSignature();
    const tag: Tag = { name, loc, sig };

    if (inlineImp !== null) {
      const imp: Import = {
        kind: ExternalKind.Tag,
        module: inlineImp.moduleName,
        field: inlineImp.fieldName,
        tag,
      };
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

    // Folded plain instruction.
    //
    // WAT fold form is `( opcode immediate-args folded-sub-expr* )`. The
    // immediates (Var refs, align/offset, type uses) come BEFORE any
    // operand sub-expressions in the token stream — but the
    // `buildPlainExpr` helper consumes them inline while constructing the
    // expression. To respect the input order:
    //
    //   1. Consume the opcode token.
    //   2. Dry-run `buildPlainExpr` with empty operands so it advances the
    //      lexer past the immediates. Errors emitted during this throwaway
    //      pass are suppressed; the real pass re-emits them.
    //   3. Parse sub-expressions (each starts with `(`) into innerCtx.
    //   4. Rewind to the immediate position, re-invoke `buildPlainExpr`
    //      with the real operands, then forward past the sub-expressions
    //      we already consumed.
    //
    // Previously the parser ran the sub-expression loop FIRST, gated on
    // `peekIsInstr`. That returned false for immediate tokens (Var, Nat,
    // etc.), so the loop exited before any operands were collected, and
    // a folded operand sub-expr like `(global.get $g)` showed up as an
    // unexpected `(` after the buildPlainExpr call.
    const tok = this.consume();
    const tt2 = tok.tokenType;
    const immStartPos = this.pos;

    // 2. Dry-run to skip over immediates. Suppress errors so a malformed
    //    immediate is only reported once (during the real pass below).
    const savedErrorCount = this.errors.length;
    this.buildPlainExpr(tok, loc, []);
    this.errors.length = savedErrorCount;

    // 3. Sub-expression loop. Only `(`-prefixed folded sub-expressions are
    //    valid here per WAT grammar; immediates have already been consumed.
    const innerCtx = newCtx();
    while (
      this.peek() === TokenType.Lpar &&
      (isPlainInstr(this.peek(1)) || isBlockInstr(this.peek(1)))
    ) {
      this.parseOneInstr(innerCtx);
    }
    flushStack(innerCtx);
    const subExprEndPos = this.pos;

    // Bug D fix: when the folded form supplies fewer children than the
    // opcode needs, fill the deficit from the surrounding stack — but
    // ONLY as many as are actually available. This makes
    // `(i32.const 5) (local.set $x)` work the same way as the linear
    // form `i32.const 5 / local.set $x` (the local.set pops from
    // stack instead of getting a Nop placeholder), while leaving ops
    // with optional operands alone when the user uses the single-child
    // form (Bug F).
    //
    // Without the `available` clamp, an op like `br_if` with `nInputs=2`
    // (cond + optional value) and one inline child would silently
    // route the supplied operand into `value` and pad `cond` with Nop —
    // and since `resolveNames` doesn't recurse into `BrIf.value`, any
    // name-vars inside (e.g. `global.get $i`) would never be resolved
    // and the binary writer would emit `global.get 0`.
    //
    // Stack-supplied operands come first (oldest, lower in stack);
    // child operands come last (innermost, closer to the instr).
    // For variable-arity opcodes (call, return, etc.): if children are
    // supplied, use them; otherwise drain the surrounding stack.
    const nInputs = instrInputCountForTok(tok);
    let operands: Expr[];
    if (nInputs === -1) {
      if (innerCtx.stmts.length > 0) {
        operands = innerCtx.stmts;
      } else {
        operands = [...ctx.stack];
        ctx.stack.length = 0;
      }
    } else if (innerCtx.stmts.length >= nInputs) {
      operands = innerCtx.stmts;
    } else {
      const deficit = nInputs - innerCtx.stmts.length;
      const available = Math.min(deficit, ctx.stack.length);
      operands = available > 0 ? [...popN(ctx, available, loc), ...innerCtx.stmts] : innerCtx.stmts;
    }

    // 4. Rewind and re-invoke buildPlainExpr with the real operands.
    this.pos = immStartPos;
    const expr = this.buildPlainExpr(tok, loc, operands);
    this.pos = subExprEndPos;

    if (this.expect(TokenType.Rpar) !== Result.Ok) return Result.Error;

    if (expr !== null) {
      if (instrProducesValue(tt2)) {
        ctx.stack.push(expr);
      } else {
        pushStmt(ctx, expr);
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
      if (hasValue) ctx.stack.push(node);
      else pushStmt(ctx, node);
      return Result.Ok;
    }

    if (tt === TokenType.If) {
      const label = this.parseBindVarOpt();
      const blockType = this.parseBlockType();

      // Optional condition in folded form: if it's a paren-expr, it's the cond
      let cond: Expr | undefined;
      if (
        this.peek() === TokenType.Lpar && this.peek(1) !== TokenType.Then &&
        this.peek(1) !== TokenType.Else
      ) {
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
      if (hasValue) ctx.stack.push(node);
      else pushStmt(ctx, node);
      return Result.Ok;
    }

    // TryTable — full support including (catch / catch_ref / catch_all /
    // catch_all_ref) clauses. Folded form:
    //   (try_table $lbl (result T)
    //     (catch $tag $target)
    //     (catch_ref $tag $target)
    //     (catch_all $target)
    //     (catch_all_ref $target)
    //     body-instrs...)
    // The catch clauses are syntactic immediates that appear before the
    // body; they get parsed into TableCatch[] and stashed on the
    // TryTableExpr. Body-instrs run inside the protected region.
    if (tt === TokenType.TryTable) {
      const label = this.parseBindVarOpt();
      const blockType = this.parseBlockType();
      const catches: TableCatch[] = [];
      while (this.peek() === TokenType.Lpar && isCatchKeyword(this.peek(1))) {
        const c = this.parseTryTableCatch();
        if (c !== null) catches.push(c);
      }
      const bodyCtx = newCtx();
      this.parseInstrList(bodyCtx);
      flushStack(bodyCtx);
      this.expect(TokenType.Rpar);
      const node: TryTableExpr = {
        kind: 'try_table',
        label,
        blockType,
        body: bodyCtx.stmts,
        catches,
        loc,
      };
      const hasValue = blockType.kind !== 'void';
      if (hasValue) ctx.stack.push(node);
      else pushStmt(ctx, node);
      return Result.Ok;
    }

    // Try (legacy EH proposal). Folded syntax:
    //   (try $label (result T)?
    //     (do body...)
    //     (catch $tag handler...)*
    //     (catch_all handler...)?
    //     (delegate $target)?)
    // The legacy proposal is superseded by `try_table`, but wasic still
    // emits this shape for every TypeScript try/catch/throw. We build a
    // real TryExpr (body + catch handlers + optional delegate) so the
    // binary writer emits the try/catch/catch_all/delegate/end opcode
    // edges. The handler dispatch is what the WASM runtime needs: each
    // `(catch $tag ...)` edge pushes the tag's params onto the operand
    // stack at entry, so the handler's leading `local.set`s consume them.
    // Earlier code coerced this to a plain block, dropping the dispatch
    // edges and producing binaries V8 rejected ("not enough arguments on
    // the stack for local.set").
    if (tt === TokenType.Try) {
      const label = this.parseBindVarOpt();
      const blockType = this.parseBlockType();
      const bodyCtx = newCtx();
      const catches: Catch[] = [];
      let delegate: Var | undefined;
      while (this.peek() === TokenType.Lpar && isTryLegacySubBlock(this.peek(1))) {
        const subLoc = this.loc();
        this.drop(); // consume '('
        const sub = this.consume(); // do / catch / catch_all / delegate
        if (sub.tokenType === TokenType.Do) {
          this.parseInstrList(bodyCtx);
        } else if (sub.tokenType === TokenType.Catch) {
          // `(catch $tag handler...)` — tag-typed handler.
          const tag = this.parseVar() ?? varIndex(0);
          const handler: Expr[] = [];
          this.parseInstrListInto(handler);
          catches.push({ loc: subLoc, tag, isRef: false, body: handler });
        } else if (sub.tokenType === TokenType.CatchAll) {
          // `(catch_all handler...)` — matches any tag, no params.
          const handler: Expr[] = [];
          this.parseInstrListInto(handler);
          catches.push({ loc: subLoc, isRef: false, body: handler });
        } else {
          // `(delegate $target)` — re-raise to an outer try; no body.
          delegate = this.parseVar() ?? varIndex(0);
          this.expect(TokenType.Rpar);
          continue;
        }
        this.expect(TokenType.Rpar);
      }
      // Bare-body form without a `(do ...)` wrapper: remaining instrs are
      // the protected body.
      if (
        bodyCtx.stmts.length === 0 && bodyCtx.stack.length === 0 &&
        catches.length === 0 && delegate === undefined
      ) {
        this.parseInstrList(bodyCtx);
      }
      flushStack(bodyCtx);
      this.expect(TokenType.Rpar);
      const node: TryExpr = delegate === undefined
        ? { kind: 'try', label, blockType, body: bodyCtx.stmts, catches, loc }
        : { kind: 'try', label, blockType, body: bodyCtx.stmts, catches, delegate, loc };
      const hasValue = blockType.kind !== 'void';
      if (hasValue) ctx.stack.push(node);
      else pushStmt(ctx, node);
      return Result.Ok;
    }

    this.error(loc, 'unexpected block instr');
    return Result.Error;
  }

  /**
   * Parse one `(catch ...)` / `(catch_ref ...)` / `(catch_all ...)` /
   * `(catch_all_ref ...)` clause inside a `try_table`. Caller must have
   * already verified that the lookahead is `( catch_kw ...`.
   *
   *   catch / catch_ref : (catch $tag $target)
   *   catch_all / catch_all_ref : (catch_all $target)
   *
   * Per the EH proposal, `_ref` variants pass an exnref to the target
   * label; non-ref variants pass only the tag's parameter values.
   */
  private parseTryTableCatch(): TableCatch | null {
    const catchLoc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return null;
    const kindTok = this.peek();
    let kind: CatchKind;
    switch (kindTok) {
      case TokenType.Catch:
        kind = CatchKind.Catch;
        break;
      case TokenType.CatchRef:
        kind = CatchKind.CatchRef;
        break;
      case TokenType.CatchAll:
        kind = CatchKind.CatchAll;
        break;
      case TokenType.CatchAllRef:
        kind = CatchKind.CatchAllRef;
        break;
      default:
        this.error(catchLoc, 'expected catch / catch_ref / catch_all / catch_all_ref');
        return null;
    }
    this.drop(); // consume the catch keyword
    let tag: Var | undefined;
    if (kind === CatchKind.Catch || kind === CatchKind.CatchRef) {
      const tv = this.parseVar();
      if (tv === null) {
        this.error(catchLoc, 'expected tag reference after catch / catch_ref');
        return null;
      }
      tag = tv;
    }
    const target = this.parseVar();
    if (target === null) {
      this.error(catchLoc, 'expected target label reference in catch clause');
      return null;
    }
    this.expect(TokenType.Rpar);
    return tag === undefined
      ? { kind, target, loc: catchLoc }
      : { kind, tag, target, loc: catchLoc };
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
      if (hasValue) ctx.stack.push(node);
      else pushStmt(ctx, node);
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
      if (hasValue) ctx.stack.push(node);
      else pushStmt(ctx, node);
      return Result.Ok;
    }

    // Try (legacy EH proposal), linear form:
    //   try $label (result T)?
    //     body...
    //   catch $tag handler... | catch_all handler... | delegate $target
    //   end
    // Builds a real TryExpr so the binary writer emits the catch/catch_all/
    // delegate/end opcode edges. See the folded-form branch above for why
    // the dispatch edges matter (the catch edge pushes the tag's params
    // onto the stack for the handler's leading local.sets to consume).
    if (tt === TokenType.Try) {
      const label = this.parseBindVarOpt();
      const blockType = this.parseBlockType();
      const bodyCtx = newCtx();
      this.parseInstrList(bodyCtx);
      flushStack(bodyCtx);
      const catches: Catch[] = [];
      let delegate: Var | undefined;
      while (this.peek() === TokenType.Catch || this.peek() === TokenType.CatchAll) {
        const cLoc = this.loc();
        const isCatch = this.peek() === TokenType.Catch;
        this.drop(); // consume catch / catch_all keyword
        const handler: Expr[] = [];
        if (isCatch) {
          const tag = this.parseVar() ?? varIndex(0);
          this.parseInstrListInto(handler);
          catches.push({ loc: cLoc, tag, isRef: false, body: handler });
        } else {
          this.parseInstrListInto(handler);
          catches.push({ loc: cLoc, isRef: false, body: handler });
        }
      }
      if (this.peek() === TokenType.Delegate) {
        this.drop();
        delegate = this.parseVar() ?? varIndex(0);
      } else {
        this.expect(TokenType.End);
        if (this.peek() === TokenType.Var) this.drop(); // optional trailing label
      }
      const node: TryExpr = delegate === undefined
        ? { kind: 'try', label, blockType, body: bodyCtx.stmts, catches, loc }
        : { kind: 'try', label, blockType, body: bodyCtx.stmts, catches, delegate, loc };
      const hasValue = blockType.kind !== 'void';
      if (hasValue) ctx.stack.push(node);
      else pushStmt(ctx, node);
      return Result.Ok;
    }

    // TryTable, linear form — simplified: parse the protected body and
    // skip the catch-clause immediates to the matching `end`. (Folded
    // try_table at the top of this method has full catch support.)
    if (tt === TokenType.TryTable) {
      const label = this.parseBindVarOpt();
      const blockType = this.parseBlockType();
      const bodyCtx = newCtx();
      this.parseInstrList(bodyCtx);
      // skip to matching end
      let depth = 1;
      while (this.peek() !== TokenType.Eof) {
        const cur = this.peek();
        if (isBlockInstr(cur)) depth++;
        else if (cur === TokenType.End) {
          depth--;
          if (depth === 0) break;
        }
        this.drop();
      }
      this.expect(TokenType.End);
      flushStack(bodyCtx);
      const node: BlockExpr = { kind: 'block', label, blockType, body: bodyCtx.stmts, loc };
      const hasValue = blockType.kind !== 'void';
      if (hasValue) ctx.stack.push(node);
      else pushStmt(ctx, node);
      return Result.Ok;
    }

    this.error(loc, 'unexpected block instr');
    return Result.Error;
  }

  private parseLinearPlainInstr(ctx: ExprCtx): Result {
    const loc = this.loc();
    const tok = this.consume();
    const tt = tok.tokenType;
    const nInputs = instrInputCountForTok(tok);

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
      pushStmt(ctx, expr);
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
      case TokenType.Unreachable:
        return { kind: 'unreachable', loc } as UnreachableExpr;
      case TokenType.Nop:
        return { kind: 'nop', loc } as NopExpr;
      case TokenType.Drop:
        return { kind: 'drop', value: op0(), loc } as DropExpr;
      case TokenType.Select: {
        const resultType: Type[] = [];
        if (this.matchLpar(TokenType.Result)) {
          while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
            const t = this.parseValueType();
            if (t !== null) resultType.push(t);
          }
          this.expect(TokenType.Rpar);
        }
        return {
          kind: 'select',
          val1: op0(),
          val2: op1(),
          cond: op2(),
          resultType,
          loc,
        } as SelectExpr;
      }
      case TokenType.Return:
        // `return` is variable-arity (instrInputCount = -1), so `operands`
        // is the entire stack at this point. For a multi-value function
        // (`(func (result i32 i32) ...)`) all stack values become return
        // values; capturing only operands[0] silently dropped the rest and
        // produced binaries that V8 rejected as missing operands.
        return { kind: 'return', values: operands, loc } as ReturnExpr;
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
        return {
          kind: 'call_indirect',
          table: tableVar,
          sig,
          typeVar: typeVar ?? varIndex(0),
          args,
          callee,
          loc,
        } as CallIndirectExpr;
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
        return {
          kind: 'return_call_indirect',
          sig,
          typeVar: typeVar ?? varIndex(0),
          table: tableVar,
          args,
          callee,
          loc,
        } as ReturnCallIndirectExpr;
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
        return { kind: 'local.get', var: this.resolveLocal(v), loc } as LocalGetExpr;
      }
      case TokenType.LocalSet: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'local.set', var: this.resolveLocal(v), value: op0(), loc } as LocalSetExpr;
      }
      case TokenType.LocalTee: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'local.tee', var: this.resolveLocal(v), value: op0(), loc } as LocalTeeExpr;
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
        return {
          kind: 'load',
          opcode: op as unknown as Opcode,
          memidx,
          offset,
          align,
          address: op0(),
          loc,
        } as LoadExpr;
      }
      case TokenType.Store: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return {
          kind: 'store',
          opcode: op as unknown as Opcode,
          memidx,
          offset,
          align,
          address: op0(),
          value: op1(),
          loc,
        } as StoreExpr;
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
        return {
          kind: 'memory.copy',
          destMemidx,
          srcMemidx,
          dest: op0(),
          src: op1(),
          size: op2(),
          loc,
        } as MemoryCopyExpr;
      }
      case TokenType.MemoryFill: {
        const memidx = this.parseMemidxOpt(loc);
        return {
          kind: 'memory.fill',
          memidx,
          dest: op0(),
          value: op1(),
          size: op2(),
          loc,
        } as MemoryFillExpr;
      }
      case TokenType.MemoryInit: {
        const segment = this.parseVar() ?? varIndex(0);
        const memidx = this.parseMemidxOpt(loc);
        return {
          kind: 'memory.init',
          segment,
          memidx,
          dest: op0(),
          src: op1(),
          size: op2(),
          loc,
        } as MemoryInitExpr;
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
        return {
          kind: 'table.grow',
          table: v,
          initValue: op0(),
          delta: op1(),
          loc,
        } as TableGrowExpr;
      }
      case TokenType.TableSize: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'table.size', table: v, loc } as TableSizeExpr;
      }
      case TokenType.TableFill: {
        const v = this.parseVar() ?? varIndex(0);
        return {
          kind: 'table.fill',
          table: v,
          start: op0(),
          value: op1(),
          size: op2(),
          loc,
        } as TableFillExpr;
      }
      case TokenType.TableCopy: {
        const dst = this.parseVar() ?? varIndex(0);
        const src = this.parseVar() ?? varIndex(0);
        return {
          kind: 'table.copy',
          dst,
          src,
          dest: op0(),
          srcOffset: op1(),
          size: op2(),
          loc,
        } as TableCopyExpr;
      }
      case TokenType.TableInit: {
        const segment = this.parseVar() ?? varIndex(0);
        const table = this.parseVar() ?? varIndex(0);
        return {
          kind: 'table.init',
          segment,
          table,
          dest: op0(),
          src: op1(),
          size: op2(),
          loc,
        } as TableInitExpr;
      }
      case TokenType.ElemDrop: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'elem.drop', segment: v, loc } as ElemDropExpr;
      }

      case TokenType.RefNull: {
        const t = this.parseValueType() ?? Type.FuncRef;
        return { kind: 'ref.null', refType: varName(typeToName(t)), loc } as RefNullExpr;
      }
      case TokenType.RefIsNull:
        return { kind: 'ref.is_null', value: op0(), loc } as RefIsNullExpr;
      case TokenType.RefFunc: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'ref.func', func: v, loc } as RefFuncExpr;
      }
      case TokenType.RefAsNonNull:
        return { kind: 'ref.as_non_null', value: op0(), loc } as RefAsNonNullExpr;
      case TokenType.RefEq:
        return { kind: 'ref.eq', left: op0(), right: op1(), loc } as RefEqExpr;
      case TokenType.RefI31:
        return { kind: 'ref.i31', value: op0(), loc } as RefI31Expr;
      case TokenType.I31Get: {
        // The lexer routes both `i31.get_s` (opcode 0x1d) and `i31.get_u`
        // (0x1e) to TokenType.I31Get, so the opcode immediate determines
        // the signedness.
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const signed = (op & 0xff) === GcOpcode.I31GetS;
        return { kind: 'i31.get', i31: op0(), signed, loc } as I31GetExpr;
      }
      case TokenType.StructNew: {
        const typeVar = this.parseVar() ?? varIndex(0);
        return { kind: 'struct.new', typeVar, operands, loc } as StructNewExpr;
      }
      case TokenType.StructNewDefault: {
        const typeVar = this.parseVar() ?? varIndex(0);
        return { kind: 'struct.new_default', typeVar, loc } as StructNewDefaultExpr;
      }
      case TokenType.StructGet: {
        // Three lexer entries (struct.get / get_s / get_u) all route here;
        // the opcode immediate distinguishes signedness for packed-field reads.
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const byte = op & 0xff;
        const signed = byte === GcOpcode.StructGetS
          ? true
          : byte === GcOpcode.StructGetU
          ? false
          : undefined;
        const typeVar = this.parseVar() ?? varIndex(0);
        const fieldVar = this.parseVar() ?? varIndex(0);
        const node: StructGetExpr = { kind: 'struct.get', typeVar, fieldVar, ref: op0(), loc };
        if (signed !== undefined) (node as { signed?: boolean }).signed = signed;
        return node;
      }
      case TokenType.StructSet: {
        const typeVar = this.parseVar() ?? varIndex(0);
        const fieldVar = this.parseVar() ?? varIndex(0);
        return {
          kind: 'struct.set',
          typeVar,
          fieldVar,
          ref: op0(),
          value: op1(),
          loc,
        } as StructSetExpr;
      }
      case TokenType.ArrayNew: {
        const typeVar = this.parseVar() ?? varIndex(0);
        // Spec stack order: init pushed first, then length; popN returns
        // [oldest, newest] = [init, length]. So op0() is init, op1() is length.
        return {
          kind: 'array.new',
          typeVar,
          init: op0(),
          length: op1(),
          loc,
        } as ArrayNewExpr;
      }
      case TokenType.ArrayNewDefault: {
        const typeVar = this.parseVar() ?? varIndex(0);
        return {
          kind: 'array.new_default',
          typeVar,
          length: op0(),
          loc,
        } as ArrayNewDefaultExpr;
      }
      case TokenType.ArrayNewFixed: {
        // `array.new_fixed $T N elem1 ... elemN` — N is an explicit immediate
        // count, then N inline element expressions. The wabt-ts parser stores
        // the elements in `operands`; the count is recoverable from the array
        // length, so we don't keep N as a separate field.
        const typeVar = this.parseVar() ?? varIndex(0);
        // Consume the count immediate (validation will check it matches
        // operands.length).
        this.parseNatOrInt();
        return {
          kind: 'array.new_fixed',
          typeVar,
          operands,
          loc,
        } as ArrayNewFixedExpr;
      }
      case TokenType.ArrayNewData: {
        const typeVar = this.parseVar() ?? varIndex(0);
        const dataVar = this.parseVar() ?? varIndex(0);
        return {
          kind: 'array.new_data',
          typeVar,
          dataVar,
          offset: op0(),
          length: op1(),
          loc,
        } as ArrayNewDataExpr;
      }
      case TokenType.ArrayNewElem: {
        const typeVar = this.parseVar() ?? varIndex(0);
        const elemVar = this.parseVar() ?? varIndex(0);
        return {
          kind: 'array.new_elem',
          typeVar,
          elemVar,
          offset: op0(),
          length: op1(),
          loc,
        } as ArrayNewElemExpr;
      }
      case TokenType.ArrayGet: {
        // Three lexer entries (array.get / get_s / get_u) all route here;
        // opcode immediate distinguishes signedness for packed elements.
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const byte = op & 0xff;
        const signed = byte === GcOpcode.ArrayGetS
          ? true
          : byte === GcOpcode.ArrayGetU
          ? false
          : undefined;
        const typeVar = this.parseVar() ?? varIndex(0);
        const node: ArrayGetExpr = {
          kind: 'array.get',
          typeVar,
          ref: op0(),
          index: op1(),
          loc,
        };
        if (signed !== undefined) (node as { signed?: boolean }).signed = signed;
        return node;
      }
      case TokenType.ArraySet: {
        const typeVar = this.parseVar() ?? varIndex(0);
        return {
          kind: 'array.set',
          typeVar,
          ref: op0(),
          index: op1(),
          value: op2(),
          loc,
        } as ArraySetExpr;
      }
      case TokenType.ArrayLen:
        return { kind: 'array.len', ref: op0(), loc } as ArrayLenExpr;

      case TokenType.RefTest: {
        const imm = this.parseRefImmediate();
        if (imm === null) return null;
        return {
          kind: 'ref.test',
          heapType: imm.heapType,
          nullable: imm.nullable,
          ref: op0(),
          loc,
        } as RefTestExpr;
      }
      case TokenType.RefCast: {
        const imm = this.parseRefImmediate();
        if (imm === null) return null;
        return {
          kind: 'ref.cast',
          heapType: imm.heapType,
          nullable: imm.nullable,
          ref: op0(),
          loc,
        } as RefCastExpr;
      }

      case TokenType.Throw: {
        const v = this.parseVar() ?? varIndex(0);
        return { kind: 'throw', tag: v, args: operands, loc } as ThrowExpr;
      }
      case TokenType.ThrowRef:
        return { kind: 'throw_ref', exnref: op0(), loc } as ThrowRefExpr;
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
        return {
          kind: 'quaternary',
          opcode: op,
          a: op0(),
          b: op1(),
          c: op2(),
          d: op3(),
          loc,
        } as QuaternaryExpr;
      }

      case TokenType.AtomicFence:
        return { kind: 'atomic_fence', consistencyModel: 0, loc } as AtomicFenceExpr;
      case TokenType.AtomicLoad: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return {
          kind: 'atomic_load',
          opcode: op as unknown as Opcode,
          memidx,
          offset,
          align,
          address: op0(),
          loc,
        } as AtomicLoadExpr;
      }
      case TokenType.AtomicStore: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return {
          kind: 'atomic_store',
          opcode: op as unknown as Opcode,
          memidx,
          offset,
          align,
          address: op0(),
          value: op1(),
          loc,
        } as AtomicStoreExpr;
      }
      case TokenType.AtomicRmw: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return {
          kind: 'atomic_rmw',
          opcode: op as unknown as Opcode,
          memidx,
          offset,
          align,
          address: op0(),
          value: op1(),
          loc,
        } as AtomicRmwExpr;
      }
      case TokenType.AtomicRmwCmpxchg: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return {
          kind: 'atomic_rmw_cmpxchg',
          opcode: op as unknown as Opcode,
          memidx,
          offset,
          align,
          address: op0(),
          expected: op1(),
          replacement: op2(),
          loc,
        } as AtomicRmwCmpxchgExpr;
      }
      case TokenType.AtomicNotify: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return {
          kind: 'atomic_notify',
          opcode: op as unknown as Opcode,
          memidx,
          offset,
          align,
          address: op0(),
          count: op1(),
          loc,
        } as AtomicNotifyExpr;
      }
      case TokenType.AtomicWait: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        return {
          kind: 'atomic_wait',
          opcode: op as unknown as Opcode,
          memidx,
          offset,
          align,
          address: op0(),
          expected: op1(),
          timeout: op2(),
          loc,
        } as AtomicWaitExpr;
      }

      case TokenType.SimdLaneOp: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const lane = this.parseSimdLane();
        const isReplace = isReplaceLaneOpcode(op);
        const node: SimdLaneOpExpr = isReplace
          ? {
            kind: 'simd_lane_op',
            opcode: op as unknown as Opcode,
            lane,
            operand: op0(),
            value: op1(),
            loc,
          }
          : {
            kind: 'simd_lane_op',
            opcode: op as unknown as Opcode,
            lane,
            operand: op0(),
            loc,
          };
        return node;
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
        return {
          kind: 'simd_shuffle',
          opcode: op as unknown as Opcode,
          lanes: laneArr,
          left: op0(),
          right: op1(),
          loc,
        } as SimdShuffleOpExpr;
      }
      case TokenType.SimdLoadLane: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        const lane = this.parseSimdLane();
        return {
          kind: 'simd_load_lane',
          opcode: op as unknown as Opcode,
          memidx,
          offset,
          align,
          lane,
          address: op0(),
          vec: op1(),
          loc,
        } as SimdLoadLaneExpr;
      }
      case TokenType.SimdStoreLane: {
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const memidx = this.parseMemidxOpt(loc);
        const offset = this.parseOffsetOpt();
        const align = this.parseAlignOpt();
        const lane = this.parseSimdLane();
        return {
          kind: 'simd_store_lane',
          opcode: op as unknown as Opcode,
          memidx,
          offset,
          align,
          lane,
          address: op0(),
          vec: op1(),
          loc,
        } as SimdStoreLaneExpr;
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

    if (type === Type.I32) {
      const n = this.parseNatOrInt();
      if (n === null) {
        this.error(loc, 'expected i32 constant');
        return null;
      }
      return constI32(Number(BigInt.asIntN(32, n)));
    }
    if (type === Type.I64) {
      const n = this.parseNatOrInt();
      if (n === null) {
        this.error(loc, 'expected i64 constant');
        return null;
      }
      return constI64(BigInt.asIntN(64, n));
    }
    if (type === Type.F32) {
      const bits = this.parseF32Bits();
      if (bits === null) {
        this.error(loc, 'expected f32 constant');
        return null;
      }
      return constF32(bits);
    }
    if (type === Type.F64) {
      const bits = this.parseF64Bits();
      if (bits === null) {
        this.error(loc, 'expected f64 constant');
        return null;
      }
      return constF64(bits);
    }
    if (type === Type.V128) {
      const bytes = this.parseV128Literal();
      if (bytes === null) return null;
      return constV128(bytes);
    }
    this.error(loc, 'unknown const type');
    return null;
  }

  /**
   * Parse the lane-typed literal that follows a `v128.const` opcode.
   *
   * WAT grammar:
   *   v128.const i8x16  N N N N N N N N N N N N N N N N
   *   v128.const i16x8  N N N N N N N N
   *   v128.const i32x4  N N N N
   *   v128.const i64x2  N N
   *   v128.const f32x4  F F F F
   *   v128.const f64x2  F F
   *
   * Each lane is written in source order; the 16 result bytes are
   * laid out little-endian per the wasm spec (lane 0 = bytes[0..]).
   * Returns null on any malformed lane.
   */
  private parseV128Literal(): Uint8Array | null {
    const loc = this.loc();
    const bytes = new Uint8Array(16);
    const dv = new DataView(bytes.buffer);
    const tt = this.peek();

    switch (tt) {
      case TokenType.I8X16: {
        this.drop();
        for (let i = 0; i < 16; i++) {
          const n = this.parseNatOrInt();
          if (n === null) {
            this.error(loc, `expected i8 lane ${i} for v128.const`);
            return null;
          }
          bytes[i] = Number(BigInt.asIntN(8, n)) & 0xff;
        }
        return bytes;
      }
      case TokenType.I16X8: {
        this.drop();
        for (let i = 0; i < 8; i++) {
          const n = this.parseNatOrInt();
          if (n === null) {
            this.error(loc, `expected i16 lane ${i} for v128.const`);
            return null;
          }
          dv.setInt16(i * 2, Number(BigInt.asIntN(16, n)), true);
        }
        return bytes;
      }
      case TokenType.I32X4: {
        this.drop();
        for (let i = 0; i < 4; i++) {
          const n = this.parseNatOrInt();
          if (n === null) {
            this.error(loc, `expected i32 lane ${i} for v128.const`);
            return null;
          }
          dv.setInt32(i * 4, Number(BigInt.asIntN(32, n)), true);
        }
        return bytes;
      }
      case TokenType.I64X2: {
        this.drop();
        for (let i = 0; i < 2; i++) {
          const n = this.parseNatOrInt();
          if (n === null) {
            this.error(loc, `expected i64 lane ${i} for v128.const`);
            return null;
          }
          dv.setBigInt64(i * 8, BigInt.asIntN(64, n), true);
        }
        return bytes;
      }
      case TokenType.F32X4: {
        this.drop();
        for (let i = 0; i < 4; i++) {
          const bits = this.parseF32Bits();
          if (bits === null) {
            this.error(loc, `expected f32 lane ${i} for v128.const`);
            return null;
          }
          dv.setUint32(i * 4, bits, true);
        }
        return bytes;
      }
      case TokenType.F64X2: {
        this.drop();
        for (let i = 0; i < 2; i++) {
          const bits = this.parseF64Bits();
          if (bits === null) {
            this.error(loc, `expected f64 lane ${i} for v128.const`);
            return null;
          }
          dv.setBigUint64(i * 8, bits, true);
        }
        return bytes;
      }
      default:
        this.error(
          loc,
          'expected v128 lane interpretation (i8x16 / i16x8 / i32x4 / i64x2 / f32x4 / f64x2)',
        );
        return null;
    }
  }

  private parseNatOrInt(): bigint | null {
    const tt = this.peek();
    if (tt !== TokenType.Nat && tt !== TokenType.Int) return null;
    const tok = this.consume() as LiteralToken;
    return parseNatText(tok.literal.text);
  }

  private parseF32Bits(): number | null {
    const tt = this.peek();
    if (tt === TokenType.Float) {
      const tok = this.consume() as LiteralToken;
      return parseF32LiteralBits(tok.literal);
    }
    if (tt === TokenType.Nat || tt === TokenType.Int) {
      // `f32.const 1` means float 1.0, not bit pattern 0x00000001 (which
      // would be the smallest positive subnormal). Convert the integer
      // value through IEEE 754 rounding to get the right bits.
      const tok = this.consume() as LiteralToken;
      const n = parseNatText(tok.literal.text);
      if (n === null) return null;
      return f32ValueToBits(Number(n));
    }
    if (tt === TokenType.NanArithmetic || tt === TokenType.NanCanonical) {
      this.drop();
      return 0x7fc00000;
    }
    return null;
  }

  private parseF64Bits(): bigint | null {
    const tt = this.peek();
    if (tt === TokenType.Float) {
      const tok = this.consume() as LiteralToken;
      return parseF64LiteralBits(tok.literal);
    }
    if (tt === TokenType.Nat || tt === TokenType.Int) {
      // See parseF32Bits — integer literals are decimal float values, not
      // raw bit patterns. Without this conversion `f64.const 1` encoded as
      // bit pattern 0x0000000000000001 = 5e-324 (smallest subnormal).
      const tok = this.consume() as LiteralToken;
      const n = parseNatText(tok.literal.text);
      if (n === null) return null;
      return f64ValueToBits(Number(n));
    }
    if (tt === TokenType.NanArithmetic || tt === TokenType.NanCanonical) {
      this.drop();
      return 0x7ff8000000000000n;
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
        if (t !== null) types.push(t);
        else break;
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

  private parseMemidxOpt(_loc: Location): Var {
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
      commands.push({
        kind: 'module',
        scriptModule: { kind: 'text', name: null, module, loc: this.peekToken().loc },
      });
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
        this.drop();
        this.drop(); // '(' 'register'
        const name = this.parseQuotedText() ?? '';
        const as_ = this.peek() === TokenType.Var ? (this.consume() as StringToken).text : null;
        this.expect(TokenType.Rpar);
        return { kind: 'register', name, as: as_, loc };
      }
      case TokenType.Invoke:
      case TokenType.Get: {
        const action = this.parseAction();
        if (action === null) return null;
        return { kind: 'action', action };
      }
      case TokenType.AssertReturn: {
        this.drop();
        this.drop();
        const action = this.parseAction();
        if (action === null) {
          this.expect(TokenType.Rpar);
          return null;
        }
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
        this.drop();
        this.drop();
        // could be action or module
        if (
          this.peek() === TokenType.Lpar &&
          (this.peek(1) === TokenType.Invoke || this.peek(1) === TokenType.Get)
        ) {
          const action = this.parseAction();
          if (action === null) {
            this.expect(TokenType.Rpar);
            return null;
          }
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
        this.drop();
        this.drop();
        const action = this.parseAction();
        this.expect(TokenType.Rpar);
        if (action === null) return null;
        return { kind: 'assert_exception', action, loc };
      }
      case TokenType.AssertExhaustion: {
        this.drop();
        this.drop();
        const action = this.parseAction();
        if (action === null) {
          this.expect(TokenType.Rpar);
          return null;
        }
        const text = this.parseQuotedText() ?? '';
        this.expect(TokenType.Rpar);
        return { kind: 'assert_exhaustion', action, text, loc };
      }
      case TokenType.AssertInvalid: {
        this.drop();
        this.drop();
        const sm = this.parseScriptModule();
        const text = this.parseQuotedText() ?? '';
        this.expect(TokenType.Rpar);
        if (sm === null) return null;
        return { kind: 'assert_invalid', scriptModule: sm, text, loc };
      }
      case TokenType.AssertMalformed: {
        this.drop();
        this.drop();
        const sm = this.parseScriptModule();
        const text = this.parseQuotedText() ?? '';
        this.expect(TokenType.Rpar);
        if (sm === null) return null;
        return { kind: 'assert_malformed', scriptModule: sm, text, loc };
      }
      case TokenType.AssertUnlinkable: {
        this.drop();
        this.drop();
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
        this.drop();
        this.drop();
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
    case TokenType.Lpar:
      return '(';
    case TokenType.Rpar:
      return ')';
    case TokenType.Eof:
      return 'EOF';
    case TokenType.Module:
      return 'module';
    case TokenType.Function:
      return 'func';
    case TokenType.Type:
      return 'type';
    case TokenType.Import:
      return 'import';
    case TokenType.Export:
      return 'export';
    case TokenType.Global:
      return 'global';
    case TokenType.Memory:
      return 'memory';
    case TokenType.Table:
      return 'table';
    case TokenType.Start:
      return 'start';
    case TokenType.Data:
      return 'data';
    case TokenType.Elem:
      return 'elem';
    case TokenType.Const:
      return 'CONST';
    case TokenType.Param:
      return 'param';
    case TokenType.Result:
      return 'result';
    case TokenType.Local:
      return 'local';
    case TokenType.End:
      return 'end';
    case TokenType.Else:
      return 'else';
    case TokenType.Then:
      return 'then';
    case TokenType.Invoke:
      return 'invoke';
    case TokenType.Register:
      return 'register';
    case TokenType.AssertReturn:
      return 'assert_return';
    default:
      return `<token:${tt}>`;
  }
}

/** Map a const opcode to its value type. */
function constOpcodeType(opcode: number): Type {
  switch (opcode) {
    case Opcode.I32Const:
      return Type.I32;
    case Opcode.I64Const:
      return Type.I64;
    case Opcode.F32Const:
      return Type.F32;
    case Opcode.F64Const:
      return Type.F64;
    default:
      // V128 const uses SIMD prefix
      return Type.V128;
  }
}

/** Map a Type to its WAT keyword string. */
function typeToName(t: Type): string {
  switch (t) {
    case Type.FuncRef:
      return 'funcref';
    case Type.ExternRef:
      return 'externref';
    case Type.ExnRef:
      return 'exnref';
    default:
      return 'funcref';
  }
}

/**
 * Map an abstract-reftype `ValueType` (`anyref` / `i31ref` / etc., as the
 * lexer hands back) to the bare abstract-heap-type name used inside
 * `ref.test (ref [null] HEAP) val` and `ref.cast`. Returns null when the
 * value type isn't a GC abstract reftype.
 */
function abstractHeapTypeNameForValType(t: Type): string | null {
  switch (t) {
    case Type.AnyRef:
      return 'any';
    case Type.EqRef:
      return 'eq';
    case Type.I31Ref:
      return 'i31';
    case Type.StructRef:
      return 'struct';
    case Type.ArrayRef:
      return 'array';
    case Type.FuncRef:
      return 'func';
    case Type.ExternRef:
      return 'extern';
    case Type.NullRef:
      return 'none';
    case Type.NullFuncRef:
      return 'nofunc';
    case Type.NullExternRef:
      return 'noextern';
    default:
      return null;
  }
}

/** Parse a float literal (LiteralToken) to its bit pattern. */
// ---------------------------------------------------------------------------
// IEEE 754 helpers
// ---------------------------------------------------------------------------
//
// `parseFloatBits` and friends used to share a single `number | null` return
// type. That was wrong for f64 in two ways:
//   - Bit-pattern values above 2^53 (any negative or large-mantissa f64 like
//     -3.14) couldn't round-trip through a JS Number, so they came back with
//     ~3e-12 drift from the lo/hi reassembly.
//   - Integer-literal NaN payload constants like `0x7ff0000000000000` are
//     already imprecise as JS Number literals.
// f32 stays on `number` (32 bits fit safely), f64 returns `bigint`.

const F32_BUF = new ArrayBuffer(4);
const F32_VIEW = new DataView(F32_BUF);
const F64_BUF = new ArrayBuffer(8);
const F64_VIEW = new DataView(F64_BUF);

function f32ValueToBits(v: number): number {
  F32_VIEW.setFloat32(0, v, true);
  return F32_VIEW.getUint32(0, true);
}

function f64ValueToBits(v: number): bigint {
  F64_VIEW.setFloat64(0, v, true);
  return F64_VIEW.getBigUint64(0, true);
}

// JavaScript's parseFloat() does NOT understand WAT hex-float notation
// (`0x1.921fb54442d18p+2`): it parses the leading "0", stops at "x", and returns 0.
// This explicitly reconstructs the double from the sign / integer-hex / fraction-hex /
// binary-exponent parts. For normal numbers the (1 + mantissa/2^k) * 2^exp form is exact.
const HEX_FLOAT_PARSE_RE = /^([+-]?)0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?[pP]([+-]?[0-9]+)$/;
function parseHexFloatValue(s: string): number {
  const m = HEX_FLOAT_PARSE_RE.exec(s);
  if (!m) return NaN;
  const [, sign, intPart, fracPart, expStr] = m;
  const intVal = intPart && intPart.length > 0 ? parseInt(intPart, 16) : 0;
  const fracVal = fracPart && fracPart.length > 0
    ? parseInt(fracPart, 16) / Math.pow(16, fracPart.length)
    : 0;
  const result = (intVal + fracVal) * Math.pow(2, parseInt(expStr!, 10));
  return sign === '-' ? -result : result;
}

function parseF32LiteralBits(lit: { literalType: LiteralType; text: string }): number | null {
  const { literalType, text } = lit;
  if (literalType === LiteralType.Infinity) {
    return text.startsWith('-') ? 0xff800000 : 0x7f800000;
  }
  if (literalType === LiteralType.Nan) {
    if (text.includes(':')) {
      const payloadStr = text.split(':')[1] ?? '0x0';
      const payload = Number(BigInt(payloadStr));
      const sign = text.startsWith('-') ? 0x80000000 : 0;
      return sign | 0x7f800000 | (payload & 0x3fffff);
    }
    return text.startsWith('-') ? 0xffc00000 : 0x7fc00000;
  }
  if (literalType === LiteralType.Hexfloat) {
    return f32ValueToBits(Math.fround(parseHexFloatValue(text.replace(/_/g, ''))));
  }
  if (literalType === LiteralType.Float) {
    return f32ValueToBits(parseFloat(text.replace(/_/g, '')));
  }
  // Integer literal used in float position (e.g., `f32.const 1`) — decimal
  // float value, NOT raw bit pattern. The "raw bits" interpretation came
  // from a misread of the wabt-ts intermediate type; the spec says these
  // are floating-point literals.
  const n = parseNatText(text);
  if (n === null) return null;
  return f32ValueToBits(Number(n));
}

function parseF64LiteralBits(lit: { literalType: LiteralType; text: string }): bigint | null {
  const { literalType, text } = lit;
  if (literalType === LiteralType.Infinity) {
    return text.startsWith('-') ? 0xfff0000000000000n : 0x7ff0000000000000n;
  }
  if (literalType === LiteralType.Nan) {
    if (text.includes(':')) {
      const payloadStr = text.split(':')[1] ?? '0x0';
      const payload = BigInt(payloadStr) & 0x000fffffffffffffn;
      const sign = text.startsWith('-') ? 0x8000000000000000n : 0n;
      return sign | 0x7ff0000000000000n | payload;
    }
    return text.startsWith('-') ? 0xfff8000000000000n : 0x7ff8000000000000n;
  }
  if (literalType === LiteralType.Hexfloat) {
    return f64ValueToBits(parseHexFloatValue(text.replace(/_/g, '')));
  }
  if (literalType === LiteralType.Float) {
    return f64ValueToBits(parseFloat(text.replace(/_/g, '')));
  }
  const n = parseNatText(text);
  if (n === null) return null;
  return f64ValueToBits(Number(n));
}

// ---------------------------------------------------------------------------
// Top-level exported parse functions
// ---------------------------------------------------------------------------

/** Return value from {@link parseWatModule}. */
export interface ParseWatResult {
  /** The parsed module IR. May be a partial IR if `errors` is non-empty. */
  readonly module: Module;
  /** Parse errors. Empty array on success. */
  readonly errors: WabtError[];
}

/** Return value from {@link parseWastScript}. */
export interface ParseWastResult {
  /** The parsed script (module + spec-test commands). */
  readonly script: WastScript;
  /** Parse errors. Empty array on success. */
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
