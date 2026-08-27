// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.22 / T13.47 — a try_table's own label is NOT in scope for its handlers.
//
// `bridgeExpr` used to push the try_table's label and THEN resolve the catch
// clauses, so every handler target came out one frame too shallow. It survived
// four releases because binaryen-ts <= 1.4.3 counted that same frame when
// turning a `dest` into a depth: two errors cancelling to the right wire byte.
// 1.5.0 fixed their half, which turned our half into wrong output.
//
// THE PROBE MUST USE A NUMERIC DEPTH. The bridge resolves a NAMED target to a
// name, and a name is insensitive to what is on the label stack -- a named
// probe returns the correct bytes whether the bug is present or not. Only an
// index engages the stack indexing that carries the defect. The first probe
// written for this fix used a name, reported a clean MATCH in a configuration
// later measured as broken, and would have licensed the merge.
//
// The oracle is OUR OWN ENCODER, not V8: three of the four
// (bridge old/fixed) x (binaryen-ts 1.0.9/1.5.0) combinations emit bytes V8
// still ACCEPTS while naming the wrong handler.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { LexerSource } from '../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../src/wabt-ts/ir/synthesize-types.ts';
import { writeBinaryIr } from '../../src/wabt-ts/writer/binary-writer.ts';
import { makeErrorList } from '../../src/wabt-ts/core/error.ts';
import { bridgeToBinaryen } from '../../src/bridge/bridge.ts';
import { encodeWasm } from '../../src/binaryen-ts/encoder/index.ts';

/** Encode `src` twice: through our own writer, and through the bridge. */
function bothEncoders(src: string): { ours: Uint8Array; bridged: Uint8Array } {
  const { module, errors } = parseWatModule(new LexerSource(src, '<test>'));
  assertEquals(errors.length, 0, `parse errors in fixture: ${errors.length}`);
  resolveNames(module, makeErrorList());
  synthesizeTypes(module);
  return { ours: writeBinaryIr(module), bridged: encodeWasm(bridgeToBinaryen(module)) };
}

/** The try_table opcode and its immediates, as hex. */
function tryTableBytes(b: Uint8Array): string {
  const i = b.indexOf(0x1f);
  assertEquals(i >= 0, true, 'no try_table (0x1f) in output');
  return [...b.subarray(i, i + 6)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
}

function v8Accepts(b: Uint8Array): boolean {
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  return WebAssembly.validate(buf);
}

const CASES: [name: string, src: string, wantDepth: number][] = [
  [
    'numeric depth 0 targets the ENCLOSING block, not the try_table',
    `(module (tag $e (param i32))
      (func (export "f") (result i32)
        (block (result i32)
          (try_table (result i32) (catch $e 0) (i32.const 1)))))`,
    0,
  ],
  [
    'numeric depth 1 targets the outer of two blocks',
    `(module (tag $e (param i32))
      (func (export "f") (result i32)
        (block (result i32)
          (block (result i32)
            (try_table (result i32) (catch $e 1) (i32.const 1))))))`,
    1,
  ],
  [
    'a NAMED target (control: cannot see the bug either way)',
    `(module (tag $e (param i32))
      (func (export "f") (result i32)
        (block $o (result i32)
          (try_table (result i32) (catch $e $o) (i32.const 1)))))`,
    0,
  ],
];

describe('T13.22 — try_table catch targets resolve in the ENCLOSING scope', () => {
  for (const [name, src, wantDepth] of CASES) {
    describe(name, () => {
      it('the bridge agrees with our own encoder, byte for byte', () => {
        const { ours, bridged } = bothEncoders(src);
        assertEquals(tryTableBytes(bridged), tryTableBytes(ours));
      });

      it(`encodes catch depth ${wantDepth}`, () => {
        // Pinned absolutely, not just as agreement: if BOTH encoders regressed
        // the same way, agreement alone would still pass.
        const { ours } = bothEncoders(src);
        const bytes = tryTableBytes(ours).split(' ');
        assertEquals(bytes[5], wantDepth.toString(16).padStart(2, '0'));
      });

      it('both outputs are accepted by V8', () => {
        const { ours, bridged } = bothEncoders(src);
        assertEquals(v8Accepts(ours), true, 'our encoder emitted invalid wasm');
        assertEquals(v8Accepts(bridged), true, 'the bridge emitted invalid wasm');
      });
    });
  }

  it('the numeric cases actually differ from each other', () => {
    // Guard the guard. If depth 0 and depth 1 produced identical bytes the
    // suite would pass while testing nothing -- which is exactly how the
    // original named-target probe failed.
    const a = tryTableBytes(bothEncoders(CASES[0]![1]).ours);
    const b = tryTableBytes(bothEncoders(CASES[1]![1]).ours);
    assertEquals(a === b, false, 'the two depth fixtures encode identically');
  });
});
