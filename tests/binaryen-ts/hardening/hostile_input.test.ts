// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 13, the hardening round, pass 1. The contract under test: given
// hostile or malformed input, every entry point either works or answers in its
// OWN typed way — a reader's `WasmBinaryError`, a writer's `WasmEncodeError`,
// a tool's error list, the interpreter's `Stop`, the bundler's `BundleError` —
// and never lets a bare JavaScript error (`RangeError`, `TypeError`, a plain
// `Error` in an internal stage's words) escape. Each case below was a bare
// error before the pass; the instruments that found them (a depth probe and a
// mutation fuzz over wasmtk's real binaries) are recorded in cmem/hardening.md.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { wasmObjdump } from '../../../src/tools/wasm-objdump.ts';
import { readForPasses, readValidForPasses, WasmBinaryError } from '../../../src/ir/prepare.ts';
import { WasmEncodeError, writeWasm, writeWat } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { makeBlock } from '../../../src/ir/expressions.ts';
import { ModuleBuilder } from '../../../src/ir/module.ts';
import { interpModule, wasmInterp } from '../../../src/tools/wasm-interp.ts';
import { bundle, BundleError } from '../../../src/tools/wasm-bundle.ts';
import { readBinary } from '../../../src/compat/binaryen-compat.ts';
import { decodeLinkingSection, LinkingFormatError } from '../../../src/core/linking.ts';
import { encodeU32Leb128 } from '../../../src/core/leb128.ts';
import { NESTING_TOO_DEEP } from '../../../src/core/error.ts';

const leb = (n: number) => [...encodeU32Leb128(n)];
const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];

/** A valid module whose one function nests `n` empty blocks — written as bytes, no text parser in the way. */
function deepBlocks(n: number): Uint8Array {
  const body = [0x00, ...Array(n).fill([0x02, 0x40]).flat(), ...Array(n).fill(0x0b), 0x0b];
  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(1, [1, 0x60, 0, 0]),
    ...section(3, [1, 0]),
    ...section(7, [1, 1, 0x66, 0x00, 0]),
    ...section(10, [1, ...leb(body.length), ...body]),
  ]);
}

/** `f` throws an instance of `cls` whose message says the nesting is too deep. */
function tooDeep(f: () => unknown, cls: new (...a: never[]) => Error): void {
  let caught: unknown;
  try {
    f();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(cls);
  expect((caught as Error).message).toContain(NESTING_TOO_DEEP);
}

/** A tool result reports the nesting limit in its error list. */
function reportsTooDeep(r: { errors: { message: string }[] }): void {
  expect(r.errors.map((e) => e.message)).toContain(NESTING_TOO_DEEP);
}

// Far past every ceiling measured before the pass (~400 to ~5,000).
const DEEP = 60_000;

describe('hardening: a module nested deeper than the walkers can follow', () => {
  const bytes = deepBlocks(DEEP);

  it('the text tools report it in their error lists', () => {
    reportsTooDeep(wat2wasm(`(module (func ${'(block '.repeat(DEEP)}${')'.repeat(DEEP)}))`));
    reportsTooDeep(wasm2wat(bytes));
    reportsTooDeep(wasmValidate(bytes));
    reportsTooDeep(wasmObjdump(bytes));
  });

  it('the reader and the compat reader throw WasmBinaryError', () => {
    tooDeep(() => readForPasses(bytes), WasmBinaryError);
    tooDeep(() => readBinary(bytes), WasmBinaryError);
  });

  it('the optimizer, the interpreter, the bundler and the writers say so in their own terms', () => {
    // Built by the API, not read: the reader's own ceiling is below these
    // stages', so a READ module could never reach them this deep.
    const m = () => {
      let body = makeBlock([]);
      for (let i = 1; i < DEEP; i++) body = makeBlock([body]);
      return new ModuleBuilder().addFunction('f', [], [], body).addExport('f', 'f').build();
    };
    let optimizer: unknown;
    try {
      new PassRunner(m(), { optimizeLevel: 2, shrinkLevel: 2 }).addDefaultOptimizationPasses()
        .run();
    } catch (e) {
      optimizer = e;
    }
    expect((optimizer as Error)?.message).toBe(`optimizer: ${NESTING_TOO_DEEP}`);
    // interpModule records a Stop as the call's OUTCOME (its contract), rather than throwing.
    expect(interpModule(m(), { runAllExports: true })[0]!.outcome).toEqual({
      stop: `unsupported: ${NESTING_TOO_DEEP}`,
    });
    tooDeep(() => bundle([{ name: 'a', module: m() }], { log: undefined }), BundleError);
    tooDeep(() => writeWasm(m()), WasmEncodeError);
    tooDeep(() => writeWat(m()), WasmEncodeError);
  });
});

describe('hardening: the nesting the text route and the writers can FOLLOW (pass 2)', () => {
  // Name resolution recursed through one 700-line switch, whose frame V8
  // sizes for every case, and gave up between 300 and 400 nested blocks on a
  // COLD call — the lowest ceiling of any stage. Split into a dispatcher (pass
  // 2) it follows 700 cold (and ~1,500 once the JIT has warmed it). Pinned at
  // 600, cold-safe, which the unsplit resolver fails — a change that brings
  // back the old frame shows here.
  const DEPTH = 600;
  const built = (n: number) => {
    let body = makeBlock([]);
    for (let i = 1; i < n; i++) body = makeBlock([body]);
    return new ModuleBuilder().addFunction('f', [], [], body).addExport('f', 'f').build();
  };

  it(`the writers write ${DEPTH} nested blocks`, () => {
    expect(WebAssembly.validate(writeWasm(built(DEPTH)) as BufferSource)).toBe(true);
    expect(writeWat(built(DEPTH)).length).toBeGreaterThan(DEPTH);
  });

  it(`wat2wasm assembles ${DEPTH} nested blocks, linear and folded`, () => {
    expect(wat2wasm(`(module (func ${'block '.repeat(DEPTH)}${'end '.repeat(DEPTH)}))`).errors)
      .toEqual([]);
    expect(wat2wasm(`(module (func ${'(block '.repeat(DEPTH)}${')'.repeat(DEPTH)}))`).errors)
      .toEqual([]);
  });
});

describe('hardening: an invalid module the reader can decode', () => {
  // The reader decodes structure; it does not validate. These read, and then
  // failed inside preparation in its own words ("derive-types: no local …").
  const badLocal = wat2wasm('(module (func local.get 5 drop))').binary;
  const badCall = wat2wasm('(module (func call 9))').binary;

  it("readForPasses answers with the VALIDATOR's diagnostic, at an offset in the file", () => {
    expect(() => readForPasses(badLocal)).toThrow(WasmBinaryError);
    expect(() => readForPasses(badLocal)).toThrow(
      /:[0-9a-f]{7}: error: local variable out of range/,
    );
    expect(() => readForPasses(badCall)).toThrow(/function variable out of range/);
  });

  it('a valid module reads as before (the validator runs on the failure path only)', () => {
    const ok = wat2wasm('(module (func (export "f") (result i32) (i32.const 7)))').binary;
    expect(readForPasses(ok).functions.length).toBe(1);
    expect(readValidForPasses(ok).functions.length).toBe(1);
  });

  it('readValidForPasses refuses an invalid module that preparation would accept', () => {
    // i32.add of i64 operands: preparation does not type-check operands, the validator does.
    const confused =
      wat2wasm('(module (func (result i32) (i32.add (i64.const 1) (i64.const 2))))').binary;
    expect(readForPasses(confused).functions.length).toBe(1);
    expect(() => readValidForPasses(confused)).toThrow(WasmBinaryError);
    expect(() => readValidForPasses(confused)).toThrow(/type mismatch/);
  });

  it('the interpreter STOPS on what only an invalid module can do', () => {
    const throwRef = readForPasses(
      wat2wasm('(module (func (export "f") (throw_ref (i32.const 0))))').binary,
    );
    expect(interpModule(throwRef, { runAllExports: true })[0]!.outcome).toEqual({
      stop: 'invalid: throw_ref of a number',
    });
    const i31 = readForPasses(
      wat2wasm('(module (func (export "f") (drop (i31.get_s (i32.const 0)))))').binary,
    );
    expect(interpModule(i31, { runAllExports: true })[0]!.outcome).toEqual({
      stop: 'invalid: expected a reference',
    });
  });

  it('wasm-interp validates a file before running it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hostile-'));
    try {
      const path = join(dir, 'bad.wasm');
      writeFileSync(
        path,
        wat2wasm('(module (func (export "f") (throw_ref (i32.const 0))))').binary,
      );
      await expect(wasmInterp(path, { runAllExports: true })).rejects.toThrow(WasmBinaryError);
      const text = join(dir, 'bad.wat');
      writeFileSync(text, '(module (func (export "f") (throw_ref (i32.const 0))))');
      await expect(wasmInterp(text, { runAllExports: true })).rejects.toThrow(
        /type mismatch|expected/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('hardening: a malformed linking section', () => {
  it('a truncated LEB inside a symbol entry is a LinkingFormatError, not a RangeError', () => {
    // version 2, symbol table (8) of 6 bytes: 1 symbol, a function, flags 0, an index LEB cut short.
    const payload = new Uint8Array([2, 8, 6, 1, 0, 0, 0x80, 0x80, 0x80]);
    expect(() => decodeLinkingSection(payload)).toThrow(LinkingFormatError);
    expect(() => decodeLinkingSection(payload)).toThrow(/malformed LEB128|unexpected end/);
  });

  it('wasm-bundle names the input whose linking section is malformed', () => {
    const m = readForPasses(wat2wasm('(module (memory 1) (func (export "f")))').binary);
    m.customSections.push({ name: 'linking', data: new Uint8Array([2, 8, 1, 0x80]) });
    expect(() => bundle([{ name: 'broken', module: m }], { log: undefined })).toThrow(BundleError);
    expect(() => bundle([{ name: 'broken', module: m }], { log: undefined })).toThrow(/^broken: /);
  });
});
