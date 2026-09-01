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

### Stage 3 — the convergence this buys

Once both sides can express a stack-sourced operand, the two IRs differ in one remaining structural
way: **wabt-ts's tree is partial and mirrors the binary; binaryen-ts's is total.** That is the real
merge question, and it is a decision rather than a defect — see decision 1 in
[overview.md](overview.md). This document exists so that decision is taken against a measurement.

## Why this was invisible until now

Nothing exercised it. Our WAT parser only ever saw folded input, because our own writer only emitted
folded input to it — and the round trip that would have caught it (`wasm2wat` → `wasm-opt`) was
itself broken for an unrelated reason. **Building the folded writer is what made the gap
measurable**, which is the argument for having built it even though it did not, on its own, achieve
what it was aimed at.
