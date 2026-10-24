// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * `--enable-<feature>` / `--disable-<feature>` / `--enable-all`, as upstream's
 * tools spell them, for every CLI that validates: `wasm-validate`, and
 * `wat2wasm` since it validates by default (2026-09-29). One parser, so the two
 * cannot drift.
 *
 * The flags exist because the validator ENFORCES the feature set (T13.10):
 * without them a gated validator would reject any GC, threads, tail-call or EH
 * module from the command line with no way to opt in.
 *
 * The spellings are D2's (`./definitions`, `features.json`): `cli`, and any
 * `cliAliases`, still accepted but deprecated. They were derived from the
 * `Features` key (`satFloatToInt` → `sat-float-to-int`), which is not upstream's
 * `saturating-float-to-int` (open-work 33 / FL1, renamed 2026-10-24).
 *
 * @module
 */

import { defaultFeatures } from '../core/feature.ts';
import type { Features } from '../core/feature.ts';
import { FEATURE_DEFINITIONS } from '../definitions/mod.ts';

/** A feature set being built from flags, starting at upstream's defaults. */
export class FeatureFlags {
  readonly features: Features = defaultFeatures();
  private readonly byFlagName = new Map<string, keyof Features>();
  /** Deprecated spelling -> the one to use. */
  private readonly deprecated = new Map<string, string>();

  constructor() {
    for (const f of FEATURE_DEFINITIONS.entries) {
      const key = f.name as keyof Features;
      this.byFlagName.set(f.cli, key);
      for (const alias of f.cliAliases ?? []) {
        this.byFlagName.set(alias, key);
        this.deprecated.set(alias, f.cli);
      }
    }
  }

  /**
   * Applies `arg` when it is a feature flag. `true` when it was one (applied),
   * `'unknown'` for an `--enable-` / `--disable-` of no known feature, `false`
   * when it is not a feature flag at all. A deprecated spelling is applied, with
   * a warning on stderr naming the one to use.
   */
  apply(arg: string): boolean | 'unknown' {
    if (arg === '--enable-all') {
      for (const n of Object.keys(this.features) as (keyof Features)[]) this.features[n] = true;
      return true;
    }
    const m = /^--(enable|disable)-(.+)$/.exec(arg);
    if (m === null) return false;
    const key = this.byFlagName.get(m[2]!);
    if (key === undefined) return 'unknown';
    const instead = this.deprecated.get(m[2]!);
    if (instead !== undefined) {
      console.error(`warning: ${arg} is deprecated; use --${m[1]}-${instead}`);
    }
    this.features[key] = m[1] === 'enable';
    return true;
  }

  /** The line naming every flag, for a usage message. */
  help(): string {
    return 'features: --enable-all, or --enable-/--disable- one of:\n  ' +
      FEATURE_DEFINITIONS.entries.map((f) => f.cli).join(' ');
  }
}
