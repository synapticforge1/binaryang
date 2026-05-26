// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Regression tests for WAT folded-form parsing.
 *
 * Folded form is `( opcode immediate-args folded-sub-expr* )`. Until this
 * commit the parser ran the sub-expression loop before consuming the
 * immediates, so any opcode that takes a Var/index argument (`local.set`,
 * `global.set`, `call`, etc.) silently dropped its operand subexpression as
 * an unexpected `(`. wasmtk reported the issue: 100% of its 270 test inputs
 * use folded `(local.set $x (global.get $y))` patterns and all of them
 * failed. The fix:
 *
 *   - `parseFoldedInstr` now consumes immediates first (via a dry-run
 *     `buildPlainExpr` with empty operands), then loops over `(`-prefixed
 *     sub-expressions, then re-invokes `buildPlainExpr` with the real
 *     operands after rewinding past the immediates.
 *   - `parseFuncModuleField` populates `this.localScope` with the
 *     function's params + named locals; `local.get / set / tee` resolve
 *     `$name` references through it at parse time so the produced IR
 *     carries index-vars (not name-vars) for locals.
 */

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { LexerSource } from '../../src/parser/lexer-source.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { resolveNames } from '../../src/ir/resolve-names.ts';
import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { validateModule } from '../../src/validator/validator.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';
import { Result } from '../../src/core/result.ts';
import { bridgeToBinaryen } from '../../src/bridge/binaryen-bridge.ts';
import { encodeWasm } from '@jrmarcum/binaryen-ts/encoder';

function parseClean(wat: string): { module: ReturnType<typeof parseWatModule>['module'] } {
  const { module, errors } = parseWatModule(new LexerSource(wat, '<folded>'));
  if (hasErrors(errors)) throw new Error(`Parse:\n${formatErrors(errors)}`);
  return { module };
}

/** Full pipeline: parse → resolveNames → bridge → encode → decode → validate. */
function endToEnd(wat: string): void {
  const { module } = parseClean(wat);
  resolveNames(module, makeErrorList());
  const wasm = encodeWasm(bridgeToBinaryen(module));
  const errs = makeErrorList();
  const decoded = readBinaryIr(wasm, errs);
  if (hasErrors(errs)) throw new Error(`Decode:\n${formatErrors(errs)}`);
  const r = validateModule(decoded, errs);
  if (hasErrors(errs)) throw new Error(`Validate:\n${formatErrors(errs)}`);
  assertEquals(r, Result.Ok);
}

describe('WAT folded-form parsing — regression tests', () => {
  it('wasmtk repro: (local.set $ptr (global.get $heap))', () => {
    // Minimal reproduction of the 1.0.3 blocker wasmtk reported.
    const { module } = parseClean(`(module
      (global $heap (mut i32) (i32.const 0))
      (func $f (param $ptr i32)
        (local.set $ptr (global.get $heap))))`);
    const body = module.funcs[0]!.body;
    assertEquals(body.length, 1, 'one statement in the body');
    const stmt = body[0]!;
    assert(stmt.kind === 'local.set', 'top-level is local.set');
    const ls = stmt as Extract<typeof stmt, { kind: 'local.set' }>;
    // Param $ptr resolved to slot 0.
    assertEquals(ls.var, { kind: 'index', value: 0 });
    // The value sub-expression was parsed correctly.
    assertEquals(ls.value.kind, 'global.get');
  });

  it('binary op with two folded operands: (i32.add (local.get $a) (local.get $b))', () => {
    endToEnd(`(module
      (func $add (param $a i32) (param $b i32) (result i32)
        (i32.add (local.get $a) (local.get $b)))
      (export "add" (func $add)))`);
  });

  it('folded store with folded address and folded value', () => {
    endToEnd(`(module
      (memory 1)
      (func $st (param $ptr i32) (param $v i32)
        (i32.store (local.get $ptr) (local.get $v))))`);
  });

  it('heap-allocator pattern (wasmtk style)', () => {
    endToEnd(`(module
      (memory 1)
      (global $heap (mut i32) (i32.const 1024))
      (func $alloc (param $size i32) (result i32)
        (local $p i32)
        (local.set $p (global.get $heap))
        (global.set $heap (i32.add (global.get $heap) (local.get $size)))
        (local.get $p))
      (export "alloc" (func $alloc)))`);
  });

  it('folded if/else with a folded condition expression', () => {
    endToEnd(`(module
      (func $abs (param $x i32) (result i32)
        (if (result i32) (i32.lt_s (local.get $x) (i32.const 0))
          (then (i32.sub (i32.const 0) (local.get $x)))
          (else (local.get $x)))))`);
  });

  it('folded call with multiple operands', () => {
    endToEnd(`(module
      (func $add (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
      (func $two (result i32)
        (call $add (i32.const 1) (i32.const 1)))
      (export "two" (func $two)))`);
  });

  it('local names with `$` prefix bind correctly for both params and locals', () => {
    const { module } = parseClean(`(module
      (func (param $a i32) (param $b i32)
        (local $tmp i32) (local $other i32)
        (local.set $tmp (local.get $b))
        (local.set $other (local.get $a))))`);
    const body = module.funcs[0]!.body;
    // First stmt: local.set $tmp (slot 2) from local.get $b (slot 1)
    const stmt0 = body[0] as Extract<(typeof body)[number], { kind: 'local.set' }>;
    assertEquals(stmt0.var, { kind: 'index', value: 2 });
    assertEquals((stmt0.value as Extract<typeof stmt0.value, { kind: 'local.get' }>).var, {
      kind: 'index',
      value: 1,
    });
    // Second stmt: local.set $other (slot 3) from local.get $a (slot 0)
    const stmt1 = body[1] as Extract<(typeof body)[number], { kind: 'local.set' }>;
    assertEquals(stmt1.var, { kind: 'index', value: 3 });
    assertEquals((stmt1.value as Extract<typeof stmt1.value, { kind: 'local.get' }>).var, {
      kind: 'index',
      value: 0,
    });
  });
});
