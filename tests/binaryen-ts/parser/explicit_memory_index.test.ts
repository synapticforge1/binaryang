// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// binaryen-ts's WAT parser and an explicit memory index: refuse, never drop.
//
// The parser has no multi-memory support in its text front door. Four of the
// five ops probed already said so -- `(memory.grow $b …)`, `memory.fill`,
// `memory.copy` and `(i32.load $b …)` all throw "unexpected atom". But
// `(memory.size $b)` built a `memory.size` with NO memory index and ignored the
// argument, so it encoded as `memory.size 0`: a valid module that asks the
// wrong memory. With `$b` at 2 pages, `wat2wasm`'s module returns 2 and this
// parser's returned 1 -- measured by running both, 2026-09-15. Found while
// making `memidx` required (S6 step 5, stage B4) -- the node was built with an
// `as MemorySizeExpr` cast, which is why no type said anything.
//
// Supporting explicit indices is a feature; refusing is the defect fix.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

function refusal(wat: string): string {
  try {
    parseWat(wat);
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

const TWO = (body: string, result = '(result i32)') =>
  `(module (memory $a 1) (memory $b 2) (func (export "f") ${result} ${body}))`;

describe('binaryen-ts WAT parser — an explicit memory index is refused, not dropped', () => {
  it('memory.size $b', () => {
    const why = refusal(TWO('(memory.size $b)'));
    assert(why !== '', 'parsed, and silently asked memory 0 instead of $b');
    assert(/memory/i.test(why), `expected the refusal to name the memory index, got: ${why}`);
  });

  for (
    const [name, body, result] of [
      ['memory.grow $b', '(memory.grow $b (i32.const 1))', '(result i32)'],
      ['memory.fill $b', '(memory.fill $b (i32.const 0) (i32.const 7) (i32.const 1))', ''],
      ['memory.copy $b $a', '(memory.copy $b $a (i32.const 0) (i32.const 0) (i32.const 1))', ''],
      ['i32.load $b', '(i32.load $b (i32.const 0))', '(result i32)'],
    ] as const
  ) {
    it(`${name} (already refused -- pinned so it stays that way)`, () => {
      assert(refusal(TWO(body, result)) !== '', `${name} parsed`);
    });
  }

  // The refusal must not cost the ordinary, index-free spelling anything. Compared
  // by RUNNING both, not by bytes: `wat2wasm` always writes a name section (the
  // owner's rule, identical to upstream `--debug-names`) and this parser does not.
  it('a bare memory.size still parses, and asks the same memory wat2wasm does', () => {
    const wat = `(module (memory 3) (func (export "f") (result i32) (memory.size)))`;
    const run = (b: Uint8Array) =>
      (new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource)).exports.f as () =>
        number)();
    assertEquals(run(encodeWasm(parseWat(wat))), 3);
    assertEquals(run(wat2wasm(wat).binary), 3);
  });
});
