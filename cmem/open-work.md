# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

Rewritten 2026-09-14 as outstanding-only. It had grown to 912 lines, most of them CLOSED history;
that history now lives in its topic files — nothing was dropped:

| closed history                                                  | now in                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| the spec-testsuite harness, SP1–SP5, G2, the feature-set lesson | [testing.md](testing.md)                                   |
| the IR convergence record and status, S1–S7                     | [ir-convergence.md](ir-convergence.md)                     |
| every upstream difference, open and closed                      | [divergences.md](divergences.md)                           |
| names (N1 and its release items)                                | [names.md](names.md)                                       |
| everything on `main` awaiting a release note                    | [unreleased.md](unreleased.md)                             |
| the WAT routes, the folded-writer ladder, the bridge question   | [ir-convergence.md](ir-convergence.md)                     |
| the retirement (D2 / D3, the frozen predecessors)               | [project.md](project.md)                                   |
| the 1.5.5 quality passes                                        | [testing.md](testing.md)                                   |
| releases, 1.5.4, `RELEASE_PAT`'s root cause                     | [publishing.md](publishing.md)                             |
| the wasmtk correspondence                                       | [handoffs.md](handoffs.md)                                 |
| the predecessors' wings (T-ids, UP-n, WT-n, invariants → tests) | [wabt-ts.md](wabt-ts.md), [binaryen-ts.md](binaryen-ts.md) |
| the 2026-09-14 memory consolidation                             | [INDEX.md](INDEX.md) § "Cleanup policy"                    |

**State, 2026-09-28 (latest):** `main` = 1.6.1 published (CLI from JSR) + unreleased work for
**1.6.2** ([unreleased.md](unreleased.md) § "After 1.6.0"): wasmtk's items 1–5, ALL of them now —
**5a custom descriptors merged** (`feat/custom-descriptors`; the 5a row below) — plus the folded
operand fixes found with it. Gate green on the committed tree (1,325 tests; spec 100% on four axes
with `customDescriptors` off for the core suite — [testing.md](testing.md)). NOT pushed; `main`
is well ahead of `origin/main`. The draft reply to wasmtk ([handoffs.md](handoffs.md) § 15) says all
five ship in 1.6.2 — it is the owner's / workspace's to send. **Next (owner, 2026-09-28): the
decommissioning** of binaryen-ts's codec adapters, decided "relocate, keep names" (§ "IR
convergence — next steps"). Open question for the owner: drop `wast2json` ([testing.md](testing.md)
§ "Do we need upstream `wast2json`?").

**State, 2026-09-28 (release, history):** 🚀 **`binaryang@1.6.0` PUBLISHED** (tag `v1.6.0`, commit
`64d22e06f`; JSR `rekorLogId=2987187551`, 647 symbols; CI, Auto-tag and Publish all green). One
front end stages 3b and 4b are in it: `./binary` and `./encoder` are gone. `main` = the release,
pushed: **1,315 tests / 0 failed**, baseline IDENTICAL, spec 100% on four axes, spec-behaviour 0
DIVERGE and no refusals (57,808 invocations, 24,151 through v128), `direct` 544/544,
`direct-behaviour` 1953 calls. ⚠️ wasmtk pins binaryang exactly (1.5.3) — 1.6.0 reaches it only
through their bump, and it is BREAKING for anything importing the two removed subpaths or the IR
shapes in CHANGELOG.md (wasmtk uses `/compat/*` only). Re-derive before quoting.

✅ **One front end stage 5 is DONE (2026-09-28, merge `824a4b435`, NOT pushed): binaryen-ts's WAT
parser is deleted** — `src/binaryen-ts/parser/`, 4,750 lines, no public path. One text front end,
one reader, one writer: **ONE FRONT END IS COMPLETE.** 46 test files moved to `readWat`;
`tests/binaryen-ts/parser/` is `tests/binaryen-ts/text_route/`. Found on the way: W14 (FIXED,
`function` taken for `func`), W15 (DESIGN, recorded). Gate green on the committed tree; 1,286 tests.
Not release material on its own (nothing public changed except W14's refusal, a fix) — it rides
the next release.

**Next session:** the "Start here" block below is DONE through the release, and stage 5 after it
(its ⬚ markers were swept 2026-09-28: 8 closed, each saying what closed it). **The open list is
the ⬚ markers in this file — 29 on 2026-09-28**, by area:

| area | where below | owner's order (2026-09-28) |
| ---- | ----------- | -------------------------- |
| the pipeline-convergence proposal; the names data-type list; Flatten's unsupported constructs | "Handoff before the pre-bump items" items 2 and 4; § Flatten | **first** — ✅ worked 2026-09-28: convergence MEASURED (owner decides), names § 1a written, Flatten's value branches merged (`51be28b2e`); what is left of each is below, marked |
| defects and gaps (≈10) | § "Open defects and gaps", and the found-not-fixed items under "Handoff before…" | **second** |
| optimizer and IR (≈10) | § "IR convergence — next steps" | then re-evaluate |
| conformance (2), quality passes 1.5.6 / 1.5.7, repo work (3), wasmtk thread (2) | their sections | then re-evaluate |

A workspace handoff to wasmtk about 1.6.0 is the workspace session's to write, not this repo's.

📥 **wasmtk's letter, 2026-09-28** (measured on published 1.6.0; their gate 63,986 pass / 0 fail /
618 skip, 569 of the skips ours). **All five REPRODUCED on `main` the same day**
(`scratchpad/wasmtk-repro.ts`):

| # | item | reproduced | whose call |
| - | ---- | ---------- | ---------- |
| 1 | ✅ a named heap type in an inline `call_indirect` / `return_call_indirect` typeuse was never resolved (`$$t`: the message's `$` before `$t`). FIXED `34c7a6bbf`: `resolveNames` walks the node's own `sig`; `return_call_indirect.wast` text modules 2/3 → 3/3 | yes | done |
| 2 | ✅ `allFeatures` / `defaultFeatures` / `Features` exported from `./wasm-validate` AND `./core/wabt-ts` (`05d027a19`) — a MINOR | yes | done (owner: "do items 1–5") |
| 3 | ✅ compat/binaryen `Module.validate()` validates: the one writer → the one reader → the validator, all features; `0` + reasons on stderr (`d9810af06`) | yes | done |
| 4 | ✅ `@name` placement checked (after a binding id; once on a module; value NOT applied), branch hint duplicate / outside a function (malformed) / non-branch target (invalid, on the binary: `validator/branch-hints.ts`) (`6ab458690`). Found by it: a hint before a FOLDED instruction was written at the expression's first byte — as upstream wabt; now at the instruction, as wasm-tools (divergence W16) | yes | done |
| 5 | ✅ **5b** `(memory (pagesize N) (data …))` (`b5c337f10`; `custom-page-sizes.wast` 10/12 → 12/12), and found beside it: an inline-data memory wrote NO maximum (the spec's `(memory m m)`) — fixed. ⬚ **5a custom-descriptors** — NOT built, scoped: 14 wasts, 381 modules, 1,029 assertions (157 invalid, 127 malformed, 271 return, 216 trap); `exact` (1,259 uses), `descriptor` / `describes` type clauses, six instructions (`ref.get_desc`, `ref.cast_desc_eq`, `br_on_cast_desc_eq(_fail)`, `struct.new(_default)_desc`) — parser, binary encoding, validation, and the optimizer's walkers — ONE IR since 1.6.0 (`wabt-ts/ir/ir.ts`; binaryen-ts's `expressions.ts` / `gc-types.ts` are views of it), two sets of consumers. A proposal-sized job (the conformance row below); V8 needs a flag. ✅ **BUILT** 2026-09-28 (owner: "we will build 5a"; `feat/custom-descriptors`, `927fdcdd7` A+C, `ae003aad7` B): measured with wasm-tools `json-from-wast` as the oracle and V8 `--experimental-wasm-custom-descriptors` — return 271/271, trap 213/213, invalid 157/157, malformed 127/127, modules 91/93 (the 2: explicit `(sub final)` written `0x4f 00`, wasm-tools writes the shorthand — our one-to-one choice). The testsuite overrides the Overview on finality and the full square. NOT in the spec gate: `spec-prepare` reads the testsuite's top level only, not `proposals/` (the harness was scratch; `tests/wabt-ts/custom_descriptors.test.ts` pins its findings). Found on the way and fixed: folded surplus children dropped; folded `br_on_cast` lost its ref under a carried value; linear `struct.new` drained the stack; `struct.new_default` never checked defaultability. Left for later: binaryen-ts's `derive-types` keeps plain allocations INEXACT (it does not know the features); `array.new_default` defaultability unchecked (read in `onArrayNewDefault` 2026-09-28; not probed) | yes | owner: when |

All merged to `main` (`8fee83e95`), gate green; NOT released — 1.6.1 carried only the CLI fix.
The next release carries these and must say which of 1–4 it contains (their process).

Found WITH item 1: `d732dee98`'s explanation ran the validator with DEFAULT features, so their
module got five "enable the functionReferences feature" lines before the real error — fixed the
same day (`853ed5991`, all features). Their process: they verify a PINNED version, and want the
changelog to say which of 1–4 a release contains.

## 🚀 Start the next session here (handoff, 2026-09-28 late — PRE-BUMP ITEMS 1–6 DONE; next is THE BUMP)

**Owner, 2026-09-28: "Lets work through items 1 through 6 then we will update the project memory
files and bump and push."** Items 1–6 are merged (`801979ed3`), the gate green on the committed tree
(every step exit 0). What remains, in order:

1. ✅ **DONE — released as 1.6.0 (2026-09-28).** **The bump branch** — its content is fixed below under "Decided (owner, 2026-09-19): option
   (a)" and the ➕ additions: unpublish `./binary` and `./encoder` from `deno.json` `exports`; delete
   binaryen-ts's decoder (3b) and encoder (4b); move the ~80 test files on `parseWasm` and ~104 on
   `encodeWasm`, and ~35 scripts, onto `readForPasses` / `writeWasm`; drop route A from
   `spec-behaviour` (its `ROUTES`) and empty `REFUSED_BUDGET` (the 7 relaxed-SIMD pins are route A's);
   README (the `parseWasm` example, the two entry-point rows) and CHANGELOG.
2. ✅ **The version is 1.6.0 (owner, 2026-09-28)** — a hand-typed MINOR: the release removes two
   published subpaths and [unreleased.md](unreleased.md) lists several BREAKING IR changes; the
   repo's precedent for removed exports ([publishing.md](publishing.md) § "`bump` has no minor
   mode"). `deno task bump` would make 1.5.5 — type it in `deno.json` AND `main.ts` by hand.

   **The bump branch (`bump/one-front-end-3b-4b`) found more than it deleted** — owner, asked
   whether to finish or release without deleting: "Finish it all first". Deleting the encoder
   removed its fail-loud checks, and the suite on the one writer alone found four defects the
   encoder had been covering, one of them LIVE since stage 4a (divergences.md, closed table,
   "found deleting the encoder / decoder"): API-built GC `get` written `get_u`; a frame branch
   captured by an unnamed block; a declared segment's placeholder table; `mul_wide` typed one
   i64. Fixed in `writeWasm`'s resolve step (`checkForWriting`, `nameTheFrame`) and
   `inferBinaryType`, with the encoder's refusals ported; parity 14,595 / 14,595 unchanged.
3. ✅ **DONE (1.6.0, tag `v1.6.0`, `rekorLogId` 2987187551).** Then the release flow ([publishing.md](publishing.md) § "The flow"): merge unbumped, gate,
   bump as its own commit, `deno task release` (it runs the cold type check first — item 1 below).

### The pre-bump items (owner's list, all DONE 2026-09-28)

| # | item | commit | result |
| - | ---- | ------ | ------ |
| 1 | the release script type-checks COLD (fresh `DENO_DIR`) before any git mutation | `83e10a7ea` | `publish_preflight_wiring.test.ts` |
| 2 | K4 `toWat()` / hybrid mode; W8 code metadata | `8eb633a95`, `815a59244` | divergences.md K4, W8 |
| 3 | validator: nothing after `catch_all` (W13); W7 bare `ref` | `cdbe4aaeb` | divergences.md W7, W13 |
| 4 | Q9 a tag keeps its type; W12 tag imports name their type | `d5d059a45` | divergences.md Q9, W12; re-baselined (21 texts, no bytes) |
| 5 | the Flatten decision: KEPT — never silently invalid now | `6107691db` | below, "Flatten" |
| 6 | spec-behaviour runs SIMD (v128 wrappers) | `cd7071629` | [testing.md](testing.md) § "Not yet covered" |

Every fix pinned by tests and inverted: 12 + 6 + 14 + 3 + 6 (+ 2 planted SIMD miscompiles) mutants,
all caught — three only after a test was ADDED for them (W8's operand-stack hint writes the same
bytes, so a tree-shape test; Q9's inline-tag intern, reached by no text; the encoder's defined-tag
site, absent from the fixture).

## Handoff before the pre-bump items (2026-09-28 — ONE FRONT END stage 2 DONE; the optimizer behaves as its input across the spec testsuite)

**2026-09-28: stage 2 is COMPLETE** — its last item, R15 (block-parameter lowering as a tree pass,
merge `196a40c0c`), and then every defect a behaviour check surfaced, Q1–Q8 (merge `a46dab48b`). The
check that closed it: each spec module's own `action` / `assert_return` / `assert_trap` replayed
against the original, a plain decode → encode, and -O1…-Oz on both routes. Result: the optimizer's
output **behaves as its input on every spec module it accepts**, INVALID outputs **0** (was 9 on
2026-09-20's `main`), and multiple tables are no longer refused (item 5); what is left is relaxed SIMD on route A. Full gate green
on `d91f0e6f3`, the last commit: fmt, lint, **1300 tests / 0 failed**, naming (no output),
portability, baseline **IDENTICAL**, publish dry-run, operators, spec **no misses**, `direct`
**544/544**, `direct-behaviour` **1953 calls / 651 exports**, `translate-eh` **70/70** in all three
worlds, optimize-corpus every level. Pick up here, in this order:

1. ✅ **One front end stage 2 is DONE** — R15 merged 2026-09-28 (item 3 below), and every defect its
   behaviour check and a whole-testsuite behaviour check found is fixed (item 4). The optimizer's
   output now behaves as its input on every spec module it accepts; since item 5 it refuses only relaxed SIMD, and only on route A — which no entry point takes since stage 3a.
2. **NOT the pipeline-convergence proposal** ("passes until the delta over the next two rounds averages
   under 0.1%"). Answered in chat and recorded below, then **parked by the owner**: noted now, tested in
   practice once the open items are worked through. Do not start it — not even the measurement — while
   anything above it is open.
   ✅ **MEASURED 2026-09-28** (owner: "start on the 3"; `scratchpad/converge.ts`, re-derive before
   quoting): the whole `-Oz` pipeline repeated over 2,919 modules (corpus + spec). Round 1 →
   1,266,410 bytes; round 2 saves **0.012%** (20 modules shrink), round 3 **0.002%** (3), round 4
   ≈ 0 (1). **No round grew any module**, so "the delta over the next TWO rounds" and "the next
   round" stop at the same place. The largest single gain is 24 bytes (`simd_const.387`, 11%), and
   every gain is on a spec module — none of the 421 corpus modules moved.
   (Recommended not to build: ~150 bytes over the suite against a 60.3 KB coverage gap.)
   ✅ **BUILT — owner, 2026-09-28: "build the pipeline convergence"** (merge `25717c474`):
   `optimizeToConvergence` (`passes/converge.ts`, exported from `./passes`) and `wasm-opt
   --converge` / `-c`, OPT-IN as upstream's. Rounds of the same schedule, each ENCODED; stops at
   an average gain under 0.1% over two rounds (the owner's rule), a fixed point, a cycle (bytes
   repeating an older round), or 20 rounds; the SMALLEST round wins, never larger than round 1.
   Over 2,919 modules: 0 invalid, 4 s, −176 bytes (0.014%) below one `-Oz`, every module at a
   fixed point (2,898 after 2 rounds). In the gate as spec-behaviour's `-Oz --converge` variant.
3. The `-Oz` size record is fresh and complete: [names.md](names.md) §§ "Names under optimization,
   priced" and "Does optimization RENAME things to shrink them?". Do not re-measure it; four new
   items in this file's optimizer list draw on it.
4. **On the next session's list (owner, 2026-09-19), after the items above:** list the DATA TYPES that
   carry names, with what would need renaming and what references each, then discuss how to minify
   without creating errors — upstream's way or a better-for-size way, measured either way. Scoped in the
   optimizer list below, under the `MinifyImportsAndExports` item; start from [names.md](names.md) § 1.
   ✅ **The list is written, 2026-09-28: [names.md](names.md) § 1a.** Measured: the twelve
   name-section kinds cost **0** bytes at `-Oz`; the whole prize is the INTERFACE (export names,
   import fields, import modules) — a ceiling of **29,668 bytes, 3.24%** of the corpus' `-Oz`
   output — and its error surface is the host, outside every gate.
   ✅ **BUILT — owner, 2026-09-28: "perform the Names data-type list items as noted in the names.md
   file"** (merge `26d4ca11e`): upstream's three passes, `MinifyImports`,
   `MinifyImportsAndExports`, `MinifyImportsAndExportsAndModules` (`passes/minify-imports-and-exports.ts`),
   OPT-IN, with the map — byte-identical to `wasm-opt` 132's on three probes (up to 4,000
   exports). The map round trip names.md asked for is in the gate: spec-behaviour's "minify through
   its map" variant — the host supplies imports and calls exports by the NEW names; a wrong map
   over self-consistent bytes is caught (two mutants). Corpus after `-Oz`: −6,203 / −13,002 /
   **−29,674 bytes (3.24%)** — the ceiling § 1a measured. `wasm-opt` prints the map to stdout as
   upstream; `onMinifyMap` / `takeMinifyMap` for the API; two runs compose (so `--converge` too).
5. ⚠️ **Unfinished measurement**: `scratchpad/names/types.ts` (Type-section bytes, ours vs upstream)
   was still running when the session ended and its number was never read. Re-run it — the scratchpad
   is session-scoped and will be gone.

**Where the work stopped.** The last CODE change is Q1–Q8 (`5b25d7846`, merged `a46dab48b`,
2026-09-28); before it R15 (`629884084`, merged `196a40c0c`). Clean except `cmem/INDEX.md`'s
uncommitted workspace pointer (not this repo's session's edit — leave it to the owner), nothing
pushed, `deno.json` still 1.5.4. **No branch is open** (⚠️ many stale merged branches exist —
`stage2/r15-tree-lowering`, `fix/q1-q3`, and the SUPERSEDED `wip/r15-tree-pass`, never merged, kept
for its commit message; check `git log -1 <branch>` before reusing a name). Corpus outputs moved by
the whole of 2026-09-28: **0** of the 421 corpus modules at any level; the 454 spec outputs that
moved behave as their input.

✅ **The behaviour check is `deno task spec-behaviour <outDir>`** (item 6 below) — run it after any
change to the optimizer or a front end. Whether it joins the gate is the owner's call (item 6).

✅ **The naming step is clean again (fixed 2026-09-18, owner-approved).** From `138148881`
(2026-09-11) `check-naming.sh` printed `tests/binaryen-ts/wabt_reference.ts`, a bare `wabt`
component, which CI's step fails on; a misread rule ("prints a filename on SUCCESS — read `$?`") hid
it. The helper is now `nameless_reference.ts`, and [working-rules.md](working-rules.md) says how the
step is judged: by its OUTPUT.

✅ **`corpus_roundtrip.test.ts`'s flaky oracle — fixed 2026-09-18 (`57b16a115`).** It failed twice
(once in M8a3's gate) on binaryen's `lit/control-flow-input.wast.wasm` with input and output
BYTE-IDENTICAL. First recorded as V8 validating lazily; the probe said worse: V8 in **Deno 2.9.7 has
no stable verdict on that binary** (legacy + new EH mixed) — 39 of 40 `WebAssembly.compile` AND
`WebAssembly.validate` calls rejected it — and **two of three probe runs crashed Deno** ("Check failed:
`!job->compile_imports_.empty()`"). No JS oracle can judge it, so the test holds it to byte identity
(`ENGINE_UNSTABLE`). ⚠️ If a Deno upgrade fixes the engine, the set can go; if another binary starts
flaking, probe it the same way before adding it.

⚠️ **The gate needs upstream wabt 1.0.41 on PATH** (`wast2json` for `translate-eh`). A scoop update to
1.0.42 removed the shim on 2026-09-16 and the owner reverted it; a red `translate-eh` saying "Failed
to spawn 'wast2json'" is the environment, not the code.

**S6 step 5 is DONE (2026-09-18):** items 1–5, the expression half, and item 6, the MODULE half (M1–M8e). The bridge is deleted; `prepareForPasses` (names M8c + types M8d) makes a wabt-ts tree ready for binaryen-ts in place, and the `direct` / `direct-behaviour` gates hold it. Scope and every stage's record:
[ir-convergence.md](ir-convergence.md) § "Item 6 — the MODULE half".

**Module ratchet** (`tests/ir/module_convergence.test.ts`; only-wabt-ts / only-binaryen-ts /
typed-differently): M1 **46 / 29 / 15** → **0 / 0 / 0** now — every pair one type, pinned whole-record. The `differ` count ROSE on purpose: a
field that converges in NAME but not yet in TYPE moves from a one-sided list into `differ`, and the
entity collections stay there until the records themselves are one type (M8).

### Done on 2026-09-17 (item 6)

| stage   | merge       | what                                                                                                        |
| ------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| M2h     | `7bcfb4171` | a global's `init` is optional in both — **M2 closed**                                                       |
| const-seq | `0cb37d858` | binaryen-ts reads a constant expression of ANY length: **53 binaries refused → byte-identical**; exposed a silent element-type loss, now refused |
| M3      | `01bc13a72` | segments are wabt-ts's records — element TYPES and entries kept: **348 improved, 175 of them had been re-encoding DIFFERENTLY** |
| M4      | `acd8ceba0` | an import EMBEDS its entity (the union): imported table64 / page size / huge sizes read, **22 more byte-identical**; imports pinned for the first time |
| M5a     | `83156ccff` | type entries keep `sub` and rec groups — **83 binaries were ALL wrong, 68 now byte-identical**              |
| M5b     | `40d1caa60` | the module's table is `types`; a field carries its name — **M5 closed**                                      |
| M6a+M6c | `b3b657ed0` | a function holds its `sig`; locals are ONE named list of slots — and flattening exposed an **OOM** on `binary.41`–`binary.44` (2^32 declared locals), now refused |
| M6b     | `f1c7424ec` | a function's body is a `RegionExpr` — **M6 closed**                                                          |
| M7a+M7b | `5ee759ea8` | the module's collections take binaryen-ts's names; the five `num*Imports` counts are DERIVED                 |
| M7c1    | `803a4a1bf` | the DataCount flag is `hasDataCountSection: boolean` in both (2026-09-18)                                     |
| M7c2    | `3d8c14b83` | the feature flags are gone from both — `hasGC` had silently drifted to "has a type section"; `featuresUsed` was never read (2026-09-18) |
| decision 4 | `ab80982a8` | 🗓️ owner: the one module follows binaryen-ts's naming practice (2026-09-18)                               |
| M7c3a   | `d654da455` | an import's param names and the module's name live on their records, not in `explicitNames` (2026-09-18)   |
| M7c3b b0 | `66ccfe236` | 🗓️ owner: names cover types and fields — binaryen-ts's types and fields always named; `explicitNames` lists the real ones by name (2026-09-18) |
| M7c3b b1a | `5e4a1cbdd` | the name section is its own fact: `hasNameSection` in both; `explicitNames` only says which names are real (2026-09-18) |
| M7c3b b1b | `c5ad07eac` | wabt-ts's reader names every entity, every writer writes only real names; `localNamesListed` → `explicitNames.localsListed` — **M7c CLOSED** (2026-09-18) |
| M7c3c   | `328a6763e` | wabt-ts's reader makes up LABELS too; fixed `--generate-names` dropping an unnamed type's real field names (a b1b bug) (2026-09-18) |
| M8 scope | `68b8194a6` | the bridge's work MEASURED: beyond names / types / labels, three value conventions (2026-09-18) |
| M8a1    | `610dd8e2d` | `align` is BYTES in binaryen-ts too (it held the exponent in a field declared bytes); fixed the compat API's alignment (2026-09-18) |
| decoder OOM | `af7082f4d` | binaryen-ts's decoder refuses 2^32 declared locals instead of running out of memory (M6c's defect, other decoder) (2026-09-18) |
| M8a2    | `cd4937027` | a call's `isReturn` is `true` or absent — `false` unrepresentable (2026-09-18) |
| engine oracle | `57b16a115` | the corpus round trip holds a binary V8 cannot judge stably to byte identity (2026-09-18) |
| M8a3    | (this merge) | a named-type `call_indirect` carries its signature — **M8a closed** (2026-09-18) |
| M8b1 + M8b2 | (this merge) | `start?: Var` in both; packed field types are the binary's codes in both (2026-09-18) |
| M8b3    | (this merge) | a module record's `loc` is optional (`locOf`): every leaf record IS its binaryen-ts partner (2026-09-18) |
| M8b4    | (this merge) | the function record is one type; `typeVar` kept and written back (51 spec binaries now byte-identical); whole-record identity pins (2026-09-18) |
| M8b5    | (this merge) | the module carries the as-written metadata (a pass run clears it); **module ratchet 0 / 0 / 0** (2026-09-18) |
| M8b6    | (this merge) | `WasmModule = Module` — binaryen-ts's module declarations are aliases, their docs kept field by field — **M8b closed** (2026-09-18) |
| M8c     | `62503981a` | `nameReferences`: every reference the bridge named is named on the module, and all 49,335 corpus references agree with the bridge; 2 more bridge defects found (`delegate` one frame too deep, a named `if` losing its label) (2026-09-18) |
| phantom value | `e819a92c3` | a linear `br_if` / `br_on_null` carries no phantom value: an S5 regression (`f27bfd5ca`) no byte gate could see, found by M8d (2026-09-18) |
| call_indirect arity | `9b786de22` | a linear `call_indirect` / `call_ref` takes its signature's arguments: T10.5's other half, found by M8d (2026-09-18) |
| M8d     | `0846a44da` | `deriveTypes`: every node typed by the factories' rules and the decoder's context. Agrees with the bridge except the bridge's `i32` `pop`s, and with the decoder over 2,490 valid spec binaries except the decoder's defects (2026-09-18) |
| M8e     | (this merge) | the bridge goes: `prepareForPasses`; the direct path's bytes ARE `wat2wasm`'s (421/421), its -O3 output behaves the same (1,806 calls); `direct` / `direct-behaviour` gates — **item 6 and S6 step 5 CLOSED** (2026-09-18) |

### Done 2026-09-18 → 2026-09-19 — every item the owner ordered

| item                        | code        | what                                                                                                   |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| post-M8 fix 1               | `ddd5f6163` | `table.get` typed by its table                                                                         |
| post-M8 fix 2               | `4b2488540` | a multi-value `call_indirect` typed by every result                                                   |
| post-M8 fix 3               | `565e7b2c2` | size / grow typed by the memory's / table's address type                                              |
| post-M8 fix 4               | `a82dadf90` | the binary reader: a one-value `br_if` is an operand                                                   |
| post-M8 fix 5               | `89b6a1805` | the WAT parser knows a branch target's arity; the text→optimizer route refuses 109 invalid modules it typed silently |
| post-M8 fix 6               | `653fd3839` | a folded `br_table` no longer DROPS a `(nop)` operand (a byte short of upstream)                       |
| post-M8 fix 7               | `517bf7c89` | `direct` / `direct-behaviour` also run `prepare.test.ts`'s fixture: they now see a start section          |
| post-M8 fix 8               | `dbe986344` | binaryen-ts reads and writes every memory index as a LEB (12 sites, not the 2 listed)                  |
| post-M8 fix 9               | `cf1b50bd8` | a `br_table` holds its carried values, in both front ends (W9 (a))                                    |
| post-M8 fix 10              | `a7915f1e1` | a branch to the function label carries the function's results (W9 (b))                                |
| owner decision (W10)        | `2fdc64ba8` | prefer the MORE ACCURATELY FOLDED form: W10a (keep ours) DESIGN, W10b match upstream                   |
| W10b                        | `cd37142a6` | a transfer is the next instruction's operand, as upstream folds it; fixed with it: `deriveTypes` typed a branch's condition before its values and accepted the invalid `br.6` |
| W11                         | `f2baf2ada` | folded `wasm2wat` folds EVERY instruction kind: 3,174 linear lines in folded output → 0, as upstream   |
| the scheduled cleanup       | `95be871f7` | RemoveUnusedModuleElements's no-op `importedFuncs` set deleted; 0 optimizer outputs moved              |
| S7 (owner: fidelity first)  | `899263b7b` | `wat2wasm` → `wasm2wat` keeps each function's written form: the `binaryang.text-form` section; the optimizer strips it |
| reader: import index space  | `ab1a211ee` | the binary reader looked up an imported function's / tag's signature among ALL imports: after a global import a call read back without operands (found by S7's measurement) |
| S7 mixed form (owner: one-to-one) | `b366262ce` | per INSTRUCTION: linear stays linear, folded folded, a mix the same mix — 2,295,102 instructions' forms reproduced over 1,043 sources; predicted from the wabt-ts reader's tree, skipped (never misapplied) where a tree disagrees |
| ONE FRONT END decided, scoped, measured | `7dc93969a` `d2d4a5afa` `ccffc54e3` | 🛑 owner: the readers and writers are shared too — `wat/wasm → reader → ir → features → ir → encoder`; the inventory of both binary readers and writers; the five-stage plan and three refinements confirmed (docs only) |
| stage 0 — saturating truncation      | `2ca4513f1` | binaryen-ts's decoder read 0xFC 0x00–0x07 as the TRAPPING truncations: `wasm-opt` turned a saturated result into a TRAP, on every route in, shipped in 1.5.4 (4 of 4 corpus modules; now 0) |
| stage 1 — one kind per SIMD load     | `f60e4e575` | `SIMD_LOAD_OPCODES` is the one rule; the WAT parser built `load` for all twelve non-plain SIMD loads and the reader for the six extending ones (90 functions → 0) |
| stage 1 — `defaultInit`, unreachable `br_if` | `1ffdcb561` | one spelling (`true` or absent, the `isReturn` precedent); a `br_if` with an unreachable operand is unreachable — missing from `deriveTypes` AND from binaryen-ts's own `makeBreak`; import stubs typed `none` (3,393 type differences → 6) |
| the dead-tail pass defect            | `0498fbbae` | DCE and Vacuum read an `unreachable` TYPE as "control stops here": `wasm-opt` emitted INVALID modules. `neverFallsThrough` asks what terminates (invalid outputs at -O2 / -Oz: 7 → 3 and 6 → 2) |
| stage 2 (first piece) — one entry per VALUE | `58fd43576` (re-baseline `36ecaddb3`) | the reader AND the parser held one stack entry per NODE, so a multi-result producer's consumer took its neighbours; identical bodies 48,666 → 48,752 of 49,254 |
| wasmtk leniency reports              | `d59816990` | limits range-checked as a u64 at parse; a legacy `try`'s clauses checked in both text forms — two shapes had assembled into modules engines ACCEPT |

Records: [divergences.md](divergences.md) — the W rows and the closed-defect table carry the post-M8
fixes, W10b and W11 — and [ir-convergence.md](ir-convergence.md) § "S7", § "One front end"; each
merge message carries its measurements. Lessons:
[best-practices.md](best-practices.md) § "Lessons from the post-M8 run", § "Lessons from S7's mixed
form", § "An assertion that spans stages is satisfied by the WRONG stage".
**`prepareForPasses` stays internal (owner, 2026-09-18)**, as the bridge was.

### Next, in order

**ONE FRONT END, stage 2 is DONE (2026-09-28)** — the owner's plan, confirmed 2026-09-19, in
[ir-convergence.md](ir-convergence.md) § "One front end". Stages 0, 1 and 2 are done; **stage 3a is
done (2026-09-28): `wasm-opt`, `readWat` and the compat `readBinary` read with the one reader**
(`readForPasses`); corpus optimizer output unchanged byte for byte. **3b — deleting binaryen-ts's
decoder — happens IN the bump (owner, 2026-09-28: "wait for the bump")**: the published `parseWasm` IS that decoder, decided to be
unpublished at the next bump and not before (below). **Stage 4a is done too (2026-09-28): `wasm-opt`,
`emitBinary` and `toBinary` write with the one writer** (`writeWasm`: wabt-ts's, after a resolve step
on a copy) — 14,595 of 14,595 outputs byte-identical to the encoder's, after two encoder defects
(one SILENT: relaxed ternary SIMD written as `v128.bitselect`) and four in the wabt-ts path were
fixed. 4b, deleting the encoder, goes with 3b into the bump. **Next: stage 5** (retire binaryen-ts's
internal `parseWat`). The two defects stage 4 found, Q9 and W12, are FIXED (pre-bump item 4).
Stage 2 moved what
binaryen-ts's decoder does FOR THE PASSES into `prepareForPasses`; its first piece (one stack entry
per value) landed in `58fd43576`. Its items, as they closed:
1. ✅ **DONE 2026-09-20 (`0e2a2bd2b`, merge below): typed `pop`s at catch entry and for block params
   (R13, R14).** The 6 type differences are settled — **0 differing nodes of 1,291,777** — and
   functions agreeing went 48,770 → 48,780 of 49,271 with no new difference category and not a byte
   moved. Record and the ordering trap it hid: [ir-convergence.md](ir-convergence.md) § "One front
   end", stage 2. 🆕 **It surfaced the next item**: R12 typed nothing, so its multi-value
   placeholders are still dropped — ~348 functions, now the largest residual category, and the same
   mechanism closes them.
1a. ✅ **DONE 2026-09-20 (`190ba909e`): a placeholder carries its value's TYPE, and its position
   (R12 completed).** Functions agreeing 48,780 → **49,125 of 49,271** — **345 fixed, 0 newly
   differing**, measured as a set diff in both directions, which is what showed the two shifted
   categories to be re-classifications. One position rule now covers entry values and mid-region
   residue, and item 1's special case is gone. Gate green on the committed tree.
2. ✅ **DONE 2026-09-20 (`spill-stack-values.ts`): make a stack-held value EXPLICIT before the passes
   run (R11').** ⚠️ Read this before trusting any size argument about it: I first reported the item as
   "priced at ~zero" and the owner reasonably said skip it; that was wrong, and the correction is the
   point. The spill is not about bytes — it is what keeps a value REACHABLE. A pass only has to put a
   block boundary between a value and the `pop` that takes it, which is what `Inlining` did at -O3 to
   `br.0` and `nop.0` ("not enough arguments on the stack"), and `Flatten` refused such a tree
   outright. After it: identical optimizer output 2,863 → **2,875** of 3,075, "differ (both valid)"
   15 → 7, and **"A valid, B INVALID" 2 → 0** — route B is no longer worse than A anywhere.
   It runs only when a pass will run, so decode → encode stays byte-exact.
   **The old measurement, still true and still not the reason:** at -Oz route B is 473 bytes SMALLER
   than route A over 2,880 modules. At -Oz over 2,880 modules
   route B is **473 bytes SMALLER** than route A (−0.03%): bigger on 2 (3 bytes each), equal on 2,866,
   smaller on 12. Behaviour agrees, including on the `$__stack_pointer` shape the decoder's spill was
   written for. What the spill buys is optimizability of that shape (a fixture goes 76 → 57 bytes on A
   and stays 70 on B, because the passes cannot work across a value they see only as a `pop`) — real,
   but 97 functions of 49,271 and net zero bytes here. Copying it adds locals the merged tree does not
   need and moves bytes (a re-baseline), and it is the largest of stage 2's items. **Not copying it
   means stacky producers (wasic, TinyGo) keep code the passes leave alone — not wrong, just
   unoptimized, and invisible.** Full record: [ir-convergence.md](ir-convergence.md) § "One front end".
2a. ✅ **Found while pricing item 2 and FIXED: a raw-kept name section survived optimization on route
   B** — 211 of 286 modules carried one after -Oz, 13,720 bytes, stale (the passes had renumbered what
   it names). Dropped now when a pass has run, `-g` included; the `data: null` placement marker stays.
   Route-B only, so it would have shipped with stage 3.
3. ✅ **DONE 2026-09-28: block-param lowering as a TREE pass (R15)** — `lower-block-params.ts`
   replaced `PassRunner`'s encode + decode round trip. **Stage 2 is complete.**
   - **Lowered ALONE** (no pass after it) over the 8 spec modules with block parameters: valid on
     **8 / 8, both routes** (`main`: 6 / 8 — `fac.0` and `if.0` invalid), and no parameter left
     (asserted: a no-op lowering produced VALID modules, which is how the wip read as working).
   - **Optimizer output, `main` vs this**, 2,919 inputs (421 corpus + every spec module V8
     accepts) × 2 routes × -O1…-Oz = 29,190 outputs: **29,150 identical**; the 40 that moved are all
     in 4 of those 8 modules; **INVALID 27 → 9, none new**; throws 1,920 → 1,920. The 9 left are
     pre-existing: `call.0` / `fac.0` at -O3 (Q2) and `names.2` on route A.
   - **Behaviour** (`scratchpad/r15behave.ts`: every manifest invocation replayed against the
     original, lowered-alone and -O1…-Oz on both routes, 326 invocations × 96 variants): all agree
     except Q1 (`if.0`'s `effects`, a pre-existing `CoalesceLocals` miscompile the old invalid output
     had hidden) and Q2.
   🔑 **Why the wip failed six of eight, and the design that replaced it**: it rewrote each entry
   `pop` into a read of its local, and a `pop` is only "already on the stack" — an entry value may be
   consumed deep in an operand, pass straight through (`if.0`'s arm is `[(pop), (pop)]`: nothing to
   rewrite), or be carried back by a `br_if` whose values a multi-result call produces INSIDE its
   condition (`fac.0`). And its wrapper `block` around `local.set`s of `pop`s cannot reach the
   enclosing stack at all. The tree pass is POSITIONAL instead: entry values into locals before the
   construct, each region READS them back at its start, `pop`s untouched; a statement holding such a
   construct or back-edge in an operand is split into statements (bytes unchanged — a `pop` writes
   nothing); the spill, now run AFTER the lowering, nests what it can again. A mixed `br_table` goes
   through a trampoline (`multivalue.test.ts` required it — the wip's refusal of it was a regression).
   Found and fixed on the way: the spill DELETED the first link of a chain of nested producers
   (latent; closed-defect table in [divergences.md](divergences.md)). Found and NOT fixed: Q1, Q2, Q3
   below. The `wip/r15-tree-pass` branch is superseded (not merged; its commit message still holds
   the two traps it paid for).
4. ✅ **DONE 2026-09-28: Q1–Q3, and everything a WHOLE-TESTSUITE behaviour check found (Q4–Q8).**
   Q1 was found by R15's behaviour check, which covered only the 8 block-parameter modules; to close
   the section the same check was run over EVERY spec module with invocations — each `action` /
   `assert_return` / `assert_trap` replayed against the original, a plain decode → encode, and
   -O1…-Oz on both routes (`scratchpad/behave-all.ts`: 2,228 modules, 16,020 variants). It found
   five more defects that change what a module does or leave it refused; all eight are fixed, each
   pinned by a test and each test inverted (13 mutants, all caught — two only jointly, see below):
   - Q1 CoalesceLocals / the CFG: a branch to an `if` label read as a return (silent, -O2+).
   - Q2 Inlining: a stack operand moved into the wrapper block (invalid, -O3).
   - Q3 the decoder: a multi-value `br_if` held as one stack entry (a round trip TRAPPED).
   - Q4 a phantom operand evaluated before the `br` that made it dead (trapped; both routes).
   - Q5 a `call_indirect`'s type index dropped across rec groups (a trap vanished).
   - Q6 a leading U+FEFF stripped from names (the engine refused the round trip).
   - Q7 `elem.drop` missing from the tree walker (22 modules could not be optimized).
   - Q8 RemoveUnusedModuleElements ignored constant-expression uses (the encoder refused).
   **After, `main` vs this** (29,190 optimizer outputs): INVALID **9 → 0**; refused 1,920 → 1,790;
   **0 corpus outputs changed**; behaviour now differs from the original NOWHERE except the
   multiple-tables refusal (164 modules — since fixed, item 5). Rows:
   [divergences.md](divergences.md) Q1–Q3 and the closed table (Q4–Q8).
   🔑 Two guards in the phantom fix exist because a first version broke `fac.0` on route A: a region's
   statements are not operands, and a bare `pop` statement is not a phantom. Either alone is
   harmless; together they took a loop body apart — the `fac-ssa` route-A fixture catches the pair.
5. ✅ **DONE 2026-09-28: several tables (writer-inventory W5 in ir-convergence.md — not
   divergences.md's W5, which is implicit type order).** binaryen-ts's encoder refused every module
   with more than one table (`checkSingleTable`), though both reasons it gave had long been fixed:
   segments take flag 2 / 6 with their table, the decoder keeps `call_indirect`'s index, and every
   table instruction resolves its own. The guard is gone. Measured, `main` vs this: refused **1,790
   → 40**, 175 spec modules now optimize, INVALID 0 → 0, **0 corpus outputs changed**, and the spec
   behaviour differential shows **0 divergences on all 2,228 modules**. `multi_table.test.ts`
   (every table-indexed form against a table that is not table 0, an imported table first; both
   inversions — segments or `call_indirect` forced to table 0 — fail every variant). The 40 left are
   all relaxed SIMD on route A (8 modules × 5 levels): binaryen-ts's DECODER refuses those opcodes
   and the reader does not — it closes with stage 3.
6. ✅ **DONE 2026-09-28: `deno task spec-behaviour <outDir>`** — the behaviour differential that
   found Q1–Q8, as a task in the repo: every spec module's invocations on the original vs a round
   trip and -O1…-Oz, both routes; exit 1 on a divergence or a hang; refusals only for the 7 pinned
   relaxed-SIMD modules (a by-name ratchet). Today: 1,342 modules, 57,808 invocations, 0
   divergences, ~6 s. Inverted twice (Q1 restored; the tables guard restored), each exit 1.
   Record: [testing.md](testing.md) § "Not yet covered" (now covered).
   ✅ **In the gate (owner, 2026-09-28: "Yes")** — [working-rules.md](working-rules.md). Since
   pre-bump item 6 it also RUNS the SIMD invocations it used to skip unseen (24,151).
- ✅ **`Flatten` — DECIDED 2026-09-28 (pre-bump item 5, `6107691db`): KEPT, and it is now never
  silently invalid.** Re-measured first over 2,919 modules, reader → one writer:

  | outcome | before | after |
  | ------- | ------ | ----- |
  | valid | 2,609 | **2,740** |
  | INVALID (silent) | 131 | **0** |
  | threw | 179 (47 an internal crash) | 179, **each naming what is unsupported** |

  The 131 were one defect: a result-typed function whose body never falls through (ends in
  `return`) was flattened as a VOID statement, so the body ended on a void block — binaryen types
  that block `unreachable` and its writer emits an `unreachable` after it; the tree now says so. The
  47 crashes were a TUPLE temp (a multi-value block or body) meeting the writer's resolver; now
  refused in `allocTemp`. Behaviour on the spec suite's own invocations (a one-variant copy of the
  harness): 57,808 invocations over 1,283 compared modules, **0 DIVERGE**. What it still refuses is
  open work, not a defect: value-carrying `br` / `br_if` / `br_table`, multi-value results, `try` /
  `try_table` / `pop`, `br_on`. The record as scoped on 2026-09-20 follows.
- ✅ **`Flatten` takes value-carrying `br` / `br_if` / `br_table` (2026-09-28, `4421bf62a`, merged
  `51be28b2e`)** — upstream's shape: the value into the target's result temp, the branch without it;
  to the function frame, a `return`. Over 2,919 modules: **2,754 valid** (was 2,740), **0 invalid**;
  spec behaviour of Flatten alone **0 DIVERGE** over 1,299 variants; 12 mutants, all caught. Three
  latent defects surfaced once those modules got further, each fixed and pinned: a block's value
  under trailing void statements (`local.set $tmp (nop)`, INVALID — `spec/nop/nop.0`); a value left
  on the stack for a later instruction silently DISCARDED; an arm of one `unreachable` losing its
  trap (`spec/unreachable` "as-if-then" returned 0). And one found by probing, in no corpus module: a
  value-less `br` to a result block (stack form) read as a trap that discards the value — VALID
  output returning 0. What it still refuses, by name:

  | count | refusal | upstream `--flatten` |
  | ----- | ------- | -------------------- |
  | 129 | multi-value (a block, body or call with N results) | handles it (tuple locals) |
  | 11 | `br_on_*` | **refuses too** ("Unsupported instruction for Flatten: BrOn") |
  | 10 | a value left on the stack for a later instruction (stack-form code the reader keeps) | has no such IR |
  | 9 | `try_table` | **refuses too** (crash, "unexpected expr type") |
  | 4 | `pop` (legacy `try` / `catch`) | handles it |
  | 2 | a value `br_table` to the function frame | handles it |

- ✅ **`Flatten` COMPLETE — owner, 2026-09-28: "perform the flatten"** (`de5374681`, merged
  `7689ea5b7`). Everything upstream's Flatten flattens, this one does; it refuses exactly what
  upstream refuses. Over 2,919 modules: **2,896 valid** (was 2,754), **0 invalid**, 23 refused —
  13 `br_on_*`, 10 `try_table`, both upstream's refusals too. The table above is closed:
  - **multi-value** (129): an N-value result lives in N temps (`values` beside `value` in `Flat`) —
    the design the owner's "perform" settled; no tuple kind was added (V1, S6 6A stand).
  - **stack form** (10) and every `pop`: each frame MODELS its operand stack — the values its
    statements left, each in a fresh temp or a constant. A `pop` takes from it, a value-less branch
    to a value-taking target takes from it, a frame's result is its top; after what never falls
    through it is polymorphic. One rule places every `pop`: operands first (a producer fills its
    slot with its LAST value, leaves the rest), then the pops take the top (`spec/fac` "fac-ssa").
  - **legacy `try`** (4): handlers entered with the tag's payload captured first.
  - **value `br_table` to the frame** (2): to a block around the body, whose end returns the temps.
  - Found on the way, each pinned: `(call_ref $t (unreachable))` never falls through though typed
    void; a value computed after a transfer is dead, not a statement; a trapping `br_table` index
    makes a missing value dead.
  **Flatten is in the gate now**: spec-behaviour's `--flatten` variant (12,061 variants, 0 DIVERGE);
  its 17 refusals pinned in `REFUSED_BUDGET`, which is keyed by (module, variant) since, so a pin
  cannot hide another variant refusing the same module. 28 tests, 14 mutants caught.
- **(history) `Flatten` is substantially unfinished, and one of its failures is SILENT** — scoped 2026-09-20
  after finding it while building item 2. Measured with `--flatten` alone over **2,925 modules** (the
  corpus + the spec testsuite), on both routes (`scratchpad/one/flatscope.ts`):

  | outcome                 | route A (decoder) | route B (reader) |
  | ----------------------- | ----------------- | ---------------- |
  | valid output            | 2,432             | 2,441            |
  | **INVALID output**      | **133**           | **132**          |
  | threw                   | 352               | 352              |

  The classes, largest first — only the second is Flatten emitting something WRONG; the rest refuse:
  - 150 `multiple tables are not supported` — the ENCODER's gap, not Flatten's (✅ lifted 2026-09-28, item 5); it is what the
    harness hit when writing the result out.
  - **132 `expected N elements on the stack for fallthru` — the silent one.** This is the class the
    `return` fixture is in: Flatten rebuilds a body whose fall-through arity it then contradicts.
  - 45 `cannot encode value type: (i32 i32)` — a tuple hoisted into a local, which no value type can
    spell (the sibling of `flatten_multivalue`'s existing refusal test).
  - 45 `Flatten: call to "$x" returns N values; multi…` — an explicit refusal of multi-value calls.
  - 24 `flatten: value-carrying br/br_if is not yet supported by this port`.
  - 24 `mapExpression: unhandled expression kind "elem.drop"` — ⚠️ NOT Flatten's: a gap in the shared
    walker. ✅ FIXED 2026-09-28 (Q7); these 24 now reach Flatten, so re-measure before quoting the
    table.
  - 14 `flatten: pop is not yet supported by this port` — on BOTH routes, since the `pop`s item 2
    deliberately keeps (entry values, multi-result producers) are still there.

  **Exposure**: `Flatten` is in no `-O` list, so no default pipeline touches it — but
  `wasm-opt --flatten` reaches it from the CLI (any `--name` becomes a pass), and so does `add('Flatten')`
  through the API. A user following upstream's documentation gets an invalid module for ~4.5% of inputs
  and an exception for ~12%. Upstream runs Flatten mainly as a prerequisite of other passes; nothing in
  this port depends on it, which is why nothing caught any of this.
  ✅ DECIDED 2026-09-28 (above: kept, never silently invalid). The decision to take was: finish it, or refuse it loudly at the entry point until it is finished. A
  pass that emits an invalid module silently is the worse of the two.
   (The `Inlining` failures on the reader route at -O3 this line used to list — `dynrt_lib_modc`,
   `Chapter11/vector`, `nop.0`, `br.0` — were fixed by the spill, R11', and Q2.)
Then stage 3 (switch the entry points ✅ 3a, 2026-09-28; delete binaryen-ts's decoder — 3b, at the
bump), stage 4 (one writer ✅ 4a, 2026-09-28; delete the encoder — 4b, at the bump), stage 5 (retire binaryen-ts's internal `parseWat`).

✅ **Decided (owner, 2026-09-19): option (a) — `./binary` and `./encoder` are UNPUBLISHED at the next
version bump, and not before every open fix and quality check below is finished.** In the owner's
words: "I agree with the unpublish at the next bump when we get to it. But that is after all our fixes
and quality check are finished from our open items." So the order is fixed: the open items first, the
bump second, the two subpaths dropped from `deno.json`'s `exports` in that bump — never as a drive-by
edit while a fix is in flight, because dropping an export is the BREAKING half of a release and
`deno.json` staying at 1.5.4 is what keeps a release unarmed ([working-rules.md](working-rules.md)).
Stage 3 therefore needs no wrapper: the two subpaths go away rather than being re-pointed at the
shared reader and encoder. Until the bump they keep working, so nothing in the tree may stop exporting
`parseWasm` / `encodeWasm` before then. The facts that decided it, gathered 2026-09-19 after the owner
asked why they are published at all:
- They ARE public functions today, and the ONLY public way to decode or encode a binary into the IR:
  the root export (`src/index.ts`) exports NOTHING, so `parseWasm` / `encodeWasm` are reachable only
  through those two subpaths. `README.md` documents both — an example (`import { parseWasm } from
  '@jrmarcum/binaryang/binary'`) and the entry-point table.
- Right, they are not CLI options; the CLI covers this ground through `wasm-opt`, `wat2wasm` and
  `wasm2wat`.
- **No known consumer imports them**: wasmtk, our only one, uses `/compat/binaryen` and
  `/compat/wabt` only. Unknown JSR consumers cannot be ruled out, so dropping them is a BREAKING
  change and belongs to a version decision (owner action 5).
- They do not disappear internally either way: `wasm-opt`, `read-wat`, the compat API and
  `lowerBlockParams` all call them.
The options as put to the owner, with (a) chosen: (a) unpublish both at the next bump and let the
compat APIs plus the tool entry points be the public surface — it also removes the wrapper question
from stage 3; (b) keep them as thin wrappers over the shared reader and encoder (`readBinaryIr` +
`prepareForPasses`, and the shared writer), preserving today's contract that `parseWasm` returns an
OPTIMIZER-READY tree; (c) publish the SHARED reader and writer under honest names and leave these two
as deprecated aliases. Consequences of (a) to carry out IN the bump, not before: drop both from
`deno.json`'s `exports`; delete the `parseWasm` example and the two entry-point rows from `README.md`;
keep both modules in the tree, since `wasm-opt`, `read-wat`, the compat API and `lowerBlockParams` all
call them; say in `CHANGELOG.md` that the public way to reach the IR is now the compat APIs and the
tool entry points. ➕ **Added 2026-09-28 (owner: stage 3b waits for the bump):** in that same bump,
delete binaryen-ts's decoder (`binary/wasm-parser.ts`, `names.ts`, `reader.ts` once nothing else
uses them — `WasmBinaryError` moves with `readForPasses`), move the ~70 test files and the
`scripts/binaryen-ts/` diagnostics off `parseWasm`, drop route A from `spec-behaviour` and empty its
`REFUSED_BUDGET`. ⚠️ "keep both modules in the tree" above was written before stage 3a; after it
nothing in `src/` but the published entry point calls the decoder. ➕ And (stage 4b) the ENCODER:
delete `encoder/wasm-encoder.ts` once nothing but the published `encodeWasm` calls it (after stage
4a nothing in `src/` does); `WasmEncodeError` moves with `writeWasm`; move the ~94 test files and
the scripts that call `encodeWasm` onto `writeWasm`; `spec-behaviour`'s route A goes entirely.
⚠️ Whatever is chosen, `parseWasm`'s published contract is "a tree the passes can run on", which is
reader + `prepareForPasses` — not the faithful tree alone.

**Found by the One front end measurements, still open:**
- ✅ ~~the fold writer and S7's prediction disagree on 6 of 26,454 functions~~ — FIXED 2026-09-28
  (`a6193b625`): re-measured 6 of 26,896 (1,119 files, five corpora), all one shape — a multi-value
  producer leaves `pop`s scattered in its consumer, the writer SPREADS that consumer inside the
  enclosing fold, and the prediction counted it as one item. `items` in `text-form.ts`; now **0**,
  pinned by `fold_prediction.test.ts` over the in-repo corpus. 3 baseline files moved in section
  bytes only.
- ✅ ~~binaryen-ts's encoder refuses every module with more than one table~~ ✅ lifted 2026-09-28
  (item 5); its **decoder refuses relaxed SIMD** (8 valid modules,
  which the reader reads). Both close when stages 3–4 keep one of each. ✅ CLOSED at 1.6.0: that
  decoder and encoder are deleted (3b, 4b).
- ✅ `names.2`: binaryen-ts's decode → encode gave a DUPLICATE empty export name — FIXED 2026-09-28
  (Q6): the decoder stripped a leading U+FEFF, so the "﻿" export became a second "".
- ✅ MOOT since 1.6.0 — route A (binaryen-ts's decoder) is deleted; the reader's checks are the only
  ones. Was: route A accepts **1,349 INVALID binaries** the reader refuses (section order, counts, UTF-8,
  mutability bytes, DataCount). Keeping the reader's checks is the point of one front end; worth a
  count in the gate once the switch happens.

🛑 **Not an open question — owner, 2026-09-19: "ignore the slower part for now. we already addressed
that issue with the ir, reader and writer that we are in the process of merging."** `wat2wasm` is
~30% slower with the text-form record on (+26–35%) because it reads its own output back to learn
what the wabt-ts reader will predict; `--no-text-form` is within noise. The read-back exists ONLY
because two front ends can build different trees for the same bytes, which is exactly what One front
end removes.
⏭️ **Action it becomes**, when stage 2 finishes converging the parser and the reader: predict from the
module in hand, delete the read-back, and re-measure `wat2wasm` against main. The guard that makes
this safe to try is already in the format — an entry whose prediction hash does not match is skipped,
so a residual disagreement degrades to "printed as predicted", never to wrong output
([ir-convergence.md](ir-convergence.md) § "S7").

📥 **From the wasmtk team, 2026-09-19** (their write-up: `wasmtk/scripts/binaryang-report.md`) — two
parser-leniency reports, both reproduced on `main` and FIXED (`d59816990`): limits took no range
check, and a legacy `try`'s clause structure was unchecked. Their runner had one catch around
"assemble the module", so an ENCODER error satisfied an `assert_malformed`; splitting the stages
flipped two assertions to skip. Left open by that report:
- ✅ ~~**the validator accepts a `catch` after `catch_all`**~~ — FIXED 2026-09-28 (pre-bump item 3,
  `cdbe4aaeb`): refused by the type checker, a second `catch_all` too; divergences.md W13 (upstream
  wabt accepts it, V8 and wasm-tools refuse it).
- ✅ ~~**a limit that overflows its OWN index type fails in the writer, not the validator**~~ —
  FIXED 2026-09-28 (`d732dee98`): when the writer refuses, `wat2wasm` asks the validator first, so
  `(memory 0x1_0000_0000)` reports "initial pages (4294967296) must be <= (65536)" (upstream's
  wording), then the writer's line. `wat2wasm` still validates nothing it CAN write. Still
  well-formed, not malformed (`malformed_text.test.ts`). `no_repair.test.ts`.

**Open, recorded not done** (each in its stage's record in ir-convergence.md):
- ✅ ~~the wabt-ts binary reader attaches a multi-value operand's NEIGHBOUR~~ — FIXED 2026-09-19
  (`58fd43576`, One front end stage 2), in the reader AND the WAT parser: both hold one stack entry
  per VALUE now, so a multi-result producer fills its own slots. It had popped operand NODES, which
  gave `(call $add2 (local.get 0) (call $take2 (call $pair)))` the `local.get` on `$take2`; bytes
  were right, the tree was not. ir-convergence.md § "One front end", stage 2, has what it took and
  the one gap left (the fold writer and the prediction disagree on 6 of 26,454 functions).
- binaryen-ts's decoder reads a `ref.null` / typed element segment but **refuses an element type other
  than `funcref`** until the element model carries it — M3 left this deliberately
- the text format has no spelling for where the `name` section sat (M2f); `wasm2wat` → `wat2wasm` puts it last
- the WAT writer does not print an empty `(offset)` / `(item)` (M2a)
- ✅ ~~the raw `metadata.code.*` section's stale offsets after optimization (item 5 (6a)); **W8**~~
  — FIXED 2026-09-28 (`815a59244`): an optimization run drops them; W8 closed with it
- Asyncify refuses `call_ref` (K1)

**Working method that keeps paying** (the rules in [working-rules.md](working-rules.md) /
[best-practices.md](best-practices.md) — today's evidence):
- **measure on the corpus BEFORE choosing a direction.** Every silent defect this week was found that
  way, not by reading: the table64 narrowing, the element-type loss, the rec-group flattening, the
  name-section move, the locals OOM.
- **after a type change, read every use the compiler CANNOT see** — string interpolation, `as` casts,
  `Record<string, …>` lookups, a byte read and never compared.
- **a blunt regex is a defect generator.** `...body` and `...funcs` (rest/spread) both contain
  `.body` / `.funcs`; a node's `body` is not a function's; a `params:` rewrite hits parameter LISTS.
  Scope every bulk edit to the lines the compiler named, and read the diff.
- **an equivalent mutant is a finding, not a failure** — twice it pointed at dead code.

⚠️ **Carry the L2 discipline into every remaining stage**: when a field loses `null` or `undefined`
from its type, the compiler stops helping (`stringValued === null` is not an error), so list the
null tests first, convert by reading, and mutate each one back — see
[best-practices.md](best-practices.md) § "TypeScript does NOT flag".

---

**History kept here as a pointer only.** The 2026-09-14 memory-work session (merges `cff3284b8` …
`1cbe88be8`), the owner decisions that followed it (release flow, K3, TranslateEH, `call_indirect`'s
`sig`, dead-function removal as upstream, the module half UNIFIED — decision B) and the S6 step 5
narrative that led to M8 are recorded in their topic files: [publishing.md](publishing.md),
[ir-convergence.md](ir-convergence.md), [binaryen-ts.md](binaryen-ts.md),
[unreleased.md](unreleased.md). The block as it stood, with its since-finished "Next" and
"Suggested order": `git show c302bfadd:cmem/open-work.md`.

## Owner actions — nothing here is blocked on code

| # | item                            | note                                                                                                                                                                                                                                                                                                                                             |
| - | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | **Create `RELEASE_PAT`** ✅ AGREED (owner, 2026-09-19: "yes on RELEASE_PAT") — the owner's to create, nothing in the code waits on it | Fine-grained, Contents: read/write, **owned by a JSR scope member**. Until it exists every DISPATCHED release needs a manual tag re-push — [publishing.md](publishing.md) § "ROOT CAUSE". A developer tag push works unaided (1.5.4)                                                                                                             |
| 4 | **Names under optimization**    | 🗓️ future discussion (owner, 2026-09-10), not scheduled, not to be decided unilaterally: how binaryen-ts's OPTIMIZATION treats internal vs exported names, vs upstream (which under `-g` keeps only surviving functions' names). N4 is provisional until then. Export and import names stay inviolable (pinned)                                  |
| 5 | **When to release**             | the next bump is the owner's decision, and several changes are API-visible — [unreleased.md](unreleased.md). **The bump must never be made incidentally**: the version line is what arms a release                                                                                                                                               |

~~A local directory path in git history~~ — 🛑 CLOSED as leave-it (owner, 2026-09-14). Committed
cmem no longer carries it: the absolute paths are in the private `cmem/local/environment.md`. The
copies in `b472b4aa4` (pushed 2026-09-03) and `df3659840` stay: a directory layout with no account,
token or secret is not worth a force push. Do not re-open.

~~JSR and GitHub descriptions on both predecessors~~ — 🛑 CLOSED as won't-do (owner, 2026-09-02);
the predecessors are frozen. Do not re-open ([project.md](project.md)).

## IR convergence — next steps

Status table and full record: [ir-convergence.md](ir-convergence.md) § "Where it stands".

- ✅ **S6 step 5 — the bridge is deleted** (M8e, 2026-09-18): `prepareForPasses` (names M8c, types
  M8d) replaced it, and `deno task direct` / `direct-behaviour` its gates —
  [ir-convergence.md](ir-convergence.md) § "Item 6 — the MODULE half".
- ✅ **S7 — the text-form record** (2026-09-19): per function (`899263b7b`), then per INSTRUCTION —
  a mix stays the same mix (`b366262ce`, owner: "one to one unless it goes through optimization");
  on by default, stripped by the optimizer — [ir-convergence.md](ir-convergence.md) § "S7".
- ✅ **K1 — atomics and `call_ref` in binaryen-ts** — ported 2026-09-16 (S6 step 5 item 5 (5)).
  Left from it: Asyncify refuses `call_ref` (upstream instruments it as an indirect call).
- ✅ **W8 — wabt-ts dropped `(@metadata.code.*)` text annotations** — FIXED 2026-09-28
  (`815a59244`, pre-bump item 2); divergences.md W8.
- ⬜ **Decommission binaryen-ts's decoder and encoder** (owner, 2026-09-28). The CODECS are already
  gone: the decoder was deleted at 1.6.0 (one front end stage 3b), the encoder at stage 4b, and
  binaryen-ts reads and writes through wabt-ts's reader and writer. What is LEFT is the adapter layer
  that still stands in their place:
  - `src/binaryen-ts/encoder/write-wasm.ts` — `writeWasm` / `writeWat` / `WasmEncodeError`:
    `resolveNames` + `synthesizeTypes` on a COPY, then `writeBinaryIr` / `writeWatModule`;
  - `src/binaryen-ts/ir/prepare.ts` — the read side: `WasmBinaryError` (moved from the decoder,
    same contract) and `prepareForPasses` (names M8c + types M8d).
  Importers, measured 2026-09-28: write-wasm.ts src 4 / tests 109 / scripts 20; prepare.ts src 3 /
  tests 89 / scripts 25. `Module.emitBinary` (`api/index.ts`) and the compat API go through them,
  so their public contracts (error classes and messages) must hold. Scope before cutting: which
  part is a real step (the copy + resolve, the pass preparation) that only MOVES, and which is a
  name that can go; the `encoder/` directory itself is the obvious leftover.
  Scoped 2026-09-28: neither file is a public export (only `api/index.ts`, `api/binaryen-compat.ts`
  and `tools/wasm-opt.ts` reach them). `write-wasm.ts` is ~500 lines of REAL work on binaryen-ts's
  tree conventions (copy, `nameTheFrame`, resolve, `checkForWriting` — the deleted encoder's
  refusals — `labelsToDepths`, sigils), so it moves, it does not go. **Owner, 2026-09-28: "Relocate,
  keep names"** — `encoder/write-wasm.ts` → `ir/` beside `prepare.ts`, the `encoder/` directory
  deleted, function names unchanged (callers change their import path only); baseline must stay
  IDENTICAL. Rejected: renaming every call site; pushing the preparation into wabt-ts (it would
  learn binaryen-ts's conventions).

### Follow-ups kept deliberately behaviour-neutral

- ✅ ~~RemoveUnusedModuleElements's `importedFuncs` set changes nothing~~ — deleted in the scheduled
  cleanup (`95be871f7`); the entry as it stood: `git show 7fa9c8246:cmem/open-work.md`.
- ⬚ `mapExpression` / `walkExpression` visit a branch's condition BEFORE its values — the reverse of
  wasm's evaluation order. Fixing it may move `-Oz` bytes, so it wants its own measured commit.
  ⚠️ It was not only theoretical: `deriveTypes` (order-sensitive) used it, and W10b's nesting made
  the spec's invalid `br.6` pass. `deriveTypes` now orders branch operands itself (`cd37142a6`);
  any OTHER order-sensitive visitor of branches is still exposed. Since 2026-09-28
  `operandsInOrder` (`ir/phantoms.ts`) is the one correct ordering — the block-parameter lowering,
  the phantom rule and Inlining use it; a fix to the walkers could route through it.
- ⬚ LocalCSE treats a multi-value `return` as opaque (as it did the `tuple.make`).
- ⬚ **26 node LITERALS in `src/` bypass their factory** and hand-compute its `type` — 17 in
  binaryen-ts's WAT parser, 5 in inlining, 4 in three other passes (re-counted 2026-09-19, was 43 on
  2026-09-14: `grep -rnE "kind: ExpressionKind\.\w+," src` outside `ir/expressions.ts`). The
  `br_if` one was wrong. The rest want a sweep comparing each literal's type to the factory's.
- ⬚ **LocalCSE is an allow-list of kinds** and is opaque to everything it does not list — e.g. an
  expression under `extract_lane` (or any other SIMD kind) is never reused, where upstream
  `--local-cse` reuses it. Found scoping K3. K3 fixed the shift itself, which is now a `binary`, but
  not what sits beneath an unlisted kind: the K3 test's first fixture tripped on exactly this. How
  much of the size gap to upstream it explains is unmeasured — but the gap it lives in now is:
  **42.1 KB over 421 modules** is all that our twelve passes lose to upstream's SAME twelve, measured
  2026-09-19 ([names.md](names.md) § "Names under optimization, priced"). That is the budget every item
  in this list draws from; a fix claiming more than it has is claiming someone else's bytes.
- ⬚ **The bigger half of the `-Oz` size gap is coverage, not quality: 60.3 KB** of the 109.5 KB comes
  from passes upstream runs at `-Oz` and we do not run at all — Inlining (ours is `-O3` only), DAE,
  DuplicateFunctionElimination, Precompute, MergeBlocks, SimplifyGlobals. It shows in what survives:
  **3,943 functions kept to upstream's 2,663**. Scheduling Inlining at `-O2` / `-Oz` is the cheapest
  probe, since the pass exists; ⚠️ it must wait for One front end stage 2, because `Inlining` is one of
  the passes the block-param round trip currently breaks (above).
- ✅ BUILT 2026-09-28 (merge `26d4ca11e`; see "Handoff before the pre-bump items" item 4). Was:
  **No `MinifyImportsAndExports` pass** — the ONLY name-based size lever there is, since every other
  name is an index ([names.md](names.md) § "Does optimization RENAME things to shrink them?"). Upstream's
  `--minify-imports-and-exports` rewrites the interface strings to `a`, `b`, `c`… and prints the old→new
  map as JSON; on the probe module it was **139 → 106 bytes, −24%**. ⚠️ Opt-in ONLY, never in `-Oz`:
  the owner's rule is that an exported name must absolutely be preserved "or we have name mangling", and
  a renamed export is only correct when the host is updated from that map. Upstream ships it exactly
  that way.
- 📝 **NOTED for the next session (owner, 2026-09-19), prerequisite to any minification: LIST THE DATA
  TYPES — every kind of thing that carries a name — so we can see what would need RENAMING and what
  REFERENCES it, then discuss how to do it without creating errors.** The owner's framing: whether we
  follow upstream's approach or do better on size is part of that discussion, and **it has to be
  measured**. Note only; it comes after the open items above.
  Where to start, so this is not built from scratch: [names.md](names.md) § 1 already lists the twelve
  name-section kinds with their corpus counts and their home field in each IR. What that table does NOT
  yet carry is the three columns a minifier needs, and those are the deliverable:
  1. **does this name occupy bytes?** For all twelve the answer is no — they live in the `name` custom
     section or nowhere, and the entity itself is referenced by INDEX. Only the import `module` / `field`
     strings and the export strings are bytes in a stripped module ([names.md](names.md) § "Does
     optimization RENAME things to shrink them?"). ⚠️ This is what makes the inventory worth writing
     down rather than assumed: it says in advance that eleven of the twelve kinds can be renamed freely
     for zero gain, and that the whole size prize sits in the interface, where renaming is a CONTRACT
     change and the risky one.
  2. **what references it, and what must move in lock-step.** Inside the module: our `explicitNames`
     record (which names are REAL — decision 4), the name-section writer, the text writer, and for a
     label its branch targets. Outside: for an export, every host that calls it; for an import, every
     host that supplies it. That outside column is the whole error surface — a wrong rename inside the
     module makes ugly text, a wrong rename of the interface makes a module that no longer loads.
  3. **what proves it did not break.** The gates that would have to hold: `direct-behaviour` (1953 calls
     / 651 exports — it calls exports BY NAME, so it is the natural oracle for a rename map), the
     `wat_input.test.ts` export-name pin (owner: "or we have name mangling"), and a new
     round-trip-the-map check. ⚠️ A minifier whose map is wrong in one entry is a defect our byte gates
     cannot see at all — they compare bytes, and the renamed bytes are self-consistent.

  **The owner's principle for it (2026-09-19), which settles the shape:** the EXPORT side must keep
  fidelity with the original names consumers reference; everything that is not referenced from outside
  "can be minified without restraint as long as they maintain programmatic fidelity in process, not
  necessarily in name". Two things follow, and the second is why this is a small job rather than a big
  one:
  - **The back-reference the owner expected to build already exists in the format.** The export section
    maps a STRING to a kind plus an INDEX — it never mentions the function's internal name, and neither
    does any other reference in a binary. So renaming anything internal cannot break an export, and
    there is no "point the exports back at the minified name at the end of the file" step. What must stay
    consistent is only in the IR: the entity's `name` field, `explicitNames`, and a label's branch
    targets.
  - **Renaming internals collects ZERO bytes,** already measured: internal names are not in the binary at
    all, and our `-Oz` output carries no name section on any of the 421 modules
    ([names.md](names.md) § "Does optimization RENAME things to shrink them?"). The only build where they
    exist is `-g`, where shrinking them defeats what `-g` was asked for. So the permission is correct and
    there is nothing behind it to collect; do not spend pass time on it.
  So the ENTIRE prize is the interface strings — the two kinds the owner fenced off — and the fattest is
  usually the import `module` string, because it repeats PER IMPORT ENTRY (twenty WASI imports carry
  `"wasi_snapshot_preview1"` twenty times, 440 bytes). ✅ The ceiling scan was done (29,668 bytes,
  names.md § 1a) and the pass built against it (−29,674 at `-Oz`).
- ⬚ **Our `RemoveUnusedModuleElements` does not prune unused TYPES** — on the probe module, after the
  uncalled function was correctly removed, ours kept **2 type entries to upstream's 1** (4 bytes there).
  ⚠️ UNMEASURED over the corpus: the run that would have priced it was still going when the session
  ended (`scratchpad/names/types.ts` adds the Type-section total to `size.ts`; re-run it).
- ✅ BUILT 2026-09-28 as `wasm-opt --converge` (merge `25717c474`; "Handoff before the pre-bump
  items" item 2). The design note, kept for its reasoning:
  📝 **PARKED by the owner, 2026-09-19, deliberately: "We can note it now and test it later in practice
  once we have worked through our open items."** So this entry is a NOTE, not a task — no loop, no flag
  and no measurement until the items above it are closed. It is written out in full because the design
  reasoning is the perishable part; the build is cheap once the numbers exist. Should the pipeline
  ITERATE to a size fixed point?
  Their proposal: "perform passes until there is a delta decrease in size in the range of 0.1% then
  stop." What upstream does: `-O`/`-Oz` is a FIXED list, and the convergence behaviour is a separate
  opt-in flag — `wasm-opt --converge` (`-c`) repeats the whole pipeline until the module stops changing
  at all, off by default because of the cost. So the owner's instinct matches upstream's, with a cheaper
  stopping rule (a percentage floor instead of a fixed point). The cautions to carry into the design:
  a round can GROW bytes before the next shrinks them (Inlining, Flatten), so it needs best-so-far
  tracking and a never-regress guard; passes can undo each other (LocalCSE's tee vs CoalesceLocals), so
  it needs an iteration cap and cycle detection on a module hash; the delta can only be read by
  ENCODING each round, which is the honest measure and a real cost; and it would move emitted bytes, so
  it re-baselines. **First step is a measurement, not a build:** run the existing `-Oz` list 2× and 3×
  over the corpus and see what round 2 and round 3 actually return — if round 2 is worth 0.3% the
  60.3 KB coverage gap above is the better investment, and if it is worth 3% this becomes the cheapest
  win we have. ⚠️ Either way it comes after One front end stage 2, because iterating a pipeline that
  currently breaks `Inlining` multiplies the exposure.
  **Refined by the owner the same day: average the delta over the next TWO rounds rather than test one
  round.** That is the right answer to the grow-then-shrink caution above — Inlining inflates and the
  next round collapses it, so a one-round test stops exactly where the win begins. Note the equivalence:
  "the average of two rounds is under 0.1%" IS "the cumulative gain over two rounds is under 0.2%", and
  the cumulative form is what to build — a history of sizes compared against best-so-far, no lookahead
  bookkeeping, and it generalises to **stop when the cumulative gain over the last `k` rounds is under
  `T`**, defaults `k = 2`, `T = 0.2%`. If the corpus shows a three-round chain, only `k` changes.
  ⚠️ Two design points survive the refinement: RETURN THE BEST-SO-FAR, not the last round — a two-round
  window always pays for two rounds it then discards, and without best-so-far the loop can hand back a
  module bigger than one it already held; and a window does not stop an OSCILLATION (LocalCSE's tee vs
  CoalesceLocals can trade forever at a small nonzero delta), so the cap and the hash check stay.
  ⚠️ Whether `k = 2` ever changes the ANSWER here is unmeasured and the same experiment settles it:
  record per-round size per module for 3 rounds, then read both the marginal gain AND every instance of
  a round that GREW. No module ever grows ⇒ `k = 1` and `k = 2` agree everywhere and the average only
  costs time. ⚠️ And "two passes" is not "two rounds": single passes are wildly uneven (`PickLoadSigns`
  does nothing to a module with no loads), so a two-PASS average mostly measures which two passes it
  landed on. The unit is a full round of the twelve.
- ⬚ **LocalCSE runs after SimplifyLocals and CoalesceLocals at -Oz**, so the tee it adds is never
  cleaned up: +4 bytes on a repeated binary (measured scoping K3, 2026-09-14).
- ⬚ **binaryen-ts could run-length-compress its locals** as wabt-ts now does — roughly 5,600 bytes
  of that redundancy on the corpus. An optimisation, not a defect
  ([ir-convergence.md](ir-convergence.md)).

## Open defects and gaps

- ✅ **Q9, W12, K4 and the release script's cold type check** — all FIXED 2026-09-28 as pre-bump
  items 1, 2 and 4 (the table at the top of this file); rows in [divergences.md](divergences.md).
- ✅ CLOSED 2026-09-28 — that parser is deleted (stage 5), and the text route honours an explicit
  memory index (`text_route/explicit_memory_index.test.ts`). Was: **binaryen-ts's WAT parser has no
  multi-memory support** (measured 2026-09-15). An explicit
  memory index on `memory.size`/`grow`/`fill`/`copy` or a load/store is REFUSED — loud, not silent.
  `memory.size` was the silent exception (it ignored `$b` and asked memory 0) until S6 step 5 stage
  B4; `tests/binaryen-ts/parser/explicit_memory_index.test.ts` pins all five as refusals. wabt-ts's
  parser and both binary paths handle multi-memory. A capability gap in one front door, not a
  defect.
- ✅ **Multiple tables were refused at encode** — lifted 2026-09-28 (item 5 of the handoff above).
  Both encoders already threaded the real index; the guard was all that was left.
- ✅ ~~**`scripts/wabt-ts/engine-check.ts` self-tests only the reject direction**~~ — FIXED
  2026-09-28 (`d732dee98`): a KNOWN_GOOD module (KNOWN_BAD's one-byte correction) every engine must
  accept, or the run aborts. All three engines pass; inverted, exit 1.
- ✅ ~~**Stale source comments**~~ — all seven corrected against the code 2026-09-28
  (`d732dee98`), each re-verified first (the relaxed ternaries ARE ternary; loads DO carry
  `memidx`; the reader DOES keep the name section; `deno task test` DOES grant `--allow-run`). The
  list, for the record (first verified 2026-09-14):
  - `src/wabt-ts/ir/ir-util.ts` ~80 / ~91 — the `ModuleContext` doc claims traffic "across
    validator, binary writer, and bridge" (the bridge is deleted); `getExprArity` has no production
    caller ([wabt-ts.md](wabt-ts.md)).
  - `src/wabt-ts/ir/apply-names.ts` ~16 header NOTE still calls the rewriter partial; T13.20 made it
    total.
  - `src/wabt-ts/reader/binary-reader.ts` ~2721–2724 calls the relaxed ternaries "not yet
    distinguishable… a known limitation"; ~2700 decodes them as ternary.
  - `src/binaryen-ts/encoder/wasm-encoder.ts` ~1736–1744 describes "four sites" and
    `sealFrame`-stamped blocks, a mechanism S6 5 removed; so does
    `tests/binaryen-ts/binary/region_body.test.ts` ~152.
  - `src/binaryen-ts/passes/asyncify.ts` ~276 says loads carry no memory index, and ~553 says the
    reader discards the name section; N1 P4 (`138148881`) reads names. Neither limitation re-probed.
  - `src/binaryen-ts/tools/wasm-opt.ts` ~463 says `import.meta.main` is "not yet universal"; the
    Node 22.18 floor has it.
  - `tests/wabt-ts/tools/cli_io_errors.test.ts:27` says `deno task test` runs `--allow-read` only.
- ✅ ~~**Minor, wabt-ts**: `parseHexFloat`; `wasm-objdump -h`; the dead lexer guard~~ — FIXED
  2026-09-28 (`d732dee98`). "Lexer-level only" was WRONG: `parseF32Literal` / `parseF64Literal` are
  PUBLIC, and were silently wrong on six shapes (`0x1.5` → 0 — the regex required `p`; `1_000.5` →
  1; double rounding past bit 52 and on f32 decimals; `1e39` → f32 infinity; `1.5abc` → 1.5). They
  now use the WAT parser's exact conversions, MOVED into `core/literal.ts` and shared — bit for bit
  with `wat2wasm`. `-h` means something (upstream's rule: show what the flags ask for). The guard
  says what it does. `literal.test.ts`, `objdump_flags.test.ts`.
- ✅ ~~**T2** — "the encoder derives the type-section order"~~ — NOT REPRODUCED, and moot: that
  encoder is deleted. Asked of the one writer instead (2026-09-28, `scratchpad/t2.ts`): the type
  section is kept byte-for-byte in 2,914 of 2,919 valid modules, and the 5 others keep every type in
  order — an empty rec group dropped (`type-rec.0`), an empty type section dropped (`custom.1`,
  `binary.62`), padded LEBs canonicalized (`binary-leb128.8`/`.9`).
- ✅ ~~**E1 unification**~~ — UNIFIED by the one reader (checked 2026-09-28, `scratchpad/e1.ts`):
  an explicit empty `else` in BYTES is kept by both byte routes (wabt-ts read → write, and
  `readForPasses` → `writeWasm`), exactly as upstream `wasm-opt` keeps it; every TEXT route drops it
  (`wasm2wat`, `wat2wasm`), exactly as upstream wabt does.
- ✅ ~~**Does the ONE READER consume-and-discard anywhere?**~~ — NO instruction is dropped, measured
  2026-09-28 (`scratchpad/discard.ts`): 2,919 valid modules through both routes, the code section
  changes in 6 and every change is encoding (zero-count local groups merged, padded LEBs, an empty
  code section). The spec suite exercises essentially every opcode the reader dispatches; an opcode
  it does not use is the gap this cannot see. One side finding: dropping an EMPTY section moves the
  custom sections anchored to it (`custom.1`: "after type" → "before type"); text only.
- ✅ COVERED by `deno task spec-behaviour` (in the gate; SIMD too since pre-bump item 6). Left, and
  optional: nothing in the gate checks the manifests' own EXPECTED values (the SIMD oracle check,
  24,110 / 24,115, was a scratch probe). Was: **`assert_return` / `assert_trap` are not run by
  `deno task spec`** — skipped deliberately so the
  first harness measured the must-reject axis. 🔧 2026-09-28: a DIFFERENTIAL invoke harness was
  built in the scratchpad and found Q1–Q8 (now `deno task spec-behaviour`, item 6 above). It compares against
  the original module run in V8, not against the manifests' `expected` values — checking those
  directly would also judge the ORIGINAL decode, which the differential cannot.
- ⬚ **N4** — under `-O2 -g` we keep the local and label names passes leave; upstream drops them.
  Provisional, pending owner action 4. **An owner decision, fully priced** ([names.md](names.md)
  § "Names under optimization, priced": 127.4 KB of locals and labels over 421 modules, under `-g`
  only, not where the size gap lives). Nothing to build until it is decided.
- ⬚ **`wasm2wat` cosmetics** (re-probed 2026-09-28: still `call 15` beside a function the name
  section calls `$__str_char_at`) — ENTITY references print by index where upstream prints the
  name; branch LABELS print by name since N8. Folded siblings share a line. Text only, never bytes.
  **Scoped 2026-09-28, not built — an owner call:** (a) every reference SITE must move together
  (calls, `global.*`, `table.*`, `memory.*` immediates, `(type N)` uses, exports, `start`, elem
  segments, tags) or the text is inconsistent — the T13.20 lesson; the total `rewriteExprVars` covers
  expressions only; (b) a name section need not hold UNIQUE names — two `$f`s would make `call $f`
  re-assemble to the first, WRONG BYTES silently — so it needs upstream's dedup rule first; (c) it
  moves the text of every corpus module with names (a text re-baseline, and a CHANGELOG line, like
  folded-by-default was).
- ✅ FIXED 2026-09-28 — owner: "Option 1. 1.6.1. Release preflight" (`b5035ff5f` on
  `release/1.6.1`, cut from `v1.6.0`; merged to `main` `9e911a5f2`, unbumped): `.` → `main.ts`,
  whose dispatcher runs under `import.meta.main` and which re-exports `src/index.ts` (no library
  import breaks — the root exported nothing); the tools' JSDoc name the root's form; release
  preflight 0d (`scripts/release/entry-check.ts`) runs the root as a user does and refuses.
  ⬚ **1.6.1 itself is NOT released** — see [publishing.md](publishing.md) § "1.6.1 — a patch
  from a branch": `deno task release` pushes LOCAL `main`, which holds unreleased work. Was:
  **The CLI is unreachable from JSR** (found 2026-09-28 fixing a stale comment): README's
  `deno run -A jsr:@jrmarcum/binaryang <command>` runs the `.` export, `src/index.ts`, which has no
  dispatcher — measured on the PUBLISHED 1.6.0: `--help` prints nothing and exits **0**, as does
  `wasm-validate /nonexistent.wasm`. The per-tool forms in the tools' JSDoc
  (`jsr:@jrmarcum/binaryang/wasm-validate …`, "CLI form (via `import.meta.main`)") do the same: the
  tools no longer self-execute (A9–A12). Since `4651be129` (2026-08-27), so probably never worked on
  binaryang. `main.ts` calls its dispatcher UNCONDITIONALLY, so pointing `.` at it would run the CLI
  on every library import. The likely fix: `main.ts` guards `await main()` with `import.meta.main`
  (the reason README gives for the 22.18 floor — nothing uses it today but `engine-check`), and a
  `./cli` export (or `.` → `main.ts` with the library at `./lib`); then the JSDoc forms. ⚠️ Changes
  the published entry points: the owner's call, and a release.
- ✅ MOOT for two of three (2026-09-28): `binaryen-ts/parser/*` is deleted (stage 5), so there is
  no intent left to confirm for those; `wasm/demo_bytes` is still unconfirmed. Was: **Doc
  references mapped on plausibility**: `binaryen-ts/parser/tokenizer`, `parser/wat-parser`
  and `wasm/demo_bytes` named subpaths that never existed and were pointed at `./api` and `./wasm`.
  Someone who knows the intent should confirm (recorded in 1.5.2's scope, summarized in
  [project.md](project.md)).

## Conformance gaps — the wasmtk-ranked list

Ranking agreed in [handoffs.md](handoffs.md). Ranks 1–3 shipped (`br_on_cast` and `br_on_*` in
1.5.3; the convert pair `9d5c886be`, unreleased — divergence X1).

| rank | gap                                                | status                                                                                                                                       |
| ---- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 4    | the five that unblock nothing for wasmtk           | ⬚ open, ranked last on their numbers despite 121 occurrences                                                                                 |
| —    | **exact types** (`(exact $T)`), 116–548 assertions | ⬚ open, ranked last on effort. Parser-gated: `(exact $T)` fails at parse, so it is a type-system change across both trees, not a bridge case (written before the IRs merged; since 1.6.0 there is ONE IR — the change is to it and its two sets of consumers, the format tools and the optimizer) |

## Quality passes — 1.5.6 / 1.5.7

The plan, agreed 2026-09-02. Each version adds a LENS and re-runs every lens below it, and each lens
repeats until a pass turns up nothing new — the re-runs are the point, since fixing a hardening
issue can introduce a code issue:

| version   | lenses, in order                            | state                                                                                    |
| --------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **1.5.5** | code                                        | ✅ passes 1–7, register empty, converged — [testing.md](testing.md) § "The 1.5.5 passes" |
| **1.5.6** | hardening → then code again                 | ⬚ not started                                                                            |
| **1.5.7** | security → then hardening → then code again | ⬚ not started                                                                            |

Without definitions 1.5.6 just repeats 1.5.5. If a finding fits two lenses, file it under the
**lowest** one that would have caught it:

| lens          | question                                    | examples from this codebase                                                                                                 |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **code**      | is it WRONG on valid input?                 | wrong bytes, dropped information, logic contradicting its own docs, one fact duplicated in two places that drifted          |
| **hardening** | does it survive HOSTILE or malformed input? | truncated binaries, absurd section counts, deep nesting, a panic where a typed error is the contract, unbounded work        |
| **security**  | can a consequence be EXPLOITED?             | unbounded allocation from an attacker-controlled length, path traversal in a CLI, ReDoS, integer overflow reaching an index |

⚠️ Converging means THESE invariants no longer discriminate, not that no issues remain. Keep a
per-pass record — what each pass looked for and found — or convergence cannot be told apart from
fatigue.

## Repo work

- ⬚ **A2 — `wasm2ts` is a stub that throws.** The long-term goal (WASI Preview 1 capable TypeScript
  output). **Blocked, and not close**: as of 2026-09-02 the wasmtk side has a long way to go before
  there is anything to implement against.
- ⬚ **Phase 10 kernel selection** — a live gap carried from binaryen-ts, not re-checked since the
  merge ([project.md](project.md)).
- ⬚ **Diagnostic usefulness** ("is the message actionable?") is the one hardening axis never
  attempted; offsets (A3) and wording are measured ([wabt-ts.md](wabt-ts.md) §
  `wabt-ts/testing.md`).

## The wasmtk thread — `handoffs.md` §§ 7–11

| §  | content                                                                        | state                                                                                                                                                                          |
| -- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7  | the `br_on_cast` estimate correction — three defects, not one                  | delivered                                                                                                                                                                      |
| 8  | retraction of the phantom "deps need proper names" finding                     | delivered                                                                                                                                                                      |
| 9  | defect 5 is **wider** than described; the deps unblock; `.gitattributes`       | ✅ **closed by them** — they renamed `binaryen` → `binaryen-backend`, widened `.gitattributes`, and closed defect 5 with a conditional                                         |
| 10 | correcting § 9 (they are on **1.5.3**); the convert pair priced by building it | ⬚ **awaiting their answer on one question** — though they have SHIPPED against 1.5.3 as 2.0.2, so the `br_on_cast` queue entry is most likely stale rather than a live failure |
| 11 | adopting their conditional-not-clearance form and their alias invariant        | ⬚ outbound                                                                                                                                                                     |
| 13 | the optimized-behaviour defects fixed on `main` (Q1–Q8, several tables) — Q1 silent at -O2+ in 1.5.4 | 🚫 **not needed** (owner, 2026-09-28: the fix ships before wasmtk updates) ([handoffs.md](handoffs.md) § 13)                                                                              |

⚠️ **The one open question is in § 10 and it matters:** their queue still lists `br_on_cast` as
unstarted, but all four `br_on_*` forms shipped in 1.5.3, which they are on. Either that entry
predates their bump, or **our fix does not cover their cases** — we asked for one failing module.
Resolve it before anyone starts on their queue.

**Also open, from their side:** their 100 pinned wast failures are described as GC/ref-types
conformance gaps. If any route to us rather than to wasic we want to know which — "now visible
rather than masked" is exactly the condition in which a gap gets attributed to whichever layer
someone is looking at.

## Not tasks, by decision

- **Converging the two IRs is not a release task** — open-ended by decision 1, tracked by
  `deno task collisions` ([project.md](project.md)). The S series is the work.
- **D4 — never yank, ever** ([project.md](project.md)).
- **The predecessors are frozen** — no change to `binaryen-ts` or `wabt-ts` on GitHub or JSR.
