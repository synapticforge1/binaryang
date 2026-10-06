// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// SimplifyLocals sinks a set's value to the get that reads it (open-work 2,
// step 3b), and the effect analysis that decides what it may move past
// (`ir/effects.ts`). A sink past the wrong thing yields a VALID module that
// computes something else, so every case RUNS the module before and after —
// and asserts whether the sink happened, so a case that never sank proves
// nothing.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { invalidates, noEffects, shallowEffects } from '../../../src/binaryen-ts/ir/effects.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import type { Expression } from '../../../src/binaryen-ts/ir/expressions.ts';

type Fn = (...a: number[]) => number;

function sink(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('SimplifyLocals').run();
  const after = writeWasm(m);
  const { errors } = wasmValidate(after, { features: allFeatures() });
  expect(errors.map((e) => e.message)).toEqual([]);
  return { before, after, text: wasm2wat(after).text };
}

/** Result or trap message, and the first 16 bytes of memory if there is one. */
async function observe(bytes: Uint8Array, name: string, args: number[]) {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  const ex = instance.exports as Record<string, unknown>;
  let r: string;
  try {
    r = String((ex[name] as Fn)(...args));
  } catch (e) {
    r = `trap: ${(e as Error).message}`;
  }
  const mem = ex.memory instanceof WebAssembly.Memory
    ? ` mem ${[...new Uint8Array(ex.memory.buffer, 0, 16)]}`
    : '';
  return `${args} -> ${r}${mem}`;
}

async function same(before: Uint8Array, after: Uint8Array, name: string, inputs: number[][]) {
  for (const a of inputs) {
    expect(await observe(after, name, a)).toBe(await observe(before, name, a));
  }
}

const INPUTS = [[0], [1], [-1], [7], [0x7fffffff]];

describe('a set sinks into the get that reads it', () => {
  it('one read: the value moves there and the set goes', async () => {
    const { before, after, text } = sink(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.mul (local.get 0) (i32.const 3)))
        (drop (i32.const 0))
        (i32.add (local.get 1) (i32.const 1))))`);
    expect(text).not.toContain('local.set');
    expect(text).not.toContain('local.tee');
    await same(before, after, 'f', INPUTS);
  });

  it('two reads: the first becomes a tee', async () => {
    const { before, after, text } = sink(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.mul (local.get 0) (i32.const 3)))
        (i32.add (local.get 1) (local.get 1))))`);
    expect(text).toContain('local.tee');
    expect(text).not.toContain('local.set');
    await same(before, after, 'f', INPUTS);
  });

  it('past a write of ANOTHER global (globals reach the passes by name)', async () => {
    const { before, after, text } = sink(`(module
      (global $a (mut i32) (i32.const 5))
      (global $b (mut i32) (i32.const 0))
      (func (export "f") (result i32) (local i32)
        (local.set 0 (global.get $a))
        (global.set $b (i32.const 9))
        (i32.add (local.get 0) (global.get $b))))`);
    expect(text).not.toContain('local.set');
    await same(before, after, 'f', [[]]);
  });

  it('past a call, when the value reads only locals', async () => {
    const { before, after, text } = sink(`(module
      (global $g (mut i32) (i32.const 0))
      (func $bump (global.set $g (i32.add (global.get $g) (i32.const 1))))
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.add (local.get 0) (i32.const 1)))
        (call $bump)
        (i32.add (local.get 1) (global.get $g))))`);
    expect(text).not.toContain('local.set');
    await same(before, after, 'f', INPUTS);
  });
});

describe('what a value may NOT move past', () => {
  it('🔧 seed 128: a read of a local the value WRITES (a tee inside it)', async () => {
    const { before, after, text } = sink(`(module
      (global $g (mut i32) (i32.const 0))
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.add (local.tee 0 (i32.const 100)) (i32.const 1)))
        (global.set $g (local.get 0))
        (i32.add (local.get 1) (global.get $g))))`);
    // Local 1's value writes local 0, which the global.set (staying where it
    // is) reads: local 1 stays put.
    expect(text).toContain('local.set 1');
    await same(before, after, 'f', INPUTS);
  });

  it("🔧 seed 128: a value another set was sunk into carries that set's write", async () => {
    const { before, after } = sink(`(module
      (func (export "f") (result i32) (local i32 i32 i32)
        (local.set 0 (i32.const 7))
        (local.set 1 (i32.add (local.get 0) (i32.const 1)))
        (local.set 2 (local.get 0))
        (i32.add (i32.mul (local.get 2) (i32.const 100)) (local.get 1))))`);
    await same(before, after, 'f', [[]]);
  });

  it('a call that writes a global the value reads', async () => {
    const { before, after, text } = sink(`(module
      (global $g (mut i32) (i32.const 5))
      (func $bump (global.set $g (i32.const 9)))
      (func (export "f") (result i32) (local i32)
        (local.set 0 (global.get $g))
        (call $bump)
        (local.get 0)))`);
    expect(text).toContain('local.set');
    await same(before, after, 'f', [[]]);
  });

  it('a read of a global that a call IN the value writes', async () => {
    const { before, after, text } = sink(`(module
      (global $g (mut i32) (i32.const 5))
      (global $h (mut i32) (i32.const 0))
      (func $bump (result i32) (global.set $g (i32.const 9)) (i32.const 1))
      (func (export "f") (result i32) (local i32)
        (local.set 0 (call $bump))
        (global.set $h (global.get $g))
        (i32.add (local.get 0) (global.get $h))))`);
    expect(text).toContain('local.set');
    await same(before, after, 'f', [[]]);
  });

  it('a global.set of a global the value reads', async () => {
    const { before, after, text } = sink(`(module
      (global $g (mut i32) (i32.const 5))
      (func (export "f") (result i32) (local i32)
        (local.set 0 (global.get $g))
        (global.set $g (i32.const 9))
        (local.get 0)))`);
    expect(text).toContain('local.set');
    await same(before, after, 'f', [[]]);
  });

  it('memory.grow, when the value reads the memory size', async () => {
    const { before, after, text } = sink(`(module (memory 1)
      (func (export "f") (result i32) (local i32)
        (local.set 0 (memory.size))
        (drop (memory.grow (i32.const 1)))
        (local.get 0)))`);
    expect(text).toContain('local.set');
    await same(before, after, 'f', [[]]);
  });

  it('a store, when the value may trap (the store would show)', async () => {
    const { before, after, text } = sink(`(module (memory (export "memory") 1)
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.div_s (i32.const 10) (local.get 0)))
        (i32.store (i32.const 0) (i32.const 0x01020304))
        (local.get 1)))`);
    expect(text).toContain('local.set');
    await same(before, after, 'f', INPUTS);
  });

  it('another trap (the two report different kinds)', async () => {
    const { before, after, text } = sink(`(module (memory 1)
      (func (export "f") (param i32 i32) (result i32) (local i32)
        (local.set 2 (i32.div_s (i32.const 10) (local.get 0)))
        (drop (i32.load (local.get 1)))
        (local.get 2)))`);
    expect(text).toContain('local.set');
    await same(before, after, 'f', [[0, 0x7fffffff], [0, 0], [2, 0x7fffffff]]);
  });

  it('a branch: the set would become conditional', async () => {
    const { before, after, text } = sink(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (block $out
          (local.set 1 (i32.const 5))
          (br_if $out (local.get 0))
          (local.set 1 (i32.add (local.get 1) (i32.const 1))))
        (local.get 1)))`);
    expect(text).toContain('local.set 1\n');
    await same(before, after, 'f', INPUTS);
  });

  it('into an if arm, or a loop', async () => {
    const { before, after, text } = sink(`(module
      (func (export "f") (param i32) (result i32) (local i32 i32)
        (local.set 1 (i32.const 5))
        (if (local.get 0) (then (local.set 2 (local.get 1))))
        (local.set 1 (i32.const 6))
        (loop $l (local.set 2 (i32.add (local.get 2) (local.get 1))))
        (local.get 2)))`);
    expect(text.match(/local\.set 1/g)?.length).toBe(2);
    await same(before, after, 'f', INPUTS);
  });

  it('the end of a block a branch reaches by DEPTH (its label is empty)', async () => {
    const { before, after } = sink(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.const 1))
        (block
          (br_if 0 (local.get 0))
          (local.set 1 (i32.const 2)))
        (local.get 1)))`);
    await same(before, after, 'f', INPUTS);
  });
});

/** The first node of `kind` in the module's first function. */
function nodeOf(wat: string, kind: string): Expression {
  const m = readForPasses(wat2wasm(wat, { textForm: false }).binary);
  let found: Expression | undefined;
  walkExpression(m.functions[0]!.body, (e) => {
    if (found === undefined && e.kind === kind) found = e;
  });
  if (found === undefined) throw new Error(`no ${kind}`);
  return found;
}

describe('the effect analysis classifies what running code cannot isolate', () => {
  // Every store may trap, so a behaviour test of "a store writes memory" is
  // always also caught by the trap rule; the classification is asserted here.
  it('a store conflicts with a read of memory that cannot trap', () => {
    const store = shallowEffects(
      nodeOf(`(module (memory 1) (func (i32.store (i32.const 0) (i32.const 1))))`, 'store'),
    );
    const size = shallowEffects(
      nodeOf(`(module (memory 1) (func (drop (memory.size))))`, 'memory.size'),
    );
    expect(store.writesMemory).toBe(true);
    expect(invalidates(store, size)).toBe(true);
    expect(invalidates(size, size)).toBe(false);
  });

  it('a global by index and a global by name are never proved apart', () => {
    const write = { ...noEffects(), globalsWritten: new Set(['#0']) };
    const named = { ...noEffects(), globalsRead: new Set(['$g']) };
    const other = { ...noEffects(), globalsRead: new Set(['#1']) };
    expect(invalidates(write, named)).toBe(true);
    expect(invalidates(named, write)).toBe(true);
    expect(invalidates(write, other)).toBe(false);
  });
});

describe('the effect analysis fails safe', () => {
  it('a kind it does not classify conflicts with everything', () => {
    const unknown = { ...noEffects(), unknown: true };
    expect(invalidates(unknown, noEffects())).toBe(true);
    expect(invalidates(noEffects(), unknown)).toBe(true);
    expect(invalidates(noEffects(), noEffects())).toBe(false);
  });
});
