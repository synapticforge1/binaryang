import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import {
  isConcreteType,
  isNumericType,
  isReferenceType,
  INVALID_ADDRESS,
  INVALID_INDEX,
  INVALID_OFFSET,
  Type,
  typeName,
} from '../../src/core/types.ts';

describe('Type constants', () => {
  it('INVALID_INDEX is 0xffffffff', () => assertEquals(INVALID_INDEX, 0xffffffff));
  it('INVALID_ADDRESS is 0xffffffffffffffffn', () =>
    assertEquals(INVALID_ADDRESS, 0xffffffffffffffffn));
  it('INVALID_OFFSET is Number.MAX_SAFE_INTEGER', () =>
    assertEquals(INVALID_OFFSET, Number.MAX_SAFE_INTEGER));
});

describe('Type enum values', () => {
  it('I32 = 0x7f', () => assertEquals(Type.I32, 0x7f));
  it('I64 = 0x7e', () => assertEquals(Type.I64, 0x7e));
  it('F32 = 0x7d', () => assertEquals(Type.F32, 0x7d));
  it('F64 = 0x7c', () => assertEquals(Type.F64, 0x7c));
  it('V128 = 0x7b', () => assertEquals(Type.V128, 0x7b));
  it('FuncRef = 0x70', () => assertEquals(Type.FuncRef, 0x70));
  it('ExternRef = 0x6f', () => assertEquals(Type.ExternRef, 0x6f));
  it('Func = 0x60', () => assertEquals(Type.Func, 0x60));
  it('Void = 0x40', () => assertEquals(Type.Void, 0x40));
});

describe('isNumericType', () => {
  it('i32 is numeric', () => assertEquals(isNumericType(Type.I32), true));
  it('i64 is numeric', () => assertEquals(isNumericType(Type.I64), true));
  it('f32 is numeric', () => assertEquals(isNumericType(Type.F32), true));
  it('f64 is numeric', () => assertEquals(isNumericType(Type.F64), true));
  it('v128 is numeric', () => assertEquals(isNumericType(Type.V128), true));
  it('funcref is not numeric', () => assertEquals(isNumericType(Type.FuncRef), false));
  it('externref is not numeric', () => assertEquals(isNumericType(Type.ExternRef), false));
  it('void is not numeric', () => assertEquals(isNumericType(Type.Void), false));
});

describe('isReferenceType', () => {
  it('funcref is a reference', () => assertEquals(isReferenceType(Type.FuncRef), true));
  it('externref is a reference', () => assertEquals(isReferenceType(Type.ExternRef), true));
  it('exnref is a reference', () => assertEquals(isReferenceType(Type.ExnRef), true));
  it('ref is a reference', () => assertEquals(isReferenceType(Type.Ref), true));
  it('ref null is a reference', () => assertEquals(isReferenceType(Type.RefNull), true));
  it('i32 is not a reference', () => assertEquals(isReferenceType(Type.I32), false));
  it('void is not a reference', () => assertEquals(isReferenceType(Type.Void), false));
});

describe('isConcreteType', () => {
  it('i32 is concrete', () => assertEquals(isConcreteType(Type.I32), true));
  it('funcref is concrete', () => assertEquals(isConcreteType(Type.FuncRef), true));
  it('void is not concrete', () => assertEquals(isConcreteType(Type.Void), false));
  it('any is not concrete', () => assertEquals(isConcreteType(Type.Any), false));
});

describe('typeName', () => {
  const cases: [Type, string][] = [
    [Type.I32, 'i32'],
    [Type.I64, 'i64'],
    [Type.F32, 'f32'],
    [Type.F64, 'f64'],
    [Type.V128, 'v128'],
    [Type.I8, 'i8'],
    [Type.I16, 'i16'],
    [Type.ExnRef, 'exnref'],
    [Type.FuncRef, 'funcref'],
    [Type.ExternRef, 'externref'],
    [Type.Func, 'func'],
    [Type.Void, 'void'],
  ];
  for (const [t, name] of cases) {
    it(`typeName(${name})`, () => assertEquals(typeName(t), name));
  }
});
