# The transition — scope and ordered work

Scoped 2026-08-26. Forward-looking execution list; the reasoning behind each decision lives in
[pre-merge-register.md](pre-merge-register.md) and is not repeated here.

**30 items across 4 phases and 5 entities** — A:17, B:6, C:3, D:4. Everything below is either done,
or gated on something named.

---

## Scope — what moves, what ends, what does nothing

| entity          | fate               | action needed                                                           |
| --------------- | ------------------ | ----------------------------------------------------------------------- |
| **binaryang**   | the merged project | the whole of phase A, then 1.5.1 and 1.5.2                              |
| **binaryen-ts** | ends at a signpost | 1.5.1 signpost → archive                                                |
| **wabt-ts**     | ends at a signpost | 1.5.1 signpost → archive                                                |
| **wasmtk**      | stays a consumer   | two import-map lines, then republish                                    |
| **LeptonPad**   | **nothing**        | invokes `jsr:@jrmarcum/wasmtk` unpinned as a CLI; follows automatically |

**The whole blast radius is three packages deep and one branch wide:** binaryang → wasmtk →
LeptonPad. Measured, not assumed — `binaryen-ts` and `wabt-ts` each report exactly **1** JSR
dependent (wasmtk), and **wasmtk itself reports 0**. There is no fan-out to discover.

## The version ladder

| version   | binaryen-ts | wabt-ts  | binaryang                       |
| --------- | ----------- | -------- | ------------------------------- |
| 1.5.0     | live        | live     | —                               |
| **1.5.1** | signpost    | signpost | **first merged release**        |
| **1.5.2** | —           | —        | **the break — binaryang alone** |

---

## Phase A — the merge (all in binaryang)

✅ **COMPLETE 2026-08-26.** All 17 items done. Gate A → B met in full:

| gate                             | result                                         |
| -------------------------------- | ---------------------------------------------- |
| tests green                      | **908** (513 + 393 + 2 guards added during A)  |
| publish dry-run                  | clean                                          |
| `verify-baseline.ts`             | **IDENTICAL**, 421 files / 1,557,602 bytes     |
| naming + portability checks      | empty, and both verified to FIRE               |
| six tools via `binaryang <tool>` | Deno, Node 22.18+, Bun — byte-identical output |

Two items ran over their stated scope and are recorded in the register: A9 was not mechanical (the
CLI entries did not exist), and A16 left five cmem topics wing-scoped with reasons rather than
forcing merges that would describe a release flow which does not exist yet.

| #       | item                                                                                                                       | notes                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **A1**  | Merge both histories into `src/binaryen-ts/` + `src/wabt-ts/`                                                              | `--allow-unrelated-histories`; source changes limited to import paths                                                          |
| **A2**  | Preserve binaryen-ts's `tests/deno.json` workspace member, **scoped to its tests only**                                    | worth 424 type errors; state `noUncheckedIndexedAccess: false` explicitly — omitting the key leaves the root's `true` in force |
| **A3**  | Rename `wabt-ts/src/bridge/binaryen-bridge.ts` → `bridge.ts`                                                               | the naming rule's one known violation                                                                                          |
| **A4**  | One `deno.json`, one workspace                                                                                             | carry `minimumDependencyAge: "0"` forward **consciously** — it is a waived supply-chain default                                |
| **A5**  | Adopt wabt-ts's `compilerOptions`                                                                                          | costs exactly 4 errors, all `exactOptionalPropertyTypes`                                                                       |
| **A6**  | **Union the `lib` arrays** — `dom` + `deno.window` — and re-check                                                          | the one genuine merge rather than adoption; do not pick one blind                                                              |
| **A7**  | Drop the `jsr:@jrmarcum/binaryen-ts@1.5.0` pin from wabt-ts's imports                                                      | the dependency the merge removes; this is what closes T13.47's exact-pin rationale                                             |
| **A8**  | Export map — narrow authored root; `./ir/{binaryen-ts,wabt-ts}`; `./compat/{binaryen,wabt}`; every other subpath preserved | **no `./ir`**, not even as an alias                                                                                            |
| **A9**  | CLI: extract six `(args) => Promise<void>` entries from the `import.meta.main` blocks                                      | they do **not** exist yet — the exported functions are library calls                                                           |
| **A10** | ✅ CLI: port `Deno.*` → `node:*` in those six                                                                              | 53 occurrences on 43 lines                                                                                                     |
| **A11** | ✅ CLI: lift the five duplicated `cliRead`/`cliWrite` into one shared cross-runtime helper                                 | do it once, not five times                                                                                                     |
| **A12** | ✅ CLI: register in `COMMANDS`, delete the `import.meta.main` blocks                                                       | preserve `wasm-validate`'s `--enable-*` feature surface (T13.10)                                                               |
| **A13** | ✅ Harness: one test task; settle `_test.ts` (38) vs `.test.ts` (130)                                                      | zero overlap today; any glob written for one silently covers half                                                              |
| **A14** | ✅ CI: naming check + **both N7 portability checks**                                                                       | verified to fire: 0/0 on binaryen-ts, 43/0 on wabt-ts                                                                          |
| **A15** | ✅ CI: runtime matrix at the floors — Node 22.18.0 + 24, Bun 1.4.0, Deno                                                   | the floors are a promise; a promise wants a job                                                                                |
| **A16** | ✅ `cmem/` merge by topic                                                                                                  | `best-practices.md` keeps **both** origin stories; `bridge.md` has inverted (312 vs 283)                                       |
| **A17** | ✅ README migration note — the old→new subpath mapping                                                                     | the two breaks are `./compat` and `./ir`                                                                                       |

### Gate A → B

- **907 tests green** _(513 + 393 + 1 new sync test; re-derive, do not trust the arithmetic)_
- Both publish dry-runs clean
- **`verify-baseline.ts` reports `IDENTICAL`** across all 421 corpus files / 1,557,602 bytes
- Naming + portability checks return empty
- All six tools run as `binaryang <tool>` on Deno, Node **and** Bun

> The baseline is the one that matters. Green tests prove the suites ran; `IDENTICAL` proves the
> relocation changed nothing. **An exit code is not evidence in this codebase.**

---

## Phase B — 1.5.1

**B1 ✅ met 2026-08-26.** wasmtk verified against binaryang in a scratch copy (its own repo
untouched, per the boundary rule). Control-first, so a failure could be attributed: run against its
current pins, then against binaryang.

|                       | control (`binaryen-ts@1.5.0` + `wabt-ts@1.4.1`)             | binaryang           |
| --------------------- | ----------------------------------------------------------- | ------------------- |
| `deno check main.ts`  | clean                                                       | clean               |
| test-file type errors | 3 (pre-existing)                                            | 3, same codes       |
| suite                 | 12 passed, 1 failed                                         | 12 passed, 1 failed |
| the failure           | `br_on_cast.wast` — KNOWN FAILING, pinned, `pass=23 skip=1` | identical           |

Normalised full-output diff shows no substantive difference. **binaryang introduces no behavioural
change for the only consumer either package has** — including across wasmtk's 1.4.1 → 1.5.x jump on
the wabt side, which this document flagged as the thing to look at first if the gate failed.

Also learned: wasmtk's real suite is `tests/*_tests.ts` (16 files). A bare `deno test tests/`
collects corpus fixture `test.js` files instead and reports 32 failures that mean nothing. It needs
`--no-check` too — 3 type errors in its own test files predate any of this.

**B2 ✅ done 2026-08-27.** `@jrmarcum/binaryang@1.5.1` published **with provenance**
(`rekorLogId=2618802426`), GitHub release created, and smoke-tested against the published artifact.
See [publishing.md](publishing.md) — including the first tag push that produced no workflow run at
all, because the tag went up before the branch registered the workflows.

**B3–B5 ✅ prepared 2026-08-27, committed locally, NOT pushed.** Pushing either repo's `main` is
what publishes: `auto-tag` sees the bumped version, tags `v1.5.1`, and dispatches `publish.yml`.

| repo        | commit        | signpost location                             | gates                            |
| ----------- | ------------- | --------------------------------------------- | -------------------------------- |
| binaryen-ts | `4bf1726f200` | `README.md` (`readmeSource: readme`)          | 514 tests, check + dry-run clean |
| wabt-ts     | `b6d1d4354`   | **`@module` in `src/index.ts`** + `README.md` | 393 tests, check + dry-run clean |

⚠️ wabt-ts's JSR page renders from **JSDoc**, so the `@module` block is the one that reaches
consumers; the README is the GitHub half. Both were written.

⚠️ **Verification note, recorded because the recipe does not work.**
`wasmtk/cmem/design-decisions.md` says to confirm a module doc with `deno doc --json <entrypoint>` →
`nodes[file].module_doc.doc`. Measured 2026-08-27: that returns **empty for every file tried**,
including `binaryen-ts/main.ts`, whose module doc JSR demonstrably renders
(`allEntrypointsDocs: yes`). So the probe is inconclusive rather than negative, and it cannot
confirm the signpost pre-publish. What _is_ established: the block is first in the file, closes
cleanly before the exports, and only its **content** changed — the structure JSR already reads is
untouched. Confirm on the JSR page after publishing.

**B6 remains** — the JSR `description` on both packages, which is a settings-page field rather than
anything in the repo. Suggested: `Superseded by @jrmarcum/binaryang — final release 1.5.1`.

| #      | item                                                               | owner       | notes                                                                                                                                         |
| ------ | ------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** | Verify wasmtk builds green against binaryang **before** publishing | wasmtk      | ⚠️ it is a full minor behind on wabt (`1.4.1`), so this jumps two releases at once. **If this fails, look here before looking at the merge.** |
| **B2** | Publish **binaryang 1.5.1**                                        | binaryang   | must exist before the signposts point at it                                                                                                   |
| **B3** | binaryen-ts 1.5.1 signpost → **`README.md`**                       | binaryen-ts | `readmeSource: readme`                                                                                                                        |
| **B4** | wabt-ts 1.5.1 signpost → **the `@module` JSDoc in `src/index.ts`** | wabt-ts     | ⚠️ `readmeSource: jsdoc` — **a README-only edit is invisible on wabt-ts's JSR page**                                                          |
| **B5** | GitHub signpost on both repo READMEs                               | both        | the GitHub half; distinct from the JSR half                                                                                                   |
| **B6** | Point both JSR `description` fields at binaryang                   | both        | shows on the search card, where a reader may never open the page                                                                              |

---

## Phase C — consumer migration

| #      | item                                                            | owner     | notes                                                                                            |
| ------ | --------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| **C1** | Swap two import-map lines to `binaryang/compat/{binaryen,wabt}` | wasmtk    | it already aliases them as `binaryen` and `wabt`, so nothing else moves                          |
| **C2** | Publish wasmtk                                                  | wasmtk    | ✅ **DONE — wasmtk 2.0.1, 2026-08-27.** See § C2 below. Verified against JSR, not reported |
| **C3** | Confirm LeptonPad's `build:wasm` task still runs                | LeptonPad | expected: no change; it resolves wasmtk unpinned                                                 |

---

## Phase D — the break, 1.5.2

| #      | item                                  | notes                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | Publish **binaryang 1.5.2**           | binaryang alone from here                                                                                                                                                                                                                                                   |
| **D2** | Set `isArchived` on both JSR packages | ⚠️ **after** B3/B4 — archiving blocks publishing                                                                                                                                                                                                                            |
| **D3** | Archive both GitHub repos             | ⚠️ **after** the 1.5.1 tags — an archived repo is read-only                                                                                                                                                                                                                 |
| **D4** | **Do not yank anything, ever**        | 🚨 yanking is version-level and affects **resolution**. It would reach backwards into all 31 published wasmtk versions and into LeptonPad's transitive `binaryen-ts@1.4.3` / `wabt-ts@1.3.5`. **This is the single action that converts a safe break into a breaking one.** |

### Why the break is safe

JSR never deletes versions. Publishing 1.5.1 does not remove 1.5.0, and archiving leaves published
versions resolvable. **Everyone already working keeps working**; the break only declines to serve
_future_ resolution of the old names. "Clean break" sounds like the bold option and is the
conservative one — provided D4 holds.

---

## Ordering constraints — the four that actually bite

1. **Publish before archive**, on both JSR and GitHub. Reversed, there is nowhere left to publish.
2. **binaryang 1.5.1 before the signposts.** They point at it.
3. **wasmtk republishes before the old packages are retired in practice.** It is a redistributor,
   not merely a consumer — decision 3 is right about the merge and understates this.
4. **Never yank.** See D4.

---

## Still open

| item                       | blocking? | note                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The promotion-rule gap** | no        | a module is promoted when nothing in either tree imports it across the boundary — but the **bridge is cross-tree by definition**, so the rule can never promote the one module that most obviously belongs to neither side. Decide where `src/bridge` lives; it can move in under `src/wabt-ts/bridge/` and be promoted later at no cost. |
| Signpost wording           | no        | drafted as handoffs when phase B is reached, not now — they would go stale                                                                                                                                                                                                                                                                |

✅ **Closed by the not-EOL policy:** the "what happens when Node 26 becomes LTS on 2026-10-28"
question. Under a lifecycle rule, **nothing happens** — Node 22 stays supported because it is still
alive. The next event that moves a floor is **Node 22's EOL on 2027-04-30**, when the floor becomes
24. That is a calendar item, not a decision.

### C1 verification — wasmtk against published binaryang, 2026-08-27

Run in a scratch copy of the working tree (uncommitted changes included), so nothing in wasmtk was
touched — and specifically so `deno` could not write to its `deno.lock`.

|                            | result                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `deno check main.ts`       | clean                                                                                     |
| suite (`tests/*_tests.ts`) | **12 passed, 0 failed**, exit 0                                                           |
| wast conformance           | **273 passing entries, 15 pinned known-failures**                                         |
| `br_on_cast.wast`          | `pass=23 skip=1 unbuilt-modules=0` — **identical to the B1 control** against the old pins |

✅ **No regression.** The pinned known-failure counts match the pre-migration control exactly, which
is the comparison that matters: the suite was never fully green, so "0 failed" alone would not have
meant anything.

⚠️ **One accounting artifact, and it nearly read as an improvement.** The B1 control reported
`12 passed | 1 failed`; this run reported `12 passed | 0 failed`. That is **one outcome missing, not
one defect fixed**. `tests/wast_tests.ts` does its work in _pre-test output_ and then calls
`Deno.exit(0)`, terminating the isolate — so whether it is counted as a test file at all varies
between runs. Its real verdict is the text it prints and its exit code, not the summary line.

A pre-existing wasmtk harness wart, not a binaryang effect, but worth writing down: a summary that
improves because a file stopped reporting looks exactly like a summary that improves because a bug
was fixed.

⚠️ **`minimumDependencyAge` is already handled** on wasmtk's side (`PT1M`), so the 24-hour wall this
document flagged for C1 does not apply there.

---

## C2 verification — wasmtk 2.0.1, 2026-08-27

**The predecessors are retired.** wasmtk 2.0.1's published dependency list names binaryang for both
compat paths and neither predecessor:

```
jsr  @jrmarcum/binaryang  1.5.2  compat/binaryen
jsr  @jrmarcum/binaryang  1.5.2  compat/wabt
jsr  @std/cli             ^1.0.0 parse-args
jsr  @std/path            ^1.1.2
npm  wasm2js              ^0.2.0
```

Read from JSR's own version-dependencies endpoint, cache-busted, rather than taken from the report.
The constraint is the exact `1.5.2`, not a range — worth knowing before any future binaryang
release, because wasmtk will not pick it up without its own bump.

### ⚠️ `dependentCount` will NOT fall to zero, and that is correct

All three packages still report `dependentCount = 1`:

| package | latest | dependents | archived |
| ------- | ------ | ---------- | -------- |
| binaryen-ts | 1.5.1 | 1 | false |
| wabt-ts | 1.5.1 | 1 | false |
| binaryang | 1.5.2 | 1 | false |

wasmtk's 31 earlier published versions are **immutable** and still name the predecessors, so the
count reflects history, not current usage. **Do not read a non-zero `dependentCount` as C2 having
failed, and above all do not try to drive it to zero** — the only mechanism that would is yanking,
which is D4, the one action that converts a safe break into a breaking one.

Retirement means *no new dependents*, not *no dependents*. That distinction is the whole design of
this ladder.

### Now unblocked

**D2** (`isArchived` on both JSR packages) and **D3** (archive both GitHub repos). Archiving is not
yanking: an archived package keeps resolving for everything already pinned to it and only refuses
new versions, which is exactly the intent. Both are console actions on jsr.io and github.com and
are the user's to run.

---

## D2 / D3 — the archive runbook

Verified 2026-08-27 against the live JSR and GitHub APIs, not from the register.

### Prerequisites — all met

| check | binaryen-ts | wabt-ts |
| ----- | ----------- | ------- |
| JSR latest version is the terminal 1.5.1 | ✅ | ✅ |
| GitHub `v1.5.1` tag present | ✅ | ✅ |
| README signpost live on `main` (B3/B4) | ✅ | ✅ |
| wasmtk no longer depends on it (C2) | ✅ | ✅ |

### ⚠️ B6 is NOT done, and it is bigger than recorded

All four descriptions still present these as live projects:

| where | current text |
| ----- | ------------ |
| JSR `binaryen-ts` | `binaryen rewritten in typescript` |
| JSR `wabt-ts` | `rewrite of wabt in typescript` |
| **GitHub `binaryen-ts`** | `Optimizer and compiler/toolchain library for WebAssembly` |
| **GitHub `wabt-ts`** | `The WebAssembly Binary Toolkit` |

**The two GitHub ones were on nobody's list.** B6 named only JSR. The GitHub description is what
shows in search results and on the org page — the two places someone most likely arrives from — and
both currently describe a live toolchain with no hint it moved.

### Order matters, and it is: descriptions → JSR → GitHub

**1. Set all four descriptions FIRST.** Archiving makes things read-only; editing a description
afterwards means unarchiving and re-archiving. Suggested text:

- JSR (both): `Superseded by @jrmarcum/binaryang — final release 1.5.1`
- GitHub `binaryen-ts`: `Superseded by jrmarcum/binaryang — merged with wabt-ts. Final release 1.5.1.`
- GitHub `wabt-ts`: `Superseded by jrmarcum/binaryang — merged with binaryen-ts. Final release 1.5.1.`

**2. D2 — JSR `isArchived` on both.** Package settings on jsr.io. This blocks any future publish
from those packages, which is the intent: 1.5.1 is terminal.

**3. D3 — archive both GitHub repos, LAST.** An archived repo is read-only, so anything needing a
commit — a README fix, a workflow tweak — must happen before this. It also stops Actions, which is
correct once nothing more will be released.

### What archiving does NOT do

🚨 **Archiving is not yanking.** Every published version keeps resolving; archiving only refuses
*new* versions. wasmtk's 31 earlier releases and LeptonPad's transitive pins are unaffected. **D4
still stands and always will** — see the C2 section above for why `dependentCount` staying at 1 is
correct and must not be "fixed".

### Not a blocker

**C3** (confirm LeptonPad's `build:wasm` still runs) is independent of archiving. It resolves wasmtk
unpinned, and wasmtk 2.0.1 is published, so the expected result is a no-op — but it is unverified
and should not be recorded as done.

### ✅ D3 done, D2 deferred — actual state 2026-08-27

**Both GitHub repos are archived.** D2 (JSR `isArchived`) is deliberately deferred.

The runbook above recommended descriptions → JSR → GitHub. What happened was GitHub first, so
record the consequences rather than the plan:

| | binaryen-ts | wabt-ts |
| - | ----------- | ------- |
| GitHub archived | ✅ | ✅ |
| GitHub description | ⚠️ frozen as `Optimizer and compiler/toolchain library for WebAssembly` | ⚠️ frozen as `The WebAssembly Binary Toolkit` |
| JSR archived | ⬚ deferred | ⬚ deferred |
| JSR description | ⚠️ still `binaryen rewritten in typescript` | ⚠️ still `rewrite of wabt in typescript` |

#### Deferring D2 is low-risk, and the reason is structural

**Archiving the GitHub repo already removed the publish path.** Workflows do not run on an archived
repository, so `publish.yml` cannot fire — and that was the only route that produced provenance. A
new version of either package would now require a deliberate manual `deno publish` from a local
clone with a token, which is not something that happens by accident.

So D2 is now **a statement of intent rather than a control**. Worth doing, not urgent.

#### The one thing that IS worth doing before D2

**The two JSR descriptions are still editable and should be set now.** JSR is where a consumer
actually lands — the description is the first line on `jsr.io/@jrmarcum/<pkg>` — and it is the half
of B6 that archiving has not frozen. It does not depend on D2 and should not wait for it.

#### The GitHub descriptions, and what the gap actually costs

The repo **page** is fine: an archived banner plus the README signpost, which is the strongest
signal and it is in place. What still misdescribes the projects is the **org repository list and
GitHub search results**, which show the description and not the README.

If that is worth closing: try editing "About" directly first, and if archiving has disabled it, the
fix is unarchive → edit description → re-archive. Both operations are non-destructive and take
seconds. This is a judgement call, not a defect — recorded so it is a choice rather than an
oversight.

#### Verified clean

Nothing in binaryang references the archived repos, and the predecessor git remotes point at local
sibling paths (`../binaryen-ts`, `../wabt-ts`), not GitHub — so archiving broke no fetch path.
