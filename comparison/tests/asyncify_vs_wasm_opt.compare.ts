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

async function haveWasmOpt(): Promise<boolean> {
  try {
    const p = new Deno.Command('wasm-opt', { args: ['--version'], stdout: 'null', stderr: 'null' });
    return (await p.output()).success;
  } catch {
    return false;
  }
}
const ignore = !(await haveWasmOpt());
if (ignore) {
  console.warn('comparison: wasm-opt not on PATH — the asyncify differentials are skipped');
}

/**
 * The reference instrument set from `wasm-opt --asyncify --pass-arg=asyncify-verbose`.
 * Verbose prints one line per state-changing function; imported functions are
 * reported as "is an import ..." and are NOT instrumented.
 */
async function wasmOptInstrumentSet(
  wat: string,
  passArgs: Record<string, string>,
): Promise<Set<string>> {
  const inFile = await Deno.makeTempFile({ suffix: '.wat' });
  const outFile = await Deno.makeTempFile({ suffix: '.wat' });
  try {
    await Deno.writeTextFile(inFile, wat);
    const args = [inFile, '--asyncify', '--pass-arg=asyncify-verbose', '-S', '-o', outFile];
    for (const [k, v] of Object.entries(passArgs)) {
      args.push(v === '' ? `--pass-arg=${k}` : `--pass-arg=${k}@${v}`);
    }
    const out = await new Deno.Command('wasm-opt', { args, stdout: 'piped', stderr: 'piped' })
      .output();
    const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
    const set = new Set<string>();
    for (const line of text.split('\n')) {
      const m = line.match(/^\[asyncify\]\s+(\S+)\s+can change the state/);
      if (m && !line.includes('is an import')) set.add(m[1]);
    }
    return set;
  } finally {
    await Deno.remove(inFile).catch(() => {});
    await Deno.remove(outFile).catch(() => {});
  }
}

async function assertMatchesOracle(
  name: string,
  wat: string,
  passArgs: Record<string, string> = {},
): Promise<void> {
  const ours = ourInstrumentSet(wat, passArgs);
  const ref = await wasmOptInstrumentSet(wat, passArgs);
  assertEquals(
    [...ours].sort(),
    [...ref].sort(),
    `${name}: instrument set differs from wasm-opt oracle`,
  );
}

/** Upstream's `wasm-opt --asyncify` bytes for `wat`. */
function wasmOptAsyncify(wat: string): Uint8Array {
  const inFile = Deno.makeTempFileSync({ suffix: '.wat' });
  const outFile = Deno.makeTempFileSync({ suffix: '.wasm' });
  try {
    Deno.writeTextFileSync(inFile, wat);
    const out = new Deno.Command('wasm-opt', {
      args: [inFile, '--asyncify', '-o', outFile],
      stdout: 'null',
      stderr: 'piped',
    }).outputSync();
    if (!out.success) {
      throw new Error(`wasm-opt --asyncify failed: ${new TextDecoder().decode(out.stderr)}`);
    }
    return Deno.readFileSync(outFile);
  } finally {
    Deno.removeSync(inFile);
    Deno.removeSync(outFile);
  }
}

Deno.test({
  name: 'analyzer vs wasm-opt --asyncify (verbose)',
  ignore,
  async fn(t) {
    await t.step('import call', () => assertMatchesOracle('import call', IMPORT_CALL));
    await t.step('transitive', () => assertMatchesOracle('transitive', TRANSITIVE));
    await t.step('indirect (default)', () => assertMatchesOracle('indirect', INDIRECT));
    await t.step(
      'ignore-indirect',
      () => assertMatchesOracle('ignore-indirect', INDIRECT, { 'asyncify-ignore-indirect': '' }),
    );
    await t.step(
      'ignore-imports',
      () => assertMatchesOracle('ignore-imports', IMPORT_CALL, { 'asyncify-ignore-imports': '' }),
    );
    await t.step(
      'imports list',
      () => assertMatchesOracle('imports list', TWO_IMPORTS, { 'asyncify-imports': 'env.sleep' }),
    );
  },
});

Deno.test({
  name: 'e2e: upstream --asyncify through our driver (x + get())',
  ignore,
  fn() {
    assertEquals(driveOnce(wasmOptAsyncify(ADD_GET), 'compute', [10], 'get', 42), 52);
  },
});

Deno.test({
  name: 'e2e: upstream --asyncify through our driver (loop)',
  ignore,
  fn() {
    assertEquals(driveOnce(wasmOptAsyncify(LOOP_GET), 'sum', [3], 'get', 7), 21);
  },
});
