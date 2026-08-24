// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Regression tests for the legacy exception-handling `(try (do …) (catch
 * $tag …) (catch_all …) (delegate …))` proposal.
 *
 * Bug (reported against v1.2.8): the WAT parser coerced legacy `(try …)`
 * into a plain `block`, merging the catch handler instructions into the
 * body and dropping the try/catch dispatch edges. The emitted binary had
 * the handler's leading `local.set`s running on an empty operand stack —
 * V8 rejected it ("not enough arguments on the stack for local.set"). The
 * fix makes the parser emit a real `TryExpr` (body + catch handlers +
 * optional delegate), which the binary writer already knew how to encode.
 *
 * A second latent bug surfaced once a TryExpr with catch bodies finally
 * reached the WAT writer: `writeCatch` wrote the handler body AND the
 * ExprVisitor's `try` case walked it again, duplicating every handler
 * instruction in wasm2wat output. Fixed by dropping the body walk from
 * writeCatch.
 *
 * wasic emits this shape for every TypeScript try/catch/throw, so the bug
 * blocked the entire wasmtk Phase 15 exception-handling suite.
 */

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { validateModule } from '../../src/validator/validator.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';
import { Result } from '../../src/core/result.ts';
import type { Expr, Func, TryExpr } from '../../src/ir/ir.ts';

function definedFuncs(wat: string): Func[] {
  const { module, errors } = parseWatModule(wat);
  if (hasErrors(errors)) throw new Error(`parse:\n${formatErrors(errors)}`);
  return module.funcs.slice(module.numFuncImports);
}

function findTry(body: Expr[]): TryExpr {
  const t = body.find((e) => e.kind === 'try');
  assert(t !== undefined, 'expected a TryExpr in the function body');
  return t as TryExpr;
}

/** wat2wasm → decode → validate; throws on any error. Returns the binary. */
function compileAndValidate(wat: string): Uint8Array {
  const { binary, errors, result } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error(`wat2wasm:\n${formatErrors(errors)}`);
  assertEquals(result, Result.Ok, 'wat2wasm returned Result.Ok');

  const decodeErrs = makeErrorList();
  const decoded = readBinaryIr(binary, decodeErrs);
  if (hasErrors(decodeErrs)) throw new Error(`decode:\n${formatErrors(decodeErrs)}`);

  const valErrs = makeErrorList();
  const r = validateModule(decoded, valErrs, { features: allFeatures() });
  if (hasErrors(valErrs)) throw new Error(`validate:\n${formatErrors(valErrs)}`);
  assertEquals(r, Result.Ok, 'validateModule returned Result.Ok');
  return binary;
}

async function compileWithV8(binary: Uint8Array): Promise<WebAssembly.Module> {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return await WebAssembly.compile(buf);
}

describe('legacy try/catch — parser produces a real TryExpr', () => {
  it('folded form: body + tag-typed catch (the minimal bug reproducer)', () => {
    const [f] = definedFuncs(`(module
      (memory 1)
      (tag $exn (param i32 i32))
      (func (export "f") (param $a i32) (param $b i32) (result i32)
        (local $result i32) (local $e_ptr i32) (local $e_len i32)
        (local.set $result (i32.const -1))
        (try
          (do (local.set $result (i32.div_s (local.get $a) (local.get $b))))
          (catch $exn
            (local.set $e_len)
            (local.set $e_ptr)
            (i32.store (i32.const 0) (local.get $e_ptr))))
        (return (local.get $result))))`);
    const t = findTry(f!.body);
    assertEquals(t.kind, 'try');
    assertEquals(t.body.length, 1, 'do-body has the single local.set');
    assertEquals(t.catches.length, 1, 'one catch clause');
    assert(t.catches[0]!.tag !== undefined, 'catch is tag-typed');
    assertEquals(t.delegate, undefined);
  });

  it('linear form: body, catch, end', () => {
    const [f] = definedFuncs(`(module
      (tag $exn (param i32))
      (func (export "g") (result i32)
        (local $c i32)
        try
          i32.const 7
          throw $exn
        catch $exn
          local.set $c
        end
        local.get $c))`);
    const t = findTry(f!.body);
    assertEquals(t.catches.length, 1);
    assert(t.catches[0]!.tag !== undefined);
  });

  it('catch_all form has a tag-less catch clause', () => {
    const [f] = definedFuncs(`(module
      (tag $exn)
      (func (export "h")
        (try
          (do (throw $exn))
          (catch_all (nop)))))`);
    const t = findTry(f!.body);
    assertEquals(t.catches.length, 1);
    assertEquals(t.catches[0]!.tag, undefined, 'catch_all carries no tag');
  });

  it('delegate form records the delegate target and no catches', () => {
    const [outer] = definedFuncs(`(module
      (tag $exn)
      (func (export "d")
        (block $b
          (try
            (do (throw $exn))
            (delegate 0)))))`);
    // The try is nested inside the block.
    const block = outer!.body.find((e) => e.kind === 'block') as Expr & { body: Expr[] };
    const t = findTry(block.body);
    assertEquals(t.catches.length, 0);
    assert(t.delegate !== undefined, 'delegate target recorded');
  });

  it('multiple catch clauses are all preserved', () => {
    const [f] = definedFuncs(`(module
      (tag $a (param i32))
      (tag $b (param i32))
      (func (export "m")
        (try
          (do (throw $a (i32.const 1)))
          (catch $a (drop))
          (catch $b (drop))
          (catch_all (nop)))))`);
    const t = findTry(f!.body);
    assertEquals(t.catches.length, 3);
    assert(t.catches[0]!.tag !== undefined);
    assert(t.catches[1]!.tag !== undefined);
    assertEquals(t.catches[2]!.tag, undefined);
  });
});

describe('legacy try/catch — encodes to a binary V8 accepts', () => {
  it('compiles + validates the minimal div/catch module', () => {
    compileAndValidate(`(module
      (memory 1)
      (tag $exn (param i32 i32))
      (func (export "f") (param $a i32) (param $b i32) (result i32)
        (local $result i32) (local $e_ptr i32) (local $e_len i32)
        (local.set $result (i32.const -1))
        (try
          (do (local.set $result (i32.div_s (local.get $a) (local.get $b))))
          (catch $exn
            (local.set $e_len)
            (local.set $e_ptr)
            (i32.store (i32.const 0) (local.get $e_ptr))))
        (return (local.get $result))))`);
  });

  it('throw + catch delivers the tag arg to the handler (V8 runtime check)', async () => {
    const binary = compileAndValidate(`(module
      (tag $exn (param i32))
      (func (export "g") (result i32)
        (local $caught i32)
        (try
          (do (throw $exn (i32.const 42)))
          (catch $exn (local.set $caught)))
        (local.get $caught)))`);
    const mod = await compileWithV8(binary);
    const inst = await WebAssembly.instantiate(mod, {});
    const g = (inst.exports as { g: () => number }).g;
    assertEquals(g(), 42, 'caught the thrown tag arg into the local');
  });

  it('rethrow re-raises out of a catch to an outer handler (V8 runtime check)', async () => {
    // Inner try catches $a and rethrows; outer try's catch_all observes it.
    const binary = compileAndValidate(`(module
      (tag $a)
      (func (export "g") (result i32)
        (local $outer i32)
        (try $t
          (do
            (try
              (do (throw $a))
              (catch $a (rethrow 0))))
          (catch_all (local.set $outer (i32.const 7))))
        (local.get $outer)))`);
    const mod = await compileWithV8(binary);
    const inst = await WebAssembly.instantiate(mod, {});
    const g = (inst.exports as { g: () => number }).g;
    assertEquals(g(), 7, 'rethrow reached the outer catch_all');
  });

  it('catch_all catches a thrown exception (V8 runtime check)', async () => {
    const binary = compileAndValidate(`(module
      (tag $exn (param i32))
      (func (export "g") (result i32)
        (local $hit i32)
        (try
          (do (throw $exn (i32.const 1)))
          (catch_all (local.set $hit (i32.const 99))))
        (local.get $hit)))`);
    const mod = await compileWithV8(binary);
    const inst = await WebAssembly.instantiate(mod, {});
    const g = (inst.exports as { g: () => number }).g;
    assertEquals(g(), 99, 'catch_all handler ran');
  });
});

describe('legacy try/catch — wasm2wat round-trip does not duplicate handlers', () => {
  it('each handler instruction appears exactly once after round-trip', () => {
    const binary = compileAndValidate(`(module
      (tag $exn (param i32 i32))
      (func (export "f") (param $a i32) (result i32)
        (local $x i32) (local $y i32)
        (try
          (do (local.set $x (local.get $a)))
          (catch $exn
            (local.set $y)
            (local.set $x)))
        (local.get $x)))`);
    const { text, errors } = wasm2wat(binary);
    if (hasErrors(errors)) throw new Error(`wasm2wat:\n${formatErrors(errors)}`);
    // The handler has exactly two `local.set` instructions. Before the
    // writeCatch fix they were emitted twice (four total).
    const catchIdx = text.indexOf('catch');
    const endIdx = text.indexOf('end', catchIdx);
    const handler = text.slice(catchIdx, endIdx);
    const setCount = (handler.match(/local\.set/g) ?? []).length;
    assertEquals(setCount, 2, 'handler local.set emitted once each, not duplicated');
  });
});
