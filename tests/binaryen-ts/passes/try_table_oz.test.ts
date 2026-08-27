// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `-Oz` must not drop a store that is live across a try_table catch edge.
//
// Reported by the wasmtk team, 2026-08-27, against binaryang@1.5.1 (first seen
// on binaryen-ts@1.5.0). Their fixture is
// `wasmtk/scripts/eh_try_table_live_local_fixture.wat`, driven by
// `check_try_table_oz.ts`; this is the same module, kept here so the defect is
// gated in the repo that owns the optimiser.
//
// ## The defect
//
// `CoalesceLocals` eliminated a local's initialisation when the local was
// written again INSIDE a try_table body. The pre-try store is only dead if the
// try COMPLETES; when the body throws, the handler must still observe the
// initial value.
//
//     pre-Oz   161 bytes -> exit 42   (correct)
//     post-Oz  151 bytes -> exit  1   ($result + 1 with the 41 store dropped)
//
// Cause, in `passes/cfg.ts`: try_table linked only `bodyEntry → handler`, so
// liveness treated the body's own writes as already done by the time the handler
// was reached. A throw can happen at any point in the body. Legacy `try` already
// pushed its catch entries onto the handler stack so every throwing instruction
// linked to them; try_table did not, because its catches are branch targets
// rather than inline handlers. The shape differs; the liveness requirement does
// not.
//
// ## ⚠️ Why this exact shape, and not a simpler try_table module
//
// wasmtk's first fixture set the local before the try and never wrote it inside.
// It passed `-Oz` cleanly WHILE REAL MODULES WERE MISCOMPILING, and on that
// evidence the workaround was removed and wrong code shipped. A try_table module
// that merely USES exceptions does not exercise this: the local must be assigned
// INSIDE the try body by something that throws, or there is no dead-store
// reasoning to get wrong and the test is green for the wrong reason.
//
// Both operands of the exit code are load-bearing — clobber either and the code
// moves, so this cannot pass by accident:
//   $result — set BEFORE the try, read AFTER the catch  (41)
//   $il     — bound FROM the tag payload by the handler (33 - 32 = 1)

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { Result } from '../../../src/wabt-ts/core/index.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

const FIXTURE = `
(module
  (import "wasi_snapshot_preview1" "proc_exit" (func $exit (param i32)))
  (tag $__exn_tag (param i32 i32))
  (memory (export "memory") 1)
  (func $mayThrow (result i32)
    (throw $__exn_tag (i32.const 7) (i32.const 33)))
  (func (export "_start")
    (local $result i32) (local $ip i32) (local $il i32)
    (local.set $result (i32.const 41))
    (block $done
      (block $h (result i32 i32)
        (try_table (catch $__exn_tag $h)
          (local.set $result (call $mayThrow)))
        (br $done))
      (local.set $il)
      (local.set $ip))
    (call $exit (i32.add (local.get $result) (i32.const 1)))))
`;

/** Run `_start` and return the code passed to `proc_exit`. */
function exitCode(bytes: Uint8Array): number {
  let code = -1;
  const imports = {
    wasi_snapshot_preview1: {
      proc_exit: (c: number) => {
        code = c;
        throw new Error('proc_exit');
      },
    },
  };
  try {
    // Sync form on purpose: with `lib` unioning dom + deno.window, the
    // `WebAssembly.instantiate` overload resolves to Instance rather than
    // InstantiatedSource, so destructuring `.instance` does not type-check.
    const instance = new WebAssembly.Instance(
      new WebAssembly.Module(bytes as BufferSource),
      imports as WebAssembly.Imports,
    );
    (instance.exports._start as () => void)();
  } catch {
    // proc_exit unwinds by design
  }
  return code;
}

describe('-Oz and try_table: a store live across a catch edge', () => {
  it('the fixture itself is correct before any optimisation', () => {
    const { binary, result } = wat2wasm(FIXTURE, { filename: 'try_table_oz.wat' });
    assertEquals(result, Result.Ok);
    // A pre-Oz failure means the fixture or the assembler broke, NOT that the
    // optimiser is fixed — the distinction wasmtk's checker also draws.
    assertEquals(exitCode(binary), 42, 'fixture is broken, not the optimiser');
  });

  it('CoalesceLocals alone keeps the pre-try store', () => {
    const { binary } = wat2wasm(FIXTURE, { filename: 'try_table_oz.wat' });
    const mod = parseWasm(binary);
    new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 }).add('CoalesceLocals').run();
    assertEquals(exitCode(encodeWasm(mod)), 42, 'CoalesceLocals dropped a live store');
  });

  it('the full -Oz pipeline keeps it, and still optimises', () => {
    const { binary } = wat2wasm(FIXTURE, { filename: 'try_table_oz.wat' });
    const mod = parseWasm(binary);
    new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 })
      .addDefaultOptimizationPasses()
      .run();
    const out = encodeWasm(mod);
    assertEquals(exitCode(out), 42, '-Oz miscompiled try_table');
    // Guard against "fixed" by disabling optimisation: the module must still shrink.
    assert(
      out.length < binary.length,
      `-Oz produced no shrink (${binary.length} -> ${out.length})`,
    );
  });
});
