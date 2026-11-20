# Best practices: lessons from the IR work

Lessons from the IR work after the merge (M8, S7, R15, pre-bump items, custom descriptors) and the
tree-shape rules they produced. Last verified 2026-11-20. The other rules are in
[best-practices.md](best-practices.md).

## 🆕 Lessons from the post-M8 run (2026-09-18 → 2026-09-19)

Fourteen items — post-M8 fixes 1–10, W10b, W11, the scheduled cleanup — each measured, mutated and
gated (`git show 3bd64ece7:cmem/open-work.md`, § "Done 2026-09-18 → 2026-09-19"). What they taught, in order of
how much they cost when ignored:

### A task's own description is a claim — check it before scoping

The working rule "a row's PREMISE is not evidence" ([working-rules.md](working-rules.md)) paid out
three more times. **Fix 8** said "read the index as a LEB, as every other memory index is": the
premise was false — four more DECODER sites read one byte, and the ENCODER wrote all six as
`writeU8(n & 0xff)`, naming a different memory from index 256. **Fix 6** said a filter "never meets a
placeholder": true, and beside the point — it met a real `(nop)` and dropped it from the module.
**The cleanup** rested on "no definition shares an import's name": a corpus count found one module
that does (the spec's `func.74`, malformed on purpose). How to apply: before choosing a fix, grep for
the item's claim ("every other …", "never …", "cannot …") and count it on the corpus.

### A guard that looks dead: list what it DOES meet

A filter declared stale because nothing it was written for reaches it can still act on inputs
nobody listed. Fix 6's `'nop'` filter received no placeholders, and did receive real `nop`
instructions. Before deleting, keeping or retargeting a guard, enumerate its actual inputs — probe
with the unusual-but-valid ones (`(nop)`, a statement where an operand is expected, an import).

### A tree-shape change is a behaviour change for every consumer of the tree

Bytes did not move once in fixes 4, 5, 9, 10, W10b or W11, and each still broke something that
READ the tree: M8d tests that took their sibling shapes from the old parser (fixes 4, 5, W10b), a
multi-memory test that assumed linear output (W11), and — the serious one — `deriveTypes`, which
walked a branch's operands in `visitChildren` order (condition BEFORE values). Nothing had ever put
a `pop` inside a `br_if`'s value until W10b did, and the spec's invalid `br.6` was then typed from
the condition and ACCEPTED. How to apply: after changing what a front end builds, run every
order- or shape-sensitive consumer over the corpus (`prepareForPasses` over the linear texts, main
against the branch) and read BOTH directions — newly refused (fix 5: 109, all V8-invalid, good) and
newly ACCEPTED (W10b: 1, V8-invalid, a defect).

### Test the FOLDED form on its own — it does not pad

Linear text pops through `popN`, which pads a short stack with placeholders; the folded form takes
only the children it finds. So padding code (`carried`) acts only in folded input, and in fixes 5
and 9 the mutant removing it SURVIVED every linear test. Where a rule concerns operands, test a
linear and a folded spelling of the same case.

### For a text change the verdict is RE-ASSEMBLY, of every changed text

W11's first cut printed `()` for a `pop` in two invalid spec modules — well-formed-looking output
that does not parse. Only re-assembling all 872 changed folded texts (main's verdict against the
branch's, per file) caught it; the targeted tests had passed. Set the name section aside when
comparing (N1: our `wat2wasm` always writes one, upstream's only with `--debug-names`), or every
spec binary reads as different.

### A "cannot happen" gets a count

Two comments said so this run and were rewritten after counting: "function names are unique"
(one malformed exception) and "no placeholder reaches this filter" (true, but a real `nop` did). A
count over the corpus costs a minute; state the claim with its scope ("in every well-formed module")
and its exceptions named.

### An equivalent mutant: name the caller that makes it equivalent

Three survived and were kept as findings, each with its reason: fix 9's first-versus-default target
(every target of a valid `br_table` carries the same values), fix 10's root arity in an init
expression (it cannot branch), W11's `pop` return value (its one caller ignores it — deleting the
line fails). "Equivalent" without the reason is indistinguishable from a missing test.

## 🆕 Lessons from S7's mixed form (2026-09-19)

### Anything encoded RELATIVE to a tree must name ONE tree

The first cut encoded each function's forms as exceptions against the canonical forms of "the
tree" — whichever the writer held. Trees for the same bytes differ (the parser, the wabt-ts reader
and binaryen-ts's decoder attach multi-value operands, void calls and operands across `unreachable`
differently), so the same payload decoded to other forms in another reader: 16 files lost their
forms, silently, with every byte still right. The fix was a definition, not a patch — the
prediction is the wabt-ts READER's tree of the very bytes, and both encoders read their output back
to get it — plus a hash so a reader whose tree differs SKIPS rather than misapplies. How to apply:
for any compressed or relative encoding, write down which computation the decoder repeats, and
make it the same computation on the same input, not an equivalent one on another.

### Measure agreement between the trees before trusting any of them

The agreement script (instruction sequence, slot counts, canonical forms — parser vs reader vs
decoder, per function, over the corpus) cost minutes and found two reader defects nobody was looking
for: imports indexed across kinds (fixed, `59c13f918`) and multi-value operands attached by node
count (recorded). Three front ends that each pass their own byte gates can still build different
trees; only comparing them says so.

### A test's premise gets asserted in the test

"A form the reader would predict differently is recorded" passed from its first run — because its
fixture recorded NOTHING, so both sides agreed trivially. The mutant that should have killed it
survived, and that is how it was found. The replacement asserts its premise first (the parser
records nothing there; the section has exactly that entry). The same held for the hash test, whose
crafted entry was invalid for a second reason, so a different check stood between it and the output.
How to apply: when a test is about a condition, assert the condition holds before asserting what
follows from it — and let a surviving mutant send you to the premise first.

## 🆕 A value's POSITION carries meaning, and a two-list model loses it (2026-09-20)

The binary reader keeps a region as `stack` (values something may still consume) and `stmts`
(committed statements), and ends it with `[...stmts, ...stack]`. Seeding a carrier's parameters onto
`stack` (R13 / R14) therefore emitted them AFTER the statements that ran with those values already on
the stack — and since a region's type is its LAST child's, an arm whose parameters were unconsumed
came out typed `i32` where the decoder typed it `none`. The nodes were all correct; only their order
was wrong, and the type is read off the order.

🔑 The bytes could not catch it: a `pop` writes nothing, so the baseline, `direct` 544/544 and the
engine were all green through the bug. It took a fixture built to leave an entry value UNCONSUMED
next to a statement. **How to apply:** when a producer emits into a list, ask what the list's ORDER
is read for downstream (here: the region's type, and what a later consumer takes) — and when a model
splits one sequence into two lists, any new insertion needs its position chosen explicitly, not
inherited from whichever list it landed in. The interleaving hazard is already documented in
`pushStmt`'s comment for the drain case; seeding hit the same seam from the other side.

## 🆕 Lessons from R15 and Q1–Q8 (2026-09-28)

### A VALID output is not a CORRECT one — run what the spec already asks

Every gate was green and the optimizer was silently changing what modules DO: a set turned into a
drop at -O2 (Q1), dead code that trapped instead of branching (Q4), a signature trap that vanished
(Q5). Validity gates cannot see any of it, and `deno task spec` skips `assert_return` by design. One
differential run — each spec module's own invocations against the original and every variant —
found eight defects in minutes. **How to apply:** after changing a pass or a front end, run the
behaviour differential, not only the validators. The original module in V8 is the oracle; no expected
value has to be derived.

### A no-op passes every test that only asks "is it valid?"

The first R15 attempt lowered NOTHING, and the modules stayed valid (the encoder writes parameters as
written), so it read as working. **How to apply:** assert the transformation happened ("no parameter
is left") alongside "valid and the same", and assert on the step ALONE as well as after the passes —
a pass can repair or hide what the step got wrong.

### A silent default is where a gap hides: make "I don't know this" loud

The CFG read ANY unknown label as a function exit. A branch to an `if` label (upstream has none, so
the port never saw one) became a return, and liveness was wrong without a sound. The fix was to push
the label — and to make an unknown label THROW, so the next unhandled labelled kind cannot fail the
same way. **How to apply:** when porting a pass, find each fallback that turns an unrecognised input
into a plausible answer ("treat as exit", "treat as none", "skip") and make it refuse instead.

### A stack placeholder means "already on the stack" — work where the stack is explicit

A `pop` has no identity beyond its position: an entry value may be consumed deep in an operand, pass
through untouched, or be produced INSIDE the condition of the branch that carries it. Rewriting
individual `pop`s failed six of eight modules; a positional lowering (write the locals, READ THEM BACK
at the region's start, leave the `pop`s alone) passed all eight. The same fact gave Q4: a phantom
filled with `unreachable` is right only where the code is already dead before it runs. **How to
apply:** before rewriting stack-held values in a tree, ask what the linear bytes do at that point;
a `block` wrapper cannot reach the enclosing stack, so sequences go into the enclosing list.

### A fix made mid-way can itself break something — keep re-running the whole check

The phantom fix, first version, took apart a loop body on route A (`fac.0` went invalid): a region's
statements were read as operands, and bare `pop` statements as phantoms. Each guard alone is
harmless; the pair was the defect. Only re-running the full differential after EACH fix showed it.
**How to apply:** when single mutants of two guards are MISSED, try them together before concluding a
guard is redundant.

## 🆕 Lessons from the pre-bump items (2026-09-28, late)

### A check that cannot make the call agrees by construction — count what it cannot see

The behaviour differential compared 57,808 invocations, and 24,151 of them — every SIMD one — threw
a TypeError on the original and on every variant, because JS cannot pass a `v128`. Equal outcomes,
so "agree": a planted SIMD miscompile passed with 0 DIVERGE. **How to apply:** when a check compares
outcomes, count the outcomes that are the harness failing to run the thing (the same exception on
the ORIGINAL), report that number, and treat a rise in it as lost coverage.

### Read the whole output of a check, not its last line

`deno fmt --check … | tail -1` printed the file count — the error was on the line above — and a
formatting miss reached the gate. **How to apply:** judge a check by its EXIT CODE, as the gate
does; a tail is for reading, never for deciding.

⚠️ **It recurred THREE more times the same day** (a format miss, then two lint misses, each
committed after a `| tail -1` check and caught only by the gate), after this lesson was written.
Writing the lesson did not change the habit; changing the command did: `deno lint >/dev/null &&
echo ok` (or `; echo "exit $?"`) cannot show a clean last line over a failure. Chains that commit
must be joined with `&&` AFTER an exit-code check, never `;`.

### A lookup table keyed by user text must not inherit

The stage 5 codemod renamed identifiers through `RENAME[name] ?? name`, a plain object. For the
identifier `toString`, `RENAME['toString']` found `Object.prototype.toString`, and the codemod
wrote its source text — `function toString() { [native code] }` — into 46 test files. The type
checker caught one; the rest were in comments or code paths it could not judge. Reverted whole and
re-run. **How to apply:** `Object.hasOwn(table, key)` (or a `Map`) for any lookup keyed by text
from the input; and AUDIT a bulk rewrite by checking every changed line is explained by the
intended renames alone (one `sed` + `uniq -u` over the diff did it, and found nothing else).

### Attribute every residual by looking at it

The K4 commit message called the `writeWat` re-assembly residuals "a DataCount section or Q9's tag".
After Q9 was fixed one was left that was neither — an empty `else` the text cannot spell (E2).
**How to apply:** before a message names the cause of a residual, open each one; a count that
"mostly" fits a story is not an attribution.

### A defect's record says where it SHOWED, not where it LIVES

Q9's row blamed the writers and `synthesizeTypes`; the spare type came from the PARSER's
implicit-type pass, found only when the fixed writers still produced it. W12's row said
`(tag $x (type $t))` was refused; measured, it always parsed. **How to apply:** reproduce from the
record's example and trace the bytes to their origin before editing the component the record names
(the corollary of "a task's premise is not evidence").

### Identical bytes can hide a wrong tree — test the stage that is wrong

A code-metadata hint left on the OPERAND stack became an operand of `i32.add` in the tree, yet wrote
the same bytes (binary order is post-order): every byte test passed that mutant. Only an assertion on
the parsed tree caught it. **How to apply:** when a mutant survives every byte test, ask whether the
defect is in a stage the bytes cannot see, and assert THAT stage (the tree), not the output.

### Deleting a component deletes the checks it made — run the suite on what remains

Unpublishing binaryen-ts's encoder looked mechanical: every entry point had used the one writer
for a stage already, with 14,595 outputs identical. Deleting it and running the suite on the one
writer ALONE found four defects the encoder had been covering (one live on the public API since
stage 4a — the parity measure could not see it, because it compared READ trees, and the defect
needed an API-built one) and seven refusals nothing else made. **How to apply:** before calling
a deletion mechanical, list what the deleted code REFUSED or NORMALIZED, and make sure each has a
new home; a parity measurement is evidence only about the inputs it fed.

## 🆕 Lessons from custom descriptors (5a, 2026-09-28)

### An optional field is invisible to the compiler — audit every consumer of the kind

Adding `desc?` to three existing node kinds type-checked cleanly while `resolve-names` (a
per-field rewrite with a silent `default`), the WAT writer's fold arms (`operands: [e.ref]`) and the
binary writer's `br_on` (a two-way sub-opcode choice) would each have lost or misencoded it. A new
KIND fails exhaustive switches loudly; a new FIELD fails nothing. **How to apply:** grep every
consumer of the kind (and of its siblings — `ref.test` beside `ref.cast` found the rest), and
classify each as generic (walks children) or hand-written (must learn the field).

### A builder that reads `operands[0..n]` silently drops the rest

Three defects, one shape: a folded instruction with surplus children, a folded `br_on_cast` with a
carried value (its FIRST operand taken as the ref), a linear `struct.new` handed the whole stack.
**How to apply:** where operands are positional, take them from the END (the top of the stack), and
say what happens to the rest.

### A proposal's testsuite outranks its Overview

The Overview asked for matching finality and a full supertype square; the testsuite, newer,
accepts both. Built from the prose, 4 valid modules were refused. **How to apply:** implement from
the prose, then let the suite overrule it — and record where it did.

### "Every feature on" is not neutral — and run a check exactly as the gate runs it

A feature that CHANGES a verdict (5a's relaxed `br_on_cast`) turns a core-suite pass into a failure
under `allFeatures` ([testing.md](testing.md)). And a path-scoped `deno fmt src tests` checked 211
files where the gate's bare `deno fmt --check` checks 446: the new test file was formatted by
neither of my runs and failed the gate. **How to apply:** before the gate, run its commands
verbatim, not a narrowed equivalent.

🔁 **Recurred 2026-10-13 (open-work 28):** `deno check src/**/*.ts tests/**/*.ts …` typed into Git
Bash showed 0 errors after `Opcode` narrowed; the gate's `deno task check` found 20 in two test
files. Bash without `globstar` does not recurse `**`, so the hand-typed run checked a fraction of
the tree. Run the TASK (`deno task check`, `bun run check`), never a retyped glob.

## 🆕 A node COUNT is behaviour — a representation that adds nodes moves every threshold on it

Inlining decides by size (≤2 always, ≤10 one caller, ≤20 flexible), and size was "nodes
`walkExpression` visits". Decision 5 made every body a region node, which would have added one node
to every function and one per `if` arm — and silently changed which functions inline, with no error
anywhere. `countsTowardSize` counts a region only where upstream's IR has a node (a body of N ≠ 1
instructions), which reproduces the pre-region count exactly.

**Grep for counters over a walk (`size++`, `count++`, `measure…`) whenever a change adds or removes
nodes.** A threshold calibrated against one IR's shape is a claim about that shape.

## 🆕 A pinned list must be a RATCHET, not a ceiling (S6 decision 6A, 2026-09-10)

The operators gate pinned seven phantom kinds and failed on any ADDITION. Decision 6A deleted one,
`TupleExtract` — and the gate stayed green with it still pinned. A ceiling-only budget goes stale
the moment something is fixed, and a stale entry is a hole: that same phantom could come back and
the gate would accept it as "already known".

**Every budget, allowlist, or pinned-failure list fails in BOTH directions** — on an entry that
appears and on an entry that no longer applies. Verify the second check fires by running it once
against the stale list before cleaning the list.

## 🆕 Every linear instruction has a folded form — add parentheses (owner rule, 2026-09-10)

**Rule: anything written linearly can be written folded by putting parentheses around the
instruction.** Folded operands are OPTIONAL; whatever an instruction consumes beyond them comes from
the stack. So `i32.add` ≡ `(i32.add)`, and `i32.const 2 i32.add` ≡ `(i32.add (i32.const 2))` when
the other operand is already there. Structured instructions fold the same way: `(block …)`,
`(loop …)`, and `(if bt foldedinstr* (then …) (else …))`, which means `foldedinstr* if bt … end` —
the condition slot holds any number of folded instructions, the last value being the condition.

**"This has no folded form" is therefore never a reason** — not to refuse input, not to justify
dropping part of it, not to rule a feature out of a parser.

The instance: I wrote that the binaryen-ts WAT parser "reads folded form only", so block PARAMETERS
— "by definition a value left on the stack by what came before" — could not be read. The owner
corrected it. Upstream wat2wasm reads all four folded spellings: an input folded before
`(block (param …) …)`, a body consuming it with a partial fold, `if` inputs in the condition slot,
and a loop back-edge. Probing those spellings then found a real defect — wabt-ts's folded `if` kept
only the LAST instruction of its condition slot and silently dropped the input (`94273c7f6`).

### How to apply

- A parser that reads folded form must read EVERY instruction parenthesised with fewer folded
  operands than it consumes, taking the rest from the stack.
- A claim about what text can express is checked against upstream `wat2wasm` before it is written
  down — it is the authority on the text format, and a probe costs a minute.
- **A WRITER applies it too** (W11, 2026-09-19, `0ec356fa5`): folded `wasm2wat` declined ~30
  instruction kinds and wrote them — and the whole expression around each — linearly, 3,174 lines
  over the corpora. Every plain kind now nests its operands (`ExprVisitor.visitShallow` gives them in
  evaluation order), `try_table` folds, a `pop` writes nothing, and only operands with SCATTERED
  placeholders fall back to folded siblings `(a) (b) (op)`. A writer never falls back to linear.
