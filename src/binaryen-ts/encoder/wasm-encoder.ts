/**
 * @module binaryen-ts/encoder/wasm-encoder
 *
 * WASM binary encoder: serializes a {@link WasmModule} IR tree into a `.wasm` binary.
 *
 * This is the inverse of the Phase 2 parser (`src/binaryen-ts/binary/wasm-parser.ts`).
 * The output is a valid WebAssembly 1.0 binary that can be re-parsed or executed.
 *
 * @license MIT
 */

import {
  type ArrayCopyExpr,
  type ArrayFillExpr,
  type ArrayGetExpr,
  type ArrayInitDataExpr,
  type ArrayInitElemExpr,
  type ArrayLenExpr,
  type ArrayNewDataExpr,
  type ArrayNewElemExpr,
  type ArrayNewExpr,
  type ArrayNewFixedExpr,
  type ArraySetExpr,
  type BinaryExpr,
  type BlockExpr,
  blockParamsOf,
  type BreakExpr,
  type BrOnExpr,
  BrOnOp,
  type CallExpr,
  type CallIndirectExpr,
  type ConstExpr,
  type DataDropExpr,
  type DropExpr,
  type ElemDropExpr,
  type Expression,
  ExpressionKind,
  type GlobalGetExpr,
  type GlobalSetExpr,
  type I31GetExpr,
  type IfExpr,
  type LoadExpr,
  type LocalGetExpr,
  type LocalSetExpr,
  type LocalTeeExpr,
  type LoopExpr,
  type MemoryCopyExpr,
  type MemoryFillExpr,
  type MemoryGrowExpr,
  type MemoryInitExpr,
  type MemorySizeExpr,
  type QuaternaryExpr,
  QuaternaryOp,
  type RefAsExpr,
  type RefCastExpr,
  type RefEqExpr,
  type RefFuncExpr,
  type RefI31Expr,
  type RefIsNullExpr,
  type RefNullExpr,
  type RefTestExpr,
  type RegionExpr,
  type RethrowExpr,
  type ReturnExpr,
  type SelectExpr,
  type SIMDExtractExpr,
  type SIMDLoadExpr,
  type SIMDLoadStoreLaneExpr,
  type SIMDReplaceExpr,
  type SIMDShuffleExpr,
  type SIMDTernaryExpr,
  type StoreExpr,
  type StructGetExpr,
  type StructNewExpr,
  type StructSetExpr,
  type SwitchExpr,
  type TableCopyExpr,
  type TableFillExpr,
  type TableGetExpr,
  type TableGrowExpr,
  type TableInitExpr,
  type TableSetExpr,
  type TableSizeExpr,
  type ThrowExpr,
  type ThrowRefExpr,
  type TryExpr,
  type TryTableExpr,
  typeOf,
  type UnaryExpr,
  writtenTypeIndexOf,
} from '../ir/expressions.ts';
import type { ExplicitNames, WasmFunction, WasmModule } from '../ir/module.ts';
import { isRef, None, type Type, Unreachable, ValType } from '../ir/types.ts';
// The ONE authoritative child enumeration. The encoder used to keep a private
// `walkChildren` copy for `collectExprTypes`; it silently `break`ed on any kind
// it did not list, and it did not list `TupleMake` (the container multi-value
// branches used before S6 decision 6A gave them a `values` list) — so a
// `call_indirect` (or a multi-result block) carried by a multi-value `br` was invisible to type
// collection and the encode failed with "unresolved function type" on a legal
// module. `visitChildren` throws on an unhandled kind, so a future node cannot
// go missing the same way.
import { visitChildren } from '../ir/walk.ts';
import {
  AbstractHeapType,
  type FieldType,
  funcTypeKey,
  type HeapType,
  isPackedType,
  isRefType,
  type RefType,
  type StorageType,
  type TypeDef,
  type ValueType,
  valueTypeKey,
} from '../ir/gc-types.ts';
import { requireIndex, type Var, varFromToken } from '../../wabt-ts/ir/ir.ts';

/**
 * The memory an instruction addresses. An ABSENT field means memory 0 — the
 * only memory a single-memory module has, and the reason the field is optional
 * at all.
 *
 * A NAME reaching the encoder is a different thing entirely, and throws:
 * defaulting it to 0 would emit a valid module addressing the wrong memory.
 */
function memIndex(v: Var | undefined, what: string): number {
  return v === undefined ? 0 : requireIndex(v, `${what} memory index`);
}

// ---------------------------------------------------------------------------
// BinaryWriter — growable byte buffer with WASM encoding helpers
// ---------------------------------------------------------------------------

class BinaryWriter {
  private buf: number[] = [];

  get byteLength(): number {
    return this.buf.length;
  }

  writeU8(n: number): void {
    this.buf.push(n & 0xff);
  }

  writeU32Fixed(n: number): void {
    this.buf.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
  }

  writeU32(n: number): void {
    n = n >>> 0;
    do {
      let byte = n & 0x7f;
      n >>>= 7;
      if (n !== 0) byte |= 0x80;
      this.buf.push(byte);
    } while (n !== 0);
  }

  /**
   * Unsigned 64-bit LEB128.
   *
   * Needed because a memarg offset is a u64 under memory64 and `writeU32`
   * TRUNCATES — it starts with `n >>>= 0`, which silently discards everything
   * above 2^32 and emits a valid instruction addressing the wrong offset.
   * `writeI64` is signed and would set a continuation byte differently near the
   * top of the range, so neither existing writer serves.
   */
  writeU64(n: bigint): void {
    if (n < 0n) throw new WasmEncodeError(`writeU64: negative value ${n}`);
    do {
      let byte = Number(n & 0x7fn);
      n >>= 7n;
      if (n !== 0n) byte |= 0x80;
      this.buf.push(byte);
    } while (n !== 0n);
  }

  writeI32(n: number): void {
    n = n | 0;
    let more = true;
    while (more) {
      let byte = n & 0x7f;
      n >>= 7;
      const signBit = (byte & 0x40) !== 0;
      more = !((n === 0 && !signBit) || (n === -1 && signBit));
      if (more) byte |= 0x80;
      this.buf.push(byte);
    }
  }

  writeI64(n: bigint): void {
    let more = true;
    while (more) {
      let byte = Number(n & 0x7fn);
      n >>= 7n;
      const signBit = (byte & 0x40) !== 0;
      more = !((n === 0n && !signBit) || (n === -1n && signBit));
      if (more) byte |= 0x80;
      this.buf.push(byte);
    }
  }

  writeF32(n: number): void {
    const arr = new Float32Array([n]);
    const bytes = new Uint8Array(arr.buffer);
    for (const b of bytes) this.buf.push(b);
  }

  writeF64(n: number): void {
    const arr = new Float64Array([n]);
    const bytes = new Uint8Array(arr.buffer);
    for (const b of bytes) this.buf.push(b);
  }

  writeBytes(bytes: Uint8Array): void {
    for (const b of bytes) this.buf.push(b);
  }

  writeUTF8(s: string): void {
    const encoded = new TextEncoder().encode(s);
    this.writeU32(encoded.length);
    this.writeBytes(encoded);
  }

  writeAll(other: BinaryWriter): void {
    for (const b of other.buf) this.buf.push(b);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

// ---------------------------------------------------------------------------
// Opcode lookup tables (inverse of wasm-parser.ts tables)
// ---------------------------------------------------------------------------

// SIMD unary ops — 0xFD prefix + U32 sub-opcode
// SIMD binary ops — 0xFD prefix + U32 sub-opcode
// SIMD shift opcode to sub-opcode
// SIMD extract opcode to (sub-opcode) — lane immediate follows
// SIMD replace opcode to sub-opcode
// SIMD load opcode to sub-opcode
// SIMD load/store lane opcode to sub-opcode
// ---------------------------------------------------------------------------
// ValType / blocktype encoding
// ---------------------------------------------------------------------------

function valTypeByte(t: ValType): number {
  switch (t) {
    case ValType.I32:
      return 0x7f;
    case ValType.I64:
      return 0x7e;
    case ValType.F32:
      return 0x7d;
    case ValType.F64:
      return 0x7c;
    case ValType.V128:
      return 0x7b;
    case ValType.FuncRef:
      return 0x70;
    case ValType.ExternRef:
      return 0x6f;
    case ValType.AnyRef:
      return 0x6e;
    case ValType.EqRef:
      return 0x6d;
    case ValType.I31Ref:
      return 0x6c;
    case ValType.StructRef:
      return 0x6b;
    case ValType.ArrayRef:
      return 0x6a;
    case ValType.NullRef:
      return 0x71;
    case ValType.NullFuncRef:
      return 0x73;
    case ValType.NullExternRef:
      return 0x72;
    case ValType.ExnRef:
      return 0x69;
    case ValType.NullExnRef:
      return 0x74;
    default:
      // Unknown ValType — silently encoding it as i32 (0x7f) would emit a
      // valid-but-wrong module. Fail loudly.
      throw new WasmEncodeError(`cannot encode value type: ${t}`);
  }
}

/**
 * The encoder's label stack, innermost last. A frame with no label is `null`.
 *
 * 🛑 It was `string[]`, with an unlabelled frame pushed as `''` — the same string
 * the function frame is seeded with, and the name the WAT path gives a `br` that
 * exits the function. So an unnamed block, `if` or `try` that was actually
 * EMITTED shadowed the function frame: `drop (block (result i32) (br '' 1))`
 * exited the block instead of the function and returned the wrong value, in a
 * module every engine accepts. C6 fixed one instance (region wrappers stopped
 * being emitted); this removes the cause. `null` equals no name, so a frame
 * without a label can never be a branch target by accident.
 */
type LabelStack = (string | null)[];

function writeValType(w: BinaryWriter, t: ValType): void {
  w.writeU8(valTypeByte(t));
}

/**
 * Whether an expression of this kind writes a BLOCKTYPE, and so may need a
 * type-section entry for its result.
 *
 * Kept beside {@link writeBlockType} because it must list exactly the kinds
 * that call it — the two drifting apart means either a missing type (an
 * unresolvable blocktype index) or an orphan one.
 */
function isBlockTypeCarrier(expr: Expression): boolean {
  switch (expr.kind) {
    case ExpressionKind.Block:
    case ExpressionKind.Loop:
    case ExpressionKind.If:
    case ExpressionKind.Try:
    case ExpressionKind.TryTable:
      return true;
    // A Region never writes a blocktype — the construct that owns it does. This
    // used to be an exception for UNNAMED blocks, which had to agree with
    // `encodeRegionBody`'s rule for inlining them: a multi-value function's body
    // wrapper once registered a type entry nothing addressed. Being a region is
    // a kind now, so there is no rule to keep in step.
    default:
      return false;
  }
}

/** A construct that closes with its own `end`, and so resets the stack to its declared type. */
function isControlConstruct(e: Expression): boolean {
  switch (e.kind) {
    case ExpressionKind.Block:
    case ExpressionKind.Loop:
    case ExpressionKind.If:
    case ExpressionKind.Try:
    case ExpressionKind.TryTable:
      return true;
    default:
      return false;
  }
}

/**
 * A block-type carrier's RESULT list, from its type: empty for `none` and for
 * `unreachable` (a construct whose every path branches away declares no result
 * — the same reading {@link writeBlockType} gives it with `0x40`).
 */
function resultsOf(t: Type | undefined): ValueType[] {
  if (t === undefined || t === None || t === Unreachable) return [];
  return Array.isArray(t) ? (t as ValueType[]) : [t as ValueType];
}

/**
 * Writes a block header's type.
 *
 * Three forms: `0x40` for void, an inline valtype byte for exactly one result,
 * and — for a multi-result block — a NON-NEGATIVE signed LEB naming a
 * type-section entry. The signed encoding is what keeps a type index distinct
 * from the negative one-byte valtype forms, so `writeU32` would be wrong here
 * for indices >= 64 exactly as it was in `writeHeapType`.
 *
 * `resolveBlockType` is passed in because the index has to come from the
 * encoder's collected type table, which this free function has no access to.
 */
function writeBlockType(
  w: BinaryWriter,
  t: Type,
  resolveBlockType: (results: ValueType[]) => number,
): void {
  if (t === None || (Array.isArray(t) && t.length === 0)) {
    w.writeU8(0x40);
  } else if (Array.isArray(t)) {
    if (t.length > 1) {
      w.writeI32(resolveBlockType(t as ValueType[]));
      return;
    }
    writeValueType(w, t[0] as ValType | RefType);
  } else if (t !== 'unreachable') {
    // A single result of ANY value type is written inline — a typed reference
    // too (`64 <heaptype>`), which is how the spec and wasm-tools encode it and,
    // since W5, how wabt-ts's writer does.
    //
    // 🔧 This used to go through the type-index form for `(ref $T)`, to match
    // wabt-ts, which interned a function type for such a block. That type was
    // one the source never implied (`ref.wast`: a one-type module must reject
    // `(block (result (ref 1)))` as "unknown type"), so wabt-ts stopped, and the
    // two writers must agree.
    writeValueType(w, t as ValType | RefType);
  } else {
    w.writeU8(0x40);
  }
}

function refHeapTypeByte(t: ValType): number {
  switch (t) {
    case ValType.FuncRef:
      return 0x70;
    case ValType.ExternRef:
      return 0x6f;
    case ValType.AnyRef:
      return 0x6e;
    case ValType.EqRef:
      return 0x6d;
    case ValType.I31Ref:
      return 0x6c;
    case ValType.StructRef:
      return 0x6b;
    case ValType.ArrayRef:
      return 0x6a;
    case ValType.NullRef:
      return 0x71;
    case ValType.NullFuncRef:
      return 0x73;
    case ValType.NullExternRef:
      return 0x72;
    case ValType.ExnRef:
      return 0x69;
    case ValType.NullExnRef:
      return 0x74;
    default:
      // Reached only for a non-ref ValType, which is a bug in the IR producing
      // this RefNull. Previously this silently returned `any` (0x6e),
      // mis-typing the null; fail loudly instead.
      throw new WasmEncodeError(`ref.null of non-reference type: ${t}`);
  }
}

// ---------------------------------------------------------------------------
// GC heap type / ref type encoding
// ---------------------------------------------------------------------------

const ABSTRACT_HEAP_TYPE_BYTE: Record<AbstractHeapType, number> = {
  [AbstractHeapType.Func]: 0x70,
  [AbstractHeapType.NoFunc]: 0x73,
  [AbstractHeapType.Ext]: 0x6f,
  [AbstractHeapType.NoExt]: 0x72,
  [AbstractHeapType.Any]: 0x6e,
  [AbstractHeapType.Eq]: 0x6d,
  [AbstractHeapType.I31]: 0x6c,
  [AbstractHeapType.Struct]: 0x6b,
  [AbstractHeapType.Array]: 0x6a,
  [AbstractHeapType.None]: 0x71,
  [AbstractHeapType.Exn]: 0x69,
  [AbstractHeapType.NoExn]: 0x74,
};

function writeHeapType(w: BinaryWriter, h: HeapType): void {
  if (typeof h === 'number') {
    // A heap type is an `s33` — a SIGNED LEB — which is how `readHeapType`
    // reads it back. `writeU32` agrees with the signed form only for indices
    // below 64; at 64 the unsigned encoding (`0x40`) reads back as -64 and
    // resolves to an abstract heap type instead of the intended index.
    w.writeI32(h);
  } else {
    const b = ABSTRACT_HEAP_TYPE_BYTE[h];
    if (b === undefined) {
      // The table is `Record<AbstractHeapType, number>`, so this is statically
      // unreachable today; the old `?? 0x6e` silently rewrote any future
      // unmapped heap type to `any`.
      throw new WasmEncodeError(`cannot encode abstract heap type: ${h}`);
    }
    w.writeU8(b);
  }
}

function writeValueType(w: BinaryWriter, t: ValType | RefType): void {
  if (isRefType(t)) {
    w.writeU8(t.nullable ? 0x63 : 0x64);
    writeHeapType(w, t.heap);
  } else {
    writeValType(w, t);
  }
}

// ---------------------------------------------------------------------------
// FuncType key for deduplication — `funcTypeKey` / `valueTypeKey` live in
// `ir/gc-types.ts`, shared with the WAT parser, which must match signatures
// EXACTLY as `gcFuncTypeIndex` below does.
// ---------------------------------------------------------------------------

/** Human-readable `(a, b) -> (c)` rendering for error messages. */
function funcSigString(params: ValueType[], results: ValueType[]): string {
  return `(${params.map(valueTypeKey).join(', ')}) -> (${results.map(valueTypeKey).join(', ')})`;
}

// ---------------------------------------------------------------------------
// WasmEncoder
// ---------------------------------------------------------------------------

interface FuncTypeEntry {
  params: ValueType[];
  results: ValueType[];
}

class WasmEncoder {
  private readonly mod: WasmModule;

  private funcIndex = new Map<string, number>();
  private globalIndex = new Map<string, number>();
  private tableIndex = new Map<string, number>();
  private memoryIndex = new Map<string, number>();
  private tagIndex = new Map<string, number>();

  private types: FuncTypeEntry[] = [];
  private typeKeyToIndex = new Map<string, number>();

  /**
   * Working copy of `mod.heapTypes` — the list the type section is emitted
   * from in GC mode. It starts as a copy so a signature that only an
   * EXPRESSION needs (a multi-result block header) can be appended without
   * mutating the caller's module. See `ensureHeapFuncType`.
   */
  private heapTypes: TypeDef[] = [];

  /**
   * Label names written so far, by function index — for the name section's
   * label subsection (N1 P5). A label's index counts every label-introducing
   * instruction in its function in the order they are WRITTEN; see
   * {@link noteLabel}.
   */
  private readonly labelNames = new Map<number, [number, string][]>();
  /** The current function's labels that came from a name section, and its count so far. */
  private funcLabels: ReadonlySet<string> | undefined;
  private funcLabelsOut: [number, string][] = [];
  private labelCount = 0;

  constructor(mod: WasmModule) {
    this.mod = mod;
  }

  /**
   * Count one label-introducing instruction — called where each pushes its
   * label, i.e. as its opcode is written — and keep its name when the module
   * was read with it. Binary order, not tree order: a folded `if`'s condition
   * block is written before the `if`.
   */
  private noteLabel(name: string | null | undefined): void {
    const index = this.labelCount++;
    if (name != null && this.funcLabels?.has(name)) this.funcLabelsOut.push([index, name]);
  }

  /**
   * Resolves an entity name to its encoded index, throwing on a miss.
   *
   * A `map.get(name) ?? 0` fallback silently encodes index `0` when a reference
   * cannot be resolved — exactly the failure mode that once made every
   * imported-function call encode as `call 0` (a valid-but-wrong binary that
   * still passes `WebAssembly.compile`). A dangling reference (a pass dropped
   * the target but left the reference, a stripped tag is still exported, a
   * global/table name never made it into the index map) is an IR bug; emitting
   * index 0 hides it behind a miscompile. Fail loudly with the offending name
   * instead.
   */
  /**
   * Resolve an entity reference to its index.
   *
   * 🔑 The two cases used to be ONE `string` parameter carrying both a `$name`
   * and a numeric index, told apart by `/^[0-9]+$/` — with `$`-prefixing as the
   * informal convention holding it together. That overload was not free: our
   * own `wasm2wat` emits `(export "…" (func 19))`, and before the numeric
   * branch existed, re-parsing our own disassembly failed on 310 of 421 corpus
   * modules while the PARSER had already accepted them.
   *
   * A `Var`'s arm answers it instead, so the regex is gone. A name that is not
   * in the map still throws: the dangling references the fail-loud rule exists
   * for are NAMED — a pass dropped `$g` but left a reference to it.
   */
  private resolveRef(map: Map<string, number>, v: Var, kind: string): number {
    if (v.kind === 'index') return v.value;
    const idx = map.get(v.name);
    if (idx !== undefined) return idx;
    throw new WasmEncodeError(`unresolved ${kind} reference: "${v.name}"`);
  }

  /**
   * Picks the `struct.get*` / `array.get*` sub-opcode for a field access.
   *
   * The GC spec has THREE sub-opcodes per family, not two:
   *
   * | family | non-packed | packed, sign-extend | packed, zero-extend |
   * | ------ | ---------- | ------------------- | ------------------- |
   * | struct | `get` 0x02 | `get_s` 0x03        | `get_u` 0x04        |
   * | array  | `get` 0x0b | `get_s` 0x0c        | `get_u` 0x0d        |
   *
   * The IR carries only `signed: boolean`, so a naive `signed ? get_s : get`
   * made `get_u` unreachable AND emitted the non-packed `get` for a packed
   * field — which every engine rejects ("Field 0 of type 0 has type i8. Use
   * struct.get_s or struct.get_u instead."). Because the binary parser decodes
   * `get_u` to `signed = false`, that also turned a VALID input module into an
   * invalid one across a bare `parseWasm` -> `encodeWasm` round-trip.
   *
   * The two states are sufficient once packedness comes from the declared
   * storage type instead of the instruction: a packed field admits only
   * `get_s`/`get_u` (selected by `signed`), and a non-packed field admits only
   * `get` (where `signed` is meaningless). So this is a total function of
   * `(storage type, signed)` and needs no IR change.
   *
   * An out-of-range type index or a def of the wrong kind is an IR bug; throw
   * rather than guess a sub-opcode.
   */
  private packedGetSubop(
    typeIndex: number,
    fieldIndex: number,
    signed: boolean,
    family: 'struct' | 'array',
  ): number {
    const def = this.heapTypes[typeIndex];
    if (def === undefined) {
      throw new WasmEncodeError(
        `${family}.get: type index ${typeIndex} is out of range ` +
          `(module declares ${this.heapTypes.length} heap types)`,
      );
    }
    if (def.kind !== family) {
      throw new WasmEncodeError(
        `${family}.get: type index ${typeIndex} is a "${def.kind}" type, not a ${family}`,
      );
    }

    let field: FieldType | undefined;
    if (def.kind === 'struct') {
      field = def.fields[fieldIndex];
      if (field === undefined) {
        throw new WasmEncodeError(
          `struct.get: field index ${fieldIndex} is out of range for type ` +
            `${typeIndex} (${def.fields.length} fields)`,
        );
      }
    } else {
      field = def.element;
    }

    const base = family === 'struct' ? 0x02 : 0x0b;
    if (!isPackedType(field.type)) return base;
    return signed ? base + 1 : base + 2;
  }

  encode(): Uint8Array {
    this.checkSingleTable();
    this.buildIndices();
    this.collectTypes();

    const out = new BinaryWriter();
    out.writeU32Fixed(0x6d736100); // magic: \0asm
    out.writeU32Fixed(0x00000001); // version: 1

    // ⚠️ Only when there is something to declare. This was unconditional, so a
    // module with no types — `(module (memory 1))` — gained an empty type
    // section (`01 01 00`) it did not arrive with. Legal, but a section the
    // input never had, which is a round-trip difference for every type-less
    // module. Found while proving multi-memory round trips byte-identically;
    // unrelated to that, and pre-existing.
    // Custom sections go back into the gap each one held (C3); `writeCustoms`
    // is called after every known section, whether or not that section is
    // emitted, so a module that lost its start section does not drag a custom
    // along with it.
    this.writeCustoms(out, null);
    if (this.typeCount() > 0) this.writeSection(out, 1, (w) => this.encodeTypeSection(w));
    this.writeCustoms(out, 1);
    if (this.hasImports()) this.writeSection(out, 2, (w) => this.encodeImportSection(w));
    this.writeCustoms(out, 2);
    if (this.mod.functions.length > 0) {
      this.writeSection(out, 3, (w) => this.encodeFunctionSection(w));
    }
    this.writeCustoms(out, 3);
    if (this.hasTables()) this.writeSection(out, 4, (w) => this.encodeTableSection(w));
    this.writeCustoms(out, 4);
    if (this.hasMemories()) this.writeSection(out, 5, (w) => this.encodeMemorySection(w));
    this.writeCustoms(out, 5);
    if (this.mod.tags.length > 0) this.writeSection(out, 13, (w) => this.encodeTagSection(w));
    this.writeCustoms(out, 13);
    if (this.mod.globals.length > 0) this.writeSection(out, 6, (w) => this.encodeGlobalSection(w));
    this.writeCustoms(out, 6);
    if (this.mod.exports.length > 0) this.writeSection(out, 7, (w) => this.encodeExportSection(w));
    this.writeCustoms(out, 7);
    // `!= null` (loose) on purpose: a module built against the pre-start
    // `WasmModule` shape has no `start` field at all, and absent
    // unambiguously means "no start function" — there is nothing to fail
    // loudly about. A `!== null` check would treat `undefined` as a real
    // name and emit a section referencing a function called "undefined".
    if (this.mod.start != null) this.writeSection(out, 8, (w) => this.encodeStartSection(w));
    this.writeCustoms(out, 8);
    if (this.mod.elements.length > 0) {
      this.writeSection(out, 9, (w) => this.encodeElementSection(w));
    }
    this.writeCustoms(out, 9);
    // BEFORE the code section, which is the point of it: a validator needs the
    // segment count while type-checking `memory.init` / `data.drop`.
    if (this.mod.hasDataCount === true || this.usesDataIndex()) {
      this.writeSection(out, 12, (w) => this.encodeDataCountSection(w));
    }
    this.writeCustoms(out, 12);
    if (this.mod.functions.length > 0) this.writeSection(out, 10, (w) => this.encodeCodeSection(w));
    this.writeCustoms(out, 10);
    if (this.mod.dataSegments.length > 0) {
      this.writeSection(out, 11, (w) => this.encodeDataSection(w));
    }
    this.writeCustoms(out, 11);
    // Last, as the spec places it — and after the code, which is where the
    // label names were counted. A module DECODED with a name section already
    // wrote it above, at the place it held among the other custom sections.
    if (this.mod.explicitNames !== undefined && !this.wroteNameSection) {
      this.writeNameSection(out, this.mod.explicitNames);
    }

    return out.toUint8Array();
  }

  /** Whether {@link writeCustoms} has already generated the `name` section. */
  private wroteNameSection = false;

  /**
   * The custom sections that followed section `after` — `null` for those that
   * came before every known section — in the order the module carried them
   * (C3). An entry with no data is the `name` section's PLACE: its content is
   * generated, and only when the module still has explicit names, so a pass run
   * without `debugInfo` drops the section rather than writing an empty one.
   *
   * Upstream `wasm-opt` instead APPENDS every custom section after the known
   * ones, keeping only `dylink.0` first; restoring the recorded position covers
   * that case and every other (register C6).
   */
  private writeCustoms(out: BinaryWriter, after: number | null): void {
    for (const c of this.mod.customSections ?? []) {
      if (c.precedingSection !== after) continue;
      if (c.data === null) {
        if (this.mod.explicitNames === undefined) continue;
        this.writeNameSection(out, this.mod.explicitNames);
        this.wroteNameSection = true;
      } else {
        const data = c.data;
        this.writeSection(out, 0, (w) => {
          w.writeUTF8(c.name);
          w.writeBytes(data);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Name section — N1 P5 (cmem/names.md)
  // ---------------------------------------------------------------------------

  /**
   * The `name` custom section, from the names the module was READ with
   * ({@link WasmModule.explicitNames}) — never from the ones the decoder made
   * up.
   *
   * 🔧 This encoder wrote none, so every name was lost the moment binaryen-ts
   * re-encoded a module (hop D of N1), and 7b(i)'s block-parameter lowering —
   * which re-decodes this encoder's output — refused every named module that
   * had parameters, because the names came back different.
   *
   * The layout is wabt-ts's writer's, which is upstream `wat2wasm
   * --debug-names`'s for the ten kinds upstream writes: subsections in id
   * order; flat maps list named entries only and are omitted when empty; the
   * local subsection is always written, with an entry for every function; names
   * without the `$`. So wabt-ts's bytes decode and re-encode to themselves.
   */
  private writeNameSection(out: BinaryWriter, names: ExplicitNames): void {
    const { mod } = this;
    const bare = (s: string): string => (s.startsWith('$') ? s.slice(1) : s);
    const sorted = (m: ReadonlyMap<number, string>): [number, string][] =>
      [...m].filter(([, n]) => n !== '').sort(([a], [b]) => a - b);
    const entries = (w: BinaryWriter, list: readonly [number, string][]): void => {
      w.writeU32(list.length);
      for (const [i, n] of list) {
        w.writeU32(i);
        w.writeUTF8(bare(n));
      }
    };
    const sub = (w: BinaryWriter, id: number, body: (b: BinaryWriter) => void): void => {
      const b = new BinaryWriter();
      body(b);
      w.writeU8(id);
      w.writeU32(b.byteLength);
      w.writeAll(b);
    };
    /** A flat map over one index space: the listed names only; nothing if none. */
    const flat = (
      w: BinaryWriter,
      id: number,
      space: readonly string[],
      set: ReadonlySet<string>,
    ) => {
      const list: [number, string][] = [];
      space.forEach((name, i) => {
        if (set.has(name)) list.push([i, name]);
      });
      if (list.length > 0) sub(w, id, (b) => entries(b, list));
    };
    /** An indirect map: the outers that have names only; nothing if none. */
    const indirect = (
      w: BinaryWriter,
      id: number,
      outer: readonly [number, [number, string][]][],
    ) => {
      const kept = outer.filter(([, inner]) => inner.length > 0);
      if (kept.length === 0) return;
      sub(w, id, (b) => {
        b.writeU32(kept.length);
        for (const [i, inner] of kept) {
          b.writeU32(i);
          entries(b, inner);
        }
      });
    };
    const imports = (kind: string): string[] =>
      mod.imports.filter((i) => i.kind === kind).map((i) => i.name);
    const funcSpace = [...imports('function'), ...mod.functions.map((f) => f.name)];

    const section = new BinaryWriter();
    section.writeUTF8('name');
    if (names.module !== undefined) sub(section, 0, (b) => b.writeUTF8(bare(names.module!)));
    flat(section, 1, funcSpace, names.functions);
    // Which functions the subsection lists: the ones the section listed, or —
    // with no record — every one, as upstream `wat2wasm --debug-names` does
    // (N6). `null` is a section that had no local subsection: write none.
    if (names.localsListed !== null) {
      const importFuncs = mod.imports.filter((i) => i.kind === 'function');
      const locals: [number, [number, string][]][] = [];
      const listed = names.localsListed;
      const wanted = (name: string) => listed.has(name);
      importFuncs.forEach((imp, i) => {
        if (wanted(imp.name)) {
          locals.push([i, sorted(names.importParams.get(imp.name) ?? new Map())]);
        }
      });
      mod.functions.forEach((fn, i) => {
        if (!wanted(fn.name)) return;
        const list: [number, string][] = [];
        fn.locals.forEach((l, j) => {
          if (l.name !== undefined && l.name !== '') list.push([j, l.name]);
        });
        locals.push([importFuncs.length + i, list]);
      });
      sub(section, 2, (b) => {
        b.writeU32(locals.length);
        for (const [i, list] of locals) {
          b.writeU32(i);
          entries(b, list);
        }
      });
    }
    indirect(section, 3, [...this.labelNames].sort(([a], [b]) => a - b));
    // Types by the OBJECT they were read as: a type a pass rebuilt, or one the
    // encoder appended for an expression, has none. Only the GC-mode type
    // section (`heapTypes`) is the decoder's own list; the derived one is not.
    const typeList: [number, string][] = [];
    this.heapTypes.forEach((def, i) => {
      const n = names.types.get(def);
      if (n !== undefined) typeList.push([i, n]);
    });
    if (typeList.length > 0) sub(section, 4, (b) => entries(b, typeList));
    flat(section, 5, [...imports('table'), ...mod.tables.map((t) => t.name)], names.tables);
    flat(section, 6, [...imports('memory'), ...mod.memories.map((m) => m.name)], names.memories);
    flat(section, 7, [...imports('global'), ...mod.globals.map((g) => g.name)], names.globals);
    flat(section, 8, mod.elements.map((e) => e.name), names.elements);
    flat(section, 9, mod.dataSegments.map((d) => d.name), names.dataSegments);
    indirect(
      section,
      10,
      this.heapTypes.map((def, i) => [i, sorted(names.fields.get(def) ?? new Map())]),
    );
    flat(section, 11, [...imports('tag'), ...mod.tags.map((t) => t.name)], names.tags);

    out.writeU8(0);
    out.writeU32(section.byteLength);
    out.writeAll(section);
  }

  // ---------------------------------------------------------------------------
  // Index building
  // ---------------------------------------------------------------------------

  private buildIndices(): void {
    let fi = 0;
    for (const imp of this.mod.imports) {
      if (imp.kind === 'function') this.funcIndex.set(imp.name, fi++);
    }
    for (const fn of this.mod.functions) {
      this.funcIndex.set(fn.name, fi++);
    }

    let gi = 0;
    for (const imp of this.mod.imports) {
      if (imp.kind === 'global') this.globalIndex.set(imp.name, gi++);
    }
    for (const g of this.mod.globals) {
      this.globalIndex.set(g.name, gi++);
    }

    let ti = 0;
    let mi = 0;
    for (const imp of this.mod.imports) {
      if (imp.kind === 'table') this.tableIndex.set(imp.name, ti++);
      if (imp.kind === 'memory') this.memoryIndex.set(imp.name, mi++);
    }
    for (const t of this.mod.tables) {
      this.tableIndex.set(t.name, ti++);
    }
    for (const mem of this.mod.memories) {
      this.memoryIndex.set(mem.name, mi++);
    }

    let tagi = 0;
    for (const imp of this.mod.imports) {
      if (imp.kind === 'tag') this.tagIndex.set(imp.name, tagi++);
    }
    for (const tag of this.mod.tags) {
      this.tagIndex.set(tag.name, tagi++);
    }
  }

  // ---------------------------------------------------------------------------
  // Type collection
  // ---------------------------------------------------------------------------

  private collectTypes(): void {
    this.heapTypes = [...this.mod.heapTypes];
    const addType = (params: ValueType[], results: ValueType[]): void => {
      const key = funcTypeKey(params, results);
      if (!this.typeKeyToIndex.has(key)) {
        this.typeKeyToIndex.set(key, this.types.length);
        this.types.push({ params, results });
      }
    };

    for (const imp of this.mod.imports) {
      if (imp.kind === 'function') addType(imp.params ?? [], imp.results ?? []);
    }
    for (const fn of this.mod.functions) {
      addType(fn.params, fn.results);
    }
    // Tags use function-type signatures (params only, no results)
    for (const imp of this.mod.imports) {
      if (imp.kind === 'tag') addType(imp.params ?? [], []);
    }
    for (const tag of this.mod.tags) {
      addType(tag.params, []);
    }
    // One walk collects both kinds of expression-level type reference:
    // `call_indirect` signatures and multi-result block headers.
    for (const fn of this.mod.functions) {
      this.collectExprTypes(fn.body, (params, results) => {
        addType(params, results);
        // In GC mode the emitted type section IS `this.heapTypes`, not the
        // deduped `this.types` — so an expression-level signature has to
        // exist THERE to be addressable by index.
        if (this.heapTypes.length > 0) this.ensureHeapFuncType(params, results);
      });
    }
  }

  /**
   * Registers every type-section entry an EXPRESSION refers to.
   *
   * Two kinds: a `call_indirect`'s signature, and a multi-result block header
   * — which names a type-section entry rather than an inline valtype, so its
   * `() -> results` signature must exist before `writeBlockType` can resolve
   * an index for it.
   */
  private collectExprTypes(
    expr: Expression,
    addType: (params: ValueType[], results: ValueType[]) => void,
  ): void {
    if (expr.kind === ExpressionKind.CallIndirect) {
      const e = expr as CallIndirectExpr;
      addType(e.sig.params, e.sig.results);
    }
    // ⚠️ Only a CONTROL construct needs a type-section entry for its result: it
    // is the one that writes a blocktype, and a blocktype above the inline forms
    // is an index into the type section. Every other expression carries its
    // multi-value type for the IR's benefit alone.
    //
    // This used to register a type for ANY multi-value-typed expression. A
    // multi-value FUNCTION's body expression is multi-value too, so a
    // `(func (result i32 i32))` entry was appended that nothing referenced — the
    // function itself uses its own signature, which has parameters. 111 corpus
    // modules carried an orphan type, 643 bytes in total, and it was the last
    // measured difference between this encoder's output and wabt-ts's.
    //
    // Harmless as it stood — unreferenced, appended last so no index shifted —
    // but "emit a type in case something needs it" is a rule that cannot be
    // checked, whereas "emit one for the constructs that address one" can.
    const params = blockParamsOf(expr);
    if (params !== undefined && params.types.length > 0) {
      // A parametrised block's header is ALWAYS a type index — no inline form
      // can say `(param …)` — so its `params -> results` signature is needed
      // whatever the result count.
      addType(params.types, resultsOf(expr.type));
    } else if (isBlockTypeCarrier(expr) && Array.isArray(expr.type) && expr.type.length > 1) {
      addType([], expr.type as ValueType[]);
    }
    visitChildren(expr, (child) => this.collectExprTypes(child, addType));
  }

  /**
   * Writes a block-type carrier's header type: a type index for a construct
   * with parameters (S6 decision 7b(i)), else {@link writeBlockType}'s forms.
   */
  private writeCarrierType(w: BinaryWriter, e: Expression): void {
    const params = blockParamsOf(e);
    if (params !== undefined && params.types.length > 0) {
      w.writeI32(this.blockTypeIndex(resultsOf(e.type), params.types));
      return;
    }
    // A header the source wrote as an INDEX keeps that form (7c). `0x40` and an
    // inline value type are the same type in fewer bytes, so a carrier that did
    // not name an index still takes `writeBlockType`'s forms.
    const written = writtenTypeIndexOf(e);
    if (written !== undefined) {
      w.writeI32(written);
      return;
    }
    writeBlockType(w, typeOf(e), (rs) => this.blockTypeIndex(rs));
  }

  /** A carrier's entry values, emitted before its opcode (and an `if`'s condition). */
  private encodeParamValues(w: BinaryWriter, e: Expression, labels: LabelStack): void {
    for (const v of blockParamsOf(e)?.values ?? []) this.encodeExpr(w, v, labels);
  }

  /**
   * Resolves the type-section index for a multi-result block header.
   *
   * Which table that index addresses depends on which one `encodeTypeSection`
   * emitted: `this.heapTypes` in GC mode, the deduped `this.types` otherwise.
   * Resolving against the wrong one yields a valid-but-wrong index — the same
   * class of bug that once retyped tag signatures (WT-2d). The two orderings
   * are unrelated, so they only coincide by luck.
   */
  private blockTypeIndex(results: ValueType[], params: ValueType[] = []): number {
    return this.heapTypes.length > 0
      ? this.gcFuncTypeIndex(params, results)
      : this.getTypeIndex(params, results);
  }

  /**
   * Returns the `this.heapTypes` index of `params -> results`, appending the
   * entry when it is absent.
   *
   * A multi-result block header names a type-section entry, and the block may
   * be one a PASS synthesised — in which case the input module never declared
   * that signature and there is nothing to look up. Appending keeps the
   * blocktype addressable instead of failing to encode a legal block.
   */
  private ensureHeapFuncType(params: ValueType[], results: ValueType[]): number {
    const want = funcTypeKey(params, results);
    for (const [i, d] of this.heapTypes.entries()) {
      if (d.kind === 'func' && funcTypeKey(d.params, d.results) === want) return i;
    }
    this.heapTypes.push({ kind: 'func', params: [...params], results: [...results] });
    return this.heapTypes.length - 1;
  }

  private getTypeIndex(params: ValueType[], results: ValueType[]): number {
    const idx = this.typeKeyToIndex.get(funcTypeKey(params, results));
    if (idx === undefined) {
      // `collectTypes` registers exactly the signatures every call site here
      // asks for (imported + defined functions, tags, and call_indirect). A
      // miss therefore means the collection and the encode walked different
      // sets — a bug that, with the old `?? 0`, silently emitted type index 0
      // and produced a function-signature mismatch in the output. Fail loudly,
      // matching `resolveRef` for entity references.
      throw new WasmEncodeError(
        `unresolved function type: ${funcSigString(params, results)}`,
      );
    }
    return idx;
  }

  // ---------------------------------------------------------------------------
  // Section helpers
  // ---------------------------------------------------------------------------

  private writeSection(out: BinaryWriter, id: number, encode: (w: BinaryWriter) => void): void {
    const body = new BinaryWriter();
    encode(body);
    if (body.byteLength === 0) return;
    out.writeU8(id);
    out.writeU32(body.byteLength);
    out.writeAll(body);
  }

  private hasImports(): boolean {
    return this.mod.imports.length > 0;
  }

  private hasTables(): boolean {
    return this.mod.tables.length > 0 || this.mod.imports.some((i) => i.kind === 'table');
  }

  private hasMemories(): boolean {
    return this.mod.memories.length > 0 || this.mod.imports.some((i) => i.kind === 'memory');
  }

  /**
   * Guards against the multi-memory proposal. The encoder hardcodes memory
   * index 0 for memory exports, data segments, and `memory.*` instructions, and
   * the parser names every memory `mem0` (so an imported + a defined memory
   * collide). Rather than silently emit everything against memory 0, fail
   * loudly when more than one memory is present.
   */
  /**
   * Write a memarg: alignment exponent, an explicit memory index when the
   * access does not address memory 0, then the offset.
   *
   * ⚠️ Bit 6 of the align field is what says "a memory index follows". Writing
   * align straight through, as this did, could only ever produce memory-0
   * accesses — which is why the encoder used to refuse multi-memory modules
   * outright rather than emit wrong bytes.
   */
  /**
   * Write an operator, whatever prefix space it lives in.
   *
   * 🔑 Replaces SEVEN lookup tables. Since S6 stage 1 the operator IS the
   * opcode, encoded the way wabt-ts encodes it: a bare byte below 0x100, and
   * `(prefix << 16) | sub` above. So the prefix and sub-opcode are read off the
   * value instead of looked up, and the tables that held that mapping — 313
   * entries of the same fact stated twice — are gone.
   *
   * It also generalises: the old code special-cased the SIMD prefix, so a MISC,
   * THREADS or GC operator had nowhere to go. This handles all four, which is
   * what lets atomics encode at all.
   */
  private writeOperator(w: BinaryWriter, opcode: number): void {
    const prefix = opcode >>> 16;
    if (prefix === 0) {
      w.writeU8(opcode);
      return;
    }
    w.writeU8(prefix);
    w.writeU32(opcode & 0xffff);
  }

  private writeMemArg(w: BinaryWriter, align: number, offset: bigint, memory?: Var): void {
    const mem = memIndex(memory, 'memarg');
    if (mem !== 0) {
      w.writeU32(align | 0x40);
      w.writeU32(mem);
    } else {
      w.writeU32(align);
    }
    w.writeU64(offset);
  }

  /**
   * Fail loudly on multiple tables. Element segments are always encoded as
   * kind-0 (implicit table 0) by `encodeElementSection`, and the binary parser
   * decodes `call_indirect`/`return_call_indirect` against table 0 — so a
   * segment or indirect call targeting a second table would be silently
   * misencoded against table 0 (wrong dispatch / uninitialized table). Mirrors
   * the memory guard that used to sit beside it. Remove once the element section and indirect-call
   * encoders thread the real table index.
   */
  private checkSingleTable(): void {
    const importedTables = this.mod.imports.filter((i) => i.kind === 'table').length;
    if (importedTables + this.mod.tables.length > 1) {
      throw new WasmEncodeError(
        'multiple tables are not supported: element segments and call_indirect are ' +
          'encoded against table index 0',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Section encoders
  // ---------------------------------------------------------------------------

  /**
   * How many entries {@link encodeTypeSection} will actually write.
   *
   * ⚠️ It must mirror that method's branch exactly. There are TWO lists — the
   * GC `heapTypes` and the deduped `types` — and the section emits `heapTypes`
   * when non-empty and `types` otherwise. Counting only `heapTypes` reported 0
   * for every non-GC module and suppressed a section they needed, which showed
   * up as `type index 0 is out of range` across 81 tests.
   */
  private typeCount(): number {
    return this.heapTypes.length > 0 ? this.heapTypes.length : this.types.length;
  }

  private encodeTypeSection(w: BinaryWriter): void {
    if (this.heapTypes.length > 0) {
      w.writeU32(this.heapTypes.length);
      for (const def of this.heapTypes) {
        if (def.kind === 'func') {
          w.writeU8(0x60);
          w.writeU32(def.params.length);
          for (const p of def.params) writeValueType(w, p);
          w.writeU32(def.results.length);
          for (const r of def.results) writeValueType(w, r);
        } else if (def.kind === 'struct') {
          w.writeU8(0x5f);
          w.writeU32(def.fields.length);
          for (const f of def.fields) {
            this.writeStorageType(w, f.type);
            w.writeU8(f.mutable ? 1 : 0);
          }
        } else {
          w.writeU8(0x5e);
          this.writeStorageType(w, def.element.type);
          w.writeU8(def.element.mutable ? 1 : 0);
        }
      }
    } else {
      w.writeU32(this.types.length);
      for (const { params, results } of this.types) {
        w.writeU8(0x60);
        w.writeU32(params.length);
        for (const p of params) writeValueType(w, p);
        w.writeU32(results.length);
        for (const r of results) writeValueType(w, r);
      }
    }
  }

  private writeStorageType(w: BinaryWriter, t: StorageType): void {
    if (t === 'i8') {
      w.writeU8(0x78);
      return;
    }
    if (t === 'i16') {
      w.writeU8(0x77);
      return;
    }
    writeValueType(w, t as ValType | RefType);
  }

  /**
   * Resolves a function signature to its index in `mod.heapTypes` (GC mode).
   *
   * This used to compare with every `RefType` collapsed to `AnyRef`, because
   * the binary parser stored ref-typed params/results as `AnyRef`. Two func
   * heap types differing only in their concrete heap types were therefore
   * indistinguishable, and the encoder had to throw "ambiguous GC function
   * type" rather than pick one. Now that value types carry concrete
   * references end-to-end, the comparison is exact and that whole failure mode
   * is gone.
   */
  private gcFuncTypeIndex(params: ValueType[], results: ValueType[]): number {
    const want = funcTypeKey(params, results);
    for (const [i, d] of this.heapTypes.entries()) {
      if (d.kind !== 'func') continue;
      if (funcTypeKey(d.params, d.results) === want) return i;
    }
    throw new WasmEncodeError(
      `unresolved GC function type: ${funcSigString(params, results)}`,
    );
  }

  private encodeImportSection(w: BinaryWriter): void {
    w.writeU32(this.mod.imports.length);
    for (const imp of this.mod.imports) {
      w.writeUTF8(imp.module);
      w.writeUTF8(imp.base);
      switch (imp.kind) {
        case 'function': {
          w.writeU8(0x00);
          const idx = this.heapTypes.length > 0
            ? this.gcFuncTypeIndex(imp.params ?? [], imp.results ?? [])
            : this.getTypeIndex(imp.params ?? [], imp.results ?? []);
          w.writeU32(idx);
          break;
        }
        case 'table': {
          w.writeU8(0x01);
          writeValueType(w, imp.type ?? ValType.FuncRef);
          const hasMax = imp.max !== null && imp.max !== undefined;
          w.writeU8(hasMax ? 1 : 0);
          w.writeU32(imp.initial ?? 0);
          if (hasMax) w.writeU32(imp.max as number);
          break;
        }
        case 'memory': {
          w.writeU8(0x02);
          const flags = (imp.max !== null && imp.max !== undefined ? 0x01 : 0) |
            (imp.shared ? 0x02 : 0) |
            (imp.is64 ? 0x04 : 0);
          w.writeU8(flags);
          w.writeU32(imp.initial ?? 0);
          if (imp.max !== null && imp.max !== undefined) w.writeU32(imp.max as number);
          break;
        }
        case 'global': {
          w.writeU8(0x03);
          writeValueType(w, imp.type ?? ValType.I32);
          w.writeU8(imp.mutable ? 1 : 0);
          break;
        }
        case 'tag': {
          w.writeU8(0x04);
          w.writeU8(0); // reserved attribute byte
          // Same GC-mode split as the defined-tag section: with heap types
          // present the emitted type section IS `mod.heapTypes`, so an index
          // into the deduped `this.types` would point at the wrong slot.
          const idx = this.heapTypes.length > 0
            ? this.gcFuncTypeIndex(imp.params ?? [], [])
            : this.getTypeIndex(imp.params ?? [], []);
          w.writeU32(idx);
          break;
        }
      }
    }
  }

  private encodeFunctionSection(w: BinaryWriter): void {
    w.writeU32(this.mod.functions.length);
    for (const fn of this.mod.functions) {
      const idx = this.heapTypes.length > 0
        ? this.gcFuncTypeIndex(fn.params, fn.results)
        : this.getTypeIndex(fn.params, fn.results);
      w.writeU32(idx);
    }
  }

  private encodeTableSection(w: BinaryWriter): void {
    const localTables = this.mod.tables;
    w.writeU32(localTables.length);
    for (const t of localTables) {
      writeValueType(w, t.type);
      const hasMax = t.max !== null;
      w.writeU8(hasMax ? 1 : 0);
      w.writeU32(t.initial);
      if (hasMax) w.writeU32(t.max as number);
    }
  }

  private encodeMemorySection(w: BinaryWriter): void {
    const localMems = this.mod.memories;
    w.writeU32(localMems.length);
    for (const m of localMems) {
      const hasMax = m.max !== null;
      const flags = (hasMax ? 0x01 : 0) | (m.shared ? 0x02 : 0) | (m.is64 ? 0x04 : 0);
      w.writeU8(flags);
      w.writeU32(m.initial);
      if (hasMax) w.writeU32(m.max as number);
    }
  }

  private encodeGlobalSection(w: BinaryWriter): void {
    w.writeU32(this.mod.globals.length);
    for (const g of this.mod.globals) {
      writeValueType(w, g.type);
      w.writeU8(g.mutable ? 1 : 0);
      this.encodeInitExpr(w, g.init);
    }
  }

  private encodeExportSection(w: BinaryWriter): void {
    w.writeU32(this.mod.exports.length);
    for (const exp of this.mod.exports) {
      w.writeUTF8(exp.name);
      switch (exp.kind) {
        case 'function': {
          w.writeU8(0x00);
          w.writeU32(this.resolveRef(this.funcIndex, varFromToken(exp.value), 'exported function'));
          break;
        }
        case 'table': {
          w.writeU8(0x01);
          w.writeU32(this.resolveRef(this.tableIndex, varFromToken(exp.value), 'exported table'));
          break;
        }
        case 'memory': {
          w.writeU8(0x02);
          w.writeU32(this.resolveRef(this.memoryIndex, varFromToken(exp.value), 'exported memory'));
          break;
        }
        case 'global': {
          w.writeU8(0x03);
          w.writeU32(this.resolveRef(this.globalIndex, varFromToken(exp.value), 'exported global'));
          break;
        }
        case 'tag': {
          // EH proposal: export kind 0x04 = tag, payload is tag index.
          // Without this case the switch fell through, writing the export
          // name then NO kind/index bytes — corrupting every subsequent
          // export. (The matching `case 0x04` was also missing in the
          // parser, so tag exports never survived a round-trip.)
          w.writeU8(0x04);
          w.writeU32(this.resolveRef(this.tagIndex, varFromToken(exp.value), 'exported tag'));
          break;
        }
        default: {
          // The `tag` case above records what falling out of this switch does:
          // the export NAME is written and the kind/index bytes are not, which
          // silently corrupts this export and every one after it in the
          // section. Adding the missing case without a guard left the same
          // trap armed for the next kind. This `never` binding also makes TS
          // fail the build if `WasmExport["kind"]` gains a member and this
          // switch is not updated.
          const bad: never = exp.kind;
          throw new WasmEncodeError(
            `cannot encode export "${exp.name}": unknown export kind ${String(bad)}`,
          );
        }
      }
    }
  }

  private encodeStartSection(w: BinaryWriter): void {
    w.writeU32(
      this.resolveRef(this.funcIndex, varFromToken(this.mod.start as string), 'start function'),
    );
  }

  /**
   * The element section, one entry per segment.
   *
   * The leading `u32` is a bitfield, not an enum: bit 0 means "not active on
   * table 0", bit 1 distinguishes passive/declarative from active-with-a-table,
   * and bit 2 selects element EXPRESSIONS over function indices. Since
   * `ElementSegment.data` is a list of function names, only the index forms are
   * reachable here — kinds 0, 1, 2 and 3.
   *
   * ⚠️ This used to write kind 0 unconditionally, which is why the parser had to
   * refuse passive and declarative segments outright: storing one would have
   * emitted it as ACTIVE and written into the table at instantiation when the
   * source forbade it. `ElementSegment.mode` is what makes them representable.
   */
  private encodeElementSection(w: BinaryWriter): void {
    w.writeU32(this.mod.elements.length);
    for (const seg of this.mod.elements) {
      const tableIdx = seg.mode === 'active' ? this.tableRefIndex(varFromToken(seg.table)) : 0;
      // Kind 2 (active with an explicit table index) is only needed for a table
      // other than 0. Preferring kind 0 when we can keeps the common case one
      // byte shorter and matches what wabt-ts emits.
      const kind = seg.mode === 'passive'
        ? 1
        : seg.mode === 'declarative'
        ? 3
        : tableIdx === 0
        ? 0
        : 2;
      w.writeU32(kind);

      if (kind === 2) w.writeU32(tableIdx);
      if (seg.mode === 'active') {
        if (seg.offset) this.encodeInitExpr(w, seg.offset);
        else {
          w.writeU8(0x41);
          w.writeI32(0);
          w.writeU8(0x0b);
        }
      }
      // Kinds 1, 2 and 3 carry an elemkind byte before the vector; kind 0 does
      // not. 0x00 is `funcref`, the only elemkind the index forms allow.
      if (kind !== 0) w.writeU8(0x00);

      w.writeU32(seg.data.length);
      for (const fname of seg.data) {
        w.writeU32(
          this.resolveRef(this.funcIndex, varFromToken(fname), 'element-segment function'),
        );
      }
    }
  }

  private encodeCodeSection(w: BinaryWriter): void {
    w.writeU32(this.mod.functions.length);
    for (const fn of this.mod.functions) {
      const body = new BinaryWriter();
      this.encodeFunctionBody(body, fn);
      w.writeU32(body.byteLength);
      w.writeAll(body);
    }
  }

  private encodeTagSection(w: BinaryWriter): void {
    w.writeU32(this.mod.tags.length);
    for (const tag of this.mod.tags) {
      w.writeU8(0); // reserved attribute byte
      // When `mod.heapTypes` is non-empty the emitted type section iterates
      // `mod.heapTypes` directly (see `encodeTypeSection`), so an index into
      // it is the only correct reference. `getTypeIndex` looks up against
      // the deduped `this.types` collection, whose ordering does NOT match
      // `mod.heapTypes` when the input had extra (unused) type entries —
      // pointing the tag at the wrong type slot. Imports and the function
      // section already switch via this same condition; the tag section was
      // the one site that didn't. (Surfaced by the wasmtk team's bug report
      // as "tag's type-index re-pointed to a different entry in the type
      // section after `RemoveUnusedModuleElements`".)
      const idx = this.heapTypes.length > 0
        ? this.gcFuncTypeIndex(tag.params, [])
        : this.getTypeIndex(tag.params, []);
      w.writeU32(idx);
    }
  }

  private encodeDataSection(w: BinaryWriter): void {
    w.writeU32(this.mod.dataSegments.length);
    for (const seg of this.mod.dataSegments) {
      if (seg.passive) {
        w.writeU32(1); // passive
        w.writeU32(seg.data.length);
        w.writeBytes(seg.data);
      } else {
        if (seg.memory) {
          w.writeU32(2); // active, explicit memory index
          w.writeU32(seg.memory);
        } else {
          w.writeU32(0); // active, memory 0
        }
        this.encodeInitExpr(w, seg.offset!);
        w.writeU32(seg.data.length);
        w.writeBytes(seg.data);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Init expression (constant-only)
  // ---------------------------------------------------------------------------

  private encodeInitExpr(w: BinaryWriter, expr: Expression): void {
    this.encodeExpr(w, expr, []);
    w.writeU8(0x0b); // end
  }

  // ---------------------------------------------------------------------------
  // Function body
  // ---------------------------------------------------------------------------

  private encodeFunctionBody(w: BinaryWriter, fn: WasmFunction): void {
    // Locals: non-param locals only, run-length encoded
    const nonParamLocals = fn.locals.slice(fn.params.length);
    // Run-length grouping compares by KEY, not by `===`: a `RefType` is an
    // object, so two structurally-identical `(ref null $T)` locals are never
    // reference-equal and would each get their own group — correct output, but
    // needlessly larger. `valueTypeKey` merges them.
    const groups: { count: number; type: ValueType; key: string }[] = [];
    for (const loc of nonParamLocals) {
      const key = valueTypeKey(loc.type);
      const open = groups[groups.length - 1];
      if (open !== undefined && open.key === key) {
        open.count++;
      } else {
        groups.push({ count: 1, type: loc.type, key });
      }
    }
    w.writeU32(groups.length);
    for (const g of groups) {
      w.writeU32(g.count);
      writeValueType(w, g.type);
    }

    // Seed the label stack with the function's implicit-block label so a `br`
    // that exits the whole function resolves to the correct depth (= number of
    // enclosing blocks) instead of collapsing to the innermost frame. It is a
    // phantom — no `block` opcode is emitted for it — and is never resolved for
    // functions that don't branch to the function frame, so the common case is
    // unchanged.
    const labels: LabelStack = [fn.bodyFrameLabel ?? ''];
    // Label indices count from 0 in each function (N1 P5).
    this.funcLabels = this.mod.explicitNames?.labels.get(fn.name);
    this.funcLabelsOut = [];
    this.labelCount = 0;
    // The same rule as every other region, through the same helper. This was a
    // third open-coded copy; `Loop` and `try_table` were two places that had the
    // rule and did NOT apply it, which is how the shadowing bug survived.
    this.encodeRegionBody(w, fn.body, labels);
    w.writeU8(0x0b); // end
    if (this.funcLabelsOut.length > 0) {
      this.labelNames.set(this.funcIndex.get(fn.name)!, this.funcLabelsOut);
    }
  }

  /**
   * Emits a `try`/`catch` handler body. The catch opcode pushes the tag's
   * parameter values onto the operand stack of the *catch region*, where the
   * handler's instructions consume them directly. The binary parser packs a
   * multi-instruction handler into an anonymous (`name === null`) `Block`
   * container — exactly like the function-body frame — so it must be UNPACKED
   * here: emitting it via the normal `encodeExpr` path would wrap it in a
   * `block ... end` whose (void) blocktype does not inherit the catch-pushed
   * values, leaving the handler's `local.set` / `store` running on an empty
   * stack ("not enough arguments on the stack"). A named block, or a
   * single-expression handler, is emitted as-is.
   */
  /**
   * Emits the body of a REGION that is not itself a block — a `try` body or a
   * `catch` handler — unpacking the anonymous container the decoder wraps a
   * multi-instruction body in.
   *
   * The container is an artifact of the IR (one `Expression` per body), not
   * something the binary had. Emitting it as a real `block` re-wraps the body a
   * level deeper than it was read, and the wrapper carries the type `makeBlock`
   * INFERRED from its last child rather than the region's declared result type.
   * A body that exits via `br` ends in an `unreachable`-typed child, so the
   * wrapper is emitted with a void blocktype, absorbs the unreachability, and
   * yields nothing to a result-typed region — "expected 1 elements on the stack
   * for fallthru, found 0" on a module that was valid going in.
   *
   * The catch handlers had a second reason (WT-2g): `catch` pushes the tag's
   * params onto the catch region's stack, which an inner void-blocktype block
   * cannot receive. The other regions have only the typing reason, which is why
   * they went unnoticed longer.
   *
   * EVERY region goes through here. The four sites are the function body
   * (unpacked inline in `encodeFunctionBody`), the `if` arms, the `try` body
   * and the `catch` handlers — and three of them were found one at a time, each
   * time as a valid module that would not survive its own round trip. A region
   * added later must use this, not `encodeExpr`.
   *
   * `loop` / `try_table` / `block` bodies are NOT regions in this sense: their
   * container is stamped with the construct's declared result type by
   * `sealFrame`, so it encodes as a correctly-typed block. They are verbose
   * rather than wrong, and are left alone.
   */
  /**
   * The index of an element segment, by name.
   *
   * Fails loudly on a miss, like every other cross-section reference: silently
   * emitting index 0 would copy from the WRONG segment, which validates.
   */
  private elemSegmentIndex(v: Var): number {
    if (v.kind === 'index') return v.value;
    const name = v.name;
    const i = this.mod.elements.findIndex((e) => e.name === name);
    if (i < 0) throw new WasmEncodeError(`unresolved element segment reference: "${name}"`);
    return i;
  }

  /**
   * The index of a data segment, by name.
   *
   * Segments are held by NAME everywhere else in this IR, so a `memory.init`
   * naming a segment that does not exist is a dangling reference — the same
   * class as an unresolved branch label, and treated the same way. Silently
   * emitting index 0 would copy from the WRONG segment.
   */
  private dataSegmentIndex(v: Var): number {
    if (v.kind === 'index') return v.value;
    const name = v.name;
    const i = this.mod.dataSegments.findIndex((s) => s.name === name);
    if (i < 0) throw new WasmEncodeError(`unresolved data segment reference: "${name}"`);
    return i;
  }

  /**
   * The index of a table, by name.
   *
   * ⚠️ Multiple tables are refused elsewhere in this encoder (element segments
   * and `call_indirect` are written against table 0), so this resolves to 0 for
   * the single table and fails loudly for a name that does not match it. It is
   * written as a lookup rather than a hardcoded 0 so that lifting the
   * single-table limit is a change in one place, and so a typo'd table name
   * cannot quietly become table 0.
   */
  private tableRefIndex(v: Var): number {
    if (v.kind === 'index') return v.value;
    const name = v.name;
    const defined = this.mod.tables.findIndex((t) => t.name === name);
    if (defined >= 0) return defined + this.importedTableCount();
    const imported = this.mod.imports.filter((i) => i.kind === 'table');
    const ii = imported.findIndex((i) => i.name === name);
    if (ii >= 0) return ii;
    throw new WasmEncodeError(`unresolved table reference: "${name}"`);
  }

  private importedTableCount(): number {
    return this.mod.imports.filter((i) => i.kind === 'table').length;
  }

  /**
   * The data count section (id 12).
   *
   * ⚠️ REQUIRED whenever `memory.init` or `data.drop` appears, and it must come
   * BEFORE the code section — a validator needs the segment count while
   * type-checking those instructions, which is the whole reason the section
   * exists. Emitting the ops without it produces a module every engine rejects.
   *
   * It was absent for as long as those two instructions were unimplemented, so
   * nothing could reach the invalid combination. That coupling is why the two
   * were fixed in one change rather than separately.
   *
   * Emitted when a function body names a data segment, or when the module was
   * decoded from a binary that had one (`WasmModule.hasDataCount`) — the rule
   * wabt-ts's writer follows, because two tools in this repo disagreeing about
   * the section list for the same module is its own defect.
   *
   * 🔧 W6: both used to emit it whenever a data segment EXISTED. Upstream
   * `wat2wasm` and `wasm-tools` emit it only when code uses a data index, and
   * 242 corpus modules differed from upstream in this section alone. The
   * "decoded with one" half keeps a binary round trip exact: a module that
   * carried a DataCount it did not need keeps it.
   */
  private encodeDataCountSection(w: BinaryWriter): void {
    w.writeU32(this.mod.dataSegments.length);
  }

  /**
   * Whether a function body names a data segment — `memory.init`, `data.drop`,
   * `array.new_data`, `array.init_data` — which makes the DataCount section
   * required.
   */
  private usesDataIndex(): boolean {
    const DATA_INDEX_USERS: ReadonlySet<string> = new Set([
      ExpressionKind.MemoryInit,
      ExpressionKind.DataDrop,
      ExpressionKind.ArrayNewData,
      ExpressionKind.ArrayInitData,
    ]);
    let found = false;
    const visit = (e: Expression): void => {
      if (found) return;
      if (DATA_INDEX_USERS.has(e.kind)) {
        found = true;
        return;
      }
      visitChildren(e, visit);
    };
    for (const fn of this.mod.functions) {
      visit(fn.body);
      if (found) return true;
    }
    return false;
  }

  /**
   * A region's instructions, with no header or `end` of its own — the owning
   * construct writes those. It used to inline any UNNAMED block found here, on
   * the convention that only a synthetic wrapper was unnamed; a region is a kind
   * now, and every `Block` is emitted as the block it is.
   */
  private encodeRegionBody(w: BinaryWriter, body: RegionExpr, labels: LabelStack): void {
    for (const child of body.children) this.encodeExpr(w, child, labels);
  }

  // ---------------------------------------------------------------------------
  // Expression encoder (recursive, stack-machine order)
  // ---------------------------------------------------------------------------

  private resolveLabel(labels: LabelStack, name: string): number {
    for (let i = labels.length - 1; i >= 0; i--) {
      if (labels[i] === name) return labels.length - 1 - i;
    }
    // Every legitimate branch target is on the stack: named blocks/loops, the
    // `if` label (threaded via IfExpr.name), and the function frame (seeded at
    // the bottom). A miss therefore means a dangling branch — a pass dropped or
    // renamed the target's label but left the `br`. The old `return 0` silently
    // re-pointed it at the innermost frame, corrupting control flow; fail loud.
    throw new WasmEncodeError(`unresolved branch label: "${name}"`);
  }

  /**
   * One expression — and, after a control construct TYPED unreachable, an extra
   * `unreachable` opcode.
   *
   * A `block` / `loop` / `if` / `try` / `try_table` is validated against its
   * DECLARED type: after its `end` the stack holds exactly its results, never a
   * polymorphic one, however surely every path inside throws or traps. The IR
   * may type such a construct `unreachable`, and a pass reading that type may
   * leave nothing after it — so without this a tree a pass built was invalid
   * wherever a value had to follow (`unreachable_construct.test.ts`). Upstream's
   * writer does exactly this (`wasm-stack.h`, `BinaryenIRWriter::visitBlock` and
   * its siblings). A DECODED construct carries its declared type, so a plain
   * decode → encode never reaches the extra byte.
   */
  private encodeExpr(w: BinaryWriter, expr: Expression, labels: LabelStack): void {
    this.encodeExprInner(w, expr, labels);
    if (expr.type === Unreachable && isControlConstruct(expr)) w.writeU8(0x00);
  }

  private encodeExprInner(w: BinaryWriter, expr: Expression, labels: LabelStack): void {
    switch (expr.kind) {
      case ExpressionKind.Nop: {
        w.writeU8(0x01);
        break;
      }

      case ExpressionKind.Region:
        // Regions are reached only through `encodeRegionBody`, from the slot
        // that owns them. One here is sitting in an operand or statement
        // position, which the type admits (a Region is an Expression) and the IR
        // forbids — emitting its children inline would silently change what the
        // surrounding code consumes.
        throw new WasmEncodeError('a region outside a region slot');
      case ExpressionKind.Unreachable: {
        w.writeU8(0x00);
        break;
      }

      case ExpressionKind.Block: {
        const e = expr as BlockExpr;
        this.encodeParamValues(w, e, labels);
        w.writeU8(0x02);
        this.writeCarrierType(w, e);
        this.noteLabel(e.name);
        labels.push(e.name ?? null);
        for (const child of e.children) this.encodeExpr(w, child, labels);
        labels.pop();
        w.writeU8(0x0b);
        break;
      }

      case ExpressionKind.Loop: {
        const e = expr as LoopExpr;
        this.encodeParamValues(w, e, labels);
        w.writeU8(0x03);
        this.writeCarrierType(w, e);
        this.noteLabel(e.name);
        labels.push(e.name);
        // A REGION, like the `if` arms — see `encodeRegionBody`. Encoding the
        // body directly emitted the parser's synthetic wrapper as a real nested
        // block, which was not merely 3 wasted bytes: the wrapper is unnamed, so
        // it went onto the label stack as `''` — the SAME sentinel as the
        // function frame — and shadowed it. `(loop $l (nop) (br 1 …))` then
        // branched to the wrapper instead of out of the function, returning the
        // fallthrough value. Valid module, wrong answer.
        this.encodeRegionBody(w, e.body, labels);
        labels.pop();
        w.writeU8(0x0b);
        break;
      }

      case ExpressionKind.If: {
        const e = expr as IfExpr;
        this.encodeParamValues(w, e, labels); // below the condition on the stack
        this.encodeExpr(w, e.condition, labels);
        w.writeU8(0x04);
        this.writeCarrierType(w, e);
        this.noteLabel(e.name);
        labels.push(e.name ?? null); // the if's branch-target label (if any)
        // The arms are REGIONS, not blocks — see `encodeRegionBody`. An arm that
        // exits via `br` ends in an unreachable-typed child, so re-wrapping it
        // emitted a void blocktype that absorbed the unreachability and yielded
        // nothing to a result-typed `if`.
        this.encodeRegionBody(w, e.ifTrue, labels);
        if (e.ifFalse) {
          w.writeU8(0x05); // else
          this.encodeRegionBody(w, e.ifFalse, labels);
        }
        labels.pop();
        w.writeU8(0x0b);
        break;
      }

      case ExpressionKind.Break: {
        const e = expr as BreakExpr;
        for (const v of e.values) this.encodeExpr(w, v, labels);
        if (e.condition) {
          this.encodeExpr(w, e.condition, labels);
          w.writeU8(0x0d); // br_if
        } else {
          w.writeU8(0x0c); // br
        }
        w.writeU32(this.resolveLabel(labels, e.target));
        break;
      }

      case ExpressionKind.Switch: {
        const e = expr as SwitchExpr;
        for (const v of e.values) this.encodeExpr(w, v, labels);
        this.encodeExpr(w, e.condition, labels);
        w.writeU8(0x0e); // br_table
        w.writeU32(e.targets.length);
        for (const t of e.targets) w.writeU32(this.resolveLabel(labels, t));
        w.writeU32(this.resolveLabel(labels, e.defaultTarget));
        break;
      }

      case ExpressionKind.Return: {
        const e = expr as ReturnExpr;
        for (const v of e.values) this.encodeExpr(w, v, labels);
        w.writeU8(0x0f);
        break;
      }

      case ExpressionKind.Const: {
        const e = expr as ConstExpr;
        const v = e.value;
        if ('i32' in v) {
          w.writeU8(0x41);
          w.writeI32(v.i32);
        } else if ('i64' in v) {
          w.writeU8(0x42);
          w.writeI64(v.i64);
        } else if ('f32' in v) {
          w.writeU8(0x43);
          w.writeF32(v.f32);
        } else if ('v128' in v) {
          w.writeU8(0xfd);
          w.writeU32(0x0c);
          w.writeBytes((v as { v128: Uint8Array }).v128);
        } else {
          w.writeU8(0x44);
          w.writeF64((v as { f64: number }).f64);
        }
        break;
      }

      case ExpressionKind.LocalGet: {
        const e = expr as LocalGetExpr;
        w.writeU8(0x20);
        w.writeU32(requireIndex(e.index, 'local index'));
        break;
      }
      case ExpressionKind.LocalSet: {
        const e = expr as LocalSetExpr;
        this.encodeExpr(w, e.value, labels);
        w.writeU8(0x21);
        w.writeU32(requireIndex(e.index, 'local index'));
        break;
      }
      case ExpressionKind.LocalTee: {
        const e = expr as LocalTeeExpr;
        this.encodeExpr(w, e.value, labels);
        w.writeU8(0x22);
        w.writeU32(requireIndex(e.index, 'local index'));
        break;
      }

      case ExpressionKind.GlobalGet: {
        const e = expr as GlobalGetExpr;
        w.writeU8(0x23);
        w.writeU32(
          this.resolveRef(
            this.globalIndex,
            e.var,
            'global.get',
          ),
        );
        break;
      }
      case ExpressionKind.GlobalSet: {
        const e = expr as GlobalSetExpr;
        this.encodeExpr(w, e.value, labels);
        w.writeU8(0x24);
        w.writeU32(
          this.resolveRef(
            this.globalIndex,
            e.var,
            'global.set',
          ),
        );
        break;
      }

      case ExpressionKind.TableGet: {
        const e = expr as TableGetExpr;
        this.encodeExpr(w, e.index, labels);
        w.writeU8(0x25);
        w.writeU32(this.resolveRef(this.tableIndex, e.table, 'table.get'));
        break;
      }
      case ExpressionKind.TableSet: {
        const e = expr as TableSetExpr;
        this.encodeExpr(w, e.index, labels);
        this.encodeExpr(w, e.value, labels);
        w.writeU8(0x26);
        w.writeU32(this.resolveRef(this.tableIndex, e.table, 'table.set'));
        break;
      }

      case ExpressionKind.Unary: {
        const e = expr as UnaryExpr;
        this.encodeExpr(w, e.value, labels);
        this.writeOperator(w, e.opcode);
        break;
      }

      case ExpressionKind.Binary: {
        const e = expr as BinaryExpr;
        this.encodeExpr(w, e.left, labels);
        this.encodeExpr(w, e.right, labels);
        // No special case for the 0xfc-prefixed wide-multiply pair any more:
        // the opcode carries its own prefix, so writeOperator handles it.
        this.writeOperator(w, e.opcode);
        break;
      }

      case ExpressionKind.Select: {
        const e = expr as SelectExpr;
        this.encodeExpr(w, e.val1, labels);
        this.encodeExpr(w, e.val2, labels);
        this.encodeExpr(w, e.condition, labels);
        // A DECLARED type is written as declared — the typed form, numeric or
        // not (S6 decision 7a; upstream binaryen writes a numeric one untyped).
        // Without one, the untyped form (0x1b) is legal only over numeric and
        // vector types; a select over references MUST be the typed form and
        // carry its type — upstream binaryen's rule for a select it built.
        const t = e.resultType ?? e.type;
        if (e.resultType !== null || (t !== undefined && isRef(t))) {
          w.writeU8(0x1c);
          w.writeU32(1);
          writeValueType(w, t as ValType | RefType);
        } else {
          w.writeU8(0x1b);
        }
        break;
      }

      case ExpressionKind.Drop: {
        const e = expr as DropExpr;
        this.encodeExpr(w, e.value, labels);
        w.writeU8(0x1a);
        break;
      }

      case ExpressionKind.Load: {
        const e = expr as LoadExpr;
        this.encodeExpr(w, e.address, labels);
        // The node holds the opcode it was written with — `v128.load`'s
        // `0xFD 0x00` included — so nothing is recomputed from width, sign or
        // result type here (see memory-access.ts for what that used to cost).
        this.writeOperator(w, e.opcode);
        this.writeMemArg(w, e.align, e.offset, e.memidx);
        break;
      }

      case ExpressionKind.Store: {
        const e = expr as StoreExpr;
        this.encodeExpr(w, e.address, labels);
        this.encodeExpr(w, e.value, labels);
        // Not derived from `e.value.type`: a store whose operand is untyped
        // (unreachable, or not yet finalized) is still a well-formed store.
        this.writeOperator(w, e.opcode);
        this.writeMemArg(w, e.align, e.offset, e.memidx);
        break;
      }

      case ExpressionKind.MemorySize: {
        w.writeU8(0x3f);
        w.writeU8(memIndex((expr as MemorySizeExpr).memidx, 'memory.size'));
        break;
      }
      case ExpressionKind.MemoryGrow: {
        const e = expr as MemoryGrowExpr;
        this.encodeExpr(w, e.delta, labels);
        w.writeU8(0x40);
        w.writeU8(memIndex(e.memidx, e.kind));
        break;
      }
      case ExpressionKind.TableInit: {
        const e = expr as TableInitExpr;
        this.encodeExpr(w, e.dest, labels);
        this.encodeExpr(w, e.source, labels);
        this.encodeExpr(w, e.size, labels);
        w.writeU8(0xfc);
        w.writeU32(12);
        // Segment index FIRST, then table — the reverse of `table.copy`, whose
        // two immediates are both tables.
        w.writeU32(this.elemSegmentIndex(e.segment));
        w.writeU32(this.tableRefIndex(e.table));
        break;
      }

      case ExpressionKind.ElemDrop: {
        const e = expr as ElemDropExpr;
        w.writeU8(0xfc);
        w.writeU32(13);
        w.writeU32(this.elemSegmentIndex(e.segment));
        break;
      }

      case ExpressionKind.MemoryInit: {
        const e = expr as MemoryInitExpr;
        this.encodeExpr(w, e.dest, labels);
        this.encodeExpr(w, e.source, labels);
        this.encodeExpr(w, e.size, labels);
        w.writeU8(0xfc);
        w.writeU32(8);
        w.writeU32(this.dataSegmentIndex(e.segment));
        w.writeU8(memIndex(e.memidx, e.kind));
        break;
      }

      case ExpressionKind.DataDrop: {
        const e = expr as DataDropExpr;
        w.writeU8(0xfc);
        w.writeU32(9);
        w.writeU32(this.dataSegmentIndex(e.segment));
        break;
      }

      case ExpressionKind.TableSize: {
        const e = expr as TableSizeExpr;
        w.writeU8(0xfc);
        w.writeU32(16);
        w.writeU32(this.tableRefIndex(e.table));
        break;
      }

      case ExpressionKind.TableGrow: {
        const e = expr as TableGrowExpr;
        this.encodeExpr(w, e.value, labels);
        this.encodeExpr(w, e.delta, labels);
        w.writeU8(0xfc);
        w.writeU32(15);
        w.writeU32(this.tableRefIndex(e.table));
        break;
      }

      case ExpressionKind.TableFill: {
        const e = expr as TableFillExpr;
        this.encodeExpr(w, e.dest, labels);
        this.encodeExpr(w, e.value, labels);
        this.encodeExpr(w, e.size, labels);
        w.writeU8(0xfc);
        w.writeU32(17);
        w.writeU32(this.tableRefIndex(e.table));
        break;
      }

      case ExpressionKind.TableCopy: {
        const e = expr as TableCopyExpr;
        this.encodeExpr(w, e.dest, labels);
        this.encodeExpr(w, e.source, labels);
        this.encodeExpr(w, e.size, labels);
        w.writeU8(0xfc);
        w.writeU32(14);
        // Destination table first, then source — the operand order and the
        // immediate order agree here, unlike `memory.copy`, whose two zero
        // immediates are memory indices rather than dst/src.
        w.writeU32(this.tableRefIndex(e.destTable));
        w.writeU32(this.tableRefIndex(e.sourceTable));
        break;
      }

      case ExpressionKind.MemoryCopy: {
        const e = expr as MemoryCopyExpr;
        this.encodeExpr(w, e.dest, labels);
        this.encodeExpr(w, e.source, labels);
        this.encodeExpr(w, e.size, labels);
        w.writeU8(0xfc);
        w.writeU32(10);
        w.writeU8(memIndex(e.destMemidx, e.kind));
        w.writeU8(memIndex(e.srcMemidx, e.kind));
        break;
      }
      case ExpressionKind.MemoryFill: {
        const e = expr as MemoryFillExpr;
        this.encodeExpr(w, e.dest, labels);
        this.encodeExpr(w, e.value, labels);
        this.encodeExpr(w, e.size, labels);
        w.writeU8(0xfc);
        w.writeU32(11);
        w.writeU8(memIndex(e.memidx, e.kind));
        break;
      }

      case ExpressionKind.Call: {
        const e = expr as CallExpr;
        for (const opcode of e.operands) this.encodeExpr(w, opcode, labels);
        // 0x10 = call, 0x12 = return_call (tail-call proposal).
        w.writeU8(e.isReturn ? 0x12 : 0x10);
        w.writeU32(this.resolveRef(this.funcIndex, e.func, 'call target'));
        break;
      }

      case ExpressionKind.CallIndirect: {
        const e = expr as CallIndirectExpr;
        for (const opcode of e.operands) this.encodeExpr(w, opcode, labels);
        this.encodeExpr(w, e.callee, labels);
        // 0x11 = call_indirect, 0x13 = return_call_indirect (tail-call proposal).
        w.writeU8(e.isReturn ? 0x13 : 0x11);
        // The index AS WRITTEN where the decoder recorded one (7c): a module may
        // hold several structurally identical function types, and deriving the
        // index picks the FIRST — re-encoding `(type $b)` as `(type $a)`, a
        // different instruction for the same behaviour (T1).
        const ciIdx = e.typeIndex ??
          (this.heapTypes.length > 0
            ? this.gcFuncTypeIndex(e.sig.params, e.sig.results)
            : this.getTypeIndex(e.sig.params, e.sig.results));
        w.writeU32(ciIdx);
        w.writeU32(this.resolveRef(this.tableIndex, e.table, 'call_indirect table'));
        break;
      }

      case ExpressionKind.RefNull: {
        const e = expr as RefNullExpr;
        w.writeU8(0xd0);
        // `ref.null` takes a HEAP type. For a concrete `(ref null $T)` that is
        // the type index, which `writeHeapType` encodes as a signed LEB — the
        // single-byte abstract form only covers the built-in heap types.
        if (isRefType(e.type)) {
          writeHeapType(w, e.type.heap);
        } else {
          w.writeU8(refHeapTypeByte(e.type as ValType));
        }
        break;
      }
      case ExpressionKind.RefIsNull: {
        const e = expr as RefIsNullExpr;
        this.encodeExpr(w, e.value, labels);
        w.writeU8(0xd1);
        break;
      }
      case ExpressionKind.RefAs: {
        const e = expr as RefAsExpr;
        this.encodeExpr(w, e.value, labels);
        // `ref.as` names exactly one instruction, so the kind IS the operator
        // and there is nothing to reject. The guard that stood here tested a
        // field that could only ever hold `RefAsNonNull`.
        w.writeU8(0xd4); // ref.as_non_null
        break;
      }
      case ExpressionKind.RefFunc: {
        const e = expr as RefFuncExpr;
        w.writeU8(0xd2);
        w.writeU32(this.resolveRef(this.funcIndex, varFromToken(e.func), 'ref.func'));
        break;
      }

      case ExpressionKind.RefEq: {
        const e = expr as RefEqExpr;
        this.encodeExpr(w, e.left, labels);
        this.encodeExpr(w, e.right, labels);
        w.writeU8(0xd3);
        break;
      }
      case ExpressionKind.RefI31: {
        const e = expr as RefI31Expr;
        this.encodeExpr(w, e.value, labels);
        w.writeU8(0xfb);
        w.writeU32(0x1c);
        break;
      }
      case ExpressionKind.AnyConvertExtern:
      case ExpressionKind.ExternConvertAny: {
        this.encodeExpr(w, expr.value, labels);
        w.writeU8(0xfb);
        w.writeU32(expr.kind === ExpressionKind.AnyConvertExtern ? 0x1a : 0x1b);
        break;
      }
      case ExpressionKind.I31Get: {
        const e = expr as I31GetExpr;
        this.encodeExpr(w, e.i31, labels);
        w.writeU8(0xfb);
        w.writeU32(e.signed ? 0x1d : 0x1e);
        break;
      }
      case ExpressionKind.StructNew: {
        const e = expr as StructNewExpr;
        if (!e.defaultInit) { for (const opcode of e.operands) this.encodeExpr(w, opcode, labels); }
        w.writeU8(0xfb);
        w.writeU32(e.defaultInit ? 0x01 : 0x00);
        w.writeU32(requireIndex(e.typeVar, e.kind));
        break;
      }
      case ExpressionKind.StructGet: {
        const e = expr as StructGetExpr;
        this.encodeExpr(w, e.ref, labels);
        w.writeU8(0xfb);
        w.writeU32(
          this.packedGetSubop(
            requireIndex(e.typeVar, e.kind),
            requireIndex(e.fieldVar, 'struct.get field'),
            e.signed,
            'struct',
          ),
        );
        w.writeU32(requireIndex(e.typeVar, e.kind));
        w.writeU32(requireIndex(e.fieldVar, 'struct.get field'));
        break;
      }
      case ExpressionKind.StructSet: {
        const e = expr as StructSetExpr;
        this.encodeExpr(w, e.ref, labels);
        this.encodeExpr(w, e.value, labels);
        w.writeU8(0xfb);
        w.writeU32(0x05);
        w.writeU32(requireIndex(e.typeVar, e.kind));
        w.writeU32(requireIndex(e.fieldVar, 'struct.set field'));
        break;
      }
      case ExpressionKind.ArrayNew: {
        const e = expr as ArrayNewExpr;
        if (e.init !== null) this.encodeExpr(w, e.init, labels);
        this.encodeExpr(w, e.length, labels);
        w.writeU8(0xfb);
        w.writeU32(e.init === null ? 0x07 : 0x06);
        w.writeU32(requireIndex(e.typeVar, e.kind));
        break;
      }
      case ExpressionKind.ArrayNewFixed: {
        const e = expr as ArrayNewFixedExpr;
        for (const v of e.operands) this.encodeExpr(w, v, labels);
        w.writeU8(0xfb);
        w.writeU32(0x08);
        w.writeU32(requireIndex(e.typeVar, e.kind));
        w.writeU32(e.operands.length);
        break;
      }
      case ExpressionKind.ArrayNewData: {
        const e = expr as ArrayNewDataExpr;
        this.encodeExpr(w, e.offset, labels);
        this.encodeExpr(w, e.length, labels);
        w.writeU8(0xfb);
        w.writeU32(0x09);
        w.writeU32(requireIndex(e.typeVar, e.kind));
        w.writeU32(requireIndex(e.dataVar, 'array.new_data segment'));
        break;
      }
      case ExpressionKind.ArrayNewElem: {
        const e = expr as ArrayNewElemExpr;
        this.encodeExpr(w, e.offset, labels);
        this.encodeExpr(w, e.length, labels);
        w.writeU8(0xfb);
        w.writeU32(0x0a);
        w.writeU32(requireIndex(e.typeVar, e.kind));
        w.writeU32(requireIndex(e.elemVar, 'array.new_elem segment'));
        break;
      }
      case ExpressionKind.ArrayGet: {
        const e = expr as ArrayGetExpr;
        this.encodeExpr(w, e.ref, labels);
        this.encodeExpr(w, e.index, labels);
        w.writeU8(0xfb);
        w.writeU32(this.packedGetSubop(requireIndex(e.typeVar, e.kind), 0, e.signed, 'array'));
        w.writeU32(requireIndex(e.typeVar, e.kind));
        break;
      }
      case ExpressionKind.ArraySet: {
        const e = expr as ArraySetExpr;
        this.encodeExpr(w, e.ref, labels);
        this.encodeExpr(w, e.index, labels);
        this.encodeExpr(w, e.value, labels);
        w.writeU8(0xfb);
        w.writeU32(0x0e);
        w.writeU32(requireIndex(e.typeVar, e.kind));
        break;
      }
      case ExpressionKind.ArrayFill: {
        const e = expr as ArrayFillExpr;
        this.encodeExpr(w, e.ref, labels);
        this.encodeExpr(w, e.offset, labels);
        this.encodeExpr(w, e.value, labels);
        this.encodeExpr(w, e.size, labels);
        w.writeU8(0xfb);
        w.writeU32(0x10);
        w.writeU32(requireIndex(e.typeVar, e.kind));
        break;
      }
      case ExpressionKind.ArrayCopy: {
        const e = expr as ArrayCopyExpr;
        this.encodeExpr(w, e.destRef, labels);
        this.encodeExpr(w, e.destOffset, labels);
        this.encodeExpr(w, e.srcRef, labels);
        this.encodeExpr(w, e.srcOffset, labels);
        this.encodeExpr(w, e.size, labels);
        w.writeU8(0xfb);
        w.writeU32(0x11);
        // Immediate order is destination type THEN source type.
        w.writeU32(requireIndex(e.destTypeVar, e.kind));
        w.writeU32(requireIndex(e.srcTypeVar, e.kind));
        break;
      }
      case ExpressionKind.ArrayInitData:
      case ExpressionKind.ArrayInitElem: {
        const e = expr as ArrayInitDataExpr | ArrayInitElemExpr;
        this.encodeExpr(w, e.ref, labels);
        this.encodeExpr(w, e.destOffset, labels);
        this.encodeExpr(w, e.srcOffset, labels);
        this.encodeExpr(w, e.size, labels);
        w.writeU8(0xfb);
        w.writeU32(e.kind === ExpressionKind.ArrayInitData ? 0x12 : 0x13);
        w.writeU32(requireIndex(e.typeVar, e.kind));
        w.writeU32(
          e.kind === ExpressionKind.ArrayInitData
            ? this.dataSegmentIndex(e.segment)
            : this.elemSegmentIndex(e.segment),
        );
        break;
      }
      case ExpressionKind.ArrayLen: {
        const e = expr as ArrayLenExpr;
        this.encodeExpr(w, e.ref, labels);
        w.writeU8(0xfb);
        w.writeU32(0x0f);
        break;
      }
      case ExpressionKind.RefTest: {
        const e = expr as RefTestExpr;
        this.encodeExpr(w, e.ref, labels);
        w.writeU8(0xfb);
        w.writeU32(e.nullable ? 0x15 : 0x14);
        writeHeapType(w, e.castType);
        break;
      }
      case ExpressionKind.RefCast: {
        const e = expr as RefCastExpr;
        this.encodeExpr(w, e.ref, labels);
        w.writeU8(0xfb);
        w.writeU32(e.nullable ? 0x17 : 0x16);
        writeHeapType(w, e.castType);
        break;
      }
      case ExpressionKind.BrOn: {
        const e = expr as BrOnExpr;
        this.encodeExpr(w, e.ref, labels);
        const depth = this.resolveLabel(labels, e.target);
        if (e.opcode === BrOnOp.Null) {
          w.writeU8(0xd5);
          w.writeU32(depth);
        } else if (e.opcode === BrOnOp.NonNull) {
          w.writeU8(0xd6);
          w.writeU32(depth);
        } else {
          w.writeU8(0xfb);
          w.writeU32(e.opcode === BrOnOp.Cast ? 0x18 : 0x19);
          // flags: bit 0 = source nullable, bit 1 = cast-target nullable.
          w.writeU8((e.from?.nullable ? 0x01 : 0x00) | (e.to?.nullable ? 0x02 : 0x00));
          w.writeU32(depth);
          // Two distinct heap-type immediates: source (`rt1`) then target
          // (`rt2`). Emitting the target twice corrupted the source immediate.
          writeHeapType(w, e.from?.heapType ?? AbstractHeapType.Any);
          writeHeapType(w, e.to?.heapType ?? AbstractHeapType.Any);
        }
        break;
      }

      case ExpressionKind.TryTable: {
        const e = expr as TryTableExpr;
        this.encodeParamValues(w, e, labels);
        w.writeU8(0x1f); // try_table
        this.writeCarrierType(w, e);
        w.writeU32(e.catches.length);
        // The catch clauses are resolved BEFORE the try_table label is pushed:
        // its own label is not in scope for its handlers, so depth 0 names the
        // enclosing frame. Pushing first emitted every handler one frame too
        // deep — symmetric with the decoder, so round-trips hid it, but IR
        // built anywhere else (a pass, the wabt-ts bridge) encoded wrong.
        for (const c of e.catches) {
          if (c.tag !== undefined) {
            w.writeU8(c.isRef ? 0x01 : 0x00); // catch / catch_ref
            w.writeU32(this.resolveRef(this.tagIndex, c.tag, 'try_table catch tag'));
          } else {
            w.writeU8(c.isRef ? 0x03 : 0x02); // catch_all / catch_all_ref
          }
          w.writeU32(this.resolveLabel(labels, c.target));
        }
        this.noteLabel(e.name);
        labels.push(e.name ?? null);
        this.encodeRegionBody(w, e.body, labels);
        labels.pop();
        w.writeU8(0x0b);
        break;
      }

      case ExpressionKind.Try: {
        const e = expr as TryExpr;
        this.encodeParamValues(w, e, labels);
        if (e.delegateTarget !== null) {
          // try...delegate: emitted as try body + delegate opcode (no end)
          w.writeU8(0x06); // try
          this.writeCarrierType(w, e);
          this.noteLabel(e.name);
          labels.push(e.name ?? null);
          this.encodeRegionBody(w, e.body, labels);
          labels.pop();
          w.writeU8(0x18); // delegate
          w.writeU32(this.resolveLabel(labels, e.delegateTarget));
        } else {
          w.writeU8(0x06); // try
          this.writeCarrierType(w, e);
          this.noteLabel(e.name);
          labels.push(e.name ?? null);
          this.encodeRegionBody(w, e.body, labels);
          // The length guard that stood here — "try has N catch tags but M
          // bodies" — is gone with the parallel arrays that made the mismatch
          // representable. A clause carries its own body.
          for (const c of e.catches) {
            if (c.tag === undefined) {
              w.writeU8(c.isRef ? 0x18 : 0x19); // catch_all_ref : catch_all
            } else {
              w.writeU8(c.isRef ? 0x08 : 0x07); // catch_ref : catch
              w.writeU32(this.resolveRef(this.tagIndex, c.tag, 'catch tag'));
            }
            this.encodeRegionBody(w, c.body, labels);
          }
          labels.pop();
          w.writeU8(0x0b);
        }
        break;
      }

      case ExpressionKind.Throw: {
        const e = expr as ThrowExpr;
        for (const opcode of e.operands) this.encodeExpr(w, opcode, labels);
        w.writeU8(0x08);
        w.writeU32(this.resolveRef(this.tagIndex, e.tag, 'throw tag'));
        break;
      }

      case ExpressionKind.ThrowRef: {
        const e = expr as ThrowRefExpr;
        this.encodeExpr(w, e.exnref, labels);
        w.writeU8(0x0a);
        break;
      }

      case ExpressionKind.Rethrow: {
        const e = expr as RethrowExpr;
        w.writeU8(0x09);
        w.writeU32(this.resolveLabel(labels, e.target));
        break;
      }

      case ExpressionKind.Pop: {
        // Pop is a pseudo-instruction; not emitted in the binary format
        break;
      }

      case ExpressionKind.SIMDExtract: {
        const e = expr as SIMDExtractExpr;
        this.encodeExpr(w, e.vec, labels);
        this.writeOperator(w, e.opcode);
        w.writeU8(e.lane);
        break;
      }

      case ExpressionKind.SIMDReplace: {
        const e = expr as SIMDReplaceExpr;
        this.encodeExpr(w, e.vec, labels);
        this.encodeExpr(w, e.value, labels);
        this.writeOperator(w, e.opcode);
        w.writeU8(e.lane);
        break;
      }

      case ExpressionKind.SIMDShuffle: {
        const e = expr as SIMDShuffleExpr;
        this.encodeExpr(w, e.left, labels);
        this.encodeExpr(w, e.right, labels);
        w.writeU8(0xfd);
        w.writeU32(0x0d);
        w.writeBytes(e.lanes);
        break;
      }

      case ExpressionKind.Quaternary: {
        const e = expr as QuaternaryExpr;
        // Stack order matches the decoder's reverse pops: a, b, c, d.
        this.encodeExpr(w, e.a, labels);
        this.encodeExpr(w, e.b, labels);
        this.encodeExpr(w, e.c, labels);
        this.encodeExpr(w, e.d, labels);
        w.writeU8(0xfc);
        w.writeU32(e.opcode === QuaternaryOp.Add128 ? 19 : 20);
        break;
      }

      case ExpressionKind.SIMDTernary: {
        const e = expr as SIMDTernaryExpr;
        // Stack order: a pushed first, b second, c on top (decoder pops c,b,a)
        this.encodeExpr(w, e.a, labels);
        this.encodeExpr(w, e.b, labels);
        this.encodeExpr(w, e.c, labels);
        w.writeU8(0xfd);
        w.writeU32(0x52);
        break;
      }

      case ExpressionKind.SIMDLoad: {
        const e = expr as SIMDLoadExpr;
        this.encodeExpr(w, e.address, labels);
        this.writeOperator(w, e.opcode);
        this.writeMemArg(w, e.align, e.offset, e.memidx);
        break;
      }

      case ExpressionKind.SIMDLoadStoreLane: {
        const e = expr as SIMDLoadStoreLaneExpr;
        this.encodeExpr(w, e.address, labels);
        this.encodeExpr(w, e.vec, labels);
        this.writeOperator(w, e.opcode);
        this.writeMemArg(w, e.align, e.offset, e.memidx);
        w.writeU8(e.lane);
        break;
      }

      default: {
        // Unknown / unsupported expression kind. Emitting a `nop` here silently
        // dropped the subtree (and any stack values it was meant to consume or
        // produce), yielding an invalid or wrong module. Fail loudly instead.
        throw new WasmEncodeError(
          `cannot encode unsupported expression kind: ${(expr as { kind: string }).kind}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Thrown when the IR cannot be serialized (e.g. unknown expression kind).
 */
export class WasmEncodeError extends Error {
  /**
   * Creates an encode error with the given message.
   *
   * @param message - Human-readable description of what couldn't be encoded
   *   (e.g. "unknown expression kind: BrOn"). The error's `name` is always
   *   `"WasmEncodeError"` for `instanceof`-free type discrimination.
   */
  constructor(message: string) {
    super(message);
    this.name = 'WasmEncodeError';
  }
}

/**
 * Serialize a {@link WasmModule} IR into a WebAssembly 1.0 binary.
 *
 * The output is a valid `.wasm` binary that can be re-parsed by {@link parseWasm}
 * or executed by any standard WebAssembly runtime.
 *
 * @param mod - The module to encode.
 * @returns A `Uint8Array` containing the WASM binary.
 *
 * @example
 * ```ts
 * import { encodeWasm } from "@jrmarcum/binaryang/encoder";
 * import { parseWasm } from "@jrmarcum/binaryang/binary";
 * import { readFile, writeFile } from "node:fs/promises";
 *
 * const bytes = new Uint8Array(await readFile("module.wasm"));
 * const mod = parseWasm(bytes);
 * // ... run passes ...
 * const optimized = encodeWasm(mod);
 * await writeFile("module.opt.wasm", optimized);
 * ```
 */
export function encodeWasm(mod: WasmModule): Uint8Array {
  return new WasmEncoder(mod).encode();
}
