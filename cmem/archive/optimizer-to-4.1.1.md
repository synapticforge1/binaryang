# optimizer — the step-by-step record of open-work 2, 30 and 31, to 4.1.1

What landed in item 2, the last 15.1 KB, open-work 30 in full, and open-work 31 steps 1 to 16 with their passrank snapshots. Moved from `cmem/optimizer.md` on 2026-11-20 (H38 step 4), verbatim.

## What landed, in order, with its commit and corpus -Oz bytes

| step | what                                                                                    | commit      | -Oz after       |
| ---- | --------------------------------------------------------------------------------------- | ----------- | --------------- |
| 1    | CoalesceLocals coalesces copies, as upstream                                            | `5032663b5` | 908,932         |
| 2    | RemoveUnusedTypes, last at every level (the "encoder gap" was unused types, item 6)      | `bb760e7a2` | 898,608         |
| 3a   | OptimizeInstructions: the shapes upstream still found on our output (narrow stores, `eqz` arms, gathered constants) | `18eb36bf5` | 888,759 |
| 3b   | SimplifyLocals sinks a set into its only read, on a shared effect analysis (`ir/effects.ts`) | `b89634f06` | 874,595    |
| 3c   | RemoveUnusedBrs: tail `return`, cheap `if` → `select`, `if (c) br` → `br_if`            | `51e180f47` | 872,500         |
| 4a   | the schedule re-runs what later passes expose (CoalesceLocals again after SimplifyLocals) | `4653ff6c3` | 869,600       |
| 4b   | DeadArgumentElimination (new)                                                           | `33dea9086` | 864,285         |
| 5    | Inlining at upstream's rules and schedule, the function passes again after it           | `2621b4316` | 859,534         |
| —    | LocalCSE rewritten (items 3–5): any repeated read-only or trapping expression           | (items 3–5) | 856,554         |
| —    | ConstantPropagation (new; a read with one reaching constant becomes it)                 | `4a0a493bd` | 854,227         |
| —    | item 23's E1 / E2: OI folds through the evaluator; Precompute (new)                     | `b86ff770e` `97080c38b` | 847,329 |
| 6a/b | Vacuum splices unnamed blocks; a block opening with a `br_if` to itself is an `if`      | `5928e66d3` | 840,079         |
| 6c   | CodeFolding (new): what both arms of an `if` end with, written once                     | `b8007cb70` | 836,929         |
| 6d   | a read of an immutable constant global is its constant; DAE again before Inlining       | `9b2c4ab9c` | 833,291         |
| 6e   | MemoryPacking (new): the data segments as the fewest bytes that build the same image    | `e0e6ed151` | **825,077**     |

Upstream's own number moved under us: 816,485 with binaryen 132 (to 2026-10-07), 809,986 with
133 (its -Oz got 6.5 KB better); every gap figure names the version it was measured against.

## What the last 15.1 KB is (2026-10-08, by section, ours − upstream)

code **+20,390** · data −5,381 (ours is the smaller since 6e) · datacount −798 · global +116 ·
import +630 · type +59 · table +30 · element +47. Functions 2,704 / 2,663. The code is in a few
large modules (`38_Phase38Combined` +1,450, `1_fib-rs` +1,008, `1_switch` +804 — its `_start` is
921 lines to upstream's 703) and is unattributed; the ranked candidates after 6e, from the
re-rank over the control: `rse`-like redundant sets (−922 `local.set` in upstream's delta),
`simplify-globals`' remainder, the loop flip. Upstream's `wasm-ctor-eval` also finds 7.4 KB more
than ours on the same input ([interpreter.md](../interpreter.md)) — a separate matter.

## Open-work 30: the gaps on real compiler output (2026-10-13 → closed 2026-10-15)

**Done when** (owner, 2026-10-15, asked once the gap was attributed): "Top shapes, then decide" —
build the four attributed fixes, each gated and merged on its own, then re-measure and close with
the rest recorded and ranked. (Not "≤ 2%", which item 2 used: that would have meant the whole list.)

**The method was item 2's** (§ "The method"), on the six `benches/browser-opt/modules`: each
upstream 133 pass alone on OUR -Oz output, then our -Oz again, against the control (upstream's bare
read-and-write); `--strip-dwarf` on every upstream run (it dies on zig-debug's DWARF, and DWARF never
counts in code bytes); per-instruction deltas (`opdelta`) to turn a pass's number into a shape;
upstream's own source for each rule. Scratch: `gap.ts`, `passrank.ts`, `opdelta.ts`, `corpus.ts`.

**Attributed** (2026-10-15): our -Oz was 10.4% over upstream on the six (153,470 vs 139,020 code
bytes), 11.2 KB of the 14.5 KB in zig-debug. Gap (a), "-Oz buys nothing over -O2", was the SCHEDULE,
not a defect: item 2 had put most of upstream's -Oz-only passes (local-cse, code-folding,
precompute-propagate) into our -O2 already.

| step | what | commits | six modules -Oz | corpus -Oz |
| --- | --- | --- | ---: | ---: |
| — | before | | 153,470 (+10.4%) | 825,077 (+1.86%) |
| 1 | OptimizeInstructions knows a value's bits: `and(x, 2^n-1)` → `x` when `x` fits; `eqz(cmp)` → the inverse integer comparison; `x op x` of a local is a constant | `5c286581b` | 150,181 (+8.0%) | 823,398 |
| 2 | CodeFolding writes TERMINATING tails once: what several places end with before `unreachable` (Zig's `call $panic … unreachable`), upstream's `optimizeTerminatingTails` | `3b159e5af` `d9c9bae05` | 148,211 (+6.6%) | 823,349 |
| 3 | RemoveUnusedModuleElements empties a slot of a table only this module sees that no `call_indirect` of its signature can reach (Zig's vtables) | `45a1c1bc9` `c16ef7a5a` | 146,667 (+5.5%) | 823,322 |
| 4 | MergeSimilarFunctions (new, -Oz): functions differing only in constants share one body, each a thunk | `c7afe86a8` `f7b23bd8a` | **145,859 (+4.9%)** | **822,964 (+1.60%)** |

Per module after: rust-debug +2.7%, rust-release +0.4%, zig-debug **+14.0%** (from +31.1%),
zig-releasefast +2.3%, tinygo +0.8% / 0.0%. At -O2 the six are **+1.5%** (from +6.3%; zig-debug
+3.6% from +16.8%), and our -Oz is now smaller than our -O2 (145,859 vs 146,481).

**Defects found on the way, all fixed:**
- **A shipped crash** (1.11.0 – 1.12.1): `deepKey` wrote each `catch` clause as plain JSON, so a
  legacy `try` ending both arms of an `if`, with an `i64.const` in a catch body, made the optimizer
  THROW at -O2 and above ("cannot serialize a BigInt"; reproduced on the pre-item-30 tree). Found
  when step 4 keyed whole bodies and the gate's `optimize-corpus` failed ten legacy-EH modules.
  `f7b23bd8a`; `code_folding_tails.test.ts` holds the CodeFolding case.
- `Func.locals` is EVERY local, parameters first: step 4's first shared function wrote 0 locals
  (invalid, caught by `wasmOpt`'s own validation), and step 3 had dropped an emptied function's
  parameter entries (no byte changed; `c16ef7a5a`).
- Table references inside code may be by INDEX: step 3's first version threw on `table.get 0`
  (caught by its own test before merging).

**What is left** (re-ranked on the result; control 144,254 vs upstream 139,068 on the six):
remove-unused-brs 1,361 (zig-debug 1,140) · simplify-locals 906 · dae-optimizing 816 (zig-debug
730) · simplify-locals-nostructure 696 · code-folding 406 (its return tails and the tails before
several `br`s, not built) · rse 301 · ssa-nomerge 175 · smaller ones; optimize-instructions now −285
(upstream's makes ours larger). Not built in step 4: upstream's parameterized CALL targets (`call_ref`,
GC only). None of these is an open item; a new one starts from this list.

## Open-work 31: below upstream (from 2026-10-15)

| step | what | commits | six modules -Oz | corpus -Oz |
| --- | --- | --- | ---: | ---: |
| — | start | | 145,859 (+4.9%) | 822,964 (+1.60%) |
| 1 | RemoveUnusedBrs: jump threading (a branch to a block followed by `br $y` goes to `$y`), and RemoveUnusedBrs + RemoveUnusedNames + Vacuum after CodeFolding (item 30's folded tails had left 152 `if (c) (br …)`) | `7a94cf9ab` | 144,444 (+3.9%) | 822,798 (+1.58%) |
| 2 | Effects: two plain memory accesses may change places (both trap only out of bounds; a trap's KIND stays observable, so not upstream's "any two implicit traps") — SimplifyLocals now sinks past loads | `7d19d5ad6` | 143,810 (+3.4%) | 822,780 (+1.58%) |
| 3 | DeadArgumentElimination: a parameter written before any read (its incoming value is dead) goes, and rounds repeat to a fixed point | `90a326d47` | 143,271 (+3.1%) | 822,764 (+1.58%) |
| 4 | Local2Stack in the writer (upstream's StackIR at -O3/-Os/-Oz): a set and its one read are left out when the value can stay on the stack; `Module.optimizeStack`, `WriteBinaryOptions.stackIR` | `b77da39c2` | 142,587 (+2.6%) | 822,460 (+1.54%) |
| 5 | ConstantPropagation removes a write of the constant the local already holds (upstream's rse, for constants); the first version's identity bug caught by the -Oz fuzz, fixed before merging | `36350ec4e` `e395e296d` | 142,317 (+2.4%) | **816,938 (+0.86%)** |
| 6 | CodeFolding folds tails before a `return` too (Zig restores its stack pointer before every return); rust-release now BELOW upstream (−0.3%) | `9e2527f49` | 142,115 (+2.2%) | 816,932 (+0.86%) |
| 7 | MEASURED, NOT KEPT: SSANoMerge (a set whose every reader reads only it gets a fresh local, before the function passes at -O3/-Os/-Oz) gave −26 on the six and **+48** on the corpus, and was reverted. Kept: the exact local graph (reaching definitions) moved to `passes/local-graph.ts` for reuse. 🔧 Its merge message says "all 27 steps": the gate ran 16 (`gate.ts --full` with no scratch path read `--full` AS the path); the full gate on step 8, which carries step 7's code, is green | (refactor only) | (142,089) | (816,980) |
| 8 | What a SECOND run of our own -Oz found (corpus −1.5 KB, then −2.9 KB more on a third): **PrecomputePropagate** (new pass: ConstantPropagation + Precompute to the fixed point, replacing two fixed rounds; and again after SimplifyLocals, which sinks constants into their uses) — corpus 816,241 alone; and **three rounds of DAE + Inlining + the function passes** (a function the round before shrank is inlinable now) — 812,485. A fourth round: −71, not kept. -O2+ about a third slower | this step | 141,857 (+2.0%) 🔧 | **812,485 (+0.31%)** |
| 9 | The control, diffed on zig-debug: upstream's BARE round trip alone shrinks our -Oz (−321 at -O2, −405 at -Oz, 0 at -O0) — its WRITER never emits code after a terminator, and ours held some, where DCE never looked. **DCE descends into operands** (a block in `(local.tee (block …))`, as stack code reads back, was never visited) and **trims after a construct that never reaches its `end`** (a block / `if` / `try` / `try_table` no branch targets, or a loop, every path ending in a terminator; the tail becomes ONE `unreachable`, since the stack after an `end` is not polymorphic). Attributed: no descent = main exactly; no structural tails = six 141,341. Measured, not kept: DCE to a fixed point (six +19, corpus 0). `branchTargets` shared in `ir/walk.ts` | `46732e907` | **141,018 (+1.4%)** (zig-debug 38,123 → 37,306) | **812,093 (+0.26%)** |

🔧 **Step 8's six-module figure:** `main` after step 8 measures **141,905**, by passrank's code-byte
count (`passrank10.log` says the same) and by `six.ts`; the 141,857 in its row is not reproduced.
Step 9's −887 is against 141,905. Upstream 133 -Oz on the six: 139,068 by that count.

**After step 9** (passrank, scratch `gap/passrank11.log`): the control row is now 94 below ours
(140,924 vs 141,018; was 977), so a second pass of upstream's reader and writer no longer hides much.
What upstream's passes still find on our -Oz: ssa-nomerge 288 (ours, step 7, did not pay) ·
code-folding 282 · simplify-locals 270 · remove-unused-brs 253 · merge-blocks 161 (was 52) ·
merge-locals 74 · remove-unused-names 65 · rse 62 · …; optimize-instructions −136.

| step | what | commits | six modules -Oz | corpus -Oz |
| --- | --- | --- | ---: | ---: |
| 10 | merge-blocks, attributed per function (scratch `passfn.ts`): its head-hoisting. **Vacuum moves a NAMED block's head out** — the leading statements before the first that names its label or has a value type, the last child kept — and our passes then collapse the block (`block { if … br } …` → an `if`). Caught by the corpus before merging: a void statement need not be stack-neutral (`(local.set $a (call $two))` leaves a result for a later `pop`), so nothing moves out of a block holding a `pop` | `7e6d94128` | **140,885 (+1.3%)** | **812,064 (+0.26%)** |

**After step 10** (`gap/passrank12.log`): merge-blocks 161 → 16; control 104 below ours
(140,781). Left: ssa-nomerge 288 · code-folding 285 · simplify-locals 270 · remove-unused-brs 251 ·
merge-locals 74 · remove-unused-names 67 · rse 62 · simplify-locals-nostructure 52 · vacuum 38 · …;
optimize-instructions −137.

| step | what | commits | six modules -Oz | corpus -Oz |
| --- | --- | --- | ---: | ---: |
| 11 | code-folding, attributed per function: the shape item 30 left unbuilt. **CodeFolding folds the tails before a block's branches** (upstream's `visitBlock`): what every way into a block's `end` ends with — its fall-through and each plain `br` to it, ending its list — goes after the block once. A `br_if` / `br_table` / `br_on_*` to it stops the fold; a tail item is a void statement branching to no label it does not declare, holding no `pop`; not with a `try`; a label declared twice (Inlining copies them) skips only its blocks (refusing the function cost 72 on zig-debug). The first version walked every candidate per round: -Oz 30% slower on the six; indexed once per round, the same time as main | `eab756cf1` | **140,587 (+1.1%)** | **811,997 (+0.25%)** |

**After step 11** (`gap/passrank13.log`): code-folding 285 → 0; control 98 below ours (140,489).
Left: ssa-nomerge 328 (step 7's version did not pay) · simplify-locals 268 · remove-unused-brs 241 ·
merge-locals 74 · rse 62 · remove-unused-names 57 · simplify-locals-nostructure 52 · vacuum 38 · …;
optimize-instructions −133.

| step | what | commits | six modules -Oz | corpus -Oz |
| --- | --- | --- | ---: | ---: |
| 12 | simplify-locals, attributed per function: its STRUCTURE half, which ours never had. **SimplifyLocals gives a block its result from sets** (upstream's `optimizeBlockReturn`): every way out — each plain `br` ending its list right after a set of one local, and the fall-through's set, or none when the block never falls through — becomes the block's result, set once; nested blocks fold in one round; a label declared twice is skipped. Runs once sinking stops (every round: corpus 7–11% slower). **Measured, not kept:** upstream's `if` form (both arms end setting the local), six 0 / corpus **+1,106** — our later passes (CodeFolding's arms, Vacuum's heads) work on VOID constructs. Caught by the corpus before merging: an identity edit after a `mapExpression` that had rebuilt the tree (core_SwitchCase invalid) | `9595a94a4` | **140,395 (+0.95%)** | **811,843 (+0.23%)** |

**After step 12** (`gap/passrank14.log`): simplify-locals 268 → 87, but remove-unused-brs 241 → 310
and simplify-locals-nostructure 52 → 127 — the new block results are shapes upstream's branch passes
use and ours do not yet. Control 105 below ours (140,290). Left: ssa-nomerge 327 · remove-unused-brs
310 · simplify-locals-nostructure 127 · simplify-locals 87 · merge-locals 72 · rse 60 · …;
optimize-instructions −133.

| step | what | commits | six modules -Oz | corpus -Oz |
| --- | --- | --- | ---: | ---: |
| 13 | remove-unused-brs, attributed per function: branches in tail position BELOW the block they name (ours took only that block's own last child). **RemoveUnusedBrs drops branches that flow to their target**: one top-down walk carries the labels whose `end` falling off the current list reaches (a void block adds its own; a void `if` passes them and its own to both arms; a loop passes them to its body, its own label being a back edge; a declared label leaves the set, so a shadowed name never matches). At a list's end a `br` to one goes, a `br_if` to one becomes `(drop cond)`, and `(br_if $a x) (br $b)` becomes `(br_if $b (i32.eqz x))`. Attributed: flowing `br`s −70 / −27, the `br_if` rules −34 / −10. 🔧 The first gate failed spec-behaviour: a branch DISCARDS stack values (`unwind.wast`, invalid at -O2+); a list reaches an end only when all before its last statement leave nothing | `6d23d64e6` `8d2303a1d` | **140,291 (+0.88%)** | **811,806 (+0.22%)** |

**After step 13** (`gap/passrank15.log`): remove-unused-brs 310 → 224; control 104 below ours
(140,187). Left: ssa-nomerge 320 (step 7's version did not pay) · remove-unused-brs 224 ·
simplify-locals-nostructure 127 · simplify-locals 100 · merge-locals 72 · rse 60 · …;
optimize-instructions −133.

| step | what | commits | six modules -Oz | corpus -Oz |
| --- | --- | --- | ---: | ---: |
| 14 | remove-unused-brs again, two shapes. **A block that is the last statement of a void block** sends its branches to that block (jump threading's "a `br $y` right after it", with the parent's own end as `$y`; upstream merges the names): −78 / −15. **Adjacent `br_if`s to one label merge on `i32.or`**, and a `br_if` then an `if` holding only a `br_if` to the same label, through `(select x (i32.const 0) c)` — the later condition must have no effect and not trap (it now runs when the first held): −64 / −64. 🔧 The first gate failed the test step: three fixtures had two `br_if`s side by side only to dodge another rule; each kept on what it is about (a `nop` between, or the assertion it meant) | `a579a328c` `694f7999e` | **140,149 (+0.78%)** | **811,727 (+0.22%)** |

**After step 14** (`gap/passrank16.log`): remove-unused-brs 224 → 125; control 102 below ours
(140,047). Left: ssa-nomerge 325 · simplify-locals-nostructure 129 · remove-unused-brs 125 ·
simplify-locals 102 · merge-locals 72 · rse 62 · vacuum 38 · …; optimize-instructions −121.

| step | what | commits | six modules -Oz | corpus -Oz |
| --- | --- | --- | ---: | ---: |
| 15 | ssa-nomerge, attributed per function (`passfn.ts`; zig-debug −193 in funcs 23 / 22 / 41 / 29): a local the compiler REUSES hides a copy — `local.get 7; local.set 8`, then `(i32.ne (local.get 8) (local.get 7))` guarding a panic, always false. We had no merge-locals at all. **MergeLocals** (new, `merge-locals.ts`, upstream's method): a read of `$b` whose only reaching write is a copy `$b = $a` reads `$a` where a second graph shows `$a` unchanged (the copy instrumented with a tee of `$a`); OptimizeInstructions folds the reflexive comparison. Before the first CoalesceLocals at -O3 / -Oz. **Measured, not kept:** upstream's all-or-nothing per copy (six 0, corpus +3); again before the second CoalesceLocals (0). **`localGraph`** takes the locals to follow and runs gen / kill bitsets: the Map-of-Sets dataflow took MergeLocals 1.72 s on zig-debug (six -Oz 3.3 → 6.9 s); now 3.29 s, corpus 10.89 → 9.53 s; equal to the old graph on 8,208 functions (scratch `graph-eq.ts`). 🔧 The first gate failed four behaviour steps (spec float_exprs `f32.epsilon` 0 at -O3 / -Oz, direct-behaviour 1_fib-rs, the -Oz fuzz): taking the instrumentation out also took a copy that is itself a tee, leaving a refused read of a local nothing wrote; the defect was worth 52 / 96 of the first figures (−173 / −724) | `d0dd41cc0` `e1227b41f` `0ebfb4e7a` | **140,028 (+0.69%)** | **811,099 (+0.14%)** |

🚨 **Step 4's Local2Stack computed WRONG results on real compiler output, steps 4–15** (found
2026-10-20 at 1.13.0's release check, before anything was pushed; never released, 1.12.1 is
correct). Re-running `benches/browser-opt/measure.ts` for the release: rust-debug -Oz returned a
different checksum and zig-releasefast -Oz trapped out of bounds, in Chrome, Firefox and WebKit
alike; -O3 / -Os / -Oz, never -O2 (the levels `optimizeStack` is set at). Bisected over main's
merges (scratch `commit-bisect.ts` + `six-run.ts`) to `5a8ab6fdb`, confirmed by writing the same
optimized module with `optimizeStack` on and off. **The defect:** the stack walk took every
candidate as a pair and went on as if both were left out; the pairs the local graph rejects were
dropped only AFTER the walk, so a kept pair left a later, exact one taken on a stack that does not
exist (`set $c … set $d … get $c … get $d` with only (d) exact: `get $c` written above `$d`'s
value). Upstream judges at the get. Fixed in `9da703316` (merge `065f8dd54`): six -Oz 140,028 →
140,032, corpus unchanged. **Why nothing caught it:** this item measured the six by COMPILING
them (`six.ts` instantiates nothing), and the behaviour gates replay the spec suite and the
corpus, where no function had the shape. `real_compiler_behaviour.test.ts` (new, in `bun run
test`) now runs the six's workload at -O1 … -Oz against the original's checksum.

🔧 **The cost in time, measured 2026-10-20 against a `v1.12.1` tree** (scratch `timeit.ts`, best of
3, the same machine): corpus -Oz 3.95 s → 10.43 s (2.6×), -O2 4.85 s → 9.91 s (2.0×), -O1
1.75 s → 1.95 s; the six -Oz 1.35 s → 3.23 s. The per-step notes ("-O2+ about a third slower",
step 8) were each against the step before, and the record's "8 s" start was never measured on
1.12.1. At -O2 the six are now **−2.1%** against upstream 133 (`gap.ts --level=O2`: 141,264 vs
144,257), from +1.5% at item 30's close: steps 1–15 pay at -O2 too.

**After step 15** (`gap/passrank17.log`): merge-locals 72 → 2, ssa-nomerge 325 → 249, rse 62 →
34; simplify-locals-nostructure 129 → 142 and simplify-locals 102 → 119 (the redirected reads are
sinking ours does not do yet). Control 89 below ours (139,939). Left: ssa-nomerge 249 ·
simplify-locals-nostructure 142 · remove-unused-brs 125 · simplify-locals 119 · vacuum 63 ·
local-cse 36 · precompute-propagate 35 · rse 34 · …; optimize-instructions −122. Not built: func
41's second mechanism (panic tails that become identical once upstream re-allocates locals, then
fold).

| step | what | commits | six modules -Oz | corpus -Oz |
| --- | --- | --- | ---: | ---: |
| 16 | ssa-nomerge, attributed per function (zig-debug 161; func 23 94): Zig reuses a local across panic checks, so equal `call 7; unreachable` tails read different locals and CodeFolding cannot fold them (33 sites, 26 once re-assigned) — func 41's "second mechanism" above. **SSANoMerge** (new, `ssa-nomerge.ts`, upstream's SSAify without merges): a set of a local with more than one definition gets a fresh local unless one of its readers may read another definition; a read whose only definition is a renamed set follows it. Left alone: a local in SSA form already, a function with `try` / `try_table`, a local with a read no path reaches, one with a node in two places (a defence; no text input makes one). First in the function passes at -O3 / -Os / -Oz, as upstream. **Measured, not kept:** before the first CoalesceLocals only, −108 / +6; followed at once by CoalesceLocals, +10 / +1,860. **Run speed** (`speed.ts`): V8 0.0%, JavaScriptCore −0.9%, each module within ±2%, the same results. Optimizer time: zig-debug -Oz 1.7 → 2.9 s, PrecomputePropagate over the extra locals until they coalesce (0.65 → 1.68 s). 9 cases, 7 mutants; the first "unreached read" mutant was equivalent (it threw, and the pass's catch kept the function) | `fa30d47cf` | **139,857 (+0.57%)** | **811,071 (+0.13%)** |
