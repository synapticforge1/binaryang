/**
 * @module binaryen-ts/ir/types
 *
 * WebAssembly type system definitions for the binaryen-ts IR.
 *
 * This module mirrors the type hierarchy in the upstream Binaryen C++ library
 * (`WebAssembly/binaryen/src/wasm-type.h`) and represents it as TypeScript discriminated unions and
 * const enums for zero-cost type safety.
 *
 * **Value types** are the primitive types that WASM values carry at runtime.
 * **Heap types** support the GC (garbage collection) proposal.
 * **Type** is the top-level alias — either a single value type, a tuple (for
 * multi-value), the special `unreachable` / `none` sentinels, or a GC
 * reference type (`RefType`).
 *
 * @example
 * ```ts
 * import { ValType, Type, typeToString } from "@jrmarcum/binaryang/ir/binaryen-ts";
 *
 * const t: Type = ValType.I32;
 * console.log(typeToString(t)); // "i32"
 *
 * const tuple: Type = [ValType.I32, ValType.F64];
 * console.log(typeToString(tuple)); // "(i32 f64)"
 * ```
 *
 * @license MIT
 */

import { isRefType, type RefType, refTypeToString } from './gc-types.ts';
import { typeName as wireTypeName } from '../../wabt-ts/core/types.ts';
export type { RefType } from './gc-types.ts';

// ---------------------------------------------------------------------------
// Value types (MVP + SIMD + reference types)
// ---------------------------------------------------------------------------

// `ValType` is defined beside the `Type` enum it is a subset of — wabt-ts's
// `core/types.ts` — since S6 step 5, item 4 (b), where wabt-ts's `ValueType` came
// to use it too. Re-exported here unchanged, value and type.
export { isValType, ValType } from '../../wabt-ts/core/types.ts';
import { isValType, ValType } from '../../wabt-ts/core/types.ts';

// ---------------------------------------------------------------------------
// Special sentinel types (not value types but appear in type positions)
// ---------------------------------------------------------------------------

/** Signals a diverging / bottom computation. Used as the type of `unreachable`. */
export const Unreachable = 'unreachable' as const;
/** The singleton literal type for {@link Unreachable}. */
export type Unreachable = typeof Unreachable;

/** The empty type — represents a void return or the empty tuple. */
export const None = 'none' as const;
/** The singleton literal type for {@link None}. */
export type None = typeof None;

// ---------------------------------------------------------------------------
// Compound / multi-value types
// ---------------------------------------------------------------------------

/**
 * A tuple type (multi-value return).
 * Represented as an ordered array of {@link ValType} values.
 * An empty array is equivalent to {@link None}.
 */
export type TupleType = (ValType | RefType)[];

// ---------------------------------------------------------------------------
// Top-level Type alias
// ---------------------------------------------------------------------------

/**
 * The union of all types that can appear in a binaryen-ts IR node's `type` field.
 *
 * - A single {@link ValType} for most expressions.
 * - A {@link TupleType} (array) for multi-value blocks and calls.
 * - {@link None} (`"none"`) for void / empty returns.
 * - {@link Unreachable} (`"unreachable"`) for diverging expressions.
 * - A {@link RefType} for GC reference-typed expressions (`ref.cast`, `struct.new`, etc.).
 */
export type Type = ValType | TupleType | None | Unreachable | RefType;

// ---------------------------------------------------------------------------
// Names — the ONE table between a scalar value type and its text spelling
// ---------------------------------------------------------------------------

/**
 * The members, as a set — what "is a scalar value type" means. Built from the
 * const object, so it cannot fall behind it.
 */
const VAL_TYPE_BY_NAME: ReadonlyMap<string, ValType> = new Map(
  (Object.values(ValType) as ValType[]).map((t) => [wireTypeName(t), t]),
);

/**
 * The text-format name of a scalar value type (`i32`, `funcref`, …).
 *
 * 🔑 **wabt-ts's `typeName` IS the table.** Stage V1 wrote a second one here,
 * member for member; once `ValType` became a subset of `Type` (V4) that copy was
 * the "second copy of a fact" this codebase keeps being bitten by, and it went.
 * A non-member -- only ever reached on an error path, which is exactly where a
 * readable message matters -- prints as itself rather than as `undefined`.
 */
export function valTypeName(t: ValType): string {
  return isValType(t) ? wireTypeName(t) : `<value type 0x${Number(t).toString(16)}>`;
}

/** The scalar value type a text-format name spells, or `undefined`. */
export function valTypeFromName(name: string): ValType | undefined {
  return VAL_TYPE_BY_NAME.get(name);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Returns the WAT textual representation of a {@link Type}.
 *
 * @example
 * ```ts
 * typeToString(ValType.I32)              // → "i32"
 * typeToString([ValType.I32, ValType.F64]) // → "(i32 f64)"
 * typeToString(None)                     // → ""
 * typeToString(Unreachable)              // → "unreachable"
 * ```
 */
export function typeToString(t: Type): string {
  if (t === None) return '';
  if (t === Unreachable) return 'unreachable';
  if (Array.isArray(t)) {
    if (t.length === 0) return '';
    const strs = t.map((e) => isRefType(e) ? refTypeToString(e) : valTypeName(e));
    if (strs.length === 1) return strs[0]!;
    return `(${strs.join(' ')})`;
  }
  if (isRefType(t)) return refTypeToString(t);
  return valTypeName(t);
}

/**
 * Returns `true` if the type is concrete (not `none` or `unreachable`).
 */
export function isConcrete(t: Type): t is ValType | TupleType {
  return t !== None && t !== Unreachable;
}

/**
 * Returns `true` if the type is an integer type (`i32` or `i64`).
 */
export function isInteger(t: Type): boolean {
  return t === ValType.I32 || t === ValType.I64;
}

/**
 * Returns `true` if the type is a floating-point type (`f32` or `f64`).
 */
export function isFloat(t: Type): boolean {
  return t === ValType.F32 || t === ValType.F64;
}

/**
 * Returns `true` if the type is a reference type (abstract ValType ref or GC RefType).
 */
export function isRef(t: Type): boolean {
  if (isRefType(t)) return true;
  if (Array.isArray(t) || t === None || t === Unreachable) return false;
  return (
    t === ValType.FuncRef ||
    t === ValType.ExternRef ||
    t === ValType.AnyRef ||
    t === ValType.EqRef ||
    t === ValType.I31Ref ||
    t === ValType.StructRef ||
    t === ValType.ArrayRef ||
    t === ValType.StringRef ||
    t === ValType.NullFuncRef ||
    t === ValType.NullExternRef ||
    t === ValType.NullRef ||
    t === ValType.ExnRef ||
    t === ValType.NullExnRef
  );
}

/**
 * Returns the byte size of a value type, or `null` for non-concrete types.
 */
export function byteSize(t: ValType): number {
  switch (t) {
    case ValType.I32:
    case ValType.F32:
      return 4;
    case ValType.I64:
    case ValType.F64:
      return 8;
    case ValType.V128:
      return 16;
    default:
      return 4; // references are pointer-sized (4 bytes in wasm32)
  }
}
