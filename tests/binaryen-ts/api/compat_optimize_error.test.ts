// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Security review round 1 (2026-11-13), C10: `readBinary` decodes structure and does not
// validate, so an invalid module reached the passes, and `optimize()` threw a bare `Error`
// ("RemoveUnusedTypes: a reference to type N, which was not kept"; 22 of ~31,000 fuzz runs).
// Now, as `readForPasses` does, the VALIDATOR is asked on the failure path: an invalid input is
// an `OptimizeError` in the validator's words, the pass's error its cause; a failure the
// validator does not explain is ours, rethrown as it was.

import { describe, it } from 'node:test';
import { assert, assertEquals, assertInstanceOf, assertThrows } from '@std/assert';
import * as binaryen from '../../../src/compat/binaryen-compat.ts';
import { listPasses, registerPass } from '../../../src/passes/pass.ts';

/**
 * One type, `() -> ()`, and one exported function declared with type 5, which does not exist:
 * the shape of the fuzz finding (a type index one byte mutated).
 */
const BAD = new Uint8Array(
  [
    '00 61 73 6d 01 00 00 00', // header
    '01 04 01 60 00 00', // type section: () -> ()
    '03 02 01 05', // function section: func 0 has type 5
    '07 05 01 01 66 00 00', // export "f" = func 0
    '0a 04 01 02 00 0b', // code: an empty body
  ].join(' ').split(' ').map((x) => parseInt(x, 16)),
);

describe('C10 — a pass that stops on an invalid module is an OptimizeError', () => {
  for (
    const [name, run] of [
      ['optimize()', (m: binaryen.Module) => m.optimize()],
      ['runPasses()', (m: binaryen.Module) => m.runPasses(['RemoveUnusedTypes'])],
    ] as const
  ) {
    it(`${name}: the validator's diagnostics, the pass's error as the cause`, () => {
      const e = assertThrows(() => run(binaryen.readBinary(BAD)));
      assertInstanceOf(e, binaryen.OptimizeError);
      assertEquals(e.name, 'OptimizeError');
      assert(e.message.startsWith(`${name}: the module readBinary read is not valid`), e.message);
      assert(e.message.includes('function type variable out of range: 5'), e.message);
      assertInstanceOf(e.cause, Error);
      assert((e.cause as Error).message.includes('RemoveUnusedTypes'));
    });
  }

  it('judges the bytes readBinary was given, though the caller changes them after', () => {
    const bytes = BAD.slice();
    const m = binaryen.readBinary(bytes);
    bytes[17] = 0; // now VALID bytes: judged by these, the failure would be called ours
    assertInstanceOf(assertThrows(() => m.optimize()), binaryen.OptimizeError);
  });

  it('a valid module optimizes as before', () => {
    const ok = BAD.slice();
    ok[17] = 0; // func 0 has type 0
    const m = binaryen.readBinary(ok);
    m.optimize();
    assert(m.emitBinary().length > 8);
  });

  it('a pass that fails on a VALID module is ours: rethrown as it was, not blamed on the input', () => {
    // Registered once per process; a second test file loading this one would find it there.
    if (!listPasses().includes('C10TestThrows')) {
      registerPass(
        class {
          readonly name = 'C10TestThrows';
          readonly description = 'throws, for a test';
          readonly requiresNonNullableLocalFixups = false;
          run(): void {
            throw new RangeError('a defect of ours');
          }
        },
      );
    }
    const ok = BAD.slice();
    ok[17] = 0;
    const e = assertThrows(() => binaryen.readBinary(ok).runPasses(['C10TestThrows']));
    assert(!(e instanceof binaryen.OptimizeError), String(e));
    assertInstanceOf(e, RangeError);
    assertEquals(e.message, 'a defect of ours');
  });

  it("an unknown pass name is still the registry's own refusal, before any pass runs", () => {
    const e = assertThrows(() => binaryen.readBinary(BAD).runPasses(['NoSuchPass']));
    assert(!(e instanceof binaryen.OptimizeError));
  });
});
