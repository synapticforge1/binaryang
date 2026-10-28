// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 52 (c), 2026-10-28: MergeLocals, SSANoMerge and StackIR caught EVERY exception and
// skipped the function, so a real bug in them showed only as lost size, and a broken label an
// earlier pass left behind surfaced only at the writer ("undefined label"). They fail loudly now,
// as CoalesceLocals — which reads the same CFG — always did. The corpus (421 modules x 5 levels)
// is unchanged by this: the catches never fired on valid input (-Oz 811,071 bytes, as before).

import { describe, it } from 'node:test';
import { assert, assertThrows } from '@std/assert';

import { readWat } from '../../../src/tools/read-wat.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { stackOmissions } from '../../../src/passes/stack-ir.ts';
import { makeBreak } from '../../../src/ir/expressions.ts';

/** A function whose body branches to a label nothing declares — what a buggy pass could leave. */
function broken() {
  const m = readWat(
    '(module (func (param i32) (result i32) (local i32) (local.set 1 (local.get 0)) (local.get 1)))',
  );
  const fn = m.functions[0]!;
  fn.body.children.unshift(makeBreak('$nowhere', null, []));
  return m;
}

describe('open-work 52 — passes that read the CFG fail loudly, not quietly', () => {
  for (const pass of ['MergeLocals', 'SSANoMerge', 'CoalesceLocals']) {
    it(`${pass} throws on an unresolvable branch`, () => {
      const m = broken();
      assertThrows(
        () => new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).add(pass).run(),
        Error,
        'cfg: branch to "$nowhere"',
      );
    });
  }

  it('StackIR’s analysis throws too', () => {
    const m = broken();
    assertThrows(() => stackOmissions(m.functions[0]!), Error, 'cfg:');
  });

  it('a valid function still goes through all four', () => {
    const m = readWat(
      '(module (func (param i32) (result i32) (local i32) (local.set 1 (local.get 0)) (local.get 1)))',
    );
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 })
      .add('MergeLocals').add('SSANoMerge').add('CoalesceLocals').run();
    assert(stackOmissions(m.functions[0]!) instanceof Set);
  });
});
