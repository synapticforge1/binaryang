// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Invalid or malformed modules our validator ACCEPTED and V8 refuses — the
// code lens of open-work 13, by mutating the spec modules and asking both. Each
// case pins the refusal and V8's agreement, and a valid neighbour as the
// control, so a check that refuses everything fails too.
//
// - data / element segment flags with an undefined bit (read bit by bit, the
//   rest ignored);
// - br_on_cast flags with an undefined bit;
// - br_on_null / br_on_non_null of a non-reference;
// - br_on_cast_fail of an operand that is not its source type;
// - ref.null of a type index past the type section.

import { test } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { allFeatures, wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { Result } from '../../../src/core/result.ts';

/** Assembled WITHOUT validating: the point is what the validator then says. */
const asm = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false, validate: false, features: allFeatures() });
  assertEquals(r.errors.map((e) => e.message), [], 'assembles');
  return r.binary;
};
const verdicts = (bytes: Uint8Array) => ({
  ours: wasmValidate(bytes, { features: allFeatures() }).result === Result.Ok,
  v8: WebAssembly.validate(bytes as BufferSource),
});
const refusedBoth = (bytes: Uint8Array, said: string) => {
  assertEquals(verdicts(bytes), { ours: false, v8: false });
  const { errors } = wasmValidate(bytes, { features: allFeatures() });
  assert(errors.some((e) => e.message.includes(said)), errors.map((e) => e.message).join(' | '));
};

/** Bytes from labelled hex groups. */
const hex = (...groups: string[]) =>
  new Uint8Array(groups.join(' ').split(/\s+/).filter(Boolean).map((b) => parseInt(b, 16)));

/** The offset of the first byte of section `id`'s body, after its count. */
function firstEntry(bytes: Uint8Array, id: number): number {
  let p = 8;
  const leb = () => {
    let v = 0, s = 0, b;
    do {
      b = bytes[p++]!;
      v |= (b & 0x7f) << s;
      s += 7;
    } while (b & 0x80);
    return v;
  };
  while (p < bytes.length) {
    const sid = bytes[p++]!;
    const size = leb();
    if (sid === id) {
      leb(); // the entry count
      return p;
    }
    p += size;
  }
  throw new Error(`no section ${id}`);
}
const patched = (bytes: Uint8Array, at: number, v: number) => {
  const b = bytes.slice();
  b[at] = v;
  return b;
};

test('a data segment flag past 2 is malformed', () => {
  const bytes = asm('(module (memory 1) (data "x"))'); // passive: flags 1
  const at = firstEntry(bytes, 0x0b);
  assertEquals(bytes[at], 0x01, 'the flags byte');
  assertEquals(verdicts(bytes), { ours: true, v8: true }, 'control');
  refusedBoth(patched(bytes, at, 0x7f), 'malformed data segment flags: 127');
});

test('an element segment flag past 7 is malformed', () => {
  const bytes = asm('(module (func $f) (elem declare func $f))'); // declarative: flags 3
  const at = firstEntry(bytes, 0x09);
  assertEquals(bytes[at], 0x03, 'the flags byte');
  assertEquals(verdicts(bytes), { ours: true, v8: true }, 'control');
  refusedBoth(patched(bytes, at, 0x7f), 'malformed element segment flags: 127');
});

test('br_on_cast flags past 3 are malformed', () => {
  const wat = `(module (func (param anyref) (result anyref)
    (block (result anyref) (br_on_cast 0 anyref anyref (local.get 0)))))`;
  const bytes = asm(wat);
  assertEquals(verdicts(bytes), { ours: true, v8: true }, 'control');
  const at = bytes.findIndex((b, i) => b === 0xfb && bytes[i + 1] === 0x18); // br_on_cast
  assert(at > 0, 'found the instruction');
  refusedBoth(patched(bytes, at + 2, 0x80), 'malformed cast flags: 0x80');
});

test('br_on_null and br_on_non_null take a reference', () => {
  assertEquals(
    verdicts(asm('(module (func (param funcref) (block (br_on_null 0 (local.get 0)) (drop))))')),
    { ours: true, v8: true },
    'control',
  );
  refusedBoth(
    asm('(module (func (param i32) (block (br_on_null 0 (local.get 0)) (drop))))'),
    'type mismatch in br_on_null, expected a reference',
  );
  refusedBoth(
    asm(
      '(module (func (param i32) (block (result funcref) (br_on_non_null 0 (local.get 0)) (ref.null func))))',
    ),
    'type mismatch in br_on_non_null, expected a reference',
  );
});

test('br_on_cast_fail takes an operand of its source type', () => {
  const wat = (param: string) =>
    `(module (type $t (struct))
      (func (param ${param}) (result anyref)
        (block (result anyref)
          (br_on_cast_fail 0 (ref null $t) (ref $t) (local.get 0)) (drop) (ref.null any))))`;
  assertEquals(verdicts(asm(wat('(ref null $t)'))), { ours: true, v8: true }, 'control');
  refusedBoth(asm(wat('anyref')), 'type mismatch in br_on_cast_fail');
});

// `(0xfd << 16) | op` is one key only below 0x10000: a SIMD sub-opcode LEB
// stretched to 0x80060 ORed into 0xfd0060, a real opcode, and the validator
// then THREW from an opcode table (a `spec/simd_f32x4` mutant).
test('a SIMD sub-opcode past 0xffff is unknown, not an alias of a real one', () => {
  const bytes = asm(
    '(module (func (param v128 i32) (result v128) (f32x4.abs (local.get 0)) (local.get 1) (drop)))',
  );
  assertEquals(verdicts(bytes), { ours: true, v8: true }, 'control');
  const at = bytes.findIndex((b, i) =>
    b === 0xfd && bytes[i + 1] === 0xe0 && bytes[i + 2] === 0x01
  );
  assert(at > 0, 'found f32x4.abs');
  // e0 01 → e0 80 (20): the LEB runs on into the next byte, 0x80060.
  const mutant = patched(bytes, at + 2, 0x80);
  let said: string[] = [];
  said = wasmValidate(mutant, { features: allFeatures() }).errors.map((e) => e.message);
  assert(said.some((m) => m.includes('unknown SIMD opcode: 0xfd 0x80060')), said.join(' | '));
  assertEquals(WebAssembly.validate(mutant as BufferSource), false);
});

// A count read from the input bounds a loop that READS: once a read fails,
// the loop must stop. 🔧 It ran the count out, every read failing silently past
// the end — 10–14 s per spec mutant whose local-group count byte became 0x80
// (~2.8M groups in a 5-byte body), and hours for 0xffffffff.
test('a huge count in a tiny module is refused at once', () => {
  const huge = 'ff ff ff ff 0f'; // 0xffffffff as a LEB
  const localGroups = hex(
    '00 61 73 6d 01 00 00 00',
    '01 04 01 60 00 00',
    '03 02 01 00',
    `0a 08 01 06 ${huge} 0b`, // one 6-byte body: the local-group count, then end
  );
  const params = hex('00 61 73 6d 01 00 00 00', `01 08 01 60 ${huge} 00`); // (func (param × 2^32-1))
  for (
    const [what, bytes, said] of [
      [
        'local groups',
        localGroups,
        'local declaration count 4294967295 is larger than the function body',
      ],
      ['params', params, ''],
    ] as const
  ) {
    const t = performance.now();
    const r = wasmValidate(bytes, { features: allFeatures() });
    const ms = performance.now() - t;
    assert(ms < 1000, `${what}: ${ms.toFixed(0)} ms`);
    assertEquals(r.result, Result.Error, what);
    if (said) assert(r.errors.some((e) => e.message.includes(said)), r.errors[0]?.message);
    assertEquals(WebAssembly.validate(bytes as BufferSource), false, `${what}: V8 refuses it too`);
  }
});

// The typed select (0x1c) names exactly one type. With none it read as a bare
// select and passed; wasm-tools, wasmtime, wasmer, WasmEdge, V8 and JSC refuse
// it (upstream wabt passes it too). Well-formed, so it still reads and writes
// back byte for byte.
test('a typed select with no types: invalid arity, and still byte-exact', async () => {
  const bytes = hex(
    '00 61 73 6d 01 00 00 00',
    '01 05 01 60 00 01 7f', // (func (result i32))
    '03 02 01 00',
    '0a 0c 01 0a 00 41 00 41 01 41 01 1c 00 0b', // i32.const 0 1 1; select (result); end
  );
  refusedBoth(bytes, 'invalid arity in select instruction: 0.');
  const { readBinaryIr } = await import('../../../src/reader/binary-reader.ts');
  const { writeBinaryIr } = await import('../../../src/writer/binary-writer.ts');
  const { makeErrorList } = await import('../../../src/core/error.ts');
  assertEquals(writeBinaryIr(readBinaryIr(bytes, makeErrorList(), {})), bytes);
});

// An IMPORTED global's or table's value type names a type that exists, as a
// defined one's must. `(import … (global (mut (ref 0))))` with no types passed.
test('an imported global or table type names a type that exists', () => {
  assertEquals(
    verdicts(asm('(module (type (func)) (import "m" "g" (global (ref null 0))))')),
    { ours: true, v8: true },
    'control',
  );
  const global = hex(
    '00 61 73 6d 01 00 00 00',
    '02 09 01 01 6d 01 67 03 64 00 01', // import "m" "g" (global (mut (ref 0)))
  );
  refusedBoth(global, 'unknown type 0 in imported global');
  const table = hex(
    '00 61 73 6d 01 00 00 00',
    '02 0a 01 01 6d 01 74 01 64 00 00 01', // import "m" "t" (table 1 (ref 0))
  );
  refusedBoth(table, 'unknown type 0 in imported table');
});

test('ref.null names a type that exists', () => {
  assertEquals(
    verdicts(asm('(module (type (func)) (func (drop (ref.null 0))))')),
    { ours: true, v8: true },
    'control',
  );
  refusedBoth(
    asm('(module (type (func)) (func (drop (ref.null 7))))'),
    'unknown type 7 in ref.null',
  );
});
