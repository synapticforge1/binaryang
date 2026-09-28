// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The spec testsuite's BEHAVIOUR, as a differential: every module's own
 * invocations replayed against the original bytes and against a plain round
 * trip and every optimization level. What one module's check
 * does, and why the original is the oracle, is in `spec-behaviour/differential.ts`.
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
 *   lowered, so a fix is kept.
 *
 * It reads the corpus `deno task spec:prepare` writes, as `deno task spec` does.
 *
 * Usage: `deno task spec-behaviour <outDir>`
 */

import type { Invoke, Row, SpecInput } from './spec-behaviour/differential.ts';
import { needsWrapper, type Sig } from './spec-behaviour/v128.ts';

/**
 * The modules our pipeline may refuse (some variant threw), pinned by NAME — a
 * count could stay level while one refusal is fixed and another appears. A
 * RATCHET, as `PHANTOM_BUDGET` in `check-operator-mapping.ts`: a new name
 * fails, and so does a pinned name that no longer refuses, or it could come
 * back unnoticed.
 *
 * Each pin is `<module> <variant>`. It was EMPTY at 1.6.0 (seven
 * relaxed-SIMD pins went with binaryen-ts's decoder, One front end stage 3b).
 * Since 2026-09-28 it holds `--flatten`'s refusals of `br_on_*` and
 * `try_table` — which upstream's Flatten refuses too (`throw` / `throw_ref`
 * / `instance` modules carry `try_table`) — and nothing else.
 */
const REFUSED_BUDGET: string[] = [
  'br_on_cast_fail/br_on_cast_fail.0.wasm --flatten',
  'br_on_cast_fail/br_on_cast_fail.1.wasm --flatten',
  'br_on_cast/br_on_cast.0.wasm --flatten',
  'br_on_cast/br_on_cast.1.wasm --flatten',
  'br_on_non_null/br_on_non_null.0.wasm --flatten',
  'br_on_non_null/br_on_non_null.2.wasm --flatten',
  'br_on_null/br_on_null.0.wasm --flatten',
  'br_on_null/br_on_null.2.wasm --flatten',
  'instance/instance.1.wasm --flatten',
  'instance/instance.2.wasm --flatten',
  'instance/instance.4.wasm --flatten',
  'throw_ref/throw_ref.0.wasm --flatten',
  'throw/throw.0.wasm --flatten',
  'try_table/try_table.1.wasm --flatten',
  'try_table/try_table.2.wasm --flatten',
  'try_table/try_table.13.wasm --flatten',
  'try_table/try_table.16.wasm --flatten',
];

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

const dir = Deno.args[0];
if (!dir) {
  console.error(
    'usage: deno task spec-behaviour <outDir>   (the corpus `deno task spec:prepare` wrote)',
  );
  Deno.exit(2);
}

/** Every binary module with invocations after it, in manifest order. */
function collect(root: string): SpecInput[] {
  const inputs: SpecInput[] = [];
  const dirs = [...Deno.readDirSync(root)].filter((e) => e.isDirectory).map((e) => e.name).sort();
  for (const d of dirs) {
    let manifest: { commands: Record<string, unknown>[] };
    try {
      manifest = JSON.parse(Deno.readTextFileSync(`${root}/${d}/${d}.json`));
    } catch {
      continue;
    }
    const cmds = manifest.commands;
    for (const [i, c] of cmds.entries()) {
      const file = c.filename as string | undefined;
      if (c.type !== 'module' || !file?.endsWith('.wasm')) continue;
      const invokes: Invoke[] = [];
      // Each export's signature as the manifest shows it: its arguments'
      // types, and an `assert_return`'s expected types — borrowed by an
      // invocation of the same export that shows no results (`assert_trap`).
      const sigs = new Map<string, Sig>();
      for (const later of cmds.slice(i + 1)) {
        if (later.type === 'module') break;
        const a = later.action as
          | { type: string; module?: string; field: string; args: Invoke['args'] }
          | undefined;
        // An invocation of a NAMED module is another module's; skip it.
        if (a?.type !== 'invoke' || a.module !== undefined) continue;
        invokes.push({ line: later.line as number, field: a.field, args: a.args });
        const expected = later.expected as { type: string }[] | undefined;
        if (later.type === 'assert_return' && expected !== undefined && !sigs.has(a.field)) {
          sigs.set(a.field, {
            params: a.args.map((x) => x.type),
            results: expected.map((x) => x.type),
          });
        }
      }
      if (invokes.length > 0) {
        const v128 = [...sigs].filter(([, sig]) => needsWrapper(sig));
        inputs.push({
          name: `${d}/${file}`,
          path: `${root}/${d}/${file}`,
          invokes,
          ...(v128.length > 0 ? { v128 } : {}),
        });
      }
    }
  }
  return inputs;
}

const rows: Row[] = [];

/** Runs `queue` in a worker until it drains or a module goes quiet; resolves with what is left. */
function drain(queue: SpecInput[]): Promise<SpecInput[]> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER, { type: 'module' });
    let next = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (remaining: SpecInput[]) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(remaining);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const stuck = queue[next]!;
        rows.push({
          name: stuck.name,
          status: 'timeout',
          invocations: stuck.invokes.length,
          v128: 0,
          blind: 0,
          variants: 0,
          refused: [],
          detail: [`no result in ${BUDGET_MS / 1000}s — the original or a variant did not return`],
        });
        finish(queue.slice(next + 1));
      }, BUDGET_MS);
    };
    worker.onmessage = (ev: MessageEvent<{ row?: Row; done?: boolean }>) => {
      if (ev.data.done) return finish([]);
      rows.push(ev.data.row!);
      next++;
      arm();
    };
    worker.onerror = (ev) => {
      ev.preventDefault();
      const cur = queue[next];
      rows.push({
        name: cur?.name ?? '<unknown>',
        status: 'DIVERGE',
        invocations: cur?.invokes.length ?? 0,
        v128: 0,
        blind: 0,
        variants: 0,
        refused: [],
        detail: [`worker error: ${ev.message}`],
      });
      finish(queue.slice(next + 1));
    };
    arm();
    worker.postMessage({ inputs: queue });
  });
}

const inputs = collect(dir);
if (inputs.length === 0) {
  console.error(`no prepared manifests under ${dir} — run \`deno task spec:prepare\` first`);
  Deno.exit(2);
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
const refused = rows.flatMap((r) => r.refused.map((why) => `${r.name} ${why}`));
const invocations = rows.reduce((n, r) => n + r.invocations, 0);
const compared = rows.reduce((n, r) => n + r.variants, 0);

console.log(
  "  === the spec testsuite's invocations: original vs round trip and -O1…-Oz ===",
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
for (const [title, list] of [['DIVERGE', diverged], ['did not terminate', timedOut]] as const) {
  if (list.length === 0) continue;
  console.log(`\n  === ${title}: ${list.length} (first 30) ===`);
  for (const r of list.slice(0, 30)) {
    console.log(`    ${r.name}`);
    for (const d of r.detail.slice(0, 3)) console.log(`        ${d.slice(0, 160)}`);
  }
}

let failed = diverged.length > 0 || timedOut.length > 0;
const added = refusedModules.filter((m) => !REFUSED_BUDGET.includes(m));
// A pin can only be RETIRED by a run that reached it.
const ran = new Set(rows.map((r) => r.name));
const retired = REFUSED_BUDGET.filter((m) =>
  ran.has(m.slice(0, m.indexOf(' '))) && !refusedModules.includes(m)
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
    `\n  TOTAL — ${invocations} invocations on ${rows.length} modules; every variant behaves as the original.`,
  );
}

// ⚠️ Exit explicitly: `worker.terminate()` cannot interrupt a worker inside a
// synchronous wasm loop, and that thread would keep the process alive after
// the verdict (the lesson of `check-direct-behaviour.ts`).
Deno.exit(failed ? 1 : 0);
