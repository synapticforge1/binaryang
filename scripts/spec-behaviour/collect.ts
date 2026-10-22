// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The spec corpus `bun run spec:prepare` wrote, as differential inputs: every binary module with
 * invocations after it, in manifest order. Shared by `check-spec-behaviour.ts` and
 * `check-lowering.ts` (open-work 32), so both replay exactly the same invocations.
 */

import { readdirSync, readFileSync } from 'node:fs';
import type { Invoke, SpecInput } from './differential.ts';
import { needsWrapper, type Sig } from './v128.ts';

/** Every binary module with invocations after it, in manifest order; names start with `prefix`. */
export function collectInputs(root: string, prefix = ''): SpecInput[] {
  const inputs: SpecInput[] = [];
  const dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) =>
    e.name
  ).sort();
  for (const d of dirs) {
    let manifest: { commands: Record<string, unknown>[] };
    try {
      manifest = JSON.parse(readFileSync(`${root}/${d}/${d}.json`, 'utf8'));
    } catch {
      continue;
    }
    const cmds = manifest.commands;
    for (const [i, c] of cmds.entries()) {
      const file = c['filename'] as string | undefined;
      if (c['type'] !== 'module' || !file?.endsWith('.wasm')) continue;
      const invokes: Invoke[] = [];
      // Each export's signature as the manifest shows it: its arguments'
      // types, and an `assert_return`'s expected types — borrowed by an
      // invocation of the same export that shows no results (`assert_trap`).
      const sigs = new Map<string, Sig>();
      for (const later of cmds.slice(i + 1)) {
        if (later['type'] === 'module') break;
        const a = later['action'] as
          | { type: string; module?: string; field: string; args: Invoke['args'] }
          | undefined;
        // An invocation of a NAMED module is another module's; skip it.
        if (a?.type !== 'invoke' || a.module !== undefined) continue;
        invokes.push({ line: later['line'] as number, field: a.field, args: a.args });
        const expected = later['expected'] as { type: string }[] | undefined;
        if (later['type'] === 'assert_return' && expected !== undefined && !sigs.has(a.field)) {
          sigs.set(a.field, {
            params: a.args.map((x) => x.type),
            results: expected.map((x) => x.type),
          });
        }
      }
      if (invokes.length > 0) {
        const v128 = [...sigs].filter(([, sig]) => needsWrapper(sig));
        inputs.push({
          name: `${prefix}${d}/${file}`,
          path: `${root}/${d}/${file}`,
          invokes,
          ...(v128.length > 0 ? { v128 } : {}),
        });
      }
    }
  }
  return inputs;
}
