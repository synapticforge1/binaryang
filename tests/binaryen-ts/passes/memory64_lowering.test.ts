// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Memory64Lowering (open-work 32): a 64-bit memory becomes a 32-bit one and the module behaves as
// before — above 2^32 too, where upstream's lowering wraps (owner, 2026-10-22: "Trap, as the
// original"). Each case RUNS the lowered module and compares it with the values the original
// gives; where the host engine runs memory64 (V8, the referee), the ORIGINAL is run too and must
// agree, so the expected values are the engine's, not ours. On JavaScriptCore (test:bun) only the
// lowered module can run — which is the point of the pass.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { MAX_PAGES } from '../../../src/passes/memory64-lowering.ts';

type Fn = (...a: unknown[]) => unknown;
const P = 2n ** 32n;

function assemble(wat: string): Uint8Array {
  return wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;
}

function lower(wat: string): Uint8Array {
  const m = readForPasses(assemble(wat));
  new PassRunner(m, {}).add('Memory64Lowering').run();
  const out = writeWasm(m);
  expect(wasmValidate(out, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return out;
}

/** Whether the engine running the tests has memory64 (V8 does; JavaScriptCore does not). */
const hostHasMemory64 = (() => {
  try {
    new WebAssembly.Module(assemble('(module (memory i64 1))') as BufferSource);
    return true;
  } catch {
    return false;
  }
})();

/** Each call's outcome: its value (a bigint shown as such), or `trap`. */
async function outcomes(bytes: Uint8Array, calls: [string, ...unknown[]][]): Promise<string[]> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
  const ex = instance.exports as Record<string, Fn>;
  return calls.map(([f, ...args]) => {
    try {
      const r = ex[f]!(...args);
      return typeof r === 'bigint' ? `${r}n` : String(r);
    } catch (e) {
      return e instanceof WebAssembly.RuntimeError ? 'trap' : `threw ${(e as Error).message}`;
    }
  });
}

/** The lowered module gives `want`; so does the original, where the host can run it. */
async function same(wat: string, calls: [string, ...unknown[]][], want: string[]) {
  expect(await outcomes(lower(wat), calls)).toEqual(want);
  if (hostHasMemory64) expect(await outcomes(assemble(wat), calls)).toEqual(want);
}

const MEM = `(memory i64 1 4) (data (i64.const 0) "abcd")`;

describe('loads and stores', () => {
  it('in range, at the end, and past it', async () => {
    await same(
      `(module ${MEM} (func (export "ld") (param i64) (result i32) (i32.load8_u (local.get 0))))`,
      [['ld', 0n], ['ld', 3n], ['ld', 65535n], ['ld', 65536n], ['ld', -1n]],
      ['97', '100', '0', 'trap', 'trap'],
    );
  });

  it('at 2^32 and above: an out-of-bounds trap, where a wrap would read byte 0', async () => {
    await same(
      `(module ${MEM} (func (export "ld") (param i64) (result i32) (i32.load8_u (local.get 0))))`,
      [['ld', P], ['ld', P + 1n], ['ld', P + 3n]],
      ['trap', 'trap', 'trap'],
    );
  });

  it('a store at 2^32 traps and writes nothing', async () => {
    await same(
      `(module ${MEM}
        (func (export "st") (param i64) (i32.store8 (local.get 0) (i32.const 120)))
        (func (export "ld") (param i64) (result i32) (i32.load8_u (local.get 0))))`,
      [['st', P], ['ld', 0n], ['st', 1n], ['ld', 1n]],
      ['trap', '97', 'undefined', '120'],
    );
  });

  it('a static offset of 2^32 or more always traps, after its operands run', async () => {
    await same(
      `(module ${MEM} (global $g (mut i32) (i32.const 0))
        (func $bump (result i64) (global.set $g (i32.const 7)) (i64.const 0))
        (func (export "ld") (result i32) (i32.load8_u offset=4294967296 (call $bump)))
        (func (export "g") (result i32) (global.get $g)))`,
      [['ld'], ['g']],
      ['trap', '7'],
    );
  });

  it('an i64 load and a wide offset below 2^32', async () => {
    await same(
      `(module ${MEM} (func (export "ld") (param i64) (result i64) (i64.load32_u offset=1 (local.get 0))))`,
      [['ld', 0n], ['ld', 65532n], ['ld', P - 1n]],
      [`${0x00646362n}n`, 'trap', 'trap'], // bytes 1..4: "bcd", 0
    );
  });
});

describe('size and grow', () => {
  it('memory.size is an i64; grow returns the old size, or -1', async () => {
    await same(
      `(module (memory i64 1 4)
        (func (export "size") (result i64) (memory.size))
        (func (export "grow") (param i64) (result i64) (memory.grow (local.get 0))))`,
      [['size'], ['grow', 1n], ['size'], ['grow', 5n], ['grow', P], ['grow', P + 1n], ['size']],
      ['1n', '1n', '2n', '-1n', '-1n', '-1n', '2n'],
    );
  });

  it(`a lowered memory holds at most ${MAX_PAGES} pages; one that starts larger is refused`, () => {
    const m = readForPasses(assemble('(module (memory i64 1))'));
    new PassRunner(m, {}).add('Memory64Lowering').run();
    expect(m.memories[0]!.limits).toMatchObject({ is64: false, initial: 1n, max: MAX_PAGES });
    const big = readForPasses(assemble('(module (memory i64 65536))'));
    expect(() => new PassRunner(big, {}).add('Memory64Lowering').run()).toThrow(
      'starts at 65536 pages',
    );
  });
});

describe('bulk memory', () => {
  const BULK = `(module ${MEM}
    (func (export "fill") (param i64 i64) (memory.fill (local.get 0) (i32.const 120) (local.get 1)))
    (func (export "copy") (param i64 i64 i64) (memory.copy (local.get 0) (local.get 1) (local.get 2)))
    (func (export "ld") (param i64) (result i32) (i32.load8_u (local.get 0))))`;

  it('fill and copy, in range and at 2^32', async () => {
    await same(
      BULK,
      [
        ['copy', 10n, 0n, 4n],
        ['ld', 13n],
        ['fill', 20n, 2n],
        ['ld', 21n],
        ['fill', P, 0n], // dest past the end, even with no bytes: trap
        ['fill', 0n, P], // a length of 2^32: trap, not a wrap to 0
        ['copy', 0n, P, 1n],
        ['copy', P, 0n, 1n],
        ['copy', 0n, 0n, P], // a length of 2^32, both memories 64-bit: trap
        ['ld', 0n],
      ],
      ['undefined', '100', 'undefined', '120', 'trap', 'trap', 'trap', 'trap', 'trap', '97'],
    );
  });

  it('memory.init into a 64-bit memory, at 2^32 too', async () => {
    await same(
      `(module (memory i64 1) (data $d "xyz")
        (func (export "init") (param i64) (memory.init $d (local.get 0) (i32.const 0) (i32.const 3)))
        (func (export "ld") (param i64) (result i32) (i32.load8_u (local.get 0))))`,
      [['init', 5n], ['ld', 6n], ['init', P]],
      ['undefined', '121', 'trap'],
    );
  });

  it('memory.copy between a 32-bit and a 64-bit memory', async () => {
    await same(
      `(module (memory $a 1) (memory $b i64 1) (data (memory $a) (i32.const 0) "q")
        (func (export "to64") (param i64) (memory.copy $b $a (local.get 0) (i32.const 0) (i32.const 1)))
        (func (export "ld") (param i64) (result i32) (i32.load8_u $b (local.get 0))))`,
      [['to64', 9n], ['ld', 9n], ['to64', P]],
      ['undefined', '113', 'trap'],
    );
  });
});

describe('data segments', () => {
  it('an i64.const offset becomes an i32.const', async () => {
    await same(
      `(module (memory i64 1) (data (i64.const 100) "Z")
        (func (export "ld") (param i64) (result i32) (i32.load8_u (local.get 0))))`,
      [['ld', 100n]],
      ['90'],
    );
  });

  it('one at 2^32 still fails instantiation, as the original does', async () => {
    const wat = '(module (memory i64 1) (data (i64.const 4294967296) "Z"))';
    await expect(WebAssembly.instantiate(lower(wat) as BufferSource, {})).rejects.toThrow();
    if (hostHasMemory64) {
      await expect(WebAssembly.instantiate(assemble(wat) as BufferSource, {})).rejects.toThrow();
    }
  });
});

describe('tables (table64): the same pass, as upstream', () => {
  const TAB = `(module
    (type $r (func (result i32)))
    (table $t i64 4 funcref)
    (elem (table $t) (i64.const 0) func $a $b)
    (func $a (type $r) (i32.const 11))
    (func $b (type $r) (i32.const 22))
    (func (export "call") (param i64) (result i32) (call_indirect $t (type $r) (local.get 0)))
    (func (export "size") (result i64) (table.size $t))
    (func (export "grow") (param i64) (result i64) (table.grow $t (ref.null func) (local.get 0)))
    (func (export "is_null") (param i64) (result i32) (ref.is_null (table.get $t (local.get 0))))
    (func (export "set") (param i64) (table.set $t (local.get 0) (ref.null func)))
    (func (export "fill") (param i64 i64) (table.fill $t (local.get 0) (ref.null func) (local.get 1))))`;

  it('call_indirect at 2^32 traps, where a wrap would call entry 0', async () => {
    await same(
      TAB,
      [['call', 0n], ['call', 1n], ['call', 2n], ['call', 4n], ['call', P], ['call', P + 1n], [
        'call',
        -1n,
      ]],
      ['11', '22', 'trap', 'trap', 'trap', 'trap', 'trap'],
    );
  });

  it('table.get / set / fill at 2^32 trap; size and grow are i64', async () => {
    await same(
      TAB,
      [
        ['is_null', 0n],
        ['is_null', 3n],
        ['is_null', P],
        ['set', P],
        ['fill', 0n, P], // a length of 2^32: trap, not a wrap to 0
        ['call', 0n], // nothing above changed entry 0
        ['size'],
        ['grow', 2n],
        ['grow', P],
        ['size'],
      ],
      ['0', '1', 'trap', 'trap', 'trap', '11', '4n', '4n', '-1n', '6n'],
    );
  });

  it('a grow past the maximum returns -1 (not 2^32 - 1); a copy of length 2^32 traps', async () => {
    await same(
      `(module
        (table $t i64 2 3 funcref) (table $u i64 2 funcref)
        (func (export "grow") (param i64) (result i64) (table.grow $t (ref.null func) (local.get 0)))
        (func (export "copy") (param i64 i64 i64) (table.copy $u $t (local.get 0) (local.get 1) (local.get 2))))`,
      [['grow', 5n], ['grow', 1n], ['grow', 1n], ['copy', 0n, 0n, 1n], ['copy', 0n, 0n, P], [
        'copy',
        P,
        0n,
        0n,
      ]],
      ['-1n', '2n', '-1n', 'undefined', 'trap', 'trap'],
    );
  });

  it("upstream's alias finds it too: --table64-lowering", () => {
    const m = readForPasses(assemble('(module (table i64 1 funcref) (memory i64 1))'));
    new PassRunner(m, {}).add('table64-lowering').run();
    expect([m.tables[0]!.limits.is64, m.memories[0]!.limits.is64]).toEqual([false, false]);
  });
});

describe('what it leaves, and what it refuses', () => {
  it('a module with no 64-bit memory is unchanged', () => {
    // The IR, not the bytes: any PassRunner run marks the module optimized, which drops names.
    const ir = (m: ReturnType<typeof readForPasses>) =>
      JSON.stringify(
        { functions: m.functions, memories: m.memories, data: m.dataSegments },
        (_k, v) => (typeof v === 'bigint' ? `${v}n` : v),
      );
    const bin = assemble(`(module (memory 1) (data (i32.const 0) "a")
      (func (export "f") (result i32) (i32.load (i32.const 0))))`);
    const m = readForPasses(bin);
    new PassRunner(m, {}).add('Memory64Lowering').run();
    expect(ir(m)).toBe(ir(readForPasses(bin)));
  });

  it("upstream's flag finds it: --memory64-lowering", () => {
    const m = readForPasses(assemble('(module (memory i64 1))'));
    new PassRunner(m, {}).add('memory64-lowering').run();
    expect(m.memories[0]!.limits.is64).toBe(false);
  });
});
