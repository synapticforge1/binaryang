// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// An `if`'s DECLARED result type wins over the inferred one.
//
// The binary reader read the blocktype into `frame.resultTypes`, computed a
// `resultType` from it — and then discarded it with a literal `void resultType;`.
// `makeIf` infers the type from its arms instead, which is right until BOTH arms
// are unreachable: then there is nothing to infer from, the `if` comes out void,
// and the value the caller expects is simply absent.
//
//     (if (result i32) (local.get 0) (then (unreachable)) (else (unreachable)))
//     -> "expected 0 elements on the stack for fallthru, found 1"
//
// ⚠️ **Found by a THIRD ORACLE, not by the corpus.** Every invariant before this
// compared wabt-ts against binaryen-ts — our own two implementations — which is
// blind by construction to anything both get wrong the same way, and to input
// neither produces. This came from re-encoding 511 third-party binaries in the
// wasmtk suite; exactly one failed, a Go-compiled `strlib.wasm`. No module in
// the 421-file corpus has an `if` with two unreachable arms.
//
// 🔑 This is the concrete cost of the missing as-written field that
// `cmem/ir-convergence.md` identifies: `blockType`-as-declared is not a nicety,
// its absence emits invalid modules. The bridge already worked around the same
// gap with `withDeclaredType`.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** Assemble, read the BINARY into binaryen-ts IR, re-encode, and require validity. */
function binaryRoundTrip(wat: string): Uint8Array {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  assert(ref.binary && !hasErrors(ref.errors), 'wabt-ts must assemble the fixture');
  const out = encodeWasm(parseWasm(ref.binary));
  // Throws with the engine's own diagnostic if the declared type was lost.
  new WebAssembly.Module(out as BufferSource);
  return out;
}

const fn = (body: string) => `(module (func (export "f") (param i32) (result i32) ${body}))`;

describe('binary reader — an if keeps its DECLARED result type', () => {
  // The regression. Both arms unreachable, so nothing can be inferred.
  it('survives when BOTH arms are unreachable', () => {
    binaryRoundTrip(
      fn('(if (result i32) (local.get 0) (then (unreachable)) (else (unreachable)))'),
    );
  });

  // The near-misses that stayed valid by luck — inference happened to agree,
  // which is why nothing caught this for so long.
  it('one unreachable arm was already fine, and still is', () => {
    binaryRoundTrip(
      fn('(if (result i32) (local.get 0) (then (unreachable)) (else (i32.const 2)))'),
    );
    binaryRoundTrip(
      fn('(if (result i32) (local.get 0) (then (i32.const 1)) (else (unreachable)))'),
    );
  });

  it('an ordinary result-typed if is unchanged', () => {
    const out = binaryRoundTrip(
      fn('(if (result i32) (local.get 0) (then (i32.const 1)) (else (i32.const 2)))'),
    );
    const run = (x: number) =>
      (new WebAssembly.Instance(new WebAssembly.Module(out as BufferSource))
        .exports.f as (n: number) => number)(x);
    assertEquals(run(1), 1);
    assertEquals(run(0), 2);
  });

  // The other direction: a VOID if must not acquire a result type.
  it('a void if stays void', () => {
    const wat = '(module (func (export "f") (param i32) (if (local.get 0) (then (nop)))))';
    binaryRoundTrip(wat);
  });

  it('a nested result-typed if inside an unreachable arm', () => {
    binaryRoundTrip(
      fn(`(if (result i32) (local.get 0)
        (then (if (result i32) (local.get 0) (then (unreachable)) (else (unreachable))))
        (else (i32.const 2)))`),
    );
  });
});
