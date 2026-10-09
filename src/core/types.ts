// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/base-types.h, include/wabt/type.h
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * Core WebAssembly value types, fundamental aliases, and constants.
 */

// ---------------------------------------------------------------------------
// Fundamental aliases (maps to C++ uint32_t / uint64_t / size_t)
// ---------------------------------------------------------------------------

/** An index into a WebAssembly index space (functions, types, tables, etc.). */
export type Index = number;

/** A byte address or byte count in linear memory. Uses bigint to cover the full 64-bit range. */
export type Address = bigint;

/** An offset into a host file or memory buffer. */
export type Offset = number;

/** Sentinel for an index that has not been set. */
export const INVALID_INDEX: Index = 0xffffffff;

/** Sentinel for an address that has not been set. */
export const INVALID_ADDRESS: Address = 0xffffffffffffffffn;

/** Sentinel for an offset that has not been set. */
export const INVALID_OFFSET: Offset = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------
// WebAssembly value types (binary encoding)
//
// Values are the byte codes used in the binary format. Negative values in the
// C++ source are stored as unsigned bytes via LEB128 sign-extension; we store
// them here as the unsigned byte value that appears on the wire.
// ---------------------------------------------------------------------------

/** WebAssembly value type codes as encoded in the binary format. */
export enum Type {
  // Numeric types
  /** 32-bit integer (signed or unsigned depending on instruction). */
  I32 = 0x7f,
  /** 64-bit integer (signed or unsigned depending on instruction). */
  I64 = 0x7e,
  /** 32-bit IEEE 754 floating-point. */
  F32 = 0x7d,
  /** 64-bit IEEE 754 floating-point. */
  F64 = 0x7c,
  /** 128-bit SIMD vector (simd proposal). */
  V128 = 0x7b,

  // Packed types — used in GC struct/array fields and lane operations
  /**
   * 8-bit packed integer (GC struct/array field storage type).
   *
   * The spec wire encoding is -0x08, i.e. 0x78 read as an unsigned byte.
   * These were originally 0x7a / 0x79, chosen by continuing the numeric
   * value-type sequence (v128 = 0x7b) — but the GC proposal does NOT continue
   * it there. The wrong bytes made wabt-ts's own binary writer emit packed
   * fields V8 rejects outright with "invalid value type 0x7a"; it was
   * invisible through the bridge because binaryen-ts re-encodes its own way.
   */
  I8 = 0x78,
  /** 16-bit packed integer (GC struct/array field storage type). Spec: -0x09. */
  I16 = 0x77,

  // Reference types
  /** Exception reference (exception-handling proposal). */
  ExnRef = 0x69,
  /** Nullable function reference (`funcref`). */
  FuncRef = 0x70,
  /** Nullable external reference (`externref`). */
  ExternRef = 0x6f,
  /** Top of the GC reference hierarchy (`anyref`). */
  AnyRef = 0x6e,
  /** GC reference type with equality (`eqref`). */
  EqRef = 0x6d,
  /** Unboxed 31-bit integer reference (`i31ref`). */
  I31Ref = 0x6c,
  /** Generic struct reference (`structref`). */
  StructRef = 0x6b,
  /** Generic array reference (`arrayref`). */
  ArrayRef = 0x6a,
  /** Bottom of the GC hierarchy (`nullref`); only `ref.null none` inhabits it. */
  NullRef = 0x71,
  /** Bottom of the func hierarchy (`nullfuncref`). */
  NullFuncRef = 0x73,
  /** Bottom of the extern hierarchy (`nullexternref`). */
  NullExternRef = 0x72,
  /**
   * Bottom of the exn hierarchy (`nullexnref`; heap type `noexn`).
   *
   * Note the encoding is -0x0c (0x74) — adjacent to `nofunc` (-0x0d), NOT
   * below `exn` (-0x17 / 0x69) as the hierarchy might suggest. Verified
   * against V8: 0x68 is rejected, 0x74 is accepted and is a subtype of
   * `exnref` and nothing else.
   */
  NullExnRef = 0x74,
  /** String reference (stringref proposal, byte 0x67). Neither encoder writes it. */
  StringRef = 0x67,
  /** Non-nullable typed reference (GC proposal). */
  Ref = 0x64,
  /** Nullable typed reference (GC proposal). */
  RefNull = 0x63,

  // Structural / composite types
  /** Function type. */
  Func = 0x60,
  /** GC struct type. */
  Struct = 0x5f,
  /** GC array type. */
  Array = 0x5e,

  // Special / internal
  /** Void / no type (used for block result types). */
  Void = 0x40,
  /** Any type — internal type-checker use only, not part of the spec. */
  Any = 0x00,
}

/**
 * Primitive WebAssembly value types.
 *
 * These are the value types that WASM values carry at runtime. The set covers
 * the MVP types plus the SIMD and reference-types proposals.
 *
 * ⚠️ **The values ARE the wire bytes, and equal wabt-ts's `Type` member for
 * member** (S6 step 5, stage V1). They were the text names (`'i32'`). Numeric was
 * decided by trial: flipping these cost 20 compile errors and 13 failing tests;
 * flipping wabt-ts's `Type` to strings cost 27 and **299** -- its reader and
 * writer use the values AS the bytes -- and the operator representation was
 * already the numeric wire encoding (stage 1). `tests/ir/value_types.test.ts`
 * pins the equality.
 *
 * ⚠️ **And since stage V4 the members ARE `Type` members** — a const
 * object over `Type`, not a second enum. Two enums with equal values are still
 * two TYPES (enums are nominal), so `Type.I32` could not be passed where a
 * `ValType` was expected. Now `ValType` is the value-type SUBSET of `Type`: every
 * `ValType` is a `Type`, and a `Type` member that is a value type is a `ValType`.
 * Use `typeof ValType.I32` where a member is needed as a TYPE.
 *
 * A NAME is never the value: print with {@link valTypeName}, parse with
 * {@link valTypeFromName}, and never interpolate a `ValType` into a string or test
 * it with `typeof === 'string'` -- both still compile, and both are wrong.
 */
export const ValType = {
  /** 32-bit integer */
  I32: Type.I32,
  /** 64-bit integer */
  I64: Type.I64,
  /** 32-bit float */
  F32: Type.F32,
  /** 64-bit float */
  F64: Type.F64,
  /** 128-bit SIMD vector */
  V128: Type.V128,
  /** Nullable function reference */
  FuncRef: Type.FuncRef,
  /** Nullable external (host) reference */
  ExternRef: Type.ExternRef,
  /** Nullable any reference (GC proposal) */
  AnyRef: Type.AnyRef,
  /** Nullable eq reference (GC proposal) */
  EqRef: Type.EqRef,
  /** Nullable i31 reference (GC proposal) */
  I31Ref: Type.I31Ref,
  /** Nullable struct reference (GC proposal) */
  StructRef: Type.StructRef,
  /** Nullable array reference (GC proposal) */
  ArrayRef: Type.ArrayRef,
  /** String reference (stringref proposal). 0x67 is that proposal's byte; neither encoder writes it. */
  StringRef: Type.StringRef,
  /** Null function reference (bottom type) */
  NullFuncRef: Type.NullFuncRef,
  /** Null external reference (bottom type) */
  NullExternRef: Type.NullExternRef,
  /** Null any reference (bottom type) */
  NullRef: Type.NullRef,
  /** Exception reference (EH proposal) */
  ExnRef: Type.ExnRef,
  /** Null exception reference (bottom type, EH proposal) */
  NullExnRef: Type.NullExnRef,
} as const;
/** A scalar value type: the value-type SUBSET of {@link Type}. */
export type ValType = typeof ValType[keyof typeof ValType];

const VAL_TYPES: ReadonlySet<number> = new Set(Object.values(ValType));

/**
 * Whether `t` is a scalar value type -- the test that replaces
 * `typeof t === 'string'`, which stopped meaning this when the values became
 * bytes (`none` and `unreachable` are still strings). Membership in the SUBSET:
 * `Type.Void` is a `Type` and not a value type.
 */
export function isValType(t: unknown): t is ValType {
  return typeof t === 'number' && VAL_TYPES.has(t);
}

// ---------------------------------------------------------------------------
// Convenience predicates
// ---------------------------------------------------------------------------

/** Returns true if {@link t} is a numeric value type (i32, i64, f32, f64, v128). */
export function isNumericType(t: Type): boolean {
  return t === Type.I32 || t === Type.I64 || t === Type.F32 || t === Type.F64 || t === Type.V128;
}

/** Returns true if {@link t} is a reference type. */
export function isReferenceType(t: Type): boolean {
  return (
    t === Type.FuncRef ||
    t === Type.ExternRef ||
    t === Type.ExnRef ||
    t === Type.AnyRef ||
    t === Type.EqRef ||
    t === Type.I31Ref ||
    t === Type.StructRef ||
    t === Type.ArrayRef ||
    t === Type.NullRef ||
    t === Type.NullFuncRef ||
    t === Type.NullExternRef ||
    t === Type.NullExnRef ||
    t === Type.Ref ||
    t === Type.RefNull
  );
}

/** Returns true if {@link t} is a concrete value type (usable as a local/global type). */
export function isConcreteType(t: Type): boolean {
  return t !== Type.Void && t !== Type.Any;
}

/** Returns a human-readable name for {@link t}, matching the WAT text format. */
export function typeName(t: Type): string {
  switch (t) {
    case Type.I32:
      return 'i32';
    case Type.I64:
      return 'i64';
    case Type.F32:
      return 'f32';
    case Type.F64:
      return 'f64';
    case Type.V128:
      return 'v128';
    case Type.I8:
      return 'i8';
    case Type.I16:
      return 'i16';
    case Type.ExnRef:
      return 'exnref';
    case Type.FuncRef:
      return 'funcref';
    case Type.ExternRef:
      return 'externref';
    case Type.AnyRef:
      return 'anyref';
    case Type.EqRef:
      return 'eqref';
    case Type.I31Ref:
      return 'i31ref';
    case Type.StructRef:
      return 'structref';
    case Type.ArrayRef:
      return 'arrayref';
    case Type.NullRef:
      return 'nullref';
    case Type.NullFuncRef:
      return 'nullfuncref';
    case Type.NullExternRef:
      return 'nullexternref';
    case Type.NullExnRef:
      return 'nullexnref';
    case Type.StringRef:
      return 'stringref';
    case Type.Ref:
      return 'ref';
    case Type.RefNull:
      return 'ref null';
    case Type.Func:
      return 'func';
    case Type.Struct:
      return 'struct';
    case Type.Array:
      return 'array';
    case Type.Void:
      return 'void';
    case Type.Any:
      return 'any';
  }
}

// ---------------------------------------------------------------------------
// Abstract heap types (GC / reference-types proposals)
// ---------------------------------------------------------------------------

/**
 * Canonical abstract-heap-type table: WAT keyword ⇄ {@link Type} entry.
 *
 * A heap type's WAT keyword (`func`) and the corresponding nullable reference
 * *value* type (`funcref`) share one byte in the binary format, so a single
 * table serves both directions. The `Type` enum values ARE the single-byte
 * binary encodings, so `heapTypeNameToType('any')` doubles as the encoder.
 *
 * This is the one place the mapping lives — the WAT parser, WAT writer, binary
 * reader, binary writer, validator, and binaryen bridge all route through it.
 * Do not copy the switch into a call site; extend this table instead.
 */
/**
 * The twelve abstract heap types, spelled as the TEXT FORMAT spells them.
 *
 * This union is the vocabulary; the table below is the encoding. Typing the
 * table with it means a keyword added to one and not the other does not
 * compile — the failure mode that let binaryen-ts carry `ext`/`noext` (which
 * are not WAT) while this table had `extern`/`noextern`.
 */
export type AbstractHeap =
  | 'func'
  | 'nofunc'
  | 'extern'
  | 'noextern'
  | 'exn'
  | 'noexn'
  | 'any'
  | 'eq'
  | 'i31'
  | 'struct'
  | 'array'
  | 'none';

const ABSTRACT_HEAP_TYPES: ReadonlyArray<readonly [AbstractHeap, ValType]> = [
  ['func', Type.FuncRef],
  ['extern', Type.ExternRef],
  ['exn', Type.ExnRef],
  ['any', Type.AnyRef],
  ['eq', Type.EqRef],
  ['i31', Type.I31Ref],
  ['struct', Type.StructRef],
  ['array', Type.ArrayRef],
  ['none', Type.NullRef],
  ['nofunc', Type.NullFuncRef],
  ['noextern', Type.NullExternRef],
  ['noexn', Type.NullExnRef],
];

const HEAP_TYPE_BY_NAME: ReadonlyMap<string, ValType> = new Map(ABSTRACT_HEAP_TYPES);
const HEAP_NAME_BY_TYPE: ReadonlyMap<Type, AbstractHeap> = new Map(
  ABSTRACT_HEAP_TYPES.map(([name, t]) => [t, name]),
);

/**
 * Map an abstract-heap-type keyword (`"func"`, `"extern"`, `"exn"`, `"any"`,
 * `"eq"`, `"i31"`, `"struct"`, `"array"`, `"none"`, `"nofunc"`, `"noextern"`)
 * to its {@link Type} entry, whose enum value is also its single-byte binary
 * encoding. Returns `null` for anything else — notably a `$name` reference to
 * a user-defined heap type, which resolves to a type index instead.
 */
export function heapTypeNameToType(name: string): ValType | null {
  return HEAP_TYPE_BY_NAME.get(name) ?? null;
}

/**
 * Inverse of {@link heapTypeNameToType}: map a reference {@link Type} (or the
 * raw byte read from a binary heap-type immediate) to its bare WAT
 * heap-type keyword. Because `funcref` and the `func` heap type share a byte,
 * this also normalizes the `…ref` value-type spellings (`Type.FuncRef` →
 * `"func"`). Returns `null` for non-reference types.
 */
export function typeToHeapTypeName(t: Type): AbstractHeap | null {
  return HEAP_NAME_BY_TYPE.get(t) ?? null;
}
