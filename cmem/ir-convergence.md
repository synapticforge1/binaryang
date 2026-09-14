# IR convergence — what actually separates the two IRs

Written 2026-08-31, from a measured finding rather than a design discussion. It is the concrete
answer to a question [project.md](project.md) decision 1 left open: the two IRs are retained, and
convergence is "gradual and open-ended" — this is what convergence would actually consist of.

> 🛑 **Owner decision, 2026-09-10 — the TEXT front end is wabt-ts.** The end state is WAT → wabt-ts
> parser → wabt-ts binary writer → bytes → binaryen-ts decoder, and external WAT already takes that
> route (`e18d9f09a`, `readWat` in `src/binaryen-ts/tools/read-wat.ts`, merged `1cb7300317`).
> binaryen-ts's own WAT parser is internal only and a retirement candidate once S6 unifies the tree,
> so **"Stage 1" below — teaching it stack-sourced operands — is SUPERSEDED**: do not resume it.
> Measured on the new route: every corpus module, written by our `wasm2wat` in linear or folded
> form, reads back 421/421 valid and byte-identical to decoding its original bytes.

## Where it stands — 2026-09-14

**The goal is ONE TREE with TWO VERB SETS, not one merged IR.** Fidelity and optimization are two
PHASES, never both meaningful for the same module — once a pass runs there is no original to be
faithful to — so the fidelity metadata lives BESIDE the tree, and binaryen-ts's passes drop it. ⚠️
"A tree cannot be faithful" is false and was recorded as though it were true: wasm has no `dup`, so
every value has exactly one consumer and a program already IS a tree, plus a marker for the producer
that must stay put — which both sides had (`Pop` ≡ `placeholder`).

| step                   | state                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 the gate            | ✅ `deno task operators`                                                                                                                                                                                       |
| S2 name reconciliation | ✅ the three pairs that ARE pairs; six type-differences moved to S6                                                                                                                                            |
| S3 the side table      | ✅ `fidelity.ts`, keyed by a spread-preserved id, driving both writers                                                                                                                                         |
| S4 coarse grouping     | ✅ five kinds folded away                                                                                                                                                                                      |
| S5 one-sided kinds     | ✅ CLOSED 2026-09-12 (`f1675d261`) — 75 shared, 9 wabt-only, 1 binaryen-only (`region`), ratcheted by `ONE_SIDED_BUDGET`. **K3 MERGED 2026-09-14** (owner decision): `simd.shift` is a `binary` — see S5 below |
| S6 unify the type      | 🚧 steps 1–4 done; Group 2 7/7, Group 3 5/5 (its owner call, `call_indirect`'s `sig`, decided and done 2026-09-14), the block/label family done. **Step 5 — delete the bridge — is next**; `deno task bridge` at 401/421 must reach 421/421                       |
| S7 linear-form marker  | ⬚ untouched, independent of the rest — and changed by C3 (see S7)                                                                                                                                              |

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

**Next:** S6 step 5. (K3 and `call_indirect`'s `sig` were both decided and merged 2026-09-14.) The
increments as they landed on `main` are in "Merge log" at the end of this file.

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

### Release shape — settled 2026-09-04

**The S series is not a breaking change for our one real consumer.** wasmtk imports exactly two
specifiers, both compat façades:

    "binaryen-backend": "jsr:@jrmarcum/binaryang@1.5.3/compat/binaryen"
    "wabt":             "jsr:@jrmarcum/binaryang@1.5.3/compat/wabt"

Four things make that safe. Neither façade re-exports anything from `../ir/`. wasmtk reads no IR
field at all (`.op`, `.ifTrue`, `.operands`, `.typeIndex`, `.condition` — zero occurrences). It pins
`@1.5.3`. And decisively, `binaryen-backend` is documented as interchangeable with
`npm:binaryen@^116.0.0`, so that surface is dictated by upstream binaryen.js and _cannot_ be changed
by this merger even if we wanted to.

⚠️ **An earlier count of "wasmtk imports `/ir/binaryen-ts` in 10 places" was wrong** and nearly
forced a needless 2.0.0. Every one of those matches was inside `wasmtk/upstream/binaryang/` — a
vendored copy of _this_ repo — and they were help text and comments, not imports. 🔑 Grepping a
sibling tree that vendors your own source counts your own code as the consumer's. Exclude the vendor
directory before drawing any blast-radius conclusion.

The one honest caveat: `./ir/binaryen-ts` and `./ir/wabt-ts` remain public JSR exports, so changing
them is semver-breaking for a hypothetical consumer we do not have. Carried as the single documented
break rather than as a reason to freeze the IR.

### S1 — the gate, first ✅ done

`deno task operators`. It has to exist before anything depends on the mapping being total, not
after.

### S2 — name reconciliation (mechanical, no behaviour change) ✅ done

**Scoped down on contact, 2026-09-04.** The step was written as "pick one convention and rename ~25
kinds". Checking the pairs before renaming them showed that only some are pairs at all — the rest
are _type_ differences wearing name clothes, and no rename reconciles those:

| binaryen-ts                             | wabt-ts                     | verdict                                     |
| --------------------------------------- | --------------------------- | ------------------------------------------- |
| `condition: Expression`                 | `cond: Expr`                | ✅ pure rename — landed                     |
| `source: Expression`                    | `src: Expr`                 | ✅ pure rename — landed                     |
| `operands: Expression[]`                | `args: Expr[]`              | ✅ pure rename — landed                     |
| `ifTrue: Expression`                    | `then_: Expr[]`             | ❌ **arity differs** — scalar vs array → S6 |
| `ifFalse: Expression \| null`           | `else_: Expr[]`             | ❌ arity differs → S6                       |
| `typeIndex: number`                     | `typeVar: Var`              | ❌ `Var` is `index \| name` → S6            |
| `fieldIndex: number`                    | `fieldVar: Var`             | ❌ same → S6                                |
| `op: UnaryOp \| BinaryOp`               | `opcode: Opcode`            | ❌ different enums → S4                     |
| `target: string` / `target: Expression` | `func: Var` / `target: Var` | ❌ `target` means three things → S6         |

🔑 **Renaming `then_` to `ifTrue` would have been inert and still wrong.** It manufactures a false
correspondence between an array and a scalar — exactly the confusion S6 exists to resolve — and it
would have spent S2's baseline proof on a change that proof does not cover. `typeVar` → `typeIndex`
is the same trap: a name that lies about its own type. Deferring them is not postponement, it is the
correct home; S6 unifies the types and names them once.

`children`/`body` was dropped for a different reason: `body` is also `Func.body` on both sides, so
the rename is ambiguous rather than mechanical. It rides along with S6.

**How it was done.** Rename the 14 declarations in `ir.ts`, then let `deno check` enumerate every
consumer — 47 read sites, then the object-literal writes, then the spread shorthands. The compiler
is the oracle because a blind substitution would have corrupted three unrelated things that share
these names: `args` is argv in every `tools/*.ts` and a wast command's own `args`, and `src` is the
lexer's `LexerSource`. `Frame.cond` in the binary reader renamed too — it is reader-private and
mirrors the IR field it feeds.

⚠️ **The compiler is not a complete oracle, and one test proved it.** `call_arity.test.ts` reached
through `as unknown as { … args: unknown[] }`, a cast that defeats type checking entirely, so the
rename typechecked clean and then failed at runtime with `Cannot read properties of undefined`. Any
`as unknown as` cast is invisible to a type-driven refactor. The _test suite_, not `deno check`, is
what caught it.

**Verified inert**, which is the whole point of doing it as its own commit: baseline `IDENTICAL`
(421/421, no emitted byte changed), 944 tests passing, `operators` TOTAL, spec suite 100% on all
four axes — 2248 accepted, 2714 invalid rejected, 711 malformed binary, 1229 malformed text, over
all 257 files since G2 (2026-09-11); it was 1955 / 2422 / 711 / 1156 over the 227 `wast2json` can
split.

### S3 — the side table ✅ done

`src/wabt-ts/ir/fidelity.ts` — `NodeId`, `FidelityEntry`, `FidelityTable`. One table per module,
created by `makeModule()` so the binary reader and the WAT parser share it. **Both producers
populate it and both writers read it**, so the table drives the output rather than merely shadowing
it, and the byte baseline is a proof rather than a coincidence.

Verified: baseline `IDENTICAL` (421/421, binary and text), 948 tests, `operators` TOTAL, spec suite
100% on all four axes.

#### 🔧 The key was wrong — corrected by measurement

The step said: _"keyed by node identity, so a pass that rewrites a subtree simply loses the entries
for what it replaced, which is the correct semantics."_ It is the correct semantics. **It is not an
achievable key in wabt-ts.**

wabt-ts's IR is immutable — 492 `readonly` fields — so its passes rebuild nodes by spread rather
than mutating them: `resolveNames` has 75 spread rebuilds and `applyNames` 25. **A spread mints a
new object, so it mints a new identity**, even when the pass is semantically identity-preserving.
Resolving `$x` to `0` is the same instruction at the same place, landing in a different object.
Measured on a five-instruction module, with a `WeakMap` standing in for the table:

```
nodes before resolveNames : 8
entries that SURVIVED     : 2 / 8
```

🔑 **An identity-keyed table would be emptied by the very pipeline that needs it** — not by an
optimizing pass legitimately discarding fidelity, but by name resolution, which every parsed module
goes through before it is written. Silently, too: entries vanish, the writer falls back to derived
values, and the output stays valid while quietly ceasing to be faithful.

**The key that holds** is an opaque `nodeId` carried on the node. A spread copies it for free, so
all 100 rebuild sites keep working and none can forget; a pass that CONSTRUCTS a replacement gets no
id and so no entry, which is the original intent reached from the other direction. The shared tree
pays one optional opaque field rather than twelve semantic ones — which is the actual point, since
after S6 binaryen-ts's passes must not have to understand wabt-ts's as-written data.

⚠️ Weaker than pure identity in one way: a pass that rewrites a node BY SPREAD keeps the id and so
keeps a possibly stale entry. Tolerable only because optimization drops the whole table. If that
ever stops being true, this key stops being sufficient.

#### 🔧 The family list was wrong too — seven became four

The step listed `blockType`, `opcode` on load/store, `memidx`, `typeUse`/`typeVar`/`sig`,
`select.resultType`, `placeholder`, and `type`-as-declared. Classifying each against a criterion the
list did not have — **"binaryen-ts can derive an equivalent, and after optimization the original is
gone"** — cut it to four:

| family                           | verdict                                                                                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockType` (5 kinds)            | ✅ declared ≠ derived (a94154e21), and two legal spellings that differ in the binary                                                                                                                                                                  |
| `select.resultType`              | ✅ `0x1b` vs `0x1c` is a written choice; the type itself is derivable from the operands                                                                                                                                                               |
| `typeUse`/`sig` on call_indirect | ✅ `(type $t)` and an inline signature resolve to the same index                                                                                                                                                                                      |
| `type`-as-declared on `Func`     | ✅ the interface's own doc already said fidelity depends on the spelling                                                                                                                                                                              |
| `opcode` (19)                    | ❌ binaryen-ts's `Load` is `{type, bytes, signed, offset, align, ptr}` — the opcode is derivable. A representation difference for S4, not as-written data                                                                                             |
| `align`, `offset` (12/15)        | ❌ memarg semantics                                                                                                                                                                                                                                   |
| GC `typeVar` (15)                | ❌ the type operand, semantic                                                                                                                                                                                                                         |
| `memidx` (16)                    | ❌ semantic — and see the gap below                                                                                                                                                                                                                   |
| `placeholder`                    | ❌ converges to binaryen-ts's `Pop`, which is a KIND. It moves INTO the tree at S5, which already lists `pop`. Would also have meant threading the table through 117 `operandPlaceholder(` call sites to store one boolean a spread already preserves |

🛑 **Gap found for S6: binaryen-ts's `Load` and `Store` have no memory index at all.** They assume
memory 0. That is not as-written data the side table can hold — it is semantic content the unified
tree is currently unable to represent, so multi-memory modules cannot survive S6 until the shared
node carries a memory index. Not a defect today, because nothing routes multi-memory through
binaryen-ts's tree; it becomes one the moment S6 lands.

#### ⚠️ The obligation the table creates

**Any wabt-ts pass that rewrites a value the table also holds must update the table.** Found the
hard way, and only because the writers were wired to read: `resolveNames` resolves `$t` name-vars
inside `select.resultType` on the NODE, the writer now reads the TABLE, and the stale entry handed
the encoder an unresolved name — `writeHeapType: var "$t" not resolved`. The comment at that same
site in `resolve-names.ts` describes an earlier version of the identical bug, from before the table
existed.

🔑 **Populating the table would not have found this; making it load-bearing did.** A table that is
only written to and never read looks correct forever. That is the argument for wiring the writers in
the same step rather than deferring it to S6.

### S4 — adopt the coarse grouping ✅ done

Five expression kinds removed from wabt-ts's IR (93 → 88), five delegate hooks with them, and 17
lines out of the bridge. Baseline `IDENTICAL`, 951 tests, `operators` TOTAL, spec 100% on four axes.

| merge                                                           | result                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `compare` → `binary`                                            | identical shape (`opcode, left, right`); the opcode was always the discriminator |
| `convert` → `unary`                                             | identical shape (`opcode, operand`)                                              |
| `br_if` → `br` + `condition?`                                   | matches binaryen-ts's `Break`, which already had `condition: Expression \| null` |
| `br_on_null` / `br_on_non_null` / `br_on_cast` → `br_on` + `op` | matches binaryen-ts's `BrOn` + `BrOnOp`                                          |

🔑 **The finer split was already redundant, and the type checker proves it.** `onCompare` is
`checkOpcode2(opcode)`; `onBinary` is the same plus an `isWideMul(opcode)` branch that dispatches on
the OPCODE and is false for every compare. `onConvert` and `onUnary` are literally the same body.
Both writers were byte-for-byte identical across all four hooks. The kinds were a second spelling of
a fact the opcode already carried.

The bridge said so itself, in a comment predating this step: _"binaryen-ts collapses compare into
binary (same shape, opcode name carries the semantics)"_. It was doing the merge at translation
time; S4 moves it into the IR and deletes the translation — a preview of what S6 does wholesale.

⚠️ **`br_on_cast` was already half-merged**, carrying `br_on_cast_fail` behind an `onFail` boolean.
That is the same idea applied to two of four cases; the sub-op generalises it. `onFail` became
`op === 'br_on_cast_fail'`, and the cast node's `value` joined the family's `ref`.

**Where the sub-op earns its keep** — the merged nodes still behave differently, and now say so as
data rather than as a kind:

- arity: `br_on_null` leaves the non-null ref on the stack, `br_on_non_null` branches away with it
- feature gates: the null pair is `functionReferences`, the cast pair is `gc` — one node, two gates
- encoding: the null pair are single-byte opcodes, the cast pair GC-prefixed with two heap types

⚠️ **Wide arithmetic is NOT here.** It sits under S5, which is where the note assigning it lives.

### S5 — the one-sided kinds ✅ scoped out 2026-09-12; its last regrouping (K3) merged 2026-09-14

**Landed**: wide arithmetic in binaryen-ts (all four ops, byte-identical), six kind renames, and
`placeholder` → `pop`. One-sided kinds **41 → 27**. Baseline `IDENTICAL`, 952 tests, `operators`
TOTAL, spec 100% on four axes.

#### 🔧 "Roughly a dozen" was 41

The step named eleven kinds. Recomputing the diff from source — necessary anyway, since S4 had just
removed five kinds from one side — gave **23 only-wabt-ts and 18 only-binaryen-ts**. The list was
not merely short; it was the wrong shape, because most entries are not capability gaps at all:

| category                                           | count | example                                         |
| -------------------------------------------------- | ----- | ----------------------------------------------- |
| pure rename (separator only)                       | 5     | `atomic_fence` vs `atomic.fence`                |
| rename with a different word                       | 1     | `atomic_rmw_cmpxchg` vs `atomic.cmpxchg`        |
| regrouping — one side merges what the other splits | ~14   | `simd_lane_op` vs `simd.extract`/`simd.replace` |
| genuine capability gap                             | ~8    | `quaternary` (wide arithmetic), `return_call*`  |

⚠️ **`simd_lane_op` is COARSE on wabt-ts's side while binaryen-ts splits it.** S4's framing —
"binaryen-ts coarser, wabt-ts finer" — is true of arithmetic and branches and **false of SIMD**. The
grouping decision was made on the families S4 covered and does not generalise unexamined; each SIMD
family needs the worst-condition question asked again, not the S4 answer applied.

#### ✅ Wide arithmetic — the named acceptance criterion

`i64.add128`, `i64.sub128`, `i64.mul_wide_s`, `i64.mul_wide_u` all round-trip through binaryen-ts
byte-identically. Previously the whole module was refused with
`unsupported bulk-memory/table opcode:
0xFC 0x13`.

**Shaped as wabt-ts's, deliberately.** wabt-ts was the only implementation, so under the
worst-condition rule its shape controls; a binaryen-ts invention would have left S6 three shapes to
reconcile instead of one. The split follows wabt-ts too and is real rather than accidental:
`add128`/`sub128` take FOUR operands (a new `Quaternary` node), `mul_wide_s`/`_u` take TWO (two new
`BinaryOp` members) — exactly the division wabt-ts's type checker already encoded, special-casing
the multiply pair's result arity inside `onBinary` via `isWideMul`.

All four yield TWO i64 results, so the node's type is a tuple; they exercise the multi-value
machinery rather than just adding an opcode. Cross-checked against **upstream wabt**, not our own
second implementation: `wat2wasm --enable-wide-arithmetic` produces the same 40 bytes and
`wasm-objdump` reads `fc 13` as `i64.add128`.

#### ✅ `placeholder` → `pop`, inherited from S3

S3 deferred this here on the grounds that the convergent form is a KIND, not metadata. Confirmed:
binaryen-ts already had `Pop` — _"a pseudo-instruction; not emitted in the binary format"_ — so the
two IRs had one mechanism under two spellings. wabt-ts's `nop` + `placeholder: boolean` became a
`pop` kind, and the bridge case is now a one-liner.

🔑 **The boolean was a latent hazard, not just a worse name.** It made a synthesized slot-filler
indistinguishable from a real `nop` to anything that forgot to check it; three of the four readers
did check, and nothing enforced that. A kind cannot be forgotten.

#### ✅ RE-MEASURED 2026-09-12 — the 27 is **11**, and none of them is a rename

The table below is what S5 left in 2026-09-04. **It is stale**, and it was cited as "27 outstanding"
for eight days. S6's stages dissolved most of it: `*.new_default` became a field, `simd_lane_op` was
split, `return_call*` became `isReturn`, `tuple.make` / `tuple.extract` were deleted (6A).
Recomputed from source against the `Expr` union and the `ExpressionKind` VALUES:

|                                 |                                                    |
| ------------------------------- | -------------------------------------------------- |
| kinds in wabt-ts's `Expr` union | **84**                                             |
| implemented binaryen-ts kinds   | **77**                                             |
| kinds shared by both IRs        | **75**                                             |
| only wabt-ts                    | **9** — the 7 atomics, `call_ref`, `code_metadata` |
| only binaryen-ts                | **2** — `region`, `simd.shift`                     |

And all 11 are already understood: 8 are one capability gap (**K1**, measured — the decoder refuses
them with `unknown opcode 0xfe`), `code_metadata` is wabt-ts-only (**K2**), `region` is the intended
R1, and `simd.shift` is a regrouping both sides implement (**K3**). **No renames remain.** 🔧
2026-09-14: K3 merged `simd.shift` into `binary`, so binaryen-only is **1** (`region`) and
implemented binaryen-ts kinds are **76**.

⚠️ **EVERY vocabulary count in this file has been overstated at least once, by SEVEN independent
causes** — the six corrections in S6 stage 2's table below, plus the identifier-vs-string comparison
here (3). **This count was wrong three times before it was right, each way worth keeping in view** —
the number was never the hard part, reading the source correctly was:

1. a **union-typed** `kind: A | B` was invisible to the regex, so `ExternConvertAny` looked like a
   phantom. `check-operator-mapping.ts` had already fixed exactly this and said so in a comment; the
   scrape reintroduced it.
2. **every** `readonly kind:` in `ir.ts` was counted — including non-expressions. `ref` is
   `RefValueType`, a TYPE, reported as a missing instruction. The `Expr` union is the authority.
3. worst, because it manufactured a _decision_: it compared binaryen-ts's enum **identifiers**
   (`Break`) against wabt-ts's kind **strings** through a snake_case guess. `ExpressionKind` is a
   string enum whose values already ARE wabt-ts's strings — `Break = 'br'`, `Switch = 'br_table'`.
   So `br`/`Break` and `br_table`/`Switch` were reported as four one-sided kinds when they are two
   shared ones spelled for two audiences, and I was a step away from measuring the blast radius of a
   rename that had nothing to rename. **Compare the values.**

🔑 The lesson is the recurring one, in a new place: a stale measurement and a wrong measurement are
cited identically. The fix is not a better number but a **ratchet** — `ONE_SIDED_BUDGET` in
`deno task operators` pins the 9 and the 2, fails when either grows, and fails when a pinned kind
becomes shared without leaving the list. Inverted four ways, including value-drift
(`Break = 'break'`) and a union member whose interface moved.

#### ✅ K3 — `simd.shift`, scoped by the worst-condition method (2026-09-14) — MERGED into `binary`

**Owner decision 2026-09-14: merge**, as recommended below, and done the same day. The scoping that
follows is kept as written; what landed:

- **The kind is gone.** `ExpressionKind.SIMDShift`, `SIMDShiftExpr`, `SIMDShiftOp` and
  `makeSIMDShift` are removed. The twelve operators are `BinaryOp` members with the same names and
  opcodes. The decoder's twelve dispatches build `makeBinary(op, vec, count)`, `parseWat` finds them
  in `BINARY_OPS`, and the walker and encoder arms went with the kind. So binaryen-ts no longer
  holds two shapes for one instruction depending on the entry path.
- **The cost matched the trial.** `deno check` was clean after the sites the trial named, plus the
  one test that built the old shape. No `default` arm needed judging: removing a kind sends its
  nodes to `Binary`'s arms, which exist in LocalCSE, OptimizeInstructions and PickLoadSigns, and all
  three match exact scalar opcodes.
- **`BinaryOp`'s doc now warns** that a `binary`'s operands are not always the same type.
  [divergences.md](divergences.md) K3 is now a DESIGN row against upstream binaryen.
- **`ONE_SIDED_BUDGET` binaryen → `['region']`.** Inverted: restoring a `simd.shift` kind with an
  interface behind it fails with "1 NEW kind(s) only binaryen has".
- **The gate is `tests/binaryen-ts/binary/simd_shift.test.ts`**, because the corpus holds no shifts.
  It runs 12 shifts through `parseWat` (compared to wabt-ts's bytes), decode → encode
  (byte-identical), the bridge, and LocalCSE. Every module runs in V8 on non-commutative inputs, and
  a `@ts-expect-error` checks that the kind cannot be built. **Red first:** the `parseWat`, decoder
  and LocalCSE cases failed on the pre-merge sources. The bridge cases pass on both sides, so they
  are labelled a guard. **Mutants:** a wrong opcode in `BINARY_OPS` failed exactly that case;
  swapped decoder operands failed the operand check and V8 validation.
- ⚠️ **Fixture lesson:** the first LocalCSE fixture put the repeated shift under `extract_lane`, and
  it failed after the merge too. LocalCSE is opaque to `extract_lane`, which is the allow-list gap
  in [open-work.md](open-work.md). The shape the pass cannot see was the one first written. The
  fixture now sums the shifts under a `local.set`, and was re-shown failing on the pre-merge
  sources.

The twelve lane shifts (`i8x16` / `i16x8` / `i32x4` / `i64x2` × `shl` / `shr_s` / `shr_u`) are a
`binary` in wabt-ts (and in upstream wabt) and their own `SIMDShift` kind in binaryen-ts (and in
upstream binaryen, whose validator requires a `Binary`'s two children to have the SAME type — the
reason it splits them; binaryen-ts has no such check). **Recommendation: merge — binaryen-ts gives
up the kind, the unified tree takes wabt-ts's `binary`.** Everything below was RUN, not read: a
probe of 12 opcodes × 9 forms (108 functions), each result executed in V8 on 28 inputs against
upstream `wat2wasm`'s bytes, with an inversion (one flipped opcode → a byte difference and 1 wrong
export).

**Fidelity — does not bind.** Byte-exact in BOTH shapes on every path: wabt-ts read → write,
`wasm2wat` folded and linear, binaryen-ts decode → encode, the bridge, and the merged shape. The
opcode is the only datum and both carry it.

**Optimization — binds, against the SPLIT form.** 13 passes and -O1/-O2/-O3/-Os/-Oz, both shapes,
all valid with 0 wrong results. But **LocalCSE is a kind allow-list**: it neither keys a `SIMDShift`
nor descends into its operands — S4's worst condition exactly (a pass forced to enumerate finer
kinds, where a missed member silently does not fire). Upstream `wasm-opt --local-cse` DOES reuse a
repeated shift (`local.tee` on `i8x16.shl`), so the merged shape matches upstream behaviour and the
split one does not. The contrary worst case for merging — a `Binary` consumer assuming same-typed
operands — did not occur: OptimizeInstructions and PickLoadSigns match exact scalar opcodes, which a
v128 × i32 node cannot reach.

⚠️ **Merging is not size-neutral**: on the probe -Oz went 7292 → 7307 bytes and -O3 7292 → 7259.
**Attributed by running, not reasoning**: `i8x16.add` — a `binary` in both shapes — gains the same
+4 bytes from LocalCSE at -Oz, because LocalCSE runs after SimplifyLocals and CoalesceLocals and its
tee is never cleaned up. The pipeline's cost model, not the shape.

**This is not the `simd_lane_op` precedent**: there no pass dispatched on the family, so neither
condition bound and cost decided. Here a pass does.

**Cost, by trial** (`deno check` error counts, both reverted):

| direction           | compile errors                                                                      | unflagged sites                                                                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| merge (binaryen-ts) | 10, in 5 files, plus 12 decoder `makeSIMDShift` calls hidden behind an import error | the existing `Binary` arms — all run above; `ONE_SIDED_BUDGET` fails loudly                                                                                                                                                                                  |
| split (wabt-ts)     | 2 (the exhaustive `never` switches)                                                 | `resolve-names`' default returns without descending; the WAT writer's fold spec defaults to linear; three OPTIONAL visitor delegates (`onBinaryExpr?.(e) ?? Result.Ok`) where a miss silently drops the shift in the binary writer, validator and WAT writer |

Merging fails loudly wherever it breaks; splitting fails silently, including in the binary writer.

**What the implementation needs:** a gate that can see shifts — **the 421-module corpus holds 0 SIMD
shifts**, so `baseline` and `bridge` are blind to K3, and `simd_bit_shift.wast` (343 uses) plus a
dedicated test is the real gate; K3's row in [divergences.md](divergences.md) replaced by a DESIGN
row vs upstream binaryen (trigger: all 13 upstream `left->type` / `right->type` reads in passes are
in `OptimizeInstructions.cpp`, and a port of them must not assume equal child types);
`ONE_SIDED_BUDGET` binaryen → `['region']`.

**Found alongside, outside K3:** the bridge already builds the MERGED shape (528 `binary`, 0
`simd.shift`, where the decoder builds 228 `simd.shift`), so binaryen-ts holds two shapes for one
instruction by entry path today; and `Module.toWat()` prints invalid WAT — a DEFECT row (K4) in
[divergences.md](divergences.md).

#### The S5 list, as recorded 2026-09-04 — superseded, kept as history

| only wabt-ts (16)                                                                                                                                                                                                                                                        | only binaryen-ts (11)                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `array.new_default`, `atomic_load`, `atomic_store`, `code_metadata`, `load_splat`, `load_zero`, `ref`, `ref.as_non_null`, `return_call`, `return_call_indirect`, `return_call_ref`, `simd_lane_op`, `simd_load_lane`, `simd_store_lane`, `struct.new_default`, `ternary` | `array.init_data`, `array.init_elem`, `ref.as`, `simd.extract`, `simd.load`, `simd.load_store_lane`, `simd.replace`, `simd.shift`, `simd.ternary`, `tuple.extract`, `tuple.make` |

Each remaining one is an S4-shaped merge — a regrouping with a sub-op, or a capability one side
lacks — not a rename. They are listed so the next step starts from the measurement rather than from
the original eleven.

### S6 — unify the type, delete the bridge 🚧 gate built, premises verified

#### 🔬 Ground truth established 2026-09-04, before any unification

**The gate exists now**: `deno task bridge` (`scripts/check-bridge-corpus.ts`) runs the real
pipeline — parse, `resolveNames`, `synthesizeTypes`, bridge, binaryen-ts encode — and uses the
ENGINE as the oracle. It opened at **397 / 421**, which reproduces C10a's recorded "5 fail to
encode, 19 fail validation" exactly. The 24 was a remembered number; it is now a measured one.
(**401 / 421** since Group 2 decision 4, which removed the encode class — see there.)

It reports the engine's actual complaint instead of a bare boolean, turning 24 opaque failures into
three root causes:

```
17x  expected N elements on the stack for fallthru, found N
 5x  cannot encode store with value type: none
 2x  expected type fN, found local.get of type iN
```

✅ **C10a's diagnosis CHECKS OUT — against all 24, not the one module it was recorded from.**
wabt-ts's own path produces a valid module for 24 of 24; only the bridge path fails. The fault is
entirely in the translation, so deleting it should dissolve them.

⚠️ **An earlier probe said the opposite, and it was wrong.** It omitted `synthesizeTypes`, so
wabt-ts's own encoder appeared to fail too — which would have falsified the premise for deleting
2,000 lines. `wat2wasm` is parse → `resolveNames` → `synthesizeTypes` → write. 🔑 A pipeline probe
that skips a stage does not measure the pipeline; it measures a program that does not exist.

#### 🛑 The plan omits the largest structural difference: the two node bases are DISJOINT

|                 | `loc` (source position) | `type` (result type)          |
| --------------- | ----------------------- | ----------------------------- |
| **wabt-ts**     | on all 88 node kinds    | **0 nodes**                   |
| **binaryen-ts** | **0 mentions**          | on every node, via `ExprBase` |

"Only now is there one `Expression`" passes over this entirely. Neither side has the other's field,
and each is load-bearing for its own half: `loc` is how every wabt-ts diagnostic points at source,
and `type` is what every binaryen-ts pass dispatches on.

**The resolution follows S3's precedent rather than needing a new principle.** `type` is not
independent data — `makeBinary` calls `inferBinaryType(op)`, so it is a MEMOISED DERIVATION computed
at construction. So the unified node carries both fields optional, each populated by the phase that
needs it, and absent means "derive it" — exactly the rule S3 established for the fidelity table.
Fidelity operations set and read `loc`; optimization sets and reads `type`; neither pays for the
other.

⚠️ **This means "delete the bridge" is not only deleting a translator.** The bridge is also where a
wabt-ts tree acquires binaryen-ts's types today. That derivation has to survive the deletion as a
pass over the unified tree, or binaryen-ts's passes get nodes with no `type` to dispatch on.

#### 🛑 And a THIRD axis: the two sides represent an operator differently

|                 |                                                                                    |
| --------------- | ---------------------------------------------------------------------------------- |
| **wabt-ts**     | 17 kinds carry `opcode: Opcode` — ONE numeric enum whose values are the wire bytes |
| **binaryen-ts** | 11 kinds carry `op: <Family>Op` — ELEVEN string enums, one per family              |

So `ternary` and `simd.ternary` have the _same shape_ — `{a, b, c}` — and still cannot be one type,
because one carries `opcode: Opcode` (a number) and the other `op: SIMDTernaryOp` (a string). That
pattern repeats across every operator-carrying kind, and it is invisible in a kind-name diff.

**Neither binds on fidelity**, which `deno task operators` already proved: 313 operator values all
name real instructions, and 128 numeric opcodes are all representable. The trade is elsewhere —
numeric costs readability in the 64 operator dispatches of `optimize-instructions.ts`; string costs
a lookup on every write in wabt-ts's two writers. The gate makes either direction safe, which is
exactly what it was built for.

⚠️ **The SIMD grouping also runs the OTHER way from S4's.** wabt-ts's `simd_lane_op` merges what
binaryen-ts splits into `simd.extract` / `simd.replace`, using the same optional-field trick S4
adopted for `br` + `condition?`. So the worst-condition question has to be asked per family here,
not answered once — S4's "binaryen-ts coarser" holds for arithmetic and branches and is false for
SIMD.

#### ✅ Stage 1 SETTLED — the unified node takes wabt-ts's numeric `Opcode`

Decided by the worst-condition rule, on measurement, not on readability.

**The gate proved only one direction.** `deno task operators` shows every binaryen-ts operator names
a real instruction — the direction where a failure means a name that does not exist. The other
direction is the one that breaks fidelity: **an instruction with no name cannot be carried at all.**
Measured, that set is not empty:

| representation                                                           | covers                                    |
| ------------------------------------------------------------------------ | ----------------------------------------- |
| wabt-ts `opcode: Opcode` (one numeric enum, the wire encoding, 17 kinds) | every instruction, **by construction**    |
| binaryen-ts `op: <Family>Op` (eleven string enums, 11 kinds)             | ~116 instructions have **no name at all** |

The unnameable set is family-shaped rather than scattered — **all atomics** (`i32.atomic.load16_u`,
`i64.atomic.rmw.add`, `memory.atomic.wait32`, …) and **all relaxed SIMD** (`f32x4.relaxed_madd`,
`i8x16.relaxed_swizzle`, …). Adopting the string enums would mean authoring ~116 names by hand: a
second copy of a fact wasm already defines, which is the exact shape this codebase has been bitten
by repeatedly.

**So fidelity BINDS and readability does not.** Losing an instruction is a failure; losing readable
dispatch in `optimize-instructions.ts`'s 64 cases is a cost. The binding condition controls.

⚠️ Note this reverses S4's direction for a different element, and that is expected rather than
inconsistent: S4 chose binaryen-ts's coarse GROUPING, stage 1 chooses wabt-ts's OPERATOR
REPRESENTATION. Third element decided, third time the rule has picked a side on evidence — twice
wabt-ts, once binaryen-ts.

#### 🛑 Seven kinds are declared with nothing behind them

`AtomicRMW = 'atomic.rmw'` is an enum member and **nothing else** — no interface, no factory, no
reader case, no encoder case. It appears nowhere in binaryen-ts but that one line. The same is true
of `AtomicCmpxchg`, `AtomicWait`, `AtomicNotify`, `AtomicFence`, `CallRef` and `TupleExtract`.

🔑 **Third instance of this exact shape**, after `TupleExtract` (already recorded as "an enum member
only") and the `compactImports` feature flag ("a feature flag is not an implementation"). It is not
an accident of one author; it is what happens when a vocabulary is written before its implementation
and nothing checks the difference. `deno task operators` now pins the list and fails on any addition
— verified by injecting one.

**Every count that scanned the enum was inflated.** Recomputed against implemented kinds only:

|                  | by name | implemented |
| ---------------- | ------- | ----------- |
| shared           | 71      | **65**      |
| only wabt-ts     | 23      | **22**      |
| only binaryen-ts | 18      | **10**      |

The six "shared" kinds that are not — `call_ref` and all five atomics — matter most: binaryen-ts
appears to support atomics and **cannot represent them at all**, having not even an atomic load or
store kind.

⚠️ **This corrects a justification given in S5.** Six wabt-ts kinds were renamed there "to the
instruction spelling binaryen-ts already used" — but binaryen-ts _used_ five of those names only as
phantoms. The renames stand, because `atomic.fence` is the real wasm instruction name and that is
reason enough, and they were verified inert. The stated reason was wrong; the change was not.

#### What stage 1 does NOT do

The decision is recorded and gated; the conversion is not written. Turning binaryen-ts's eleven
string enums into numeric opcodes touches ~32 files, and doing it separately from the type
unification would mean editing the same call sites twice. It belongs to the same change as stage 3.

#### ✅ Stage 2 — the one-sided kinds, CLASSIFIED (and mostly not what they looked like)

The count survived six corrections. Each one made the divergence look larger than it is, and none
was visible in the number it produced:

| # | correction                              | effect                                                                                 |
| - | --------------------------------------- | -------------------------------------------------------------------------------------- |
| 1 | count only kinds binaryen-ts IMPLEMENTS | 7 phantom enum members excluded                                                        |
| 2 | capture union-typed `kind` declarations | `array.init_data`/`_elem` and `any.convert_extern`/`extern.convert_any` were invisible |
| 3 | `'ref'` is `RefValueType`, a TYPE       | never an expression kind at all                                                        |
| 4 | tail calls are a FIELD                  | `isReturn: boolean` on Call/CallIndirect                                               |
| 5 | `*.new_default` is a FIELD              | `defaultInit` / `init` on StructNew/ArrayNew                                           |
| 6 | SIMD families regroup both ways         | wabt-ts splits what binaryen-ts merges, and vice versa                                 |

🔑 **A kind-name diff cannot see a capability expressed as a field.** Corrections 4 and 5 are the
same mistake twice: `return_call` and `array.new_default` looked one-sided and are ordinary
capabilities behind a boolean. That is the same optional-field shape S4 adopted for `br` +
`condition?`, so it is the codebase's own idiom being missed by the measurement.

**The corrected divergence — 23 only-wabt-ts, 8 only-binaryen-ts — sorts into three buckets:**

**A. Same capability, different shape (18 kinds).** Reconcilable, and _blocked on stage 1's operator
conversion_ because both sides carry an operator field:

| wabt-ts                                   | binaryen-ts                                        |
| ----------------------------------------- | -------------------------------------------------- |
| `return_call`, `return_call_indirect`     | `call` / `call_indirect` + `isReturn`              |
| `array.new_default`, `struct.new_default` | `array.new` + `init`, `struct.new` + `defaultInit` |
| `ref.as_non_null`                         | `ref.as` + `RefAsOp`                               |
| `load_splat`, `load_zero`                 | `simd.load` + `SIMDLoadOp`                         |
| `simd_load_lane`, `simd_store_lane`       | `simd.load_store_lane` + op                        |
| `simd_lane_op`                            | `simd.extract` / `simd.replace` / `simd.shift`     |
| `ternary`                                 | `simd.ternary`                                     |

**B. Absent in binaryen-ts — wabt-ts's shape survives, no merge to perform (12).** All seven atomics
(`atomic.load`, `atomic.store`, `atomic.rmw`, `atomic.cmpxchg`, `atomic.wait`, `atomic.notify`,
`atomic.fence`), `call_ref`, `return_call_ref`, `code_metadata`, `any.convert_extern`,
`extern.convert_any`.

**C. Absent in wabt-ts (1).** `tuple.make` — though wabt-ts covers multi-value through
`values:
Expr[]` arity rather than a node.

#### 🛑 Stage 2 has almost no independent implementation content

That is the finding, not an excuse. For a one-sided kind there are only two cases, and neither is
work that can be done _now_:

- **bucket A** needs the operator representation settled in code first, or every merge is written
  twice — exactly the double work this ordering was meant to avoid
- **buckets B and C** have nothing to merge: when one side lacks a capability, the other side's
  shape simply survives the unification. There is no intermediate state to build.

**So stages 2 and 3 are one piece of work**, and the recorded ordering was wrong to separate them.
What stage 2 delivers is the classification above — which is what makes stage 3 tractable, and what
the plan's "roughly a dozen one-sided kinds" never had.

Landed in code: `atomic_load` / `atomic_store` renamed to `atomic.load` / `atomic.store`, finishing
the set S5 started. Verified inert — baseline `IDENTICAL`, 952 tests.

#### 📋 Stage 3 — the sequence, scoped 2026-09-04

Stages 2 and 3 collapsed into one change. This is that change, split into five steps that each end
at a green gate, so any one can be reverted without unpicking the others.

**⚠️ This is the first step in the whole series where the corpus invariants can genuinely break.**
S2–S5 stayed `IDENTICAL` largely by construction — renames and regroupings that never reached the
encoder. Step 1 changes what the encoder writes. The baseline stops being a formality and becomes
the actual check.

##### Step 1 — the operator representation becomes numeric ✅ DONE

The 1,383 call sites do **not** get rewritten. Each enum member keeps its NAME and changes its
VALUE: `BinaryOp.EqI32 = Opcode.I32Eq` instead of `'i32.eq'`. Everything spelled `BinaryOp.EqI32`
keeps working, and the field's type widens from the enum to `Opcode`, so an instruction with no enum
member is still representable — which is the whole point of stage 1's decision.

🔑 **The mapping already exists and the change can be GENERATED from it.** Four tables in the
encoder hold it today: `UNARY_TO_OPCODE` (52), `BINARY_TO_OPCODE` (76), `SIMD_UNARY_SUBOP` (65),
`SIMD_BINARY_SUBOP` (120). Coverage is total but for two members — `MulWideSInt64` /
`MulWideUInt64`, added in S5 and handled by a 0xfc special case rather than a table entry.

Those four tables then become the identity function and are **deleted**: 313 entries of "one fact in
two places" removed, which is the hazard class this codebase has been bitten by most.

|           |                                                    |
| --------- | -------------------------------------------------- |
| edits     | 11 enums, 4 tables deleted, ~6 op-as-string sites  |
| untouched | all 1,383 `Op.Member` references                   |
| gate      | ⚠️ **NOT the baseline** — see the correction below |

⚠️ Known consequences: `exprToWat` prints `expr.op` and needs `opName(op)`; encoder messages
likewise; and `wasm_encoder.test.ts` passes `op: 'not.a.real.unary.op'` expecting a throw — that
test asserts a behaviour the change removes, so it gets inverted rather than deleted.

**Landed.** 11 enums converted, 369 members, 0 call sites touched. All NINE lookup tables deleted —
the four named above plus five more SIMD sub-opcode tables found on the way. They collapsed into one
`writeOperator` helper that reads the prefix off the value, which also GENERALISES: the old code
special-cased the SIMD prefix, so MISC, THREADS and GC operators had nowhere to go. That is what
will let atomics encode at all.

🔑 **The mapping was cross-checked against the copy it replaced before being applied**: 313 of 313
members agreed, zero disagreements. It was generated from wabt-ts's opcode tables rather than
binaryen-ts's encoder tables, because generating from the derived copy would have carried any drift
straight into the enums.

⚠️ **The plan named the wrong gate, and the correction matters.** It said "baseline `IDENTICAL` — a
single wrong mapping changes bytes". **The baseline never touches binaryen-ts**:
`verify-baseline.ts` runs wabt-ts's `wat2wasm` and contains zero references to the other half, so it
could not have caught an operator-mapping error at all. The real gate here is `deno task bridge`,
which puts 421 modules through binaryen-ts's encoder, plus the binaryen-ts tests. Both held: 397/421
unchanged, 952 green.

**The operators gate was rewritten**, because its premise changed with the representation. It used
to ask whether each operator STRING named a real instruction; it now asks whether each operator
VALUE is an opcode wabt-ts assigns — the same premise checked against the value, which is strictly
stronger. It also went from 315 members across 2 enums to **369 across all 11**; the narrow version
is why two `BrOnOp` members with no resolvable name went unnoticed until the conversion. Verified by
injecting a bogus value and confirming exit 1.

##### Step 2 — bucket A, now unblocked (18 kinds) ✅ DONE, all seven families

Seven S4-shaped merges: `return_call*`→`call`+`isReturn`, `*.new_default`→`*.new`+`defaultInit`,
`ref.as_non_null`→`ref.as`+op, `load_splat`/`load_zero`→`simd.load`+op,
`simd_load_lane`/`simd_store_lane`→`simd.load_store_lane`, `simd_lane_op`→`simd.extract`/`replace`,
`ternary`→`simd.ternary`.

⚠️ **Direction is NOT uniform and must be asked per family.** S4's "binaryen-ts coarser" is false
for SIMD, where wabt-ts's `simd_lane_op` merges what binaryen-ts splits. Six of the seven point at
binaryen-ts's shape; the SIMD lane family points the other way.

**Landed 2026-09-04**: the operator FIELD name, plus three families. Shared kinds 67 → 70, wabt-ts
kinds 91 → 89.

- **field name first**, since every merge needs one settled: binaryen-ts's `op` → `opcode`, chosen
  by cost (47 sites vs 135) and by accuracy — since step 1 the value IS an opcode. ⚠️ **Not**
  renamed on `BrOn`, whose `op` names WHICH br_on variant: a sub-op discriminator, a different
  concept both halves already spell the same way, and the one place the short name is right.
- `ternary` → `simd.ternary` — a pure rename, because step 1 had already made the shapes identical.
- `load_splat` + `load_zero` → `simd.load`; `simd_load_lane` + `simd_store_lane` →
  `simd.load_store_lane`. Each pair's interfaces were character-for-character identical but for the
  kind, with the opcode as the only discriminator — the S4 argument exactly.

🔑 **Two consumers differed, and I assumed they did not.** Having compared the binary writer's and
WAT writer's handler pairs and found both byte-for-byte identical, I deleted the VALIDATOR's pair
without comparing it. It was not identical — `onSimdStoreLane` and `onSimdLoadLane` have different
stack effects — and `v128.store8_lane` started failing type checking. **Identical handlers in one
consumer say nothing about another.**

The same bug hid a second time in `ir-util`'s arity table, where the duplicate case returned
`nreturns: 0` for a store and `1` for a load, so after the merge every store_lane reported 1. ⚠️
**TypeScript accepted the duplicate case silently; `deno lint`'s `no-duplicate-case` caught it.** A
merged kind needs every consumer checked, and tsc will not do it for you.

Both now dispatch on the opcode — the sub-op pattern S4 established, where the merged node still
behaves differently and says so as data.

**The other four, 2026-09-11.** wabt-ts kinds 89 → 85, shared 70 → 73.

- **tail calls** — `return_call`, `return_call_indirect`, `return_call_ref` fold into their base
  kinds behind `isReturn`. binaryen-ts already modelled it that way; the three pairs of interfaces
  were identical but for the kind name.
- **`*.new_default`** — `struct.new` gains `defaultInit`, `array.new`'s `init` becomes optional.
  Every consumer differs here, because the default form genuinely carries fewer operands.
- **`ref.as_non_null` → `ref.as`** — a rename; the GC proposal has exactly one `ref.as` variant.
- **`simd_lane_op` → `simd.extract` / `simd.replace`** — see below.

🔑 **The SIMD lane family went the FINE way, against S4's coarse preference, and on evidence.** Both
worst conditions were measured and NEITHER binds: the forms are fidelity-equivalent, and **no pass
dispatches on this family at all** — S4's rationale was a pass forced to enumerate finer kinds, so
with no such pass the rationale simply does not apply. With neither binding, cost decides, and it is
4:1 — 27 sites on wabt-ts's side against 110 on binaryen-ts's. Splitting is the cheap direction.

That is the rule working rather than being overridden: it names a controlling condition, and when
none controls it says so instead of manufacturing one.

⚠️ **A comparison script now precedes every merge**, after the S4-era bug where I compared two of
four consumers, found them identical, and deleted a third that was not. It extracts every `case`
body per pair across the tree and diffs them. It found the four consumers that genuinely differ for
tail calls, and reported up front that ALL of them differ for `*.new_default`.

⚠️ **It does not see delegate METHODS**, which is how the validator and both writers dispatch —
those are still checked by hand. A comparison tool that silently omits a class of consumer is the
same trap one level up.

**One self-inflicted break, caught by the compiler**: `case 'call_indirect':` was a FALLTHROUGH
LABEL onto `case 'return_call_indirect': { … }`, so deleting the return_* block took the body
`call_indirect` depended on. Removing a case is not safe just because the label above it is the one
being kept.

##### Step 3 — the node base carries `loc?` and `type?` ✅ DONE

The two bases are disjoint: 88 wabt-ts kinds carry `loc` and none carries `type`; every binaryen-ts
node carries `type` and none mentions `loc`. Both become optional, absent meaning "derive it" — the
rule S3 established for the fidelity table.

Making `type` optional is the one change with a **silent** failure mode: 53 reads across 11 pass
files would see `undefined` rather than a type. Each needs an explicit decision, not a `?.`.

**Landed 2026-09-11.** `ExprBase` now has `type?: Type` and `loc?: Location`, and a `typeOf(e)`
accessor that THROWS naming the node when a type is required and absent. 952 tests, baseline
`IDENTICAL`, bridge 397/421, spec 100%.

**Safe to relax today, and measured rather than assumed**: all 81 factories in `expressions.ts` set
a type, so nothing here can produce an untyped node. One can only arrive once wabt-ts's tree flows
in directly, which is step 4 — so the guard is in place before the thing it guards against exists.

🔑 **`typeOf` rather than 53 defensive checks.** The plan called this the one change with a silent
failure mode. A `?.` at each read would have spread the silence; one accessor that fails loud
concentrates it. Verified by construction: an untyped node throws
`expression of kind "i32.add" has no
computed type`, and the same happens through a real encode
path.

⚠️ **The first attempt at routing the reads was wrong in two ways at once, and worth recording.** A
tree-wide regex rewrote 110 reads when 38 were failing — catching `field.type` on a struct field,
and turning the ASSIGNMENT `blk.type = resultType` into `typeOf(blk) = resultType`. The check that
"passed" afterwards was counting `TS<number>` lines, and a SyntaxError carries no TS code, so a
broken file reported zero errors.

**Two lessons, and the second is the sharper one**: let the compiler name the sites rather than a
pattern; and assert on a command's FAILURE, not on a string inside its output. The redo was
compiler-driven and line-scoped, which left only four sites needing hands — three where the
offending read sat on a different line from the error, and one where `loop.body.type` became
`loop.typeOf(body)` because the pattern captured only the last path segment.

##### Step 4 — one `Expression` ✅ the (b) conversion is DONE (5 of 5 families); the 28 structural kinds remain

⚠️ **"Alias one to the other" understates this by a lot.** The kind sets agree on 73 kinds; the
FIELD sets do not. Measured:

|                                     |                                       |
| ----------------------------------- | ------------------------------------- |
| kinds implemented on both sides     | 73                                    |
| field sets already identical        | **23**                                |
| differing by exactly one field pair | 22, reducing to **13 distinct pairs** |
| needing a per-kind decision         | **28**                                |

🔑 **Every one of the 13 "renames" is a type difference** — the S2 finding again, at field level.
But they split cleanly in two, and only one half is real:

- **(a) `Expr` vs `Expression`, 8 pairs** — `operand`/`value`, `start`/`dest`, `initValue`/`value`,
  `values`/`value`, `func`/`target`, `depth`/`target`, `values`/`condition`, `source`/`offset`.
  These differ only because the element type is one of the two types being unified. They **dissolve
  by definition** the moment the types are one; they are renames, not decisions.
- **(b) `Var` vs a resolved index or name, 5 pairs** — `typeVar`/`typeIndex`, `var`/`index`,
  `var`/`name`, `memidx`/`memory`, `heapType`/`castType`. A real structural difference: wabt-ts
  holds `Var`, the `index | name` union that exists BEFORE name resolution; binaryen-ts holds the
  resolved form directly.

###### The (b) decision: `Var` controls

Cost does not decide — 210 `Var` reads in wabt-ts against 275 resolved-index reads in binaryen-ts,
near enough even. So the worst condition does:

- **fidelity BINDS.** A module whose WAT names its locals must round-trip with those names. `Var`
  carries a name; `index: number` cannot represent `$x` at all. Losing it would regress round-trip
  fidelity, which is the outcome the rule exists to prevent.
- **optimization does not bind.** A pass needing an index reads it from `Var`'s index arm through an
  accessor. That is a convenience, not a capability.

So the unified node holds `Var`, and binaryen-ts's consumers get an accessor — the same shape and
the same reasoning as the multi-memory decision, and the third element where wabt-ts's form
controls.

###### The 28 structural kinds, scoped 2026-09-11

Each asked the worst-condition question once. **Only seven turned out to be decisions**; the rest
are the already-settled `Var` call plus operand renames that dissolve when the types unify.

⚠️ One measurement artifact caught first: the script that printed the 28 shape pairs filtered fields
whose name STARTS WITH `type`, to hide the base `type:` field — and so hid `typeIndex`, the very
field under study. It briefly looked as though binaryen-ts could not say which struct or array type
a `struct.get` addressed. Eighth artifact of this class; the fix was an anchored pattern rather than
a prefix.

**Group 1 — no new decision (16 kinds).** `array.copy`, `array.fill`, `array.init_data`,
`array.init_elem`, `array.new_data`, `array.new_elem`, `array.new_fixed`, `struct.get`,
`struct.set`, `memory.copy`, `memory.init`, `simd.load`, `simd.load_store_lane`, `table.copy`,
`block`, `loop`. Each differs by the `Var`-vs-resolved-index call already made, plus operand names
(`destOffset`/`destIndex`, `address`/`ptr`, `operands`/`values`, `srcOffset`/`source`) that are pure
renames once `Expr` and `Expression` are one type. Direction on those goes by blast radius, as S2
did.

**Group 2 — the seven that are real decisions.**

| kind(s)                                     | the difference                                           | controls                               | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load`, `store`, `simd.load*`               | `opcode` vs decomposed `bytes` + `signed`                | **wabt-ts**                            | S6 stage 1 already made the numeric opcode the operator representation. `bytes`/`signed` are derivable from it; the reverse needs a table. Settled by consistency, not re-litigated.                                                                                                                                                                                                                                                                                                                                      |
| memarg `offset`                             | `bigint` vs `number`                                     | **wabt-ts**                            | memory64 offsets exceed 2^32. `number` cannot carry one, so **fidelity binds**: a valid module would be unrepresentable.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `loop`, `try`, `try_table` body             | `Expr[]` vs a single `Expression`                        | **wabt-ts**                            | A list of N instructions can only be one `Expression` inside a synthetic `Block`. That wrapper is a node the input never had, and it has already cost: `oneOrTypedBlock` creates them, `encodeRegionBody` must inline them, and `isBlockTypeCarrier` carries a comment about a multi-value function body wrapper registering a type entry nothing addressed. **Fidelity binds** and the wrapper is a known defect source. 🔧 _Overstated — faithful today by convention; resolved as neither form, see decision 5 below._ |
| `try` catches                               | `Catch[]` vs parallel `catchTags[]` + `catchBodies[]`    | **wabt-ts**                            | The parallel arrays are documented as such in binaryen-ts. Two arrays indexed in lockstep are one fact in two places — the hazard class this codebase has been bitten by most, and the one `deno task operators` exists to police.                                                                                                                                                                                                                                                                                        |
| `br` values                                 | `values: Expr[]` vs `value: Expression \| null`          | **wabt-ts**                            | A multi-value `br` carries N values. S2 flagged this as a real arity difference, not a rename. **Fidelity binds.**                                                                                                                                                                                                                                                                                                                                                                                                        |
| `blockType`, `typeUse`, `select.resultType` | present on wabt-ts, absent on binaryen-ts                | **wabt-ts, and they stay on the node** | These are the as-written fields S3 put in the fidelity table. The table SHADOWS them; it does not replace them, because the encoder still needs a value when no entry exists. Keeping both is the S3 design, not a duplication.                                                                                                                                                                                                                                                                                           |
| `ref.as` operator, `simd.shuffle` operator  | an operator field on a kind with exactly ONE instruction | **drop it**                            | With one variant the KIND is the operator. Neither side loses anything, and it removes a field that can disagree with the kind.                                                                                                                                                                                                                                                                                                                                                                                           |

**Group 3 — genuine ties, decided on cost (5 kinds).** `br_on` (`from`/`to` objects vs four flat
`castType`/`castNullable`/`srcType`/`srcNullable` fields), `select` (`val1`/`val2` vs
`ifTrue`/`ifFalse`), `if` (`then_`/`else_` vs `ifTrue`/`ifFalse`), `call_indirect` (`sig` vs
`params`+`results`), `ref.null` (`refType` vs carrying it in the node's `type`). Neither condition
binds on any of them: both forms are fidelity-equivalent and no pass depends on either spelling.
Blast radius decides, as it did in S2 and for the SIMD lane family.

###### ✅ Group 3, measured and 3 of 5 done (2026-09-11)

Blast radius by TRIAL — rename the field in the interface only, count the compile errors, revert.
Baseline 0, so every count is real.

| tie             | change wabt-ts | change binaryen-ts | taken                                 |
| --------------- | -------------- | ------------------ | ------------------------------------- |
| `select`        | 12             | **8**              | ✅ wabt-ts's `val1` / `val2`          |
| `if`            | **30**         | 44                 | ✅ binaryen-ts's `ifTrue` / `ifFalse` |
| `br_on`         | 30             | **5**              | ✅ wabt-ts's paired `from` / `to`     |
| `call_indirect` | 11             | **16**             | ✅ wabt-ts's `sig` (owner, 2026-09-14) |
| `ref.null`      | 10             | n/a                | ⬚ NOT a rename — see below            |

🔑 **On all three taken, cost and meaning agreed** — which is what made them safe to do as renames:

- a SELECT is not a branch. Both operands are always evaluated, so `ifTrue` / `ifFalse` named it
  wrongly (its doc comments said "branch taken when…" of an instruction that branches nowhere).
- an `if` does branch, so `ifTrue` / `ifFalse` is right there; `then_` was wabt's C++ keyword
  workaround, and in TypeScript a `then` PROPERTY makes an object a thenable to `await`.
- `br_on`'s heap type and its nullability are ONE reference type. Four flat optionals could hold a
  nullability with no heap type beside it, and the encoder papered over exactly that with
  `?? AbstractHeapType.Any`; paired, that state cannot be written down.

⚠️ **Two of the five are not the mechanical ties the plan called them**, and the measurement is what
showed it:

- ✅ **DECIDED 2026-09-14: A — binaryen-ts takes `sig`** (owner: fidelity is where the trouble has
  been, and binaryen-ts is the cheaper side to change in source). Done in `b034cedb1`: binaryen-ts
  gains `FuncSignature` (same name and shape as wabt-ts's, over its own value types, until S6
  unifies them); `CallIndirectExpr.sig`; `makeCallIndirect` changed ARITY so the compiler named all
  22 sites; a `@ts-expect-error` pins that no flat `params` returns (inverted). Behaviour-neutral:
  baseline IDENTICAL, decode → encode 421/421. ⚠️ Scope was this node: binaryen-ts's
  `WasmFunction` is still flat `params` / `results`, so the function-signature family is not yet
  one shape on that side.
- **`call_indirect`'s `sig` vs `params`+`results` — 🗓️ OWNER CALL, evidence gathered 2026-09-11.**
  Cost says convert wabt-ts (11 vs 16), but that is a 5-site margin **against the structural
  grain**: `FuncSignature` is wabt-ts's house concept — 49 uses, 78 `.sig` reads — and binaryen-ts
  has ZERO, so whichever way this goes ONE side gets a lone exception. In wabt-ts the flat spelling
  would also sit beside `typeVar` / `typeUse`, the triple whose whole point is "this call names a
  signature" (and which S3's table keys on as `FidelityEntry.sig`). `FuncSignature` is exactly
  `{params, results}`, so the two really are equivalent — which is why cost cannot settle it alone.
  **Not flipped unilaterally on a 5-site margin: the one Group 3 tie where cost and structure point
  opposite ways.** 🔬 **Re-measured 2026-09-14, for the owner's options review** (same trial: change
  the interface, count `deno check` errors, revert). The totals are unchanged at **11 vs 16**, but
  split by file **the margin is mostly tests**:
  - convert wabt-ts: 10 source sites (`bridge.ts` 3, `wast-parser.ts` 3, `ir-util.ts` 2,
    `binary-reader.ts` 2) plus 1 test;
  - convert binaryen-ts: 9 source sites (`wasm-encoder.ts` 6, `expressions.ts` 1, `wat-parser.ts` 1,
    `flatten.ts` 1) plus 7 tests.

  Counting production code only, binaryen-ts is the cheaper side to change. The structural fact is
  wider than this one node:
  - wabt-ts carries `sig: FuncSignature` on `Func`, on the func type entry, on the func import and
    in `FidelityEntry`.
  - binaryen-ts carries flat `params` / `results` on `WasmFunction`, and has no `FuncSignature` at
    all.

  So the tie is two house styles for ONE family (function signatures), and settling `call_indirect`
  alone leaves a lone exception on whichever side loses.
- **`ref.null` — NO CHANGE, and that is the finding.** binaryen-ts has no field because the heap
  type IS the node's `type` (`ref.null t` has type `(ref null t)`) — one fact in one place, and
  **byte-identical on all 13 spellings probed**: every abstract heap type, a concrete `$t`, and a
  `$t` that is not type 0. Adding an explicit `refType` beside it TODAY would be the same fact
  twice, the hazard this codebase keeps being bitten by. The merged tree does need the explicit
  field, because wabt-ts's nodes have no `type` to carry it — so it lands WITH the merge, when
  `type` becomes derived, not before.

###### ✅ And one safety rename cost did not get a vote on

**binaryen-ts's `CallIndirectExpr.target` → `callee`.** It was documented "Target label of the
branch", which it is not: `call_indirect` does not branch and the field is not a label — it is the
operand giving the table SLOT. `target` meant three different things across kinds (the called
function on `call`, a branch label on `br_on`, this operand here), and here it sat directly beside
`table`, the other thing a reader would call a target. wabt-ts's `callee` is unambiguous. Same
precedent as `table.copy`'s `dst` / `dest`: safety, not blast radius.

**So the order of work is:** the `Var` accessor first, since Group 1 cannot land without it; then
Group 2's seven, which are structural and want their own commits; then Group 3's renames, which are
mechanical; then the aliasing.

🔑 **Six of the seven real decisions go to wabt-ts's form.** That is not a thumb on the scale — it
is what "fidelity binds, optimization does not" keeps producing once the question is asked per
element. S4 went the other way on grouping, and the SIMD lane family went the other way on cost.

###### What remains, honestly

1. the (b) conversion — ~275 binaryen-ts read sites behind an accessor
2. the 28 structural kinds, each needing the worst-condition question asked once. They are not
   uniform: `load`/`store` are wabt-ts's `opcode` against binaryen-ts's decomposed `bytes`+`signed`
   (noted in S3); the block family is `blockType`+`label`+`body` against `name`+`children`, and
   `blockType` already lives in the fidelity table; `select`, `br`, `br_on` and the `array.*` family
   each differ their own way
3. the aliasing itself, which is the small part

**This is the largest single piece left in S6**, and larger than the plan's one-line description of
it. Recorded before starting so the next session begins from the measurement.

###### ✅ The `typeIndex` family converted — the pilot for the other four

The first of the five (b) families is done: binaryen-ts's `typeIndex` / `destTypeIndex` /
`srcTypeIndex` are now `typeVar` / `destTypeVar` / `srcTypeVar`, holding a `Var`. 40 references
across the node definitions, 15 factories, 44 construction sites, 15 encoder reads, 19 test call
sites. The nodes no longer have a `typeIndex` field at all — it is gone, not shadowed.

**Nothing moved**: 952 tests, baseline IDENTICAL, bridge 397/421 unchanged, spec 100% on all four
axes with no misses. A representation change that moved a byte would have meant it was not one.

🔑 **The method that made it cheap: let the compiler name the sites.** The first pass searched for
factory names and missed a call made through a local alias —

```ts
const make = head === 'array.init_data' ? makeArrayInitData : makeArrayInitElem;
return make(varIndex(ti), …);
```

— which no name-based scan can see, because the name is not at the call. So the remaining sites came
from `deno check` itself: `scratchpad/wrap-from-check.ts` reads the error stream and rewrites the
exact `file:line:col` span the compiler underlines. That found 19 test sites a search would have had
to guess at.

⚠️ **And it caught its own artifact, which is the point.** The first run fixed 11 of 18 and reported
success on all 11 — it required a `~` run for the underline, and TypeScript marks a
**single-character** token with `^`. Every one-letter argument (`t,`) was skipped silently. The
count is what exposed it: 11 wrapped, 18 reported. **Always compare the two numbers**; "11 wrapped"
alone reads like a clean pass.

The test assertions changed shape as well, and are stronger for it:

```ts
assertEquals(sn.typeVar, varIndex(0)); // was: assertEquals(sn.typeIndex, 0)
```

`varIndex(0)` equals only a _resolved_ index 0, so a node carrying an unresolved name now fails. The
old form could not tell those apart.

⚠️ **The `index` family will not take the same treatment.** `index: number` (an entity reference, a
`Var` candidate) and `index: Expression` (an operand — `table.get`'s dynamic index) share the field
name in `expressions.ts`, four sites of the latter. The type tells them apart and the name does not,
so that family has to be selected by TYPE. The compiler would catch a name-keyed rename that caught
the operands — `Expression` is not `Var` — but it would catch it as a pile of errors to sort through
rather than as one, which is how the `.type` regex went wrong: the recovery cost, not the detection,
is what makes the wrong key expensive.

**Remaining (b) families:** `index`, `name`, `memory`, `castType`.

###### ✅ The `memory` family converted — 2 of 5

`memory` and `sourceMemory` hold a `Var` on all nine kinds that address a memory (load, store,
memory.size/grow/init/copy/fill, simd.load, simd.load_store_lane). **No rename**: unlike
`typeIndex`, the name does not encode the old type, so only the type changed.

🔑 **The whole family cost six edits, not fifty, because the wrap went at the SOURCE.** The first
check reported 50 errors and every one was the same local flowing out of `readMemArg`. The binary
form of a memarg memory index is always resolved, so `readMemArg` returns a `Var` now and the ~50
factory calls downstream were already correct. **When the compiler reports many errors on one value,
the fix is usually upstream of all of them.**

⚠️ **"Absent means memory 0" is a real convention here and it survived intact.** The factories
deliberately omit the field when it is zero:

```ts
...(indexOf(memory) !== 0 ? { memory } : {})   // was: memory !== 0
```

`indexOf` returns `undefined` for a NAME, so a named memory is never mistaken for memory 0 and
dropped. The test that pins this — _records no memory field on a memory-0 access_ — passed
unchanged, which is what makes the claim worth anything.

Encoder reads go through one helper stating the convention once:

```ts
function memIndex(v: Var | undefined, what: string): number {
  return v === undefined ? 0 : requireIndex(v, `${what} memory index`);
}
```

`writeMemArg` needed only its parameter type: it already branched on the resolved VALUE
(`mem !== 0`), not on the field's presence, so multi-memory encoding was never presence-dependent.

**Gate**: 952 tests, baseline IDENTICAL, bridge 397/421, spec 100% on four axes. One test changed
shape rather than fixed — `multi_memory.test.ts` asserted `store['memory'] === 1` and now asserts
`varIndex(1)`.

⚠️ **A restriction became liftable, and is NOT lifted yet.** `requireDefaultMemory` in the bridge
rejects every non-zero and named memory index as "not yet supported". Two of its three reasons are
gone: the encoder's `checkSingleMemory` guard no longer exists, and the bridge already carries every
`module.memories` declaration. What is unverified is the NAME path — passing a name through would
move the failure from bridge time to encode time, which is a worse place for it unless names are
resolved first. None of the 24 current bridge failures are memory-related, so lifting it will not
move 397/421; it closes a lossy path rather than fixing a break. Its own increment.

**Remaining (b) families:** `index`, `name`, `castType`.

###### ✅ The `index` (locals) family converted — 3 of 5, and the one that found real defects

`local.get` / `local.set` / `local.tee` hold a `Var`. 202 sites, and unlike the first two families
this one runs through the OPTIMIZATION PASSES, so the errors ran in both directions: a pass READS an
index (`requireIndex`) and also WRITES a renumbered one (`varIndex`). Two mirrored compiler-driven
scripts, run together each round.

🛑 **Three defect classes the type checker cannot see. All three compiled clean.**

| class                                        | what broke                                                                                                                                                                                              | what caught it                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `===` became REFERENCE comparison            | `SimplifyLocals` lost `set`+`get`→`tee` fusion. Two separately built vars for the same local are never `===`, so the optimization silently stopped firing                                               | `passes.test.ts`                             |
| `` `${e.index}` `` renders `[object Object]` | `LocalCSE` keyed its cache on `` `lg:${expr.index}` `` — EVERY `local.get` hashed alike, folding unrelated values. A behavioural miscompile. Four more sites: the invalidation path, a WAT printer (×3) | the fuzz test (seed 2) and one pipeline test |
| `as any` on a test fixture                   | `asyncify.test.ts` hand-builds a tree and casts the body `as any`, so `index: 0` was never checked and reached a pass as a raw number                                                                   | 8 asyncify tests                             |

🔑 **The BYTE tests could not see any of it.** Baseline stayed IDENTICAL and bridge stayed 397/421
while `LocalCSE` was actively miscompiling, because neither exercises that pass on those inputs.
Only the behavioural tests could. This is the argument for keeping them in the gate.

⚠️ **`as any` is the boundary of the compiler-driven method**, and it is worth stating plainly: the
technique converts everything the compiler can see, and nothing it cannot. 12 `as any` casts remain
in the binaryen-ts tests; each is a place a future field change will pass silently.

Finding it needed instrumenting `requireIndex` to dump the offending VALUE — the stack names only
the read site, never where the bad node was built. It came back `0`, a number rather than a var,
which pointed straight at the literal.

`sameVar(a, b)` now lives in `ir.ts` beside `requireIndex`, with the `SimplifyLocals` failure in its
doc comment. Every remaining family will hit that class.

The interesting sites, which no script should have touched: `coalesce-locals` renumbers slots and so
needs both directions in one expression (read the current index, compare, write a wrapped one);
`pick-load-signs`'s `LoadInfo.localIndex` and `flatten`'s structural cast are private types
MIRRORING the node's field, so they follow it rather than converting at each use; `inlining`'s
`varIndex(remap(requireIndex(…)))` reads resolved, renumbers, stores resolved.

**Gate**: 952 tests, baseline IDENTICAL, bridge 397/421, spec 100% four axes, lint clean.

**Remaining (b) families:** `name` (which is really TWO families — globals, and block/loop/try
labels), and `castType` (a decision, not a conversion — see below).

###### ✅ The globals `name` family converted — 4 of 5

binaryen-ts's `GlobalGetExpr.name: string` / `GlobalSetExpr.name: string` are now `var: Var`,
matching wabt-ts's spelling. Both a rename and a retype, because `name` encoded the old type; the
direction follows blast radius, as Group 3 says.

🔑 **Renaming the field, not just retyping it, converts a SILENT break into a compile error — and
this family proved it.** `LocalCSE` had a SECOND cache-key bug, `` `gg:${expr.name}` ``, identical
in kind to the `` `lg:` `` one that miscompiled in the locals family. Because the field became
`var`, the compiler reported a missing property instead of letting the object stringify to
`[object Object]`. The `memory` family kept its field name and had no such protection.

**So: when a field's type changes meaningfully, rename it too.** It is not cosmetic — it is the
difference between the compiler finding the sites and a behavioural test finding them later.

⚠️ **A name collision the compiler could not warn about.** `bridge.ts` already had a local
`varName(v, names)` that resolves a var TO its declared string — the exact INVERSE of `ir.ts`'s
`varName(name)`, which builds one FROM a string. The inserted calls bound silently to the local
function. Renamed it `resolveVarName`, which also makes the two-step honest at the call site:
resolve the wabt-ts var to its name, then rebuild a name-form Var, because binaryen-ts's encoder
addresses globals BY NAME.

⚠️ **The cast class has a second spelling.** After the locals family I swept for `as any` and found
12. That grep missed `(getState as { name: string }).name` — a NARROW structural cast asserting the
old shape, which kept compiling and yielded `undefined` at runtime. Sweep for `as \{ <field>:` as
well.

`requireName` and `nameOf` join `requireIndex`/`indexOf` in `ir.ts`: binaryen-ts addresses globals
by name, and inventing a name for an index-form var is the same silent-wrong-answer failure in the
other direction.

`valueTypeEquals` hand-wrote `sameVar`'s comparison arm-by-arm with two structural casts; folded
into `sameVar` so there is one spelling to keep agreed.

**Gate**: 952 tests, baseline IDENTICAL, bridge 397/421, spec 100% four axes, lint clean.

⚠️ **Block/loop/br/try LABELS are NOT part of this family**, though they also spell a reference as
`name: string`. wabt-ts holds a `Var` that may be a relative DEPTH; binaryen-ts holds a symbolic
label its passes rely on. That is the block family's structural question (Group 1), not the (b)
conversion.

###### ✅ `castType` — the third form, and the last (b) family. Step 4 COMPLETE

Owner's call, 2026-09-09: take the third form rather than either side's.

```ts
export type HeapTypeRef =
  | { readonly kind: 'abstract'; readonly name: AbstractHeap }
  | Var;
```

The index and name arms ARE `Var`, so `requireIndex`, `sameVar` and name resolution apply to a
defined-type reference unchanged; only the abstract case is new.

🔑 **It paid for itself four times over, because FOUR consumers were doing the same table lookup to
recover a distinction the type had thrown away.** All four are gone:

| site                               | what it did                                                                                                           | now                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `binary-writer.writeHeapType`      | `abstractHeapTypeByteForName(name) !== null` to decide whether a name was a keyword                                   | switches on the arm; an unresolved `$T` is its own error rather than sharing a path with a typo |
| `resolve-names.resolveHeapTypeVar` | `heapTypeNameToType(name) !== null` to discover "this name is not a reference"                                        | the arm says so; the file no longer imports the keyword table at all                            |
| `wat-writer`                       | could not use its `$`-aware `writeName` for heap types, because one path wrote both keywords and identifiers verbatim | a `$T` goes through the normal quoting path                                                     |
| `bridge.heapTypeForBridge`         | a TEN-case switch translating keyword strings into enum members                                                       | `return h.name` — and the assignment is what proves both sides spell the same twelve            |

⚠️ **That switch had a latent bug**: it was missing `exn` and `noexn`, so those fell to the default
and threw _"not resolved"_ for a heap type that was perfectly resolved. A hand-written mapping
between two enumerations is exactly where that hides — worth more than the lines saved.

🔑 **The evidence the third form was RIGHT, not merely tidier: the lexer already distinguished
them.** `parseHeapTypeVar` switches on `TokenType.Var` for `$T` against `TokenType.HeapType` for a
keyword. The token stream knew, the IR discarded it, and four consumers reconstructed it by table
lookup. The parser now just says what it read.

###### 🛑 Widening a union has TWO blind spots a compiler-driven conversion cannot see

Both cost a full gate cycle. Neither is a type error, because **the old arm is still legal in the
new union** — adding an arm does not invalidate code that tests or builds an existing one.

1. **`h.kind === 'name'` tests silently NARROW.** They meant "keyword or `$T`" and now mean "`$T`
   only". Three sites: the `(ref null func)` → one-byte `funcref` collapse, the funcidx-elem `func`
   shorthand, and one downstream. Caught by the behavioural tests.
2. **`{ kind: 'name', name: 'func' }` LITERALS silently keep building the old shape.** Six sites.
   Caught by `deno task baseline` — one funcidx elem segment stopped printing its shorthand — and
   the other five were latent in the two validators, where a keyword in the wrong arm makes
   `sameHeap` compare unequal against a correctly-parsed one.

**The defence is a constructor per arm** (`heapAbstract`), which makes the wrong arm hard to build
by accident where a bare literal makes it easy. `heap_type_arms.test.ts` asserts the invariant
directly over BOTH front ends, and is verified to fail when a literal is reintroduced.

⚠️ **`deno task baseline` earned its place here** — the check comparing our own bytes against our
own, which looks like the weakest oracle in the set, was the ONLY one that could see blind spot 2.
The binary hashes were unchanged and only the text hashes moved, which located it to the WAT writer
immediately; dumping one module's WAT on each branch and diffing gave the answer in one step, where
a hash only ever says "different".

###### The prerequisite: binaryen-ts had the wrong WAT keywords

`AbstractHeapType.Ext`/`NoExt` were `'ext'`/`'noext'` — binaryen's internal C++ spellings, not WAT.
Since `heapTypeToString` returns the value AS the keyword, the parser rejected `(ref null extern)`
and the printer emitted `(ref null ext)`, which nothing accepts; `exn`/`noexn` were missing from the
parser map entirely. Four of twelve broken in both directions, fixed in `62032c7c6` with a test
verified to fail against the old spelling.

⚠️ **Upstream wabt could not arbitrate it**: 1.0.41 has no GC heap-type text support at all
(`(ref null any)` → `unexpected token "any"`), the same limitation that makes `spec:prepare` skip 30
files. A first probe with `--enable-all` appeared to show `any` and `eq` rejected too — that was the
flags, not the keywords. **When the usual third oracle cannot reach the feature, the spec is the
oracle and that must be said out loud.**

The enum became a const object + type alias so its members are assignable to the keyword union —
TypeScript string enums are NOMINAL, so an enum member could not have been stored in the shared
type. Every call site (`AbstractHeapType.Any`, `h: AbstractHeapType`, `Object.values(…)`) is
unchanged, and the conversion was source-compatible on the first check.

**Gate**: 954 tests, baseline IDENTICAL, bridge 397/421, spec 100% on four axes, lint clean.

##### The 28 structural kinds — RE-MEASURED 2026-09-09, and the scoping was stale

⚠️ **Group 1 was scoped as "no new decision — differs by the `Var` call already made". The call was
made; the CONVERSION was not.** Re-measuring before touching anything found **28 entity references
across 11 field names** still held as a resolved scalar — because the step-4 measurement found its
five families by looking at kinds whose field sets differed by exactly ONE pair, and that method
cannot see a kind differing several ways at once, which is every kind in this set.

Converted in two commits, split by the accessor each needs:

| batch      | fields | what                                                                      |
| ---------- | ------ | ------------------------------------------------------------------------- |
| index-form | 4      | `fieldIndex`→`fieldVar`, `dataSegment`→`dataVar`, `elemSegment`→`elemVar` |
| name-form  | 17     | `table` ×7, `segment` ×6, `tag`, `Call.target`, `destTable`/`sourceTable` |

**NOT converted, each deliberately:** the 7 LABEL references (`name` ×5, `delegateTarget`,
`Rethrow.target`) — wabt-ts holds a relative DEPTH, binaryen-ts a symbolic label, which is different
modelling and belongs with the block family; `CatchClause.tag`, inside the `try_table` catch shape,
a Group 2 decision that converting would settle by accident; and module-level references
(`ElementSegment.table`, exports), a separate surface.

###### Where the 28 stand now

| bucket         | n  |                                                                                                           |
| -------------- | -- | --------------------------------------------------------------------------------------------------------- |
| **RESOLVED**   | 4  | `array.new_data`, `array.new_elem`, `struct.get`, `struct.set` — identical once `Expr`/`Expression` unify |
| **RENAME**     | 8  | same field count and types, different operand names                                                       |
| **STRUCTURAL** | 16 | a real decision remains                                                                                   |

**RENAME (8):** `array.copy`, `array.fill`, `array.init_data`, `array.init_elem`, `array.new_fixed`,
`memory.copy`, `memory.init`, `table.copy`.

🛑 **`table.copy` is NOT mechanical, and a blind rename would silently swap two fields.** `source`
exists on BOTH sides with different meanings:

```
wabt-ts : dst: Var;        source: Var;        dest: Expr; srcOffset: Expr; size: Expr
bn      : destTable: Var;  sourceTable: Var;   dest: Expr; source: Expr;    size: Expr
```

wabt-ts's `source` is the source TABLE; binaryen-ts's `source` is the source OFFSET operand.
Unifying on the name would hand one side a table where it expects an operand — valid types on both
sides of the swap, and no compiler complaint. Rename `srcOffset`/`source` first, or rename the table
reference, but never both to `source`.

⚠️ **The measurement itself had an artifact, caught before it misled anything.** The classifier
paired fields BY POSITION, so `memory.init` read as `segment/memory, memidx/segment` when the real
mapping is segment↔segment and memidx↔memory — the field ORDER differs, which is not a rename at
all. Fixed to report set differences. Nth artifact of this class in this project; a positional
comparison of two independently-authored structures is never right.

**STRUCTURAL (16):** `block`, `br`, `br_on`, `call_indirect`, `if`, `load`, `loop`, `ref.as`,
`ref.null`, `select`, `simd.load`, `simd.load_store_lane`, `simd.shuffle`, `store`, `try`,
`try_table` — Group 2's seven decisions, Group 3's five ties, and the block/label family.

###### ✅ The 8 renames — DONE. The 28 stand at 12 RESOLVED / 16 STRUCTURAL

Direction decided by MEASUREMENT in every case, and the crude instrument would have been wrong
twice.

⚠️ **A repo-wide `.field` grep is the wrong instrument for a per-node question.** It reported
`.offset` 68 vs 74 and `.memidx` 67 vs `memory` 20 — counting every memarg, every `module.memory`
and every unrelated `.offset` in the tree. **Trial the rename and count compile errors instead**;
that is the true blast radius.

| pair                                | true cost     | direction                                             |
| ----------------------------------- | ------------- | ----------------------------------------------------- |
| the four `array.*` operand families | 20 vs 27      | wabt-ts's names — a real tie, decided on cost         |
| `memory` → `memidx` (9 kinds)       | **10 vs 133** | wabt-ts's, decisively. The grep had said the opposite |
| `table.copy`                        | —             | **binaryen-ts's, on SAFETY not cost**                 |

🔑 **These operand names never appear in emitted output**, so neither fidelity nor round-trip
readability binds and it genuinely is pure cost — which is exactly when blast radius is the right
rule. The `memidx` asymmetry is 13× because wabt-ts's name appears in its writers, validators and
name-resolution passes while binaryen-ts's is read almost only by its encoder. They were never
equally entrenched; they only looked that way from outside.

🛑 **`table.copy` was decided on safety.** wabt-ts had `dst` (the destination TABLE) beside `dest`
(the destination index OPERAND) — one letter apart, different meanings. TypeScript itself kept
offering _"Did you mean to write 'dest'?"_. binaryen-ts's `destTable`/`sourceTable` +
`dest`/`source` is unambiguous, so cost did not get a vote.

⚠️ **It needed two SEQUENCED passes.** `source` had to keep meaning the table until every table site
was converted; only then could `srcOffset` take the name. Both at once makes every `source` site
ambiguous — the compiler says "property does not exist" without saying which one was meant, and no
script can choose. **When two fields swap names, sequence the passes and verify clean between
them.**

`memory.init` and `table.init` follow with `dest`/`source`. `table.init` was not in the 28 — it
differs only by that one name — but it shares a `walk.ts` case with `memory.init` and carried the
identical divergence for the identical role. Leaving it would have meant splitting a walk case to
preserve an inconsistency.

###### Two mechanical hazards this batch kept hitting

- **`walk.ts` is where the property-key problem lives**, three times now. It is the one file that
  rebuilds every node as a mapping literal, so a rename must touch its KEYS and its READS, and a
  caret-anchored script only ever sees one of them. Check it explicitly.
- **A conditional object SPREAD bypasses excess-property checking** — the seventh silent mode, and
  the only one in this series that moved emitted bytes. See `cmem/best-practices.md`.

###### What remains: 16 structural, and they are DECISIONS

`block`, `br`, `br_on`, `call_indirect`, `if`, `load`, `loop`, `ref.as`, `ref.null`, `select`,
`simd.load`, `simd.load_store_lane`, `simd.shuffle`, `store`, `try`, `try_table`.

That is Group 2's seven worst-condition calls, Group 3's five ties, and the block/label family —
which also owns the 7 label references (`name` ×5, `delegateTarget`, `Rethrow.target`) and
`CatchClause.tag`, all deliberately routed around during the mechanical passes so they would not be
settled by accident.

##### Group 2 — the seven real decisions 🚧 6 of 7 IMPLEMENTED, and 7a / 7b(i) of the seventh

The decisions themselves were made when the 28 were scoped; these are the implementations, each its
own commit and gate.

###### ✅ 1. An operator field on a kind with exactly ONE instruction — DROPPED

binaryen-ts's `RefAsExpr.opcode` and `RefAsOp`; wabt-ts's `SimdShuffleOpExpr.opcode`.

`RefAsOp` had one member (`RefAsNonNull: 0xd4`) but was typed `Opcode`, so the field ADMITTED every
instruction, was always set to the one value, and the encoder THREW for anything else — three
mechanisms enforcing what the kind already said.

⚠️ **Its doc carried a live reservation** — "the extern conversions are post-MVP and would be added
here rather than as separate expression kinds" — and dropping the field would foreclose it. Except
wabt-ts already models them as their own kinds (`any.convert_extern` / `extern.convert_any`) and
binaryen-ts models them not at all, so the unified IR has taken the other road. **Superseded, not
abandoned**, and said so in a comment where the enum stood: a reader finding neither the enum nor an
explanation would reasonably re-add it.

`simd.shuffle` went the same way — the WAT writer already hardcoded `i8x16.shuffle`, which is the
tell. Needed a named constant, `OPCODE_I8X16_SHUFFLE`, in `core/opcode.ts` beside the opcode table
rather than inline at the writer.

###### ✅ 2. Memarg `offset` is `bigint` — and memory64 ACTUALLY WORKS now

The one where **fidelity binds rather than cost**: `number` cannot represent a valid memory64 module
at all.

This closed a real gap rather than only unifying a type. `writeU32` begins `n >>>= 0`, so a load at
offset 2³²+8 re-encoded as one at offset 8 — valid wasm, wrong address, no diagnostic. The bridge
carried the honest version of the same limitation, throwing "memory64 not supported yet". Both gone.

The encoder needed a genuinely new `writeU64`: `writeU32` truncates and `writeI64` is SIGNED, so
neither existing writer served.

🛑 **The mechanical pass twice produced code that satisfied the compiler while preserving the exact
loss the change existed to remove:**

- in the bridge, `BigInt(bigintOffsetToNumber(off, 'load'))` — a bigint→number→bigint round trip
  THROUGH the lossy check;
- in the parser, 45 call sites wrapped as `BigInt(offset)` where `offset` came from `readU32`.

The real fix each time was one line at the source (`readMemArg` uses `readU64`, which the reader
already had). **A wrapper that satisfies the type checker is not evidence that the value survived.**

###### ✅ 3. `try`'s catches are RECORDS — the highest-yield decision so far

Three mechanisms existed ONLY because the parallel `catchTags[]` / `catchBodies[]` permitted an
invalid state. All three are gone rather than merely passing:

| mechanism                                        | why it existed                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the encoder's length guard                       | its comment records the defect: "a mismatched `Try` emitted a `catch` opcode with no handler after it, corrupting the rest of the function body"                |
| the `catch_all` SENTINEL                         | the two halves **actually disagreed** — parser wrote `$__catch_all`, encoder tested `tag === ''`, so every catch_all died with "unresolved catch tag reference" |
| `cfg.ts`'s "same length by construction" comment | reasoning the type now carries                                                                                                                                  |

Two sentinels had been tried before absence: a named one collides with a real tag, an empty one
needs both halves to agree. **A missing field cannot be spelled two ways.**

✅ **It also removed a capability gap**: `catch_ref` / `catch_all_ref` threw "not yet supported" at
the bridge because there was no slot for the flag and dropping it would change what the handler
receives. Four lines, because wabt-ts already had the opcodes.

🔑 **The strongest evidence for the shape: binaryen-ts ALREADY modelled `try_table`'s clauses as
records** (`CatchClause`). The same concept, two representations, in one file — and only the
parallel one accumulated a guard, a sentinel and a bug history.

⚠️ **A test had pinned the sentinel** (`['$e', '']`, "as the encoder requires") and had ALREADY been
rewritten once for the same reason. Each version recorded an internal convention as though it were
the requirement, which is what let the mismatch read as intended behaviour. It now pins absence.

###### Two testing notes from this batch

- **Do not scan a whole binary for an opcode byte.** The first version of
  `try_catch_clauses.test.ts` collected an `0x08` from a section header and failed on a correct
  encoding. **Diff two encodings that differ only in the property under test** — self-anchoring, and
  a stronger claim: flipping `isRef` on the middle of three clauses moves exactly one byte.
- `memory64_offset.test.ts` pins all three places a width loss can hide (encoder, reader, and a
  type-widening conversion between them). Verified against the truncating encoder: **5 of 7 cases
  fail and the two below 2³² still pass**, so it discriminates on the boundary rather than merely
  going red.

###### ✅ 4. Load/store hold their OPCODE — and three defects went with the old shape

`LoadExpr` drops `bytes` + `signed`, `StoreExpr` drops `bytes`; both hold `opcode: Opcode`. Width,
sign and type come from ONE table, `src/binaryen-ts/ir/memory-access.ts`, which replaced five copies
(encoder `loadOpcode`/`storeOpcode`, bridge `loadInfo`/`storeBytes`, WAT-parser
`loadBytes`/`storeBytes`). The table is tested against sources that are not itself: each row's
mnemonic against wabt-ts's `anyOpcodeName`, and each width against what the mnemonic states — either
check alone misses half of a rotation (right names, wrong widths).

Three defects, each a consequence of re-deriving the opcode:

| defect                                                                                                      | caught by                                   | closed in                 |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------- |
| i64 narrow stores ROTATED in the encoder and INVERSELY in the decoder; `i64.store8` wrote 2 bytes           | executing under V8, per half, independently | `b8b3150db` (before this) |
| a store's opcode read off its OPERAND's type → "cannot encode store with value type: none"                  | 5 of the bridge's 24 failures               | `006326af7`               |
| WAT names matched by pattern: `f32.load8_s`→`f32.load`, `f64.store8`→`f64.store`, `i32.load32_s`→`i32.load` | a probe; upstream wat2wasm rejects all five | `006326af7`               |

**Bridge 397 → 401.** Four of the five store failures round-trip; the fifth (`59_AsyncClosureCb`)
was masking a second failure and now sits in the dominant fallthru class with the other 17 — which
is step 5's. A per-file diff against `main` said so; the totals could not.

🛑 **The compiler's error list was complete for loads and blind for stores.** `makeLoad` changed
arity; `makeStore` did not, and its old first argument — a width, 1/2/4/8/16 — is a valid `Opcode`
value at every width (`nop`, `block`, `if`, `throw`, `call`). Every unconverted store call
type-checked. Store sites were found by grep, `makeStore` now validates its opcode, and this is the
eighth silent mode in [best-practices.md](best-practices.md).

API-visible: `LoadExpr`/`StoreExpr` and both factory signatures via `./ir/binaryen-ts`, which now
also exports the table (`loadShape`, `storeShape`, `withSigned`, …) for anyone who read `.bytes`.

###### ✅ 6. Branch and return values are a LIST — option A, owner-decided (`2b5850a8a`)

Owner, 2026-09-10: **"go with 6A … and fix any bugs first"** — so the bug queue the premise probes
found was cleared and merged first (`31ec7cc86`), and 6A started from a clean `main`.

`Break`, `Switch` and `Return` hold `values: Expression[]` in stack order, as wabt-ts's nodes do.
`tuple.make` — built only to pack 2+ values into the one `value` slot, emitted as its operands — is
deleted, and so is the phantom `tuple.extract`. Divergence V1 in [divergences.md](divergences.md).
The premise probe had already shown fidelity does not bind here; what decided it is that **the
packing step is where both halves dropped values**, four times between them.

The trial predicted ~26 src + 12 test sites; the compiler named 76 src error lines (several per
site) and 63 in tests. The test sites were rewritten by a Deno script with a balanced-paren scanner
that skips strings and comments, its per-file counts checked against the compiler's (8 of 8 files
matched), never `String.replace`.

| found                                                                                                       | how                                                       | disposition                                   |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| decoder `return` popped ONE value in any function with results — the rest left as loose statements          | reading the call site the compiler flagged                | fixed; latent (no pass disturbed it — probed) |
| the bridge's `br_table` passed `null` for its values, dropping wabt-ts's `BrTableExpr.values`               | the new `values` argument made the omission visible       | fixed; V8 rejected folded input               |
| the WAT parser built `br_if` as a literal typed `none` even when carrying values                            | a literal construction beside a factory that did it right | fixed; latent (probed: no output changed)     |
| the operators gate stayed green with `TupleExtract` still pinned after its deletion                         | the phantom count moved 7 → 6 and nothing complained      | the budget is now a RATCHET                   |
| a test's structural cast `{ …; value: unknown }` compiled after the rename                                  | the suite: `undefined !== null`                           | the real `SwitchExpr` type                    |
| a `br_table` comment calling mixed tables "rejected" beside the trampoline that serves them; two more stale | editing in place                                          | corrected                                     |

**Measured against `main`, 421 corpus modules: parse→encode, `-O1` and `-Oz` all 421/421
byte-identical.** Bridge 401/421, unchanged — the corpus reaches the bridge through the binary
reader, where branch values are linear statements, not `values`. Two things were kept exactly as
they were so that would hold, and are open:

- ⬚ **walk order**: `mapExpression` / `walkExpression` visit a `Break`'s condition BEFORE its values
  — the reverse of wasm's evaluation order (the CFG builder has it right). Harmless for pure
  visitors; wrong for any order-sensitive one.
- ⬚ **LocalCSE and multi-value `return`**: left opaque, as the `tuple.make` was. Rewriting several
  values needs the between-operand invalidation `Binary` already does.

⚠️ **`values.length` is not always the arity.** An entry that itself leaves several values — a
multi-value `call` or `block`, or flatten's `return` of a whole multi-result body — stands for all
of them. `valuesType` flattens such entries; nothing should count `values` to find the arity.

###### 🚧 7. Declared types and block parameters — 7a and 7b(i) done, 7c open (2026-09-10)

Owner: 7a (select `resultType` on the node), 7b(i) (block params on the node, lowered where
optimization starts), 7c (FORM in the fidelity side table). Five commits, each gated:

| commit      | what                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `c0bab64ac` | 7 control-node literals → factories (`makeBlock` gains a declared type) — found Flatten dropping an `if`'s label        |
| `7171b8b38` | **7a** `SelectExpr.resultType` — S1 closes with no side table; the bridge was dropping the declaration                  |
| `73a1066fb` | the `br_table` trampoline's wrapper blocks were typed `unreachable`; DCE deleted cases — any -O level broke it          |
| `02d77f533` | **7b(i)** `params?: BlockParams` on block/loop/if/try/try_table; decoder keeps them; `PassRunner` lowers by re-decoding |
| `c309e57a0` | wabt-ts's folded `if` dropped its condition-slot inputs (found probing folded block params)                             |

🔑 **7a needed no side table.** A declared result type is semantics for references and its PRESENCE
is the form, so one field on the node is both. The side table is for form that is not also meaning.

🔑 **7b(i) lowers by RE-DECODING.** Placed `Pop`s do not say which parameter they are; the decoder's
stack does. So `lowerBlockParams` encodes the module and decodes it with the long-standing lowering,
swapping in only the parametrised functions' bodies, and refuses (loudly) a module whose names no
longer match its own bytes.

⚠️ **The owner corrected a false rationale mid-step**: I had the binaryen-ts WAT parser refusing
block params because it "reads folded form only". Every linear instruction has a folded form (add
parentheses — best-practices); upstream wat2wasm reads all four folded spellings, and probing them
found the wabt-ts `if` defect above and three more divergences (W4, W5, W6 in divergences.md) —
including that **wabt-ts matches upstream wat2wasm byte-for-byte on only 146 of 421 corpus files**.

**Measured against `main` at each step: 421/421 byte-identical on parse→encode, -O1 and -Oz.** No
corpus module has a typed select or block parameters, so the corpus could not see these changes —
their tests carry them, each inverted.

###### ✅ 7c — the written type INDEX, on the node (2026-09-11)

Two form losses, both in binaryen-ts, both closed by recording what the header NAMED:

- **T1** — `call_indirect (type $b)` came back `(type $a)`: the encoder derived the index by
  matching the signature, and a module may hold several identical function types.
- **a block header written as a type INDEX** came back inline (`02 00` → `02 7f`). Same type,
  different bytes.

🔑 **It rides on the NODE, not in wabt-ts's side table** — binaryen-ts's IR has no `NodeId` to key
that table with, and 7a/7b(i) set the precedent (`resultType`, `params`). `PassRunner` drops it
before the first pass runs: a pass may retype a construct and leave the index naming something else.

🔧 **Recording it unconditionally broke every lowered block-parameter case** — the index names a
type WITH parameters, and `lowerBlockParams` takes the parameters away, so the header re-declared
inputs nothing supplied ("not enough arguments on the stack for loop"). The index is kept only while
the node still has that signature: no parameters, or parameters kept.

⚠️ **T2 was not real on this path, and the row said it was.** "The encoder DERIVES the type-section
order, reordering input" does not happen for a decoded module: it keeps the decoder's type list, in
its own order, duplicates included. Three cases that would each come back reordered are pinned in
`tests/binaryen-ts/binary/written_type_index.test.ts`. T2's row is corrected rather than closed —
whatever was measured on 2026-09-10 was not the decode → encode path.

###### Remaining: none of 7

| # | decision                                      | note                                                                                                   |
| - | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 7 | `blockType` / `typeUse` / `select.resultType` | 7a ✅ `7171b8b38`; 7b(i) ✅ `02d77f533`; 7c ✅ — the written type index on the node, dropped by passes |

🔑 **The block/label family's answer is a PORT, not a new design — `TypeUse` already solves its
ambiguity.** An index-form `Var` on a branch target means three different things: the author wrote a
number, `resolveNames` resolved a name down to a depth, or a binary handed us a depth with no
spelling behind it at all. `TypeUse` (`Var | 'resolved' | 'inline'`, omitted when nothing was
written) exists for exactly that ambiguity on TYPE references — its doc names it: _"index 0 is
ambiguous between 'no annotation' and 'the source really wrote `(type 0)`'"_. Give a branch target
the same treatment and each of the three prints faithfully; N8's rule then reduces to "print the
recorded spelling, derive only when there is none", and the text→text consequence N8 accepted
disappears. What is left is mechanical: one field, a label stack in wabt-ts's binary writer
(binaryen-ts's `resolveLabel` is the template), and a reader that records which of the three it saw.

Plus Group 3's five ties and the block/label family — which still owns the 7 label references
(`name` ×5, `delegateTarget`, `Rethrow.target`) and `CatchClause.tag`, all deliberately routed
around so the mechanical passes could not settle them by accident.

###### ✅ The block/label family and the catch clauses — DONE 2026-09-11

Recorded here 2026-09-14; until then this series lived only in machine-local memory and in the merge
messages. In landing order:

- **A branch to a NAMED label prints the name — N8, `61d991592`.** `wasm2wat` printed `block $outer`
  and then `br 1 (;@1;)` below it: N2 reads label names and nothing used them. `wasm-tools print` is
  the oracle (upstream `wasm2wat` has no label names to print). ⚠️ Only where the name MEANS that
  block — a nearer label sharing the name keeps the depth, or the branch would be retargeted. **415
  of 421 TEXT hashes moved, 0 byte hashes**, checked column by column and re-baselined in its own
  commit.
- **Labels keep their NAME; the binary writer resolves the depth — `3e1cc60b1`.** `resolveLabelVar`
  rewrote every label reference to a depth, and that rewrite is what CREATED the ambiguity: `br 1`
  and `br $b` both became an index. 🔑 **A label is the ONE reference that needs no rewriting** —
  its target is a position on the block stack the writer already walks, not an entry in a
  module-level index space. So `resolveNames` now only CHECKS, and the binary writer resolves
  (`writeLabelVar`, innermost first so a nearer same name shadows). Corpus byte-identical.
  - ⚠️ Two scopes are not the obvious one, both in the spec: a `try`'s own label is out of scope for
    its `delegate`, and a `try_table`'s for its catch targets. **The inversion run is what showed
    both had no coverage** — the parser had tests, the writer had none.
  - `rethrow $l` is a label reference too; it was the one site missed.
  - `writeBinaryIr` no longer needs a prior resolve pass for labels; the per-function scope reset
    became a LOUD balance check, since a silent reset would hide an imbalance that shifts every
    depth.
- **The text→text residual closed before it could spread — `2abb7880c`.** It was live in the PUBLIC
  compat API: `parseWat(…).toText()` is text → IR → text with NO binary hop (`wabt-compat.ts`), and
  it rewrote `(block $b (br 0))` into `(br $b)`. Only the CALLER knows whether an index carries a
  spelling, so `WriteWatOptions.namedLabelTargets` (default OFF) carries that bit: `wasm2wat` sets
  it (a binary's index is a depth), a text-parsing caller does not. ⚠️ **The corpus could never have
  caught it**: 17 of 421 files hold 2,090 authored numeric labels and 0 point at a NAMED block, so
  the byte baseline is blind to the whole class — it needed a test, not a re-baseline. 🔑 The merged
  tree still wants NAMES in the tree (binaryen-ts's form — a depth silently retargets when a pass
  inserts a block) with the as-written form beside it; this removed the wabt-ts half of the
  obstacle.
- **A `try_table` catch clause carries its kind ONCE — `b1410d6e8`.** Scoping `CatchClause.tag`
  found more than a naming difference: `TableCatch` held `kind: CatchKind` AND `tag?: Var`, whose
  PRESENCE says the same thing, and the binary writer read them separately (`catchKindByte(c.kind)`,
  then `if (c.tag !== undefined)`) — so `CatchAll` plus a tag would emit the catch_all byte AND a
  stray tag index, sliding every later clause by a field. Nothing built that state, so this closed
  the SHAPE: two shapes, tagged kinds REQUIRING a tag, the catch_all pair unable to carry one. Two
  `c.tag!` assertions in the bridge went (the switch now narrows). 🔑 **For an unrepresentability
  change the inversion is COMPILE-TIME**: the load-bearing assertions are `@ts-expect-error`,
  checked by `deno task check` — widening the union back makes four of them stop erroring and the
  gate fails. Verified by doing it.
- **Every single-label reference is `target`, in BOTH IRs — `d85635eb1`** (`targets` /
  `defaultTarget` for the table, which already agreed). Measured: converting binaryen-ts's `name` /
  `label` / `dest` = 24 sites, the reverse = 45. wabt-ts's `rethrow.depth` → `target` too (9 sites):
  `depth` described only ONE of a `Var`'s two forms, and since the writer resolves label names, what
  reaches that field from text is a NAME. ⚠️ `name` is overloaded (a block's OWN label), so this
  went per compile error; the scripted pass still over-corrected `block.name` → `block.target` twice
  and the COMPILER caught both. ⬚ Deliberately left: `delegate` vs `delegateTarget` (not worse, and
  not a branch target), and the try's OWN label (`label` vs `name`) — a definition, not a reference.
- **The catch tag is a `Var`, spelled once — `949bee3b8`.** binaryen-ts held `TryCatch.tag?: Var`
  (legacy) beside `CatchClause.tag: string | null` (try_table) — one concept, two shapes, with the
  encoder wrapping the second in `varFromToken()` to resolve what the first passed straight through.
  Both are `tag?: Var` now. 🔑 NOT the redundancy class `TableCatch` closed: `CatchClause` is two
  ORTHOGONAL bits (has-tag × is-ref) and always was. Consistency plus the merged tree's form;
  nothing gains fidelity today, since binaryen-ts's decoder and WAT parser both produce names. ⚠️
  `exactOptionalPropertyTypes` matters here: the decoder's scratch list stays `tag: Var | undefined`
  (every entry HAS the slot); only the IR clause distinguishes absent. A stale `tag !== null`
  assertion passed either way once `null` was gone — **check what an assertion still ASKS after a
  sentinel changes.**

⚠️ `else_` in `binaryen-ts/api/` is a public PARAMETER of the compat façade, not the `if` field
Group 3 renamed — do not rename it with the field.

###### 🔬 Premises of 6 and 7 re-checked 2026-09-10, BEFORE either is implemented

Decision 5's recorded reason turned out false, so both remaining rows were probed against upstream
wat2wasm 1.0.41 — binaryen-ts's binary round trip and its WAT path, code and type sections compared.

**Decision 6 is wider than its row, and its reason does not hold.** It covers FOUR instructions —
`br`, `br_if` (binaryen-ts's one `Break`), `br_table` (`Switch`) and `return`. wabt-ts gives all
four `values: Expr[]`; binaryen-ts gives them `value: Expression | null` and packs 2+ values in a
`tuple.make` — which is purely a synthetic container here (built only for branch operands; the
encoder emits its operands inline; `TupleExtract` is declared and never built). The same one-slot-
or-wrapper shape decision 5 removed. Probed: multi-value `br`, `br_if`, `return` round-trip
byte-identically on BOTH paths, so **fidelity does not bind** — the representation holds them. But:

- 🛑 **binaryen-ts's WAT parser drops a value from a multi-value `br_table`** — V8 rejects the
  result (probe 6c). The representation could hold both; the parser built one. **wabt-ts hit the
  same class and fixed it by moving to lists** (its `BrExpr.values` doc: the single `value?` slot
  "silently dropped all but the first"). Both sides have now dropped values at the packing step.
- Trials: lists win → 26 src sites (9 in passes, 12 in ir) + 12 tests; single wins → 27 src (10 in
  the bridge step 5 deletes, so ~17) + 4 tests. Roughly even.

**Decision 7's reason is CONFIRMED — and understated.** binaryen-ts cannot represent the as-written
forms at all, and one gap is a validity gap, not only fidelity:

| probe                                         | binary round trip                                  | WAT path                       |
| --------------------------------------------- | -------------------------------------------------- | ------------------------------ |
| `select (result i32)` (opcode `0x1c`)         | 🛑 **decoder rejects `0x1c`: "unknown opcode"**    | rejects `(result …)`           |
| block with `(param i32)`                      | rewritten to `local.set`/`local.get` + a new local | rejects `(param …)`            |
| `call_indirect (type $b)`, identical `$a` too | re-encoded as type index 0, not 1                  | throws (next row)              |
| block `(type $t)`, one result                 | same as upstream (both write the inline valtype)   | rejects `(type $t)` on a block |
| `block (result i32 i32)`                      | same                                               | same                           |

🛑 **Found in passing, WAT path:** once ANY `(type …)` is declared, a function whose signature is
not among the declared types throws `unresolved GC function type`, and `(func (type $a))` reports
`() -> ()` — the function's own type use is IGNORED. Loud, not silent; neither the corpus (it
reaches binaryen-ts through wabt-ts's wat2wasm) nor the spec harness (it drives wabt-ts) reaches
this path.

🔑 **What decision 7 actually is:** not "which side's fields win" — binaryen-ts has no fields to
lose. It is whether the unified node carries the SEMANTICS binaryen-ts lacks (block params; a typed
select's result type, which validity needs for reference types) and where the FORM lives (inline
valtype vs type index; which of two identical type indices). A candidate split: semantics on the
node, form in the fidelity side table — which is what "the table SHADOWS them" was reaching for.

###### ✅ 5. Region bodies — neither form: a `RegionExpr` in every region slot (`365e9277c`)

🔧 **The Group 2 table's reason for this row was OVERSTATED.** It says "fidelity binds" because a
multi-instruction body must sit in a synthetic `Block`. Probed against upstream `wat2wasm`: a block
the SOURCE wrote without a label survives both binaryen-ts paths byte-for-byte — inside a `loop`, an
`if` arm, as a function body, typed and untyped, 5 of 5. The single-expression form IS faithful
today. It is faithful **by convention**: `labelFor` names every source block, so `name === null` can
mean "synthetic wrapper". Nothing in the type enforces that, which is the UNREPRESENTABLE rule's
sentinel tell — and the wrapper it protects has cost twice (C6's silent miscompile; the orphan type
entry from a multi-value function-body wrapper).

**The trials** (field types flipped, `deno task check`, reverted; counts are per-site sums — the
`Found N` line counts only the first of two programs, since `tests/binaryen-ts` is a workspace
member):

| option                                                          | src sites                            | test sites                          |
| --------------------------------------------------------------- | ------------------------------------ | ----------------------------------- |
| single wins — wabt-ts `loop`/`try`/`try_table` → one `Expr`     | 35 (10 in the bridge step 5 deletes) | 1                                   |
| lists win — the same three only                                 | 39                                   | 4                                   |
| lists, all seven region slots (+ catch bodies, `if`, functions) | ~160                                 | 354                                 |
| **every slot narrowed to a list-node subtype of `Expression`**  | **49** (29 passes, **0 encoder**)    | 124, mostly absorbable by factories |

Each pure form's cons were real on the other side: single moves wrappers and their convention into
wabt-ts, the FIDELITY half; lists break the one-slot shape every binaryen-ts pass (and its upstream
C++ reference) is written against, and converting only three kinds keeps the whole wrapper mechanism
alive for `if` arms, catch bodies and function bodies.

**The blend, chosen by the owner:** a new interface,
`RegionExpr { kind: Region; children:
Expression[] }`, held by all seven slots (`loop`, `try`, each
catch, `try_table`, both `if` arms, the function body), ALWAYS — even for 0 or 1 instructions, so a
body has one spelling. It is an `Expression`, so reading, visiting, typing or replacing a slot is
unchanged; it is its own KIND, so "synthetic" is a type fact, not a naming convention. Blocks are
only ever blocks.

What it deliberately leaves, and the sweeps it therefore owes:

- **A new kind.** `walk.ts` throws on an unknown kind, so the central walkers fail loud; **16
  private kind switches in 10 files** do not, and must be swept.
- **30 `kind === Block` tests (10 pass files).** One applied directly to a slot becomes a compile
  error (no overlap). One on a node reached through a walker just stops matching — silent mode 4.
- **A `Region` in an operand slot type-checks.** The encoder rejects it loudly. Excluding it from
  the `Expression` union would enforce it but makes every slot read a type error — the list cost.
- Byte gates cannot see a pass that stops firing, so the fuzz and pipeline tests carry this one.

Rejected variant: keep the slot a `BlockExpr` that is synthetic by POSITION. No new kind, but its
`name` would be settable and meaningless, and type registration would have to know position —
trading one convention for another.

All seven slots in ONE commit: at 49 sites it is affordable, and stopping part-way is what would
leave the wrapper mechanism alive.

**Implemented 2026-09-10 — what the implementation found that the plan did not:**

| found                                                                                                     | how                                         | disposition                          |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------ |
| an emitted unnamed block/if/try shadowed the FUNCTION frame (`''` meant both) — V8-valid, wrong value     | probed while designing; C6 had one instance | fixed first, `2f519bde7`             |
| the decoder invented a `nop` for an EMPTY body (`03 40 0b` → `03 40 01 0b`)                               | probe vs upstream                           | fixed by the region                  |
| the decoder dropped an explicit EMPTY `else` from a valid binary                                          | hand-assembled binary                       | fixed by the region                  |
| 5 passes' private switches handled `Block` and defaulted past `Region` — every body silently unoptimized  | the switch sweep                            | Region added to each                 |
| 5 places put a body where a STATEMENT goes (StripEH, remove-unused-names, asyncify ×2, inlining, flatten) | grep for body/arm fields used as values     | `asStatement`                        |
| inlining's size thresholds counted nodes — regions would have moved them                                  | reading the counter                         | `countsTowardSize`, exact            |
| ~a dozen VACUOUS guarded assertions in tests; structural casts that accept a region                       | the conversion                              | `region_helpers.ts`                  |
| LocalCSE CSEs bare `local.get` and constants; upstream's `isRelevant` excludes both (LocalCSE.cpp:356)    | classifying the `-Oz` byte diff             | ✅ fixed `5b0cf25c6` (divergence C1) |
| the WAT path emits an `else` for `(else)` with no instructions; upstream wat2wasm omits it                | the empty-region probe                      | ✅ fixed `ce77680de` (divergence W1) |

**Measured against `main`, 421 corpus modules:** parse→encode **421/421 byte-identical**; `-O1` 2
differ (−2 each); `-Oz` 28 differ, net **+128 bytes**, all V8-valid, every one classified — an
all-nop body now encodes as nothing instead of `nop`, and LocalCSE reaching single-instruction
bodies (the OPEN divergence above; it was already live on multi-statement bodies). Bridge held at
401/421; baseline IDENTICAL; spec 100% on four axes.

✅ **The LocalCSE half is gone** (`5b0cf25c6`): once CSE follows upstream's relevance rule, `-Oz` is
**−37,262 bytes** (−3.9%) against the pre-fix tree — 339 modules smaller, 0 larger, 421/421 valid.
The +128 was never regions' cost; it was a pass defect that regions exposed. The all-nop half is
divergence R2 (DESIGN): `wasm-opt --vacuum` leaves one `nop` where we leave nothing.

⚠️ **A region's TYPE is its contents' type**, not the construct's. The wrapper stamped the declared
type because it wrote a blocktype; a region never does, so the declared type stays on the construct.
Passes that ask an arm "do you produce a value?" through its type then get the answer a
one-instruction arm always gave.

##### Step 5 — delete the bridge, and carry its type derivation forward

1,923 lines plus 13 test files when this step was planned (2026-09-04); 1,803 lines on 2026-09-14.
⚠️ **The bridge is also where a wabt-ts tree acquires its types today**; that derivation
(`inferBinaryType` / `inferUnaryType`) becomes a pass over the unified tree, or binaryen-ts's passes
get nodes with no `type` to dispatch on.

**Acceptance**: `deno task bridge` goes 401/421 → **421/421** (it opened at 397). If it does not,
C10a's diagnosis was wrong and this whole step rests on a mistake — which is exactly what the gate
was built to be able to say.

##### The bridge and the WAT routes into binaryen-ts — history, summarized

Consolidated 2026-09-14 from `bridge.md` and `text-routes.md` under the cleanup policy
([INDEX.md](INDEX.md)); full text of each: `git show 1672c2a5a:cmem/bridge.md` and
`git show 1672c2a5a:cmem/text-routes.md`. The bridge's binding rules — reserved upstream names in
paths, import aliases that must not shadow a package — moved to [project.md](project.md).

**Until this step lands, two things matter when touching the bridge** (`src/bridge/bridge.ts`, tests
`tests/bridge/`): it walks the wabt-ts IR by **direct recursion**, not the expression-visitor
delegate (reasoning: [wabt-ts.md](wabt-ts.md) § "Why direct recursion"); and it keeps **its OWN
label stack, which has diverged twice** — T13.22 the notorious one — so its tests are the first to
run after touching either IR's control flow. Tier coverage (~60 kinds plus the module surface) is
enumerated in [wabt-ts.md](wabt-ts.md) § "Tier coverage". And it is **deliberately NOT exported**
(decided 2026-08-27): a `./bridge` subpath would make the part of the tree most likely to change a
supported public surface, and the duplication permanent rather than resolved. Do not export it to
close a gap.

**What the bridge went through.** The merge turned a package boundary into an internal module (A7:
the exact `jsr:@jrmarcum/binaryen-ts@1.5.0` pin gone, 15 cross-tree imports now relative).
**T13.22**, two errors cancelling across the repository boundary, was closed BEFORE the merge,
because merging first would have made it permanently invisible — `buildCatchClause` now runs before
the label push, gated by a numeric probe in `try_table_catch_scope.test.ts`. **T13.50 / A1**, the
incomplete de-coarsening, closed in 1.5.2 (`50a959baa`) with six shapes in
`gc_decoarsening.test.ts`; its two lessons were **two defects stacked** (removing one refusal only
MOVED the error message, which is what showed the second) and **a tag case green for the wrong
reason** (a conjunction precondition, now in [best-practices.md](best-practices.md)). It moved to
`src/bridge/` in 1.5.3 (`e76e2b7ca`). Nothing ever shipped against it, and this step deletes it.

**The WAT routes, 2026-08-31 → 2026-09-10.** Asking whether "nothing ships against the bridge" could
be closed turned up a user-facing defect: **`wasm-opt` could not read the linear WAT our own
`wasm2wat` writes**, and died with an uncaught exception. Closed by routing (W4, `e18d9f09a`):
external WAT goes wabt-ts → bytes → the decoder, 421/421, and failures print `wasm-opt: <message>`,
exit 1. Measured on 150 files beforehand, the two WAT → binaryen routes covered different ground and
agreed byte-for-byte on 0 of the 70 both could read — the argument for one front door, not a second.

On the way, binaryen-ts's own `parseWat` was climbed from reading **1/421 → 421/421** of our folded
output, each fix revealing the next (1 → 2 → 101 → 302 → … → 421): numeric branch depths and
operands (307 modules), stack-sourced operands (44), numeric `call_indirect` types (39), an `if`
that pushed no label scope — whose silent half sent branches to the WRONG block (24), reconstructed
tag names (11), `try` (10), and a tail of four unrelated causes (`df24686ec`, `3ec5b29d6`). With the
ladder finished, 1.5.4 flipped `wasm2wat`'s default to folded (`357007307`). Pins: inline exports
and imports `tests/binaryen-ts/parser/inline_export.test.ts`; numeric references
`tests/binaryen-ts/encoder/numeric_refs.test.ts`; the loop result
`tests/wabt-ts/reader/loop_result.test.ts`. What it taught, kept here because it is not recorded
elsewhere:

- **A size win can be data loss.** binaryen-ts's output looked 1.24% smaller because `parseWat`
  silently dropped inline exports — 196 of 345 — and inline IMPORTS, which shift every later index
  so a valid module calls the wrong function. **Count the thing, not the bytes.** The real byte gap,
  once found, was wabt-ts not run-length-compressing locals: fixed for **42,437 bytes (2.7%)** over
  the corpus (baseline 1,557,602 → 1,515,165); binaryen-ts could take the same fix
  ([open-work.md](open-work.md)).
- 🔁 **RECONSTRUCTING a name instead of resolving an index** recurred three times — `$depth{N}` for
  branch labels, a name-only lookup for `call_indirect` types, `$tag{N}` for tags. Each is the name
  the parser would have synthesized for an anonymous construct, so each works until the construct
  has a name of its own — and it silently rots if the synthesizing side changes. **Resolve what is
  AT an index.**
- **"Structurally unfoldable" was wrong twice.** `br` / `br_if` / `return` carry `values`, hidden
  from a `grep -A 9` by a docstring; and multi-value results CAN fold —
  `(local.set 1 (call $two)) (local.set 0)` is valid, the second consumer taking its value from the
  stack. Hence the owner's folded-form rule in [best-practices.md](best-practices.md).
- **A defect invisible to every byte check**: a `loop` reaching its end did not push its result, so
  it could not fold — valid bytes, wrong IR shape. `loop_result.test.ts` asserts the SHAPE.
- **A wrong assumption held by two places produces correct output until one of them moves**:
  `writeFoldedConstExpr` and `writeInstrHead` both treated a leaf's linear rendering as its head,
  and the output was valid exactly as long as linear was the default.

##### Verification at every step

**CI's steps first** — `deno fmt --check` · `deno lint` · `deno task ci` (check + test) ·
`scripts/check-naming.sh` · `scripts/check-portability.sh` · `baseline` · `publish:dry` — then
`operators` · `spec` · `bridge`. The bridge gate must never regress below **401** (raised from 397
by decision 4) until step 5 raises it to 421.

🛑 This list used to start at `deno task test`, which runs `--no-check`. S6 step 4 left two
`scripts/` files uncompiled and nothing here could see it; CI would have on the first push.

#### Measured size of what remains

|                                            |                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| files importing wabt-ts's `Expr`           | 25                                                                                                                                                                                                                             |
| files importing binaryen-ts's `Expression` | 32                                                                                                                                                                                                                             |
| lines in the two IR modules + bridge       | 6,346                                                                                                                                                                                                                          |
| one-sided kinds still to reconcile         | **10** since K3 merged (2026-09-14); **11** when re-measured 2026-09-12 — 8 are one capability gap (K1), `code_metadata` (K2), `region` (R1). The "27 (from S5)" here was stale for eight days; `ONE_SIDED_BUDGET` now pins it |
| name pairs inherited from S2               | 6                                                                                                                                                                                                                              |

**This is larger than S2–S5 combined.** It should be staged the way they were — each stage
independently verifiable against `deno task bridge`, the byte baseline and the spec suite — rather
than attempted as one change. The natural stages, in dependency order:

1. ~~settle the operator representation~~ ✅ decided above: numeric `Opcode` controls
2. ~~reconcile the one-sided kinds~~ ✅ classified above; the merges themselves belong to 3
3. **one change**: convert the operator representation, reconcile bucket A, and give the node base
   `loc?` and `type?` — these cannot be separated without editing the same call sites twice
4. converge the six name pairs, which the type unification settles
5. alias one `Expression` to the other and delete the bridge, carrying its type derivation forward
   as a pass
6. `deno task bridge` reaches 421/421 — the acceptance criterion

Only now is there one `Expression`. `src/bridge/bridge.ts` (1,935 lines when written; 1,803 on
2026-09-14) and its test files become unnecessary.

✅ **S6 BLOCKER CLEARED, 2026-09-04 — and it was a defect, not just a gap.**

binaryen-ts's `Load`/`Store` were `{type, bytes, signed, offset, align, ptr}` with no memory index,
while wabt-ts carried `memidx` on 16 kinds. The first description of this said binaryen-ts "silently
rewrites every multi-memory module to memory 0". **Both that and the correction to it were wrong**,
and the truth was worse than either:

- `readMemArg` read align and offset straight through. **Bit 6 of the align field means an explicit
  memory index follows**, so `i32.store (memory $b)` — `36 42 01 00` — decoded as align 0x42 (a
  nonsense 2^66 alignment) and offset 1 (the memory INDEX), leaving the real offset byte to be
  consumed as an OPCODE. `00` became a phantom `unreachable`, which makes the rest of the body dead
  code. **Same failure shape as the typed-ref block type** in `block_type_ref.test.ts`.
- SIMD open-coded a second copy of the same read, carrying the same defect.
- Nothing caught it: no error at parse, and `checkSingleMemory` only fired on re-encode, reporting
  the module as unsupported rather than the body as corrupt.
- The reader also dropped the memidx for `memory.copy`/`fill`/`init`/`size`/`grow`, and named every
  memory export `mem0` regardless of which memory it exported.

🔑 **Verified against the INDEPENDENT oracle, not against ourselves.** Upstream wabt assembles the
same source to byte-identical output, `wasm-validate` accepts ours, and upstream `wasm-objdump`
reads the field as `i32.store 2 1 0` — align 2, memory 1, offset 0. Our two implementations agreeing
would have proved nothing here.

**Resolved in wabt-ts's favour, per the worst-condition rule.** The controlling load combination is
multi-memory and only wabt-ts's shape carries it, so binaryen-ts's nodes gained `memory` on all nine
memory-addressing kinds rather than wabt-ts losing `memidx`. Converging the other way would have
REGRESSED behaviour that already worked — the outcome the rule exists to prevent. Note this is the
first element where wabt-ts's shape controls; S4's grouping goes the other way, which is some
evidence the rule is doing real work rather than rationalising a predetermined answer.

`checkSingleMemory` is gone, and `tests/binaryen-ts/binary/multi_memory.test.ts` pins load/store,
`memory.copy`/`fill`/`size`/`grow`, an active data segment on a second memory, and an exported
second memory — all byte-identical round trips.

⚠️ **One test was INVERTED, not deleted**: `encodeWasm: multiple memories throw` asserted the
refusal, which was correct while the bytes would have been wrong. It now asserts the capability.

📥 **S6 also inherits the six name pairs S2 could not touch** — `ifTrue`/`then_`, `ifFalse`/`else_`,
`typeIndex`/`typeVar`, `fieldIndex`/`fieldVar`, `target`/`func`, and `children`/`body`. They are not
renames: each is a type or arity difference, so the name follows the unification rather than
preceding it. See S2 for why renaming them early would have been inert and wrong.

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
- ~~**binaryen-ts drops custom sections entirely**, so optimization strips the marker for free —
  exactly the wanted behaviour, with no code~~ ⚠️ **No longer true since C3 (2026-09-11,
  `4c162c584`)**: binaryen-ts keeps every custom section and passes keep them, as upstream does
  through `-O2`. So S7 must strip its own marker DELIBERATELY when optimization runs.
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

## Merge log — the S6 run on `main`, 2026-09-09 → 2026-09-12

Generated from `git log --first-parent --merges main` on 2026-09-14 rather than transcribed, so the
hashes are the artifact. Each merge message carries the increment's measurements; the branch commits
beneath it carry the code. Merges after this list are in `git log`.

| merge       | date       | increment                                                                                |
| ----------- | ---------- | ---------------------------------------------------------------------------------------- |
| `219c9736b` | 2026-09-09 | S6 step 2 complete -- bucket A reconciled, all seven families                            |
| `73d1e6120` | 2026-09-09 | S6 step 3 -- the shared node base carries loc? and type?                                 |
| `56dcdd711` | 2026-09-09 | S6 step 4 measured -- field-level divergence and the Var decision                        |
| `f7ad11f42` | 2026-09-09 | S6 step 4 groundwork -- one canonical Var accessor                                       |
| `abd08c834` | 2026-09-09 | S6 step 4 -- four of the five (b) families hold a Var                                    |
| `14119f9ea` | 2026-09-09 | S6 step 4 COMPLETE -- every (b) family holds its as-written form                         |
| `1e0c220e3` | 2026-09-09 | the remaining entity references hold their as-written form                               |
| `51cc013cd` | 2026-09-09 | the 28 structural kinds reduce to 16 real decisions                                      |
| `3c54ce732` | 2026-09-09 | S6 Group 2 -- three of the seven structural decisions implemented                        |
| `41b9ca385` | 2026-09-10 | two binaryen-ts defects found while scoping Group 2 decision 4, plus the Group 2 lessons |
| `813fce2a4` | 2026-09-10 | S6 Group 2 decision 4 -- load/store hold their opcode; `check` green again               |
| `7f3ec1d6e` | 2026-09-10 | S6 Group 2 decision 5 -- region bodies are a RegionExpr                                  |
| `bc44d98d3` | 2026-09-10 | record decisions 6/7 premise checks                                                      |
| `31ec7cc86` | 2026-09-10 | clear the pre-6/7 bug queue before decisions 6A and 7b(i)                                |
| `15c6ef763` | 2026-09-10 | S6 Group 2 decision 6A -- branch and return values are a list                            |
| `527759f58` | 2026-09-10 | S6 decision 7a and 7b(i), and three defects found on the way                             |
| `1cb730031` | 2026-09-10 | external WAT goes through wabt-ts to bytes -- W4 resolved by routing                     |
| `2e3de0734` | 2026-09-10 | register N1 -- names are lost at three hops                                              |
| `91fa9caf9` | 2026-09-10 | pin the module interface -- export and import names never mangled                        |
| `76fd5f82c` | 2026-09-10 | N1 decision -- names kept by default in the fidelity phase                               |
| `66871576e` | 2026-09-10 | wabt-ts always keeps names                                                               |
| `2c2647066` | 2026-09-10 | future discussion -- internal vs exported names under optimization                       |
| `d588817dd` | 2026-09-11 | scope N1 -- internal names                                                               |
| `40d171ce2` | 2026-09-11 | N1 owner decisions                                                                       |
| `e127d1aad` | 2026-09-11 | N1 step P1 -- param and local names have a home                                          |
| `fd4e1f4b4` | 2026-09-11 | an absent align= is the natural alignment in the tree                                    |
| `7520ed7d3` | 2026-09-11 | N1 P2-P3 -- wabt-ts keeps names; WAT -> wat2wasm -> wasm2wat gives the WAT back          |
| `25a63a8cb` | 2026-09-11 | open-work -- N1 wabt-ts half merged, C2 queued                                           |
| `006fa2a08` | 2026-09-11 | wasm-tools confirms N1 labels and fields; G2 closeable; A1 registered                    |
| `eb0b3dcea` | 2026-09-11 | N1 P4-P6 -- binaryen-ts reads and writes names; N1 built in both halves                  |
| `3db3106dc` | 2026-09-11 | W6 -- DataCount only when needed or when read; wabt-ts equals upstream on 400/421        |
| `964d80c46` | 2026-09-11 | W5 -- implicit types in upstream's order; wabt-ts equals upstream wat2wasm on 421/421    |
| `13f0e806e` | 2026-09-11 | C2 -- custom sections survive the text, with their position                              |
| `5debccc22` | 2026-09-11 | C3 touches S7 -- the linear-form marker's free strip                                     |
| `4c162c584` | 2026-09-11 | C3 -- binaryen-ts keeps the custom sections a binary carried                             |
| `5d3ebb9ef` | 2026-09-11 | N6 -- the name section's local subsection keeps the shape it was read with               |
| `feea95f09` | 2026-09-11 | A1 -- an array field's NAME survives the text                                            |
| `318915973` | 2026-09-11 | G2 -- the spec harness runs all 257 files, GC included                                   |
| `7a87af4b9` | 2026-09-11 | 7c -- the written type index, on the node (S6 decision 7 complete)                       |
| `be762009e` | 2026-09-11 | S6 Group 3 -- 3 of 5 ties settled, and the other 2 re-classified                         |
| `edbdb8c10` | 2026-09-11 | Group 3 -- call_indirect's CALLEE, and the last two ties settled as findings             |
| `61d991592` | 2026-09-11 | a branch to a NAMED label prints the name (N8)                                           |
| `470eae6e2` | 2026-09-11 | correct what moved the corpus for N8, and name the TypeUse port                          |
| `3e1cc60b1` | 2026-09-11 | labels keep their NAME; the binary writer resolves the depth                             |
| `2abb7880c` | 2026-09-11 | close N8's text→text residual before it could spread                                     |
| `b1410d6e8` | 2026-09-11 | a try_table catch clause carries its kind ONCE                                           |
| `d85635eb1` | 2026-09-11 | every single-label reference is `target`, in both IRs                                    |
| `949bee3b8` | 2026-09-11 | a catch tag is a `Var`, spelled once in binaryen-ts                                      |
| `456423b54` | 2026-09-12 | the corpus round trip runs again, and guards every index space                           |
| `cec3a3381` | 2026-09-12 | the live binaryen interop test runs — 0 ignored in the suite                             |
| `0e66da1e3` | 2026-09-12 | pin npm:binaryen to 132, and clean the lock my probes dirtied                            |
| `f1675d261` | 2026-09-12 | S5 one-sided kinds are 11 and now ratchet -- plus two corrections to my own commits      |
| `f36a22e43` | 2026-09-12 | open-work -- S5 closed, its acceptance criterion re-probed and holding                   |
| `c6bbf7d71` | 2026-09-12 | pre-merge N1 (test-file naming) was already moot -- 230 .test.ts, 0 _test.ts             |
