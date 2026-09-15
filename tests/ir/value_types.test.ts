// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, stage V1: ONE scalar value-type representation.
//
// binaryen-ts's `ValType` held text names (`'i32'`); wabt-ts's `Type` holds the
// wire bytes (`0x7f`). Numeric was chosen by trial -- flipping binaryen-ts's
// cost 20 compile errors and 13 failing tests, flipping wabt-ts's cost 27 and
// 299, because its reader and writer use the values AS the bytes.
//
// These pin the equality member by member, and the three numeric-enum traps that
// compile silently: a value interpolated into text, `typeof === 'string'`, and
// the reverse mapping a numeric enum adds.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { Type } from '../../src/wabt-ts/core/types.ts';
import type { RefValueType } from '../../src/wabt-ts/ir/ir.ts';
import type { RefType } from '../../src/binaryen-ts/ir/gc-types.ts';
import {
  isValType,
  None,
  typeToString,
  Unreachable,
  ValType,
  valTypeFromName,
  valTypeName,
} from '../../src/binaryen-ts/ir/types.ts';

/** Every binaryen-ts member that has a wabt-ts counterpart. `StringRef` does not. */
const SHARED = [
  'I32',
  'I64',
  'F32',
  'F64',
  'V128',
  'FuncRef',
  'ExternRef',
  'AnyRef',
  'EqRef',
  'I31Ref',
  'StructRef',
  'ArrayRef',
  'NullFuncRef',
  'NullExternRef',
  'NullRef',
  'ExnRef',
  'NullExnRef',
] as const;

describe('one scalar value-type representation', () => {
  it('every ValType member IS the wabt-ts Type member of the same name', () => {
    // V1 made the VALUES equal, and they were still two TYPES (enums are
    // nominal: this line would not compile). V4 made `ValType` a const object
    // over `Type`, so the plain comparison below type-checks -- see also the
    // compile-time pins at the bottom of this file.
    for (const name of SHARED) assertEquals(ValType[name], Type[name], name);
    assertEquals(ValType.StringRef, Type.StringRef);
  });

  it('and the only extra member is StringRef, which the wabt-ts Type now also has', () => {
    // A const object does not reverse-map (the enum it replaced did).
    assertEquals(Object.keys(ValType).filter((k) => !(SHARED as readonly string[]).includes(k)), [
      'StringRef',
    ]);
    assertEquals(Object.values(ValType).length, SHARED.length + 1);
  });

  it('names round-trip through the one table', () => {
    for (const name of SHARED) {
      const t = ValType[name];
      assertEquals(valTypeFromName(valTypeName(t)), t, name);
    }
    assertEquals(valTypeName(ValType.I32), 'i32');
    assertEquals(typeToString([ValType.I32, ValType.F64]), '(i32 f64)');
  });

  it('a member NAME is not a type name, and a byte is not a name', () => {
    // The trap `raw in ValType` fell into: `'I32' in ValType` is true.
    assertEquals(valTypeFromName('I32'), undefined);
    assertEquals(valTypeFromName('127'), undefined);
  });

  it('isValType is the scalar test, not typeof', () => {
    assert(isValType(ValType.I32));
    assert(!isValType(None), '`none` is still a string sentinel');
    assert(!isValType(Unreachable), '`unreachable` is still a string sentinel');
    assert(!isValType('i32'), 'a name is not a value');
    assert(!isValType(0x40), 'a byte that is not a value type');
  });
});

// ---------------------------------------------------------------------------
// Stage V3: ONE reference-type record
// ---------------------------------------------------------------------------

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * binaryen-ts's `RefType` and wabt-ts's `RefValueType` are the same record:
 * `{ heapType: HeapTypeRef; nullable: boolean }`. V3a renamed binaryen-ts's
 * `heap` to `heapType`; V3b removed wabt-ts's `kind: 'ref'`. A compile-time
 * assertion, in two parts: the KEY sets, then mutual assignability. Assignability
 * alone was not enough -- its first draft stayed green with an OPTIONAL field
 * added to one side, because an absent optional still assigns. (`readonly` does
 * not affect assignability, so wabt-ts's readonly fields do not stop it being
 * one record.)
 */
const _oneRefRecord: [Same<keyof RefType, keyof RefValueType>, Same<RefType, RefValueType>] = [
  true,
  true,
];
void _oneRefRecord;

// ---------------------------------------------------------------------------
// Stage V4: ONE scalar TYPE -- ValType is the value-type subset of Type
// ---------------------------------------------------------------------------

/** Every `ValType` is a `Type` (compile-time: a widening assignment). */
const _valTypeIsAType: Type = ValType.I32;
/** And a value-type member of `Type` is a `ValType` -- which V1 could not do. */
const _typeMemberIsAValType: ValType = Type.I32;
/** But not every `Type` is a `ValType`: `Type.Void` is not a value type. */
// @ts-expect-error -- Type.Void is not in the value-type subset
const _voidIsNotAValType: ValType = Type.Void;
void _valTypeIsAType;
void _typeMemberIsAValType;
void _voidIsNotAValType;
