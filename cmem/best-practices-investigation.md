# Best practices: investigating defects and measurements

Rules for investigating a defect or a measurement: attribution, hypotheses, denominators, blast
radius, vocabulary and defensive code. Last verified 2026-11-20. The other rules are in
[best-practices.md](best-practices.md).

## 🆕 The result gets attributed to whichever property was in view

**Four instances in one week across two repositories, and nobody caught their own.** Seven by
2026-09-04 — the later three are below the table.

- **the claim:** "`br_on_cast` is one bridge case"
  - the property in view: the bridge's instruction switch
  - what actually governed: three defects in two trees — the encoder wrote typed-ref blocktypes in a form that did not round-trip
- **the claim:** "the defect is a tag with a `(ref $T)` param"
  - the property in view: the param that happened to be in the repro
  - what actually governed: a conjunction naming neither the tag's types: a struct/array exists in the module, **and** no function shares the tag's signature
- **the claim:** wasmtk: "`ref.null` marshalling is ~32 assertions"
  - the property in view: where the instruction is **asserted**
  - what actually governed: where the value is **used** — `table_fill`/`table_set` pass it as an argument. Delivered 123
- **the claim:** wasmtk: "audit our fixtures for `(ref $T)` tag params"
  - the property in view: the wording they inherited from us
  - what actually governed: the check returns no matches and cannot show what it was being asked to show. **A false clearance, one step from being recorded**

The errors run in both directions — two undershot cost, two undershot reach — so this is not
optimism. **It is that the property you are looking at feels like the property that matters.**

### The detection mechanism is the finding

**Every one was caught by the other party. None by its author.** That is not a comment on care; the
author has already decided which property is salient, which is exactly the decision under review.

Two things follow, and they are cheap:

- **Hand over the CHECK, not the conclusion.** "Audit for `(ref $T)` params" is unfalsifiable by its
  recipient; "the precondition is a struct existing AND no function sharing the signature" can be
  run and disagreed with. A conclusion travels as a claim about the world; a check travels as
  something the other side can execute.
- **Record a negative as a CONDITIONAL, not a clearance.** wasmtk's closing form is the model:
  _wasic emits zero struct and zero array definitions, so conjunct (a) is never satisfied — and the
  day it emits its first struct, both conjuncts go live together and those 11 modules become exposed
  in the same commit._ That is a finding with a trigger attached. "Unaffected" is a finding with an
  expiry date and no alarm.

### Naming it made self-detection possible

One instance **was** caught by its author, and only after the pattern had been written down: a
convert-pair probe reported `bin-roundtrip=OK` and was green for the wrong reason — validity was the
property in view, and the opcode count was what governed. It was checked precisely because the same
trap had just been named twice.

**That is the argument for this section existing.** The pattern is not detectable by being careful;
it is detectable by being enumerable.

### Three more instances, and what they add (through 2026-09-04)

- **the claim:** "the convert pair round-trips fine"
  - the property in view: the module **validates**
  - what actually governed: the opcode was silently dropped — valid, and still correct on the one input tested (the self-caught one above)
- **the claim:** "wasmtk imports our IR in 10 places, so the merge is a 2.0.0 break"
  - the property in view: matches under wasmtk's directory
  - what actually governed: every match was inside `wasmtk/upstream/binaryang/` — a **vendored copy
    of OUR repo** — and they were comments, not imports. wasmtk imports two compat façades and reads
    no IR field
- **the claim:** "binaryen-ts silently rewrites multi-memory to memory 0", then "no — it refuses loudly"
  - the property in view: first the missing `memory` field, then the `checkSingleMemory` guard
  - what actually governed: neither. The reader DESYNCED: bit 6 of the memarg align field means an
    explicit memidx follows, so the offset byte was consumed as an opcode and became a phantom
    `unreachable`. **Two wrong descriptions in a row, both from reading code; the truth came from
    running one module**

Four rules they add to the two above:

- **Run one input before describing a behaviour.** Reading more code produced a second wrong answer,
  not a right one; one module through the real path settled it in one command.
- **Build the thing before pricing it.** One module through the full path would have shown all three
  `br_on_cast` defects in minutes.
- **A sibling repo may vendor YOUR source.** Exclude vendor directories before measuring "what does
  the consumer use" — the second row above nearly forced a needless major version.
- **Assert the mechanism, not the outcome.** A validity check passes a silently dropped opcode; an
  opcode count does not.

### The checklist — "where is this construct USED, not where is it NAMED?"

> **Copied from synapticforge1/cmem/best-practices.md § 5.5 on 2026-10-23** (stamp wording per
> workspace letter H27, 2026-10-26, the nine clauses of the canonical prose re-read against the
> list below, equal; workspace letter H5, drift
> W5: canonical THERE, copied into each repo under this stamp; a change is made there and
> re-copied, never edited here). Nine questions:
>
> 1. Which set did the number come from — declared, asserted, or consumed?
> 2. Is it BLOCKED BY the thing, or does it merely CONTAIN it?
> 3. Has the binding constraint moved to us?
> 4. The reported shape, or the actual precondition?
> 5. Green because it works, or because it was never exercised?
> 6. Does my measurement see a known positive?
> 7. Am I proving DEAD from an input that could not show it alive?
> 8. Does my probe reimplement something the codebase exports?
> 9. Is the distribution suspicious — all one bucket, a round zero, a total equal to the input count?
>
> "Not detectable by being careful — by being enumerable."

## 🆕 Before fixing a hypothesis, TEST it — "fidelity binds" was not true

Decision 5's recorded rationale was that a single-expression body loses fidelity. Five probes
against upstream `wat2wasm` said no: source-written unlabeled blocks survived byte-for-byte, because
every parser names every real block. The rationale was overstated — and correcting it changed the
decision (neither pure form won; a new interface did). The measurement that followed found the
fidelity defects that DID exist, in a different place: the decoder invented a `nop` for an empty
body and dropped an explicit empty `else`.

**A recorded reason is a hypothesis until a probe agrees with it.** The probe costs minutes; acting
on a false reason costs the design.

### Refinement: there are TWO upstreams — probe both before attributing a difference (2026-09-10)

The empty-`else` fix was recorded as a divergence "vs wabt". Probing both later: **upstream
`wasm2wat`/`wat2wasm` DROP an explicit empty `else`; upstream `wasm-opt` KEEPS it.** So the
pre-region decoder matched wabt and differed from binaryen, and keeping it is a fidelity choice
(divergence E1), not a return to "what upstream does". Likewise `wasm-opt --vacuum` leaves one `nop`
in an all-nop body, which settled R2 as a real difference rather than an assumed one.

**A divergence row names WHICH upstream, from a probe of each.** The binaryen half is cheap: wrap
the body bytes in a one-function `() -> ()` module, run `wasm-opt in.wasm [flags] -o out.wasm` (no
flags = read → write), and compare the code-section body. Note that `-Oz` deletes an unexported
function outright — export it, or probe a single pass.

## 🆕 Find WHERE the bytes are before attributing them (2026-09-20)

Pricing One front end's item 2 produced three different answers for the same question.
**27.5% bigger** — my harness read with `readDebugNames` defaulted OFF, which makes the reader keep
the name section as RAW BYTES on purpose (for `wasm-strip`), so I was measuring a debug section, not
code. **0.75% bigger** — real, and a defect: `PassRunner` dropped the applied names and left the raw
copy, so optimized output carried a stale name section. **0.03% SMALLER** — the answer, once both were
out of the way.

Each wrong answer would have justified a different decision, and the first would have justified a
large piece of work (copying the decoder's scratch-local spills) on the strength of a number that had
nothing to do with spills.

🔑 The check that caught it took one command: a section-by-section diff of the two outputs, which said
`custom +3839` and nothing else. **How to apply:** before a size number becomes an argument, split it
by section (or by whatever the units are) and name the biggest contributor. If a total moves and no
individual part explains it, the harness is the suspect — and a default that differs between the tool
and the harness is the likeliest one.

## 🆕 A SIZE measurement cannot answer a CORRECTNESS question (2026-09-20)

One front end's item 2 (the scratch-local spills) was priced and reported as worth ~zero: route B was
473 bytes smaller than route A over 2,880 modules, behaviour agreed, and the only visible effect was a
fixture the passes left unoptimized. Every number was right. The conclusion drawn from them — "not
wrong, only unoptimized" — was false, and the owner made a decision on it: **two modules emit an
INVALID module at -O3**, because a pass put a block boundary between a value and the `pop` that takes
it. The bytes could not say that, because an invalid module has a size too.

🔑 Compounding it: the register attributed those two failures to a different item (R15, block-param
lowering), and neither module has a block parameter at all — a check that took one command and had
never been run. **How to apply:** when an item's value is in doubt, ask what it PREVENTS before asking
what it saves, and test that directly (here: run the passes and validate the output). When a record
says which item owns a failure, verify the attribution before pricing or skipping the item — a
register entry is a claim, like any other written result.

## 🆕 A comparison must print its DENOMINATOR (2026-09-19)

The first `-Oz` size script printed four neat totals — over **zero** modules. Every upstream call had
failed because `--enable-all` is not a `wasm-opt` flag (it is `--all-features`), the loop's
`if (!u1) continue` swallowed all 421, and the sums stayed at their initial `0`. Nothing was wrong
with the arithmetic; the comparison had simply never happened. It looked like an answer, and the only
reason it was caught is that `0.0 KB` is an implausible corpus size.

🔑 A skipped input is invisible by construction — the same shape as "a skip is not a failure"
([handoffs.md](handoffs.md) § 4) and as the stage-spanning assertion above. **How to apply:** every
measurement prints how many inputs it compared and how many it dropped, with the reason, on the same
line as the result. An external tool's non-zero exit is a REASON, not a skip: count it. And verify a
flag exists before a run depends on it — a wrong flag fails every call identically, which reads like
"the tool cannot do this" rather than "I asked wrongly".

## 🆕 Measure blast radius by TRIALLING the change, not by grepping for the name

**Rule: when direction is decided by cost, get the cost from the compiler. Make the change, count
the errors, revert, and do the same the other way.**

Choosing between two field names, a repo-wide `.field` count said `memory` 20 vs `memidx` 67 — keep
`memory`. Trialling both renames said **10 sites vs 133**, the other way, a 13× difference. The grep
had counted `module.memory`, every memarg's `.offset`, and every unrelated `.memory` in the tree.

The asymmetry was real and explicable once measured: wabt-ts's `memidx` appears in its writers,
validators and name-resolution passes; binaryen-ts's `memory` was read almost only by its encoder.
The two names were never equally entrenched — they only looked it from outside.

### Two refinements from the same work

- **When two fields SWAP names, sequence the passes.** `table.copy` had `source` meaning the source
  TABLE on one side and the source OFFSET operand on the other. Renaming both at once makes every
  `source` site ambiguous — the compiler reports "property does not exist" without saying which was
  meant, and no script can choose. Move one field aside, verify clean, then move the other.
- **Cost does not always get the vote.** wabt-ts had `dst` (a table) beside `dest` (an operand), one
  letter apart; TypeScript itself kept suggesting _"Did you mean to write 'dest'?"_ during the
  rename. That went to the unambiguous names on SAFETY. Blast radius decides ties, and a name that
  invites the wrong field is not a tie.

## 🆕 A defensive branch carrying a DEFECT NUMBER is evidence — do not delete it as clutter

**Rule: before removing a guard, find its second caller. A comment that names a measured failure is
telling you the guard is load-bearing for a population you are not looking at.**

The encoder's `resolveRef` took a `string` meaning either a `$name` or a numeric index, told apart
by `/^[0-9]+$/`. Converting the node fields to `Var` made that regex look like pure legacy cost, so
it went — and 15 tests failed, three of them named _"encoder — numeric entity references resolve as
indices"_, written for precisely the defect being reintroduced.

Its own comment had recorded the cost in advance: **310 of 421 corpus modules**, because
`(export "f" (func 19))` is legal WAT and our own `wasm2wat` emits the numeric form. The comment was
read, understood, and the mechanism removed anyway — the failure was not missing information.

🔑 **What was actually missed is that the function served TWO populations.** Expression-node
references had been converted and carried their arm; MODULE-level references — exports, `start`,
element-segment functions, `ref.func`, catch tags — were still raw tokens, and a token genuinely can
be either form.

### How to apply

- **"This overload is pure cost" is a claim about every caller.** Enumerate them before acting; the
  one in front of you is not the population.
- **Discrimination does not disappear, it MOVES.** The right destination is the text boundary, where
  it happens once: a `varFromToken()` that reads the token and picks the arm. What was wrong was a
  FIELD carrying both meanings, not the act of telling them apart.
- **A defect number in a comment is a test that already ran.** Treat it as data: it says a
  population exists that broke this before.

## 🆕 A vocabulary must be checked against the SPEC, not against the other half of the repo

**Rule: when two components each hold a copy of an external vocabulary, agreement between them is
not evidence. Check the copy that faces the outside world against the standard.**

binaryen-ts spelled two abstract heap types `ext` / `noext` — binaryen's internal C++ names, which
are not WAT keywords. Because `heapTypeToString` returns the enum VALUE as the keyword, the defect
ran both ways: the parser **rejected** `(ref null extern)`, the spec spelling that every other tool
emits, and the printer **emitted** `(ref null ext)`, which no WAT parser accepts. `exn` / `noexn`
were missing from the parser's map entirely though the enum declared them. Four of twelve broken in
both directions, undetected for the life of the file.

Nothing caught it because nothing asserted on the keyword SET: the round-trip corpus is
binary-sourced, and `deno task baseline` compares our bytes against our own. wabt-ts had the correct
table in `core/types.ts` the whole time, so the two halves disagreed silently — the failure mode a
single repository invites.

### How to apply

- **Type the table with the vocabulary**, so a keyword added to one and not the other does not
  compile: `ReadonlyArray<readonly [AbstractHeap, Type]>`, not `readonly [string, Type]`.
- **Tighten the boundary functions to the union**, not `string` —
  `typeToHeapTypeName(t):
  AbstractHeap | null`. Then a miss means the table is short an entry
  rather than that the caller passed something unexpected.
- **Assert the set is reachable**: a test that every enum member has a keyword catches the
  `exn`/`noexn` shape, where a member exists but no input can produce it.
- ⚠️ **Say out loud when the usual oracle cannot reach the feature.** wabt 1.0.41 has no GC
  heap-type text support (`(ref null any)` → `unexpected token "any"`), the same limitation that
  makes `spec:prepare` skip 30 files — so the spec was the only authority here. A first probe with
  `--enable-all` appeared to show `any` and `eq` rejected too; that was the flags, not the keywords.

## 🆕 A "this is unsafe" comment can be wrong about the standard and right about our code

The WAT writer declined to fold any node whose operands were partly stack-sourced, and the comment
explaining why named a specific case: `(i32.store (value))` gives one operand for two slots, and "a
reader assigns it to the FIRST", so the address would be filled with the value.

Half of that was wrong. Folding is defined by UNFOLDING — `(instr a b)` is `a b instr` — so written
operands land in the LAST slots and the stack supplies the leading ones. wabt-ts reads it correctly.

**The other half was right, about a component the comment never mentioned.** binaryen-ts's parser
read that exact text as storing the address at the value: 0 where wabt-ts gives 42. Valid bytes,
wrong program.

**So removing a guard on the grounds that its justification is wrong requires checking every
component the guard was protecting, not just the one the comment argued about.** Measuring the
standard would have licensed the change; measuring our own parser is what caught the miscompile.

⚠️ **Use a NON-COMMUTATIVE operation whenever operand order is what you are testing.** With
`i32.add` every assertion here passes under the reversed reading. `i32.sub` and a 3-argument
subtraction are what made the slots observable.

## 🆕 The code being replaced is not the specification of the replacement (2026-09-18)

M8c's `nameReferences` replaces what the bridge does with references, so its label scoping was
first COPIED from the bridge, including a `delegate` resolved with its own `try`'s label still in
scope. `resolveNames`, the binary writer and binaryen-ts's encoder all resolve it one frame further
out, and they are the ones that decide what the bytes say. The bridge was wrong and nothing
noticed, because no corpus module delegates (the same held for a named `if`, whose label the
bridge dropped). An agreement check against the old code (49,335 references, 0 differ) proves
agreement, not correctness, over exactly the cases the corpus reaches. For every case it does
not reach, read the CONSUMERS' rule and test it directly.

## 🆕 A reservation in a comment must be checked for supersession before it is foreclosed

`RefAsOp`'s doc said _"the extern conversions are post-MVP and would be added here rather than as
separate expression kinds"_. Dropping the field foreclosed that plan — except the unified IR already
modelled those conversions as their own kinds, so the reservation had been superseded, not merely
left unused.

**Check whether a reserved extension point has been served some other way before removing it — and
say what served it in the comment left behind.** A reader who finds neither the mechanism nor an
explanation will reasonably re-add it, and the reservation will outlive a second design.
