// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/ir.h, src/ir.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * WebAssembly IR (Intermediate Representation).
 *
 * Expressions are tree-structured discriminated unions — each node embeds its
 * operand children as typed fields. This differs from the C++ wabt IR (which
 * uses a flat ExprList), but is required for WAT s-expression output and the
 * binaryen bridge (both are bottom-up / tree-order).
 *
 * The stack-to-tree conversion happens during binary decode: maintain an
 * operand stack, push leaf nodes, pop operands when building composites.
 */

import type { Location } from '../core/error.ts';
import { Type, typeName } from '../core/types.ts';
import type { Index } from '../core/types.ts';
import { BinarySection, ExternalKind } from '../core/binary.ts';
import { Opcode } from '../core/opcode.ts';

// Re-export so consumers can import everything from this module.
export { Opcode };
export { ExternalKind };
export { Type };

// ---------------------------------------------------------------------------
// Var — reference to a named or indexed entity
// ---------------------------------------------------------------------------

/** A reference to a function, local, global, label, etc. by index or name. */
export type Var =
  | { readonly kind: 'index'; readonly value: Index }
  | { readonly kind: 'name'; readonly name: string };

/** Construct an index-form {@link Var} (`0`, `1`, …) used after `resolveNames`. */
export function varIndex(value: Index): Var {
  return { kind: 'index', value };
}
/** Construct a name-form {@link Var} (`$foo`, `$bar`) as emitted by the WAT parser. */
export function varName(name: string): Var {
  return { kind: 'name', name };
}

/** Type guard for index-form {@link Var}. */
export function isVarIndex(v: Var): v is { kind: 'index'; value: Index } {
  return v.kind === 'index';
}
/** Type guard for name-form {@link Var}. */
export function isVarName(v: Var): v is { kind: 'name'; name: string } {
  return v.kind === 'name';
}

// ---------------------------------------------------------------------------
// Block type — the signature of a block/loop/if/try
// ---------------------------------------------------------------------------

/**
 * Block-type immediate for `block` / `loop` / `if` / `try` / `try_table`.
 * Either void, a single value type, or an index into the type section for
 * multi-value signatures (multi-value proposal).
 */
export type BlockType =
  | { readonly kind: 'void' }
  | { readonly kind: 'value'; readonly type: Type }
  | { readonly kind: 'func_type'; readonly typeIdx: Index };

/** Pre-built singleton for the void block type. */
export const BLOCK_TYPE_VOID: BlockType = { kind: 'void' };
/** Construct a single-value {@link BlockType}. */
export function blockTypeValue(type: Type): BlockType {
  return { kind: 'value', type };
}
/** Construct a multi-value {@link BlockType} referencing a type-section func entry. */
export function blockTypeFuncType(typeIdx: Index): BlockType {
  return { kind: 'func_type', typeIdx };
}

// ---------------------------------------------------------------------------
// Const — a constant value (leaf node, no children)
// ---------------------------------------------------------------------------

/**
 * The immediate payload of a `*.const` instruction. f32 / f64 store the
 * raw IEEE 754 bit pattern (not the float value) so NaN payloads survive
 * round-trips; v128 stores the literal 16 lane bytes.
 */
export type Const =
  | { readonly type: Type.I32; readonly value: number }
  | { readonly type: Type.I64; readonly value: bigint }
  | { readonly type: Type.F32; readonly bits: number } // raw IEEE 754 bit pattern
  | { readonly type: Type.F64; readonly bits: bigint } // raw IEEE 754 bit pattern
  | { readonly type: Type.V128; readonly bytes: Uint8Array }; // 16 raw bytes

/** Construct an i32 {@link Const}. */
export function constI32(value: number): Const {
  return { type: Type.I32, value };
}
/** Construct an i64 {@link Const}. */
export function constI64(value: bigint): Const {
  return { type: Type.I64, value };
}
/** Construct an f32 {@link Const} from its raw IEEE 754 bit pattern. */
export function constF32(bits: number): Const {
  return { type: Type.F32, bits };
}
/** Construct an f64 {@link Const} from its raw IEEE 754 bit pattern. */
export function constF64(bits: bigint): Const {
  return { type: Type.F64, bits };
}
/** Construct a v128 {@link Const} from its 16 lane bytes. */
export function constV128(bytes: Uint8Array): Const {
  return { type: Type.V128, bytes };
}

// ---------------------------------------------------------------------------
// Catch clauses — exception handling
// ---------------------------------------------------------------------------

/** The four `(catch …)` clause shapes in `try_table` (EH proposal). */
export enum CatchKind {
  /** `(catch $tag $label)` — branches to `$label` with the unpacked args. */
  Catch = 'catch',
  /** `(catch_ref $tag $label)` — branches with args + the exception ref. */
  CatchRef = 'catch_ref',
  /** `(catch_all $label)` — matches any tag, no args. */
  CatchAll = 'catch_all',
  /** `(catch_all_ref $label)` — matches any tag, branches with the exception ref. */
  CatchAllRef = 'catch_all_ref',
}

/** A catch clause in a try/catch block (legacy exception handling). */
export interface Catch {
  loc: Location;
  tag?: Var; // undefined → catch_all / catch_all_ref
  isRef: boolean; // catch_ref vs catch (or catch_all_ref vs catch_all)
  body: Expr[];
}

/** A catch entry in a try_table block (new exception handling proposal). */
export interface TableCatch {
  loc: Location;
  kind: CatchKind;
  tag?: Var; // undefined for CatchAll / CatchAllRef
  target: Var; // branch target label
}

// ---------------------------------------------------------------------------
// Expr — the full discriminated union for WebAssembly instructions
//
// Each node embeds its children as typed fields (tree form). The `loc` field
// is the byte offset or source position of the opcode.
// ---------------------------------------------------------------------------

// --- Control ---
/** `nop` (0x01) — single-byte no-op. */
export interface NopExpr {
  readonly kind: 'nop';
  readonly loc: Location;
}
/** `unreachable` (0x00) — traps unconditionally. Type-stack becomes polymorphic. */
export interface UnreachableExpr {
  readonly kind: 'unreachable';
  readonly loc: Location;
}
/** `return` — returns the function's result values from the type stack (multi-value capable). */
export interface ReturnExpr {
  readonly kind: 'return';
  /**
   * Operand expressions whose post-order evaluation pushes the return
   * values onto the operand stack before the `return` opcode fires.
   * Length must equal the enclosing function's result arity at runtime.
   * Single-value returns store one entry; void returns store none;
   * multi-value returns (`(func (result i32 i32) ...)`) store the full
   * tuple.
   */
  readonly values: Expr[];
  readonly loc: Location;
}
/** `drop` (0x1a) — discards the top stack value. */
export interface DropExpr {
  readonly kind: 'drop';
  readonly value: Expr;
  readonly loc: Location;
}
/** `select` (0x1b / 0x1c) — picks `val1` or `val2` based on a non-zero `cond`. */
export interface SelectExpr {
  readonly kind: 'select';
  readonly val1: Expr;
  readonly val2: Expr;
  readonly cond: Expr;
  readonly resultType: ValueType[];
  readonly loc: Location;
}

// --- Blocks ---
/** `block` (0x02) — a labeled scope; `br $label` exits forward. */
export interface BlockExpr {
  readonly kind: 'block';
  readonly label: string;
  readonly blockType: BlockType;
  readonly body: Expr[];
  readonly loc: Location;
}
/** `loop` (0x03) — a labeled scope; `br $label` jumps to the LOOP HEADER, not its exit. */
export interface LoopExpr {
  readonly kind: 'loop';
  readonly label: string;
  readonly blockType: BlockType;
  readonly body: Expr[];
  readonly loc: Location;
}
/** `if` / `else` / `end` (0x04 / 0x05) — conditional execution based on a non-zero `cond`. */
export interface IfExpr {
  readonly kind: 'if';
  readonly label: string;
  readonly blockType: BlockType;
  readonly cond: Expr;
  readonly then_: Expr[];
  readonly else_: Expr[];
  readonly loc: Location;
}

// --- Branches ---
/** `br $label` (0x0c) — unconditional branch to the label-stack `target`. */
export interface BrExpr {
  readonly kind: 'br';
  readonly target: Var;
  /**
   * Operands pushed before the branch, in stack order. A branch to a label
   * with N results carries N values; the earlier single `value?: Expr` slot
   * silently dropped all but the first, so
   * `(func (result i32 f64) (br 0 (i32.const 79) (f64.const 8)))` emitted one
   * operand and V8 rejected it. Same shape as {@link ReturnExpr.values}.
   */
  readonly values: Expr[];
  readonly loc: Location;
}
/** `br_if $label` (0x0d) — branches when `cond` is non-zero. */
export interface BrIfExpr {
  readonly kind: 'br_if';
  readonly target: Var;
  /**
   * The i32 condition. NOTE the operand order: cond is the TOP operand and
   * the carried values sit BELOW it, which is why it is read from the END of
   * the operand list (see the parser).
   */
  readonly cond: Expr;
  /** Values carried to the target label, in stack order. See {@link BrExpr.values}. */
  readonly values: Expr[];
  readonly loc: Location;
}
/** `br_table` (0x0e) — table-switch branch. The i32 value indexes `targets` (out-of-range → `defaultTarget`). */
export interface BrTableExpr {
  readonly kind: 'br_table';
  readonly targets: Var[];
  readonly defaultTarget: Var;
  /**
   * The i32 index selecting a target. It is the TOP operand — the values
   * carried to the target sit below it, exactly as with {@link BrIfExpr.cond}.
   */
  readonly value: Expr;
  /**
   * Values carried to the selected label, in stack order. In the LINEAR form
   * these are preceding statements, but the folded form
   * `(br_table $a $b (i32.const 7) (local.get 0))` supplies them inline, where
   * they used to be misread — the first child landed in the index slot and the
   * real index was dropped.
   */
  readonly values: Expr[];
  readonly loc: Location;
}
/** `br_on_null $label` (0xd5) — branches if the top ref is null (typed-refs proposal). */
export interface BrOnNullExpr {
  readonly kind: 'br_on_null';
  readonly target: Var;
  readonly value: Expr;
  readonly loc: Location;
}
/** `br_on_non_null $label` (0xd6) — branches if the top ref is non-null. */
export interface BrOnNonNullExpr {
  readonly kind: 'br_on_non_null';
  readonly target: Var;
  readonly value: Expr;
  readonly loc: Location;
}

// --- Constants ---
/** `*.const` (0x41 / 0x42 / 0x43 / 0x44 / 0xfd 0x0c) — pushes a literal value. */
export interface ConstExpr {
  readonly kind: 'const';
  readonly value: Const;
  readonly loc: Location;
}

// --- Locals ---
/** `local.get $var` (0x20) — pushes the value of a local. */
export interface LocalGetExpr {
  readonly kind: 'local.get';
  readonly var: Var;
  readonly loc: Location;
}
/** `local.set $var` (0x21) — pops the top stack value and writes it to a local. */
export interface LocalSetExpr {
  readonly kind: 'local.set';
  readonly var: Var;
  readonly value: Expr;
  readonly loc: Location;
}
/** `local.tee $var` (0x22) — like local.set but leaves the value on the stack. */
export interface LocalTeeExpr {
  readonly kind: 'local.tee';
  readonly var: Var;
  readonly value: Expr;
  readonly loc: Location;
}

// --- Globals ---
/** `global.get $var` (0x23) — pushes the value of a global. */
export interface GlobalGetExpr {
  readonly kind: 'global.get';
  readonly var: Var;
  readonly loc: Location;
}
/** `global.set $var` (0x24) — pops the top stack value and writes it to a (mutable) global. */
export interface GlobalSetExpr {
  readonly kind: 'global.set';
  readonly var: Var;
  readonly value: Expr;
  readonly loc: Location;
}

// --- Numeric: unary, binary, compare, convert ---
/** Single-operand numeric op (`i32.eqz`, `f32.abs`, etc.). `opcode` identifies the specific op. */
export interface UnaryExpr {
  readonly kind: 'unary';
  readonly opcode: Opcode;
  readonly operand: Expr;
  readonly loc: Location;
}
/** Two-operand numeric op (`i32.add`, `f64.mul`, etc.). `opcode` identifies the specific op. */
export interface BinaryExpr {
  readonly kind: 'binary';
  readonly opcode: Opcode;
  readonly left: Expr;
  readonly right: Expr;
  readonly loc: Location;
}
/** Two-operand comparison (`i32.eq`, `f64.lt`, etc.); pushes i32 (0 / 1). */
export interface CompareExpr {
  readonly kind: 'compare';
  readonly opcode: Opcode;
  readonly left: Expr;
  readonly right: Expr;
  readonly loc: Location;
}
/** Numeric type conversion (`i32.wrap_i64`, `f32.convert_i32_s`, etc.). */
export interface ConvertExpr {
  readonly kind: 'convert';
  readonly opcode: Opcode;
  readonly operand: Expr;
  readonly loc: Location;
}
/** Three-operand numeric op (rare; placeholder for relaxed-SIMD ternary instructions). */
export interface TernaryExpr {
  readonly kind: 'ternary';
  readonly opcode: Opcode;
  readonly a: Expr;
  readonly b: Expr;
  readonly c: Expr;
  readonly loc: Location;
}
/** Four-operand numeric op (rare; placeholder for relaxed-SIMD quaternary instructions). */
export interface QuaternaryExpr {
  readonly kind: 'quaternary';
  readonly opcode: Opcode;
  readonly a: Expr;
  readonly b: Expr;
  readonly c: Expr;
  readonly d: Expr;
  readonly loc: Location;
}

// --- Memory load/store ---
/** Linear-memory load (`i32.load`, `f64.load8_s`, etc.). `align = 0` means "use opcode-natural". */
export interface LoadExpr {
  readonly kind: 'load';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly loc: Location;
}
/** Linear-memory store (`i32.store`, `f32.store`, etc.). `align = 0` means "use opcode-natural". */
export interface StoreExpr {
  readonly kind: 'store';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly value: Expr;
  readonly loc: Location;
}

// --- Memory misc ---
/** `memory.size` (0x3f) — pushes the current memory size in pages. */
export interface MemorySizeExpr {
  readonly kind: 'memory.size';
  readonly memidx: Var;
  readonly loc: Location;
}
/** `memory.grow` (0x40) — grows memory by `delta` pages, returns the old size (or -1 on failure). */
export interface MemoryGrowExpr {
  readonly kind: 'memory.grow';
  readonly memidx: Var;
  readonly delta: Expr;
  readonly loc: Location;
}
/** `memory.copy` (0xfc 0x0a) — copies `size` bytes from `src` to `dest` within memory. */
export interface MemoryCopyExpr {
  readonly kind: 'memory.copy';
  readonly destMemidx: Var;
  readonly srcMemidx: Var;
  readonly dest: Expr;
  readonly src: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
/** `memory.fill` (0xfc 0x0b) — fills `size` bytes starting at `dest` with `value`. */
export interface MemoryFillExpr {
  readonly kind: 'memory.fill';
  readonly memidx: Var;
  readonly dest: Expr;
  readonly value: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
/** `memory.init $seg` (0xfc 0x08) — copies bytes from a passive data segment into memory. */
export interface MemoryInitExpr {
  readonly kind: 'memory.init';
  readonly segment: Var;
  readonly memidx: Var;
  readonly dest: Expr;
  readonly src: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
/** `data.drop $seg` (0xfc 0x09) — declares a passive data segment as no longer needed. */
export interface DataDropExpr {
  readonly kind: 'data.drop';
  readonly segment: Var;
  readonly loc: Location;
}

// --- Calls ---
/** `call $func` (0x10) — direct call to a function (index space includes imports + defined). */
export interface CallExpr {
  readonly kind: 'call';
  readonly func: Var;
  readonly args: Expr[];
  readonly loc: Location;
}
/** `call_indirect (type $T) [$table]` (0x11) — indirect call through a function table. */
export interface CallIndirectExpr {
  readonly kind: 'call_indirect';
  readonly sig: FuncSignature;
  readonly typeVar: Var;
  readonly table: Var;
  readonly args: Expr[];
  readonly callee: Expr;
  readonly loc: Location;
}
/** `call_ref $type` (0x14) — typed-function-references proposal: calls a `(ref $T)` value. */
export interface CallRefExpr {
  readonly kind: 'call_ref';
  readonly sigType: Var;
  readonly args: Expr[];
  readonly callee: Expr;
  readonly loc: Location;
}
/** `return_call $func` (0x12) — tail-call proposal: like `call` but replaces the current frame. */
export interface ReturnCallExpr {
  readonly kind: 'return_call';
  readonly func: Var;
  readonly args: Expr[];
  readonly loc: Location;
}
/** `return_call_indirect` (0x13) — tail-call proposal: like `call_indirect` but tail-position. */
export interface ReturnCallIndirectExpr {
  readonly kind: 'return_call_indirect';
  readonly sig: FuncSignature;
  readonly typeVar: Var;
  readonly table: Var;
  readonly args: Expr[];
  readonly callee: Expr;
  readonly loc: Location;
}
/** `return_call_ref $type` (0x15) — tail-call proposal: like `call_ref` but tail-position. */
export interface ReturnCallRefExpr {
  readonly kind: 'return_call_ref';
  readonly sigType: Var;
  readonly args: Expr[];
  readonly callee: Expr;
  readonly loc: Location;
}

// --- Ref types ---
/** `ref.null funcref|externref|…` (0xd0) — pushes a null ref of the given type. */
export interface RefNullExpr {
  readonly kind: 'ref.null';
  readonly refType: Var;
  readonly loc: Location;
}
/** `ref.is_null` (0xd1) — pops a ref, pushes i32 (1 = null, 0 otherwise). */
export interface RefIsNullExpr {
  readonly kind: 'ref.is_null';
  readonly value: Expr;
  readonly loc: Location;
}
/** `ref.func $f` (0xd2) — pushes a funcref to the named function (must be declared in elem or export). */
export interface RefFuncExpr {
  readonly kind: 'ref.func';
  readonly func: Var;
  readonly loc: Location;
}
/** `ref.as_non_null` (0xd4) — converts nullable ref to non-null (traps on null). */
export interface RefAsNonNullExpr {
  readonly kind: 'ref.as_non_null';
  readonly value: Expr;
  readonly loc: Location;
}

// --- GC reference ops (GC proposal) ---
/** `ref.eq` — compares two `eqref`-compatible references for identity. */
export interface RefEqExpr {
  readonly kind: 'ref.eq';
  readonly left: Expr;
  readonly right: Expr;
  readonly loc: Location;
}
/** `ref.i31` — boxes an i32 value into an `i31ref`. */
export interface RefI31Expr {
  readonly kind: 'ref.i31';
  readonly value: Expr;
  readonly loc: Location;
}
/**
 * `any.convert_extern` (0xfb 0x1a) / `extern.convert_any` (0xfb 0x1b) — the GC
 * proposal's conversions between the `extern` and `any` hierarchies. One
 * operand, no immediates.
 */
export interface ExternConvertExpr {
  readonly kind: 'any.convert_extern' | 'extern.convert_any';
  readonly value: Expr;
  readonly loc: Location;
}
/** `i31.get_s` / `i31.get_u` — unboxes an `i31ref` to i32 (sign- or zero-extended). */
export interface I31GetExpr {
  readonly kind: 'i31.get';
  readonly i31: Expr;
  /** True for `i31.get_s` (sign-extended), false for `i31.get_u` (zero-extended). */
  readonly signed: boolean;
  readonly loc: Location;
}

// --- GC struct ops ---
/** `struct.new $type` — pops one value per field, pushes (ref $type). */
export interface StructNewExpr {
  readonly kind: 'struct.new';
  readonly typeVar: Var;
  readonly operands: Expr[];
  readonly loc: Location;
}
/** `struct.new_default $type` — pushes a (ref $type) with default field values. */
export interface StructNewDefaultExpr {
  readonly kind: 'struct.new_default';
  readonly typeVar: Var;
  readonly loc: Location;
}
/**
 * `struct.get $type $field` (and signed/unsigned variants for packed fields).
 * Pops a `(ref null $type)`, pushes the field's value.
 */
export interface StructGetExpr {
  readonly kind: 'struct.get';
  readonly typeVar: Var;
  readonly fieldVar: Var;
  readonly ref: Expr;
  /**
   * Signedness extension for i8/i16 packed fields. `undefined` for `struct.get`
   * (unpacked field); `true` for `struct.get_s`; `false` for `struct.get_u`.
   */
  readonly signed?: boolean;
  readonly loc: Location;
}
/** `struct.set $type $field` — pops ref + value, no result. */
export interface StructSetExpr {
  readonly kind: 'struct.set';
  readonly typeVar: Var;
  readonly fieldVar: Var;
  readonly ref: Expr;
  readonly value: Expr;
  readonly loc: Location;
}

// --- GC array ops ---
/** `array.new $T` — pops init value + length (i32), pushes (ref $T). */
export interface ArrayNewExpr {
  readonly kind: 'array.new';
  readonly typeVar: Var;
  readonly init: Expr;
  readonly length: Expr;
  readonly loc: Location;
}
/** `array.new_default $T` — pops length (i32), pushes (ref $T) zero-filled. */
export interface ArrayNewDefaultExpr {
  readonly kind: 'array.new_default';
  readonly typeVar: Var;
  readonly length: Expr;
  readonly loc: Location;
}
/** `array.new_fixed $T N` — pops N element values, pushes (ref $T). */
export interface ArrayNewFixedExpr {
  readonly kind: 'array.new_fixed';
  readonly typeVar: Var;
  readonly operands: Expr[];
  readonly loc: Location;
}
/**
 * `array.new_data $T $data` — pops offset (i32) + length (i32), pushes (ref $T)
 * initialized from the named data segment.
 */
export interface ArrayNewDataExpr {
  readonly kind: 'array.new_data';
  readonly typeVar: Var;
  readonly dataVar: Var;
  readonly offset: Expr;
  readonly length: Expr;
  readonly loc: Location;
}
/**
 * `array.new_elem $T $elem` — pops offset (i32) + length (i32), pushes (ref $T)
 * initialized from the named element segment.
 */
export interface ArrayNewElemExpr {
  readonly kind: 'array.new_elem';
  readonly typeVar: Var;
  readonly elemVar: Var;
  readonly offset: Expr;
  readonly length: Expr;
  readonly loc: Location;
}
/**
 * `array.get $T` (and signed/unsigned variants for packed element types).
 * Pops (ref $T) + i32 index, pushes element value.
 */
export interface ArrayGetExpr {
  readonly kind: 'array.get';
  readonly typeVar: Var;
  readonly ref: Expr;
  readonly index: Expr;
  /** Signedness for i8/i16 packed element types. Undefined for unpacked. */
  readonly signed?: boolean;
  readonly loc: Location;
}
/** `array.set $T` — pops (ref $T) + i32 index + element value, no result. */
export interface ArraySetExpr {
  readonly kind: 'array.set';
  readonly typeVar: Var;
  readonly ref: Expr;
  readonly index: Expr;
  readonly value: Expr;
  readonly loc: Location;
}
/**
 * `array.fill $t` (0xfb 0x10) — pops (ref null $t), i32 offset, field value,
 * i32 size; fills the range with the value.
 */
export interface ArrayFillExpr {
  readonly kind: 'array.fill';
  readonly typeVar: Var;
  readonly ref: Expr;
  readonly offset: Expr;
  readonly value: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
/**
 * `array.copy $dst $src` (0xfb 0x11) — pops dest ref, dest offset, src ref,
 * src offset, size. Carries TWO type immediates, destination first.
 */
export interface ArrayCopyExpr {
  readonly kind: 'array.copy';
  readonly destTypeVar: Var;
  readonly srcTypeVar: Var;
  readonly destRef: Expr;
  readonly destOffset: Expr;
  readonly srcRef: Expr;
  readonly srcOffset: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
/**
 * `array.init_data $t $d` (0xfb 0x12) / `array.init_elem $t $e` (0xfb 0x13) —
 * pops (ref null $t), i32 dest offset, i32 source offset, i32 size, and
 * copies from the named data/elem segment. `segmentKind` selects which
 * index space `segment` refers to.
 */
export interface ArrayInitSegmentExpr {
  readonly kind: 'array.init_data' | 'array.init_elem';
  readonly typeVar: Var;
  readonly segment: Var;
  readonly ref: Expr;
  readonly destOffset: Expr;
  readonly srcOffset: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
/** `array.len` — pops (ref array), pushes i32 length. No type immediate. */
export interface ArrayLenExpr {
  readonly kind: 'array.len';
  readonly ref: Expr;
  readonly loc: Location;
}

// --- GC ref.test / ref.cast ---
/**
 * `ref.test (ref [null] H) val` — pops a ref, pushes i32 (1 if the ref's
 * runtime type matches the heap type H respecting nullability, else 0).
 *
 * `heapType` is a {@link Var} for parity with `ref.null`: name-form holds
 * the abstract-heap-type keyword (`"any"` / `"eq"` / `"i31"` / `"struct"` /
 * `"array"` / `"func"` / `"extern"` / `"none"` / `"nofunc"` / `"noextern"`)
 * or `"$T"` for a concrete user-defined heap type. `nullable` matches the
 * `null` keyword in the WAT immediate.
 */
export interface RefTestExpr {
  readonly kind: 'ref.test';
  readonly heapType: Var;
  readonly nullable: boolean;
  readonly ref: Expr;
  readonly loc: Location;
}
/**
 * `ref.cast (ref [null] H) val` — pops a ref, pushes a ref of type H
 * (traps if the runtime type doesn't match).
 */
export interface RefCastExpr {
  readonly kind: 'ref.cast';
  readonly heapType: Var;
  readonly nullable: boolean;
  readonly ref: Expr;
  readonly loc: Location;
}

// --- Tables ---
/** `table.get $table` (0x25) — reads the element at the given index. */
export interface TableGetExpr {
  readonly kind: 'table.get';
  readonly table: Var;
  readonly index: Expr;
  readonly loc: Location;
}
/** `table.set $table` (0x26) — writes an element at the given index. */
export interface TableSetExpr {
  readonly kind: 'table.set';
  readonly table: Var;
  readonly index: Expr;
  readonly value: Expr;
  readonly loc: Location;
}
/** `table.grow $table` (0xfc 0x0f) — grows the table by `delta`, init with `initValue`. */
export interface TableGrowExpr {
  readonly kind: 'table.grow';
  readonly table: Var;
  readonly initValue: Expr;
  readonly delta: Expr;
  readonly loc: Location;
}
/** `table.size $table` (0xfc 0x10) — pushes the current table size. */
export interface TableSizeExpr {
  readonly kind: 'table.size';
  readonly table: Var;
  readonly loc: Location;
}
/** `table.fill $table` (0xfc 0x11) — fills a range of the table with `value`. */
export interface TableFillExpr {
  readonly kind: 'table.fill';
  readonly table: Var;
  readonly start: Expr;
  readonly value: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
/** `table.copy $dst $src` (0xfc 0x0e) — copies `size` elements between tables. */
export interface TableCopyExpr {
  readonly kind: 'table.copy';
  readonly dst: Var;
  readonly src: Var;
  readonly dest: Expr;
  readonly srcOffset: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
/** `table.init $seg $table` (0xfc 0x0c) — copies elements from a passive elem segment. */
export interface TableInitExpr {
  readonly kind: 'table.init';
  readonly segment: Var;
  readonly table: Var;
  readonly dest: Expr;
  readonly src: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
/** `elem.drop $seg` (0xfc 0x0d) — declares a passive element segment as no longer needed. */
export interface ElemDropExpr {
  readonly kind: 'elem.drop';
  readonly segment: Var;
  readonly loc: Location;
}

// --- Exceptions ---
/** `throw $tag` (0x08) — throws an exception with the named tag, popping the tag's args. */
export interface ThrowExpr {
  readonly kind: 'throw';
  readonly tag: Var;
  readonly args: Expr[];
  readonly loc: Location;
}
/** `throw_ref` (0x0a) — re-throws an existing exception reference (EH proposal). */
export interface ThrowRefExpr {
  readonly kind: 'throw_ref';
  readonly exnref: Expr;
  readonly loc: Location;
}
/** `rethrow $depth` (0x09) — legacy EH: re-throws the exception caught by the labeled outer catch. */
export interface RethrowExpr {
  readonly kind: 'rethrow';
  readonly depth: Var;
  readonly loc: Location;
}

/** `try ... (catch ...)* (delegate ...)?` (0x06) — legacy EH; superseded by `try_table`. */
export interface TryExpr {
  readonly kind: 'try';
  readonly label: string;
  readonly blockType: BlockType;
  readonly body: Expr[];
  readonly catches: Catch[];
  readonly delegate?: Var;
  readonly loc: Location;
}
/** `try_table ... (catch ...)*` (0x1f) — current EH proposal; catches branch to labels. */
export interface TryTableExpr {
  readonly kind: 'try_table';
  readonly label: string;
  readonly blockType: BlockType;
  readonly body: Expr[];
  readonly catches: TableCatch[];
  readonly loc: Location;
}

// --- SIMD ---
/** SIMD `*.extract_lane $L` / `*.replace_lane $L` — per-lane access on v128. */
export interface SimdLaneOpExpr {
  readonly kind: 'simd_lane_op';
  readonly opcode: Opcode;
  readonly lane: number;
  /** Vector operand. For `*.extract_lane` this is the only operand. */
  readonly operand: Expr;
  /**
   * Scalar replacement value. Set for `*.replace_lane` opcodes (the i8x16 /
   * i16x8 / i32x4 / i64x2 / f32x4 / f64x2 replace_lane family); undefined
   * for `*.extract_lane`. Previously this slot didn't exist and the parser
   * silently dropped the scalar half of every replace_lane, producing
   * binaries V8 rejected as missing operands.
   */
  readonly value?: Expr;
  readonly loc: Location;
}
/** SIMD `i8x16.shuffle` — permutes 32 bytes from two v128 operands via 16 lane indices. */
export interface SimdShuffleOpExpr {
  readonly kind: 'simd_shuffle';
  readonly opcode: Opcode;
  readonly lanes: Uint8Array; // 16 lane indices
  readonly left: Expr;
  readonly right: Expr;
  readonly loc: Location;
}
/** SIMD `v128.load*_lane` — loads one lane of a v128 from memory, leaving others unchanged. */
export interface SimdLoadLaneExpr {
  readonly kind: 'simd_load_lane';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly lane: number;
  readonly address: Expr;
  readonly vec: Expr;
  readonly loc: Location;
}
/** SIMD `v128.store*_lane` — stores one lane of a v128 to memory. */
export interface SimdStoreLaneExpr {
  readonly kind: 'simd_store_lane';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly lane: number;
  readonly address: Expr;
  readonly vec: Expr;
  readonly loc: Location;
}
/** SIMD `v128.load*_splat` — loads a scalar and broadcasts it to every lane. */
export interface LoadSplatExpr {
  readonly kind: 'load_splat';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly loc: Location;
}
/** SIMD `v128.load*_zero` — loads a scalar into the first lane, zeros the rest. */
export interface LoadZeroExpr {
  readonly kind: 'load_zero';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly loc: Location;
}

// --- Atomics ---
/** Atomic load (`i32.atomic.load`, etc.) — sequentially-consistent read from shared memory. */
export interface AtomicLoadExpr {
  readonly kind: 'atomic_load';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly loc: Location;
}
/** Atomic store — sequentially-consistent write to shared memory. */
export interface AtomicStoreExpr {
  readonly kind: 'atomic_store';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly value: Expr;
  readonly loc: Location;
}
/** Atomic read-modify-write (`i32.atomic.rmw.add`, etc.) — pops value, returns the prior memory contents. */
export interface AtomicRmwExpr {
  readonly kind: 'atomic_rmw';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly value: Expr;
  readonly loc: Location;
}
/** Atomic compare-exchange — writes `replacement` iff memory matches `expected`; returns the old value. */
export interface AtomicRmwCmpxchgExpr {
  readonly kind: 'atomic_rmw_cmpxchg';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly expected: Expr;
  readonly replacement: Expr;
  readonly loc: Location;
}
/** `memory.atomic.wait{32,64}` — blocks until memory at `address` changes or timeout expires. */
export interface AtomicWaitExpr {
  readonly kind: 'atomic_wait';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly expected: Expr;
  readonly timeout: Expr;
  readonly loc: Location;
}
/** `memory.atomic.notify` — wakes up to `count` waiters blocked on `address`. */
export interface AtomicNotifyExpr {
  readonly kind: 'atomic_notify';
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly count: Expr;
  readonly loc: Location;
}
/** `atomic.fence` (0xfe 0x03) — memory fence; `consistencyModel` is always 0 currently. */
export interface AtomicFenceExpr {
  readonly kind: 'atomic_fence';
  readonly consistencyModel: number;
  readonly loc: Location;
}

// --- Misc ---
/** Code-metadata pseudo-expression — captures debug info attached to an instruction position. */
export interface CodeMetadataExpr {
  readonly kind: 'code_metadata';
  readonly name: string;
  readonly data: Uint8Array;
  readonly loc: Location;
}

// ---------------------------------------------------------------------------
// Expr — the complete union type
// ---------------------------------------------------------------------------

/**
 * The full discriminated union of WebAssembly instruction IR nodes. Each
 * variant carries its operands as typed children (tree shape) so a
 * post-order walk emits the correct binary stack-machine sequence.
 * Use the `kind` field to discriminate.
 */
export type Expr =
  | NopExpr
  | UnreachableExpr
  | ReturnExpr
  | DropExpr
  | SelectExpr
  | BlockExpr
  | LoopExpr
  | IfExpr
  | BrExpr
  | BrIfExpr
  | BrTableExpr
  | BrOnNullExpr
  | BrOnNonNullExpr
  | ConstExpr
  | LocalGetExpr
  | LocalSetExpr
  | LocalTeeExpr
  | GlobalGetExpr
  | GlobalSetExpr
  | UnaryExpr
  | BinaryExpr
  | CompareExpr
  | ConvertExpr
  | TernaryExpr
  | QuaternaryExpr
  | LoadExpr
  | StoreExpr
  | MemorySizeExpr
  | MemoryGrowExpr
  | MemoryCopyExpr
  | MemoryFillExpr
  | MemoryInitExpr
  | DataDropExpr
  | CallExpr
  | CallIndirectExpr
  | CallRefExpr
  | ReturnCallExpr
  | ReturnCallIndirectExpr
  | ReturnCallRefExpr
  | RefNullExpr
  | RefIsNullExpr
  | RefFuncExpr
  | RefAsNonNullExpr
  | RefEqExpr
  | RefI31Expr
  | ExternConvertExpr
  | I31GetExpr
  | StructNewExpr
  | StructNewDefaultExpr
  | StructGetExpr
  | StructSetExpr
  | ArrayNewExpr
  | ArrayNewDefaultExpr
  | ArrayNewFixedExpr
  | ArrayNewDataExpr
  | ArrayNewElemExpr
  | ArrayGetExpr
  | ArraySetExpr
  | ArrayLenExpr
  | ArrayFillExpr
  | ArrayCopyExpr
  | ArrayInitSegmentExpr
  | RefTestExpr
  | RefCastExpr
  | TableGetExpr
  | TableSetExpr
  | TableGrowExpr
  | TableSizeExpr
  | TableFillExpr
  | TableCopyExpr
  | TableInitExpr
  | ElemDropExpr
  | ThrowExpr
  | ThrowRefExpr
  | RethrowExpr
  | TryExpr
  | TryTableExpr
  | SimdLaneOpExpr
  | SimdShuffleOpExpr
  | SimdLoadLaneExpr
  | SimdStoreLaneExpr
  | LoadSplatExpr
  | LoadZeroExpr
  | AtomicLoadExpr
  | AtomicStoreExpr
  | AtomicRmwExpr
  | AtomicRmwCmpxchgExpr
  | AtomicWaitExpr
  | AtomicNotifyExpr
  | AtomicFenceExpr
  | CodeMetadataExpr;

/** Helper alias for the discriminant string of {@link Expr} (e.g. `'block'`, `'i32.const'`). */
export type ExprKind = Expr['kind'];

// ---------------------------------------------------------------------------
// Module-level IR structures
// ---------------------------------------------------------------------------

/** Function signature (type). */
export interface FuncSignature {
  params: ValueType[];
  results: ValueType[];
}

/** Structural equality for two {@link FuncSignature} values (params + results). */
export function valueTypeEquals(a: ValueType, b: ValueType): boolean {
  if (isRefValueType(a) || isRefValueType(b)) {
    if (!isRefValueType(a) || !isRefValueType(b)) return false;
    if (a.nullable !== b.nullable) return false;
    if (a.heapType.kind !== b.heapType.kind) return false;
    return a.heapType.kind === 'index'
      ? a.heapType.value === (b.heapType as { value: number }).value
      : a.heapType.name === (b.heapType as { name: string }).name;
  }
  return a === b;
}

/** Structural equality for two {@link FuncSignature} values (params + results). */
export function sigEquals(a: FuncSignature, b: FuncSignature): boolean {
  return (
    a.params.length === b.params.length &&
    a.results.length === b.results.length &&
    a.params.every((t, i) => valueTypeEquals(t, b.params[i]!)) &&
    a.results.every((t, i) => valueTypeEquals(t, b.results[i]!))
  );
}

/** A local variable declaration (type + count, matching LocalTypes in C++). */
export interface LocalDecl {
  type: ValueType;
  count: Index;
}

/**
 * A CONCRETE typed reference — `(ref $T)` / `(ref null $T)` — carrying the
 * heap type it points at.
 *
 * The flat `Type` enum cannot express this: its values are single wire bytes,
 * but a typed reference encodes as `0x64`/`0x63` FOLLOWED BY a heap type. The
 * parser used to coarsen every typed ref to `Type.StructRef`, so the writer
 * emitted a structref byte and V8 rejected any module using one in a
 * signature, local, global, or element type.
 */
export interface RefValueType {
  readonly kind: 'ref';
  /** The heap type: a name-var for `$T`, an index-var once resolved. */
  readonly heapType: Var;
  /** `(ref null $T)` when true, `(ref $T)` when false. */
  readonly nullable: boolean;
}

/**
 * Anywhere a value type can appear: either an abstract {@link Type} (whose
 * enum value IS its wire byte) or a concrete {@link RefValueType}.
 */
export type ValueType = Type | RefValueType;

/** Narrow a {@link ValueType} to the concrete typed-reference case. */
export function isRefValueType(vt: ValueType): vt is RefValueType {
  return typeof vt === 'object';
}

/**
 * Collapse a {@link ValueType} to a single abstract {@link Type}.
 *
 * For consumers that cannot yet represent a concrete heap type — the
 * type-checker's operand stack and the binaryen bridge. A typed ref becomes
 * its nullable abstract supertype, which is what the whole IR used to store.
 * Encoders must NOT use this: emitting the coarsened byte is precisely the
 * bug this type exists to fix.
 */
export function coarsenValueType(vt: ValueType): Type {
  return isRefValueType(vt) ? Type.StructRef : vt;
}

/**
 * Human-readable spelling of a {@link ValueType}, matching the WAT text
 * format. Abstract types delegate to `typeName`; a concrete typed reference
 * prints as `(ref $T)` / `(ref null $T)`.
 */
export function valueTypeName(vt: ValueType): string {
  if (!isRefValueType(vt)) return typeName(vt);
  const h = vt.heapType.kind === 'index' ? `${vt.heapType.value}` : vt.heapType.name;
  return `(ref ${vt.nullable ? 'null ' : ''}${h})`;
}

/** Shared shape for every {@link TypeEntry} variant. */
export interface TypeEntryBase {
  name: string;
  loc: Location;
  /**
   * An explicit `(sub final? $super*)` declaration.
   *
   * ABSENT means the bare comptype shorthand, which the spec defines as
   * `sub final` with no supertypes — so absent is NOT the same as
   * `{ final: false, supertypes: [] }`, and the writer emits a different
   * encoding for each.
   */
  sub?: { final: boolean; supertypes: Var[] };
  /**
   * Set on the FIRST entry of an explicit `(rec …)` group: how many
   * consecutive entries the group spans. Absent means a singleton group.
   *
   * The type INDEX space counts entries, but the type SECTION is a vector of
   * rec groups — so a 2-entry group occupies one vector slot and two indices.
   */
  recGroupSize?: number;
}

/** A type section entry — function, struct, or array type. */
export type TypeEntry =
  | ({ kind: 'func'; sig: FuncSignature } & TypeEntryBase)
  | ({ kind: 'struct'; fields: Field[] } & TypeEntryBase)
  | ({ kind: 'array'; field: Field } & TypeEntryBase);

/**
 * Walk `types` as the SECTION sees it: a sequence of rec groups. Each yielded
 * entry is `[startIndex, count, explicit]`, where `explicit` distinguishes a
 * written `(rec …)` from an implicit singleton — the two encode differently.
 */
export function recGroups(
  types: readonly TypeEntry[],
): Array<{ start: number; count: number; explicit: boolean }> {
  const out: Array<{ start: number; count: number; explicit: boolean }> = [];
  for (let i = 0; i < types.length;) {
    const size = types[i]!.recGroupSize;
    if (size !== undefined && size >= 0) {
      out.push({ start: i, count: size, explicit: true });
      i += Math.max(size, 1);
    } else {
      out.push({ start: i, count: 1, explicit: false });
      i += 1;
    }
  }
  return out;
}

/** A field in a GC struct or array type. */
export interface Field {
  name: string;
  type: ValueType;
  mutable: boolean;
}

/** Memory / table size limits. */
export interface Limits {
  initial: number;
  max?: number;
  isShared: boolean;
  is64: boolean;
  pageSize?: number; // custom-page-sizes proposal (default 65536)
}

/** A function defined (or imported) in the module. */
export interface Func {
  name: string;
  loc: Location;
  /** Type-section reference (index or name). Filled during decode. */
  typeVar: Var;
  sig: FuncSignature;
  /** Local variable declarations (not including params). */
  localDecls: LocalDecl[];
  /** Function body as a sequence of tree-structured expressions. */
  body: Expr[];
  tailcall: boolean;
}

/** A global variable. */
export interface Global {
  name: string;
  loc: Location;
  type: ValueType;
  mutable: boolean;
  init: Expr[]; // initializer expression (constant expr)
}

/** A table. */
export interface Table {
  name: string;
  loc: Location;
  elemType: ValueType;
  limits: Limits;
  init: Expr[]; // initializer expression (for table with init value)
}

/** A linear memory. */
export interface Memory {
  name: string;
  loc: Location;
  limits: Limits;
}

/** An exception tag. */
export interface Tag {
  name: string;
  loc: Location;
  sig: FuncSignature;
}

/** An element segment (active or passive). */
export type SegmentKind = 'active' | 'passive' | 'declared';

/**
 * An element segment in the elem section. Active segments initialize a
 * portion of a table at instantiation; passive segments wait for an explicit
 * `table.init`; declared segments only declare ref.func references for
 * subsequent `ref.func` instructions.
 */
export interface ElemSegment {
  name: string;
  loc: Location;
  kind: SegmentKind;
  tableVar: Var; // only for active
  offset: Expr[]; // only for active (constant expr)
  elemType: ValueType;
  elemExprs: Expr[][]; // each element is a constant expression
}

/** A data segment (active or passive). */
export interface DataSegment {
  name: string;
  loc: Location;
  kind: SegmentKind;
  memoryVar: Var; // only for active
  offset: Expr[]; // only for active (constant expr)
  data: Uint8Array;
}

/** An import entry. */
export type Import =
  | { kind: ExternalKind.Func; module: string; field: string; func: Func }
  | { kind: ExternalKind.Table; module: string; field: string; table: Table }
  | { kind: ExternalKind.Memory; module: string; field: string; memory: Memory }
  | { kind: ExternalKind.Global; module: string; field: string; global: Global }
  | { kind: ExternalKind.Tag; module: string; field: string; tag: Tag };

/** An export entry. */
export interface Export {
  name: string;
  kind: ExternalKind;
  var: Var;
}

/** A custom section's raw bytes and name. */
export interface Custom {
  name: string;
  data: Uint8Array;
  loc: Location;
}

// ---------------------------------------------------------------------------
// Section metadata envelope (for wasm-objdump)
// ---------------------------------------------------------------------------

/** Byte-level metadata about a section in the binary. */
export interface SectionMeta {
  section: BinarySection;
  /** Byte offset of the section *body* (after the section ID and size LEB). */
  offset: number;
  /** Byte size of the section body. */
  size: number;
  /** Number of entries in the section (0 for custom/start). */
  count: number;
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

/** A complete decoded WebAssembly module. */
export interface Module {
  name: string;
  filename: string;
  loc: Location;

  // Type section
  types: TypeEntry[];

  // Imports (all external items, in declaration order)
  imports: Import[];

  // Defined items (in binary order; indices start after imports)
  funcs: Func[];
  tables: Table[];
  memories: Memory[];
  globals: Global[];
  tags: Tag[];

  // Segments
  elemSegments: ElemSegment[];
  dataSegments: DataSegment[];

  // Exports
  exports: Export[];

  // Start function (optional; absent when not present in module)
  start?: Var;

  // Custom sections
  customs: Custom[];

  // Import counts (used to compute final index-space positions)
  numFuncImports: number;
  numTableImports: number;
  numMemoryImports: number;
  numGlobalImports: number;
  numTagImports: number;

  // Section layout metadata (byte offsets, sizes — for wasm-objdump)
  sectionMeta: SectionMeta[];

  // Features used by this module (tracked during decode)
  featuresUsed: {
    simd: boolean;
    exceptions: boolean;
    threads: boolean;
    tailcall: boolean;
    gc: boolean;
  };
}

/** Returns an empty, zeroed Module ready to be populated by a reader. */
export function makeModule(): Module {
  return {
    name: '',
    filename: '',
    loc: { filename: '', line: 0, column: 0, offset: 0 },
    types: [],
    imports: [],
    funcs: [],
    tables: [],
    memories: [],
    globals: [],
    tags: [],
    elemSegments: [],
    dataSegments: [],
    exports: [],
    customs: [],
    numFuncImports: 0,
    numTableImports: 0,
    numMemoryImports: 0,
    numGlobalImports: 0,
    numTagImports: 0,
    sectionMeta: [],
    featuresUsed: { simd: false, exceptions: false, threads: false, tailcall: false, gc: false },
  };
}

/** Total number of functions in index space (imports + defined). */
export function totalFuncs(m: Module): number {
  return m.numFuncImports + m.funcs.length;
}
/** Total number of tables in index space (imports + defined). */
export function totalTables(m: Module): number {
  return m.numTableImports + m.tables.length;
}
/** Total number of memories in index space (imports + defined). */
export function totalMemories(m: Module): number {
  return m.numMemoryImports + m.memories.length;
}
/** Total number of globals in index space (imports + defined). */
export function totalGlobals(m: Module): number {
  return m.numGlobalImports + m.globals.length;
}
/** Total number of tags in index space (imports + defined). */
export function totalTags(m: Module): number {
  return m.numTagImports + m.tags.length;
}
