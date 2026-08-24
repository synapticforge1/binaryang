# Best Practices — method rules, extracted from what went wrong

Every rule below was paid for by a real incident in **this** repo. Each is followed by the incident
that produced it and where the detail lives.

**This file holds METHOD, not findings.** Post-mortems stay in their home files —
`design-decisions.md` for load-bearing invariants, `tasks.md` for the running log, `bridge.md` for
binaryen-ts coverage. What lives here is the transferable part: *how to work on this codebase so the
same class does not recur.*

Structure and several rules are adopted from the sibling **wazmrt** project's
`cmem/best-practices.md`. Rules marked 🔁 were learned independently here and match one there — a
repeat across two codebases is the strongest signal a rule generalises. Rules marked 📥 were adopted
from wazmrt before we hit them, and are kept because the shape clearly applies.

⚠️ **Read this before starting a conformance pass, a scoping exercise, or any change to a
producer/consumer pair.** Most entries exist because someone competent did the obvious thing.

---

## 1. Verifying a change

🔁 **A parse-success count is an UPPER BOUND, not a measurement.** Five tranches were scoped and
ranked by "files that parse clean" — a metric that structurally cannot see a module that parses
perfectly and then encodes to bytes V8 rejects. At the tranche-4 cut the split was **230 files
parse-clean but only 180 whose every module V8-validates.** Two latent bugs sat in that 50-file gap
the whole time, both already documented as unfixed and neither in any tranche, *because the tranches
were derived from parse failures*. — `tasks.md`, "The parse metric has a blind spot"

**Measure with the strongest oracle available, and prefer it to our own reasoning.** Two encodings
were settled by asking V8 directly rather than reading the proposal text:
`noexn` is `0x74`, not the `0x68` that continuing the hierarchy implies; and a `try_table` catch
target resolves in the **enclosing** scope (depth 0 for the immediately enclosing block), not with
the try_table's own label pushed as the spec's `C, label [t*] ⊢ catch*` rule reads. Both times the
plausible reading was wrong and one probe settled it. — `design-decisions.md`

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
not the codebase. Run it against one file you *know* is fine before reporting anything.

🔁 **Re-measure before quoting any number, especially from a memory file.** `CLAUDE.md` states the
binaryen-ts submodule is pinned at `6c6f81f66` (v1.0.9). The working checkout is **v1.3.5**, and
three gaps listed there are already fixed upstream. An upstream report filed from that list would
have been noise. — `tasks.md`, living log rule 2

**Measure the direction your metric CANNOT see, or you will report the wrong verdict.** The
validator-agreement metric counts modules V8 accepts that we also accept — false *rejections*. It
says nothing about what a permissive validator waves through. On that number alone the T9.3 typed
lattice looked like a **regression** (2120 → 2110) and was nearly reported as one. Adding the
opposite direction — `assert_invalid` modules we correctly reject — showed it caught **28 more real
errors**, and the ten false rejections turned out to be ten *further* bugs the coarse lattice had
been hiding. One-sided metrics produce confidently wrong conclusions. — `tasks.md`, T9.3/T9.4

🔁 **Read the field the code actually sets.** The T9.5 survey asked `hasErrors(result.errors)`; the
validator signals failure through `result`, and `dropTypes` returned `Result.Error` **without
recording a message**. Every stack underflow therefore read as "accepted". The reported gap was
**903 missed**; measured on `result` it was **314**, and fixing the *report* accounted for the
difference before a single check was added. Two lessons in one: a silent failure is a defect in its
own right (`wasm-validate` exited non-zero and printed nothing), and it corrupts every measurement
that reads the wrong field. — `tasks.md`, T9.5

**When a fix makes a metric WORSE, that is information — chase it before explaining it away.**
Correcting the element-segment type on the binary side dropped round-trip fidelity 1961 → 1779.
The instinct is to call it acceptable collateral; following it instead found the other half of the
bug — the WAT writer's `func` shorthand was gated on the *nullable* `funcref` when that spelling
means `(ref func)`. Both halves fixed, fidelity back to 1961. — `tasks.md`, T11

**Diff the whole per-file list, not the total.** Every tranche recorded newly-passing *and*
newly-failing files by set difference, not just the count. A tranche that fixes 14 and breaks 2
shows the same delta as one that fixes 12 and breaks 0.

---

## 2. Investigating a defect

🔁 **Triage by first-error text MISLABELS — confirm every root cause with a minimal repro through
the real entry point.** Clustering 137 failures by their first error produced four wrong
hypotheses: underscores in numeric literals (they work), `(module quote …)` (works; only the
*multi-string* form fails), relaxed SIMD instructions (parse fine — those files fail on `(either …)`),
and "expected i32 constant" (nothing to do with separators; `BigInt('-0x…')` throws because JS
rejects sign-plus-radix). Reading error strings tells you where parsing stopped, not why.
— `tasks.md`, tranche scope

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
`select (result any)` — which is what `wasm2wat` printed. The source was
`select (result (ref 1))`, and the misprint was itself a symptom of the bug being hunted (the
writer emitted `0x00` for the annotation). When a tool under investigation renders the input, get
the input from the file. — `tasks.md`, T9.10

**A cast is where a refactor stops.** The T7.4 `ValueType` refactor widened the IR from `Type` to
`Type | RefValueType`, and every site that had a cast survived compilation unchanged and silently
wrong: `this.s.writeU8(t as number)` wrote `0x00` for an object, so **every** typed-ref
`select (result …)` was mis-encoded; a type-lookup key built by string interpolation produced
`(func (param [object Object]))`. After widening a type, grep the old name for casts and template
interpolation — the compiler will not.

**Check the INPUT before blaming the code.** Twice in one session a "parser bug" was invalid WAT of
my own writing: `br_if` leaves its values on the stack when *not* taken, so nothing may follow it
inside a block whose result those values are. Both probes were rewritten, not the parser.

**A defect that parses cleanly is invisible to a parse metric — and one the bridge re-encodes is
invisible to bridge tests.** The packed-type wire bytes (`Type.I8` was `0x7a`, spec says `0x78`)
were wrong for four releases: invisible to parsing because the text is fine, and invisible through
the bridge because binaryen-ts re-encodes its own way. Only asking V8 about *our* encoder's output
found it. — `design-decisions.md`

**"Silently wrong" and "loudly broken" need different hunts.** Three failure modes, in increasing
order of how hard they are to find: throws (a stack trace names the site), V8 rejects (a message
names the construct), V8 *accepts wrong bytes* (nothing tells you). Raw non-ASCII characters in WAT
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
`(table $x 1 (ref null $t))` decoded as `(table 0 ref null)` — wrong limits *and* wrong type, from
one missing read.

**`resolveNames` must walk EVERY name-bearing immediate, or the writer emits index 0.** Found five
times now — `call_indirect`'s `typeVar` (Bug G), `br_if`'s carried value (Bug F), `ref.null`'s heap
type, `br_table`'s index expression, `try_table`'s catch tag and target, and every memory op's
`memidx`. The fix that ends the class is not another case: it is the standing guard in
`tests/ir/encode_correctness.test.ts` asserting **no name-var survives `resolveNames` anywhere in
the IR**, over a hand-built module and the whole spec testsuite. That guard is what found the
`try_table` one. — `design-decisions.md`

🔁 **A second copy of a lookup table is a second place to be incomplete.** The heap-type
keyword ⇄ `Type` mapping existed three times (parser, binary reader, binary writer) and each was
missing different entries; it is now one table in `core/types.ts`. A duplicate `typeName` switch
was also found hiding in `wasm-objdump.ts`. When you need a mapping that already exists somewhere,
extend the original — do not copy it. — `design-decisions.md`

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
it: the error simply moves downstream. The distinction had been collapsed in **five** places at
once (parser, binary reader, binary writer, WAT writer, validator), each hiding the next. —
`tasks.md`, T11

🔁 **The same off-by-one recurs in every layer that walks the same structure.** `try_table` catch
targets resolve in the ENCLOSING scope. That was fixed in the parser in T7.6 — and reappeared
unchanged in the validator in T9.8, where the catches were checked after `beginTryTable` had
already pushed the try_table's own label. Six valid modules rejected. When you fix a scoping rule
in one layer, grep for the other layers that implement it.

**Coarsen at the CONSUMER's boundary, never in an encoder.** The validator's type-checker and the
binaryen bridge both have flat type surfaces and legitimately cannot hold a concrete typed ref, so
they call `coarsenValueType` at their entry points — a handful of methods rather than ~20 call
sites. Encoders must never coarsen; that was the bug being fixed.

---

## 4. Tests and gates

🔁 **A test that passes under BOTH the right and the wrong behaviour tests nothing — invert it and
watch it fail.** The first `try_table` catch-depth test passed under either depth convention,
because its two candidate targets were type-compatible and both propagated the value. It was
written *as* the regression test for that fix and would never have caught it. The replacement was
confirmed by reverting the fix and watching it fail. **Any test written as the guard for a specific
fix should be run once against the unfixed code.**

**Assert the VALUE, not that it parsed.** `table.init`'s two indices were transposed for the whole
of tranche 2 while parsing fine. The test that pins it instantiates two tables and two elem
segments and reads back which one got filled. Where semantics matter, execute in V8; where
*encoding* matters (typed-ref GC code V8 cannot accept through this path), assert the bytes — but
say in the test which one you are doing and why.

**A test whose weak spot is known should say so in the test.** The nesting case for `try_table`
catch depth is kept, but its comment now states it does not pin the convention and points at the
one that does. A test that quietly overclaims is worse than no test.

**A guard is only as wide as its CORPUS.** The standing "no name-var survives `resolveNames`"
sweep — the guard credited below with ending a whole class — did not catch the `select (result
(ref $t))` annotation, because no spec-testsuite module writes one. It was found instead by the
binary writer's fail-loud check, once a cast stopped hiding it. Class guards are the right shape,
but state what they run over, and do not treat them as proof for inputs the corpus never contains.

**When a new check rejects something valid, suspect the CHECK's inputs before loosening the check.**
Making the reference lattice precise produced ten false rejections. The tempting fix — widen the
lattice until the number goes green — would have undone the entire point. Every one of the ten was
a *separate* bug the coarse lattice had been masking: a producer still reporting a placeholder
type, a rule that skipped its push in unreachable code, a canonical key that baked in a raw index,
a nullability rule applied to the wrong side. **A green metric bought by weakening a check is worth
less than a red one.** — `tasks.md`, T9.3/T9.4

**Test the failing-by-design case, and flip it when it stops failing.** A known gap (cross-group
forward type references) was written into the test suite as an assertion that we *do not* catch it,
with the reason. When T9.7 closed it, that test failed — which is exactly how the gap announced it
was gone. Documented gaps belong in the suite, not only in a log.

**Prefer one guard for a class over one test per instance.** See the no-unresolved-name-var sweep in
§3. Six individual regression tests would not have found the seventh.

---

## 5. Recording what you found

🔁 **Record findings that were WRONG, so they are not "fixed" again.** The binaryen-ts living log
carries an explicit *"already fixed upstream — do NOT file"* table, because three entries inherited
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

T10's seven groups were ranked by severity on the spec testsuite: the ones
producing invalid wasm first, "valid but wrong export order" last. Measured
against the wasmtk WASI corpus — the corpus the standing goal actually names —
the ranking inverted: five of the seven groups did not occur there **at all**,
while the one ranked last occurred in **100%** of the differences.

Acting on the goal's ranking (2026-08-24) closed T10.1 and, because they shared
a root, T10.2 with it — the cheapest item on the list, and it took the corpus
from 1/270 to 50/270 where severity-order would have spent the effort on groups
worth 0 there.

Two things generalise:

- **A severity ranking and a frequency ranking are both correct, for different
  corpora.** Neither is "the" priority. Pick the corpus the goal names, and say
  which one you picked.
- **Re-measure the ranking when the goal is written down**, not once at the
  start. T10's order was set before the WASI target was recorded; nothing about
  it was wrong at the time.

## A "cosmetic" difference is not cosmetic if it is observable

T10.1 was parked as "valid, wrong order" for the whole campaign. But export
order is readable through `WebAssembly.Module.exports()`, so a round-trip that
changes it produces a DIFFERENT module — the same class as T9.1, where the
decoder reordered a program. The tell is not "does it still validate" but "can
a consumer see the difference". Ask that before filing something as cosmetic.

## Ask whether repeating the operation is a fixed point

T10.5 was filed as "valid, larger" and ranked last but one. The stray `nop` it
produced is inert — it pushes nothing, so the instruction that had been starved
of an operand still found its value on the stack, and the module ran correctly.
Everything about it said cosmetic.

Running the round trip SIX times said otherwise: 517 → 521 → 525 → 529 → 533 →
537 → 541. Every pass added the same four bytes, with no bound. A toolchain in a
build pipeline that disassembles and reassembles more than once grows the module
forever.

"Does it still validate" and "is the output correct" are both weaker questions
than "**is doing it again a fixed point**". Two lines of harness, and it moved
the item from cosmetic to a real defect.

## Re-measure a diagnosis before acting on it, even your own

T10.5's recorded cause was the binary READER ("the reader cannot attribute every
value to an operand slot"). That was written from evidence and it was wrong for
the dominant case: measuring which node actually over-consumed found the PARSER,
draining the whole operand stack for `call`. The reader-side cause is real but
is the residue (now T10.8), not the bulk.

The classification had been made once, months of work earlier, and carried
forward as fact. Cost of re-measuring: one 40-line harness that printed
`call args=3 want=2` and its friends.

## When a marker has to be applied at every construction site, grep for it

T10.8's fix is a flag on one IR node, and the obvious place to set it is the
shared `popN` helper each decoder owns. Doing exactly that took the WASI corpus
to 270/270 and looked finished.

The spec testsuite disagreed: it moved only to 2074/2120. The parser builds the
same placeholder in **13 more places** that never go near `popN` —
`buildPlainExpr`'s `op0()`…`op4()` operand accessors, two folded-`if` condition
slots, and four `operands[operands.length - 1] ?? …` callee slots. Converting
those took it to 2088/2120, and files affected from 27 to 14.

Grep for the literal (`kind: 'nop'` here), not for the helper. And keep a second
corpus around: one of the two would have called this done.

## An unused parameter in one of a family of parallel handlers is a missing check

`deno lint` had ten standing `'offset' is never used` warnings in
`shared-validator.ts`. They looked like dead-parameter noise left over from a
callback signature, and they were treated that way for long enough to be
described as "lint debt to clear before a merge".

They were reporting a real gap. `onLoad` and `onStore` pass `offset` to
`checkMemArgOffset`; the other ten memarg handlers declare it and drop it — so
the rule that a memarg offset must fit the memory's index type simply did not
apply to any SIMD or atomic memory op. Four were demonstrable false-accepts
against V8.

Both campaign corpora were blind to it: agreement and `assert_invalid` did not
move, because no spec-testsuite module writes an out-of-range offset on a SIMD
op. **A lint warning caught what five metrics could not.**

Before silencing an unused-variable warning, check whether the handler's
SIBLINGS use that variable. If they do, the warning is a diff between them.

## In this codebase, "the linear form is a stub" IS a round-trip bug

`try_table`'s linear branch carried a comment saying so - "simplified: parse the
protected body and skip the catch-clause immediates to the matching `end`" -
and it had been fine for a long time, because hand-written and wasic-generated
WAT both use the folded form.

But **the WAT writer is linear-only by design**. So every `wasm2wat` output is
in exactly the form the parser did not support, and a round trip silently
replaced every `try_table` with an empty block. It surfaced only once the
round-trip metric existed, as "V8 rejects this after a round trip".

The general shape: when a producer and a consumer in the same toolchain
deliberately favour different forms of the same grammar, a stub on one side is
not a partial implementation - it is a hole exactly where the other side aims.
Grep for the remaining ones rather than waiting for a metric to find them.
