// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The spec testsuite's `proposals/` — what each one needs to be judged. ONE
 * table, read by `bun run spec` and `bun run spec-behaviour` (`--proposal
 * <name>`) and by the driver, `bun run proposals` (`check-proposals.ts`).
 *
 * Owner, 2026-09-29: both halves in the gate — validity AND behaviour, the
 * latter on V8's EXPERIMENTAL flags, accepting that a future Deno may need a
 * row here adjusted. ⚠️ That is the maintenance point: when a Deno upgrade
 * renames or retires a flag (a proposal that ships drops its flag), V8 only
 * WARNS and runs without it — so the behaviour check counts an original the
 * engine will not compile as BLIND and the driver fails on it, rather than let
 * original and variants "agree" by failing alike.
 */

import type { Features } from '../src/core/feature.ts';
import { featuresForSuite } from '../src/definitions/mod.ts';

import process from 'node:process';

/**
 * The feature set a suite in `dir` (relative to the testsuite root) is written
 * against — from D2, the shared feature list (open-work 22): every feature on,
 * except where an entry's `onlyIn` / `offIn` says otherwise.
 */
export const suiteFeatures = (dir: string): Features =>
  featuresForSuite(dir) as unknown as Features;

export interface Proposal {
  /** The directory under `testsuite-main/proposals/`. */
  name: string;
  /**
   * The feature set its suite is written against. Every feature on, except
   * what the suite predates: a later proposal that RELAXES a rule makes that
   * suite's `assert_invalid` valid.
   */
  features: Features;
  /** V8 flags the behaviour check runs under (`engine` `node` or `deno`); empty when V8 needs none. */
  v8Flags: string[];
  /**
   * Which runtime's WebAssembly engine runs the behaviour check (Bun migration B4, 2026-10-12;
   * cmem/bun-migration.md § "The engine oracle"). `deno` (V8 15.0) unless a row says otherwise:
   * the owner runs Node 22 only (2026-10-12), whose V8 12.4 fails the behaviour gate, so Deno is
   * the V8 referee until it is gone. An experimental proposal needs an engine that HAS it, and
   * no single one has them all.
   */
  engine?: 'node' | 'deno' | 'bun';
  /**
   * Why the behaviour half cannot run, when it cannot: the invocations are then
   * reported as NOT RUN, never as passing.
   */
  noEngine?: string;
  /**
   * The behaviour check, when it is not the differential: a script beside this
   * one that takes the prepared directory. For a proposal V8 cannot run as
   * written, which a pass LOWERS so it can — the original then has no engine,
   * and the spec's expected values are the oracle.
   */
  behaviourScript?: string;
}

export const PROPOSALS: readonly Proposal[] = [
  {
    name: 'custom-descriptors',
    // D2: on ONLY here — it relaxes `br_on_cast`, which the core suite asserts.
    features: suiteFeatures('proposals/custom-descriptors/'),
    v8Flags: ['--experimental-wasm-custom-descriptors'],
    // TEMPORARY, on Deno's V8 (15.0). Measured 2026-10-12: Node 24's V8 (13.6) predates opcode
    // 0xfb20 and refuses 9 originals; Node 26's V8 (14.6) accepts them, and since open-work 28
    // part 4 (2026-10-12) Node 26 runs this source too (erasable TypeScript). So Node 26 can
    // take this row once it is the V8 referee; until then, Deno.
    engine: 'deno',
  },
  {
    name: 'custom-page-sizes',
    features: suiteFeatures('proposals/custom-page-sizes/'),
    // V8 (15.0) has no custom-page-sizes support, not even a flag. Owner,
    // 2026-09-29: lower it so V8 runs it — `LowerCustomPageSizes`, judged
    // against the spec's own assertions in seven worlds.
    v8Flags: [],
    behaviourScript: './check-lowered-page-sizes.ts',
  },
  {
    name: 'threads',
    // D2: multi-memory is OFF here — the suite predates it and asserts
    // "multiple memories" invalid five times.
    features: suiteFeatures('proposals/threads/'),
    v8Flags: [],
  },
  {
    name: 'wide-arithmetic',
    features: suiteFeatures('proposals/wide-arithmetic/'),
    // On Bun: JavaScriptCore has wide-arithmetic ON by default. V8 has it only from 15.0 (Deno,
    // behind --experimental-wasm-wide-arithmetic); Node 24's 13.6 and Node 26's 14.6 do not have
    // it at all. Measured 2026-10-12: on Bun the check gives Deno's exact result (99 invocations,
    // 2 modules, 0 DIVERGE).
    v8Flags: [],
    engine: 'bun',
  },
];

/** The row for `--proposal <name>`, or exit 2 naming the known ones. */
export function proposalNamed(name: string): Proposal {
  const p = PROPOSALS.find((x) => x.name === name);
  if (p !== undefined) return p;
  console.error(`unknown proposal '${name}'; known: ${PROPOSALS.map((x) => x.name).join(', ')}`);
  process.exit(2);
}

/** `--proposal <name>` from `args`, removed from them; `undefined` when absent. */
export function takeProposalArg(args: string[]): Proposal | undefined {
  const i = args.indexOf('--proposal');
  if (i < 0) return undefined;
  const name = args[i + 1];
  if (name === undefined) {
    console.error('--proposal needs a name');
    process.exit(2);
  }
  args.splice(i, 2);
  return proposalNamed(name);
}
