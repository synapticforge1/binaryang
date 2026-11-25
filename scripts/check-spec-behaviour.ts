// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The spec testsuite's BEHAVIOUR, as a differential: every module's own
 * invocations replayed against the original bytes and against a plain round
 * trip and every optimization level. What one module's check
 * does, and why the original is the oracle, is in `spec-behaviour/differential.ts`.
 *
 * Two checks run, over the same prepared corpus. The differential above compares each variant
 * with V8's run of the original; the SPEC-EXPECTED check (`spec-behaviour/script-run.ts`, C-R2-5)
 * runs every script as the spec's own interpreter does and compares the original and every variant
 * with the expected values the `.wast` states — `assert_return` (NaN canonical / arithmetic, `v128`
 * lanes, `either`, references), `assert_trap`, `assert_exhaustion`, `assert_exception`,
 * `assert_uninstantiable` and plain actions. V8 against the script is pinned in
 * {@link ENGINE_LIMITS}; binaryang against the script has no pin: any disagreement fails.
 *
 * Why it exists: on 2026-09-28 this check, then a scratch script, found eight
 * defects with every other gate green — among them a SILENT -O2 miscompile
 * shipped in 1.5.4 (Q1–Q8, cmem/divergences.md). Validity gates cannot see a
 * module that stays valid while computing something else.
 *
 * Verdict:
 * - exit 1 on any DIVERGE (an outcome differs, or the engine refuses our
 *   bytes) or any module that does not terminate;
 * - REFUSED variants (our pipeline threw — loud, not a miscompile) are counted
 *   against {@link REFUSED_BUDGET}: more fails, fewer asks for the budget to be
 *   lowered, so a fix is kept. Both runs feed it: the differential, and the script run — which
 *   also reaches the modules with no later invocation, that the differential never replays.
 *
 * It reads the corpus `bun run spec:prepare` writes, as `bun run spec` does.
 *
 * Usage: `bun run spec-behaviour <outDir>`
 */

import type { Row, SpecInput } from './spec-behaviour/differential.ts';
import { collectInputs, collectScripts } from './spec-behaviour/collect.ts';
import {
  emptyRow as emptyScriptRow,
  type ScriptInput,
  type ScriptRow,
} from './spec-behaviour/script-run.ts';
import { takeProposalArg } from './proposals.ts';

import process from 'node:process';
import { Worker } from 'node:worker_threads';

/**
 * The modules our pipeline may refuse (some variant threw), pinned by NAME — a
 * count could stay level while one refusal is fixed and another appears. A
 * RATCHET, as `PHANTOM_BUDGET` in `check-operator-mapping.ts`: a new name
 * fails, and so does a pinned name that no longer refuses, or it could come
 * back unnoticed.
 *
 * Each pin is `<module> <variant>`, a module the ENGINE accepts as the original. It was EMPTY at 1.6.0 (seven
 * relaxed-SIMD pins went with binaryen-ts's decoder, One front end stage 3b).
 * Since 2026-09-28 it holds `--flatten`'s refusals of `br_on_*` and
 * `try_table` — which upstream's Flatten refuses too (`throw` / `throw_ref`
 * / `instance` modules carry `try_table`) — and nothing else.
 */
const REFUSED_BUDGET: string[] = [
  'br_on_cast_fail/br_on_cast_fail.0.wasm --flatten',
  'br_on_cast_fail/br_on_cast_fail.1.wasm --flatten',
  'br_on_cast_fail/br_on_cast_fail.2.wasm --flatten',
  'br_on_cast/br_on_cast.0.wasm --flatten',
  'br_on_cast/br_on_cast.1.wasm --flatten',
  'br_on_cast/br_on_cast.2.wasm --flatten',
  'br_on_non_null/br_on_non_null.0.wasm --flatten',
  'br_on_non_null/br_on_non_null.1.wasm --flatten',
  'br_on_non_null/br_on_non_null.2.wasm --flatten',
  'br_on_null/br_on_null.0.wasm --flatten',
  'br_on_null/br_on_null.1.wasm --flatten',
  'br_on_null/br_on_null.2.wasm --flatten',
  'instance/instance.1.wasm --flatten',
  'instance/instance.2.wasm --flatten',
  'instance/instance.4.wasm --flatten',
  'throw_ref/throw_ref.0.wasm --flatten',
  'throw/throw.0.wasm --flatten',
  'try_table/try_table.1.wasm --flatten',
  'try_table/try_table.2.wasm --flatten',
  'try_table/try_table.5.wasm --flatten',
  'try_table/try_table.13.wasm --flatten',
  'try_table/try_table.16.wasm --flatten',
  // Since the script run feeds this list too (2026-11-20: 23 pairs on the core corpus, 17 seen by
  // the differential), six more pins: modules with no invocation after them, which the differential
  // never replays — br_on_cast.2, br_on_cast_fail.2, br_on_non_null.1, br_on_null.1, try_table.5
  // (each placed with its file above) and this one: the same `--flatten` refusals of `br_on_*`.
  'unreached-valid/unreached-valid.2.wasm --flatten',
  // `proposals/custom-descriptors` (2026-09-29): `--flatten` refusing `br_on_*`
  // — the `_desc_eq` forms and the proposal's own copies of the core files — for
  // the same reason as above. (Eight of them, the `.0` / `.1` / `.2` / `.19` files, have no
  // invocation after them: found by the script run's refusal count, 2026-11-20.)
  'proposals/custom-descriptors/br_on_cast_desc_eq_fail/br_on_cast_desc_eq_fail.0.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_desc_eq_fail/br_on_cast_desc_eq_fail.1.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_desc_eq_fail/br_on_cast_desc_eq_fail.19.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_desc_eq_fail/br_on_cast_desc_eq_fail.26.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_desc_eq_fail/br_on_cast_desc_eq_fail.27.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_desc_eq/br_on_cast_desc_eq.0.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_desc_eq/br_on_cast_desc_eq.1.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_desc_eq/br_on_cast_desc_eq.19.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_desc_eq/br_on_cast_desc_eq.26.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_desc_eq/br_on_cast_desc_eq.27.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_fail/br_on_cast_fail.0.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_fail/br_on_cast_fail.1.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast_fail/br_on_cast_fail.2.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast/br_on_cast.0.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast/br_on_cast.1.wasm --flatten',
  'proposals/custom-descriptors/br_on_cast/br_on_cast.2.wasm --flatten',
  'proposals/custom-descriptors/exact-casts/exact-casts.0.wasm --flatten',
  'proposals/custom-descriptors/exact-casts/exact-casts.1.wasm --flatten',
  'proposals/custom-descriptors/exact-casts/exact-casts.2.wasm --flatten',
  'proposals/custom-descriptors/exact-func-import/exact-func-import.8.wasm --flatten',
  'proposals/custom-descriptors/exact-func-import/exact-func-import.13.wasm --flatten',
  'proposals/custom-descriptors/exact-func-import/exact-func-import.14.wasm --flatten',
];

/**
 * What V8 itself cannot do with the CORE corpus's modules, pinned by script and line — the ORIGINAL
 * module, run by V8 against the script's expected values (C-R2-5), is the one place the spec check
 * can fail for a reason that is not ours. Each pin is the start of the disagreement's text. A RATCHET
 * like {@link REFUSED_BUDGET}: a new disagreement fails, and so does a pin that no longer holds.
 */
const ENGINE_LIMITS: [pin: string, why: string][] = [
  [
    'memory64 original line 9: module memory64.5.wasm',
    'declares a 2^48-page maximum memory: V8 limits a memory to 262,144 pages, the spec allows it (the script asserts nothing of it)',
  ],
];

/**
 * The assertions the CORE corpus run could not make, by cause (the total, pinned — a ratchet: more
 * is coverage lost silently, fewer asks for the number to be lowered). 12 are `imports a module the
 * script did not register` (a module importing from one given only as text or a
 * `module_definition`); 7 are JS API `TypeError`s on a reference type JS has no value for.
 */
const NOT_RUN_BUDGET = 19;

/**
 * Per-module budget: 12 variants, each optimized and run. The whole suite runs
 * in ~6 s (2026-09-28), so a module past this has hung.
 */
const BUDGET_MS = 20_000;

/**
 * Stop after this many modules fail to terminate. ⚠️ Found by the first
 * inversion: with Q1's miscompile restored, loops across the suite never ended,
 * and each hang cost the full budget PLUS a thread that keeps spinning —
 * `worker.terminate()` cannot interrupt a synchronous wasm loop. The run was
 * still going after 20 minutes and 12,500 CPU-seconds. The verdict is already a
 * failure after the first hang; a few more only say how widespread it is.
 */
const MAX_TIMEOUTS = 3;

const WORKER = new URL('./spec-behaviour/worker.ts', import.meta.url);
const SCRIPT_WORKER = new URL('./spec-behaviour/script-worker.ts', import.meta.url);
/** A whole script: every module of it under every variant, and every assertion run. */
const SCRIPT_BUDGET_MS = 120_000;

const args = [...process.argv.slice(2)];
/**
 * `--proposal <name>`: a `proposals/<name>` corpus. Its module names are
 * prefixed `proposals/<name>/` (custom-page-sizes has `binary/` and
 * `memory_max/`, as the core suite does). The V8 flags it needs are the
 * caller's to pass (`bun run proposals` does) — a flag cannot be set from
 * inside a running isolate.
 */
const PROPOSAL = takeProposalArg(args);
const PREFIX = PROPOSAL ? `proposals/${PROPOSAL.name}/` : '';
const dir = args[0];
if (!dir) {
  console.error(
    'usage: bun run spec-behaviour <outDir>   (the corpus `bun run spec:prepare` wrote)',
  );
  process.exit(2);
}

/** Every binary module with invocations after it, in manifest order (`spec-behaviour/collect.ts`). */
function collect(root: string): SpecInput[] {
  return collectInputs(root, PREFIX);
}

const rows: Row[] = [];

/**
 * Runs `queue` in a worker (`worker`) until it drains or an item goes quiet; resolves with what is
 * left. `onRow` takes each result; `fail` makes the row for an item that hung or threw.
 */
function drainWith<I extends { name: string }, R>(
  worker: URL,
  queue: I[],
  budgetMs: number,
  onRow: (row: R) => void,
  fail: (item: I | undefined, why: string, hung: boolean) => R,
): Promise<I[]> {
  return new Promise((resolve) => {
    // node:worker_threads, not the web `Worker`: it runs on Deno, Node and Bun alike (Node has no
    // global `Worker`). This harness is an engine ORACLE, so `bun run` starts it on the V8
    // referee, Node through `scripts/v8.ts` (cmem/bun-migration.md § "The engine oracle"). The
    // worker inherits this process's execArgv, so a runtime flag (a V8 flag on Node) reaches it.
    const w = new Worker(worker);
    let next = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (remaining: I[]) => {
      clearTimeout(timer);
      void w.terminate();
      resolve(remaining);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        onRow(
          fail(
            queue[next],
            `no result in ${budgetMs / 1000}s — the original or a variant did not return`,
            true,
          ),
        );
        finish(queue.slice(next + 1));
      }, budgetMs);
    };
    w.on('message', (data: { row?: R; done?: boolean }) => {
      if (data.done) return finish([]);
      onRow(data.row!);
      next++;
      arm();
    });
    w.on('error', (err: Error) => {
      onRow(fail(queue[next], `worker error: ${err.message}`, false));
      finish(queue.slice(next + 1));
    });
    arm();
    w.postMessage({ inputs: queue });
  });
}

/** The differential's rows: a module's variants against its original. */
function drain(queue: SpecInput[]): Promise<SpecInput[]> {
  return drainWith<SpecInput, Row>(
    WORKER,
    queue,
    BUDGET_MS,
    (r) => rows.push(r),
    (cur, why, hung) => ({
      name: cur?.name ?? '<unknown>',
      status: hung ? 'timeout' : 'DIVERGE',
      invocations: cur?.invokes.length ?? 0,
      v128: 0,
      blind: 0,
      variants: 0,
      refused: [],
      detail: [why],
    }),
  );
}

const inputs = collect(dir);
if (inputs.length === 0) {
  console.error(`no prepared manifests under ${dir} — run \`bun run spec:prepare\` first`);
  process.exit(2);
}
let queue = inputs;
let stoppedEarly = 0;
while (queue.length > 0) {
  queue = await drain(queue);
  if (rows.filter((r) => r.status === 'timeout').length >= MAX_TIMEOUTS && queue.length > 0) {
    stoppedEarly = queue.length;
    break;
  }
}
rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

const diverged = rows.filter((r) => r.status === 'DIVERGE');
const timedOut = rows.filter((r) => r.status === 'timeout');
const blindOriginals = rows.filter((r) => r.status === 'blind');
const refused = rows.flatMap((r) => r.refused.map((why) => `${r.name} ${why}`));
const invocations = rows.reduce((n, r) => n + r.invocations, 0);
const compared = rows.reduce((n, r) => n + r.variants, 0);

console.log(
  `  === the spec testsuite's invocations${
    PROPOSAL ? ` — proposals/${PROPOSAL.name}` : ''
  }: original vs round trip and -O1…-Oz ===`,
);
console.log(`    modules                  ${String(rows.length).padStart(6)}`);
console.log(
  `    invocations              ${
    String(invocations).padStart(6)
  }   (each replayed on every variant)`,
);
console.log(
  `      of them through v128   ${
    String(rows.reduce((n, r) => n + r.v128, 0)).padStart(6)
  }   (each vector as two i64 lanes — spec-behaviour/v128.ts)`,
);
console.log(
  `      blind                  ${
    String(rows.reduce((n, r) => n + r.blind, 0)).padStart(6)
  }   (the JS API could not make the call on the original: counted, not compared)`,
);
console.log(`    variants compared        ${String(compared).padStart(6)}`);
console.log(
  `    agree                    ${
    String(rows.filter((r) => r.status === 'agree').length).padStart(6)
  } modules`,
);
console.log(`    DIVERGE                  ${String(diverged.length).padStart(6)} modules`);
console.log(
  `    engine refused ORIGINAL  ${
    String(blindOriginals.length).padStart(6)
  } modules   (nothing compared — a missing V8 flag looks like this)`,
);
console.log(`    did not terminate        ${String(timedOut.length).padStart(6)} modules`);
if (stoppedEarly > 0) {
  console.log(
    `    NOT RUN                  ${String(stoppedEarly).padStart(6)} modules — stopped after ` +
      `${MAX_TIMEOUTS} hangs; the counts above cover only what ran`,
  );
}
// Pinned per (module, VARIANT): a module one variant is allowed to refuse must
// not hide another variant starting to refuse it too.
const refusedModules = [
  ...new Set(
    rows.flatMap((r) => r.refused.map((why) => `${r.name} ${why.slice(0, why.indexOf(': '))}`)),
  ),
];
console.log(
  `    refused variants         ${
    String(refused.length).padStart(6)
  }   (${REFUSED_BUDGET.length} pinned, by module and variant)`,
);

if (refused.length > 0) {
  // One cause usually explains many; group before reading.
  const reasons = new Map<string, number>();
  for (const r of refused) {
    const key = r.replace(/^\S+ /, '').replace(/^(round trip|-O\w): /, '').replace(
      /0x[0-9a-f]+|\d+/gi,
      'N',
    );
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  console.log('\n  === why variants were refused ===');
  for (const [k, n] of [...reasons].sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(n).padStart(4)}x  ${k.slice(0, 110)}`);
  }
}
for (
  const [title, list] of [
    ['DIVERGE', diverged],
    ['did not terminate', timedOut],
    ['engine refused the ORIGINAL', blindOriginals],
  ] as const
) {
  if (list.length === 0) continue;
  console.log(`\n  === ${title}: ${list.length} (first 30) ===`);
  for (const r of list.slice(0, 30)) {
    console.log(`    ${r.name}`);
    for (const d of r.detail.slice(0, 3)) console.log(`        ${d.slice(0, 160)}`);
  }
}

// === The spec's own expected values: every script, once per variant (spec-behaviour/script-run.ts)
const scriptRows: ScriptRow[] = [];
let scriptQueue: ScriptInput[] = collectScripts(dir, PREFIX);
const scriptHangs: string[] = [];
while (scriptQueue.length > 0) {
  scriptQueue = await drainWith<ScriptInput, ScriptRow>(
    SCRIPT_WORKER,
    scriptQueue,
    SCRIPT_BUDGET_MS,
    (r) => scriptRows.push(r),
    (cur, why) => {
      scriptHangs.push(`${cur?.name ?? '<unknown>'}: ${why}`);
      return emptyScriptRow(cur?.name ?? '<unknown>');
    },
  );
  if (scriptHangs.length >= MAX_TIMEOUTS) break;
}
const sum = (pick: (r: ScriptRow) => number) => scriptRows.reduce((n, r) => n + pick(r), 0);
const specOriginal = scriptRows.flatMap((r) => r.original.map((x) => `${r.name} ${x}`));
const specVariant = scriptRows.flatMap((r) => r.variant.map((x) => `${r.name} ${x}`));
// What the script run saw our pipeline refuse, of a module the engine accepted as the original: the
// differential replays only a module with an invocation after it, so for the rest this is the only
// place a refusal (a pipeline bug) can show. Same `<module> <variant>` form as REFUSED_BUDGET.
const scriptRefused = [...new Set(scriptRows.flatMap((r) => r.refused))];
const notRun = new Map<string, number>();
for (const r of scriptRows) {
  for (const [why, n] of Object.entries(r.unchecked)) notRun.set(why, (notRun.get(why) ?? 0) + n);
}
console.log(
  `
  === the spec's own expected values (assert_return, assert_trap, assert_exhaustion, assert_exception, assert_uninstantiable, actions): the .wast's script, run once per variant ===`,
);
console.log(`    scripts                  ${String(scriptRows.length).padStart(6)}`);
console.log(
  `    assertions               ${
    String(sum((r) => r.asserted)).padStart(6)
  }   (checked against the script's expected values on the ORIGINAL, as V8 runs it)`,
);
console.log(
  `    variant checks           ${
    String(sum((r) => r.variantChecks)).padStart(6)
  }   (each assertion on each variant that ran it)`,
);
console.log(
  `      NaN payload unseen     ${
    String(sum((r) => r.nanBoundary)).padStart(6)
  }   (a literal NaN met by a NaN: the JS API may quiet a payload)`,
);
console.log(
  `    not run                  ${
    String([...notRun.values()].reduce((a, b) => a + b, 0)).padStart(6)
  }   (each counted by cause below; per original run)`,
);
for (const [why, n] of [...notRun].sort((a, b) => b[1] - a[1])) {
  console.log(`      ${String(n).padStart(6)}  ${why}`);
}
console.log(
  `    pipeline refused         ${
    String(scriptRefused.length).padStart(6)
  }   (module, variant) pairs of modules the engine accepts; ${
    scriptRefused.filter((m) => !refusedModules.includes(m)).length
  } not seen by the differential; every one must be pinned in REFUSED_BUDGET`,
);
console.log(
  `    V8 vs the script         ${
    String(specOriginal.length).padStart(6)
  }   disagreements (the ORIGINAL)`,
);
console.log(
  `    binaryang vs the script  ${
    String(specVariant.length).padStart(6)
  }   disagreements (a variant as we wrote it)`,
);
for (
  const [title, list] of [['V8 vs the script', specOriginal], [
    'binaryang vs the script',
    specVariant,
  ]] as const
) {
  if (list.length === 0) continue;
  console.log(`\n  === ${title}: ${list.length} (first 30) ===`);
  for (const x of list.slice(0, 30)) console.log(`    ${x.slice(0, 200)}`);
}
for (const h of scriptHangs) console.log(`  ✗ script did not terminate: ${h}`);

let failed = diverged.length > 0 || timedOut.length > 0 || blindOriginals.length > 0 ||
  scriptHangs.length > 0 || specVariant.length > 0;
// V8 against the script: pinned for the core corpus (ENGINE_LIMITS), every one a finding elsewhere.
const pins = PROPOSAL ? [] : ENGINE_LIMITS;
const unpinned = specOriginal.filter((x) => !pins.some(([p]) => x.startsWith(p)));
if (unpinned.length > 0) {
  console.log(
    `\n  ✗ ${unpinned.length} disagreement(s) of the ORIGINAL (V8) with the script, not pinned in ENGINE_LIMITS`,
  );
  failed = true;
}
const stale = pins.filter(([p]) => !specOriginal.some((x) => x.startsWith(p)));
if (stale.length > 0) {
  console.log(
    `\n  ✗ ${stale.length} ENGINE_LIMITS pin(s) no longer hold — remove them: ${
      stale.map(([p]) => p).join('; ')
    }`,
  );
  failed = true;
}
const notRunTotal = [...notRun.values()].reduce((a, b) => a + b, 0);
if (!PROPOSAL && notRunTotal !== NOT_RUN_BUDGET) {
  console.log(
    `\n  ✗ ${notRunTotal} assertion(s) not run, NOT_RUN_BUDGET is ${NOT_RUN_BUDGET} — coverage changed: fix, or set the budget with why`,
  );
  failed = true;
}
if (scriptRows.length === 0) {
  console.log('\n  ✗ no scripts found to check against their expected values');
  failed = true;
}
// The differential's refusals and the script run's: a pair either one saw.
const refusedAll = [...new Set([...refusedModules, ...scriptRefused])];
const added = refusedAll.filter((m) => !REFUSED_BUDGET.includes(m));
// A pin can only be RETIRED by a run that reached it.
const ran = new Set([...rows.map((r) => r.name), ...scriptRows.flatMap((r) => r.modules)]);
const retired = REFUSED_BUDGET.filter((m) =>
  ran.has(m.slice(0, m.indexOf(' '))) && !refusedAll.includes(m)
);
if (added.length > 0) {
  console.log(
    `\n  ✗ ${added.length} (module, variant) pair(s) NEWLY refused — fix, or pin in REFUSED_BUDGET with why:`,
  );
  for (const m of added) console.log(`    '${m}',`);
  failed = true;
}
if (retired.length > 0) {
  console.log(
    `\n  ✗ ${retired.length} pinned pair(s) no longer refused — remove them from REFUSED_BUDGET:`,
  );
  for (const m of retired) console.log(`    '${m}',`);
  failed = true;
}
if (!failed) {
  console.log(
    `\n  TOTAL — ${invocations} invocations on ${rows.length} modules; every variant behaves as the original. ${
      sum((r) => r.asserted)
    } spec assertions, each also met by every variant (${sum((r) => r.variantChecks)} checks).`,
  );
}

// ⚠️ Exit explicitly: `worker.terminate()` cannot interrupt a worker inside a
// synchronous wasm loop, and that thread would keep the process alive after
// the verdict (the lesson of `check-direct-behaviour.ts`).
process.exit(failed ? 1 : 0);
