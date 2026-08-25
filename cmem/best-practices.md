# Best Practices — method rules, extracted from what went wrong here

**This file holds METHOD, not findings.** The post-mortems stay in [correctness.md](correctness.md);
the decisions stay in [architecture.md](architecture.md) and [passes.md](passes.md). What lives here
is the transferable part: _how to work on this codebase so the same class does not recur._

Adapted from the sibling `wazmrt` project's `cmem/best-practices.md`, which is the origin of the
format and of several rules below. Only rules that apply to a **parser / optimizer / encoder
library** were brought across, and each is grounded in an incident from _this_ repo where we have
one. Rules adopted without a local incident are marked **(adopted)** — they are cheap insurance
against a class we have not yet paid for.

⚠️ **Read this before a conformance pass, an audit, or any change that touches the parser and the
encoder together.** Most entries exist because someone competent did the obvious thing.

---

## 1. Producer/consumer pairs — the recurring blind spot

This project **is** a producer/consumer pair. `parseWasm` and `encodeWasm` are written by the same
hand against the same mental model, so they agree with each other far more readily than either
agrees with the spec.

**A round trip proves agreement with yourself, not correctness.** Our decoder mapped both
`struct.get_u` (0x04) and `struct.get` (0x02) to `signed = false`, and the encoder wrote `get` for
`signed = false`. Self-consistent, and wrong: a valid `get_u` module came back invalid (UP-1). When
a defect can only be seen by a third party, the test has to BE a third party — hand the bytes to
V8/Wasmtime, or assert the bytes directly.

**Fix the mirror, or you turn a silent accept into a loud reject.** UP-1 needed the encoder to
derive packedness AND the WAT front door to reject a mismatched `get`/`get_s`/`get_u`; `ref.null`
needed the decoder to stop collapsing heap types AND `writeHeapType` to stop writing a concrete
index as unsigned. Repairing one half alone rejects input that was fine, or keeps emitting bytes
that are not.

**A workaround in the producer for a gap in the consumer does not stay cosmetic.** The
AnyRef-collapse shim existed so ref-typed params would fit a `ValType`-only IR. It made two func
heap types differing only in their heap types indistinguishable, which forced `gcFuncTypeIndex` to
_throw_ on ambiguity — a real failure mode manufactured by the workaround. Fixing UP-7 deleted the
throw. Fix the gap; do not route around it.

**A tag added to one of two readers works in half the positions.** `readValTypeByte` and
`readValueType` both read a value type; only one collapsed refs. Likewise the module has TWO
instruction decode paths — `readInitExpr` for constant expressions and the main body decoder — and
`ref.null` was wrong in both, so fixing one would have read as fixed. **When an encoding gains a
form, grep for every site that reads that grammar.**

**When the IR gains a capability, grep every PRODUCER of that node — not just every reader.** The
rule above is about readers of an encoding; this is its mirror, and it is the one that was missed.
Multi-value landed in the binary decoder, and the WAT parser went on truncating
`(block (result i32 i32) …)` to its first type for a day — collecting every declared result and then
discarding all but one. The IR could express the tuple; one of its two front doors just never
started producing it. Ask which constructors build this node, and check each.

**Two implementations agreeing is not corroboration when they share the mistake.** Count the places
that implement a rule before trusting that they check each other. (adopted — the wazmrt instance had
three: assembler, validator and interpreter all resolved a `try_table` label one frame too deep, and
every round trip was green.)

**…and on 2026-08-25 we found we had the two-implementation version of that exact bug.** Our decoder
and encoder both resolved a `try_table` catch destination one frame too deep, symmetrically, so
every round trip was byte-identical and green — the paragraph above described our own code and
nobody had grepped for it. Two lessons, and the second is the sharper one:

- A borrowed war story is a **search query**, not a trophy. When a sibling project's failure mode
  lands in this file, spend the ten minutes grepping this codebase for the same shape before filing
  it away. `try_table` label resolution appears in exactly two places here; checking them was cheap
  and would have found it that day.
- **The evidence has to be able to disagree with you.** The fixture that finally pinned it puts the
  question to V8 with the two candidate readings made distinguishable — a tag carrying one value,
  and two candidate target blocks taking one and two. Depth 0 and depth 1 get different verdicts
  from the engine. A fixture where both readings type-check proves nothing, however green it is.

## 2. One authoritative enumeration

**There is exactly one child enumeration, in [walk.ts](../src/ir/walk.ts).** Anything that recurses
over children goes through `mapExpression` / `walkExpression` / `visitChildren` /
`mapChildrenShallow` — never a private switch.

**A private dispatcher cannot be kept in sync, and falling behind produces SILENCE.** Two had
drifted before anyone noticed: `deepCopy` covered 29 of 79 expression kinds and returned the rest
as-is (sharing subtrees across inlined copies, breaking the one-parent invariant it exists to
uphold), and PickLoadSigns' `_walkWithParent` covered ~15 and could not see a `local.get` inside a
`br` — which made a _use_ invisible rather than neutral and flipped a load's sign, turning `-1` into
`255`. Both now delegate to walk.ts, whose `default` throws.

**A list written a second time will drift; derive it.** Same rule, one level up. Where a second list
is unavoidable, pin it with a check that compares names AND values — two lists of equal length can
still disagree.

**A conservative default is what makes an allow-list safe.** `_exprKey` (`return null`), `_isPure`
(`return false`) and Vacuum's removal set are allow-lists: an unknown kind is simply not CSE-able,
not pure, not removable. That is correct by construction and does not drift. An allow-list whose
default _guesses_ is the dangerous shape.

## 2b. Close the shape, not the arm (2026-08-25)

Three of the seven findings in that day's sweep were **a previous fix that closed one instance and
left the mechanism open**, and in each case the file already carried a comment describing the
failure mode:

- `encodeExportSection`'s `case "tag"` explains that falling out of the switch writes an export name
  with no kind/index and "corrupts every subsequent export" — and the fix added the case without
  adding a `default`, leaving the trap armed for the next kind.
- The start-section case explains that a dropped section is "valid wasm, wrong behaviour, no
  diagnostic" — three lines above a `default:` that silently skipped every unknown section.
- `walk.ts` was made to throw on an unhandled kind after exactly this class of bug; the encoder was
  still keeping its own private child enumeration, which silently skipped `TupleMake`.

**When you fix a silent fallback, ask what SHAPE allowed it and close that**: delete the duplicate
enumeration rather than adding the missing case, make the `default` throw rather than adding the
missing arm, bind the discriminant to `never` so the compiler catches the next member. A fix that
closes one arm leaves a comment describing a bug that is still there.

A useful corollary for reviewing: **grep the codebase for the failure your own comments describe.**
Three of these were findable by reading the explanations already written next to them.

## 2c. A placeholder must not be representable as real data (2026-08-25)

`funcTypes` mirrors the type section index-for-index, so a struct or array entry has to occupy its
slot. The filler chosen was `{ params: [], results: [] }` — **a perfectly valid function type**. A
`call_indirect` naming a struct index therefore resolved to an empty signature, popped zero
operands, and built a call of the wrong arity: the WT-2b "call need N got M" shape, with no
diagnostic. `CoalesceLocals` had the same shape in miniature, filling a "can't happen" slot gap with
`fn.locals[numParams] ?? fn.locals[0]` — an arbitrary local's TYPE, which would encode a different
program if the gap ever appeared.

The alignment need was real in both cases. The mistake was picking a filler that reads as data.
**Use a sentinel the domain cannot produce (`null`), or throw** — never a well-formed value of the
same type. "Placeholder to keep indices aligned" is a comment that makes a silent fallback look
deliberate.

**Then put the sentinel in the TYPE and let the compiler do the audit.** Widening `funcTypes` to
`(FuncType | null)[]` immediately failed the build at the two call sites that were still unguarded —
found in seconds, and they were not the ones the grep had turned up. An invariant expressed as a
type is checked at every site forever; one expressed in a comment is checked by whoever reads it.

Related, and now done: `noUncheckedIndexedAccess` was OFF, so `args[1]` on a one-element array was
typed `SExpr`, not `SExpr | undefined` — which is what let ~70 folded WAT handlers reach for
operands they were never given and die on `s.kind` with a raw `TypeError`. It is ON for `src/` as of
2026-08-25; see [correctness.md](correctness.md) § "`noUncheckedIndexedAccess` rollout".

Two things worth carrying from that rollout:

- **A big error count is not a big edit count.** 261 errors collapsed to a handful of structural
  causes, because one under-typed helper produces dozens of call-site errors. Widening five S-expr
  accessors removed 61 on its own. Measure the SHAPES before estimating the work — and fix the
  helper, never the call sites.
- **`!` only where the bound is visible in the same function.** `reader.ts` qualifies: each byte
  read sits directly under a `checkBounds(n)` that throws for exactly that count. Anywhere the
  invariant is further away, guard or throw. Scattering `!` mechanically converts the audit into
  noise and defeats the reason for enabling the flag.

## 2d. A value read and discarded is a decision (2026-08-25)

`r.readU32(); // table index` reads like frame-advancing, but the very next line hard-coded
`ctx.tableNames[0]`. Every `call_indirect` in a multi-table module was silently retargeted to table
0 — while the element-segment and `table.get`/`table.set` decoders in the same file did honour the
index. **A read whose result is dropped is pinning a semantic to a constant; say so, or use it.**

What kept it off the radar is worth naming separately: it never reached bytes, because the ENCODER
rejects modules with more than one table. **A wrong decode made harmless by a guard in another file
is a load-bearing coincidence**, not a fix — it holds only while that guard stays, and it does
nothing for consumers who never reach it. This decoder is read directly by the wabt-ts bridge and by
the compat facade's introspection; both saw the wrong table with no diagnostic. When you find a
defect that "can't happen because X", check whether X is in the same module and whether every
consumer goes through it.

## 3. Verifying a change

**An exit code is not evidence.** Every serious defect this project has had produced _valid wasm
with the wrong value_: `WebAssembly.compile` has never caught one. Verify against the ladder in
[INDEX.md](INDEX.md) — the behavioural rungs (fuzzer, `equiv_check`, corpus round-trip) are the ones
that see a valid-but-wrong module.

**A green suite is evidence about the tests, not about the code.** Neither the `deepCopy` sharing
nor the PickLoadSigns miscompile could have been caught by the fuzzer or the equivalence harness.
Measured, not assumed: `optimize_fuzz_test.ts` contains **zero** `makeLoad` and **zero** `makeBreak`
calls and no SIMD or GC nodes, so it cannot construct either defect's shape. Both were found by
reading for a structural pattern. **When you add a construct, grep the harness for the node kinds it
actually emits before assuming it covers you.**

**A new test that has never failed has not been shown to test anything.** Break the fix, watch the
test go red, restore. Done for the start-section pass seeding (only that test went red), the `br_if`
fall-through restore, the `ref.null` heap types, the phantom-pop convergence check and the
PickLoadSigns `br` use. Cheap, and it has caught bad tests here.

**Assert the SILENCE too.** A check that fires on everything is as useless as one that never fires.
(adopted)

**Re-measure before quoting any number.** Test counts, corpus counts and sizes go stale silently,
and a stale number reads as current. Ours appear in at least three cmem files plus README.

**Totals must reconcile, or a category is hiding files.** `verify_roundtrip.ts` silently `continue`d
past every file that failed the FIRST parse, so "0 failures" was not evidence the corpus had been
exercised — the only symptom was that the buckets stopped summing to the file count. It now prints
`files seen: N (accounted for: N)`.

**Ask what the number does not cover.** `lit/control-flow-input.wast.wasm` round-trips, but it does
not validate under V8 _as input_ — so it exercises decode/encode structure and says nothing about
output validity. Behavioural claims need a fixture that validates on its own.

## 4. Investigating a defect

**Prove the failure is yours before debugging it.** A one-command falsification beats any amount of
reading a diff you already believe. (adopted)

**Identify the LAYER before naming a cause.** Ours is: input bytes → decoder → IR → pass → encoder →
engine. Bisect it. The `equiv_check` and pass-bisect scripts exist for exactly this, and the WT-2k
investigation named "memory-grow ordering" before the real cause turned out to be the decoder
reordering a value on the operand stack, one layer up.

**Record findings that were WRONG, so they are not "fixed" again.** WT-2i's first hypothesis — a
fresh-local index collision, "fixed" by changing `nextLocal` — was wrong and reverted, because
`fn.locals` already includes params. The asyncify "memory-grow ordering" hypothesis was a red
herring. Both are written down. A retraction is as valuable as a finding.

**A retraction re-checks the REASONING, not the REQUIREMENT.** "The argument was bad" is not "the
code is correct" — go back to the spec, not to the refuted argument. (adopted)

## 5. Status, scope and memory

**Never write a status line from an ARGUMENT — open the file and grep.** The first code-issue sweep
waved six unreferenced exports through as "published API surface". That was reasoned, not checked:
`src/parser/` has no `exports` subpath at all and `src/passes/index.ts` imports asyncify only for
its side effect, so four of them were unreachable and genuinely dead. **The decisive test for "is
this public" is the `exports` map in `deno.json`, not the `export` keyword.**

**Check whether "dead" code is really a MISSING CALL.** `materializeFakeGlobals` had exactly one
reference — its own definition — and a doc comment warning "do NOT wire this into
`AsyncifyPass.run`". That reads like an omission and was the opposite. Read the comment before
deleting the function, and preserve any design rationale it carries.

**"Update the project memory" means AUDIT for stale live claims, not edit the files you touched.**
Grep for the OLD values and classify every hit as live (fix) or dated history (leave). When two
files disagree, do not pick the newer one — measure.

**"By design" ages badly by definition.** Re-test a deliberate limitation when you price the entry
that depends on it. Loop inputs were correctly rejected in one commit and correctly supported in the
next; what changed was not the code but how much of the surrounding machinery existed.

**Say which claims are live and which are as-triaged.** Counts that were accurate when written go
stale the moment the next change lands; mark them rather than letting them read as current.

## 6. Release and environment

**A cache key must name everything the answer depends on.** `deno check` caches per file by hash, so
editing A does not re-check B even when B's types depend on A. CI starts cold and disagrees. Use
`--reload` when a cross-file type dependency changes — see [publishing.md](publishing.md).

**A gate only gates what RUNS it.** Test files were never type-checked by any task
(`deno test
--no-check`, and `check` scoped to `src/` + `main.ts`), which hid seven type errors
including a fixture calling `addTable` with scrambled arguments. Check what a validating task
actually walks.

**Know which action is irreversible, and what triggers it.** Pushing a `deno.json` version with no
matching tag makes `auto-tag.yml` create the tag and dispatch `publish.yml`, which publishes to JSR
— and a JSR version number can never be reused. While `deno.json` holds a version whose tag already
exists on the remote, no push can publish.
