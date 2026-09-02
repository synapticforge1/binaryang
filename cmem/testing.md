# Testing

Merged topic file (§2.2). Supersedes `binaryen-ts/testing.md` and `wabt-ts/testing.md` as the
statement of how binaryang is tested. Both wings stay for per-invariant detail — which regression
test pins which bug — and remain worth opening.

Unblocked by §2.1: until `scripts/release/` existed this file would have described two release
gates.

## Running

```sh
deno task check        # type-check src/ + main.ts + tests/ + scripts/
deno task test         # the full suite — 912 tests / 3153 steps / 2 ignored (2026-08-27)
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

The wabt-ts wing carries an elaborate apparatus for working around it: a `diff` incantation that
strips carriage returns and re-passes the project's formatter options, a scratch-checkout recipe, a
warning that `git archive` applies the same conversion, a rule to copy files aside rather than
`git stash` before revert experiments, and a note that a Python edit must preserve line endings.

**All of it is obsolete here.** `.gitattributes` pins `* text=auto eol=lf`, so `deno fmt --check`
now reports what it means. Read those wing sections as history.

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

| corpus                  | what                                         | state                                                                                                                     |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `upstream/test`         | binaryen's own suite, for parse→encode→parse | **gitignored and currently ABSENT.** The test SKIPS rather than fails, so it is free to keep locally and CI is unaffected |
| `tests/wabt-ts/wasmtk/` | 421 real-world WAT files from wasmtk         | present; the runner picks up any file dropped in, and a reverse-direction runner asserts the disassembly re-compiles      |

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
  four releases with four metrics green and none of them running the validator.
- **A metric measures the population its classifier hands it.** One denominator moved from 2737 to
  2683 purely because a case stopped being misclassified.

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

Deno 2.9.5 intermittently panics (`Check failed: !job->compile_imports_.empty()`), aborting the
process so the run produces **no summary line at all**. That is the danger — it reads as "the suite
did not print ok" and is easy to skip past. Re-run it; if it reproduces on the same file, _then_ it
is a finding.

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

## ⚠️ Every test-file path in the wings is DEAD

The merge normalised the naming from `foo_test.ts` to `foo.test.ts`. **Zero `*_test.ts` files exist;
all 172 are `*.test.ts`** — and the two wings between them contain **58 references to the old
form**, every one an unfollowable path.

They are not wrong about _which_ test pins an invariant, which is what those sections are for. They
cannot be copy-pasted. Translate the name, and confirm the file exists before citing it — two of the
paths in this very file were carried over from a wing and had to be corrected the same way.

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

## Where the per-invariant detail lives

- **[binaryen-ts/testing.md](binaryen-ts/testing.md)** — the region matrix, the corpus round-trip
  design points, the fuzzer's hazard list, and regression-test placement per invariant.
- **[wabt-ts/testing.md](wabt-ts/testing.md)** — the nine conformance metrics with their blind-spot
  column, the hardening-axis table, the enumeration frontier, and ~200 lines of per-invariant test
  placement.

⚠️ **The conformance metric tables in the wabt-ts wing are a SNAPSHOT at campaign close, not a
current reading.** They were headed "now" until someone noticed — a header that silently becomes
false. The harnesses are the only current answer, and they live in a session scratchpad, not the
repo.
