# IR convergence — what actually separates the two IRs

Written 2026-08-31, from a measured finding rather than a design discussion. It is the concrete
answer to a question [overview.md](overview.md) decision 1 left open: the two IRs are retained, and
convergence is "gradual and open-ended" — this is what convergence would actually consist of.

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

## Scope

### Stage 1 — binaryen-ts WAT parser accepts stack-sourced operands

The narrow, high-value piece. It closes ladder item #2 in [open-work.md](open-work.md) (44 modules)
and is the prerequisite for `wasm-opt` reading the WAT `wasm2wat` writes.

Two syntactic cases, and they fail in different places, so they are separate work:

| form            | current failure                   | where                                                                             |
| --------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| `(local.set 0)` | `missing operand for "local.set"` | inside the instruction parser, which reached the instruction and found no operand |
| `local.set 0`   | `unexpected atom in expression`   | the expression parser, which never accepts a bare token at all                    |

The first is one code path with a diagnostic that already names the exact condition — someone knew
this case existed. The second is a second parsing mode, since every construct needs it.

**Do the first alone if the writer can be made to always parenthesise.** That is a real option: our
folded writer knows precisely where a value is stack-sourced, because that is what `placeholder`
marks.

## Stage 1 — status at pause, 2026-08-31

### ✅ Done: binaryen-ts accepts a stack-sourced operand (single claim)

`ce1320bf4`. A consumer whose operand is absent claims the preceding sibling that produced a value,
and that producer is spliced out of the statement list. No spill needed for the single-consumer case
— the producer is simply moved into the consumer, giving the tree the folded spelling would have
produced.

Works: `(i32.const 9) (drop)`, `(local.set 0)`, `(i32.eqz)`, and the same inside a block.

⚠️ **Bounded to ONE claim per instruction, and gated on the instruction having no WRITTEN operand.**
Handlers request operands left to right while the stack yields them top first, so a two-operand
claim assigns them backwards. Measured before the limit:

```
(i32.const 10) (i32.const 3) (i32.sub)    ->  -7   want 7
(i32.const 20) (i32.const 4) (i32.div_s)  ->   0   want 5
stack-form i32.store                       wrote nothing
```

A second claim is **refused rather than reversed**, because wrong bytes that still validate is the
failure mode worth avoiding.

**To lift the bound**, the parser needs an instruction's ARITY at the point of the first claim. It
does not have one — a handler discovers its arity by how many times it asks. wabt-ts has
`instrInputCount` for exactly this; porting or mirroring that table is the concrete next step, and
it is a table, not an algorithm.

🔧 **Corrected 2026-09-01 — the count was never the whole rule.** One claim is NOT "the subset where
order cannot be wrong". With N slots, W of them written and C claimed, the stack fills the LEADING C
slots, but a claim serves whichever slot happens to ask — a TRAILING one whenever W > 0. The two
agree only when W is zero. Measured: `(i32.const 16) (i32.store (i32.const 42))` stored 16 at
address 42 and read back 0, on ONE claim; wabt-ts reads the same text as 42 at 16. Claiming is now
gated on `_served === 0` as well, and a slot that cannot be claimed becomes a `Pop` — which encodes
to nothing, so the producer stays where it stands and stack order is preserved.

**`call` never had the problem, and the reason generalises.** It does not ask for missing operands
at all: it emits the written ones and lets the preceding statements supply the rest, which is simply
stack semantics. The arity problem belongs to handlers that discover arity BY ASKING — binary ops,
compares, stores. So the table is needed for a smaller set than this document implied.

### ✅ Done: the wabt-ts half, and the whole ladder behind it

Both halves landed, and the ladder they gated finished on 2026-09-01: **binaryen-ts reads our folded
output on 421 of 421 corpus modules**, with folded output still assembling to bytes identical to
linear on all 421 and the emitted-byte baseline `IDENTICAL`.

The writer spells a fully stack-sourced node as its head alone, and a PARTLY stack-sourced one by
omitting the placeholders — they always occupy a prefix, because the reader fills from the top of
the stack down and the deepest slots run out first. A scattered mix would be inexpressible
positionally and still declines, though our binary reader does not produce one.

⚠️ **The arity table was never needed for the corpus.** Step 3 below anticipated it; no corpus
module required a multi-claim instruction, because the only mixed-operand nodes present were
`call`s, which do not claim at all. The table remains the right fix for stack-form binary ops and
stores, which is a real gap but not one this corpus exercises.

### One test was CHANGED, not fixed

`WAT: a missing operand is a WatParseError naming the instruction` asserted that stack form THROWS —
it encoded the limitation as a contract. Replaced with the new behaviour plus two guards: the
diagnostic must still fire when there is genuinely nothing to claim, and a two-operand stack form
must be refused rather than reversed.

**Worth noticing as a shape:** a test can pin a limitation so that removing the limitation reads as
a regression. Nothing distinguished this one from a test pinning a requirement.

### Stage 2 — wabt-ts stops needing the marker

`placeholder` is not wrong; it is honest. But it is the reason 44 modules cannot be folded, and it
is the shape that has no folded spelling.

Two routes, and they are not equivalent:

- **Spill on read** — mirror binaryen-ts: when the binary reader finds an empty stack, allocate a
  temporary. ⚠️ This would change what `wasm2wat` EMITS, and the emitted-byte baseline pins that. It
  also makes wabt-ts's IR stop mirroring the binary format, which is the property its round-trip
  fidelity rests on. **Not obviously desirable.**
- **Keep the marker, teach the writer to spell it** — emit `(local.set 0)` (parenthesised, no
  operand) rather than a bare instruction wherever a placeholder sits. The IR keeps its fidelity;
  only the text changes; and it pairs with Stage 1's first case exactly.

**The second is preferred**, and it is the one that makes the two sides meet in the middle rather
than one adopting the other's shape.

### Stage 3 — one tree, two verb sets

🔧 **Reframed 2026-09-02, against the project's stated goals.** This section used to say: _"the two
IRs differ in one remaining structural way — wabt-ts's tree is partial and mirrors the binary;
binaryen-ts's is total. That is the real merge question."_

That framed it as **pick one shape**, which the goals show is the wrong question:

> Round-trip fidelity through the wabt-ts part, and optimization through the binaryen-ts part.
> Whether the WAT is hand-written or came from optimized wasm, the end result should be fidelity of
> the WAT being converted to and from wasm.

Fidelity and optimization are not two shapes competing for one tree. They are two **phases**, and
they are never both meaningful for the same module — once a pass runs, there is no original left to
be faithful to. So the design is:

**ONE tree. Two sets of operations over it. Fidelity metadata BESIDE the tree, not inside the
nodes.**

- wabt-ts's operations read and write the side table
- binaryen-ts's passes never touch it, and **drop** it — an optimized module has no original to be
  faithful to
- the tree type is shared, and passes pay nothing

⚠️ **"A tree cannot be faithful" is false, and this document used to imply it.** Wasm has no `dup`:
every value has exactly one consumer, so a program already _is_ a tree — plus a marker for the case
where the producer must stay put rather than move into its consumer. Both IRs already have that
marker, under two names: binaryen-ts's `Pop` (_"a pseudo-instruction; not emitted in the binary
format"_) and wabt-ts's `placeholder` (_"the value is already on the stack"_). The hard part was
already done.

## The measurements this rests on

Taken 2026-09-02. ⚠️ **Three earlier attempts were probe artifacts** — comparing enum MEMBER names
(`I32Add` vs `AddI32`), and enumerating one of wabt-ts's four opcode spaces. Each would have
reported an alarming false finding. The numbers below are the corrected ones.

### Vocabulary

|                              |                                                       |
| ---------------------------- | ----------------------------------------------------- |
| binaryen-ts `ExpressionKind` | 81                                                    |
| wabt-ts kind discriminants   | 98 (some are Var/type discriminants, not expressions) |
| shared by identical spelling | 63                                                    |

The two already agree on **every structural construct**: `block`, `loop`, `if`, `try`, `try_table`,
`br`, `br_table`, `call`, `call_indirect`, `call_ref`, and the whole `memory.*` / `table.*` /
`struct.*` / `array.*` / `ref.*` families.

### Fields — 62 shared kinds compared

15 identical, 47 differing. **The differences are not arbitrary.** Most are pure renames
(`typeIndex`/`typeVar`, `op`/`opcode`, `condition`/`cond`, `ifTrue`/`then_`, `name`/`label`,
`children`/`body`, `operands`/`args`, `index`/`var`). What remains is one coherent set:

| wabt-ts keeps AS WRITTEN                         | binaryen-ts DERIVES                  |
| ------------------------------------------------ | ------------------------------------ |
| `blockType` on block/loop/if/try                 | `type`, inferred from the last child |
| `opcode` on load/store                           | `bytes` + `signed`                   |
| `memidx` on every memory op                      | assumes memory 0                     |
| `typeUse` / `typeVar` / `sig` on `call_indirect` | resolved `params` / `results`        |
| `resultType` on `select`                         | inferred                             |
| `placeholder` on `nop`                           | a separate `pop` kind                |
| `values` (plural) on `br` / `return`             | `value` (singular)                   |

🔑 **That left column IS the side table.** It was not designed; it was discovered by diffing, which
is why it is trustworthy. `type` belongs in it too and is its most load-bearing member — declared in
wabt-ts, inferred in binaryen-ts, and the field the bridge's `withDeclaredType` already exists to
reconcile.

### Do the passes constrain it? No.

16 passes. `blockType`, `memidx`, `opcode`, `typeUse`, `typeVar` appear **zero times** across all of
them. The passes read `kind` (70 references) and then `value`, `name`, `index`, `target`, `body`,
`condition`, `operands`, `op` — the semantic surface, exclusively.

**Moving the as-written fields into a side table requires no pass changes.** The split was already
the one the code observes in practice.

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

## Scope — the path to full convergence

Ordered so that each step is independently verifiable and none of them requires the next one to be
correct. **The corpus invariants are the acceptance test at every step**: 421/421 validating,
421/421 byte-identical, baseline `IDENTICAL`.

### S1 — the gate, first ✅ done

`deno task operators`. It has to exist before anything depends on the mapping being total, not
after.

### S2 — name reconciliation (mechanical, no behaviour change)

Pick one convention and rename across ~25 kinds: `typeIndex`/`typeVar`, `op`/`opcode`,
`condition`/`cond`, `ifTrue`/`then_`, `name`/`label`, `children`/`body`, `operands`/`args`,
`index`/`var`.

**Verifiable by construction**: a pure rename must leave every emitted byte unchanged, so the
baseline is the proof. Do it as its own commit precisely because it should be provably inert.

### S3 — the side table

Define it, and move the as-written set into it: `blockType`, `opcode` on load/store, `memidx`,
`typeUse`/`typeVar`/`sig`, `select.resultType`, `placeholder`, and `type`-as-declared.

⚠️ **`values` vs `value` on `br`/`return` is NOT a side-table entry** — it is a real arity
difference, already resolved in the tree by `TupleMake`. Do not sweep it in.

Keyed by node identity, so a pass that rewrites a subtree simply loses the entries for what it
replaced, which is the correct semantics.

### S4 — adopt the coarse grouping

Fold `compare`/`convert` into `binary`/`unary`, `br_if` into `br`+condition, and the three `br_on_*`
into `br_on`+sub-op, on the wabt-ts side. S1's gate is what makes this safe; S2 should land first so
the rename noise is not tangled with it.

### S5 — the one-sided kinds

Roughly a dozen: `pop`, `tuple.make`, `tuple.extract` one way; `return_call`,
`return_call_indirect`, `return_call_ref`, `struct.new_default`, `array.new_default`,
`code_metadata` the other.

### S6 — unify the type, delete the bridge

Only now is there one `Expression`. `src/bridge/bridge.ts` (1,935 lines) and its 13 test files
become unnecessary.

🛑 **S6 ABSORBS C10a — owner decision 2026-09-02.** The 24 modules the bridge mistranslates are not
a separate defect to fix first; they fail in the TRANSLATION, not in either IR, and S6 deletes the
translator. Proved: the same wabt-ts IR encodes VALID through wabt-ts's own writer and INVALID
through the bridge.

⚠️ **So S6 carries an acceptance criterion the other steps do not**: those 24 modules must
round-trip correctly once the type is unified. They are the regression suite for this step, not
leftovers — if S6 lands and they still fail, the fault was never in the bridge and this diagnosis
was wrong.

⚠️ **If S6 is ever abandoned, C10a comes back with it.** The decision not to fix them is conditional
on the step that removes them actually happening.

### S7 — the linear-form marker

A custom section recording that the source was linear, so `wasm2wat` reproduces the form it was
given. Independent of S2–S6 and can land at any point.

- wabt-ts already models custom sections (`Custom { name, data, loc, afterSection }`)
- **binaryen-ts drops custom sections entirely**, so optimization strips the marker for free —
  exactly the wanted behaviour, with no code
- corpus sources are folded (58 of 60 sampled), so emitting the marker only for linear input leaves
  the emitted-byte baseline untouched
- absence means folded, so binaries produced before this exists still read right

⚠️ **A whole-module flag cannot reproduce MIXED WAT** — and mixed is common in hand-written source
(fold the arithmetic, leave the control flow flat). Version the section so per-function form can
land later without breaking old binaries.

### What is NOT in scope

**Merging the two IRs into one is not the goal, and was briefly recorded as though it were.** The
goal is one tree type with two verb sets. wabt-ts's operations and binaryen-ts's passes stay
separate — they are different phases, and the side table is what lets them share a tree without
sharing obligations.

## Why this was invisible until now

Nothing exercised it. Our WAT parser only ever saw folded input, because our own writer only emitted
folded input to it — and the round trip that would have caught it (`wasm2wat` → `wasm-opt`) was
itself broken for an unrelated reason. **Building the folded writer is what made the gap
measurable**, which is the argument for having built it even though it did not, on its own, achieve
what it was aimed at.
