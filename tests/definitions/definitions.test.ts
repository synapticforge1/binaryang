// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The shared definitions (open-work 22): the generated module equals its
// JSON sources, each stated hash is the content's, and D2 says what the code
// does — binaryang is the definitions' first consumer.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import {
  FEATURE_DEFINITIONS,
  featuresForSuite,
  VERDICT_DEFINITIONS,
  verdictClass,
} from '../../src/definitions/mod.ts';
import { allFeatures, defaultFeatures } from '../../src/wabt-ts/core/feature.ts';
import { FeatureFlags } from '../../src/cli/feature-flags.ts';
import { contentHash } from '../../scripts/definitions.ts';

const source = (f: string) =>
  JSON.parse(Deno.readTextFileSync(new URL(`../../src/definitions/${f}`, import.meta.url)));

describe('the generated module is its sources', () => {
  for (
    const [file, data] of [
      ['features.json', FEATURE_DEFINITIONS],
      ['verdicts.json', VERDICT_DEFINITIONS],
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

  it('only compactImports is declared but not implemented', () => {
    expect(entries.filter((e) => !e.implemented).map((e) => e.name)).toEqual(['compactImports']);
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
