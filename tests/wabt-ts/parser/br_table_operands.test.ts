// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A folded `br_table` keeps EVERY operand below its index (post-M8 fix 6).
//
// Its carried values were filtered by `kind !== 'nop'`, left from when the
// operand placeholder was a nop (it is a `pop` since S5). No placeholder ever
// reached it — linear text pops the index alone, and the folded form never
// pads — so the record called the filter stale. What it did meet was a REAL
// `(nop)` child, and it dropped it from the module: one byte short of upstream
// `wat2wasm`, the only branch that did (`br` / `br_if` / `return` /
// `br_on_null` keep theirs). The expected bytes below are upstream 1.0.41's.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

const WAT = `(module
  (func (export "f") (param i32) (result i32)
    (block (result i32)
      (br_table 0 0 (i32.const 7) (nop) (local.get 0)))))`;

/** The function body as upstream `wat2wasm` 1.0.41 writes it. */
const UPSTREAM_BODY = [
  ...[0x02, 0x7f], // block (result i32)
  ...[0x41, 0x07], // i32.const 7
  ...[0x01], // nop — the byte the filter dropped
  ...[0x20, 0x00], // local.get 0
  ...[0x0e, 0x01, 0x00, 0x00], // br_table 0 0
  ...[0x0b, 0x0b], // end end
];

function contains(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

describe('a folded br_table keeps every operand below its index', () => {
  it('a (nop) child is written, as upstream writes it', () => {
    const bytes = wat2wasm(WAT, { filename: 't.wat' }).binary;
    assert(bytes !== undefined);
    assert(contains(bytes, UPSTREAM_BODY), 'the body carries the nop');
    const x = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
      .exports as { f: (i: number) => number };
    assertEquals([x.f(0), x.f(1)], [7, 7]);
  });

  it('the tree holds it among the carried values, below the index', () => {
    const p = parseWatModule(WAT);
    assert(p.module);
    const block = p.module.functions[0]!.body.children[0];
    assert(block?.kind === 'block');
    const [bt] = block.children;
    assert(bt?.kind === 'br_table');
    assertEquals(bt.values.map((e) => e.kind), ['const', 'nop']);
    assertEquals(bt.condition.kind, 'local.get');
  });

  // Until post-M8 fix 9 a linear br_table took its index alone and left the
  // value a sibling; it now takes its default target's values, as the binary
  // reader does.
  it('a linear br_table takes its target’s value and its index', () => {
    const p = parseWatModule(`(module (func (param i32) (result i32)
      block (result i32)
        i32.const 7
        local.get 0
        br_table 0 0
      end))`);
    assert(p.module);
    const block = p.module.functions[0]!.body.children[0];
    assert(block?.kind === 'block');
    const bt = block.children.find((e) => e.kind === 'br_table');
    assert(bt?.kind === 'br_table');
    assertEquals(bt.values.map((e) => e.kind), ['const']);
    assertEquals(block.children.length, 1, 'the value is no longer a sibling');
  });
});
