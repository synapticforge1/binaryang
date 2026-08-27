// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.24 — the bridge did not push a label frame for `if`.
//
// `bridgeExpr` keeps its own `ctx.labelStack` and resolves `br` depths against
// it. `block`, `loop` and `try_table` each push a frame; `if` did not. But an
// `if` is a branch target in wasm whether or not it carries a label, so every
// `br` inside one resolved ONE FRAME TOO SHALLOW — wrong in both directions:
//
//   br 0 (out of the if)   silently retargeted the enclosing block: a VALID
//                          module that returns a different number
//   br 1 (past the if)     died with a bogus "br depth 1 out of range"
//
// Measured against our own encoder on the fixture below: ours 222 / 111, bridge
// 111 / throw.
//
// The `if` case DID handle labels — it rejects a labeled `if` because
// binaryen-ts's `makeIf` has no label slot — so this reads as covered. What was
// missed is that an UNLABELED if still occupies a depth. The comment explained
// the labeled case and nobody asked about the other one.
//
// Same class as T13.22 (the try_table catch scope): bridge label bookkeeping
// diverging from `resolveNames`, which gets both right. Found by scoping that
// shape — enumerating every `labelStack` push/pop in the bridge against the
// cases that need one — rather than by any corpus, since the bridge is dev-only
// and no metric reaches it.
//
// **`br 0` is now a hard failure, not a fix.** binaryen-ts genuinely cannot
// express a branch to an unlabeled `if`, and the alternative — resolving to
// whatever encloses it — is the silent wrong answer this test exists to stop.
// Fail-loud is the correct end state until `makeIf` grows a label slot.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { LexerSource } from '../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../src/wabt-ts/ir/resolve-names.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../src/wabt-ts/tools/wat2wasm.ts';

import { bridgeToBinaryen } from '../../src/bridge/bridge.ts';
import { encodeWasm } from '../../src/binaryen-ts/encoder/index.ts';

function bridged(wat: string): Uint8Array {
  const { module, errors } = parseWatModule(new LexerSource(wat, '<label-frames>'));
  if (hasErrors(errors)) throw new Error('parse:\n' + formatErrors(errors));
  const re = makeErrorList();
  resolveNames(module, re);
  if (hasErrors(re)) throw new Error('resolveNames:\n' + formatErrors(re));
  return encodeWasm(bridgeToBinaryen(module));
}

function runExport(bytes: Uint8Array): number {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const inst = new WebAssembly.Instance(new WebAssembly.Module(buf), {});
  return (inst.exports.run as () => number)();
}

function ourAnswer(wat: string): number {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return runExport(binary);
}

/**
 * `br <depth>` from inside the `then` arm. Depth 0 targets the `if` itself, so
 * 111 becomes the if's value and is dropped, leaving 222. Depth 1 targets
 * `$outer` and returns 111. The two answers differ, which is what makes this
 * fixture able to tell the hypothesis from its negation — the failing property
 * of the first probe written for T13.22.
 */
const brFromIf = (depth: number) =>
  `(module (func (export "run") (result i32)
  (block $outer (result i32)
    (drop (if (result i32) (i32.const 1)
      (then (br ${depth} (i32.const 111)))
      (else (i32.const 0))))
    (i32.const 222))))`;

describe('T13.24 — the bridge accounts for the `if` label frame', () => {
  it('the fixture discriminates: the two depths give different answers', () => {
    // Guard the guard. If these ever agree, every assertion below is vacuous.
    assertEquals(ourAnswer(brFromIf(0)), 222, 'br 0 should target the if');
    assertEquals(ourAnswer(brFromIf(1)), 111, 'br 1 should target $outer');
  });

  it('resolves a br that branches PAST an if to the enclosing block', () => {
    // Was: "Bridge: br depth 1 out of range (stack size 1)" — valid input
    // rejected, because the if frame was missing from the count.
    assertEquals(runExport(bridged(brFromIf(1))), ourAnswer(brFromIf(1)));
  });

  it('rejects a br whose target IS the if, rather than silently retargeting', () => {
    // Was: silently resolved to $outer and returned 111 where 222 is correct —
    // a valid module computing something else, with no diagnostic.
    let msg = '';
    try {
      bridged(brFromIf(0));
    } catch (e) {
      msg = (e as Error).message;
    }
    assert(msg.includes('br to an `if` label'), `expected a loud refusal, got: ${msg || '(none)'}`);
  });

  it('still bridges an if with no branches in it', () => {
    // The guard against over-correcting: pushing a frame must not disturb the
    // ordinary case, and the condition is evaluated OUTSIDE the frame.
    const wat = `(module (func (export "run") (result i32)
      (if (result i32) (i32.const 1) (then (i32.const 7)) (else (i32.const 9)))))`;
    assertEquals(runExport(bridged(wat)), 7);
    assertEquals(runExport(bridged(wat)), ourAnswer(wat));
  });

  it('keeps block and loop depths correct alongside an if', () => {
    // An if between two blocks shifts every depth measured through it, so this
    // fails if the frame is pushed but never popped.
    const wat = `(module (func (export "run") (result i32)
      (block $a (result i32)
        (drop (if (result i32) (i32.const 1)
          (then (block $b (result i32) (br 2 (i32.const 55))))
          (else (i32.const 0))))
        (i32.const 66))))`;
    assertEquals(ourAnswer(wat), 55, 'fixture: br 2 should reach $a');
    assertEquals(runExport(bridged(wat)), 55);
  });
});
