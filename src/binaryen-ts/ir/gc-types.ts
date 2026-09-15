/**
 * @module binaryen-ts/ir/gc-types
 *
 * GC proposal type definitions for the binaryen-ts IR.
 *
 * This module defines the heap type hierarchy, reference types, and user-defined
 * struct/array/func type definitions introduced by the WebAssembly GC proposal.
 *
 * **Heap types** can be either abstract (built-in) or user-defined (type index).
 * **Reference types** are `(ref $T)` (non-nullable) or `(ref null $T)` (nullable).
 * **Type definitions** are the entries in the module's type section: func, struct, or array.
 *
 * @example
 * ```ts
 * import { AbstractHeapType, heapAbstract, type RefType } from "@jrmarcum/binaryang/ir/binaryen-ts";
 * import { varIndex } from "@jrmarcum/binaryang/ir/wabt-ts";
 *
 * const i31ref: RefType = { heap: heapAbstract(AbstractHeapType.I31), nullable: true };
 * const ref0: RefType   = { heap: varIndex(0), nullable: false }; // (ref $0)
 * ```
 *
 * @license MIT
 */

import { type ValType, valTypeName } from './types.ts';
import { heapAbstract, type HeapTypeRef } from '../../wabt-ts/ir/ir.ts';
export { heapAbstract, sameHeap } from '../../wabt-ts/ir/ir.ts';

// ---------------------------------------------------------------------------
// Heap types
// ---------------------------------------------------------------------------

/**
 * Abstract (built-in) heap types from the GC proposal.
 * Mirrors `HeapType::BasicHeapType` in upstream Binaryen.
 *
 * ⚠️ **A const object, not an `enum`, and deliberately.** TypeScript string
 * enums are NOMINAL: `AbstractHeapType.Any` is not assignable to `'any'`, so
 * an enum member could not be stored in the shared {@link HeapTypeRef}, whose
 * abstract arm is the spec's keyword union. This form keeps every call site
 * (`AbstractHeapType.Any`, `h: AbstractHeapType`, `Object.values(...)`)
 * working while making the members ordinary string literals.
 *
 * The VALUES are the WAT keywords and are load-bearing: `heapTypeToString`
 * returns them verbatim. They read `ext`/`noext` once, which is binaryen's
 * internal C++ spelling and not WAT — see `heap_type_keywords.test.ts`.
 */
export const AbstractHeapType = {
  /** Top of the function reference hierarchy. */
  Func: 'func',
  /** Bottom of the function reference hierarchy (null func). */
  NoFunc: 'nofunc',
  /** External (host) reference. */
  Ext: 'extern',
  /** Bottom of the external reference hierarchy. */
  NoExt: 'noextern',
  /** Top of the GC reference hierarchy. */
  Any: 'any',
  /** Equatable references (structs, arrays, i31). */
  Eq: 'eq',
  /** 31-bit integers as references. */
  I31: 'i31',
  /** Abstract struct type. */
  Struct: 'struct',
  /** Abstract array type. */
  Array: 'array',
  /** Bottom of the GC reference hierarchy (null ref). */
  None: 'none',
  /** Exception reference. */
  Exn: 'exn',
  /** Bottom of the exception reference hierarchy. */
  NoExn: 'noexn',
} as const;

/** The value type of {@link AbstractHeapType} — the twelve WAT keywords. */
export type AbstractHeapType = typeof AbstractHeapType[keyof typeof AbstractHeapType];

/**
 * A heap type: an abstract built-in, or a reference to a defined type.
 *
 * ⚠️ **It IS wabt-ts's `HeapTypeRef`** (S6 step 5, stage V2 — the owner's
 * "third form", decided 2026-09-09). It was `AbstractHeapType | number`. Now:
 *
 * - `{ kind: 'abstract', name }` — one of the twelve built-ins;
 * - a `Var` — `{ kind: 'index', value }` into {@link WasmModule.heapTypes}, or
 *   a `{ kind: 'name', name }` not yet resolved.
 *
 * An OBJECT: never compare two with `===` (use `sameHeap`), never key a `Map`
 * on one, never interpolate one, never test one with `typeof` — each of those
 * still compiles. Build them with `heapAbstract` and `varIndex`.
 */
export type HeapType = HeapTypeRef;

// ---------------------------------------------------------------------------
// Reference types
// ---------------------------------------------------------------------------

/**
 * A WebAssembly reference type: `(ref $T)` or `(ref null $T)`.
 *
 * Used anywhere a value type is expected when the value is a GC reference.
 *
 * @example
 * ```ts
 * const anyref: RefType = { heap: heapAbstract(AbstractHeapType.Any), nullable: true };
 * const nonNullI31: RefType = { heap: heapAbstract(AbstractHeapType.I31), nullable: false };
 * const userStruct: RefType = { heap: varIndex(0), nullable: false }; // (ref $0)
 * ```
 */
export interface RefType {
  /** The target heap type. */
  heap: HeapType;
  /** Whether a null value is allowed. */
  nullable: boolean;
}

// ---------------------------------------------------------------------------
// Struct / array field types
// ---------------------------------------------------------------------------

/**
 * Packed integer storage types for struct and array fields.
 * These are not valid value types — they are only valid inside field declarations.
 */
export type PackedType = 'i8' | 'i16';

/**
 * The storage type of a struct or array field: a value type, a packed integer,
 * or a reference type.
 */
export type StorageType = ValType | PackedType | RefType;

/**
 * Any wasm *value* type — a scalar/abstract {@link ValType} or a concrete typed
 * reference {@link RefType} such as `(ref null $T)`.
 *
 * This is the type of a local, a global, a table element, a function parameter
 * or result, and a tag payload. It deliberately excludes {@link PackedType}
 * (`i8`/`i16`), which is only valid as struct/array *storage*.
 *
 * Before this existed those positions were all typed `ValType`, so a concrete
 * typed reference had to be widened to `ValType.AnyRef` — which meant a GC
 * module using `(ref null $T)` locals could not be re-encoded faithfully.
 */
export type ValueType = ValType | RefType;

/**
 * A struct or array field declaration.
 */
export interface FieldType {
  /** The storage type of this field. */
  type: StorageType;
  /** Whether the field can be mutated after construction. */
  mutable: boolean;
}

// ---------------------------------------------------------------------------
// User-defined type definitions
// ---------------------------------------------------------------------------

/**
 * A user-defined struct type.
 *
 * @example
 * ```ts
 * const pointType: StructTypeDef = {
 *   kind: "struct",
 *   fields: [
 *     { type: ValType.I32, mutable: false }, // x
 *     { type: ValType.I32, mutable: false }, // y
 *   ],
 * };
 * ```
 */
export interface StructTypeDef {
  /** Discriminant — identifies this entry as a struct type. */
  kind: 'struct';
  /** The ordered list of field declarations. */
  fields: FieldType[];
}

/**
 * A user-defined array type.
 *
 * @example
 * ```ts
 * const intArrayType: ArrayTypeDef = {
 *   kind: "array",
 *   element: { type: ValType.I32, mutable: true },
 * };
 * ```
 */
export interface ArrayTypeDef {
  /** Discriminant — identifies this entry as an array type. */
  kind: 'array';
  /** The element field declaration. */
  element: FieldType;
}

/**
 * A function type stored explicitly in the module's type section.
 * Used when GC types are present (so all type indices are stable).
 */
export interface FuncTypeDef {
  /** Discriminant — identifies this entry as a function type. */
  kind: 'func';
  /** Parameter types in declaration order. */
  params: (ValType | RefType)[];
  /** Result types in declaration order (empty array = void). */
  results: (ValType | RefType)[];
}

/**
 * A user-defined type entry in the module's type section.
 */
export type TypeDef = StructTypeDef | ArrayTypeDef | FuncTypeDef;

// ---------------------------------------------------------------------------
// Type guard utilities
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the value is a {@link RefType} object.
 *
 * Useful to narrow `ValType | RefType` unions.
 */
/**
 * Stable string form of one value type, for map keys and diagnostics.
 *
 * `RefType` is an object, so `String(t)` / `join(",")` would render every
 * concrete typed reference as `[object Object]` — collapsing `(ref $A)` and
 * `(ref null $B)` onto the same key and silently deduping two distinct
 * signatures into one type-section entry.
 */
export function valueTypeKey(t: ValueType): string {
  // The NAME, not the value: keys stay the strings they always were.
  if (!isRefType(t)) return valTypeName(t);
  // `heapTypeToString`, never `${t.heap}`: the heap is an OBJECT now, and would
  // render every typed reference as `[object Object]` — the exact collapse this
  // function exists to prevent.
  return `ref${t.nullable ? ' null' : ''} ${heapTypeToString(t.heap)}`;
}

/**
 * The key two function signatures share exactly when they are the same
 * signature. ONE definition, used by the encoder to find a signature's type
 * index and by the WAT parser to decide whether a type use needs an implicit
 * type — if the two compared differently, the parser would add an entry the
 * encoder cannot find, or skip one it needs.
 */
export function funcTypeKey(params: readonly ValueType[], results: readonly ValueType[]): string {
  return params.map(valueTypeKey).join(',') + '->' + results.map(valueTypeKey).join(',');
}

export function isRefType(t: unknown): t is RefType {
  return (
    typeof t === 'object' &&
    t !== null &&
    !Array.isArray(t) &&
    'heap' in t &&
    'nullable' in t
  );
}

/**
 * Returns `true` if the heap type is an abstract built-in rather than a
 * user-defined type index.
 *
 * This is the public discriminator for the exported {@link HeapType} union.
 * Completes the guard set with {@link isRefType} and {@link isPackedType}.
 */
export function isAbstractHeapType(
  h: HeapType,
): h is { readonly kind: 'abstract'; readonly name: AbstractHeapType } {
  return h.kind === 'abstract';
}

/**
 * Returns `true` if the storage type is a packed integer (`i8` or `i16`).
 */
export function isPackedType(t: StorageType): t is PackedType {
  return t === 'i8' || t === 'i16';
}

// ---------------------------------------------------------------------------
// String conversion helpers
// ---------------------------------------------------------------------------

/**
 * Returns the WAT text representation of a {@link HeapType}.
 *
 * Abstract types use their built-in name; type indices use `$typeN`.
 */
export function heapTypeToString(h: HeapType): string {
  if (h.kind === 'abstract' || h.kind === 'name') return h.name;
  return `$type${h.value}`;
}

/**
 * Returns the WAT text representation of a {@link RefType}.
 *
 * @example
 * ```ts
 * refTypeToString({ heap: heapAbstract('i31'), nullable: true }) // → "(ref null i31)"
 * refTypeToString({ heap: varIndex(0), nullable: false })          // → "(ref $type0)"
 * ```
 */
export function refTypeToString(rt: RefType): string {
  const inner = heapTypeToString(rt.heap);
  return rt.nullable ? `(ref null ${inner})` : `(ref ${inner})`;
}

/**
 * Returns the WAT text representation of a {@link StorageType}.
 */
export function storageTypeToString(t: StorageType): string {
  if (isRefType(t)) return refTypeToString(t);
  if (isPackedType(t)) return t;
  // ⚠️ Was `t as string`, which stage V1 turned into the BYTE (`127`) -- a cast,
  // so V1's sweep of interpolations did not see it; found in V2.
  return valTypeName(t);
}

// ---------------------------------------------------------------------------
// Canonical abstract-type shorthands (convenience RefType values)
// ---------------------------------------------------------------------------

/** `anyref` = `(ref null any)` */
export const anyref: RefType = { heap: heapAbstract(AbstractHeapType.Any), nullable: true };
/** `eqref`  = `(ref null eq)`  */
export const eqref: RefType = { heap: heapAbstract(AbstractHeapType.Eq), nullable: true };
/** `i31ref` = `(ref null i31)` */
export const i31ref: RefType = { heap: heapAbstract(AbstractHeapType.I31), nullable: true };
/** `structref` = `(ref null struct)` */
export const structref: RefType = { heap: heapAbstract(AbstractHeapType.Struct), nullable: true };
/** `arrayref` = `(ref null array)` */
export const arrayref: RefType = { heap: heapAbstract(AbstractHeapType.Array), nullable: true };
/** `funcref` = `(ref null func)` */
export const funcref: RefType = { heap: heapAbstract(AbstractHeapType.Func), nullable: true };
/** `externref` = `(ref null ext)` */
export const externref: RefType = { heap: heapAbstract(AbstractHeapType.Ext), nullable: true };
/** `nullref` = `(ref null none)` */
export const nullref: RefType = { heap: heapAbstract(AbstractHeapType.None), nullable: true };
