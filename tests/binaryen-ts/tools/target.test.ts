// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// `wasm-opt --target portable` (open-work 34): a module is refused when it uses what the D4
// profile excludes — every such feature named, with the engines measured refusing it — and what
// the profile lowers is lowered, so the output fits the profile and runs on the host engine (V8 on
// the referee, which refuses most of the originals). The probe corpus behind the profile is in
// cmem/portability.md; this file pins the behaviour.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { parseArgs, wasmOpt } from '../../../src/tools/wasm-opt.ts';
import {
  assessTarget,
  checkTarget,
  featuresNeeded,
  TargetError,
  targetProfile,
} from '../../../src/tools/target.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { allFeatures, defaultFeatures } from '../../../src/core/feature.ts';
import { registerPass } from '../../../src/passes/index.ts';
import type { WasmModule } from '../../../src/ir/module.ts';

const wasm = (wat: string) => wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;
/** The profile's portable features (D4 tier `portable`), as a validator feature set. */
const PORTABLE_FEATURES = {
  ...defaultFeatures(),
  ...Object.fromEntries(
    targetProfile('portable').features.filter((f) => f.tier === 'portable').map((
      f,
    ) => [f.feature, true]),
  ),
};
const toPortable = async (wat: string, extra: Record<string, unknown> = {}) =>
  (await wasmOpt(wasm(wat), { target: 'portable', ...extra })) as Uint8Array;
const run = async (bytes: Uint8Array) => {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
  return (instance.exports['t'] as () => unknown)();
};
const refusal = async (wat: string): Promise<TargetError> => {
  try {
    await toPortable(wat);
  } catch (e) {
    if (e instanceof TargetError) return e;
    throw e;
  }
  throw new Error('accepted');
};

const GC =
  '(module (type $s (struct (field i32))) (func (export "t") (result i32) (struct.get $s 0 (struct.new $s (i32.const 1)))))';
const TAIL =
  '(module (func $f (result i32) i32.const 1) (func (export "t") (result i32) return_call $f))';

describe('--target portable refuses what the profile excludes, naming the engines', () => {
  it('GC: wasmer and wazero', async () => {
    const e = await refusal(GC);
    expect(e.findings.map((f) => [f.name, f.refusedBy])).toEqual([['gc', ['wasmer', 'wazero']]]);
    expect(e.message).toContain('gc — refused by wasmer, wazero');
    expect(e.message).toContain('measured 2026-10-23');
  });

  it('tail calls, multi-memory, br_on_non_null', async () => {
    expect((await refusal(TAIL)).findings.map((f) => f.name)).toEqual(['tailCall']);
    expect(
      (await refusal(
        '(module (memory 1) (memory 1) (func (export "t") (result i32) (i32.load 1 (i32.const 0))))',
      ))
        .findings.map((f) => f.name),
    ).toEqual(['multiMemory']);
    expect(
      (await refusal(`(module (func (export "t") (param funcref) (result i32)
        (block $l (result (ref func)) (br_on_non_null $l (local.get 0)) (return (i32.const 0))) drop i32.const 1))`))
        .findings.map((f) => [f.kind, f.name, f.refusedBy]),
    ).toEqual([['instruction', 'br_on_non_null', ['wasmer']]]);
  });

  it('every excluded feature at once, not only the first', async () => {
    const both = `(module (type $s (struct (field i32)))
      (func $f (result i32) (struct.get $s 0 (struct.new $s (i32.const 1))))
      (func (export "t") (result i32) return_call $f))`;
    expect((await refusal(both)).findings.map((f) => f.name)).toEqual(['tailCall', 'gc']);
  });

  it('an unknown target is refused, naming the targets', async () => {
    await expect(wasmOpt(wasm('(module)'), { target: 'everywhere' })).rejects.toThrow(
      'unknown target "everywhere" (targets: portable)',
    );
  });
});

describe('--target portable lowers what the profile lowers', () => {
  const cases: [string, string, unknown][] = [
    [
      'wide arithmetic',
      '(module (func (export "t") (result i64) (i64.add128 (i64.const -1) (i64.const 0) (i64.const 1) (i64.const 0)) drop))',
      0n, // the high half of 2^64 - 1 + 1 is 1, the low 0: drop leaves the low
    ],
    [
      'relaxed SIMD',
      '(module (func (export "t") (result i32) (i32x4.extract_lane 0 (f32x4.relaxed_min (v128.const f32x4 -0 0 0 0) (v128.const f32x4 0 0 0 0))) ))',
      -0x80000000, // -0: the deterministic profile's fmin
    ],
    [
      'memory64',
      '(module (memory i64 1) (func (export "t") (result i64) (i64.store (i64.const 8) (i64.const 42)) (i64.load (i64.const 8))))',
      42n,
    ],
    [
      'custom page sizes',
      '(module (memory 3 (pagesize 1)) (func (export "t") (result i32) (memory.size)))',
      3,
    ],
    [
      'memory64 with custom page sizes',
      '(module (memory i64 3 10 (pagesize 1)) (func (export "t") (result i64) (drop (memory.grow (i64.const 5))) (memory.size)))',
      8n,
    ],
    [
      'legacy exception handling',
      `(module (tag $e (param i32))
        (func (export "t") (result i32) (try (result i32) (do (throw $e (i32.const 7))) (catch $e))))`,
      7,
    ],
    [
      // No handler at all: `try` is the only legacy instruction to see.
      'legacy try without a handler',
      '(module (func (export "t") (result i32) (try (result i32) (do (i32.const 5)))))',
      5,
    ],
  ];
  for (const [name, wat, want] of cases) {
    it(`${name}: the output fits the profile and keeps the value`, async () => {
      const original = wasm(wat);
      expect(assessTarget(original, readForPasses(original), targetProfile('portable')).length)
        .toBeGreaterThan(0);
      const out = await toPortable(wat);
      expect(assessTarget(out, readForPasses(out), targetProfile('portable'))).toEqual([]);
      expect(wasmValidate(out, { features: PORTABLE_FEATURES }).errors.map((e) => e.message))
        .toEqual([]);
      expect(await run(out)).toBe(want);
    });
  }

  it('-O2 under the target fits the profile too', async () => {
    const out = await toPortable(cases[0]![1], { optimizeLevel: 2 });
    expect(assessTarget(out, readForPasses(out), targetProfile('portable'))).toEqual([]);
  });
});

describe('--target portable leaves a portable module as it would be without it', () => {
  it('byte-identical output', async () => {
    const wat = '(module (func (export "t") (result i32) (i32.add (i32.const 1) (i32.const 2))))';
    expect(await toPortable(wat)).toEqual(await wasmOpt(wasm(wat)));
  });
});

describe('the pieces', () => {
  it('featuresNeeded: what the module is invalid without', () => {
    expect(featuresNeeded(wasm('(module (func (result i32) i32.const 1))'))).toEqual([]);
    expect(featuresNeeded(wasm(GC))).toContain('gc');
  });

  it('wasm-opt checks its OUTPUT: a pass that leaves the profile is caught', async () => {
    // A test-only pass that adds a second memory (multi-memory: excluded).
    registerPass(
      class {
        readonly name = 'TestOnlyAddSecondMemory';
        readonly description = 'test only';
        readonly requiresNonNullableLocalFixups = false;
        run(m: WasmModule) {
          m.memories.push({ name: '$second', limits: structuredClone(m.memories[0]!.limits) });
        }
      },
    );
    const b = wasm('(module (memory 1) (func (export "t") (result i32) (i32.load (i32.const 0))))');
    await expect(wasmOpt(b, { target: 'portable', passes: ['TestOnlyAddSecondMemory'] })).rejects
      .toThrow(
        'the output uses multiMemory, outside the profile',
      );
  });

  it('checkTarget refuses a module outside the profile', () => {
    const b = wasm(TAIL);
    expect(() => checkTarget(b, readForPasses(b), 'portable')).toThrow('the output uses tailCall');
  });

  it('the CLI: --target <name>, and a missing name refused', () => {
    expect(parseArgs(['in.wasm', '--target', 'portable']).options.target).toBe('portable');
    expect(() => parseArgs(['in.wasm', '--target'])).toThrow('--target requires a profile name');
    expect(() => parseArgs(['in.wasm', '--target', '-O2'])).toThrow(
      '--target requires a profile name',
    );
  });
});
