// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A legacy `try … delegate` leaked its label into the binary writer's scope.
//
// `delegate` REPLACES `end` as the try's terminator, so `ExprVisitor` fires
// `onDelegateExpr` INSTEAD of `endTryExpr` (the WAT parser's label check says so,
// and pops there). The writer's `onDelegateExpr` popped the label to write the
// target — correct: the try's own label is not in scope for it — and then pushed
// it BACK for an `endTryExpr` that never comes. So every delegate left one
// label behind:
//
//   - later in the SAME function, every named branch past it resolved one frame
//     too deep. VALID bytes, wrong program: `br $out` was written `br 1`, which
//     upstream wat2wasm 1.0.41 writes `br 0`, and the function below returned 0
//     instead of 7;
//   - in a LATER function, the writer's balance check refused the module
//     ("label scope not balanced … 1 left"), which is how it was found — while
//     building TranslateToExnref's fixtures (2026-09-14).

import { assert, assertEquals } from '@std/assert';

import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

/**
 * `binary` with its `name` custom section cut out, byte for byte, so the hex
 * below is the instructions' alone. (It lived in binaryen-ts's
 * `nameless_reference.ts`, retired with `parseWat` in One front end stage 5.)
 */
function withoutNameSection(binary: Uint8Array): Uint8Array {
  const leb = (p: { i: number }): number => {
    let r = 0;
    for (let shift = 0;; shift += 7) {
      const x = binary[p.i++]!;
      r += (x & 0x7f) * 2 ** shift;
      if ((x & 0x80) === 0) return r;
    }
  };
  const keep: number[] = [...binary.subarray(0, 8)];
  const p = { i: 8 };
  while (p.i < binary.length) {
    const start = p.i;
    const id = binary[p.i++]!;
    const end = leb(p) + p.i;
    let isName = false;
    if (id === 0) {
      const q = { i: p.i };
      const n = leb(q);
      isName = new TextDecoder().decode(binary.subarray(q.i, q.i + n)) === 'name';
    }
    if (!isName) keep.push(...binary.subarray(start, end));
    p.i = end;
  }
  return new Uint8Array(keep);
}

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  return r.binary;
}

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

const SAME_FUNCTION = `(module
  (func (export "g") (result i32) (local $r i32)
    (block $a
      (block $out
        (try $t (do (try (do (nop)) (delegate $t))) (catch_all))
        (br $out))
      (local.set $r (i32.const 7)))
    (local.get $r)))`;

Deno.test('delegate: a named branch after it in the same function keeps its depth', () => {
  const bytes = assemble(SAME_FUNCTION);
  // Upstream wat2wasm 1.0.41's bytes for the module above, taken 2026-09-14.
  // The branch is the `0c 00` — the leak wrote `0c 01`.
  assertEquals(
    hex(withoutNameSection(bytes)),
    '00 61 73 6d 01 00 00 00 01 05 01 60 00 01 7f 03 02 01 00 07 05 01 01 67 00 00 ' +
      '0a 1d 01 1b 01 01 7f 02 40 02 40 06 40 06 40 01 18 00 19 0b 0c 00 0b 41 07 21 00 0b 20 00 0b',
  );
  const g = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports
    .g as () => number;
  assertEquals(g(), 7);
});

Deno.test('delegate: a function after one that delegates still assembles', () => {
  for (const delegate of ['(delegate $t)', '(delegate 1)']) {
    const r = wat2wasm(`(module (tag $e)
      (func (try $t (do (try (do (throw $e)) ${delegate})) (catch_all)))
      (func (block $b (br $b))))`);
    assert(!hasErrors(r.errors), `${delegate}: ${formatErrors(r.errors)}`);
  }
});
