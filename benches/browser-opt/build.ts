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
 * `--wasm64` builds ONLY the memory64 modules (open-work 32: real compiler output for
 * `Memory64Lowering`), into ./modules64, leaving the six above untouched: the same workload for
 * Rust nightly `wasm64-unknown-unknown` (tier 3: `-Zbuild-std`) and Zig `wasm64-freestanding`,
 * release builds only (Rust's debug build is 7 MB). Each has a 64-bit memory and a 64-bit table.
 * Emscripten (`-O2 -m64`, ./src/c; the same bytes as the deprecated `-sMEMORY64=1`) gives two more: a standalone module, and a PROGRAM
 * with Emscripten's own JS glue (`.cjs`, the package being `"type": "module"`) that grows its
 * memory — the glue is part of what is tested. Emscripten is found through `$EMSDK` (set by
 * `emsdk_env`).
 *
 *   bun benches/browser-opt/build.ts            # the six 32-bit modules
 *   bun benches/browser-opt/build.ts --wasm64   # the memory64 modules
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

if (process.argv.includes('--wasm64')) {
  const out64 = join(here, 'modules64');
  mkdirSync(out64, { recursive: true });
  try {
    console.log(
      `rustc nightly: ${
        spawnSync('rustc', ['+nightly', '--version'], { encoding: 'utf8' }).stdout.trim()
      }`,
    );
    console.log(`zig: ${version('zig', 'version')}`);
    // Rust: wasm64 is tier 3, so std is built for it (`-Zbuild-std`, nightly). The target dir is
    // outside the repo, under the system temp dir: a long path breaks the build scripts on Windows.
    const target = join(tmp, 'cargo64');
    run(
      'cargo +nightly build --release (wasm64)',
      'cargo',
      [
        '+nightly',
        'build',
        '--release',
        '--target',
        'wasm64-unknown-unknown',
        '-Zbuild-std=std,panic_abort',
      ],
      join(here, 'src', 'rust'),
      { CARGO_TARGET_DIR: target },
    );
    copyFileSync(
      join(target, 'wasm64-unknown-unknown', 'release', 'browser_opt_workload.wasm'),
      join(out64, 'rust-release-wasm64.wasm'),
    );
    run('zig ReleaseFast (wasm64)', 'zig', [
      'build-exe',
      join(here, 'src', 'zig', 'run.zig'),
      '-target',
      'wasm64-freestanding',
      '-fno-entry',
      '-rdynamic',
      '-O',
      'ReleaseFast',
      `-femit-bin=${join(out64, 'zig-releasefast-wasm64.wasm')}`,
      '--cache-dir',
      join(tmp, 'zig-cache64'),
    ]);
    // Emscripten: on Windows `emcc` is a .bat, which spawnSync runs only through cmd.exe, and
    // cmd.exe mangles quoted arguments; emsdk's `emcc.exe` launcher beside it is run directly.
    const emsdk = process.env['EMSDK'];
    if (emsdk === undefined) {
      console.error('✗ EMSDK is not set (run emsdk_env first)');
      process.exit(1);
    }
    const emcc = join(
      emsdk,
      'upstream',
      'emscripten',
      process.platform === 'win32' ? 'emcc.exe' : 'emcc',
    );
    console.log(`emcc: ${version(emcc, '--version')}`);
    const c = join(here, 'src', 'c');
    run('emcc -O2 -m64 (standalone)', emcc, [
      join(c, 'workload.c'),
      '-O2',
      '-m64',
      '--no-entry',
      '-sSTANDALONE_WASM',
      '-sEXPORTED_FUNCTIONS=_run',
      '-o',
      join(out64, 'emcc-o2-wasm64.wasm'),
    ]);
    run('emcc -O2 -m64 (program, JS glue, memory growth)', emcc, [
      join(c, 'workload.c'),
      join(c, 'program.c'),
      '-O2',
      '-m64',
      '-sENVIRONMENT=node',
      '-sALLOW_MEMORY_GROWTH=1',
      '-o',
      join(out64, 'emcc-o2-program-wasm64.cjs'),
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  for (
    const n of [
      'rust-release-wasm64.wasm',
      'zig-releasefast-wasm64.wasm',
      'emcc-o2-wasm64.wasm',
      'emcc-o2-program-wasm64.wasm',
      'emcc-o2-program-wasm64.cjs',
    ]
  ) {
    console.log(`${n}: ${statSync(join(out64, n)).size} bytes`);
  }
  process.exit(0);
}

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
