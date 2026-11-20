# Best practices: evidence, tests and gates

Rules about what counts as evidence: tests, gates, written results and the inversions that prove them. Last verified 2026-11-20. The other rules are in [best-practices.md](best-practices.md).

## 🆕 A written result is a CLAIM — compare it to the artifact (2026-09-12)

**Rule: a commit message, a gate report and a recorded count are claims, not evidence. Check the
thing itself — the diff, the exit code, a re-derived number — and prefer a guard that fails over a
note that is true.**

Three landed on `main` stating results the artifact contradicted, all found on one day, all by
finally looking at the artifact:

| the claim                                                       | the artifact                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `8d9ba0cb9` "pin npm:binaryen to **132** … exactly one mapping" | its diff DELETED the 132 entries; `@*` stayed **116.0.0** (fixed `9507d78b5`)              |
| `8f5945b83` / `b940e6c6b` "Gate: fmt, **lint**, ci …"           | `deno lint` failed on the committed tree, twice, from those commits (fixed `4f1fe0950`)    |
| "**27** one-sided kinds outstanding", cited for 8 days          | re-derived: **11**, and none of them a rename (S5, [ir-convergence.md](ir-convergence.md)) |

**Why each survived.** Nothing downstream reads a commit message. The suite was green — but green
says nothing about what it RAN AGAINST: the binaryen tests passed on 116 because the same commit had
switched that fixture to folded WAT, which 116 also accepts. And a stale number and a wrong number
are **cited identically**; neither carries a date or a way to fail.

### How to actually check

- **A commit's effect**: `git show <sha> -- <path>`. Read the diff, not the prose. That very
  commit's own takeaway was "check `git diff deno.lock` after version archaeology" — not applied to
  itself.
- **A gate**: its VERDICT, per step, read the way CI reads it — the exit code. (Until 2026-09-29
  the naming check was a shell script that always exited 0 and made a printed line the violation;
  its TypeScript port exits 1.) ⚠️ This line once said that script "prints a filename on success",
  which was wrong and hid a real violation for a week (2026-09-11 → 18). Check how CI judges a step
  before deciding what "green" means.
- **A pin**: put the version where the tool ENFORCES it. A bare `import('npm:binaryen')` names no
  version, so the lockfile may answer anything; `const BINARYEN = 'npm:binaryen@132'` in the source
  cannot drift. `deno lint`'s `no-unversioned-import` was flagging exactly this.
- **A recorded count**: re-derive it, then make it RATCHET (`PHANTOM_BUDGET`, `ONE_SIDED_BUDGET`).
- **A cached third-party reading**: it is a claim about the past. We told wasmtk they were on
  binaryang 1.5.2, read off JSR's dependency endpoint before 1.5.3 existed and never checked against
  their own report — they were on 1.5.3 (corrected in [handoffs.md](handoffs.md) § 10). **A cached
  third-party reading beat a direct statement from the party itself.** Ask the party.

🔑 **Every one of the three was written down correctly somewhere and still decayed, because prose
has no failure mode.** The related failure in the TEST suite — a skipped test and a narrow guard
fail the same silent way — is in [testing.md](testing.md) § "Independent oracles". The difference
from the section above: that one attributes a real result to the wrong cause; this one never checks
the result.

## 🆕 A change that silently does nothing is indistinguishable from one that worked

**Rule: make every edit, gate and guard fail loudly when its target is absent.** The expensive
defect is not the wrong change — it is the change that had no effect and reported success.

Both projects hit this repeatedly, from different directions. Gathered because the instances only
look like one class once they are next to each other:

- **the no-op:** a string replacement written **without asserting the target exists**
  - how it presented: the document's summary table contradicted its own sections for hours. The asserted edits _beside_ it succeeded, so the commit looked complete
- **the no-op:** a workspace member **omitting** a `compilerOptions` key
  - how it presented: the member inherits the root's value and merges over it, so omission leaves the root setting in force. Looks like it works until you check the error count
- **the no-op:** `git checkout-index -a -f` after adding `.gitattributes`
  - how it presented: attributes apply when a file is written, and Git skips stat-clean files. Zero of 32 were rewritten, with no output
- **the no-op:** a mutating script that **read no arguments at all**
  - how it presented: `--dry-run` performed a real bump and reported it in the same form a dry run would have used
- **the no-op:** `deno task test` **enumerating test directories by name**
  - how it presented: moving a suite makes it silently stop running. The whole bridge suite would have gone quiet
- **the no-op:** deleting a release guard's entire block
  - how it presented: **all twelve of its logic tests still passed.** The original defect was that the logic was _absent_, not wrong
- **the no-op:** pushing a tag before the branch on a new repo
  - how it presented: Actions has no workflow registered to match the event against; it passes unmatched. **A silent absence, not an error**

## Why this class is expensive

Every one produced a **green result**, so nothing prompted a second look. Several sat next to
changes that _did_ work, which is worse than failing alone: the surrounding success is read as
evidence for the whole.

And the counter-instinct is wrong. Care does not help — you cannot notice the absence of an effect
you were not shown. **Structure helps.**

## How to apply

- **Assert the precondition, always.** `assert old in s` before a replace. A replacement that finds
  nothing must raise, never return the input unchanged. This is one line and it would have caught
  the first two rows.
- **Prefer "fail if absent" over "act if present."** The two are identical on the happy path and
  opposite on the one that matters.
- **Enumerate from the source, not by hand.** A directory list, an export list, a set of test paths
  — any hand-maintained enumeration acquires a hole the next time something moves. If a comment
  claims a list is complete, that claim is testable.
- **Omission is not reset.** Wherever config merges (workspace members, layered CI, extended
  tsconfig), write the value out explicitly.
- **Invert the gate.** This is the detection half, already a rule elsewhere: break the thing on
  purpose and confirm the check fires. It is the only way to tell a passing check from a blind one —
  and note `git add --renormalize` reporting no changes was _correct_ here, yet identical in
  appearance to the broken case.

**The related-but-distinct failure** is
[attributing a result to whichever property was in
view](#-the-result-gets-attributed-to-whichever-property-was-in-view) — that one is a wrong
attribution of a real effect; this one is a missing effect reported as success.

## 🆕 A test for a fix is not coverage until it FAILS without the fix

Four fixtures for the anonymous-block label defect all passed — and all four still passed with the
fix reverted. They went through `wasm2wat --fold` first, and the writer NAMES a block it emits a
branch to, so the anonymous case the fix addressed never reached the parser. The fixtures exercised
a path adjacent to the defect and nothing in the result said so.

**The check is mechanical and takes one minute:** revert the fix, run the test, confirm it fails,
restore. Do it per fix, not per file — in the same change, reverting the `try` half of the label fix
left all 421 corpus modules passing, which is how it became clear that half had no evidence behind
it and should not be described as a fixed defect.

⚠️ **Two related traps this exposed, both about the fixture rather than the code:**

- **A round trip can normalise away the input you meant to test.** If the pipeline rewrites the
  shape before it reaches the component under test, parse the shape DIRECTLY and keep the round trip
  as a separate integration guard.
- **A fixture can fail for a reason unrelated to the defect.** Declaring any explicit `(type ...)`
  puts our encoder in GC mode, where every function signature must be declared — so a fixture
  declaring only the import's type failed with the _same diagnostic_ from a different section. The
  first reading was that the fix had not worked.

**When a test does not discriminate and cannot cheaply be made to, label it in the file as a guard
rather than as coverage.** Two of these were kept on those terms. What must not happen is a green
suite implying evidence that was never collected.

### Refinement: it must fail on the BOUNDARY, not merely go red (S6, 2026-09-09)

A test that fails against the reverted fix has been shown to fail — not to test the right thing. It
could be failing on everything.

`memory64_offset.test.ts` was checked against the truncating encoder: **5 of 7 cases failed, and the
two below 2³² still passed.** That split is the evidence — it shows the test separates the values
the defect affects from the ones it does not. A test where all seven had gone red would have proved
only that something changed.

**Include cases on BOTH sides of the boundary, and read which ones flip.** This is the same
instruction the wabt-ts wing gave for guard tests — "check WHICH steps flip" — applied to a value
range rather than a set of steps.

### Refinement: a fix that NARROWS what a component acts on can make its OLD tests vacuous (S6, 2026-09-10)

A test proven to fail once stays proven only while its input still reaches the logic it guards.
Aligning LocalCSE with upstream's `isRelevant` meant a bare `local.get` is no longer cached — and
**three of its four invalidation regression tests, plus the -Oz fixture test, were built around a
repeated bare `local.get`.** All stayed green, because CSE no longer fired on them at all. With
invalidation disabled outright they STILL passed.

**After narrowing a pass, a parser, or a matcher, re-invert every regression test of that
component** — not just the new one. Here it took one env-guarded early `return` and one run. The
three were rebuilt around a relevant compound and re-verified to fail; the fixture was labelled in
its doc as no longer covering that bug, per the guard-not-coverage rule above.

## 🆕 A test named for a rule may never REACH that rule

"Vacuum: unnamed single-child block collapses" passes with Vacuum's unnamed-block rule inverted to
one that is never true. A region whose SOLE child is an unnamed block is flattened by `asRegion`,
which `mapExpression` applies to every region slot it rebuilds — the block is gone before the pass
under test decides anything. The test asserts the right OUTCOME; something else produces it.

Two general points:

- **A test's name is a claim about which code decides its outcome, and the name is not evidence.**
  The only proof is a mutant: break the rule the test is named for and require THAT test to fail.
  Where a whole suite is green against such a mutant, the rule is untested however many tests
  mention it.
- **The shortcut path is the usual reason.** A normalizing helper upstream of the code under test
  (`asRegion` here) reaches the same result first. Reach the rule by choosing a fixture the
  shortcut cannot take — a second sibling made the region unflattenable, and the same mutant then
  failed.

A sibling case from the same stage: no fixture reached `TranslateToExnref` with an UNLABELLED
carrier, because both front ends invent a label (`$labelN` from the decoder, `$depthN` from the WAT
parser). Only the public factory `makeTry(null, …)` produces one. **A front end that always fills a
field hides every consumer's handling of that field's absence** — build the node directly, or strip
the invented value, to test what a library caller can actually construct.

## 🆕 A gate that only PRINTS its verdict is not a gate (2026-09-18)

`scripts/check-bridge-corpus.ts` printed "TOTAL" when every module passed and a list when some did not,
and exited 0 either way. Every gate run judged it by exit code (working-rules.md says to), so a failing
bridge would have read green, and the owner-facing summary "bridge 421/421" came from reading its output
by eye. Its replacement, `deno task direct`, exits 1. When writing or inheriting a gate, invert it once
and read the EXIT CODE the mutant produces, not just the text.

## 🆕 A byte gate cannot see a TREE defect whose node writes no bytes (2026-09-18)

Since S5 made the parser's padding placeholder a `pop`, every value-less `br_if` in linear text had
carried a phantom value for two weeks, and a linear `call_indirect` had swallowed a later
instruction's value since before that. Neither changed a byte, because a `pop` is written as nothing
and operands are emitted in order. So baseline, spec, round trips and bridge-behaviour all stayed
green. They were found by M8d, the first consumer that checks the tree against wasm's stack rule and
REFUSES what doesn't add up, rather than defaulting (the bridge typed every `pop` `i32` and went on).
When a node kind writes nothing, the tree around it has no byte-level witness. Build one that
checks the tree itself, and make it refuse, not default.

## 🆕 An assertion that spans stages is satisfied by the WRONG stage (2026-09-19)

The wasmtk team's runner had one `catch` around "assemble the module", so a failure at ANY stage —
parse, encode, engine validation — counted as `assert_malformed` passing. Two assertions had been
green for years on an encoder error, which is not what "this text cannot be decoded" means. Splitting
the stages turned them into skips and found two real leniency bugs here (limits unchecked, legacy
`try` clauses unchecked), both fixed in `530569512`.

🔑 It is the same shape as the `bin-roundtrip=OK` probe on this side, which reported success for
modules it never round-tripped, and as `direct` reading 421/421 while the bridge dropped every
element segment. **How to apply:** for every assertion that names a STAGE ("malformed" = parse,
"invalid" = validation, "traps" = run), assert the stage — catch that stage's failure alone, and let
the others fail the test loudly. A single try/catch spanning a pipeline is a green light wired to the
wrong switch.

## 🆕 The local gate must BE CI's gate — a step only CI runs is a failure deferred to push time

**Rule: run every step CI runs, read from the workflow file, not from memory of it.**

S6 step 4 (`290faadcd`) left two scripts that no longer type-checked. The local gate —
`test · baseline · operators · spec · bridge` — does not run `deno task check`; `ci.yml` does, and
so does `publish.yml`. Nothing had been pushed since, so for 65 commits `main` was red by CI's
standard and green by ours, and **the first push would have failed, and so would the next publish.**

It was found by accident: decision 4's trial type-check included `scripts/`, and ten of its errors
were not decision 4's. They were confirmed pre-existing by running the same check on a `main`
worktree — not by assuming.

### How to apply

- **The gate is `grep -n "run:" .github/workflows/ci.yml`**, plus the project's own gates on top.
  Today that is
  `fmt --check · lint · check · naming · portability · test ·
  baseline · publish --dry-run`,
  then `operators · spec · bridge`.
- **An unpushed branch is not a tested branch.** The longer `main` runs ahead of `origin`, the more
  a CI-only step is worth running locally.
- **Run it on the tree you COMMIT, after the last edit.** Decision 5 (`7c2ad5fd3`) merged with
  `deno lint` red — the region helpers replaced the last `as BlockExpr` cast in `passes.test.ts`
  after the gate had run, and the import stayed. Found a day later by the next gate. If an edit
  follows the gate, the gate has not run.

## 🆕 A fixed failure can UNMASK another — predict from counts, then check per file

Decision 4 removed a failure class accounting for 5 of the bridge's 24 failures, and the bridge went
397 → **401**, not 402. A per-file diff against `main` explained it in one line: `59_AsyncClosureCb`
had been failing at ENCODE on the removed class and now got far enough to fail at V8 in the dominant
fallthru class. Not a regression — a second defect the first one had been hiding.

**A pass count is a sum over files; diff the per-file outcomes, not the totals.** "4 fixed, 1 moved
class" and "5 fixed, 1 new regression" produce the same total.
