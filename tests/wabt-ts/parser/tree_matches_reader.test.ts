// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The parser's tree of a text IS the binary reader's tree of the bytes it
// writes (open-work 10, 2026-10-06). The writer now predicts text forms from
// the module in hand instead of reading its own bytes back, which holds only
// while the two trees agree — measured on 5,437 of 5,437 valid modules (the
// corpus and every prepared spec module, linear and folded). Three shapes did
// not, and each is pinned here; the first was a miscompile on the direct path
// (text tree → passes).

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../../src/wabt-ts/ir/synthesize-types.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { formNodes } from '../../../src/wabt-ts/ir/text-form.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { prepareForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import type { Module } from '../../../src/wabt-ts/ir/ir.ts';

function parsed(wat: string): Module {
  const p = parseWatModule(new LexerSource(wat, 'test.wat'));
  expect(p.errors.length).toBe(0);
  resolveNames(p.module, p.errors);
  synthesizeTypes(p.module);
  return p.module;
}

/** Each function's tree shape — kinds and canonical forms — from the parser and from the reader. */
function shapes(wat: string) {
  const m = parsed(wat);
  const r = readBinaryIr(writeBinaryIr(m, { writeTextForm: false }), makeErrorList(), {});
  const shape = (mod: Module) =>
    mod.functions.map((f) => {
      const { nodes, canonical } = formNodes(f.body.children);
      return nodes.map((n, i) => `${n.kind}:${canonical[i]}`).join(' ');
    });
  return { parser: shape(m), reader: shape(r), m };
}

describe("the parser's tree is the reader's", () => {
  it('🔧 a folded instruction short of operands takes the missing ones from BELOW', async () => {
    // select(val1 = 10, val2 = 20, cond = param): 10 was left on the stack before the nop.
    const wat = `(module (func (export "f") (param i32) (result i32)
      (i32.const 10) (nop) (select (i32.const 20) (local.get 0))))`;
    const { parser, reader } = shapes(wat);
    expect(parser).toEqual(reader);
    // It was a miscompile on the direct path: value and condition swapped.
    const m = prepareForPasses(parsed(wat));
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).addDefaultOptimizationPasses().run();
    const run = async (b: Uint8Array, x: number) =>
      ((await WebAssembly.instantiate(b as BufferSource)).instance.exports.f as (
        x: number,
      ) => number)(x);
    for (const x of [0, 1]) {
      expect(await run(writeWasm(m), x)).toBe(await run(wat2wasm(wat).binary, x));
    }
  });

  it("🔧 a `throw` takes its TAG's params — an imported tag's too", () => {
    const { parser, reader } = shapes(`(module
      (type (func))
      (import "t" "e" (tag $e (type 0)))
      (func (result i32) (i32.const 1) (throw $e)))`);
    expect(parser).toEqual(reader);
  });

  it('🔧 a multi-result child keeps its earlier results in their slots', () => {
    const { parser, reader } = shapes(`(module
      (func $two (param i32) (result i32 i32) (local.get 0) (i32.const 7))
      (func $g (param i32 i32 i32) (result i32) (local.get 0))
      (func (param i32) (result i32) (call $g (local.get 0) (call $two (local.get 0)))))`);
    expect(parser).toEqual(reader);
  });
});

describe('the text-form section, predicted from the module in hand', () => {
  it('gives back a mixed linear / folded body as written', () => {
    const wat = `(module (func (param i32) (result i32)
      local.get 0
      (i32.add (local.get 0) (i32.const 1))
      i32.mul))`;
    const text = wasm2wat(wat2wasm(wat).binary).text;
    expect(text).toContain(
      '    local.get 0\n    (i32.add\n      (local.get 0)\n      (i32.const 1))\n    i32.mul))',
    );
  });
});
