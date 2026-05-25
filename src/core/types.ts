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
  /** 8-bit packed integer (GC / SIMD lane). */
  I8 = 0x7a,
  /** 16-bit packed integer (GC / SIMD lane). */
  I16 = 0x79,

  // Reference types
  /** Exception reference (exception-handling proposal). */
  ExnRef = 0x69,
  /** Nullable function reference (`funcref`). */
  FuncRef = 0x70,
  /** Nullable external reference (`externref`). */
  ExternRef = 0x6f,
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
