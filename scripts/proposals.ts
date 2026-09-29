// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The spec testsuite's `proposals/` — what each one needs to be judged. ONE
 * table, read by `deno task spec` and `deno task spec-behaviour` (`--proposal
 * <name>`) and by the driver, `deno task proposals` (`check-proposals.ts`).
 *
 * Owner, 2026-09-29: both halves in the gate — validity AND behaviour, the
 * latter on V8's EXPERIMENTAL flags, accepting that a future Deno may need a
 * row here adjusted. ⚠️ That is the maintenance point: when a Deno upgrade
 * renames or retires a flag (a proposal that ships drops its flag), V8 only
 * WARNS and runs without it — so the behaviour check counts an original the
 * engine will not compile as BLIND and the driver fails on it, rather than let
 * original and variants "agree" by failing alike.
 */

import type { Features } from '../src/wabt-ts/core/feature.ts';
import { allFeatures } from '../src/wabt-ts/core/feature.ts';

export interface Proposal {
  /** The directory under `testsuite-main/proposals/`. */
  name: string;
  /**
   * The feature set its suite is written against. Every feature on, except
   * what the suite predates: a later proposal that RELAXES a rule makes that
   * suite's `assert_invalid` valid.
   */
  features: Features;
  /** `--v8-flags` the behaviour check runs under; empty when V8 needs none. */
  v8Flags: string[];
  /**
   * Why the behaviour half cannot run, when it cannot: the invocations are then
   * reported as NOT RUN, never as passing.
   */
  noEngine?: string;
}

export const PROPOSALS: readonly Proposal[] = [
  {
    name: 'custom-descriptors',
    // The core harness turns this OFF (it relaxes `br_on_cast`); its own suite needs it ON.
    features: { ...allFeatures(), customDescriptors: true },
    v8Flags: ['--experimental-wasm-custom-descriptors'],
  },
  {
    name: 'custom-page-sizes',
    features: allFeatures(),
    v8Flags: [],
    noEngine: 'V8 (Deno 2.9.7, V8 15.0) has no custom-page-sizes support, not even a flag',
  },
  {
    name: 'threads',
    // Written before multi-memory: it asserts "multiple memories" INVALID five
    // times (imports.wast:410/414/418, memory.wast:14/15), which multi-memory
    // — Wasm 3.0 — made valid.
    features: { ...allFeatures(), multiMemory: false },
    v8Flags: [],
  },
  {
    name: 'wide-arithmetic',
    features: allFeatures(),
    v8Flags: ['--experimental-wasm-wide-arithmetic'],
  },
];

/** The row for `--proposal <name>`, or exit 2 naming the known ones. */
export function proposalNamed(name: string): Proposal {
  const p = PROPOSALS.find((x) => x.name === name);
  if (p !== undefined) return p;
  console.error(`unknown proposal '${name}'; known: ${PROPOSALS.map((x) => x.name).join(', ')}`);
  Deno.exit(2);
}

/** `--proposal <name>` from `args`, removed from them; `undefined` when absent. */
export function takeProposalArg(args: string[]): Proposal | undefined {
  const i = args.indexOf('--proposal');
  if (i < 0) return undefined;
  const name = args[i + 1];
  if (name === undefined) {
    console.error('--proposal needs a name');
    Deno.exit(2);
  }
  args.splice(i, 2);
  return proposalNamed(name);
}
