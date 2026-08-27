import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import {
  MiscOpcode,
  Opcode,
  opcodeName,
  PREFIX_MISC,
  PREFIX_SIMD,
  PREFIX_THREADS,
} from '../../../src/wabt-ts/core/opcode.ts';

describe('Opcode prefix constants', () => {
  it('PREFIX_MISC = 0xfc', () => assertEquals(PREFIX_MISC, 0xfc));
  it('PREFIX_SIMD = 0xfd', () => assertEquals(PREFIX_SIMD, 0xfd));
  it('PREFIX_THREADS = 0xfe', () => assertEquals(PREFIX_THREADS, 0xfe));
});

describe('Core opcodes', () => {
  const cases: [Opcode, number, string][] = [
    [Opcode.Unreachable, 0x00, 'unreachable'],
    [Opcode.Nop, 0x01, 'nop'],
    [Opcode.Block, 0x02, 'block'],
    [Opcode.Loop, 0x03, 'loop'],
    [Opcode.If, 0x04, 'if'],
    [Opcode.Return, 0x0f, 'return'],
    [Opcode.Call, 0x10, 'call'],
    [Opcode.CallIndirect, 0x11, 'call_indirect'],
    [Opcode.Drop, 0x1a, 'drop'],
    [Opcode.LocalGet, 0x20, 'local.get'],
    [Opcode.LocalSet, 0x21, 'local.set'],
    [Opcode.LocalTee, 0x22, 'local.tee'],
    [Opcode.GlobalGet, 0x23, 'global.get'],
    [Opcode.I32Const, 0x41, 'i32.const'],
    [Opcode.I64Const, 0x42, 'i64.const'],
    [Opcode.F32Const, 0x43, 'f32.const'],
    [Opcode.F64Const, 0x44, 'f64.const'],
    [Opcode.I32Add, 0x6a, 'i32.add'],
    [Opcode.I64Add, 0x7c, 'i64.add'],
    [Opcode.F32Add, 0x92, 'f32.add'],
    [Opcode.F64Add, 0xa0, 'f64.add'],
    [Opcode.I32WrapI64, 0xa7, 'i32.wrap_i64'],
    [Opcode.I32ReinterpretF32, 0xbc, 'i32.reinterpret_f32'],
    [Opcode.I32Extend8S, 0xc0, 'i32.extend8_s'],
    [Opcode.RefNull, 0xd0, 'ref.null'],
    [Opcode.RefIsNull, 0xd1, 'ref.is_null'],
  ];
  for (const [op, byte, name] of cases) {
    it(`${name} has byte 0x${byte.toString(16)}`, () => assertEquals(op, byte));
    it(`opcodeName(${name})`, () => assertEquals(opcodeName(op), name));
  }
});

describe('MiscOpcode (0xfc group)', () => {
  it('I32TruncSatF32S = 0', () => assertEquals(MiscOpcode.I32TruncSatF32S, 0));
  it('MemoryInit = 8', () => assertEquals(MiscOpcode.MemoryInit, 8));
  it('MemoryCopy = 10', () => assertEquals(MiscOpcode.MemoryCopy, 10));
  it('TableFill = 17', () => assertEquals(MiscOpcode.TableFill, 17));
});
