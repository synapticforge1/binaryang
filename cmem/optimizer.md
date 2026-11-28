# The size gap to upstream `wasm-opt -Oz` — open-work item 2, closed

The size gap to upstream `wasm-opt -Oz`: the method, the decisions kept, the browser measurement, the current baseline and the lessons.
Last verified 2026-11-25.

**Now (2026-11-25, shipped in 4.2.0): corpus -Oz 810,806 bytes, +0.101% over binaryen 133's
809,986** (Inlining's upstream `inlinedInto` rule, 58c7e3c52; was 811,071, +0.134%); the six
real-compiler modules -Oz 138,410 (+0.573%), -O2 139,865 (−2.09%). These are the size ratchet's
baseline (`scripts/optimize-size-baseline.json`, gate step `optimize-corpus`): growth fails, and
so does a gain until it is recorded (`--update-baseline`).

**Closed 2026-10-08 at 1.86%** — ours 825,077 bytes to upstream's 809,986 (binaryen 133) over
the 421 corpus modules at -Oz; the owner's "Done when" (2026-10-06) was ≤ 2%. Opened 2026-09-19
at **109.5 KB (13%)**, "mostly COVERAGE": passes we lacked. This file is the summary the cleanup
policy asks for ([INDEX.md](INDEX.md)); the full step-by-step record as it stood before the cut
is `git show 058d5ca6e:cmem/open-work.md` (item 2, lines 63–409).

§ What landed, in order, with its commit and corpus -Oz bytes: moved to [archive/optimizer-to-4.1.1.md](archive/optimizer-to-4.1.1.md)
§ Open-work 30: the gaps on real compiler output (2026-10-13 → closed 2026-10-15): moved to [archive/optimizer-to-4.1.1.md](archive/optimizer-to-4.1.1.md) (its "What is left" list too)
§ Open-work 31, steps 1–16 (the step tables and each "After step" ranking except the last): moved to [archive/optimizer-to-4.1.1.md](archive/optimizer-to-4.1.1.md)

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

🔧 2026-10-26: the modules this table measured were REPLACED (open-work 44 — they embedded the
build machine's paths): rust-debug and rust-release are a later nightly's output (originals
50,286 / 19,856 code bytes), and the Zig files carry no DWARF any more, so their total size is
their code bytes. The table stays as the 2026-10-13 record; today's -Oz / -O2 totals are under
§ "Open-work 31", "State 2026-10-26".

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

## Open-work 31: below upstream (from 2026-10-15)

The owner: "Work the list to a target, but remove the 2% limit. Lets see how much more than upstream
we can actually optimize." Start: six modules -Oz 145,859 (+4.9%), corpus -Oz 822,964 (+1.60%).

**The owner's targets, from step 16 (2026-10-22):** "I am not as concerned with the optimization
time cost as the wasm run time cost", then "The goal is smaller file and faster run". A step is
judged by output size AND output run speed; optimizer time is recorded, not a reason to refuse.
Run speed is measured by scratch `gap/speed.ts`: each of the six at -Oz from `main` (a `git
archive` of its `src/`) and from the tree, `run(900)` timed on V8 (Node 24) and JavaScriptCore
(Bun), the median of 21 calls, three trials A / B interleaved, results compared. The browser
benchmark (`measure.ts`) times in whole milliseconds on a 5–11 ms workload: it cannot tell
variants apart.
**After step 16** (`gap/passrank19.log`): ssa-nomerge 229 → 33; control 148 below ours
(139,709). Left: simplify-locals-nostructure 135 · simplify-locals 117 · remove-unused-brs 109 ·
vacuum 63 · local-cse 36 · precompute-propagate 35 · ssa-nomerge 33 · rse 32 · …;
optimize-instructions −118.

**State 2026-10-26 — the six REBUILT (open-work 44), the baseline re-derived.** Five of the
committed modules carried the build machine's paths (user profile, toolchains, project tree) in
their DWARF and in Rust's panic locations — public on GitHub — so they were replaced: the Rust
ones rebuilt with rustc's path remapping (nightly 2026-10-20; the original nightly was never
recorded, so the code moved), the Zig ones with their `.debug_*` sections removed byte for byte
(code bytes unchanged, 64,910 / 20,408 / 19,743), TinyGo untouched. Positive control first: the
OLD modules reproduced step 16's numbers exactly on today's tree (ours 139,857; upstream 133
`-Oz --strip-dwarf -all` 139,068). **New baseline, six -Oz: ours 138,410 vs upstream 137,621
(+0.57%); -O2: ours 139,865 vs upstream 142,855 (−2.1%)** — the gap is unchanged. Originals'
code bytes now rust-debug 50,286 (was 51,752), rust-release 19,856 (19,836); the four others as
before. The corpus was not re-measured (none of its modules changed; 811,071 is still step 16's
claim). **Item 31 resumes from 138,410, not 139,857.** `benches/browser-opt/build.ts` now
remaps, strips and SCANS, and refuses a module that carries a machine path.

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
- **Removing a branch is not free when values are on the stack** (step 13): a `br` or `return`
  discards what earlier statements left; falling through keeps it for the `end`. `_tailReturn`
  learned it from `unwind.wast` in item 2 and the new flowing-branch walk had to again, three
  levels down. Any rule that turns "branch to X" into "fall to X" checks every list on the way.
- **A fixture shaped to dodge one rule breaks when the next rule arrives** (step 14): three
  tests used a second, adjacent `br_if` only to keep a block from becoming an `if`, and the new
  merge took it. Say in the fixture what each extra statement is there FOR, so the next change
  can keep the test on its subject instead of rewriting its assertion.
- **Take instrumentation out by what it IS, not by what it holds** (step 15): MergeLocals' tee
  was found by its inner read, and a bottom-up walk then found the copy (also a tee) holding the
  same read once the instrumentation was gone. The test had a tee copy only where every read
  moved, so the copy's loss changed nothing it ran; a refused read is the case that shows it.
  Test each rewrite with a case where it is REFUSED next to the one where it applies.
- **A measured input must also be RUN** (steps 4–15): the six real-compiler modules were this
  item's yardstick for eleven steps, and every measurement only compiled them. The wrong output
  was in them from step 4; the first thing that ran them, the release's browser benchmark, found
  it. When a module set becomes a target, its workload joins the tests the same day.
- **A rewrite judged after a walk that assumed it** (step 4): a simulation that goes on as if a
  candidate were taken must decide the candidate where it takes it. Filtering afterwards leaves
  every later decision resting on a state that the filter undid.
- **A bitwise result is signed; a `Uint32Array` element is not** (step 15): comparing `(a | b)`
  with the stored word never held once bit 31 was set, and `localGraph`'s worklist never ended
  (exit 127, out of memory, no message). `>>> 0` before comparing.
- **A shape that exists only mid-schedule needs a test through `wasmOpt`** (steps 10, 13): the
  pass alone receives the module already spilled (a value left on the stack arrives `drop`ped),
  so a test of the pass in isolation cannot reach it. Test the spec's own function, every level.
- **Labels are compared by position, never by name**, when two subtrees are asked whether they
  are the same code: the reader names every block and `if` it reads.
- **A helper's branch no test reached is a shipped bug waiting for a wider caller** (open-work 30):
  `deepKey`'s `catches` branch had never run, until whole function bodies were keyed — and its
  first caller could reach it too. Before reusing a helper on a bigger scope, run its every branch.
- **A tree node may sit in two places** (open-work 31 step 5): `mapExpression` hands its callback
  a REBUILT parent, so a rewrite keyed by a parent node's identity never fires — and keying by a
  leaf instead (a constant) hit a constant shared by two writes, and a needed write went. Every
  corpus behaviour gate passed; the -Oz fuzz (`optimize_fuzz.test.ts`) caught it. Rewrite
  top-down with `mapChildrenShallow` when matching nodes the analysis saw. 🔁 **It recurred in
  step 12**: a `mapExpression` that changed NOTHING still rebuilt the tree, and the index built
  before it named nodes no longer there (core_SwitchCase invalid; the corpus caught it). Any
  `mapExpression` between an index and the edits it drives invalidates the index.
- **A construct given a result leaves the passes that only take void ones** (step 12): upstream's
  `if`-result fold is right in upstream's pipeline and cost 1.1 KB in ours, because CodeFolding's
  arms, Vacuum's heads and the branch-tail fold all require `type === None`. Measure a fold that
  changes a construct's TYPE on the whole schedule, not on its own pass.
- **Run the optimizer on its own output before ranking anyone else's pass** (open-work 31, step
  8): passrank's control row (our -Oz again, after upstream's bare round trip) was 1.1 KB below a
  single run, and that was most of every "prize" in the table. A pipeline that is not idempotent
  says its schedule stops short; the second run's diff names where (here: a constant tree made
  after the last Precompute, a function inlinable only once the round before shrank it).
- **Split a round trip by level before blaming a pass** (open-work 31, step 9): upstream's bare
  read-and-write at -O0, -O2 and -Oz (no passes) told the WRITER (StackIR) from the reader in
  three runs: 0, −321, −405 on zig-debug. Then `wasm-tools print` (not `wasm-dis`, which reads into
  Binaryen IR and hides the stack form) on one function showed the shape.
- **A walker that recurses only through control nodes misses control inside OPERANDS** (step 9):
  DCE's `default: return expr` never saw `(local.tee (block …))`, which stack code read back is
  full of. It cost 798 bytes on one module and no test failed. Any pass with a hand-written
  `switch` over control kinds should `mapChildrenShallow` in its default case, or say why not.
- **A void statement is not always stack-neutral** (step 10): after `spillStackValues`, a
  multi-value call's results can be set one statement at a time, the later ones through `pop`.
  Moving any statement across a block boundary must keep a `pop` with its producer; the corpus
  caught it, the behaviour gates would have too, the hand-written test did not reach it (a bare
  `PassRunner` lacks `wasmOpt`'s presets: test through `wasmOpt` when the shape comes from there).
- **Read a field's convention from its WRITER before building one** (`Func.locals` holds the
  parameters first; the writer skips `params.length` of them): it bit twice in one item.
