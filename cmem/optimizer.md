# The size gap to upstream `wasm-opt -Oz` — open-work item 2, closed

**Closed 2026-10-08 at 1.86%** — ours 825,077 bytes to upstream's 809,986 (binaryen 133) over
the 421 corpus modules at -Oz; the owner's "Done when" (2026-10-06) was ≤ 2%. Opened 2026-09-19
at **109.5 KB (13%)**, "mostly COVERAGE": passes we lacked. This file is the summary the cleanup
policy asks for ([INDEX.md](INDEX.md)); the full step-by-step record as it stood before the cut
is `git show be911aa05:cmem/open-work.md` (item 2, lines 63–409).

## What landed, in order, with its commit and corpus -Oz bytes

| step | what                                                                                    | commit      | -Oz after       |
| ---- | --------------------------------------------------------------------------------------- | ----------- | --------------- |
| 1    | CoalesceLocals coalesces copies, as upstream                                            | `0be183b85` | 908,932         |
| 2    | RemoveUnusedTypes, last at every level (the "encoder gap" was unused types, item 6)      | `573afe238` | 898,608         |
| 3a   | OptimizeInstructions: the shapes upstream still found on our output (narrow stores, `eqz` arms, gathered constants) | `db8e87d91` | 888,759 |
| 3b   | SimplifyLocals sinks a set into its only read, on a shared effect analysis (`ir/effects.ts`) | `32ade3c13` | 874,595    |
| 3c   | RemoveUnusedBrs: tail `return`, cheap `if` → `select`, `if (c) br` → `br_if`            | `149415e1d` | 872,500         |
| 4a   | the schedule re-runs what later passes expose (CoalesceLocals again after SimplifyLocals) | `bd7fd5a5b` | 869,600       |
| 4b   | DeadArgumentElimination (new)                                                           | `e8946f04c` | 864,285         |
| 5    | Inlining at upstream's rules and schedule, the function passes again after it           | `18b645f03` | 859,534         |
| —    | LocalCSE rewritten (items 3–5): any repeated read-only or trapping expression           | (items 3–5) | 856,554         |
| —    | ConstantPropagation (new; a read with one reaching constant becomes it)                 | `a99676678` | 854,227         |
| —    | item 23's E1 / E2: OI folds through the evaluator; Precompute (new)                     | `ec500c2d4` `7d94884f5` | 847,329 |
| 6a/b | Vacuum splices unnamed blocks; a block opening with a `br_if` to itself is an `if`      | `bca05a0db` | 840,079         |
| 6c   | CodeFolding (new): what both arms of an `if` end with, written once                     | `a754e5ee8` | 836,929         |
| 6d   | a read of an immutable constant global is its constant; DAE again before Inlining       | `5ad2ec1ad` | 833,291         |
| 6e   | MemoryPacking (new): the data segments as the fewest bytes that build the same image    | `3eac51231` | **825,077**     |

Upstream's own number moved under us: 816,485 with binaryen 132 (to 2026-10-07), 809,986 with
133 (its -Oz got 6.5 KB better); every gap figure names the version it was measured against.

## The method

- **The gap is measured on the same ORIGINAL modules**: `wasm2wat`'s bytes (no text-form
  section) through ours and through upstream, by section (`gap.ts`, scratch; its method: `wasm-opt`
  with the explicit `--enable-*` list, never `-all`, which turns on compact imports our reader
  refuses). Re-derived after every step.
- **What each upstream pass would still save**: the pass alone on OUR -Oz output, then our -Oz
  again — **against the proper control, upstream's bare read-and-write of our output then our
  -Oz**, which saved 4,400 on its own (ours run twice: 2,098). Every per-pass number carries
  that; the first re-rank (2026-09-30) and this round's both mis-ordered the work until it was
  subtracted. Per-opcode attribution of what a pass changes (`opdelta.ts`) is what turns a number
  into a shape to build: the bare re-encode's whole effect was −1,323 unnamed blocks (6a); the
  `precompute` 6.7 KB was mostly that re-encode and loop shapes, not evaluation.
- **Count the shapes before building** (`brshapes.ts`, `memshapes.ts`): 2,529 loops tested their
  exit with a leading `br_if` (6b); upstream's loop flip existed 4 times (not built); 421 / 421
  modules were eligible for packing, 1,381 segments → 390 (6e).
- **The small modules with the largest per-module gap are the cheapest to read** (`1_if-else`
  +1,180 → the immutable-global fold, 6d; `1_switch` +804 is unread).
- **Every step gated and merged on its own**: the corpus at every level, the behaviour gates
  (`spec-behaviour` 57,808 invocations / 0 DIVERGE, `direct-behaviour` 1,953 calls / 0 DIVERGE),
  a test per step that RUNS each case before and after, mutants inverted.

## Decisions kept

- **Done when ≤ 2% of upstream `-Oz` on the originals** (owner, 2026-10-06) — not "match
  upstream": upstream also keeps 6.5 KB of custom sections we drop and writes a DataCount we do
  not, and its writer emits an `unreachable` after every loop that never falls through.
- **Inlining only after the cleanups** (owner-agreed 2026-09-30): the 2026-09-30 probe grew -Oz
  by 0.5–4.4 KB; after steps 1–4 it paid (−4.8 KB at -Oz, −17% at -O3).
- **Constant propagation is item 2's, evaluation item 23's** (owner, 2026-10-06); the two share
  one evaluator and one fold rule ([interpreter.md](interpreter.md)).
- **`wasm-ctor-eval` is outside this gap** (opt-in; [interpreter.md](interpreter.md)).
- **Two guards unobservable through the runner are kept as defence**: CodeFolding's `pop` guard
  (the spill makes every stack value a local first) and 6b's block-parameter guard
  (`lowerBlockParams` runs first). A rule against branches to an arm's other labels was dropped
  as dead: a label is in scope only inside its own construct.
- **Not built**, each measured as small or absent on this corpus: upstream's loop flip (4 shapes),
  CodeFolding's tails before several `br`s to one block and `return` tails, MemoryPacking for
  passive or bulk-memory segments, `rse` (not in upstream's -Oz either), SimplifyGlobals (the
  immutable-global fold took its measurable part), merge-blocks' rest.

## What the last 15.1 KB is (2026-10-08, by section, ours − upstream)

code **+20,390** · data −5,381 (ours is the smaller since 6e) · datacount −798 · global +116 ·
import +630 · type +59 · table +30 · element +47. Functions 2,704 / 2,663. The code is in a few
large modules (`38_Phase38Combined` +1,450, `1_fib-rs` +1,008, `1_switch` +804 — its `_start` is
921 lines to upstream's 703) and is unattributed; the ranked candidates after 6e, from the
re-rank over the control: `rse`-like redundant sets (−922 `local.set` in upstream's delta),
`simplify-globals`' remainder, the loop flip. Upstream's `wasm-ctor-eval` also finds 7.4 KB more
than ours on the same input ([interpreter.md](interpreter.md)) — a separate matter.

## Real compiler output, in three browsers (2026-10-13, open-work 28.6)

`bun benches/browser-opt/measure.ts`. One workload (Mandelbrot, an LCG fill, a sort, FNV;
`run(300) -> i32`) from rustc nightly, Zig 0.16 and TinyGo 0.43, unoptimized and optimized: six
committed modules (`benches/browser-opt/modules`, made by `build.ts`). binaryang's `wasmOpt` ran IN a
module Web Worker in Chrome 154, Firefox 155 and Safari's engine (WebKit 26.6), through Playwright;
upstream `wasm-opt` 133 made the reference on the host, with `--strip-dwarf` (it dies on zig-debug's
DWARF otherwise: "Fatal: TODO: DW_LNE_define_file"). Medians of 5, a fresh instance per run.

**Code bytes** (everything outside custom sections). The debug builds are mostly DWARF, which
binaryang keeps, as upstream does by default (rust-debug `-O2` without `-g`: 1,636,434 bytes), so
total size compares debug info. Sizes are the same in every browser; the percentage is ours against
upstream at the same level.

| module          | original | ours -O2 | upstream -O2 |      | ours -Oz | upstream -Oz |      |
| --------------- | -------: | -------: | -----------: | ---: | -------: | -----------: | ---: |
| rust-debug      |   51,752 |   43,844 |       42,857 | +2.3% |   43,919 |       42,316 | +3.8% |
| rust-release    |   19,836 |   17,879 |       17,578 | +1.7% |   17,876 |       17,524 | +2.0% |
| zig-debug       |   64,910 |   47,237 |       40,436 | +16.8% |   47,335 |       36,113 | +31.1% |
| zig-releasefast |   20,408 |   20,048 |       19,112 | +4.9% |   20,048 |       18,883 | +6.2% |
| tinygo-opt1     |   12,996 |   12,958 |       12,930 | +0.2% |   12,958 |       12,848 | +0.9% |
| tinygo-optz     |   11,389 |   11,382 |       11,392 | −0.1% |   11,382 |       11,384 | 0.0% |

**binaryang's optimize time in the browser, -O2** (Chrome / Firefox / Safari, ms): rust-debug
321 / 551 / 384; rust-release 85 / 182 / 100; zig-debug 712 / 1,662 / 871; zig-releasefast
137 / 379 / 172; tinygo-opt1 90 / 171 / 76; tinygo-optz 60 / 98 / 60. -Oz within 15% of these.

**What it shows:**

- **Correct everywhere:** 4 optimized variants × 6 modules × 3 engines, every checksum equal to
  the original's.
- **No run-time speedup, from anyone's optimizer:** the workload's time is the same within the
  timer's resolution (Firefox and Safari clamp to 1 ms) for the original, ours and upstream's, even
  for the debug builds (Chrome, rust-debug: 11.0 / 11.0 / 10.8 ms). The engines' optimizing tiers
  already do the work. `WebAssembly.compile` is under 2 ms for every variant. What optimizing in the
  page buys here is BYTES (smaller to cache and pass on), not speed. That is the measurement behind
  28.6's decision.
- **Two gaps the corpus did not show** (item 2 closed at 1.86% of upstream -Oz on the corpus):
  binaryang's `-Oz` is no smaller than its `-O2` on any of the six (upstream's -Oz saves 10.7% on
  zig-debug), and on zig-debug our -O2 code is 16.8% larger than upstream's. Open-work 30 (closed
  2026-10-15, below).
- **Limits:** one workload, a few ms long; the run-time result says "no speedup on this kind of
  code", not "never".

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
| 1 | OptimizeInstructions knows a value's bits: `and(x, 2^n-1)` → `x` when `x` fits; `eqz(cmp)` → the inverse integer comparison; `x op x` of a local is a constant | `6958502cc` | 150,181 (+8.0%) | 823,398 |
| 2 | CodeFolding writes TERMINATING tails once: what several places end with before `unreachable` (Zig's `call $panic … unreachable`), upstream's `optimizeTerminatingTails` | `a1b07e9f3` `159715c50` | 148,211 (+6.6%) | 823,349 |
| 3 | RemoveUnusedModuleElements empties a slot of a table only this module sees that no `call_indirect` of its signature can reach (Zig's vtables) | `a676e31a9` `9c5655cff` | 146,667 (+5.5%) | 823,322 |
| 4 | MergeSimilarFunctions (new, -Oz): functions differing only in constants share one body, each a thunk | `49c730b76` `4a19c39a2` | **145,859 (+4.9%)** | **822,964 (+1.60%)** |

Per module after: rust-debug +2.7%, rust-release +0.4%, zig-debug **+14.0%** (from +31.1%),
zig-releasefast +2.3%, tinygo +0.8% / 0.0%. At -O2 the six are **+1.5%** (from +6.3%; zig-debug
+3.6% from +16.8%), and our -Oz is now smaller than our -O2 (145,859 vs 146,481).

**Defects found on the way, all fixed:**
- **A shipped crash** (1.11.0 – 1.12.1): `deepKey` wrote each `catch` clause as plain JSON, so a
  legacy `try` ending both arms of an `if`, with an `i64.const` in a catch body, made the optimizer
  THROW at -O2 and above ("cannot serialize a BigInt"; reproduced on the pre-item-30 tree). Found
  when step 4 keyed whole bodies and the gate's `optimize-corpus` failed ten legacy-EH modules.
  `4a19c39a2`; `code_folding_tails.test.ts` holds the CodeFolding case.
- `Func.locals` is EVERY local, parameters first: step 4's first shared function wrote 0 locals
  (invalid, caught by `wasmOpt`'s own validation), and step 3 had dropped an emptied function's
  parameter entries (no byte changed; `9c5655cff`).
- Table references inside code may be by INDEX: step 3's first version threw on `table.get 0`
  (caught by its own test before merging).

**What is left** (re-ranked on the result; control 144,254 vs upstream 139,068 on the six):
remove-unused-brs 1,361 (zig-debug 1,140) · simplify-locals 906 · dae-optimizing 816 (zig-debug
730) · simplify-locals-nostructure 696 · code-folding 406 (its return tails and the tails before
several `br`s, not built) · rse 301 · ssa-nomerge 175 · smaller ones; optimize-instructions now −285
(upstream's makes ours larger). Not built in step 4: upstream's parameterized CALL targets (`call_ref`,
GC only). None of these is an open item; a new one starts from this list.

## Open-work 31: below upstream (from 2026-10-15)

The owner: "Work the list to a target, but remove the 2% limit. Lets see how much more than upstream
we can actually optimize." Start: six modules -Oz 145,859 (+4.9%), corpus -Oz 822,964 (+1.60%).

| step | what | commits | six modules -Oz | corpus -Oz |
| --- | --- | --- | ---: | ---: |
| — | start | | 145,859 (+4.9%) | 822,964 (+1.60%) |
| 1 | RemoveUnusedBrs: jump threading (a branch to a block followed by `br $y` goes to `$y`), and RemoveUnusedBrs + RemoveUnusedNames + Vacuum after CodeFolding (item 30's folded tails had left 152 `if (c) (br …)`) | `8a91144e0` | 144,444 (+3.9%) | 822,798 (+1.58%) |
| 2 | Effects: two plain memory accesses may change places (both trap only out of bounds; a trap's KIND stays observable, so not upstream's "any two implicit traps") — SimplifyLocals now sinks past loads | `c083bcf97` | 143,810 (+3.4%) | 822,780 (+1.58%) |
| 3 | DeadArgumentElimination: a parameter written before any read (its incoming value is dead) goes, and rounds repeat to a fixed point | `90d200ec5` | 143,271 (+3.1%) | 822,764 (+1.58%) |
| 4 | Local2Stack in the writer (upstream's StackIR at -O3/-Os/-Oz): a set and its one read are left out when the value can stay on the stack; `Module.optimizeStack`, `WriteBinaryOptions.stackIR` | `f69843225` | 142,587 (+2.6%) | 822,460 (+1.54%) |
| 5 | ConstantPropagation removes a write of the constant the local already holds (upstream's rse, for constants); the first version's identity bug caught by the -Oz fuzz, fixed before merging | `1f1282029` `e3434bbf1` | 142,317 (+2.4%) | **816,938 (+0.86%)** |
| 6 | CodeFolding folds tails before a `return` too (Zig restores its stack pointer before every return); rust-release now BELOW upstream (−0.3%) | `634237a60` | 142,115 (+2.2%) | 816,932 (+0.86%) |

**Measuring note (step 4):** a first "stack-IR prize" of 5 KB on the corpus was upstream's
compact-imports encoding, which `--all-features` switches on (20 bytes on a typical module's import
section). Item 2's rule stands: never `-all` against the corpus; `--disable-compact-imports` with it.
The six real-compiler modules are unaffected (no import-section difference).

## Lessons

- **A written estimate that adds two measurements is wrong** — "propagation ~7.7 KB" assumed
  `precompute-propagate` − `precompute`; they do not add (2026-10-07).
- **A per-pass number without its control is the control**: upstream's reader and writer reshape
  our code on the way through, and later passes exploit it; measure the bare round trip first.
- **A guard the pipeline makes unreachable still documents a hazard for a direct caller**; say
  so in the test instead of pretending the mutant can be caught.
- **Labels are compared by position, never by name**, when two subtrees are asked whether they
  are the same code: the reader names every block and `if` it reads.
- **A helper's branch no test reached is a shipped bug waiting for a wider caller** (open-work 30):
  `deepKey`'s `catches` branch had never run, until whole function bodies were keyed — and its
  first caller could reach it too. Before reusing a helper on a bigger scope, run its every branch.
- **A tree node may sit in two places** (open-work 31 step 5): `mapExpression` hands its callback
  a REBUILT parent, so a rewrite keyed by a parent node's identity never fires — and keying by a
  leaf instead (a constant) hit a constant shared by two writes, and a needed write went. Every
  corpus behaviour gate passed; the -Oz fuzz (`optimize_fuzz.test.ts`) caught it. Rewrite
  top-down with `mapChildrenShallow` when matching nodes the analysis saw.
- **Read a field's convention from its WRITER before building one** (`Func.locals` holds the
  parameters first; the writer skips `params.length` of them): it bit twice in one item.
