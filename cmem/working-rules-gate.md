# Working rules — the gate

Summary: the gate steps, run on the committed tree, with their expected counts and the exit-code rules. Last verified 2026-11-20.
Main file: [working-rules.md](working-rules.md).

## The gate — on the COMMITTED tree, reading every EXIT CODE

🔧 **Every project script is a `package.json` script, run as `bun run <name>`: read each `deno
task <name>` in this file, history included, that way** (B4, 2026-10-12; the last ones moved in B3
/ B5 / B7, 2026-10-13). There is no `ci` script: the gate is the list below, step by step. Deno
still runs two of them, `publish:dry` (`deno publish --dry-run`) and `comparison` (the
`comparison/` suite against upstream), and the publish itself; `cli-smoke.ts` also runs UNDER Deno
in CI, as one of the runtimes the package supports. `bun run` starts the right runtime by
itself: Bun for most, and for the steps whose oracle is the host WebAssembly engine, the **V8 referee**: Node 24 through fnm, named once in
`scripts/v8.ts` (Node 22's V8 12.4 fails these gates; Bun's JavaScriptCore differs). Deno is kept
for JSR only (owner, 2026-10-12) ([bun-migration.md](bun-migration.md) § "The engine oracle").

CI's steps first, read from `.github/workflows/ci.yml` rather than from memory of it:

`bun install --frozen-lockfile` · `bun run fmt:check` (dprint + its canary, since B3, 2026-10-13; it
replaced `deno fmt --check`) · `bun run lint` (Biome, since B3, 2026-10-13; it replaced `deno lint`)
· `bun run check` (THE type check: tests since B5, alone since B7; `bun check` since 2026-10-15,
`tsc` before, kept as `bun run check:tsc` — [jsr-deno-exit-guide.md](jsr-deno-exit-guide.md) § "Type
checking: `bun check`") · `bun run test` (node:test on Node 24, the referee) · `bun run test:bun`
(Bun, against `tests/bun-known-differences.json`)
· `bun run naming` · `bun run portability` ·
`bun run browser` (every export bundles for the browser, open-work 28, 2026-10-12) ·
`bun run baseline` · `bun run surface:check` (the compatibility gate's snapshot, since
2026-10-23, workspace letter H6; [publishing.md](publishing.md) § "The compatibility gate") ·
`bun run publish:dry` (`deno publish --dry-run --allow-dirty`) · `bun run npm:prove` (the npm package built, packed, installed and run) — and the `runtimes` job's
`scripts/cli-smoke.ts`, run under each runtime it tests (locally:
`deno run -A scripts/cli-smoke.ts
"deno run -A"` and `bun scripts/cli-smoke.ts bun`, and for Node **`bun run lts`**: every current
Node LTS line per Node's own release schedule, each through `fnm exec`, failing on a line fnm has
not installed (owner, 2026-10-12: "support and test all currently available lts versions");
all must print the same hash)

then the project's own: `bun run operators` · `bun run spec <corpus>` ·
`bun run spec-behaviour <corpus>` · `bun run lowering <corpus>` (since 2026-10-22, open-work
32: every spec module with a 64-bit memory or table, lowered by `Memory64Lowering`, against the
original on V8 — on V8 and on JavaScriptCore; expect 122 modules, 1,759 invocations, 0
diverging, 0 refused) · `bun run direct` ·
`bun run direct-behaviour` · `bun run translate-eh <testsuite-main>/legacy <outDir>` ·
`bun run optimize-corpus` · `bun run proposals <testsuite-main> <outDir>` · then, AFTER
`proposals` (it prepares their corpora), `bun run interp <corpus> <legacy corpus>
<outDir>/custom-descriptors <outDir>/custom-page-sizes <outDir>/threads <outDir>/wide-arithmetic`
(below) (since 2026-09-29:
`proposals/`, validity and behaviour, V8 experimental flags per `scripts/proposals.ts`; expect every
proposal to hold, custom-page-sizes judged on V8 through `LowerCustomPageSizes` — 31 assertions in 7
worlds, both unlinkables honoured, no pins — [testing.md](testing.md) § "The proposal testsuites").
(`direct` / `direct-behaviour` replaced `bridge` / `bridge-behaviour` when M8e deleted the bridge,
2026-09-18; this list named the old tasks until 2026-09-19.) Expect `direct` **544 / 544** and
`direct-behaviour` **1953 calls / 651 exports, 0 DIVERGE** — the 421 corpus modules plus
`prepare.test.ts`'s 123 (post-M8 fix 7).

- **`deno task spec-behaviour <corpus>` joined the gate 2026-09-28 (owner: "Yes").** It replays the
  spec testsuite's own invocations on the original and on every variant we make (round trip,
  -O1…-Oz, both routes); it is the one step that sees a VALID module computing the wrong thing, and
  found eight defects with every other step green (Q1–Q8). Same prepared corpus as `spec`. Expect
  **1,342 modules, 57,808 invocations (24,151 through v128 wrappers, 53 blind), 0 DIVERGE** — a
  rising `blind` count is a coverage loss worth reading — and NO refusals: `REFUSED_BUDGET` is empty
  since 1.6.0 (its 7 relaxed-SIMD pins were binaryen-ts's decoder's, deleted then, and the variants
  are the one route's round trip and -O1…-Oz). A module that starts being refused FAILS the step
  until it is fixed or pinned with why — that is the ratchet, not a regression.

- **`deno task interp <corpus>` joined the gate 2026-10-07 (owner: "yes on deno task interp").** The
  interpreter (open-work 23, E3) against the testsuite's `assert_return` / `assert_trap` /
  `assert_exhaustion`, the MANIFEST as the oracle. Same prepared corpus as `spec`. The verdict is
  **0 FAIL**; the `stopped` count (what the interpreter cannot run yet, by reason) should only FALL
  as E3's increments land — a rise is a coverage loss to read. At E3a: 15,432 pass, 42,144 stopped;
  at E3b: 25,811 pass, 31,819 stopped; at E3c: 32,618 pass, 25,012 stopped (15 s in the gate
  run, from 3 s at E3b — not yet attributed); at E3d-1: 32,687 pass, 24,961 stopped; at E3d-2:
  33,268 pass, 24,380 stopped; at E3e (`v128`, 2026-10-08): **57,608 pass, 40 stopped**.
  - **Every corpus, since 2026-10-07 (owner: "Yes (runs everywhere)").** One `interp` run takes
    the core corpus, the LEGACY-EH corpus and the four `proposals/` corpora, and prints each one's
    totals: the legacy and custom-descriptors corpora found three defects the core one was green
    on. The legacy corpus is prepared each session like the core one —
    `deno task spec:prepare <testsuite-main>/legacy <dir>` (`translate-eh`'s output is flat, not
    this layout) — and the proposal corpora are the `proposals` step's output, so `interp` runs
    after it. Expect at E3e: core **57,608 / 0 / 40**; legacy 70 / 0 / 0; custom-descriptors
    170 / 0 / 317; custom-page-sizes 31 / 0 / 0; threads 80 / 0 / 187; wide-arithmetic
    **99 / 0 / 0** (pass / FAIL / stopped; at E3d-2 the core was 33,268 / 0 / 24,380 and
    wide-arithmetic 0 / 0 / 99). A relaxed-SIMD `either` passes on ANY listed alternative. CI
    does not run it — like `spec` and `spec-behaviour`, it needs the sibling repo's testsuite and
    `wast2json`; the gate run here is where it runs.

- ⚠️ **A corpus hash says output CHANGED, not that it is VALID.** Two -O3 defects sat unseen
  (2026-09-14) because optimizer checks hashed the output. `deno task optimize-corpus` optimizes all
  421 modules at `-O1` … `-Oz` and fails on any throw or any module `WebAssembly.validate` rejects.

- ⚠️ **A gate that COMPILES is not a gate that RUNS.** `deno task bridge` read 421/421 for as long
  as the bridge silently dropped every element segment, because an empty table is a valid table.
  `deno task bridge-behaviour` runs both paths in lockstep on identical stubs and compares every
  call plus a memory hash; on the mutant that restores the drop it reports 39 DIVERGE while
  `deno task bridge` still reports 421/421. It calls corpus entry points, which is where the
  coverage is (419 exports) and also why it needs a worker it can kill — one module never returns.
  (Both are history since M8e: `deno task direct` / `direct-behaviour` carry the same pair — one
  compiles and validates, the other RUNS in lockstep — over the prepared tree.)

- ⚠️ **A gate is evidence about what it REACHES.** Not one corpus module has a `(start …)`, so when
  M8e's mutant dropped the start function both direct gates stayed green; only a unit test saw it.
  Since post-M8 fix 7 both also run `prepare.test.ts`'s fixture (`scripts/direct-inputs.ts`), and
  that mutant fails both (`direct`: 3 bytes short; `direct-behaviour`: `f()` 99 vs 0). Before
  trusting a gate for a feature, find an input in it that HAS the feature.

- ⚠️ **Run it after the LAST edit.** If an edit follows the gate, the gate has not run — decision 5
  merged with `deno lint` red that way.
- ⚠️ **Read every step's EXIT CODE.** The naming check is now an exit code too: its TypeScript port
  (2026-09-29) prints each offender AND exits 1. Its shell predecessor always exited 0 and made the
  output the verdict, and a rule that once read it the wrong way round ("prints a filename on
  SUCCESS, read `$?`") hid a real violation (`tests/binaryen-ts/wabt_reference.ts`, from `8c2d0be3d`
  2026-09-11 until its rename 2026-09-18). The lesson stands for every step: read each exit code —
  `deno lint` was failing on `main` for two commits whose messages reported it green (`8f5945b83`,
  `b940e6c6b`; fixed `4f1fe0950`).
- ⚠️ **`bun run test` alone is not the gate** — it type-checks nothing; `bun run check` is the type
  check. (Under Deno, `deno task test` ran `--no-check` and `deno task ci` was check + test;
  dropping `check` left `main` red by CI's standard for 65 unpushed commits, `d550f94a8`.)
- **The spec corpus is per-session scratch.** A new session rebuilds it first:
  `deno task spec:prepare <testsuite-main> <outDir>` then `deno task spec <outDir>`, with `<outDir>`
  in the session scratchpad. Source, READ ONLY (a sibling repo):
  `wasmtk/tests/module/wasm_wast/testsuite-main`, absolute path in the private
  `cmem/local/environment.md`. Expect **2248/2248 · 2714/2714 · 711/711 · 1229/1229**; a different
  count means the prepare step, not a regression.
- **`deno task translate-eh`** splits the testsuite's `legacy/` itself (upstream `wast2json`, so it
  needs that installed) into `<outDir>`. Expect **6 modules, 70 / 70 in all three worlds** (legacy,
  translated, translated `-Oz`). It is not in CI: CI has neither the sibling testsuite nor
  `wast2json`.

