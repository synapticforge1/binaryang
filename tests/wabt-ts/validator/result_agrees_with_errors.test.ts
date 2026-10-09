// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `wasmValidate`'s `result` is `Error` whenever it REPORTED an error.
//
// 🔧 It was the checks' returned results alone, and a check that reports without
// failing — a block type naming a type that is not a function type — gave
// `Result.Ok` with the error in the list. `wasm-validate` printed the error, then
// "OK", and exited 0, on a module V8 refuses. Found by the code lens of
// open-work 13: a mutant of a wasmtk producer binary (`try_table`'s block type
// byte 0x40 → 0x80, reading as type index 128 of 16), run against V8. wasmtk
// uses `wasmValidate` as an oracle.

import { assert, assertEquals } from '@std/assert';

import { allFeatures, wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { Result } from '../../../src/core/result.ts';
import { ErrorLevel } from '../../../src/core/error.ts';

/** Bytes from labelled hex groups. */
const hex = (...groups: string[]) =>
  new Uint8Array(groups.join(' ').split(/\s+/).filter(Boolean).map((b) => parseInt(b, 16)));

/** A module of one `(func)` whose body is `block <blockType> end`. */
const withBlockType = (blockType: string) =>
  hex(
    '00 61 73 6d 01 00 00 00', // magic, version
    '01 04 01 60 00 00', // type section: one type, (func)
    '03 02 01 00', // function section: one function, of type 0
    `0a 07 01 05 00 02 ${blockType} 0b 0b`, // code: no locals, block … end, end
  );

/** The block type is type index 5; the module has one type. */
const BLOCK_TYPE_OUT_OF_RANGE = withBlockType('05');
/** The block type is empty (0x40): valid. */
const VALID = withBlockType('40');

Deno.test('the fixtures are what they say — V8 is the control', () => {
  assert(!WebAssembly.validate(BLOCK_TYPE_OUT_OF_RANGE as BufferSource));
  assert(WebAssembly.validate(VALID as BufferSource));
});

Deno.test('a block type naming no function type: reported AND failed', () => {
  for (const features of [undefined, allFeatures()]) {
    const r = wasmValidate(BLOCK_TYPE_OUT_OF_RANGE, features ? { features } : {});
    assert(
      r.errors.some((e) => e.message.includes('type index 5 is not a function type')),
      'the error is reported',
    );
    assertEquals(r.result, Result.Error, 'and the result says so');
  }
});

Deno.test('the result is Error exactly when an error-level diagnostic was reported', () => {
  for (const bytes of [VALID, BLOCK_TYPE_OUT_OF_RANGE]) {
    const r = wasmValidate(bytes, { features: allFeatures() });
    const reported = r.errors.some((e) => e.level === ErrorLevel.Error);
    assertEquals(r.result === Result.Error, reported);
    assertEquals(r.result === Result.Ok, WebAssembly.validate(bytes as BufferSource));
  }
});

Deno.test('`wasm-validate` exits 1 and says INVALID, not OK', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = `${dir}/bad.wasm`;
    await Deno.writeFile(file, BLOCK_TYPE_OUT_OF_RANGE);
    const main = new URL('../../../main.ts', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    );
    const out = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', main, 'wasm-validate', file],
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    const said = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
    assertEquals(out.code, 1, said);
    assert(!/: OK\b/.test(said), `no "OK": ${said}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
