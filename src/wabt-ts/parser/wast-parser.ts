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
import { addError, ErrorLevel, unknownLocation } from '../core/error.ts';
import { Result } from '../core/result.ts';
import { ExprVisitor } from '../ir/expr-visitor.ts';
import { decodeStringToken, STRICT_NAME_DECODER } from '../core/literal.ts';
import { GcOpcode, Opcode, PREFIX_SIMD } from '../core/opcode.ts';
import { heapTypeNameToType, Type, typeName, typeToHeapTypeName } from '../core/types.ts';
import {
  type ArrayCopyExpr,
  type ArrayFillExpr,
  type ArrayGetExpr,
  type ArrayInitSegmentExpr,
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
  type BrOnCastExpr,
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
  type ExternConvertExpr,
  type Field,
  type Func,
  type FuncSignature,
  type Global,
  type GlobalGetExpr,
  type GlobalSetExpr,
  type I31GetExpr,
  type IfExpr,
  type Import,
  isRefValueType,
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
  operandPlaceholder,
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
  sigEquals,
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
  type TypeUse,
  type UnaryExpr,
  type UnreachableExpr,
  type ValueType,
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
  tokenTypeName,
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
    readonly args: WastArg[];
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
  | {
    readonly kind: 'ref.null';
    /**
     * The expected null's heap type, as the matching nullable reference
     * {@link Type} (`ref.null extern` → `Type.ExternRef`).
     *
     * **Omitted for the bare `(ref.null)` result form**, which the wast
     * grammar defines as "a null of ANY heap type" — a runner must accept
     * any null there rather than compare against a specific type. A
     * user-defined `$T` heap type has no flat `Type` entry and coarsens to
     * `Type.StructRef` (the loose typed-ref IR).
     */
    readonly refType?: Type;
  }
  | { readonly kind: 'ref.func' }
  | { readonly kind: 'ref.any' }
  | { readonly kind: 'ref.eq' }
  | { readonly kind: 'ref.i31' }
  | { readonly kind: 'ref.struct' }
  | { readonly kind: 'ref.array' }
  | {
    readonly kind: 'either';
    /**
     * Alternative expected results — the actual value matches when it matches
     * ANY alternative. Used by the relaxed-SIMD tests, whose operations are
     * permitted more than one correct answer.
     */
    readonly alternatives: ExpectedConst[];
  }
  | {
    readonly kind: 'ref.extern';
    /**
     * The host reference's numeric value, from `(ref.extern 1)`.
     *
     * **Omitted for the bare `(ref.extern)` form**, which matches ANY
     * external reference regardless of value — same convention as
     * {@link ExpectedConst}'s `ref.null` refType.
     */
    readonly value?: number;
  }
  | {
    readonly kind: 'ref.host';
    /**
     * The host reference's numeric value, from `(ref.host 1)` — the
     * internalized (any-side) counterpart of `(ref.extern N)`. Omitted for
     * the bare `(ref.host)` form.
     */
    readonly value?: number;
  };

/**
 * An argument to an `invoke` action.
 *
 * The same shapes as {@link ExpectedConst} minus the patterns that only make
 * sense as *results* — the nan patterns and the bare abstract-reference
 * matchers. Derived from `ExpectedConst` so the two can't drift.
 */
export type WastArg = Extract<
  ExpectedConst,
  { kind: 'value' | 'ref.null' | 'ref.extern' | 'ref.host' | 'ref.func' }
>;

/**
 * The heap type a bare reference-pattern result matches — `(ref.func)` →
 * `Type.FuncRef`, `(ref.array)` → `Type.ArrayRef`, and so on.
 *
 * These patterns all mean the same thing ("a reference whose heap type is a
 * subtype of H"), so a script runner can handle them uniformly instead of
 * switching on six near-identical `kind`s. Returns null for the non-reference
 * variants (`value` / the nan patterns) and for `ref.null`, whose match is on
 * nullness rather than on a heap type — read its `refType` instead.
 */
export function expectedRefHeapType(c: ExpectedConst): Type | null {
  switch (c.kind) {
    case 'ref.func':
      return Type.FuncRef;
    case 'ref.extern':
      return Type.ExternRef;
    case 'ref.host':
      // `ref.host` is the internalized side of an external reference, so it
      // lives in the `any` hierarchy rather than the `extern` one.
      return Type.AnyRef;
    case 'ref.any':
      return Type.AnyRef;
    case 'ref.eq':
      return Type.EqRef;
    case 'ref.i31':
      return Type.I31Ref;
    case 'ref.struct':
      return Type.StructRef;
    case 'ref.array':
      return Type.ArrayRef;
    default:
      return null;
  }
}

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
  }
  | {
    /**
     * `(module definition $M …)` — a module DECLARED but not instantiated.
     * Structurally a text module; the distinction is that a script runner
     * must not instantiate it until a matching `(module instance …)` asks
     * for it. memory.wast uses it for `(memory 65536)`, which is well-formed
     * but would be absurd to instantiate.
     */
    readonly kind: 'definition';
    readonly name: string | null;
    readonly module: Module;
    readonly loc: Location;
  };

/** A command in a WAST script. */
export type WastCommand =
  | { readonly kind: 'module'; readonly scriptModule: WastScriptModule }
  | {
    /** `(module instance $I $M)` — instantiate the definition named `$M`. */
    readonly kind: 'module_instance';
    readonly name: string | null;
    readonly definition: Var;
    readonly loc: Location;
  }
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
  | {
    /**
     * `(assert_trap (module …) "msg")` — the module is well-formed and VALID;
     * INSTANTIATING it traps (an out-of-bounds data or elem segment, a start
     * function that traps).
     *
     * This used to be reported as `assert_invalid`, which says the opposite:
     * that the module should fail validation. 54 commands across data.wast,
     * elem.wast, linking*.wast and start.wast were mislabelled, and any runner
     * driving the script tested the wrong property for every one of them.
     */
    readonly kind: 'assert_trap_module';
    readonly scriptModule: WastScriptModule;
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
    case TokenType.BrOnCast:
    case TokenType.BrOnCastFail:
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
    case TokenType.AnyConvertExtern:
    case TokenType.ExternConvertAny:
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
    case TokenType.ArrayFill:
    case TokenType.ArrayCopy:
    case TokenType.ArrayInitData:
    case TokenType.ArrayInitElem:
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
    case TokenType.Rec:
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
/**
 * The element type of a FUNCIDX elemlist — `(elem … func $a $b)` and the bare
 * `(elem (offset …) $a $b)` abbreviation.
 *
 * It is the NON-NULLABLE `(ref func)`, not `funcref`: every entry is a
 * function index, so no entry can be null. Recording `funcref` here conflated
 * the funcidx form with an explicitly-written `funcref` elemlist, and the two
 * are not interchangeable — elem.wast has `(elem (i32.const 0) $g)` against a
 * `(ref func)` table as VALID and `(elem (i32.const 0) funcref (ref.func 0))`
 * against the same table as INVALID, and they differ only in this.
 */
const FUNCIDX_ELEM_TYPE: ValueType = {
  kind: 'ref',
  heapType: { kind: 'name', name: 'func' },
  nullable: false,
};

/** Strip surrounding quotes and resolve escapes for a WAT string, returning text. */
function decodeStringText(raw: string): string {
  return TEXT_DECODER.decode(decodeStringToken(raw));
}

/**
 * Parse a NAT/INT token text to an integer (as bigint). Returns null on
 * failure.
 *
 * Handles the two things `BigInt()` alone does not:
 *
 * - **Digit-group separators** (`1_000_000`, `0xFF_FF`) are stripped. An
 *   earlier `replace('_', '')` removed only the FIRST underscore, so any
 *   literal with two or more separators threw → null → callers silently
 *   defaulted to index/value 0.
 * - **A sign combined with a radix prefix.** `BigInt('-0x10')` THROWS —
 *   JS accepts a sign only on decimal, and a radix prefix only unsigned.
 *   The old comment here claimed the opposite ("BigInt already understands
 *   the 0x/+/- prefixes"), so every negative hex/octal/binary literal became
 *   null: `(i32.const -0x7fffffff)` reported "expected i32 constant", which
 *   alone accounted for 16 spec-testsuite files.
 */
/**
 * Whether a float literal spells a FINITE value — a decimal, a hex float, or a
 * bare integer. `inf` / `-inf` / `nan` / `nan:0x…` name their values directly
 * and are always in range; only a finite form can OVERFLOW to infinity, which
 * the spec calls out of range rather than infinity.
 */
function isFiniteLiteralForm(lt: LiteralType): boolean {
  return lt !== LiteralType.Infinity && lt !== LiteralType.Nan;
}

/**
 * Whether a `v128.const` lane value fits a `bits`-wide integer lane.
 *
 * As for scalar constants, the legal span is the UNION of the signed and
 * unsigned ranges — `[-2^(b-1), 2^b)` — because the text format lets a lane be
 * written either way. Without the check `BigInt.asIntN` silently WRAPPED:
 * `(v128.const i8x16 -129 …)` became 127 and `256` became 0.
 */
function laneFits(n: bigint, bits: number): boolean {
  return n >= -(1n << BigInt(bits - 1)) && n < (1n << BigInt(bits));
}

function parseNatText(text: string): bigint | null {
  const t = text.replace(/_/g, '');
  // Split a leading sign off any radix-prefixed literal and re-apply it.
  const signed = /^([+-])(0[xXoObB][0-9a-fA-F]+)$/.exec(t);
  try {
    if (signed) {
      const magnitude = BigInt(signed[2]!);
      return signed[1] === '-' ? -magnitude : magnitude;
    }
    return BigInt(t);
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
  // INTENT OF EACH GROUP BELOW: every label sharing a `return N` asserts that
  // THAT instruction pops exactly N operands off the surrounding operand stack
  // — nothing about what it means, what section it belongs to, or how the spec
  // groups it. Adding a label to a group is that assertion, so check the
  // arity, not the neighbours' names.
  //
  // Getting this wrong is silent and expensive in both directions: too HIGH
  // and the parser eats an instruction that was not this one's operand
  // (T13.16 — `data.drop` sat here at 1 and deleted the preceding call, so
  // the module ran and returned a different answer); too LOW and the operands
  // become placeholders and the IR TREE is wrong even though the bytes come
  // out right (the `Quaternary` bug — which is what the bridge and `wasm2ts`
  // read). `tests/parser/instr_arity.test.ts` gates both: T13.8 differentials
  // folded against linear form, and T13.18 fails if any `isPlainInstr` token
  // has no entry here at all.
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
    case TokenType.Rethrow:
    case TokenType.StructNewDefault:
      // Genuinely zero-operand, and listed EXPLICITLY rather than left to fall
      // through: `default: return 0` is a silent landing pad, and it has
      // already cost one bug — `Quaternary` had no entry, so the linear form
      // popped nothing and all four operands became placeholders (right bytes,
      // wrong IR tree, which is what a bridge or `wasm2ts` reads). An
      // instruction that is absent from this table and one that is deliberately
      // zero must not look the same. `instr_arity.test.ts` now enumerates
      // `isPlainInstr` and fails if any member has no explicit entry here.
    case TokenType.DataDrop:
    case TokenType.ElemDrop:
      // `data.drop $x` / `elem.drop $x` are `[] -> []`: the segment is an
      // IMMEDIATE and nothing comes off the stack. They sat in the arity-1
      // group below, sharing a `case` label with genuine one-operand
      // instructions (`table.get`, `ref.test`, `memory.grow`), so
      // `parseFoldedInstr`'s deficit fill popped a value that belonged to the
      // surrounding scope — and `buildPlainExpr` has no slot to put it in, so
      // it was silently DISCARDED. `(call $f) (data.drop $d)` dropped the
      // call: valid wasm, no diagnostic, wrong program. Same shape as
      // T13.11's `table.get` inheriting `table.size`'s body, one table over.
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
    case TokenType.AnyConvertExtern:
    case TokenType.ExternConvertAny:
    case TokenType.I31Get:
    case TokenType.StructGet:
    case TokenType.ArrayNewDefault:
    case TokenType.ArrayLen:
    case TokenType.RefTest:
    case TokenType.RefCast:
    case TokenType.MemoryGrow:
    case TokenType.TableGet:
    case TokenType.ThrowRef:
    case TokenType.BrOnCast:
    case TokenType.BrOnCastFail:
      // br_on_cast's two reference types are IMMEDIATES, not operands — only
      // the ref being tested comes off the stack.
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
    case TokenType.AtomicStore:
    case TokenType.AtomicRmw:
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
      //
      // atomic_store / atomic_rmw: address + value, and atomic_rmw_cmpxchg
      // (below) is address + expected + replacement. All three were listed ONE
      // TOO HIGH, which is worse than it sounds: the linear-form parser pops
      // `nInputs` off the stack, so it took a placeholder into the ADDRESS slot
      // and left a real operand unconsumed — and a placeholder emits nothing
      // (T10.8), so the operand was simply GONE. `wasm2wat` emits linear form,
      // so a round trip through it silently rewrote every atomic store and RMW
      // into one with a missing operand.
      //
      // Invisible to all seven metrics: parse-clean sees only the parser,
      // round-trip over the spec testsuite never reaches these (its atomic
      // modules do not survive to that metric), and everything else starts
      // from bytes. Caught by a folded-vs-linear differential — write the
      // instruction folded, disassemble to linear, re-encode, compare
      // (`tests/parser/instr_arity.test.ts`).
      return 2;
    case TokenType.Select:
    case TokenType.MemoryFill:
    case TokenType.TableFill:
    case TokenType.AtomicWait:
    case TokenType.ArraySet:
      // atomic_wait: address + expected + timeout.
      return 3;
    case TokenType.AtomicRmwCmpxchg:
      // address + expected + replacement. This was 4, and `buildPlainExpr`
      // reads op0/op1/op2 — see the note on AtomicStore/AtomicRmw above.
      return 3;
    case TokenType.ArrayFill:
    case TokenType.ArrayInitData:
    case TokenType.ArrayInitElem:
      return 4;
    case TokenType.ArrayCopy:
      return 5;
    case TokenType.MemoryCopy:
    case TokenType.TableCopy:
    case TokenType.MemoryInit:
    case TokenType.TableInit:
      return 3;
    case TokenType.Ternary:
      return 3;
    case TokenType.Quaternary:
      // `i64.add128` / `i64.sub128` (wide arithmetic) read op0..op3 in
      // `buildPlainExpr`. Without an entry here the token fell to the
      // `default: return 0`, so the LINEAR form popped nothing and all four
      // operands became placeholders — the folded form was fine because it
      // uses its inline children. The bytes came out right anyway (pushStmt
      // flushes the operands in order and a placeholder emits nothing), but
      // the IR TREE was wrong, which is what a bridge or `wasm2ts` reads.
      return 4;
    case TokenType.BrTable:
      // `br_table` consumes exactly ONE stack operand: the i32 index (top of
      // stack). Any branch value carried to the target sits BELOW the index
      // and is emitted as a preceding statement, not folded into the
      // br_table node (which has a single `value` slot = the index). The
      // earlier "variable arity" classification drained the WHOLE surrounding
      // stack and then kept only operands[0] (the bottom), so a br_table whose
      // target carries a value emitted the branch value in place of the index
      // and dropped the index — V8 rejected the result. Matches the binary
      // reader, which pops one operand (the index) for br_table.
      return 1;
    // variable arity
    case TokenType.Return:
    case TokenType.Br:
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
  // Compare on the SUB-opcode. These were written as packed literals
  // (`0xfd17`), which silently stopped matching when the packing widened from
  // `prefix << 8` to `prefix << 16` — the check just returned false and every
  // replace_lane lost its scalar operand. Deriving the sub-opcode keeps this
  // independent of the packing width.
  if ((op >>> 16) !== PREFIX_SIMD) return false;
  switch (op & 0xffff) {
    case 0x17: // i8x16.replace_lane
    case 0x1a: // i16x8.replace_lane
    case 0x1c: // i32x4.replace_lane
    case 0x1e: // i64x2.replace_lane
    case 0x20: // f32x4.replace_lane
    case 0x22: // f64x2.replace_lane
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
    case TokenType.AnyConvertExtern:
    case TokenType.ExternConvertAny:
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
    // br_on_cast falls through with the ref still on the stack (narrowed one
    // way or the other depending on which spelling). Treating it as
    // value-producing lets a following instruction consume it as an operand,
    // which is exactly how the testsuite writes it:
    //   (block $l (result (ref i31))
    //     (br_on_cast $l anyref (ref i31) (table.get …))
    //     (return (i32.const -1)))
    //   (i31.get_u)          ;; <- consumes the fallthrough ref
    case TokenType.BrOnCast:
    case TokenType.BrOnCastFail:
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
  const result: Expr[] = [];
  for (let i = 0; i < n; i++) {
    result.unshift(ctx.stack.pop() ?? operandPlaceholder(fallback));
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
/** A function body whose parse is deferred; see `parsePendingBodies`. */
interface PendingBody {
  /** The function to fill in — `body` is mutated in place. */
  func: Func;
  /** Its local-name -> slot map, built while the header was parsed. */
  scope: Map<string, number>;
  /** Token index of the first body token. */
  pos: number;
  /**
   * Token index of the function's closing `)`.
   *
   * Deferring the body parse cost us the error path: `parsePendingBodies`
   * restores the cursor unconditionally, so before this field a body that
   * failed to parse simply left `body` short and NOTHING reported it. A typo'd
   * instruction — `(i32.addd …)` — was silently DELETED and `wat2wasm`
   * returned Ok. Parsing must now end exactly here, or the leftovers are
   * reported.
   */
  endPos: number;
}

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

  /**
   * The module currently being parsed, set for the duration of a function
   * body (same lifecycle as {@link localScope}). `parseBlockType` needs it to
   * register the synthesized function type that a multi-value block or a
   * block with params requires.
   */
  private currentModule: Module | null = null;

  /**
   * Function bodies whose parse has been DEFERRED to the end of the enclosing
   * module's field list. See {@link parsePendingBodies}.
   */
  private pendingBodies: PendingBody[] = [];

  /**
   * Type uses that carry an inline signature, checked once the whole field
   * list is known.
   *
   * `(type $t)` may refer FORWARD -- the type it names can be declared later
   * in the module -- so checking at the point of use saw an empty table and
   * skipped the comparison entirely. Deferring makes the restatement rule
   * (T12.7) apply to a forward reference too, and lets a use of a type index
   * that never exists be reported instead of ignored.
   */
  private pendingTypeUses: { typeVar: Var; sig: FuncSignature; loc: Location }[] = [];

  /**
   * Param count of every function in the index space of the module whose
   * deferred bodies are being parsed, by index and by name. Empty outside
   * {@link parsePendingBodies}, in which case every variable-arity opcode
   * falls back to draining the operand stack as before.
   */
  /**
   * True only while parsing an `assert_return` EXPECTED result.
   *
   * `nan:canonical` / `nan:arithmetic` are result PATTERNS ("any canonical
   * NaN"), not literals. `parseExpectedConst` handles the scalar spelling
   * itself, but a v128 result may carry them per LANE —
   * `(v128.const f32x4 nan:canonical …)` is legal and common in simd_f32x4
   * .wast — and those lanes go through the same `parseF32Bits` an instruction
   * const uses. So the rule cannot be global: the pattern is legal HERE and
   * malformed in a real `f32.const` (T12.6).
   */
  private allowNanPatterns = false;

  private funcParamCounts: number[] = [];
  private funcParamCountsByName = new Map<string, number>();

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

  /**
   * Guard a parse loop against making no progress.
   *
   * Several loops here are shaped `while (peek() !== Rpar && peek() !== Eof)`
   * with a body that delegates to a sub-parser. When that sub-parser reports
   * an error and returns WITHOUT consuming the offending token — which
   * `parseValueType` does — the loop spins forever, appending an error (and
   * often a list entry) every iteration until the process runs out of memory.
   * Real inputs hit this: `(module (type $s (struct (field i1` hung and then
   * OOM'd, found by mutation-fuzzing the spec testsuite.
   *
   * Call with the `this.pos` captured at the top of the iteration. Returns
   * true when nothing was consumed, having reported the offending token; the
   * caller must then `break`.
   */
  private noProgress(before: number, what: string): boolean {
    if (this.pos > before) return false;
    this.reportUnexpected(`unexpected ${tokenName(this.peek())} in ${what}`);
    return true;
  }

  /**
   * INTENT: turn "the parser stopped here" into "you misspelled an
   * instruction", which is what actually happened most of the time.
   *
   * The lexer emits `TokenType.Reserved` for a word it does not recognise, and
   * for no other reason — so a Reserved token is by definition not a valid
   * anything, and naming it is correct wherever it turns up. That makes this
   * safe to consult from any error site: it returns null unless the offending
   * token really is an unrecognised word.
   *
   * Looks one token past a `(` as well, because the folded form puts the
   * operator there: in `(i32.load32 …)` the token the parser is sitting on is
   * the paren, and reporting the paren tells the author nothing.
   *
   * The spec calls this an "unknown operator" and the testsuite asserts that
   * wording, so the phrase is load-bearing — see
   * `tests/parser/unknown_operator.test.ts`.
   */
  private unknownOperatorText(): string | null {
    const i = this.peek() === TokenType.Lpar ? this.pos + 1 : this.pos;
    const t = this.tokens[i];
    if (t === undefined || t.tokenType !== TokenType.Reserved) return null;
    return (t as StringToken).text;
  }

  /** Report `fallback`, unless an unknown operator explains it better. */
  private reportUnexpected(fallback: string): void {
    const op = this.unknownOperatorText();
    this.error(this.loc(), op === null ? fallback : `unknown operator "${op}"`);
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
    this.reportUnexpected(
      `expected ${tokenName(tt)}, got ${tokenName(this.peek())}`,
    );
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

  /**
   * The identifier text of a Var token, normalizing the QUOTED spelling.
   *
   * `id ::= '$' idchar+ | '$' '"' string '"'` — the quoted form is an
   * alternate spelling of the SAME identifier, with escapes resolved, so
   * `$"fh"` denotes exactly `$fh`. The lexer hands back the raw source slice
   * including the quotes, so the two compared unequal and every quoted
   * reference reported "undefined func".
   */
  private varTokenText(tok: StringToken): string {
    const t = tok.text;
    if (!t.startsWith('$"')) return t;
    return '$' + decodeStringText(t.slice(1));
  }

  parseVar(): Var | null {
    const tt = this.peek();
    if (tt === TokenType.Var) {
      const tok = this.consume() as StringToken;
      return varName(this.varTokenText(tok));
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

  /**
   * Read the var at the cursor WITHOUT consuming it or reporting an error.
   *
   * Used to learn a variable-arity opcode's arity from its immediate before
   * its operands are popped — in linear form the immediate follows the
   * opcode, so it is already in the token stream when the pop has to happen.
   */
  private peekVar(): Var | null {
    const savedPos = this.pos;
    const savedErrors = this.errors.length;
    const v = this.parseVar();
    this.pos = savedPos;
    this.errors.length = savedErrors;
    return v;
  }

  /**
   * Stack arity of a variable-arity opcode, resolved from its immediate.
   *
   * `instrInputCount` returns -1 for `call` because the arity is the CALLEE's
   * param count, which is not a property of the token. The parser used to
   * treat that as "consume the whole operand stack", which is wrong whenever
   * a value below the call's own arguments belongs to a later instruction:
   *
   *     i32.const 0        ;; the address for the i32.store below
   *     f64.const 5
   *     f64.const 3
   *     call $f            ;; takes TWO args, but swallowed all three
   *     i32.store          ;; ... so its address slot got a Nop placeholder
   *
   * The Nop is inert, so the module stays valid and the bug reads as
   * cosmetic — but the re-encode carries an extra `nop` byte, and every
   * further round trip adds another, so the encoding grows without bound
   * (T10.5). Our own `wasm2wat` output is linear form, which is why this
   * only ever showed up on a round trip.
   *
   * Returns -1 when the arity cannot be determined, which keeps the old
   * draining behaviour. That is why function bodies are parsed only after
   * the whole module field list is known — see {@link parsePendingBodies}.
   */
  private varArityForTok(tok: Token): number {
    const n = instrInputCountForTok(tok);
    if (n !== -1) return n;
    switch (tok.tokenType) {
      case TokenType.Call:
      case TokenType.ReturnCall: {
        const v = this.peekVar();
        if (v === null) return -1;
        const count = v.kind === 'index'
          ? this.funcParamCounts[v.value]
          : this.funcParamCountsByName.get(v.name);
        return count ?? -1;
      }
      case TokenType.ArrayNewFixed: {
        // `array.new_fixed $T N elem1 … elemN` carries its arity as the
        // second immediate, so no module context is needed. Draining instead
        // handed it whatever else was on the stack — V8 rejected the result
        // with `array.new_fixed[0] expected type f32, found local.get of type
        // i32` (T10.6).
        const savedPos = this.pos;
        const savedErrors = this.errors.length;
        this.parseVar();
        const n = this.parseNatOrInt();
        this.pos = savedPos;
        this.errors.length = savedErrors;
        return n === null || n < 0n || n > 0xffffffffn ? -1 : Number(n);
      }
      default:
        return -1;
    }
  }

  parseVarOpt(defaultVar: Var): Var {
    if (this.peekMatchVar()) {
      return this.parseVar() ?? defaultVar;
    }
    return defaultVar;
  }

  parseBindVarOpt(): string {
    if (this.peek() === TokenType.Var) {
      return this.varTokenText(this.consume() as StringToken);
    }
    return '';
  }

  /** Parse an optional `(type $name)` type annotation. Returns the var or null. */
  /**
   * The signature of an already-declared function type, by name or index.
   * Returns null for a forward reference (not yet in `module.types`), which
   * `synthesizeTypes` reconciles later.
   */
  private lookupFuncTypeEntry(module: Module, v: Var): FuncSignature | null {
    let entry;
    if (v.kind === 'index') entry = module.types[v.value];
    else entry = module.types.find((t) => t.name === v.name);
    if (entry === undefined || entry.kind !== 'func') return null;
    return entry.sig;
  }

  /**
   * Fold a `(type …)` type-use into an otherwise-empty inline signature.
   *
   * `(func $f (type $t) …)` with NO inline params/results takes its whole
   * signature from `$t`. Without this the item carried an empty signature:
   * the emitted type was `() -> ()` while the body pushed a value, and V8
   * rejected the module with "expected 0 elements on the stack". It also
   * matters BEFORE the body is parsed, because local slot numbering starts at
   * `sig.params.length`.
   *
   * Returns the {@link TypeUse} to record: `'resolved'` once the index is
   * settled (which makes it AUTHORITATIVE — `synthesizeTypes` must not
   * re-derive it, because several distinct types can share one signature),
   * the var itself when the referenced type does not exist yet, or null when
   * no type-use was written at all.
   */
  private settleTypeUse(
    module: Module,
    typeVar: Var | null,
    sig: FuncSignature,
  ): TypeUse | null {
    if (typeVar === null) return null;
    // A type-use WITH an inline signature still takes its INDEX from the
    // type-use; the inline part only RESTATES the signature, so it has to say
    // the same thing. `(func (type $sig) (result i32))` against
    // `(type $sig (func))` is malformed — we used to take the index and
    // discard the inline part unread, emitting a function whose declared
    // signature was neither of the two the source wrote.
    if (sig.params.length > 0 || sig.results.length > 0) {
      this.pendingTypeUses.push({ typeVar, sig, loc: this.loc() });
      return 'resolved';
    }
    const entry = this.lookupFuncTypeEntry(module, typeVar);
    if (entry === null) return typeVar;
    sig.params.push(...entry.params);
    sig.results.push(...entry.results);
    return 'resolved';
  }

  private parseTypeUseOpt(): Var | null {
    if (this.matchLpar(TokenType.Type)) {
      const v = this.parseVar();
      this.expect(TokenType.Rpar);
      return v;
    }
    return null;
  }

  /** Parse zero or more `(param ...)` groups and return types + name bindings. */
  private parseParams(paramTypes: ValueType[], bindings: Map<string, number>): Result {
    while (this.matchLpar(TokenType.Param)) {
      if (this.peek() === TokenType.Var) {
        const name = this.varTokenText(this.consume() as StringToken);
        const t = this.parseValueType();
        if (t === null) {
          this.expect(TokenType.Rpar);
          return Result.Error;
        }
        if (bindings.has(name)) this.error(this.loc(), `duplicate local ${name}`);
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
  private parseResults(resultTypes: ValueType[]): Result {
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
    const params: ValueType[] = [];
    const results: ValueType[] = [];
    const bindings = new Map<string, number>();
    this.parseParams(params, bindings);
    this.parseResults(results);
    return { sig: { params, results }, bindings };
  }

  /** Parse a value type token. Returns null on failure. */
  parseValueType(): ValueType | null {
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
    // `(ref H)` / `(ref null H)`. An ABSTRACT heap type collapses to its
    // matching nullable reference Type (one wire byte); a CONCRETE `$T` or
    // numeric index becomes a RefValueType carrying the heap type, which the
    // writer encodes as the 0x64 / 0x63 marker plus the heap type. This used
    // to coarsen every concrete typed ref to Type.StructRef, so the writer
    // emitted a structref byte and V8 rejected the module.
    if (tt === TokenType.Lpar && this.peek(1) === TokenType.Ref) {
      this.drop(); // (
      this.drop(); // ref
      const nullable = this.match(TokenType.Null);
      const ht = this.parseHeapTypeVar();
      if (ht === null) return null;
      this.expect(TokenType.Rpar);
      if (ht.kind === 'name') {
        const abstract_ = heapTypeNameToType(ht.name);
        // `(ref null func)` is exactly `funcref`; `(ref func)` is the
        // non-nullable form and still needs the two-part encoding.
        if (abstract_ !== null && nullable) return abstract_;
      }
      return { kind: 'ref', heapType: ht, nullable };
    }
    this.error(this.loc(), `expected value type, got ${tokenName(tt)}`);
    return null;
  }

  /** Parse a ref type: `ref null? funcref/externref/...` */
  private parseRefType(): Type | null {
    // consume 'ref'
    this.drop();
    // The flat `Type` enum can't carry nullability, so `(ref func)` and
    // `(ref null func)` coarsen to the same code (the typed-ref-IR-loose
    // limitation). Consume the optional `null` keyword either way — the old
    // `isNull ? Type.FuncRef : Type.FuncRef` ternaries implied it was honored.
    this.match(TokenType.Null);
    const tt = this.peek();
    if (tt === TokenType.Func) {
      this.drop();
      return Type.FuncRef;
    }
    if (tt === TokenType.Extern) {
      this.drop();
      return Type.ExternRef;
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
    // Abbreviated spelling: `ref.cast i31ref …` instead of
    // `ref.cast (ref null i31) …`. A bare `…ref` value type IS the nullable
    // reference type, so it maps to the heap type with nullable = true.
    // Only the parenthesized form was accepted, so every abbreviated
    // ref.cast / ref.test failed with "expected (, got VALUETYPE".
    if (this.peek() === TokenType.ValueType) {
      const tok = this.peekToken() as TypeToken;
      const name = typeToHeapTypeName(tok.valueType);
      if (name !== null) {
        this.consume();
        return { heapType: varName(name), nullable: true };
      }
    }
    if (this.expect(TokenType.Lpar) !== Result.Ok) return null;
    if (this.peek() !== TokenType.Ref) {
      this.error(loc, 'expected (ref ...) for heap-type immediate');
      return null;
    }
    this.drop(); // 'ref'
    const nullable = this.match(TokenType.Null);

    const heapType = this.parseHeapTypeVar();
    if (heapType === null) return null;
    if (this.expect(TokenType.Rpar) !== Result.Ok) return null;
    return { heapType, nullable };
  }

  /**
   * Parse a bare heap type — the immediate of `ref.null H` and the body of the
   * `(ref [null] H)` form consumed by {@link parseRefImmediate}.
   *
   * Accepts every abstract-heap-type keyword (`func` / `extern` / `exn` /
   * `any` / `eq` / `i31` / `struct` / `array` / `none` / `nofunc` /
   * `noextern`), the legacy `…ref` spellings the lexer classifies as
   * ValueType (`funcref` normalizes to `func`), a `$T` reference to a
   * user-defined type, or a numeric type index. Abstract keywords come back
   * as name-vars and are passed through by `resolveNames`; `$T` name-vars are
   * resolved there against the type scope.
   *
   * `struct` / `array` / `exn` / `func` / `extern` each have their own token
   * type (they double as composite-type and refkind keywords), which is why
   * this can't go through `parseValueType`.
   */
  private parseHeapTypeVar(): Var | null {
    const loc = this.loc();
    const tt = this.peek();
    switch (tt) {
      case TokenType.Var: {
        // `$T` — user-defined heap type; resolveNames maps it to an index.
        const tok = this.consume() as StringToken;
        return varName(this.varTokenText(tok));
      }
      case TokenType.Nat: {
        const tok = this.consume() as LiteralToken;
        const n = parseNatText(tok.literal.text);
        if (n === null) {
          this.error(tok.loc, `invalid heap type index: ${tok.literal.text}`);
          return null;
        }
        return varIndex(Number(n));
      }
      // The bare abstract heap keywords, which have their own token type so
      // they cannot slip into a value-type slot.
      case TokenType.HeapType: {
        const tok = this.consume() as TypeToken;
        const name = typeToHeapTypeName(tok.valueType);
        if (name === null) {
          this.error(tok.loc, 'unknown heap type');
          return null;
        }
        return varName(name);
      }
      // Bare keywords with dedicated token types — they double as
      // composite-type / refkind keywords, so they never reach ValueType.
      case TokenType.Func:
        this.drop();
        return varName('func');
      case TokenType.Extern:
        this.drop();
        return varName('extern');
      case TokenType.Exn:
        this.drop();
        return varName('exn');
      case TokenType.Struct:
        this.drop();
        return varName('struct');
      case TokenType.Array:
        this.drop();
        return varName('array');
      case TokenType.ValueType: {
        // `funcref` / `anyref` / `i31ref` / … — strip to the bare heap-type
        // keyword. Rejects numeric value types (`ref.null i32`).
        const tok = this.consume() as TypeToken;
        const name = typeToHeapTypeName(tok.valueType);
        if (name === null) {
          this.error(loc, `not a heap type: ${typeName(tok.valueType)}`);
          return null;
        }
        return varName(name);
      }
      default:
        this.error(loc, `expected heap type, got ${tokenName(tt)}`);
        return null;
    }
  }

  /** Parse limits: optional `i32`/`i64` index type, then `N` or `N M`, optionally `shared`. */
  parseLimits(): Limits | null {
    // Optional index type for the memory64 proposal: `(memory i64 N M)`.
    // Default i32. The earlier code matched TokenType.I64X2 — a SIMD shape
    // token that can never appear here — and always returned is64: false, so
    // `(memory i64 …)` silently lost its 64-bit flag.
    let is64 = false;
    if (this.peek() === TokenType.ValueType) {
      const vt = (this.peekToken() as TypeToken).valueType;
      if (vt === Type.I64) {
        this.consume();
        is64 = true;
      } else if (vt === Type.I32) {
        this.consume();
      }
    }
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
    // Kept as the EXACT bigint the source wrote. `Number(initN)` used to round
    // anything past 2^53, so a 64-bit limit at the top of its range arrived as
    // a different value than the one written (T13.2).
    const initial = initN;
    let max: bigint | undefined;
    if (this.peek() === TokenType.Nat || this.peek() === TokenType.Int) {
      const maxText = (this.consume() as LiteralToken).literal.text;
      const maxN = parseNatText(maxText);
      if (maxN !== null) max = maxN;
    }
    const shared = this.match(TokenType.Shared);
    // `(pagesize N)` trails the limits, AFTER `shared`. The keyword had a lexer
    // entry and `Limits` had a field, but nothing parsed it — so
    // `(memory 1 (pagesize 1))` failed with "expected ), got (".
    //
    // N is the size in BYTES and the IR holds its LOG2, so a value with no log2
    // — anything that is not a power of two — cannot be encoded at all and is
    // MALFORMED here. Whether an encodable size is a LEGAL one (only 1 and
    // 65536 are) is the validator's call: `(pagesize 3)` is bad text, while
    // `(pagesize 2)` is a well-formed module that is invalid. Answering both
    // here would answer one of them for the wrong reason.
    let pageSizeLog2: number | undefined;
    if (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.PageSize) {
      const psLoc = this.loc();
      this.drop();
      this.drop();
      const n = this.peek() === TokenType.Nat || this.peek() === TokenType.Int
        ? parseNatText((this.consume() as LiteralToken).literal.text)
        : null;
      if (n === null || n <= 0n || (n & (n - 1n)) !== 0n) {
        this.error(psLoc, `page size must be a power of two: ${n ?? '?'}`);
      } else {
        pageSizeLog2 = n.toString(2).length - 1;
      }
      this.expect(TokenType.Rpar);
    }
    if (pageSizeLog2 !== undefined) {
      return max !== undefined
        ? { initial, max, isShared: shared, is64, pageSizeLog2 }
        : { initial, isShared: shared, is64, pageSizeLog2 };
    }
    return max !== undefined
      ? { initial, max, isShared: shared, is64 }
      : { initial, isShared: shared, is64 };
  }

  /**
   * Parse a quoted string token and return its text content (without quotes).
   *
   * This is the NAME path — import module/field names, export names, custom
   * section ids. A wasm name must be valid UTF-8, so `"\80"` is a malformed
   * module rather than a character to repair. The lenient decoder silently
   * substituted U+FFFD, which produced a DIFFERENT, valid-looking name.
   *
   * Raw byte strings (data segments) go through `parseTextList` instead and
   * are deliberately NOT checked — `(data "\ff")` is perfectly legal.
   */
  parseQuotedText(): string | null {
    if (this.peek() !== TokenType.Text) {
      this.error(this.loc(), 'expected string');
      return null;
    }
    const tok = this.consume() as StringToken;
    const bytes = decodeStringToken(tok.text);
    try {
      return STRICT_NAME_DECODER.decode(bytes);
    } catch {
      this.error(tok.loc, 'malformed UTF-8 encoding');
      return decodeStringText(tok.text);
    }
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

  /**
   * Parse `align=N` if present. Returns 0 if not (caller uses natural align).
   *
   * `N` must be a POWER OF TWO — the text grammar says so, which makes anything
   * else MALFORMED rather than invalid. Without the check the value flowed into
   * a `log2` that FLOORS, so `align=3` silently became `align=2` and `align=7`
   * silently became the natural alignment. That is a changed module, not a
   * cosmetic difference: binaryen's optimizer reads the alignment as a hard
   * constraint (see the `naturalAlignForOpcode` note in design-decisions.md).
   *
   * Zero is rejected here too. It is not a power of two, and it would be
   * indistinguishable from the "no `align=` keyword given" sentinel this
   * function returns — so an explicit `align=0` silently meant "natural".
   *
   * The SIZE of the alignment is a separate, VALIDATION-time rule (`align`
   * must not exceed the operand's natural alignment); `align=8` on an
   * `i32.load` is well-formed and invalid, and is already rejected there.
   */
  private parseAlignOpt(): number {
    if (this.peek() === TokenType.AlignEqNat) {
      const loc = this.loc();
      const tok = this.consume() as StringToken;
      const n = parseNatText(tok.text);
      if (n === null) {
        this.error(loc, `malformed alignment: ${tok.text}`);
        return 0;
      }
      // Power-of-two test on the BigInt: a 2^32 alignment would overflow a
      // 32-bit bitwise check.
      if (n <= 0n || (n & (n - 1n)) !== 0n) {
        this.error(loc, `alignment must be a power of two: ${n}`);
        return 0;
      }
      return Number(n);
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
    // Nested `(module …)` fields recurse through here, so each field list
    // owns its own deferral queue.
    const savedPending = this.pendingBodies;
    this.pendingBodies = [];
    const savedTypeUses = this.pendingTypeUses;
    this.pendingTypeUses = [];

    // An import may not follow a DEFINITION of a function, table, memory,
    // global or tag. Imports occupy the low indices of each index space, so
    // accepting a late one and emitting it first silently RENUMBERS everything
    // the module already referred to: `(func $d) (import … (func $i)) (call 0)`
    // called `$d` in source order and `$i` after the reorder — valid wasm, V8
    // runs it, different answer (T12.2).
    let firstDefKind: string | null = null;
    const defCount = (): number =>
      module.funcs.length + module.tables.length + module.memories.length +
      module.globals.length + module.tags.length;

    while (this.peekIsModuleField()) {
      const loc = this.loc();
      const importsBefore = module.imports.length;
      const defsBefore = defCount();

      if (this.parseModuleField(module) !== Result.Ok) {
        this.synchronizeToModuleField();
        continue;
      }

      if (module.imports.length > importsBefore && firstDefKind !== null) {
        this.error(loc, `import after ${firstDefKind}`);
      }
      if (firstDefKind === null && defCount() > defsBefore) {
        firstDefKind = module.funcs.length > 0
          ? 'function'
          : module.tables.length > 0
          ? 'table'
          : module.memories.length > 0
          ? 'memory'
          : module.globals.length > 0
          ? 'global'
          : 'tag';
      }
    }

    const pending = this.pendingBodies;
    this.pendingBodies = savedPending;
    this.parsePendingBodies(pending, module);
    const typeUses = this.pendingTypeUses;
    this.pendingTypeUses = savedTypeUses;
    this.checkPendingTypeUses(typeUses, module);
    this.checkDuplicateIds(module);
  }

  /**
   * An inline signature beside a `(type …)` names a type that must EXIST and
   * must say the same thing.
   *
   * Deferred to here because a type use may refer forward; see
   * {@link pendingTypeUses}. A type use with no inline signature is NOT
   * checked -- `(func (type 4))` against a module with fewer types is
   * `assert_invalid`, not `assert_malformed`, and belongs to the validator.
   */
  private checkPendingTypeUses(
    uses: { typeVar: Var; sig: FuncSignature; loc: Location }[],
    module: Module,
  ): void {
    for (const u of uses) {
      const declared = this.lookupFuncTypeEntry(module, u.typeVar);
      if (declared === null) {
        this.error(u.loc, 'unknown type');
      } else if (!sigEquals(declared, u.sig)) {
        this.error(u.loc, 'inline function type does not match explicit type');
      }
    }
  }

  /**
   * An identifier may be bound ONCE per index space.
   *
   * Every lookup here resolves a name by SCANNING for the first match
   * (`module.types.find(t => t.name === …)`, and the same shape for funcs,
   * globals, tables, memories and tags), so a second binding of the same name
   * did not collide -- it was simply unreachable. The module still referred to
   * something, just never to the item the author wrote last, and nothing said
   * so.
   *
   * The index space spans IMPORTS AND DEFINITIONS together, which is why this
   * walks `module.imports` first: `(import "" "" (func $foo)) (func $foo)` is
   * as much a duplicate as two definitions.
   */
  private checkDuplicateIds(module: Module): void {
    const spaces = new Map<string, Set<string>>();
    const bind = (space: string, name: string, loc: Location): void => {
      if (name === '') return;
      let seen = spaces.get(space);
      if (seen === undefined) spaces.set(space, seen = new Set());
      if (seen.has(name)) this.error(loc, `duplicate ${space} ${name}`);
      else seen.add(name);
    };

    for (const imp of module.imports) {
      switch (imp.kind) {
        case ExternalKind.Func:
          bind('func', imp.func.name, imp.func.loc);
          break;
        case ExternalKind.Table:
          bind('table', imp.table.name, imp.table.loc);
          break;
        case ExternalKind.Memory:
          bind('memory', imp.memory.name, imp.memory.loc);
          break;
        case ExternalKind.Global:
          bind('global', imp.global.name, imp.global.loc);
          break;
        case ExternalKind.Tag:
          bind('tag', imp.tag.name, imp.tag.loc);
          break;
      }
    }
    for (const f of module.funcs) bind('func', f.name, f.loc);
    for (const t of module.tables) bind('table', t.name, t.loc);
    for (const mem of module.memories) bind('memory', mem.name, mem.loc);
    for (const g of module.globals) bind('global', g.name, g.loc);
    for (const tag of module.tags) bind('tag', tag.name, tag.loc);
    for (const t of module.types) bind('type', t.name, t.loc);
    for (const e of module.elemSegments) bind('elem', e.name, e.loc);
    for (const d of module.dataSegments) bind('data', d.name, d.loc);

    // Struct field names are scoped to their own type, not to the module.
    for (const t of module.types) {
      if (t.kind !== 'struct') continue;
      const seen = new Set<string>();
      for (const f of t.fields) {
        if (f.name === '') continue;
        if (seen.has(f.name)) this.error(t.loc, `duplicate field ${f.name}`);
        else seen.add(f.name);
      }
    }
  }

  /**
   * Parse the function bodies held back by {@link parseFuncModuleField}.
   *
   * Bodies are deferred so that a body sees every function's signature,
   * including functions declared LATER in the module. `varArityForTok` needs
   * the callee's param count to give `call` its real arity, and a forward
   * reference is not rare: 199 of the 270 modules in the wasmtk WASI corpus
   * contain at least one (487 calls against 5470 backward ones), so resolving
   * only what happened to be parsed already would have left most files still
   * differing on a round trip.
   *
   * The token stream is a random-access array, so deferring costs one
   * balanced-paren skip per function and a cursor assignment per body.
   *
   * Diagnostics from bodies are therefore appended AFTER those from later
   * module fields. Errors carry their own locations, so the ordering of the
   * list is presentation, not information.
   */
  private parsePendingBodies(pending: PendingBody[], module: Module): void {
    if (pending.length === 0) return;

    const savedPos = this.pos;
    const savedScope = this.localScope;
    const savedModule = this.currentModule;
    const savedCounts = this.funcParamCounts;
    const savedByName = this.funcParamCountsByName;

    // Function index space: imports first, then definitions — the same order
    // resolveNames binds it in.
    const counts: number[] = [];
    const byName = new Map<string, number>();
    const record = (name: string, n: number): void => {
      if (name) byName.set(name, n);
      counts.push(n);
    };
    for (const imp of module.imports) {
      if (imp.kind === ExternalKind.Func) record(imp.func.name, imp.func.sig.params.length);
    }
    for (const f of module.funcs) record(f.name, f.sig.params.length);
    this.funcParamCounts = counts;
    this.funcParamCountsByName = byName;

    for (const pb of pending) {
      this.pos = pb.pos;
      this.localScope = pb.scope;
      this.currentModule = module;
      this.parseInstrListInto(pb.func.body);
      if (this.pos !== pb.endPos) {
        // Unconsumed input between here and the function's `)`. The instr
        // loop stops at the first thing it cannot parse and `parseInstrList`
        // swallows the failure, so without this the leftovers vanish without
        // a word — an unknown or misspelled instruction compiled to an EMPTY
        // body and `wat2wasm` reported success.
        this.reportUnexpected(
          `unexpected ${tokenName(this.peek())} in function body`,
        );
      }
      checkLabelScopes(pb.func.body, (loc, msg) => this.error(loc, msg));
    }

    this.funcParamCounts = savedCounts;
    this.funcParamCountsByName = savedByName;
    this.currentModule = savedModule;
    this.localScope = savedScope;
    this.pos = savedPos;
  }

  /**
   * Advance past the remainder of the current parenthesised group, leaving
   * the cursor ON its closing `)`. Used to step over a deferred function
   * body; the body is linear or folded WAT, so only paren depth matters.
   */
  private skipToGroupClose(): void {
    let depth = 0;
    for (;;) {
      const tt = this.peek();
      if (tt === TokenType.Eof) return;
      if (tt === TokenType.Rpar) {
        if (depth === 0) return;
        depth--;
      } else if (tt === TokenType.Lpar) {
        depth++;
      }
      this.drop();
    }
  }

  private parseModuleField(module: Module): Result {
    const tt1 = this.peek(1);
    switch (tt1) {
      case TokenType.Type:
        return this.parseTypeModuleField(module);
      case TokenType.Rec:
        return this.parseRecModuleField(module);
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

  /**
   * Parse a `(rec (type …)*)` group.
   *
   * Every member lands in `module.types` as an ordinary entry — the type INDEX
   * space counts members, not groups — and the group is recorded as a
   * `recGroupSize` on its FIRST member so the binary writer can re-emit the
   * `0x4e` wrapper. An empty `(rec)` is legal and occupies a section slot
   * while consuming no indices, so size 0 is recorded rather than skipped.
   */
  private parseRecModuleField(module: Module): Result {
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Rec) !== Result.Ok) return Result.Error;
    const first = module.types.length;
    let count = 0;
    while (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.Type) {
      if (this.parseTypeModuleField(module) !== Result.Ok) return Result.Error;
      count++;
    }
    this.expect(TokenType.Rpar);
    const head = module.types[first];
    // An empty `(rec)` has no member to hang the marker on. It is legal but
    // contributes nothing to the type index space, so it is simply dropped —
    // re-emitting it would need a group representation that does not depend
    // on a member existing.
    if (head !== undefined) head.recGroupSize = count;
    return Result.Ok;
  }

  private parseTypeModuleField(module: Module): Result {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    if (this.expect(TokenType.Type) !== Result.Ok) return Result.Error;
    const name = this.parseBindVarOpt();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;

    // Optional `(sub final? $super*)` wrapper around the comptype. A BARE
    // comptype is the spec's shorthand for `sub final` with no supertypes, so
    // `sub` stays undefined in that case — the two encode differently.
    let sub: { final: boolean; supertypes: Var[] } | undefined;
    if (this.peek() === TokenType.Sub) {
      this.drop();
      const final = this.match(TokenType.Final);
      const supertypes: Var[] = [];
      while (this.peekMatchVar()) {
        const v = this.parseVar();
        if (v !== null) supertypes.push(v);
      }
      sub = { final, supertypes };
      if (this.expect(TokenType.Lpar) !== Result.Ok) return Result.Error;
    }

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
    if (sub !== undefined) {
      entry.sub = sub;
      this.expect(TokenType.Rpar); // closes the comptype
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
          const before = this.pos;
          const { mutable, type } = this.parseFieldType();
          // parseFieldType defaults to i32 rather than returning null, so a
          // bad token yields a field WITHOUT advancing — check position.
          if (this.noProgress(before, 'struct field list')) break;
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
  private parseFieldType(): { mutable: boolean; type: ValueType } {
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
      const typeUse = this.settleTypeUse(module, typeVar, sig);
      const func: Func = {
        name,
        loc,
        typeVar: typeVar ?? varIndex(0),
        ...(typeUse !== null ? { typeUse } : {}),
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
      const limits = this.parseLimits() ?? { initial: 0n, isShared: false, is64: false };
      const elemType = this.parseValueType() ?? Type.FuncRef;
      const table: Table = { name, loc, elemType, limits, init: [] };
      imp = { kind: ExternalKind.Table, module: moduleName, field: fieldName, table };
      module.imports.push(imp);
      module.numTableImports++;
    } else if (tt === TokenType.Memory) {
      this.drop();
      const name = this.parseBindVarOpt();
      const limits = this.parseLimits() ?? { initial: 0n, isShared: false, is64: false };
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
    // `(func $f (type $t) …)` with NO inline params/results takes its whole
    // signature from $t. Without this the func carried an empty signature: the
    // emitted type was `() -> ()` while the body pushed a value, and V8
    // rejected the module with "expected 0 elements on the stack". It also
    // matters BEFORE the body is parsed, because local slot numbering starts
    // at sig.params.length. Only the already-declared case can be resolved
    // here; a forward reference still falls back to synthesizeTypes.
    const typeUse = this.settleTypeUse(module, typeVar, sig);

    if (inlineImp !== null) {
      // This is an imported function declared as (func (import ...) ...)
      const func: Func = {
        name,
        loc,
        typeVar: typeVar ?? varIndex(0),
        ...(typeUse !== null ? { typeUse } : {}),
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
          const localName = this.varTokenText(nameTok);
          const t = this.parseValueType();
          if (t !== null) {
            // `nameTok.text` includes the leading `$` to match the param
            // binding convention from `parseParams`. Params and locals share
            // ONE index space, so a local may not reuse a param's name either.
            if (scope.has(localName)) this.error(nameTok.loc, `duplicate local ${localName}`);
            scope.set(localName, slot);
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

      // The body is parsed once the whole module field list is known, so
      // that `call` can be given the callee's real arity even when the
      // callee is declared later. See parsePendingBodies.
      const bodyPos = this.pos;
      this.skipToGroupClose();
      const bodyEnd = this.pos;
      const body: Expr[] = [];

      const func: Func = {
        name,
        loc,
        typeVar: typeVar ?? varIndex(0),
        ...(typeUse !== null ? { typeUse } : {}),
        sig,
        localDecls,
        body,
        tailcall: false,
      };
      module.funcs.push(func);
      this.pendingBodies.push({ func, scope, pos: bodyPos, endPos: bodyEnd });
    }

    this.expect(TokenType.Rpar);
    return Result.Ok;
  }

  private parseGlobalType(): { type: ValueType; isMut: boolean } {
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
      const limits = this.parseLimits() ?? { initial: 0n, isShared: false, is64: false };
      const memory: Memory = { name, loc, limits };
      const imp: Import = {
        kind: ExternalKind.Memory,
        module: inlineImp.moduleName,
        field: inlineImp.fieldName,
        memory,
      };
      module.imports.push(imp);
      module.numMemoryImports++;
    } else if (
      (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.Data) ||
      (this.peek() === TokenType.ValueType && this.peek(1) === TokenType.Lpar &&
        this.peek(2) === TokenType.Data)
    ) {
      // Inline data segment, optionally preceded by an index type:
      //   (memory (data "…"))
      //   (memory i64 (data "…"))
      // The index-type spelling used to fall through to parseLimits, which
      // demanded a numeric initial size and reported "expected limit initial
      // value".
      let is64 = false;
      if (this.peek() === TokenType.ValueType) {
        is64 = (this.peekToken() as TypeToken).valueType === Type.I64;
        this.consume();
      }
      this.drop();
      this.drop();
      const data = this.parseTextList();
      this.expect(TokenType.Rpar);
      const pages = Math.ceil(data.length / 65536);
      const limits: Limits = { initial: BigInt(pages), isShared: false, is64 };
      const memory: Memory = { name, loc, limits };
      module.memories.push(memory);
      // Add data segment at offset 0
      // A 64-bit memory needs an i64 offset — V8 rejects an i32.const offset
      // on a memory64 data segment.
      const offsetExpr: Expr = {
        kind: 'const',
        value: is64 ? constI64(0n) : constI32(0),
        loc,
      } as ConstExpr;
      module.dataSegments.push({
        name: '',
        kind: 'active',
        memoryVar: varIndex(memIdx),
        offset: [offsetExpr],
        data,
        loc,
      });
    } else {
      const limits = this.parseLimits() ?? { initial: 0n, isShared: false, is64: false };
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
      const limits = this.parseLimits() ?? { initial: 0n, isShared: false, is64: false };
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
      // A table definition has two shapes:
      //
      //   (table id? indextype? limits reftype elemexpr?)   -- limits form
      //   (table id? indextype? reftype (elem ...))         -- abbreviated
      //
      // `indextype` is `i32` / `i64` (the table64 proposal). It is NOT an
      // element type — those are always reference types — so a ValueType here
      // must be classified before anything else; `(table $t i64 30 30
      // funcref)` used to consume `i64` as the element type and then hit the
      // real one with "expected ), got ValueType". `parseLimits` consumes the
      // index type itself, so only the abbreviated form strips it here.
      const idxTok = this.peek() === TokenType.ValueType
        ? (this.peekToken() as TypeToken).valueType
        : null;
      const hasIndexType = idxTok === Type.I32 || idxTok === Type.I64;
      const afterIndex = hasIndexType ? this.peek(1) : this.peek();
      const isLimitsForm = afterIndex === TokenType.Nat || afterIndex === TokenType.Int;

      if (isLimitsForm) {
        const limits = this.parseLimits() ?? { initial: 0n, isShared: false, is64: false };
        const elemType = this.parseValueType() ?? Type.FuncRef;
        // Optional initializer expression: `(table $t 10 funcref (ref.null func))`
        // fills every slot with the given value.
        const init: Expr[] = [];
        if (this.peek() === TokenType.Lpar) {
          const ctx = newCtx();
          if (this.parseOneInstr(ctx) === Result.Ok) {
            flushStack(ctx);
            init.push(...ctx.stmts);
          }
        }
        module.tables.push({ name, loc, elemType, limits, init });
      } else {
        // Abbreviated form: reftype followed by an inline `(elem ...)`.
        let is64 = false;
        if (hasIndexType) {
          is64 = idxTok === Type.I64;
          this.consume();
        }
        const elemType = this.parseValueType() ?? Type.FuncRef;
        const inits: Expr[][] = [];
        if (this.matchLpar(TokenType.Elem)) {
          // Two elemlist spellings again: a bare funcidx list (`$f $g`) and
          // element EXPRESSIONS (`(ref.func $f) (ref.null func)`). Only the
          // funcidx list was accepted, so the expression form failed with
          // "expected ), got (".
          while (this.peekMatchVar() || this.peek() === TokenType.Lpar) {
            if (this.peekMatchVar()) {
              const v = this.parseVar();
              if (v !== null) inits.push([{ kind: 'ref.func', func: v, loc } as RefFuncExpr]);
              continue;
            }
            const ctx = newCtx();
            if (this.parseOneInstr(ctx) !== Result.Ok) break;
            flushStack(ctx);
            inits.push(ctx.stmts);
          }
          this.expect(TokenType.Rpar);
        }
        const limits: Limits = {
          initial: BigInt(inits.length),
          max: BigInt(inits.length),
          isShared: false,
          is64,
        };
        module.tables.push({ name, loc, elemType, limits, init: [] });
        const offsetExpr: Expr = {
          kind: 'const',
          value: is64 ? constI64(0n) : constI32(0),
          loc,
        } as ConstExpr;
        module.elemSegments.push({
          name: '',
          kind: 'active',
          tableVar: varIndex(tableIdx),
          offset: [offsetExpr],
          elemType,
          elemExprs: inits,
          loc,
        });
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
    // A module has AT MOST ONE start function. A second `(start …)` used to
    // overwrite the first, so the module ran a different function than the one
    // it names first and nothing said so.
    if (module.start !== undefined) this.error(this.loc(), 'multiple start sections');
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
    } else if (this.peek() === TokenType.Lpar) {
      // Bare inline offset expression. Any `(` still here is the offset —
      // `(memory …)` and `(offset …)` were handled above, and everything
      // after the offset is a Text chunk. The condition used to require
      // `(X.const …)` specifically, so `(data (global.get 0) "a")` — an
      // imported-global base, which the linking tests use throughout — fell
      // through and then failed on the data string. Same shape as the elem
      // bare-offset branch.
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
    let elemType: ValueType = FUNCIDX_ELEM_TYPE;
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
      this.peek(1) !== TokenType.Item &&
      this.peek(1) !== TokenType.Ref
    ) {
      // Bare offset expression: `(elem (i32.const 0) $f1 $f2)`.
      // The `(...)` after elem (when it's not `(table ...)`, `(offset ...)`,
      // or `(item ...)`) is a const expression giving the offset for an
      // active segment on table 0. wasmtk's wasic emits this shape
      // pervasively; previously the parser fell through all branches and
      // failed at "expected ), got (" inside the elem.
      //
      // `(ref …)` is excluded because it is a TYPE, not an instruction: it
      // opens the `elemlist ::= reftype elemexpr*` of a PASSIVE segment, as
      // in `(elem (ref func) (ref.func 0))`. Swallowing it as an offset made
      // the segment active with an EMPTY offset expression, which V8 rejected
      // with "expected 1 elements on the stack for constant expression".
      // Nothing is lost by the exclusion — an offset must be a constant
      // expression producing i32, and no instruction is spelled `(ref …)`.
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
      elemType = FUNCIDX_ELEM_TYPE;
      while (this.peekMatchVar()) {
        const v = this.parseVar();
        if (v !== null) inits.push([{ kind: 'ref.func', func: v, loc } as RefFuncExpr]);
      }
    } else if (
      this.peek() === TokenType.ValueType || this.peek() === TokenType.Ref ||
      (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.Ref)
    ) {
      // The element type may be the parenthesized typed-ref form
      // `(ref $t)` / `(ref null $t)`, which starts with `(` — the check used
      // to look only for a bare ValueType or the `ref` keyword, so
      // `(elem (table $t) (i32.const 1) (ref func) (ref.func $d))` failed.
      elemType = this.parseValueType() ?? Type.FuncRef;
      // `elemlist ::= reftype elemexpr*`, and `elemexpr` has two spellings:
      // the explicit `(item instr*)` form, and the abbreviation where a
      // single folded instruction IS the element expression —
      // `(elem (i32.const 0) funcref (ref.null func) (ref.func $f))`.
      // Only the `(item …)` form used to be accepted, so the abbreviation
      // failed with "expected ), got (" for every instruction (not just
      // `ref.null` — `ref.func` failed identically).
      while (this.peek() === TokenType.Lpar) {
        const itemExprs: Expr[] = [];
        if (this.matchLpar(TokenType.Item)) {
          this.parseInstrListInto(itemExprs);
          this.expect(TokenType.Rpar);
        } else {
          const ctx = newCtx();
          // parseOneInstr consumes nothing when the `(` doesn't open an
          // instruction, so bail out rather than spin — the trailing
          // expect(Rpar) below reports the real error.
          if (this.parseOneInstr(ctx) !== Result.Ok) break;
          flushStack(ctx);
          itemExprs.push(...ctx.stmts);
        }
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
    // A tag may name its signature with `(type $t)` instead of spelling it
    // inline: `(tag (export "e") (type $t))`. Adopt the referenced type's
    // signature, exactly as a function's type-use does; a forward reference
    // is left to synthesizeTypes.
    const typeVar = this.parseTypeUseOpt();
    const { sig } = this.parseFuncSignature();
    if (typeVar !== null && sig.params.length === 0 && sig.results.length === 0) {
      const entry = this.lookupFuncTypeEntry(module, typeVar);
      if (entry !== null) {
        sig.params.push(...entry.params);
        sig.results.push(...entry.results);
      }
    }
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
  private parseInstrList(ctx: ExprCtx): Result {
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

    // Resolve the arity while the cursor is still ON the immediate — by the
    // time the operand count is needed below, the sub-expression loop has
    // moved past it.
    const varArity = this.varArityForTok(tok);

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
    const nInputs = varArity;
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
      // The condition can span SEVERAL folded instructions, each consuming the
      // previous one's result: `(if (i32.const 1) (i32.eqz) (then …))`. Only
      // one was parsed, so the rest hit "expected ), got (". Keep folding
      // until `(then` / `(else`; the last value left is the condition.
      let cond: Expr | undefined;
      const condCtx = newCtx();
      while (
        this.peek() === TokenType.Lpar && this.peek(1) !== TokenType.Then &&
        this.peek(1) !== TokenType.Else &&
        (isPlainInstr(this.peek(1)) || isBlockInstr(this.peek(1)))
      ) {
        const before = this.pos;
        this.parseFoldedInstr(condCtx);
        if (this.pos === before) break; // nothing consumed — do not spin
      }
      if (condCtx.stmts.length > 0 || condCtx.stack.length > 0) {
        flushStack(condCtx);
        cond = condCtx.stmts[condCtx.stmts.length - 1] ?? condCtx.stack[0];
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

      const condExpr: Expr = cond ?? operandPlaceholder(loc);
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

  /**
   * Consume the OPTIONAL label a linear `end` or `else` may repeat, and check
   * that it MATCHES the one the block opened with.
   *
   * `block $a … end $l` is malformed, and so is `block … end $l` on an
   * unlabelled block. Both were `if (peek() === Var) this.drop()` — the
   * closing label was thrown away unread, so a typo'd or copy-pasted label
   * silently named a different block and the module still compiled.
   */
  private matchClosingLabel(label: string): void {
    if (this.peek() !== TokenType.Var) return;
    const tok = this.consume() as StringToken;
    const written = this.varTokenText(tok);
    if (written !== label) {
      this.error(
        tok.loc,
        `mismatching label: ${
          label === '' ? 'the block is unlabelled' : `expected ${label}`
        }, got ${written}`,
      );
    }
  }

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
      this.matchClosingLabel(label);
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
        this.matchClosingLabel(label);
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
      this.matchClosingLabel(label);

      const condExpr2: Expr = cond ?? operandPlaceholder(loc);
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
        this.matchClosingLabel(label);
      }
      const node: TryExpr = delegate === undefined
        ? { kind: 'try', label, blockType, body: bodyCtx.stmts, catches, loc }
        : { kind: 'try', label, blockType, body: bodyCtx.stmts, catches, delegate, loc };
      const hasValue = blockType.kind !== 'void';
      if (hasValue) ctx.stack.push(node);
      else pushStmt(ctx, node);
      return Result.Ok;
    }

    // TryTable, linear form:
    //   try_table $lbl (result T)? (catch $tag $target)* … body… end $lbl?
    //
    // The catch clauses are parenthesised IMMEDIATES and come before the
    // body, exactly as in the folded form — so this reads them with the same
    // `parseTryTableCatch`, and the two forms cannot drift apart.
    //
    // This used to skip the clauses AND the body to the matching `end`, and
    // build a plain `BlockExpr`. `parseInstrList` stops at the first
    // `(catch …)` because a catch clause is not an instruction, so the body
    // came out EMPTY and every catch edge was lost. Since our own `wasm2wat`
    // emits linear form, that made a round trip silently gut any module using
    // `try_table`: V8 rejected the result with "expected 1 elements on the
    // stack for fallthru, found 0" — the block's declared result had nothing
    // left to produce it (T10.6).
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
      this.expect(TokenType.End);
      this.matchClosingLabel(label);
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

    this.error(loc, 'unexpected block instr');
    return Result.Error;
  }

  private parseLinearPlainInstr(ctx: ExprCtx): Result {
    const loc = this.loc();
    const tok = this.consume();
    const tt = tok.tokenType;
    // `varArityForTok` resolves `call` against the callee's signature; the
    // -1 fallback (arity genuinely unknown) keeps the old drain.
    const nInputs = this.varArityForTok(tok);

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
    const op0 = (): Expr => operands[0] ?? operandPlaceholder(loc);
    const op1 = (): Expr => operands[1] ?? operandPlaceholder(loc);
    const op2 = (): Expr => operands[2] ?? operandPlaceholder(loc);
    const op3 = (): Expr => operands[3] ?? operandPlaceholder(loc);
    const op4 = (): Expr => operands[4] ?? operandPlaceholder(loc);

    switch (tt) {
      case TokenType.Unreachable:
        return { kind: 'unreachable', loc } as UnreachableExpr;
      case TokenType.Nop:
        return { kind: 'nop', loc } as NopExpr;
      case TokenType.Drop:
        return { kind: 'drop', value: op0(), loc } as DropExpr;
      case TokenType.Select: {
        // `select (result i32) (result)` — several result GROUPS, any of them
        // empty. Matching only one group left the rest unconsumed.
        const resultType: ValueType[] = [];
        while (this.matchLpar(TokenType.Result)) {
          while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
            const before = this.pos;
            const t = this.parseValueType();
            if (t !== null) resultType.push(t);
            if (this.noProgress(before, 'select result list')) break;
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
        // `br` is variable-arity: every operand is a carried value, in stack
        // order. Keeping only operands[0] dropped the rest for a multi-value
        // target — the same defect ReturnExpr.values fixed.
        return { kind: 'br', target: v, values: operands, loc } as BrExpr;
      }
      case TokenType.BrIf: {
        const v = this.parseVar();
        if (v === null) return null;
        // Stack order for `br_if` is `[value?] [cond]` — the i32 condition is
        // the TOP operand and the optional branch value (present only when the
        // target label carries a result) sits below it. The earlier code read
        // `cond` from the bottom (operands[0]) and `value` from the top
        // (operands[1]), swapping them: the encoder emitted `value; cond`
        // built from the wrong exprs, so `(br_if $l (local.get 0) (i32.const 1))`
        // branched with the condition instead of the value (and, with code
        // after the branch, produced a stack V8 rejected). `cond` is always
        // the last operand; `value` the one before it, when there is one.
        // In the linear form `operands` is padded to nInputs=2 with a leading
        // Nop when no value is on the stack, so a Nop in the value slot means
        // "no carried value" (a Nop can never be a real branch value).
        const cond = operands[operands.length - 1] ??
          operandPlaceholder(loc);
        // Everything below cond is a carried value, in stack order — a
        // multi-value target takes several. A padded Nop can never be a real
        // branch value (it produces nothing), so it drops out.
        const values = operands.slice(0, -1).filter((e) => e.kind !== 'nop');
        return { kind: 'br_if', target: v, cond, values, loc } as BrIfExpr;
      }
      case TokenType.BrOnNull:
      case TokenType.BrOnNonNull: {
        const v = this.parseVar();
        if (v === null) return null;
        // Stack order is `[t*] [ref]` — the tested ref is the TOP operand and
        // any values the target carries sit BELOW it, exactly as for `br_if`.
        // Taking op0() read the bottom operand as the ref, so
        // `(br_on_null $l (local.get $n) (local.get $r))` tested $n and
        // dropped $r entirely. A padded Nop can never be a real carried value,
        // so it drops out.
        const ref = operands[operands.length - 1] ?? operandPlaceholder(loc);
        const values = operands.slice(0, -1).filter((x) => x.kind !== 'nop');
        return {
          kind: tt === TokenType.BrOnNull ? 'br_on_null' : 'br_on_non_null',
          target: v,
          ref,
          values,
          loc,
        } as BrOnNullExpr | BrOnNonNullExpr;
      }
      case TokenType.BrOnCast:
      case TokenType.BrOnCastFail: {
        // `br_on_cast $l rt1 rt2` — a label followed by TWO reference types,
        // parsed with the same helper ref.cast / ref.test use, so both the
        // parenthesized `(ref null $T)` and the abbreviated `anyref` spelling
        // work here too.
        const v = this.parseVar();
        if (v === null) return null;
        const from = this.parseRefImmediate();
        if (from === null) return null;
        const to = this.parseRefImmediate();
        if (to === null) return null;
        return {
          kind: 'br_on_cast',
          onFail: tt === TokenType.BrOnCastFail,
          target: v,
          from,
          to,
          value: op0(),
          loc,
        } as BrOnCastExpr;
      }
      case TokenType.BrTable: {
        const targets: Var[] = [];
        while (this.peekMatchVar()) {
          const v = this.parseVar();
          if (v !== null) targets.push(v);
        }
        const defaultTarget = targets.pop() ?? varIndex(0);
        // The INDEX is the top operand; anything below it is carried to the
        // target. Taking op0() as the index put a carried value there and
        // dropped the real index whenever the folded form supplied both.
        const idx = operands.length > 0 ? operands[operands.length - 1]! : op0();
        const carried = operands.slice(0, -1).filter((x) => x.kind !== 'nop');
        return {
          kind: 'br_table',
          targets,
          defaultTarget,
          value: idx,
          values: carried,
          loc,
        } as BrTableExpr;
      }
      case TokenType.Call: {
        const v = this.parseVar();
        if (v === null) return null;
        return { kind: 'call', func: v, args: operands, loc } as CallExpr;
      }
      case TokenType.CallIndirect: {
        const tableVar = this.parseVarOpt(varIndex(0));
        const typeVar = this.parseTypeUseOpt();
        const { sig, bindings } = this.parseFuncSignature();
        // A param in a `call_indirect` type use may not be NAMED: there is no
        // body for the name to scope over. `parseFuncSignature` allows names
        // because a real `(func (param $x i32) …)` needs them.
        if (bindings.size > 0) {
          this.error(loc, 'unexpected token: a param in a type use may not be named');
        }
        if (typeVar !== null && (sig.params.length > 0 || sig.results.length > 0)) {
          this.pendingTypeUses.push({ typeVar, sig, loc });
        }
        const callee = operands[operands.length - 1] ?? operandPlaceholder(loc);
        const args = operands.slice(0, -1);
        // `call_indirect (param i32)` names its signature inline instead of
        // with a `(type …)`. That inline signature DEFINES a type entry, but
        // it cannot be interned here without pushing explicit `(type …)`
        // fields off the low indices — so it is deferred to synthesizeTypes.
        // Before this, `typeVar` silently stayed at index 0 and the call was
        // encoded against whatever type happened to be first.
        return {
          kind: 'call_indirect',
          ...{ typeUse: (typeVar === null ? 'inline' : 'resolved') as TypeUse },
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
        const callee = operands[operands.length - 1] ?? operandPlaceholder(loc);
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
        const { sig, bindings } = this.parseFuncSignature();
        // A param in a `call_indirect` type use may not be NAMED: there is no
        // body for the name to scope over. `parseFuncSignature` allows names
        // because a real `(func (param $x i32) …)` needs them.
        if (bindings.size > 0) {
          this.error(loc, 'unexpected token: a param in a type use may not be named');
        }
        if (typeVar !== null && (sig.params.length > 0 || sig.results.length > 0)) {
          this.pendingTypeUses.push({ typeVar, sig, loc });
        }
        const callee = operands[operands.length - 1] ?? operandPlaceholder(loc);
        const args = operands.slice(0, -1);
        // `call_indirect (param i32)` names its signature inline instead of
        // with a `(type …)`. That inline signature DEFINES a type entry, but
        // it cannot be interned here without pushing explicit `(type …)`
        // fields off the low indices — so it is deferred to synthesizeTypes.
        // Before this, `typeVar` silently stayed at index 0 and the call was
        // encoded against whatever type happened to be first.
        return {
          kind: 'return_call_indirect',
          ...{ typeUse: (typeVar === null ? 'inline' : 'resolved') as TypeUse },
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
        const callee = operands[operands.length - 1] ?? operandPlaceholder(loc);
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
        // Two spellings, and the one-var form names the DATA segment:
        //   memory.init $dataidx
        //   memory.init $memidx $dataidx
        // Parse segment-first and SWAP when a second var appears — the same
        // shape as table.init. The parenthesized `(memory $m) $data` form
        // puts the memory first and needs no swap.
        let segment: Var;
        let memidx: Var;
        if (this.peek() === TokenType.Lpar && this.peek(1) === TokenType.Memory) {
          memidx = this.parseMemidxOpt(loc);
          segment = this.parseVar() ?? varIndex(0);
        } else {
          segment = this.parseVarOpt(varIndex(0));
          memidx = varIndex(0);
          if (this.peekMatchVar()) {
            memidx = this.parseVarOpt(varIndex(0));
            [segment, memidx] = [memidx, segment];
          }
        }
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

      // Every `table.*` table index is OPTIONAL and defaults to table 0.
      // These used to call parseVar() unconditionally, which REPORTS an error
      // when the next token isn't a var — so the bare spellings the testsuite
      // uses throughout (`table.size`, `(table.fill (i32.const 0) …)`) all
      // failed even though the `?? varIndex(0)` fallback produced the right
      // index.
      case TokenType.TableGet: {
        const v = this.parseVarOpt(varIndex(0));
        return { kind: 'table.get', table: v, index: op0(), loc } as TableGetExpr;
      }
      case TokenType.TableSet: {
        const v = this.parseVarOpt(varIndex(0));
        return { kind: 'table.set', table: v, index: op0(), value: op1(), loc } as TableSetExpr;
      }
      case TokenType.TableGrow: {
        const v = this.parseVarOpt(varIndex(0));
        return {
          kind: 'table.grow',
          table: v,
          initValue: op0(),
          delta: op1(),
          loc,
        } as TableGrowExpr;
      }
      case TokenType.TableSize: {
        const v = this.parseVarOpt(varIndex(0));
        return { kind: 'table.size', table: v, loc } as TableSizeExpr;
      }
      case TokenType.TableFill: {
        const v = this.parseVarOpt(varIndex(0));
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
        const dst = this.parseVarOpt(varIndex(0));
        const src = this.parseVarOpt(varIndex(0));
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
        // Two spellings, and the one-var form names the ELEM segment:
        //   table.init $elemidx
        //   table.init $tableidx $elemidx
        // So parse segment-first and SWAP when a second var appears. The
        // earlier code read segment then table with no swap, silently
        // transposing the two indices for every two-var `table.init`.
        let segment = this.parseVarOpt(varIndex(0));
        let table = varIndex(0);
        if (this.peekMatchVar()) {
          table = this.parseVarOpt(varIndex(0));
          [segment, table] = [table, segment];
        }
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
        // `refType` is a HEAP type, not a value type: abstract keywords stay
        // as name-vars (the binary writer encodes them as the single negative
        // byte), `$T` resolves to a type index in resolveNames. The earlier
        // code funnelled it through parseValueType + a typeToName() that
        // collapsed everything except funcref/externref/exnref to "funcref",
        // and nothing ever resolved the resulting name-var — so every
        // `ref.null` failed to encode.
        const ht = this.parseHeapTypeVar();
        return { kind: 'ref.null', refType: ht ?? varName('func'), loc } as RefNullExpr;
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
      case TokenType.AnyConvertExtern:
        return { kind: 'any.convert_extern', value: op0(), loc } as ExternConvertExpr;
      case TokenType.ExternConvertAny:
        return { kind: 'extern.convert_any', value: op0(), loc } as ExternConvertExpr;
      case TokenType.I31Get: {
        // The lexer routes both `i31.get_s` (opcode 0x1d) and `i31.get_u`
        // (0x1e) to TokenType.I31Get, so the opcode immediate determines
        // the signedness.
        const op = (tok as OpcodeToken).opcode as unknown as number;
        const signed = (op & 0xffff) === GcOpcode.I31GetS;
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
      case TokenType.ArrayFill: {
        const typeVar = this.parseVar() ?? varIndex(0);
        return {
          kind: 'array.fill',
          typeVar,
          ref: op0(),
          offset: op1(),
          value: op2(),
          size: op3(),
          loc,
        } as ArrayFillExpr;
      }
      case TokenType.ArrayCopy: {
        // Two type immediates, DESTINATION first: `array.copy $dst $src`.
        const destTypeVar = this.parseVar() ?? varIndex(0);
        const srcTypeVar = this.parseVar() ?? varIndex(0);
        return {
          kind: 'array.copy',
          destTypeVar,
          srcTypeVar,
          destRef: op0(),
          destOffset: op1(),
          srcRef: op2(),
          srcOffset: op3(),
          size: op4(),
          loc,
        } as ArrayCopyExpr;
      }
      case TokenType.ArrayInitData:
      case TokenType.ArrayInitElem: {
        const typeVar = this.parseVar() ?? varIndex(0);
        const segment = this.parseVar() ?? varIndex(0);
        return {
          kind: tt === TokenType.ArrayInitData ? 'array.init_data' : 'array.init_elem',
          typeVar,
          segment,
          ref: op0(),
          destOffset: op1(),
          srcOffset: op2(),
          size: op3(),
          loc,
        } as ArrayInitSegmentExpr;
      }

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
        // `i8x16.shuffle` takes EXACTLY 16 lane indices, each an unsigned
        // byte. The loop used to skip any position whose token was not a
        // number, so a shuffle written with 15 lanes -- or with none at all --
        // silently got zeros for the rest; and `laneArr[i] = Number(n)` let a
        // Uint8Array store wrap -1 to 255 and 256 to 0.
        const laneArr = new Uint8Array(16);
        for (let i = 0; i < 16; i++) {
          if (this.peek() !== TokenType.Nat && this.peek() !== TokenType.Int) {
            this.error(this.loc(), `invalid lane length: expected 16 lane indices, got ${i}`);
            break;
          }
          const laneTok = this.consume() as LiteralToken;
          const n = this.peekWasSigned(laneTok) ? null : parseNatText(laneTok.literal.text);
          if (n === null || n < 0n || n > 0xffn) {
            this.error(laneTok.loc, `i8 constant out of range: ${laneTok.literal.text}`);
          } else {
            laneArr[i] = Number(n);
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
        const memidx = this.parseSimdLaneMemidxOpt(loc);
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
        const memidx = this.parseSimdLaneMemidxOpt(loc);
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
      // The spec accepts a 32-bit constant written as either signed or
      // unsigned, so the legal span is [-2^31, 2^32); anything else is
      // MALFORMED. `BigInt.asIntN` alone silently TRUNCATES —
      // `(i32.const 0x100000000)` became `i32.const 0`, which V8 accepts and
      // runs, so the program computed a different number with no diagnostic
      // anywhere (T12.1).
      if (n < -0x8000_0000n || n >= 0x1_0000_0000n) {
        this.error(loc, `i32 constant out of range: ${n}`);
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
      if (n < -0x8000_0000_0000_0000n || n >= 0x1_0000_0000_0000_0000n) {
        this.error(loc, `i64 constant out of range: ${n}`);
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
          if (!laneFits(n, 8)) {
            this.error(loc, `i8 constant out of range: ${n}`);
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
          if (!laneFits(n, 16)) {
            this.error(loc, `i16 constant out of range: ${n}`);
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
          if (!laneFits(n, 32)) {
            this.error(loc, `i32 constant out of range: ${n}`);
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
      const bits = parseF32LiteralBits(tok.literal);
      // A FINITE literal that rounds to infinity is out of range, not
      // infinity: `inf` has to be written as `inf`. Silently overflowing gave
      // `(f32.const 1e39)` the value `inf`, which V8 accepts and runs — a
      // different number with no diagnostic (T12.1).
      if (
        bits !== null && isFiniteLiteralForm(tok.literal.literalType) &&
        (bits & 0x7fffffff) === 0x7f800000
      ) {
        this.error(tok.loc, `f32 constant out of range: ${tok.literal.text}`);
        return null;
      }
      return bits;
    }
    if (tt === TokenType.Nat || tt === TokenType.Int) {
      // `f32.const 1` means float 1.0, not bit pattern 0x00000001 (which
      // would be the smallest positive subnormal). Convert the integer
      // value through IEEE 754 rounding to get the right bits.
      const tok = this.consume() as LiteralToken;
      const n = parseNatText(tok.literal.text);
      if (n === null) return null;
      const bits = f32ValueToBits(Number(n));
      if ((bits & 0x7fffffff) === 0x7f800000) {
        this.error(tok.loc, `f32 constant out of range: ${tok.literal.text}`);
        return null;
      }
      return bits;
    }
    if (tt === TokenType.NanArithmetic || tt === TokenType.NanCanonical) {
      this.drop();
      if (this.allowNanPatterns) return 0x7fc00000;
      // Not in a result position: a pattern is not a literal. This used to
      // return the canonical NaN bits silently (T12.6).
      this.error(this.loc(), 'unexpected token, expected an f32 literal');
      return null;
    }
    return null;
  }

  private parseF64Bits(): bigint | null {
    const tt = this.peek();
    if (tt === TokenType.Float) {
      const tok = this.consume() as LiteralToken;
      const bits = parseF64LiteralBits(tok.literal);
      // See parseF32Bits: a finite literal must not round to infinity.
      if (
        bits !== null && isFiniteLiteralForm(tok.literal.literalType) &&
        (bits & 0x7fffffffffffffffn) === 0x7ff0000000000000n
      ) {
        this.error(tok.loc, `f64 constant out of range: ${tok.literal.text}`);
        return null;
      }
      return bits;
    }
    if (tt === TokenType.Nat || tt === TokenType.Int) {
      // See parseF32Bits — integer literals are decimal float values, not
      // raw bit patterns. Without this conversion `f64.const 1` encoded as
      // bit pattern 0x0000000000000001 = 5e-324 (smallest subnormal).
      const tok = this.consume() as LiteralToken;
      const n = parseNatText(tok.literal.text);
      if (n === null) return null;
      const bits = f64ValueToBits(Number(n));
      if ((bits & 0x7fffffffffffffffn) === 0x7ff0000000000000n) {
        this.error(tok.loc, `f64 constant out of range: ${tok.literal.text}`);
        return null;
      }
      return bits;
    }
    if (tt === TokenType.NanArithmetic || tt === TokenType.NanCanonical) {
      this.drop();
      if (this.allowNanPatterns) return 0x7ff8000000000000n;
      // Not in a result position: a pattern is not a literal. This used to
      // return the canonical NaN bits silently (T12.6).
      this.error(this.loc(), 'unexpected token, expected an f64 literal');
      return null;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Block type parsing
  // -------------------------------------------------------------------------

  /**
   * Parse a block signature: `(type $t)? (param …)* (result …)*`.
   *
   * The single-result shorthand encodes as one value-type byte; ANY other
   * shape — multiple results, or any params — needs a function type index in
   * the blocktype slot. The old code had neither: params were not parsed at
   * all, and multiple results were silently truncated to the first
   * ("simplified: use first type"), so `(block (result i32 i32) …)` emitted a
   * single-result block and V8 rejected the function with "expected 1
   * elements on the stack for fallthru, found 2".
   */
  /**
   * Consume an inline `(param …)* (result …)*` that follows an explicit
   * `(type $t)` in a block signature. The type index is authoritative, so the
   * inline restatement carries no extra information — but it must still be
   * consumed or the caller trips over it.
   */
  /**
   * Parse the inline `(param …)* (result …)*` that may FOLLOW a `(type $t)`
   * in a block type use. Returns null when nothing was written.
   *
   * This used to SKIP the group without reading it, which lost three rules at
   * once: the order is fixed (`(result …)` then `(param …)` is malformed), a
   * param in a block type use may not be NAMED, and — at the call site — an
   * inline signature only RESTATES the referenced type, so it has to say the
   * same thing.
   */
  private parseInlineBlockSig(): FuncSignature | null {
    let written = false;
    const params: ValueType[] = [];
    const results: ValueType[] = [];
    while (this.peek() === TokenType.Lpar) {
      const next = this.peek(1);
      if (next !== TokenType.Param && next !== TokenType.Result) break;
      const loc = this.loc();
      this.drop();
      this.drop();
      const into = next === TokenType.Param ? params : results;
      if (next === TokenType.Param) {
        if (results.length > 0) this.error(loc, 'unexpected token: param after result');
        if (this.peek() === TokenType.Var) {
          this.error(this.loc(), 'unexpected token: a param in a block type may not be named');
          this.drop();
        }
      }
      written = true;
      while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
        const before = this.pos;
        const t = this.parseValueType();
        if (t !== null) into.push(t);
        if (this.noProgress(before, 'inline block signature')) break;
      }
      this.expect(TokenType.Rpar);
    }
    return written ? { params, results } : null;
  }

  private parseBlockType(): BlockType {
    // Explicit `(type $t)`. The grammar is `(type $t)? (param …)* (result …)*`
    // and BOTH may appear — `(block (type $sig) (result i32) …)` is legal, the
    // inline signature restating what `$sig` already says. Returning here
    // left the `(result …)` unconsumed and the block failed with
    // "expected ), got (". The type index wins; the inline part is consumed
    // and discarded.
    if (this.matchLpar(TokenType.Type)) {
      const v = this.parseVar();
      this.expect(TokenType.Rpar);
      const inline = this.parseInlineBlockSig();
      let typeIdx = -1;
      if (v !== null && v.kind === 'index') typeIdx = v.value;
      else if (v !== null && this.currentModule !== null) {
        typeIdx = this.currentModule.types.findIndex((t) => t.name === v.name);
      }
      if (inline !== null && v !== null) {
        this.pendingTypeUses.push({ typeVar: v, sig: inline, loc: this.loc() });
      }
      if (typeIdx >= 0) return { kind: 'func_type', typeIdx };
      return BLOCK_TYPE_VOID;
    }

    const params: ValueType[] = [];
    while (this.matchLpar(TokenType.Param)) {
      while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
        const before = this.pos;
        const t = this.parseValueType();
        if (t !== null) params.push(t);
        if (this.noProgress(before, 'block param list')) break;
      }
      this.expect(TokenType.Rpar);
    }

    const results: ValueType[] = [];
    while (this.matchLpar(TokenType.Result)) {
      while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) {
        const before = this.pos;
        const t = this.parseValueType();
        if (t !== null) results.push(t);
        if (this.noProgress(before, 'block result list')) break;
      }
      this.expect(TokenType.Rpar);
    }

    if (params.length === 0) {
      if (results.length === 0) return BLOCK_TYPE_VOID;
      if (results.length === 1) {
        // A single ABSTRACT result uses the compact one-byte blocktype; a
        // concrete typed ref cannot be spelled that way and needs the
        // interned function type like every other non-shorthand shape.
        const only = results[0]!;
        if (!isRefValueType(only)) return blockTypeValue(only);
      }
    }
    return { kind: 'func_type', typeIdx: this.internFuncType({ params, results }) };
  }

  /**
   * Find or append a function type matching `sig` and return its index.
   * Appending keeps every already-declared type at its existing index, and
   * `synthesizeTypes` reconciles whatever it adds afterwards.
   */
  private internFuncType(sig: FuncSignature): number {
    const m = this.currentModule;
    if (m === null) return 0;
    const existing = m.types.findIndex((t) => t.kind === 'func' && sigEquals(t.sig, sig));
    if (existing >= 0) return existing;
    m.types.push({ kind: 'func', name: '', sig, loc: this.loc() });
    return m.types.length - 1;
  }

  // -------------------------------------------------------------------------
  // Memory index parsing
  // -------------------------------------------------------------------------

  /**
   * Parse an optional memory index immediate, defaulting to memory 0.
   *
   * Two spellings: the parenthesized `(memory $m)` form, and the BARE var the
   * spec grammar actually uses on instructions — `i32.load $mem offset=0`,
   * `memory.size $mem`. Only the parenthesized form was accepted, so every
   * bare memory index failed with "expected ), got Var"; that alone accounted
   * for 33 spec-testsuite files.
   */
  private parseMemidxOpt(_loc: Location): Var {
    if (this.matchLpar(TokenType.Memory)) {
      const v = this.parseVar() ?? varIndex(0);
      this.expect(TokenType.Rpar);
      return v;
    }
    return this.parseVarOpt(varIndex(0));
  }

  /**
   * Parse the optional memory index of a SIMD lane load/store.
   *
   * `v128.load8_lane memarg laneidx` — the lane index is MANDATORY and comes
   * last, so a single bare integer is the LANE, not a memory index. Upstream
   * wabt disambiguates by lookahead and so do we: a bare Nat is only a memory
   * index when followed by `offset=`, `align=`, or a second Nat. Without this
   * the plain `(v128.load8_lane 3 …)` form silently reads lane 3 as memory 3.
   */
  private parseSimdLaneMemidxOpt(loc: Location): Var {
    if (this.peek() === TokenType.Nat) {
      const next = this.peek(1);
      if (
        next !== TokenType.OffsetEqNat && next !== TokenType.AlignEqNat &&
        next !== TokenType.Nat
      ) {
        return varIndex(0); // the lone integer is the lane index
      }
    }
    // `(memory $m)` and a bare `$name` are unambiguous — lane indices are
    // always numeric.
    return this.parseMemidxOpt(loc);
  }

  /**
   * Parse a SIMD lane-index immediate.
   *
   * The immediate is a single BYTE on the wire, so a value that does not fit
   * `u8` is MALFORMED — simd_lane.wast asserts exactly that, with the message
   * "i8 constant out of range", and separately asserts that 16..255 is
   * INVALID ("invalid lane index"). The two rules live in different layers:
   * fitting the byte is the parser's, being below the lane COUNT is the
   * validator's (T9.6), and 255 must reach the validator to be told apart
   * from 256.
   *
   * Unchecked, `Number(n)` handed the writer 256, which the byte encoding
   * truncated to lane 0 — a silently different program.
   */
  /** Did this numeric token carry an explicit sign? Lane indices may not. */
  private peekWasSigned(tok: LiteralToken): boolean {
    return tok.tokenType === TokenType.Int;
  }

  private parseSimdLane(): number {
    // A lane index is a `u32` in the text grammar, so it is a NAT: a SIGNED
    // spelling is not a small number, it is a different token. `+0x0f` and
    // `+3` were accepted and their sign dropped -- `TokenType.Int` is exactly
    // "this literal carried a sign".
    if (this.peek() === TokenType.Int) {
      this.error(this.loc(), 'unexpected token, a lane index may not be signed');
      this.drop();
      return 0;
    }
    if (this.peek() === TokenType.Nat) {
      const tok = this.consume() as LiteralToken;
      const n = parseNatText(tok.literal.text);
      if (n === null) {
        this.error(tok.loc, 'invalid SIMD lane index');
        return 0;
      }
      if (n < 0n || n > 0xffn) {
        this.error(tok.loc, `i8 constant out of range: ${n}`);
        return 0;
      }
      return Number(n);
    }
    // Every lane op REQUIRES its immediate. Returning 0 silently here made
    // `(i8x16.extract_lane_s (local.get 0) (v128.const …))` — which omits the
    // lane entirely — compile as lane 0 (T12.6).
    this.error(this.loc(), 'unexpected token, expected a lane index');
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
        // `(module instance $I $M)` instantiates an earlier
        // `(module definition $M …)`. It is a COMMAND, not a module, so it is
        // split off before parseScriptModule.
        if (this.peek(2) === TokenType.Instance) {
          const loc2 = this.loc();
          this.drop(); // (
          this.drop(); // module
          this.drop(); // instance
          const name = this.peek() === TokenType.Var
            ? this.varTokenText(this.consume() as StringToken)
            : null;
          const definition = this.parseVarOpt(varIndex(0));
          this.expect(TokenType.Rpar);
          return { kind: 'module_instance', name, definition, loc: loc2 };
        }
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
        // `(assert_trap (module …) "msg")`: the module is VALID and traps on
        // INSTANTIATION. Reporting it as `assert_invalid` asserted the
        // opposite — that it should fail validation.
        const sm = this.parseScriptModule();
        const text = this.parseQuotedText() ?? '';
        this.expect(TokenType.Rpar);
        if (sm === null) return null;
        return { kind: 'assert_trap_module', scriptModule: sm, text, loc };
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
    // `(module definition $M …)` puts the keyword BEFORE the bind var.
    const isDefinition = this.match(TokenType.Definition);
    const name = this.parseBindVarOpt() || null;

    if (this.match(TokenType.Bin)) {
      const data = this.parseTextList();
      this.expect(TokenType.Rpar);
      return { kind: 'binary', name, data, loc };
    }
    if (this.match(TokenType.Quote)) {
      // `(module quote "a" "b")` — the text pieces CONCATENATE, exactly as
      // they do for `(module binary …)` right above. This used to read a
      // single string and then choke on the second with "expected ), got
      // Text"; the testsuite splits quoted modules across one string per
      // line throughout.
      const source = TEXT_DECODER.decode(this.parseTextList());
      this.expect(TokenType.Rpar);
      return { kind: 'quote', name, source, loc };
    }

    const module = makeModule();
    module.name = name ?? '';
    this.parseModuleFieldList(module);
    this.expect(TokenType.Rpar);
    return { kind: isDefinition ? 'definition' : 'text', name, module, loc };
  }

  private parseAction(): WastAction | null {
    const loc = this.loc();
    if (this.expect(TokenType.Lpar) !== Result.Ok) return null;
    const tt = this.peek();

    if (tt === TokenType.Invoke) {
      this.drop();
      const name = this.peek() === TokenType.Var ? (this.consume() as StringToken).text : null;
      const field = this.parseQuotedText() ?? '';
      const args: WastArg[] = [];
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

  /**
   * Parse one `invoke` action argument: `(i32.const 42)`, `(ref.null extern)`,
   * `(ref.extern 0)`, `(ref.host 2)`, or `(ref.func)`.
   *
   * Only the `(X.const N)` form used to be accepted — every reference-valued
   * argument was rejected with "expected const instr", which skipped whole
   * testsuite files (`(invoke "init" (ref.extern 0))` and friends).
   */
  private parseConstExprArg(): WastArg | null {
    if (this.expect(TokenType.Lpar) !== Result.Ok) return null;

    if (this.peek() === TokenType.Const) {
      const tok = this.consume() as OpcodeToken;
      const c = this.parseConst(tok.opcode as unknown as number);
      this.expect(TokenType.Rpar);
      return c === null ? null : { kind: 'value', value: c };
    }

    const ref = this.parseRefValue();
    if (ref !== null) return ref;

    this.error(this.loc(), 'expected a const or reference value');
    // Skip to the closing rpar so the enclosing action can keep parsing.
    while (this.peek() !== TokenType.Rpar && this.peek() !== TokenType.Eof) this.drop();
    this.expect(TokenType.Rpar);
    return null;
  }

  /**
   * Parse the reference forms shared by `invoke` arguments and
   * `assert_return` results: `(ref.null [H])`, `(ref.extern [N])`,
   * `(ref.host [N])`, `(ref.func)`.
   *
   * Assumes the opening `(` is already consumed, and consumes the closing
   * `)`. Returns null WITHOUT consuming anything when the current token
   * isn't one of these, so callers can fall through to other forms.
   */
  private parseRefValue(): WastArg | null {
    const tt = this.peek();

    if (tt === TokenType.RefNull) {
      this.drop();
      // `(ref.null)` — bare form, "a null of any heap type". Valid wast
      // grammar (the sibling `(ref.func)` bare form was already accepted);
      // it used to hard-error with "expected heap type, got )". Reported by
      // OMITTING refType, so a runner can't silently compare against a type
      // the script never specified.
      if (this.peek() === TokenType.Rpar) {
        this.drop();
        return { kind: 'ref.null' };
      }
      // `(ref.null H)` — same heap-type grammar as the instruction form. This
      // shape stores a plain Type, so map the keyword back through the
      // canonical table (a user-defined `$T` has no Type entry — coarsen to
      // structref, matching the loose typed-ref IR).
      const ht = this.parseHeapTypeVar();
      const t = ht !== null && ht.kind === 'name'
        ? heapTypeNameToType(ht.name) ?? Type.StructRef
        : Type.StructRef;
      this.expect(TokenType.Rpar);
      return { kind: 'ref.null', refType: t };
    }

    if (tt === TokenType.RefFunc) {
      this.drop();
      this.expect(TokenType.Rpar);
      return { kind: 'ref.func' };
    }

    // `(ref.extern N)` / `(ref.host N)` name a specific host reference; the
    // bare forms match any. `'ref.extern'` was declared in the ExpectedConst
    // union all along but never parsed, and `ref.host` had no token at all.
    if (tt === TokenType.RefExtern || tt === TokenType.RefHost) {
      const kind = tt === TokenType.RefExtern ? 'ref.extern' as const : 'ref.host' as const;
      this.drop();
      if (this.peek() === TokenType.Rpar) {
        this.drop();
        return { kind };
      }
      const next = this.peek();
      if (next !== TokenType.Nat && next !== TokenType.Int) {
        this.error(this.loc(), `expected a host reference index, got ${tokenName(next)}`);
        return null;
      }
      const tok = this.consume() as LiteralToken;
      const n = parseNatText(tok.literal.text);
      if (n === null) {
        this.error(tok.loc, `invalid host reference index: ${tok.literal.text}`);
        return null;
      }
      this.expect(TokenType.Rpar);
      return { kind, value: Number(n) };
    }

    return null;
  }

  /** Parse an expected-return value like `(i32.const 42)` or `(f32.const nan:canonical)`. */
  private parseExpectedConst(): ExpectedConst | null {
    if (this.peek() !== TokenType.Lpar) return null;
    const savedPos = this.pos;
    this.drop(); // consume '('

    // Everything parsed from here is an EXPECTED RESULT, where the NaN
    // patterns are legal — including per-lane inside a v128 literal.
    const savedAllowNan = this.allowNanPatterns;
    this.allowNanPatterns = true;
    try {
      return this.parseExpectedConstInner(savedPos);
    } finally {
      this.allowNanPatterns = savedAllowNan;
    }
  }

  private parseExpectedConstInner(savedPos: number): ExpectedConst | null {
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

    if (this.peek() === TokenType.Either) {
      // `(either r1 r2 …)` — the result matches if ANY alternative matches.
      // The `either` token existed and upstream has ParseEither, but nothing
      // here ever consumed it, so every relaxed-SIMD file failed outright.
      this.drop();
      const alternatives: ExpectedConst[] = [];
      while (this.peek() === TokenType.Lpar) {
        const alt = this.parseExpectedConst();
        if (alt === null) break;
        alternatives.push(alt);
      }
      this.expect(TokenType.Rpar);
      return { kind: 'either', alternatives };
    }

    // Bare abstract-reference patterns — `(ref.any)`, `(ref.eq)`,
    // `(ref.i31)`, `(ref.struct)`, `(ref.array)`: "a reference whose heap
    // type is a subtype of H". Result-position only; each used to hard-error,
    // which skipped whole GC testsuite files.
    const bareRefKind = BARE_REF_RESULT_KINDS.get(this.peek());
    if (bareRefKind !== undefined) {
      this.drop();
      this.expect(TokenType.Rpar);
      return { kind: bareRefKind } as ExpectedConst;
    }

    // Forms an invoke argument can take too.
    const ref = this.parseRefValue();
    if (ref !== null) return ref;

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
      // Everything not spelled out above goes through the shared name map,
      // which now falls back to the enum member name.
      return tokenTypeName(tt);
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

/**
 * Bare abstract-reference result patterns → their {@link ExpectedConst} kind.
 *
 * Result-position only. `ref.eq` / `ref.i31` reuse their instruction token
 * types (those keywords double as instructions); `ref.any` / `ref.struct` /
 * `ref.array` have result-only tokens since no instruction shares the name.
 * `ref.func` / `ref.null` / `ref.extern` / `ref.host` are legal as invoke
 * arguments too, so they live in `parseRefValue` instead.
 */
const BARE_REF_RESULT_KINDS: ReadonlyMap<TokenType, ExpectedConst['kind']> = new Map([
  [TokenType.RefAny, 'ref.any' as const],
  [TokenType.RefEq, 'ref.eq' as const],
  [TokenType.RefI31, 'ref.i31' as const],
  [TokenType.RefStructKw, 'ref.struct' as const],
  [TokenType.RefArrayKw, 'ref.array' as const],
]);

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

// Module-level codec singleton, matching the convention in stream.ts /
// wat-writer.ts / binary-reader.ts / lexer-source.ts: TextDecoder is stateless
// under .decode(), so one shared instance avoids reallocating per call.
//
// `ignoreBOM: true` reads confusingly — it means "do NOT give U+FEFF its
// byte-order-mark meaning", i.e. keep it as an ordinary character. A wasm name
// is a byte string, and names.wast exports one that is exactly the UTF-8 BOM
// (EF BB BF) to check that. Stripping it produced a SECOND empty export name
// and V8 rejected the module for a duplicate export. Only the whole-file
// decode in lexer-source.ts should strip a leading BOM.
const TEXT_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

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
// The `p` exponent is OPTIONAL in the WAT grammar:
//   hexfloat ::= '0x' hexnum '.'? hexfrac? (('p'|'P') sign? num)?
// Requiring it rejected every exponent-less hex float — `0x1.5` and the
// `0x0123456789ABCDEF.` form (trailing dot, no fraction digits) that the SIMD
// testsuite files use throughout.
const HEX_FLOAT_PARSE_RE =
  /^([+-]?)0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?(?:[pP]([+-]?[0-9]+))?$/;

// Parse a WAT hex-float string directly to the IEEE-754 bit pattern of the
// target format (`mantBits` fraction bits, `expBits` exponent bits), rounding
// to nearest with ties to even.
//
// The earlier implementation reconstructed a JS `number` via
// `(int + frac) * 2^exp` and then let `Math.fround` / the f64 store round it.
// A JS double keeps only 52 fraction bits, so any mantissa bit past bit 52 of
// the literal was silently dropped BEFORE the format rounding ran. A value
// sitting just above an f32/f64 rounding midpoint (`0x1.00000100000000001p-50`)
// therefore collapsed onto the midpoint and then rounded the wrong way (to
// even, i.e. down) instead of up. This reconstructs the exact significand with
// BigInt and carries a sticky bit over every discarded low bit, so the final
// round-to-nearest-even sees the true value.
function hexFloatToBits(s: string, mantBits: number, expBits: number): bigint | null {
  const m = HEX_FLOAT_PARSE_RE.exec(s);
  if (!m) return null;
  const [, sign, intPart, fracPart, expStr] = m;

  const signShift = BigInt(mantBits + expBits);
  const signBit = (sign === '-' ? 1n : 0n) << signShift;
  const bias = (1n << BigInt(expBits - 1)) - 1n;
  const allOnesExp = (1n << BigInt(expBits)) - 1n;
  const mantMask = (1n << BigInt(mantBits)) - 1n;

  // Concatenate integer and fraction hex digits into one exact big integer.
  // `mant` is that integer; its least-significant bit has binary weight
  // 2^(exp - 4*fracLen).
  const fracLen = fracPart?.length ?? 0;
  const hexDigits = (intPart ?? '') + (fracPart ?? '');
  // With the exponent optional the pattern would otherwise match `0x.`.
  if (hexDigits.length === 0) return null;
  const mant = hexDigits.length > 0 ? BigInt('0x' + hexDigits) : 0n;
  // An absent `p` exponent means 2^0.
  const lowExp = (expStr === undefined ? 0 : parseInt(expStr, 10)) - 4 * fracLen;

  if (mant === 0n) return signBit; // signed zero

  // Unbiased exponent of the leading (most-significant set) bit.
  const msb = mant.toString(2).length - 1;
  let biased = BigInt(msb + lowExp) + bias;

  // Round `mant` (msb+1 significant bits) down to the target width, choosing
  // the drop count so the result has (mantBits+1) significant bits for a
  // normal number, or fewer for a subnormal.
  const subnormal = biased <= 0n;
  const dropBits = subnormal ? (1 - Number(bias) - mantBits) - lowExp : msb - mantBits;

  let keep: bigint;
  if (dropBits > 0) {
    const d = BigInt(dropBits);
    keep = mant >> d;
    const roundBit = (mant >> (d - 1n)) & 1n;
    const sticky = (mant & ((1n << (d - 1n)) - 1n)) !== 0n;
    // Round half to even: round up on a set round bit only when the discarded
    // remainder is nonzero (past the halfway point) or the kept LSB is odd.
    if (roundBit === 1n && (sticky || (keep & 1n) === 1n)) keep += 1n;
  } else {
    keep = mant << BigInt(-dropBits);
  }

  if (subnormal) {
    // `keep` counts subnormal ULPs. A round-up that reaches 2^mantBits carries
    // cleanly into the exponent field, yielding the smallest normal — so the
    // raw low bits ARE the exp+fraction encoding.
    return signBit | keep;
  }

  // Rounding a normal can overflow the significand to (mantBits+2) bits
  // (1.11…1 → 10.0…0); renormalize by bumping the exponent.
  if (keep > (mantMask | (1n << BigInt(mantBits)))) {
    keep >>= 1n;
    biased += 1n;
  }

  if (biased >= allOnesExp) return signBit | (allOnesExp << BigInt(mantBits)); // overflow → inf

  return signBit | (biased << BigInt(mantBits)) | (keep & mantMask);
}

const DEC_FLOAT_PARSE_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

// Compare the positive rational `num/den` against `2^e` (e may be negative)
// without ever shifting a BigInt by a negative amount. Returns -1 / 0 / 1.
function cmpRationalPow2(num: bigint, den: bigint, e: number): number {
  let a = num;
  let b = den;
  if (e >= 0) b = den << BigInt(e);
  else a = num << BigInt(-e);
  return a < b ? -1 : a > b ? 1 : 0;
}

// round(num/den * 2^s) with ties to even, for a positive rational and any
// integer shift `s`.
function roundScaledRational(num: bigint, den: bigint, s: number): bigint {
  let n = num;
  let d = den;
  if (s >= 0) n = num << BigInt(s);
  else d = den << BigInt(-s);
  let q = n / d;
  const twiceR = (n % d) * 2n;
  if (twiceR > d) q += 1n;
  else if (twiceR === d && (q & 1n) === 1n) q += 1n; // tie → even
  return q;
}

// Parse a DECIMAL float string directly to the IEEE-754 bit pattern of the
// target format, rounding to nearest with ties to even in a SINGLE step.
//
// `f32ValueToBits(parseFloat(text))` double-rounds: `parseFloat` first rounds
// the decimal to an f64, then the store rounds that f64 to f32. Inputs crafted
// to sit at an f32 midpoint (e.g. `8.8817847263968443574e-16`) round the wrong
// way under double rounding — the intermediate f64 lands exactly on an f32
// midpoint and ties-to-even sends it to a different neighbor than a correct
// single rounding of the original decimal would. (f64 is unaffected: JS
// `parseFloat` is a correctly-rounded decimal→f64, and storing that exact f64
// adds no second rounding — so only the f32 path needs this.) This evaluates
// the decimal as an exact BigInt rational `num/den` and rounds it once.
function decimalToBits(s: string, mantBits: number, expBits: number): bigint | null {
  const m = DEC_FLOAT_PARSE_RE.exec(s);
  if (!m) return null;
  const [, sign, intDigits, fracDigits, expStr] = m;

  const signBit = (sign === '-' ? 1n : 0n) << BigInt(mantBits + expBits);
  const bias = (1n << BigInt(expBits - 1)) - 1n;
  const allOnesExp = (1n << BigInt(expBits)) - 1n;
  const mantMask = (1n << BigInt(mantBits)) - 1n;

  const digits = (intDigits ?? '') + (fracDigits ?? '');
  if (digits.length === 0) return null; // not a number (e.g. bare exponent)
  const d = BigInt(digits);
  if (d === 0n) return signBit; // signed zero

  // value = d * 10^powTen  =  num / den (positive).
  const powTen = (expStr ? parseInt(expStr, 10) : 0) - (fracDigits?.length ?? 0);
  let num = d;
  let den = 1n;
  if (powTen >= 0) num *= 10n ** BigInt(powTen);
  else den = 10n ** BigInt(-powTen);

  // e = floor(log2(value)). Seed from the bit-length difference (within 1 of
  // the answer) then correct with exact comparisons.
  let e = num.toString(2).length - den.toString(2).length;
  while (cmpRationalPow2(num, den, e) < 0) e -= 1;
  while (cmpRationalPow2(num, den, e + 1) >= 0) e += 1;

  let biased = BigInt(e) + bias;

  if (biased <= 0n) {
    // Subnormal: round at the fixed subnormal grid (LSB weight
    // 2^(1 - bias - mantBits)). A round-up to 2^mantBits carries cleanly into
    // the exponent field, yielding the smallest normal.
    const q = roundScaledRational(num, den, mantBits + Number(bias) - 1);
    return signBit | q;
  }

  if (biased >= allOnesExp) return signBit | (allOnesExp << BigInt(mantBits)); // overflow → inf

  // Normal: keep (mantBits+1) significant bits. Rounding can carry the
  // significand to 2^(mantBits+1); renormalize by bumping the exponent.
  let q = roundScaledRational(num, den, mantBits - e);
  if (q > (mantMask | (1n << BigInt(mantBits)))) {
    q >>= 1n;
    biased += 1n;
  }
  if (biased >= allOnesExp) return signBit | (allOnesExp << BigInt(mantBits)); // rounded up → inf

  return signBit | (biased << BigInt(mantBits)) | (q & mantMask);
}

/**
 * Report every branch target in `body` that names a label not in scope.
 *
 * Labels are LEXICAL and fully known at parse time, so `(block $l (br $l0))` is
 * malformed, not merely invalid. `resolveNames` already reports it — but
 * `resolveNames` is a separate pass that `parseWatModule` does not run, so the
 * parser accepted it and only `wat2wasm` (which runs both) caught it. Checking
 * here puts the diagnostic where the spec puts it, and at the branch's own
 * location rather than the enclosing function's.
 *
 * This CHECKS ONLY: it resolves nothing and rewrites no `Var`, so the worst it
 * can do is report an error that is not there — which the parse-clean and
 * V8-valid metrics see immediately. Resolution stays in `resolveNames`, which
 * still owns it for IR that never came from text.
 *
 * Two scoping details, both of them past bugs (T7.6, T9.8, and the legacy-EH
 * work):
 *
 *   - a `try_table`'s CATCH targets resolve in the ENCLOSING scope, so they
 *     are checked before the `try_table`'s own label is pushed;
 *   - a legacy `try`'s `delegate` likewise targets the OUTER scope, so it is
 *     checked after the try's label is popped.
 *
 * `ExprVisitor` walks neither a catch clause's target nor a delegate, so both
 * are read here explicitly.
 */
function checkLabelScopes(
  body: Expr[],
  report: (loc: Location, msg: string) => void,
): void {
  const stack: string[] = [];
  const check = (v: Var, loc: Location): void => {
    // A numeric depth is a validator matter, not a naming one.
    if (v.kind !== 'name') return;
    if (!stack.includes(v.name)) report(loc, `undefined label ${v.name}`);
  };
  const push = (label: string): Result => {
    stack.push(label);
    return Result.Ok;
  };
  const pop = (): Result => {
    stack.pop();
    return Result.Ok;
  };
  const visitor = new ExprVisitor({
    beginBlockExpr: (e) => push(e.label),
    endBlockExpr: () => pop(),
    beginLoopExpr: (e) => push(e.label),
    endLoopExpr: () => pop(),
    beginIfExpr: (e) => push(e.label),
    endIfExpr: () => pop(),
    beginTryExpr: (e) => push(e.label),
    // `delegate` REPLACES `end` as the block terminator — it is a different
    // opcode, not an extra one — so `ExprVisitor` fires `onDelegateExpr`
    // INSTEAD of `endTryExpr`, exactly as the binary writer, the WAT writer
    // and the validator all rely on. This is therefore where the try's own
    // label leaves scope; popping in `endTryExpr` alone would leak it into
    // every branch that followed, and would never check the delegate at all.
    onDelegateExpr: (e) => {
      pop();
      // AFTER the pop: `try … delegate $l` names a target OUTSIDE the try.
      if (e.delegate !== undefined) check(e.delegate, e.loc);
      return Result.Ok;
    },
    endTryExpr: () => pop(),
    beginTryTableExpr: (e) => {
      // BEFORE the push, for the same reason in the other direction.
      for (const c of e.catches) check(c.target, c.loc);
      return push(e.label);
    },
    endTryTableExpr: () => pop(),
    onBrExpr: (e) => {
      check(e.target, e.loc);
      return Result.Ok;
    },
    onBrIfExpr: (e) => {
      check(e.target, e.loc);
      return Result.Ok;
    },
    onBrTableExpr: (e) => {
      for (const t of e.targets) check(t, e.loc);
      check(e.defaultTarget, e.loc);
      return Result.Ok;
    },
    onBrOnNullExpr: (e) => {
      check(e.target, e.loc);
      return Result.Ok;
    },
    onBrOnNonNullExpr: (e) => {
      check(e.target, e.loc);
      return Result.Ok;
    },
    onBrOnCastExpr: (e) => {
      check(e.target, e.loc);
      return Result.Ok;
    },
    onRethrowExpr: (e) => {
      check(e.depth, e.loc);
      return Result.Ok;
    },
  });
  visitor.visitExprList(body);
}

/**
 * Read the payload of an explicit NaN literal (`nan:0x7f_ffff`).
 *
 * Returns null when the payload is absent or malformed. The earlier code
 * called `BigInt(text.split(':')[1])` bare: it neither stripped the `_` digit
 * separators the surrounding hexfloat / float branches already strip, nor
 * guarded the call — so `nan:0x7f_ffff` escaped the parser as a raw
 * `SyntaxError` instead of being reported as a parse error (const.wast,
 * simd_splat.wast). A parser must never throw on malformed input.
 */
function parseNanPayload(text: string): bigint | null {
  const payloadStr = (text.split(':')[1] ?? '').replace(/_/g, '');
  // Only the `0x…` spelling is legal here, and BigInt would happily accept
  // other forms (decimal, `0b…`) that the grammar does not.
  if (!/^0[xX][0-9a-fA-F]+$/.test(payloadStr)) return null;
  try {
    return BigInt(payloadStr);
  } catch {
    return null;
  }
}

function parseF32LiteralBits(lit: { literalType: LiteralType; text: string }): number | null {
  const { literalType, text } = lit;
  if (literalType === LiteralType.Infinity) {
    return text.startsWith('-') ? 0xff800000 : 0x7f800000;
  }
  if (literalType === LiteralType.Nan) {
    if (text.includes(':')) {
      const payload = parseNanPayload(text);
      if (payload === null) return null;
      const sign = text.startsWith('-') ? 0x80000000 : 0;
      // f32 is 1 sign + 8 exponent + 23 mantissa, so the NaN payload field is
      // 23 bits, and a payload names a NaN only when it is in [1, 2^23-1].
      // Masking instead of checking made both ends silently WRONG: `nan:0x0`
      // has no bits set, so it emitted 0x7f800000 -- INFINITY, not a NaN at
      // all -- and an oversized payload was truncated into a different NaN.
      // (The mask was 0x3fffff for four releases, which lost `nan:0x400000`
      // the same way; `literal.ts`'s F32_MANTISSA_MASK already had it right.)
      if (payload <= 0n || payload > 0x7fffffn) return null;
      return sign | 0x7f800000 | Number(payload);
    }
    return text.startsWith('-') ? 0xffc00000 : 0x7fc00000;
  }
  if (literalType === LiteralType.Hexfloat) {
    const bits = hexFloatToBits(text.replace(/_/g, ''), 23, 8);
    return bits === null ? null : Number(bits);
  }
  if (literalType === LiteralType.Float) {
    // Exact single-rounding decimal→f32 (see decimalToBits). Fall back to the
    // double-rounding path only if the literal doesn't match the decimal
    // grammar, which shouldn't happen for a lexer-classified Float.
    const clean = text.replace(/_/g, '');
    const bits = decimalToBits(clean, 23, 8);
    return bits === null ? f32ValueToBits(parseFloat(clean)) : Number(bits);
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
      const raw = parseNanPayload(text);
      if (raw === null) return null;
      const sign = text.startsWith('-') ? 0x8000000000000000n : 0n;
      // As for f32: the payload field is 52 bits and 0 is not a NaN.
      if (raw <= 0n || raw > 0x000fffffffffffffn) return null;
      return sign | 0x7ff0000000000000n | raw;
    }
    return text.startsWith('-') ? 0xfff8000000000000n : 0x7ff8000000000000n;
  }
  if (literalType === LiteralType.Hexfloat) {
    return hexFloatToBits(text.replace(/_/g, ''), 52, 11);
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

/**
 * Run a lex+parse pass, converting any escaping exception into a parse error.
 *
 * Malformed input must always come back as an `errors` entry, never as a
 * thrown exception — a caller feeding the parser untrusted text should not
 * have to wrap it in try/catch. `nan:0x7f_ffff` used to escape as a raw
 * `SyntaxError` from `BigInt()`; that specific hole is fixed at the source
 * (see {@link parseNanPayload}), and this is the backstop for the next one.
 *
 * The backstop reports rather than swallows: an exception here is a wabt-ts
 * bug, so it surfaces as a loud "internal parser error" carrying the original
 * message, and the partial result built so far is returned alongside it.
 */
function runParse<T>(
  src: LexerSource | string,
  build: (parser: WastParser) => T,
  empty: () => T,
): { value: T; errors: WabtError[] } {
  const lexer = new WastLexer(src);
  let parser: WastParser | null = null;
  try {
    const tokens = lexer.tokenize();
    parser = new WastParser(tokens);
    const value = build(parser);
    return { value, errors: [...lexer.errors, ...parser.errors] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const errors: WabtError[] = [...lexer.errors, ...(parser?.errors ?? [])];
    addError(errors, unknownLocation(), `internal parser error: ${message}`);
    return { value: empty(), errors };
  }
}

/** Parse a WAT text file into a Module IR. */
export function parseWatModule(src: LexerSource | string): ParseWatResult {
  const { value: module, errors } = runParse(src, (p) => p.parseModule(), makeModule);
  return { module, errors };
}

/** Parse a WAST script file into a WastScript. */
export function parseWastScript(src: LexerSource | string): ParseWastResult {
  const { value: script, errors } = runParse(
    src,
    (p) => p.parseScript(),
    () => ({ filename: '', commands: [] }),
  );
  return { script, errors };
}
