// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Re-measures D4, the `portable` profile (open-work 34 a; cmem/portability.md), and compares the
 * measurement with `src/definitions/profiles.json`. LOCAL ONLY: it needs the engines installed, so
 * CI does not run it; run it when an engine releases, and before changing D4.
 *
 *   bun run probe <work dir> [executor,…]     # e.g. bun run probe ../scratch/probe wasmtime,node
 *
 * 1. Builds the probe modules (`modules.ts`: 785 on 2026-10-24) into `<work>/originals`.
 * 2. Runs them on every executor (`engines.ts`) and asks each its build.
 * 3. **Conformance:** a module that states its result (a value or a trap) must produce it on every
 *    executor that runs it; modules that do not must give one value on every defining engine
 *    (relaxed SIMD excepted: its results depend on the hardware, which is why it is lowered).
 * 4. **The lowered tier:** every original through `wasmOpt(…, { target: 'portable' })` — refused
 *    exactly when it needs an excluded feature or instruction, also accepted at `-O2` — and the
 *    outputs run on every defining engine with the original's agreed outcome.
 * 5. **D4:** per feature and per listed instruction, the defining engines refusing a module, the
 *    tier that follows, and the probe count, against `profiles.json`. An instruction is counted
 *    where its mnemonic is in a module's bytes; a feature's `refusedBy` leaves out the modules
 *    holding a listed instruction (D4's rule). A refusal outside D4's lists is reported.
 *
 * Writes `<work>/report.json`. Exit 0: D4 holds on every defining engine; 1: a difference or a
 * wrong result; 3: D4 holds on what was measured, but a defining engine was not measured.
 * Interpreters (`wasm-interp`, binaryang) are reported, not defining.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { profileDefinition } from '../../src/definitions/mod.ts';
import { wasmOpt } from '../../src/tools/wasm-opt.ts';
import { type Executor, executors, type Result } from './engines.ts';
import { buildModules, type ProbeModule } from './modules.ts';

const [work, only] = process.argv.slice(2);
if (work === undefined || work.startsWith('-')) {
  console.error('usage: bun run probe <work dir> [executor,…]');
  process.exit(2);
}
const D4 = profileDefinition('portable')!;
const D1 = (JSON.parse(
  readFileSync(new URL('../../src/definitions/opcodes.json', import.meta.url), 'utf8'),
) as {
  entries: { name: string; feature: string | null }[];
}).entries;
type Results = Record<string, Record<string, Result>>;
const differences: string[] = [];
const wrong: string[] = [];
const reported: string[] = [];

// ---- 1. the modules ----
const ORIG = `${work}/originals`;
const { index, problems } = buildModules(ORIG);
console.log(`modules: ${index.length}${problems.length ? `, ${problems.length} PROBLEM(S)` : ''}`);
for (const p of problems) console.log(`  ✗ ${p}`);
if (problems.length > 0) process.exit(1);
const byFile = new Map(index.map((m) => [m.file, m]));

// ---- 2. the executors ----
const want = only ? new Set(only.split(',')) : null;
const all = executors((file) => byFile.get(file)?.feature ?? '').filter((x) =>
  want === null || want.has(x.id)
);
const measured: Executor[] = [];
const builds: Record<string, string> = {};
for (const x of all) {
  const b = await x.build();
  if (b === null) console.log(`  — ${x.id}: not installed, not measured`);
  else measured.push(x);
}
async function runAll(dir: string, files: string[]): Promise<Results> {
  const results: Results = {};
  for (const x of measured) {
    const t0 = Date.now();
    // An executor that fails as a whole is a result for every module, not the end of the probe.
    const r = await x.run(dir, files).catch((e: unknown) => {
      const m = `the executor failed: ${(e as Error)?.message ?? e}`;
      return new Map(files.map((f): [string, Result] => [f, { s: 'error', m }]));
    });
    for (const f of files) (results[f] ??= {})[x.id] = r.get(f) ?? { s: 'error', m: 'no result' };
    builds[x.engine] = (await x.build()) ?? '?';
    const c: Record<string, number> = {};
    for (const f of files) c[results[f]![x.id]!.s] = (c[results[f]![x.id]!.s] ?? 0) + 1;
    console.log(
      `  ${x.id.padEnd(18)} ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s  ${
        JSON.stringify(c)
      }`,
    );
  }
  return results;
}
console.log('originals:');
const results = await runAll(ORIG, index.map((m) => m.file));
const defining = measured.filter((x) => x.defining);
const engineOf = new Map(measured.map((x) => [x.id, x.engine]));

// ---- 3. conformance ----
const show = (
  r: Result,
) => (r.s === 'ok' ? r.v! : r.s === 'trap' ? 'trap' : `${r.s}: ${(r.m ?? '').slice(0, 80)}`);
const agreed = new Map<string, string>(); // file -> the outcome every defining engine that ran it gave
for (const m of index) {
  const per = results[m.file]!;
  if (m.expect !== undefined) {
    for (const x of measured) {
      const r = per[x.id]!;
      if (r.s === 'refused') continue;
      const ok = m.expect === 'trap' ? r.s === 'trap' : r.s === 'ok' && r.v === m.expect;
      if (!ok) {
        (x.defining ? wrong : reported).push(
          `${m.file} on ${x.id}: expected ${m.expect}, got ${show(r)}`,
        );
      }
    }
    agreed.set(m.file, m.expect);
    continue;
  }
  const outcomes = new Map<string, string[]>();
  for (const x of defining) {
    const r = per[x.id]!;
    if (r.s !== 'ok' && r.s !== 'trap') continue;
    const o = show(r);
    outcomes.set(o, [...(outcomes.get(o) ?? []), x.id]);
  }
  if (outcomes.size === 1) agreed.set(m.file, [...outcomes.keys()][0]!);
  if (outcomes.size > 1) {
    const line = `${m.file}: ${
      [...outcomes].map(([o, xs]) => `${o} on ${xs.join('+')}`).join('; ')
    }`;
    (m.feature === 'relaxedSimd' ? reported : wrong).push(`values differ: ${line}`);
  }
  for (const x of measured.filter((y) => !y.defining)) {
    const r = per[x.id]!;
    if (r.s !== 'refused' && agreed.has(m.file) && show(r) !== agreed.get(m.file)) {
      reported.push(
        `${m.file} on ${x.id}: the engines agree on ${agreed.get(m.file)}, got ${show(r)}`,
      );
    }
  }
}

// ---- 4. the lowered tier ----
const excludedFeatures = new Set(
  D4.features.filter((f) => f.tier === 'excluded').map((f) => f.feature),
);
const instructionsIn = new Map<string, Set<string>>(); // file -> D4-listed instructions in its bytes
const listed = D4.opcodes.map((o) => o.name);
const featureOfName = new Map(D1.map((e) => [e.name, e.feature ?? 'core']));
for (const m of index) {
  const names = listed.filter((n) => featureOfName.get(n) === m.feature);
  if (names.length === 0) continue;
  const printed =
    spawnSync('wasm-tools', ['print', `${ORIG}/wasm/${m.file}`], { encoding: 'utf8' }).stdout;
  // An instruction begins a printed line; `(catch …)` inside a `try_table` line is a clause, not `catch`.
  const found = names.filter((n) =>
    new RegExp(`^\\s*${n.split(' ')[0]!.replace(/\./g, '\\.')}(\\s|$)`, 'm').test(printed)
  );
  if (found.length) instructionsIn.set(m.file, new Set(found));
}
const excludedListed = new Set(D4.opcodes.filter((o) => o.tier === 'excluded').map((o) => o.name));
const LOW = `${work}/lowered`;
mkdirSync(`${LOW}/wasm`, { recursive: true });
const lowered: ProbeModule[] = [];
for (const m of index) {
  const bytes = readFileSync(`${ORIG}/wasm/${m.file}`);
  const shouldRefuse = excludedFeatures.has(m.feature) ||
    [...(instructionsIn.get(m.file) ?? [])].some((n) => excludedListed.has(n));
  let out: Uint8Array | null = null;
  let err = '';
  try {
    out = (await wasmOpt(bytes, { target: 'portable' })) as Uint8Array;
  } catch (e) {
    err = String((e as Error).message ?? e);
  }
  if (out === null) {
    if (!shouldRefuse || !err.startsWith('--target portable: the module uses')) {
      wrong.push(
        `lowering ${m.file} (${m.feature}): ${
          shouldRefuse ? 'refused, but not by the target' : 'REFUSED'
        }: ${err.split('\n')[0]}`,
      );
    }
    continue;
  }
  if (shouldRefuse) {
    wrong.push(`lowering ${m.file} (${m.feature}): ACCEPTED, but D4 excludes it`);
    continue;
  }
  try {
    await wasmOpt(bytes, { target: 'portable', optimizeLevel: 2 });
  } catch (e) {
    wrong.push(`lowering ${m.file} at -O2: ${String((e as Error).message).split('\n')[0]}`);
  }
  writeFileSync(`${LOW}/wasm/${m.file}`, out);
  lowered.push(m);
}
writeFileSync(`${LOW}/index.json`, `${JSON.stringify(lowered, null, 1)}\n`);
console.log(
  `lowered: ${lowered.length} accepted, ${index.length - lowered.length} refused by the target`,
);
const lowResults = await runAll(LOW, lowered.map((m) => m.file));
for (const m of lowered) {
  const per = lowResults[m.file]!;
  // Relaxed SIMD's original differs by hardware; its lowering must give ONE value everywhere.
  const ref = m.feature === 'relaxedSimd' ? undefined : agreed.get(m.file);
  const got = new Map<string, string[]>();
  for (const x of defining) {
    const o = show(per[x.id]!);
    got.set(o, [...(got.get(o) ?? []), x.id]);
  }
  const off = ref === undefined
    ? (got.size > 1 ? [...got] : [])
    : [...got].filter(([o]) => o !== ref);
  if (off.length > 0) {
    wrong.push(
      `lowered ${m.file}: want ${ref ?? 'one value'}, ${
        off.map(([o, xs]) => `${o} on ${xs.join('+')}`).join('; ')
      }`,
    );
  }
}

// ---- 5. D4 ----
const refusers = (files: string[]) => {
  const s = new Set<string>();
  for (const f of files) {
    for (const x of defining) if (results[f]![x.id]!.s === 'refused') s.add(engineOf.get(x.id)!);
  }
  return [...s].sort();
};
const measuredEngines = new Set(defining.map((x) => x.engine));
const notMeasured = D4.engines.map((e) => e.name).filter((n) => !measuredEngines.has(n));
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const engineBuild: string[] = [];
for (const e of D4.engines) {
  if (builds[e.name] !== undefined && builds[e.name] !== e.build) {
    engineBuild.push(`${e.name}: D4 ${e.build}, now ${builds[e.name]}`);
  }
}
for (const n of measuredEngines) {
  if (!D4.engines.some((e) => e.name === n)) {
    differences.push(`engine ${n}: measured, but not one of D4's`);
  }
}
/** `refusing`: the modules whose refusals count; `probes`: every module that exercises it. */
const compare = (
  what: string,
  entry: { tier: string; pass?: string; refusedBy: string[]; probes: number },
  refusing: string[],
  probes: number,
) => {
  const got = refusers(refusing);
  const wantRefused = entry.refusedBy.filter((n) => measuredEngines.has(n)).sort();
  const tier = got.length === 0 ? 'portable' : entry.pass !== undefined ? 'lowered' : 'excluded';
  if (!sameSet(got, wantRefused)) {
    differences.push(
      `${what}: refused by [${got.join(', ')}], D4 says [${wantRefused.join(', ')}]`,
    );
  }
  // A tier is measured only with every engine; with one missing, refusedBy above is the check.
  if (notMeasured.length === 0 && probes > 0 && tier !== entry.tier) {
    differences.push(`${what}: measures ${tier}, D4 says ${entry.tier}`);
  }
  if (probes !== entry.probes) {
    differences.push(`${what}: ${probes} probe modules, D4 says ${entry.probes}`);
  }
};
for (const f of D4.features) {
  const files = index.filter((m) => m.feature === f.feature).map((m) => m.file);
  // A feature's `refusedBy` leaves out the modules that hold a listed instruction (D4's rule).
  compare(
    `feature ${f.feature}`,
    f,
    files.filter((file) => !instructionsIn.has(file)),
    files.length,
  );
}
for (const o of D4.opcodes) {
  const files = index.filter((m) => instructionsIn.get(m.file)?.has(o.name)).map((m) => m.file);
  compare(`instruction ${o.name}`, o, files, files.length);
}
// A refusal in a feature D4 calls portable, by a module holding no listed instruction, is new.
for (const m of index) {
  if (instructionsIn.has(m.file)) continue;
  const tier = D4.features.find((f) => f.feature === m.feature)?.tier ?? 'portable';
  if (tier !== 'portable') continue;
  const r = refusers([m.file]);
  if (r.length > 0) {
    differences.push(
      `${m.file} (${m.feature}, ${m.covers.join(' ') || 'encoding'}): refused by ${r.join(', ')}`,
    );
  }
}

// ---- the report ----
const unique = [...new Set(differences)];
writeFileSync(
  `${work}/report.json`,
  `${
    JSON.stringify(
      {
        measured: new Date().toISOString().slice(0, 10),
        builds,
        notMeasured,
        engineBuild,
        differences: unique,
        wrong,
        reported,
        results,
        lowResults,
      },
      null,
      1,
    )
  }\n`,
);
const section = (title: string, xs: string[]) => {
  console.log(`\n${title}: ${xs.length === 0 ? 'none' : xs.length}`);
  for (const x of xs.slice(0, 60)) console.log(`  ${x}`);
  if (xs.length > 60) console.log(`  … ${xs.length - 60} more in report.json`);
};
section('builds changed since D4 was measured', engineBuild);
section('D4 differences', unique);
section('wrong results (defining engines, or the target)', wrong);
section('reported (interpreters; relaxed SIMD originals)', reported);
console.log(
  notMeasured.length
    ? `\nnot measured: ${notMeasured.join(', ')}`
    : '\nevery defining engine measured',
);
process.exit(unique.length > 0 || wrong.length > 0 ? 1 : notMeasured.length > 0 ? 3 : 0);
