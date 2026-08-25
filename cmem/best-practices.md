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
- An audit must report the size of the population it examined
- Test the two halves of a parser against each other
- The proposals your corpus lacks are your blind spot
- After changing code, audit the change before auditing the codebase
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
- Name the ref you measured, and check it is the ref the reader will run
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
`(data "\0cf")` is legal wasm and must stay legal. The codebase already split
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

## An audit must report the size of the population it examined

Two self-inflicted misses in one review pass, both invisible without a count:

- The `Var`-field audit reported "374 of 571 unresolved" because the capture
  group stopped at the first `)` in `S(0x61)`. It printed a result and looked
  like it had run; it had checked a third of the table.
- The alignment audit named three token types (`LoadSplat`, `LoadZero`,
  `LoadExtend`) that match nothing — the SIMD loads are all `TokenType.Load`.
  The population happened to be complete, but only a trailing line saying "these
  names matched no rows" made that checkable.

**A clean result and an empty run look identical unless the audit says how much
it looked at.** Print the denominator, and assert on it (`assert(checked > 80)`)
so a mis-typed filter fails instead of passing vacuously. This is the same rule
as "a metric measures the population its classifier hands it", applied to
one-off audits rather than standing metrics — and one-offs are MORE exposed,
because nobody re-derives them later.

## Name the ref you measured, and check it is the ref the reader will run

One report to wasmtk contained BOTH directions of the same mistake, which is
what makes it worth a rule rather than an apology:

- **Ask 2** stated a present-tense fact about wasic from `tests/wasmtk/`, a
  FROZEN snapshot. Current wasic emits a real `throw` in all five modules; the
  whole finding evaporated. Third time this week the snapshot produced a wrong
  upstream claim, after the `KNOWN_INVALID` seven and the 6-vs-10 EH scope — and
  the rule against it was already written, and had been cited earlier in the
  same session.
- **Ask 1** stated a present-tense fact about a RELEASED wabt-ts version from
  `main`. "`try_table` works end to end; nothing needed on our side" was true of
  HEAD and false of v1.3.5, which is what they pin. At the pinned version we
  could emit only the form Wasmtime refuses.

Both are "I tested one tree and reported about another." The existing rule
covered the snapshot direction only. It reads in both now:

**Before any cross-project claim, write down the ref you measured and the ref
the reader will run. If they differ, either measure theirs or say which is
which.** `git log -1` on their checkout; `git worktree add <tmp> <tag>` on ours.
A worktree at the pinned tag is thirty seconds and would have caught this.

**The corollary that cost the most:** the fix they needed had existed since
2026-08-21 and was sitting unreleased on `main`. **An unreleased fix is
indistinguishable from an absent one to everyone downstream** — if a report says
"nothing needed on our side", check that the nothing is actually shipped.

## Test the two halves of a parser against each other

The strongest bug found in the 1.4.0 pre-release audit needed no oracle, no
corpus and no engine: `instrInputCount` said one thing and `buildPlainExpr` did
another, for three atomic families, and **`wasm2wat` was emitting wasm V8
rejects** (T13.8).

The differential that found it: write the instruction in **FOLDED** form, where
operands are inline children and the arity table is not consulted for them;
disassemble to **LINEAR** form, where the table is exactly what pops operands
off the stack; re-encode; compare bytes. The two halves must agree, and neither
is trusted as the reference.

This generalises. Wherever a codebase has two paths that must agree — folded and
linear, named and numeric, text and binary — **the differential is cheaper than
an oracle and finds things no corpus contains.** Both audits added here are of
that shape, and both found what seven conformance metrics could not:

- folded vs linear caught the arity bug;
- named vs numeric (T13.7) covers the class that shipped in v1.3.5 and blocked a
  downstream team, because round-trip only ever exercises the numeric form.

The corollary for invariants: **an invariant nobody has checked mechanically is
a comment.** Both of these were written down — "audit its `opN()` calls when
adding an opcode", and the arity note itself — and both were wrong in the tree.

## The proposals your corpus lacks are your blind spot

Seven conformance metrics, all green, and the threads proposal had **two** real
bugs in it: an arity table that made `wasm2wat` emit wasm V8 rejects (T13.8),
and a validator that type-checked every atomic as `(v128,v128)→v128` and
rejected them all (T13.9).

Neither was subtle. Both were invisible for one reason: **the 257-file spec
testsuite snapshot contains no atomics at all** — no `atomic.wast`, no
shared-memory file, not one `atomic.load` / `store` / `rmw`. Every metric is
shaped by that corpus, so the entire proposal sat outside the population being
measured.

**Before trusting a corpus-shaped number, enumerate what the corpus does not
contain.** Here that list is a real artifact: `ls` the testsuite and diff it
against the proposals the code claims to support. Anything the code implements
and the corpus never exercises needs a test written by hand, because no amount
of green will ever reach it.

The same logic explains T13.4 (custom page sizes shipped half-built) and T13.10
(nine dead feature gates): all three are features the corpus cannot see.

## After changing code, audit the change before auditing the codebase

Five audit passes over this codebase found six bugs. The fifth found exactly one
gap — **in the feature gating written an hour earlier** (instructions gated,
types not). Nothing in the older surface turned up.

That is worth acting on rather than noting: once a codebase has been swept a few
times, the highest-yield place to look is the most recent diff, not a new
region. Re-audit your own change with the same instruments used on everything
else — and specifically ask what the change does NOT cover, since a gate keyed
on one kind of thing (instructions) says nothing about its siblings (types).


## A guard is only as wide as the AXIS it varies

T13.7 built `tests/parser/named_refs.test.ts` — a named reference in every
position the grammar allows, 64 cases, 21 of which fail against v1.3.5. It is a
good guard, built for exactly the right reason, and it **covers `table.get`**:

```wat
(module (table $t 1 funcref) (func (drop (table.get $t (i32.const 0)))))
```

It still missed T13.11, a `resolveNames` bug in `table.get`, for a reason worth
internalising. The axis that test varies is WHERE the name appears — the table
slot, the memory slot, the tag slot, the catch target. In every one of the 64
cases the *operands* are held constant as literals (`(i32.const 0)`,
`(ref.null func)`). And T13.11 lives in the operand: `table.get`'s index
sub-expression was never recursed into, so `(table.get $t (global.get $g))`
failed while `(table.get $t (i32.const 0))` passed.

The guard varied position and held operands fixed, so it could only ever find
position bugs. This is the same lesson as "a guard is only as wide as its
corpus," one level up: **a hand-built guard has an axis, the axis is a choice,
and everything off it is as invisible as it was before the guard existed.**
When building one, write down the axis explicitly and ask what the *other*
dimensions are being pinned to.

**Closed 2026-08-25 (T13.13).** The operand axis was added — 69 cases, one per
instruction that takes sub-expressions — and came back **69 / 69 clean**. No
product bug lived there beyond T13.11 itself. That is worth stating as a result
rather than a shrug: before the axis existed the honest position was "we have
never looked," and those are different states even when the number is the same.

Reverting the T13.11 fix turns **exactly one** of the 69 red. A guard that goes
uniformly red under inversion is measuring something coarser than it claims;
one that flips precisely the case you broke is calibrated.

## Enumerate the type on every axis the type has

The audit that found the atomic `memidx` gap is recorded here as "audit a manual
walk against the TYPE, not against a corpus," and it works. But it was run on
one axis: every `Var`-bearing field of every `Expr` interface vs. the
`resolveNames` case that handles it.

`resolveNames` has to be total on **two** kinds of field — name-bearing
immediates (`Var`) and sub-expressions (`Expr`) — and the `Var` audit came back
clean while T13.11, an `Expr`-field gap, was live. Re-run mechanically over
`ir.ts` on 2026-08-25, the two axes report:

| axis | population | misses |
| --- | --- | --- |
| `Var`-typed fields vs. case body | 64 interfaces | 0 |
| `Expr`-typed fields vs. case body | 75 interfaces | **1** (`table.get.index`) |

A clean result on one axis says nothing about the other. When enumerating a
type, enumerate every KIND of member the invariant ranges over, not just the one
that produced the last bug — the previous bug is what makes an axis feel like
*the* axis.

Cheap to do: the whole audit is ~30 lines of `awk` over the interface
declarations plus a regex over the switch bodies, and it runs in under a second.
Worth re-running after any change that adds an IR variant.

## A behavioural fixture must go through the instruction under test

The first behavioural fixture written for T13.11 reached the table through
`call_indirect` and **passed with the bug still in place**, because
`call_indirect` has its own, correct `resolveNames` case. It reached the same
observable state — a table element selected by a named global — by a path that
was never broken.

The shipped fixture uses `table.get` directly. Only slot 3 is populated and only
global 1 holds 3, so a resolve that fell back to global 0 reads the empty slot
and `ref.is_null` flips.

This is a specific failure mode of the standing "invert the guard before
trusting it" rule: inverting catches a test that passes *unconditionally*, but
this one failed correctly on the assertion-count axis — 4 of 7 steps went red —
while the behavioural step, the one carrying the semantic claim, stayed green
for the wrong reason. **When inverting, check WHICH steps flip, not just that
some do.** A behavioural step that survives the inversion is testing a
neighbour, not the defect.

## A green gate is a floor, not a result

The audit that produced T13.11 and T13.12 started from: `deno lint` clean,
`deno task check` clean, 363 tests passing, and **all seven conformance metrics
exhausted** — 257/257 parse, 2119/2119 agreement, 2683/2683 `assert_invalid`,
round-trip closed. There was no failing signal anywhere to pull on.

Both bugs were found by enumerating types and comparing siblings, which is
exactly what the tooling cannot do. Neither moved a metric, and neither could:
`table.get` with a named operand is absent from both corpora, and six of the
seven metrics start from bytes, downstream of a text-side name-resolution
failure.

The practical form of this: when everything is green, do not read that as
"nothing to find." Read it as "the instruments that can see are all reporting" —
and reach for the ones that require reading, not running.

## A harness reporting zero is broken until proven otherwise

Re-measuring the conformance metrics after T13.11 / T13.12 took three attempts,
and **both failures printed a confident number rather than an error**:

- `0 / 0` — a wrong guess at the wast-command shape, so no module was ever
  reached;
- `0 / 2120` — the population was right, but `writeBinaryIr` returns a
  `Uint8Array` and the harness did `w.buffer ?? w`. A `Uint8Array` *has* a
  `.buffer`, so this quietly took the underlying `ArrayBuffer`, and the
  `instanceof Uint8Array` guard then rejected all 2120 modules.

Read literally, the second run said the encoder had stopped working entirely.
It had not. **Sanity-check the DENOMINATOR before believing the numerator**: the
populations here are known constants — 257 files, 2120 modules, 272 corpus files
— and hitting them exactly is the evidence the walk is correct. A metric whose
denominator is right and whose numerator is zero is a real catastrophe; a metric
that reports zero out of zero, or zero out of everything, is almost always a
harness bug.

Corollary for the `?? ` idiom specifically: `a.b ?? a` is only a safe "unwrap or
passthrough" when `a` genuinely lacks `b`. On built-ins it usually does not —
typed arrays have `.buffer`, functions have `.name`, everything has
`.constructor` — so the fallback never fires and the wrong branch is taken
silently.

## Measure even when the argument for "nothing could move" is good

The argument for skipping re-measurement after T13.11 / T13.12 was sound:
`table.get` with a named operand is absent from both corpora, and six of the
seven metrics start from bytes, downstream of a text-side name-resolution
failure. All true, and all beside the point — **T13.12 adds a `throw` to a code
path every single encode runs through.** A bound off by one would have converted
valid modules into hard failures across the entire corpus, which is precisely
what a metric detects and what an argument about reachability does not even
address.

The measurement cost about two minutes and returned `0` hard failures, which is
the fact that actually retires the risk. When a change touches a shared path,
the reachability argument tells you where the bug ISN'T; only the run tells you
the change is inert.

## Ask what a suite ASSERTS before borrowing a fixture from it

Building the operand axis for `named_refs.test.ts`, three fixtures failed the
new V8-validity check. Two of them had been copy-pasted out of the existing
64-case table in the same file — and triaging "my fixture or a real bug?"
revealed that **the originals were invalid wasm too**, and had been for four
releases:

- `array.new_elem` — elem segment `(ref func)` against an array of
  `(ref null $ft)`; V8: *not a subtype of array element type*.
- `br_on_cast` — the branch target was a bare `(block $l)`; V8: *must target a
  branch of arity at least 1*.

They passed because that suite only ever asserted `wat2wasm` returned a
non-empty buffer. It never asked an engine anything. For those two constructs it
was asserting "the encoder produced bytes" about input that was not a module.

Two rules fall out. **A fixture inherits the assumptions of the suite it came
from, including the unchecked ones** — when a borrowed fixture fails a stricter
assertion, check whether the source suite ever asserted that property, rather
than assuming the fixture was vetted. And **"the encoder accepted it" is not a
validity claim**: any suite whose fixtures are supposed to be valid wasm should
say so to an engine, or its fixtures will drift and nothing will report it.

## A metric that counts one direction is blind to the other, structurally

Validator agreement is *"of the modules V8 accepts, how many do we accept?"*. It
counts **false REJECTIONS**. It can sit at 2119 / 2119 while the validator waves
through anything at all, because a module we wrongly ACCEPT is not in its
population. That is not a gap in the measurement, it is the measurement's shape,
and no amount of corpus will fix it.

T13.14 found twelve false accepts in the GC instructions with every one of the
seven campaign metrics green and unmoved — and none of them could have moved,
because `assert_invalid` only covers the invalid modules the spec testsuite
happens to contain, and it contains none of these shapes.

**The counter-measure is a hand-built INVALID corpus, and it is cheap.** Roughly
twenty lines: a table of modules that should be rejected, run through
`wat2wasm` (which does NOT validate) into `wasmValidate`, with V8 as oracle and
Wasmtime as the authority. Twelve real bugs came out of the first two passes.
Write the fixtures by asking, per instruction family, "what is the most obvious
way to be wrong here?" — wrong hierarchy, wrong numeric type, wrong
signedness, missing check entirely.

**And read the direction of every metric you quote before concluding from it.**
"Agreement 2119 / 2119" reads like "the validator is correct"; it means "the
validator is not too strict". Those are different claims, and only one of them
was ever measured.

## A rejection is evidence only for the check you actually varied

`ref.as_non_null` on an i32 was rejected by a first probe, so it was scored
correct and set aside. It was rejected on the RESULT type: the fixture declared
`(result anyref)` and the instruction pushed the i32 straight back, so the
mismatch was at the function boundary and the operand check — the thing being
audited — never ran at all. Make the declared result agree with the wrong
operand and the module validates clean.

The fixture had **two** reasons to fail and the wrong one was credited. When a
negative result clears a check, confirm the failure came from that check:
change the fixture so every other reason to fail is removed, or read the error
message and see that it names what you expect. A green "it rejects" is worth
nothing if you cannot say which rule did the rejecting — this is the same
discipline as the sensitivity check (revert the fix, see EXACTLY which steps
flip), applied to a probe rather than to a suite.

## Enumerate the family, then ask what each member checks

Three separate bug clusters here — Bug G, the atomic `memidx`, and now T13.14's
twelve — were found the same way, and none by a corpus:

1. pick a FAMILY (all the memarg handlers, all the `Var`-bearing cases, all the
   GC instructions that pop a reference);
2. for each member, read what it checks;
3. any member that checks less than its neighbours is the finding.

The tells, in rough order of strength:

- **an underscore-prefixed parameter** (`_signed`, `_offset`) in one handler of
  a family whose siblings use it — declared and dropped IS the missing check;
- **a parameter the sibling takes and this one does not** — `onStructGet` took
  `signed`, `onArrayGet` never did, and `validator.ts` had `e.signed` in hand;
- **a bare `dropTypes(n)`** where siblings call `popAndCheck1Type`;
- **a `case` sharing a label with a genuine LEAF** (T13.11's `table.get`);
- **a helper that exists and is not called** — `isSubtype` was already on
  `SharedValidator` and `onBrOnCast` already used it; `ref.cast` and `ref.test`
  simply never did.

That last one is worth its own note: **the fix for T13.14's largest root was to
call a function that had been sitting in the same class for releases.** When a
check is missing, look first for a sibling that already has it rather than
designing one — and if you find it, the comment on that sibling usually
explains the rule for free.

## Fixing one direction of a rule can break the other, so pin both

The obvious repair for a cross-hierarchy cast is "require the cast-to type to
be a subtype of the operand" — and it is WRONG. Both V8 and Wasmtime accept a
WIDENING `ref.cast` (`(ref $s)` to `(ref null any)`), so a subtype test in
either direction rejects valid modules; the actual rule is that the two types
share a hierarchy. The check that catches this is the one nobody writes: a
table of modules that were ALREADY VALID and must STAY valid, asserted in the
same test as the newly-rejected ones.

`gc_operand_checks.test.ts` carries 15 invalid + 14 valid for exactly this
reason, and the valid half is the half that constrains the design. **A
tightening change needs a both-directions measurement before it lands** — for a
validator that means the false-reject sweep as well as the false-accept one; the
former was re-run with the three edited files reverted, to establish that 449 /
449 was the baseline and not a coincidence of the new code.

## Enumerate the SIGNATURE, not the parameter

T9.11 swept twelve memarg handlers for one thing: does each use its `offset`?
Ten did not, all ten were fixed, and the item was closed. On 2026-08-25 T13.15
found `onSimdLoadLane` and `onSimdStoreLane` — **two of those same twelve
handlers** — still declaring and dropping `is64`, so a 64-bit memory got an i32
address check. The earlier audit had walked the family along ONE PARAMETER and
declared the family clean.

That is the axis lesson (*"a guard is only as wide as the axis it varies"*)
applied to an audit rather than a test, and it has a cheap fix: when a family
audit turns up a missing parameter, **finish the member before closing the
family** — read the whole signature of at least the handlers you touched, and
ask of every parameter what a sibling does with it. Ten fixes in one pass is a
signal that the family is neglected, not that it is now complete.

The same reading applies to a fix list: the presence of `is64` in
`onLoadSplat` right next to the two that dropped it was visible the whole time.
Nobody looked because the question being asked was about `offset`.

## Run the mechanical axis even at a low true-positive rate

The `instrInputCount` vs `buildPlainExpr` scan (declared arity vs the highest
`opN()` each case actually reads) reported six mismatches. **Four were regex
artifacts** — stacked `case` labels confusing the block splitter — and had to be
dismissed by hand. The remaining two were `data.drop` and `elem.drop` declared
at arity 1 while consuming nothing, which made the compiler silently delete a
preceding instruction and emit a module that ran and returned the wrong answer
(T13.16).

A 33% true-positive rate on a scan that takes a minute to write and a second to
run is an excellent trade, and the instinct to distrust a noisy enumeration is
worth resisting. **Triage the false positives by hand rather than tightening the
scan** — tightening is where a real finding gets filtered out, and the four
dismissals took less time than making the regex understand stacked labels would
have.

## Not every family has three engines — say which oracle you actually had

The standing rule is V8 as fast oracle, Wasmer as divergence detector, Wasmtime
as the authority. **Legacy EH has none of that**: Wasmtime 47.0.3 and Wasmer
both refuse `try` outright (`legacy_exceptions feature required`) and
`wasmtime -W` has no switch to enable it, so V8 is the only engine that will
rule on a legacy-EH module at all. T13.17's fixtures are V8-only for that
reason.

Two things follow. **Write the limitation into the test header**, not just into
the commit message — a fixture asserting `v8Accepts(binary) === false` reads
like a full cross-check to the next person unless it says otherwise. And
**weight the severity by it**: a soundness hole in a family the primary WASI
host will not execute is real and worth fixing, but it is not the same
proposition as one in a family that ships, and a bug list that does not
distinguish them is misleading in the direction of panic.

## A shared `case` label asserts its members are interchangeable

Grouping labels to share one body is the most ordinary thing in a switch, and it
is also a **silent claim**: that every member of the group is the same in every
respect the body cares about. Nothing type-checks that claim, no test states it,
and when it is false the body does something plausible to an instruction it was
never written for.

It has now produced two separate bugs in this codebase, in two different files,
three weeks apart:

| item | the group | the member that did not belong | what it cost |
| --- | --- | --- | --- |
| T13.11 | `resolveNames`: `case 'table.size'` — a genuine LEAF | `table.get`, which carries a sub-expression | its index was never walked; **valid WAT failed to encode** |
| T13.16 | `instrInputCount`: the arity-**1** group | `data.drop` / `elem.drop`, which are `[] -> []` | the parser ate the preceding instruction and **DELETED it** — wrong answer, no diagnostic |

Both read perfectly naturally in review. `table.get` and `table.size` are
adjacent in the spec and both take a table immediate; `data.drop` sits among a
dozen instructions that do take exactly one operand. The grouping is wrong on an
axis the surrounding names do not mention.

So: **when you add a label to an existing `case` group, state to yourself what
the group is asserting and check the new member against it** — not against the
other labels' names. And when auditing, treat every multi-label `case` as a
claim to verify rather than as one unit to read. The two axes that have actually
bitten are *is every member a leaf?* and *does every member have this arity?*

## A closed audit item is a claim about the question you asked

T9.11's entry reads like a family was finished: twelve memarg handlers
enumerated, ten defects found, all ten fixed. What it actually established is
narrower — *ten of twelve handlers ignored their `offset`, and no longer do*. The
handlers themselves were never certified; one parameter of theirs was. T13.15
then found `is64` dropped in two of those same twelve.

This is worth separating from the fix that follows it (*enumerate the SIGNATURE,
not the parameter*), because the failure is one of **bookkeeping, not
technique**. The audit was competent. Its result was recorded in a form that
overstated it, and the next person read "memarg handlers: audited" instead of
"memarg handlers: audited for offset".

Two habits fix it, both cheap:

- **Write the question into the finding, not just the answer.** "Every memarg
  handler checks its offset" ages correctly; "the memarg handlers were audited"
  does not.
- **When a bug lands somewhere a previous audit visited, record the RECURRENCE
  as part of the finding.** It is the strongest available evidence about where
  the next bug is, and it is invisible unless someone writes it down at the
  moment it happens — by the next pass it just looks like two unrelated entries.

### Root causes that have recurred — check these first

The point of the table is that these are not hypotheses. Each has produced a
real, shipped-or-nearly-shipped defect more than once, which makes them the
highest-yield things to look at in any new audit here.

| root cause | occurrences | where to look |
| --- | --- | --- |
| **Unused parameter in a family of parallel handlers** | T9.11 (`offset`, 10 handlers) → T13.14 (`_signed`, struct/array get) → T13.15 (`is64`, **two of T9.11's own handlers**) | any `_`-prefixed parameter whose siblings use the same name; any parameter a sibling takes and this one does not |
| **Shared `case` label whose members are not interchangeable** | T13.11 (leaf vs non-leaf) → T13.16 (arity 0 vs 1) | every multi-label `case`, checked on the axis its body actually depends on |
| **A helper that exists and is simply never called** | T13.14 (`isSubtype`, already used by `onBrOnCast`) → T13.17 (`LabelType.Catch`, already set by `onCatch`) → T13.18 (`getOpcodeNaturalAlign`, a duplicate table nothing called) | a check missing in one place that a sibling performs — look for the existing helper before designing a new one |
| **A `default:` arm returning a benign value** | T13.18 (`instrInputCount`'s `default: return 0` — already the cause of the `Quaternary` wrong-IR-tree bug) → T13.16 (its inverse: a wrong explicit entry) | any `default` that returns `0` / `false` / `null` / `Result.Ok` in a function whose other arms return real per-case data |

**Three of the four T13.14–T13.17 findings sit in this table**, which is the
argument for keeping it: the pass that found them did not start from a fresh
idea about where bugs live, it started from where bugs had already lived.

### How the table actually performed, and what that predicts

The first audit run FROM the table (2026-08-25, T13.18) found **no new
wrong-answer bugs**. One row — *a helper that exists and is never called* —
pointed straight at a duplicated alignment table that would not have been
reached any other way. The other two rows produced only negative results.

That is the expected shape and it is worth stating so the next person is not
disappointed by it: **a recurrence table's predictive value decays as it is
used**, because the pass that writes a row is usually the pass that sweeps that
row clean. It stays valuable for two things after that — catching the row's
NEXT instance in code written later, and telling a newcomer where this codebase
is structurally weak — but it stops being a bug-finding engine after a round or
two.

So: keep extending it, do not expect a yield curve, and **treat a clean sweep of
a row as the result** rather than as a failed search. The rows are cheap to
re-run and the alternative — deciding fresh each time where to look — is how
T9.11 came to be re-audited three releases late.

## Record the negative results, or the next pass re-derives them

Three axes came back clean in T13.18: `instrProducesValue` omitting the SIMD
loads (runtime-checked in four shapes), the 87-token arity enumeration, and a
differential of the two natural-alignment tables across the whole opcode space.
None of them produced a fix. All three are written into `tasks.md` anyway.

The reason is that **"clean" and "never examined" are indistinguishable from the
code**, and they imply completely different next actions. An auditor who finds
no record of the SIMD-load question will spend the same twenty minutes deriving
the same answer; one who finds "checked 2026-08-25, correct because folded
parsing collects children explicitly and the linear placeholder means
already-on-the-stack" can move on — or, better, can notice if the reasoning
stops holding after a parser change.

A negative result needs the same three things a positive one does: **what was
varied, what was held fixed, and why the answer is what it is.** "Looks fine" is
not a negative result; it is the absence of one.

## An unearned fix is a worse trade than the doubt

`instrProducesValue` omitting `SimdLoadSplat` / `SimdLoadLane` looked wrong —
both produce a v128, both fall to `default: return false`, and the comment
directly above them documents this exact setup causing operand scrambling for
`call`. The tempting move was to add them "for robustness".

Four runtime probes said the behaviour is correct, for a reason that holds
generally (folded parsing collects children explicitly; in the linear case the
placeholder means "already on the runtime stack"). Adding the tokens would have
changed which list a value-producing instruction lands in, in a function whose
own comment history records two prior regressions from exactly that kind of
change — to fix nothing.

**A change that fixes no demonstrated defect is not free**; it is a bet against
a delicate function with no upside to win. Prefer recording the reasoning
(above) and leaving the code alone. Same instinct as *"an unearned rule is
noise"*, applied to code rather than to documentation.

## Write down the thing you only said out loud

Every rule in this file exists because someone paid for it once. What decides
whether it gets paid for TWICE is not whether anyone understood it at the time
- it is whether the understanding reached a file.

The pattern is consistent and it is worth naming, because it does not feel like
a failure while it is happening:

| what was known | what the record said | what it cost |
| --- | --- | --- |
| "we audited these handlers for `offset`" | "the memarg handlers were audited" | T13.15 - the same two handlers still dropped `is64` three releases later |
| "these snapshot files are frozen and predate the fix" | (nothing; the snapshot's age was undocumented) | a wrong present-tense claim sent upstream, corrected by the wasmtk team |
| "the arity list is hand-maintained, so it can drift" | a header comment ASSERTING the list was complete | `Quaternary`, then T13.16 - a wrong IR tree, then a deleted instruction |

In all three, nobody was confused. The scope, the staleness and the fragility
were understood by the person doing the work and simply did not survive into
the artifact. **Knowledge that exists only in a conversation is operationally
identical to knowledge nobody has** - and the conversation always ends first.

So when writing anything up here:

- **The scope of a check belongs in the finding.** "Every memarg handler checks
  its offset" ages correctly; "the memarg handlers were audited" does not.
- **A completeness claim in a comment is a liability unless it is tested.** If
  the claim is true it is testable (T13.18); if it is not testable it should not
  be phrased as a claim.
- **Calibrate honestly, including downward.** A tool described accurately keeps
  getting used. One oversold gets abandoned the first time it disappoints, and
  then its real value - which was never zero - goes with it.
- **The two lines it costs are always cheaper than the re-derivation.** Every
  row in the table above was a multi-release round trip that a sentence would
  have prevented.

## Notate the INTENT of a section, at the section, for whoever edits it next

Distinct from the rule above about writing findings down. This one is about
comments in the CODE, and it is aimed at a specific failure: an editor works on
the right file, in the right function, makes a locally reasonable change, and
introduces a bug - because the section carried an invariant that nothing at the
section stated.

Every multi-label `case` group, every parallel handler family, every table
keyed by opcode is a **membership assertion**: joining the group claims you
satisfy whatever the group's body assumes. That claim is usually invisible.

Three defects here came from exactly that, and in all three the edit looked
right:

| section | the unstated assertion | what an editor did |
| --- | --- | --- |
| `resolveNames`, the `table.size` arm | "every member is a LEAF - no sub-expressions to walk" | added `table.get`, which carries an index (T13.11) |
| `instrInputCount`, the `return 1` group | "every member pops exactly one operand" | added `data.drop`, which pops none (T13.16) |
| the memarg handler family | "every handler resolves memidx, checks align, checks offset, AND passes `is64`" | wrote handlers honouring three of the four (T9.6, T9.11, T13.15) |

Nobody was careless. `table.get` and `table.size` are adjacent in the spec and
both take a table immediate; `data.drop` sits among a dozen genuinely
one-operand instructions. **The grouping is on an axis the surrounding names do
not mention**, so reading the neighbours - which is what an editor does - gives
the wrong answer.

So, at the head of any section whose membership carries an invariant, write:

1. **What joining this group asserts**, in the group's own terms (arity,
   leaf-ness, which four things a handler owes) - not what the section is
   "for".
2. **What breaks if it is wrong**, in both directions where both exist. Too
   high and too low fail differently in `instrInputCount`, and only one of them
   is visible in the emitted bytes.
3. **Where the gate is**, so the editor knows what will catch them - and knows
   there is nothing to catch them if no gate is named.

Cost is five lines at a site that gets edited rarely and read every time it is
edited. Compare that with the three rows above, each of which was a multi-round
trip: found, diagnosed, fixed, regression-tested, and written up.

**A section comment that explains WHAT the code does is close to worthless** -
the code says that already, and it goes stale. Notate the constraint the code
cannot express: the reason a wrong edit here is not caught by the type checker.

## An example that satisfies its own matcher is data, not documentation

Documentation that lives INSIDE the corpus a tool scans becomes input to that
tool. An illustrative value written to explain a command is indistinguishable,
to the command, from a real one.

The ledger's "how to pick the next id" block is the instance, and it took three
drafts to get right:

1. The instructions carried an example id. Running the documented command
   returned that example as the highest id in use.
2. The fix added a sentence warning about the first literal - and that sentence
   contained a literal of its own, which the command then returned instead.
3. Only the third draft, using a `<next>` placeholder throughout and describing
   the trap without instancing it, returns the true answer.

Nothing about this is specific to ids. The same shape applies to a fixture
directory a test walks, a rule file a linter reads, an allowlist a scanner
consumes, a `.wast` snippet inside a doc that a corpus runner globs, or a
sample config a loader picks up. **If the doc and the data share a namespace,
the doc is data.**

Two habits:

- **Write placeholders, never well-formed values**, in any documentation the
  tool can see. `<next>`, `$NAME`, `0xNN` - anything the matcher rejects.
- **Run the documented command against the documentation.** It is one line and
  it is the only check that catches this; reading the passage cannot, because
  the passage reads correctly. This is the same discipline as inverting a new
  guard before trusting it, applied to prose.

The paragraph in `tasks.md` now says so in place, and the check is named there
as its own test.

## An INTENT block goes on any section with a membership invariant

The convention that came out of the notation work, stated so it can be applied
uniformly rather than re-derived per site. A section qualifies if joining it
asserts something the type checker cannot verify - a multi-label `case` group, a
family of parallel handlers, an opcode-keyed table, a `default:` arm with an
entry condition.

The block states three things, in this order:

1. **What joining asserts**, in the group's own terms - "pops exactly N
   operands", "is a LEAF", "owes these four checks". Not what the section is
   for; an editor can see that.
2. **What breaks if it is wrong**, in each direction where the directions differ.
   `instrInputCount` fails asymmetrically: too high deletes an instruction and
   the module still runs, too low corrupts the IR tree while the bytes come out
   right. An editor who knows only one of those will check only for that one.
3. **Which gate catches it** - by test file name - or, explicitly, that none
   does. "Nothing will catch this" is the most useful sentence in the block.

Live examples: `instrInputCount` and `resolveExpr` in the parser and IR, and the
memarg handler family in `shared-validator.ts`. Each of the three has already
been joined wrongly by an edit that looked locally reasonable, which is the
whole argument - the editor was in the right file, in the right function, and
had no way to see the constraint.

## Read a partial switch's `default` before its case count

A switch that handles 13 of 87 kinds is not thereby a bug, and one that handles
57 is not thereby safe. What decides it is where the unhandled kinds land.

Enumerated across `src/` in T13.21, every partial switch over expression kinds
falls into one of two groups:

| default | sites | consequence of a gap |
| --- | --- | --- |
| **rejects or throws** | `isConstExpr` (`return false`), the binaryen bridge (`throw`) | a missing kind is refused, loudly. Cannot be silently wrong. |
| **returns something plausible** | `applyNames` (`return e`), `writeInstrHead` (fall back to a full render) | a missing kind is processed WRONGLY and nothing says so |

Both bugs found that round were in the second group and neither was reachable
from any metric. `isConstExpr` covers 13 kinds and is completely safe, because
anything not on its allowlist is rejected on sight - the doc comment says so
explicitly, which is why nobody has ever had to re-derive it.

So when auditing: **find the `default`, ask what a kind landing there
experiences, and only then look at coverage.** A short allowlist with a
rejecting default needs no further thought. A long list with a benign default
deserves the full enumeration however complete it looks.

And when WRITING one: if the set is closed and you can reject, reject - it
converts every future omission from a silent defect into a loud one for free.
That is the same trade as fail-loud `writeVar`, applied to control flow.

## Scope the SHAPE, not the instance

Finding a bug is the beginning of the work, not the end of it. T13.20 was one
pass (`applyNames`) walking 37 of 87 expression kinds. The instance took an
afternoon; asking *"where else does something walk expression kinds?"* took ten
minutes, covered all 24 `switch (x.kind)` sites in `src/`, and turned up T13.21
- a coupling between two writer switches whose failure mode is a duplicated
operand that still reparses.

The scoping pass is cheap because the shape is already known. It also produces
the thing a bug report cannot: **a map of where the shape does and does not
appear**, including the sites that are fine and WHY they are fine. That map is
in `tasks.md` under T13.21 and it is what makes the next audit of this shape
five minutes instead of an afternoon.

Two rules:

- **After fixing, enumerate the shape across the codebase before closing.** Not
  "are there other bugs" - specifically "where else does this exact structure
  occur".
- **Record the clean sites with their reason.** "The bridge is fine because its
  default throws" is what stops the next person re-checking it, and it is also
  the sentence that goes stale loudly if someone ever changes that default.

## A probe that cannot separate the hypothesis from its negation proves nothing

Reviewing a report that our bridge had an off-by-one, the first check ran the
module both ways and got the same answer, 111 and 111. That reads as "no
difference, report refuted". It was a bad probe, and the report was correct.

Patching the disputed byte directly shows why:

    depth 0 -> 222        depth 1 -> 111        depth 2 -> 111

The two candidate depths were 1 and 2, and they are INDISTINGUISHABLE in that
shape - depth 2 lands on the function body, which happens to yield the same
value. The fixture separated depth 0 from the rest, which was never in question.

**Before trusting a probe's negative result, show that it can produce a positive
one.** Feed it the wrong answer deliberately and check it says so. That is the
same discipline as inverting a new guard test, applied to an investigation
rather than to a suite - and it matters more here, because an investigation's
output is a claim to somebody else rather than a red bar.

What settled it was comparing BYTES against a known-correct reference encoder,
one difference in one field, rather than comparing behaviour. **When a
disagreement is about an encoding, compare encodings.** Behaviour is downstream
of the thing in dispute and can mask it; the artifact cannot.

## Answer an upstream question in the terms it was asked

binaryen-ts framed their breaking change as a fork: *if your bridge compensates
for our old off-by-one, remove the shift; if it was already spec-correct, you
were being mis-encoded.* That framing is a gift - it names the evidence that
decides it, so the reply is a measurement rather than an opinion.

Three things made the answer usable to them:

- **Pick the branch explicitly** ("it is the first branch"), rather than
  describing findings and leaving them to infer it.
- **Correct the framing where it is too narrow.** Ours was not a deliberate
  shift they could tell us to delete; it was a scope bug that happens to
  cancel. That distinction changes what they should expect from our fix, so it
  belongs in the reply even though it was not asked.
- **Say plainly what you could not verify.** Two of their four notes had no
  record on our side or depended on their own passes. Confirming those to be
  agreeable would have been worse than useless - it is how the `KNOWN_INVALID`
  claim went upstream wrong. "We cannot confirm this, here is what we checked"
  is a complete answer.

And when a dependency's fix is unpublished, **the coupled change is the unit of
work**: record the fix, do not apply it, and name the trigger. Applying half of
a cancelling pair is worse than applying neither.

## A caret range plus a lockfile is not a pin

It is a pin *until someone reloads*. `deno.lock` held binaryen-ts at 1.0.9 while
`deno.json` asked `^1.0.9` and the registry already carried 1.4.3 - so the only
thing keeping us on the version our bridge is bug-compatible with was a file
that routine commands regenerate. `deno cache --reload`, a fresh clone with a
stale lock, a CI cache miss: any of them floats the dependency with **no version
change of ours, no commit, and nothing to review**.

That was survivable only by luck of timing: every released version still had the
old behaviour, so a float landed somewhere harmless. The next release makes the
same float silently wrong.

**Distinguish the two reasons a version constraint exists.** Most ranges express
COMPATIBILITY - "anything from here up should work" - and a lockfile is the
right place to make that concrete. A few express CORRECTNESS - "our code is
bug-compatible with exactly this" - and those belong in the SPECIFIER, where a
reload cannot move them and a reader can see the intent. Ours was the second
kind written as the first.

The tell that you have one: ask what a `--reload` would do. If the answer is
"nothing, the lock holds", ask again with the next upstream release imagined as
already published. If the answer changes, pin exactly and say why in the file
someone will open before bumping it.

## The upstream fix can be necessary without being sufficient

binaryen-ts confirmed a multi-value writer bug and its repro reproduces here
exactly - but not through the path they expected. Our own bridge raises
*"multi-value blocks (func_type BlockType) not yet supported"* BEFORE their
encoder is reached, so their fix alone changes nothing for us; lifting our own
restriction is the second half.

Worth checking on any accepted upstream report, because it changes what you tell
them and when you can act: **is our own layer clean on the path to the defect?**
A fail-loud guard of ours in front of their bug means the shape is unreachable
from here, so their fix unblocks nothing until we also move - and saying so is
more useful to them than "confirmed".

The inverse case is the one to watch for: if our layer is SILENT rather than
fail-loud on that path, their fix may start surfacing shapes we have never
exercised. Same question, opposite conclusion.

## A comment answers the question that was asked; ask the other one

The bridge's `if` case rejects a LABELED `if`, with a comment explaining that
binaryen-ts's `makeIf` has no label slot. It reads as thorough - somebody
clearly thought about `if` and about labels. What it does not say, and what
nobody asked, is what happens to an UNLABELED one: it is still a branch target,
it still occupies a depth, and the case pushed no frame for it. Every `br`
inside an `if` was off by one for as long as the bridge has existed (T13.24).

This is the code-comment form of *"a closed audit item is a claim about the
question you asked"*, and it is more dangerous, because a comment reads as
coverage in a way a ledger entry does not. **A thoughtful comment about one case
is the strongest available evidence that the neighbouring case was never
considered** - the author was demonstrably in the right place, thinking about
the right topic, and stopped at the boundary of the question they had.

So when auditing, treat an explanatory comment as a prompt rather than an
answer: name the case it covers, then name the complement and go looking.
Labeled/unlabeled, present/absent, zero/non-zero, the abstract form and the
indexed form. In this log the complement has been live three times - T9.11's
`is64` beside a certified `offset`, T13.16's `data.drop` beside genuinely
one-operand siblings, and this.

## Verify the restore, do not trust it

Sensitivity measurement means reverting a fix, re-running, and putting the file
back. The putting-back is the step nobody checks, and on this checkout it
silently rewrote a file: `git stash push` and `git checkout --` both re-run the
EOL filter, so with `core.autocrlf=true` a round trip turned
`binaryen-bridge.ts` from LF into CRLF. `git diff --stat` went from a surgical
47/10 to **1649 insertions / 1612 deletions** - three real edits buried in a
whole-file diff, which is unreviewable and would have been committed.

Two habits, and the second one generalises past line endings:

- **Use a byte-level copy aside and back** for revert experiments here, not a
  git operation. Git operations apply filters; `cp` does not.
- **Run `git diff --stat` after any experiment that touched the working tree.**
  One line. It catches EOL churn, a half-applied restore, a stray edit in a file
  you thought you had reverted, and a `finally` block you left instrumented.

The general point is that an experiment has a teardown, and the teardown is
unverified by construction - the test you just ran passed against the MODIFIED
tree, so nothing you ran afterwards proves the tree came back.

## Your tooling has a silent failure mode too - gate it

Every enumeration in this project's audit definition is grep- or regex-driven
over the source. A single NUL byte written into `binaryen-bridge.ts` made grep
classify the file as BINARY, so it printed

    Binary file src/bridge/binaryen-bridge.ts matches

*instead of* the match lines - and an alignment-duplication sweep that should
have covered that file **reported clean** (T13.25). Type-check, lint, fmt and
377 tests were all green throughout, because a NUL is legal in a TS string
literal.

That is this project's own worst-case shape - a silent fall-through - sitting in
the tooling rather than the code, and it invalidates results rather than
producing wrong output. Nothing about a green gate can catch it.

Two things follow:

- **Gate the properties your METHOD depends on**, not only the ones your product
  depends on. `tests/audit/source_hygiene.test.ts` costs 300ms and defends every
  grep-driven audit here. If a sweep's validity rests on an assumption
  (greppable source, a complete file list, a parseable table), that assumption
  is testable and should be tested.
- **A tool saying something unexpected is a finding, not noise.** "Binary file
  … matches" where match lines were expected is the entire tell. The instinct to
  skim past an odd-looking line from a tool - rather than from the code - is
  what would have left this live.

The generalisation: an enumeration reports on the population it actually saw,
never the one you meant. **Pin the population.** Every source-enumeration gate
here now asserts a floor on what it scanned (`scanned > 100`, `instrs.size >
80`, `withOperands.size >= 5`) precisely so a walk that silently found nothing
fails instead of passing.

## Probe the OPERATION's boundaries, not the domain's

`readMemArg` computed alignment as `1 << alignLog2`. JS shift operands are taken
mod 32, so exponent 32 wrapped to align 1 and 33 to align 2 - small, plausible
values that the validator accepted on modules V8 and Wasmtime both reject
(T13.26).

What makes this worth a rule is where the bug lived. Anyone probing alignment
reasons in ALIGNMENTS: 1, 2, 4, 8, 16, then "try something huge". Every one of
those gives the right answer:

    exponent 2      valid          accepted    correct
    exponent 4, 5   too large      rejected    correct
    exponent 31, 63 wrap NEGATIVE  rejected    correct, by accident
    exponent 32, 33 wrap SMALL     accepted    WRONG

The live range is 32..62, and nothing about alignment points there. It is a
property of `<<`, not of memargs. The "something huge" spot check - the one a
careful reviewer actually performs - lands on 63 and passes for the wrong
reason.

So: **when a value is derived through a bit operation, a cast, or a fixed-width
container, enumerate that mechanism's boundaries as well as the domain's.**
Shift widths (31/32/33), `| 0` and `>>> 0` wraps at 2^31 and 2^32, `Number`
precision at 2^53, byte and LEB field widths. Those numbers belong in the
fixture table next to the domain-meaningful ones, and they are the ones that
find things.

Corollary, and it is the sharper half: **a spot check that passes for the wrong
reason is worse than no spot check**, because it is recorded as coverage.
Exponent 63 was almost certainly tried at some point and behaved correctly. When
a boundary case passes, confirm it passes for the reason you think - here, by
printing the decoded value rather than only the accept/reject verdict.

## Read a decode next to its encode

The memarg bug was found by putting `readMemArg` and `writeMemArg` side by side
during the first real audit pass over `binary-reader.ts` - 3059 lines, the
largest surface in this project that had never been enumerated. The two agree on
the flag-bit protocol exactly; the defect was one line further on, in how the
decoded exponent became a number.

**Encode/decode pairs are a cheap, high-yield axis** and they are easy to skip
because each half looks fine alone. Read them together and ask, field by field:
does the decode invert the encode, for every value the encode can produce AND
every value the wire format allows? The second half is where this one was - the
writer can never emit exponent 32, but the format permits it, and a decoder
answers to the format rather than to its sibling.

## Scope a hygiene gate to what the WORKFLOW reads, not what the compiler reads

T13.25 gated `src/` and `tests/` against control bytes, because those are the
files that compile. Three days of edits later, five control bytes had
accumulated in `cmem/` - unscoped - and two memory files were BINARY to grep
(T13.28). Searching project memory is itself a grep, and `cmem/` is the
most-grepped directory here.

One of the corrupted bytes was a `\b` collapsed to a backspace **inside the
documented command for picking the next tranche id**, so the instruction the
ledger gives for its most routine bookkeeping step matched nothing. Another sat
in the prose explaining the NUL-byte hazard, a few lines from the rule telling
people not to write NULs.

The boundary was drawn around the wrong thing. A gate that exists to keep a
METHOD working belongs around every file that method touches: source, tests,
memory, README, config, fixture directories. Ask what the workflow greps, and
scope to that.

Two related habits:

- **When a gate finds a bug, ask what else has the property the gate checks** -
  before writing the gate, not after. The `cmem/` bytes were already there when
  T13.25 was written; a moment's thought about "where else could a control byte
  hide" would have caught them a session earlier.
- **Tool-quoting is the hazard, not the content.** Every one of these was a
  two-character escape (`\b`, `\0`) collapsed by a shell heredoc while writing
  files through one-liners. The same class mangled a regex three times in T13.19
  and produced the original sentinel NUL in T13.24. Where the text contains
  backslash escapes, write it through a file rather than through a shell string,
  and let the gate catch what slips.

## A stale rationale is worse than no rationale

`design-decisions.md` recorded a performance invariant - `ModuleContext`
precomputes two index maps "because `getExprArity` runs for every expression
during validator and writer walks". **`getExprArity` has no production caller.**
Nor do the two methods the maps exist to accelerate. Only the WAT writer extends
the class, and it calls none of them.

Nothing is broken; the maps are cheap and the code is published API that cannot
simply be deleted. What is broken is the RECORD, and it is broken in the
expensive direction: it tells a future reader that a cold path is hot. That
reader will defend it in review, refuse to simplify it, and cite the invariant
while doing so - the file's authority working against the codebase.

**When recording a performance decision, record the measurement or the caller
that motivated it, not a plausible story about why it matters.** "Precomputed
because X calls it per-expression" is checkable and ages loudly - one grep for
X. "Precomputed for speed" is unfalsifiable and ages silently. And when an audit
finds the cited caller gone, **correct the entry in place rather than deleting
it**: the correction is the useful artifact, because it tells the next person
the claim was tested.

## Fuzz the published surface — it needs no oracle

Every axis in this file until now has been an enumeration: types against
walkers, tables against consumers, decodes against encodes. T13.29 came from
something cheaper. Take one module exercising every section kind, feed each tool
every truncation of it and every single-byte corruption to 0x00 / 0x7f / 0xff,
and assert only that nothing throws. 585 inputs, four tools, about fifteen lines
of harness.

All four published binary tools crashed on roughly 102 inputs each.

**The reason this works with no oracle is the property being tested.** "Does not
throw" is decidable without knowing the right answer, so there is nothing to
compare against, no corpus to be missing from, and no fixture to maintain. Most
of the hard work in testing this project is establishing what SHOULD happen;
here that question does not arise.

Make it a standing axis: **any entrypoint that accepts bytes from outside gets
the truncate-and-corrupt sweep.** Two guards keep it honest — assert that a
malformed input is still REPORTED (otherwise "never throws" is satisfied by
swallowing everything), and that a valid input still succeeds.

## Fix the contract at the boundary, not at the source

Every one of T13.29's crashes came from `core/leb128.ts`, whose `decode*Leb128`
throws a `RangeError` on a truncated encoding. The tempting fix is to stop it
throwing.

That would have been wrong. `leb128.ts` is a pure decoder and its other callers
— the WAT parser, the bridge — want the throw; softening it there trades one
loud bug for silent ones in three subsystems. The defect was never the throw,
it was that nothing CONVERTED it where the contract changes: the binary reader
promises `{ errors, result }` and sits between the two.

So the general question when an exception escapes an API: **where does the
contract change, and is anything standing there?** Not "who threw". The throw is
usually correct in its own context, and moving the fix to its origin damages
every other caller.

Two details worth copying:

- **The conversion parks the cursor at end-of-input**, so a caller that ignores
  the error flag cannot spin on the same malformed bytes. Converting a throw
  into a value means inventing a resumption state; pick one that terminates.
- **A backstop at the public entry is not redundant.** The four LEB helpers
  handle the known cases; `readBinaryIr` also wraps the whole decode, because
  one unconverted throw anywhere in 3000 lines reproduces the entire bug, and a
  four-entrypoint contract should not depend on having found them all.

## An API should fail in ONE shape, and its docs should name every method that fails

`/compat` has three failure paths. Two were documented as throwing and surfaced
`new Error(formatErrors(errors))`. The third documented no failure at all and
propagated the binary writer's raw internal string (T13.30). So the same API
threw two different shapes, and the method that surprised a caller was precisely
the one whose contract did not mention failing.

The asymmetry is the tell, and it is the same one that has produced defect after
defect here at the level of code: **look along the family, not at the method.**
Three siblings, two documented, one not — that third one is where to look, in
docs exactly as in handler tables.

Two rules for an error boundary:

- **One shape.** A caller writes one `catch`. If some failures arrive as
  `Error(formatErrors(...))` and others as a deeper layer's string, the caller
  cannot tell what it is holding, and the useful ones get logged identically to
  the useless ones.
- **Every error names its origin.** `binary writer: no (type (func (param )))`
  is a fine message and a terrible top-level one — it tells you what broke and
  not which call you made. Prefixing with the method (`toBinary: the module
  could not be encoded: …`) costs one line and turns a mystery into a bug
  report. The regression test asserts exactly this property over the whole fuzz
  population rather than any specific message.

And on the docs: **if a method can fail, its doc comment says so, even when the
failure is rare or "obviously" internal.** `toBinary` failing on a module the
same API had just handed back is not a caller error and not an internal
invariant — it is a real path, because decoding does not check what encoding
requires.

## Fix the shape, not the instance — the version for entrypoints

T13.29 fixed four byte-consuming CLI tools. The instance was done; the SHAPE was
"every published entrypoint that accepts outside input", and two more existed:
`wat2wasm` (text) and `/compat`. Asking that question directly, rather than
waiting for the next fuzz run to wander into them, produced T13.30 the same day —
and cleared `wat2wasm` as a recorded negative result (2505 malformed-text inputs,
never threw).

The enumeration is trivial and worth writing down once: **list the exported
functions that take a `Uint8Array` or a `string` from the caller.** For this
project that is `wat2wasm`, `wasm2wat`, `wasmValidate`, `wasmObjdump`,
`wasmStrip`, and `/compat`'s `parseWat` / `readWasm` plus the `WasmModule`
methods reachable from them. Six of the eight had never been fuzzed; two of those
six were broken.

## Scope a test's PERMISSIONS deliberately — the low-privilege half is the one that runs

`deno task test` is `deno test --allow-read`. A test that spawns the real CLIs
needs `run` and `write`, so T13.31's behavioural checks could never execute in
the normal gate. Three options, and only one is right:

- **Broaden the suite to `-A`.** One file gains what it needs; every other test
  gains permissions it does not. The sandbox stops meaning anything.
- **Let the test skip.** It runs under `-A` and nowhere else — so in CI, which
  runs `deno task test`, it never runs at all. **A test that always skips
  protects nothing** and is worse than absent, because the file's existence
  reads as coverage.
- **Split it by privilege.** Ask which half of the property can be checked at
  the lowest privilege, and make that half always-on.

For T13.31 the split was: a SOURCE gate (`--allow-read`) asserting no
`import.meta.main` block calls `Deno.readFile` / `writeFile` / `writeTextFile`
directly, plus the subprocess checks `ignore`d when permission is absent. The
source gate is not the more convincing test — it never proves the message is
right — but it guards the exact site where a regression is reintroduced, and it
runs every day. The behavioural half proved the fix once and will catch a helper
that stops working, whenever someone runs with `-A`.

Two details:

- **Skip LOUDLY.** `describe(..., { ignore: !canRun }, ...)` makes Deno print
  `ignored`, so the gate output says the check did not run. A silent `return`
  inside the test body looks identical to a pass.
- **Pin the source gate's population.** It asserts it reached every tool
  (`scanned === TOOLS.length`) and that each tool DEFINES the helper — otherwise
  a tool that does no I/O at all would satisfy "no unguarded I/O" vacuously.

## The frontier list is a claim, and a missing row looks like a swept one

`cmem/testing.md` keeps a running list of what has NOT been enumerated, so an
audit does not restart on ground already covered. T13.31 found that the list
**never mentioned the CLI shims** — a whole class of published entrypoint, five
files, absent. Not marked pending, not marked done: absent.

That is the failure mode of any such list, and it is asymmetric. A row saying
"not yet examined" is honest and gets picked up. **A missing row is
indistinguishable from a swept one**, and an audit working from the list will
never reach it — the list actively steers attention away.

So when maintaining a frontier record:

- **Derive the population, do not recall it.** For entrypoints that is one
  command: list the exported functions and the `import.meta.main` blocks. For
  files it is a glob. Anything reconstructed from memory inherits memory's gaps.
- **Add the row before auditing it**, so the list is complete even if the pass
  runs out of time. T13.31 added and struck the CLI row in the same session,
  which is fine — what matters is that the row existed before the work did.
- Treat "the list is complete" as **itself an unaudited claim** until someone
  regenerates the population and diffs it.

## Gate the correspondence even when today's answer is "no bug"

The lexer enumeration (T13.32) found nothing wrong: two `TokenType` members are
never emitted, and both were deliberate and already explained in place. The
obvious conclusion is "clean, move on". The gate got written anyway, for a
reason that has nothing to do with the two dead members:

**A member stops being emitted when its `KEYWORDS` entry is deleted or
mistyped, and that is not a compile error.** A `const enum` member with no
remaining reference produces no diagnostic. The symptom is valid WAT quietly
failing to parse, with the error surfacing somewhere unrelated to the keyword
that went missing.

So the question when an enumeration comes back clean is not "was there a bug"
but **"what would it look like if this correspondence broke tomorrow, and would
anything say so?"** Where the answer is "nothing would", the enumeration you
just ran by hand is worth ten lines as a test — you have already written the
hard part.

This is why several gates here exist with no bug behind them:
`opcode_tables.test.ts` (T13.6), `instr_arity.test.ts`'s totality half (T13.18),
`const_expr_head_coupling.test.ts` (T13.21, the two switches had not drifted),
and this one. Each pins a hand-maintained correspondence that the compiler
cannot see.

**A hand-maintained correspondence is the unit worth gating**, not a bug. Two
tables that must agree, an enum and the code that populates it, a list and its
consumers — those decay silently, and every one of them can be checked from the
source in a few lines.

## An empty frontier means the cheap axes are spent, not that the code is clean

`cmem/testing.md`'s "what has NOT been enumerated" list reached empty on
2026-08-25. That is a real milestone and a dangerous sentence, because the
obvious misreading — "everything has been audited, the code is clean" — is not
what it says.

What it says is narrower and more useful: **every surface has had SOME axis run
against it, and the axes that were cheap are used up.** The evidence is in the
yield curve, which is public in the log: the last several passes returned
progressively less, and two of them (T13.27, T13.32) found nothing at all.

Two honest options when the frontier empties, and it is worth naming which one
you are taking:

- **Invent a new axis.** The fuzz axis was the last new one and it paid three
  times in three sessions (T13.29, T13.30, T13.31) across surfaces that six
  conformance metrics and 380 tests never touched. New axes beat re-running
  spent ones.
- **Accept a lower yield and say so.** A pass that finds nothing is a result,
  provided it records what it varied — but do not dress it as thoroughness if
  the honest description is "the same enumerations, again".

Write the reading into the list itself. A future reader arriving at an empty
frontier with no note will draw the wrong conclusion, and the list will have
caused it.

## "We fuzzed it" is a claim about ONE property — ask a different question, not for more inputs

T13.29 fed the published tools 585 truncated and corrupted modules and asserted
*does it throw?* It found four broken entrypoints, and the axis was cheap
precisely because that property needs no oracle. Then it was clean, and the
surface was treated as covered.

T13.33 used the SAME KIND OF INPUT and asked *does it NOTICE?* — and found a
module that decodes, returns a `Module`, reports success, and is malformed. A
type section declaring 4 294 967 295 entries with none present decoded to zero
types and validated clean. No throw, so the fuzz axis was blind to it by
construction.

**When a robustness sweep comes back clean, the productive move is a different
QUESTION over the same corpus, not more inputs.** The questions are separable,
and each is its own axis:

| question | needs an oracle? | what it catches |
| --- | --- | --- |
| does it **survive**? | no | crashes, uncaught throws |
| does it **terminate**? | no | hangs, unbounded loops |
| does it stay **linear**? | no | algorithmic-complexity DoS |
| does it **notice**? | **yes** | silent acceptance of malformed input |
| does it **report accurately**? | yes | wrong or misleading diagnostics |

The first three are nearly free and should be standing. The last two cost an
oracle, which is why they get skipped — and why they are where the interesting
defects survive. Three cheap axes came back clean here in the same session that
the expensive one found a real bug.

The trap to name: **a clean fuzz run reads like "this surface is robust"** when
it means "this surface does not crash on these inputs". Record which property
was actually asserted, or the next person will not know which question is still
open.

## Hardening is a lens, not a task

The request was "look for hardening opportunities", which sounds like polish —
add a bounds check here, a guard there. What it actually produced was a
correctness bug that eight sessions of bug-hunting had missed, because the lens
changes which questions get asked.

Bug-hunting asks *what is wrong with this code?* and is steered by where defects
have been found before — which is why a recurrence table works, and why its
yield decays. Hardening asks *what would an adversary or an accident do to
this?* and is steered by the input space instead: enormous counts, deep nesting,
pathological sizes, resource limits. Different steering, different reachable
set.

Both are worth running. Reach for hardening specifically when the frontier list
empties and the enumeration axes stop paying.

**CORRECTED 2026-08-25 (T13.36).** This paragraph originally claimed
*"hardening does not decay the way bug-hunting does, because the input space is
not exhausted by finding a bug in it"* — written after ONE successful pass, and
too strong. Four passes in, the record is 1 finding, 2 findings, 0, 0: the same
curve enumeration showed. The input space is indeed not exhausted, but **the
CHEAP hardening axes are consumed at the same rate as the cheap enumeration
axes**, because what gets used up is not the inputs, it is the supply of
properties that can be checked without an oracle (hangs, allocation, growth
factors). What remains on this lens is the expensive row — diagnostic quality —
which needs a real oracle.

The correction is left in place rather than the claim quietly rewritten: an
over-confident generalisation from one data point is a normal failure, and the
useful record is that it was tested and revised.

**REVISED AGAIN 2026-08-25 (T13.37), one pass later.** The fifth pass ran the
one axis the correction named as remaining — diagnostic quality — and found **2**.
The curve is 1, 2, 0, 0, 2. So the correction was right about the mechanism and
wrong to leave "expensive" hanging as a reason to stop: the oracle that axis
needed was already in the repo, unread. **Two empty passes in a row are evidence
the axis LIST is stale, not that the code is clean** — the cheap axes being
spent is a prompt to go find a new oracle, and the first place to look is what
the corpora you already parse are telling you and you are throwing away.

## Disbelieve the comment you just wrote

While fixing the subtyping-depth limit (T13.34) I wrote a cycle guard and
documented it:

> `state` marks a node as in-progress, and meeting an in-progress node returns 0
> and **lets the ordinary subtype checks report the cycle**.

Nothing reported the cycle. Supertype cycles validated clean, and both engines
reject them. The sentence was plausible, written seconds after reading the
surrounding code, and false — and it would have been believed by the next
reader, because it reads exactly like a fact someone checked.

**A comment asserting that some OTHER code handles a case is a claim, and it is
the easiest kind to get wrong**, because writing it feels like documenting
rather than asserting. You are describing code you are not currently looking at,
from a mental model built minutes ago, at the moment your attention is on
something else.

The fix is mechanical: **when a comment says "X is handled elsewhere", go and
watch X fail.** One probe. Here the probe already existed — the same run that
produced the depth finding had a cycle case in it, and the result line said
`ACCEPT(!)` next to the sentence claiming otherwise.

This is T13.24's rule ("a thoughtful comment about one case is evidence the
neighbouring case was never tested") turned inward. The version worth
remembering: **your own fresh comment is not evidence. It is a hypothesis you
happen to believe.**

## Ask whether a rejection is a SPEC limit or an engine limit — the answer changes what you do

V8 rejected a 500-deep subtyping chain that we accepted. That could be either
of two very different things:

- a **spec limit** we are missing, in which case we have a false accept and must
  fix it;
- an **engine implementation limit**, in which case V8 is stricter than the spec
  and we are correct to accept — exactly the situation with the 2^48-page
  `memory i64` already in the log, which **Wasmtime accepts and V8 does not**,
  and which the metrics table records as a known non-defect.

The two look identical from V8 alone. Asking Wasmtime settled it in one command:
Wasmtime rejects too, at the same boundary, so it is a spec limit and ours was a
real gap.

That is what the three-engine oracle rule is FOR, and it is worth restating
because the single-engine version of this investigation reaches the wrong
conclusion in both directions — either shipping a false accept, or "fixing"
something by adding a limit the spec does not have and rejecting valid modules.

**Find the exact boundary as well as the verdict.** 64 types accepted, 65
rejected, on both engines. A limit adopted without its boundary is an off-by-one
waiting to happen, and here the off-by-one direction rejects VALID modules.

## A probe that produces findings is not thereby a good probe

The diagnostic-accuracy probe (T13.35) corrupted one byte at a time and checked
that the reported error offset landed at or shortly after the corruption. Across
317 errors it flagged 32 as suspicious. That looks like a result.

**Every flagged case examined was correct behaviour.** A `LEB128 u32 overflow`
for a corruption at byte 13 reported offset 9 — and 9 is where that LEB starts.
Reporting the beginning of the malformed construct is BETTER than reporting
where the decoder gave up, and the oracle's rule ("the offset must not precede
the corruption") is false for every multi-byte construct in the format.

Had those 32 been reported as defects, the "fix" would have made diagnostics
WORSE — pointing at a corrupted byte instead of the construct containing it.

This is the T13.22 non-discriminating-probe lesson turned around. There the
probe could not tell the hypothesis from its negation. Here it discriminated
perfectly — it was measuring the wrong property. Both produce confident wrong
answers, and the second is more dangerous because it produces a LIST, and a list
looks like work.

**Before believing a probe's findings, read three of them by hand.** Not to
confirm they are real — to check the oracle encodes the property you meant. Ten
seconds each, and it is the only step that catches a well-implemented
measurement of the wrong thing.

And when the oracle turns out not to hold: **record the axis as UNMEASURED, not
as clean.** "We looked and it was fine" and "we looked with an instrument that
does not work" are different states, and only one of them means the next person
can skip it.

## Distinguish clean, unmeasured, and not-attempted

Three states get collapsed into "nothing found", and they imply different next
actions:

| state | meaning | what the next pass should do |
| --- | --- | --- |
| **clean** | measured with an oracle that holds; no defect | skip, unless the code changed |
| **unmeasured** | attempted; the instrument did not discriminate | needs a better oracle before it means anything |
| **not attempted** | never run | run it |

T13.35 produced one of each: size amplification and string scaling are CLEAN
(the oracles — hang, allocation, growth factor — are sound and need no external
truth), diagnostic accuracy is UNMEASURED, and diagnostic USEFULNESS beyond
offsets was never attempted.

The frontier list already distinguishes "not attempted" from "swept". It should
distinguish unmeasured too, or an honest failure gets filed as a success — and
the cost is that nobody ever returns to it, because the record says it was
covered.

## Check whether a corpus you already own carries an answer key you are discarding

Recording diagnostic accuracy as UNMEASURED (above) is what made this findable.
The rule said the axis needed a real oracle, so the next pass went looking for
one — and it had been in the repo for the whole campaign.

Every `assert_malformed` command in the spec testsuite carries **the error text
the module is supposed to produce**. Our metric parsed those commands, took the
module bytes, checked we rejected them, and threw the string away. It scored
711 / 711 and had done since the campaign closed.

**Counting rejections cannot tell rejecting for the right reason from rejecting
for the wrong one.** Reading the strings took 40 lines and found that **70 of
the 711 were rejected with wording the spec does not recognise** — including one
genuinely wrong diagnosis: a 4-byte file with a bad magic number was reported as
a file that ended unexpectedly, because the reader read the version field before
it compared the magic. We named a fault the user had not made.

The generalisation is cheap to apply and worth doing once per corpus:

- a testsuite with **expected error texts** grades your diagnostics;
- one with **expected VALUES** (`assert_return`) grades your semantics, not just
  your acceptance — that is how the execution metric came about;
- one with **expected byte counts, offsets, or section sizes** grades your
  encoder's fidelity beyond "the engine took it".

Ask of every corpus already wired up: **what fields am I parsing and then not
asserting on?** An unused field in a harness is a metric nobody has run.

## Conformance metrics measure acceptance; the ERROR PATH needs its own

Seven of the eight metrics answer some form of "do we agree about which modules
are good?". None of them looks at what we SAY about a bad one, and the T13.29–31
and T13.37 findings are all on that path: entrypoints that threw raw internal
strings, CLI shims that dumped a stack trace for a typo, a reader that
misidentified which fault it had found.

That is not a coincidence. **A metric built from a corpus of modules can only
grade the accept/reject decision**, because that is the only output it compares.
Everything downstream of the decision — the message, the offset, whether the
process exits or throws — is invisible to all of them, which is why those
findings kept arriving with every number green and unmoved.

The corollary for a release: **the error path carries the least-tested code in
the project**, and it is the code that runs precisely when a user is already
confused. Treat "what does this print when the input is wrong?" as a first-class
question about every published entrypoint, not as polish.

## A broken harness can score BETTER — check the instrument against a metric it should fail

The scratch harnesses omitted `synthesizeTypes`, so nearly every module they
built had dangling type indices and was rejected on sight (T13.39). On a metric
that counts rejections — `assert_invalid` — that reads as **success**. The
harness reported `2673 / 2678`, a plausible number, for a whole session.

The general shape: **a measurement defect that pushes a metric the way the
metric is scored is invisible.** It is the mirror of a false-accept-blind
metric, and it is worse, because the number goes UP.

Two cheap defences, both of which would have caught this on day one:

- **Give the harness an input it must FAIL on**, the way `engine-check`
  self-tests against a known-invalid module and refuses to report if an engine
  accepts it. A harness that cannot fail is not measuring.
- **Sanity-check the denominator against a second route.** Agreement read 449
  where round-trip's population was also 449 and the corpus runner — the one
  harness that called `wat2wasm` instead of rebuilding it — was unaffected.
  One instrument disagreeing with another about how many modules exist is the
  whole finding, available for free.

And the specific rule: **do not reassemble a pipeline inside a harness.** Call
the published entry point. Every stage a harness re-implements is a stage it can
get wrong, and it will get it wrong silently, because the harness has no tests.

## An allowlist entry is a claim — ask what the thing is FOR before excusing it

T13.32's token-reachability gate lists tokens the lexer emits and the parser
never consumes, with a comment explaining why that is fine (unimplemented wabt
script keywords). `Reserved` was on that list.

But `Reserved` is what the lexer emits for **a word it does not recognise** — a
misspelled instruction. The parser never consuming it is not an unimplemented
feature; it is precisely the defect T13.38 fixed. **The symptom sat inside a
passing test, labelled benign, for an entire tranche.**

The gate was not wrong to list it — the list is the right mechanism, and it did
force the entry to be justified. What failed is that the justification was
written once, for the group, and never re-examined per member. When you add an
entry to an allowlist, write down what that specific member IS, not just that it
is currently unused. "The lexer emits this for unrecognised words" and "the
parser ignores it" are, side by side, obviously a bug.

## A test can pin the WEAKER of two behaviours simply by being satisfied with it

`malformed_input.test.ts` contained a case named **"names the offending token
and where it is"** whose assertion was `/in function body/`. The message it was
testing was `unexpected ( in function body` — which names a parenthesis, not the
offending token. The test's name described the property that was wanted; its
assertion accepted a message that did not have it, and so it passed for as long
as the weaker behaviour lasted.

This is not the same as a vacuous test. It ran, it was sensitive to total
breakage, and it would have caught a regression to silence. It just could not
distinguish the behaviour it was named for from a nearby worse one.

**When a test's name states a property, assert the property.** Here that meant
`/i32\.addd/` — the operator text — rather than a substring of the surrounding
sentence. The re-write is usually one line, and the moment to do it is when you
are already looking at the test because something else changed.

## Classify a difference by its PROVENANCE before explaining it

The round-trip metric reported 83 differences and I explained them in one line —
*"almost all deliberately non-minimal LEB encodings that cannot round-trip by
construction"* — without opening one. The file tally in the same output said
`elem.wast:19`, which is not crafted bytes at all, and the explanation did not
survive contact with it: **22 of the 83 were our own encoder padding every
section size to 5 bytes** (T13.40).

The fix was to split the population by where the input came from:

| input source | meaning of a difference |
| --- | --- |
| the module was **text** | the input binary is OUR OWN output — a difference is our bug |
| the module was **binary** | the input is bytes someone crafted — a difference may be correct |

That single distinction took a 96%-looking number to **2119 / 2119, 100%** on the
half that measures us, and isolated the real defect in the other half. Before it,
the two were summed, so a genuine 3.2% size regression sat inside a number that
looked like a modest round-trip shortfall.

**Ask of any difference metric: for which inputs am I obliged to match?** If the answer
differs across the population, it is two metrics wearing one number, and the
mixture will hide whichever direction is smaller.

## Byte-identity against a non-canonical input can mean you SHARE its defect

When the section-size padding was fixed, `float_literals.wast` moved from
MATCHING to differing. That reads as a regression and is the reverse: that file's
input is itself padded, so our padded output had matched it **by coincidence —
two wrongs cancelling**. `binary_leb128_64.wast` moved the other way at the same
time, for the same reason.

A round-trip metric compares output against whatever the input happened to be. A
match is evidence of fidelity **only when the input is canonical**; against a
non-canonical input it may be telling you that you faithfully reproduce its
non-canonicality. So a round-trip score that moves DOWN after a correctness fix
is not automatically a regression — check which direction each moved case went,
and why.

The corollary is a nastier one: **a defect shared between the producer and the
consumer of a round trip is invisible to that round trip**, exactly as a
consistently-wrong opcode mapping is (already recorded). Padding was that shape —
reader and writer agreed, and only an input from OUTSIDE our own pipeline could
show it.

## Upstream has an option; check whether the port has its default

`canonicalize_lebs` is a `WriteBinaryOptions` field in upstream wabt, and its
default is **true**. wabt-ts ported the fixed-width branch and not the
canonicalising one — so the port silently shipped upstream's non-default
behaviour, with no option and no note saying so.

When porting a function that reads an option, port both branches or record which
one you chose and why. A dropped branch looks like a simplification and behaves
like a configuration change nobody made.

## An oracle can pass VACUOUSLY — check that the input exercises the behaviour

`wasm-strip` scored perfectly on the sharpest oracle available: *a module with
no custom section has nothing to strip, so strip must be the identity.* 272 /
272. Idempotent 272 / 272. Never grew a module. It read as a clean sweep.

It was a coverage illusion. `wat2wasm` emits no custom sections, so **every
input had nothing to strip** — the tool's actual job was never executed. Feeding
it modules that DID have custom sections found that `--sections` was wrong in
every single case (T13.41).

The identity test was not wrong, and it was worth having. What was missing is
the question that goes with it: **did the input make the code under test
actually do anything?** For a tool, that means checking the input has the
feature the tool operates on. Two cheap forms:

- assert the precondition — `expect(customSectionCount(input)).toBeGreaterThan(0)`
  before asserting the tool removed them;
- report the split, the way the T13.41 probe ended up doing: "272 modules, of
  which 272 had no custom section" is a sentence that answers itself.

This is the sibling of "print what a harness SKIPS". That rule catches inputs
dropped from the denominator; this one catches inputs that are counted, pass,
and exercise nothing.

## Read the option's DOC before believing your probe of it

The first `--sections` probe scored 0 / 265 because I had assumed the option
meant *keep these*; the documentation says *"Names of custom sections to
strip"*. Had I filed on that run, the "fix" would have inverted a correct
option and broken every existing caller.

The corrected oracle then also scored 0 / 265, and only then was it a finding.
Two probes agreeing is not what made it real — reading the contract is. **When a
probe says an option is completely broken, the first hypothesis is that you have
the option backwards**, because "wrong in 100% of cases" is far more often a
misread contract than a defect that survived release.

Related, from the same file: the implementation named its local `keep` and used
it as `!keep.has(...)`. The name said one thing and the code did the other, so
the doc was the only correct statement of intent in the file. Renamed with an
INTENT block — **when a name and its use disagree, an editor will trust the
name.**

## A defect shared by a producer and its consumer is invisible to their round trip

Already recorded for a consistently-wrong opcode mapping; T13.40 and T13.41 are
two more instances, and the pattern is worth stating as a class.

If the reader and the writer agree on something wrong, a round trip through them
returns the input unchanged and every fidelity metric reads 100%. Section-size
padding was that shape (T13.40). Custom-section relocation was nearly that shape
(T13.41) and escaped only because it changes ORDER, which a byte comparison can
see — but nothing in the corpus had a custom section to reorder.

The counter-measure is an input the pipeline **did not produce**:

- the spec testsuite's `(module binary …)` blobs — crafted by someone else,
  which is exactly what exposed the padding;
- a synthetic input built to have the feature under test, which is what exposed
  the relocation;
- another implementation's output.

**A corpus made of your own output cannot test your own output.** When a metric
over such a corpus reads 100%, that is the moment to ask where an independent
input could come from.

## A command written to see past a false alarm must be proven to still fire

`deno fmt --check src tests` reports ~104 files failing on line endings on this
checkout. That is git's `autocrlf`, it is documented, and the documented
workaround was a per-file diff with the endings stripped.

The workaround was wrong. `deno fmt --ext ts -` reads from stdin and **does not
read `deno.json`**, so it used deno's default lineWidth of 80 against a project
set to 100 — flagging every line of 81–100 characters, which is noise, and
missing a real 101-character line. Two files would have failed CI on push
(T13.42), on a branch where every other gate was green and re-run after every
edit.

**A standing false alarm is not free.** It costs whatever the workaround misses,
and nobody re-examines a workaround that has been in the docs for months.

The discipline is already recorded twice — invert a guard test before trusting
it; give a harness an input it must fail on. It applies to a diagnostic COMMAND
in the docs too:

- **break something on purpose and confirm the command still reports it.** For
  the corrected format check that was one re-joined import line and five
  seconds;
- **and check it clears the noise it was written for** — the corrected form was
  validated in both directions, 11 of 12 false alarms gone AND the real fault
  still caught. One direction alone proves nothing: a command that reports
  everything passes the first test, and one that reports nothing passes the
  second.

This is the second documented command in two days found not to work — the other
was the ledger-count `grep` in `publishing.md`, which returned 0. **Run the
command before you write it down, and again when you next rely on it.**

## Documentation of a SAFETY guard is a claim to verify, not a description to trust

Two files stated that `scripts/publish.ts` "refuses if the working tree is dirty
or the tag already exists." Neither guard existed. The script staged
`deno.json`, force-tagged, and pushed — and the tag is what JSR publishes, so on
a dirty tree it would have released a bare version bump containing none of the
work, permanently (T13.43).

The tell was in the same file: `cmem/publishing.md` line 130 described the real
behaviour ("commits `deno.json` if it is still dirty") and line 221 promised the
refusal. **A document that contradicts itself about a safety property is
evidence that nobody has run the path recently.**

The general rule: a sentence describing what a tool REFUSES to do is a test
case, not prose. Two minutes to check — put the tool in the state it claims to
reject and run it:

- for a release script, a dirty tree;
- for a validator, the thing it says it rejects;
- for a guard, the condition it guards against.

**Prefer to verify the negative claims first.** "It does X" fails visibly the
first time it does not. "It refuses to do X" fails silently until the day it
matters, and by then the damage is a published artifact, a deleted branch, or an
overwritten file.

## Code that acts at import time cannot be tested — extract the decision

`publish.ts` stages, tags and pushes at the top level, so importing it performs
a release. That is why a four-release-old script with a documented safety
contract had zero tests: not an oversight, a structural impossibility.

The fix is not "write a test for publish.ts" — it is to move the DECISION into a
pure function that a test can import, and leave the effects in the script.
`releaseBlockers(porcelain: string): string[]` takes the output of
`git status --porcelain` and returns what would be left out; the script runs git
and acts on the answer. Twelve test cases, no repository state, no network.

Look for this shape wherever a file has top-level side effects: a release
driver, a migration, a CLI entry point, anything under `if (import.meta.main)`
whose logic sits outside the guard. **If the only way to exercise a decision is
to perform its consequences, it will not be exercised.**

## Test the case where the guard must NOT fire

A guard is two claims: it blocks the bad state, and it permits the good one.
The second is the one that gets skipped, and it is the one that decides whether
the guard survives contact with a deadline — a guard that refuses a legitimate
release fails safe exactly once, and is then removed by whoever needs to ship.

For the release preflight that meant asserting an empty `git status --porcelain`
and a `deno.json`-only tree both come back with **no blockers**, alongside the
five blocking cases. Same shape as the sensitivity-inversion rule for regression
tests, pointed the other way: **invert a new guard to prove it fires, and feed
it the happy path to prove it does not.**

## A regression test for a guard must gate the CALL SITE, not just the logic

After adding the release preflight, the obvious test covered `releaseBlockers`:
twelve cases, clean tree, dirty tree, renames, precision. All good, and all
useless against the actual failure — **delete the guard block from
`publish.ts` and every one of those twelve still passes**, because the pure
function is untouched (T13.44).

That is precisely the shape of the defect they were written for. T13.43 was not
"the dirty-tree logic is wrong"; it was "the dirty-tree logic is absent." A test
of the logic cannot see that.

So for any guard, ask which of the two you have covered:

| covered | catches |
| --- | --- |
| the LOGIC (`f(bad) === blocked`) | someone breaking the rule |
| the WIRING (the caller calls `f`, before acting) | someone deleting or bypassing it |

The second is usually the one that actually happens, and it is usually the one
missing. When the caller cannot be executed in a test — a release driver, a
migration, an `import.meta.main` block — a **source-text** assertion is the only
thing that runs on every commit, and it is worth the bluntness.

Two properties make such a gate durable rather than decorative:

- **Classify by allowlist, not blocklist.** The wiring gate extracts every
  `['git', '<sub>']` call in source order and fails on anything before the guard
  that is not on a READ_ONLY list. A new subcommand is therefore mutating until
  someone says otherwise — the safe default, and it forces a decision at the
  moment the call is added.
- **Assert the effects still exist afterwards.** Without a check that `add`,
  `commit`, `tag` and `push` still appear AFTER the guard, the whole file passes
  vacuously on a script that no longer releases anything. Same trap as the strip
  identity test that passed on inputs with nothing to strip.

## A stale artifact read as a live signal — now seen in two projects independently

wabt-ts kept a frozen copy of wasmtk's build output and reported three
present-tense claims from it, all wrong, all caught by the recipient (T13.45).
Within the same period wasmtk's own `bundle_tests` reported **4/4 green while
the malformation was still in the file**, because it read a stale artifact
rather than the current one. Same shape, different projects, neither caused by
carelessness.

That independence is the reason to write it down as a class rather than an
incident: **a cached, vendored or generated input is indistinguishable from a
live one unless something records when it was taken.** The failure is silent by
construction — the stale copy answers every question confidently, and the
answers were true once.

Two counter-measures, both cheap:

- **Stamp the artifact where it lives**, with the source revision and the date,
  and gate the stamp so a refresh cannot silently skip it. The useful assertion
  is a derived quantity — a file count, a hash, a row count — because that is
  what changes when someone refreshes the data and forgets the metadata.
- **Never let a check read an artifact it did not just produce**, or make the
  freshness part of what it asserts. `bundle_tests` reading a stale bundle and
  `KNOWN_INVALID` re-checking pre-fix bytes are the same bug: an assertion whose
  input is older than the thing it claims to be testing.

## "Unmeasured" is worth strictly more than an oracle you assume holds

From the wasmtk team, on our recording diagnostic-offset accuracy as UNMEASURED
rather than clean: *an oracle that doesn't hold is worth strictly more than one
you assume holds.*

That sharpens the clean / unmeasured / not-attempted distinction already
recorded. The value of "unmeasured" is not honesty for its own sake — it is that
it names a specific, still-open question, whereas an assumed-good oracle
produces a number that closes the question wrongly and nobody revisits.
`bundle_tests`'s 4/4 was exactly that: not a missing measurement, a confident
wrong one.

So when a probe's oracle turns out not to hold, **the finding is the oracle**,
and it belongs in the record with the same weight as a defect. It is the thing
that tells the next person where to spend effort.
