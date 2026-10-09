// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 24: `wasm-bundle`. The claim is BEHAVIOUR under V8: a bundle of
// real `wasm-ld --emit-relocs` outputs (rustc, zig) and of modules our own
// assembler marked with `(@reloc data)` runs each program as it ran alone,
// with its memory image moved to its own base — every marked address, every
// pointer word in data, every address global. The structural claims (one
// memory, one import per name, the conflict policies) are checked on the
// module read back.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import {
  bundle,
  BundleError,
  type BundleInput,
  type BundleOptions,
  moduleNameOf,
} from '../../../src/binaryen-ts/tools/wasm-bundle.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';

const PAGE = 65536;
const fixtures = join(import.meta.dirname!, 'fixtures', 'bundle');

function fixture(name: string): WasmModule {
  return readForPasses(new Uint8Array(readFileSync(join(fixtures, name))), name);
}

function input(name: string, module: WasmModule): BundleInput {
  return { name, module, source: name };
}

/** Bundle, write, validate, and read back. */
function bundled(inputs: BundleInput[], options: Partial<BundleOptions> = {}) {
  const { module, report } = bundle(inputs, { log: undefined, ...options });
  const bytes = writeWasm(module);
  expect(WebAssembly.validate(bytes as BufferSource)).toBe(true);
  return { bytes, report, back: readForPasses(bytes) };
}

/** A WASI host that captures what the program writes to any fd. */
async function run(bytes: Uint8Array) {
  const written: string[] = [];
  const host: { memory?: WebAssembly.Memory } = {};
  const view = () => new DataView(host.memory!.buffer);
  const wasi = {
    fd_write: (_fd: number, iovs: number, count: number, nwritten: number): number => {
      let total = 0;
      for (let i = 0; i < count; i++) {
        const ptr = view().getUint32(iovs + i * 8, true);
        const len = view().getUint32(iovs + i * 8 + 4, true);
        written.push(new TextDecoder().decode(new Uint8Array(host.memory!.buffer, ptr, len)));
        total += len;
      }
      view().setUint32(nwritten, total, true);
      return 0;
    },
    environ_sizes_get: (count: number, size: number): number => {
      view().setUint32(count, 0, true);
      view().setUint32(size, 0, true);
      return 0;
    },
    environ_get: (): number => 0,
    proc_exit: (code: number): never => {
      throw new Error(`proc_exit(${code})`);
    },
  };
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {
    wasi_snapshot_preview1: wasi,
  });
  const ex = instance.exports as Record<string, (...a: number[]) => number>;
  const memory = instance.exports.memory as WebAssembly.Memory;
  host.memory = memory;
  const str = (ptr: number, len: number) =>
    new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len));
  const byte = (ptr: number) => new Uint8Array(memory.buffer)[ptr]!;
  return { ex, memory, written, str, byte };
}

const RUST_PAGES = 17;
const ZIG_PAGES = 2;

/** The Rust program's claims, from any base. */
function checkRust(ex: Awaited<ReturnType<typeof run>>, base: number) {
  const { ex: f, str, written } = ex;
  f._start!();
  expect(written.join('')).toBe('hello from strlib\n');
  const ptr = f.greeting_ptr!();
  expect(ptr).toBeGreaterThanOrEqual(base);
  expect(ptr).toBeLessThan(base + RUST_PAGES * PAGE);
  expect(str(ptr, f.greeting_len!())).toBe('hello from strlib\n');
  expect([0, 1, 2, 3].map((i) => f.table_at!(i))).toEqual([10, 20, 30, 40]);
  // `NAMES` is a table of pointers in data: `R_WASM_MEMORY_ADDR_I32` words.
  expect(str(f.name_ptr!(0), f.name_len!(0))).toBe('alpha');
  expect(str(f.name_ptr!(1), f.name_len!(1))).toBe('beta');
  expect(f.name_ptr!(1)).toBeGreaterThanOrEqual(base);
  expect([f.bump!(), f.bump!(), f.bump!()]).toEqual([1, 2, 3]); // .bss, through a memarg offset
}

function checkZig(ex: Awaited<ReturnType<typeof run>>, base: number) {
  const { ex: f, str } = ex;
  expect([0, 1, 2, 3, 4, 7].map((i) => f.square_at!(i))).toEqual([1, 4, 9, 16, 25, 9]);
  const ptr = f.label_ptr!();
  expect(ptr).toBeGreaterThanOrEqual(base);
  expect(ptr).toBeLessThan(base + ZIG_PAGES * PAGE);
  expect(str(ptr, f.label_len!())).toBe('zig says hi');
  expect(f.call_count!()).toBe(6);
}

describe('wasm-bundle: linked modules (wasm-ld --emit-relocs)', () => {
  it('bundles a Rust WASI program with a Zig library: one memory, every address moved, both run', async () => {
    const { bytes, report, back } = bundled([
      input('strbin', fixture('strbin_rust.wasm')),
      input('mathlib', fixture('mathlib_zig.wasm')),
    ]);
    expect(report.inputs.map((r) => [r.name, r.base, r.pages, r.relocation])).toEqual([
      ['strbin', 0, RUST_PAGES, 'linked'],
      ['mathlib', RUST_PAGES * PAGE, ZIG_PAGES, 'linked'],
    ]);
    expect(report.inputs[0]!.entries).toBe(1049 + 110);
    expect(report.inputs[1]!.entries).toBe(5);
    expect(report.memory).toEqual({ pages: RUST_PAGES + ZIG_PAGES });
    expect(back.memories.length).toBe(1);
    expect(back.imports.length).toBe(4); // the WASI imports, once each
    expect(back.customSections.filter((c) => c.name !== 'name' && c.name !== 'binaryang.text-form'))
      .toEqual([]);
    expect(report.inputs[0]!.dropped).toContain('linking');

    const instance = await run(bytes);
    expect(instance.memory.buffer.byteLength).toBe((RUST_PAGES + ZIG_PAGES) * PAGE);
    await checkRust(instance, 0);
    await checkZig(instance, RUST_PAGES * PAGE);
  });

  it('in the other order the Rust image moves, stack pointer and heap end included, and still runs', async () => {
    const { bytes, report } = bundled([
      input('mathlib', fixture('mathlib_zig.wasm')),
      input('strbin', fixture('strbin_rust.wasm')),
    ]);
    expect(report.inputs.map((r) => r.base)).toEqual([0, ZIG_PAGES * PAGE]);
    const instance = await run(bytes);
    await checkZig(instance, 0);
    await checkRust(instance, ZIG_PAGES * PAGE);
  });

  it('a __memory_base-relative module (Rust cdylib) moves by its base global', async () => {
    const { bytes, report } = bundled([
      input('mathlib', fixture('mathlib_zig.wasm')),
      input('strlib', fixture('strlib_rust.wasm')),
    ]);
    const base = ZIG_PAGES * PAGE;
    expect(report.inputs[1]!.base).toBe(base);
    const { ex, str } = await run(bytes);
    ex._initialize!();
    const ptr = ex.greeting_ptr!();
    expect(ptr).toBeGreaterThanOrEqual(base);
    expect(str(ptr, ex.greeting_len!())).toBe('hello from strlib');
    expect([0, 1, 2, 3].map((i) => ex.table_at!(i))).toEqual([10, 20, 30, 40]);
    expect([ex.bump!(), ex.bump!()]).toEqual([1, 2]);
  });

  it('refuses a module whose relocations are stale (the code was re-encoded after the link)', () => {
    // Our own writer re-encodes the padded LEBs wasm-ld left at the sites, and
    // keeps the Linking sections as they were: exactly TinyGo's situation.
    const rewritten = readForPasses(writeWasm(fixture('strbin_rust.wasm')));
    expect(rewritten.customSections.some((c) => c.name === 'reloc.CODE')).toBe(true);
    expect(() => bundle([input('strbin', rewritten)], { log: undefined })).toThrow(
      /stale|does not match/,
    );
  });
});

// ---------------------------------------------------------------------------
// Modules our assembler marked with (@reloc data)
// ---------------------------------------------------------------------------

/** A library with a string, a pointer table in data, and a bump heap — every address marked. */
function marked(tag: string): string {
  return `(module
    (memory (export "memory") 1)
    (global $heap (mut i32) (@reloc data) (i32.const 1056))
    (data (i32.const 1024) "${tag}bc\\00${tag}yz\\00")
    (data (i32.const 1040) (@reloc data) "\\00\\04\\00\\00\\04\\04\\00\\00")
    (func (export "str") (result i32)
      (@reloc data) i32.const 1024)
    (func (export "word") (param $i i32) (result i32)
      (i32.load (i32.add (@reloc data) (i32.const 1040) (i32.mul (local.get $i) (i32.const 4)))))
    (func (export "byte") (param $p i32) (result i32)
      (i32.load8_u (local.get $p)))
    (func (export "alloc") (param $n i32) (result i32)
      (local $p i32)
      (local.set $p (global.get $heap))
      (global.set $heap (i32.add (local.get $p) (local.get $n)))
      (local.get $p)))`;
}

describe('wasm-bundle: (@reloc data) marks through our assembler', () => {
  it('the assembler writes linking + reloc.CODE / reloc.GLOBAL / reloc.DATA from the marks', () => {
    const m = readWat(marked('a'));
    expect(m.customSections.map((c) => c.name)).toEqual(
      expect.arrayContaining(['linking', 'reloc.CODE', 'reloc.GLOBAL', 'reloc.DATA']),
    );
  });

  it("two marked libraries: the second one's string, pointer words and heap all move", async () => {
    const { bytes, report } = bundled(
      [input('a', readWat(marked('a'))), input('b', readWat(marked('b')))],
      { onConflict: 'prefix' },
    );
    expect(report.inputs.map((r) => [r.base, r.entries, r.moved])).toEqual([
      [0, 5, 7], // 2 code sites, 2 data words, 1 global — and the 2 segment offsets
      [PAGE, 5, 7],
    ]);
    expect(report.conflicts.map((c) => c.name).sort()).toEqual(['alloc', 'byte', 'str', 'word']);
    const { ex, byte } = await run(bytes);
    expect(ex.a_str!()).toBe(1024);
    expect(ex.b_str!()).toBe(PAGE + 1024);
    expect(String.fromCharCode(byte(ex.a_str!()))).toBe('a');
    expect(String.fromCharCode(byte(ex.b_str!()))).toBe('b');
    expect(ex.a_word!(1)).toBe(1028);
    expect(ex.b_word!(1)).toBe(PAGE + 1028);
    expect(String.fromCharCode(byte(ex.b_word!(1)))).toBe('b');
    expect(String.fromCharCode(byte(ex.b_byte!(ex.b_word!(0)) ? ex.b_word!(0) : 0))).toBe('b');
    expect([ex.a_alloc!(8), ex.a_alloc!(0)]).toEqual([1056, 1064]);
    expect([ex.b_alloc!(8), ex.b_alloc!(0)]).toEqual([PAGE + 1056, PAGE + 1064]);
    expect(ex.memory === undefined).toBe(false);
  });

  it('a misplaced or malformed mark is an error, not a dropped annotation', () => {
    const errorsOf = (src: string): string => {
      const { errors } = wat2wasm(src, { filename: 't.wat' });
      return hasErrors(errors) ? formatErrors(errors) : '';
    };
    expect(errorsOf('(module (func (result i32) (@reloc data) i32.const 1 i32.const 2 i32.add))'))
      .toBe('');
    expect(errorsOf('(module (func (result i32) i32.const 1 i32.const 2 (@reloc data) i32.add))'))
      .toMatch(
        /belongs before an i32.const/,
      );
    expect(errorsOf('(module (func (result i64) (@reloc data) i64.const 1))')).toMatch(
      /belongs before an i32.const/,
    );
    expect(errorsOf('(module (memory 1) (data (i32.const 0) (@reloc data) "\\01\\02\\03"))'))
      .toMatch(/whole i32 words/);
    expect(errorsOf('(module (func (@reloc code) i32.const 1 drop))')).toMatch(/expected `data`/);
  });
});

// ---------------------------------------------------------------------------
// Unmarked modules
// ---------------------------------------------------------------------------

const UNMARKED = `(module
  (memory (export "memory") 1)
  (data (i32.const 1024) "plain\\00")
  (func (export "str") (result i32) i32.const 1024)
  (func (export "byte") (param $p i32) (result i32) (i32.load8_u (local.get $p)))
  (func (export "seven") (result i32) i32.const 7))`;

describe('wasm-bundle: a module with no relocation marks', () => {
  it('is refused by default, naming the ways to mark it', () => {
    expect(() => bundle([input('p', readWat(UNMARKED))], { log: undefined })).toThrow(
      /no linking section.*--emit-relocs.*\(@reloc data\).*--unmarked=guess/s,
    );
  });

  it('with unmarked: guess, relocates by its data range and warns', async () => {
    const { bytes, report } = bundled(
      [input('a', readWat(marked('a'))), input('p', readWat(UNMARKED))],
      { unmarked: 'guess', onConflict: 'prefix' },
    );
    expect(report.inputs[1]!.relocation).toBe('guessed');
    expect(report.inputs[1]!.moved).toBe(2); // the i32.const 1024 and the segment offset
    expect(report.warnings.length).toBe(1);
    expect(report.warnings[0]).toMatch(/GUESSED/);
    const { ex, str } = await run(bytes);
    expect(ex.p_str!()).toBe(PAGE + 1024);
    expect(str(ex.p_str!(), 5)).toBe('plain');
    expect(ex.seven!()).toBe(7); // outside the range: untouched
  });

  it('a module without a memory has nothing to relocate and needs no marks', () => {
    const { report } = bundled([
      input('pure', readWat('(module (func (export "f") (result i32) i32.const 3))')),
    ]);
    expect(report.inputs[0]!.relocation).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Exports, imports, start
// ---------------------------------------------------------------------------

const leaf = (n: number, name = 'f') =>
  readWat(`(module (func (export "${name}") (result i32) i32.const ${n}))`);

describe('wasm-bundle: export conflicts', () => {
  it('refuses by default and lists the names and inputs', () => {
    expect(() => bundle([input('a', leaf(1)), input('b', leaf(2))], { log: undefined })).toThrow(
      /1 export name clash.*"f" \(a, b\).*--on-conflict=prefix/s,
    );
  });

  it('prefix: each becomes <module>_<name>; a name only one input has stays bare', async () => {
    const { bytes, report } = bundled(
      [input('a', leaf(1)), input('b', leaf(2)), input('c', leaf(3, 'g'))],
      { onConflict: 'prefix' },
    );
    expect(report.exports.map((e) => e.name)).toEqual(['a_f', 'b_f', 'g']);
    const { ex } = await run(bytes);
    expect([ex.a_f!(), ex.b_f!(), ex.g!()]).toEqual([1, 2, 3]);
  });

  it('alias: as prefix, but every module in a conflict must have been named by the caller', () => {
    expect(() =>
      bundle([input('a', leaf(1)), input('b', leaf(2))], {
        log: undefined,
        onConflict: 'alias',
        named: new Set(['a']),
      })
    ).toThrow(/needs an alias for every module.*b/);
    const { report } = bundled([input('a', leaf(1)), input('b', leaf(2))], {
      onConflict: 'alias',
      named: new Set(['a', 'b']),
    });
    expect(report.exports.map((e) => e.name)).toEqual(['a_f', 'b_f']);
    expect(report.conflicts[0]!.resolution).toBe('alias');
  });

  it('exclude: neither is exported', () => {
    const { report, back } = bundled([input('a', leaf(1)), input('b', leaf(2))], {
      onConflict: 'exclude',
    });
    expect(report.exports).toEqual([]);
    expect(back.exports).toEqual([]);
    expect(back.functions.length).toBe(2); // still there; an optimizer would drop them
  });

  it("start: the chosen input keeps _start, the others' are prefixed", async () => {
    const { bytes, report } = bundled(
      [input('a', leaf(1, '_start')), input('b', leaf(2, '_start'))],
      { start: 'b' },
    );
    expect(report.exports.map((e) => e.name).sort()).toEqual(['_start', 'a__start']);
    const { ex } = await run(bytes);
    expect(ex._start!()).toBe(2);
    expect(ex.a__start!()).toBe(1);
  });

  it('memory exports collapse into one set, never a conflict', () => {
    const a = readWat(
      '(module (memory 1) (export "memory" (memory 0)) (export "mem_a" (memory 0)) (data (i32.const 0) "x"))',
    );
    const b = readWat('(module (memory 1) (export "memory" (memory 0)) (data (i32.const 0) "y"))');
    const { back } = bundled([input('a', a), input('b', b)], { unmarked: 'guess' });
    expect(back.exports.map((e) => e.name)).toEqual(['memory', 'mem_a']);
  });
});

describe('wasm-bundle: imports', () => {
  const WASI = (name: string, sig: string) =>
    `(import "wasi_snapshot_preview1" "${name}" (func $${name} ${sig}))`;
  const w = (n: number, sig = '(param i32 i32 i32 i32) (result i32)') =>
    readWat(
      `(module ${
        WASI('fd_write', sig)
      } (func (export "f${n}") (result i32) (call $fd_write (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))`,
    );

  it('the same import in two inputs is declared once', () => {
    const { back } = bundled([input('a', w(1)), input('b', w(2))]);
    expect(back.imports.length).toBe(1);
    expect(back.exports.map((e) => e.name)).toEqual(['f1', 'f2']);
  });

  it('the same import with two types is refused', () => {
    expect(() =>
      bundle([input('a', w(1)), input('b', w(2, '(param i32) (result i32)'))], { log: undefined })
    )
      .toThrow(/"fd_write" has a different type/);
  });

  it("an import from another input by its name is linked to that input's export", async () => {
    const a = readWat(
      '(module (func (export "add") (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1))))',
    );
    const b = readWat(`(module
      (import "a" "add" (func $add (param i32 i32) (result i32)))
      (func (export "twice") (param $x i32) (result i32) (call $add (local.get $x) (local.get $x))))`);
    const { bytes, back } = bundled([input('a', a), input('b', b)]);
    expect(back.imports).toEqual([]);
    const { ex } = await run(bytes);
    expect(ex.twice!(21)).toBe(42);
  });

  it('an import from another input that it does not export is an error', () => {
    const a = leaf(1);
    const b = readWat('(module (import "a" "nothing" (func)))');
    expect(() => bundle([input('a', a), input('b', b)], { log: undefined })).toThrow(
      /"nothing".*does not export/,
    );
  });
});

describe('wasm-bundle: start functions', () => {
  const starter = (name: string, v: number) =>
    readWat(
      `(module (global $g (export "${name}") (mut i32) (i32.const 0)) (func $s (global.set $g (i32.const ${v}))) (start $s))`,
    );

  it('several start sections run in input order from one start function', async () => {
    const { bytes, back } = bundled([input('a', starter('ga', 1)), input('b', starter('gb', 2))]);
    expect(back.start).toBeDefined();
    expect(back.functions.length).toBe(3);
    const { ex } = await run(bytes);
    expect((ex.ga as unknown as WebAssembly.Global).value).toBe(1);
    expect((ex.gb as unknown as WebAssembly.Global).value).toBe(2);
  });
});

describe('wasm-bundle: names', () => {
  it('derives a module name from the file name', () => {
    expect(moduleNameOf('lib/math-lib.wasm')).toBe('math_lib');
    expect(moduleNameOf('18_bundle.wat')).toBe('_18_bundle');
    expect(moduleNameOf('strbin_rust.wasm')).toBe('strbin_rust');
  });

  it('refuses two inputs with one name, and a name that is not an identifier', () => {
    expect(() => bundle([input('a', leaf(1)), input('a', leaf(2))], { log: undefined })).toThrow(
      /two inputs are named "a"/,
    );
    expect(() => bundle([input('a-b', leaf(1))], { log: undefined })).toThrow(/not a module name/);
  });

  it('refuses GC types, several memories, and 64-bit or shared memories', () => {
    expect(() => bundle([input('g', readWat('(module (type (struct)))'))], { log: undefined }))
      .toThrow(/GC/);
    expect(() =>
      bundle([input('m', readWat('(module (memory 1) (memory 1))'))], { log: undefined })
    ).toThrow(/2 memories/);
    expect(() => bundle([input('m', readWat('(module (memory i64 1))'))], { log: undefined }))
      .toThrow(/64-bit/);
    expect(() => bundle([input('m', readWat('(module (memory 1 1 shared))'))], { log: undefined }))
      .toThrow(/shared/);
  });
});

describe('wasm-bundle: BundleError', () => {
  it('is what every refusal throws', () => {
    try {
      bundle([], { log: undefined });
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BundleError);
    }
  });
});
