# wabt-ts — the predecessor's memory, summarized

Summary: what the retired wabt-ts side still teaches — the reading guide, the task-ledger rules and
triggers, the pre-merge baseline, runtime rules, and what the overview and release notes still hold.
Last verified 2026-11-20.
Split by subject: [ids](wabt-ts-ids.md), [invariants](wabt-ts-invariants.md),
[practices](wabt-ts-practices.md), [testing](wabt-ts-testing.md); closed history in
[archive/wabt-ts-to-4.1.1.md](archive/wabt-ts-to-4.1.1.md).

wabt-ts brought a wing of 12 files (13,219 lines) into the merge, at `cmem/wabt-ts/`. On 2026-09-14
it was **corrected and summarized into this one file**, and the directory was removed. The policy
is in [INDEX.md](INDEX.md) § "Cleanup policy": cmem is working memory, and git is the archive.

**How to read it.** There is one section per wing file. Each section says what the file was and how
it ended, then gives:

- **Kept** — what still matters, tagged by kind:
  - `[decision]`
  - `[lesson]`
  - `[reference]`
  - `[trigger]` — a condition that makes something act
  - `[baseline]` — a measurement to compare against
  - `[correction]` — a wing claim that is no longer true
  - `[open]`
- **Already in the core** — pointers to where the rest lives now.
- **History** — a summary, with commits.
- **Full text** — the whole file, one command away: `git show 62c65a9db:cmem/wabt-ts/<file>`.

**What was corrected, not just shortened:**

- **Paths.** Every file path was rewritten to this tree and checked with `git ls-files` on
  `08383677a`:
  - `src/<x>` → `src/wabt-ts/<x>`, and `tests/<x>` → `tests/wabt-ts/<x>`.
  - `src/bridge/binaryen-bridge.ts` → `src/bridge/bridge.ts`.
  - The release scripts → `scripts/release/`; the wabt-ts tooling → `scripts/wabt-ts/`.
  - C++ citations → `WebAssembly/wabt/…`.
- **Wing claims the code has overtaken** are marked `[correction]`.

**The full texts are not corrected.** They keep the dead `foo_test.ts` paths and the pre-merge
layout, so translate a path from them before following it.

**Open items this summary found** are not kept here. They were verified and moved to
[open-work.md](open-work.md).

**The T-id index** (in the first section) covers every T-id cited anywhere outside the wing. Code,
tests and commit messages cite T-ids, UP-n and the named bugs, so look them up here first.

## `wabt-ts/tasks.md` (6,760 lines) — the wabt-ts task ledger: T-ids, the conformance campaign, the UP-n upstream log, the decisions log and wabt-ts Phases 1–8

The granular status and decision log of wabt-ts, relocated from the repo-root `TASKS.md` on 2026-06-09.
Top to bottom it holds: the tranche ledger (T1–T13.50) with its numbering rules; the 2026-08-20 →
08-25 conformance campaign (parse-clean → V8-validity → validator agreement → round-trip → execution →
`assert_malformed` → diagnostics, then post-1.4.0 enumeration and hardening passes T13.11–T13.44); the
binaryen-ts upstream log UP-1…UP-7; dated tranche narratives (T1–T7); the 2026-06-09 silent-corruption
audit summary; the wabt-ts Decisions Log; and wabt-ts Phases 1–8 (Phase 7 = bridge, Phase 8 = `wasm2ts`).
It ended at the merge with every tranche closed except T13.50, recorded as post-merge work; T13.50
closed in 1.5.2 (`d6d22559c`). Nothing in the ledger is open today; what this summary found still open
in the code is in [open-work.md](open-work.md).

- § T-id index, § UP-n index: moved to [wabt-ts-ids.md](wabt-ts-ids.md)
- § `wabt-ts/design-decisions.md`, § "2026-06-09 silent-corruption audit": moved to [wabt-ts-invariants.md](wabt-ts-invariants.md)
- § "The audit definition", § `wabt-ts/best-practices.md`, § "Oracles — the engine panel", §
  "Robustness and hardening", § "Audit a manual walk against the TYPE, not against a corpus": moved
  to [wabt-ts-practices.md](wabt-ts-practices.md)
- § `wabt-ts/testing.md`, § `wabt-ts/phases.md`: moved to [wabt-ts-testing.md](wabt-ts-testing.md)
- § `wabt-ts/bridge.md`, § "Why direct recursion", § "Tier coverage": moved to [wabt-ts-to-4.1.1.md](archive/wabt-ts-to-4.1.1.md) (the bridge was deleted 2026-09-18)

**Kept**

Numbering and status (T13.19) — still in use: code cites T13.50b and T13.51, allocated after the merge.
- [decision] A decimal extends a tranche's area, a new integer opens one; **never renumber a closed id**
  (commit messages cite them). Take the max over the index AND `src/`/`tests/`; write a placeholder,
  never a literal example id, in any text a lookup scans (the example matched its own search, T13.19).
- [decision] Status vocabulary: `DONE` (fixed, regression-gated, metrics re-measured); struck-through =
  absorbed, never deleted; `RETRACTED` keeps the wrong claim with its correction; `NO DEFECTS FOUND`
  gets an id and says what was varied (T13.27); `BLOCKED (…)` names its unblocking trigger, and its row
  says "BLOCKED, not done" (T13.22). Every item gets an index row, not just a write-up.

The invariants the T-ids paid for are kept once, in § `wabt-ts/design-decisions.md` below; the method
lessons in § `wabt-ts/best-practices.md`; the campaign figures in § `wabt-ts/testing.md`. What
none of those holds:
- [decision] Out of scope, do not port without revisiting: `wasm-interp` (and `src/wabt-ts/interp/` stays
  a placeholder), `spectest-interp`, `wasm2c`, `wasm-link` (wasmtk's wasmbundler), `wasm-decompiler`,
  fuzzers. wabt-ts is not compiled to wasm itself.
- [lesson] A mutating script must treat an unrecognised flag as refusal, never consent (T13.48; verified in
  `scripts/release/bump_version.ts`).

Triggers — the day X happens, Y is exposed
- [trigger] `src/wabt-ts/` has no module-scope `let`/`var`. The scratch buffers in
  `parser/wast-parser.ts` (`F32_BUF`/`F64_BUF` and their `DataView`s `F32_VIEW`/`F64_VIEW`) are safe only
  because the parser has zero `await`; the day it gains one, they are a live interleaving hazard (T13.36).
- [trigger] `generateLabelNames` walks only block-like kinds — benign because `wasm2wat`'s IR comes from the
  reader (blocks in statement position) and unnamed labels are legal. If either changes, re-check (T13.21).
- [trigger] `varArityForTok` resolves `call`/`return_call`/`array.new_fixed`; `br`, `return`, `throw`,
  `call_indirect`, `call_ref`, `struct.new` still drain the stack (-1). Extend it the day a measurement
  shows one (T10.5; verified in `src/parser/wast-parser.ts:1406`).
- [trigger] wasmtk's Go-leaf memory floor "two pages so byte 65536 exists" (TinyGo's init flag) is false
  under `(pagesize 1)`; its WAT regex `\(memory\s+\(export "memory"\)\s+(\d+)\)` never matches our writer's
  `(memory (;0;) …)` spelling. Carried to wasmtk; not ours to fix, status there not re-checked.

Reference the code still relies on
- [reference] Named bugs cited from code/tests: **Bug D** — empty-folded ops (`(local.set $x)`) pop the deficit
  from the enclosing stack (v1.1.6, `empty_folded.test.ts`); **Bug F** — that pop clamped to what the stack
  holds (v1.1.7); **Bug C** — decimal `f32.const` literals rounded twice (via f64), fixed by rounding the exact
  rational once, `decimalToBits` (`1f1eec50e`, `decimal_float_rounding.test.ts`; the last of three wasmtk
  spec-runner `const.wast` bugs after A, `br_if`, and B, hex-float); **Bug G** — `call_indirect (type $name)` typeVar never resolved → index 0 (v1.2.0,
  `bug_g_repro.test.ts`). Standing guard for the class: no name-var survives `resolveNames`
  (`tests/wabt-ts/ir/encode_correctness.test.ts`; `ref.null.refType` the one exception).
- [reference] `/compat`: `parseWat` ignores its features bag (`_features`), so partial feature bags equal
  `enable_all`; the facade exposes no `Limits` and no IR, so T13.3/T13.4 never reached wasmtk.
- [reference] Cross-engine support for what we emit (2026-08-24; Wasmtime 47.0.3, V8/Node 24.19, Bun 1.3.14,
  Wasmer 7.2.1, wazero 1.12.0): memory64/table64 fail on Bun, Wasmer and wazero; GC, multi-memory, tail call,
  EH fail on wazero; custom page sizes run on Wasmtime only; **wazero's CLI rejects any module with a tag
  section**, legacy or `try_table`; Wasmtime and Wasmer refuse legacy `try` outright (no `-W` switch).

Corrections someone could re-derive wrongly
- [correction] The 7 `KNOWN_INVALID` wasmtk modules were STALE SNAPSHOT BYTES, not wasic bugs; the
  `$__exn_tag`/`needsExceptionTag` finding was retracted; legacy-EH scope was 10 modules, not 6.
- [correction] The 19 "V8-accepts" `assert_invalid` leftovers were mostly our encoder repairing modules (T13.2).
- [correction] Six `ours=ACCEPT / V8=reject` size cases are V8 implementation limits — Wasmtime accepts all
  six; adding limits would reject valid modules (T13.35).
- [correction] Diagnostic offsets: T13.35's "offset must not precede the corruption" oracle is false for any
  multi-byte construct — reporting a LEB's start is better → measured since as A3 (core).
- [correction] `ModuleContext.getExprArity` (published via `src/ir/ir-util.ts`) has no production
  caller — only `tests/wabt-ts/audit/silent_corruption_fixes.test.ts` — so its precomputed maps are NOT a
  hot path, and are kept only because `ir-util.ts` is public API. T13.28 corrected the wing, not the code:
  the class doc ("reused across validator, binary writer, and bridge") and the field comment at
  `ir-util.ts:86-90` ("getExprArity calls them for every expression during validator and writer walks")
  are still false → [open-work.md](open-work.md).
- [correction] Phase 3's "DataCount always written if data exists" is superseded by W6 (upstream rule) →
  divergences.md closed table.

**Already in the core** — pointers only:
- Three-engine panel, and legacy EH has V8 as its only oracle (T13.17) → cmem/testing.md § "A
  fixture believed valid must be said to an engine" (Wasmtime as the accept/reject authority,
  2026-08-21 `97e96699e`, is not stated as such in the core — kept here as a decision)
- A harness must call the real entry point (T13.39); print what a harness SKIPS (execution harness) → cmem/testing.md §§ "A harness must call the real entry point", "Print what a harness SKIPS"
- Every test has an axis (T13.11/T13.13); four corpus-free tests (atomics blind spot, folded/linear
  differential of T13.8) → cmem/testing.md §§ "Every test has an AXIS…", "Four tests that need
  neither a corpus nor an oracle"
- Every metric is blind to something (agreement counts false rejections only; `wat2wasm` does not validate) → cmem/testing.md § "Every metric is blind to something — record what"
- Clean / measured / UNMEASURED; A3 offsets measured → cmem/testing.md §§ "Three states, not two", "A3 — diagnostic offsets are MEASURED"
- wasmtk corpus is a snapshot; regenerate before claiming anything about wasic (T13.45/T13.46) →
  cmem/testing.md § "The wasmtk corpus is a SNAPSHOT…"; `tests/wabt-ts/wasmtk/PROVENANCE.md` (421 =
  413 + 8, 373-vs-413 unreconciled)
- Release guard + wiring tests (T13.43/T13.44); dirty-tree recovery → cmem/testing.md § "The release
  path is tested, and needs two tests"; cmem/publishing.md § "A dirty tree ships a release
  containing none of the work"
- `publish:dry` is not in `deno task test` (T13.3's slow-types break) → cmem/publishing.md § "`publish:dry` is in CI but NOT in `deno task test`"
- Never run `deno publish` locally / CI calls `deno publish` directly (OIDC); sub-version cap at 9 → cmem/publishing.md §§ "Never run `deno publish` locally", "Version rule — sub-version capped at 9"
- `minimumDependencyAge` decision (T13.47 Blocker 1) → cmem/project.md, cmem/publishing.md § "Consumers hit a 24-hour wall"
- JSR license MIT not compound → cmem/licensing.md
- CRLF / `deno fmt --check` false alarm and `git stash` EOL rewrite (T13.24, T13.42) →
  cmem/testing.md § "The `deno fmt --check` line-ending false alarm is RETIRED";
  cmem/best-practices.md § "Pin every environment-dependent default in the repository…"
- Heredoc corrupts content (T13.28 root cause) → cmem/best-practices.md § "Do not author file CONTENT through a shell heredoc"
- Resolution of a pinned version vs a fresh cache (related to T13.23, not the same rule) → cmem/best-practices.md § "`--reload` does not invalidate a resolved VERSION…"
- Invert every gate before trusting it (T13.24's guard-the-guard, T13.42) → cmem/testing.md § "Invert every gate before trusting it"
- T13.22 closed before the merge; T13.50/A1 closed 1.5.2 with its two lessons; bridge not exported → cmem/ir-convergence.md (bridge + WAT routes summary)
- Diagnostic wording figures; "a snapshot headed now silently becomes false"; the coupling lesson → cmem/project.md § "Live gaps carried from the predecessors"
- `wasm2ts` stub, WASI Preview 1 goal (wabt-ts Phase 8) → cmem/project.md § "Live gaps…", cmem/open-work.md § "Repo work" (A2)
- Custom-section placement divergences (C2–C6), relocation-padded LEBs (L1), DataCount (W6) → cmem/divergences.md
- Wing test-file paths use the dead `_test.ts` form → cmem/testing.md § "Every test-file path in the wing full texts is DEAD"
- Per-invariant metric tables and the hardening-axis states → § `wabt-ts/testing.md` below

## `wabt-ts/pre-merge-known-issues.md` (362 lines) — the wabt-ts side's pre-merge register, measured 2026-08-25

This was wabt-ts's inventory of what the merge had to settle or must not hide. It listed defects
that survive the merge (A0–A5), mechanical collisions (B1–B3), configuration (C1–C3), licensing (D),
what the merge resolves (E), and do-first actions (G1–G3). The two sides' registers were
reconciled into one on 2026-08-26, and every decision is now in the core. What remains uniquely here
is G1, a few lessons, and the dated measurements.

**Kept:**

### G1 — the emitted-byte baseline
- [baseline] `scripts/wabt-ts/pre-merge-baseline.tsv` (421 corpus files, 1,557,602 bytes) is checked by
  `scripts/wabt-ts/verify-baseline.ts`, which `deno task baseline` runs. A pure relocation must report
  `IDENTICAL`. It is deliberately NOT a test: re-baseline in the same commit as a genuine encoder change
  and say why. It was captured before the merge because the conformance harnesses live in scratchpads
  and could not be rewritten "before" afterwards. Details → cmem/testing.md § "Proving a refactor changed nothing: `deno task baseline`".
- [lesson] A package's public subpaths are not derivable from its file tree. The audit checked `src/`
  directories and tracked paths and missed both `exports` collisions (`.` and `./compat`); binaryen-ts
  found them (B2a).
- [lesson] Merge `cmem/` by TOPIC, not by concatenation. The two sides were 14,023 and 2,296 lines, and
  a naive merge reads as the larger side's memory with notes appended.
- [trigger] A1: the bridge's `ref.null` refusal for a user-defined heap type was a DIFFERENT defect from
  de-coarsening ("do not assume it went away"). It closed as T13.50b in `d6d22559c`, gated by
  `tests/bridge/gc_decoarsening.test.ts`; the refusal message no longer appears in `src/bridge/`.
- [decision] A4, wasmtk's "373 vs 413" corpus count, is deliberately NOT reconciled: which sources count
  is wasmtk's call. Recorded in `tests/wabt-ts/wasmtk/PROVENANCE.md`.

**Already in the core:**
- All pre-merge decisions and outcomes are in cmem/project.md § "The merge — how it was prepared (2026-08-26)" and § "Settled decisions":
  - B1 namespacing (`src/wabt-ts/` rather than `src/wabt/`).
  - B2a `./compat/wabt` and `./compat/binaryen`.
  - B3 and a clean break with no shims.
  - C1/G2a `compilerOptions` and the `lib` union.
  - C2/G2/P1 singleQuote (`eba0207cf39`).
  - C3 `minimumDependencyAge`.
  - A0/T13.22.
- A1/T13.50 de-coarsening closed in 1.5.2 (`d6d22559c`) → cmem/project.md § "Versions"; cmem/ir-convergence.md
- A2 `wasm2ts` stub, still open → cmem/open-work.md § "Repo work". A3 offsets MEASURED 2026-08-31 → cmem/testing.md § "✅ A3 — diagnostic offsets are MEASURED (2026-08-31)"
- D licensing → cmem/licensing.md § "The merged repo inherits BOTH upstreams' obligations"
- A5 repack failure → `cmem/local/environment.md` (private and gitignored; machine-level, so correctly outside the committed cmem)
- E2: the `CLAUDE.md` archive does not travel. The rule "project knowledge in `cmem/`, machine facts outside" is now the INDEX cleanup policy.

## `wabt-ts/runtime-tooling.md` (124 lines) — wabt-ts's runtime targets and TypeScript compiler rules

This file covered Deno as primary and Bun as secondary, measured Bun/Node behaviour (2026-08-24),
`Features` gating for callers, the four strict compiler options with idioms for each, the `Result`
enum convention, and the binaryen-ts exact pin. Runtime floors and the layered portability rule have
since been superseded by the core. The compiler idioms and `Result` convention are still live.

**Kept:**
- [reference] Idioms for the strict flags (root config; `tests/binaryen-ts/` opts out of `noUncheckedIndexedAccess`):
  - `verbatimModuleSyntax`: `import type` for type-only imports, with `.ts` extensions.
  - `noUncheckedIndexedAccess`: iterate with `.entries()`. To walk imports by kind, keep a running index;
    never filter and then index, because the filtered indices are not the index space.
  - `exactOptionalPropertyTypes`: omit an optional property rather than assigning `undefined`, and
    forward optionals with `if (x !== undefined) o.x = x`.
- [reference] `Result` is a plain enum (`Result.Ok = 0`, `Result.Error = 1`), not `Result<T>`. Chain with
  `combineResults`, not `combine`. A helper that records an error but returns a value sets a
  `hadError` flag, which is folded into the final result.
- [lesson] `bun test tests/` treats the argument as a path FILTER and walks sibling checkouts, so a naive
  Bun run reads as catastrophic. Node's `--experimental-strip-types` rejects `enum` (`core/types.ts`),
  so Node runs the published, transpiled package. That is why the slow-types check matters for the Node claim.
- [baseline] Bun/JSC rejects memory64 and table64 where V8 accepts them (Bun 1.3.14, 2026-08-24; not
  re-measured on the 1.4.0 floor).
- [reference] For callers, `wasmValidate(binary, { features })` ENFORCES the set (T13.10). `allFeatures()`
  answers "is this valid wasm at all"; `defaultFeatures()` is the ratified set. CLI flags are hyphenated
  as in wabt (`--enable-multi-memory`).

**Already in the core:**
- Runtime floors (Node 22.18.0, Bun 1.4.0) and the layered portability rule (library web-only; CLI `node:*`, not `Deno.*`) → cmem/project.md § "Runtime portability, layered"
- `lib` is now `esnext, deno.ns, deno.window, dom` (the `deno.window` rule survived as part of the union) → cmem/project.md § "Settled decisions"
- A caret plus lockfile is a pin only until reload, and correctness pins go in the specifier → cmem/best-practices.md § "🆕 `--reload` does not invalidate a resolved VERSION"
- CLI matrix Deno / Node 22.18 / Node 24 / Bun 1.4 → cmem/testing.md § "CI gate"

## `wabt-ts/overview.md` (478 lines) — what wabt-ts was, and its conformance state and T13 story at 2026-08-25

What wabt-ts was: a TypeScript port of WebAssembly/wabt, built so wasmtk would not need the compiled
binary, with `wasm2ts` as the long-term goal. The file also held the conformance table, a
newest-first retelling of the T13 audit and hardening passes (T13.11–T13.47), the standalone repo
layout, and the sibling-project framing. **It is stale in two ways.** It treats wasmtk as part of
the merge, but binaryang is two projects and wasmtk stays a consumer. And its layout (`upstream/`,
`binaryen-ts/`, `wasmtk/` submodules, `src/bridge/binaryen-bridge.ts`) no longer exists.

**Kept**
- [correction] **The merge was two projects, not three.** → cmem/project.md § "Scope: two projects,
  not three". Source is now `src/wabt-ts/…`, the bridge is `src/bridge/bridge.ts`, and there are no
  submodules. The upstream C++ is a gitignored clone in this repo at `upstream/wabt/` (moved in from
  the wabt-ts checkout 2026-10-26; `1.0.41` + 68 checked out; upstream also has `1.0.42`, newer than
  the 1.0.41 oracle).
- [decision] **Who encodes what.** wabt-ts's encoder serves the format tools (the
  `wat2wasm`/`wasm2wat` round trip, strip, validate). binaryen-ts encodes *optimized* wasm. External
  `.wat` enters through wabt-ts (routing W4 → cmem/ir-convergence.md § "The bridge and the WAT
  routes into binaryen-ts — history, summarized").
- [decision] **Wasmtime is the authority when V8 and Wasmtime disagree**, and engine limits are told apart
  from spec limits → § "Oracles — the engine panel" above.
- [trigger] **An import-surface diff is not an upgrade test.** When the binaryen-ts side changes
  what it *requires* of callers, every import still resolves while the bridge breaks: at 1.5.0, 0 of
  72 imports were missing and 12 of 28 bridge tests failed (T13.47). With no pin any more, run
  `tests/bridge/` after S6 or any encoder change.
- [open, unverified] **wasmtk's legacy-EH output is rejected by Wasmtime and Wasmer**, while its
  `try_table` output reaches parity: `scripts/wabt-ts/wasmtk-eh-parity-report.md`, which also
  carries a RETRACTED `$__exn_tag` finding. This is wasmtk-side, so it is not tracked in
  cmem/open-work.md, and it has not been re-checked since 2026-08-25.

**Already in the core**
- `wasm2ts` is a stub (wabt-ts Phase 8) → cmem/project.md § "Live gaps carried from the predecessors"; cmem/open-work.md § "Repo work" (A2)
- Metric blind spots; a corpus lacking atomics hides a whole proposal → cmem/testing.md § "Every metric is blind to something — record what", § "Four tests that need neither a corpus nor an oracle"
- The `Limits` bigint / `pageSizeLog2` breaks and who they reach → cmem/publishing.md § "⚠️ `bump` has no minor mode — a non-patch release is typed by hand"
- T13.22/T13.24 and the bridge's own label stack → cmem/ir-convergence.md § "The bridge and the WAT
  routes into binaryen-ts — history, summarized"; diagnostic wording at close → cmem/project.md §
  "Live gaps carried from the predecessors"

## `wabt-ts/publishing.md` (318 lines) — wabt-ts JSR releases 1.4.0 → 1.5.0 and its release flow

Covered the release flow, the version rule, the `auto-tag` `actorNotScopeMember` trap, slow types,
never publishing locally, and repo hygiene. It also covered the contents and severity of 1.4.0
(breaking), 1.4.1 (fifteen fixes) and 1.5.0 (nothing user-visible). The predecessor is frozen and
archived → cmem/project.md § "The retirement — complete (2026-09-02)".

**Kept**
- [decision] **wabt-ts 1.5.0 skipped the bump rule on purpose**, for version parity with binaryen-ts 1.5.0 when the T13.22 coupling resolved. 1.4.2–1.4.9 never existed; the gap is not a tooling fault.
- [lesson] **Rank a release by failure class:** wrong code from valid input (T13.16), then silent
  repair of invalid input (T13.26), then loud valid-input-rejected (T13.11, T13.15) or
  invalid-accepted (T13.14, T13.17). **An unreleased fix is indistinguishable from an absent one
  downstream.**
- [lesson] **A documented command can go wrong without changing, when the question moves under it.**
  A `grep -c` of "unreleased" rows silently became a count of released contents once the section was
  retitled. Ask git (`git diff --stat <last tag>..HEAD -- src/`), not prose.

**Already in the core**
- Never `deno publish` locally; the tag-driven flow; the version rule → cmem/publishing.md § "The
  release process (§2.2, merged 2026-08-31)"; `auto-tag` dispatch and recovery → § "The auto-tag
  dispatch path does not publish — its cause, and the recovery"
- Slow types and the Node path → cmem/publishing.md § "`publish:dry` is in CI but NOT in `deno task test`"; the dirty-tree guard (T13.43) → § "A dirty tree ships a release containing none of the work"
- `Limits` / `pageSizeLog2` / feature-gating breaks → cmem/publishing.md § "⚠️ `bump` has no minor mode — a non-patch release is typed by hand"; hygiene → § "Repo hygiene and the memory routing rule"

