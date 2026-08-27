// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T10.4 — NaN payloads were mangled, and the last round-trip difference.
//
// `f32.const` bits 0x7fffffff came back as 0x7fbfffff: the quiet bit lost, a
// quiet NaN turned into a signalling one. Valid wasm, different value — the
// same class as T9.1, where the decoder reordered a program.
//
// `printF32Literal` stripped the quiet bit before printing the payload, on the
// theory that "the parser always ORs it back in". TWO parsers disagreed:
//
//   src/core/literal.ts   parseF32Literal      forced the quiet bit ON
//   src/parser/…          parseF32LiteralBits  read the payload exactly
//
// The second is the one `wat2wasm` calls, and it is the one the spec agrees
// with: `nan:0x<n>` names the mantissa EXACTLY, with no special treatment of
// the quiet bit — `float_literals.wast` writes both `nan:0x400000` (which IS
// the canonical quiet NaN) and `nan:0x7fffff`. So the printer was the inverse
// of a function nothing called. Both `literal.ts` halves now match the spec
// and the WAT parser.
//
// Fixed alongside, in the same file the metric pointed at: the WAT writer
// never emitted `return_call_indirect`'s TABLE index. That did not fail to
// reparse — `parseVarOpt` defaults it to 0 — so every `return_call_indirect`
// against a table other than 0 came back pointing at table 0.
//
// With these, **round-trip fidelity is 2120 / 2120** on the spec testsuite and
// 270 / 270 on the wasmtk WASI corpus. The metric is exhausted.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function toWat(binary: Uint8Array): string {
  const { text, errors } = wasm2wat(binary);
  if (hasErrors(errors)) throw new Error('wasm2wat:\n' + formatErrors(errors));
  assert(text);
  return text;
}

/** The constant line of a single-const module, minus the `(;=…;)` comment. */
function constLine(wat: string): string {
  const line = wat.split('\n').find((l) => /\.const/.test(l)) ?? '';
  return line.replace(/\(;=.*?;\)/, '').trim().replace(/\)+$/, '').trim();
}

describe('T10.4 — a NaN payload survives a round trip unchanged', () => {
  const F32 = ['nan', 'nan:0x1', 'nan:0x80', 'nan:0x200000', 'nan:0x400000', 'nan:0x7fffff'];
  const F64 = [
    'nan',
    'nan:0x1',
    'nan:0x4000000000000',
    'nan:0x8000000000000',
    'nan:0xfffffffffffff',
  ];

  for (const lit of F32) {
    for (const sign of ['', '-']) {
      it(`round-trips f32.const ${sign}${lit}`, () => {
        const first = compile(`(module (func (result f32) (f32.const ${sign}${lit})))`);
        assertEquals(compile(toWat(first)), first);
      });
    }
  }

  for (const lit of F64) {
    it(`round-trips f64.const ${lit}`, () => {
      const first = compile(`(module (func (result f64) (f64.const ${lit})))`);
      assertEquals(compile(toWat(first)), first);
    });
  }

  it('prints the payload as the full mantissa, not with the quiet bit stripped', () => {
    // 0x7fffffff is a quiet NaN with every payload bit set. Printing
    // `nan:0x3fffff` re-parsed to 0x7fbfffff — a SIGNALLING NaN.
    const wat = toWat(compile('(module (func (result f32) (f32.const nan:0x7fffff)))'));
    assertEquals(constLine(wat), 'f32.const nan:0x7fffff');
  });

  it('prints the canonical quiet NaN as bare `nan`', () => {
    // `nan` and `nan:0x400000` denote the same value; the short spelling wins.
    for (const lit of ['nan', 'nan:0x400000']) {
      const wat = toWat(compile(`(module (func (result f32) (f32.const ${lit})))`));
      assertEquals(constLine(wat), 'f32.const nan', lit);
    }
  });

  it('keeps a signalling NaN signalling', () => {
    // The quiet bit clear, other payload bits set. Forcing the bit on here is
    // what the old `literal.ts` parser did.
    const first = compile('(module (func (result f32) (f32.const nan:0x200000)))');
    const wat = toWat(first);
    assertEquals(constLine(wat), 'f32.const nan:0x200000');
    assertEquals(compile(wat), first);
  });
});

describe('T10.4 — return_call_indirect keeps its table index', () => {
  it('round-trips a call against a table other than 0', () => {
    const first = compile(`(module
      (type $t (func (result i32)))
      (table $t0 1 funcref)
      (table $t1 1 funcref)
      (func $f (export "f") (result i32)
        (return_call_indirect $t1 (type $t) (i32.const 0))))`);
    const wat = toWat(first);
    // Omitting the index still reparsed — parseVarOpt defaults it to 0 — so
    // the only tell was the bytes.
    assertEquals(compile(wat), first);
  });

  it('still omits the index when it is 0, as call_indirect does', () => {
    const first = compile(`(module
      (type $t (func (result i32)))
      (table $t0 1 funcref)
      (func $f (export "f") (result i32)
        (return_call_indirect (type $t) (i32.const 0))))`);
    const wat = toWat(first);
    assert(/return_call_indirect \(type/.test(wat), wat);
    assertEquals(compile(wat), first);
  });
});
