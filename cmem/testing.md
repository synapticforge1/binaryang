# Testing

Merged topic file (§2.2). Supersedes `binaryen-ts/testing.md` and `wabt-ts/testing.md` as the
statement of how binaryang is tested. The per-invariant detail — which regression test pins which
bug — is in [wabt-ts.md](wabt-ts.md) and [binaryen-ts.md](binaryen-ts.md).

Unblocked by §2.1: until `scripts/release/` existed this file would have described two release
gates.

## Running

```sh
deno task check        # type-check src/ + main.ts + tests/ + scripts/
deno task test         # the full suite — 1265 tests / 0 ignored (2026-09-19); 1043 (2026-09-12); was 912 tests / 3153 steps / 2 ignored (2026-08-27)
deno task fmt:check    # format
deno lint
deno task ci           # check + test
deno task publish:dry  # JSR manifest + slow-types, WITHOUT publishing
deno task baseline     # emitted-byte baseline — IDENTICAL, or exit 1 naming the files
deno task collisions   # convergence indicator (reported, never gated)
```

⚠️ **A count in prose goes stale silently.** The wabt-ts wing carried three successive test counts,
one of which went stale the same day it was written. Treat the number above as the date it carries;
`deno task test | tail -1` is the only current answer.

**`publish:dry` belongs in the gate whenever a change ADDS or MOVES an exported symbol.** It is the
only step running JSR's slow-types check — moving one constant into another file made it public API
without an explicit type, and 339 passing tests plus three metric runs never saw it.

## ✅ The `deno fmt --check` line-ending false alarm is RETIRED

The wabt-ts wing carried an elaborate apparatus for working around it: a `diff` incantation that
strips carriage returns and re-passes the project's formatter options, a scratch-checkout recipe, a
warning that `git archive` applies the same conversion, a rule to copy files aside rather than
`git stash` before revert experiments, and a note that a Python edit must preserve line endings.

**All of it is obsolete here.** `.gitattributes` pins `* text=auto eol=lf`, so `deno fmt --check`
now reports what it means. Its full text keeps those sections as history.

⚠️ **The revert-experiment habit survives the fix and is still worth keeping**: run
`git diff --stat` after any revert experiment. It is one line, and it catches a restore that
silently rewrote a file long before you read the diff. See [best-practices.md](best-practices.md).

## Test tree

`tests/binaryen-ts/` · `tests/wabt-ts/` · `tests/bridge/`, each mirroring its `src/` counterpart.

⚠️ **`deno task test` enumerates those three directories by name.** A fourth top-level test
directory will not run until it is added there — `tests/bridge/` needed exactly that when the bridge
moved, and the whole bridge suite would have gone quiet without it.

### `noUncheckedIndexedAccess` is ON at the root, OFF in `tests/binaryen-ts/`

In `src/` an unchecked index that turns out to be `undefined` becomes wrong bytes in a `.wasm` —
this project's worst failure mode. In a test it becomes a failed assertion, which is the test
working. `tests/binaryen-ts/deno.json` is a workspace member existing only to turn it back off.

⚠️ **Omitting the key does not reset it.** A workspace member inherits the root's `compilerOptions`
and merges its own over them, so an omitted override looks like it works right up until you check
the error count and find it unchanged. It must be written out as `false`.

The asymmetry is not repo-wide: `tests/wabt-ts/` and `tests/bridge/` are not members and run under
the strict flag, as does `scripts/release/`. Only the tree that would have needed ~420 `!` edits
opted out.

## Proving a refactor changed nothing: `deno task baseline`

`scripts/wabt-ts/pre-merge-baseline.tsv` records, per corpus file, the byte length and hash of
`wat2wasm` output and the hash of `wasm2wat` text — **421 files, 1,557,602 bytes**.

**It is deliberately not a test.** It pins emitted bytes, so a genuine encoder improvement is
_supposed_ to fail it. In the gate, the right answer would become "relax the assertion", which is
how a baseline stops meaning anything. **Re-baseline in the same commit as such a change, and say
why in the message.**

Verified in both directions, which is the standing rule for any check: `IDENTICAL` on an unchanged
tree, exit 1 naming the file when one byte-count or hash is altered.

## The corpora, and what each is for

| corpus                  | what                                         | state                                                                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream/test`         | binaryen's own suite, for parse→encode→parse | the reading-room clone, OUTSIDE the repo at `wasmExamples/binaryen-ts/upstream/test`. The test looks in both places and SKIPS only when neither exists, so CI is unaffected. 🔧 It had silently skipped from the merge until 2026-09-12 — see "Independent oracles" below |
| `tests/wabt-ts/wasmtk/` | 421 real-world WAT files from wasmtk         | present; the runner picks up any file dropped in, and a reverse-direction runner asserts the disassembly re-compiles                                                                                                                                                      |

### The wasmtk corpus is a SNAPSHOT, and that has cost real credibility

Stamped and gated — `provenance.test.ts` fails if the source commit, date or file count stops
matching. **It has still produced three wrong reports to the wasmtk team, all caught by them rather
than by us.**

**Rule: regenerate from the wasmtk checkout before validating against another runtime or stating
anything about wasic.** The snapshot supports _"our toolchain handles this shape"_. It does not
support _"wasic emits X"_ or _"wasic has bug Y"_ — we made exactly that claim about seven modules
already fixed upstream.

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

## The behavioural harnesses

**`tests/binaryen-ts/passes/optimize_fuzz.test.ts`** — every optimizer bug in the WT series was a
_behavioural_ miscompile: valid wasm, wrong value, which validity checks never catch. Seeded,
deterministic, CI-safe; bisects the pipeline to name the first offending pass.

⚠️ **Its reach is narrower than it looks.** Measured: zero `makeLoad`, zero `makeBreak`, no SIMD or
GC nodes — so it could not have constructed either defect from the duplicate-dispatcher sweep.
**Grep the harness for the node kinds it emits before assuming it covers a new construct.**

**`corpus_roundtrip.test.ts` holds one binary to byte identity instead of an engine verdict**
(`ENGINE_UNSTABLE`, `57b16a115`, 2026-09-18): V8 in Deno 2.9.7 has no stable verdict on binaryen's
`lit/control-flow-input.wast.wasm` (legacy + new EH mixed) — 39 of 40 `compile` / `validate` calls
rejected it, and two of three probe runs crashed Deno (`!job->compile_imports_.empty()`). If a Deno
upgrade fixes the engine the set can go; if another binary starts flaking, probe it the same way
before adding it.

**`scripts/binaryen-ts/equiv_check.ts`** — not a test, a script. Two stubbed instances driven by the
same call sequence stay bit-identical iff optimisation preserved semantics. Surfaced six miscompiles
a validity-only benchmark had called "valid".

## The release path is tested, and needs two tests

`scripts/release/publish.ts` **cannot be imported by a test** — it stages, tags and pushes at import
time. Its decisions therefore live in `scripts/release/release-guard.ts`.

**Both tests are needed.** `release_guard.test.ts` covers the LOGIC;
`publish_preflight_wiring.test.ts` covers the WIRING — that `publish.ts` imports and calls the
guard, that it exits rather than warns, that no mutating git subcommand runs before it, and that
`scripts/` stays in the gate. Deleting the guard block leaves all twelve logic tests passing, which
is exactly what the original defect was: **the logic was absent, not wrong.**

## CI gate

`.github/workflows/ci.yml` runs `deno fmt --check`, `deno lint`, `deno task check`,
`deno task test`, the two binding-rule scripts, `deno task baseline`, `deno publish --dry-run`, and
the convergence indicator (reported, ungated). Plus a CLI matrix on Deno, Node 22.18, Node 24 and
Bun 1.4.

**Test files ARE type-checked**, and that was once a real gap: `deno task test` runs `--no-check`
and `check` once covered only `src/`, so test files were type-checked by no task at all. Closing it
surfaced seven latent type errors, one a genuinely wrong fixture that passed anyway because it
asserted a throw that fires regardless of its arguments. **When adding a task that validates
something, check what it actually walks.**

`scripts/` is in the gate too. Until it was added, the file that publishes immutable artifacts was
type-checked by nothing.

🛑 **And then a local gate dropped it again.** The S6 verification list was
`test · baseline · operators · spec · bridge` — no `check`, and `test` runs `--no-check`. So
`abddf1206` left two `scripts/` files uncompiled, and `main` stayed red by CI's standard for 65
unpushed commits. **Use `deno task ci` (check + test), never `deno task test` alone**, and see
[best-practices.md](best-practices.md) "The local gate must BE CI's gate".

## ⚠️ Every test-file path in the wing full texts is DEAD

The merge normalised the naming from `foo_test.ts` to `foo.test.ts`. **Zero `*_test.ts` files exist;
all 172 are `*.test.ts`** (230 by 2026-09-12, still zero of the old form) — and the two wings
between them contained **58 references to the old form**, every one an unfollowable path.

🔧 The summaries ([wabt-ts.md](wabt-ts.md), [binaryen-ts.md](binaryen-ts.md), 2026-09-14) rewrote
every path to today's tree and checked it. The full texts behind their `git show` commands were not
corrected: they are not wrong about _which_ test pins an invariant, but their paths cannot be
copy-pasted. Translate the name, and confirm the file exists before citing it — two of the paths in
this very file were carried over from a wing and had to be corrected the same way.

## ✅ A3 — diagnostic offsets are MEASURED (2026-08-31)

`scripts/measure-diagnostic-offsets.ts` / `deno task offsets`. The axis was UNMEASURED, not clean,
because T13.35's oracle was broken and no replacement was built. This is the replacement.

### Why the first oracle failed, and what replaced it

T13.35 asked _is the reported offset near the corrupted byte?_ — and scored the right answer as
wrong: for a malformed multi-byte construct, reporting the **start of the construct** beats
reporting where the decoder stopped. It flagged 32 cases and every one examined was correct.

The replacement **reports a distribution, not a verdict**, because what the first attempt got wrong
was believing one number could carry the judgement. Method: flip each byte of a valid module,
decode, and record `delta = reportedOffset - corruptedByte`.

### The reading

|                                                           |                         |
| --------------------------------------------------------- | ----------------------- |
| corruptions swept                                         | 196 across five modules |
| rejected                                                  | **195 (99.5%)**         |
| accepted, and V8 accepts too (legal alternative encoding) | 1                       |
| accepted while V8 rejects — **missed rejections**         | **0**                   |

Of the 154 rejections carrying a _specific_ diagnostic: **133 land at the construct**, 21
downstream, 0 upstream.

### Three calibrations the harness needed, each of which changed the answer

1. **`pos` is the position AFTER the failing read**, so a report "at" the corrupted byte lands a
   read-width later. Treating `delta == 0` as the only good answer is T13.35's mistake in new
   clothes; the band is `1..4`.
2. **Corrupting a LENGTH field makes the reader run to end-of-input**, reporting at the buffer end.
   That delta is `length - at` — an artifact of _where_ the corruption sits, carrying nothing about
   diagnostic quality. 21 of 175 were this, and unbucketed they dominated the distribution.
3. 🚨 **Comparing our READER against V8 is an unfair oracle.** V8 decodes _and_ validates; a reader
   that defers a semantic check to the validator is not defective. The first reading claimed
   **twenty** missed rejections. Adding our validator stage dropped it to **five**. **Three quarters
   of that finding was the instrument.**

### What it found

All five survivors were the same field: **the export section accepted any byte as an export kind.**
`readExportSection` did `this.readU8() as ExternalKind` — a cast asserts a fact about the byte
instead of checking it — while the import section beside it had always carried a
`default: unknown import kind` arm. The two dispatches disagreed and only one was wrong.

Fixed, with `tests/wabt-ts/reader/export_kind.test.ts` gating it (verified to fail with the check
removed). Missed rejections **5 → 0**, and the one legal alternative encoding is still accepted.

### The blind spots, stated

- **Five hand-written modules**, not a corpus. It spans single-byte fields, multi-byte LEBs, nested
  control, GC types and element segments — and it is still five.
- **Single-byte corruption only.** Truncation, insertion and multi-byte corruption are unmeasured.
- **`delta` is not correctness.** A negative delta is usually the better diagnostic. The 21
  downstream cases are all body-internal corruption noticed at the section or function end, which is
  explainable rather than obviously wrong — nobody has judged them one at a time.
- **The accepted class outranks the offset numbers**, and the harness says so in its own output.

## ✅ Diagnostic usefulness — MEASURED (2026-09-29, open-work 16)

`scripts/measure-diagnostics.ts` / `deno task diagnostics <prepared spec dir>` (`--templates` lists
every message shape by count). Reported, not gated. The one hardening axis never attempted: not "is
the message the spec's" (wording) or "where does the reader point" (A3), but **can a user act on the
line the CLI prints?**

⚠️ **The lesson: measure what the user READS.** Wording and offsets were both green while every
binary diagnostic printed `file:0:0` — both instruments read the `loc` / `message` FIELDS, and the
renderer threw the offset away between the field and the screen. This instrument renders each
must-reject case through the tool a user would run (`wat2wasm`; `wasm-validate`), with a filename,
exactly as `formatErrors` prints it, and scores the first error line.

| over the spec's 4,654 must-reject cases              | before  | after    |
| ---------------------------------------------------- | ------- | -------- |
| decode diagnostics LOCATED                           | 0%      | 99.6%    |
| validate diagnostics LOCATED                         | 0%      | 98.6%    |
| a PLACEHOLDER subject (`type mismatch in opcode`)    | 420     | 0        |
| malformed binaries reporting more than one error     | 81      | 0        |
| a JS-internal leak / a throw instead of a diagnostic | 0 / 0   | 0 / 0    |
| spec wording agreement (parse · decode · validate)   | 811 · 693 · 2465 | unchanged |

The defects, DG1–DG6 in [divergences.md](divergences.md): the renderer's location (DG1), the
placeholder subjects (DG2), the reader never stopping at its first error because `stopOnFirstError`
defaulted the wrong way and `wasm-validate` validating a half-decoded module (DG3), `wasm-opt` not
validating its input and so blaming the optimizer (DG4), and the source line + caret the CLI now
prints under a text error. Each fix was inverted alone against `diagnostic_usefulness.test.ts`: 8
mutants, 8 killed, each by its own test. The first fixture for DG3 let its mutant survive — once
the reader stops early, a module truncated after its last body gives the validator nothing to
object to; a cut INSIDE the code section does.

**The blind spots, stated:**

- **Mechanical properties only.** Located / named / clean / alone say a message is usable, not that
  it is the clearest one. `--templates` groups ~4,600 messages into ~200 shapes for a person to read;
  no person has read them yet.
- **40 cases are still unlocated**: `duplicate export` (20) and index-out-of-range on exports — the
  export entries carry no location — plus 3 `unexpected end of binary` at offset 0.
- ~~`wasm-opt` on WAT shows no position for a validation error~~ — ✅ since DG5 closed (the same
  day), a WAT input is validated as text, at `line:col` with the source line.
- **The CLI's flags and usage messages are unmeasured** — only diagnostics on bad modules.

## Independent oracles — our two implementations checking each other is blind by construction

⚠️ **Nearly every invariant in this project compares wabt-ts against binaryen-ts — our own two
implementations.** That is excellent at finding disagreements (it found ~20 defects across the 1.5.5
passes) but **blind by construction** to two things: anything both get wrong the same way, and any
input neither of them produces. The tools that reach past it are installed; the list is in
[working-rules.md](working-rules.md) § "Installed oracles".

**Proved on first use.** Against 511 third-party binaries from the wasmtk suite, exactly one failed
— a Go-compiled `strlib.wasm`. The binary reader read an `if`'s blocktype, computed its result type,
and discarded it with a literal `void resultType;`; `makeIf` infers from the arms instead, which is
right until BOTH arms are unreachable. No module in the 421-file corpus has that shape, so no amount
of re-running it would ever have found this (`if_declared_result.test.ts`). It also confirmed
empirically that `blockType`-as-declared is the most load-bearing member of the as-written set
([ir-convergence.md](ir-convergence.md)): its absence emitted an invalid module on real code.

🔑 **Keep reaching for upstream on every byte-level claim.** It paid twice on 2026-09-04: upstream
`wat2wasm` confirmed our multi-memory bytes were right before a defect was diagnosed from them, and
confirmed the wide-arithmetic encoding before binaryen-ts gained it. Our own second implementation
would have agreed with the first and proved nothing.

### Standing results — so a new harness adds an axis rather than repeating one

| oracle                                          | result                             |
| ----------------------------------------------- | ---------------------------------- |
| upstream `wasm-validate` on our binaries        | 421 / 421                          |
| upstream `wat2wasm` on our FOLDED output        | 421 / 421                          |
| upstream `wat2wasm` on our LINEAR output        | 421 / 421                          |
| 511 foreign `.wasm` read and re-encoded valid   | 511 / 511                          |
| wabt-ts `wat2wasm` bytes == upstream (W5, W6)   | 421 / 421, outside custom sections |
| `wasm-tools` on our labels and field names (N2) | see [names.md](names.md)           |
| V8, per operator, on the evaluator's numeric core | 136 / 136 scalar instructions (2026-10-07; one defect found first) |
| the spec manifests' `expected` on the interpreter (`deno task interp`) | 32,618 pass, 0 FAIL, 25,012 stopped (2026-10-07, E3c) |
| wasmtk's gate on 1.7.1: our `wasmValidate` on every module the spec asserts VALID, 288 files | **0 rejected** — their guard, inverted by them (`defaultFeatures()` flags 3 valid GC modules); they now use our validator as a second `assert_invalid` oracle where V8 cannot judge. 2026-09-29, [handoffs.md](handoffs.md) § 18 |

### Byte parity with upstream `wat2wasm` — 146 → 400 → 421 of 421

⚠️ **`--enable-all` makes upstream `wat2wasm` emit bytes NOTHING else reads** — measured 2026-09-19
while pricing `-Oz` sizes. On `11_logging.wat` it writes the **compact import section** form (the
module name once, an empty field name, marker `0x7f`, then a count and the grouped entries) instead
of one entry per import. That form is an unratified proposal: binaryen 132 refuses it
(`compact imports not supported (at 0:95)`, and with `--all-features` the misleading
`bad import kind (at 0:128)`), **V8 refuses it**, and our reader refuses it precisely —
`unknown import kind 0x7f (at offset 0x5f)`, the same offset binaryen names. Our own `wat2wasm`
never emits the form, so our bytes optimize fine where wabt's do not. The lesson for any harness
that chains the oracles: **`wat2wasm --enable-all | wasm-opt` is not a valid pipe** — assemble with
the features the file needs (`--enable-exceptions` etc.), or assemble with ours. A run that skips the
module quietly, as the first size script did, reports a number computed over a corpus it never read.

The byte baseline pins our OWN output, so it was blind to every divergence older than itself;
wabt-ts's parity with upstream `wat2wasm` had never been measured. Measured 2026-09-10 with default
features (`--enable-all` changes what upstream EMITS): **146 of 421 identical** — 242 differed in
the DataCount section alone, the rest in type / function / code / tag sections. Re-measured
precisely the next day: those "other" differences were the 21 exception-handling modules upstream
cannot assemble without `--enable-exceptions`.

| after           | identical, outside custom sections | commit (re-baseline)      |
| --------------- | ---------------------------------- | ------------------------- |
| W6 — DataCount  | 400 / 421                          | `cb474baaa` (`5dbe951f1`) |
| W5 — type order | **421 / 421**                      | `bd327efe7` (`232768359`) |

⚠️ **Since S7 (2026-09-19)** "outside custom sections" matters: by default our `wat2wasm` adds a
`binaryang.text-form` section to sources written other than as the plain nested fold — linear, or
any mix (75 of these 421 since the per-instruction record, `b366262ce`; 20 when it was per
function) — a DESIGN divergence, owner-decided; `--no-text-form` gives upstream's bytes exactly, so
parity with that flag is 421 / 421 whole-file.

The name sections, compared on their own, are equal on 426/426. Parity is now total on this corpus,
so **any new difference is a regression or a new divergence, and gets a row** in
[divergences.md](divergences.md). Details of both fixes are their rows there; W5's implicit types
are indexed by the PARSER at module end, through a `makeTypeInterner` shared with `synthesizeTypes`.

The upstream-wabt oracle's REACH LIMIT is above ("An oracle that cannot reach the feature must be
SAID to not reach it"); `wasm-tools` 1.259 reaches GC text, labels and field names, and has its own
gaps (divergence G4).

### A SKIPPED test and a NARROW guard fail the same way — silently (2026-09-12)

Found by asking what the suite's "2 ignored" were. **Read what a passing test MEASURES, not what it
is named — and check the ignored count, every time.**

- **`corpus_roundtrip` (91 upstream binaries) had been skipping since the MERGE.** It looked for the
  reading-room clone at `<repo>/upstream/test`, and the clone stayed BESIDE the merged repo, in
  `wasmExamples/binaryen-ts/upstream/test`. It now checks both paths (`456423b54`).
- **Then it turned out not to guard what its doc claimed**: `summary()` counted 4 of the 9 index
  spaces, so deleting the entire EXPORT section from the encoder still passed it. It now counts
  every space and compares the whole record.
- **The other ignored test was ALSO broken.** The live `npm:binaryen` interop test, gated on
  `BINARYEN_LIVE=1`, had never run — and failed when enabled. Its fixture was LINEAR WAT while
  `deno.lock` resolved `npm:binaryen@116`, whose old s-expression parser reads FOLDED only:
  `parseText` aborts the Emscripten process with `exit(1)`, which poisons the exit code for the NEXT
  live test too. binaryen 132 (the `wasm-opt` on PATH) reads both. Both live tests now run on
  availability rather than an env flag: **1043 passed, 0 ignored** (`cec3a3381`).
- ⚠️ **A probe that imports `npm:binaryen` from OUTSIDE this project resolves 132** and says linear
  is fine — the probe and the test were both right about different binaryens. Pin the version in the
  probe, or compare `npm:binaryen@116` and `@132` side by side, which is what settled it.
- 🛑 **The follow-up pin commit did the opposite of its message.** `b8fafaa3f` said `npm:binaryen@*`
  → 132.0.0; its diff deleted the 132 entries and left `@*` → 116.0.0, and the suite stayed green
  only because the same commit made the fixture folded, which 116 also reads. 🔑 **The hole was the
  BARE specifier** — `import('npm:binaryen')` names no version, so the lock may answer anything. The
  version now lives in the SOURCE, `const BINARYEN = 'npm:binaryen@132'`, one constant for the probe
  and both live cases, where Deno enforces it (`dea8ff9cf`). See
  [best-practices.md](best-practices.md) § "A written result is a CLAIM".

## The spec-testsuite harness — the must-REJECT axis

**Owner-assigned 2026-09-02, built `c1c24c9d3`**: `deno task spec:prepare` then `deno task spec`.
Moved here from `open-work.md` on 2026-09-14, where it had been recorded while it was the open item.

The source is 257 `.wast` files in the sibling wasmtk checkout, at
`wasmtk/tests/module/wasm_wast/testsuite-main` (its absolute path on the development machine is in
the private `cmem/local/environment.md`). ⚠️ **READ ONLY**: it is a sibling repo, so never write
there; copy to scratch if a tool might. Rebuilding the corpus each session:
[working-rules.md](working-rules.md).

🔑 **It tests an axis nothing here had EVER tested: whether we correctly REJECT.** Every invariant
before it asked "do we accept valid input correctly" — and a tool that accepts everything scores
perfectly on all of them. The suite contains **4,654 must-reject cases**:

| assertion              | count     | what it demands                           |
| ---------------------- | --------- | ----------------------------------------- |
| `assert_return`        | 52,591    | the module runs and returns a given value |
| `assert_trap`          | 4,977     | it traps                                  |
| **`assert_invalid`**   | **2,714** | the module **must fail validation**       |
| **`assert_malformed`** | **1,940** | the text **must fail to parse**           |
| `assert_unlinkable`    | 200       | instantiation must fail                   |

`wast2json` splits each file into modules plus a JSON manifest of its assertions — that is the way
in; do not hand-parse `.wast`.

### First run: the must-reject axis came out strong

Fail-loud holds up under a suite designed to attack it.

| axis                           | result                 |
| ------------------------------ | ---------------------- |
| modules ACCEPTED (must accept) | 1951 / 1955 · 99.8%    |
| `assert_invalid` REJECTED      | 2420 / 2422 · 99.9%    |
| malformed BINARY rejected      | 711 / 711 · **100%**   |
| malformed TEXT rejected        | 1156 / 1156 · **100%** |

227 of 257 files; the 30 skipped were GC-proposal files `wast2json` 1.0.41 cannot split (G2, closed
below).

### All six findings closed by ONE fix — `3445d978a`

SP1–SP4 were one root cause. **`BlockType`'s value case was typed `Type`** — a flat numeric enum
whose values are single wire bytes. A typed reference does not fit: `(ref ht)` encodes as `0x64`
FOLLOWED BY a heap type. The reader took the tag and left the heap index in the instruction stream,
where the next decode step consumed it as an OPCODE:

```
(block (result (ref 0)) (ref.func 0))
  upstream : block (result (ref 0)) / ref.func 0
  ours     : block <type 100> / UNREACHABLE / ref.func
```

🔑 **BYTE EQUALITY IS NOT SEMANTIC EQUALITY, and this is the proof.** It round-tripped
byte-identically — the writer emitted that phantom `unreachable` as the very byte it had been
mis-read from, so the two halves of one gap concealed each other. **The corpus round trip at 421/421
byte-identical, the strongest signal this project had, was blind to an IR containing an instruction
the program does not have.** A phantom `unreachable` makes everything after it dead code, so any
pass reading that IR reasoned about a different program. The spec suite saw the same gap from the
other side: a heap index never stored can never be range-checked, so two INVALID modules were
ACCEPTED, and SP1–SP3's "type mismatch" errors were the missing heap type breaking type-checking
downstream.

| axis                      | after                  |
| ------------------------- | ---------------------- |
| modules ACCEPTED          | 1955 / 1955 · **100%** |
| `assert_invalid` REJECTED | 2422 / 2422 · **100%** |
| malformed BINARY          | 711 / 711 · **100%**   |
| malformed TEXT            | 1156 / 1156 · **100%** |

### SP5 — and the finding as first written was half wrong

It was recorded as "`Features.compactImports` and `.wideArithmetic` are declared but the binary
reader does not implement them" — one claim covering two unrelated situations, and **neither had
been checked**.

- ✅ **`wideArithmetic` is FULLY implemented in wabt-ts** — `i64.add128` / `sub128` / `mul_wide_s` /
  `mul_wide_u` decode, validate, write and round-trip byte-identically.
- ⚠️ **`compactImports` was worse than unimplemented**: declared, settable, returned `true` by
  `allFeatures()`, and read by nothing. Enabling it changed nothing.

Fixed by making the flag TRUTHFUL rather than implementing the proposal, which is not planned — V8
needs `--experimental-wasm-compact-imports` to load such a module at all. The reader names the
proposal instead of `unknown import kind: 127`, and the field says plainly that setting it does
nothing. Kept rather than removed, because `Features` is public surface.

The one real gap it surfaced — wide arithmetic refused by binaryen-ts's binary reader
(`unsupported bulk-memory/table opcode: 0xFC 0x13`) — was assigned to S5 and **dissolved by it**
(re-probed 2026-09-12): `(i64.add128 …)` assembled by upstream `wat2wasm --enable-all` decodes
through binaryen-ts and re-encodes **byte-identically** (40B → 40B). ⚠️ Checked rather than assumed:
a shared KIND does not imply a decoded OPCODE.

🔑 **A feature flag is not an implementation** — the third "declared is not implemented" of that
session, after `ExpressionKind` members with no factory and four stale `not yet supported` blockers.
And about the FINDING: a two-part claim written from one observation. **The half with evidence was
true; the inferred half was false.**

### ⚠️ The feature set IS the design, and it was wrong twice first

- **`--enable-all` is wrong**: it changes what `wast2json` EMITS, not just what it permits. It
  produced compact-imports binaries (import kind `0x7F`) that are not standard wasm — V8 rejects
  them outright — and the harness reported **58 false "valid module REJECTED"** findings.
- **the DEFAULT set is also wrong**: only 157 of 257 files convert, silently dropping SIMD, GC,
  threads and tail calls. That reads as a pass because the failures never enter the corpus.
- **the validator needs its features passed too**: the very first run used the default set and
  reported **464 false rejections**, every one a post-MVP proposal the suite exercises on purpose.

**A corpus built with the wrong flags measures the flags, not the code.** All three configurations
are recorded in `scripts/spec-prepare.ts`.

### ✅ G2 — all 257 files run (2026-09-11, `318915973`)

`spec-prepare` falls back to `wasm-tools json-from-wast` for the 30 files `wast2json` 1.0.41 cannot
split, and the harness reads its command types: `module_definition` (a module's obligation — accept
it), and modules or `assert_invalid` cases given as **TEXT**, where `wast2json` only ever emitted
binaries. A text module is assembled and then decoded and validated, because `wat2wasm` does not
validate.

| axis                      | was (227 files) | now (257 files)        |
| ------------------------- | --------------- | ---------------------- |
| modules ACCEPTED          | 1955 / 1955     | **2248 / 2248 · 100%** |
| `assert_invalid` REJECTED | 2422 / 2422     | **2714 / 2714 · 100%** |
| malformed BINARY          | 711 / 711       | **711 / 711 · 100%**   |
| malformed TEXT            | 1156 / 1156     | **1229 / 1229 · 100%** |

🔑 **The 30 missing files were the least safe thirty to be missing**: they test the GC proposal —
the one thing this toolchain implements and upstream wabt cannot judge at all (G1, G3). The new
ground is 293 must-accept modules, 289 must-reject modules and 73 must-reject texts, and **all of
them passed on the first run.** ⚠️ **"No misses" on brand-new coverage is the shape of a harness
that is NOT RUNNING** — so it was proved otherwise: run over those 30 dirs alone they account for
exactly those counts, and corrupting one accepted module plus making one `assert_invalid` case valid
makes the harness report both.

### ✅ Behaviour — `assert_return` / `assert_trap` (was "Not yet covered"; covered since 2026-09-28)

`assert_return` / `assert_trap` — 55,993 behavioural assertions, skipped deliberately so the first
pass measured the axis nothing else measures. 🔧 **2026-09-28: they were run, as a DIFFERENTIAL, and
it found eight defects every gate had passed** (Q1–Q8 in [divergences.md](divergences.md), among
them a silent -O2 miscompile shipped in 1.5.4). For every spec `module` with invocations after it,
the ORIGINAL bytes are instantiated with inert import stubs and each `invoke` replayed; the same
replay on a plain decode → encode and on -O1…-Oz, both routes, must give the same outcome — a value
compared by bits, or a trap. The original run in V8 is the oracle, so the manifests' `expected`
values are not needed — and ours never decide them.

✅ **Now `deno task spec-behaviour <outDir>`** (2026-09-28; `scripts/check-spec-behaviour.ts`, the
check in `scripts/spec-behaviour/differential.ts`), over the corpus `deno task spec:prepare` writes.
On `main` today (2026-09-28 late): **1,342 modules with invocations, 57,808 invocations (24,151
through v128, 53 blind), 16,062 variants compared, 0 divergences, in ~8 s**. Its verdict: exit 1 on a DIVERGE (an outcome differs, or the engine refuses
our bytes) or a module that does not terminate; a variant our pipeline REFUSES (throws — loud, not
a miscompile) is allowed only for a module pinned by name in `REFUSED_BUDGET`, a ratchet like
`PHANTOM_BUDGET`. (It held 7 relaxed-SIMD modules on route A, binaryen-ts's decoder; route A left
with that decoder in 1.6.0, and the budget now holds only the `--flatten` pins below.)
⚠️ Nothing in the gate checks the manifests' own EXPECTED values — the differential needs none,
and the SIMD oracle check (24,110 / 24,115, below) was a one-off. Optional, not scheduled.

**Variants since 2026-09-28 (9 per module):** round trip; -O1, -O2, -O3, -Os, -Oz; `-Oz --converge`;
`--flatten` alone; and "minify through its map" — `…-and-modules` minification where the HOST
supplies its imports and calls its exports by the map's new names (spectest imports get the values
of the names they had), so a wrong map over self-consistent bytes DIVERGEs (two mutants, caught).
An instantiation failure is compared with the import's names removed from the message. Measured
2026-09-28: 12,061 variants, 0 DIVERGE. `REFUSED_BUDGET` is keyed by **(module, variant)** —
`'<module> <variant>'` — and holds the 17 `--flatten` refusals of `br_on_*` / `try_table`
(upstream's Flatten refuses both); a pin can no longer hide another variant refusing the same
module. Inverted: one pin removed → exit 1.

- **Inverted twice**: Q1's miscompile restored → exit 1, with DIVERGEs (`align.106`'s
  `i32_align_switch` gave 0 for 23 at -O2+ — Q1 reached further than `if.0`) and hangs;
  the multiple-tables guard restored → exit 1, 161 modules NEWLY refused.
- ⚠️ **It stops after 3 modules that do not terminate.** The first inversion ran for 20 minutes and
  12,500 CPU-seconds: a miscompiled loop never ends, `worker.terminate()` cannot interrupt a
  synchronous wasm loop, and every hang left a spinning thread behind. After the first hang the
  verdict is already a failure; the report says how many modules were NOT run.
- Its blind spots: an invocation of a NAMED module (another module's) is skipped; imports are inert
  stand-ins, so behaviour that depends on a real import is compared only as far as the stand-in
  goes (the same stand-ins on every side); a trap is compared by class, not message.
- 🔧 **v128 — the blind spot nobody had listed (closed 2026-09-28, pre-bump item 6, `cd7071629`).**
  The JS API cannot pass or receive a `v128`, so every SIMD invocation threw a TypeError on the
  original AND on every variant — and "agreed" without running: **24,151 of the 57,808**. A writer
  miscompile planted on purpose (`replace_lane` writing lane `^ 1`; `i8x16.shuffle` reversed) passed
  with 0 DIVERGE. Now `scripts/spec-behaviour/v128.ts` appends a wrapper per such export — each
  vector as two `i64` lanes, rebuilt with `i64x2.splat` / `replace_lane`, split with
  `extract_lane` — to the BYTES, the original's and each variant's alike, after the variant is made;
  hand-written, so the toolchain under test builds none of it, and nothing is renumbered. The same
  two miscompiles now fail (5 and 4 modules). The signature is the manifest's (arguments; an
  `assert_return`'s expected types, borrowed by an `assert_trap` of the same export).
  - **The wrappers were checked against an oracle that owes nothing to our code**: the ORIGINAL,
    through them, against the manifests' own expected lanes — **24,110 of 24,115** match. The 5
    others pass a signalling-NaN f32/f64 SCALAR, whose payload a JS number cannot carry — the
    existing scalar path's limit (same on every side), not the wrapper's.
  - What JS still cannot call is now COUNTED as **`blind`: 53** (a TypeError on the original),
    reported in the summary rather than agreeing unseen.
  - `spec_behaviour_v128.test.ts`; 6 mutants of the index arithmetic, all caught.

### ✅ The interpreter against the MANIFESTS — `deno task interp`, in the gate since 2026-10-07

`spec-behaviour` uses V8 as the oracle and never reads `expected`. The interpreter (open-work 23,
`src/binaryen-ts/interp/`) is a second implementation of the spec, so its oracle is the other one:
**the manifests' own `expected` values**. `scripts/check-interp.ts` replays every `assert_return`,
`assert_trap`, `assert_exhaustion` and `assert_uninstantiable` on it — bits for values,
`nan:canonical` / `nan:arithmetic` as the spec defines them, a trap by its message's prefix (D3's
rule) — with `spectest` as `spec/interpreter` defines it and `register` wiring modules together.
Same prepared corpus as `spec`; ~3 s. Owner: "yes on deno task interp" (2026-10-07).

- **Verdict: 0 FAIL.** A wrong value, a missing or wrong trap, a plain `module` whose instantiation
  traps, or a JS error out of the interpreter is a FAIL.
- **`stopped` is coverage, printed by reason** — an instruction not run yet, a host import not
  given, a `v128` argument. It should only FALL as E3's increments land; a rise is a coverage loss.
  At E3a 15,432 pass / 42,144 stopped; at E3b 25,811 / 31,819; at E3c **32,618 / 25,012**
  (2026-10-07).
- **50 M instructions of fuel per invocation**, and running out is a FAIL, not a stop: every suite
  invocation finishes (clean at 5 M), and without the limit a wrong loop HANGS the run — it did,
  under a mutant, before the limit existed.
- ⚠️ **A STOP taints shared state.** Code that stops PART WAY may already have written memory, a
  table or a global, so the state the suite's next commands assume is not there. The harness
  records which instances share state (an importer and what it imported from, both ways) and,
  when a module stops while being set up OR an invocation stops after it began, marks the whole
  group stopped from then on. Found twice: E3b's Stop on active element segments showed as two
  false FAILs in `linking.wast` (data written, then the start function traps); at E3c,
  `ref_eq.wast`'s bare `(invoke "init")` stopped on `struct.new` and 40 `eq` assertions after it
  compared nulls. A stop BEFORE running (an argument the harness cannot build) taints nothing.
  At E3c the rule holds back 2,601 assertions. And a bare `action` that traps is a FAIL — the
  suite has no expectation for it to fail.
- First runs found real defects, each fixed the same day: the exhaustion check overflowing in its
  own regex (`fac.wast`'s `fac-rec`), an imported mutable global COPIED rather than shared
  (`linking.wast`'s `Mg.mut_glob`), and a module with active element segments set up as if its
  tables were empty (now a Stop until E3c).

**The numeric core has its own oracle, V8, operator by operator**
(`tests/binaryen-ts/interp/numeric_differential.test.ts`): every scalar numeric instruction D1
lists — 136, and the test FAILS if the core answers `null` for one, so coverage is asserted, not
hoped. Operands cross the JS boundary as integer BITS and are reinterpreted inside the module,
because a float passed as a JS number can lose a NaN's payload on the way. Where the spec allows any
arithmetic NaN, both must be NaN and ours must be quiet; `abs` / `neg` / `copysign` /
reinterpretations are exact. It found `f64.ceil` of a signalling NaN returning it UNCHANGED (V8
carried the payload through `Math.ceil`) on its first run.

**Every increment's tests were mutation-tested, with the equivalents named** — E1 14 / 15 (the
survivor computes the same function: JS masks shift counts), E2 9 / 9, E3a 11 / 11, E3b 13 / 13
plus one equivalent (`copyWithin` vs `set` for an overlapping copy), E3c 15 / 15. Twice a mutant
survived the WHOLE spec suite and was killed only by a test added for it: a value BELOW a block's
parameters read after the block (E3a), and an active data segment not dropped (E3b). The other way
round once: a non-overlap-safe `table.copy` passed the unit tests and only the suite killed it —
the unit test read the slot both copies leave alike; it now reads the one they leave differently
(E3c). The runners are scratch scripts; each child gets a 90 s timeout, since a mutant may loop
forever.

### The comparison suite — `comparison/`, outside the gate (2026-09-28, `ee25accb2`)

Everything that measures binaryang AGAINST upstream binaryen (`npm:binaryen`, the `wasm-opt`
binary) lives in the committed `comparison/` directory ([its README](../comparison/README.md)):
the former `./interop` bridge, its tests, our `-O2` beside upstream's, the Asyncify differentials
(split from the native tests, which stayed — shared fixtures and driver in
`tests/binaryen-ts/passes/asyncify_helpers.ts`), and four `npm:binaryen` scripts. Run with
`deno task comparison` — 18 passed, none skipped, with `wasm-opt` v133 (2026-09-28).

- **Its tests are `*.compare.ts`**, a name `deno test` does not discover; the task names them. ⚠️
  A config `"test": { "exclude": ["comparison/"] }` was tried first and REJECTED: Deno applies it
  to explicit paths too — `deno test comparison/tests/` then found "No test modules". A bare
  `deno test` and `deno task test` both give 1,308; the suite is in neither.
- It IS covered by `deno fmt --check` (a workspace member), not by `deno task check` or `lint`.
- The split kept every native test: 1,325 → 1,308 = 19 moved out (interop 14, hybrid 2,
  asyncify differentials 3) + 2 added (native `-S`, the `--hybrid` refusal). The 19 became 18
  in `comparison/` — the hybrid pair's CLI-binary-input case had no path left to test.
- Not in it, deliberately: `wast2json` / `wasm-tools` in `spec-prepare` and `translate-eh` —
  they SPLIT test inputs for the gate and compare nothing.

### ⚠️ `allFeatures` is not neutral once a feature CHANGES a verdict (2026-09-28)

Custom descriptors (5a) relaxes `br_on_cast`'s `rt2 <: rt1` to "one hierarchy" — the first feature
here that makes invalid code valid rather than only permitting new code. With it in `allFeatures`,
the gate's `spec` step dropped to **2708 / 2714** assert_invalid (six `br_on_cast(_fail).wast`
modules). The top-level suite is written against the core rules; the proposal's own copies carry
the relaxed ones. `scripts/spec-testsuite.ts` now runs `{ ...allFeatures(), customDescriptors:
false }` → 2714 / 2714. **A future proposal that changes a verdict joins that exclusion**, with its
own suite run under it.

### The proposal testsuites (`proposals/`) — IN the gate since 2026-09-29

🗓️ **Owner, 2026-09-29: both halves, V8's experimental flags included**, accepting that a future
Deno may need a flag adjusted. `deno task proposals <testsuite-main> <outDir>`
(`scripts/check-proposals.ts`) prepares each `proposals/<name>`, runs VALIDITY
(`spec-testsuite.ts --proposal <name>`) and BEHAVIOUR (`check-spec-behaviour.ts --proposal
<name>`, in a process started with that proposal's `--v8-flags`). ONE table says what each needs:
`scripts/proposals.ts` — its feature set, its flags, and why an engine cannot run it.

| proposal           | validity (accept · invalid · malformed bin · malformed text) | behaviour                                | V8 flag                                  |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------- |
| custom-descriptors | 93 · 157 · 111 · 16                                          | 488 invocations, 19 modules, 0 DIVERGE   | `--experimental-wasm-custom-descriptors` |
| custom-page-sizes  | 41 · 19 · 108 · 4                                            | 31 assertions × 7 worlds, LOWERED (below) | none exists — lowered instead            |
| threads            | 114 · 93 · 0 · 19                                            | 321 invocations, 14 modules, 0 DIVERGE   | none needed                              |
| wide-arithmetic    | 2 · 8 · 0 · 0                                                | 99 invocations, 2 modules, 0 DIVERGE     | `--experimental-wasm-wide-arithmetic`    |

**Feature sets are the suite's, not ours.** Every feature on, except what a suite predates or a
proposal turns on: custom descriptors ON for its own suite (the core harness turns it off — it
relaxes `br_on_cast`); `multiMemory` OFF for threads, which predates it and asserts "multiple
memories" invalid five times. With our core set, custom descriptors read 36/93 accepted and threads
5 false accepts — the harness, not the validator.

⚠️ **The flag hazard, and its guard.** A flag Deno's V8 no longer knows is only WARNED about; the
original and every variant then fail to compile ALIKE, which the differential used to count as
`agree`. Since 2026-09-29 an original the engine refuses is `blind` and FAILS the run ("engine
refused ORIGINAL" — 0 across the core suite's 1,342 modules). Inverted: withholding the flag fails
wide-arithmetic (2 refused) and custom descriptors (15).

**What its first run found** — four defects that emitted INVALID modules, every other gate green
(the 2026-09-28 scratch harness had run our ROUND TRIP only, never an optimized variant): a value
under a `br_on_*` spilled at every -O level (Q10), and inlined past at -O3 (Q11), a multi-result
call operand inlined at -O3 (Q12), and `--flatten`'s inexact temporaries for exact allocations
(Q13, open-work 9) — [divergences.md](divergences.md). Q10–Q12 are not descriptor-specific
(`br_on_passthrough.test.ts` uses plain `br_on_cast`); the core suite has no such case. Pinned: 14
`--flatten` refusals of `br_on_*`, as the core suite's.

**custom-page-sizes behaviour — on V8, LOWERED.** V8 15.0 has no support and no flag. Two routes
were measured (wasmtime 49 runs the `.wast` as written; or lower to 64 KiB pages) and 🗓️ **the
owner chose lowering, 2026-09-29: "we want V8 to be able to run it. That is the whole point of
wasmtk, in that it runs everywhere."** So it is a FEATURE, not a test aid:
`LowerCustomPageSizes` (`wasm-opt --lower-custom-page-sizes`,
`src/binaryen-ts/passes/lower-custom-page-sizes.ts`; its design is in the module doc).

`scripts/check-lowered-page-sizes.ts` (run by `deno task proposals`): the original cannot run on
V8, so the oracle is the spec's expected values, in SEVEN worlds — lowered as read, round trip,
-O1 … -Oz — each optimized BEFORE lowering, so our optimizer is judged on real custom-page
memories and the lowering on everything. 🔧 An earlier note here said lowering "would test the
lowering more than the module we emit"; running the optimized variants first is the answer to it.
Every `module` must instantiate (the linking ones included), all **31** assertions (27
`assert_return`, 4 `assert_trap` — every one in the suite) hold in every world, and the 2
`assert_unlinkable` must fail to link. 4 `module definition`s exceed V8's OWN memory64 cap (262,144
pages — the default-page-size one at `memory_max_i64.wast:18` too, which lowering does not touch);
for those our validator judges the lowered bytes instead.

✅ **P1 — closed by the owner's decision (2026-09-29): no pins.** Under its own name a lowered
memory linked to a NATIVE 64 KiB importer (`custom-page-sizes-invalid.wast:104`), which could then
read and write past the logical size without a trap — not unsafe to the engine (it still
bounds-checks the underlying memory), but the proposal's guarantees lost. A lowered memory is now
exported and imported as `<name>#pagesize=<ps>`, so that link fails as the proposal says, and both
`assert_unlinkable`s hold in every world. The ratchet (`LINKS_ANYWAY`, now empty) is what demanded
the pin go. Working through the question also found L2 — `grow` exposed unzeroed slack a host
could have written — [divergences.md](divergences.md) P1, L2.

Unit tests: `lower_custom_page_sizes.test.ts`, V8 with no flag — sizes, growth across a 64 KiB
boundary and to the declared max, traps at the TRUE size, operand order before a trap,
`memory.copy` / `fill`, a 64-bit memory, active segments, `#pages` linking, the shared refusal. 8
mutants, 8 killed.

### Do we need upstream `wast2json`? (measured 2026-09-28)

Two uses, both in this repo (the workspace's other repos only mention it). **`spec-prepare`**:
`wasm-tools` 1.259 `json-from-wast` split **all 257** top-level files on its own — `wast2json` is
not needed there (the fallback already exists for 30; the command types differ, and the harness
already reads wasm-tools'). **`translate-eh`**: `wasm-tools` fails all four `legacy/` files
("unknown operator" — it no longer parses `try` / `catch` / `delegate`), so `wast2json` is the only
external splitter for them. Dropping it means splitting those four with our own
`parseWastScript` (not independent of what is tested — but V8, not we, judges the result) or
retiring them.

🗓️ **OWNER, 2026-09-28: KEEP `wast2json` — for `translate-eh`.** Its value is the coverage of the
translate-to-exnref pass (then `-Oz`) on the legacy files, which nothing else has: wasmtk's gate
runs those four files too (its own splitter, no `wast2json`; baselined 15 / 10 / 39 / 25 passes,
0 skips) but only AS WRITTEN — never translated — and through its pinned binaryang, not `main`.
Nothing binaryang ships runs `wast2json` (no reference in `src/`). Checked the same day against 5a
and the decommission: `translate-eh` needed no change (its import was rewritten by the relocation;
gate exit 0).

**And `wasm-tools`? (measured 2026-09-28)** Nothing binaryang ships runs it: `src/` and `main.ts`
spawn no subprocess at all. The ONE place it is executed is `spec-prepare`'s fallback
(`scripts/spec-prepare.ts:119`) for the 30 GC-proposal files `wast2json` 1.0.41 cannot split —
corpus PREPARATION, run when the corpus is (re)built; `deno task spec` reads the prepared output.
Every other mention (~60, in `src/` and `tests/`) is a comment or a test's EXPECTED bytes citing
wasm-tools as the reference — measured once, hard-coded, no tool at run time. The custom-descriptors
harness that used it was scratch, not in the repo. So: not needed for binaryang to work; needed to
re-prepare the spec corpus's GC files (and for any future proposal harness).

## The 1.5.5 passes — the code lens, summarized

Seven passes on 2026-09-02; the plan and the lens definitions for 1.5.6 / 1.5.7 are in
[open-work.md](open-work.md). Full per-pass register: `git show 1672c2a5a:cmem/quality-passes.md`.

**The method that found things here** — greps found NOTHING (no live TODOs; all four "impossible"
comments self-aware). What worked was **strengthening an existing metric**: the corpus asked whether
binaryen-ts re-encodes _without throwing_ (421/421, green for months); asking whether the result
_validates_ read 383/421. 🔑 **Look for a check whose PREDICATE is weaker than its name** —
"round-trips" that only assert no-throw, "agrees" that only compares lengths, counts of files
processed rather than files correct. And when a metric is raised, re-derive every number that
depended on it.

| pass | commit                   | what it found                                                                                                                                                                                                                                             |
| ---- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `e662bd099`              | memarg alignment is an EXPONENT, and its default was wrong the other way; `return` / `br` kept only their first value; `storeBytes` had drifted from `loadBytes`                                                                                          |
| 2    | `3e808b99b`              | `parseElem` was a stub that emptied every function table (still valid, then every `call_indirect` trapped); anonymous functions all synthesized as `$f0`, so `(call 1)` became infinite recursion from valid input                                        |
| 3    | `9588504bd`, `ff9a383d2` | two "size deltas" were a **silent miscompile** (a synthetic loop wrapper shadowing the function frame) and **silent data corruption** (a byte string UTF-8 encoded)                                                                                       |
| 4    | `c0d79b56d`              | `memory.init` / `data.drop` and the data count section, done together because either alone is a wrong module; six `ExpressionKind` members had nothing behind them                                                                                        |
| 5    | `d706fffa1`              | orphan type entries — the predicate is "does it write a blocktype", not "is it a block"                                                                                                                                                                   |
| 6    | `a33c94655`              | C9, one IR gap behind four symptoms: `ElementSegment.mode` — unblocked passive and declarative segments, `table.init`, `elem.drop` and six `0xFC` ops                                                                                                     |
| 7    | `a38febfc6`              | export ORDER, the last byte difference; five never-run probe classes, which found that our linear output could not be re-read (C10, first routed through the bridge `ab90d7beb`, superseded by W4's `e18d9f09a`; C10a absorbed into S6 by owner decision) |

| measure             | before       | after pass 7  |
| ------------------- | ------------ | ------------- |
| re-encode validates | 383 / 421    | **421 / 421** |
| byte-identical      | 1 / 421      | **421 / 421** |
| total size delta    | +24107 bytes | **0 bytes**   |

**Lessons it paid for**, beyond the method:

- **A size delta is not a cosmetic finding.** Both "bytes, probably benign" items in pass 3 were
  wrong output; the size was the symptom that was easy to measure. And each hid behind a natural
  fixture — a one-statement loop needs no wrapper, and ASCII round-trips through UTF-8 unchanged.
- **Unexplained is not benign.** C6–C8 stayed open as unexplained size deltas; two of them were the
  miscompile and the corruption.
- **When testing an INDEX path, the fixture must be anonymous** — a probe using named targets came
  back clean, because calls by name never touch the synthesized spelling. The named case is the
  control.
- **An enum member is not evidence of an implementation**, and a **central walker whose `default`
  throws** is what caught every omitted kind.
- **A guard can be holding up code that has never run**: lifting C9's refusal exposed an `flags & 2`
  test that was right only while declarative segments were unreachable.
- **When a test asserts a REFUSAL, write down what stays true once the refusal is lifted** — the
  third time a test pinned a limitation so that removing it read as a regression. The unknown-`0xFC`
  test moved to an unassigned sub-opcode; the passive-segment test now requires the untouched slot
  to TRAP.
- **No check that inspects a SET can see ORDER**: the interface comparison passed 421/421 while
  every function's export landed after every other kind's. It took a byte comparison.
- **A blocker naming a version is a dated assertion, not an invariant** — four stale "binaryen-ts
  v1.0.9 lacks X" blockers made a whole route look impossible, and one refused 417 of 421 modules.

## Where the per-invariant detail lives

- **[binaryen-ts.md](binaryen-ts.md) § `binaryen-ts/testing.md`** — the region matrix, the corpus
  round-trip design points, the fuzzer's hazard list, and regression-test placement per invariant.
- **[wabt-ts.md](wabt-ts.md) § `wabt-ts/testing.md`** — the conformance metrics (13 rows) with their
  blind-spot column, the hardening-axis table, the enumeration frontier, and the invariant → test
  placement table.

⚠️ **The conformance metric tables from the wabt-ts wing are a SNAPSHOT at campaign close, not a
current reading.** They were headed "now" until someone noticed — a header that silently becomes
false. The harnesses are the only current answer, and they live in a session scratchpad, not the
repo.
