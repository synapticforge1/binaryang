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

## Lessons

- **A written estimate that adds two measurements is wrong** — "propagation ~7.7 KB" assumed
  `precompute-propagate` − `precompute`; they do not add (2026-10-07).
- **A per-pass number without its control is the control**: upstream's reader and writer reshape
  our code on the way through, and later passes exploit it; measure the bare round trip first.
- **A guard the pipeline makes unreachable still documents a hazard for a direct caller**; say
  so in the test instead of pretending the mutant can be caught.
- **Labels are compared by position, never by name**, when two subtrees are asked whether they
  are the same code: the reader names every block and `if` it reads.
