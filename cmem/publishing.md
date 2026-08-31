# Publishing — JSR provenance

Merged topic file, **partial**. This covers provenance only. The rest of the release process is
still wing-scoped in [binaryen-ts/publishing.md](binaryen-ts/publishing.md) and
[wabt-ts/publishing.md](wabt-ts/publishing.md), because the two release scripts are not yet
reconciled and a merged document would describe a flow that does not exist. See
[INDEX.md](INDEX.md).

## RULE — never bump the version in the same change that merges to `main`

**Merge first, unbumped. Bump as its own commit afterwards.**

`auto-tag` runs on every push to `main` and asks exactly one question: does
`refs/tags/v<deno.json version>` already exist? It does not compare versions, and it does not detect
a change. **So a merge that carries a version bump IS a release** — the same push integrates the
code and publishes it.

### Why that is worth a rule and not a habit

**One action must not do two things when only one of them is reversible.** A bad merge can be
reverted; a bad publish cannot. JSR versions are immutable — there is no unpublish, no overwrite,
and a yank would reach backwards into every consumer that already resolved it. Merging and releasing
have completely different blast radii and they should not share a trigger.

**It lets `main` be verified in its integrated state before anything ships.** A branch can be green
and the merge still wrong: a bad resolution, a lost hunk, two changes that pass separately and
conflict in behaviour. Merging first buys a real check of the thing that will actually be published,
instead of a check of the thing that was about to be merged.

**It makes the release chosen rather than inherited.** A release branch carrying a bumped version is
**armed from birth** — every merge of it publishes, including a premature one, a partial one, or one
made to unblock somebody. Keeping the branch on the released version means the branch is safe to
merge at any point, and the bump is the moment somebody decides to ship.

**It survives review.** A reviewer reading a merge diff sees code. One line of `deno.json` is what
turns that diff into an irreversible public act, and it is the least conspicuous line in it. Making
the bump a separate commit puts the decision where it cannot be skimmed past.

### The sequence

```
1. merge release/X.Y.Z -> main      # version still the RELEASED one; auto-tag no-ops
2. push main                        # CI runs on the integrated tree; nothing publishes
3. verify main is green
4. bump deno.json AND main.ts       # its own commit — this is the arming step
5. push main                        # auto-tag tags vX.Y.Z and the release goes out
```

Both files, together: `tests/binaryen-ts/version_sync.test.ts` fails the publish otherwise, and
`deno task bump` rewrites both.

⚠️ Two consequences of the rule being _"tag exists"_ rather than _"version increased"_: deleting a
tag re-arms that version, and a downgrade triggers a publish too. There is no monotonicity check.

## The one thing to understand

**Provenance fails silently, and a green publish run is not proof.**

`deno publish` skips attestation **non-fatally** when it cannot mint or submit the GitHub OIDC
token. The run succeeds, the version publishes, the release is created, and provenance is simply
absent. JSR versions are immutable, so by the time anyone notices, it cannot be fixed for that
version.

**The only evidence is JSR's `rekorLogId`**:

```sh
curl -s -H 'Accept: application/json' \
  https://api.jsr.io/scopes/jrmarcum/packages/<name>/versions/<version> | grep rekorLogId
```

`.github/workflows/publish.yml` polls exactly that as its **last** step and fails the job when it
comes back null. Last, deliberately: the version exists either way, so failing there surfaces the
problem loudly without blocking the publish or the GitHub release.

⚠️ **The OIDC availability step is NOT that evidence.** It checks a prerequisite — whether
`ACTIONS_ID_TOKEN_REQUEST_URL`/`_TOKEN` reached the runner. wasmtk got **ten releases of false
assurance** from exactly that step: it emitted no warning and provenance was absent anyway. It is
kept because when it _does_ fail it names the cause immediately (org/enterprise Actions OIDC
policy), which is otherwise invisible.

## Do not "fix" provenance by editing the YAML

Measured 2026-08-26: **binaryen-ts's `publish.yml` is byte-identical at `v1.4.3` (no provenance) and
at `v1.5.0` (provenance).** Same `id-token: write`, same direct `deno publish`. The workflow is not
the variable, and editing permissions or restructuring the job is motion without effect.

The structural requirements are already met and worth stating once so they are not re-litigated:

- `permissions: id-token: write` (plus `contents: write` for checkout and the GitHub Release)
- `deno publish` called **directly**, never through `deno task publish` — the task wraps a script
  that spawns `deno publish` via `Deno.Command`, and OIDC detection does not propagate into the
  subprocess
- no `--token` / `DENO_AUTH_TOKEN` (their presence disables OIDC), and no `--no-provenance`
- the JSR package linked to the GitHub repo — ✅ verified for `@jrmarcum/binaryang`

⚠️ The inherited version of this comment cited **wasmtk** as precedent for calling `deno publish`
directly. wasmtk has **no provenance on any published version**, so it was never evidence for
anything. Corrected rather than repeated.

## Measured history, 2026-08-26

Read from the JSR API across the scope. This is the useful part, because it shows the failure is
**intermittent and per-package**, not a setting anyone got wrong:

| package         | provenance                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **wabt-ts**     | present on 1.5.0 (2026-08-26), 1.4.1, 1.4.0, 1.3.5, 1.3.4, and back to 1.2.7 — **one isolated gap at 1.3.3 (2026-06-10)** |
| **binaryen-ts** | present at 1.3.1–1.3.3, then **dark from 1.3.5 (2026-06-10) through 1.4.3 (2026-07-09)**, recovered at 1.5.0 (2026-08-25) |
| **wasmtk**      | last attested release **1.11.2 (2026-07-03)**; dark ever since, including 2.0.0                                           |

Two things follow that neither project had established:

🆕 **Provenance works on this account and scope right now.** Two packages were attested on
2026-08-25 and 2026-08-26. Whatever broke wasmtk is not a global JSR or GitHub change — which is the
leading hypothesis in `wasmtk/cmem/design-decisions.md` ("remaining suspects: JSR-side or
GitHub-side changes in the 2026-07-03 → 07-09 window"). That window is refuted by these dates, and
it is worth telling them, because it is an open investigation that has already ruled out the Deno
version.

🆕 **Both siblings lost provenance on the same day — 2026-06-10.** wabt-ts at 1.3.3 and binaryen-ts
at 1.3.5. wabt-ts recovered on its next release; binaryen-ts stayed dark for a month. A shared
single-day failure across two independent repos reads as transient infrastructure, not configuration
— and binaryen-ts's month-long tail then looks like nobody re-checked, rather than like a second
cause.

## `--allow-slow-types` was removed

binaryen-ts passed `--allow-slow-types` because `interop/binaryen-js.ts`'s `BinaryenInterop.create`
does a runtime-configurable `await import(path)`, which JSR cannot statically resolve.

**Measured 2026-08-26: the merged tree passes the slow-types check without it.** Keeping it is not
neutral — JSR's own warning says a slow-types package ships **no `.d.ts` for Node users**, and Node
support is one of binaryang's published capabilities.

It also closed a gate mismatch: CI's dry-run ran `deno publish --dry-run --allow-dirty` while the
real publish ran `deno publish --allow-slow-types`, so the gate was verifying a different
configuration from the one that ships. They now run the same command.

## 1.5.1 published — the result

`@jrmarcum/binaryang@1.5.1`, 2026-08-27, **provenance recorded: `rekorLogId=2618802426`**. The
verification step confirmed it in-run rather than leaving it to be discovered later. Smoke-tested
against the PUBLISHED artifact (not local paths): `./wat2wasm`, `./wasm2wat`, `./core/wabt-ts` and
`./binary` in one program, round-tripping and executing correctly.

### ⚠️ The first tag push produced NO workflow run at all

Pushed the tag before the branch. At that moment the remote's `main` was still the initial
README-only commit, so Actions had no `publish.yml` registered to match a tag event against — the
event passed unmatched and silently. Pushing `main` then registered all three workflows, and
`auto-tag` correctly no-opped because the tag already existed. Net effect: a tag, a green CI run,
and no release.

Fixed by deleting and re-pushing the tag once the workflows were registered.

**This only bites on a repository's first push**, and the intended release flow avoids it entirely,
because there the branch push always comes first. Worth writing down anyway: the symptom is not an
error, it is an _absence_, and absence is the hardest thing to notice.

### The score is 88, and provenance is not why

Read from `api.jsr.io/scopes/jrmarcum/packages/binaryang/score` — **15 of 17 factors**:

| factor                                                   | binaryang | siblings (18/18) |
| -------------------------------------------------------- | --------- | ---------------- |
| `hasProvenance`                                          | ✅ yes    | yes              |
| `allFastCheck`                                           | ✅ yes    | yes              |
| `hasReadme` / `hasReadmeExamples` / `allEntrypointsDocs` | ✅ yes    | yes              |
| `percentageDocumentedSymbols`                            | 98.1%     | 98.3% / 99.7%    |
| **`hasDescription`**                                     | ❌ **NO** | yes              |
| **`atLeastOneRuntimeCompatible`**                        | ❌ **NO** | yes              |
| **`multipleRuntimesCompatible`**                         | ❌ **NO** | yes              |

**All three gaps are JSR-side settings, not code.** Verified: neither sibling's `deno.json` contains
a `description` field, yet both score `hasDescription: yes` — so it is set in the JSR package
settings UI, and the runtime-compatibility flags likewise. Set description, and tick Deno / Node /
Bun / browser, and the score reaches parity.

### How to find the undocumented symbols — the method, not the number

The table row above is a **snapshot**; `percentageDocumentedSymbols` reached **100%** for binaryang
on 2026-08-27. What is worth keeping is how the gap was located, because the obvious route is a dead
end.

⚠️ **`deno doc --lint` is NOT a doc-coverage check, and its number does not track JSR's.** The two
have different denominators: the lint counts nested interface members, JSR counts declarations.
binaryang saw **701** lint errors against 98.1%; wasmtk saw the lint **clean on all 16 entrypoints**
against 98.04%. The same discrepancy from opposite sides, confirmed independently in both repos.

**Chasing the lint number to fix the JSR one means several hundred filler comments on struct
fields, and does not move the score.**

**Find the real gap arithmetically.** JSR's percentage is an exact fraction: `0.98087955` is
`513/523` to eight digits, so **ten** declarations were missing — not seven hundred. Then read
`deno doc --json`:

- a symbol carries `declarations[]`, each with its own `jsDoc`; a symbol is documented if **any**
  declaration has one;
- entries with `kind: "reference"` are **re-exports whose originals carry the doc**. Counting them
  is what makes a first pass overshoot — it reported 36 against a true 10.

⚠️ **`percentageDocumentedSymbols` earns no points.** The score keys on `allEntrypointsDocs`.
binaryang scored **100 while that percentage read 98.1%**, so raising it is a quality decision and
must not be described as a score fix.

_Relocated from machine-local memory 2026-08-27, where it was the only copy — the same move wabt-ts
made with its formatter notes, and for the same reason: this is PROJECT knowledge and would not
survive a clone. Machine-level facts (`safe.directory`, the repack failure) correctly stay outside._

`allFastCheck: yes` independently confirms that removing `--allow-slow-types` was right: the package
passes fast-check, so it ships a `.d.ts` for Node consumers.

### The `unanalyzable-dynamic-import` warning is benign

Publishing emits:

```
warning[unanalyzable-dynamic-import]: unable to analyze dynamic import
  --> src/binaryen-ts/interop/binaryen-js.ts:160  mod = await import(path);
```

It affects **neither provenance nor the score** — `allFastCheck` is already `yes`. JSR's concern is
that a dynamic import resolved through a local import map would break for consumers, because it
cannot be rewritten at publish time.

✅ That does not apply here. The default specifier is `npm:binaryen`, a **runtime** scheme rather
than an import-map alias, and binaryang's import map contains no `binaryen` entry at all (only
`@std/*`) — so there is nothing to rewrite and nothing that breaks. The warning is JSR correctly
reporting that it cannot see through `await import(path)` where `path` is a parameter, which is the
whole point of the API: callers may pass their own specifier or a pre-loaded module.

🔓 One real caveat behind it, unrelated to publishing: `npm:` resolves on **Deno** only. Node and
Bun callers must pass `binaryenJsPath` or `{ binaryen }`, which `create()`'s doc comment and its
error hint both say. `./interop` is documented as not browser-available.

### Consumers hit a 24-hour wall

Deno's `minimumDependencyAge` (default 24h) refuses a version this new:

> Could not find version … A newer matching version was found, but it was not used because it was
> newer than the specified minimum dependency date

Expected, not a defect — pass `--min-dep-age=0`, or wait. Worth knowing before wasmtk's migration
(C1): binaryang's own `deno.json` sets `minimumDependencyAge: "0"`, inherited from wabt-ts, but a
consumer's setting is the one that governs.

## 🆕 The JSR version API is CACHED — do not read it once and believe it

**The single most misleading thing found in this whole investigation.**

`api.jsr.io/scopes/<scope>/packages/<pkg>/versions/<ver>` serves a cached record. Attestation is
written asynchronously a few seconds after publish, and a plain re-read can keep returning the
**pre-attestation** record for minutes — `rekorLogId: null`, `updatedAt == createdAt`.

Measured 2026-08-27 on `wabt-ts@1.5.1`: eight consecutive plain reads over ~3 minutes all returned
`null`; a single **cache-busted** read returned `rekorLogId: 2618866200`, written at 20:33:42, four
seconds after publish. The release had provenance the whole time.

```sh
# WRONG — can report a false negative for minutes
curl -s -H 'Accept: application/json' "$URL"
# RIGHT
curl -s -H 'Accept: application/json' -H 'Cache-Control: no-cache' "$URL?cb=$(date +%s)"
```

⚠️ **This was a live defect in our own verification step**, which polled without cache-busting and
could therefore have failed a release that actually succeeded. Fixed.

⚠️ **And it is worth passing to the wasmtk investigation**, whose verify step has the same shape. It
does not explain wasmtk's long-term absence — a months-old version is not still cached — but any
_immediately post-publish_ check it makes is unreliable, and a false negative there would send the
next person hunting a problem that is not there.

**The tell:** an attested version has `updatedAt` a few seconds AFTER `createdAt` — the attestation
being recorded. `updatedAt == createdAt` means either not-yet-attested or never-attested, and only a
cache-busted read distinguishes them.

## 🚨 The auto-tag dispatch path does NOT publish — 3 of 3

Measured across three releases of three packages:

| trigger                                            | outcome                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `workflow_dispatch` (auto-tag's `gh workflow run`) | **failed at `deno publish`** — binaryen-ts, wabt-ts, binaryang 1.5.2, **and 1.5.3** — 4 of 4. **Cause found, see below** |
| `push: tags` (tag pushed by a user)                | **succeeded** — 5 of 5 across all three packages                                      |

⚠️ **This is no longer a correlation with one plausible confound.** The first two failures were the
same day inside a four-minute window, which a transient registry-side fault would explain. The third
is a different package, hours later, on a workflow that had since gained an OIDC diagnostic — and
that diagnostic emitted **no warning**, so the token was present. Nothing published on any of the
three; each died at `deno publish` with only `exit code 1`, and the Actions logs endpoint is 403
unauthenticated so the reason is still unrecovered.

**Practical consequence: the documented release flow does not work.** _Merge to main → auto-tag →
dispatch → publish_ fails at the last step, every time so far. The reliable sequence is:

```
merge (unbumped) -> push -> verify -> bump -> push        # auto-tag creates the tag; publish FAILS
git push origin :refs/tags/vX.Y.Z && git push origin vX.Y.Z   # re-push it; publish SUCCEEDS
```

The tag `auto-tag` creates is correct — only the dispatch fails — so deleting and re-pushing that
same tag is enough, and costs one red run in the history.

**The real fix is to remove the dispatch.** `auto-tag` only calls `gh workflow run` because a tag
pushed by `GITHUB_TOKEN` cannot trigger a workflow (GitHub's recursion guard). Pushing that tag with
a PAT or deploy key would fire `publish.yml` through `push: tags` — the path with a 5-of-5 record —
and delete the failing step entirely.

### The fix: `RELEASE_PAT`

`auto-tag` now checks out with `token: ${{ secrets.RELEASE_PAT || secrets.GITHUB_TOKEN }}`. The
token checkout stores is the one `git push` later uses, and that is what decides whether the tag
push triggers `publish.yml`.

- **With `RELEASE_PAT` set** — the tag push is attributed to that identity, fires `publish.yml`
  through `on: push: tags`, and the dispatch step is skipped entirely. That is the path with a
  **5-of-5** record.
- **Without it** — the dispatch fallback runs, emits a `::warning::` naming the cause, and prints
  the two-command manual recovery. Nothing changes for the worse; the repo still behaves as it did.

🔓 **Setup, one time, owner action:** create a fine-grained PAT with **Contents: read and write** on
this repository, and add it as the repository secret `RELEASE_PAT`. Nothing else needs changing.

⚠️ **Implementation note worth keeping:** the `secrets` context is not dependably available in a
step-level `if:`, so the presence of the PAT is turned into a plain step output (`yes`/`no`) and the
conditions gate on that. Writing `if: secrets.RELEASE_PAT != ''` looks correct and can silently
evaluate the wrong way. The secret's value is never echoed — only its name appears, in messages.

**Why a PAT and not a reusable workflow.** Converting `publish.yml` to `workflow_call` and invoking
it from `auto-tag` would avoid the PAT, but it changes the OIDC claim shape that JSR attests against
— and provenance can only be tested by publishing, burning a version number per attempt. The PAT
routes the release through the exact trigger that already works, so it risks nothing.

## The verification step was tested against both sides

Not assumed to work. Its logic was run against four real published versions before being wired in:

|                     |                         |
| ------------------- | ----------------------- |
| `wabt-ts@1.5.0`     | PASS — Rekor 2603257282 |
| `binaryen-ts@1.5.0` | PASS — Rekor 2590420167 |
| `binaryen-ts@1.4.3` | FAIL — no provenance    |
| `wasmtk@2.0.0`      | FAIL — no provenance    |

A check that has only ever been seen to pass is a claim, not a gate.

---

## 🚨 ROOT CAUSE of the `workflow_dispatch` publish failures — found 2026-08-27

It was never flakiness, and it was never the YAML. The 1.5.3 attempt returned a real error instead
of a bare `exit code 1`:

```
error: Failed to publish @jrmarcum/binaryang@1.5.3
Caused by:
    The actor that this request was authenticated for is not authorized as a
    scope member for this scope. (actorNotScopeMember)
```

**JSR authorises the OIDC token's ACTOR, and on a dispatched run the actor is
`github-actions[bot]`** — which is not a member of the `@jrmarcum` scope. Confirmed directly
against the runs API:

| workflow | event | actor | result |
| -------- | ----- | ----- | ------ |
| Publish to JSR (v1.5.3) | `workflow_dispatch` | **`github-actions[bot]`** | ❌ failure |
| every other run | `push` | `jrmarcum` | ✅ success |

That single column explains **5 of 5 versus 0 of 4** completely. A tag pushed by a person carries
actor `jrmarcum`, who is a scope member; a workflow dispatched by `auto-tag` using `GITHUB_TOKEN`
carries the bot, who is not.

### What this retires

The register said *"treat this as a correlation, not a cause — one dispatch run per repo, in a
four-minute window, with no OIDC diagnostic in place."* That caution was correct at the time and is
now **spent**: there is a mechanism, it is checkable in one API field, and it predicts every
observation.

It also retires the idea that provenance was ever the variable. Provenance never got a chance to
fail — the publish was rejected at authorisation.

### Why `RELEASE_PAT` is the fix, and not a stylistic preference

`auto-tag` checks out with `token: ${{ secrets.RELEASE_PAT || secrets.GITHUB_TOKEN }}`. With the PAT
present, the tag is pushed **as its owner**, so `publish.yml` fires on `push: tags` with actor
`jrmarcum` — a scope member. Without it, the tag is pushed by `GITHUB_TOKEN`, GitHub's recursion
guard suppresses the tag event, `auto-tag` falls back to dispatching, and the dispatch runs as the
bot and is rejected.

⚠️ **The 1.5.3 failure is proof the secret is not set.** The fallback is doing exactly what it was
designed to do — warn and try anyway — and the attempt cannot succeed.

**The PAT must belong to a JSR scope member.** A fine-grained PAT with Contents: read/write, owned
by `jrmarcum`. A PAT from a non-member account would push the tag successfully and fail publish the
same way.

### Recovery when this happens

Nothing is published, so nothing is burnt — a JSR version is only immutable once it exists. Delete
the remote tag and re-push it from a workstation, where the pusher is a real user:

```sh
git push origin :refs/tags/vX.Y.Z
git tag -a vX.Y.Z -m "vX.Y.Z" HEAD
git push origin vX.Y.Z          # actor = jrmarcum -> push:tags -> publishes
```

✅ **The recovery was executed for 1.5.3 and worked, which confirms the mechanism rather than
merely the fix.** The re-pushed tag produced `event=push`, `actor=jrmarcum`, `conclusion=success`,
and `1.5.3` landed on JSR with provenance (`rekorLogId=2620472173`, `createdAt`→`updatedAt` four
seconds apart). Same commit, same workflow, same YAML as the run that failed minutes earlier — only
the actor differed.

---

# The release process (§2.2, merged 2026-08-27)

Everything above this line is the provenance half, merged at A16. This half waited on §2.1: it
describes one release flow, and until `scripts/release/` existed there were two.

## 🚨 Never run `deno publish` locally

**Both projects wrote this rule independently, in nearly the same words.**

Provenance only attaches when `deno publish` runs inside the GitHub Actions workflow, which supplies
the OIDC token JSR fingerprints. A local `deno publish` **succeeds and uploads** — and that version
is permanently flagged "No provenance". **It cannot be retro-fixed on that version number**; the
only remedy is to burn another one.

binaryen-ts `1.0.0`–`1.0.9` carry an empty `rekorLogId` for exactly this reason.

The only safe local invocation is `deno task publish:dry` (`--allow-dirty`, never uploads).

**Symptoms someone published locally:** no git tag for the version; no "Provenance" badge on JSR; a
bumped-and-published `deno.json` with no corresponding run under the `publish.yml` workflow.

The protection is **structural, not defensive**: `scripts/release/publish.ts` has no `deno publish`
call site at all. It stages, commits, tags and pushes; the tag push is what publishes.

## The flow

```sh
git add -A && git commit -m "..."   # commit ALL source changes FIRST -- see the guard below
deno task bump                      # rewrites deno.json AND main.ts (sub-version capped at 9)
deno task release                   # guard, commit the bump, tag, push commit + tag atomically
```

The tag push fires `publish.yml`, which verifies the tag matches `deno.json`, runs `check` and
`test`, then calls `deno publish` **directly** — never through `deno task`, because that indirection
spawns a subprocess and loses OIDC — and finally creates a GitHub Release.

⚠️ **In practice a release currently needs a manual step**, because `RELEASE_PAT` is not set. See
the root-cause section above.

## Version rule — sub-version capped at 9

`1.0.9 → 1.1.0`, `1.9.9 → 2.0.0`, major uncapped (`9.9.9 → 10.0.0`). Both projects adopted this
independently; enforced by `deno task bump`, which rewrites **both** `deno.json` and `main.ts`
(`version_sync.test.ts` fails the publish if they disagree) and preserves formatting by replacing
only the version line rather than round-tripping the JSON.

### ⚠️ `bump` has no minor mode — a non-patch release is typed by hand

binaryen-ts set 1.5.0 by hand from 1.4.3, because a sweep had removed four dead exports. **Removing
an exported symbol is a breaking change regardless of whether anything imported it** — you cannot
know that nothing did.

wabt-ts reached the same rule from the other direction and recorded the corollary that matters:
**verify who the break actually reaches.** Its `Limits.initial`/`max` moving to `bigint`, and
`pageSize` becoming `pageSizeLog2`, looked like they would hit wasmtk and did not — wasmtk consumes
`/compat`, which exposes neither. That was established by replaying their call sites from
`origin/main`, not assumed.

**A behavioural break counts too.** Feature-gating the validator meant callers passing
`defaultFeatures()` started getting rejections where they previously got success. That is the option
finally working, and it is still a behaviour change that belongs in release notes.

## `publish:dry` is in CI but NOT in `deno task test`

It runs the **slow-types** check, which `deno task check` does not. Moving one constant into another
file made it public API without an explicit type — a `missing-explicit-type` error that **339
passing tests and three full metric runs never saw**.

**Run it whenever a change ADDS or MOVES an exported symbol**, not only when publishing. It also
backs the Node compatibility claim: Node cannot run the sources directly, so the supported path is
the transpiled JSR package, and slow types are what make that transpilation possible.

## Preconditions

The GitHub repo must be linked under "GitHub Actions" in the JSR package settings, or OIDC
provenance is rejected. Verify through the API rather than the settings UI, which has been
unreachable before:

```sh
curl -s https://api.jsr.io/scopes/jrmarcum/packages/binaryang | jq .githubRepository
```

`provenance: true` is **not** a `deno.json` field — it was removed when JSR went OIDC-only. Delete
it if you see `unknown field provenance`.

**Pin actions to the major-version tag** (`actions/checkout@v6`, `denoland/setup-deno@v2`,
`actions/setup-node@v4`, `oven-sh/setup-bun@v2`): mutable, auto-flows patches, guards the major
boundary. Moving checkout from v4 to v6 was forced by GitHub's Node 20 runtime deprecation.

## Recovery recipes

### A dirty tree ships a release containing none of the work

`publish.ts` stages `deno.json` and nothing else, so on a dirty tree it commits a bare version bump,
tags that, and publishes a release with none of the code. **binaryen-ts v1.2.3 shipped as
effectively v1.2.2 with a different version string** — two sessions of fixes sat uncommitted, and
the wasmtk team reported "the bugs you fixed are still there", because they were.

Guarded now by `scripts/release/release-guard.ts`. **Untracked files count as dirty too**: a new
source file that was never committed is absent from the tag, so the release is missing it while
every local check still passes, because the file is sitting on disk.

### `deno task check` caches per file, and lies locally

Editing file A does not re-check file B even when B's types depend on A — B's own bytes did not
change. CI starts with no cache and catches it; local does not. **This shipped v1.2.4 broken**: a
new member made a compat `Record` incomplete, local passed, CI failed at the publish step, leaving
an orphaned tag with no JSR publish and no Release.

**Recovery: bump and re-publish** — JSR has no record of a version whose publish failed. Guard
against it with a cold `deno check --reload` before tagging, which is what the v1.5.0 pre-flight
actually ran.

### `would clobber existing tag`

If `git fetch origin --tags` rejects with this, the local tag points at a different commit than the
remote's. **The remote is canonical.** Fix: `git tag -d vX.Y.Z && git fetch origin --tags`.

### A tag pushed before the branch produces NO workflow run at all

See the provenance half above — on a repo's first push Actions has no workflow registered to match a
tag event against, and the event passes unmatched. Push the branch first.

## Repo hygiene and the memory routing rule

`CLAUDE.md` and `TASKS.md` are **gitignored** — machine-local working notes. `cmem/` is
**committed** portable memory, and supersedes the gitignored `CLAUDE.md`.

**The routing rule, stated by both projects independently:** if a teammate would need to see it, it
goes in `README.md`; if it is curated internal project memory, it goes in `cmem/`.

binaryang has **no submodules** — the predecessor remotes point at local sibling paths. Both wings
carry a submodule-remnant recovery recipe (`git rm --cached` leaves behind a `.git` file and the
`.git/modules/<name>/` storage, worth hundreds of MB). It no longer applies here and is left in the
wings for the history.
