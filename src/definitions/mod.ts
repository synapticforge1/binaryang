// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The shared definitions — the workspace's D2 (the WebAssembly feature /
 * proposal list) and D3 (the verdict vocabulary of the spec testsuite) — for
 * other projects to GENERATE their own copies from (open-work 22).
 *
 * Each carries its `dataVersion` and a `sha256` of its content, for a
 * generated copy's header to quote and a consumer's gate to check. The JSON
 * sources ship in the package beside this module
 * (`src/definitions/features.json`, `verdicts.json`), for consumers in other
 * languages.
 *
 * ```ts
 * import { VERDICT_DEFINITIONS, verdictClass } from 'jsr:@jrmarcum/binaryang/definitions';
 * verdictClass('uninitialized element 2')?.key; // 'uninitialized-element'
 * ```
 */

import { FEATURE_DEFINITIONS, OPCODE_DEFINITIONS, VERDICT_DEFINITIONS } from './data.ts';
import type { FeatureDefinition, OpcodeDefinition, VerdictDefinition } from './types.ts';

export { FEATURE_DEFINITIONS, OPCODE_DEFINITIONS, VERDICT_DEFINITIONS };
export type {
  DefinitionHeader,
  FeatureDefinition,
  FeatureDefinitions,
  OpcodeDefinition,
  OpcodeDefinitions,
  StackSignature,
  VerdictDefinition,
  VerdictDefinitions,
} from './types.ts';

/**
 * An instruction's KEY as binaryang's IR holds it: the byte for a core opcode,
 * `(prefix << 16) | sub` for a prefixed one.
 */
export function opcodeKey(d: OpcodeDefinition): number {
  return d.prefix === null ? d.opcode : (parseInt(d.prefix, 16) << 16) | d.opcode;
}

const BY_KEY = new Map<number, OpcodeDefinition>();
for (const d of OPCODE_DEFINITIONS.entries) {
  // The first entry for a key wins; keys are unique (checked by the tests).
  if (!BY_KEY.has(opcodeKey(d))) BY_KEY.set(opcodeKey(d), d);
}

/** The D1 entry for an IR opcode key, or `undefined`. */
export function opcodeDefinition(key: number): OpcodeDefinition | undefined {
  return BY_KEY.get(key);
}

/**
 * The class of an expected-failure text, by the testsuite's prefix rule: the
 * entry whose message is the LONGEST prefix of `text`. `undefined` when none
 * is.
 */
export function verdictClass(text: string): VerdictDefinition | undefined {
  let best: VerdictDefinition | undefined;
  for (const e of VERDICT_DEFINITIONS.entries) {
    if (
      text.startsWith(e.message) && (best === undefined || e.message.length > best.message.length)
    ) {
      best = e;
    }
  }
  return best;
}

/**
 * Which features a suite in `dir` (relative to the testsuite root, e.g.
 * `proposals/threads/`, or `''` for the core suite) is written against: every
 * feature ON, except one whose `onlyIn` excludes `dir`, or whose `offIn`
 * includes it. Keyed by canonical name.
 */
export function featuresForSuite(dir: string): Record<string, boolean> {
  const within = (dirs: string[]) => dirs.some((d) => dir.startsWith(d));
  const out: Record<string, boolean> = {};
  for (const f of FEATURE_DEFINITIONS.entries as FeatureDefinition[]) {
    out[f.name] = !(f.onlyIn !== undefined && !within(f.onlyIn)) &&
      !(f.offIn !== undefined && within(f.offIn));
  }
  return out;
}
