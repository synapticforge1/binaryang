// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A prefixed sub-opcode that is no instruction is MALFORMED (open-work 28, 2026-10-13).
//
// Found by TYPING, not by a corpus: when every opcode field became `InstrCode` (the 582 real
// instructions, generated from `src/definitions/opcodes.json`), the binary reader's casts had to
// go, and the SIMD decoder's last line turned out to take ANY sub-opcode as a binary operator.
// A reserved `0xfd 0x9a` decoded, `wasm-validate` passed it, `wasm2wat` printed
// `<opcode:0xfd009a>`, and V8 refused it. The atomic decoder's reserved 0x04–0x0f are held here
// too. Each prefixed decoder now asks `isInstrCode` first and keeps the message its `default`
// always gave (SIMD, which had none, says it like its siblings).
//
// Every case is a one-function module whose body is `<prefix> <LEB sub> end`: the decoder must
// refuse the opcode before reading anything after it.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { readBinaryIr } from '../../../src/reader/binary-reader.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/core/error.ts';
import { INSTR_CODES } from '../../../src/definitions/instr-code.ts';

const leb = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
};

/** `(module (func <prefix> <sub> <imm…>))`, byte by byte. */
function moduleWith(prefix: number, sub: number, imm: number[] = []): Uint8Array {
  const body = [0x00, prefix, ...leb(sub), ...imm, 0x0b]; // no locals, the opcode, end
  const code = [0x01, body.length, ...body];
  return new Uint8Array([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    ...[0x01, 0x04, 0x01, 0x60, 0x00, 0x00], // (type (func))
    ...[0x03, 0x02, 0x01, 0x00], // (func (type 0))
    0x0a,
    code.length,
    ...code,
  ]);
}

function readErrors(bytes: Uint8Array): string | null {
  const errs = makeErrorList();
  readBinaryIr(bytes, errs);
  return hasErrors(errs) ? formatErrors(errs) : null;
}

/** Sub-opcodes of `prefix` up to `max` that name no instruction, per the definitions. */
function reserved(prefix: number, max: number): number[] {
  const out: number[] = [];
  for (let sub = 0; sub <= max; sub++) if (!INSTR_CODES.has((prefix << 16) | sub)) out.push(sub);
  return out;
}

const CASES = [
  // 20 inside the SIMD range, and two beyond its last instruction (0x113).
  ...[...reserved(0xfd, 0x113), 0x114, 0x200].map((sub) => ({
    prefix: 0xfd,
    sub,
    message: `unknown SIMD opcode: 0xfd 0x${sub.toString(16)}`,
  })),
  ...[...reserved(0xfe, 0x4e), 0x4f].map((sub) => ({
    prefix: 0xfe,
    sub,
    message: `unknown atomic opcode: 0xfe 0x${sub.toString(16)}`,
  })),
  ...[...reserved(0xfc, 0x16), 0x17].map((sub) => ({
    prefix: 0xfc,
    sub,
    message: `unknown misc opcode: ${sub}`,
  })),
];

describe('a prefixed sub-opcode that is no instruction is malformed', () => {
  it('the cases are the ones the definitions leave out', () => {
    assertEquals(CASES.filter((c) => c.prefix === 0xfd).length, 22, '20 reserved + 2 beyond');
    assertEquals(CASES.filter((c) => c.prefix === 0xfe).length, 13, '0x04-0x0f + 1 beyond');
    assertEquals(CASES.filter((c) => c.prefix === 0xfc).length, 2, '0x12 + 1 beyond');
  });

  for (const c of CASES) {
    const name = `0x${c.prefix.toString(16)} 0x${c.sub.toString(16)}`;
    it(`${name}: the reader refuses it, as V8 does`, () => {
      const bytes = moduleWith(c.prefix, c.sub);
      assertEquals(WebAssembly.validate(bytes as BufferSource), false, 'the engine refuses it');
      const errs = readErrors(bytes);
      assert(errs !== null, `${name} decoded without an error`);
      assert(errs.includes(c.message), `expected "${c.message}", got: ${errs}`);
      assert(wasmValidate(bytes).errors.length > 0, 'wasm-validate refuses it too');
    });
  }

  it('a real prefixed instruction in the same position still decodes', () => {
    const { binary } = wat2wasm('(module (func (result i32) (i32.const 1) (i32.extend8_s)))');
    assert(binary && readErrors(binary) === null);
    // atomic.fence (0xfe 0x03 0x00) is a real atomic with nothing on the stack.
    const fence = moduleWith(0xfe, 0x03, [0x00]);
    assertEquals(WebAssembly.validate(fence as BufferSource), true, 'the control is valid');
    assertEquals(readErrors(fence), null);
  });
});
