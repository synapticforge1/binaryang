// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 1: the walkers visited a `br_if` / `br_table`'s CONDITION before
// its carried VALUES — the reverse of wasm, which pushes the values first. Every
// walker claims evaluation order (`visitChildren`, `mapChildrenShallow`), and
// one depends on it for meaning, not only for order-sensitive callers:
// `mapWithSequences` keeps, evaluated, the operands visited BEFORE one that
// becomes a never-falling-through sequence. With the condition first, StripEH
// turned `(br_if $l (throw $e) (call $bump))` into "call $bump, then trap" — a
// side effect wasm never performs, since the throw comes first.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import {
  asRegion,
  type Expression,
  ExpressionKind,
  makeBlock,
  makeBreak,
  makeCall,
  makeI32Const,
  makeLocalGet,
  makeSwitch,
  makeThrow,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { mapChildrenShallow, visitChildren } from '../../../src/binaryen-ts/ir/walk.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { varIndex, varName } from '../../../src/wabt-ts/ir/ir.ts';

/** What a child is, by the local it reads (0 = a value, 9 = the condition). */
const tag = (e: Expression) =>
  e.kind === ExpressionKind.LocalGet
    ? `local ${(e as { var: { value: number } }).var.value}`
    : e.kind;
const value = () => makeLocalGet(varIndex(0), ValType.I32);
const condition = () => makeLocalGet(varIndex(9), ValType.I32);

describe('a branch visits its values BEFORE its condition, as wasm evaluates them', () => {
  const nodes: [string, () => Expression][] = [
    ['br_if', () => makeBreak('l', condition(), [value()])],
    ['br_table', () => makeSwitch(['l'], 'l', condition(), [value()])],
  ];
  for (const [name, make] of nodes) {
    it(`${name}: visitChildren`, () => {
      const seen: string[] = [];
      visitChildren(make(), (c) => seen.push(tag(c)));
      expect(seen).toEqual(['local 0', 'local 9']);
    });
    it(`${name}: mapChildrenShallow`, () => {
      const seen: string[] = [];
      mapChildrenShallow(make(), (c) => (seen.push(tag(c)), c));
      expect(seen).toEqual(['local 0', 'local 9']);
    });
  }
});

describe('StripEH keeps a condition that runs after a throw from running', () => {
  // The TEXT reader never builds this shape — a stack-polymorphic `throw` stays
  // a statement before the branch, whose `values` are then empty — but a tree
  // built through the builder API, or by a pass, holds the throw IN `values`.
  const run = async (branch: (cond: Expression, values: Expression[]) => Expression) => {
    const m = readForPasses(
      wat2wasm(`(module
      (tag $e (param i32))
      (global $n (mut i32) (i32.const 0))
      (func $bump (result i32) (global.set $n (i32.add (global.get $n) (i32.const 1))) (i32.const 0))
      (func (export "run") (result i32) (i32.const 0))
      (func (export "n") (result i32) (global.get $n)))`).binary,
    );
    const bump = makeCall(varName('$bump'), [], ValType.I32);
    const thrown = makeThrow(varName('$e'), [makeI32Const(7)]); // WITH a payload: StripEH makes a SEQUENCE of it
    m.functions[1]!.body = asRegion(makeBlock([branch(bump, [thrown])], '$l', ValType.I32));
    new PassRunner(m, {}).add('StripEH').run();
    const { instance } = await WebAssembly.instantiate(writeWasm(m) as BufferSource);
    const x = instance.exports as Record<string, () => number>;
    expect(() => x.run!()).toThrow(WebAssembly.RuntimeError); // the throw became a trap
    return x.n!(); // …before the condition ever ran
  };
  it('br_if', async () => {
    expect(await run((c, v) => makeBreak('$l', c, v))).toBe(0);
  });
  it('br_table', async () => {
    expect(await run((c, v) => makeSwitch(['$l'], '$l', c, v))).toBe(0);
  });
});
