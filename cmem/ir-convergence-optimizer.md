# IR convergence — the optimizer after One front end

Summary: why R15's block-param lowering is positional, why Flatten was kept, and how `--converge` was designed. Last verified 2026-11-20.
Main note: [ir-convergence.md](ir-convergence.md).

## The optimizer after One front end — records moved from open-work.md (2026-09-29)

Moved here when [open-work.md](open-work.md) was cut back to open items. The blow-by-blow (every
stage-2 item, the M-series and post-M8 tables, the pre-bump items): `git show
3bd64ece7:cmem/open-work.md`, § "Handoff before the pre-bump items".

### R15 — why the block-param lowering is POSITIONAL (merge `f3008cbd6`)

🔑 The first attempt (never merged; recorded in full below, § "The first attempt, as its commit
recorded it") rewrote
each entry `pop` into a read of its local and failed 6 of 8: a `pop` is only "already on the stack"
— an entry value may be consumed deep in an operand, pass straight through (`if.0`'s arm is
`[(pop), (pop)]`: nothing to rewrite), or be carried back by a `br_if` whose values a multi-result
call produces INSIDE its condition (`fac.0`); and a wrapper `block` around `local.set`s of `pop`s
cannot reach the enclosing stack. The tree pass: entry values into locals before the construct,
each region READS them back at its start, `pop`s untouched; a statement holding such a construct or
back-edge in an operand is split into statements (bytes unchanged — a `pop` writes nothing); the
spill (R11'), run AFTER the lowering, nests what it can again; a mixed `br_table` goes through a
trampoline. Its behaviour check found Q1–Q3; the same check over the whole testsuite found Q4–Q8
(all in [divergences.md](divergences.md); `deno task spec-behaviour` is that check, in the gate).
🔑 Two guards in the phantom fix (Q4) exist because a first version broke `fac.0`: a region's
statements are not operands, and a bare `pop` statement is not a phantom — the `fac-ssa` route-A
fixture caught the pair.

#### The first attempt, as its commit recorded it (folded 2026-11-05, open-work 43)

Its only record was the commit message of the local branch `wip/r15-tree-pass` (2026-09-20; id
`91dfb6cc2` after the 2026-10-26 re-parent, `ade9019d6` before; never pushed). What the message
alone held is here; the branch was then deleted on the owner's word (2026-11-05: "proceed with
item 43 then delete the branch after the merge is accomplished"). Its patch survives only in the
machine-local backup bundles under `cmem/local/backups/` (the pre-item-46 bundle holds the
`91dfb6cc2` ref, the pre-H19 bundle the `ade9019d6` one).

- **What it changed** (3 files, +263 / −66): `lower-block-params.ts` rewritten as a tree pass —
  entry values to fresh locals, each `pop` standing for parameter `i` rewritten to read slot `i`, a
  loop back-edge that writes those slots and carries nothing (the values put BACK after a `br_if`
  for the fall-through path), the `else` a one-armed `if` needs once its parameters are locals, and
  a loud refusal for a `br_table` mixing a parametrised loop with other targets;
  `derive-types.ts`: an origin became `{entry: i}` instead of `'entry'`, so a `pop` says WHICH
  parameter it stands for (the message called this part sound, the enabler of any tree pass);
  `spill-stack-values.ts`: `regionPops` exported, the same question asked of a carrier's region.
- **What failed, with the lowering run ALONE** (no pass after it): `spec/fac/fac.0.wasm` — "not
  enough arguments on the stack for local.set", the back-edge rewrite wrong the same way the
  decoder's was; `spec/if/if.0.wasm` f44 and `spec/block/block.0.wasm` f49 — "expected 2 elements
  on the stack for fallthru, found 1", the multi-value constructs (the wrapper block's arity, or the
  synthesized `else`, does not hold for a tuple). `spec/try_table/try_table.1.wasm` was VALID
  before and after `-O2` on both routes.
- **Trap 1 — `mapExpression` calls back with a REBUILT node, so identity survives only for
  LEAVES.** A first version looked a construct up and replaced it by identity; it never matched,
  nothing was lowered, the guard loop ran its 1,000 iterations and the function came back with
  ~800 locals. The fix in that attempt: lower inside one bottom-up `mapExpression`, which also
  lowers a nested construct before the one that holds it. **How to apply:** never key a rewrite on
  the identity of a non-leaf node inside a `mapExpression` callback.
- **Trap 2 — a no-op passes every test that only asks "is it valid?"**: with nothing lowered the
  module stayed valid (the encoder writes parameters as written). Recorded as a practice in
  [best-practices.md](best-practices.md) § "A no-op passes every test that only asks 'is it
  valid?'".

### Flatten — decided KEPT, then completed (2026-09-28)

- **Decision** (pre-bump item 5, `24f1167e9`): finish it rather than refuse it at the entry point —
  but never silently invalid. Scoped 2026-09-20 at **132 INVALID outputs of 2,925** (~4.5%) and ~12%
  throwing, reachable by `wasm-opt --flatten` and `add('Flatten')` though in no `-O` list. The 131
  after re-measuring were ONE defect: a result-typed body that never falls through was flattened as
  a void statement.
- **Value-carrying branches** (`e22d9f86b`, merged `06e3d750d`): upstream's shape — the value into
  the target's result temp, the branch without it; to the frame, a `return`.
- **Complete** (`897d4ac94`, merged `6d4b5ebf3`; owner: "perform the flatten"): an N-value result
  lives in N temps (`values` beside `value` in `Flat` — no tuple kind added; V1 and S6 6A stand);
  each frame MODELS its operand stack, so stack-form code and every `pop` flatten (operands first,
  then the pops take the top); legacy `try`; a value `br_table` to the frame. Over 2,919 modules:
  **2,896 valid, 0 invalid, 23 refused — `br_on_*` and `try_table` only, both upstream's refusals
  too.** In the gate as spec-behaviour's `--flatten` variant, its refusals pinned by (module,
  variant) in `REFUSED_BUDGET`.

### `wasm-opt --converge` — the design reasoning (built 2026-09-28, merge `86c913eff`)

The owner's proposal (2026-09-19, parked, then built): repeat the pipeline until the size delta
over the next TWO rounds averages under 0.1%. Upstream's `--converge` repeats to a fixed point,
opt-in because of cost. What was built: `optimizeToConvergence` (`passes/converge.ts`, `./passes`),
opt-in; each round ENCODED (the honest measure); stop at a cumulative gain under 0.2% over the last
two rounds (≡ the average rule), a fixed point, a cycle (bytes repeating an older round), or 20
rounds; **return the SMALLEST round, never larger than round 1**. The reasons each guard exists:
a round can GROW before the next shrinks (Inlining, Flatten) — hence the window and best-so-far;
passes can undo each other (LocalCSE's tee vs CoalesceLocals) at a small nonzero delta forever — a
window cannot stop that, hence the cap and the cycle check; the unit is a full round, never a pass
(single passes are wildly uneven). **Measured first**: over 2,919 modules round 2 saves 0.012%,
round 3 0.002%, **no round grew any module**, no corpus module moved; −176 bytes (0.014%) in all.
Built on the owner's call knowing that; the 60.3 KB coverage gap ([open-work.md](open-work.md)) is
where size lives.

