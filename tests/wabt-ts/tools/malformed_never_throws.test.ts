// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.29 — the four binary-consuming tools threw on malformed input.
//
// `wasm2wat`, `wasmValidate`, `wasmObjdump` and `wasmStrip` are published
// entrypoints whose contract is `{ errors, result }`. A consumer writing
//
//     const { text, errors, result } = wasm2wat(untrustedBytes);
//     if (result !== Result.Ok) { ...handle... }
//
// got an uncaught `RangeError` instead — on ~102 of 585 truncated or
// single-byte-corrupted modules, for every one of the four. All of them came
// out of `core/leb128.ts`'s `decode*Leb128`, which throws on a truncated or
// over-long encoding.
//
// **`leb128.ts` throwing is CORRECT and was not changed.** It is a pure decoder
// whose other callers (the WAT parser, the bridge) want the throw. The defect
// was that nothing converted it at the reader's boundary, so a decode failure
// on untrusted bytes escaped as a crash. The conversion now lives in the four
// `readXLeb` helpers, which report a positioned diagnostic and let the existing
// `hadError` / `ok()` machinery halt decoding — plus a backstop in
// `readBinaryIr` itself, because one unconverted throw anywhere in 3000 lines
// of decoder reproduces the whole bug.
//
// `wasmStrip` needed a second guard for a different reason: it RE-ENCODES, and
// a module can decode cleanly yet be un-encodable, because index validity is
// the VALIDATOR's job and not the reader's. The binary writer is deliberately
// fail-loud (T10.7) and must stay that way, so the tool catches rather than the
// writer softening.
//
// This is T7.1's "never throw, never hang" rule, which was applied to the WAT
// parser and never to the binary path — the same rule, the other front door.

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { wasmObjdump } from '../../../src/wabt-ts/tools/wasm-objdump.ts';
import { wasmStrip } from '../../../src/wabt-ts/tools/wasm-strip.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** A module exercising most section kinds, so truncation lands everywhere. */
function reference(): Uint8Array {
  const { binary, errors } = wat2wasm(`(module
    (type $t (func (param i32) (result i32)))
    (import "e" "f" (func $imp (param i32) (result i32)))
    (memory 1) (table 2 funcref)
    (global $g (mut i32) (i32.const 0))
    (tag $x (param i32))
    (func $f (type $t) (local.get 0))
    (export "f" (func $f))
    (elem (i32.const 0) $f) (data (i32.const 0) "hi"))`);
  if (hasErrors(errors)) throw new Error(formatErrors(errors));
  assert(binary);
  return binary;
}

const TOOLS: [string, (b: Uint8Array) => unknown][] = [
  ['wasm2wat', (b) => wasm2wat(b)],
  ['wasm-validate', (b) => wasmValidate(b, { features: allFeatures() })],
  ['wasm-objdump', (b) => wasmObjdump(b, { headers: true, details: true })],
  ['wasm-strip', (b) => wasmStrip(b)],
];

describe('T13.29 — binary tools report malformed input, never throw', () => {
  for (const [name, run] of TOOLS) {
    it(`${name} survives every truncation`, () => {
      const full = reference();
      const failures: string[] = [];
      for (let n = 0; n <= full.length; n++) {
        try {
          run(full.slice(0, n));
        } catch (e) {
          failures.push(`truncated to ${n}: ${(e as Error).message.slice(0, 60)}`);
        }
      }
      assert(
        failures.length === 0,
        `${name} threw on ${failures.length} of ${full.length + 1} truncations; ` +
          `its contract is { errors, result }:\n  ${failures.slice(0, 5).join('\n  ')}`,
      );
    });

    it(`${name} survives every single-byte corruption`, () => {
      const full = reference();
      const failures: string[] = [];
      for (let i = 0; i < full.length; i++) {
        for (const v of [0x00, 0x7f, 0xff]) {
          const c = Uint8Array.from(full);
          c[i] = v;
          try {
            run(c);
          } catch (e) {
            failures.push(`byte ${i} = ${v}: ${(e as Error).message.slice(0, 60)}`);
          }
        }
      }
      assert(
        failures.length === 0,
        `${name} threw on ${failures.length} of ${full.length * 3} corruptions:\n  ` +
          failures.slice(0, 5).join('\n  '),
      );
    });
  }

  it('a truncated module is REPORTED, not silently accepted', () => {
    // Not throwing is only half of it — the tool must also say something. A
    // silent success on garbage is the failure mode this could decay into.
    const full = reference();
    const half = full.slice(0, Math.floor(full.length / 2));
    const { errors, result } = wasmValidate(half, { features: allFeatures() });
    assert(result !== 0 || hasErrors(errors), 'a half-truncated module was accepted silently');
    assert(hasErrors(errors), 'rejected with no diagnostic — the T9.x silent-path bug');
  });

  it('still decodes the intact module correctly', () => {
    // The guard against over-correcting: swallowing everything would also pass
    // the assertions above.
    const full = reference();
    for (const [name, run] of TOOLS) {
      const r = run(full) as { errors: unknown[]; result: number };
      assert(!hasErrors(r.errors as never), `${name} now reports errors on a VALID module`);
    }
  });
});
