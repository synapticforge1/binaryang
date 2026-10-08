/**
 * @module binaryen-ts/interp/interpreter
 *
 * The interpreter (open-work 23, stage E3): runs a module's functions over the
 * IR, for `wasm-ctor-eval`, a `wasm-interp` CLI and tests. Numbers go through
 * the evaluator's numeric core (`numeric.ts`), so a value is computed exactly as
 * OptimizeInstructions and Precompute fold it.
 *
 * **A stack machine over the tree.** Each node pushes its results onto ONE value
 * stack; a node pops one value per operand it takes. The reader is byte-faithful,
 * so a body may still hold a `pop` — a value an earlier instruction left on the
 * stack, a multi-result producer's earlier values, a block parameter — and here
 * a `pop` is simply nothing: the value is already on the stack where the
 * consumer takes it. A branch carries the top values its TARGET takes (a block's
 * results, a loop's parameters, the function's results), however they came to
 * be on the stack.
 *
 * **Two ways to stop, never confused:**
 * - {@link Trap} — the program trapped, as an engine would (the spec testsuite's
 *   wording: `integer divide by zero`, `unreachable`, `call stack exhausted`);
 * - {@link Stop} — the interpreter cannot go on: a host function it was not
 *   given, an instruction it does not run yet, or its fuel ran out. Never a
 *   result about the program — a caller that evaluates at compile time keeps
 *   the code as it was.
 *
 * Runs: numeric code, locals, globals, control flow (`block`, `loop`, `if`,
 * `br`, `br_if`, `br_table`, `return`, `select`, `drop`), direct calls, host
 * functions (E3a); linear memory — loads, stores, `memory.*`, data segments,
 * imported and exported memories (E3b, `memory.ts`); tables, references,
 * indirect and tail calls (E3c, `table.ts`); exceptions (E3d-1); GC (E3d-2,
 * `types.ts`); `v128` — every SIMD operator through `simd.ts`, the SIMD loads
 * and stores, lane loads and stores (E3e); wide arithmetic. What is left is a
 * {@link Stop}: atomics and shared memory, custom descriptors.
 *
 * @license MIT
 */

import {
  BinaryOp,
  blockParamsOf,
  BrOnOp,
  type Expression,
  ExpressionKind,
  labelName,
  type Literal,
  QuaternaryOp,
  SIMDLoadOp,
  SIMDLoadStoreLaneOp,
} from '../ir/expressions.ts';
import { simdExtract, simdReplace, simdShuffle, simdTernary } from './simd.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import type {
  BlockResult,
  FuncSignature,
  HeapTypeRef,
  StorageType,
  TypeEntry,
  ValueType,
  Var,
} from '../../wabt-ts/ir/ir.ts';
import { Type } from '../../wabt-ts/core/types.ts';
import { isRef } from '../ir/types.ts';
import { loadShape, storeShape } from '../ir/memory-access.ts';
import { evalBinary, evalUnary } from './numeric.ts';
import { MemoryCell, OutOfBounds, TooLarge } from './memory.ts';
import { TableCell, TableOutOfBounds, TableTooLarge } from './table.ts';
import { inHeap, ModuleTypes, type RefShape, type ResolvedHeap, type RttType } from './types.ts';

export { MemoryCell } from './memory.ts';
export { TableCell } from './table.ts';

// ---------------------------------------------------------------------------
// Values and outcomes
// ---------------------------------------------------------------------------

/**
 * A function reference: the instance that defines (or imports) the function,
 * its index there, and its signature — what `call_indirect` checks. Calling it
 * runs in its OWN instance, whichever module's table it came through.
 */
export interface FuncRef {
  readonly owner: Interpreter;
  readonly index: number;
  readonly sig: FuncSignature;
  /** The function's canonical type — what `call_indirect` and a cast compare (E3d-2). */
  readonly rtt: RttType;
}

/** A GC struct: its canonical type and its fields, in order (packed fields as `i32`). */
export interface StructObj {
  readonly type: 'ref';
  readonly kind: 'struct';
  readonly rtt: RttType;
  readonly fields: Value[];
}

/** A GC array: its canonical type and its elements (packed elements as `i32`). */
export interface ArrayObj {
  readonly type: 'ref';
  readonly kind: 'array';
  readonly rtt: RttType;
  readonly elems: Value[];
}

/**
 * A reference value (E3c): `null` — one null, whatever its heap type, since
 * nothing observes the difference at run time — a function, or an extern
 * value the host supplied (compared by identity).
 */
export type Ref =
  | { readonly type: 'ref'; readonly kind: 'null' }
  | { readonly type: 'ref'; readonly kind: 'func'; readonly func: FuncRef }
  // An extern value: the host's, or an internal one `extern.convert_any` wrapped.
  | {
    readonly type: 'ref';
    readonly kind: 'extern';
    readonly host: unknown;
    readonly internal?: Ref;
  }
  | { readonly type: 'ref'; readonly kind: 'exn'; readonly exn: WasmException }
  | StructObj
  | ArrayObj
  | { readonly type: 'ref'; readonly kind: 'i31'; readonly value: number }
  // A host extern value brought into `any` by `any.convert_extern`: in `any`, not in `eq`.
  | { readonly type: 'ref'; readonly kind: 'hostany'; readonly host: unknown };

/**
 * A tag's identity (E3d). A `catch` matches by IDENTITY, not by signature: an
 * imported tag is the exporter's cell, and two tags with the same signature
 * are different tags.
 */
export interface TagCell {
  readonly name: string;
  readonly sig: FuncSignature;
}

/**
 * A wasm exception in flight: its tag and its payload. Thrown through the
 * interpreter as itself, so it is never confused with a {@link Trap} — a trap
 * is not an exception, and no `catch_all` catches one. One that leaves an
 * invocation uncaught is what `assert_exception` asks for.
 */
export class WasmException {
  constructor(readonly tag: TagCell, readonly values: Value[]) {}
}

/** `delegate $l` in flight: the construct labelled `$l` handles, or passes on, `exn`. */
class Delegate {
  constructor(readonly exn: WasmException, readonly label: string) {}
}

/** The null reference. */
export const NULL: Ref = { type: 'ref', kind: 'null' };

/** A runtime value: a number (`Literal`) or a reference. */
export type Value = Literal | Ref;

const isNumber = (v: Value): v is Literal => v.type !== 'ref';

/** The program trapped. `message` is the spec testsuite's wording. */
export class Trap extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Trap';
  }
}

/** Why the interpreter could not go on — never a statement about the program. */
export type StopReason = 'host' | 'unsupported' | 'fuel';

/** The interpreter cannot go on; see {@link StopReason}. */
export class Stop extends Error {
  constructor(readonly reason: StopReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'Stop';
  }
}

/** A function the host supplies for an import: arguments in, results out. */
export type HostFunction = (args: Value[]) => Value[];

/**
 * A global's storage. An imported global IS the exporter's cell, not a copy:
 * a write to a mutable one through either module is seen by both (🔧 it was
 * copied, and spec `linking.wast`'s `Mg.mut_glob` read 142 for 241).
 */
export interface GlobalCell {
  value: Value;
}

/** What the host supplies for one import, by its kind. */
export type HostImport =
  // `func`, when the import is another instance's function: a reference to the
  // import is then THAT function, with its own type — which may be a subtype of
  // the type the importer declared (custom descriptors' `exact-func-import.wast`).
  | { kind: 'func'; call: HostFunction; func?: FuncRef }
  | { kind: 'global'; cell: GlobalCell }
  | { kind: 'memory'; cell: MemoryCell }
  | { kind: 'table'; cell: TableCell<Value> }
  | { kind: 'tag'; cell: TagCell };

/** Options for {@link Interpreter}. */
export interface InterpreterOptions {
  /** Supplies an import, or `undefined`: a call to a missing function is a {@link Stop}. */
  imports?: (module: string, field: string) => HostImport | undefined;
  /** Nested calls before `call stack exhausted`. Default 1,000. */
  maxDepth?: number;
  /** Instructions to run before stopping with `fuel`. Default: unlimited. */
  fuel?: number;
  /**
   * Whether instantiation runs the start function. Default `true`, as the
   * spec says; `wasm-ctor-eval` runs it itself, statement by statement.
   */
  runStart?: boolean;
}

/**
 * An instance's state, in index-space order (imports first), for a tool that
 * snapshots, compares and writes it back (`wasm-ctor-eval`). The arrays and
 * cells are the LIVE ones: a memory's `bytes`, a global's `value`, a table's
 * `elems`; a data or element segment's entry is empty once dropped.
 */
export interface InstanceState {
  readonly memories: readonly MemoryCell[];
  readonly globals: readonly GlobalCell[];
  readonly tables: readonly TableCell<Value>[];
  readonly data: Uint8Array[];
  readonly elems: Value[][];
}

// ---------------------------------------------------------------------------
// Control transfer (thrown, not Errors: no stack trace to capture)
// ---------------------------------------------------------------------------

class Branch {
  constructor(readonly label: string) {}
}
class Return {}
const RETURN = new Return();
/** A `return_call*`: the current frame is replaced by a call to `func`. */
class TailCall {
  constructor(readonly func: FuncRef, readonly args: Value[]) {}
}

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

type FuncSlot =
  | { kind: 'defined'; fn: WasmFunction; sig: FuncSignature; rtt: RttType }
  | {
    kind: 'host';
    name: string;
    call: HostFunction | undefined;
    sig: FuncSignature;
    rtt: RttType;
    /** The imported function itself, when it is another instance's: what its references ARE. */
    func?: FuncRef;
  };

const EMPTY = new Uint8Array(0);

/** An address operand, unsigned: an `i32` read `>>> 0`, an `i64` as `asUintN(64)`. */
function address(v: Value): bigint {
  if (v.type === ValType.I32) return BigInt(v.value >>> 0);
  if (v.type === ValType.I64) return BigInt.asUintN(64, v.value);
  throw new Error('interp: an address must be i32 or i64');
}

/** A memory size or grow result, in the memory's address type. */
const sizeValue = (n: bigint, is64: boolean): Value =>
  is64
    ? { type: ValType.I64, value: BigInt.asIntN(64, n) }
    : { type: ValType.I32, value: Number(BigInt.asIntN(32, n)) };

/** Runs a memory operation; an access out of bounds is the spec's trap, too large a Stop. */
function memoryOp<T>(run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof OutOfBounds) throw new Trap('out of bounds memory access');
    if (e instanceof TooLarge) throw new Stop('unsupported', e.message);
    throw e;
  }
}

/** Runs a table operation; an access out of bounds is the spec's trap, too large a Stop. */
function tableOp<T>(run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof TableOutOfBounds) throw new Trap('out of bounds table access');
    if (e instanceof TableTooLarge) throw new Stop('unsupported', e.message);
    throw e;
  }
}

/** `ref.eq`: both null, two i31s of one value, or the same struct / array. */
function sameRef(a: Value, b: Value): boolean {
  if (a.type !== 'ref' || b.type !== 'ref') throw new Error('interp: ref.eq of a non-reference');
  if (a.kind === 'null' || b.kind === 'null') return a.kind === b.kind;
  if (a.kind === 'i31' && b.kind === 'i31') return a.value === b.value;
  if (a.kind === 'extern' && b.kind === 'extern') return a.host === b.host;
  return a === b;
}

/** A module's canonical types; one this cannot canonicalise is a Stop, never a guess. */
function typesOf(entries: readonly TypeEntry[]): ModuleTypes {
  try {
    return new ModuleTypes(entries);
  } catch (e) {
    throw new Stop('unsupported', `type section: ${e instanceof Error ? e.message : e}`);
  }
}

/** What a non-null reference IS, for a cast. */
function shapeOf(r: Ref): RefShape {
  switch (r.kind) {
    case 'null':
      return { kind: 'null' };
    case 'func':
      return { kind: 'func', rtt: r.func.rtt };
    case 'struct':
    case 'array':
      return { kind: r.kind, rtt: r.rtt };
    default:
      return { kind: r.kind };
  }
}

/** The zero a GC field of `type` holds by default (`struct.new_default`, `array.new_default`). */
function fieldDefault(type: StorageType): Value {
  if (type === Type.I8 || type === Type.I16) return { type: ValType.I32, value: 0 };
  if (type === ValType.V128) return { type: ValType.V128, bytes: new Uint8Array(16) };
  const z = zeroOf(type as ValueType);
  if (z === undefined) throw new Stop('unsupported', `a field of type ${String(type)}`);
  return z;
}

/** A value as a field of `type` stores it: a packed field keeps its low 8 / 16 bits. */
function packField(type: StorageType, v: Value): Value {
  if (type === Type.I8) return { type: ValType.I32, value: (v as { value: number }).value & 0xff };
  if (type === Type.I16) {
    return { type: ValType.I32, value: (v as { value: number }).value & 0xffff };
  }
  return v;
}

/** A stored field as `get` / `get_s` / `get_u` reads it. */
function unpackField(type: StorageType, v: Value, signed: boolean | undefined): Value {
  if (type !== Type.I8 && type !== Type.I16) return v;
  const bits = type === Type.I8 ? 24 : 16;
  const raw = (v as { value: number }).value;
  return { type: ValType.I32, value: signed ? (raw << bits) >> bits : raw };
}

/** Elements beyond which an array allocation is refused here (a Stop, not a trap). */
const ARRAY_LIMIT = 10_000_000;

/** An `array.new*` length: unsigned, and a Stop past what this process allocates. */
function arrayLength(n: number): number {
  const len = n >>> 0;
  if (len > ARRAY_LIMIT) throw new Stop('unsupported', `an array of ${len} elements`);
  return len;
}

/** The index a struct field `Var` names. */
function fieldIndex(entry: Extract<TypeEntry, { kind: 'struct' }>, v: Var): number {
  const i = v.kind === 'index' ? v.value : entry.fields.findIndex((f) => f.name === v.name);
  if (i < 0 || i >= entry.fields.length) throw new Error('interp: unknown field');
  return i;
}

/** Bytes an element of `type` takes in a data segment (`array.new_data`, `array.init_data`). */
function storageBytes(type: StorageType): number {
  switch (type) {
    case Type.I8:
      return 1;
    case Type.I16:
      return 2;
    case ValType.I32:
    case ValType.F32:
      return 4;
    case ValType.I64:
    case ValType.F64:
      return 8;
    case ValType.V128:
      return 16;
    default:
      throw new Error('interp: a reference element cannot come from a data segment');
  }
}

/** One element of `type` read little-endian from `data` at `at`. */
function readElement(data: Uint8Array, at: number, type: StorageType): Value {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  switch (type) {
    case Type.I8:
      return { type: ValType.I32, value: v.getUint8(at) };
    case Type.I16:
      return { type: ValType.I32, value: v.getUint16(at, true) };
    case ValType.I32:
      return { type: ValType.I32, value: v.getInt32(at, true) };
    case ValType.I64:
      return { type: ValType.I64, value: v.getBigInt64(at, true) };
    case ValType.F32:
      return { type: ValType.F32, bits: v.getUint32(at, true) };
    case ValType.F64:
      return { type: ValType.F64, bits: v.getBigUint64(at, true) };
    default:
      return { type: ValType.V128, bytes: data.slice(at, at + 16) };
  }
}

/** A load's bytes as its value. */
function readValue(mem: MemoryCell, at: number, opcode: number): Value {
  const { bytes, signed, type } = loadShape(opcode);
  const v = mem.view;
  switch (type) {
    case ValType.I32:
      return {
        type,
        value: bytes === 1
          ? (signed ? v.getInt8(at) : v.getUint8(at))
          : bytes === 2
          ? (signed ? v.getInt16(at, true) : v.getUint16(at, true))
          : v.getInt32(at, true),
      };
    case ValType.I64:
      return {
        type,
        value: bytes === 8 ? v.getBigInt64(at, true) : BigInt(
          bytes === 1
            ? (signed ? v.getInt8(at) : v.getUint8(at))
            : bytes === 2
            ? (signed ? v.getInt16(at, true) : v.getUint16(at, true))
            : (signed ? v.getInt32(at, true) : v.getUint32(at, true)),
        ),
      };
    case ValType.F32:
      return { type, bits: v.getUint32(at, true) };
    case ValType.F64:
      return { type, bits: v.getBigUint64(at, true) };
    default:
      return { type: ValType.V128, bytes: mem.bytes.slice(at, at + 16) };
  }
}

/** A store's value as its bytes — the low `bytes` of it for a narrow store. */
function writeValue(mem: MemoryCell, at: number, opcode: number, value: Value): void {
  const { bytes } = storeShape(opcode);
  const v = mem.view;
  switch (value.type) {
    case ValType.I32:
      if (bytes === 1) v.setUint8(at, value.value & 0xff);
      else if (bytes === 2) v.setUint16(at, value.value & 0xffff, true);
      else v.setUint32(at, value.value >>> 0, true);
      return;
    case ValType.I64:
      if (bytes === 8) v.setBigUint64(at, BigInt.asUintN(64, value.value), true);
      else {
        const low = Number(BigInt.asUintN(bytes * 8, value.value));
        if (bytes === 1) v.setUint8(at, low);
        else if (bytes === 2) v.setUint16(at, low, true);
        else v.setUint32(at, low, true);
      }
      return;
    case ValType.F32:
      v.setUint32(at, value.bits >>> 0, true);
      return;
    case ValType.F64:
      v.setBigUint64(at, BigInt.asUintN(64, value.bits), true);
      return;
    case ValType.V128:
      mem.bytes.set(value.bytes, at);
      return;
    default:
      throw new Error('interp: a store of a reference');
  }
}

/** The bytes a `simd.load` reads: 8 for the extending loads, the lane's width for a splat or `_zero`. */
function simdLoadBytes(opcode: number): number {
  switch (opcode) {
    case SIMDLoadOp.Load8SplatVec128:
      return 1;
    case SIMDLoadOp.Load16SplatVec128:
      return 2;
    case SIMDLoadOp.Load32SplatVec128:
    case SIMDLoadOp.Load32ZeroVec128:
      return 4;
    default:
      return 8;
  }
}

/** The vector a `simd.load` makes of the `n` bytes at `at`. */
function simdLoadValue(mem: MemoryCell, at: number, opcode: number): Value {
  const v = mem.view;
  const out = new Uint8Array(16);
  const o = new DataView(out.buffer);
  switch (opcode) {
    case SIMDLoadOp.Load8SplatVec128:
      out.fill(v.getUint8(at));
      break;
    case SIMDLoadOp.Load16SplatVec128:
      for (let i = 0; i < 8; i++) o.setUint16(2 * i, v.getUint16(at, true), true);
      break;
    case SIMDLoadOp.Load32SplatVec128:
      for (let i = 0; i < 4; i++) o.setUint32(4 * i, v.getUint32(at, true), true);
      break;
    case SIMDLoadOp.Load64SplatVec128:
      for (let i = 0; i < 2; i++) o.setBigUint64(8 * i, v.getBigUint64(at, true), true);
      break;
    case SIMDLoadOp.Load8x8SVec128:
      for (let i = 0; i < 8; i++) o.setInt16(2 * i, v.getInt8(at + i), true);
      break;
    case SIMDLoadOp.Load8x8UVec128:
      for (let i = 0; i < 8; i++) o.setUint16(2 * i, v.getUint8(at + i), true);
      break;
    case SIMDLoadOp.Load16x4SVec128:
      for (let i = 0; i < 4; i++) o.setInt32(4 * i, v.getInt16(at + 2 * i, true), true);
      break;
    case SIMDLoadOp.Load16x4UVec128:
      for (let i = 0; i < 4; i++) o.setUint32(4 * i, v.getUint16(at + 2 * i, true), true);
      break;
    case SIMDLoadOp.Load32x2SVec128:
      for (let i = 0; i < 2; i++) o.setBigInt64(8 * i, BigInt(v.getInt32(at + 4 * i, true)), true);
      break;
    case SIMDLoadOp.Load32x2UVec128:
      for (let i = 0; i < 2; i++) {
        o.setBigUint64(8 * i, BigInt(v.getUint32(at + 4 * i, true)), true);
      }
      break;
    case SIMDLoadOp.Load32ZeroVec128:
      o.setUint32(0, v.getUint32(at, true), true);
      break;
    case SIMDLoadOp.Load64ZeroVec128:
      o.setBigUint64(0, v.getBigUint64(at, true), true);
      break;
    default:
      throw new Error(`interp: not a simd.load opcode 0x${opcode.toString(16)}`);
  }
  return { type: ValType.V128, bytes: out };
}

/** A lane load / store's width in bytes, and whether it stores. */
function laneAccess(opcode: number): { bytes: number; store: boolean } {
  switch (opcode) {
    case SIMDLoadStoreLaneOp.Load8LaneVec128:
      return { bytes: 1, store: false };
    case SIMDLoadStoreLaneOp.Load16LaneVec128:
      return { bytes: 2, store: false };
    case SIMDLoadStoreLaneOp.Load32LaneVec128:
      return { bytes: 4, store: false };
    case SIMDLoadStoreLaneOp.Load64LaneVec128:
      return { bytes: 8, store: false };
    case SIMDLoadStoreLaneOp.Store8LaneVec128:
      return { bytes: 1, store: true };
    case SIMDLoadStoreLaneOp.Store16LaneVec128:
      return { bytes: 2, store: true };
    case SIMDLoadStoreLaneOp.Store32LaneVec128:
      return { bytes: 4, store: true };
    case SIMDLoadStoreLaneOp.Store64LaneVec128:
      return { bytes: 8, store: true };
    default:
      throw new Error(`interp: not a lane access opcode 0x${opcode.toString(16)}`);
  }
}

/** Pops a vector's bytes. */
function vectorOf(v: Value): Uint8Array {
  if (v.type !== ValType.V128) throw new Error('interp: expected a v128 operand');
  return v.bytes;
}

const I64 = (value: bigint): Value => ({ type: ValType.I64, value: BigInt.asIntN(64, value) });

/** A 128-bit value from its `(lo, hi)` i64 halves, unsigned. */
const wide = (lo: bigint, hi: bigint): bigint =>
  (BigInt.asUintN(64, hi) << 64n) | BigInt.asUintN(64, lo);
/** A 128-bit value as its `(lo, hi)` i64 halves. */
const halves = (x: bigint): Value[] => [I64(BigInt.asUintN(64, x)), I64(x >> 64n)];

/** The zero a local of `type` starts with; `undefined` for a type not run yet. */
function zeroOf(type: ValueType): Value | undefined {
  switch (type) {
    case ValType.I32:
      return { type: ValType.I32, value: 0 };
    case ValType.I64:
      return { type: ValType.I64, value: 0n };
    case ValType.F32:
      return { type: ValType.F32, bits: 0 };
    case ValType.F64:
      return { type: ValType.F64, bits: 0n };
    case ValType.V128:
      return { type: ValType.V128, bytes: new Uint8Array(16) };
    default:
      // A reference local starts null. (A non-nullable one is set before any
      // read — validation's guarantee — so its start value is never seen.)
      return isRef(type) ? NULL : undefined;
  }
}

const arityOf = (
  t: BlockResult | string,
): number => (t === 'none' || t === 'unreachable' ? 0 : Array.isArray(t) ? t.length : 1);

function resolve<T>(v: Var, slots: T[], names: string[], what: string): T {
  const i = v.kind === 'index' ? v.value : names.indexOf(v.name);
  const slot = slots[i];
  if (slot === undefined) {
    throw new Error(`interp: unknown ${what} ${v.kind === 'index' ? v.value : v.name}`);
  }
  return slot;
}

/**
 * One instantiated module. Instantiation evaluates the global initialisers and
 * runs the start function, which may trap or stop like any call.
 */
export class Interpreter {
  private readonly funcs: FuncSlot[] = [];
  private readonly funcNames: string[] = [];
  private readonly globals: GlobalCell[] = [];
  private readonly globalNames: string[] = [];
  private readonly memories: MemoryCell[] = [];
  private readonly memoryNames: string[] = [];
  /** Each data segment's bytes; a dropped one is empty. */
  private readonly data: Uint8Array[] = [];
  private readonly tables: TableCell<Value>[] = [];
  private readonly tableNames: string[] = [];
  /** Each element segment's references; a dropped one is empty. */
  private readonly elems: Value[][] = [];
  private readonly tags: TagCell[] = [];
  private readonly tagNames: string[] = [];
  /** The exceptions legacy `catch` bodies are handling, innermost last — what `rethrow $l` finds. */
  private readonly handling: { label: string; exn: WasmException }[] = [];
  private readonly stack: Value[] = [];
  private readonly maxDepth: number;
  /** This module's types, canonical across every module (E3d-2). */
  readonly types: ModuleTypes;
  private depth = 0;
  private fuel: number;

  constructor(readonly module: WasmModule, options: InterpreterOptions = {}) {
    this.maxDepth = options.maxDepth ?? 1000;
    this.types = typesOf(module.types);
    this.fuel = options.fuel ?? Infinity;
    const host = options.imports ?? (() => undefined);

    for (const imp of module.imports) {
      if (imp.kind === ExternalKind.Func && imp.exact) {
        throw new Stop('unsupported', 'an exact function import (custom descriptors)');
      }
      if (imp.kind === ExternalKind.Func) {
        const h = host(imp.module, imp.field);
        this.funcs.push({
          kind: 'host',
          name: `${imp.module}.${imp.field}`,
          call: h?.kind === 'func' ? h.call : undefined,
          sig: imp.func.sig,
          rtt: imp.func.typeVar !== undefined
            ? this.types.of(imp.func.typeVar)
            : this.types.ofSig(imp.func.sig),
          ...(h?.kind === 'func' && h.func !== undefined ? { func: h.func } : {}),
        });
        this.funcNames.push(imp.func.name);
      } else if (imp.kind === ExternalKind.Global) {
        const h = host(imp.module, imp.field);
        if (h?.kind !== 'global') throw new Stop('host', `global ${imp.module}.${imp.field}`);
        this.globals.push(h.cell);
        this.globalNames.push(imp.global.name);
      } else if (imp.kind === ExternalKind.Memory) {
        const h = host(imp.module, imp.field);
        if (h?.kind !== 'memory') throw new Stop('host', `memory ${imp.module}.${imp.field}`);
        this.memories.push(h.cell);
        this.memoryNames.push(imp.memory.name);
      } else if (imp.kind === ExternalKind.Table) {
        const h = host(imp.module, imp.field);
        if (h?.kind !== 'table') throw new Stop('host', `table ${imp.module}.${imp.field}`);
        this.tables.push(h.cell);
        this.tableNames.push(imp.table.name);
      } else if (imp.kind === ExternalKind.Tag) {
        const h = host(imp.module, imp.field);
        if (h?.kind !== 'tag') throw new Stop('host', `tag ${imp.module}.${imp.field}`);
        this.tags.push(h.cell);
        this.tagNames.push(imp.tag.name);
      }
    }
    for (const fn of module.functions) {
      this.funcs.push({
        kind: 'defined',
        fn,
        sig: fn.sig,
        rtt: fn.typeVar !== undefined ? this.types.of(fn.typeVar) : this.types.ofSig(fn.sig),
      });
      this.funcNames.push(fn.name);
    }
    for (const m of module.memories) {
      if (m.limits.isShared) throw new Stop('unsupported', 'a shared memory');
      try {
        this.memories.push(new MemoryCell(m.limits));
      } catch (e) {
        if (e instanceof TooLarge) throw new Stop('unsupported', e.message);
        throw e;
      }
      this.memoryNames.push(m.name);
    }
    for (const g of module.globals) {
      // An initialiser is a constant expression: it may read the globals
      // before it, and nothing else this interpreter cannot run.
      const [value] = this.evaluate(g.init?.children ?? [], 1);
      this.globals.push({ value: value! });
      this.globalNames.push(g.name);
    }
    for (const t of module.tags) {
      this.tags.push({ name: t.name, sig: t.sig });
      this.tagNames.push(t.name);
    }
    // Tables, each filled with its initialiser or null (E3c).
    for (const t of module.tables) {
      const [init] = t.init === undefined ? [NULL] : this.evaluate(t.init.children, 1);
      this.tables.push(tableOp(() => new TableCell<Value>(t.limits, init!)));
      this.tableNames.push(t.name);
    }
    // Element segments: every one's references are computed now; an active one
    // is written and dropped, a declared one only dropped; one out of bounds
    // traps, keeping what the segments before it wrote — the same order as data.
    for (const s of module.elements) {
      this.elems.push(s.elemExprs.map((r) => this.evaluate(r.children, 1)[0]!));
      if (s.kind === 'passive') continue;
      if (s.kind === 'active') {
        const [offset] = this.evaluate(s.offset?.children ?? [], 1);
        const table = resolve(s.tableVar, this.tables, this.tableNames, 'table');
        const refs = this.elems[this.elems.length - 1]!;
        tableOp(() => table.init(address(offset!), refs, 0n, BigInt(refs.length)));
      }
      this.elems[this.elems.length - 1] = [];
    }
    // Data segments, in order: an active one is written and then dropped; one
    // out of bounds traps, keeping what the segments before it wrote (the
    // spec's order since bulk memory — observable through a shared memory).
    for (const d of module.dataSegments) {
      this.data.push(d.data);
      if (d.kind !== 'active') continue;
      const [offset] = this.evaluate(d.offset?.children ?? [], 1);
      const mem = resolve(d.memoryVar, this.memories, this.memoryNames, 'memory');
      try {
        mem.init(address(offset!), d.data, 0n, BigInt(d.data.length));
      } catch (e) {
        if (e instanceof OutOfBounds) throw new Trap('out of bounds memory access');
        throw e;
      }
      this.data[this.data.length - 1] = EMPTY;
    }
    if (module.start !== undefined && (options.runStart ?? true)) {
      this.call(resolve(module.start, this.funcs, this.funcNames, 'function'), []);
    }
  }

  /** Calls the exported function `name` with `args`; throws {@link Trap} or {@link Stop}. */
  invoke(name: string, args: Value[]): Value[] {
    const ex = this.module.exports.find((e) => e.name === name && e.kind === ExternalKind.Func);
    if (ex === undefined) throw new Error(`interp: no exported function "${name}"`);
    return this.call(resolve(ex.var, this.funcs, this.funcNames, 'function'), args);
  }

  /** The index-space index of the function `v` names. */
  functionIndex(v: Var): number {
    const i = v.kind === 'index' ? v.value : this.funcNames.indexOf(v.name);
    if (this.funcs[i] === undefined) throw new Error('interp: unknown function');
    return i;
  }

  /** This instance's live state — see {@link InstanceState}. */
  state(): InstanceState {
    return {
      memories: this.memories,
      globals: this.globals,
      tables: this.tables,
      data: this.data,
      elems: this.elems,
    };
  }

  /**
   * Runs function `index`'s body one top-level statement at a time, for
   * `wasm-ctor-eval`: after each statement that completes, `after` is told
   * which one, the locals as they stand, and whether the operand stack is
   * empty there (a point the body can be cut at). A trap, a {@link Stop}, an
   * exception — or a Stop `after` throws — leaves the state as it is at that
   * moment; the caller holds its own snapshot. Returns the results when the
   * body completes (by falling off its end or by `return`); a tail call from
   * the body is a Stop.
   */
  runStatements(
    index: number,
    args: Value[],
    after: (statement: number, locals: readonly Value[], stackEmpty: boolean) => void,
  ): Value[] {
    const f = this.funcs[index];
    if (f === undefined) throw new Error(`interp: no function ${index}`);
    if (f.kind === 'host') throw new Stop('host', f.name);
    const { fn, sig } = f;
    const locals: Value[] = [...args];
    for (let i = sig.params.length; i < fn.locals.length; i++) {
      const z = zeroOf(fn.locals[i]!.type);
      if (z === undefined) {
        throw new Stop('unsupported', `a local of type ${String(fn.locals[i]!.type)}`);
      }
      locals.push(z);
    }
    const base = this.stack.length;
    const n = sig.results.length;
    this.depth++;
    try {
      for (const [k, e] of fn.body.children.entries()) {
        this.exec(e, locals);
        after(k, locals, this.stack.length === base);
      }
    } catch (t) {
      if (t instanceof TailCall) {
        this.stack.length = base;
        throw new Stop('unsupported', 'a tail call from a constructor');
      }
      const frame = t instanceof Branch && (t.label === '' || t.label === fn.bodyFrameLabel);
      if (t !== RETURN && !frame) {
        this.stack.length = base;
        if (t instanceof Delegate && (t.label === '' || t.label === fn.bodyFrameLabel)) throw t.exn;
        if (t instanceof RangeError && t.message.includes('call stack')) {
          throw new Trap('call stack exhausted');
        }
        throw t;
      }
    } finally {
      this.depth--;
    }
    const results = this.stack.splice(this.stack.length - n, n);
    this.stack.length = base;
    return results;
  }

  /** Sets the instructions left to run before a {@link Stop} with `fuel` — per call, for a caller that wants it. */
  refuel(fuel: number): void {
    this.fuel = fuel;
  }

  /** The current value of the exported global `name`. */
  global(name: string): Value {
    return this.globalCell(name).value;
  }

  /** The exported memory `name`'s cell — what another module importing it shares. */
  memoryCell(name: string): MemoryCell {
    const ex = this.module.exports.find((e) => e.name === name && e.kind === ExternalKind.Memory);
    if (ex === undefined) throw new Error(`interp: no exported memory "${name}"`);
    return resolve(ex.var, this.memories, this.memoryNames, 'memory');
  }

  /** The exported table `name`'s cell — what another module importing it shares. */
  tableCell(name: string): TableCell<Value> {
    const ex = this.module.exports.find((e) => e.name === name && e.kind === ExternalKind.Table);
    if (ex === undefined) throw new Error(`interp: no exported table "${name}"`);
    return resolve(ex.var, this.tables, this.tableNames, 'table');
  }

  /** The exported tag `name`'s cell — what another module importing it shares, and catches by. */
  tagCell(name: string): TagCell {
    const ex = this.module.exports.find((e) => e.name === name && e.kind === ExternalKind.Tag);
    if (ex === undefined) throw new Error(`interp: no exported tag "${name}"`);
    return resolve(ex.var, this.tags, this.tagNames, 'tag');
  }

  /** Calls function `index` of this instance — how a {@link FuncRef} from any table runs. */
  callIndex(index: number, args: Value[]): Value[] {
    const f = this.funcs[index];
    if (f === undefined) throw new Error(`interp: no function ${index}`);
    return this.call(f, args);
  }

  /** What the export `name` is — for a host wiring one module's exports to another's imports. */
  exportKind(name: string): ExternalKind | undefined {
    return this.module.exports.find((e) => e.name === name)?.kind;
  }

  /** The exported global `name`'s cell — what another module importing it shares. */
  globalCell(name: string): GlobalCell {
    const ex = this.module.exports.find((e) => e.name === name && e.kind === ExternalKind.Global);
    if (ex === undefined) throw new Error(`interp: no exported global "${name}"`);
    return resolve(ex.var, this.globals, this.globalNames, 'global');
  }

  /** Runs `exprs` as a body with no locals and returns its top `results` values. */
  private evaluate(exprs: Expression[], results: number): Value[] {
    const base = this.stack.length;
    for (const e of exprs) this.exec(e, []);
    const out = this.stack.splice(this.stack.length - results);
    this.stack.length = base;
    return out;
  }

  private call(f: FuncSlot, args: Value[]): Value[] {
    // A loop, not recursion, for TAIL calls: a `return_call` replaces this
    // frame with its callee's, so a million-deep tail recursion runs in one
    // frame, as the spec requires (`return_call.wast` counts down from 10^6).
    for (;;) {
      if (f.kind === 'host') {
        if (f.call === undefined) throw new Stop('host', f.name);
        return f.call(args);
      }
      if (++this.depth > this.maxDepth) {
        this.depth--;
        throw new Trap('call stack exhausted');
      }
      const { fn, sig } = f;
      const locals: Value[] = [...args];
      for (let i = sig.params.length; i < fn.locals.length; i++) {
        const z = zeroOf(fn.locals[i]!.type);
        if (z === undefined) {
          this.depth--;
          throw new Stop('unsupported', `a local of type ${String(fn.locals[i]!.type)}`);
        }
        locals.push(z);
      }
      const base = this.stack.length;
      const n = sig.results.length;
      try {
        for (const e of fn.body.children) this.exec(e, locals);
      } catch (t) {
        if (t instanceof TailCall) {
          this.depth--;
          this.stack.length = base;
          if (t.func.owner !== this) return t.func.owner.callIndex(t.func.index, t.args);
          f = this.funcs[t.func.index]!;
          args = t.args;
          continue;
        }
        // A `return`, or a branch to the function's own frame, leaves with the
        // top values the function returns.
        const frame = t instanceof Branch && (t.label === '' || t.label === fn.bodyFrameLabel);
        if (t !== RETURN && !frame) {
          this.depth--;
          this.stack.length = base;
          // `delegate` to the function's own frame: the exception leaves it.
          if (t instanceof Delegate && (t.label === '' || t.label === fn.bodyFrameLabel)) {
            throw t.exn;
          }
          // The host's own stack ran out first: to the program that is the same
          // exhaustion. 🔧 This tested the message with a regex, and at the
          // stack's limit the regex ITSELF overflowed (spec `fac.wast`'s
          // `fac-rec`). Whatever the test throws here propagates to the caller's
          // frame, which tries again with more room.
          if (t instanceof RangeError && t.message.includes('call stack')) {
            throw new Trap('call stack exhausted');
          }
          throw t;
        }
      }
      this.depth--;
      const results = this.stack.splice(this.stack.length - n, n);
      this.stack.length = base;
      return results;
    }
  }

  /** The function a reference names, or the trap a null one is. */
  private funcOf(r: Value, nullTrap: string): FuncRef {
    if (r.type !== 'ref') throw new Error('interp: expected a reference');
    if (r.kind === 'null') throw new Trap(nullTrap);
    if (r.kind !== 'func') throw new Error('interp: expected a function reference');
    return r.func;
  }

  /** Calls `func` with the top values of the stack — or, for a tail call, hands it to `call`. */
  private invokeRef(func: FuncRef, tail: boolean | undefined): void {
    const s = this.stack;
    const args = s.splice(s.length - func.sig.params.length);
    if (tail) throw new TailCall(func, args);
    s.push(
      ...(func.owner === this
        ? this.call(this.funcs[func.index]!, args)
        : func.owner.callIndex(func.index, args)),
    );
  }

  private pop(): Value {
    const v = this.stack.pop();
    if (v === undefined) throw new Error('interp: operand stack underflow');
    return v;
  }

  /** Pops a number — what every numeric operator takes. */
  private num(): Literal {
    const v = this.pop();
    if (!isNumber(v)) throw new Error('interp: expected a number, found a reference');
    return v;
  }

  private i32(): number {
    const v = this.pop();
    if (v.type !== ValType.I32) throw new Error('interp: expected an i32 operand');
    return v.value | 0;
  }

  private i64(): bigint {
    const v = this.pop();
    if (v.type !== ValType.I64) throw new Error('interp: expected an i64 operand');
    return BigInt.asIntN(64, v.value);
  }

  /** Runs a labelled construct whose body is `run`; a branch to `label` ends it with `arity` values. */
  private scope(label: string, base: number, arity: number, run: () => void): void {
    try {
      run();
    } catch (t) {
      // A `delegate` to a construct that is not a `try` goes on outward, as
      // if thrown from that construct (a `try` handles its own, in `Try`).
      if (t instanceof Delegate && label !== '' && t.label === label) throw t.exn;
      if (!(t instanceof Branch) || label === '' || t.label !== label) throw t;
    }
    const results = this.stack.splice(this.stack.length - arity, arity);
    this.stack.length = base;
    this.stack.push(...results);
  }

  private exec(e: Expression, locals: Value[]): void {
    if (--this.fuel < 0) throw new Stop('fuel', 'out of fuel');
    const s = this.stack;
    switch (e.kind) {
      case ExpressionKind.Nop:
      case ExpressionKind.Pop:
        return;

      case ExpressionKind.Const:
        s.push(e.value);
        return;

      case ExpressionKind.LocalGet:
        s.push(locals[(e.var as Extract<Var, { kind: 'index' }>).value]!);
        return;
      case ExpressionKind.LocalSet:
        this.exec(e.value, locals);
        locals[(e.var as Extract<Var, { kind: 'index' }>).value] = this.pop();
        return;
      case ExpressionKind.LocalTee: {
        this.exec(e.value, locals);
        const v = this.pop();
        locals[(e.var as Extract<Var, { kind: 'index' }>).value] = v;
        s.push(v);
        return;
      }

      case ExpressionKind.GlobalGet:
        s.push(resolve(e.var, this.globals, this.globalNames, 'global').value);
        return;
      case ExpressionKind.GlobalSet: {
        this.exec(e.value, locals);
        resolve(e.var, this.globals, this.globalNames, 'global').value = this.pop();
        return;
      }

      case ExpressionKind.Unary: {
        this.exec(e.value, locals);
        const r = evalUnary(e.opcode, this.num());
        if (r === null) throw new Stop('unsupported', `unary 0x${e.opcode.toString(16)}`);
        if ('trap' in r) throw new Trap(r.trap);
        s.push(r.value);
        return;
      }
      case ExpressionKind.Binary: {
        this.exec(e.left, locals);
        this.exec(e.right, locals);
        const b = this.num(), a = this.num();
        // Wide arithmetic: two i64 in, the 128-bit product out as two i64.
        if (e.opcode === BinaryOp.MulWideSInt64 || e.opcode === BinaryOp.MulWideUInt64) {
          if (a.type !== ValType.I64 || b.type !== ValType.I64) {
            throw new Error('interp: i64.mul_wide of non-i64 operands');
          }
          const signed = e.opcode === BinaryOp.MulWideSInt64;
          const x = signed ? BigInt.asIntN(64, a.value) : BigInt.asUintN(64, a.value);
          const y = signed ? BigInt.asIntN(64, b.value) : BigInt.asUintN(64, b.value);
          s.push(...halves(x * y));
          return;
        }
        const r = evalBinary(e.opcode, a, b);
        if (r === null) throw new Stop('unsupported', `binary 0x${e.opcode.toString(16)}`);
        if ('trap' in r) throw new Trap(r.trap);
        s.push(r.value);
        return;
      }

      case ExpressionKind.Quaternary: {
        // `i64.add128` / `sub128`: two 128-bit values as (lo, hi) pairs, the
        // 128-bit sum or difference as a (lo, hi) pair, wrapping.
        this.exec(e.a, locals);
        this.exec(e.b, locals);
        this.exec(e.c, locals);
        this.exec(e.d, locals);
        const yh = this.i64(), yl = this.i64(), xh = this.i64(), xl = this.i64();
        const x = wide(xl, xh), y = wide(yl, yh);
        s.push(...halves(e.opcode === QuaternaryOp.Add128 ? x + y : x - y));
        return;
      }

      // -------------------------------------------------------------------
      // SIMD (E3e): lanes, shuffles, ternaries — the operators are `simd.ts`'s
      // -------------------------------------------------------------------
      case ExpressionKind.SIMDExtract: {
        this.exec(e.vec, locals);
        const r = simdExtract(e.opcode, vectorOf(this.pop()), e.lane);
        if (r === null || 'trap' in r) throw new Error('interp: not a lane extraction');
        s.push(r.value);
        return;
      }
      case ExpressionKind.SIMDReplace: {
        this.exec(e.vec, locals);
        this.exec(e.value, locals);
        const value = this.num();
        const r = simdReplace(e.opcode, vectorOf(this.pop()), e.lane, value);
        if (r === null || 'trap' in r) throw new Error('interp: not a lane replacement');
        s.push(r.value);
        return;
      }
      case ExpressionKind.SIMDShuffle: {
        this.exec(e.left, locals);
        this.exec(e.right, locals);
        const b = vectorOf(this.pop()), a = vectorOf(this.pop());
        s.push(simdShuffle(a, b, e.lanes).value);
        return;
      }
      case ExpressionKind.SIMDTernary: {
        this.exec(e.a, locals);
        this.exec(e.b, locals);
        this.exec(e.c, locals);
        const c = vectorOf(this.pop()), b = vectorOf(this.pop()), a = vectorOf(this.pop());
        const r = simdTernary(e.opcode, a, b, c);
        if (r === null) throw new Stop('unsupported', `simd.ternary 0x${e.opcode.toString(16)}`);
        if ('trap' in r) throw new Trap(r.trap);
        s.push(r.value);
        return;
      }
      case ExpressionKind.SIMDLoad: {
        this.exec(e.address, locals);
        const mem = this.memory(e.memidx);
        const n = simdLoadBytes(e.opcode);
        const at = memoryOp(() => mem.at(address(this.pop()), e.offset, n));
        s.push(simdLoadValue(mem, at, e.opcode));
        return;
      }
      case ExpressionKind.SIMDLoadStoreLane: {
        this.exec(e.address, locals);
        this.exec(e.vec, locals);
        const mem = this.memory(e.memidx);
        const vec = vectorOf(this.pop());
        const { bytes, store } = laneAccess(e.opcode);
        const at = memoryOp(() => mem.at(address(this.pop()), e.offset, bytes));
        const laneAt = e.lane * bytes;
        if (store) {
          mem.bytes.set(vec.subarray(laneAt, laneAt + bytes), at);
          return;
        }
        const out = vec.slice();
        out.set(mem.bytes.subarray(at, at + bytes), laneAt);
        s.push({ type: ValType.V128, bytes: out });
        return;
      }

      case ExpressionKind.Select: {
        this.exec(e.val1, locals);
        this.exec(e.val2, locals);
        this.exec(e.condition, locals);
        const c = this.i32(), b = this.pop(), a = this.pop();
        s.push(c !== 0 ? a : b);
        return;
      }
      case ExpressionKind.Drop:
        this.exec(e.value, locals);
        this.pop();
        return;

      case ExpressionKind.Region:
        for (const c of e.children) this.exec(c, locals);
        return;

      case ExpressionKind.Block: {
        const params = this.params(e, locals);
        const base = s.length - params;
        this.scope(e.label, base, arityOf(e.type as BlockResult), () => {
          for (const c of e.children) this.exec(c, locals);
        });
        return;
      }

      case ExpressionKind.Loop: {
        const params = this.params(e, locals);
        const base = s.length - params;
        const results = arityOf(e.type as BlockResult);
        for (;;) {
          try {
            this.exec(e.body, locals);
          } catch (t) {
            if (t instanceof Delegate && t.label === e.label) throw t.exn;
            if (!(t instanceof Branch) || t.label !== e.label) throw t;
            // Back to the top, with the loop's parameters.
            const carried = s.splice(s.length - params, params);
            s.length = base;
            s.push(...carried);
            continue;
          }
          break;
        }
        const out = s.splice(s.length - results, results);
        s.length = base;
        s.push(...out);
        return;
      }

      case ExpressionKind.If: {
        const params = this.params(e, locals);
        this.exec(e.condition, locals);
        const c = this.i32();
        const base = s.length - params;
        const arm = c !== 0 ? e.ifTrue : e.ifFalse;
        this.scope(e.label, base, arityOf(e.type as BlockResult), () => {
          if (arm !== null) this.exec(arm, locals);
        });
        return;
      }

      case ExpressionKind.Break: {
        for (const v of e.values) this.exec(v, locals);
        if (e.condition !== undefined) {
          this.exec(e.condition, locals);
          if (this.i32() === 0) return; // falls through, its values left as its result
        }
        throw new Branch(labelName(e.target));
      }

      case ExpressionKind.Switch: {
        for (const v of e.values) this.exec(v, locals);
        this.exec(e.condition, locals);
        const i = this.i32() >>> 0;
        throw new Branch(labelName(i < e.targets.length ? e.targets[i]! : e.defaultTarget));
      }

      case ExpressionKind.Return:
        for (const v of e.values) this.exec(v, locals);
        throw RETURN;

      case ExpressionKind.Unreachable:
        throw new Trap('unreachable');

      case ExpressionKind.Call: {
        for (const o of e.operands) this.exec(o, locals);
        this.invokeRef(this.funcRef(e.func), e.isReturn);
        return;
      }

      // -------------------------------------------------------------------
      // References and tables (E3c)
      // -------------------------------------------------------------------
      case ExpressionKind.CallIndirect: {
        for (const o of e.operands) this.exec(o, locals);
        this.exec(e.callee, locals);
        const table = this.table(e.table);
        const i = address(this.pop());
        // The spec's order: an index past the end, then an empty slot, then a
        // signature that does not match.
        if (i >= table.size) throw new Trap('undefined element');
        // The reference interpreter names the slot (`uninitialized element 2`);
        // the suite expects both that and the bare prefix.
        const func = this.funcOf(table.get(i), `uninitialized element ${i}`);
        // Since GC, function types match by IDENTITY — rec-group
        // canonicalisation — and declared subtyping, not by shape: two `(func)`
        // types in different rec groups differ, and a subtype matches its
        // supertype (`type-rec.wast`, `type-subtyping.wast`). Canonical types
        // are shared across modules, so this compares a callee from any table.
        const expected = e.typeVar !== undefined
          ? this.types.of(e.typeVar)
          : this.types.ofSig(e.sig);
        if (!func.rtt.isSubtypeOf(expected)) throw new Trap('indirect call type mismatch');
        this.invokeRef(func, e.isReturn);
        return;
      }
      case ExpressionKind.CallRef: {
        for (const o of e.operands) this.exec(o, locals);
        this.exec(e.callee, locals);
        this.invokeRef(this.funcOf(this.pop(), 'null function reference'), e.isReturn);
        return;
      }
      case ExpressionKind.RefNull:
        s.push(NULL);
        return;
      case ExpressionKind.RefFunc:
        s.push({ type: 'ref', kind: 'func', func: this.funcRef(e.func) });
        return;
      case ExpressionKind.RefIsNull: {
        this.exec(e.value, locals);
        const r = this.pop();
        s.push({ type: ValType.I32, value: r.type === 'ref' && r.kind === 'null' ? 1 : 0 });
        return;
      }
      case ExpressionKind.RefAs: {
        this.exec(e.value, locals);
        const r = this.pop();
        if (r.type === 'ref' && r.kind === 'null') throw new Trap('null reference');
        s.push(r);
        return;
      }
      case ExpressionKind.RefEq: {
        this.exec(e.left, locals);
        this.exec(e.right, locals);
        const b = this.pop(), a = this.pop();
        s.push({ type: ValType.I32, value: sameRef(a, b) ? 1 : 0 });
        return;
      }
      case ExpressionKind.TableGet: {
        this.exec(e.index, locals);
        const table = this.table(e.table);
        const i = address(this.pop());
        s.push(tableOp(() => table.get(i)));
        return;
      }
      case ExpressionKind.TableSet: {
        this.exec(e.index, locals);
        this.exec(e.value, locals);
        const table = this.table(e.table);
        const v = this.pop(), i = address(this.pop());
        tableOp(() => table.set(i, v));
        return;
      }
      case ExpressionKind.TableSize: {
        const table = this.table(e.table);
        s.push(sizeValue(table.size, table.is64));
        return;
      }
      case ExpressionKind.TableGrow: {
        this.exec(e.value, locals);
        this.exec(e.delta, locals);
        const table = this.table(e.table);
        const delta = address(this.pop()), init = this.pop();
        s.push(sizeValue(tableOp(() => table.grow(delta, init)), table.is64));
        return;
      }
      case ExpressionKind.TableFill: {
        this.exec(e.dest, locals);
        this.exec(e.value, locals);
        this.exec(e.size, locals);
        const table = this.table(e.table);
        const n = address(this.pop()), v = this.pop(), dest = address(this.pop());
        tableOp(() => table.fill(dest, v, n));
        return;
      }
      case ExpressionKind.TableCopy: {
        this.exec(e.dest, locals);
        this.exec(e.source, locals);
        this.exec(e.size, locals);
        const to = this.table(e.destTable), from = this.table(e.sourceTable);
        const n = address(this.pop()), src = address(this.pop()), dest = address(this.pop());
        tableOp(() => TableCell.copy(to, dest, from, src, n));
        return;
      }
      case ExpressionKind.TableInit: {
        this.exec(e.dest, locals);
        this.exec(e.source, locals);
        this.exec(e.size, locals);
        const table = this.table(e.table);
        const refs = resolve(
          e.segment,
          this.elems,
          this.module.elements.map((s) => s.name),
          'element segment',
        );
        const n = address(this.pop()), src = address(this.pop()), dest = address(this.pop());
        tableOp(() => table.init(dest, refs, src, n));
        return;
      }
      case ExpressionKind.ElemDrop: {
        const names = this.module.elements.map((s) => s.name);
        const i = e.segment.kind === 'index' ? e.segment.value : names.indexOf(e.segment.name);
        if (this.elems[i] === undefined) throw new Error('interp: unknown element segment');
        this.elems[i] = [];
        return;
      }

      // -------------------------------------------------------------------
      // GC (E3d-2): i31, structs, arrays, casts, conversions
      // -------------------------------------------------------------------
      case ExpressionKind.RefI31: {
        this.exec(e.value, locals);
        s.push({ type: 'ref', kind: 'i31', value: this.i32() & 0x7fffffff });
        return;
      }
      case ExpressionKind.I31Get: {
        this.exec(e.i31, locals);
        const r = this.nonNull('null i31 reference');
        if (r.kind !== 'i31') throw new Error('interp: i31.get of a non-i31');
        s.push({ type: ValType.I32, value: e.signed ? (r.value << 1) >> 1 : r.value });
        return;
      }
      case ExpressionKind.StructNew: {
        // Descriptors (custom descriptors proposal) are not run: a struct made
        // with one, and every cast by one, STOPS rather than run as plain.
        if (e.desc !== undefined) {
          throw new Stop('unsupported', 'struct.new_desc (custom descriptors)');
        }
        const { entry, rtt } = this.structType(e.typeVar);
        let fields: Value[];
        if (e.defaultInit) fields = entry.fields.map((f) => fieldDefault(f.type));
        else {
          for (const o of e.operands) this.exec(o, locals);
          fields = s.splice(s.length - entry.fields.length).map((v, i) =>
            packField(entry.fields[i]!.type, v)
          );
        }
        s.push({ type: 'ref', kind: 'struct', rtt, fields });
        return;
      }
      case ExpressionKind.StructGet: {
        this.exec(e.ref, locals);
        const { entry } = this.structType(e.typeVar);
        const r = this.nonNull('null structure reference');
        if (r.kind !== 'struct') throw new Error('interp: struct.get of a non-struct');
        const i = fieldIndex(entry, e.fieldVar);
        s.push(unpackField(entry.fields[i]!.type, r.fields[i]!, e.signed));
        return;
      }
      case ExpressionKind.StructSet: {
        this.exec(e.ref, locals);
        this.exec(e.value, locals);
        const { entry } = this.structType(e.typeVar);
        const v = this.pop();
        const r = this.nonNull('null structure reference');
        if (r.kind !== 'struct') throw new Error('interp: struct.set of a non-struct');
        const i = fieldIndex(entry, e.fieldVar);
        r.fields[i] = packField(entry.fields[i]!.type, v);
        return;
      }
      case ExpressionKind.ArrayNew: {
        const { field, rtt } = this.arrayType(e.typeVar);
        if (e.init !== undefined) this.exec(e.init, locals);
        this.exec(e.length, locals);
        const n = arrayLength(this.i32());
        const v = e.init !== undefined ? this.pop() : fieldDefault(field.type);
        s.push({
          type: 'ref',
          kind: 'array',
          rtt,
          elems: new Array<Value>(n).fill(packField(field.type, v)),
        });
        return;
      }
      case ExpressionKind.ArrayNewFixed: {
        const { field, rtt } = this.arrayType(e.typeVar);
        for (const o of e.operands) this.exec(o, locals);
        const elems = s.splice(s.length - e.operands.length).map((v) => packField(field.type, v));
        s.push({ type: 'ref', kind: 'array', rtt, elems });
        return;
      }
      case ExpressionKind.ArrayNewData: {
        const { field, rtt } = this.arrayType(e.typeVar);
        this.exec(e.offset, locals);
        this.exec(e.length, locals);
        const n = arrayLength(this.i32()), off = this.i32() >>> 0;
        const data = this.dataSegment(e.dataVar);
        const z = storageBytes(field.type);
        if (off + n * z > data.length) throw new Trap('out of bounds memory access');
        const elems = Array.from(
          { length: n },
          (_, k) => readElement(data, off + k * z, field.type),
        );
        s.push({ type: 'ref', kind: 'array', rtt, elems });
        return;
      }
      case ExpressionKind.ArrayNewElem: {
        const { rtt } = this.arrayType(e.typeVar);
        this.exec(e.offset, locals);
        this.exec(e.length, locals);
        const n = arrayLength(this.i32()), off = this.i32() >>> 0;
        const seg = this.elemSegment(e.elemVar);
        if (off + n > seg.length) throw new Trap('out of bounds table access');
        s.push({ type: 'ref', kind: 'array', rtt, elems: seg.slice(off, off + n) });
        return;
      }
      case ExpressionKind.ArrayGet: {
        this.exec(e.ref, locals);
        this.exec(e.index, locals);
        const { field } = this.arrayType(e.typeVar);
        const i = this.i32() >>> 0;
        const a = this.array();
        if (i >= a.elems.length) throw new Trap('out of bounds array access');
        s.push(unpackField(field.type, a.elems[i]!, e.signed));
        return;
      }
      case ExpressionKind.ArraySet: {
        this.exec(e.ref, locals);
        this.exec(e.index, locals);
        this.exec(e.value, locals);
        const { field } = this.arrayType(e.typeVar);
        const v = this.pop(), i = this.i32() >>> 0;
        const a = this.array();
        if (i >= a.elems.length) throw new Trap('out of bounds array access');
        a.elems[i] = packField(field.type, v);
        return;
      }
      case ExpressionKind.ArrayLen: {
        this.exec(e.ref, locals);
        s.push({ type: ValType.I32, value: this.array().elems.length | 0 });
        return;
      }
      case ExpressionKind.ArrayFill: {
        this.exec(e.ref, locals);
        this.exec(e.offset, locals);
        this.exec(e.value, locals);
        this.exec(e.size, locals);
        const { field } = this.arrayType(e.typeVar);
        const n = this.i32() >>> 0, v = this.pop(), off = this.i32() >>> 0;
        const a = this.array();
        if (off + n > a.elems.length) throw new Trap('out of bounds array access');
        a.elems.fill(packField(field.type, v), off, off + n);
        return;
      }
      case ExpressionKind.ArrayCopy: {
        this.exec(e.destRef, locals);
        this.exec(e.destOffset, locals);
        this.exec(e.srcRef, locals);
        this.exec(e.srcOffset, locals);
        this.exec(e.size, locals);
        const n = this.i32() >>> 0, so = this.i32() >>> 0;
        const src = this.array();
        const d = this.i32() >>> 0;
        const dest = this.array();
        if (so + n > src.elems.length || d + n > dest.elems.length) {
          throw new Trap('out of bounds array access');
        }
        // Overlapping ranges copy as if through a buffer.
        const moved = src.elems.slice(so, so + n);
        for (let k = 0; k < n; k++) dest.elems[d + k] = moved[k]!;
        return;
      }
      case ExpressionKind.ArrayInitData: {
        this.exec(e.ref, locals);
        this.exec(e.destOffset, locals);
        this.exec(e.srcOffset, locals);
        this.exec(e.size, locals);
        const { field } = this.arrayType(e.typeVar);
        const n = this.i32() >>> 0, so = this.i32() >>> 0, d = this.i32() >>> 0;
        const a = this.array();
        const data = this.dataSegment(e.segment);
        const z = storageBytes(field.type);
        if (d + n > a.elems.length) throw new Trap('out of bounds array access');
        if (so + n * z > data.length) throw new Trap('out of bounds memory access');
        for (let k = 0; k < n; k++) a.elems[d + k] = readElement(data, so + k * z, field.type);
        return;
      }
      case ExpressionKind.ArrayInitElem: {
        this.exec(e.ref, locals);
        this.exec(e.destOffset, locals);
        this.exec(e.srcOffset, locals);
        this.exec(e.size, locals);
        const n = this.i32() >>> 0, so = this.i32() >>> 0, d = this.i32() >>> 0;
        const a = this.array();
        const seg = this.elemSegment(e.segment);
        if (d + n > a.elems.length) throw new Trap('out of bounds array access');
        if (so + n > seg.length) throw new Trap('out of bounds table access');
        for (let k = 0; k < n; k++) a.elems[d + k] = seg[so + k]!;
        return;
      }
      case ExpressionKind.RefTest: {
        this.exec(e.ref, locals);
        const r = this.pop();
        s.push({ type: ValType.I32, value: this.inType(r, e.heapType, e.nullable) ? 1 : 0 });
        return;
      }
      case ExpressionKind.RefCast: {
        if (e.desc !== undefined) {
          throw new Stop('unsupported', 'ref.cast_desc_eq (custom descriptors)');
        }
        this.exec(e.ref, locals);
        const r = this.pop();
        if (!this.inType(r, e.heapType, e.nullable)) throw new Trap('cast failure');
        s.push(r);
        return;
      }
      case ExpressionKind.BrOn: {
        for (const v of e.values) this.exec(v, locals);
        this.exec(e.ref, locals);
        const r = this.pop();
        const isNull = r.type === 'ref' && r.kind === 'null';
        if (e.opcode === BrOnOp.Null) {
          // Taken: the carried values go, the null does not. Not taken: the
          // ref stays, now known non-null.
          if (isNull) throw new Branch(labelName(e.target));
          s.push(r);
        } else if (e.opcode === BrOnOp.NonNull) {
          if (isNull) return;
          s.push(r);
          throw new Branch(labelName(e.target));
        } else if (e.opcode === BrOnOp.Cast || e.opcode === BrOnOp.CastFail) {
          const to = e.to!;
          s.push(r);
          if (this.inType(r, to.heapType, to.nullable) === (e.opcode === BrOnOp.Cast)) {
            throw new Branch(labelName(e.target));
          }
        } else throw new Stop('unsupported', 'br_on_cast_desc_eq (custom descriptors)');
        return;
      }
      case ExpressionKind.AnyConvertExtern: {
        this.exec(e.value, locals);
        const r = this.pop();
        if (r.type !== 'ref' || r.kind === 'null') s.push(NULL);
        else if (r.kind === 'extern') {
          // An extern that `extern.convert_any` made gives back the very value.
          s.push(r.internal ?? { type: 'ref', kind: 'hostany', host: r.host });
        } else throw new Error('interp: any.convert_extern of a non-extern');
        return;
      }
      case ExpressionKind.ExternConvertAny: {
        this.exec(e.value, locals);
        const r = this.pop();
        if (r.type !== 'ref' || r.kind === 'null') s.push(NULL);
        else if (r.kind === 'hostany') s.push({ type: 'ref', kind: 'extern', host: r.host });
        else s.push({ type: 'ref', kind: 'extern', host: r, internal: r });
        return;
      }

      // -------------------------------------------------------------------
      // Exceptions (E3d)
      // -------------------------------------------------------------------
      case ExpressionKind.Throw: {
        for (const o of e.operands) this.exec(o, locals);
        const tag = resolve(e.tag, this.tags, this.tagNames, 'tag');
        throw new WasmException(tag, s.splice(s.length - tag.sig.params.length));
      }
      case ExpressionKind.ThrowRef: {
        this.exec(e.exnref, locals);
        const r = this.pop();
        if (r.type !== 'ref') throw new Error('interp: throw_ref of a number');
        if (r.kind === 'null') throw new Trap('null exception reference');
        if (r.kind !== 'exn') throw new Error('interp: throw_ref of a non-exception');
        throw r.exn;
      }
      case ExpressionKind.TryTable: {
        const params = this.params(e, locals);
        const base = s.length - params;
        try {
          this.scope(
            e.label,
            base,
            arityOf(e.type as BlockResult),
            () => this.exec(e.body, locals),
          );
        } catch (t) {
          if (!(t instanceof WasmException)) throw t;
          // The first clause that matches branches to ITS label, outside the
          // try_table, with the payload (and the exception, for a `_ref`). What
          // the body left below the payload needs no clearing: a branch carries
          // only the top values and its target truncates to its own base (a
          // mutant that skipped a reset here was equivalent).
          for (const c of e.catches) {
            if (c.tag !== undefined && this.tag(c.tag) !== t.tag) continue;
            if (c.tag !== undefined) s.push(...t.values);
            if (c.isRef) s.push({ type: 'ref', kind: 'exn', exn: t });
            throw new Branch(labelName(c.target));
          }
          throw t;
        }
        return;
      }
      case ExpressionKind.Try: {
        const params = this.params(e, locals);
        const base = s.length - params;
        this.scope(e.label, base, arityOf(e.type as BlockResult), () => {
          try {
            this.exec(e.body, locals);
          } catch (t) {
            // What reaches this try's handlers: an exception from its body,
            // or one a `delegate` inside it named this try for.
            let exn: WasmException;
            if (t instanceof WasmException) exn = t;
            else if (t instanceof Delegate && e.label !== '' && t.label === e.label) exn = t.exn;
            else throw t;
            if (e.delegate !== undefined) throw new Delegate(exn, labelName(e.delegate));
            for (const c of e.catches) {
              if (c.tag !== undefined && this.tag(c.tag) !== exn.tag) continue;
              // The handler starts from the try's own stack, the payload on it
              // for the handler's `pop`s.
              s.length = base;
              if (c.tag !== undefined) s.push(...exn.values);
              if (c.isRef) s.push({ type: 'ref', kind: 'exn', exn });
              this.handling.push({ label: e.label, exn });
              try {
                this.exec(c.body, locals);
              } finally {
                this.handling.pop();
              }
              return;
            }
            throw exn;
          }
        });
        return;
      }
      case ExpressionKind.Rethrow: {
        const label = labelName(e.target);
        for (let i = this.handling.length - 1; i >= 0; i--) {
          if (this.handling[i]!.label === label) throw this.handling[i]!.exn;
        }
        throw new Error(`interp: rethrow to "${label}", which no catch encloses`);
      }

      // -------------------------------------------------------------------
      // Linear memory (E3b)
      // -------------------------------------------------------------------
      case ExpressionKind.Load: {
        this.exec(e.address, locals);
        const mem = this.memory(e.memidx);
        const shape = loadShape(e.opcode);
        const at = memoryOp(() => mem.at(address(this.pop()), e.offset, shape.bytes));
        s.push(readValue(mem, at, e.opcode));
        return;
      }
      case ExpressionKind.Store: {
        this.exec(e.address, locals);
        this.exec(e.value, locals);
        const mem = this.memory(e.memidx);
        const value = this.pop();
        const at = memoryOp(() =>
          mem.at(address(this.pop()), e.offset, storeShape(e.opcode).bytes)
        );
        writeValue(mem, at, e.opcode, value);
        return;
      }
      case ExpressionKind.MemorySize: {
        const mem = this.memory(e.memidx);
        s.push(sizeValue(mem.pages, mem.is64));
        return;
      }
      case ExpressionKind.MemoryGrow: {
        this.exec(e.delta, locals);
        const mem = this.memory(e.memidx);
        const delta = address(this.pop());
        s.push(sizeValue(memoryOp(() => mem.grow(delta)), mem.is64));
        return;
      }
      case ExpressionKind.MemoryFill: {
        this.exec(e.dest, locals);
        this.exec(e.value, locals);
        this.exec(e.size, locals);
        const mem = this.memory(e.memidx);
        const n = address(this.pop()), value = this.i32(), dest = address(this.pop());
        memoryOp(() => mem.fill(dest, value, n));
        return;
      }
      case ExpressionKind.MemoryCopy: {
        this.exec(e.dest, locals);
        this.exec(e.source, locals);
        this.exec(e.size, locals);
        const to = this.memory(e.destMemidx), from = this.memory(e.srcMemidx);
        // The size is in the SMALLER address type of the two (memory64).
        const n = address(this.pop()), src = address(this.pop()), dest = address(this.pop());
        memoryOp(() => MemoryCell.copy(to, dest, from, src, n));
        return;
      }
      case ExpressionKind.MemoryInit: {
        this.exec(e.dest, locals);
        this.exec(e.source, locals);
        this.exec(e.size, locals);
        const mem = this.memory(e.memidx);
        const data = resolve(e.segment, this.data, this.dataNames(), 'data segment');
        const n = address(this.pop()), src = address(this.pop()), dest = address(this.pop());
        memoryOp(() => mem.init(dest, data, src, n));
        return;
      }
      case ExpressionKind.DataDrop: {
        const i = e.segment.kind === 'index'
          ? e.segment.value
          : this.dataNames().indexOf(e.segment.name);
        if (this.data[i] === undefined) throw new Error('interp: unknown data segment');
        this.data[i] = EMPTY;
        return;
      }

      default:
        throw new Stop('unsupported', e.kind);
    }
  }

  /** Pops a reference, trapping with `message` on null. */
  private nonNull(message: string): Ref {
    const r = this.pop();
    if (r.type !== 'ref') throw new Error('interp: expected a reference');
    if (r.kind === 'null') throw new Trap(message);
    return r;
  }

  /** Pops an array reference, trapping on null. */
  private array(): ArrayObj {
    const r = this.nonNull('null array reference');
    if (r.kind !== 'array') throw new Error('interp: expected an array');
    return r;
  }

  private structType(v: Var): { entry: Extract<TypeEntry, { kind: 'struct' }>; rtt: RttType } {
    const i = this.types.index(v);
    const entry = this.module.types[i]!;
    if (entry.kind !== 'struct') throw new Error('interp: not a struct type');
    return { entry, rtt: this.types.types[i]! };
  }

  private arrayType(
    v: Var,
  ): { field: Extract<TypeEntry, { kind: 'array' }>['field']; rtt: RttType } {
    const i = this.types.index(v);
    const entry = this.module.types[i]!;
    if (entry.kind !== 'array') throw new Error('interp: not an array type');
    return { field: entry.field, rtt: this.types.types[i]! };
  }

  private dataSegment(v: Var): Uint8Array {
    return resolve(v, this.data, this.dataNames(), 'data segment');
  }

  private elemSegment(v: Var): Value[] {
    return resolve(v, this.elems, this.module.elements.map((s) => s.name), 'element segment');
  }

  /** Whether `r` is in the reference type `(ref null? h)`. */
  private inType(r: Value, h: HeapTypeRef, nullable: boolean): boolean {
    if (r.type !== 'ref') throw new Error('interp: a cast of a number');
    if (r.kind === 'null') return nullable;
    return inHeap(shapeOf(r), this.heap(h));
  }

  private heap(h: HeapTypeRef): ResolvedHeap {
    if (h.kind === 'abstract') return { kind: 'abstract', name: h.name };
    if (h.kind === 'exact') return { kind: 'defined', rtt: this.types.of(h.type), exact: true };
    return { kind: 'defined', rtt: this.types.of(h), exact: false };
  }

  private tag(v: Var): TagCell {
    return resolve(v, this.tags, this.tagNames, 'tag');
  }

  private table(v: Var): TableCell<Value> {
    if (this.tables.length === 0) throw new Error('interp: no table');
    return resolve(v, this.tables, this.tableNames, 'table');
  }

  /** A reference to this instance's function `v`. */
  private funcRef(v: Var): FuncRef {
    const index = v.kind === 'index' ? v.value : this.funcNames.indexOf(v.name);
    const slot = this.funcs[index];
    if (slot === undefined) {
      throw new Error(`interp: unknown function ${v.kind === 'index' ? v.value : v.name}`);
    }
    if (slot.kind === 'host' && slot.func !== undefined) return slot.func;
    return { owner: this, index, sig: slot.sig, rtt: slot.rtt };
  }

  /** A reference to the exported function `name` — the function itself, for another instance to import. */
  funcRefOf(name: string): FuncRef {
    const ex = this.module.exports.find((e) => e.name === name && e.kind === ExternalKind.Func);
    if (ex === undefined) throw new Error(`interp: no exported function "${name}"`);
    return this.funcRef(ex.var);
  }

  private memory(v: Var): MemoryCell {
    if (this.memories.length === 0) throw new Error('interp: no memory');
    return resolve(v, this.memories, this.memoryNames, 'memory');
  }

  private dataNames(): string[] {
    return this.module.dataSegments.map((d) => d.name);
  }

  /** Evaluates a carrier's parameter values; returns how many it takes. */
  private params(e: Expression, locals: Value[]): number {
    const p = blockParamsOf(e);
    if (p === undefined) return 0;
    for (const v of p.values) this.exec(v, locals);
    return p.types.length;
  }
}
