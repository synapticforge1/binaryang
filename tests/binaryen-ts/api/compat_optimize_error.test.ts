// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Security review round 1 (2026-11-13), C10: `readBinary` decodes structure and does not
// validate, so an invalid module reached the passes, and `optimize()` threw a bare `Error`
// ("RemoveUnusedTypes: a reference to type N, which was not kept"; 22 of ~31,000 fuzz runs).
// Now, as `readForPasses` does, the VALIDATOR is asked on the failure path: an invalid input is
// an `OptimizeError` in the validator's words, the pass's error its cause; a failure the
// validator does not explain is ours, rethrown as it was.
//
// Round 2 (C10b): the fuzz case itself — a function DECLARED with a type that does not exist — is
// now refused by `readBinary`, as upstream's reader refuses it; the writer used to choose a type
// with the same signature, so it came out of read → emit as a valid, different module. So the
// OptimizeError path is pinned with a module the reader does accept (a block of type 5) and a
// pass that throws.

import { describe, it } from 'node:test';
import { assert, assertEquals, assertInstanceOf, assertThrows } from '@std/assert';
import * as binaryen from '../../../src/compat/binaryen-compat.ts';
import { WasmBinaryError } from '../../../src/ir/prepare.ts';
import { listPasses, registerPass } from '../../../src/passes/pass.ts';

const bytes = (parts: string[]) =>
  new Uint8Array(parts.join(' ').split(' ').map((x) => parseInt(x, 16)));

/** One function DECLARED with type 5, which does not exist: the shape of the fuzz finding. */
const DECLARED_MISSING = bytes([
  '00 61 73 6d 01 00 00 00', // header
  '01 04 01 60 00 00', // type section: () -> ()
  '03 02 01 05', // function section: func 0 has type 5
  '07 05 01 01 66 00 00', // export "f" = func 0
  '0a 04 01 02 00 0b', // code: an empty body
]);

/** A module the reader accepts that is not valid: `block (type 5)`; its byte 31 is the 5. */
const BLOCK_MISSING = bytes([
  '00 61 73 6d 01 00 00 00',
  '01 04 01 60 00 00',
  '03 02 01 00',
  '07 05 01 01 66 00 00',
  '0a 07 01 05 00 02 05 0b 0b', // block (type 5) end end
]);
const BLOCK_TYPE_AT = 31;

/** A pass that throws: registered once per process. */
function throwingPass(): string {
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
  return 'C10TestThrows';
}

describe('C10b — a function declared with a missing type is refused when read', () => {
  it("readBinary refuses it with the validator's words, as upstream's reader does", () => {
    const e = assertThrows(() => binaryen.readBinary(DECLARED_MISSING));
    assertInstanceOf(e, WasmBinaryError);
    assert(e.message.includes('function type variable out of range: 5'), e.message);
  });

  it('the same module with its type in range reads and optimizes as before', () => {
    const ok = DECLARED_MISSING.slice();
    ok[17] = 0; // func 0 has type 0
    const m = binaryen.readBinary(ok);
    m.optimize();
    assert(m.emitBinary().length > 8);
  });
});

describe('C10 — a pass that stops on an invalid module is an OptimizeError', () => {
  it('the fixture: invalid as given, valid with its block untyped', () => {
    assertThrows(() => binaryen.readBinary(BLOCK_MISSING).runPasses([throwingPass()]));
    const ok = BLOCK_MISSING.slice();
    ok[BLOCK_TYPE_AT] = 0x40;
    const errorsOff = console.error;
    console.error = () => undefined;
    try {
      assertEquals(binaryen.readBinary(BLOCK_MISSING).validate(), 0);
      assertEquals(binaryen.readBinary(ok).validate(), 1);
    } finally {
      console.error = errorsOff;
    }
  });

  it("the validator's diagnostics, the pass's error as the cause", () => {
    const e = assertThrows(() => binaryen.readBinary(BLOCK_MISSING).runPasses([throwingPass()]));
    assertInstanceOf(e, binaryen.OptimizeError);
    assertEquals(e.name, 'OptimizeError');
    assert(e.message.startsWith('runPasses(): the module readBinary read is not valid'), e.message);
    assert(e.message.includes('type index 5'), e.message);
    assertInstanceOf(e.cause, RangeError);
  });

  it('judges the bytes readBinary was given, though the caller changes them after', () => {
    const b = BLOCK_MISSING.slice();
    const m = binaryen.readBinary(b);
    b[BLOCK_TYPE_AT] = 0x40; // `block` with no type: VALID bytes, by which the failure would be ours
    assertInstanceOf(assertThrows(() => m.runPasses([throwingPass()])), binaryen.OptimizeError);
  });

  it('a pass that fails on a VALID module is ours: rethrown as it was, not blamed on the input', () => {
    const ok = BLOCK_MISSING.slice();
    ok[BLOCK_TYPE_AT] = 0x40;
    const e = assertThrows(() => binaryen.readBinary(ok).runPasses([throwingPass()]));
    assert(!(e instanceof binaryen.OptimizeError), String(e));
    assertInstanceOf(e, RangeError);
    assertEquals(e.message, 'a defect of ours');
  });

  it("an unknown pass name is still the registry's own refusal, before any pass runs", () => {
    const e = assertThrows(() => binaryen.readBinary(BLOCK_MISSING).runPasses(['NoSuchPass']));
    assert(!(e instanceof binaryen.OptimizeError));
  });
});
