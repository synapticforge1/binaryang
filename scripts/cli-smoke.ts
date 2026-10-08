// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Exercises every dispatcher command under one runtime and prints the sha256
 * of the `wat2wasm` output, which the caller compares across runtimes — the
 * same bytes on every supported runtime is the actual claim (README "Runtime
 * support").
 *
 * The argument is the runtime invocation that runs `main.ts`:
 *
 * ```sh
 * deno run -A scripts/cli-smoke.ts "deno run -A"
 * node --experimental-transform-types scripts/cli-smoke.ts "node --experimental-transform-types"
 * bun scripts/cli-smoke.ts "bun"
 * ```
 *
 * ⚠️ This script runs on ALL FOUR supported runtimes (CI runs it under the one
 * it is testing, where Deno may not be installed), so it uses `node:` builtins
 * only — never `Deno.*` — and only erasable TypeScript: no enums, no parameter
 * properties.
 *
 * Node needs `--experimental-transform-types`, NOT `--experimental-strip-types`:
 * strip-only mode erases types without generating code, so it rejects
 * TypeScript enums (`src/` has dozens) and parameter properties. Both
 * predecessors documented the strip flag, and their CLI therefore never ran on
 * Node at all.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const WAT = `(module
  (func (export "add") (param i32 i32) (result i32)
    (i32.add (local.get 0) (local.get 1))))
`;

const invocation = (process.argv[2] ?? '').trim().split(/\s+/).filter((w) => w !== '');
const [runtime, ...runtimeArgs] = invocation;
if (runtime === undefined) {
  console.error(`usage: cli-smoke.ts '<runtime invocation>'`);
  process.exit(2);
}

/** Runs `main.ts <args>` under the runtime; its exit status (stdout discarded). */
function cli(args: string[], stderr: 'inherit' | 'ignore' = 'inherit'): number | null {
  const r = spawnSync(runtime!, [...runtimeArgs, 'main.ts', ...args], {
    stdio: ['ignore', 'ignore', stderr],
  });
  if (r.error) throw new Error(`could not start ${runtime}: ${r.error.message}`);
  return r.status;
}

function must(args: string[]): void {
  const status = cli(args);
  if (status !== 0) throw new Error(`main.ts ${args[0]} exited ${status}`);
}

const d = mkdtempSync(join(tmpdir(), 'cli-smoke-'));
let hash = '';
try {
  const f = (name: string) => join(d, name);
  writeFileSync(f('t.wat'), WAT);

  must(['--version']);
  must(['wat2wasm', f('t.wat'), '-o', f('t.wasm')]);
  must(['wasm-validate', f('t.wasm')]);
  must(['wasm2wat', f('t.wasm'), '-o', f('t.rt.wat')]);
  must(['wasm-objdump', f('t.wasm')]);
  copyFileSync(f('t.wasm'), f('s.wasm'));
  must(['wasm-strip', f('s.wasm')]);
  must(['wasm-opt', f('t.wasm'), '-o', f('o.wasm'), '-Oz']);
  must(['wasm-interp', f('t.wasm'), '--run-export=add', '--argument=2', '--argument=3']);
  must([
    'wasm-ctor-eval',
    f('t.wasm'),
    '-o',
    f('c.wasm'),
    '--ctors=add',
    '--ignore-external-input',
    '-q',
  ]);
  // wasm2ts is a deliberate stub: it must exit non-zero with a one-line message.
  if (cli(['wasm2ts', f('t.wasm')], 'ignore') === 0) {
    throw new Error('wasm2ts unexpectedly succeeded');
  }

  for (const name of ['t.wasm', 's.wasm', 'o.wasm']) {
    let size = 0;
    try {
      size = statSync(f(name)).size;
    } catch { /* missing counts as empty */ }
    if (size === 0) throw new Error(`empty output: ${name}`);
  }
  hash = createHash('sha256').update(readFileSync(f('t.wasm'))).digest('hex');
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  rmSync(d, { recursive: true, force: true });
}
// The hash the caller compares across runtimes.
if (hash !== '') console.log(hash);
