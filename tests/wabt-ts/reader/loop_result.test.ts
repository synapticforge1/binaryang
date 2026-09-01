// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A loop's blocktype means DIFFERENT THINGS at its two ends, and the reader
// conflated them:
//
//   - a BRANCH to a loop targets its START and carries its PARAMETERS;
//   - a loop reaching its END falls through and produces its RESULTS.
//
// `brTargetResultCount` gets the first right, reading `blockParamCount` for loop
// frames. The end-of-frame path then forced `rCount = 0` for loops as well, so
// `(loop (result i32) …)` was flushed as a STATEMENT instead of pushing its
// value, and whatever consumed it found an empty operand stack and took an
// `operandPlaceholder`.
//
// ⚠️ The modules still round-tripped. The WAT writer spells a placeholder by
// emitting linear form, which reassembles to the same bytes — so this was
// invisible to every byte-level check and visible only as an IR that could not
// be folded. Assert the IR SHAPE, not the bytes.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import type { Expr } from '../../../src/wabt-ts/ir/ir.ts';

const CHILD_KEYS = [
  'left',
  'right',
  'value',
  'values',
  'val1',
  'val2',
  'operand',
  'cond',
  'address',
  'ref',
  'index',
  'init',
  'length',
  'delta',
  'dest',
  'src',
  'size',
  'callee',
  'args',
  'operands',
  'body',
  'then_',
  'else_',
] as const;

/** Count synthesized operand slot-fillers in a decoded module. */
function placeholders(wat: string): number {
  const r = wat2wasm(wat, { filename: 't.wat' });
  assert(r.binary !== undefined && !hasErrors(r.errors), 'fixture must assemble');
  const m = readBinaryIr(r.binary, makeErrorList());
  let n = 0;
  const walk = (e: Expr | undefined) => {
    if (!e || typeof e !== 'object' || !('kind' in e)) return;
    if (e.kind === 'nop' && (e as { placeholder?: boolean }).placeholder) n++;
    for (const k of CHILD_KEYS) {
      const v = (e as unknown as Record<string, unknown>)[k];
      if (Array.isArray(v)) v.forEach((x) => walk(x as Expr));
      else if (v && typeof v === 'object' && 'kind' in v) walk(v as Expr);
    }
  };
  for (const fn of m.funcs) for (const e of fn.body) walk(e);
  return n;
}

describe('binary reader — a loop pushes its result', () => {
  it('a loop result consumed as an operand is not a placeholder', () => {
    assertEquals(
      placeholders(
        '(module (func (export "f") (result i32) (i32.add (loop (result i32) (i32.const 1)) (i32.const 2))))',
      ),
      0,
    );
  });

  it('a loop result assigned to a local is not a placeholder', () => {
    assertEquals(
      placeholders(
        '(module (func (export "f") (result i32) (local i32) (local.set 0 (loop (result i32) (i32.const 1))) (local.get 0)))',
      ),
      0,
    );
  });

  it('block and if were already correct — guards against a regression', () => {
    assertEquals(
      placeholders(
        '(module (func (export "f") (result i32) (i32.add (block (result i32) (i32.const 1)) (i32.const 2))))',
      ),
      0,
    );
  });

  // The other half of the blocktype's meaning must not move: a branch to a loop
  // targets its START and carries PARAMETERS, not results.
  it('a branch back to a loop still resolves', () => {
    const wat = `(module (func (export "f") (result i32)
      (local i32)
      (loop $l
        (local.set 0 (i32.add (local.get 0) (i32.const 1)))
        (br_if $l (i32.lt_s (local.get 0) (i32.const 5))))
      (local.get 0)))`;
    const r = wat2wasm(wat, { filename: 'l.wat' });
    assert(r.binary !== undefined && !hasErrors(r.errors));
    const inst = new WebAssembly.Instance(new WebAssembly.Module(r.binary as BufferSource));
    assertEquals((inst.exports.f as () => number)(), 5);
  });

  // A void loop has no result, so it must still be flushed as a statement.
  it('a void loop is still a statement', () => {
    assertEquals(
      placeholders('(module (func (export "f") (result i32) (loop $l (nop)) (i32.const 1)))'),
      0,
    );
  });
});
