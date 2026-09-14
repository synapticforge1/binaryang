// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The non-nullable-local fixup (`src/binaryen-ts/passes/non-nullable-locals.ts`).
//
// It was documented and did not exist: `Pass.requiresNonNullableLocalFixups`
// was `false` in every pass and nothing read it, while pass.ts said the fixup
// "is automatically inserted" and inlining.ts leaned on it. Probed 2026-09-14
// with GC fixtures through every pass and every -O level: Flatten turned a valid
// `(if (result (ref $S)) …)` into a set in each arm and a read after the `if`,
// which V8 and wabt-ts both refused ("uninitialized non-defaultable local").
// Every other pass and pipeline kept the fixtures valid.
//
// The analysis is checked case by case against the wasm rule — a set covers
// reads until the end of its enclosing construct — each uncovered case beside a
// covered twin, because a fixup that flags everything would pass the Flatten
// test too.

import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import {
  handleNonDefaultableLocals,
  uncoveredNonNullableLocals,
} from '../../../src/binaryen-ts/passes/non-nullable-locals.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';

const S = '(type $S (struct (field i32)))';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  return r.binary;
}

function assertValid(bytes: Uint8Array): void {
  new WebAssembly.Module(bytes as BufferSource); // V8
  const errs = makeErrorList();
  const m = readBinaryIr(bytes, errs);
  if (!hasErrors(errs)) validateModule(m, errs, { features: allFeatures() });
  assert(!hasErrors(errs), `wabt-ts: ${formatErrors(errs)}`);
}

function run(bytes: Uint8Array, inputs: number[]): number[] {
  const f = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports.f as (
    x: number,
  ) => number;
  return inputs.map((x) => f(x));
}

/** The uncovered local indices of function 0 in a one-function module whose body is `body`. */
function uncovered(locals: string, body: string): number[] {
  const mod = parseWasm(assemble(`(module ${S}
    (func (param $p i32) (result i32) ${locals} ${body}))`));
  return [...uncoveredNonNullableLocals(mod.functions[0]!)].sort();
}

const NEW = '(struct.new $S (i32.const 1))';
const GET_T = '(struct.get $S 0 (local.get $t))';
const T = '(local $t (ref $S))'; // local 1

Deno.test('analysis: a set at the top level covers every later read', () => {
  assertEquals(
    uncovered(T, `(local.set $t ${NEW}) (if (local.get $p) (then (drop ${GET_T}))) ${GET_T}`),
    [],
  );
});

Deno.test('analysis: a set inside an if arm does not cover a read after the if', () => {
  assertEquals(
    uncovered(
      T,
      `(if (local.get $p) (then (local.set $t ${NEW})) (else (local.set $t ${NEW}))) ${GET_T}`,
    ),
    [1],
  );
  // …but covers a read inside the same arm.
  assertEquals(
    uncovered(T, `(if (local.get $p) (then (local.set $t ${NEW}) (drop ${GET_T}))) (i32.const 0)`),
    [],
  );
});

Deno.test('analysis: a set inside a block or loop ends with it', () => {
  assertEquals(uncovered(T, `(block (local.set $t ${NEW})) ${GET_T}`), [1]);
  assertEquals(uncovered(T, `(loop (local.set $t ${NEW})) ${GET_T}`), [1]);
  assertEquals(uncovered(T, `(block (local.set $t ${NEW}) (drop ${GET_T})) (i32.const 0)`), []);
});

Deno.test('analysis: a tee covers the reads that follow it, not the ones inside its value', () => {
  assertEquals(uncovered(T, `(i32.add (struct.get $S 0 (local.tee $t ${NEW})) ${GET_T})`), []);
  assertEquals(uncovered(T, `(local.set $t (struct.new $S ${GET_T})) (i32.const 0)`), [1]);
});

Deno.test("analysis: a branch's values are evaluated before its condition", () => {
  // The shared walker visits the condition first; wasm evaluates the value first,
  // so this read precedes the tee and is NOT covered.
  assertEquals(
    uncovered(
      T,
      `(block $b (result (ref $S))
         (br_if $b (local.get $t) (ref.is_null (local.tee $t ${NEW})))
         (drop) ${NEW}) (drop) (i32.const 0)`,
    ),
    [1],
  );
});

Deno.test('analysis: params and nullable locals are never flagged', () => {
  assertEquals(
    uncovered(
      '(local $n (ref null $S))',
      '(block (local.set $n (ref.null $S))) (drop (local.get $n)) (i32.const 0)',
    ),
    [],
  );
});

Deno.test('fixup: a function with nothing uncovered is left as the same objects', () => {
  const mod = parseWasm(
    assemble(`(module ${S} (func (result i32) ${T} (local.set $t ${NEW}) ${GET_T}))`),
  );
  const fn = mod.functions[0]!;
  const [body, locals] = [fn.body, fn.locals];
  handleNonDefaultableLocals(fn);
  assert(fn.body === body && fn.locals === locals);
});

const FLATTEN_IF = `(module ${S}
  (func (export "f") (param i32) (result i32)
    (struct.get $S 0 (if (result (ref $S)) (local.get 0)
      (then (struct.new $S (i32.const 10))) (else (struct.new $S (i32.const 20)))))))`;

Deno.test('Flatten on an if typed (ref $S) leaves a valid module that computes the same', () => {
  const bytes = assemble(FLATTEN_IF);
  const mod = parseWasm(bytes);
  new PassRunner(mod).add('Flatten').run();
  const out = encodeWasm(mod);
  assertValid(out);
  assertEquals(run(out, [0, 1]), run(bytes, [0, 1]));
});

Deno.test('PassRunner runs the fixup after a pass that declares it, and only then', () => {
  // A module whose read is uncovered on the way IN; a pass that does nothing
  // isolates what the runner itself does with the flag.
  const wat = `(module ${S}
    (func (export "f") (param i32) (result i32) ${T}
      (if (local.get 0) (then (local.set $t ${NEW})) (else (local.set $t ${NEW})))
      ${GET_T}))`;
  const nothing = (requiresNonNullableLocalFixups: boolean) => ({
    name: 'Nothing',
    description: 'does nothing',
    requiresNonNullableLocalFixups,
    run() {},
  });
  const withFlag = parseWasm(assemble(wat));
  new PassRunner(withFlag).addPass(nothing(true)).run();
  assertValid(encodeWasm(withFlag));
  assertEquals(run(encodeWasm(withFlag), [0, 1]), [1, 1]);

  const withoutFlag = parseWasm(assemble(wat));
  new PassRunner(withoutFlag).addPass(nothing(false)).run();
  assertEquals(uncoveredNonNullableLocals(withoutFlag.functions[0]!).size, 1);
});
