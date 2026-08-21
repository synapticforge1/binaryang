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

🔁 **Validate the harness against a known-good case before trusting an aggregate.** The first
V8-validity harness reported **1937 of 1937 modules failing**; the second reported 1667 rejected.
Both were harness bugs — a missing `synthesizeTypes` pass leaves an empty type section, so every
module fails with "no signature at index 0". A number that extreme is evidence about the harness,
not the codebase. Run it against one file you *know* is fine before reporting anything.

🔁 **Re-measure before quoting any number, especially from a memory file.** `CLAUDE.md` states the
binaryen-ts submodule is pinned at `6c6f81f66` (v1.0.9). The working checkout is **v1.3.5**, and
three gaps listed there are already fixed upstream. An upstream report filed from that list would
have been noise. — `tasks.md`, living log rule 2

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
