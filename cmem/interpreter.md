# The interpreter, the evaluator, `wasm-ctor-eval` and `wasm-interp` — open-work item 23, closed

**Closed 2026-10-08.** Opened by the owner 2026-09-30 ("could an interpreter precompute DATA
OBJECTS — memory, globals, what a program builds at start — as part of optimization?"), built
2026-10-07 → 2026-10-08 in stages E1–E4, each gated and merged on its own. This file is the summary
the cleanup policy asks for ([INDEX.md](INDEX.md)); the full stage-by-stage record as it stood
before the cut is one command away: `git show 0496ac247:cmem/open-work.md` (item 23, E1–E3e). The
E4 record is here in full.

## What landed, and where it lives

| stage | what                                                                                       | commit      | lives in                                                                                     |
| ----- | ------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------- |
| E1    | the evaluator's numeric core: every scalar operator, exact, a trap a RESULT                | `ec500c2d4` | `src/binaryen-ts/interp/numeric.ts`; `numeric_differential.test.ts` (V8, 136 ops, coverage)  |
| E2    | `Precompute`, on it; ONE fold rule (`foldedLiteral`) shared with OptimizeInstructions      | `7d94884f5` | `passes/precompute.ts`; `precompute.test.ts`                                                 |
| E3a–d | the interpreter: numbers, control, calls; memory; tables, references, tail calls; EH; GC   | `809b1d42d` `2a0416b20` `44b3b3ea5` `731e4b060` `1d1d53cbd` | `interp/interpreter.ts` `memory.ts` `table.ts` `types.ts`; `interpreter.test.ts`; `scripts/check-interp.ts` |
| E3e   | `v128`: every SIMD operator, relaxed SIMD deterministically, SIMD loads / stores; wide arithmetic | `ea25476cb` `6da1eae56` | `interp/simd.ts`; `simd_differential.test.ts`                                        |
| E4    | `wasm-ctor-eval` and `wasm-interp`, CLI commands and `./tools/*` subpaths                   | `3f9aa6494` `9990e1e66` | `tools/wasm-ctor-eval.ts` `tools/wasm-interp.ts`; `wasm_ctor_eval.test.ts` `wasm_interp.test.ts` |

**One semantics.** OptimizeInstructions, Precompute, the interpreter and `wasm-ctor-eval` all compute
through `numeric.ts` / `simd.ts`; `foldedLiteral` is the one rule for WHETHER a pass may fold: never
a trap, a NaN only from a bit-exact operator (a NaN lane likewise), never a relaxed-SIMD operator.

**The gate.** `deno task interp` runs the interpreter against the spec testsuite's own assertions
on six corpora, the manifest as oracle ([working-rules.md](working-rules.md) § "The gate"). At the
close: core **57,608 pass, 0 FAIL, 40 stopped** (15 expected `funcref` values, shared-state taints,
two 2^31-element arrays); legacy 70 / 0 / 0; custom-descriptors 170 / 0 / 317 (descriptor
operations stop); custom-page-sizes 31 / 0 / 0; threads 80 / 0 / 187 (shared memory stops);
wide-arithmetic 99 / 0 / 0. What still stops: atomics and shared memory, custom descriptors.

## Decisions

- **Opt-in, never part of `-O`** (owner, 2026-09-30, as upstream): `wasm-ctor-eval` is a tool;
  `--ignore-external-input` assumes empty arguments and environment and zero parameters — the
  caller's decision about the deployment.
- **The owner's question — which combination of `wasm-ctor-eval` and `wasm-interp` — MEASURED
  (2026-10-08, 421 corpus modules, 419 export `_start`, `--ctors=_start --kept-exports=_start
  --ignore-external-input`):** ours -Oz 847,023; ctor-eval then -Oz 790,206 (−56,817); **-Oz,
  ctor-eval, -Oz 788,198 (−58,825, 6.9%)** — evaluate AFTER an optimisation and optimise again. Without
  the second -Oz the output is LARGER (the cut constructor is a copy beside the original until
  RemoveUnusedModuleElements). `_start` under deterministic WASI stubs (the host transcript, the
  exit, a memory hash) agrees on all 419 across the three. `wasm-interp` is the interpreter as a
  CLI; it plays no part in the size. Scratch: `measure-ctor.ts` / `measure-ctor-worker.ts`,
  `calib.ts` (lost with the session; the method is in the E4 commit).
- **Calibration against upstream `wasm-ctor-eval` (binaryen 133, scoop shim), same input, same
  -Oz after:** 780,818 (−66,205) — **7.4 KB further than ours**; all 419 handled, every output valid.
  Where it is: code (upstream 649,106 vs ours 656,026 after -Oz on 2026-10-08's first pass; data
  since matched by the initial write-back and the 8-byte packing gap). Not attributed further; a
  candidate for item 2's round, not a defect.
- **Relaxed SIMD in the interpreter is the deterministic choice** (owner, 2026-10-07): the
  saturating truncations and `q15mulr`, FUSED `madd` / `nmadd` (exact through `bigint`), `bitselect`
  for `laneselect`, `min` / `max`, `swizzle`, every dot-product lane signed. Upstream binaryen's
  interpreter computes the same on each (`literal.cpp`), except its `nmadd` is unfused —
  [divergences.md](divergences.md) F3. The harness accepts ANY alternative of an `either`; the
  suite's `either` lists are not a profile (on three assertions ours is a later alternative).
- **`wasm-ctor-eval`'s cut** is always at a statement boundary with an EMPTY operand stack, after a
  snapshot; the state written back is the snapshot, never what a failed statement left. A snapshot
  is written only if every value can be (numbers, vectors, nulls, this module's function
  references): a table that changed, a passive segment dropped, a GC object in a global or local
  stop it at the boundary before. **No constructor is evaluated after one that did not complete**
  (its remaining code runs at start, AFTER anything written back). The state at instantiation is
  written back first, whatever follows (memory repacked, initialisers folded) — upstream flattens
  memory first for the same effect. A module with an imported memory or table is returned untouched.

## Defects found along the way (all fixed in the stage's commit)

- E1: `f64.ceil` / `floor` returned a signalling NaN unchanged (V8 differential, first run).
- E3a: the exhaustion check overflowed in its own regex at the stack's limit; an imported mutable
  global was copied, not shared. E3b–E3d: the custom-descriptors and legacy corpora each found a
  defect the core corpus was green on (recorded in the full text).
- E3e: `fma` dropped a product that UNDERFLOWS to zero (2^-1000 × 2^-75) before the exact path —
  found only when the unit test's expected value, itself computed with the same underflowing
  `2 ** -1075`, was rewritten by hand.
- E4: `wasm-ctor-eval` evaluated a second constructor onto the boundary state of a first that
  did not complete, and the first's remainder overwrote it at start (the test found it).
- E4, in the OPTIMIZER: the spill before the passes made an invalid module of a binaryen-written
  body — a pop replaced by a `local.get` ahead of a tuple's pop that stayed; the `local.get` pushed
  its value on top of what the later `local.tee` was to take. Found on upstream's ctor-eval output;
  the rule now: a pop that stays keeps every pop evaluated before it (`9990e1e66`,
  [unreleased.md](unreleased.md)). Corpus bytes unmoved.

## Lessons (for [best-practices.md](best-practices.md) if they recur)

- **A harness mutant needs a defect to judge** — mutate the judge and the judged together (E3e's
  two harness-judgement mutants survived alone, as they must on a correct interpreter).
- **An expected value computed in the arithmetic under test shares its defects** — write the
  expectation by hand, or from a different arithmetic (the `fma` underflow).
- **A tool's premise is not observable before it holds**: a program whose constructor was pre-run
  cannot be compared with the original BEFORE the constructor; two test cases were wrong that way.
- **Measure with validation on** — the first calibration counted invalid output as a size.

## For the owner

- ⚠️ Should a `wasm-ctor-eval` behaviour check join the gate? Today it is a scratch script
  (`measure-ctor.ts`: `_start` under WASI stubs on A, B, C, 0 DIVERGE on 419); the unit tests run
  each case before and after under V8, but no gate step runs the tool over the corpus.
- The 7.4 KB upstream's ctor-eval finds beyond ours (after the same -Oz) is unattributed.
