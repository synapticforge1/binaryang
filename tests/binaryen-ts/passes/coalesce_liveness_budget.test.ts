// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The liveness CoalesceLocals starts from is one Set of live locals per block start and end:
// blocks × live locals entries. 10,000 locals each read in one of 10,000 loops: 20,000 blocks of
// thousands of live locals, over 40 s and gigabytes (3,000 loops: over 100 s); upstream colours
// it in 0.1 s. The sets are now given up once they hold COALESCE_MAX_LIVENESS_CELLS entries and
// the function is left as it is (README "Limits on untrusted input").

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { buildCFG, computeLiveness } from '../../../src/passes/cfg.ts';
import { PassRunner } from '../../../src/passes/index.ts';

const rep = (n: number, f: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => f(i)).join('\n');

/** n locals, n loops: loop i sets local i from local (7 i) mod n, and branches back on the parameter. */
const loopsWat = (n: number) =>
  `(module (func (export "f") (param i32) (local ${'i32 '.repeat(n)})
  ${
    rep(
      n,
      (i) =>
        `(loop $l (local.set ${i + 1} (i32.add (local.get ${
          (i * 7) % n + 1
        }) (i32.const 1))) (br_if $l (local.get 0)))`,
    )
  }))`;

const shape = (fn: { body: unknown }) =>
  JSON.stringify(fn.body, (_k, v) => typeof v === 'bigint' ? String(v) : v);

describe('CoalesceLocals: liveness sets bounded by blocks × live locals', () => {
  it('computeLiveness gives up past its cells, finishes under them', () => {
    const fn = readForPasses(wat2wasm(loopsWat(200), { textForm: false }).binary).functions[0]!;
    expect(computeLiveness(buildCFG(fn.body, fn.bodyFrameLabel), 100)).toBe(false);
    expect(computeLiveness(buildCFG(fn.body, fn.bodyFrameLabel))).toBe(true);
  });

  it('3,000 locals in 3,000 loops: under 10 s, the function left as it is', {
    timeout: 60_000,
  }, () => {
    const m = readForPasses(wat2wasm(loopsWat(3000), { textForm: false }).binary);
    const before = shape(m.functions[0]!);
    const t = performance.now();
    new PassRunner(m, {}).add('CoalesceLocals').run();
    expect(performance.now() - t).toBeLessThan(10_000); // measured ~0.3 s; was over 100 s
    expect(shape(m.functions[0]!)).toBe(before);
  });
});
