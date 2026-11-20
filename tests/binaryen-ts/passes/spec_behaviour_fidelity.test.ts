// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// `bun run spec-behaviour` replays the spec suite's invocations on the original and on every
// level. Security review round 4 (R2 fidelity) found it blind to two things, each shown here by
// PLANTING the defect in one level's output tree and requiring a DIVERGE:
//
//   - a call to an import dropped (the imports were silent stand-ins: no value showed it);
//   - a level the CLI offers but it never ran (-O4).
//
// (It already spelled a float by its bits, so -0 and +0 differ: the last test holds that.)
// Inverting each check — no import log, -O4 left out of LEVELS, floats by `String` — makes the
// matching test fail.

import { after as afterAll, before as beforeAll, describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@std/expect';
import { check, LEVELS, type SpecInput } from '../../../scripts/spec-behaviour/differential.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { ExpressionKind, makeF64ConstBits, makeNop } from '../../../src/ir/expressions.ts';
import type { Expression } from '../../../src/ir/expressions.ts';
import type { WasmModule } from '../../../src/ir/module.ts';
import { mapExpression } from '../../../src/ir/walk.ts';
import { ValType } from '../../../src/ir/types.ts';

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'binaryang-specfid-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A one-module input whose invocations call each export once. */
function input(name: string, wat: string, fields: string[]): SpecInput {
  const path = join(dir, `${name}.wasm`);
  writeFileSync(path, wat2wasm(wat).binary);
  return { name, path, invokes: fields.map((field, i) => ({ line: i + 1, field, args: [] })) };
}

function rewrite(m: WasmModule, fn: (e: Expression) => Expression): void {
  for (const f of m.functions) f.body = mapExpression(f.body, fn);
}

const IMPORTS = `(module
  (import "env" "log" (func $log (param i32)))
  (func (export "f") (result i32) (call $log (i32.const 1)) (call $log (i32.const 2)) (i32.const 0)))`;

describe('spec-behaviour sees what it was blind to', () => {
  it('agrees when nothing is planted', () => {
    const row = check(input('plain', IMPORTS, ['f']));
    expect(row.detail).toEqual([]);
    expect(row.status).toBe('agree');
  });

  it('a dropped call to an import DIVERGEs at the level that dropped it', () => {
    const row = check(input('dropped', IMPORTS, ['f']), {
      afterPasses: (level, m) =>
        level === '-O2'
          ? rewrite(
            m,
            (e) =>
              e.kind === ExpressionKind.Call && e.operands[0]?.kind === ExpressionKind.Const &&
                e.operands[0].value.type === ValType.I32 && e.operands[0].value.value === 1
                ? makeNop()
                : e,
          )
          : undefined,
    });
    expect(row.status).toBe('DIVERGE');
    expect(row.detail.join('\n')).toContain('-O2');
    expect(row.detail.join('\n')).toContain('env.log');
  });

  it('runs -O4: a defect only -O4 plants is seen', () => {
    expect(LEVELS.map((l) => l[0])).toContain('-O4');
    const row = check(input('o4', IMPORTS, ['f']), {
      afterPasses: (level, m) =>
        level === '-O4'
          ? rewrite(m, (e) => e.kind === ExpressionKind.Call ? makeNop() : e)
          : undefined,
    });
    expect(row.status).toBe('DIVERGE');
    expect(row.detail.join('\n')).toContain('-O4');
  });

  it('a -0 made +0 DIVERGEs: floats are compared by bits', () => {
    const row = check(
      input('negzero', '(module (func (export "f") (result f64) (f64.const -0)))', ['f']),
      {
        afterPasses: (_l, m) =>
          rewrite(m, (e) =>
            e.kind === ExpressionKind.Const && e.value.type === ValType.F64 &&
              e.value.bits === 0x8000000000000000n
              ? makeF64ConstBits(0n)
              : e),
      },
    );
    expect(row.status).toBe('DIVERGE');
  });
});
