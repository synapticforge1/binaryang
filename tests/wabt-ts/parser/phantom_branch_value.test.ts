// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Regression (found by M8d, 2026-09-18): in LINEAR text a `br_if` or a
// `br_on_null` / `br_on_non_null` with no carried value got a phantom one.
//
// The linear form pads a short stack with the operand placeholder, and both
// dropped that padding by checking `kind !== 'nop'` — the placeholder WAS a nop
// until S5 (`f27bfd5ca`) made it a `pop`. From then on the padding stayed, as a
// carried value. A `pop` is written as nothing, so the bytes never changed and
// no byte gate could see it; the TREE was wrong, and a value-less `br_if` was
// typed by its phantom value instead of `none`.
//
// `br_table` has the same stale filter, but in linear text its arity is 1 (the
// index), so it never pads: a value below the index stays a loose sibling, and
// no input reaches the filter with a placeholder. It is left alone.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';

/** The first node of `kind` in function 0's body. */
// deno-lint-ignore no-explicit-any
function first(wat: string, kind: string): any {
  const p = parseWatModule(wat);
  assert(p.module, 'the module parses');
  // deno-lint-ignore no-explicit-any
  let found: any;
  const walk = (v: unknown): void => {
    if (found !== undefined || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if ((v as { kind?: unknown }).kind === kind) found = v;
    else for (const [k, x] of Object.entries(v)) if (k !== 'loc') walk(x);
  };
  walk(p.module.functions[0]!.body);
  assert(found, `a ${kind} node`);
  return found;
}

describe('linear branches carry no phantom value', () => {
  it('br_if to a void block carries nothing', () => {
    const br = first('(module (func (param i32) block local.get 0 br_if 0 end))', 'br');
    assertEquals(br.values, []);
    assertEquals(br.condition.kind, 'local.get');
  });

  it('br_on_null to a void block carries nothing', () => {
    const br = first(
      '(module (func (param externref) block local.get 0 br_on_null 0 drop end))',
      'br_on',
    );
    assertEquals(br.values, []);
    assertEquals(br.ref.kind, 'local.get');
  });

  it('a REAL carried value is kept (the filter drops padding only)', () => {
    const br = first(
      '(module (func (param i32) (result i32) block (result i32) i32.const 7 local.get 0 br_if 0 end))',
      'br',
    );
    assertEquals(br.values.map((v: { kind: string }) => v.kind), ['const']);
  });
});
