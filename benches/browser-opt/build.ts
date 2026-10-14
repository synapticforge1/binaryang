// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Builds the browser-optimization test modules (open-work 28.6; owner: "commit as test modules")
 * from ./src into ./modules: one workload, `run(n) -> i32`, from three toolchains, each in an
 * unoptimized and an optimized form. Plain wasm (no WASI), so a page runs it with no imports.
 *
 * The toolchains are NOT in CI: the modules are committed, and this script is how they were made
 * (its output names the versions). Rebuild only on purpose; the measurement's table cites them.
 *
 *   bun benches/browser-opt/build.ts
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, 'modules');
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'binaryang-browser-opt-'));

function run(
  label: string,
  cmd: string,
  args: string[],
  cwd = here,
  env: Record<string, string> = {},
): void {
  console.log(`$ ${label}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`✗ ${label}: exit ${r.status ?? r.error?.message}`);
    process.exit(1);
  }
}
const version = (cmd: string, arg: string) =>
  spawnSync(cmd, [arg], { encoding: 'utf8' }).stdout.split('\n')[0]!.trim();

try {
  console.log(`rustc: ${version('rustc', '--version')}`);
  console.log(`zig: ${version('zig', 'version')}`);
  console.log(`tinygo: ${version('tinygo', 'version')}`);

  // Rust: wasm32-unknown-unknown, debug and release (opt-level 3, LTO), target dir outside the repo.
  const rust = join(here, 'src', 'rust');
  const target = join(tmp, 'cargo');
  for (const [profile, flag] of [['debug', []], ['release', ['--release']]] as const) {
    run(
      `cargo build ${profile}`,
      'cargo',
      ['build', '--target', 'wasm32-unknown-unknown', ...flag],
      rust,
      {
        CARGO_TARGET_DIR: target,
      },
    );
    copyFileSync(
      join(target, 'wasm32-unknown-unknown', profile, 'browser_opt_workload.wasm'),
      join(out, `rust-${profile}.wasm`),
    );
  }

  // Zig: wasm32-freestanding, Debug and ReleaseFast; no entry point, the exports kept.
  for (
    const [mode, name] of [['Debug', 'zig-debug'], ['ReleaseFast', 'zig-releasefast']] as const
  ) {
    run(`zig ${mode}`, 'zig', [
      'build-exe',
      join(here, 'src', 'zig', 'run.zig'),
      '-target',
      'wasm32-freestanding',
      '-fno-entry',
      '-rdynamic',
      '-O',
      mode,
      `-femit-bin=${join(out, `${name}.wasm`)}`,
      '--cache-dir',
      join(tmp, 'zig-cache'),
    ]);
  }

  // TinyGo: the plain-wasm target, -opt=1 and -opt=z (size, TinyGo's default for wasm). Not -opt=0:
  // TinyGo 0.43 cannot build `wasm-unknown` there (its reactor entry keeps a goroutine start inside
  // `if hasScheduler`, unfolded at -opt=0, which `scheduler: none` refuses), so -opt=1, the least
  // optimization that builds, is TinyGo's unoptimized input.
  for (const [opt, name] of [['1', 'tinygo-opt1'], ['z', 'tinygo-optz']] as const) {
    run(`tinygo -opt=${opt}`, 'tinygo', [
      'build',
      '-o',
      join(out, `${name}.wasm`),
      '-target=wasm-unknown',
      `-opt=${opt}`,
      '-no-debug',
      join(here, 'src', 'tinygo', 'main.go'),
    ]);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
for (
  const n of [
    'rust-debug',
    'rust-release',
    'zig-debug',
    'zig-releasefast',
    'tinygo-opt1',
    'tinygo-optz',
  ]
) {
  console.log(`${n}.wasm: ${statSync(join(out, `${n}.wasm`)).size} bytes`);
}
