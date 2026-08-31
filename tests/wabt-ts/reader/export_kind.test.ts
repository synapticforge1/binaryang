// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A3 — the export section accepted ANY byte as an export kind.
//
// `readExportSection` read the kind byte and wrote `as ExternalKind`, which
// asserts a fact about the byte instead of checking it. The import section
// immediately above it has always had a `default: unknown import kind` arm, so
// the two dispatches disagreed and only one of them was wrong.
//
// Found by MEASUREMENT, not by review: the A3 single-byte corruption sweep
// (`deno task offsets`) flips each byte of a valid module and asks whether our
// reader plus validator still accept it while V8 rejects it. Corrupting this
// field was the one shape our whole pipeline waved through — five instances,
// one per subject module, all the same field.
//
// ⚠️ The sweep's FIRST reading claimed twenty such shapes. That was an unfair
// oracle: it compared our READER against V8, which decodes *and* validates, so
// every case our validator would have caught was booked as a reader defect.
// Adding the validator stage dropped twenty to five. Three quarters of that
// first finding was the instrument.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

const SRC = '(module (func (export "f") (result i32) (i32.const 7)))';

/** Byte index of the export-kind field in the module `SRC` assembles to. */
function exportKindOffset(bytes: Uint8Array): number {
  // Export section (id 0x07) → size → count → name length → name → KIND.
  for (let i = 8; i < bytes.length; i++) {
    if (bytes[i] === 0x07) {
      const count = bytes[i + 2]!;
      const nameLen = bytes[i + 3]!;
      if (count === 1 && nameLen === 1) return i + 3 + nameLen + 1;
    }
  }
  throw new Error('export section not located; fixture changed');
}

describe('A3 — the export kind byte is checked, not asserted', () => {
  it('a valid module still round-trips', () => {
    const { binary } = wat2wasm(SRC, { filename: 'e.wat' });
    const errs = makeErrorList();
    const m = readBinaryIr(binary, errs);
    assert(!hasErrors(errs), 'the uncorrupted fixture must read cleanly');
    assertEquals(m.exports.length, 1);
  });

  // The fixture is corrupted at the located offset rather than a hard-coded
  // one, so a change to the assembler moves the probe instead of silently
  // testing the wrong byte.
  it('rejects an unknown export kind that V8 also rejects', () => {
    const { binary } = wat2wasm(SRC, { filename: 'e.wat' });
    const at = exportKindOffset(binary);
    assertEquals(binary[at], 0x00, 'expected the func export kind at the located offset');

    const bad = binary.slice();
    bad[at] = 0xff;

    // The oracle: a real engine refuses this module. If V8 ever accepts it,
    // this test is asserting the wrong thing and should be revisited rather
    // than relaxed.
    assertEquals(WebAssembly.validate(bad as BufferSource), false, 'V8 must reject the fixture');

    const errs = makeErrorList();
    readBinaryIr(bad, errs);
    assert(hasErrors(errs), 'the reader must reject an unknown export kind');
    assert(
      errs.some((e) => e.message.includes('unknown export kind')),
      `expected an "unknown export kind" diagnostic, got: ${errs.map((e) => e.message).join('; ')}`,
    );
  });

  it('every defined export kind is still accepted', () => {
    const { binary } = wat2wasm(SRC, { filename: 'e.wat' });
    const at = exportKindOffset(binary);
    // Func/Table/Memory/Global/Tag = 0..4. Only Func indexes validly here, so
    // this asserts the READER accepts the byte, not that the module validates.
    for (const kind of [0, 1, 2, 3, 4]) {
      const v = binary.slice();
      v[at] = kind;
      const errs = makeErrorList();
      readBinaryIr(v, errs);
      assert(
        !errs.some((e) => e.message.includes('unknown export kind')),
        `export kind ${kind} is defined and must not be reported as unknown`,
      );
    }
  });

  it('the whole pipeline agrees with V8 on the corrupted module', () => {
    const { binary } = wat2wasm(SRC, { filename: 'e.wat' });
    const bad = binary.slice();
    bad[exportKindOffset(binary)] = 0xff;

    const errs = makeErrorList();
    const m = readBinaryIr(bad, errs);
    if (!hasErrors(errs)) {
      validateModule(m, errs, { features: allFeatures() });
    }
    assert(hasErrors(errs), 'reader+validator together must reject what V8 rejects');
  });
});
