// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Memory64Lowering on REAL compiler output (open-work 32): the benchmark workload built for
// memory64 by Rust nightly (wasm64-unknown-unknown) and Zig (wasm64-freestanding) —
// benches/browser-opt/build.ts --wasm64 — each with a 64-bit memory AND a 64-bit table, the memory
// exported. Lowered, each must run its workload to the checksum the 32-bit builds give, on every
// engine — JavaScriptCore included, which refuses the original ("Memory64 is not enabled"). Where
// the engine runs memory64 (V8, the referee) the ORIGINAL must give it too.
//
// Measured 2026-10-22 before this test: all four builds (debug and release of each) lowered and ran
// on both engines to 1892226719; the debug builds are not committed (Rust's is 7 MB).

import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { expect } from '@std/expect';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';

const MODULES = new URL('../../../benches/browser-opt/modules64/', import.meta.url);
/** What every build of the workload computes: `run(300)`'s checksum (real_compiler_behaviour). */
const CHECKSUM = '1892226719';

async function workload(bytes: Uint8Array): Promise<string> {
  try {
    const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
    const ex = instance.exports as Record<string, unknown>;
    if (typeof ex['_initialize'] === 'function') (ex['_initialize'] as () => void)();
    return String((ex['run'] as (n: number) => number)(300) >>> 0);
  } catch (e) {
    return `${e instanceof WebAssembly.RuntimeError ? 'trap' : 'refused'}: ${(e as Error).message}`;
  }
}

const hostHasMemory64 = (() => {
  try {
    // (module (memory i64 1)): a 64-bit memory, limits flag 0x04.
    new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1]));
    return true;
  } catch {
    return false;
  }
})();

describe('real compiler output for memory64, lowered, runs everywhere', () => {
  for (const m of ['rust-release-wasm64', 'zig-releasefast-wasm64']) {
    it(m, async () => {
      const bytes = new Uint8Array(readFileSync(new URL(`${m}.wasm`, MODULES)));
      const mod = readForPasses(bytes);
      // Not vacuous: the build really is 64-bit, memory and table.
      expect(mod.memories.some((x) => x.limits.is64)).toBe(true);
      expect(mod.tables.some((x) => x.limits.is64)).toBe(true);
      new PassRunner(mod, {}).add('Memory64Lowering').run();
      expect([...mod.memories, ...mod.tables].some((x) => x.limits.is64)).toBe(false);
      expect(await workload(writeWasm(mod))).toBe(CHECKSUM);
      if (hostHasMemory64) expect(await workload(bytes)).toBe(CHECKSUM);
    });
  }
});
