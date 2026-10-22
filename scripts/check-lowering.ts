// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The gate for `Memory64Lowering` (open-work 32): every spec module with a 64-bit memory or table,
 * LOWERED, must behave as the ORIGINAL does on V8 — on V8, and on JavaScriptCore, the engine the
 * lowering is for (Safari, Bun: "Memory64 is not enabled").
 *
 * **The oracle is the original, run by V8** (the referee, `scripts/v8.ts`): JavaScriptCore cannot
 * run it. Each module's invocations are replayed by `spec-behaviour`'s own `outcomes()` — `v128`
 * exports through their wrappers, imports as inert stand-ins, values by bits, traps by class — in
 * two child processes, `scripts/lowering/record.ts` under Node and under Bun. Then:
 *
 * - lowered on V8 must equal the original on V8, exactly;
 * - lowered on JavaScriptCore must equal it too, after two normalizations that are facts of
 *   JavaScriptCore's JS API, not of the module: a NaN that reaches JavaScript is compared as NaN
 *   (JavaScriptCore canonicalizes its payload; measured 2026-10-22 on plain 32-bit
 *   `float_memory.wast`, no lowering involved), and a module that fails to instantiate is
 *   compared by its failure's kind, not the engine's wording.
 *
 * A module the pass REFUSES fails the gate (none is expected in the spec corpus). Reported, not
 * failed: how many originals JavaScriptCore refuses — what the lowering is for.
 *
 * Usage: `bun run lowering <outDir>` (the corpus `bun run spec:prepare` wrote)
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readForPasses } from '../src/ir/prepare.ts';
import { writeWasm } from '../src/ir/write-wasm.ts';
import { PassRunner } from '../src/passes/index.ts';
import type { WasmModule } from '../src/ir/module.ts';
import { ExternalKind } from '../src/core/binary.ts';
import { collectInputs } from './spec-behaviour/collect.ts';
import type { Job, Recorded } from './lowering/record.ts';
import { nodeCommand, REFEREE } from './v8.ts';

/** Whether `m` has a 64-bit memory or table: the modules this gate is about. */
export function has64(m: WasmModule): boolean {
  const limits = [
    ...m.memories.map((x) => x.limits),
    ...m.tables.map((x) => x.limits),
    ...m.imports.flatMap((i) =>
      i.kind === ExternalKind.Memory
        ? [i.memory.limits]
        : i.kind === ExternalKind.Table
        ? [i.table.limits]
        : []
    ),
  ];
  return limits.some((l) => l.is64);
}

/** Whether `bits` (an f64's, as `show()` spells a number) is a NaN. */
function isNaNBits(bits: bigint): boolean {
  return ((bits >> 52n) & 0x7ffn) === 0x7ffn && (bits & ((1n << 52n) - 1n)) !== 0n;
}

/**
 * An outcome as JavaScriptCore's JS API lets it be compared: each NaN number as `n:NaN`, and a
 * module that does not instantiate by its kind (`INVALID` / `instantiation fails`) alone.
 */
export function forJsc(outcome: string): string {
  const m = /^(INVALID|instantiation fails): /.exec(outcome);
  if (m) return m[1]!;
  return outcome.replace(/n:(\d+)/g, (all, b: string) => (isNaNBits(BigInt(b)) ? 'n:NaN' : all));
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: bun run lowering <outDir>   (the corpus `bun run spec:prepare` wrote)');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  const work = mkdtempSync(join(tmpdir(), 'binaryang-lowering-'));
  const failures: string[] = [];
  const refused: string[] = [];
  let modules = 0, invocations = 0, v128 = 0, jscRefusesOriginal = 0;
  try {
    // 1. The modules with a 64-bit memory or table, lowered.
    const jobs: Job[] = [];
    mkdirSync(join(work, 'lowered'));
    for (const input of collectInputs(dir)) {
      const bytes = new Uint8Array(readFileSync(input.path));
      let m: WasmModule;
      try {
        m = readForPasses(bytes);
      } catch {
        continue; // not ours to judge: `bun run spec` does
      }
      if (!has64(m)) continue;
      try {
        new PassRunner(m, {}).add('Memory64Lowering').run();
      } catch (e) {
        refused.push(`${input.name}: ${(e as Error).message.split('\n')[0]}`);
        continue;
      }
      const lowered = join(work, 'lowered', `${jobs.length}.wasm`);
      writeFileSync(lowered, writeWasm(m));
      jobs.push({
        name: input.name,
        original: input.path,
        lowered,
        invokes: input.invokes,
        v128: input.v128 ?? [],
      });
    }
    const jobsPath = join(work, 'jobs.json');
    writeFileSync(jobsPath, JSON.stringify(jobs));

    // 2. Both engines' legs.
    const record = join(root, 'scripts', 'lowering', 'record.ts');
    const leg = (name: string, bin: string, args: string[]): Record<string, Recorded> => {
      const out = join(work, `${name}.json`);
      const r = spawnSync(bin, [...args, jobsPath, out], {
        cwd: root,
        encoding: 'utf8',
        timeout: 900_000,
      });
      if (r.status !== 0) {
        throw new Error(`${name} leg failed (exit ${r.status}): ${(r.stderr ?? '').slice(0, 300)}`);
      }
      return JSON.parse(readFileSync(out, 'utf8')) as Record<string, Recorded>;
    };
    const [nodeBin, nodeArgs] = nodeCommand(REFEREE, [], record, []);
    const v8 = leg('v8', nodeBin, nodeArgs);
    const jsc = leg('jsc', 'bun', [record]);

    // 3. Lowered, on each engine, against the original on V8.
    for (const j of jobs) {
      modules++;
      invocations += j.invokes.length;
      v128 += j.invokes.filter((i) => j.v128.some(([f]) => f === i.field)).length;
      const want = v8[j.name]!.original;
      if (/^INVALID: /.test(jsc[j.name]!.original[0] ?? '')) jscRefusesOriginal++;
      for (
        const [engine, got, norm] of [
          ['V8', v8[j.name]!.lowered, (s: string) => s],
          ['JavaScriptCore', jsc[j.name]!.lowered, forJsc],
        ] as const
      ) {
        const k = want.findIndex((w, i) => norm(got[i] ?? '') !== norm(w));
        if (k >= 0 || got.length !== want.length) {
          const at = k >= 0 ? k : Math.min(want.length, got.length);
          failures.push(`${j.name} on ${engine}: want «${want[at]}» got «${got[at]}»`);
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log(
    "  === Memory64Lowering: the spec's 64-bit modules, lowered, on V8 and JavaScriptCore ===",
  );
  console.log(`    modules                          ${modules}`);
  console.log(
    `    invocations                      ${invocations}   (${v128} through v128 wrappers)`,
  );
  console.log(
    `    originals JavaScriptCore refuses ${jscRefusesOriginal}   (what the lowering is for)`,
  );
  console.log(`    refused by the pass              ${refused.length}`);
  console.log(`    diverging (module × engine)      ${failures.length}`);
  for (const r of refused.slice(0, 20)) console.log(`      refused: ${r}`);
  for (const f of failures.slice(0, 30)) console.log(`      ${f}`);
  if (failures.length > 0 || refused.length > 0) process.exit(1);
  console.log(
    '\n  TOTAL — every lowered module behaves as its original does on V8, on both engines.',
  );
}
