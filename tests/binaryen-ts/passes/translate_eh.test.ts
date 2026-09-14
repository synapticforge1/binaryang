// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// TranslateToExnref (owner decision 7, 2026-09-14): legacy EH — try / catch /
// catch_all / delegate / rethrow — into try_table / throw_ref.
//
// Every fixture is assembled by wabt-ts, decoded by binaryen-ts, translated,
// encoded, and then held to four things:
//
//   1. no legacy construct survives (the bytes are re-decoded and walked);
//   2. wabt-ts's validator accepts the result — a second implementation, not the
//      encoder that wrote it;
//   3. V8 gives the SAME outcome for the legacy module and the translated one on
//      every input — a value, or an exception with its payload. V8 runs both
//      forms, so it is the one engine that can compare them directly;
//   4. each fixture's expected outcomes are also written out by hand, so a shared
//      misreading of legacy EH in V8 and in the pass cannot pass as agreement.
//
// Wasmtime, the engine this pass exists for, runs the translated bytes where it
// is installed. It is not in CI, so that half is on availability; the legacy spec
// testsuite gate (`scripts/check-translate-eh.ts`) is the broader check.

import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';

/** A call's outcome: a returned value, or an exception carrying tag `e`'s first payload value. */
type Outcome = { value: number | bigint } | { thrown: number | bigint | 'other' } | { trap: true };

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  assert(!hasErrors(r.errors), `wat2wasm:\n${formatErrors(r.errors)}`);
  return r.binary;
}

function translate(legacy: Uint8Array, optimize = false): Uint8Array {
  const mod = parseWasm(legacy);
  new PassRunner(mod).add('TranslateToExnref').run();
  if (optimize) {
    new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 }).addDefaultOptimizationPasses().run();
  }
  return encodeWasm(mod);
}

function assertNoLegacy(bytes: Uint8Array): void {
  for (const fn of parseWasm(bytes).functions) {
    walkExpression(fn.body, (e) => {
      assert(
        e.kind !== ExpressionKind.Try && e.kind !== ExpressionKind.Rethrow,
        `a ${e.kind} survived in ${fn.name}`,
      );
    });
  }
}

function assertValid(bytes: Uint8Array): void {
  const errs = makeErrorList();
  const m = readBinaryIr(bytes, errs);
  assert(!hasErrors(errs), `decode:\n${formatErrors(errs)}`);
  validateModule(m, errs, { features: allFeatures() });
  assert(!hasErrors(errs), `validate:\n${formatErrors(errs)}`);
}

function outcomes(bytes: Uint8Array, inputs: number[], fn = 'f'): Outcome[] {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource));
  const f = inst.exports[fn] as (x: number) => number | bigint;
  // deno-lint-ignore no-explicit-any
  const W = WebAssembly as any;
  const tag = inst.exports.e;
  return inputs.map((x): Outcome => {
    try {
      return { value: f(x) };
    } catch (err) {
      if (err instanceof W.Exception) {
        // deno-lint-ignore no-explicit-any
        const exn = err as any;
        return { thrown: tag && exn.is(tag) ? exn.getArg(tag, 0) : 'other' };
      }
      if (err instanceof WebAssembly.RuntimeError) return { trap: true };
      throw err;
    }
  });
}

let wasmtimeChecked: boolean | undefined;
async function haveWasmtime(): Promise<boolean> {
  if (wasmtimeChecked === undefined) {
    try {
      const p = new Deno.Command('wasmtime', {
        args: ['--version'],
        stdout: 'null',
        stderr: 'null',
      });
      wasmtimeChecked = (await p.output()).success;
    } catch {
      wasmtimeChecked = false;
    }
  }
  return wasmtimeChecked;
}

/** Wasmtime's outcome for the inputs whose V8 outcome is a plain value. */
async function assertWasmtimeAgrees(
  bytes: Uint8Array,
  inputs: number[],
  want: Outcome[],
  fn: string,
) {
  if (!(await haveWasmtime())) return;
  const file = await Deno.makeTempFile({ suffix: '.wasm' });
  try {
    await Deno.writeFile(file, bytes);
    for (const [i, x] of inputs.entries()) {
      const o = await new Deno.Command('wasmtime', {
        args: ['run', '-W', 'exceptions=y', '--invoke', fn, file, String(x)],
        stdout: 'piped',
        stderr: 'piped',
      }).output();
      const w = want[i]!;
      if ('value' in w) {
        assert(o.success, `wasmtime ${fn}(${x}): ${new TextDecoder().decode(o.stderr)}`);
        assertEquals(
          new TextDecoder().decode(o.stdout).trim(),
          String(w.value),
          `wasmtime ${fn}(${x})`,
        );
      } else {
        assert(!o.success, `wasmtime ${fn}(${x}) returned, V8 said ${JSON.stringify(w)}`);
      }
    }
  } finally {
    await Deno.remove(file);
  }
}

interface Fixture {
  name: string;
  wat: string;
  inputs: number[];
  expect: Outcome[];
  fn?: string;
}

const v = (value: number | bigint): Outcome => ({ value });
const thrown = (payload: number | bigint): Outcome => ({ thrown: payload });

const FIXTURES: Fixture[] = [
  {
    name: 'catch a tag payload (the value is the pop)',
    wat: `(module (tag $e (param i32))
      (func (export "f") (param i32) (result i32)
        (try (result i32)
          (do (if (local.get 0) (then (throw $e (i32.add (local.get 0) (i32.const 1)))))
              (i32.const 7))
          (catch $e))))`,
    inputs: [0, 4],
    expect: [v(7), v(5)],
  },
  {
    name: 'several catches, a multi-value tag, catch_all',
    wat: `(module (tag $a (param i32)) (tag $b (param i32 i64)) (tag $c)
      (func (export "f") (param i32) (result i32) (local $w i64)
        (try (result i32)
          (do (if (i32.eq (local.get 0) (i32.const 1)) (then (throw $a (i32.const 5))))
              (if (i32.eq (local.get 0) (i32.const 2)) (then (throw $b (i32.const 3) (i64.const 40))))
              (if (i32.eq (local.get 0) (i32.const 3)) (then (throw $c)))
              (i32.const 1))
          (catch $a (i32.add (i32.const 100)))
          ;; the i64 is on top: store it, widen the i32 beneath, add them back
          (catch $b (local.set $w) (i64.extend_i32_u) (local.get $w) (i64.add)
            (i64.const 1000) (i64.add) (i32.wrap_i64))
          (catch_all (i32.const 99)))))`,
    inputs: [0, 1, 2, 3],
    expect: [v(1), v(105), v(1043), v(99)],
  },
  {
    name: 'rethrow with a payload used first (catch_ref, values and exnref together)',
    wat: `(module (tag $e (export "e") (param i32))
      (func (export "f") (param i32) (result i32) (local $v i32)
        (try $t (result i32)
          (do (throw $e (local.get 0)))
          (catch $e
            (local.set $v)
            (if (i32.gt_s (local.get $v) (i32.const 10)) (then (rethrow $t)))
            (i32.mul (local.get $v) (i32.const 2))))))`,
    inputs: [3, 20],
    expect: [v(6), thrown(20)],
  },
  {
    name: 'rethrow from catch_all, caught by an outer try',
    wat: `(module (tag $e (param i32))
      (func (export "f") (param i32) (result i32)
        (try (result i32)
          (do (try $t (result i32)
                (do (throw $e (local.get 0)))
                (catch_all (rethrow $t))))
          (catch $e (i32.const 100) (i32.sub)))))`,
    inputs: [9],
    expect: [v(-91)],
  },
  {
    name: 'rethrow to an OUTER label from an inner catch (two exnref depths)',
    wat: `(module (tag $e (export "e") (param i32)) (tag $f)
      (func (export "f") (param i32) (result i32)
        (try $outer (result i32)
          (do (throw $e (local.get 0)))
          (catch $e
            (drop)
            ;; this catch stores ITS OWN exnref too (it may rethrow $inner), so a
            ;; shared local would hand rethrow $outer the $f exception instead
            (try $inner (result i32)
              (do (throw $f))
              (catch $f
                (if (i32.eq (local.get 0) (i32.const 7)) (then (rethrow $inner)))
                (if (local.get 0) (then (rethrow $outer)))
                (i32.const 1))
              (catch_all (rethrow $inner)))))))`,
    inputs: [0, 6, 7],
    expect: [v(1), thrown(6), { thrown: 'other' }],
  },
  {
    name: 'sibling rethrow-targeted trys share one exnref local',
    wat: `(module (tag $e (export "e") (param i32))
      (func (export "f") (param i32) (result i32)
        (try $a (do (if (i32.eq (local.get 0) (i32.const 1)) (then (throw $e (i32.const 11)))))
          (catch_all (rethrow $a)))
        (try $b (do (if (i32.eq (local.get 0) (i32.const 2)) (then (throw $e (i32.const 22)))))
          (catch_all (rethrow $b)))
        (i32.const 0)))`,
    inputs: [0, 1, 2],
    expect: [v(0), thrown(11), thrown(22)],
  },
  {
    name: 'delegate skips an intermediate try to reach its target',
    wat: `(module (tag $e (param i32))
      (func (export "f") (param i32) (result i32)
        (try $t (result i32)
          (do (try $mid (result i32)
                (do (try (result i32) (do (throw $e (local.get 0))) (delegate $t)))
                (catch $e (drop) (i32.const 1000))))
          (catch $e (i32.add (i32.const 1))))))`,
    inputs: [41],
    expect: [v(42)],
  },
  {
    name: 'delegate to the caller, from a function with a result and from one without',
    wat: `(module (tag $e (export "e") (param i32))
      (func $inner (param i32) (result i32)
        (try $t (result i32)
          (do (try (result i32)
                (do (if (local.get 0) (then (throw $e (local.get 0)))) (i32.const 5))
                (delegate 1)))
          (catch_all (i32.const -1))))
      (func $void (param i32)
        (try (do (if (local.get 0) (then (throw $e (i32.const 77))))) (delegate 0)))
      (func (export "f") (param i32) (result i32)
        (try (result i32)
          (do (call $void (i32.eq (local.get 0) (i32.const 2)))
              (call $inner (i32.eq (local.get 0) (i32.const 1))))
          (catch $e))))`,
    inputs: [0, 1, 2],
    expect: [v(5), v(1), v(77)],
  },
  {
    name: 'delegate naming a plain block resolves to the try around it',
    wat: `(module (tag $e (param i32))
      (func (export "f") (param i32) (result i32)
        (try (result i32)
          (do (block $b (result i32)
                (try (result i32) (do (throw $e (local.get 0))) (delegate $b))))
          (catch $e (i32.mul (i32.const 3))))))`,
    inputs: [5],
    expect: [v(15)],
  },
  {
    name: 'delegate inside a catch to its own try is not handled by that try',
    wat: `(module (tag $e (export "e") (param i32))
      (func (export "f") (param i32) (result i32)
        (try (result i32)
          (do (try $t (result i32)
                (do (throw $e (i32.const 1)))
                (catch $e (drop)
                  (try (result i32) (do (throw $e (local.get 0))) (delegate $t)))))
          (catch $e (i32.add (i32.const 500))))))`,
    inputs: [2],
    expect: [v(502)],
  },
  {
    name: 'a br to the try label from the body and from a catch',
    wat: `(module (tag $e (param i32))
      (func (export "f") (param i32) (result i32) (local $v i32)
        (try $t (result i32)
          (do (if (i32.eqz (local.get 0)) (then (br $t (i32.const 5))))
              (throw $e (local.get 0)))
          ;; an untaken br_if leaves its value, so it is dropped
          (catch $e (local.set $v)
            (drop (br_if $t (i32.const 8) (i32.eq (local.get $v) (i32.const 1))))
            (i32.const 9)))))`,
    inputs: [0, 1, 2],
    expect: [v(5), v(8), v(9)],
  },
  {
    name: 'a catch-less try, and a try that is both a delegate and a delegate target',
    wat: `(module (tag $e (export "e") (param i32))
      (func (export "f") (param i32) (result i32) (local $v i32)
        (try $outer (result i32)
          (do (try $both (result i32)
                (do (try (result i32) (do (throw $e (local.get 0))) (delegate $both)))
                (delegate $outer)))
          (catch $e (local.set $v)
            (try (result i32) (do (i32.add (local.get $v) (i32.const 1))))))))`,
    inputs: [9],
    expect: [v(10)],
  },
  {
    name: 'a multi-value try whose catch leaves both values',
    wat: `(module (tag $e (param i32 i32))
      (func (export "f") (param i32) (result i32)
        (try (result i32 i32)
          (do (if (local.get 0) (then (throw $e (local.get 0) (i32.const 10))))
              (i32.const 1) (i32.const 2))
          (catch $e)
          (catch_all (i32.const 0) (i32.const 0)))
        (i32.sub)))`,
    inputs: [0, 4],
    expect: [v(-1), v(-6)],
  },
  {
    name: 'a statement try, catches that fall through to the next instruction',
    wat: `(module (tag $e (param i32)) (tag $f)
      (func (export "f") (param i32) (result i32) (local $r i32)
        (local.set $r (i32.const 1))
        (try
          (do (if (i32.eq (local.get 0) (i32.const 1)) (then (throw $e (i32.const 30))))
              (if (i32.eq (local.get 0) (i32.const 2)) (then (throw $f))))
          (catch $e (local.set $r))
          (catch $f (local.set $r (i32.const 40))))
        (i32.add (local.get $r) (i32.const 100))))`,
    inputs: [0, 1, 2],
    expect: [v(101), v(130), v(140)],
  },
];

for (const fx of FIXTURES) {
  const fn = fx.fn ?? 'f';
  Deno.test(`TranslateToExnref: ${fx.name}`, async () => {
    const legacy = assemble(fx.wat);
    assertEquals(outcomes(legacy, fx.inputs, fn), fx.expect, 'the LEGACY module, in V8');
    const translated = translate(legacy);
    assertNoLegacy(translated);
    assertValid(translated);
    assertEquals(outcomes(translated, fx.inputs, fn), fx.expect, 'the TRANSLATED module, in V8');
    await assertWasmtimeAgrees(translated, fx.inputs, fx.expect, fn);
  });
}

Deno.test('TranslateToExnref: sibling rethrow targets reuse one exnref local', () => {
  const fx = FIXTURES.find((f) => f.name.startsWith('sibling'))!;
  const mod = parseWasm(assemble(fx.wat));
  const before = mod.functions[0]!.locals.length;
  new PassRunner(mod).add('TranslateToExnref').run();
  assertEquals(mod.functions[0]!.locals.length, before + 1);
});

Deno.test('TranslateToExnref: nested rethrow targets get one exnref local per depth', () => {
  const fx = FIXTURES.find((f) => f.name.startsWith('rethrow to an OUTER'))!;
  const mod = parseWasm(assemble(fx.wat));
  const before = mod.functions[0]!.locals.length;
  new PassRunner(mod).add('TranslateToExnref').run();
  assertEquals(mod.functions[0]!.locals.length, before + 2);
});

Deno.test('TranslateToExnref: a module with no legacy EH is left byte-identical', () => {
  const bytes = assemble(`(module (tag $e (param i32))
    (func (export "f") (param i32) (result i32)
      (block $h (result i32)
        (try_table (result i32) (catch $e $h) (throw $e (local.get 0))))))`);
  const mod = parseWasm(bytes);
  new PassRunner(mod).add('TranslateToExnref').run();
  // A pass RAN, so names follow -g (N1): the control runs a pass that does
  // nothing, so the two differ only in what TranslateToExnref did.
  const control = parseWasm(bytes);
  new PassRunner(control).addPass({
    name: 'Nothing',
    description: 'does nothing',
    requiresNonNullableLocalFixups: false,
    run() {},
  }).run();
  assertEquals(encodeWasm(mod), encodeWasm(control));
});

Deno.test('TranslateToExnref: the upstream kebab name resolves', () => {
  const mod = parseWasm(assemble(FIXTURES[0]!.wat));
  new PassRunner(mod).add('translate-to-exnref').run();
  assertNoLegacy(encodeWasm(mod));
});
