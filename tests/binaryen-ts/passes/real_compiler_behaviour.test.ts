// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Real compiler output keeps its behaviour at every optimizing level. The six modules of
// benches/browser-opt (Rust, Zig and TinyGo; debug and release builds of one workload) are
// optimized at -O1 … -Oz and each output RUNS the workload as benches/browser-opt/worker.ts does:
// `_initialize`, then `run(300)`, whose checksum must equal the original's.
//
// 🔧 Why this test exists: no gate ran these modules. Open-work 31's measurements only checked
// that the output compiled, and the behaviour gates (spec-behaviour, direct-behaviour) replay the
// spec suite and the corpus, where no function had the shape. From step 4 to step 15, Local2Stack
// made rust-debug compute a different checksum and zig-releasefast trap at -O3 / -Os / -Oz; the
// in-browser benchmark found it at 1.13.0's release check (`stack-ir.ts` § `_pairs`).

import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { expect } from '@std/expect';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';

const MODULES = new URL('../../../benches/browser-opt/modules/', import.meta.url);
const LEVELS = {
  O1: { optimizeLevel: 1, shrinkLevel: 0 },
  O2: { optimizeLevel: 2, shrinkLevel: 0 },
  O3: { optimizeLevel: 3, shrinkLevel: 0 },
  Os: { optimizeLevel: 2, shrinkLevel: 1 },
  Oz: { optimizeLevel: 2, shrinkLevel: 2 },
} as const;

async function workload(bytes: Uint8Array): Promise<string> {
  try {
    const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
    const ex = instance.exports as Record<string, unknown>;
    if (typeof ex['_initialize'] === 'function') (ex['_initialize'] as () => void)();
    return String((ex['run'] as (n: number) => number)(300));
  } catch (e) {
    return `${e instanceof WebAssembly.RuntimeError ? 'trap' : 'threw'}: ${(e as Error).message}`;
  }
}

const SIX = ['rust-debug', 'rust-release', 'zig-debug', 'zig-releasefast', 'tinygo-opt1', 'tinygo-optz'];

describe('real compiler output keeps its behaviour at every level', () => {
  for (const m of SIX) {
    it(m, async () => {
      const src = new Uint8Array(readFileSync(new URL(`${m}.wasm`, MODULES)));
      const want = await workload(src);
      expect(want).toMatch(/^\d+$/); // the original runs to a checksum
      const got: Record<string, string> = {};
      for (const [level, opts] of Object.entries(LEVELS)) {
        got[level] = await workload((await wasmOpt(src, { ...opts, validate: true })) as Uint8Array);
      }
      expect(got).toEqual(Object.fromEntries(Object.keys(LEVELS).map((l) => [l, want])));
    });
  }
});
