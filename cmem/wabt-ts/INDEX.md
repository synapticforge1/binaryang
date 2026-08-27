# cmem — Portable Project Memory for wabt-ts

This folder is the **authoritative, portable project memory** for `wabt-ts`. It lives inside the
project tree, so it travels with the project (USB drive, clones) and is committed to git — unlike
the legacy `CLAUDE.md`, which is `.gitignore`d and therefore machine-local only.

**Format:** plain Markdown — one focused topic file per domain, so any single concern can be
reviewed and revised without wading through one giant file. Keep files small and single-topic.

This layout mirrors the `cmem/` convention established in the sibling `wasmtk` project.

## Policy (durable)

- **`cmem/` is the single home for ALL project memory.** When the owner (or anyone) says "**update
  the project memory**," that means: update the matching `cmem/` topic file with the latest
  decisions, found bugs, design changes, and current state — then add/refresh its one-line pointer
  in the table below. Convert relative dates to absolute; update existing entries rather than
  duplicating.
- **`README.md` is NOT project memory.** It is the public, user-facing document shipped to GitHub
  and JSR. Keep internal decision logs / bug post-mortems out of it (those live here).
- The legacy `CLAUDE.md` (repo root, gitignored, machine-local) is the auto-loaded historical
  archive and remains the exhaustive line-by-line record; `cmem/` is the curated, portable source of
  truth that supersedes it going forward. When the two disagree, reconcile and prefer `cmem/`.

### Notations: two kinds, both binding

**In the CODE — notate the INTENT of a section for whoever edits it next.** A
multi-label `case` group, a parallel handler family or an opcode-keyed table is a
*membership assertion*: joining it claims you satisfy what its body assumes, and that
claim is normally invisible. Three defects here came from an editor reading the
neighbours instead — `table.get` joining a LEAF-only arm (T13.11), `data.drop` joining
the arity-1 group and deleting an instruction (T13.16), memarg handlers honouring three
of the four things that family owes (T9.6 → T9.11 → T13.15). At the head of such a
section, state **what joining asserts**, **what breaks if it is wrong** (in both
directions, where both exist), and **which gate catches it** — or that none does. A
comment explaining what the code *does* is worth little; the code says that already.
Full version, with the table of all three: [best-practices.md](best-practices.md).

**In `cmem/` — a finding is only worth something once it is written down for someone else.**

The reasoning that produced a decision does not survive the conversation it happened in. Only the
file survives. So **the qualification, the caveat and the calibration go INTO the file** — not into
a summary, a commit message, or a reply that scrolls away. If it was worth saying while deciding,
it is worth the two lines here.

This is not a style preference; it is the direct cause of the most expensive class of defect in
this log:

- **T9.11 → T13.15.** The audit knew it had only checked `offset`. That qualification was never
  written down, so the entry read "the memarg handlers were audited" and the next reader believed
  it. Three releases later the same two handlers were still dropping `is64`. **The knowledge
  existed and the record did not, which is operationally identical to not knowing.**
- **The `KNOWN_INVALID` upstream report.** A present-tense claim about wasic, made from a frozen
  snapshot, because nothing in the file said the snapshot was frozen. It was wrong, it went
  upstream, and the wasmtk team had to correct it.
- **T13.18's decay note.** The observation that a recurrence table's yield falls after the pass
  that writes it would have been lost the moment that conversation ended. It is in
  [best-practices.md](best-practices.md) instead, so the next person reads a clean sweep as the
  expected result rather than as the tool having failed.

Three habits follow, and they are cheap:

1. **Write what you did NOT check** alongside what you did. An audit's scope is part of its result.
2. **Write the negative results.** "Clean" and "never examined" are indistinguishable from the code
   and imply different next actions.
3. **Write the calibration, even when it makes the work look smaller.** A tool honestly described
   keeps getting used; one oversold gets abandoned the first time it disappoints. Prefer the
   version that survives contact.

### The "update the project memory" trigger (binding on every agent)

When the owner says **"update the project memory"** (or any clear synonym — "update memory", "record
this", "remember this for the project"), the required action is:

1. **Revise all relevant `cmem/` files** — fold the latest decisions, found bugs, design changes,
   and current state into the matching topic file(s); refresh the one-line pointer in the Files
   table; convert relative dates to absolute; update existing entries instead of duplicating.
2. **Sync `README.md` where, and only where, the change is user-relevant** — install/usage,
   examples, capability surface, status. Keep internal detail in `cmem/` only.

This is the durable contract for this repo. Any agent reading this file is expected to honor it.

### Trigger — "look for code issues" (binding on every agent)

Comprehensive audit across **both tested AND untested** paths for: (1) workarounds / temporary
hacks; (2) dead code (verify each with a grep); (3) bugs — silently-wrong codegen, inverted logic,
type-inference gaps, scanner off-by-ones; (4) **silent fall-throughs** — the worst failure mode:
unhandled input skipped or padded with a placeholder instead of erroring. Prefer converting
silently-wrong into a hard fail. **A `default:` arm returning a benign value (`0` / `false` /
`null` / `Result.Ok`) in a function whose other arms return real per-case data is the canonical
instance** — `instrInputCount`'s `default: return 0` caused the `Quaternary` wrong-IR-tree bug
outright, and T13.16 was its inverse. Where the population is enumerable from the source, gate on
it (T13.18) rather than trusting a hand-maintained list. Report `file:line` + severity, fix the
safe ones, keep every gate green.

**What "audit" means here specifically** — corpus coverage is NOT the tool. All three bugs found this
way (Bug G; the atomic `memidx`; `table.get`'s index) were unreachable by either corpus. Enumerate
the TYPE and check the code against it:

- every `Var`-bearing field of every `Expr` interface vs. the `resolveNames` case that handles it;
- **every `Expr`-bearing field of every `Expr` interface vs. that same case body** — a second, equally
  necessary axis. `resolveNames` must be total on BOTH kinds of member, and on 2026-08-25 the `Var`
  axis came back clean across all 64 interfaces while the `Expr` axis found `table.get.index`
  (T13.11) across all 75. A clean result on one axis says nothing about the other;
- every `ExprVisitorDelegate` hook vs. each walker that must be total (both writers, the validator);
- **every entrypoint that accepts bytes from outside, fuzzed by truncation and single-byte
  corruption.** Assert only that it does not THROW — a property needing no oracle, no corpus and no
  fixtures. All four binary tools crashed on ~102 of 585 such inputs (T13.29). Pair it with two
  guards: malformed input must still be REPORTED, and valid input must still succeed;
- **every `readX` in the binary reader beside its `writeX` in the binary writer.** Cheap, high-yield,
  and easy to skip because each half looks fine alone. Field by field: does the decode invert the
  encode for every value the encode can produce AND every value the WIRE FORMAT allows? The second
  half is where T13.26 lived — the writer can never emit alignment exponent 32, but the format
  permits it, and a decoder answers to the format rather than to its sibling;
- `instrInputCount` vs. the max `opN()` each `buildPlainExpr` case actually reads — **and check that
  every member of a shared `case` group has the same arity**: `data.drop` / `elem.drop` sat in the
  arity-1 group and the parser DELETED a preceding instruction (T13.16, a wrong-answer bug). This
  scan reported 6 hits of which 4 were regex artifacts from stacked `case` labels; **triage the
  false positives by hand rather than tightening the scan**;
- **every parameter of each handler in a family, not one parameter across the family.** T9.11 asked
  "does each memarg handler use its `offset`?", fixed ten, and closed — leaving `onSimdLoadLane` /
  `onSimdStoreLane` dropping `is64` for another release (T13.15). Ten fixes in one pass means the
  family is neglected, not that it is now complete;
- a family of parallel handlers — **a sibling that does what its neighbour skips is the strongest
  single tell**. Watch particularly for a case sharing a `case` label with a genuine LEAF: that is
  how `table.get` inherited `table.size`'s body and stopped walking its own operand. The other
  high-yield tells, all paid for here: an **underscore-prefixed parameter** (`_signed`, `_offset`)
  in a handler whose siblings use it; a **parameter the sibling takes and this one does not**; a
  bare **`dropTypes(n)`** where siblings call `popAndCheck1Type`; and a **helper that exists and is
  simply never called** — T13.14's largest root was fixed by calling `isSubtype`, already on the
  class and already used by `onBrOnCast`;
- **for the validator specifically, a hand-built INVALID corpus** — ~20 lines, bad modules through
  `wat2wasm` (which does NOT validate) into `wasmValidate`, V8 as oracle and Wasmtime as authority.
  Validator agreement counts only false REJECTIONS, so **no conformance metric can see a permissive
  validator**; T13.14 found twelve false accepts with all seven green. Pair every tightening fix
  with the false-REJECT sweep too, and re-run that sweep with the fix reverted so the baseline is
  measured rather than assumed.

**Start from the recurring root causes, not from a fresh idea about where bugs live.**
[best-practices.md](best-practices.md) ends with a table of root causes that have each produced a
real defect MORE THAN ONCE here — an unused parameter in a family of parallel handlers (three
times, most recently in two of the very handlers a prior audit had already fixed), a shared `case`
label whose members are not interchangeable (twice, and one of them DELETED an instruction), and a
helper that exists and is never called (three times), and a `default:` arm returning a benign value
(twice). Three of the four findings on 2026-08-25 sit in that table. Check it first and extend it
whenever something recurs.

**Expect the table's yield to decay, and treat a clean sweep of a row as the RESULT.** The first
audit run from it (T13.18) found no new wrong-answer bugs — one row paid off, two came back clean.
That is normal: the pass that writes a row is usually the pass that sweeps it. **Record the
negative results** — "clean" and "never examined" are indistinguishable from the code and imply
different next actions, so a negative result needs the same three things a positive one does: what
was varied, what was held fixed, and why the answer is what it is.

**Record the QUESTION an audit asked, not just that it happened.** "Every memarg handler checks its
offset" ages correctly; "the memarg handlers were audited" does not, and reading the second where
the first was meant is exactly what let T13.15 survive T9.11.

**Every one of these enumerations is grep- or regex-driven, so they inherit grep's failure modes.**
A single control byte makes a file BINARY to grep, which then prints "Binary file … matches" instead
of the matches — the file drops out of the sweep and the sweep still reports clean (T13.25, and it
was our own byte). `tests/audit/source_hygiene.test.ts` gates that. **Pin the population** in any new
enumeration — assert a floor on what it scanned — so a walk that silently found nothing fails rather
than passes.

These enumerations are ~30 lines of `awk` + regex each and run in about a second; they are cheaper
to re-run than to reason about. **A fully green gate is the normal starting condition for this
work**, not a reason to skip it — T13.11 and T13.12 were both found with lint, typecheck, 363 tests
and all seven conformance metrics already passing, and neither moved a metric.

### Trigger — regression gate (binding)

**When a bug is found or fixed, run the whole gate**, which for this repo is:

```sh
deno task check && deno task test && deno fmt --check && deno lint
```

**Caveat on `deno fmt --check` here:** it reports ~104 of 146 files failing with "Text differed by
line endings" on this checkout — autocrlf, not drift — so its exit status is not a usable signal.
Check a file you touched with the line-ending-normalised diff in [testing.md](testing.md); real
drift does occur and does fail CI (`tests/` is in the formatter's scope, `cmem/` is not).

Then **re-measure the conformance metrics that the change could move** — they live outside the test
suite and nothing else will catch a regression in them. The set and their current values are in
[overview.md](overview.md); the harnesses and what each one is blind to are in
[testing.md](testing.md). A parser, reader, writer or validator change can move any of them.

**Measure, do not assume.** "Outlier" is relative to which FILE changed, never absolute. A change
that looks confined to the WAT writer moved the round-trip metric by 80 modules (T10.1).

## Files

| File                                       | What it holds                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [overview.md](overview.md)                 | What wabt-ts is, the long-term wasmtk/wasm2ts goal, **the current conformance state (all SEVEN metrics)**, the cross-runtime support matrix, the v1.4.0 breaking changes, repo layout, the upstream C++ reference tree                                                                                                                                                                                 |
| [runtime-tooling.md](runtime-tooling.md)   | Deno-primary / Bun-secondary; the four load-bearing TS compiler rules (`verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `deno.window` lib); `Result` enum shape; no `Deno.*` in library dirs; **what was actually MEASURED on Bun and Node (2026-08-24)**                                              |
| [pre-merge-known-issues.md](pre-merge-known-issues.md) | **Written 2026-08-25, before the binaryang merge.** Everything MEASURED from the wabt-ts side while the repos are still separate, so nothing gets absorbed into "it was already like that": the pre-merge ACTIONS are settled in section G (baseline captured and verifiable, `singleQuote` and `compilerOptions` resolved, the three sequencing decisions recommended); **T13.22 is CLOSED as a precondition** (pin at 1.5.0, ordering fixed, gated) — raised by binaryen-ts as the first thing that must not travel into the merge, and met before the note arrived; the bridge de-coarsening is **incomplete with 3 measured failing shapes and no test** (imported func / tag with `(ref $T)`, and a global of `(ref null $T)`); **five `src/` directories collide with different contents** — `src/ir` is the wabt IR in one and the binaryen IR in the other, which is the very distinction the bridge exists to translate; 21 tracked-path collisions including **8** `cmem/` files (14,023 lines vs 2,296 — merge by TOPIC, not concatenation); **2 `exports` subpath collisions, `.` and `./compat`** — a surface this audit missed and binaryen-ts caught, resolved as `./compat/wabt` + `./compat/binaryen`; `compilerOptions` differ in 5 of 7 but cost only **4 type errors**; `fmt.singleQuote` is opposite; both upstreams' Apache attribution obligations combine. Also records what the merge RESOLVES, and the rule that entries are MARKED when fixed, never deleted |
| [phases.md](phases.md)                     | Phase delivery plan (1–8) with status, the TS↔C++ file mapping per phase, and the per-phase gotchas (IR field names, keyword tokens, fold-form invariants, validator rules, CLI pipeline decisions); the post-v1.3.5 conformance campaign as a CLOSED snapshot (its numbers are dated, not current), and **the ONGOING post-v1.4.0 audit/hardening tranche T13 at a glance** — findings to date, the fifteen user-visible fixes SHIPPED in v1.4.1, the one deliberately unfixed (T13.22), and the empty enumeration frontier                                                                                                                                    |
| [design-decisions.md](design-decisions.md) | Load-bearing invariants that must NOT be silently reverted — performance/singleton invariants + the full bug-fix invariant log (return-values array, f64 bits as bigint, SIMD lane arity, legacy try/catch, statement ordering, **resolveNames completeness on BOTH its axes — `Var` immediates AND `Expr` sub-expressions**, all four LEB encoders rejecting what they cannot represent, **decoder messages using the SPEC’s vocabulary — and the two LEB faults the spec names separately staying distinct**, **`TokenType.Reserved` is the unknown-operator signal and new error sites must route through `reportUnexpected`**, **a conformance harness calls `wat2wasm` rather than rebuilding its four stages**, **section sizes are encoded MINIMALLY and the reserve/patch pair is strictly LIFO — never hold an offset across a patch**, **custom sections keep their INPUT POSITION via `Custom.precedingSection`, and a new section must pair its write with `writeCustomSectionsAfter`**, **the release preflight lives in `scripts/release-guard.ts` and runs BEFORE any mutation; `scripts/` is inside the gate**, **the GC validator operand checks — shared-hierarchy not subtyping, no bare `dropTypes`, packed signedness is a tri-state**, **`instrInputCount` must equal what `buildPlainExpr` reads**, **a memarg handler follows the memory INDEX TYPE as well as checking the offset**, GC type encodings, …)                                                       |
| [bridge.md](bridge.md)                     | Phase 7 binaryen bridge — **opens with the ⚠ catch-scope compensation that MUST land with the next `@jrmarcum/binaryen-ts` version bump (T13.22): the bridge and binaryen-ts 1.0.9 hold two off-by-ones that cancel, so upgrading without the paired fix emits the wrong catch depth** — then the binaryen-ts constructor API surface, bridge type mapping, post-order traversal constraint, tier-by-tier coverage (A/B/C/D + GC 1–4), and the cumulative gotchas |
| [testing.md](testing.md)                   | How to run the gate, **including `deno fmt`'s real scope (`src/` + `tests/` only, NOT `cmem/`) and its standing CRLF false alarm**; **the NINE conformance metrics and what each is blind to — including diagnostic WORDING, which grades the error MESSAGES the other seven never look at, over THREE populations (reader 689/711, validator 2446/2683, parser 816/1229) and measures AGREEMENT not quality; a boxed warning that the scratch harnesses omitted `synthesizeTypes` until 2026-08-25 and read a denominator FIVE TIMES too small (T13.39); **round-trip reported as TWO metrics — FIDELITY against our own output (2119 / 2119) and re-encoding of crafted bytes (27 / 88), which must never be summed**; and the DEMONSTRATED blindness of validator agreement to false ACCEPTS, and the hand-built invalid corpus that covers it**; **the four test shapes that need neither a corpus nor an oracle** (differentials, code-enumerated populations, gate tests, type-enumeration audits) and why each has an AXIS; **a running list of what has NOT been enumerated yet — read it FIRST when starting an audit, and update it when finishing one**; **what to do when the three-engine panel is not available (legacy EH: V8 is the only oracle)**; **the fixture convention — say it to an engine**; **`scripts/verify-baseline.ts`, which proves a refactor changed no emitted bytes** (421 files hashed; deliberately NOT a test, because a real encoder improvement must be free to fail it); the wasmtk WAT corpus runner and the fact that `tests/wasmtk/` is a FROZEN SNAPSHOT (`PROVENANCE.md`); regression-test placement |
| [licensing.md](licensing.md)               | MIT-primary with Apache-2.0 alternative; file layout (`LICENSE` / `LICENSE-MIT` / `LICENSE-APACHE` / `NOTICE.md`); per-file ported-vs-original headers; the no-compound-SPDX rule                                                                                                                                                      |
| [publishing.md](publishing.md)             | JSR package `@jrmarcum/wabt-ts`; tag-driven publish flow (never `deno publish` locally — OIDC provenance); the bump task + sub-version-capped-at-9 rule; CI workflows; **what is UNRELEASED on `main`** (**v1.4.1 SHIPPED 2026-08-25** with all fifteen, OIDC provenance; nothing is unreleased on `main`. That heading count has gone stale TWICE — re-derive it, never quote it — that heading read "five" for several passes while the table held twelve, so **re-derive the count, do not quote it**; T13.16 EMITTED WRONG CODE and T13.26 silently repaired an invalid module, which are the two that argue for shipping), **what v1.4.0 breaks**, **why `auto-tag.yml` can tag but CANNOT publish** (and how to recover), and why `--dry-run` must be run when an exported symbol moves                                     |
| [best-practices.md](best-practices.md)     | **Method rules, each paid for by a real incident here** — parse-count is an upper bound, confirm root causes with repros not error text, producer/consumer order mismatches, invert a new guard test before trusting it (and check WHICH steps flip), measure severity never inherit it, name the ref you measured, the proposals your corpus lacks are your blind spot, audit your own diff before the codebase, **a guard is only as wide as the axis it varies**, **a green gate is a floor not a result**, **a metric that counts one direction is blind to the other**, **a rejection is evidence only for the check you actually varied**, **enumerate the family then ask what each member checks**, **fixing one direction of a rule can break the other so pin both**, **enumerate the SIGNATURE not the parameter**, **run the mechanical axis even at a low true-positive rate**, **not every family has three engines — say which oracle you actually had**, **a shared `case` label asserts its members are interchangeable**, **a closed audit item is a claim about the question you asked**, **record the negative results**, **an unearned fix is a worse trade than the doubt**, **write down the thing you only said out loud**, **notate the INTENT of a section at the section**, **an example that satisfies its own matcher is data not documentation**, **read a partial switch’s `default` before its case count**, **scope the SHAPE not the instance**, **a probe that cannot separate the hypothesis from its negation proves nothing**, **answer an upstream question in the terms it was asked**, **a caret range plus a lockfile is not a pin**, **the upstream fix can be necessary without being sufficient**, **a comment answers the question that was asked — ask the other one**, **verify the restore, do not trust it**, **your tooling has a silent failure mode too — gate it**, **probe the OPERATION's boundaries not the domain's**, **read a decode next to its encode**, **scope a hygiene gate to what the WORKFLOW reads not what the compiler reads** (T13.28 — `cmem/` was unscoped and the ledger's own documented command silently broke), **a stale rationale is worse than no rationale**, **fuzz the published surface — it needs no oracle**, **fix the contract at the boundary not at the source**, **an API should fail in ONE shape and its docs should name every method that fails**, **scope a test's PERMISSIONS deliberately — the low-privilege half is the one that runs**, **the frontier list is a claim, and a missing row looks like a swept one**, **gate the correspondence even when today's answer is "no bug"**, **an empty frontier means the cheap axes are spent, not that the code is clean**, **"we fuzzed it" is a claim about ONE property — ask a different question, not for more inputs**, **hardening is a lens, not a task**, **disbelieve the comment you just wrote**, **a probe that produces findings is not thereby a good probe**, **distinguish clean / unmeasured / not-attempted**, **ask whether a rejection is a SPEC limit or an ENGINE limit — and find the exact boundary**, **check whether a corpus you already own carries an ANSWER KEY you are discarding** (T13.37 — the spec testsuite states the expected error text for every `assert_malformed` and we read only the modules), **conformance metrics grade acceptance; the ERROR PATH needs its own**, **a broken harness can score BETTER — give it an input it must FAIL on, and never reassemble a pipeline inside one**, **an allowlist entry is a claim: ask what the thing is FOR before excusing it** (T13.38 — `Reserved` sat on a "never consumed, and fine" list while being the exact symptom), **a test can pin the WEAKER of two behaviours by being satisfied with it**, **classify a difference by its PROVENANCE before explaining it** (T13.40 — "round-trip 2124/2207" summed two populations and hid a 3.2% size defect; fidelity was already 100%), **byte-identity against a NON-CANONICAL input can mean you share its defect**, **upstream has an option — check whether the port kept its DEFAULT**, **an oracle can pass VACUOUSLY — check the input exercises the behaviour** (T13.41 — strip scored 272/272 on inputs that had nothing to strip), **read an option’s DOC before believing your probe of it**, **a defect shared by a producer and its consumer is invisible to their round trip — a corpus of your own output cannot test your own output**, **a command written to see past a FALSE ALARM must be proven to still fire**, **a documented command can go wrong WITHOUT CHANGING when the question moves under it — state what it counts, and prefer a source of truth over prose**, **documentation of a SAFETY guard is a claim to verify, not prose to trust** (T13.43 — two files said the release script refused a dirty tree; it had no such check and would have published a version containing none of the work), **code that acts at IMPORT time cannot be tested — extract the decision**, **test the case where the guard must NOT fire**, **a regression test for a guard must gate the CALL SITE, not just the logic**, **an import-surface diff is NOT an upgrade test**, **a test pinning someone else’s DEFECT is supposed to go red when they fix it** (T13.47 — 1.5.0 fixed UP-1 and two bridge tests failed; that is the notification), **watch the ERROR MESSAGE move, not just the failure count** (fixing the first of two stacked defects fixed zero tests and changed the message) (T13.47 — 0 of 72 imports missing at binaryen-ts 1.5.0, and 12 of 28 bridge tests still failed), **a probe whose input cannot vary the mechanism proves nothing — twice on the same item**, **a stale artifact read as a LIVE SIGNAL — seen independently in two projects** (T13.45; stamp the artifact and gate a DERIVED quantity like a file count), **"unmeasured" is worth strictly more than an oracle you assume holds** (T13.44 — deleting the release guard left all 12 of its unit tests passing) (T13.42 — the documented format check used the wrong lineWidth and hid two CI-failing files) — it carries a **table of root causes that have RECURRED** (plus an honest note on that table's decaying yield), which is the first thing a new audit should read, and closes with the three incidents where the knowledge existed and the RECORD did not, plus the form an INTENT block takes. Structure adopted from the sibling wazmrt project's file of the same name. |
| [tasks.md](tasks.md)                       | **Granular** implementation status, per-file checklists, and the running phase/bug/decision log (relocated from the repo-root `TASKS.md` on 2026-06-09). `phases.md` is the distilled summary; this is the detail.                                                                                                                     |

## Related files outside cmem

- `README.md` — the **public, user-facing** doc for GitHub/JSR. NOT project memory.
- `CLAUDE.md` — legacy exhaustive memory archive (repo root, gitignored, machine-local; auto-loaded
  by Claude Code). The line-by-line historical record; superseded by `cmem/` as the curated source
  of truth.

(The granular task/decision log formerly at the repo-root `TASKS.md` now lives inside this folder as
[tasks.md](tasks.md), so all project memory is in one committed, portable place.)
