// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The behaviour gate (`bun run direct-behaviour`) must SEE the three things it was blind to
// (security review round 4, R2 fidelity), each shown by PLANTING the defect in the optimizer's
// output tree and requiring a DIVERGE:
//
//   - the sign of a zero (`-0` was compared equal to `+0`: `String(-0)` is "0");
//   - a call to an import dropped or reordered (imports were silent stand-ins);
//   - a level other than -O3 (a pass only -O1, -O4, -Os or -Oz runs went unseen).
//
// Each planted defect is ALSO the inversion of the check: with the comparison reverted to what it
// was (return values spelled by `String`, no import log, -O3 only) the same plant reads `agree`.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { check, show } from '../../../scripts/direct-behaviour/differential.ts';
import { PROBES } from '../../../scripts/direct-behaviour/probes.ts';
import { ExpressionKind, makeF64ConstBits, makeNop } from '../../../src/ir/expressions.ts';
import type { Expression } from '../../../src/ir/expressions.ts';
import { mapExpression } from '../../../src/ir/walk.ts';
import type { WasmModule } from '../../../src/ir/module.ts';
import { ValType } from '../../../src/ir/types.ts';
import { Opcode } from '../../../src/core/opcode.ts';

const probe = (name: string) => PROBES.find((p) => p.name === `probe#${name}`)!.wat;

/** Rewrites every function body of `m` with `fn`. */
function rewrite(m: WasmModule, fn: (e: Expression) => Expression): void {
  for (const f of m.functions) f.body = mapExpression(f.body, fn);
}

const NEG_ZERO = 0x8000000000000000n;

describe('the behaviour comparison sees what it was blind to', () => {
  it('every probe agrees with no planted defect, at every level', () => {
    for (const p of PROBES) {
      const row = check(p.name, p.wat);
      expect(row.detail).toBe('');
      expect(row.status).toBe('agree');
      expect(row.calls).toBeGreaterThan(0);
    }
  });

  it('spells -0 and +0 apart, and every NaN alike', () => {
    expect(show(ValType.F64, -0)).not.toBe(show(ValType.F64, 0));
    expect(show(ValType.F32, -0)).not.toBe(show(ValType.F32, 0));
    expect(show(ValType.F64, NaN)).toBe(show(ValType.F64, -NaN));
    expect(show(ValType.I32, 5)).toBe('5');
    expect(show(ValType.I64, 5n)).toBe('5n');
  });

  it('a fold that makes -0 into +0 DIVERGEs, at every level', () => {
    const row = check('negzero', probe('negative-zero'), {
      afterPasses: (_l, m) =>
        rewrite(m, (e) =>
          e.kind === ExpressionKind.Const && e.value.type === ValType.F64 &&
            e.value.bits === NEG_ZERO
            ? makeF64ConstBits(0n)
            : e),
    });
    expect(row.status).toBe('DIVERGE');
    // Every level reports it (the module's text holds a `-0` constant at -O0 too).
    for (const tag of ['-O0', '-O1', '-O2', '-O3', '-O4', '-Os', '-Oz']) {
      expect(row.detail).toContain(`${tag}:`);
    }
  });

  it('x + 0 -> x (wrong for x = -0) DIVERGEs', () => {
    const row = check('add0', probe('preserved-zero-sign'), {
      afterPasses: (_l, m) =>
        rewrite(m, (e) =>
          e.kind === ExpressionKind.Binary && e.opcode === Opcode.F64Add &&
            e.right.kind === ExpressionKind.Const
            ? e.left
            : e),
    });
    expect(row.status).toBe('DIVERGE');
    expect(row.detail).toContain('add0');
  });

  it('a dropped call to an import DIVERGEs, though no value it returns is used', () => {
    const row = check('dropped', probe('import-calls'), {
      afterPasses: (_l, m) =>
        rewrite(
          m,
          (e) =>
            e.kind === ExpressionKind.Call && e.operands[0]?.kind === ExpressionKind.Const &&
              e.operands[0].value.type === ValType.I32 && e.operands[0].value.value === 1
              ? makeNop()
              : e,
        ),
    });
    expect(row.status).toBe('DIVERGE');
    expect(row.detail).toContain('env.log');
  });

  it('two import calls swapped DIVERGE, though their sum is the same', () => {
    const row = check('order', probe('import-calls'), {
      afterPasses: (_l, m) =>
        rewrite(m, (e) =>
          e.kind === ExpressionKind.Binary && e.opcode === Opcode.I32Add &&
            e.left.kind === ExpressionKind.Call && e.right.kind === ExpressionKind.Call
            ? { ...e, left: e.right, right: e.left }
            : e),
    });
    expect(row.status).toBe('DIVERGE');
    expect(row.detail).toContain('sum');
  });
});
