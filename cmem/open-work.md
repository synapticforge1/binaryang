# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

**Earlier state lines, summarized 2026-10-23** (workspace letter H6, memory conventions: the
status is written once). Six dated "State" paragraphs, 2026-10-09 → 2026-10-22, each superseding
the one above, are folded here; their full text: `git show 4e1c27969:cmem/open-work.md` (lines
7–161). What they recorded, and where it lives now: releases 1.10.0 → 1.14.0 ([publishing.md](publishing.md),
one section per release); the Bun migration, items 26 and 28, `bun check` (merge `f5eb19750`)
([bun-migration.md](bun-migration.md), [run-everywhere.md](run-everywhere.md)); CI fully green
with the Browsers job (2026-10-13, `0e7c5398f`); the code lens pass 1 merged and closed
([hardening.md](hardening.md)); items 30 and 32 closed ([optimizer.md](optimizer.md),
[run-everywhere.md](run-everywhere.md)); the wasmtk Asyncify thread ([handoffs.md](handoffs.md)).

**State, 2026-10-23 (supersedes the paragraphs above where they differ):** letter H19 is COMPLETE
— the rewritten history is on GitHub — and **`binaryang@1.15.0` is PUBLISHED** on JSR (Rekor
`3423023791`) and npm (SLSA provenance), carrying `SSANoMerge` (open-work 31, step 16) and the
history note (CHANGELOG § 1.15.0; release record [publishing.md](publishing.md) § "1.15.0"). Also
on `main`: `docs/ir-map.html`, a map of the IR's layout for this repo and its siblings, shipped in
neither package. **Open:** 31 (resume at simplify-locals-nostructure), 13, 14, 15.

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
| everything else: M-series and post-M8 tables, the pre-bump items         | `git show 3bd64ece7:cmem/open-work.md`                                                               |

## Defects and gaps — the owner's first

34. ◐ **One opcode profile every widely used engine runs** (owner, 2026-10-23: "attempt to create a
    consolidated opcode set that all can decode and run. lets test and scope", then the four
    decisions in [portability.md](portability.md): the defining engines are the most widely used
    by browser and runtime prevalence; build the wide-arithmetic and relaxed-SIMD lowerings;
    binaryang is the source; wasmrt / wazmrt adopt it afterwards). Pass 1 (497 typed opcodes) and
    pass 2 (76 templates: every untyped D1 entry plus the encoding-level features; 13 executors
    incl. Chromium, Firefox, WebKit, Deno) DONE 2026-10-23: no engine computes a different value;
    the tiers are in portability.md. wasmer and wazero DEFINE portability (owner, 2026-10-23), so
    GC, tail calls and multi-memory stay engine-specific. Browsers: V8, SpiderMonkey,
    JavaScriptCore only (owner, 2026-10-23; Ladybird excluded). Stable browsers measured
    2026-10-23 (Chrome 156, Edge 155, Firefox 158, ESR 153, stock, no automation): they do not
    narrow the portable tier; Chrome / Edge forbid a blocking `memory.atomic.wait` on the main
    thread. Safari from MDN browser-compat-data: memory64, multi-memory and relaxed SIMD are
    preview-only there. Floor DECIDED (owner, decision 8): supported browsers on supported operating
    systems — Safari 18.4+, current Chrome / Edge, Firefox current + ESR 153; the tier stands. Pass 3
    DONE: every engine and stable browser matches the spec on 210 failure paths. **The final
    deliverable** (owner, 2026-10-23): an **`opcode-guide.md`** for the other projects to follow as
    a reference, once conformance is done. **Next:** the two lowerings,
    the portable target, D4, then **target-aware optimization** (owner, 2026-10-23: browsers'
    WebAssembly 2.0 support "should be taken into account with our optimization efforts" — passes
    may introduce what the target profile permits; portability.md decision 5). Found on the way,
    its own item when worked: binaryang's interpreter
    refuses every shared memory.

33. ⬚ **FL1 — upstream's feature-flag spelling is refused** (found 2026-10-23 measuring workspace
    letter H8 / I6): `--enable-saturating-float-to-int` / `--disable-…` (upstream wabt 1.0.41 and
    wasm-tools) is an unknown flag here; ours is `sat-float-to-int`. **Waits on the owner**, because
    `./definitions` (D2) publishes the spelling: accept upstream's (ours as an alias is additive) and
    decide whether D2's `cli` changes. [divergences.md](divergences.md) FL1.

No defects open. (Item 32 closed 2026-10-22: our OUTPUT runs on JavaScriptCore too — Safari and
Bun, the engine behind 34 of the 36 known Bun differences. Owner: "we should work on item 32
first", then "Trap, as the original", then "we measure each and make the decisions based on the
measurements". Built: `Memory64Lowering` (`--memory64-lowering`, `--table64-lowering` its alias),
sound where upstream's wraps above 2^32; the gate step `bun run lowering` (122 spec modules, 0
diverging on either engine); real compiler output — Rust nightly and Zig wasm64 builds, lowered,
run their workload to the right checksum on JavaScriptCore (`memory64_real_compiler.test.ts`).
Measured, nothing built: legacy-EH `delegate` was already solved by TranslateToExnref (70 / 70);
JavaScriptCore's multi-memory limit is 100 memories and every compiler measured emits one, so no
multi-memory lowering. Emscripten 6.0.13 `-sMEMORY64` (measured once installed): refused as built,
runs lowered — and so does its JS glue, unchanged, memory growth included; committed as test
modules beside the Rust and Zig ones (owner). Every step and number:
[run-everywhere.md](run-everywhere.md) § "Open-work 32". Its number is kept free.)

No defects open before it. (Item 27 closed 2026-10-12: the interpreter's constant-expression evaluator never
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

Closed 2026-09-29: `array.new_default` defaultability (`1108a5a1f`), empty offsets / items (M2a),
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
    upstream's 139,068; 140,028 before the Local2Stack fix, `eb0fff576`), corpus 811,099
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
    **State 2026-10-22, after step 16 (merged, NOT pushed):** owner, "proceed with item 31";
    the targets are now **output size and output run speed** ("The goal is smaller file and
    faster run"; optimizer time is not one). Step 16, the new SSANoMerge: six 139,857 (+0.57%),
    corpus 811,071 (+0.13%), run speed unchanged (scratch `gap/speed.ts`, V8 and
    JavaScriptCore). **Next** (`gap/passrank19.log`): simplify-locals-nostructure 135,
    simplify-locals 117, remove-unused-brs 109, vacuum 63. **Paused** there (owner: "update the
project memory files, then pause until later today"); resume by attributing
simplify-locals-nostructure per function (`passfn.ts <module> simplify-locals-nostructure`),
after re-deriving the six (139,857) and corpus (811,071).

**Workspace letter H15 (2026-10-22, the scripting rule) — acted on** (owner: "proceed with H15"):
the rule recorded in [working-rules.md](working-rules.md) § Tools (committed repeated-use scripts
are TypeScript on Bun; a one-time script may stay shell, written with `Write`; no committed shell
script — none tracked; no heredocs, `bun -e` / `node -e` included; this repo keeps `node:` only,
stricter than the workspace's `Bun.*`). Nothing to port. The stale lines the letter named were
corrected: [bun-migration.md](bun-migration.md)'s state line (item 26 is done) and
working-rules.md's `deno.json` / `--config jsr.json` / "still `deno task`s" / `deno task ci`
lines. Still open from the workspace for binaryang: H5 (the provenance note), H6 (the
compatibility gate: `api-surface.ts`), H8 (I5–I8 measurements), H12 (reserve `./ts2wasm` in the
exports plan, no code).

**The workspace rules reviewed (2026-10-22, owner: "yes" to two of the findings):** (1) docs land
in the same commit as their code — adopted, [working-rules.md](working-rules.md) § Git; (2) H6's
SemVer half DONE: `bun run bump [patch|minor|major]`, no cap, each version line matched exactly
once, both texts made before either write, each written through a temp file and a rename
(tooling rule 4); `version_bump.test.ts`, 7 mutants killed; one real `bump minor` run (1.14.0 →
1.15.0 in both files, no temp file left) and restored from a copy. Left with the owner: whether
`scripts/spec-prepare.ts:74`'s default (a local drive path, no user name) may stay committed
under the workspace's no-personal-information rule. Noted for the workspace session (not ours to
edit): its § The gate still calls binaryang's naming check a shell script that always exits 0
(✅ corrected there the same day).

**Workspace letter H18 (personal drive paths) — acted on** (owner: "personal drive paths are not to
be public information"): `scripts/spec-prepare.ts`'s default corpus is the sibling wasmtk checkout
resolved from the script's own location (run with no source: 257 / 257 prepared, the same tree);
a test comment's `file:///D:/…` became `<repo>`; four cmem lines naming this machine's drives
reworded; the workspace scan finds nothing; commit messages carry no path. **Not done — letter
H19, the history purge, waits on the owner:** the old path is in public history from
`cebbb1260`, and every commit's author address is the owner's personal one (no local
`user.email`; the noreply address is needed). H19's hazards for this repo: upstream wabt /
binaryen history with third-party authors (rewrite only the owner's address), 375 branches and
21 tags, released provenance pinned to old hashes, wasmtk's `upstream/binaryang` clone.
✅ **H19 DONE the same day** (owner: "start"; "only public facing items"; "items in the public
facing history should be cleaned in the history"): the public history rewritten — 1,761 commits
and 5 tags, the 11,187 upstream commits untouched — verified, cited hashes remapped, local
`user.email` the noreply address. **Paused 2026-10-22 at the owner's word** ("I need to pause
here for today"), in the middle of "update the project memory files, bump the version then push
to github"; ✅ **COMPLETED 2026-10-23** (owner: "continue with H19", then "yes" to the bump):
the 24 public refs force-pushed with a lease each, no publish triggered ([publishing.md](publishing.md)
§ "The history purge", "Pushed"); CI green; `CHANGELOG.md` § 1.15.0 gated and merged; a fresh
clone 17 / 17; **1.15.0 released** on JSR and npm with provenance ([publishing.md](publishing.md)
§ "1.15.0"). The tag-by-tag hash map: [publishing.md](publishing.md) § "The history purge".
**Every commit hash quoted before 2026-10-22 outside this repo (wasmtk's letters, the workspace) is
now an OLD hash.** Left with the owner, not ours to do: telling wasmtk to re-clone
`upstream/binaryang` (a letter, drafted on request), and a GitHub Support request if the old
commits must stop being served by hash.

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

(Item 29 closed 2026-10-22: binaryang is on npm as `@synapticforge1/binaryang`, JSR staying the
source. Built and proved first (`bun run npm:build` / `npm:prove`, in CI); 1.13.1 published by
hand to create the package, since npm's trusted publisher can only be added to one that exists;
then **1.13.3 by the workflow**, trusted publishing, SLSA provenance read back. The name took two
corrections: the npm scope is the npm org's name, `synapticforge1`, and the GitHub org was renamed
to match. Every step, the owner's settings and what was measured on the way:
[publishing.md](publishing.md) § "npm as a SECOND registry", § "1.13.1", § "1.13.3". Its number is
kept free.)

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
  `4da931fb7` and `29652f51e` name no account, token or secret, and are not worth a force push. Do
  not re-open.
- **JSR and GitHub descriptions on the predecessors — won't do** (owner, 2026-09-02); they are
  frozen.
- **Converging the two IRs further is not a release task.** It is open-ended by decision 1 and
  tracked by `deno task collisions` ([project.md](project.md)).
- **D4 — never yank, ever** ([project.md](project.md)).
- **The predecessors are frozen**: no change to `binaryen-ts` or `wabt-ts` on GitHub or JSR.
