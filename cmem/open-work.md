# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

**State, end of 2026-10-09:** `binaryang@1.10.0` is the last release (`wasm-bundle` —
[bundle.md](bundle.md), [publishing.md](publishing.md) § 1.10.0). **On `main`, UNRELEASED and
NOT PUSHED:** item 21 closed — one `src/` tree, one declaration per name (collisions 88 → 0, the
compat names renamed with deprecated aliases), one IR subpath `./ir` with the three old ones
deprecated ([one-tree.md](one-tree.md)); round 13 (hardening) passes 1–2 — malformed input gets
a typed answer everywhere, the weakest nesting ceiling ~384 → ~930; and the interpreter's HANG
CHECK, interval 2 s set from measured run times ([hardening.md](hardening.md)). The next release
is a MINOR, 1.11.0 (new exports, deprecations, one type-level breaking change —
[unreleased.md](unreleased.md)), typed by hand when the owner says. wasmtk's letter
[handoffs.md](handoffs.md) § 27 SENT by the owner; it asks their measurement once wasic marks its
addresses. **Next: round 13 goes on — the code lens again, then a hardening pass that re-runs
`deno task hostile` until a pass finds nothing; deeper nesting ceilings are the OWNER's priority
call. Then 14 (security); 25 after the `./ir` release; 15 stays blocked on wasmtk. 4 open items,
none blocking**; numbers 2–7, 9–12, 16, 17, 21, 22, 23, 24 are gone and kept free. Re-derive any
number before quoting it.

**State, end of 2026-10-12 (this supersedes the 2026-10-09 line above; all merged to `main`, NOT
PUSHED; the version stays 1.10.0):**
- **Done this session:** item 26 B1, B2 and B4 (the Bun migration; scripts run from Bun);
  item **27** closed (interp `Stop(invalid)`); item **28** parts 1, 2, 4 and 5 (every export loads
  in a browser, held by `bun run browser` with `--external 'node:*'` plus `bun run portability`;
  `wasmOpt` takes bytes; the source is erasable TypeScript, so Node 22–26 run it with NO flag;
  every current Node LTS tested by `bun run lts` through fnm, and CI by `setup-node`). The guide for
  the other JSR packages is [jsr-deno-exit-guide.md](jsr-deno-exit-guide.md).
- **Who runs what** (owner, 2026-10-12): **Deno for JSR only** (`deno publish --config jsr.json`
  and its dry run; `deno check` / `test` / `fmt` remain until B3 / B5). **The V8 referee** for
  the engine-oracle steps is Node 24 through fnm, named once in `scripts/v8.ts`, with Node 26 for
  custom-descriptors and Bun for wide-arithmetic, each measured equal to Deno's results.
  **Everything else** runs on Bun. fnm holds Node 22, 24 and 26.
- **The next release is a MINOR, 1.11.0** ([unreleased.md](unreleased.md)): new exports,
  deprecations, the `./ir` subpath, and now a type-level BREAKING change (the 19 exported `enum`s
  are const objects).
- **6 open items:** 13 (hardening; code lens pass 1 on the unmerged `code-lens-13`), 14
  (security), 15 (`wasm2ts`, blocked on wasmtk), 25 (remove the deprecated subpaths, after
  1.11.0), 26 (Bun migration: B3, B5, B6, B7), 28 (part 3, a headless browser; the in-browser
  optimization measurement; precise operator unions, a follow-up).
- ⚠️ **`code-lens-13` CONFLICTS with `main` in one file, `src/ir/derive-types.ts`** (everything
  else auto-merges). The branch adds a NEW constructor parameter property there
  (`private readonly discarded?: Discarded`) in the constructor part 4 converted. Merging means
  resolving that hunk AND converting the property to the `declare` form; `erasableSyntaxOnly` (on
  in tsconfig and deno.json) refuses it otherwise. Its own process still applies first: one
  convergence re-run that adds no row.
- **Dates:** Node 26 becomes LTS on 2026-10-28 (ready: it runs the source; `bun run lts` will
  require it that day). Node 22's end of life (2027-04-30) needs NO action: `bun run lts` follows
  the schedule. Deno keeps working after its development ends (owner, 2026-10-12).
- **Owner, 2026-10-12: the NEXT project is universal-wasm-loader** (Bun cannot import `.wasm`;
  the guide's F11), worked in ITS repo, not from here.

**State, end of 2026-10-13 (supersedes the 2026-10-12 paragraph where they differ; all merged to
`main` and PUSHED; owner: "lets update the project memory files and then ship 1.11.0"):**
- 🚀 **1.11.0 PUBLISHED** 2026-10-13T01:12:58Z (UTC) with provenance (Rekor `3247643457`), the first
  publish through the Bun workflow: B6 / B7 proven, **item 26 CLOSED**. ([publishing.md](publishing.md) § "1.11.0".)
- **Item 26, the Bun migration: DONE (closed with the 1.11.0 publish).** B3 (Biome for `deno lint`, dprint for
  `deno fmt` byte for byte, each with a canary; no `biome-ignore` left), B5 (the suite on
  `node:test`: `bun run test` on Node 24 is the verdict, `bun run test:bun` must fail exactly 36
  listed JavaScriptCore differences), B6 (auto-tag off Deno; publish.yml runs CI's checks, then
  the one direct `deno publish`), B7 (no `deno.json`; `deno publish` finds `jsr.json` itself; the
  standalone `comparison/` runs again). **B6 / B7 proven by the 1.11.0 publish (Rekor `3247643457`).** [bun-migration.md](bun-migration.md) has each step.
- **Who runs what:** Deno for `deno publish` (and `deno doc` in one test, and the Deno-run
  `comparison/`); Node 24 for the test verdict and the engine-oracle scripts; Bun for everything
  else.
- **Item 28:** `Opcode` is the union of the 582 real instructions, generated from `opcodes.json`
  (`src/definitions/instr-code.ts`); the 43 opcode casts are gone; the reader now refuses a reserved
  SIMD sub-opcode it used to accept. Open: the headless-browser run (Playwright or Puppeteer: the
  owner's call) and the in-browser optimization measurement.
- **wasmtk's Asyncify report (handoffs.md §§ 28-29, the reply SENT by the owner):** TinyGo 0.43's
  goroutine builds crashed `Asyncify`; the cause was an analysis divergence (upstream stops
  propagation at the bottom-most runtime); fixed, and wasmtk's reproducer runs correctly
  (`wg-counter: 45` on wasmtime and wasmer).
- **1.11.0** carries all of it ([unreleased.md](unreleased.md)): a MINOR (new exports, type-level
  BREAKING entries: the enums as const objects, `Opcode` narrowed).
- 🚀 **1.12.0 PUBLISHED** 2026-10-13T01:39:42Z (UTC), provenance (Rekor `3247710678`): the removal of
  1.11.0's deprecated subpaths and type names (open-work 25). wasmtk awaits it to test.
- **wasmtk's § 33 (2026-10-13):** on 1.12.0 their nested-goroutine program trapped on the rewind;
  `Asyncify`'s save set missed a paused call's operand temps. FIXED on main (unreleased, a Silent
  fix); the reply, handoffs § 34, SENT by the owner.
- **CI fully GREEN on GitHub (2026-10-13, `5e485c497`), the Browsers job included:** chromium,
  Chrome, Edge, Brave, Opera, Firefox, WebKit (Vivaldi removed by the owner).
- 🚀 **1.12.1 PUBLISHED** 2026-10-14T03:40:26Z (UTC), provenance (Rekor `3248420107`): the § 33
  Asyncify fix (a patch; the owner's "commit and bump and push"). wasmtk can bump its pin to it and
  re-run `go_asyncify_tests` (the § 34 reply asked for the count). Paused there for the day (owner).
- **5 open items:** 13, 14, 15, 28, 30 (28: 28.3 built and GREEN on CI; 28.6 MEASURED
  2026-10-13, no run-time speedup in any browser; the owner agreed: no helper, 28.7 at most a
  recipe; 30: the size gaps 28.6 found). 29 (npm as a second
  registry) PARKED as a contingency. The `code-lens-13` conflict above still stands.
- ⚠️ This machine's exFAT drive can fail a big `git merge`; check status and `MERGE_HEAD`, and if
  clean, retry (`local/environment.md`, private).

**State, 2026-10-15 (supersedes the paragraphs above where they differ; merged to `main`, NOT
PUSHED; the version stays 1.12.1):**
- **`code-lens-13` is MERGED** (owner: "sort out the code-lens-13 branch and wrap that up"):
  C1–C17 on top of 1.12.1, merge `9eb1b1de7`, full gate green on it. The ⚠️ conflict noted under
  2026-10-12 is resolved: seven files, the decisions in the merge message (the `declare` form in
  `derive-types.ts`; both opcode checks kept in the reader, the branch's duplicate C6 check dropped;
  the three new tests on `node:test`). The branch is deleted.
- **Code lens, pass 1: CLOSED.** The converging re-run on the merged tree added no row
  ([hardening.md](hardening.md) § "Code lens, pass 1"). Item 13 goes on: the hardening re-run, then
  the code lens again.
- **Unreleased on `main`:** C1–C17 ([unreleased.md](unreleased.md), `CHANGELOG.md` § Unreleased).
  The release, and its number, are the owner's call. Its letter is [handoffs.md](handoffs.md)
  § 35 (was § 28 on the branch), ✅ SENT by the owner 2026-10-15, BEFORE the release: it asks
  whether any wasmtk gate reads `wasmValidate(...).result` or `wasm-validate`'s exit status, and
  to re-run it on the release that carries C1–C17. ANSWERED the same day (§ 37): one reader,
  their wast runner's `assert_invalid` oracle, where the defect could only hide passes; they
  expect passes up, skips (16) down, their soundness guard at 0, and will send the numbers after
  the release.
- **wasmtk on 1.12.1** ([handoffs.md](handoffs.md) § 36, received 2026-10-15): `go_asyncify_tests`
  12 / 12, gate 64,506 / 0 / 16, nothing else moved. The Asyncify thread (§§ 28–34) is CLOSED.
- **The type check is `bun check`** (owner: "yes make the change"; merge `8b52828d5`): Bun
  1.4.3's built-in checker on the same four projects, gate green; `tsc` 7.0.2 kept as
  `bun run check:tsc`, not in CI ([jsr-deno-exit-guide.md](jsr-deno-exit-guide.md) § "Type
  checking: `bun check`"). Repo-only: nothing for a release note.
- **`bun lint` / `bun format` SHELVED** until a Bun release ships them (§ "Not tasks, by decision").
- **Item 28 CLOSED** (owner: "lets complete item 28 first"): 28.7's browser recipe,
  `examples/browser-optimize/`, run by `bun run browsers` in every browser, and the README's
  § "Optimizing in the browser" ([run-everywhere.md](run-everywhere.md)).
- **Item 30 CLOSED** (owner: "lets close out item 30 now", then "Top shapes, then decide"): four
  optimizer steps and a shipped-crash fix, each gated and merged on its own
  ([optimizer.md](optimizer.md) § "Open-work 30: the gaps on real compiler output").
- **3 open items:** 13, 14, 15. Then **item 31 opened** (the optimizer list, no threshold).
- ⚠️ The merge `8b52828d5` took its message by `-m`, not `-F` (working-rules.md, Git). The text
  is plain and intact; left as is, unpushed, for the owner to judge.

**State, 2026-10-20 (supersedes the paragraphs above where they differ):** **`binaryang@1.13.0`
is PUBLISHED** (Rekor `3344028471`; [publishing.md](publishing.md) § 1.13.0): everything the
paragraphs above call unreleased — C1–C17, open-work 30, open-work 31 steps 1–15 — shipped in it.
`main` = the release plus cmem; nothing unreleased ([unreleased.md](unreleased.md)). 🚨 The
release check found Local2Stack (31 step 4) computing wrong results on real compiler output;
fixed before the push, never shipped. **Open:** 31 (optimizer), 32 (new: lowering for engines
without memory64 / multi-memory), 29 (npm, reopened the same day: built and proved, not
published), 13, 14, 15. **wasmtk on 1.13.0** ([handoffs.md](handoffs.md)
§ 39, received the same day, answering § 38): gate 64,506 / 0 / 16 unchanged, soundness guard 0,
`go_asyncify_tests` 12 / 12; 43 golden WATs moved (merged `-Oz` libraries only), behaviour
unchanged; nothing open either way. **The repo moved to `synapticforge/binaryang`** the same day
([publishing.md](publishing.md) § "The move to `synapticforge`"); the JSR link re-made by the
owner and checked through the API. Not yet proven: a publish from the org (provenance), and the
org's Actions settings, which the next push's CI and the next release show.

**Owner's order (2026-09-28):** defects and gaps first, then optimizer and IR, then re-evaluate.

**Cut back to open items on 2026-09-29** (the second time; the first was 2026-09-14). The file had
grown to 1,020 lines of finished stages again. Nothing that later work needs was dropped. Each
removed record went to a topic file, and the full text is one `git show` away:

| closed history                                                           | now in                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| One front end (stages 0–5), R15's design, Q1–Q8, Flatten, `--converge`   | [ir-convergence.md](ir-convergence.md) § "Where it stands" and § "The optimizer after One front end" |
| the minify passes, the owner's naming principle, "is the scheme optimal" | [names.md](names.md) § 1a and § "Does optimization RENAME things"                                    |
| N4 (decided: keep), the Q / W rows                                       | [divergences.md](divergences.md)                                                                     |
| `spec-behaviour`, `ENGINE_UNSTABLE`, the proposal suites                 | [testing.md](testing.md)                                                                             |
| releases 1.6.0 / 1.6.1 / 1.7.0, the release pattern, `RELEASE_PAT`       | [publishing.md](publishing.md), [project.md](project.md) § "Versions"                                |
| wasmtk's letter of 2026-09-28 (items 1–5, 5a)                            | [handoffs.md](handoffs.md) § 14–15, `CHANGELOG.md` § 1.7.0                                           |
| everything else: M-series and post-M8 tables, the pre-bump items         | `git show 769b4d3c0:cmem/open-work.md`                                                               |

## Defects and gaps — the owner's first

32. ⬚ **Lowering for engines that lack memory64 / table64 / multi-memory — "runs everywhere" for
    our OUTPUT** (opened 2026-10-20, owner: "yes open that item after the release"). The 36 known
    Bun differences (`tests/bun-known-differences.json`) are all JavaScriptCore refusing a module
    V8 accepts — binaryang itself behaves the same on every runtime (`test:bun` fails exactly the
    list; the CLI smoke hash agrees on Deno / Bun / every Node LTS; the browser gate loads every
    export in WebKit). What is missing is a way to MAKE such a module run there: 24 are memory64 /
    table64 (JavaScriptCore: "Memory64 is not enabled"), 5 a memory index of 127 and up, 5 a
    legacy `delegate` form, 2 the same refusal in other words. Upstream has `--memory64-lowering`,
    `--table64-lowering` and `--multi-memory-lowering`; we have none (`LowerCustomPageSizes` is
    the one lowering built, item 12). **First, measure, nothing built:** (a) does JavaScriptCore
    take TranslateToExnref's output for the 5 `delegate` cases (if so, that is the answer for
    those, and only needs saying); (b) which lowering a real producer needs (memory64 from Rust /
    Zig / Emscripten `-sMEMORY64`; multi-memory past 127 is rare); (c) upstream's passes as the
    reference, and the gate: the lowered module behaves as the original on V8, and instantiates
    on JavaScriptCore. Not the 2 message-only cases, which need nothing.

No defects open. (Item 27 closed 2026-10-12: the interpreter's constant-expression evaluator never
checked that an expression left a value, so `(offset nop)` on an unvalidated module escaped as a
bare `TypeError`; now `Stop(invalid)` — [hardening.md](hardening.md) § "2026-10-12 — open-work 27".
Its number is kept free.)

(Item 28 closed 2026-10-15: "runs everywhere" is held by evidence in CI — every export bundles and
loads in a browser, the library runs in seven browsers with the same output as Deno / Node / Bun,
the source runs on every Node LTS with no flag, `wasmOpt` takes bytes, and the browser recipe
(28.7, `examples/browser-optimize/`) runs in every browser. The record, verbatim, and the close:
[run-everywhere.md](run-everywhere.md). Its number is kept free.)

Items 18–20, from wasmtk's § 20, were fixed for 1.8.1 the day they arrived: L3 (a
lowered out-of-bounds access traps as out of bounds), L4 (the placeholder; case 2 at an engine
ceiling) and C7 (`getFunctionInfo` shaped as binaryen.js) — [divergences.md](divergences.md).

Closed 2026-09-29: `array.new_default` defaultability (`d6b487c2d`), empty offsets / items (M2a),
the name section's position (N9, by decision), references by name (N10), folded layout and its label
comments (W18), the diagnostic defects DG1–DG4 found by measuring the old item 16
([testing.md](testing.md) § "Diagnostic usefulness"), and the two that measurement left, numbered 16
and 17 after it: DG5 (`wat2wasm` validates by default, as upstream — owner: "we want to do the
same"; it needed the validator to take labels BY NAME, which it never could) and DG6 (a text
diagnostic at the WORD, not its `(`, underlined as upstream) — [divergences.md](divergences.md). The
CI shell scripts are TypeScript (the old item 17).

## Optimizer and IR

31. ◐ **Below upstream: work the optimizer.md list with no threshold** (owner, 2026-10-15: "lets
    close out the optimizer.md items", then "Work the list to a target, but remove the 2% limit.
    Lets see how much more than upstream we can actually optimize."). The list is
    [optimizer.md](optimizer.md) § "Open-work 30: the gaps on real compiler output", "What is left"
    (re-ranked after each step), and item 2's "Not built". Method and gate as items 2 and 30: each
    step attributed first, gated and merged on its own, the behaviour gates unchanged, the
    real-compiler six AND the corpus measured. Start: six modules -Oz 145,859 (+4.9% over upstream
    133's 139,020), corpus -Oz 822,964 (+1.60% over 809,986). Progress: optimizer.md § "Open-work
    31". **State 2026-10-20, after step 15 — RELEASED in 1.13.0:** six 140,032 (+0.69% over
    upstream's 139,068; 140,028 before the Local2Stack fix, `42965f49b`), corpus 811,099
    (+0.14%); -O2 2.1% BELOW upstream. Step 9: the control diff (step 8's "next")
    found upstream's WRITER dropping code after terminators that our DCE never visited (blocks in
    operands) or never judged dead (constructs that never reach their `end`); fixed in DCE. Step
    10: Vacuum moves a named block's head out (upstream merge-blocks; 161 → 16). Step 11:
    CodeFolding folds the tails before a block's branches (code-folding 285 → 0). Step 12:
    SimplifyLocals gives a block its result from sets (simplify-locals 268 → 87; its `if` form
    measured worse, not kept). Step 13: RemoveUnusedBrs drops branches that flow to their target
    (remove-unused-brs 310 → 224; the first gate caught an `unwind.wast` regression, fixed before
    merging). Step 14: RemoveUnusedBrs sends a block's branches to the parent it ends, and merges
    adjacent `br_if`s on `i32.or` (remove-unused-brs 224 → 125). Step 15 (resumed 2026-10-20,
    owner: "lets pickup where we left off", then "yes" to the plan): the new MergeLocals pass —
    ssa-nomerge's top shape was a reused local hiding a copy (merge-locals 72 → 2, ssa-nomerge
    325 → 249); `localGraph` on bitsets, so -Oz time is unchanged; the first gate caught a
    wrong-output defect (a tee copy removed), fixed before merging. Step 8's own six figure
    (141,857) does not reproduce: 141,905 (optimizer.md 🔧). **Next: the ranked passes** (scratch
    `gap/passrank17.log`): ssa-nomerge 249, simplify-locals-nostructure 142, remove-unused-brs
    125, simplify-locals 119. Pushed and released with 1.13.0 (2026-10-20). A new session copies
    the scratch scripts first (cmem/local/environment.md, "Optimizer measurement scripts"; add
    `six-run.ts`, `commit-bisect.ts`, `timeit.ts`'s `LEVEL=`) and re-derives the six / corpus
    baseline before quoting it. **Every step now also runs** `real_compiler_behaviour.test.ts`
    (in `bun run test`): a step that only measures the six never runs them.

(Item 1 closed 2026-09-30: the walkers visit a `br_if` / `br_table`'s values before its condition.
It was a DEFECT, not only an order: `mapWithSequences` keeps, evaluated, what it mapped before an
operand that becomes a never-falling-through sequence, so StripEH ran a builder-made
`br_if $l (throw $e (i32.const 7)) (call $bump)`'s call before the trap — reachable only from trees
built by the API or a pass; the text reader keeps such a `throw` a statement before the branch. The
"may move `-Oz` bytes" premise was measured: 0 of 13,285 optimizer outputs moved (the corpus and
every prepared spec module, at -O1 … -Oz). The hand-written traversals (`deriveTypes`, `phantoms`,
`cfg`, `non-nullable-locals`) already had wasm's order. `branch_operand_order.test.ts`.)

(Item 2 closed 2026-10-08 at **1.86%** of upstream `wasm-opt -Oz` on the corpus — the owner's
≤ 2% — from 13% on 2026-09-19: [optimizer.md](optimizer.md), every step with its commit, the
method, what the last 15 KB is. Its number is kept free.)

(Item 30 closed 2026-10-15 — owner: "Top shapes, then decide": on the six real-compiler modules our
-Oz went from 10.4% to **4.9%** over upstream 133 (zig-debug +31.1% → +14.0%), -O2 from 6.3% to 1.5%,
the corpus -Oz from 1.86% to 1.60%, in four steps: OptimizeInstructions' bit rules, CodeFolding's
terminating tails, RUME's unreachable table slots, MergeSimilarFunctions. On the way, a SHIPPED crash
(1.11.0 – 1.12.1: a legacy `try` ending both arms of an `if` threw at -O2+) was found and fixed.
Gap (a) was the schedule, not a defect. Every step, the defects and what is left, ranked:
[optimizer.md](optimizer.md) § "Open-work 30: the gaps on real compiler output". Its number is
kept free.)

## Conformance

Nothing open. Closed 2026-09-29: item 11 (rank 4 of the wasmtk-ranked list — closed since M8e by the
One front end, never recorded: [handoffs.md](handoffs.md) § 4's outcome) and item 12 (`proposals/`
in the gate, both halves; custom-page-sizes on V8 through `LowerCustomPageSizes`, every assertion of
the suite honoured — [testing.md](testing.md) § "The proposal testsuites",
[divergences.md](divergences.md) L1, L2, P1). Their numbers are kept free.

## Quality passes — the lens plan (agreed 2026-09-02)

Each round adds a LENS and re-runs every lens below it. Each lens repeats until a pass turns up
nothing new; the re-runs are the point, since fixing a hardening issue can introduce a code issue.
The rounds were named for versions 1.5.6 / 1.5.7 before the releases overtook them, so they keep the
names as labels only.

| round     | lenses, in order                            | state                                                                                    |
| --------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **1.5.5** | code                                        | ✅ passes 1–7, register empty, converged — [testing.md](testing.md) § "The 1.5.5 passes" |
| **1.5.6** | hardening → then code again                 | 13. ◐ passes 1 (the contract) and 2 (the weakest ceiling, ~384 → ~930) DONE 2026-10-09, and the fuel question answered by a sound HANG CHECK (2 s); the code lens pass 1 (C1–C17) MERGED and CLOSED 2026-10-15, its converging re-run adding no row; open: a hardening re-run until clean, then the code lens again; deeper ceilings are the owner's call — [hardening.md](hardening.md) |
| **1.5.7** | security → then hardening → then code again | 14. ⬚ not started                                                                        |

If a finding fits two lenses, file it under the **lowest** one that would have caught it:

| lens          | question                                    | examples from this codebase                                                                                                 |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **code**      | is it WRONG on valid input?                 | wrong bytes, dropped information, logic contradicting its own docs, one fact duplicated in two places that drifted          |
| **hardening** | does it survive HOSTILE or malformed input? | truncated binaries, absurd section counts, deep nesting, a panic where a typed error is the contract, unbounded work        |
| **security**  | can a consequence be EXPLOITED?             | unbounded allocation from an attacker-controlled length, path traversal in a CLI, ReDoS, integer overflow reaching an index |

⚠️ Converging means THESE invariants no longer discriminate, not that no issues remain. Keep a
per-pass record of what each pass looked for and found, or convergence cannot be told apart from
fatigue.

## Repo work

29. ◐ **npm as a SECOND registry, as `@synapticforge/binaryang`** (parked 2026-10-13; REOPENED
    2026-10-20, owner: "I am setup on npm now. How do I publish this package there?", then the
    name `@synapticforge/binaryang` and "Build and prove, no publish"). JSR stays the source.
    **BUILT and PROVED, nothing published** (branch `npm-package`): `bun run npm:build` (tsc into
    `dist/` with `.ts` imports rewritten, the `bin` shebang, the files JSR ships, `dist/package.json`
    generated from `jsr.json`); `bun run npm:prove` (the TARBALL installed into a scratch consumer:
    every export imports and runs nothing on Node 22 / 24 / 26 and Bun, the installed CLI gives
    the source's smoke hash, `npm exec binaryang`, the `.d.ts` for a consumer with no
    `@types/node`, the browser bundle, the export list against JSR's own npm build); 7 build
    mutants all caught; in CI's Gates job. **The npm job** in `publish.yml` runs after JSR's from
    the same tag, OFF until the repository variable `NPM_PUBLISH` is `true`. **The owner's steps
    to switch it on:** on npmjs.com, a trusted publisher for `@synapticforge/binaryang` naming
    `synapticforge/binaryang` and `publish.yml` (check npm's docs: it may need the package to
    exist first, then a one-time token for the first publish); then the variable; then the next
    release publishes to both. Record: [publishing.md](publishing.md) § "npm as a SECOND registry".

15. ⬚ **A2 — `wasm2ts` is a stub that throws.** The long-term goal is WASI Preview 1 capable
    TypeScript output. **Blocked, and not close:** as of 2026-09-02 the wasmtk side had a long way
    to go before there is anything to implement against.
(Item 25 closed 2026-10-13: the deprecated IR subpaths and names are removed on `main`, for the next
minor, 1.12.0 — [unreleased.md](unreleased.md), the letter [handoffs.md](handoffs.md) § 32. The
premise "wasmtk does not import the IR subpaths" was checked in their repo before relying on it: true
for their code; only their vendored copy of our old source names them. Its number is kept free.)

(Item 26 closed 2026-10-13 (UTC) with the 1.11.0 publish: the development toolchain moved from Deno
to Bun, JSR kept as the source. B1–B7 are in [bun-migration.md](bun-migration.md); the proof of the
last two, the first publish through the new workflow, recorded provenance, Rekor log id
`3247643457`. Deno remains for `deno publish`, one `deno doc` test and the Deno-run `comparison/`.
Its number is kept free.)

(Item 21 closed 2026-10-09: one `src/` tree by concept, one declaration per name, one IR
subpath — [one-tree.md](one-tree.md): the four phases, the decisions, what the gate found. Its
number is kept free; the follow-up is item 25 above.)

(Item 22 closed 2026-10-08 with the 1.9.0 release and its letter, [handoffs.md](handoffs.md)
§ 26: [definitions.md](definitions.md) — what shipped, the decisions, what the proof found. Its
number is kept free.)

(Item 24 BUILT 2026-10-08 on `main`, unreleased — `wasm-bundle`, `./tools/wasm-bundle`, the
`(@reloc data)` annotation: [bundle.md](bundle.md) — the rules as built, the decisions, what was
measured, the gaps; the letter is [handoffs.md](handoffs.md) § 27. Its number is kept free.)

## The wasmtk thread — [handoffs.md](handoffs.md)

§ 22 (2026-09-30) closed the thread: 1.8.1 pinned, all three fixes hold on five engines, skips 66 →
16 (gate 64,506 / 0 / 16), nothing asked. § 20 was answered in code (items 18–20, 1.8.1) and by
§ 21. § 19 (1.8.0 is out; `LowerCustomPageSizes` offered for the custom-page modules they skip) was
SENT 2026-09-29 and asks nothing — a reply is welcome, above all their custom-page-sizes skip count
with the pass. § 17 (item 1 fixed in 1.7.1) was answered by § 18: on 1.7.1 their gate is 64,473
passed / 0 failed / 66 skipped, all 11 of our skips pass, and "none of the 66 is yours". § 11 was
sent and answered (their reply reached us 2026-09-29) — closed in [handoffs.md](handoffs.md).

## Not tasks, by decision

- **When to release is the owner's call, every time — a standing rule, not a task.** The pattern is
  settled ([publishing.md](publishing.md), current-state line). The bump is never made incidentally,
  because the version line arms a release.
- **`RELEASE_PAT` — not needed** (owner, 2026-09-29). The release pattern always pushes the tag
  itself (8 of 8 unaided). The PAT fixes only the `auto-tag` → dispatch path, which the pattern
  never takes ([publishing.md](publishing.md)).
- **Names under optimization — decided** (owner, 2026-09-29):
  - with `-g`, the local and label names the passes leave are KEPT (N4, DESIGN);
  - export and import names are inviolable, and minification is opt-in with a map;
  - the minified scheme is final: separate import/export sequences were rejected
    ([names.md](names.md)).
- **WASM kernels (binaryen-ts Phase 10) — parked** (owner, 2026-09-29: "we may reevaluate way down
  the road when we start talking about optimization and speed of processing").
  - The code stays as it is: `wasm-runtime.ts`, the demo kernel in `src/wasm/`, the
    published `./wasm` and `./wasm-runtime`. Only a test and a bench call them.
  - What was never built is kernel SELECTION: which optimizer operations are worth moving to wasm.
    The baseline is a ~2–3 ns boundary cost per call (`add_i32` ~3.6 ns as a kernel vs ~0.34 ns in
    TS), so only an operation doing much work per call can pay.
  - **Trigger to reopen:** work on the optimizer's processing speed. Profile the corpus first; a
    kernel is justified only by a hot operation the profile shows.
  - It is not part of the IR merge: the IR is the tree's shape, this is the passes' speed.
  - The doc mapping of `wasm/demo_bytes` to `./wasm` is correct: `./wasm` exports `DEMO_BYTES`
    (checked 2026-09-29).
- (29, npm as a second registry, was PARKED here from 2026-10-13; REOPENED 2026-10-20 — see item
  29 under "Repo work".)
- **`bun lint` / `bun format` in place of Biome / dprint — SHELVED** (owner, 2026-10-15: "We will
  shelve that decision until it become available in a later release"). Merged to Bun's main
  (oven-sh/bun PR #44805) and documented at bun.com/docs/lint, but NOT in Bun 1.4.3, the release
  CI and publish pin (`bun lint` there: `Script not found "lint"`); canary only.
  - **Trigger to reopen:** a Bun RELEASE that ships `bun lint` (check its release notes, then
    `bun lint --rules` outside the repo: our `lint` script shadows it inside).
  - **What deciding needs then**, the `bun check` method ([jsr-deno-exit-guide.md](jsr-deno-exit-guide.md)
    § "Type checking: `bun check`"): Biome's recommended preset minus `biome.jsonc`'s eight
    switched-off rules against `bun lint`'s defaults; the six canary rules map to `no-explicit-any`,
    `no-debugger`, `eqeqeq`, `require-await`, `no-var`, `prefer-const`; a run over the tree with
    every difference explained; the canary moved; config in `bunfig.toml`. `bun format` against
    dprint must be byte-identical over the formatted files (dprint reproduces `deno fmt`), or
    one deliberate reformat commit.
- **A local directory path in git history — leave it** (owner, 2026-09-14). The copies in
  `b472b4aa4` and `df3659840` name no account, token or secret, and are not worth a force push. Do
  not re-open.
- **JSR and GitHub descriptions on the predecessors — won't do** (owner, 2026-09-02); they are
  frozen.
- **Converging the two IRs further is not a release task.** It is open-ended by decision 1 and
  tracked by `deno task collisions` ([project.md](project.md)).
- **D4 — never yank, ever** ([project.md](project.md)).
- **The predecessors are frozen**: no change to `binaryen-ts` or `wabt-ts` on GitHub or JSR.
