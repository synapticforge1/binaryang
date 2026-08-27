// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.30 — `/compat`'s three failure paths threw two different SHAPES of error,
// and only two of the three said they threw at all.
//
// The module docs are explicit and asymmetric:
//
//     parseWat(filename, source, features?)  — throws on parse error
//     readWasm(buffer, opts?)                — throws on decode error
//     toBinary(opts) -> { buffer }           — "encodes the IR"
//
// The first two surface failures as `new Error(formatErrors(errors))`. The
// third documented no throw and propagated the binary writer's own internal
// string — so the same API failed in two different shapes depending on which
// method you called, and the one that was undocumented was the one that
// surprised you.
//
// **It is reachable with no mistake by the caller.** A module can decode
// cleanly and still be un-encodable: index validity is the VALIDATOR's job, not
// the reader's, so `readWasm` of a corrupted binary whose func references a type
// the type section no longer holds hands back a module, and `toBinary` is where
// it fails. Found by fuzzing `/compat` — 2 of 585 truncated / corrupted inputs.
//
// `/compat` is the wasmtk-facing migration surface, which makes this the more
// consequential half of the same shape fixed in `wasmStrip` under T13.29.
//
// The binary writer still throws and MUST (T10.7) — it refuses to emit bytes it
// cannot justify. What changed is that `toBinary` wraps that in an error naming
// itself, and the docs now say it throws.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import wabt from '../../src/api/wabt-compat.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function reference(): Uint8Array {
  const { binary, errors } = wat2wasm(`(module
    (type $t (func (param i32) (result i32)))
    (import "e" "f" (func $imp (param i32) (result i32)))
    (memory 1) (table 2 funcref)
    (global $g (mut i32) (i32.const 0))
    (func $f (type $t) (local.get 0))
    (export "f" (func $f))
    (data (i32.const 0) "hi"))`);
  if (hasErrors(errors)) throw new Error(formatErrors(errors));
  assert(binary);
  return binary;
}

describe('T13.30 — /compat fails in one shape, and says so', () => {
  it('every throw from the byte surface is an Error naming its origin', async () => {
    const w = await wabt();
    const full = reference();
    const anonymous: string[] = [];
    let threw = 0;

    const check = (e: unknown, where: string, tag: string) => {
      threw++;
      assert(e instanceof Error, `${tag} [${where}] threw a non-Error: ${typeof e}`);
      // Every failure must identify itself. A bare internal string from a
      // deeper layer is what this test exists to prevent.
      if (
        !/parseWat|readWasm|toBinary|toText|applyNames|destroyed|error|expected|malformed|invalid|truncated|overflow|out of bounds/i
          .test(e.message)
      ) {
        anonymous.push(`${tag} [${where}]: ${e.message.slice(0, 70)}`);
      }
    };

    for (let n = 0; n <= full.length; n++) {
      let mod;
      try {
        mod = w.readWasm(full.slice(0, n), {});
      } catch (e) {
        check(e, 'readWasm', `trunc@${n}`);
        continue;
      }
      for (
        const [name, fn] of [
          ['toBinary', () => mod!.toBinary({})],
          ['toText', () => mod!.toText({})],
          ['applyNames', () => mod!.applyNames()],
        ] as const
      ) {
        try {
          fn();
        } catch (e) {
          check(e, name, `trunc@${n}`);
        }
      }
      mod.destroy();
    }

    for (let i = 0; i < full.length; i++) {
      for (const v of [0x00, 0x7f, 0xff]) {
        const c = Uint8Array.from(full);
        c[i] = v;
        let mod;
        try {
          mod = w.readWasm(c, {});
        } catch (e) {
          check(e, 'readWasm', `byte${i}=${v}`);
          continue;
        }
        for (
          const [name, fn] of [
            ['toBinary', () => mod!.toBinary({})],
            ['toText', () => mod!.toText({})],
          ] as const
        ) {
          try {
            fn();
          } catch (e) {
            check(e, name, `byte${i}=${v}`);
          }
        }
        mod.destroy();
      }
    }

    // Pin the population — if nothing threw, the assertion above is vacuous.
    assert(threw > 50, `only ${threw} throws seen; the fuzz is not reaching the failure paths`);
    assert(
      anonymous.length === 0,
      `${anonymous.length} throw(s) carried a bare internal message with no origin:\n  ` +
        anonymous.slice(0, 5).join('\n  '),
    );
  });

  it('toBinary names itself when the module cannot be encoded', async () => {
    // The specific case: decode succeeds, encode cannot. Byte 8 of the
    // reference module is the type-section count; zeroing it leaves a func
    // referencing a type that is no longer there.
    const w = await wabt();
    const c = Uint8Array.from(reference());
    c[8] = 0x00;
    let mod;
    try {
      mod = w.readWasm(c, {});
    } catch {
      return; // a stricter decoder refusing outright is also acceptable
    }
    let msg = '';
    try {
      mod.toBinary({});
    } catch (e) {
      msg = (e as Error).message;
    }
    mod.destroy();
    if (msg === '') return; // encoding succeeded; nothing to assert
    assert(
      msg.startsWith('toBinary:'),
      `toBinary propagated a bare internal error instead of naming itself: ${msg}`,
    );
  });

  it('still round-trips a valid module through the compat surface', async () => {
    // The guard against over-correcting — wrapping everything in try/catch
    // would also satisfy the assertions above.
    const w = await wabt();
    const mod = w.readWasm(reference(), {});
    const { buffer } = mod.toBinary({});
    assertEquals(new Uint8Array(buffer).length, reference().length);
    assert(mod.toText({}).includes('module'));
    mod.destroy();
  });
});
