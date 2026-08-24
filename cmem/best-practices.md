# Best Practices — method rules, extracted from what went wrong

Every rule below was paid for by a real incident in **this** repo. Each is followed by the incident
that produced it and where the detail lives.

**This file holds METHOD, not findings.** Post-mortems stay in their home files —
`design-decisions.md` for load-bearing invariants, `tasks.md` for the running log, `bridge.md` for
binaryen-ts coverage. What lives here is the transferable part: _how to work on this codebase so the
same class does not recur._

Structure and several rules are adopted from the sibling **wazmrt** project's
`cmem/best-practices.md`. Rules marked 🔁 were learned independently here and match one there — a
repeat across two codebases is the strongest signal a rule generalises. Rules marked 📥 were adopted
from wazmrt before we hit them, and are kept because the shape clearly applies.

⚠️ **Read this before starting a conformance pass, a scoping exercise, or any change to a
producer/consumer pair.** Most entries exist because someone competent did the obvious thing.

---

## Index

Sections 1–5 are the original thematic groups. Everything after them was appended rule-by-rule as
incidents happened, newest last; they are grouped here rather than moved, so the append order (and
therefore the history) stays intact.

**Working method**

- [1. Verifying a change](#1-verifying-a-change)
- [2. Investigating a defect](#2-investigating-a-defect)
- [3. Producer/consumer pairs — the recurring blind spot](#3-producerconsumer-pairs--the-recurring-blind-spot)
- [4. Tests and gates](#4-tests-and-gates)
- [5. Recording what you found](#5-recording-what-you-found)

**Judging severity and priority** — the campaign's most expensive mistakes were here, not in the
code

- Rank the remaining work against the yardstick the GOAL names
- A "cosmetic" difference is not cosmetic if it is observable
- Ask whether repeating the operation is a fixed point
- Re-verifying a finding is not the same as re-ranking it
- An over-correction is still a correction in the wrong direction

**Auditing — finding what no corpus reaches**

- "We consume it and ignore it" is a bug shape you can GREP for
- A one-sided rule is invisible to every metric built on your own output
- Widening a mask is not fixing a range check
- A rule that only fires when its operand is already known is half a rule
- Audit a manual walk against the TYPE, not against a corpus
- An unused parameter in one of a family of parallel handlers is a missing check
- When a marker has to be applied at every construction site, grep for it
- In this codebase, "the linear form is a stub" IS a round-trip bug
- Two implementations of one grammar rule will disagree, and the writer will be the inverse of the
  wrong one

**Trusting your own tools**

- Run the whole panel, not the metric you are moving
- Where you put the probe changes the number, so say where it is
- An "enable everything" switch can make an engine refuse everything
- A metric can be precise, stable, and measuring almost nothing
- Re-measure a diagnosis before acting on it, even your own
- A fail-loud path is only as useful as what it prints
- When you name an alternative, check whether it refutes your own diagnosis

**Working with sibling projects** (wasmtk, binaryen-ts, wazmrt)

- Read the sibling project before designing the same feature twice
- "Nothing records that" is a claim about the checkout you searched
- A half-built feature is worse than a missing one, and no corpus will tell you
- Stamp a vendored snapshot with source + date, in the change that creates it
- Verify an incoming report's premises, not just its conclusion
- Review someone else's codebase with the metric you built for your own

## 1. Verifying a change

🔁 **A parse-success count is an UPPER BOUND, not a measurement.** Five tranches were scoped and
ranked by "files that parse clean" — a metric that structurally cannot see a module that parses
perfectly and then encodes to bytes V8 rejects. At the tranche-4 cut the split was **230 files
parse-clean but only 180 whose every module V8-validates.** Two latent bugs sat in that 50-file gap
the whole time, both already documented as unfixed and neither in any tranche, _because the tranches
were derived from parse failures_. — `tasks.md`, "The parse metric has a blind spot"

**Measure with the strongest oracle available, and prefer it to our own reasoning.** Two encodings
were settled by asking V8 directly rather than reading the proposal text: `noexn` is `0x74`, not the
`0x68` that continuing the hierarchy implies; and a `try_table` catch target resolves in the
**enclosing** scope (depth 0 for the immediately enclosing block), not with the try_table's own
label pushed as the spec's `C, label [t*] ⊢ catch*` rule reads. Both times the plausible reading was
wrong and one probe settled it. — `design-decisions.md`

**ASK ALL THREE ENGINES; WASMTIME DECIDES.** The panel is V8 (fast, in-process, what the routine
harnesses use), **Wasmtime (the authority — Bytecode Alliance write the spec and its reference
tooling)**, and Wasmer (differently configured, so it disagrees for different reasons). Run all
three even when the first two agree: on the 73-module cross-check V8 and Wasmtime both returned a
flat 73/73 accept, which carried no information beyond "no disagreement", while Wasmer's 52/21
classified the modules by the proposal each needed. Its 21 were pure feature gates and changed no
verdict — but they were the only DATA the exercise produced. **Two engines agreeing tells you
nothing about why; an engine that disagrees for a boring reason still tells you what your inputs
contain.** Two traps: enable proposals explicitly (a default-off feature is not a spec opinion, and
`-W all-proposals=y` fails on stock Windows Wasmtime via unsupported `stack-switching`), and give
every module its own `-o` path (reusing one scored three I/O collisions as REJECT).
`deno task engine-check` does all of this and self-tests first. — `CLAUDE.md`, "Oracle rule"

🔁 **Validate the harness against a known-good case before trusting an aggregate.** The first
V8-validity harness reported **1937 of 1937 modules failing**; the second reported 1667 rejected.
Both were harness bugs — a missing `synthesizeTypes` pass leaves an empty type section, so every
module fails with "no signature at index 0". A number that extreme is evidence about the harness,
not the codebase. Run it against one file you _know_ is fine before reporting anything.

🔁 **Re-measure before quoting any number, especially from a memory file.** `CLAUDE.md` states the
binaryen-ts submodule is pinned at `6c6f81f66` (v1.0.9). The working checkout is **v1.3.5**, and
three gaps listed there are already fixed upstream. An upstream report filed from that list would
have been noise. — `tasks.md`, living log rule 2

**Measure the direction your metric CANNOT see, or you will report the wrong verdict.** The
validator-agreement metric counts modules V8 accepts that we also accept — false _rejections_. It
says nothing about what a permissive validator waves through. On that number alone the T9.3 typed
lattice looked like a **regression** (2120 → 2110) and was nearly reported as one. Adding the
opposite direction — `assert_invalid` modules we correctly reject — showed it caught **28 more real
errors**, and the ten false rejections turned out to be ten _further_ bugs the coarse lattice had
been hiding. One-sided metrics produce confidently wrong conclusions. — `tasks.md`, T9.3/T9.4

🔁 **Read the field the code actually sets.** The T9.5 survey asked `hasErrors(result.errors)`; the
validator signals failure through `result`, and `dropTypes` returned `Result.Error` **without
recording a message**. Every stack underflow therefore read as "accepted". The reported gap was
**903 missed**; measured on `result` it was **314**, and fixing the _report_ accounted for the
difference before a single check was added. Two lessons in one: a silent failure is a defect in its
own right (`wasm-validate` exited non-zero and printed nothing), and it corrupts every measurement
that reads the wrong field. — `tasks.md`, T9.5

**When a fix makes a metric WORSE, that is information — chase it before explaining it away.**
Correcting the element-segment type on the binary side dropped round-trip fidelity 1961 → 1779. The
instinct is to call it acceptable collateral; following it instead found the other half of the bug —
the WAT writer's `func` shorthand was gated on the _nullable_ `funcref` when that spelling means
`(ref func)`. Both halves fixed, fidelity back to 1961. — `tasks.md`, T11

**Diff the whole per-file list, not the total.** Every tranche recorded newly-passing _and_
newly-failing files by set difference, not just the count. A tranche that fixes 14 and breaks 2
shows the same delta as one that fixes 12 and breaks 0.

---

## 2. Investigating a defect

🔁 **Triage by first-error text MISLABELS — confirm every root cause with a minimal repro through
the real entry point.** Clustering 137 failures by their first error produced four wrong hypotheses:
underscores in numeric literals (they work), `(module quote …)` (works; only the _multi-string_ form
fails), relaxed SIMD instructions (parse fine — those files fail on `(either …)`), and "expected i32
constant" (nothing to do with separators; `BigInt('-0x…')` throws because JS rejects
sign-plus-radix). Reading error strings tells you where parsing stopped, not why. — `tasks.md`,
tranche scope

🔁 **A passing test on one syntactic form says nothing about the other.** `br_table` with a carried
value was tested and green in **linear** form since v1.3.4. The **folded** form
`(br_table $a $b (i32.const 7) (local.get 0))` put the carried value in the index slot and dropped
the real index — for four tranches, behind a passing test.

🔁 **When a rule is off by a CONSTANT, test the neighbours.** The `try_table` catch depth was fixed
by emitting depths 0, 1 and 2 for one shape and seeing which V8 accepted. Reasoning about the spec
rule had already produced the wrong answer once.

🔁 **Read what the spec test ASSERTS before reasoning about the algorithm.** `uninitialized local`
was deferred with the reasoning that it needed "an init set per control frame, intersected at an
`if` join" and that any approximation would reject valid code. `local_init.wast`'s own
`assert_invalid` cases say otherwise: setting a local in **both** arms of an `if` still leaves it
uninitialised afterwards, so there is no join and no intersection — just frame-scoped rollback. The
feature was a fraction of the estimated size, carried no false-rejection risk, and closed the
category on the first run. The evidence was already in the repo and took minutes to read. —
`tasks.md`, T9.9

**Never read OUR OWN rendering as the source.** The last `assert_invalid` case was investigated as
`select (result any)` — which is what `wasm2wat` printed. The source was `select (result (ref 1))`,
and the misprint was itself a symptom of the bug being hunted (the writer emitted `0x00` for the
annotation). When a tool under investigation renders the input, get the input from the file. —
`tasks.md`, T9.10

**A cast is where a refactor stops.** The T7.4 `ValueType` refactor widened the IR from `Type` to
`Type | RefValueType`, and every site that had a cast survived compilation unchanged and silently
wrong: `this.s.writeU8(t as number)` wrote `0x00` for an object, so **every** typed-ref
`select (result …)` was mis-encoded; a type-lookup key built by string interpolation produced
`(func (param [object Object]))`. After widening a type, grep the old name for casts and template
interpolation — the compiler will not.

**Check the INPUT before blaming the code.** Twice in one session a "parser bug" was invalid WAT of
my own writing: `br_if` leaves its values on the stack when _not_ taken, so nothing may follow it
inside a block whose result those values are. Both probes were rewritten, not the parser.

**A defect that parses cleanly is invisible to a parse metric — and one the bridge re-encodes is
invisible to bridge tests.** The packed-type wire bytes (`Type.I8` was `0x7a`, spec says `0x78`)
were wrong for four releases: invisible to parsing because the text is fine, and invisible through
the bridge because binaryen-ts re-encodes its own way. Only asking V8 about _our_ encoder's output
found it. — `design-decisions.md`

**"Silently wrong" and "loudly broken" need different hunts.** Three failure modes, in increasing
order of how hard they are to find: throws (a stack trace names the site), V8 rejects (a message
names the construct), V8 _accepts wrong bytes_ (nothing tells you). Raw non-ASCII characters in WAT
strings were truncated to one byte — `é` emitted `e9` instead of `c3 a9` — producing a valid module
with the wrong data in it. Budget hunting time by failure mode, not by cluster size.

---

## 3. Producer/consumer pairs — the recurring blind spot

🔁 **Text order and binary order are DIFFERENT orders; a writer that emits one in the other's slot
round-trips into garbage.** `memory.init` is `(memory, data)` in text and `(data, memory)` in
binary. The WAT writer emitted the binary order, so any non-zero memory re-parsed transposed and V8
rejected it with "invalid data segment index". Invisible until multi-memory `memory.init` could be
written at all.

🔁 **A reader that consumes N bytes where the writer emits N+1 desyncs everything after it.**
`readRefType` read a single byte, so a typed table element type left its heap type in the stream:
`(table $x 1 (ref null $t))` decoded as `(table 0 ref null)` — wrong limits _and_ wrong type, from
one missing read.

**`resolveNames` must walk EVERY name-bearing immediate, or the writer emits index 0.** Found five
times now — `call_indirect`'s `typeVar` (Bug G), `br_if`'s carried value (Bug F), `ref.null`'s heap
type, `br_table`'s index expression, `try_table`'s catch tag and target, and every memory op's
`memidx`. The fix that ends the class is not another case: it is the standing guard in
`tests/ir/encode_correctness.test.ts` asserting **no name-var survives `resolveNames` anywhere in
the IR**, over a hand-built module and the whole spec testsuite. That guard is what found the
`try_table` one. — `design-decisions.md`

🔁 **A second copy of a lookup table is a second place to be incomplete.** The heap-type keyword ⇄
`Type` mapping existed three times (parser, binary reader, binary writer) and each was missing
different entries; it is now one table in `core/types.ts`. A duplicate `typeName` switch was also
found hiding in `wasm-objdump.ts`. When you need a mapping that already exists somewhere, extend the
original — do not copy it. — `design-decisions.md`

**The IR must be able to EXPRESS what the format can, or every consumer silently truncates.** Four
instances of one shape: `ReturnExpr.value` → `values[]`, then `BrExpr` / `BrIfExpr` the same way,
and `FuncSignature.params: Type[]` → `ValueType[]` so `(ref $T)` stops coarsening to `structref`.
Each single-slot field looked adequate until a multi-value or parameterised case arrived. **When a
field holds "the" value of something the format allows several of, that is the bug, not the call
site.**

**An encoder must never REPAIR invalid input.** The writer preferred the funcidx element encoding
for any all-`ref.func` segment. That silently turned a module the spec calls invalid — a nullable
`funcref` segment against a `(ref func)` table — into one V8 accepts, so `wat2wasm` was quietly
fixing its input. A tool that turns invalid input into valid output is worse than one that rejects
it: the error simply moves downstream. The distinction had been collapsed in **five** places at once
(parser, binary reader, binary writer, WAT writer, validator), each hiding the next. — `tasks.md`,
T11

🔁 **The same off-by-one recurs in every layer that walks the same structure.** `try_table` catch
targets resolve in the ENCLOSING scope. That was fixed in the parser in T7.6 — and reappeared
unchanged in the validator in T9.8, where the catches were checked after `beginTryTable` had already
pushed the try_table's own label. Six valid modules rejected. When you fix a scoping rule in one
layer, grep for the other layers that implement it.

**Coarsen at the CONSUMER's boundary, never in an encoder.** The validator's type-checker and the
binaryen bridge both have flat type surfaces and legitimately cannot hold a concrete typed ref, so
they call `coarsenValueType` at their entry points — a handful of methods rather than ~20 call
sites. Encoders must never coarsen; that was the bug being fixed.

---

## 4. Tests and gates

🔁 **A test that passes under BOTH the right and the wrong behaviour tests nothing — invert it and
watch it fail.** The first `try_table` catch-depth test passed under either depth convention,
because its two candidate targets were type-compatible and both propagated the value. It was written
_as_ the regression test for that fix and would never have caught it. The replacement was confirmed
by reverting the fix and watching it fail. **Any test written as the guard for a specific fix should
be run once against the unfixed code.**

**Assert the VALUE, not that it parsed.** `table.init`'s two indices were transposed for the whole
of tranche 2 while parsing fine. The test that pins it instantiates two tables and two elem segments
and reads back which one got filled. Where semantics matter, execute in V8; where _encoding_ matters
(typed-ref GC code V8 cannot accept through this path), assert the bytes — but say in the test which
one you are doing and why.

**A test whose weak spot is known should say so in the test.** The nesting case for `try_table`
catch depth is kept, but its comment now states it does not pin the convention and points at the one
that does. A test that quietly overclaims is worse than no test.

**A guard is only as wide as its CORPUS.** The standing "no name-var survives `resolveNames`" sweep
— the guard credited below with ending a whole class — did not catch the `select (result
(ref $t))`
annotation, because no spec-testsuite module writes one. It was found instead by the binary writer's
fail-loud check, once a cast stopped hiding it. Class guards are the right shape, but state what
they run over, and do not treat them as proof for inputs the corpus never contains.

**When a new check rejects something valid, suspect the CHECK's inputs before loosening the check.**
Making the reference lattice precise produced ten false rejections. The tempting fix — widen the
lattice until the number goes green — would have undone the entire point. Every one of the ten was a
_separate_ bug the coarse lattice had been masking: a producer still reporting a placeholder type, a
rule that skipped its push in unreachable code, a canonical key that baked in a raw index, a
nullability rule applied to the wrong side. **A green metric bought by weakening a check is worth
less than a red one.** — `tasks.md`, T9.3/T9.4

**Test the failing-by-design case, and flip it when it stops failing.** A known gap (cross-group
forward type references) was written into the test suite as an assertion that we _do not_ catch it,
with the reason. When T9.7 closed it, that test failed — which is exactly how the gap announced it
was gone. Documented gaps belong in the suite, not only in a log.

**Prefer one guard for a class over one test per instance.** See the no-unresolved-name-var sweep in
§3. Six individual regression tests would not have found the seventh.

---

## 5. Recording what you found

🔁 **Record findings that were WRONG, so they are not "fixed" again.** The binaryen-ts living log
carries an explicit _"already fixed upstream — do NOT file"_ table, because three entries inherited
from `CLAUDE.md` were stale. — `tasks.md`

**Measure severity, never inherit it.** `UP-1` (binaryen-ts `struct.get_u`) was described from
`CLAUDE.md` as "functionally invisible under V8, which recovers signedness from the packed field
type". Probing V8 showed the bytes it emits instead are **rejected outright** on a packed field.
That moved it from "worth reporting" to "blocking", changing the fix priority handed upstream.

**Record the ROOT CAUSE, not the symptom** — several upstream items are IR shape limits an encoder
patch would not fix (`StructGetExpr.signed` is a `boolean`, so it cannot represent three opcodes).

**Record empty passes too.** A tranche completing without a new upstream finding is evidence the
gaps are narrowing; the living log asks for those explicitly.

**Do not modify a sibling checkout to fix a finding.** `binaryen-ts/` stays clean on `main`; this
side only reads it. Fixes belong to that project's own workflow.

---

## Where this came from

`wazmrt/cmem/best-practices.md` is the larger, older version of this file (~1200 lines, Zig/runtime
focused). Rules there that have not yet cost us anything here are deliberately **not** copied — an
unearned rule is noise. When a pass here produces a lesson that would apply to a different
subsystem, add it here **and** leave the detail in its home file.

## Rank the remaining work against the yardstick the GOAL names

T10's seven groups were ranked by severity on the spec testsuite: the ones producing invalid wasm
first, "valid but wrong export order" last. Measured against the wasmtk WASI corpus — the corpus the
standing goal actually names — the ranking inverted: five of the seven groups did not occur there
**at all**, while the one ranked last occurred in **100%** of the differences.

Acting on the goal's ranking (2026-08-24) closed T10.1 and, because they shared a root, T10.2 with
it — the cheapest item on the list, and it took the corpus from 1/270 to 50/270 where severity-order
would have spent the effort on groups worth 0 there.

Two things generalise:

- **A severity ranking and a frequency ranking are both correct, for different corpora.** Neither is
  "the" priority. Pick the corpus the goal names, and say which one you picked.
- **Re-measure the ranking when the goal is written down**, not once at the start. T10's order was
  set before the WASI target was recorded; nothing about it was wrong at the time.

## A "cosmetic" difference is not cosmetic if it is observable

T10.1 was parked as "valid, wrong order" for the whole campaign. But export order is readable
through `WebAssembly.Module.exports()`, so a round-trip that changes it produces a DIFFERENT module
— the same class as T9.1, where the decoder reordered a program. The tell is not "does it still
validate" but "can a consumer see the difference". Ask that before filing something as cosmetic.

## Ask whether repeating the operation is a fixed point

T10.5 was filed as "valid, larger" and ranked last but one. The stray `nop` it produced is inert —
it pushes nothing, so the instruction that had been starved of an operand still found its value on
the stack, and the module ran correctly. Everything about it said cosmetic.

Running the round trip SIX times said otherwise: 517 → 521 → 525 → 529 → 533 → 537 → 541. Every pass
added the same four bytes, with no bound. A toolchain in a build pipeline that disassembles and
reassembles more than once grows the module forever.

"Does it still validate" and "is the output correct" are both weaker questions than "**is doing it
again a fixed point**". Two lines of harness, and it moved the item from cosmetic to a real defect.

## Re-measure a diagnosis before acting on it, even your own

T10.5's recorded cause was the binary READER ("the reader cannot attribute every value to an operand
slot"). That was written from evidence and it was wrong for the dominant case: measuring which node
actually over-consumed found the PARSER, draining the whole operand stack for `call`. The
reader-side cause is real but is the residue (now T10.8), not the bulk.

The classification had been made once, months of work earlier, and carried forward as fact. Cost of
re-measuring: one 40-line harness that printed `call args=3 want=2` and its friends.

## When a marker has to be applied at every construction site, grep for it

T10.8's fix is a flag on one IR node, and the obvious place to set it is the shared `popN` helper
each decoder owns. Doing exactly that took the WASI corpus to 270/270 and looked finished.

The spec testsuite disagreed: it moved only to 2074/2120. The parser builds the same placeholder in
**13 more places** that never go near `popN` — `buildPlainExpr`'s `op0()`…`op4()` operand accessors,
two folded-`if` condition slots, and four `operands[operands.length - 1] ?? …` callee slots.
Converting those took it to 2088/2120, and files affected from 27 to 14.

Grep for the literal (`kind: 'nop'` here), not for the helper. And keep a second corpus around: one
of the two would have called this done.

## An unused parameter in one of a family of parallel handlers is a missing check

`deno lint` had ten standing `'offset' is never used` warnings in `shared-validator.ts`. They looked
like dead-parameter noise left over from a callback signature, and they were treated that way for
long enough to be described as "lint debt to clear before a merge".

They were reporting a real gap. `onLoad` and `onStore` pass `offset` to `checkMemArgOffset`; the
other ten memarg handlers declare it and drop it — so the rule that a memarg offset must fit the
memory's index type simply did not apply to any SIMD or atomic memory op. Four were demonstrable
false-accepts against V8.

Both campaign corpora were blind to it: agreement and `assert_invalid` did not move, because no
spec-testsuite module writes an out-of-range offset on a SIMD op. **A lint warning caught what five
metrics could not.**

Before silencing an unused-variable warning, check whether the handler's SIBLINGS use that variable.
If they do, the warning is a diff between them.

## In this codebase, "the linear form is a stub" IS a round-trip bug

`try_table`'s linear branch carried a comment saying so - "simplified: parse the protected body and
skip the catch-clause immediates to the matching `end`" - and it had been fine for a long time,
because hand-written and wasic-generated WAT both use the folded form.

But **the WAT writer is linear-only by design**. So every `wasm2wat` output is in exactly the form
the parser did not support, and a round trip silently replaced every `try_table` with an empty
block. It surfaced only once the round-trip metric existed, as "V8 rejects this after a round trip".

The general shape: when a producer and a consumer in the same toolchain deliberately favour
different forms of the same grammar, a stub on one side is not a partial implementation - it is a
hole exactly where the other side aims. Grep for the remaining ones rather than waiting for a metric
to find them.

## A fail-loud path is only as useful as what it prints

T9.5's rule was "a validator failure must REPORT, not merely return `Result.Error`" - a silent
rejection inflated a measured gap from 314 to 903. T10.7 is the writer-side twin, and it is subtler
because the path DID report.

`tagTypeIndex` threw with a real message naming the signature it could not find. But it rendered
each param as `(p as number).toString(16)`, and a typed reference is an object, so the message read:

    no (type (func (param [object Object]))) in the type section

The throw was correct and the diagnostic named nothing. The item sat as "T10.7, two hard failures"
for the whole campaign; once the message printed `(ref $t)` the cause - `===` on a `ValueType` - was
obvious in one reading.

When you write a fail-loud branch, print the value through the same formatter the rest of the
codebase uses for that type (`valueTypeName` here), not a cast.

## Two implementations of one grammar rule will disagree, and the writer will

## be the inverse of the wrong one

`nan:0x<n>` had two parsers: `literal.ts`'s `parseF32Literal`, which forced the quiet bit on, and
the WAT parser's `parseF32LiteralBits`, which read the payload exactly. The spec agrees with the
second, and the second is the one `wat2wasm` calls - the first was reachable only through the public
helper.

`printF32Literal` was written as the inverse of the FIRST one. So it stripped the quiet bit on the
way out, nothing put it back, and a quiet NaN round-tripped into a signalling NaN. Both functions
had comments confidently explaining the convention; they explained different conventions.

Two lessons. Assert **print o parse = identity** directly, over the whole input shape, rather than
testing each direction against a remembered convention. And when a helper duplicates a rule the real
pipeline implements elsewhere, either delete it or make the pipeline call it - a second
implementation that nothing exercises is where a printer goes to get its idea of the format.

## Stamp a vendored snapshot with source + date, in the change that creates it

`tests/wasmtk/` is 272 `.wat` files copied from another project's build output. Its live corpus
is 373. Nothing recorded where the copy came from or when, because files accreted one at a time as
new shapes appeared.

That was invisible for as long as nobody asked a question whose answer changes over time. Then it
put a false claim in a report we sent upstream: seven modules described as _"genuinely invalid wasm
— V8, Wasmtime and Wasmer all reject them"_, present tense, when all seven had been fixed. Worse,
the `KNOWN_INVALID` assertion guarding them was written specifically to go red when they were fixed
— and it kept passing, because it was re-checking frozen bytes. **It masked the fix instead of
tracking it: an assertion doing the exact inverse of its purpose, while green.**

wasmtk hit the same pattern independently in the same week, with a vendored `proposals/threads/`
snapshot. Two projects, one week, no carelessness in either: **a snapshot is indistinguishable from
current data unless something records its provenance.**

Two rules fall out:

- **Stamp it at creation** — source, commit, date, count — not when someone finally asks. This
  project already pins an upstream SHA for exactly this reason; a test corpus deserves the same
  treatment.
- **An assertion over vendored data can only be as fresh as the data.** If it is designed to fire on
  an external change, it needs a path to that change, or it is decoration. Re-derive from source
  before reporting anything upstream.

## Verify an incoming report's premises, not just its conclusion

When wasmtk received our EH report they re-checked both of its load-bearing premises — that
`wasmtime -W` has no legacy knob, and that a `try_table` module runs with no flags — rather than
taking them from us. Both held, and the confirmation was worth more than agreement would have been.

They also regenerated their corpus before testing, per their own testing rules, and it changed the
outcome of half the report: four modules we had not listed, and seven we had listed wrongly.

This is "measure severity, never inherit it" pointed at an INCOMING report instead of an outgoing
one. Same discipline, and the direction that is easier to skip.

## Re-verifying a finding is not the same as re-ranking it

Before filing the binaryen-ts report we applied the log's own rule 2 — re-verify against the actual
checkout — and it worked: three of seven entries were stale and got corrected. We filed with
confidence.

Two of the seven severities were still wrong, and the recipient caught both. UP-5 was recorded as
"no `setStart`", a bridge gap, ranked sixth. It is actually the worst finding in the report: the
decoder discards the start function's index, so a decode/re-encode produces **valid wasm that
behaves differently, with no diagnostic**. We had ranked a loud failure above a silent one.

Rule 2 makes facts current. It does not re-ask _"which of these is worst, and why"_ — that is a
separate judgement, and freshness does not supply it. When a list has been carried for a while,
re-rank it as deliberately as you re-verify it, and rank **silent above loud**: an engine catches
the loud one, the silent one ships.

## When you name an alternative, check whether it refutes your own diagnosis

The UP-1 write-up said _"the root cause is in the IR, not the encoder — an encoder-only patch cannot
fix it"_, and then listed as option (2) an encoder-only patch that fixes it completely. The
recipient pointed at our own option (2) as the counterexample, and they were right: packedness is
available at encode time, and given packedness the existing boolean is total.

The diagnosis sentence was written first and never re-read against the options underneath it. **We
undersold our own recommendation.** When a write-up ends with "here are the options", re-read the
claim above them last — the options are the test of it.

## Review someone else's codebase with the metric you built for your own

Our upstream report classified seven binaryen-ts findings. The count of "how many produce bytes an
engine rejects" went **1 → 2 → 3**, wrong in the same direction every time, and the recipient
corrected us each time.

The reason is structural, not carelessness. We were measuring **what the bridge could not express**
— missing factories, narrowed signatures, absent enum entries. All three wrong-bytes findings live
somewhere else entirely: the `readBinary(b).emitBinary()` round-trip, with no builder, no bridge and
no passes involved. A start function silently dropped; `struct.get_u` collapsed onto `get`; a
typed-ref local read back as `anyref`.

**We had already learned this about ourselves.** The campaign's third metric exists precisely
because parse-clean and V8-validity both measure the ENCODE path, and T9.1 — the decoder reordering
a program — was invisible to both. We built a round-trip metric for our own code and then reviewed
someone else's without one.

The rule: when reviewing another project, **run the metric your own hard-won blind spot taught you
to run**. For a wasm toolchain that is decode → encode, compared for bytes AND behaviour. It takes
about ten lines and it found three defects that seven careful reads had ranked as "surface".

## An over-correction is still a correction in the wrong direction

Re-verifying UP-7 before filing showed our old note was stale — `RefType` already existed — so we
restated it from "design-limit" to "gap" and wrote _"a much smaller ask than our old note implied"_.
Correcting downward felt safe, because the error we had just found was an over-claim.

It was an over-correction. The half we could see (narrowed `ModuleBuilder` signatures) really is
small; the half we did not look for — the decoder collapsing a typed-ref local to `anyref` — makes
it a wrong-bytes bug. Fixing one direction of error is not the same as being right, and the momentum
of a correction pushes past the target as easily as the original claim did.

## Audit a manual walk against the TYPE, not against a corpus

`resolveNames` walks the IR by hand rather than through `ExprVisitor`, so nothing forces it to be
total. Two bugs have now come out of that: Bug G (`call_indirect` resolving `table` and skipping
`typeVar`) and, found this week, `atomic_rmw_cmpxchg` / `atomic_wait` spreading `...e` and carrying
`memidx` through unresolved — so a named multi-memory atomic silently operated on the WRONG MEMORY.

Both were found the same way, and it is not corpus coverage: **enumerate every `Var`-bearing field
of every Expr interface, then check the case body that handles that kind actually mentions each
one.** About 30 lines of script, and it found the second bug in one pass over 65 kinds and 99
fields.

Corpus coverage cannot find these. Neither the spec testsuite nor the wasmtk corpus contains a named
multi-memory atomic, which is exactly why the standing "no name-var survives resolveNames" guard
stayed green. A guard is only as wide as its corpus; a type is as wide as the code.

**The strongest single tell is a sibling.** Four of the six atomic memory ops resolved `memidx` and
two did not, in one switch, adjacent. When cases in a family diverge, the divergence is the bug —
the same signal as an unused parameter in one of a family of parallel handlers.

## A metric can be precise, stable, and measuring almost nothing

The new execution metric's first run reported **2,084 / 2,240 passing**. Stable across runs,
plausible pass rate, 17 named files failing. It was executing **only nullary functions**: a spec
`WastArg` is `{kind:'value', value: Const}`, the harness read `.type` off the wrapper, got
`undefined`, and silently skipped every invoke with arguments.

Fixed, the same harness runs **23,077** assertions — more than ten times as many — and all of them
pass. The 156 "failures" were four separate harness bugs, none of them in wabt-ts.

Two things to take from it:

- **A denominator is a measurement too.** 2,240 looked reasonable; nothing about the number
  announced that it should have been 26,837. Sanity-check what a harness SKIPS as carefully as what
  it fails, and print the skip count.
- **Before reporting a failure, reproduce it standalone.** Each of the three clusters here dissolved
  the moment it was rebuilt as a minimal module: `memory.size`/`grow` worked, `br_on_non_null`
  emitted `0xd6` and behaved correctly. The harness was wrong every time.

## Correct bytes are not evidence of a correct IR

The `Quaternary` arity gap left all four operands of a linear-form `i64.add128` as placeholders,
with the real operands stranded as separate statements. **The encoding was byte-for-byte correct
anyway**, because `pushStmt` flushes stranded operands in source order and a placeholder emits
nothing. Round-trip identical, V8 happy, execution metric happy — six metrics, none of which could
see it, because every one of them ends at the bytes.

What was wrong was the shape of the tree, and the tree is what the binaryen bridge and (eventually)
`wasm2ts` consume. A consumer that walks the IR rather than the bytes would have read a quaternary
with no operands.

So: **when a metric set bottoms out at one representation, bugs hide in the others.** Ours all end
at bytes. Audit the IR against the type when you want to know whether the tree is right — that is a
different question from whether the module is right, and this codebase has now been bitten by the
difference twice in one day (the atomic `memidx`, and this).

## Dead code that encodes a superseded design is worse than dead

`Validator.refNullType` was uncalled, so it cost nothing at runtime. But it was the COARSENING
helper the T9.3 ValueType refactor replaced — it collapsed `ref.null $T` to an abstract supertype —
sitting immediately below the correct call site, with a helpful-looking doc comment and a plausible
signature.

That is a trap, not just clutter: the obvious next edit is to call it. And the bug it would
reintroduce is one a sibling project independently shipped (binaryen-ts's UP-7, a typed ref
collapsed to `anyref` on read).

**Delete superseded implementations in the same change that supersedes them.** If that is not
possible, the leftover needs a comment saying what replaced it — an uncalled private method with a
clean doc comment reads as an oversight, not a hazard.

## Fix the class, not the instance — then guard the class

`i64.add128` / `i64.sub128` were encodable but not decodable, so `wasm2wat`
could not read back what `wat2wasm` had just written. Fixed, tested, committed.

The proposal has FOUR opcodes. `i64.mul_wide_s` / `i64.mul_wide_u` sat with the
identical defect for another audit round, because the fix was driven by the
reported symptom rather than by the opcode space.

The generalisation is one question — *for every opcode the lexer can produce,
can the reader decode it?* — and it is cheap to answer exhaustively: feed each
of the 571 spellings to the reader as a synthetic body and look for the
"unknown … opcode" diagnostic. **0 / 571** after the fix, and it now lives in
the regression file, so the class is guarded rather than four instances.

Two notes on building that sweep:

- **The static version was wrong in the noisy direction.** Matching `case`
  labels in the reader source reported 317 gaps, 315 of them false, because the
  SIMD and atomics decoders dispatch by RANGE, not by case label. Running the
  code beats parsing it — the empirical version is shorter AND correct.
- **Invert it before trusting it.** With the fix stashed the sweep reports
  exactly the two real gaps and nothing else.

## "Unreachable" is a property of today's code, not of the defect

`getMiscOpcodeTypeInfo`'s `default:` returned a `(v128,v128,v128) → v128`
signature for any unhandled misc opcode. Misc opcodes are never SIMD, and the
comment thirty lines above it documents the T9.2 incident caused by exactly
that fall-through. It was written up as a latent trap and deliberately left
alone, with a defensible reason: unreachable today, and changing validator
behaviour risks moving metrics for no measured gain.

**It was reachable one commit later.** Adding wide-arithmetic support to the
binary reader — a change that never touched the validator — routed
`i64.mul_wide_s` (a `BinaryExpr` carrying a misc opcode) straight into it. The
result was worse than the incident it echoed: not "wrong operands validate
clean" but **every well-typed wide-arithmetic module rejected**.

So when the reason to defer a fix is "nothing reaches it", note what WOULD
reach it. Here the answer was "any misc opcode that is not a saturating
truncation" — and the same audit round that logged the trap was in the middle
of adding two.

**Corollary: a hard-coded shape in a handler that ignores its opcode is the
same bug.** `onQuaternary(_opcode)` hard-coded the v128×4 shape — note the
underscore, marking the opcode as deliberately unused — and so rejected the
only instructions that reach it. A lying default is greppable; a lying constant
in a handler body is not.

## When V8 gates a proposal off, it is not an oracle for that proposal

Every wide-arithmetic defect here was invisible to the agreement metric,
because V8 answers `Invalid opcode 0xfc13 (enable with --experimental-…)` — it
rejects the module for a reason that has nothing to do with whether we typed it
correctly. Agreement stayed 2120/2120 through a validator that rejected every
well-typed module of that proposal.

Wasmtime with `-W wide-arithmetic=y` settled it in one command. **Before
trusting "the oracle agrees", check the oracle actually implements the feature
under test** — a rejection for a feature gate looks identical to a rejection on
the merits.

## A metric measures the population you fed it — audit the CLASSIFIER, not just the checker

`assert_invalid` sat at **2664 / 2737, 73 missed** for the whole campaign, and
every tranche from T9.5 to T9.10 was driven by chasing those misses. The number
was wrong in the denominator.

`(assert_trap (module …) "msg")` was being parsed as `assert_invalid`. The two
assertions say opposite things — one means "must fail validation", the other
means "is valid, and traps on instantiation" — so **54 valid modules were in the
population, and correctly accepting them scored as 54 misses**. The real figure
is 2664 / 2683, 19 missed.

Nothing about the validator changed. What changed was what we were counting.

Two things follow:

- **When a metric plateaus with a stubborn residue, suspect the residue's
  provenance before hunting more bugs in the thing being measured.** The "73"
  was five parts classification artefact to one part real finding, and a
  cross-engine exercise was run over it — which is why all three engines
  returned a flat accept. They were mostly valid modules.
- **The classifier is code too.** We audited the validator exhaustively and
  never audited the parser that decides which bucket each spec command lands
  in. `parseWastScript` returning the wrong command kind is as much a defect as
  a wrong type rule, and it is invisible to every metric that consumes its
  output — because the metric IS the consumer.

## A metric you have never built is where your regressions go to hide

T10.5's deferred function-body parsing introduced a silent regression: an
unknown or misspelled instruction stopped being an error and became a silent
DELETION of the whole expression, with `wat2wasm` still reporting success.

It survived six commits and a deliberate "look for code issues" audit. Every
one of the six metrics was green throughout, and none of them could see it:

- parse-clean measures files that parse WITHOUT error — this bug removes errors
- V8-validity, round-trip and execution all start from modules that parsed
- validator agreement and `assert_invalid` both consume the parser's output

**A metric that only ever asks "does good input succeed" cannot see a change
that makes bad input succeed too.** The seventh metric — `assert_malformed`,
the spec's "this must fail to parse" assertions — found it on the first run,
along with a second defect that had been there far longer.

Two rules:

- **For every "does X work" measurement, ask what the corresponding "does
  NOT-X fail" measurement is.** Both directions of `assert_invalid` were
  measured years into this project; both directions of PARSING were not.
- **When you make a parse path more permissive as a side effect — restoring a
  cursor, swallowing a Result, skipping a region — that is a change to the
  error path, and the error path needs its own test.** `parseInstrList` returns
  `Result.Ok` no matter why its loop stopped; deferral removed the only thing
  that had been catching that.

## Ranking by measurement is only as good as the measurement

T12 was opened with its eight categories ranked by MEASURED consequence rather
than case count — deliberately, because T10 had been mis-ordered for a whole
campaign by inheriting a severity ranking. The probe asked, for each category,
"what does accepting this actually produce?"

T12.3 still came out one rank too low. The probe recorded `align=0` and
`align=7` as "align silently DISCARDED (falls back to natural)" — true, and it
sounded like a lost annotation. Fixing it showed the real behaviour: the raw
value flows into a `log2` that FLOORS, so **`align=3` was emitted as
`align=2`** — a different module, and the optimizer treats alignment as a hard
constraint.

The probe had checked whether the value SURVIVED, not what it survived AS. Two
of the ten cases I chose happened to be ones where the floor landed on the
natural alignment, which reads as "discarded"; a single `align=3` would have
shown it immediately.

**When probing severity, choose inputs whose wrong answers are DISTINGUISHABLE
from each other.** "It vanished" and "it became something else" are different
severities and it is easy to pick a sample where they look the same.

## Rank a category by the RULE it represents, not by the metric that surfaced it

T12.5 was ranked last of the tranche's wrong-value work — "name mangled", 186
cases — because that is what the `assert_malformed` QUOTED metric showed. It was
the highest-leverage item in T12 by a wide margin.

The rule "a wasm name must be valid UTF-8" holds on both sides of the pipeline,
and the spec tests it mostly on the other one: `utf8-import-module.wast`,
`utf8-import-field.wast` and `utf8-custom-section-id.wast` are 176 BINARY cases
each. One fix moved quoted 869 → 1045 and binary 110 → 638.

The ranking was built from a single metric's view of the category. **A category
is a RULE; count its cases wherever the rule applies**, not just where the
metric that found it happens to look. The tell was available before any work
started — the file names say "import-module", "import-field",
"custom-section-id", all of which exist in both encodings.

## The exemption is part of the rule, and needs its own test

Making names strict UTF-8 is only correct because DATA SEGMENTS are exempt —
`(data "f")` is legal wasm and must stay legal. The codebase already split
those paths (`parseQuotedText` for names, `parseTextList` for bytes), so the fix
was two decoders and no restructuring; had they shared one, the tempting fix
would have broken every data segment with a high byte in it.

When tightening a rule, write down what it must NOT apply to, and test that
alongside — an over-broad tightening reads exactly like a correct one until
something legal hits it.

## "We consume it and ignore it" is a bug shape you can GREP for

T12.6 through T12.9 kept turning up the same thing under four different
category names, and the code always looked like one of these:

```ts
if (this.peek() === TokenType.Var) this.drop();   // a closing label, unread
private skipInlineBlockSig(): void { … }          // a signature, unread
this.readU32Leb();  // "used for validation, we don't store it"
const mutable = this.readU8() !== 0;              // 0x02 and 0xff are MUTABLE
const alignLog2 = alignFlags & 0x3f;              // 0x80 becomes 0
```

The first three are visibly discards. **The last two are the same discard
spelled arithmetically**, and they are the ones that survived four releases: a
mask and a `!== 0` look like decoding, not like throwing something away.

What makes this class worth hunting directly rather than waiting for a metric
is that it never fails loudly. The parse succeeds, the module encodes, an
engine runs it — it is just a DIFFERENT module than the source says. Grep for
a `drop()`/`read*()` whose result is unused, for a `skip…` that returns
`void`, and for every `&` mask and `!== 0` applied to a field the format
defines exactly.

## Widening a mask is not fixing a range check

The NaN payload mask was `0x3fffff` and lost `nan:0x400000` to infinity. The
fix widened it to `0x7fffff` — correct for that input, and it left `nan:0x0`
producing infinity by exactly the same mechanism, for two more releases (T12.9).

A mask answers "which bits do I keep". The format's question is "is this value
in range". When a bug report is "this value came out wrong", check whether the
code is answering the second question at all; if it is masking, the fix is a
comparison, not a wider mask.

## A rule that only fires when its operand is already known is half a rule

T12.7 made an inline signature beside a `(type $t)` check against the type it
restates. It compared at the point of use — and a type use may refer FORWARD,
so every module that declared the type later skipped the comparison silently.

**No spec case combined a forward reference with a mismatched restatement, so
the metric read 100% either way.** The gap was found by asking what the check
does when its input is not there yet, which is a question worth asking of any
check that resolves a name: defer it to the point where the whole scope is
known (`pendingTypeUses` alongside `pendingBodies`) rather than checking
opportunistically.

## Where you put the probe changes the number, so say where it is

Quoted `assert_malformed` reads **1227 / 1229** at `parseWatModule` and
**1229 / 1229** through `wat2wasm`. Both are honest; the difference is two
undefined labels, which `resolveNames` rejects and the parser does not, because
name resolution is genuinely a separate pass here.

That is not a rounding difference to paper over. Report the probe point with
the number, and prefer the stricter one as the headline — a metric quoted
without its boundary invites exactly the mistake of "fixing" something that was
never broken.

## Run the whole panel, not the metric you are moving

The T12.8 function/code count check went in as
`count !== m.funcs.length - m.numFuncImports`. `m.funcs` holds defined
functions only, so it rejected every module with a function import.
**`assert_malformed` was identical either way** — round-trip dropped
2120 → 2051 across 14 files and named the error in its first line.

This is now the fourth time in the campaign that the metric which caught a
regression was not the one the work was aimed at. The panel takes minutes; a
check written in the wrong index space looks exactly like a correct one.

## A half-built feature is worse than a missing one, and no corpus will tell you

Custom page sizes had a feature flag, an IR field, a lexer keyword, and reader
and writer code — and no parser syntax, no validation, and a field whose
documented meaning (bytes) disagreed with what every writer of it stored (a
log2). Seven conformance metrics ran clean over it for an entire campaign,
because the proposal is not in the testsuite snapshot.

**A feature no corpus reaches is not covered by a corpus-shaped test, however
many of them pass.** The tell is a feature flag with no test that turns it on,
or an IR field no parser can produce. Grep for both.

The related sizing rule, from wazmrt's conformance ledger: it carried this item
as "2 assertions" and it was worth **69 skips**, because a module the assembler
cannot build sends every assertion targeting it into NoTarget. **Size an item
by assertions UNBLOCKED, not by failures closed** — the failure column
undercounted it 35x.

## Read the sibling project before designing the same feature twice

wazmrt (the Zig runtime) had shipped custom page sizes and left its reasoning
in the code: the not-every-power-of-two trap, the ceiling that must divide by
the page size, the flag bit that is a property of the POSITION rather than the
value, and what a silently-dropped `(pagesize …)` costs at run time. Reading it
first turned a design question into a review, and produced two places where our
answer should DIFFER — the malformed/invalid layer split, and preserving an
explicit `pagesize 65536` because round-trip fidelity is a metric here and not
there.

**Take the rules; re-derive the choices that depend on what the project IS.**
A runtime and a format tool are allowed different answers about what may be
canonicalised away.

## "Nothing records that" is a claim about the checkout you searched

Asked whether a Go/GC link to page sizes existed, I grepped wasmtk and found
nothing — and reported that. The checkout was dated **2026-07-02** and the work
was dated **2026-07-08**. The finding was real, six days newer than the tree I
searched, and `git log -1` would have said so before the grep did.

The project already knows the frozen-snapshot version of this rule
(`tests/wasmtk/` and the `KNOWN_INVALID` retraction). This is the same rule
about a *live* sibling clone, which is easier to trust precisely because it is
not marked as a snapshot: **date the checkout before concluding from its
absence**, and prefer `git show origin/main:<path>` over the working tree when
the question is "does this exist upstream".

A negative result from a grep is only as current as `git log -1`.

## An "enable everything" switch can make an engine refuse everything

The rule "a default-off feature is not a spec opinion, so turn the proposals on"
is right, and the file that records it also records the trap: `-W
all-proposals=y` pulls in `stack-switching`, which a stock Windows Wasmtime
cannot compile, and then every module fails for a reason that has nothing to do
with the module. **I hit the identical trap on Wasmer the moment I applied the
rule to it.**

`wasmer validate --enable-all` rejects `(module (memory 1) (func))`. Bisecting
the individual switches, `--enable-tail-call`, `--enable-multi-memory` and
`--enable-memory64` each do it alone: they are accepted as flags and implemented
by no backend, so turning one on makes the ENGINE unsupported. The error is
worded as a module-level validation failure, so a 272-file corpus reads 0/272
and looks exactly like a catastrophic bug in the thing being measured.

Two rules, and the second is the one that saved it:

- **Enable proposals by explicit list, never with the blanket flag** — for every
  engine, not just the one where you already learned it.
- **Self-test the harness on a module that MUST pass.** A configuration failure
  and a module rejection are indistinguishable from the outside. This one was
  caught only because the corpus number was 0 and a trivial module was to hand;
  `engine-check` already refuses to report if an engine fails to reject a
  known-invalid module, and it needs the same guard in the accept direction.

## A one-sided rule is invisible to every metric built on your own output

The binary writer emitted a tag's attribute byte as `0x00` with the comment
*"only valid value"*. The reader did `this.readU8();` and threw it away. So
`0xff` decoded to exactly the same tag as `0x00` (T13.5).

**No metric could see that, and it is worth understanding why:**

- round-trip fidelity compares OUR bytes to OUR bytes, and we never emit the
  bad value, so we never read one back;
- `assert_malformed` only sees inputs the spec suite bothered to write, and it
  has no case for this byte;
- validator agreement and `assert_invalid` are about VALIDATION, and this is a
  decode rule.

The asymmetry is the tell, and it is greppable: **a constant the writer emits
with a comment justifying it, against a reader that does not check the same
constant.** Both halves of the rule were in the repo; only one was enforced.

This was the third "consume and ignore" instance in the binary reader after
T12.8 and T13.2 — three repetitions is enough to move the grep out of a tranche
and into the routine, alongside the sibling-case check (the tag attribute had to
be fixed in the section AND the import, exactly like Bug G and the
`atomic_rmw_cmpxchg` memidx).

