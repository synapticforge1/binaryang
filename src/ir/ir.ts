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
import { Type } from '../core/types.ts';
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

export function varIndex(value: Index): Var {
  return { kind: 'index', value };
}
export function varName(name: string): Var {
  return { kind: 'name', name };
}

export function isVarIndex(v: Var): v is { kind: 'index'; value: Index } {
  return v.kind === 'index';
}
export function isVarName(v: Var): v is { kind: 'name'; name: string } {
  return v.kind === 'name';
}

// ---------------------------------------------------------------------------
// Block type — the signature of a block/loop/if/try
// ---------------------------------------------------------------------------

export type BlockType =
  | { readonly kind: 'void' }
  | { readonly kind: 'value'; readonly type: Type }
  | { readonly kind: 'func_type'; readonly typeIdx: Index };

export const BLOCK_TYPE_VOID: BlockType = { kind: 'void' };
export function blockTypeValue(type: Type): BlockType {
  return { kind: 'value', type };
}
export function blockTypeFuncType(typeIdx: Index): BlockType {
  return { kind: 'func_type', typeIdx };
}

// ---------------------------------------------------------------------------
// Const — a constant value (leaf node, no children)
// ---------------------------------------------------------------------------

export type Const =
  | { readonly type: Type.I32; readonly value: number }
  | { readonly type: Type.I64; readonly value: bigint }
  | { readonly type: Type.F32; readonly bits: number } // raw IEEE 754 bit pattern
  | { readonly type: Type.F64; readonly bits: bigint } // raw IEEE 754 bit pattern
  | { readonly type: Type.V128; readonly bytes: Uint8Array }; // 16 raw bytes

export function constI32(value: number): Const {
  return { type: Type.I32, value };
}
export function constI64(value: bigint): Const {
  return { type: Type.I64, value };
}
export function constF32(bits: number): Const {
  return { type: Type.F32, bits };
}
export function constF64(bits: bigint): Const {
  return { type: Type.F64, bits };
}
export function constV128(bytes: Uint8Array): Const {
  return { type: Type.V128, bytes };
}

// ---------------------------------------------------------------------------
// Catch clauses — exception handling
// ---------------------------------------------------------------------------

export enum CatchKind {
  Catch = 'catch',
  CatchRef = 'catch_ref',
  CatchAll = 'catch_all',
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
export interface NopExpr {
  readonly kind: 'nop';
  readonly loc: Location;
}
export interface UnreachableExpr {
  readonly kind: 'unreachable';
  readonly loc: Location;
}
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
export interface DropExpr {
  readonly kind: 'drop';
  readonly value: Expr;
  readonly loc: Location;
}
export interface SelectExpr {
  readonly kind: 'select';
  readonly val1: Expr;
  readonly val2: Expr;
  readonly cond: Expr;
  readonly resultType: Type[];
  readonly loc: Location;
}

// --- Blocks ---
export interface BlockExpr {
  readonly kind: 'block';
  readonly label: string;
  readonly blockType: BlockType;
  readonly body: Expr[];
  readonly loc: Location;
}
export interface LoopExpr {
  readonly kind: 'loop';
  readonly label: string;
  readonly blockType: BlockType;
  readonly body: Expr[];
  readonly loc: Location;
}
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
export interface BrExpr {
  readonly kind: 'br';
  readonly target: Var;
  readonly value?: Expr;
  readonly loc: Location;
}
export interface BrIfExpr {
  readonly kind: 'br_if';
  readonly target: Var;
  readonly cond: Expr;
  readonly value?: Expr;
  readonly loc: Location;
}
export interface BrTableExpr {
  readonly kind: 'br_table';
  readonly targets: Var[];
  readonly defaultTarget: Var;
  readonly value: Expr;
  readonly loc: Location;
}
export interface BrOnNullExpr {
  readonly kind: 'br_on_null';
  readonly target: Var;
  readonly value: Expr;
  readonly loc: Location;
}
export interface BrOnNonNullExpr {
  readonly kind: 'br_on_non_null';
  readonly target: Var;
  readonly value: Expr;
  readonly loc: Location;
}

// --- Constants ---
export interface ConstExpr {
  readonly kind: 'const';
  readonly value: Const;
  readonly loc: Location;
}

// --- Locals ---
export interface LocalGetExpr {
  readonly kind: 'local.get';
  readonly var: Var;
  readonly loc: Location;
}
export interface LocalSetExpr {
  readonly kind: 'local.set';
  readonly var: Var;
  readonly value: Expr;
  readonly loc: Location;
}
export interface LocalTeeExpr {
  readonly kind: 'local.tee';
  readonly var: Var;
  readonly value: Expr;
  readonly loc: Location;
}

// --- Globals ---
export interface GlobalGetExpr {
  readonly kind: 'global.get';
  readonly var: Var;
  readonly loc: Location;
}
export interface GlobalSetExpr {
  readonly kind: 'global.set';
  readonly var: Var;
  readonly value: Expr;
  readonly loc: Location;
}

// --- Numeric: unary, binary, compare, convert ---
export interface UnaryExpr {
  readonly kind: 'unary';
  readonly opcode: Opcode;
  readonly operand: Expr;
  readonly loc: Location;
}
export interface BinaryExpr {
  readonly kind: 'binary';
  readonly opcode: Opcode;
  readonly left: Expr;
  readonly right: Expr;
  readonly loc: Location;
}
export interface CompareExpr {
  readonly kind: 'compare';
  readonly opcode: Opcode;
  readonly left: Expr;
  readonly right: Expr;
  readonly loc: Location;
}
export interface ConvertExpr {
  readonly kind: 'convert';
  readonly opcode: Opcode;
  readonly operand: Expr;
  readonly loc: Location;
}
export interface TernaryExpr {
  readonly kind: 'ternary';
  readonly opcode: Opcode;
  readonly a: Expr;
  readonly b: Expr;
  readonly c: Expr;
  readonly loc: Location;
}
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
export interface LoadExpr {
  readonly kind: 'load';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly loc: Location;
}
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
export interface MemorySizeExpr {
  readonly kind: 'memory.size';
  readonly memidx: Var;
  readonly loc: Location;
}
export interface MemoryGrowExpr {
  readonly kind: 'memory.grow';
  readonly memidx: Var;
  readonly delta: Expr;
  readonly loc: Location;
}
export interface MemoryCopyExpr {
  readonly kind: 'memory.copy';
  readonly destMemidx: Var;
  readonly srcMemidx: Var;
  readonly dest: Expr;
  readonly src: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
export interface MemoryFillExpr {
  readonly kind: 'memory.fill';
  readonly memidx: Var;
  readonly dest: Expr;
  readonly value: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
export interface MemoryInitExpr {
  readonly kind: 'memory.init';
  readonly segment: Var;
  readonly memidx: Var;
  readonly dest: Expr;
  readonly src: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
export interface DataDropExpr {
  readonly kind: 'data.drop';
  readonly segment: Var;
  readonly loc: Location;
}

// --- Calls ---
export interface CallExpr {
  readonly kind: 'call';
  readonly func: Var;
  readonly args: Expr[];
  readonly loc: Location;
}
export interface CallIndirectExpr {
  readonly kind: 'call_indirect';
  readonly sig: FuncSignature;
  readonly typeVar: Var;
  readonly table: Var;
  readonly args: Expr[];
  readonly callee: Expr;
  readonly loc: Location;
}
export interface CallRefExpr {
  readonly kind: 'call_ref';
  readonly sigType: Var;
  readonly args: Expr[];
  readonly callee: Expr;
  readonly loc: Location;
}
export interface ReturnCallExpr {
  readonly kind: 'return_call';
  readonly func: Var;
  readonly args: Expr[];
  readonly loc: Location;
}
export interface ReturnCallIndirectExpr {
  readonly kind: 'return_call_indirect';
  readonly sig: FuncSignature;
  readonly typeVar: Var;
  readonly table: Var;
  readonly args: Expr[];
  readonly callee: Expr;
  readonly loc: Location;
}
export interface ReturnCallRefExpr {
  readonly kind: 'return_call_ref';
  readonly sigType: Var;
  readonly args: Expr[];
  readonly callee: Expr;
  readonly loc: Location;
}

// --- Ref types ---
export interface RefNullExpr {
  readonly kind: 'ref.null';
  readonly refType: Var;
  readonly loc: Location;
}
export interface RefIsNullExpr {
  readonly kind: 'ref.is_null';
  readonly value: Expr;
  readonly loc: Location;
}
export interface RefFuncExpr {
  readonly kind: 'ref.func';
  readonly func: Var;
  readonly loc: Location;
}
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

// --- Tables ---
export interface TableGetExpr {
  readonly kind: 'table.get';
  readonly table: Var;
  readonly index: Expr;
  readonly loc: Location;
}
export interface TableSetExpr {
  readonly kind: 'table.set';
  readonly table: Var;
  readonly index: Expr;
  readonly value: Expr;
  readonly loc: Location;
}
export interface TableGrowExpr {
  readonly kind: 'table.grow';
  readonly table: Var;
  readonly initValue: Expr;
  readonly delta: Expr;
  readonly loc: Location;
}
export interface TableSizeExpr {
  readonly kind: 'table.size';
  readonly table: Var;
  readonly loc: Location;
}
export interface TableFillExpr {
  readonly kind: 'table.fill';
  readonly table: Var;
  readonly start: Expr;
  readonly value: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
export interface TableCopyExpr {
  readonly kind: 'table.copy';
  readonly dst: Var;
  readonly src: Var;
  readonly dest: Expr;
  readonly srcOffset: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
export interface TableInitExpr {
  readonly kind: 'table.init';
  readonly segment: Var;
  readonly table: Var;
  readonly dest: Expr;
  readonly src: Expr;
  readonly size: Expr;
  readonly loc: Location;
}
export interface ElemDropExpr {
  readonly kind: 'elem.drop';
  readonly segment: Var;
  readonly loc: Location;
}

// --- Exceptions ---
export interface ThrowExpr {
  readonly kind: 'throw';
  readonly tag: Var;
  readonly args: Expr[];
  readonly loc: Location;
}
export interface ThrowRefExpr {
  readonly kind: 'throw_ref';
  readonly exnref: Expr;
  readonly loc: Location;
}
export interface RethrowExpr {
  readonly kind: 'rethrow';
  readonly depth: Var;
  readonly loc: Location;
}

export interface TryExpr {
  readonly kind: 'try';
  readonly label: string;
  readonly blockType: BlockType;
  readonly body: Expr[];
  readonly catches: Catch[];
  readonly delegate?: Var;
  readonly loc: Location;
}
export interface TryTableExpr {
  readonly kind: 'try_table';
  readonly label: string;
  readonly blockType: BlockType;
  readonly body: Expr[];
  readonly catches: TableCatch[];
  readonly loc: Location;
}

// --- SIMD ---
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
export interface SimdShuffleOpExpr {
  readonly kind: 'simd_shuffle';
  readonly opcode: Opcode;
  readonly lanes: Uint8Array; // 16 lane indices
  readonly left: Expr;
  readonly right: Expr;
  readonly loc: Location;
}
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
export interface LoadSplatExpr {
  readonly kind: 'load_splat';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly loc: Location;
}
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
export interface AtomicLoadExpr {
  readonly kind: 'atomic_load';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly loc: Location;
}
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
export interface AtomicNotifyExpr {
  readonly kind: 'atomic_notify';
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly count: Expr;
  readonly loc: Location;
}
export interface AtomicFenceExpr {
  readonly kind: 'atomic_fence';
  readonly consistencyModel: number;
  readonly loc: Location;
}

// --- Misc ---
export interface CodeMetadataExpr {
  readonly kind: 'code_metadata';
  readonly name: string;
  readonly data: Uint8Array;
  readonly loc: Location;
}

// ---------------------------------------------------------------------------
// Expr — the complete union type
// ---------------------------------------------------------------------------

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
  | I31GetExpr
  | StructNewExpr
  | StructNewDefaultExpr
  | StructGetExpr
  | StructSetExpr
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

export type ExprKind = Expr['kind'];

// ---------------------------------------------------------------------------
// Module-level IR structures
// ---------------------------------------------------------------------------

/** Function signature (type). */
export interface FuncSignature {
  params: Type[];
  results: Type[];
}

export function sigEquals(a: FuncSignature, b: FuncSignature): boolean {
  return (
    a.params.length === b.params.length &&
    a.results.length === b.results.length &&
    a.params.every((t, i) => t === b.params[i]) &&
    a.results.every((t, i) => t === b.results[i])
  );
}

/** A local variable declaration (type + count, matching LocalTypes in C++). */
export interface LocalDecl {
  type: Type;
  count: Index;
}

/** A type section entry — function, struct, or array type. */
export type TypeEntry =
  | { kind: 'func'; name: string; sig: FuncSignature; loc: Location; tailcallTarget?: boolean }
  | { kind: 'struct'; name: string; fields: Field[]; loc: Location }
  | { kind: 'array'; name: string; field: Field; loc: Location };

/** A field in a GC struct or array type. */
export interface Field {
  name: string;
  type: Type;
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
  type: Type;
  mutable: boolean;
  init: Expr[]; // initializer expression (constant expr)
}

/** A table. */
export interface Table {
  name: string;
  loc: Location;
  elemType: Type;
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

export interface ElemSegment {
  name: string;
  loc: Location;
  kind: SegmentKind;
  tableVar: Var; // only for active
  offset: Expr[]; // only for active (constant expr)
  elemType: Type;
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
export function totalTables(m: Module): number {
  return m.numTableImports + m.tables.length;
}
export function totalMemories(m: Module): number {
  return m.numMemoryImports + m.memories.length;
}
export function totalGlobals(m: Module): number {
  return m.numGlobalImports + m.globals.length;
}
export function totalTags(m: Module): number {
  return m.numTagImports + m.tags.length;
}
