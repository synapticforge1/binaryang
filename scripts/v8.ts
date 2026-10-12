// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Runs a script on the V8 REFEREE: the Node that judges WebAssembly for the engine-oracle steps
 * (owner, 2026-10-12: Deno is kept for JSR, "not the V8 items"; cmem/bun-migration.md § "The
 * engine oracle").
 *
 * Those steps use the host engine as an oracle (`WebAssembly.validate` / `Module` / `Instance`),
 * so WHICH engine runs them decides what they find. Bun's engine is JavaScriptCore (it differed
 * from V8 on 300 of 6,753 corpus modules), so they cannot run on Bun, and this machine's default
 * `node` may be any LTS (Node 22's V8 12.4 fails the behaviour gate). So the referee is named HERE,
 * once, and run through fnm, never taken from PATH.
 *
 * Measured 2026-10-12: Node 24 (V8 13.6) gives Deno 2.9.7's exact results on every oracle step,
 * and Node 26 (V8 14.6) gives them on custom-descriptors, which Node 24's V8 is too old for. Raise
 * {@link REFEREE} to a newer LTS after measuring it the same way (validate the whole corpus on old
 * and new, diff the verdicts, then run the behaviour gates).
 *
 * ```sh
 * bun scripts/v8.ts scripts/check-spec-behaviour.ts <corpus>      # on the referee
 * bun scripts/v8.ts --node=26 --v8=--experimental-wasm-x <script>  # a given major, V8 flags
 * ```
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** The Node major whose V8 referees the engine-oracle steps. */
export const REFEREE = 24;

/** The command that runs `script args` on Node `major` with V8 `flags`, through fnm. */
export function nodeCommand(
  major: number,
  flags: readonly string[],
  script: string,
  args: readonly string[],
): [string, string[]] {
  return ['fnm', ['exec', `--using=${major}`, 'node', '--no-warnings', ...flags, script, ...args]];
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let major = REFEREE;
  const flags: string[] = [];
  while (argv[0]?.startsWith('--node=') || argv[0]?.startsWith('--v8=')) {
    const a = argv.shift()!;
    if (a.startsWith('--node=')) major = Number(a.slice('--node='.length));
    else flags.push(a.slice('--v8='.length));
  }
  const script = argv.shift();
  if (script === undefined || !Number.isInteger(major)) {
    console.error('usage: bun scripts/v8.ts [--node=<major>] [--v8=<flag>]... <script> [args...]');
    process.exit(2);
  }
  if (spawnSync('fnm', ['--version'], { stdio: 'ignore' }).status !== 0) {
    console.error(
      'the engine-oracle steps run on Node through fnm (https://fnm.vercel.app): install fnm, then ' +
        `\`fnm install ${major}\``,
    );
    process.exit(2);
  }
  const [bin, args] = nodeCommand(major, flags, script, argv);
  const r = spawnSync(bin, args, { stdio: 'inherit' });
  if (r.status === null) process.exit(1);
  process.exit(r.status);
}
