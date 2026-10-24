// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The shared definitions (open-work 22): the generated module equals its
// JSON sources, each stated hash is the content's, and D2 says what the code
// does — binaryang is the definitions' first consumer.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import {
  FEATURE_DEFINITIONS,
  featuresForSuite,
  OPCODE_DEFINITIONS,
  PROFILE_DEFINITIONS,
  profileDefinition,
  VERDICT_DEFINITIONS,
  verdictClass,
} from '../../src/definitions/mod.ts';
import { listPasses } from '../../src/passes/index.ts';
import { allFeatures, defaultFeatures } from '../../src/core/feature.ts';
import { FeatureFlags } from '../../src/cli/feature-flags.ts';
import { contentHash } from '../../scripts/definitions.ts';
import * as fsx from '../test_fs.ts';

const source = (f: string) =>
  JSON.parse(fsx.readTextFileSync(new URL(`../../src/definitions/${f}`, import.meta.url)));

describe('the generated module is its sources', () => {
  for (
    const [file, data] of [
      ['opcodes.json', OPCODE_DEFINITIONS],
      ['features.json', FEATURE_DEFINITIONS],
      ['verdicts.json', VERDICT_DEFINITIONS],
      ['profiles.json', PROFILE_DEFINITIONS],
    ] as const
  ) {
    it(`${file}: the same content, and the stated sha256 is the content's`, async () => {
      const s = source(file);
      expect(data).toEqual(s);
      expect(await contentHash(s)).toBe(s.sha256);
    });
  }
});

describe('D2 says what the code does', () => {
  const entries = FEATURE_DEFINITIONS.entries;

  it('one entry per Features key, in its order', () => {
    expect(entries.map((e) => e.name)).toEqual(Object.keys(allFeatures()));
  });

  it('defaultOn is defaultFeatures()', () => {
    const d = defaultFeatures() as unknown as Record<string, boolean>;
    for (const e of entries) expect(`${e.name}: ${e.defaultOn}`).toBe(`${e.name}: ${d[e.name]}`);
  });

  it('cli is the spelling the CLIs accept', () => {
    for (const e of entries) {
      const flags = new FeatureFlags();
      expect(`${e.cli}: ${flags.apply(`--enable-${e.cli}`)}`).toBe(`${e.cli}: true`);
      expect((flags.features as unknown as Record<string, boolean>)[e.name]).toBe(true);
    }
  });

  it("saturating-float-to-int is upstream's spelling; sat-float-to-int is gone (FL1, 2.0.0)", () => {
    expect(entries.find((e) => e.name === 'satFloatToInt')!.cli).toBe('saturating-float-to-int');
    const flags = new FeatureFlags();
    expect(flags.apply('--disable-sat-float-to-int')).toBe('unknown');
    expect(flags.apply('--disable-saturating-float-to-int')).toBe(true);
    expect(flags.features.satFloatToInt).toBe(false);
  });

  it('only compactImports is declared but not implemented', () => {
    expect(entries.filter((e) => !e.implemented).map((e) => e.name)).toEqual(['compactImports']);
  });

  it('requires: D2 names, never itself, no cycle; the four the proposals state (open-work 40)', () => {
    const names = new Set(entries.map((e) => e.name));
    for (const e of entries) {
      for (const r of e.requires) {
        expect(`${e.name} requires ${r}: ${names.has(r) && r !== e.name}`).toBe(
          `${e.name} requires ${r}: true`,
        );
      }
    }
    const req = new Map(entries.map((e) => [e.name, e.requires]));
    /** Whether `to` is reachable from `from` through `requires`. */
    const reaches = (from: string, to: string): boolean => {
      const seen = new Set<string>();
      const todo = [...(req.get(from) ?? [])];
      while (todo.length > 0) {
        const r = todo.pop()!;
        if (r === to) return true;
        if (!seen.has(r)) {
          seen.add(r);
          todo.push(...(req.get(r) ?? []));
        }
      }
      return false;
    };
    for (const e of entries) {
      expect(`${e.name}: ${reaches(e.name, e.name)}`).toBe(`${e.name}: false`);
    }
    expect(
      Object.fromEntries(
        entries.filter((e) => e.requires.length > 0).map((e) => [e.name, e.requires]),
      ),
    ).toEqual({
      functionReferences: ['referenceTypes'],
      gc: ['referenceTypes', 'functionReferences'],
      relaxedSimd: ['simd'],
      customDescriptors: ['gc'],
    });
  });

  it('presets: wasm1 ⊂ wasm2 ⊂ wasm3 ⊂ all, in D2 order; wasm2 is defaultOn; all is every feature', () => {
    const order = entries.map((e) => e.name);
    const preset = (n: string) => FEATURE_DEFINITIONS.presets.find((p) => p.name === n)!.features;
    expect(FEATURE_DEFINITIONS.presets.map((p) => p.name)).toEqual([
      'wasm1',
      'wasm2',
      'wasm3',
      'all',
    ]);
    for (const p of FEATURE_DEFINITIONS.presets) {
      expect(p.features).toEqual(order.filter((n) => p.features.includes(n)));
    }
    const chain = ['wasm1', 'wasm2', 'wasm3', 'all'].map(preset);
    for (let i = 1; i < chain.length; i++) {
      for (const f of chain[i - 1]!) expect(chain[i]).toContain(f);
    }
    expect(preset('wasm2')).toEqual(entries.filter((e) => e.defaultOn).map((e) => e.name));
    expect(preset('all')).toEqual(order);
    // Release 3.0's sections (the spec's changes.rst), beyond 2.0.
    expect(preset('wasm3').filter((f) => !preset('wasm2').includes(f))).toEqual([
      'exceptions',
      'functionReferences',
      'tailCall',
      'annotations',
      'gc',
      'memory64',
      'multiMemory',
      'extendedConst',
      'relaxedSimd',
    ]);
  });

  it('suite feature sets: the core turns custom-descriptors off, threads multi-memory', () => {
    const all = allFeatures() as unknown as Record<string, boolean>;
    expect(featuresForSuite('')).toEqual({ ...all, customDescriptors: false });
    expect(featuresForSuite('proposals/custom-descriptors/')).toEqual(all);
    expect(featuresForSuite('proposals/threads/')).toEqual({
      ...all,
      customDescriptors: false,
      multiMemory: false,
    });
  });
});

describe('D4 is consistent with D1, D2 and the passes', () => {
  const portable = profileDefinition('portable')!;

  it("the 'portable' profile exists; an unknown name is undefined", () => {
    expect(portable.name).toBe('portable');
    expect(profileDefinition('nowhere')).toBeUndefined();
  });

  for (const p of PROFILE_DEFINITIONS.entries) {
    const engines = new Set(p.engines.map((e) => e.name));
    const tiers = [
      ...p.features.map((f) => ({ ...f, id: f.feature })),
      ...p.opcodes.map((o) => ({ ...o, id: o.name })),
    ];

    it(`${p.name}: one feature entry per D2 feature, in its order`, () => {
      expect(p.features.map((f) => f.feature)).toEqual(
        FEATURE_DEFINITIONS.entries.map((e) => e.name),
      );
    });

    it(`${p.name}: every instruction is a D1 name`, () => {
      const names = new Set(OPCODE_DEFINITIONS.entries.map((e) => e.name));
      for (const o of p.opcodes) expect(`${o.name}: ${names.has(o.name)}`).toBe(`${o.name}: true`);
    });

    it(`${p.name}: a lowered entry names a registered pass; no other entry names one`, () => {
      const passes = new Set(listPasses());
      for (const t of tiers) {
        expect(`${t.id}: ${t.tier === 'lowered' ? passes.has(t.pass ?? '') : t.pass === undefined}`)
          .toBe(`${t.id}: true`);
      }
    });

    it(`${p.name}: refusedBy names defining engines; portable means none refused`, () => {
      for (const t of tiers) {
        for (const e of t.refusedBy) {
          expect(`${t.id}: ${e} ${engines.has(e)}`).toBe(`${t.id}: ${e} true`);
        }
        if (t.tier === 'portable') expect(`${t.id}: ${t.refusedBy.length}`).toBe(`${t.id}: 0`);
        // Not portable, and probed: some engine was measured refusing it.
        else if (t.probes > 0) expect(`${t.id}: ${t.refusedBy.length > 0}`).toBe(`${t.id}: true`);
      }
    });
  }
});

describe('D3: the testsuite prefix rule', () => {
  it('a longer expected text belongs to the class that prefixes it', () => {
    expect(verdictClass('uninitialized element 2')?.key).toBe('uninitialized-element');
  });

  it('the LONGEST prefix wins; a class is not matched by a different start', () => {
    expect(verdictClass('null array reference')?.key).toBe('null-array-reference');
    expect(verdictClass('null reference')?.key).toBe('null-reference');
    expect(verdictClass('descriptor cast failure')?.key).toBe('descriptor-cast-failure');
  });

  it('no class: undefined', () => {
    expect(verdictClass('some engine wording')).toBeUndefined();
  });

  it('keys and messages are unique', () => {
    const e = VERDICT_DEFINITIONS.entries;
    expect(new Set(e.map((x) => x.key)).size).toBe(e.length);
    expect(new Set(e.map((x) => x.message)).size).toBe(e.length);
  });
});
