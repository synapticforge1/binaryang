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

Deno.test('a data segment flag past 2 is malformed', () => {
  const bytes = asm('(module (memory 1) (data "x"))'); // passive: flags 1
  const at = firstEntry(bytes, 0x0b);
  assertEquals(bytes[at], 0x01, 'the flags byte');
  assertEquals(verdicts(bytes), { ours: true, v8: true }, 'control');
  refusedBoth(patched(bytes, at, 0x7f), 'malformed data segment flags: 127');
});

Deno.test('an element segment flag past 7 is malformed', () => {
  const bytes = asm('(module (func $f) (elem declare func $f))'); // declarative: flags 3
  const at = firstEntry(bytes, 0x09);
  assertEquals(bytes[at], 0x03, 'the flags byte');
  assertEquals(verdicts(bytes), { ours: true, v8: true }, 'control');
  refusedBoth(patched(bytes, at, 0x7f), 'malformed element segment flags: 127');
});

Deno.test('br_on_cast flags past 3 are malformed', () => {
  const wat = `(module (func (param anyref) (result anyref)
    (block (result anyref) (br_on_cast 0 anyref anyref (local.get 0)))))`;
  const bytes = asm(wat);
  assertEquals(verdicts(bytes), { ours: true, v8: true }, 'control');
  const at = bytes.findIndex((b, i) => b === 0xfb && bytes[i + 1] === 0x18); // br_on_cast
  assert(at > 0, 'found the instruction');
  refusedBoth(patched(bytes, at + 2, 0x80), 'malformed cast flags: 0x80');
});

Deno.test('br_on_null and br_on_non_null take a reference', () => {
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

Deno.test('br_on_cast_fail takes an operand of its source type', () => {
  const wat = (param: string) =>
    `(module (type $t (struct))
      (func (param ${param}) (result anyref)
        (block (result anyref)
          (br_on_cast_fail 0 (ref null $t) (ref $t) (local.get 0)) (drop) (ref.null any))))`;
  assertEquals(verdicts(asm(wat('(ref null $t)'))), { ours: true, v8: true }, 'control');
  refusedBoth(asm(wat('anyref')), 'type mismatch in br_on_cast_fail');
});

Deno.test('ref.null names a type that exists', () => {
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
