// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.34 — two limits on the subtyping graph that both engines enforce and we
// did not.
//
// 1. **Depth.** The GC proposal caps a type's subtyping depth at 63 so a
//    subtype check can be O(1) — a depth-indexed display rather than a walk.
//    Wasmtime rejects a deeper chain, and V8 says
//    `type 64: subtyping depth is greater than 63`. We accepted chains of any
//    length: a 2000-deep chain validated clean here and loaded nowhere.
//
// 2. **Cycles.** `$a` extending `$b` extending `$a`, a 3-cycle, and the
//    self-referential `$a extending $a` all validated clean. Both engines
//    reject them: `type 0: invalid supertype`.
//
// Both were found through a HARDENING lens — probing the type graph for hangs
// and blowup, not for wrongness. Neither is a hang (the walks are linear and
// terminate); both are silent acceptance, which the "does it survive?" fuzz axis
// of T13.29 is blind to by construction.
//
// ## The cycle half is a lesson about comments
//
// The depth check was written first, with a cycle guard and this comment:
//
//     `state` marks a node as in-progress, and meeting an in-progress node
//     returns 0 and lets the ordinary subtype checks report the cycle.
//
// **Nothing reported the cycle.** The claim was plausible, written by someone
// who had just read the surrounding code, and wrong — and it would have been
// believed. Checking it rather than trusting it is what found the second half.
// Same shape as T13.24: a thoughtful comment about one case is evidence the
// neighbouring case was never tested.
//
// The reporting itself was free: a depth walk must already detect cycles to
// terminate, so `inProgress` had the answer and was discarding it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function v8Accepts(bytes: Uint8Array): boolean {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return WebAssembly.validate(buf);
}

function ourVerdict(bytes: Uint8Array): Result {
  return wasmValidate(bytes, { features: allFeatures() }).result;
}

/** `n` types in a single `(sub …)` chain: $t0 <- $t1 <- … <- $t{n-1}. */
function chain(n: number): string {
  const types = Array.from(
    { length: n },
    (_, i) =>
      i === 0
        ? '(type $t0 (sub (struct (field i32))))'
        : `(type $t${i} (sub $t${i - 1} (struct (field i32))))`,
  ).join('\n  ');
  return `(module\n  ${types}\n  (func (param (ref $t${n - 1}))))`;
}

describe('T13.34 — subtyping depth is capped at 63', () => {
  // The boundary is the whole point: 64 types is 63 ancestors, which is legal.
  // 65 types is 64 ancestors, which is not. An off-by-one here rejects valid
  // modules, so both sides are pinned.
  for (const n of [2, 32, 63, 64]) {
    it(`accepts a chain of ${n} types (${n - 1} ancestors)`, () => {
      const b = compile(chain(n));
      assertEquals(v8Accepts(b), true, `V8 rejects ${n} — check the fixture`);
      assertEquals(ourVerdict(b), Result.Ok, `we rejected a legal chain of ${n}`);
    });
  }

  for (const n of [65, 100, 2000]) {
    it(`rejects a chain of ${n} types (${n - 1} ancestors)`, () => {
      const b = compile(chain(n));
      assertEquals(v8Accepts(b), false, `V8 accepts ${n} — check the fixture`);
      assertEquals(ourVerdict(b), Result.Error, `we accepted a chain of ${n}`);
    });
  }

  it('does not take superlinear time on a long chain', () => {
    // The hardening question that started this. The depth walk memoises, so a
    // 2000-type chain must not be quadratic.
    const b = compile(chain(2000));
    const t0 = performance.now();
    ourVerdict(b);
    const ms = performance.now() - t0;
    assert(ms < 2000, `validating a 2000-type chain took ${Math.round(ms)}ms`);
  });
});

describe('T13.34 — a supertype cycle is rejected, not walked forever', () => {
  const CYCLES: [string, string][] = [
    [
      'two types referencing each other',
      '(module (rec (type $a (sub $b (struct))) (type $b (sub $a (struct)))) (func (param (ref null $a))))',
    ],
    [
      'three-type cycle',
      `(module (rec (type $a (sub $c (struct))) (type $b (sub $a (struct)))
         (type $c (sub $b (struct)))) (func (param (ref null $a))))`,
    ],
    [
      'a type that is its own supertype',
      '(module (rec (type $a (sub $a (struct)))) (func (param (ref null $a))))',
    ],
  ];

  for (const [name, wat] of CYCLES) {
    it(`rejects ${name}`, () => {
      const b = compile(wat);
      assertEquals(v8Accepts(b), false, `V8 accepts "${name}" — check the fixture`);
      const { result, errors } = wasmValidate(b, { features: allFeatures() });
      assertEquals(result, Result.Error, `we accepted "${name}"`);
      assert(hasErrors(errors), `"${name}" was rejected with no diagnostic`);
    });
  }

  it('terminates promptly on a cycle', () => {
    // A depth walk without a cycle guard does not return at all.
    const b = compile(CYCLES[0]![1]);
    const t0 = performance.now();
    ourVerdict(b);
    assert(
      performance.now() - t0 < 1000,
      'validating a supertype cycle did not terminate promptly',
    );
  });

  it('still accepts legal recursive types', () => {
    // The guard against over-correcting. A rec group whose types REFERENCE each
    // other is the entire point of rec groups — only the SUPERTYPE graph must
    // be acyclic, and conflating the two would reject ordinary GC modules.
    const b = compile(`(module
      (rec (type $a (sub (struct (field (ref null $b)))))
           (type $b (sub (struct (field (ref null $a))))))
      (func (param (ref null $a) (ref null $b))))`);
    assertEquals(v8Accepts(b), true, 'V8 rejects the valid fixture — check it');
    const { result, errors } = wasmValidate(b, { features: allFeatures() });
    assertEquals(result, Result.Ok, `we rejected legal mutual recursion:\n${formatErrors(errors)}`);
  });

  it('still accepts a valid one-level subtype', () => {
    const b = compile(
      '(module (rec (type $a (sub (struct))) (type $b (sub $a (struct)))) (func (param (ref null $b))))',
    );
    assertEquals(v8Accepts(b), true);
    assertEquals(ourVerdict(b), Result.Ok);
  });
});
