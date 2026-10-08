# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

**State, 2026-10-07:** `binaryang@1.8.1` is the last release; `main` holds a large UNRELEASED set —
the optimizer steps (item 2: 1–5, LocalCSE, ConstantPropagation), `./definitions` (D1 / D2 / D3,
item 22), items 3–8 and 10 closed, six silent fixes ([unreleased.md](unreleased.md): the next
release is a MINOR, 1.9.0) — NOT PUSHED. The owner's order (2026-10-06): finish the open items and
the wasmtk list before publishing — 22 is done (closes with the release and its letter), 24 has its
design decided and waits to be built. Item 2 is PARKED (owner, 2026-10-07: the delta to upstream is
judged after item 23; 3.8% after E2). **Next: item 23** — E1 (the numeric evaluator) and E2
(Precompute) done; E3, the interpreter, done except `v128` (E3a–E3d: numbers, control,
memory, tables, calls, exceptions, GC); `v128` next (owner: "SIMD first"), then E4
(`wasm-ctor-eval`, `wasm-interp`) (see its "Plan" line), then 24, 21, and the rounds 13 / 14, and item 2's remaining steps once
23 is done. **8 open items, none blocking**; numbers 3–7, 9–12, 16, 17 are gone and kept free.
Re-derive any number before quoting it.

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

**None open.** Items 18–20, from wasmtk's § 20, were fixed for 1.8.1 the day they arrived: L3 (a
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

(Item 1 closed 2026-09-30: the walkers visit a `br_if` / `br_table`'s values before its condition.
It was a DEFECT, not only an order: `mapWithSequences` keeps, evaluated, what it mapped before an
operand that becomes a never-falling-through sequence, so StripEH ran a builder-made
`br_if $l (throw $e (i32.const 7)) (call $bump)`'s call before the trap — reachable only from trees
built by the API or a pass; the text reader keeps such a `throw` a statement before the branch. The
"may move `-Oz` bytes" premise was measured: 0 of 13,285 optimizer outputs moved (the corpus and
every prepared spec module, at -O1 … -Oz). The hand-written traversals (`deriveTypes`, `phantoms`,
`cfg`, `non-nullable-locals`) already had wasm's order. `branch_operand_order.test.ts`.)

2. ⬚ **The size gap to upstream at `-Oz` is mostly COVERAGE: 60.3 KB of 109.5 KB**
   ([names.md](names.md) § "Names under optimization, priced", measured 2026-09-19).
   - The missing passes: Inlining (ours runs at `-O3` only), DAE, DuplicateFunctionElimination,
     Precompute, MergeBlocks, SimplifyGlobals.
   - It shows in what survives: we keep 3,943 functions to upstream's 2,663.
   - ~~The cheapest probe is scheduling Inlining at `-O2` / `-Oz`.~~ **Probed 2026-09-30: inlining
     does not pay until the cleanup passes exist.** Corpus totals (421 modules), before → probe:
     - upstream's schedule (`InliningOptimizing` in the post passes at
       `optimizeLevel >= 2 ||
       shrinkLevel >= 2`, `pass.cpp:822`): -Oz 915,103 → **915,970
       (+867)**, -O3 +14 KB;
     - plus a second round of the function passes after it, as upstream's
       `addUsefulPassesAfterInlining` does (`precompute-propagate` + the default function passes):
       -O2 917,483 → 915,587, **-Oz 915,575 (+472)**;
     - that second round WITHOUT inlining: -O2 915,115 (**−2,368**), -Oz unchanged — the -O2 gain is
       the round, not the inlining;
     - plus upstream's one-caller limit (`oneCallerInlineMaxSize = -1`, unlimited; ours is 10): -Oz
       **919,515 (+4.4 KB)** — every inline leaves overhead we cannot remove.
   - **What an inline leaves behind** (one callee, one caller, -Oz: ours 70 bytes, upstream 43):
     parameter COPIES (`local.set 1 (local.get 0)` — upstream's CoalesceLocals coalesces copies,
     ours does not); a CONSTANT parameter not propagated or folded (`5 * 3` → upstream's
     `precompute-propagate` gives 15; we have no Precompute); the `__inlined_func` wrapper block
     with a `br` out of an `if` (upstream's RemoveUnusedBrs / MergeBlocks remove it and make the
     `if` a `select`); an unused type (item 6). **So the order is: those cleanups first, then
     inlining at upstream's schedule and one-caller limit.** The probes were reverted.
   - The steps, owner-agreed 2026-09-30: (1) copy coalescing in CoalesceLocals, (2) MergeBlocks, (3)
     Precompute (+ propagate), (4) Inlining at upstream's schedule and one-caller limit — each
     measured the same way (corpus totals at every level; the behaviour gates).
   - 🔧 **Re-ranked by measurement 2026-09-30, owner-agreed:** each upstream pass run ALONE by
     `wasm-opt -all` on OUR -Oz output (421 modules, after step 1: 908,932 bytes; upstream's
     re-encode with no pass: 901,807). What each would still save: `inlining-optimizing` 46,994 ·
     `dae-optimizing` 25,763 · **re-encoding alone 7,125** · `optimize-instructions` 6,538 ·
     `simplify-locals` 5,007 · `code-folding` 4,551 · `remove-unused-brs` 4,211 · `local-cse` 3,531
     · `simplify-globals-optimizing` 1,537 · `precompute-propagate` 1,517 ·
     `duplicate-function-elimination` 1,306 · `merge-similar-functions` 1,293 · `vacuum`,
     `precompute`, `remove-unused-module-elements`, `coalesce-locals`, `reorder-locals` 351–595 each
     · **`merge-blocks` 12**. (Our -Oz leaves 3,770 NAMED blocks — branch targets — and 181 unnamed;
     ~160 in MergeBlocks' shapes.) So MergeBlocks is dropped from step 2; the order is now: **the
     encoder gap**, then **DAE**, then the cleanups inlining needs (OptimizeInstructions coverage,
     SimplifyLocals, RemoveUnusedBrs, Precompute), then **inlining**. Scratch instrument:
     `passvalue.ts` (not kept; its method is this paragraph).
   - ✅ **Step 2 done 2026-09-30 — "the encoder gap" was not the encoder.** Per section, our -Oz
     bytes vs upstream re-encoding them: import +7,506 was an ARTIFACT (`-all` turns on upstream's
     compact-import form; with `--disable-compact-imports` the sections are identical), DataCount
     −819 likewise (upstream writes it whenever bulk memory is on), and code −9,535 is upstream's
     encoding being LARGER. The one real loss: **type +9,973 — unused types** (item 6). New pass
     `RemoveUnusedTypes` (`passes/remove-unused-types.ts`), last at every -O level: uses found by
     FIELD over the whole module (type `Var`s, heap types, a block's numeric `typeIndex`), closed
     over used types' own references and whole rec groups, then every index renumbered. Corpus: -O1
     −10,324, -O2 −10,324, -O3 −12,515, -Os / -Oz 908,932 → **898,608**; the type section now 17,307
     against upstream's 17,658. `spec-behaviour` 57,808 / 0 DIVERGE, `direct-behaviour`, `proposals`
     (descriptor types) all hold. `remove_unused_types.test.ts`, 6 mutants killed — the block
     `typeIndex` one only by running the pass DIRECTLY: through `PassRunner` a block's written index
     is dropped as form before any pass.
   - 🔧 **Re-ordered 2026-09-30, owner-agreed: the cleanups (step 3), THEN DAE (step 4), then
     inlining.** Measured before writing DAE, on our -Oz output (898,608): upstream's plain `--dae`
     saves 3,745; `--dae-optimizing` 25,763 against the compact-imports re-encode (to 883,550 with
     `--disable-compact-imports`). The difference is upstream's FUNCTION passes re-run on what DAE
     changed — and ours, run on upstream's `--dae` output, collect about 1 KB of it (898,604 →
     897,581; control, our -Oz run twice: 898,608 → 898,604). DAE's value waits on the cleanups:
     OptimizeInstructions coverage, SimplifyLocals, RemoveUnusedBrs, Precompute (`precompute` 556,
     `precompute-propagate` 1,517 on its own). Scratch: `daeprobe.ts` (method is this paragraph).
   - ✅ **Step 3a done 2026-09-30 — OptimizeInstructions coverage.** What upstream's pass still
     changes on our -Oz output, by opcode count (`opdelta.ts` / `hunks.ts`: per-opcode net change,
     then sample diff hunks): `i32.store (wrap_i64 x)` → `i64.store32` (770),
     `extend_i32_u
     (i32.load)` → `i64.load32_u` (770), `if (eqz c)` arm swap (~1,000 eqz),
     added constants gathered (`(x+c1)+c2`, `(0-x)+c`, `((x+1)<<2)+8`); `ge_u` → `le_u` is canonical
     order, 0 bytes. Built those (plus `i64.storeN(extend)`, the store mask, `eqz(eqz)` in a
     condition, `select` swap when both operands are pure, the shorter spelling of `x ± c`). Corpus:
     -O2 902,484 → **892,635 (−9,849)**, -O3 1,112,248 → **1,085,767 (−26,481)**, -Os / -Oz 898,608
     → **888,759 (−9,849)** — more than upstream's pass alone was worth (6,538): the later passes
     find more. -O1 unmoved (no OI there). 🔧 Found reading the pass: `i64.extend8_s` / `extend16_s`
     of a constant folded through `Number(v)`, WRONG above 2^53 — silent, valid output (a mutant
     restoring it is killed). NOT built: `load(add(p, c))` → `offset=c` — the add wraps and the
     offset does not (upstream needs `--low-memory-unused`). `spec-behaviour` 57,808 / 0 DIVERGE,
     `direct-behaviour` 1,953 / 651 agree, gate green; `optimize_instructions_coverage.test.ts` runs
     every case before and after, 13 mutants killed (4 survived the first draft — each an untested
     case, now tested). Next: SimplifyLocals, RemoveUnusedBrs, Precompute, measured the same way.
   - ✅ **Step 3b done 2026-10-06 — SimplifyLocals SINKS, on a shared effect analysis.** Re-ranked
     first on our -Oz output after 3a: `inlining-optimizing` 43,621 · `dae-optimizing` 24,559 ·
     `simplify-locals` 5,007 · `code-folding` 4,542 · `remove-unused-brs` 4,210 · `local-cse` 3,327
     · `precompute-propagate` 1,511 · `optimize-instructions` 1,003 (was 6,538). Upstream's
     simplify-locals by opcode: 8,013 sets became tees, 7,594 gets went. Ours only merged a set with
     an ADJACENT get. New `ir/effects.ts` (upstream's `effects.h` role): shallow / deep effects,
     `invalidates(a, b)`; an unclassified kind conflicts with everything; two traps never swap (the
     trap kind is behaviour). SimplifyLocals rewritten on it: a set's value moves to the first get
     that reads it along straight-line code (cleared at any branch, loop, `if` arm, `try`, and EVERY
     block end — a branch names its target by depth, so an empty label proves nothing), the get
     becoming the value when it is the only read, else a tee. Corpus: -O2 892,635 → **878,476
     (−14,159)**, -O3 1,085,767 → **1,065,080 (−20,687)**, -Os / -Oz 888,759 → **874,595
     (−14,164)**. 🔧 The fuzzer (`optimize_fuzz.test.ts`, seed 128) caught two miscompiles in the
     first draft, both now named tests: a `local.get` did not invalidate a pending value that WRITES
     its local (a tee inside it), and a value that another set was sunk into did not carry that
     set's effects. Found measuring: globals reach the passes by NAME (667 / 667), so per-index
     global tracking was dead — keys are now the reference as written, and an index and a name are
     never proved apart. Upstream's `if` / block result values from sets in arms are not done.
     `spec-behaviour` 57,808 / 0 DIVERGE, `direct-behaviour` 1,953 / 651 agree, gate green, fuzz
     5,000 more seeds clean; `simplify_locals_sink.test.ts`, 14 of 15 mutants killed — the survivor,
     "a branch does not clear", is redundant with the effect rule (every sinkable writes its local)
     and kept as its statement. Next: RemoveUnusedBrs, Precompute.
   - ✅ **Step 3c done 2026-10-06 — RemoveUnusedBrs, the counted shapes.** Upstream's
     remove-unused-brs on our output after 3b: 4,174 (upstream's simplify-locals is now −1,992
     there: ours does better). Most of it restructures loops; the shapes counted in our -Oz output
     (`brshapes.ts`): a `return` ending the body 494, a cheap `if` with a result 468,
     `if
     (c) br` 29. Built: the tail `return` → its value (not past values left on the stack),
     a cheap `if` → `select` (numeric result, each arm one constant / read, and the condition writes
     nothing they read — `ir/effects.ts`), `if (c) br $l` → `br_if $l c` (not to the `if` itself).
     Corpus: -O2 878,476 → **876,375 (−2,101)**, -O3 1,065,080 → **1,062,111 (−2,969)**, -Os / -Oz
     874,595 → **872,500 (−2,095)**. 🔧 The first draft removed a tail `return` that also DISCARDS
     values left on the stack (spec `unwind.wast`:
     `(i32.const 3)
     (i64.const 1) (return (i32.const 9))`) — INVALID output, caught by
     `spec-behaviour` and `proposals`, not by the fuzzer (its generator builds no stack residue).
     Not built: upstream's loop restructuring. Gate green, fuzz 3,000 more seeds clean;
     `remove_unused_brs_3c.test.ts`, 9 mutants killed — the `br_if` type one only by asserting the
     IR (nothing reads a valueless `br_if`'s stored type today; DCE asks the structure). Next:
     Precompute.
   - 🔧 **Re-ordered again 2026-10-06, owner-agreed:** Precompute (now 1,134 on our output) is
     FOLDED INTO item 23 — built on the one evaluator item 23 plans, not separately. Measured after
     3c (872,500): our whole -Oz run TWICE saves 2,764 (the pipeline was not at a fixed point);
     upstream's plain `--dae` then our pipeline 869,736 → 867,076 (was ~1 KB before the cleanups),
     upstream's `dae-optimizing` 863,788. So: **4a** the re-runs, **4b** DAE, then inlining.
   - ✅ **Step 4a done 2026-10-06 — the schedule re-runs what later passes expose** (`schedule.ts`:
     candidate schedules, corpus totals). All of the twice-run gain is ONE pass: CoalesceLocals
     again after SimplifyLocals / LocalCSE (the reads and writes sinking removed leave locals to
     merge): −2,900, more than running everything twice; moving it instead of repeating keeps only
     −2,348. And SimplifyLocals after Inlining at -O3 (an inlined call leaves its arguments copied
     into locals): −8,097 of -O3's −8,309 (−212 without it). Corpus: -O2 876,375 → **873,471
     (−2,904)**, -O3 1,062,111 → **1,053,802 (−8,309)**, -Os / -Oz 872,500 → **869,600 (−2,900)**.
     Gate green; `pipeline_schedule.test.ts` asserts each re-run against the schedule without it and
     runs the output — removing either fails it. Next: **4b DAE**.
   - ✅ **Step 4b done 2026-10-06 — DeadArgumentElimination**
     (`passes/dead-argument-elimination.ts`, new). For a function reached ONLY by direct `call` /
     `return_call` (not exported, never a `ref.func` operand in code, globals or element segments,
     not imported): a parameter nothing reads goes when every call passes it an effect-free value;
     one every call passes the SAME constant (bit for bit — a float by its bits) becomes a local set
     to it on entry. Decided on the tree as read, then every call pruned by node IDENTITY before any
     rebuild, then each function's locals renumbered and its type interned with the writer's own
     interner (`makeTypeInterner`, so RemoveUnusedTypes sees the right use). Placement measured
     (`schedule2.ts`): before the function passes −5,315, after them plus a cleanup re-run
     (upstream's `dae-optimizing` placement) −5,411, both −5,559 — taken: before, one pass. Corpus:
     -O2 873,471 → **868,216 (−5,255)**, -O3 1,053,802 → **1,046,251 (−7,551)**, -Os / -Oz 869,600 →
     **864,285 (−5,315)** — upstream's `dae-optimizing` reached 863,788 from 872,500. Spec -O3 +246
     on `call.0` / `return_call.0` (Inlining takes the smaller functions; -O3 trades size for
     speed). Not done: removing a result every caller drops; moving an operand with effects out of
     the call. Gate green; `dead_argument_elimination.test.ts`, 12 mutants killed (a test asserting
     the start function's signature was dropped as vacuous — a start function has no parameters, and
     the check with it). Next: **inlining** at upstream's schedule.
   - ✅ **Step 5 done 2026-10-06 — Inlining at upstream's rules and schedule.** `isInlineable` is
     upstream's `worthFullInlining`: size ≤ 2 always; ONE caller at any size (upstream's
     `oneCallerInlineMaxSize = -1`; ours was 10 — `--pass-arg one-caller-inline-max-size@N` limits
     it); several callers only at -O3 without shrinking, and only a leaf without loops. 🔧 That last
     rule was `!hasCalls || !hasLoops` (upstream refuses EITHER): -O3 inlined far too much. The
     schedule (`schedule3.ts` measured placements): at -O2 and above the function passes, then
     Inlining, then the function passes AGAIN and a Vacuum (upstream's
     `addUsefulPassesAfterInlining`; without the trailing Vacuum -O2 GREW 8.4 KB — the round's later
     passes leave what its early Vacuum already passed). The same probe on 2026-09-30 grew -Oz by
     0.5–4.4 KB; the cleanups since make it pay. Corpus: -O2 868,216 → **859,534 (−8,682)**, -O3
     1,046,251 → **865,688 (−180,563, −17%)**, -Os / -Oz 864,285 → **859,534 (−4,751)**; spec -O3
     −18.5 KB. Upstream's `inlining-optimizing` now saves 918 on our output (was 33.7 KB),
     `dae-optimizing` 635. 🔧 Found by `translate-eh` (spec legacy `try_catch.wast` /
     `try_delegate.wast`): a `return_call` inside a `try` was inlined — the callee's throw, which a
     tail call takes PAST the `try`, was caught — at -O3 before this step too. In a function with
     any `try`, no `return_call` is inlined now. Gate green, fuzz 3,000 more seeds clean;
     `inlining_schedule.test.ts`, 8 mutants killed; `inlining.test.ts`'s size-limit test given a
     second caller (its premise was the old cap).
   - ✅ **Done when (owner, 2026-10-06): our corpus -Oz is within 2% of upstream `wasm-opt -Oz`** on
     the same original modules (`gap.ts`) — about 16 KB at today's 816,485. Not "match upstream".
   - 📏 **Where it stood at the end of 2026-10-06** (superseded by "Resume here (2026-10-07)"
     below). After LocalCSE the gap is **40,069 (4.9%)**: ours 856,554, upstream 816,485 (`gap.ts`);
     the target (≤ 2%) is ~16.3 KB, so ~24 KB to find. WHERE it is (`gapdetail.ts`, ours − upstream
     on the original modules): code +43,166 (upstream also keeps 6,499 of custom sections we drop,
     and a DataCount); by opcode we have +6,906 `local.get`, +4,163 `local.set`, +1,260 local decls,
     +4,234 `block`, +2,634 `br_if`, −1,706 `if`. WHAT closes it — each upstream pass applied to our
     -Oz output, then OUR -Oz again (`enable.ts`; control: ours run twice = 856,248):
     `precompute-propagate` **−11,135**, `precompute` (fold only) −3,392 — so constant PROPAGATION
     through locals is ~7.7 KB of it; `remove-unused-brs` −5,014 (its `block`+`br_if` → `if`
     restructuring is the block / br_if / if delta above); `code-folding` −5,442; all three −17,889
     (→ ~2.7%). Example (`sidebyside.ts`, `10b_DynamicArrays.wat` $7):
     `(local.set $12 (local.tee $15 (i32.const 132)))` — $15 is 132 for the whole function; upstream
     writes `i32.const 132` at every read and folds `x - 132 + 8` to `x - 124`. ⚠️ **Question for
     the owner before building it:** constant PROPAGATION (a reaching-definitions pass: a
     `local.get` whose only reaching set is a constant becomes the constant; folding stays
     OptimizeInstructions') is not EVALUATION — may it go in item 2 now, while Precompute proper
     (evaluation) stays in item 23 as decided? Then RemoveUnusedBrs' block / br_if → if, then
     CodeFolding. ✅ **Answered 2026-10-06, owner: "Yes. Constant propagation may go into item 2
     now."** Precompute proper (evaluation) stays in item 23. So item 2 resumes with: constant
     propagation, then RemoveUnusedBrs' block / br_if → if, then CodeFolding — each measured and
     gated as before.
   - ✅ **Constant propagation built, 2026-10-07** (`ConstantPropagation`,
     `constant-propagation.ts`, on `cfg.ts`; after OptimizeInstructions, then OptimizeInstructions
     again). Corpus -Oz 856,554 → **854,227 (−2,327)**, -O2 −2,339, -O3 −3,393, -O1 unchanged. Gate
     green (fresh spec corpus); `constant_propagation.test.ts` RUNS every leave-alone case on each
     path, 6 mutants killed (one — no re-flow — survived the first test set: every loop read sat in
     the loop head). Placed twice: −40 more; iterated with OI: −87 more — not taken. Functions kept
     2,705 → 2,711 (inlining moved). ⚠️ **The 2026-10-06 estimate "propagation ~7.7 KB" was WRONG**
     (precompute-propagate −11,135 minus precompute −3,392 assumed the two add up; they do not).
     Re-measured on the new output (scratch `ppleft.ts`): upstream `precompute-propagate` still
     saves **9,493**, and what it does is EVALUATION — `f64.sqrt 9` → 3, `select` on a constant
     condition, `f64.eq 10 0` → the branch gone (`7a_MathIntrinsics`) — item 23's, by the owner's
     decision.
   - 📏 **Resume here (2026-10-07).** Gap **37,742 (4.6%)**: ours 854,227, upstream 816,485
     (`gap.ts`); ≤ 2% is ~16.3 KB, so **~21.4 KB to find**. Next, as decided: RemoveUnusedBrs —
     upstream's `remove-unused-brs` saves **5,137** on our output now (`ppleft.ts`; 886 of it
     `1_fib-rs`); the shapes seen: `(block $b (br_if $b c) rest…)` →
     `(if (i32.eqz c) (then rest…))`, and `br_table` targets trimmed by subtracting from the index.
     Then CodeFolding (−5,442 on 2026-10-06's output). ⚠️ **For the owner, before the end of item
     2:** RemoveUnusedBrs and CodeFolding together look like ~10.5 KB of the 21.4 KB — the gap would
     sit near 3.3%, not ≤ 2%, while ~9.5 KB of what remains is evaluation, which is item 23's.
     Either item 2's target counts evaluation as out of scope (≤ 2% measured without it), or
     Precompute moves forward, or more passes are found (`enable.ts` over the rest of upstream's
     list). Not decided; measure after the two steps. ✅ **Owner, 2026-10-07: "Lets worry about the
     delta with upstream after item 23 is done. For now move on to the next item."** Item 2 is
     PARKED at 4.6% — RemoveUnusedBrs and CodeFolding wait; the gap is re-measured once item 23
     (with Precompute) is done, and the target judged then.
   - 📏 **Where item 2 stands, 2026-10-06:** upstream `wasm-opt -Oz` on each ORIGINAL corpus module
     totals 816,485; ours 859,534 — **the gap is 43,049 (5.0%)**, from 109.5 KB on 2026-09-19.
     Functions kept: ours 2,705, upstream 2,663 (was 3,943). No single upstream pass saves more than
     3.6 KB on our output (`code-folding` 3,573, `local-cse` 3,549); upstream's whole -Oz on our
     output still saves 55,449 — the rest is passes in combination. Scratch: `gap.ts`. 2026-09-30:**
     a copy does not make its two locals interfere, a variable may take a PARAM's slot (the search
     started past the params), a copy partner's slot is tried first, and a copy onto its own slot is
     removed. Corpus: -O2 917,483 → **912,808 (−4,675)**, -O3 1,147,462 → **1,124,763 (−22,699)**,
     -Os / -Oz 915,103 → **908,932 (−6,171)**; the one-inline example 70 → 66 bytes.
     `spec-behaviour` 57,808 / 0 DIVERGE, `direct-behaviour` 1953 / 651 agree.
     `coalesce_copies.test.ts` — 5 mutants killed, the over-merge one by the three tests that RUN a
     module where a copy's source or copy is later overwritten. (Items 3–5, LocalCSE, closed
     2026-10-06 by REWRITING the pass on `ir/effects.ts`, in SimplifyLocals' straight-line walk.
     Upstream's `local-cse` still found 3,549 on our -Oz output: repeated `i32.shl` index arithmetic
     (×1,142), `memory.size`, loads, trapping conversions, `select` — all outside the old pass's
     ALLOW-LIST (item 3) and its one-block scope; its hand-kept invalidation list had drifted four
     times (`fib`, `itoa`, `call_ref`, `monthFromDays`). Now: any expression with no effect beyond
     reads and a trap is keyed structurally (a trap is no obstacle: the first evaluation traps or
     neither does); invalidated by what writes what it reads (`writesWhatItReads`, new in
     `effects.ts`); cleared at loop starts, `if` arms, block ends, `try` bodies and handlers;
     reference values never (which also keeps out allocations). A multi-value `return` is no longer
     opaque (item 5): its values are walked like any operands. Item 4 (the tee never cleaned) was
     closed by step 4a's CoalesceLocals after LocalCSE — re-checked: the repeated `i32.mul` example
     is 57 → 44 bytes, the tee in a param slot. Corpus: -O2 −3,124, -O3 −3,200, -Os / -Oz 859,534 →
     **856,554 (−2,980)**; spec -Oz −1,057. Gate green, fuzz 4,000 more seeds clean;
     `local_cse_effects.test.ts`, 7 mutants killed — an eighth, the allocation exclusion, was
     REDUNDANT with the reference-type rule and was removed, its `ref.eq` test kept for the day
     reference values become candidates.)

(Item 6, unused types, closed 2026-09-30 as item 2's step 2 — below.)

(Item 7, node literals, closed 2026-10-06: the 8 left — local-cse 1, optimize-instructions 2,
inlining 5 — use their factories; every literal's type had matched its factory's, and all 13,285
optimizer outputs stayed byte-identical. `tests/binaryen-ts/ir/no_node_literals.test.ts` now fails
on any new one outside `ir/expressions.ts` — inverted once.)

(Item 8, Asyncify and `call_ref`, closed 2026-10-06: `call_ref` is instrumented as an INDIRECT call,
as upstream treats it — in the call-graph scan (it seeds its function as state-changing, so callers
propagate), `exprCanChangeState`, `doesCall` and `callChangesState`; the CFG already counted it as a
call point. `return_call_ref` stays refused, as the other tail calls are. `asyncify_e2e.test.ts`
runs a suspend inside a function reached by `call_ref`, through a caller, with a run COUNTER — an
uninstrumented function re-runs its prologue on rewind and the count shows it: the scan's seed
survived two drafts of the test that had no side effect before the call. 5 mutants killed.)

(Item 9, inexact allocations, closed 2026-09-29: it was NOT "valid either way" — `--flatten` made
invalid modules from it. Q13 in [divergences.md](divergences.md).)

(Item 10, S7's read-back, closed 2026-10-06. Its premise — "one front end, so predict from the
module in hand" — was MEASURED first and was false: the parser's and the reader's trees of the same
bytes still differed in 17 of 5,439 valid modules (the corpus, and every prepared spec module
printed linear and folded; scratch `s7probe.ts`). Three parser shapes, each fixed, so they now agree
on 5,437 of 5,437: 🔧 a folded instruction short of operands padded the missing ones at the END —
`(i32.const 10) (nop) (select (i32.const 20) (local.get 0))` built select(20, cond, pop): **a
miscompile on the direct path** (text tree → passes), 20 where wat2wasm's module gives 10 at -O2; 🔧
`throw` drained the stack instead of taking its tag's params (an imported tag's too); 🔧 a folded
multi-result child lost its earlier results' `pop`s, shifting a sibling into the wrong slot (a tree
difference only: the direct path's result was right). Then the writer predicts from the module in
hand: `wat2wasm` over the corpus 1,546 → 1,362 ms (−12%; the item's 26–35% was an older measure),
bytes identical. An INVALID module (validation off) may still predict differently; its hash then
mismatches and the reader prints that function as predicted — plainly, never wrongly.
`tests/wabt-ts/parser/tree_matches_reader.test.ts`, 4 mutants killed.)

23. ⬚ 🗓️ **An interpreter, and `wasm-ctor-eval` on it — AFTER the optimizer steps** (owner,
    2026-09-30: "yes add as open item after the optimizer steps … the wasm-ctor-eval then the -Oz
    seems to be the right path"). The owner's question: could an interpreter precompute DATA OBJECTS
    — memory, globals, what a program builds at start — as part of optimization? Yes; that is
    upstream's `wasm-ctor-eval`: run an entry point at build time up to the first host call, then
    write memory into data segments, globals into their initializers, and what is left back as the
    body. wabt-ts has NO interpreter today (upstream wabt's `wasm-interp` was never ported).
    - **Priced 2026-09-30** on our -Oz output (421 modules, 419 export `_start` — WASI commands,
      `proc_exit` / `fd_write`), with upstream's tool
      (`--ctors=_start --kept-exports=_start
      --ignore-external-input`): ours 898,608 →
      ctor-eval **843,920** (366 changed, 80 grew, 2 refused); upstream `-Oz` on ours without it
      **810,895**, with it first **758,362** — worth **52.5 KB on top of full optimization**, more
      than inlining. Scratch: `ctoreval.ts`.
    - **Shape:** ONE evaluator shared by a Precompute pass, the ctor-eval tool and a `wasm-interp`
      CLI; the spec testsuite's `assert_return` / `assert_trap` its tests, V8 a second oracle. A
      wrong evaluator is a SILENT miscompile (valid module, wrong result), so the behaviour gates
      apply as to any pass.
    - **Rules:** stop at any host call and anything non-deterministic; never fold a trap away.
      **Opt-in, never part of `-O`** — upstream keeps it a separate tool, and
      `--ignore-external-input` assumes empty args / environment (2 corpus modules read their
      environment): an explicit caller decision.
    - **Owner, 2026-09-30:** "maybe wasm-ctor-eval is the better tool … but maybe a combination of
      wasm-ctor-eval and wasm-interp could be ideal also. we will need to measure and see." Which
      combination is an open question to MEASURE, not a decided shape.
    - **Precompute joins this item** (owner-agreed 2026-10-06, item 2): `precompute-propagate` was
      worth 1,134 on our -Oz output after step 3c — built on this item's evaluator, so constant
      folding has one semantics, not two.
    - 🗺️ **Plan (2026-10-07, started on the owner's "move on to the next item").** Each stage gated
      and merged on its own:
      - **E1 — the evaluator's numeric core**: every scalar unary / binary / compare / conversion on
        `Literal`s, exact (float BITS, NaN payloads as the spec allows, a trap as a RESULT, never a
        throw). Oracle: V8, differentially, per opcode over edge and random operands. OI's
        `_foldBinary` / `_foldUnary` then call it — one semantics. `v128` later, recorded as a
        limit. ✅ **Done 2026-10-07** (`interp/numeric.ts`; `numeric_differential.test.ts`, all 136
        scalar instructions D1 lists, coverage asserted; `fold_through_evaluator.test.ts`). The V8
        differential found one defect first run: `f64.ceil` / `floor` returned a signalling NaN
        unchanged — results that are NaN are now written canonical explicitly. 14 / 15 mutants
        killed (the survivor is equivalent: JS masks shift counts). OI now folds every scalar
        operator — never a trap; a NaN only from a bit-exact operator (`isBitExact`). Corpus -Oz
        854,227 → **851,764 (−2,463)**, -O3 −4,409. Gate green. **LIMIT: `v128` operators are not
        evaluated** (`null`); E2 / E3 must treat them as unknown.
      - **E2 — Precompute** on it: an expression of constants with no other effect becomes its
        value; a trap is never folded away; a constant condition picks its arm. In -O, as upstream.
        Measured on the corpus; item 2's gap re-measured. ✅ **Done 2026-10-07** (`precompute.ts`;
        the fold rule is now ONE function, `foldedLiteral`, shared with OI). Scheduled
        ConstantPropagation, Precompute, ConstantPropagation, Precompute (one round −3,862, two
        −4,435; DCE right after it: −66 more, not taken). Corpus -Oz 851,764 → **847,329**, -O3
        854,686 → 848,683. `precompute.test.ts`, 9 / 9 mutants killed. Gate green. Item 2's gap
        re-derived: **30,844 (3.8%)** (ours 847,329, upstream 816,485; functions 2,706 / 2,663) —
        judged when item 23 is done (owner).
      - **E3 — the interpreter**: bodies, locals, control, memory, globals, tables, calls; a host
        call or anything non-deterministic STOPS it. Oracles: the spec testsuite's `assert_return` /
        `assert_trap`, and V8. In increments (owner, 2026-10-07: "proceed"): E3a numbers, locals,
        control; E3b memory, globals; E3c tables, calls; E3d exceptions, GC.
        - ✅ **E3a done 2026-10-07** (`interp/interpreter.ts`, a stack machine over the tree: a
          `pop` is nothing, a branch carries the top values its TARGET takes — so the reader's stack
          shapes run as they are; `Trap` vs `Stop`, never confused). Harness
          `scripts/check-interp.ts`, `deno task interp <prepared spec dir>` — the MANIFEST is the
          oracle: **15,432 pass, 0 FAIL, 42,144 stopped** (by reason: 23,508 v128 arguments, 10,618
          `load`, 4,992 `call_indirect`, 765 `store`, …; 50 modules not set up); ~2 s; 50 M fuel per
          invocation (clean at 5 M). First run found 2 defects: the exhaustion check overflowed in
          its own regex (`fac-rec`); an imported mutable global was copied, not shared (`linking`
          `Mg.mut_glob`). `interpreter.test.ts` against V8; 11 / 11 mutants (one only after a test
          with a value BELOW a block's parameters — the whole spec suite missed it). ⚠️ **For the
          owner: should `deno task interp` join the gate?** Green in today's gate runs as a proposed
          step; the rule is a FAIL count of 0, and the stopped count should only fall. ✅ **Owner,
          2026-10-07: "yes on deno task interp"** — in the gate
          ([working-rules.md](working-rules.md) § "The gate").
        - ✅ **E3b done 2026-10-07** (`interp/memory.ts`: a shared `MemoryCell`, bounds-checked,
          floats as bits; `memory.grow` −1 where the spec allows, a STOP past 1 GiB). Loads /
          stores, `memory.*`, data segments (in order, an OOB one trapping after the ones before it,
          active ones dropped), imported / exported memories. `deno task interp`: **25,811 pass, 0
          FAIL, 31,819 stopped** (23,508 v128 arguments, 5,592 active element segment — a module
          with one now STOPS at instantiation until E3c, it was set up as if its tables were empty —
          932 `call_indirect`, …). The harness checks `assert_uninstantiable`, fails a plain module
          whose instantiation traps, and marks instances a STOPPED importer may have left short of
          the spec's state as stopped (`linking.wast`). 13 / 13 non-equivalent mutants (one after a
          test was added); `copyWithin` vs `set` was equivalent — `set` alone now.
        - ✅ **E3c done 2026-10-07** (`interp/table.ts`: a shared `TableCell`, grow −1 where the
          spec allows, a STOP past 10 M elements). References are values — one null, a function
          reference that runs in its OWN instance, an extern host value. Runs `ref.*`, `table.*`,
          `elem.drop`, element segments (same order rules as data), imported / exported tables,
          `call_indirect` (undefined element → `uninitialized element N` → type mismatch),
          `call_ref`, and TAIL calls (the frame is replaced: 10^6 deep under a depth limit of 100).
          `deno task interp`: **32,618 pass, 0 FAIL, 25,012 stopped** (21,868 of them v128
          arguments; 2,601 tainted — below). Harness rule made general: an invocation that STOPS
          part way taints every instance sharing state with it (`ref_eq.wast`'s `init` action
          stopped on `struct.new`, and the `eq` assertions after it compared nulls); a bare action
          that traps is a FAIL. 15 / 15 mutants (one by the spec suite alone until the unit test
          read the table slot where the two copies differ). Gate green.
          ⚠️ **Deferred to E3d, as a STOP:** a `call_indirect` in a module with a rec group or
          explicit subtyping, or with typed references — types then match by IDENTITY
          (`type-rec.wast`, `type-subtyping.wast`), which structural `sigEquals` cannot decide.
        - E3d split in two (2026-10-07): **E3d-1 exceptions**, then **E3d-2 GC**.
        - ✅ **E3d-1 done 2026-10-07.** Tags are identity cells (an imported tag IS the
          exporter's); a `WasmException` is never a `Trap` (no `catch_all` catches a trap).
          `throw`, `throw_ref`, `try_table` (first matching clause), legacy `try` / `catch` /
          `rethrow` (innermost by label — matters under recursion) / `delegate` (a `try` with the
          label handles it, any other construct passes it outward, the frame lets it leave).
          `deno task interp`: core **32,687 pass, 0 FAIL, 24,961 stopped**; the LEGACY suite
          (`testsuite-main/legacy`, its own `spec:prepare` corpus) **70 / 70, 0 stopped**. 11
          mutants: 10 killed (one only after a recursion test was added; clause order killed by the
          core corpus alone, `delegate` by the legacy corpus alone), 1 equivalent and removed. Gate
          green (with the legacy corpus run as a proposed step).
          ⚠️ **For the owner: should the gate run `deno task interp` on the legacy corpus too?**
          Today it does not, and it is the only thing that killed the `delegate` mutant. It would
          need `spec:prepare <testsuite-main>/legacy <dir>` beside the core corpus.
        - ✅ **E3d-2 done 2026-10-07** (`interp/types.ts`: iso-recursive canonicalisation — a rec
          group keyed by its structure, in-group references relative, earlier ones by THEIR keys,
          interned process-wide, so identical groups in two modules are one `RttType` and identity
          is `===`; a singleton group IS the bare type). Structs, arrays (packed `i8` / `i16`),
          `i31`, `ref.test` / `ref.cast` / `br_on_*`, the extern ↔ any round trip; `call_indirect`
          by canonical subtyping (E3c's Stop gone). A reference to an IMPORTED function is the
          function itself, with the exporter's type (it was minted with the importer's declared
          type — found by the custom-descriptors corpus). Descriptor operations and exact function
          imports STOP (they ran as plain ones: 85 FAILs in that corpus first). `deno task interp`:
          core **33,268 pass, 0 FAIL, 24,380 stopped** (21,868 v128 arguments); legacy 70 / 70;
          proposals, NOT in the gate: custom-descriptors 170 / 0 FAIL, custom-page-sizes 31 / 0,
          threads 80 / 0 (shared memory stops), wide-arithmetic 0 run (stops). 15 / 15 GC mutants
          (exact only after an interpreter-only test) plus the imported-identity one. Gate green,
          with the legacy and four proposal corpora run as proposed steps.
          ⚠️ **For the owner, widening the earlier question:** should the gate's `interp` step
          also run the legacy-EH corpus and the four `proposals/` corpora the `proposals` step
          already prepares? The custom-descriptors corpus is what found both of E3d-2's defects.
          ✅ **Owner, 2026-10-07: "Yes (runs everywhere)."** One `interp` run takes all six
          corpora ([working-rules.md](working-rules.md) § "The gate"); CI cannot run it (it needs
          the testsuite and `wast2json`), as with `spec`.
        - **E3 is complete except `v128`** — every SIMD operator still stops (E1's limit), and that
          is most of what `stopped` counts. Owner's choice whether it comes before E4.
          ✅ **Owner, 2026-10-07: "SIMD first."**
        - 📏 **Resume here: E3e — `v128`** (the evaluator's SIMD core, then the interpreter's SIMD
          loads / stores / lanes / shuffles), V8 as the per-operator oracle as for E1; then E4.
        - Then **E4 — `wasm-ctor-eval` and `wasm-interp` on the interpreter**, and the owner's
          question (which combination) MEASURED.
      - **E4 — `wasm-ctor-eval` and `wasm-interp`** on it, opt-in; then the owner's question — which
        combination — MEASURED.

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
| **1.5.6** | hardening → then code again                 | 13. ⬚ not started                                                                        |
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

15. ⬚ **A2 — `wasm2ts` is a stub that throws.** The long-term goal is WASI Preview 1 capable
    TypeScript output. **Blocked, and not close:** as of 2026-09-02 the wasmtk side had a long way
    to go before there is anything to implement against.
21. ⬚ 🗓️ **Merge `src/binaryen-ts/` and `src/wabt-ts/` into `src/` — SCOPE after the IR work**
    (owner, 2026-09-30: "It looks like we can now phase a merge of the binaryen-ts and wabt-ts
    folders into the src folder … I would like to scope that after our IR work is completed"). Facts
    measured that day, for the scoping:
    - **There is ONE IR already**: `Expression = Expr`, `WasmModule = W.Module`,
      `WasmFunction =
      W.Func` (binaryen-ts `ir/` aliases wabt-ts `ir/ir.ts`). The trees are
      LAYERS, not two IRs: 30 binaryen-ts files import wabt-ts, 0 the other way (wabt-ts 52 files /
      37k lines — IR, reader, writer, validator, text tools; binaryen-ts 43 / 19k — passes, compat,
      `wasm-opt`).
    - **Decision 1** ([project.md](project.md)) says "Two IRs are retained … not a merge task" — its
      premise no longer describes the code; the merge re-decides it.
    - `deno task collisions` = **86** names declared in both trees — the aliases; one tree needs one
      name each, and the indicator itself (it counts per tree) retires with the merge.
    - PUBLIC subpaths name the trees: `./ir/binaryen-ts`, `./ir/wabt-ts`, `./core/wabt-ts` — moving
      files keeps them working (they map to paths), renaming them is BREAKING.
    - Mirrors to move with it: `tests/binaryen-ts|wabt-ts|ir`, `scripts/binaryen-ts|wabt-ts`
      (workspace members with their own `deno.json`), and cmem's path citations (retargeting is part
      of the move — working-rules.md).
    - 🗓️ **Agreed with the owner, 2026-09-30** — worth doing, for simpler optimization, bug finding,
      hardening and security work: one name and one place per concept, one layout for the lens
      rounds to audit. The shape agreed:
      - **Mostly NOT breaking.** Consumers import SUBPATHS, a map in `deno.json`; moving files
        behind them breaks no one (wasmtk uses `compat/wabt`, `compat/binaryen`, `wasm-validate`).
        Only the three tree-named subpaths raise it: keep them as deprecated aliases for a release
        beside new names, remove them in a later MINOR.
      - **Phased:** (1) move files into one tree by concept (`ir/`, `reader/`, `writer/`,
        `validator/`, `passes/`, `tools/`, `compat/`), every subpath kept — the gate green and
        output bytes IDENTICAL; (2) collapse the aliases into single names; (3) remove logic that
        exists twice; (4) then decide the three tree-named subpaths.
      - **Timing:** after the IR work (owner) and BEFORE the hardening and security rounds (items
        13, 14), so those audit the final structure once.
22. ⬚ **H9 — publish the shared definitions D2 / D3 / D1 as a `./definitions` subpath** (placed on
    the list by the owner 2026-09-30, from wasmtk's letter [§ 23](handoffs.md); the design is the
    workspace's `../cmem/divergences.md` § "The shared definitions", letter H9 in
    `../cmem/handoffs.md`). wasmtk is ready to start H10 (generating their copies) as soon as there
    is a version to pin. What they asked, narrowed to their use:
    - **Order: D2 and D3 first, D1 later.** Their runner uses D2 / D3 today; D1 matters to them only
      when their WAT regexes give way to our parser (I2, after one-front-end stage 5). ⚠️ This
      REVERSES the workspace plan (D1 first, proved by regenerating our own opcode table; D3 last,
      after C1). ✅ **Decided 2026-10-06, owner: "I approve the wasmtk order for definitions"** — D2
      and D3 first, D1 later. (The workspace's `../cmem/divergences.md` still reads D1-first; the
      workspace session updates it, not this one.)
    - **Delivery:** a `./definitions` subpath in a normal release (a new export = MINOR), pinned at
      the same exact version as their other three. A TS module of typed constants, and/or the JSON
      sources in the package at a stable path (for the Rust / Zig consumers). **The content hash and
      the version IN the data**, so their generated copy's header quotes them and their gate proves
      the copy matches.
    - **D2, per feature:** the canonical name (the one `allFeatures()` / `Features` uses); the
      spec-testsuite directories it gates, relative to the testsuite root; whether it CHANGES core
      semantics, not only adds (why they scope `custom-descriptors`: on everywhere it relaxes
      `br_on_cast`, and core `br_on_cast.wast` / `br_on_cast_fail.wast` lose 3 `assert_invalid` each
      — possibly the same fact as D2's "snapshots that must NOT receive it" column); the date it
      entered the list. Engine flag spellings stay theirs, keyed by our name.
    - **D3, per verdict class:** for traps a class key and the testsuite's exact `assert_trap`
      message, with the PREFIX rule stated (`"uninitialized element 2"` matches
      `"uninitialized
      element"`); the same for `assert_invalid` / `assert_malformed` later;
      nothing engine-specific. Entries they filed now (H10 asks for it): `unreachable`,
      `out of bounds memory access`, `out
      of bounds table access`,
      `out of bounds array access`, `undefined element`, `uninitialized
      element`,
      `indirect call type mismatch`, `integer divide by zero`, `integer overflow`,
      `invalid conversion to integer`, `cast failure`, `descriptor cast failure`, `null reference`,
      `null structure reference`, `null array reference`, `null i31 reference`,
      `null function
      reference`, `null descriptor reference`, `unaligned atomic`;
      `call stack exhausted` for `assert_exhaustion`. Proposals their gate treats specially:
      `wide-arithmetic` (every file), `custom-descriptors` (scoped), `custom-page-sizes` (through
      `LowerCustomPageSizes`).
    - **D1, later:** mnemonic and legal shorthands, immediate syntax (`offset=` / `align=`), stack
      signature, gating feature; a coarse operator class ("numeric binary") would let them DERIVE
      their 13 never-a-pointer `i32` operators — that judgment stays theirs.
    - Their side (H10), for reference: `scripts/gen-definitions.ts` → committed
      `src/definitions.generated.ts`; their gate regenerates and diffs, inverted once.
    - ✅ **D2 and D3 built 2026-10-06 (unreleased; D1 is what is left of this item).** Sources
      `src/definitions/features.json` (D2: 22 entries — `name` = the `Features` key, `cli`,
      `defaultOn`, `implemented`, `testsuiteDirs`, `onlyIn` / `offIn` for a feature that changes
      core semantics, `note`, `since`) and `verdicts.json` (D3: 19 trap classes +
      `call stack
      exhausted`, `key` / `message`, the PREFIX rule stated in the data). Each
      carries `dataVersion` and a `sha256` of its canonical content (keys sorted, the hash field
      empty). `deno task
      definitions` stamps the hashes and GENERATES
      `src/definitions/data.ts`; `--check` changes nothing and fails on a stale hash or a generated
      module that differs; `--prepared <roots>` also proves D3 has a class for every trap /
      exhaustion message the prepared suites write (21 distinct across core, the four proposals and
      legacy EH — inverted once: dropping `unaligned-atomic` trips all three checks). Subpath
      `./definitions` (`mod.ts`: `FEATURE_DEFINITIONS`, `VERDICT_DEFINITIONS`, `verdictClass(text)`,
      `featuresForSuite(dir)`) — a new export, so the release is a MINOR; the JSON ships in the
      package. binaryang is the first consumer: `scripts/proposals.ts`, the core spec harness and
      `measure-diagnostics.ts` take their feature sets from D2 (`suiteFeatures`), with `spec` and
      `proposals` green on it (custom-descriptors is now off in `threads` / `wide-arithmetic` /
      `custom-page-sizes` too, per its `onlyIn`; none of those suites tests `br_on_cast`).
      `tests/definitions/` asserts the data against the code: one entry per `Features` key in order,
      `defaultOn` = `defaultFeatures()`, every `cli` accepted by `FeatureFlags`, only
      `compactImports` unimplemented. Gate step `definitions`. A letter to wasmtk goes WITH the
      release (§ 24 in [handoffs.md](handoffs.md), to draft then): the version to pin, the field
      list, the prefix rule. **Next: D1** (the opcode + immediate table; their I2 trigger).
    - ✅ **D1 built 2026-10-06 — the item's three definitions are done (unreleased); it closes with
      the release and the letter.** `src/definitions/opcodes.json`, 582 entries: `name`, `encoding`
      (hex, LEB sub-opcode), `prefix`, `opcode`, `immediates` (kinds in binary order — the
      vocabulary is in the data's `rules`), `align` (memarg width), `signature` (fixed stack types,
      `addr` = the memory's index type; 498 of 582 — null where an immediate or the stack decides),
      `feature` (a D2 name), `class` (coarse: wasmtk's "numeric binary" ask). Populated once from
      `opcode.ts` plus rules by mnemonic (scratch `d1populate.ts`), then PROVED, as the data's
      `proof` rule says (`tests/definitions/opcodes.test.ts`): every entry decodes as ONE
      instruction and re-encodes to its bytes; every signature validates (addr i32, and i64 on
      memory64) and is refused with its first or its last operand changed; align is exactly natural
      (one step above is refused); every gated instruction with a signature is refused with its
      feature off. Each check inverted when written (a dropped / extra immediate, a wrong operand, a
      wrong align, a gate removed — the extra immediate survived until the one-instruction count was
      added: its sample byte decoded as `unreachable`). **binaryang now reads D1:** `opcode.ts`'s
      name tables and `naturalAlignForOpcode` (~790 hand-kept lines) are built from it;
      `check-operator-mapping.ts` reads it. What the proof found, all fixed:
      - 🔧 **Five features were gated NOWHERE** — `simd`, `signExtension`, `satFloatToInt`,
        `bulkMemory`, `referenceTypes`: with the feature off, `v128.load`, `i32.extend8_s`,
        `memory.copy`, `table.get`, `ref.null` … validated (254 of 345 gated instructions with a
        signature). They are wabt's default-ON features, which hid it. Now one gate in the validator
        (`everyExpr`, a new `ExprVisitorDelegate` hook) asks D1 for each instruction's feature; the
        other features keep their dedicated handlers, so nothing reports twice. ⚠️ The hook is NOT
        named `on…`: three delegates (text-form, WAT writer, binary writer) are Proxies answering
        every `on…` / `begin…` / `end…` name — named `onAnyExpr` it broke 18 test files, each
        recording every instruction twice.
      - 🔧 **`i64.add128` / `i64.sub128` checked three operands and dropped the fourth** — the FIRST
        — unchecked: an `i32` there validated. A test had pinned the three-type message.
      - 🔧 `delegate`, `catch_all`, `try_table` had no name (a disassembly printed `<opcode:0x1f>`);
        and the lexer gave `delegate` no opcode, unlike `else` / `catch_all`. What D1 does NOT
        prove: the NAME of an index space in an immediate (a `memidx` and a `tableidx` are both one
        LEB) beyond what the signature check resolves; text shorthands (wasmtk's I2 list) beyond the
        mnemonic and the memarg's `offset=` / `align=`.
24. ⬚ 🗓️ **`wasm-bundle` — take wasmtk's `wasmbundle` into our tools, and wasmtk imports it back**
    (owner, 2026-09-30: "incorporating wasmtk's wasmbundle into our cli tools and offload that from
    wasmtk. And import it back for use there"; "we will probably want to call it wasm-bundle in our
    tools section"). Nothing is written into wasmtk from here: they drop their copy and pin ours by
    their own session, from a letter, once there is a release to pin. Facts read from their tree
    2026-09-30 (re-derive before acting):
    - **What it is:** `src/wasmbundle.ts` (413 lines) bundles N standalone `.wasm` (WASI programs or
      libraries) into ONE library: export-name conflicts resolved (interactive prompt, or
      `--on-conflict=prefix|alias|exclude`, `--alias a.wasm=m`), WASI imports deduplicated, every
      module's data RELOCATED into one memory, `_start` kept, then `-Oz`. The merging itself is
      `src/wasmmerge.ts` (991 lines) — REGEXES over printed WAT (`readWasm` → `toText` →
      `parseWat`), which `wasic.ts` also uses; the data relocation decides "never a pointer" by
      operator (`ARITH_NEVER_PTR`, 13 `i32` ops) — a heuristic. Their tests: `bundle_tests.ts` (179
      lines), `merge_tests.ts` (245), `wasmmerge_guard_tests.ts`.
    - **So it is a REWRITE on the IR, not a port of the text:** index spaces (types, functions,
      globals, tables, memories, tags, data, elems) renumbered on the tree — which also retires I2's
      regexes for this path (`../cmem/divergences.md` I2). Upstream binaryen's `wasm-merge`
      (installed here) is the reference for the linking half.
    - ✅ **Decided 2026-10-06, owner: ONE memory, relocated EXACTLY — no multi-memory mode, ever**
      ("no future multiple memories that breaks 'runs everywhere'"; "exact relocation instead of
      guessed. This is why I want it in this repository and out of wasmtk. This repository has more
      experience with this side of the process"). Why, as weighed that day: multi-memory breaks WASI
      (`fd_write` reads the one exported `memory`), wasmtk's host bindings (one `memory` export),
      cross-module pointers, and wazero (it failed exactly the two multi-memory modules in wasmtk's
      § 20 run). Exact means the PRODUCER marks its data addresses — a relocation section as
      `wasm-ld` objects carry, or position-independent code with a `__memory_base` global — so
      nothing is guessed; a module without the marks is refused, or relocated by today's
      range-scoped rule with a printed warning, never silently. Which marking wasmtk's producers
      (`wasic`, the Go / Zig / Rust wrappers) emit is settled with wasmtk by letter when this item
      starts. **Letter § 24 SENT 2026-10-06** ([handoffs.md](handoffs.md)): proposes the
      tool-conventions Linking format (`linking` + `reloc.*`, `wasm-ld --emit-relocs`) and asks
      wasmtk to measure, per producer, whether it can emit it. Building waits on that answer.
      **Answered: § 25** (2026-10-06, measured): Rust yes; Zig and TinyGo only object +
      `wasm-ld --emit-relocs` (TinyGo's own build runs `wasm-opt` after linking, leaving STALE
      relocations: 0/48 address sites correct); wasic needs our part first. **The design points it
      fixes:**
      - consume relocations as the module is READ, each tied to its instruction node, before
        anything rewrites a byte — our own reader → writer re-encodes the padded LEBs `wasm-ld`
        writes at relocation sites, so a byte offset is valid only against the original bytes;
      - VERIFY every relocation against the code it names, and refuse a stale one as a missing one
        (their site check is the start: `i32.const` + 5-byte LEB, `call` / `ref.func`);
      - bundle BEFORE optimisation; `linking` with no `reloc.CODE` = nothing to relocate;
      - `reloc..debug_*`: drop the DWARF sections with a printed note (proposed default) or
        relocate;
      - for wasic: a WAT form that marks an address and an assembler writing `linking` / `reloc.*`
        from it. ✅ **Decided 2026-10-06, owner: an ANNOTATION in the WAT** — the text format's
        standard annotation syntax (annotations proposal), e.g.
        `(i32.const 1024 (@reloc data $str_0))`, one file, through our parser; we define the
        annotation's meaning and document it for wasmtk (not a relocation list beside the WAT, not
        wasm-ld objects only). The exact spelling is ours to propose when the item starts. (wasmtk's
        current rule, their header: "range-scoped … but still address-based, not dataflow-exact".)
    - **Scope questions:** whether `wasmmerge.ts`'s `wasic` path moves too or stays theirs; what
      stays in wasmtk (`witgen`'s WIT emission beside the output; the interactive prompt belongs to
      a CLI — ours or theirs).
    - **Surface:** a `wasm-bundle` CLI tool and a `./wasm-bundle` subpath — a new export, so a
      MINOR; their pin moves to four specifiers (five with item 22's `./definitions`).

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
  - The code stays as it is: `wasm-runtime.ts`, the demo kernel in `src/binaryen-ts/wasm/`, the
    published `./wasm` and `./wasm-runtime`. Only a test and a bench call them.
  - What was never built is kernel SELECTION: which optimizer operations are worth moving to wasm.
    The baseline is a ~2–3 ns boundary cost per call (`add_i32` ~3.6 ns as a kernel vs ~0.34 ns in
    TS), so only an operation doing much work per call can pay.
  - **Trigger to reopen:** work on the optimizer's processing speed. Profile the corpus first; a
    kernel is justified only by a hot operation the profile shows.
  - It is not part of the IR merge: the IR is the tree's shape, this is the passes' speed.
  - The doc mapping of `wasm/demo_bytes` to `./wasm` is correct: `./wasm` exports `DEMO_BYTES`
    (checked 2026-09-29).
- **A local directory path in git history — leave it** (owner, 2026-09-14). The copies in
  `b472b4aa4` and `df3659840` name no account, token or secret, and are not worth a force push. Do
  not re-open.
- **JSR and GitHub descriptions on the predecessors — won't do** (owner, 2026-09-02); they are
  frozen.
- **Converging the two IRs further is not a release task.** It is open-ended by decision 1 and
  tracked by `deno task collisions` ([project.md](project.md)).
- **D4 — never yank, ever** ([project.md](project.md)).
- **The predecessors are frozen**: no change to `binaryen-ts` or `wabt-ts` on GitHub or JSR.
