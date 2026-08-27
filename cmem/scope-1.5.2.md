# 1.5.2 — scope

Branch `release/1.5.2`, opened 2026-08-27.

Named `release/1.5.2` rather than `v1.5.2` on purpose: a branch and a tag sharing a name makes
`git checkout v1.5.2` ambiguous between `refs/heads` and `refs/tags`.

## ⚠️ The version bump is a SEPARATE commit ON MAIN, after the merge

**Never bump in the change that merges.** See [publishing.md](publishing.md) § "RULE — never bump
the version in the same change that merges to `main`". Merge first with the released version still
in place, verify `main`, then bump as its own commit. A merge carrying a bump _is_ a release, and it
makes one push do two things when only one of them is reversible.

**This branch stays at `1.5.1` while the work happens.** It is therefore safe to merge to `main` at
any point — partial work can land without releasing.

`auto-tag` does **not** compare versions or detect a change. It runs on every push to `main` and
asks exactly one question: _does `refs/tags/v<deno.json version>` already exist?_ If yes it logs
"nothing to do"; if no it tags, pushes, and dispatches `publish.yml`.

So while `deno.json` reads `1.5.1` and `v1.5.1` exists, merging publishes nothing. **Bumping
`deno.json` and `main.ts` to `1.5.2` is what arms the release**, and it should be the final commit
before the merge that is meant to publish. Both files, together — `version_sync.test.ts` fails the
publish otherwise, and `deno task bump` rewrites both.

Two consequences of the rule being "tag exists" rather than "version increased":

- **Deleting a tag re-arms that version.** The next merge would re-tag and attempt a republish; JSR
  rejects it as immutable, so the job goes red rather than doing something silently wrong.
- **A downgrade also triggers.** There is no monotonicity check.

A tag is also the one thing that publishes from anywhere: `publish.yml` keys on `push: tags: [v*]`
with no branch constraint, so pushing a `v*` tag from this branch would publish immediately. Nothing
else reachable from a branch push can.

## ✅ Status at release — what actually shipped

**Released early, on purpose.** The ladder had 1.5.2 as "the break", to follow the predecessors'
retirement. It shipped ahead of that because **wasmtk is blocked on the `-Oz` miscompile fixed
here** and a correctness fix a downstream consumer is waiting on outranks a tidy release ordering.

| item                                 | state                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **§1 T13.50 / A1 — de-coarsening**   | ✅ done, and it grew: 3 reported shapes plus 3 more found by review                                                                                                     |
| **`-Oz` try_table miscompile**       | ✅ done — not originally in scope; came in as a wasmtk bug report                                                                                                       |
| **`compat/binaryen` pass API**       | ✅ done — `listPasses` exported, kebab-case accepted, error lists names                                                                                                 |
| **§2.2 cmem topic merges**           | ◐ partial — `overview`, `licensing`, `bridge`, `best-practices`, `publishing` (provenance half) done; `phases` / `testing` / the rest of `publishing` still wing-scoped |
| **§2.1 release-script unification**  | ✅ done — one `scripts/release/`, the union of both sets; `bump` and `release` tasks wired (neither existed)                                                            |
| **§2.3 where the bridge lives**      | ⬚ deferred — still `src/wabt-ts/bridge/`, promotion-rule gap unresolved                                                                                                 |
| **§3 `scripts/count-collisions.ts`** | ⬚ deferred — rule pinned in [overview.md](overview.md), not yet scripted                                                                                                |
| **§4 phases C/D**                    | ⬚ blocked — C2 (wasmtk republish) is wasmtk's to run; D archiving follows it                                                                                            |

The deferred items are recorded rather than dropped: §2.1 still blocks the `phases`/`testing`/
`publishing` merges, because those would describe a release flow that does not exist until it lands.

## What 1.5.2 is

In the retirement ladder it is **the break** — the first release where binaryang stands alone, after
`binaryen-ts` and `wabt-ts` are signposted at 1.5.1 and archived.

But a break release that contains only a version bump wastes the moment. The merge was justified
partly on the grounds that it would make certain work _cheaper_, and 1.5.2 is where that claim gets
tested. So the theme is: **do the things the merge made possible, and finish what it left
half-done.**

---

## 1. The defect the merge was supposed to make cheap — headline

### T13.50 / A1 — complete the bridge's de-coarsening

The register deferred this deliberately: _"the fix needs both type systems visible at once, which is
exactly what the merge provides."_ That is now true, so the excuse is spent.

✅ **Re-measured 2026-08-27, unchanged since the pre-merge audit:** 24 coarsening call sites in
`src/wabt-ts/bridge/bridge.ts` plus 1 in `type-map.ts`; **5** precise (`wabtTypeToValueType`).

Three shapes fail, all measured, none covered by a test — which is why the bridge suite reads green:

| shape                                 | result                                                   |
| ------------------------------------- | -------------------------------------------------------- |
| imported func with a `(ref $T)` param | `unresolved GC function type: (structref) -> ()`         |
| tag with a `(ref $T)` param           | `unresolved GC function type: (structref) -> ()`         |
| global of type `(ref null $T)`        | `Bridge: ref.null with a user-defined heap type is not…` |

Remaining sites: `addFunctionImport`, `addGlobal`, `addTag`, `addTable`, locals, and the block/field
helpers.

**Acceptance:** each of the three repros passes, each gated by a test that was seen to fail first.
Emitted-byte baseline must still report `IDENTICAL`, or the change needs a re-baseline and a reason.

⚠️ **The third row is a DIFFERENT defect sitting next door** — the bridge refuses `ref.null` with a
user-defined heap type. Do not fix it by widening the de-coarsening and assume it went away. Two
fixes, two tests.

---

## 2. Finish what the merge left half-done

### 2.1 Unify the release scripts

✅ **Done 2026-08-27.** One `scripts/release/` holds `version.ts`, `bump_version.ts`, `publish.ts`
and `release-guard.ts`. Both predecessors' copies are gone; `scripts/{binaryen-ts,wabt-ts}/` keep
only their diagnostics, and `verify-baseline.ts` stays put because it reads
`pre-merge-baseline.tsv` beside it and is not a release script.

**It is the UNION, not a pick.** Each side's copy was strictly better than the other in one place,
so choosing either would have silently dropped a guard:

| from | what would have been lost |
| ---- | -------------------------- |
| wabt-ts | `--dry-run` (a mutating script that read NO arguments, so `--dry-run` did a real bump), `release-guard.ts` and its T13.43/T13.44 tests, the remote-tag guard |
| binaryen-ts | the `main.ts` VERSION rewrite — without it `--version` drifts, exactly as binaryen-ts's did across two minor releases |

⚠️ **Neither task existed in binaryang.** The scripts came through the merge but `deno task bump`
and the release task were never wired, so every document saying "`deno task bump` rewrites both"
described a command that would have failed. Now `bump` and `release` are real tasks.

**Named `release`, not `publish`**: `publish:dry` runs `deno publish --dry-run`, which checks the
JSR manifest and is not a dry run of the release script. Two names one keystroke apart doing
unrelated things, one of them irreversible.

**Verified by inverting it:** a real `deno task bump` moved `deno.json` and `main.ts` together to
1.5.3, `version_sync` passed, and both were reverted to 1.5.2. A `--dry-run` moved neither.

**Unblocks:** the `phases` / `testing` / `publishing` cmem merges below.

### 2.2 Merge the remaining cmem topics

Now unblocked or near-unblocked:

- **`overview.md` (95 / 478) — stale on both sides.** Each still says all _three_ projects merge.
  Neither can be promoted as-is; this needs authoring, not merging.
- **`phases.md` (177 / 209)**, **`testing.md` (186 / 642)**, and the non-provenance half of
  **`publishing.md`** — after 2.1.

### 2.3 Decide where the bridge lives

The promotion rule cannot ever promote it: a module earns a common `src/` folder when nothing in
either namespaced tree imports it across the boundary, and the bridge is cross-tree _by definition_.
It currently sits in `src/wabt-ts/bridge/`, which is where it happened to come from.

Either move it to a common `src/bridge/` and record that the promotion rule has one standing
exception, or leave it and record _why_. Both are defensible; the gap is that neither is written
down.

---

## 3. Make the convergence indicator real

The 56-collision count is the project's stated measure of convergence, and it was measured by hand.

✅ **Reproduced 2026-08-27 — and the counting rule matters:**

| rule                          | count                            |
| ----------------------------- | -------------------------------- |
| `type` + `interface` + `enum` | **56** ← the documented baseline |
| …plus `class`                 | 58                               |
| `type` + `interface` only     | 55                               |

The number has **not moved** since the merge. But the rule was never written down, and a metric
whose method is unpinned cannot be compared across time — the same tree yields 55, 56 or 58
depending on what you count.

✅ **Done 2026-08-27.** `scripts/count-collisions.ts`, `deno task collisions`, reported into
`$GITHUB_STEP_SUMMARY` by CI and **explicitly ungated** (`|| true`, so it can never redden a build).

It reproduces the hand count: **56**. All three variants were re-derived independently of the script
and match the table above exactly — 55 / 56 / 58 — so the rule the script pins is the rule the
number was always measured with, rather than a new rule that happens to land on 56.

`class` is excluded with a reason, not by omission: a class is a runtime value as well as a type, so
two same-named exported classes collide at runtime too. Zero runtime values collide today, and
folding classes in would hide the day one does.

---

## 4. Complete the retirement — phases C and D

These are the ladder, and they gate the release rather than the branch.

| #         | item                                                                    | note                                                                                                             |
| --------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **B3–B6** | signposts on both predecessors                                          | drafted in [handoffs.md](handoffs.md) § 2; **now unblocked**, 1.5.1 is live                                      |
| **C1**    | wasmtk: swap two import-map lines to `binaryang/compat/{binaryen,wabt}` | verified green in B1                                                                                             |
| **C2**    | wasmtk publishes                                                        | ⚠️ **this is what actually retires the old packages** — every wasmtk user is a transitive dependent              |
| **C3**    | confirm LeptonPad's `build:wasm` still runs                             | expected no-op; it resolves wasmtk unpinned                                                                      |
| **D2**    | `isArchived` on both JSR packages                                       | **after** B3/B4 — archiving blocks publishing                                                                    |
| **D3**    | archive both GitHub repos                                               | **after** the 1.5.1 tags — archived repos are read-only                                                          |
| **D4**    | 🚨 **never yank**                                                       | version-level, affects resolution, would reach backwards into 31 wasmtk versions and LeptonPad's transitive pins |

⚠️ **C1 note:** consumers hit Deno's 24-hour `minimumDependencyAge` on a fresh version. Expected,
not a defect — `--min-dep-age=0` or wait. binaryang sets it to `"0"` for itself, but a _consumer's_
setting governs.

---

## 5. Smaller, cheap

- **`percentageDocumentedSymbols` 98.1% → 100%.** The only score factor not at full marks; the
  others reached parity once the JSR description and runtime flags were set.
- **Doc references I mapped on plausibility, not verification.** `binaryen-ts/parser/tokenizer`,
  `parser/wat-parser` and `wasm/demo_bytes` named subpaths that never existed in either package;
  they were pointed at `./api` and `./wasm` as the nearest real thing. Someone who knows the intent
  should confirm.
- **Pass the provenance finding to wasmtk.** Its investigation's leading hypothesis — a JSR-side or
  GitHub-side change in the 2026-07-03 → 07-09 window — is refuted by wabt-ts, binaryen-ts and now
  binaryang all being attested on 2026-08-25/26/27. Whatever broke wasmtk is specific to wasmtk. See
  [publishing.md](publishing.md).

---

## Explicitly NOT in 1.5.2

Recorded so they are not silently dropped, and so nobody re-opens the question:

- **A2 — `wasm2ts` (Phase 8) is a stub that throws.** The project's long-term goal, WASI Preview 1
  capable TypeScript output. A feature, not merge follow-through, and deferred pending wasmtk QA/QC.
- **A3 — diagnostic offset accuracy is UNMEASURED**, not clean. T13.35's cheap oracle was false for
  every multi-byte construct and no replacement was built. **Do not let attrition convert this into
  "clean"** — it needs a measurement before it needs a fix.
- **Converging the two IRs.** Open-ended by decision 1, tracked by the count in § 3, and not a
  release task.

---

## Gates before merging to `main`

Everything in the A-gate, since merging publishes:

- `deno task check` · `deno task test` · `deno lint` · `deno fmt --check`
- `sh scripts/check-naming.sh` and `sh scripts/check-portability.sh` both empty
- **`deno task baseline` reports `IDENTICAL`** — or a deliberate re-baseline in the same commit,
  with the reason
- `deno publish --dry-run` clean
- CLI smoke on Deno, Node 22.18+, Bun 1.4+ — byte-identical output
- and, after publish, the workflow's own **provenance verification** step going green
