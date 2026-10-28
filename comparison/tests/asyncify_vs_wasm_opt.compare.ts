/**
 * @module comparison/tests/asyncify_vs_wasm_opt
 *
 * Asyncify against upstream `wasm-opt --asyncify` (Binaryen v130) — the
 * authoritative oracle for the ABI TinyGo depends on. Moved out of
 * `tests/binaryen-ts/passes/` at 1.7.0 (owner, 2026-09-28: upstream is for
 * comparison, never the product or its gate); the native tests stayed there.
 *
 * Two differentials:
 *  - the ANALYZER: our instrument set against what
 *    `--pass-arg=asyncify-verbose` reports;
 *  - END TO END: upstream's asyncified output through the SAME unwind/rewind
 *    driver our own output passes (`asyncify_helpers.ts`).
 *
 * Skipped, loudly, where `wasm-opt` is not on PATH.
 *
 * @license MIT
 */

import { describe, it, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertEquals } from '@std/assert';

import {
  ADD_GET,
  driveOnce,
  IMPORT_CALL,
  INDIRECT,
  LOOP_GET,
  ourInstrumentSet,
  TRANSITIVE,
  TWO_IMPORTS,
} from '../../tests/binaryen-ts/passes/asyncify_helpers.ts';

const skip = spawnSync('wasm-opt', ['--version'], { stdio: 'ignore' }).status !== 0;
if (skip) {
  console.warn('comparison: wasm-opt not on PATH — the asyncify differentials are skipped');
}

/** Runs `use` with a fresh temporary directory, removed afterwards. */
function withTempDir<T>(use: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'binaryang-comparison-'));
  try {
    return use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The reference instrument set from `wasm-opt --asyncify --pass-arg=asyncify-verbose`.
 * Verbose prints one line per state-changing function; imported functions are
 * reported as "is an import ..." and are NOT instrumented.
 */
function wasmOptInstrumentSet(wat: string, passArgs: Record<string, string>): Set<string> {
  return withTempDir((dir) => {
    const inFile = join(dir, 'in.wat');
    writeFileSync(inFile, wat);
    const args = [
      inFile,
      '--asyncify',
      '--pass-arg=asyncify-verbose',
      '-S',
      '-o',
      join(dir, 'out.wat'),
    ];
    for (const [k, v] of Object.entries(passArgs)) {
      args.push(v === '' ? `--pass-arg=${k}` : `--pass-arg=${k}@${v}`);
    }
    const out = spawnSync('wasm-opt', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
    const text = out.stdout + out.stderr;
    const set = new Set<string>();
    for (const line of text.split('\n')) {
      const m = line.match(/^\[asyncify\]\s+(\S+)\s+can change the state/);
      if (m && !line.includes('is an import')) set.add(m[1]);
    }
    return set;
  });
}

function assertMatchesOracle(
  name: string,
  wat: string,
  passArgs: Record<string, string> = {},
): void {
  const ours = ourInstrumentSet(wat, passArgs);
  const ref = wasmOptInstrumentSet(wat, passArgs);
  assertEquals(
    [...ours].sort(),
    [...ref].sort(),
    `${name}: instrument set differs from wasm-opt oracle`,
  );
}

/** Upstream's `wasm-opt --asyncify` bytes for `wat`. */
function wasmOptAsyncify(wat: string): Uint8Array {
  return withTempDir((dir) => {
    const inFile = join(dir, 'in.wat');
    const outFile = join(dir, 'out.wasm');
    writeFileSync(inFile, wat);
    const out = spawnSync('wasm-opt', [inFile, '--asyncify', '-o', outFile], {
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
    if (out.status !== 0) throw new Error(`wasm-opt --asyncify failed: ${out.stderr}`);
    return new Uint8Array(readFileSync(outFile));
  });
}

// Six steps of one Deno test until 2026-10-28; `t.step` became a nested describe, as in the
// suite's own port (Bun migration B5).
describe('analyzer vs wasm-opt --asyncify (verbose)', { skip }, () => {
  it('import call', () => assertMatchesOracle('import call', IMPORT_CALL));
  it('transitive', () => assertMatchesOracle('transitive', TRANSITIVE));
  it('indirect (default)', () => assertMatchesOracle('indirect', INDIRECT));
  it(
    'ignore-indirect',
    () => assertMatchesOracle('ignore-indirect', INDIRECT, { 'asyncify-ignore-indirect': '' }),
  );
  it(
    'ignore-imports',
    () => assertMatchesOracle('ignore-imports', IMPORT_CALL, { 'asyncify-ignore-imports': '' }),
  );
  it(
    'imports list',
    () => assertMatchesOracle('imports list', TWO_IMPORTS, { 'asyncify-imports': 'env.sleep' }),
  );
});

test('e2e: upstream --asyncify through our driver (x + get())', { skip }, () => {
  assertEquals(driveOnce(wasmOptAsyncify(ADD_GET), 'compute', [10], 'get', 42), 52);
});

test('e2e: upstream --asyncify through our driver (loop)', { skip }, () => {
  assertEquals(driveOnce(wasmOptAsyncify(LOOP_GET), 'sum', [3], 'get', 7), 21);
});
