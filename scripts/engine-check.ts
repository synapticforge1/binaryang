// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * Put a directory of `.wasm` files to all three engines and report where they
 * disagree.
 *
 * The panel, and why it is three (see CLAUDE.md, "Oracle rule"):
 *
 * - **Wasmtime — the AUTHORITY.** Bytecode Alliance write the spec and its
 *   reference tooling. Where engines disagree, its answer is the one wabt-ts
 *   must match.
 * - **V8 — the fast oracle.** In-process, no subprocess, no temp files. What
 *   the routine harnesses use. A second opinion, never the ruling.
 * - **Wasmer — the divergence detector.** Different default feature set and a
 *   different error vocabulary, so it disagrees for *different reasons*.
 *
 * Run all three even when the first two agree. On the check that prompted this
 * script V8 and Wasmtime both returned a flat 73/73 accept — no information
 * beyond "no disagreement" — while Wasmer's 21 rejections classified the
 * modules by the proposal each one needed. None of that was a validity ruling,
 * but it was the only data the exercise produced.
 *
 * Usage:
 *
 * ```sh
 * deno task engine-check path/to/dir-of-wasm
 * ```
 *
 * Missing engines are reported and skipped rather than failing the run, so
 * this still does something useful on a machine with only one installed.
 */

import { join } from 'jsr:@std/path@^1.0.0';

/**
 * Proposals to enable, listed explicitly.
 *
 * NOT `-W all-proposals=y`: on a stock Windows Wasmtime that pulls in
 * `stack-switching`, which the compiler configuration does not support, and
 * every module then fails for a reason that has nothing to do with the module.
 * A default-off feature is not a spec opinion either — every one of Wasmer's
 * 21 "rejections" in the original run was a feature gate.
 */
const WASMTIME_FEATURES = [
  'gc=y',
  'function-references=y',
  'exceptions=y',
  'memory64=y',
  'multi-memory=y',
  'threads=y',
  'relaxed-simd=y',
  'tail-call=y',
  'extended-const=y',
  'custom-page-sizes=y',
  'wide-arithmetic=y',
].join(',');

/** One engine's verdict on one module. */
interface Verdict {
  accepted: boolean;
  /** Short reason when rejected, for grouping. */
  reason: string;
}

type Engine = (wasm: Uint8Array, path: string, scratch: string) => Promise<Verdict | null>;

async function have(bin: string): Promise<boolean> {
  try {
    const c = new Deno.Command(bin, { args: ['--version'], stdout: 'null', stderr: 'null' });
    return (await c.output()).success;
  } catch {
    return false;
  }
}

const v8: Engine = (wasm) => {
  const buf = new ArrayBuffer(wasm.byteLength);
  new Uint8Array(buf).set(wasm);
  try {
    new WebAssembly.Module(buf);
    return Promise.resolve({ accepted: true, reason: '' });
  } catch (e) {
    return Promise.resolve({
      accepted: false,
      reason: String(e).replace(/^CompileError: WebAssembly.Module\(\): /, '').slice(0, 80),
    });
  }
};

const wasmtime: Engine = async (_wasm, path, scratch) => {
  // A UNIQUE output path per module. Reusing one made three modules report
  // "failed to write output", which an earlier hand-rolled harness scored as a
  // rejection — I/O collisions, not validation failures.
  const out = join(scratch, `${crypto.randomUUID()}.cwasm`);
  const cmd = new Deno.Command('wasmtime', {
    args: ['compile', '-W', WASMTIME_FEATURES, path, '-o', out],
    stdout: 'null',
    stderr: 'piped',
  });
  const { success, stderr } = await cmd.output();
  try {
    Deno.removeSync(out);
  } catch { /* never created */ }
  const err = new TextDecoder().decode(stderr).replace(/\s+/g, ' ').trim();
  if (/failed to write output/.test(err)) {
    throw new Error(`wasmtime could not write its output — check the scratch dir: ${err}`);
  }
  return { accepted: success, reason: err.slice(0, 80) };
};

const wasmer: Engine = async (_wasm, path) => {
  const cmd = new Deno.Command('wasmer', {
    args: ['validate', path],
    stdout: 'piped',
    stderr: 'piped',
  });
  const { stdout, stderr } = await cmd.output();
  const out = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
  if (/Validation passed/.test(out)) return { accepted: true, reason: '' };
  const m = /Validation error: (.{0,80})/.exec(out.replace(/\s+/g, ' '));
  return { accepted: false, reason: (m?.[1] ?? out.replace(/\s+/g, ' ')).slice(0, 80) };
};

const ENGINES: ReadonlyArray<readonly [string, Engine, string]> = [
  ['wasmtime', wasmtime, 'AUTHORITY'],
  ['v8', v8, 'fast oracle'],
  ['wasmer', wasmer, 'divergence detector'],
];

/**
 * A module every engine MUST reject. Run first: an all-accept result proves
 * nothing until the harness has been shown to reject something.
 */
const KNOWN_BAD = Uint8Array.from(
  (
    '0061736d 01000000' + // magic + version
    '01 05 01 60 00 01 7f' + // type:  () -> i32
    '03 02 01 00' + // func:  one function, type 0
    '0a 06 01 04 00 42 01 0b' // code:  i64.const 1; end   <- wrong result type
  ).replace(/\s/g, '').match(/../g)!.map((h) => parseInt(h, 16)),
);

async function main(): Promise<void> {
  const dir = Deno.args[0];
  if (dir === undefined) {
    console.error('usage: deno task engine-check <dir-of-wasm>');
    Deno.exit(2);
  }

  const scratch = Deno.makeTempDirSync({ prefix: 'engine-check-' });
  const badPath = join(scratch, 'known-bad.wasm');
  Deno.writeFileSync(badPath, KNOWN_BAD);

  const active: Array<readonly [string, Engine, string]> = [];
  for (const entry of ENGINES) {
    const [name, fn] = entry;
    if (name !== 'v8' && !(await have(name))) {
      console.log(`skipping ${name} — not installed`);
      continue;
    }
    const v = await fn(KNOWN_BAD, badPath, scratch);
    if (v === null || v.accepted) {
      console.error(
        `ABORT: ${name} ACCEPTED the known-invalid self-test module. ` +
          `The harness cannot detect a rejection, so any result would be meaningless.`,
      );
      Deno.exit(1);
    }
    active.push(entry);
  }
  if (active.length === 0) {
    console.error('no engines available');
    Deno.exit(1);
  }
  console.log(`self-test passed for: ${active.map(([n]) => n).join(', ')}\n`);

  const files = [...Deno.readDirSync(dir)]
    .filter((e) => e.name.endsWith('.wasm'))
    .map((e) => e.name)
    .sort();

  const tally = new Map<string, { ok: number; no: number; reasons: Map<string, number> }>();
  for (const [name] of active) tally.set(name, { ok: 0, no: 0, reasons: new Map() });
  /** Modules where the engines did not all agree. */
  const disagreements: string[] = [];

  for (const f of files) {
    const path = join(dir, f);
    const wasm = Deno.readFileSync(path);
    const verdicts = new Map<string, boolean>();
    for (const [name, fn] of active) {
      const v = await fn(wasm, path, scratch);
      if (v === null) continue;
      const t = tally.get(name)!;
      if (v.accepted) t.ok++;
      else {
        t.no++;
        t.reasons.set(v.reason, (t.reasons.get(v.reason) ?? 0) + 1);
      }
      verdicts.set(name, v.accepted);
    }
    const values = [...verdicts.values()];
    if (values.some((x) => x !== values[0])) {
      disagreements.push(
        `${f}: ${[...verdicts].map(([n, a]) => `${n}=${a ? 'accept' : 'reject'}`).join(' ')}`,
      );
    }
  }

  console.log(`${files.length} modules\n`);
  for (const [name, , role] of active) {
    const t = tally.get(name)!;
    console.log(`${name} (${role}): ${t.ok} accepted, ${t.no} rejected`);
    for (const [reason, n] of [...t.reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`    ${String(n).padStart(4)}  ${reason}`);
    }
  }

  console.log(`\ndisagreements: ${disagreements.length}`);
  for (const d of disagreements.slice(0, 40)) console.log(`  ${d}`);
  if (disagreements.length > 40) console.log(`  … ${disagreements.length - 40} more`);
  console.log(
    disagreements.length === 0
      ? '\nAll engines agree. Wasmtime is the authority either way.'
      : '\nWASMTIME decides each of the above. See CLAUDE.md, "Oracle rule".',
  );

  try {
    Deno.removeSync(scratch, { recursive: true });
  } catch { /* leave it */ }
}

if (import.meta.main) await main();
