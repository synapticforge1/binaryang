# Testing — the convergent testing philosophy and its rules

Summary: the rules for what a metric, harness, fixture or gate may claim, each with its blind spot. Last verified 2026-11-20.
Main file: [testing.md](testing.md).

## The convergent testing philosophy

Both projects arrived at these independently, which is why they belong here rather than in a wing.

### Three states, not two: clean / measured / UNMEASURED

**Collapsing "unmeasured" into "clean" means nobody ever returns to it.**

✅ The instance this rule was written about — **diagnostic offset accuracy** — is now MEASURED; see
below. It is worth noting what the three states bought: the axis sat labelled UNMEASURED for months
rather than being quietly called clean, and when someone finally built the instrument it found a
real fail-loud defect. **A "clean" label would have closed the question permanently.**

### Every metric is blind to something — record what

A number without its blind spot invites the conclusion it cannot support. Worked examples, each of
which cost a real bug:

- **Validator agreement counts false REJECTIONS only** — it says nothing about what a permissive
  validator waves through. Twelve GC false accepts were found with that metric and six others green.
- **Byte-identical round-trip is blind to a consistently-wrong opcode mapping** — reader and writer
  agree, so the bytes match.
- **`wat2wasm` does not validate**, which is how the entire SIMD half of the validator sat dead for
  four releases with four metrics green and none of them running the validator. (The LIBRARY
  function still does not by default; the CLI does since 2026-09-29, DG5 — and turning it on found
  the validator had never taken a label by name: a text module was a population no metric fed it.)
- **A metric measures the population its classifier hands it.** One denominator moved from 2737 to
  2683 purely because a case stopped being misclassified.
- **The byte BASELINE pins our own output, so it is blind to every divergence older than itself.**
  Upstream wat2wasm is "the byte-level oracle", and wabt-ts's byte parity with it on its own corpus
  had never been measured. Measured 2026-09-10: **146 of 421 identical** — 242 differ only by a
  DataCount section upstream omits, ~33 by implicit-type order. All valid, so every validity metric
  was green. A named oracle is not an oracle until something compares against it.

⚠️ **Compare with default features, not `--enable-all`** — it changes what upstream EMITS (compact
imports), and the first run of that comparison read 51/421 because of it.

### The BYTE gates are blind to a pass that stops firing

Added from S6 step 4 (2026-09-09), where it cost two full gate cycles.

`deno task baseline` stayed **IDENTICAL** and `deno task bridge` stayed **397/421** while `LocalCSE`
was actively miscompiling — it had begun folding unrelated `local.get`s together, because its cache
key interpolated a `Var` object and every key came out `lg:[object Object]`. Neither gate exercises
that pass on those inputs, so neither could see it. The fuzz test at seed 2 and one `-Oz` pipeline
test were the only checks that could.

**An optimization that silently stops firing, or fires too eagerly, changes no bytes on any input
that does not reach it.** The corpus is a fixed set; the passes are conditional. That is the gap the
behavioural tests exist to cover, and it is the argument for keeping them in the gate even though
they are the slowest part of it.

### …and the byte gate is the ONLY thing that sees a construction defect

The mirror of the above, from the same day, and the reason both belong in the gate.

Six sites built a heap type as `{ kind: 'name', name: 'func' }` after the type gained an `abstract`
arm. That literal is a valid `Var`, hence a valid `HeapTypeRef`, so the compiler had nothing to
object to — and the behavioural tests passed, because the value is only _wrong_, never malformed.
`deno task baseline` caught it: a funcidx elem segment stopped printing its `func` shorthand.

🔑 **`baseline` compares our own bytes against our own, which looks like the weakest oracle in the
set. It is the only one that sees an IR-shape regression that changes output without changing
behaviour.** Rank oracles by what they can see, not by how independent they sound.

### When `baseline` fails, DIFF the output — a hash only says "different"

The manifest holds four columns: byte length, binary hash, folded-text hash, linear-text hash. Read
them before anything else, because they localise the fault for free:

- **binary hash unchanged, text hashes moved** → the WAT writer, not the encoder. That single
  observation cut the search to one file.
- **byte length unchanged, binary hash moved** → an encoding swap of equal width, not a structural
  change.

Then dump one affected module's output on each branch and `diff` it. `scratchpad/dump-wat.ts` does
this in one call, and it turned "30 modules differ" into `(elem $e0 … func 9)` vs
`(elem $e0 … (ref func) (item (ref.func 9)))` — the actual answer — in one step. **Re-baselining
without doing this discards the finding.**

### An oracle that cannot reach the feature must be SAID to not reach it

Upstream wabt is the standing third oracle for byte-level claims, and for GC heap types it is not an
oracle at all: 1.0.41 rejects `(ref null any)` with `unexpected token "any"`, having no GC heap-type
text support — the same limitation that makes `deno task spec:prepare` skip 30 files.

Two ways that misleads if unstated:

- A probe of it returns plausible REJECTIONS that look like findings about our code.
- ⚠️ **The feature flags can manufacture the result.** A first run with `--enable-all` showed `any`
  and `eq` rejected; the project's own `spec-prepare` notes already warn that `--enable-all` changes
  what wabt emits. Reading the error TEXT, rather than the exit code, is what distinguished "the
  keyword is wrong" from "this build has no GC support".

When the third oracle cannot reach a feature, the spec is the authority — and the write-up has to
say so, or the next reader assumes the usual oracle was consulted.

### Do not scan a whole binary for an opcode byte — DIFF two encodings

Added 2026-09-09.

The first version of `try_catch_clauses.test.ts` scanned every byte of an encoded module for
`0x07`/`0x08`/`0x18`/`0x19` and asserted the list it found. Those values are also section ids,
section lengths, type codes and LEB continuation bytes, so it collected an `0x08` from a section
header and **failed on a correct encoding**. Worse, a scan like that can equally PASS on a wrong
one, if the stray byte happens to supply the missing value.

**Build two modules that differ ONLY in the property under test, encode both, and diff them.**
Nothing else in the module can move, so the diff is self-anchoring — and it supports a stronger
claim than presence. Flipping `isRef` on the middle of three catch clauses provably moves **exactly
one byte**, `0x07`→`0x08`, which says the flag is per-clause and disturbs no neighbour. A scan could
never have shown that.

### A test that pins an internal CONVENTION records it as a requirement

Added 2026-09-09.

`wat_parser.test.ts` asserted `catchTags === ['$e', '$__catch_all']`. The encoder had never agreed —
it tested `tag === ''` — so every `catch_all` failed to encode, and the test, pinning the losing
side, made the disagreement read as intended behaviour. It was corrected to `['$e', '']` with the
message _"as the encoder requires"_: **the other side of the same disagreement, pinned the same
way.** It has now been rewritten a third time, to assert that a `catch_all` has no tag at all.

The failure was not either value. It was asserting a representation CHOICE — how "no tag" happens to
be spelled — as if it were the behaviour. Two things follow:

- **Assert the property, not the spelling.** "The handler runs", "the module validates", "the clause
  has no tag" survive a change of representation; `=== ''` does not, and resists the change that
  would have fixed the defect.
- **A test that has had to be rewritten for the same reason twice is telling you the representation
  is wrong**, not the test. Both rewrites moved the assertion; neither asked why there was a
  sentinel to assert on.

### A harness must call the real entry point

Scratch harnesses reassembled the pipeline and skipped one step, so nearly every module was rejected
for a fault the harness created. **The defect hid because a broken harness SCORES BETTER on a metric
that counts rejections.**

### Print what a harness SKIPS — a denominator is a measurement

One execution harness reported a stable, plausible 2,084 / 2,240 while executing **only nullary
functions**. The real denominator was 26,837.

### Test the SHAPE, not the instance

`tests/binaryen-ts/binary/region_body.test.ts` crosses every construct owning a region body with
bodies that fall through and bodies that exit via `br` — 25 cases, 5 of which go red if the fix is
reverted. It exists because the same bug was found FOUR times as four one-off fixtures, and none of
those ever provoked the next case. **When a bug has a shape, test the shape.**

### Four tests that need neither a corpus nor an oracle

A corpus-shaped number is only as complete as its corpus — the 257-file snapshot contains no atomics
at all, so a whole proposal sat outside every metric. These four cover what a corpus cannot:

1. **A differential between two spellings of the same thing** — folded vs linear, `$name` vs
   numeric. They must agree by construction, so disagreement is a bug and no oracle is needed.
2. **Enumerate the population from the CODE, not from files** — drive the lexer's own opcode table,
   walk every sub-opcode. Anything the code claims to support gets exercised.
3. **Test the option, not just the path** — every harness passes `allFeatures()`, which is precisely
   the configuration in which a feature gate cannot be observed.
4. **Enumerate the TYPE against the code that must be total over it** — ~30 lines of `awk` over the
   interface declarations plus a regex over the switch bodies. No fixtures at all.

**Any comment asserting a list is complete is a candidate: if the completeness claim is true, it is
testable.**

### Every test has an AXIS, and the held-fixed dimension is the new blind spot

A named-reference suite varied only _where_ the name appears, pinning every operand to a literal —
so it covered `table.get $t` and still missed a bug living in `table.get`'s _operand_. The same
enumeration came back clean across 64 interfaces while a gap was live on a different field type.

**When adding a corpus-free test, write down what it varies and what it holds fixed.**

### A fixture believed valid must be said to an engine

Asserting `wat2wasm` returned bytes is not asserting the bytes are valid. One suite did only the
latter for four releases while 2 of its 64 fixtures were invalid modules the whole time. The check
is four lines.

⚠️ **State the oracle you actually had.** Legacy EH breaks the three-engine panel — Wasmtime and
Wasmer both reject `try` outright, so V8 is the only engine that will rule on it. A fixture
asserting `v8Accepts(binary) === false` reads like a full cross-check otherwise.

### A crashed run is not a green run

Deno 2.9.5 and 2.9.6 intermittently panic (`Check failed: !job->compile_imports_.empty()`), aborting the
process so the run produces **no summary line at all**. That is the danger — it reads as "the suite
did not print ok" and is easy to skip past. Re-run it; if it reproduces on the same file, _then_ it
is a finding.

### `--filter` matches TEST names, not STEP names — an empty run prints like a clean one

`deno test --filter MALFORMED` on a file whose cases are `it()` steps inside one `describe()` ran
**nothing**: `ok | 0 passed | 0 failed | 1 filtered out`. It exits 0 and says `ok`. Verifying that a
new test fails on `main` means reading the step lines themselves (`MALFORMED ... FAILED`) from an
unfiltered run — and a check that greps the output for a summary line will pass on this one.

### A GUARDED assertion is vacuous — state the expectation, do not branch on it

```ts
const ret = mod.functions[0].body;
if (ret.kind === ExpressionKind.Return) {
  assertEquals(ret.value?.kind, ExpressionKind.LocalGet); // asserts NOTHING if ret is anything else
}
```

Decision 5 found about a dozen of these in `passes.test.ts` alone (OptimizeInstructions,
SimplifyLocals, RemoveUnusedBrs, CoalesceLocals). Once every body became a region, each would have
passed while checking nothing. They were flagged only because the narrowed type made the comparison
impossible (`TS2367`). The helpers in `tests/binaryen-ts/region_helpers.ts` — `region`, `soleInstr`,
`soleOf(body, kind)` — FAIL on the wrong shape instead of skipping it.

⚠️ **A STRUCTURAL cast accepts any node that fits.**
`body as { kind: ExpressionKind; type: string }` compiled with a region there, because a region has
a `kind` and a `type`. One such test asserted only `.type` — and a region of one block has the
block's type, so it would have PASSED while reading the wrong node, and its next line checked
`$outer` where it meant `$inner`. When a node's position changes, convert every read of it, not just
the ones the compiler flags.

The same cast also survives a FIELD RENAME.
`findSwitch(…) as { targets; defaultTarget; value:
unknown }` kept compiling after decision 6A
renamed `value` to `values`; it failed only because the assertion happened to compare `undefined`
with `null`. Had it asserted `!sw.value`, it would have passed forever. **Cast to the real node
type** (`as SwitchExpr`) and the compiler checks the field names for you.

### A replaced test must say it REPLACED, and why

`wasm_encoder.test.ts` asserted "load with a non-numeric result type throws" — a guard that existed
because the load opcode was recomputed from the type. Once the node held its opcode, that failure
became unrepresentable and the throw was deleted, so the test had to go. It was replaced by what the
new design promises (a load's bytes do not depend on its type; an untyped store operand still
encodes, diffed against its neighbour opcode) with a 🔧 note saying so. A deleted test with no note
reads, to the next person, as coverage lost.

### Invert every gate before trusting it

A check that can only say "clean" is indistinguishable from one that is blind. Break something on
purpose and confirm it still fires. The differential fuzzer's teeth were verified by reverting each
fix individually; the release-guard wiring tests by injecting all four faults.

