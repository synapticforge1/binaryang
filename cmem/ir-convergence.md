# IR convergence — what actually separates the two IRs

Summary: why the two IRs stay two, the owner decisions that fixed the text front end and the fidelity/optimization split, and the grouping decision. Last verified 2026-11-20.
Optimizer follow-ups (R15, Flatten, `--converge`) are in [ir-convergence-optimizer.md](ir-convergence-optimizer.md); the finished S1–S7 record is in [the archive](archive/ir-convergence-to-4.1.1.md).

Written 2026-08-31, from a measured finding rather than a design discussion. It is the concrete
answer to a question [project.md](project.md) decision 1 left open: the two IRs are retained, and
convergence is "gradual and open-ended" — this is what convergence would actually consist of.

> 🛑 **Owner decision, 2026-09-10 — the TEXT front end is wabt-ts.** The end state is WAT → wabt-ts
> parser → wabt-ts binary writer → bytes → binaryen-ts decoder, and external WAT already takes that
> route (`8033ca3c0`, `readWat` in `src/tools/read-wat.ts`, merged `552b5fa058`).
> binaryen-ts's own WAT parser is internal only and a retirement candidate once S6 unifies the tree,
> so **"Stage 1" below — teaching it stack-sourced operands — is SUPERSEDED**: do not resume it.
> Measured on the new route: every corpus module, written by our `wasm2wat` in linear or folded
> form, reads back 421/421 valid and byte-identical to decoding its original bytes.

> 🛑 **Owner decision, 2026-09-19 — prefer the more ACCURATELY FOLDED form.** "The more accurate
> the folded nature the better our setup treats it." The defects this project kept finding were in
> the linear / less-folded shapes (post-M8 fixes 4, 5, 9, 10), so where our text can be folded
> truly, fold it, even where upstream `wasm2wat --fold-exprs` stays flatter; where upstream folds
> MORE, match it. Applied first to divergence W10: keep our folding where a statement splits an
> instruction's operands (W10a, DESIGN), match upstream's nesting in unreachable code (W10b, open).
> Bytes are never the question — both forms assemble to the same code.

> 🛑 **Owner decision, 2026-09-19 — FIDELITY first on the text path; FOLDED for the optimizer.**
> "The first rule is fidelity for the wat2wasm and wasm2wat. This part is separate from the
> optimization part which requires the folded structure. So this part transpiles verbatim. The
> optimization does not and is not fidelity tied, and must use the folded structure in the tree."
> So `wat2wasm` → `wasm2wat` gives back every instruction in the form it was WRITTEN (S7, below),
> and the folding decision above governs what an unrecorded function — written as the plain nested
> fold, or from any binary with no record — is written as, and the tree the optimizer works on.

> 🛑 **Owner decision, 2026-09-19 (later) — MIXED stays mixed: one-to-one unless optimized.** "The
> default should be a mixed form if a mixed form is in the wat for fidelity for wat2wasm and
> wasm2wat. It should also be linear if linear is what is in the wat file, or folded if folded is
> what is in the wat file. It should never change the state unless it goes into optimization." And:
> "It is basically a one to one translation unless it goes through optimization." S7 had recorded
> forms per FUNCTION (a mixed one came back folded); it records them per INSTRUCTION since.

> 🛑 **Owner decision, 2026-09-19 — ONE FRONT END: the readers and writers are shared too.** Asked
> why wabt-ts and binaryen-ts still each read and write bytes after the bridge went: "When we
> removed the bridge, I thought we were merging the ir parts and the read and write parts. And
> keeping the individual parts that should not cross separate, like the optimization and fidelity
> parts." The record had scoped only the TREE ("one tree type, two verb sets", § "What is NOT in
> scope") and was silent on the readers and writers, so two binary readers, two binary writers and
> two WAT parsers remained. The target now: **shared** — the IR and the reading and writing of
> bytes and text; **fidelity only** — the side table, the text-form record, as-written spellings;
> **optimization only** — the passes and the PREPARATION they need (`prepareForPasses`: naming,
> types, and whatever binaryen-ts's decoder does for the passes today). Scoped by measurement
> first — § "One front end" — before any code moves. **Scoped by the owner** (same day): merge the
> IR, the reader and the encoder — `wat/wasm → reader → ir → features → ir → encoder → wat/wasm` —
> and nothing else; the features stay separate (§ "One front end", "Scope").

## Where it stands — 2026-09-28

**The goal is ONE TREE with TWO VERB SETS, not one merged IR.** Fidelity and optimization are two
PHASES, never both meaningful for the same module — once a pass runs there is no original to be
faithful to — so the fidelity metadata lives BESIDE the tree, and binaryen-ts's passes drop it. ⚠️
"A tree cannot be faithful" is false and was recorded as though it were true: wasm has no `dup`, so
every value has exactly one consumer and a program already IS a tree, plus a marker for the producer
that must stay put — which both sides had (`Pop` ≡ `placeholder`).

- **step:** S1 the gate
  - state: ✅ `deno task operators`
- **step:** S2 name reconciliation
  - state: ✅ the three pairs that ARE pairs; six type-differences moved to S6
- **step:** S3 the side table
  - state: ✅ `fidelity.ts`, keyed by a spread-preserved id, driving both writers
- **step:** S4 coarse grouping
  - state: ✅ five kinds folded away
- **step:** S5 one-sided kinds
  - state: ✅ CLOSED 2026-09-12 (`765713b8f`) — 75 shared, 9 wabt-only, 1 binaryen-only (`region`),
    ratcheted by `ONE_SIDED_BUDGET`. **K3 MERGED 2026-09-14** (owner decision): `simd.shift` is a
    `binary` — see S5 below
- **step:** S6 unify the type
  - state: ✅ DONE 2026-09-18: steps 1–5 — the bridge is deleted (M8e); `prepareForPasses` (names
    M8c, types M8d) makes a wabt-ts tree ready for the passes; the module ratchet is **0 / 0 / 0**;
    `deno task direct` / `direct-behaviour` hold it — see "Item 6 — the MODULE half"
- **step:** S7 text-form record
  - state: ✅ DONE 2026-09-19: per function (`048ecd424`), then per INSTRUCTION — a mix stays the
    same mix (`1f8e8985f`); on by default (owner: fidelity first on the text path), stripped by the
    optimizer — see S7
- **step:** One front end
  - state: ✅ COMPLETE 2026-09-28 (owner, 2026-09-19: the reader and the encoder are shared too).
    Stages 0 `96dcb522b`, 1 `dab3fa7e4` + `e6ddba9a8`, 2 (last item R15, merge `f3008cbd6`; then
    Q1–Q8, `cde2a8f39`, and several tables, `c82656e9b`), 3a / 4a, 3b / 4b (the decoder and encoder
    deleted, released in **1.6.0**), 5 (`parseWat` deleted, `868faea1b`); `encoder/` relocated to
    `ir/` (`5f83028ae`) — see "One front end"

**Measured 2026-09-02, and the numbers are why this was scoped rather than debated** (kept here from
`open-work.md`'s summary; the detail is under "The measurements this rests on"):

|                                              |                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| shared expression kinds (identical spelling) | 63 of 81 / 98 — including **every** structural construct                    |
| shared kinds whose fields differ             | 47 of 62, but almost all pure RENAMES                                       |
| the real difference                          | one coherent set: what wabt-ts keeps AS WRITTEN vs what binaryen-ts DERIVES |
| passes touching an as-written field          | **0 of 16** — the split is already the one the code observes                |
| grouping: opcodes representable coarsely     | **128 / 128**, and 0 of 313 operators name a non-instruction                |

The grouping decision was taken by worst-condition analysis — the fidelity worst case (an
unrepresentable instruction) does NOT bind at 0/128; the optimization worst case does, on
`optimize-instructions.ts` with its 64 operator dispatches.

**Next:** nothing in the convergence itself (2026-09-29). One follow-up it unblocked is open —
deleting S7's read-back (§ "One front end", stage 2's ⏭️ line); it and the optimizer items are in
[open-work.md](open-work.md). The increments as they landed on `main` are in "Merge log" at the end
of this file.

## The finding

A stack machine lets one instruction's result be consumed by a later instruction with nothing
syntactically connecting them. A TREE IR has no way to say that: a node has one parent.

**All three toolchains hit this. Only one solved it.**

|                       | how it handles a stack-sourced operand                                                 |
| --------------------- | -------------------------------------------------------------------------------------- |
| **upstream binaryen** | **spills to a synthetic local** and rewrites each consumer as an explicit read         |
| **binaryen-ts**       | refuses at the syntax level — `missing operand … stack-form WAT is not supported here` |
| **wabt-ts**           | records a `placeholder` marker: the problem noted, not solved                          |

Verified against upstream binaryen 132. Given `(local.set 1 (call $two)) (local.set 0)` — where
`$two` returns two values — it emits:

```
(tuple.extract 2 0 (local.tee $2 (call $two)))
(tuple.extract 2 1 (local.get $2))
```

The multi-value result is evaluated once into a temporary, and each consumer becomes an explicit
extract from it. **That is the whole mechanism**, and it is why upstream's parser accepts every form
of WAT while ours accepts one.

### What each of ours accepts today

| form                                 | upstream binaryen | binaryen-ts | wabt-ts |
| ------------------------------------ | ----------------- | ----------- | ------- |
| fully folded                         | parses            | parses      | parses  |
| `(local.set 0)` — parens, no operand | **parses**        | rejects     | parses  |
| `local.set 0` — bare                 | **parses**        | rejects     | parses  |
| fully linear                         | **parses**        | rejects     | parses  |

⚠️ **The restriction is OURS, not inherited.** binaryen-ts's WAT parser implemented the folded
subset; upstream reads the whole text format. That is worth stating plainly because the reverse was
assumed for some time — that a tree IR simply _cannot_ read stack form. It can. Upstream does.

## The machinery already exists on our side

**binaryen-ts has the mechanism and did not use it here.**

🔧 **Corrected 2026-09-01.** This first said binaryen-ts "has both halves", listing `TupleMake` and
`TupleExtract`. **`TupleExtract` is an enum member only** — no interface, no factory, no encoder
case. Only `TupleMake` is implemented. Claimed from an enum listing without checking for an
implementation.

The correction turned out not to matter, because **tuples were the wrong mechanism anyway**:

- `PopExpr` already exists, and the encoder emits **nothing** for it — _"Pop is a
  pseudo-instruction; not emitted in the binary format"_. That is exactly what wabt-ts's
  `operandPlaceholder` means. **The two IRs already had the same mechanism under different names**,
  which is a better convergence result than adding tuple extraction to one of them.
- `ExpressionKind.TupleMake` is in the IR and implemented.
- `spillBlockParams` in `src/binaryen-ts/binary/wasm-parser.ts` already does exactly upstream's
  spill: pop the values, allocate a fresh local per value, emit `local.set` before the construct,
  and hand back `local.get` reads. It was written for block and loop PARAMETERS (the UP-series Tier
  6/7 work) and its docstring already argues the correctness case — entering a block has no
  observable effect, and spilling preserves evaluation order where relocating the expressions would
  not.

So the binaryen-ts side is **applying an existing, tested mechanism to a second site**, not
inventing one.

**wabt-ts has neither**, and does not need tuples for its own sake: its IR is a partial tree that
mirrors the binary format, and `placeholder` is a deliberate, documented marker meaning "this value
is already on the stack". The convergence question there is different — see below.

## Moved sections

The plan, the measurements and the step records are finished and live in [archive/ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md).

- § "Scope — Stages 1–3, as first planned": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "The measurements this rests on": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "Scope — the path to full convergence": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "K3": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "The (b) decision": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "Group 3": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "The block/label family": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "Step 5 — delete the bridge, and carry its type derivation forward": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "The bridge and the WAT routes into binaryen-ts — history, summarized": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "Item 6 — the MODULE half": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "One front end": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "Merge log": moved to [ir-convergence-to-4.1.1.md](archive/ir-convergence-to-4.1.1.md)
- § "The optimizer after One front end", § R15, § Flatten, § `wasm-opt --converge`: moved to [ir-convergence-optimizer.md](ir-convergence-optimizer.md)

## The grouping decision — worst condition controls

The remaining difference is how finely each side groups instructions: binaryen-ts coarser (one
kind + an operator enum), wabt-ts finer (`compare` and `convert` split out, `br_if` separate from
`br`, three `br_on_*` kinds). Decided by asking what the worst case is on each side, and letting the
binding one control.

**Fidelity side, worst condition** — an instruction the coarse grouping cannot represent, which
breaks the round trip outright:

- 128 wasm numeric opcodes → **128 representable, 0 missing**
- 313 binaryen-ts operator values → **0 name an instruction wasm does not have**, against 556 known
  instruction names

**Does not bind.** Coarse grouping is lossless in both directions.

**Optimization side, worst condition** — a pass that must treat a family uniformly, forced to
enumerate the finer kinds, where a missed member silently does not fire:

- `optimize-instructions.ts`: 6 kinds but **64 operator dispatches**
- only 5 of 15 passes dispatch on an operator at all

**Binds** — narrowly, but hard, on the one pass whose whole job is operator pattern-matching.

### So binaryen-ts's coarse grouping controls

|                | required by COARSE                   | required by FINE                            |
| -------------- | ------------------------------------ | ------------------------------------------- |
| what it needs  | a complete operator ↔ opcode mapping | splitting 64 dispatches in the hottest pass |
| does it exist? | **yes, and it is complete**          | no — would have to be built                 |

The same answer falls out for all four sub-cases — arithmetic, `br`/`br_if`, `br_on`, and the SIMD
families. A rule that flipped per case would mean the framing was wrong.

⚠️ **Coarse grouping has one exposure, and it is this codebase's known failure mode**: the operator
enum and the opcode table are one fact in two places. They are in step today — measured — but
nothing enforced it. `storeBytes` drifted from `loadBytes`; `constExprOperands` from
`writeInstrHead`; `isBlockTypeCarrier` from `encodeRegionBody`. Each was found only after it
produced wrong output.

**So the decision ships with a gate:** `deno task operators` (`scripts/check-operator-mapping.ts`)
fails if any operator names an instruction wasm does not have. It converts "complete now" into
"stays complete", which is what makes the controlling condition safe to design against.


### What is NOT in scope

**Merging the two IRs into one is not the goal, and was briefly recorded as though it were.** The
goal is one tree type with two verb sets. wabt-ts's operations and binaryen-ts's passes stay
separate — they are different phases, and the side table is what lets them share a tree without
sharing obligations.

⚠️ This paragraph said nothing about the READERS and WRITERS, and they stayed duplicated — which the
owner had not intended (decision "ONE FRONT END", 2026-09-19, at the top). Reading and writing
belong to neither phase; they are shared, like the tree.

## Why this was invisible until now

Nothing exercised it. Our WAT parser only ever saw folded input, because our own writer only emitted
folded input to it — and the round trip that would have caught it (`wasm2wat` → `wasm-opt`) was
itself broken for an unrelated reason. **Building the folded writer is what made the gap
measurable**, which is the argument for having built it even though it did not, on its own, achieve
what it was aimed at.

