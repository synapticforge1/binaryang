# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

**State, 2026-09-29:** 🚀 **`binaryang@1.8.1` is published** (tag `v1.8.1`, `531d82f1b`;
[publishing.md](publishing.md) § 1.8.1) — 1.8.0 carried everything below, 1.8.1 wasmtk's § 20
fixes; `main` = the release plus, since 2026-09-30, item 2's steps 1–2 and item 1 — UNRELEASED and
NOT PUSHED (owner: wait "until the next updates are finished"; [unreleased.md](unreleased.md)).
**Owner's order that day: items 16 and 17
(done), then 11 (found already closed), then 12** — decided the same day (both halves, V8 flags)
and built: `proposals/` is in the gate, and its first run found Q10–Q13 and closed item 9.
Custom-page-sizes runs on V8 through a new lowering pass (owner's choice), and its linking
trade-off P1 was decided the same day (rename the export), which closed 12. The optimizer and
IR items (from 2) are next. **14 open items, none blocking**, numbered below: old 16 and 17
closed, new 16 and 17 came out of them and closed the same day, and 6, 9, 11, 12, 16 and 17 are
gone with their numbers kept free.
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

**None open.** Items 18–20, from wasmtk's § 20, were fixed for 1.8.1 the day they arrived: L3
(a lowered out-of-bounds access traps as out of bounds), L4 (the placeholder; case 2 at an engine
ceiling) and C7 (`getFunctionInfo` shaped as binaryen.js) — [divergences.md](divergences.md).

Closed 2026-09-29: `array.new_default` defaultability (`d6b487c2d`),
empty offsets / items (M2a), the name section's position (N9, by decision), references by name
(N10), folded layout and its label comments (W18), the diagnostic defects DG1–DG4 found by
measuring the old item 16 ([testing.md](testing.md) § "Diagnostic usefulness"), and the two that
measurement left, numbered 16 and 17 after it: DG5 (`wat2wasm` validates by default, as upstream —
owner: "we want to do the same"; it needed the validator to take labels BY NAME, which it never
could) and DG6 (a text diagnostic at the WORD, not its `(`, underlined as upstream) —
[divergences.md](divergences.md). The CI shell scripts are TypeScript (the old item 17).


## Optimizer and IR

(Item 1 closed 2026-09-30: the walkers visit a `br_if` / `br_table`'s values before its condition.
It was a DEFECT, not only an order: `mapWithSequences` keeps, evaluated, what it mapped before an
operand that becomes a never-falling-through sequence, so StripEH ran a builder-made
`br_if $l (throw $e (i32.const 7)) (call $bump)`'s call before the trap — reachable only from trees
built by the API or a pass; the text reader keeps such a `throw` a statement before the branch.
The "may move `-Oz` bytes" premise was measured: 0 of 13,285 optimizer outputs moved (the corpus
and every prepared spec module, at -O1 … -Oz). The hand-written traversals (`deriveTypes`,
`phantoms`, `cfg`, `non-nullable-locals`) already had wasm's order. `branch_operand_order.test.ts`.)

2. ⬚ **The size gap to upstream at `-Oz` is mostly COVERAGE: 60.3 KB of 109.5 KB**
   ([names.md](names.md) § "Names under optimization, priced", measured 2026-09-19).
   - The missing passes: Inlining (ours runs at `-O3` only), DAE, DuplicateFunctionElimination,
     Precompute, MergeBlocks, SimplifyGlobals.
   - It shows in what survives: we keep 3,943 functions to upstream's 2,663.
   - ~~The cheapest probe is scheduling Inlining at `-O2` / `-Oz`.~~ **Probed 2026-09-30: inlining
     does not pay until the cleanup passes exist.** Corpus totals (421 modules), before → probe:
     - upstream's schedule (`InliningOptimizing` in the post passes at `optimizeLevel >= 2 ||
       shrinkLevel >= 2`, `pass.cpp:822`): -Oz 915,103 → **915,970 (+867)**, -O3 +14 KB;
     - plus a second round of the function passes after it, as upstream's
       `addUsefulPassesAfterInlining` does (`precompute-propagate` + the default function
       passes): -O2 917,483 → 915,587, **-Oz 915,575 (+472)**;
     - that second round WITHOUT inlining: -O2 915,115 (**−2,368**), -Oz unchanged — the -O2 gain
       is the round, not the inlining;
     - plus upstream's one-caller limit (`oneCallerInlineMaxSize = -1`, unlimited; ours is 10):
       -Oz **919,515 (+4.4 KB)** — every inline leaves overhead we cannot remove.
   - **What an inline leaves behind** (one callee, one caller, -Oz: ours 70 bytes, upstream 43):
     parameter COPIES (`local.set 1 (local.get 0)` — upstream's CoalesceLocals coalesces copies,
     ours does not); a CONSTANT parameter not propagated or folded (`5 * 3` → upstream's
     `precompute-propagate` gives 15; we have no Precompute); the `__inlined_func` wrapper block
     with a `br` out of an `if` (upstream's RemoveUnusedBrs / MergeBlocks remove it and make the
     `if` a `select`); an unused type (item 6). **So the order is: those cleanups first, then
     inlining at upstream's schedule and one-caller limit.** The probes were reverted.
   - The steps, owner-agreed 2026-09-30: (1) copy coalescing in CoalesceLocals, (2) MergeBlocks,
     (3) Precompute (+ propagate), (4) Inlining at upstream's schedule and one-caller limit —
     each measured the same way (corpus totals at every level; the behaviour gates).
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
     over used types' own references and whole rec groups, then every index renumbered. Corpus:
     -O1 −10,324, -O2 −10,324, -O3 −12,515, -Os / -Oz 908,932 → **898,608**; the type section now
     17,307 against upstream's 17,658. `spec-behaviour` 57,808 / 0 DIVERGE, `direct-behaviour`,
     `proposals` (descriptor types) all hold. `remove_unused_types.test.ts`, 6 mutants killed — the
     block `typeIndex` one only by running the pass DIRECTLY: through `PassRunner` a block's written
     index is dropped as form before any pass.
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
     then sample diff hunks): `i32.store (wrap_i64 x)` → `i64.store32` (770), `extend_i32_u
     (i32.load)` → `i64.load32_u` (770), `if (eqz c)` arm swap (~1,000 eqz), added constants
     gathered (`(x+c1)+c2`, `(0-x)+c`, `((x+1)<<2)+8`); `ge_u` → `le_u` is canonical order, 0
     bytes. Built those (plus `i64.storeN(extend)`, the store mask, `eqz(eqz)` in a condition,
     `select` swap when both operands are pure, the shorter spelling of `x ± c`). Corpus: -O2
     902,484 → **892,635 (−9,849)**, -O3 1,112,248 → **1,085,767 (−26,481)**, -Os / -Oz 898,608 →
     **888,759 (−9,849)** — more than upstream's pass alone was worth (6,538): the later passes
     find more. -O1 unmoved (no OI there). 🔧 Found reading the pass: `i64.extend8_s` /
     `extend16_s` of a constant folded through `Number(v)`, WRONG above 2^53 — silent, valid
     output (a mutant restoring it is killed). NOT built: `load(add(p, c))` → `offset=c` — the add
     wraps and the offset does not (upstream needs `--low-memory-unused`). `spec-behaviour` 57,808 /
     0 DIVERGE, `direct-behaviour` 1,953 / 651 agree, gate green;
     `optimize_instructions_coverage.test.ts` runs every case before and after, 13 mutants killed
     (4 survived the first draft — each an untested case, now tested). Next: SimplifyLocals,
     RemoveUnusedBrs, Precompute, measured the same way.
   - ✅ **Step 3b done 2026-10-06 — SimplifyLocals SINKS, on a shared effect analysis.**
     Re-ranked first on our -Oz output after 3a: `inlining-optimizing` 43,621 · `dae-optimizing`
     24,559 · `simplify-locals` 5,007 · `code-folding` 4,542 · `remove-unused-brs` 4,210 ·
     `local-cse` 3,327 · `precompute-propagate` 1,511 · `optimize-instructions` 1,003 (was 6,538).
     Upstream's simplify-locals by opcode: 8,013 sets became tees, 7,594 gets went. Ours only
     merged a set with an ADJACENT get. New `ir/effects.ts` (upstream's `effects.h` role): shallow /
     deep effects, `invalidates(a, b)`; an unclassified kind conflicts with everything; two traps
     never swap (the trap kind is behaviour). SimplifyLocals rewritten on it: a set's value moves
     to the first get that reads it along straight-line code (cleared at any branch, loop, `if`
     arm, `try`, and EVERY block end — a branch names its target by depth, so an empty label
     proves nothing), the get becoming the value when it is the only read, else a tee. Corpus:
     -O2 892,635 → **878,476 (−14,159)**, -O3 1,085,767 → **1,065,080 (−20,687)**, -Os / -Oz
     888,759 → **874,595 (−14,164)**. 🔧 The fuzzer (`optimize_fuzz.test.ts`, seed 128) caught
     two miscompiles in the first draft, both now named tests: a `local.get` did not invalidate a
     pending value that WRITES its local (a tee inside it), and a value that another set was sunk
     into did not carry that set's effects. Found measuring: globals reach the passes by NAME
     (667 / 667), so per-index global tracking was dead — keys are now the reference as written,
     and an index and a name are never proved apart. Upstream's `if` / block result values from
     sets in arms are not done. `spec-behaviour` 57,808 / 0 DIVERGE, `direct-behaviour` 1,953 /
     651 agree, gate green, fuzz 5,000 more seeds clean; `simplify_locals_sink.test.ts`, 14 of 15
     mutants killed — the survivor, "a branch does not clear", is redundant with the effect rule
     (every sinkable writes its local) and kept as its statement. Next: RemoveUnusedBrs, Precompute.
   - ✅ **Step 3c done 2026-10-06 — RemoveUnusedBrs, the counted shapes.** Upstream's
     remove-unused-brs on our output after 3b: 4,174 (upstream's simplify-locals is now −1,992
     there: ours does better). Most of it restructures loops; the shapes counted in our -Oz
     output (`brshapes.ts`): a `return` ending the body 494, a cheap `if` with a result 468, `if
     (c) br` 29. Built: the tail `return` → its value (not past values left on the stack), a cheap
     `if` → `select` (numeric result, each arm one constant / read, and the condition writes
     nothing they read — `ir/effects.ts`), `if (c) br $l` → `br_if $l c` (not to the `if`
     itself). Corpus: -O2 878,476 → **876,375 (−2,101)**, -O3 1,065,080 → **1,062,111
     (−2,969)**, -Os / -Oz 874,595 → **872,500 (−2,095)**. 🔧 The first draft removed a tail
     `return` that also DISCARDS values left on the stack (spec `unwind.wast`: `(i32.const 3)
     (i64.const 1) (return (i32.const 9))`) — INVALID output, caught by `spec-behaviour` and
     `proposals`, not by the fuzzer (its generator builds no stack residue). Not built: upstream's
     loop restructuring. Gate green, fuzz 3,000 more seeds clean; `remove_unused_brs_3c.test.ts`, 9
     mutants killed — the `br_if` type one only by asserting the IR (nothing reads a valueless
     `br_if`'s stored type today; DCE asks the structure). Next: Precompute.
   - 🔧 **Re-ordered again 2026-10-06, owner-agreed:** Precompute (now 1,134 on our output) is
     FOLDED INTO item 23 — built on the one evaluator item 23 plans, not separately. Measured
     after 3c (872,500): our whole -Oz run TWICE saves 2,764 (the pipeline was not at a fixed
     point); upstream's plain `--dae` then our pipeline 869,736 → 867,076 (was ~1 KB before the
     cleanups), upstream's `dae-optimizing` 863,788. So: **4a** the re-runs, **4b** DAE, then
     inlining.
   - ✅ **Step 4a done 2026-10-06 — the schedule re-runs what later passes expose**
     (`schedule.ts`: candidate schedules, corpus totals). All of the twice-run gain is ONE pass:
     CoalesceLocals again after SimplifyLocals / LocalCSE (the reads and writes sinking removed
     leave locals to merge): −2,900, more than running everything twice; moving it instead of
     repeating keeps only −2,348. And SimplifyLocals after Inlining at -O3 (an inlined call leaves
     its arguments copied into locals): −8,097 of -O3's −8,309 (−212 without it). Corpus: -O2
     876,375 → **873,471 (−2,904)**, -O3 1,062,111 → **1,053,802 (−8,309)**, -Os / -Oz 872,500 →
     **869,600 (−2,900)**. Gate green; `pipeline_schedule.test.ts` asserts each re-run against the
     schedule without it and runs the output — removing either fails it. Next: **4b DAE**.
   - ✅ **Step 4b done 2026-10-06 — DeadArgumentElimination** (`passes/dead-argument-elimination.ts`,
     new). For a function reached ONLY by direct `call` / `return_call` (not exported, never a
     `ref.func` operand in code, globals or element segments, not imported): a parameter nothing
     reads goes when every call passes it an effect-free value; one every call passes the SAME
     constant (bit for bit — a float by its bits) becomes a local set to it on entry. Decided on
     the tree as read, then every call pruned by node IDENTITY before any rebuild, then each
     function's locals renumbered and its type interned with the writer's own interner
     (`makeTypeInterner`, so RemoveUnusedTypes sees the right use). Placement measured
     (`schedule2.ts`): before the function passes −5,315, after them plus a cleanup re-run (upstream's
     `dae-optimizing` placement) −5,411, both −5,559 — taken: before, one pass. Corpus: -O2 873,471 →
     **868,216 (−5,255)**, -O3 1,053,802 → **1,046,251 (−7,551)**, -Os / -Oz 869,600 → **864,285
     (−5,315)** — upstream's `dae-optimizing` reached 863,788 from 872,500. Spec -O3 +246 on
     `call.0` / `return_call.0` (Inlining takes the smaller functions; -O3 trades size for speed).
     Not done: removing a result every caller drops; moving an operand with effects out of the
     call. Gate green; `dead_argument_elimination.test.ts`, 12 mutants killed (a test asserting the
     start function's signature was dropped as vacuous — a start function has no parameters, and
     the check with it). Next: **inlining** at upstream's schedule.
   - ✅ **Step 5 done 2026-10-06 — Inlining at upstream's rules and schedule.** `isInlineable` is
     upstream's `worthFullInlining`: size ≤ 2 always; ONE caller at any size (upstream's
     `oneCallerInlineMaxSize = -1`; ours was 10 — `--pass-arg one-caller-inline-max-size@N` limits
     it); several callers only at -O3 without shrinking, and only a leaf without loops. 🔧 That last
     rule was `!hasCalls || !hasLoops` (upstream refuses EITHER): -O3 inlined far too much. The
     schedule (`schedule3.ts` measured placements): at -O2 and above the function passes, then
     Inlining, then the function passes AGAIN and a Vacuum (upstream's
     `addUsefulPassesAfterInlining`; without the trailing Vacuum -O2 GREW 8.4 KB — the round's
     later passes leave what its early Vacuum already passed). The same probe on 2026-09-30 grew
     -Oz by 0.5–4.4 KB; the cleanups since make it pay. Corpus: -O2 868,216 → **859,534
     (−8,682)**, -O3 1,046,251 → **865,688 (−180,563, −17%)**, -Os / -Oz 864,285 → **859,534
     (−4,751)**; spec -O3 −18.5 KB. Upstream's `inlining-optimizing` now saves 918 on our output
     (was 33.7 KB), `dae-optimizing` 635. 🔧 Found by `translate-eh` (spec legacy
     `try_catch.wast` / `try_delegate.wast`): a `return_call` inside a `try` was inlined — the
     callee's throw, which a tail call takes PAST the `try`, was caught — at -O3 before this step
     too. In a function with any `try`, no `return_call` is inlined now. Gate green, fuzz 3,000
     more seeds clean; `inlining_schedule.test.ts`, 8 mutants killed; `inlining.test.ts`'s
     size-limit test given a second caller (its premise was the old cap).
   - 📏 **Where item 2 stands, 2026-10-06:** upstream `wasm-opt -Oz` on each ORIGINAL corpus module
     totals 816,485; ours 859,534 — **the gap is 43,049 (5.0%)**, from 109.5 KB on 2026-09-19.
     Functions kept: ours 2,705, upstream 2,663 (was 3,943). No single upstream pass saves more
     than 3.6 KB on our output (`code-folding` 3,573, `local-cse` 3,549); upstream's whole -Oz on
     our output still saves 55,449 — the rest is passes in combination. Scratch: `gap.ts`. 2026-09-30:** a copy does not make its two locals interfere, a variable may
     take a PARAM's slot (the search started past the params), a copy partner's slot is tried
     first, and a copy onto its own slot is removed. Corpus: -O2 917,483 → **912,808 (−4,675)**,
     -O3 1,147,462 → **1,124,763 (−22,699)**, -Os / -Oz 915,103 → **908,932 (−6,171)**; the
     one-inline example 70 → 66 bytes. `spec-behaviour` 57,808 / 0 DIVERGE, `direct-behaviour`
     1953 / 651 agree. `coalesce_copies.test.ts` — 5 mutants killed, the over-merge one by the
     three tests that RUN a module where a copy's source or copy is later overwritten.
3. ⬚ **LocalCSE is an allow-list of kinds**, so it never reuses what sits under an unlisted kind
   (`extract_lane`, any SIMD). Upstream reuses it.
   - Its share of the **42.1 KB** our twelve passes lose to upstream's same twelve is unmeasured.
   - That 42.1 KB is the budget items 3–5 draw from.
4. ⬚ **LocalCSE runs after SimplifyLocals and CoalesceLocals at `-Oz`**, so the tee it adds is never
   cleaned up: +4 bytes on a repeated binary (measured scoping K3, 2026-09-14).
5. ⬚ **LocalCSE treats a multi-value `return` as opaque** (as it once did `tuple.make`).
(Item 6, unused types, closed 2026-09-30 as item 2's step 2 — below.)

7. ⬚ **9 node LITERALS in `src/` bypass their factory** and hand-compute `type` (re-counted
    2026-09-29: inlining 5, optimize-instructions 2, local-cse 1, simplify-locals 1; it was 26
    before the WAT parser was deleted).
    - Count them with `grep -rnE "kind: ExpressionKind\.\w+," src` outside `ir/expressions.ts`.
    - The `br_if` one was wrong. The rest want each literal's type compared to the factory's.
8. ⬚ **Asyncify refuses `call_ref`** (K1's leftover; `passes/asyncify.ts`: "call_ref is not yet
    supported"). Upstream instruments it as an indirect call.
(Item 9, inexact allocations, closed 2026-09-29: it was NOT "valid either way" — `--flatten` made
invalid modules from it. Q13 in [divergences.md](divergences.md).)

10. ⬚ **Delete S7's read-back in `wat2wasm`.** `writeBinaryIr` still re-reads its own bytes
    (`binary-writer.ts`, `readBinaryIr`) to predict the text forms, which costs +26–35% on
    `wat2wasm`.
    - The re-read existed only because two front ends built different trees. There is one front end
      now, so predict from the module in hand, delete the read-back, and re-measure.
    - The prediction hash keeps it safe: a residual disagreement prints as predicted, never wrong
      ([ir-convergence.md](ir-convergence.md) § "S7", and § "One front end", stage 2's ⏭️ line).
23. ⬚ 🗓️ **An interpreter, and `wasm-ctor-eval` on it — AFTER the optimizer steps** (owner,
    2026-09-30: "yes add as open item after the optimizer steps … the wasm-ctor-eval then the -Oz
    seems to be the right path"). The owner's question: could an interpreter precompute DATA
    OBJECTS — memory, globals, what a program builds at start — as part of optimization? Yes; that
    is upstream's `wasm-ctor-eval`: run an entry point at build time up to the first host call, then
    write memory into data segments, globals into their initializers, and what is left back as the
    body. wabt-ts has NO interpreter today (upstream wabt's `wasm-interp` was never ported).
    - **Priced 2026-09-30** on our -Oz output (421 modules, 419 export `_start` — WASI commands,
      `proc_exit` / `fd_write`), with upstream's tool (`--ctors=_start --kept-exports=_start
      --ignore-external-input`): ours 898,608 → ctor-eval **843,920** (366 changed, 80 grew, 2
      refused); upstream `-Oz` on ours without it **810,895**, with it first **758,362** — worth
      **52.5 KB on top of full optimization**, more than inlining. Scratch: `ctoreval.ts`.
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
    - **Precompute joins this item** (owner-agreed 2026-10-06, item 2): `precompute-propagate`
      was worth 1,134 on our -Oz output after step 3c — built on this item's evaluator, so
      constant folding has one semantics, not two.

## Conformance

Nothing open. Closed 2026-09-29: item 11 (rank 4 of the wasmtk-ranked list — closed since M8e by
the One front end, never recorded: [handoffs.md](handoffs.md) § 4's outcome) and item 12
(`proposals/` in the gate, both halves; custom-page-sizes on V8 through `LowerCustomPageSizes`,
every assertion of the suite honoured — [testing.md](testing.md) § "The proposal testsuites",
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
    folders into the src folder … I would like to scope that after our IR work is completed").
    Facts measured that day, for the scoping:
    - **There is ONE IR already**: `Expression = Expr`, `WasmModule = W.Module`, `WasmFunction =
      W.Func` (binaryen-ts `ir/` aliases wabt-ts `ir/ir.ts`). The trees are LAYERS, not two IRs:
      30 binaryen-ts files import wabt-ts, 0 the other way (wabt-ts 52 files / 37k lines — IR,
      reader, writer, validator, text tools; binaryen-ts 43 / 19k — passes, compat, `wasm-opt`).
    - **Decision 1** ([project.md](project.md)) says "Two IRs are retained … not a merge task" — its
      premise no longer describes the code; the merge re-decides it.
    - `deno task collisions` = **86** names declared in both trees — the aliases; one tree needs
      one name each, and the indicator itself (it counts per tree) retires with the merge.
    - PUBLIC subpaths name the trees: `./ir/binaryen-ts`, `./ir/wabt-ts`, `./core/wabt-ts` —
      moving files keeps them working (they map to paths), renaming them is BREAKING.
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
      after C1). ✅ **Decided 2026-10-06, owner: "I approve the wasmtk order for definitions"** —
      D2 and D3 first, D1 later. (The workspace's `../cmem/divergences.md` still reads D1-first;
      the workspace session updates it, not this one.)
    - **Delivery:** a `./definitions` subpath in a normal release (a new export = MINOR), pinned at
      the same exact version as their other three. A TS module of typed constants, and/or the JSON
      sources in the package at a stable path (for the Rust / Zig consumers). **The content hash and
      the version IN the data**, so their generated copy's header quotes them and their gate proves
      the copy matches.
    - **D2, per feature:** the canonical name (the one `allFeatures()` / `Features` uses); the
      spec-testsuite directories it gates, relative to the testsuite root; whether it CHANGES core
      semantics, not only adds (why they scope `custom-descriptors`: on everywhere it relaxes
      `br_on_cast`, and core `br_on_cast.wast` / `br_on_cast_fail.wast` lose 3 `assert_invalid`
      each — possibly the same fact as D2's "snapshots that must NOT receive it" column); the date
      it entered the list. Engine flag spellings stay theirs, keyed by our name.
    - **D3, per verdict class:** for traps a class key and the testsuite's exact `assert_trap`
      message, with the PREFIX rule stated (`"uninitialized element 2"` matches `"uninitialized
      element"`); the same for `assert_invalid` / `assert_malformed` later; nothing engine-specific.
      Entries they filed now (H10 asks for it): `unreachable`, `out of bounds memory access`, `out
      of bounds table access`, `out of bounds array access`, `undefined element`, `uninitialized
      element`, `indirect call type mismatch`, `integer divide by zero`, `integer overflow`,
      `invalid conversion to integer`, `cast failure`, `descriptor cast failure`, `null reference`,
      `null structure reference`, `null array reference`, `null i31 reference`, `null function
      reference`, `null descriptor reference`, `unaligned atomic`; `call stack exhausted` for
      `assert_exhaustion`. Proposals their gate treats specially: `wide-arithmetic` (every file),
      `custom-descriptors` (scoped), `custom-page-sizes` (through `LowerCustomPageSizes`).
    - **D1, later:** mnemonic and legal shorthands, immediate syntax (`offset=` / `align=`), stack
      signature, gating feature; a coarse operator class ("numeric binary") would let them DERIVE
      their 13 never-a-pointer `i32` operators — that judgment stays theirs.
    - Their side (H10), for reference: `scripts/gen-definitions.ts` → committed
      `src/definitions.generated.ts`; their gate regenerates and diffs, inverted once.
24. ⬚ 🗓️ **`wasm-bundle` — take wasmtk's `wasmbundle` into our tools, and wasmtk imports it back**
    (owner, 2026-09-30: "incorporating wasmtk's wasmbundle into our cli tools and offload that from
    wasmtk. And import it back for use there"; "we will probably want to call it wasm-bundle in our
    tools section"). Nothing is written into wasmtk from here: they drop their copy and pin ours
    by their own session, from a letter, once there is a release to pin. Facts read from their
    tree 2026-09-30 (re-derive before acting):
    - **What it is:** `src/wasmbundle.ts` (413 lines) bundles N standalone `.wasm` (WASI programs
      or libraries) into ONE library: export-name conflicts resolved (interactive prompt, or
      `--on-conflict=prefix|alias|exclude`, `--alias a.wasm=m`), WASI imports deduplicated, every
      module's data RELOCATED into one memory, `_start` kept, then `-Oz`. The merging itself is
      `src/wasmmerge.ts` (991 lines) — REGEXES over printed WAT (`readWasm` → `toText` →
      `parseWat`), which `wasic.ts` also uses; the data relocation decides "never a pointer" by
      operator (`ARITH_NEVER_PTR`, 13 `i32` ops) — a heuristic. Their tests: `bundle_tests.ts`
      (179 lines), `merge_tests.ts` (245), `wasmmerge_guard_tests.ts`.
    - **So it is a REWRITE on the IR, not a port of the text:** index spaces (types, functions,
      globals, tables, memories, tags, data, elems) renumbered on the tree — which also retires
      I2's regexes for this path (`../cmem/divergences.md` I2). Upstream binaryen's `wasm-merge`
      (installed here) is the reference for the linking half.
    - ⚠️ **Decision for the owner — ONE memory or MANY:** their bundle relocates every module into
      one memory, which needs to know which values are pointers (the heuristic above; a wrong
      judgment is silent corruption — their own comment at `wasmbundle.ts:142`). Upstream
      `wasm-merge` keeps each module's memory (multi-memory): sound by construction, and every
      engine wasmtk targets runs multi-memory — but a host expecting ONE exported `memory` breaks.
    - **Scope questions:** whether `wasmmerge.ts`'s `wasic` path moves too or stays theirs; what
      stays in wasmtk (`witgen`'s WIT emission beside the output; the interactive prompt belongs
      to a CLI — ours or theirs).
    - **Surface:** a `wasm-bundle` CLI tool and a `./wasm-bundle` subpath — a new export, so a
      MINOR; their pin moves to four specifiers (five with item 22's `./definitions`).

## The wasmtk thread — [handoffs.md](handoffs.md)

§ 22 (2026-09-30) closed the thread: 1.8.1 pinned, all three fixes hold on five engines, skips 66 → 16 (gate 64,506 / 0 / 16), nothing asked. § 20 was answered in code (items 18–20, 1.8.1) and by § 21. § 19 (1.8.0 is out; `LowerCustomPageSizes` offered for the
custom-page modules they skip) was SENT 2026-09-29 and asks nothing — a reply is welcome, above all
their custom-page-sizes skip count with the pass. § 17 (item 1 fixed in 1.7.1) was answered by § 18: on 1.7.1 their gate
is 64,473 passed / 0 failed / 66 skipped, all 11 of our skips pass, and "none of the 66 is yours". § 11 was sent and answered (their reply reached us 2026-09-29) — closed in
[handoffs.md](handoffs.md).

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
