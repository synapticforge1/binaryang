# Publishing — JSR provenance and the release process

JSR provenance, the release pattern, the publish workflow's jobs. The release process half is
[publishing-release-flow.md](publishing-release-flow.md); closed and historical sections are in
[archive/publishing-to-4.1.1.md](archive/publishing-to-4.1.1.md). Last verified 2026-11-20.

Merged topic file, **both halves**: the provenance half at A16, the release process at §2.2
(2026-08-31, once `scripts/release/` made it one flow — the second half starts at "The release
process" below). The wing files it merged are summarized in [binaryen-ts.md](binaryen-ts.md) and
[wabt-ts.md](wabt-ts.md), each with its `git show` command.

🔒 **Since 2026-11-10 the release ORDER is the owner's D1 (workspace letter H33): `bun run release`
pushes `main` ONLY; `publish.yml` runs on that push — `checks` → CI's `tag` → the `release` page →
`jsr` / `npm`; `auto-tag.yml` is retired.** The current flow, binaryang's commands and jobs, is
[release.md](release.md) § "How a release is made"; **every release record is in
[release.md](release.md) § "Release History"** (moved 2026-11-11, D3 — a pointer marks each spot).
Below, wherever a section says the tag is pushed from this machine, "the tag push publishes", or
auto-tag tags and dispatches, it is history.

**Latest (2026-11-11 UTC): 3.0.4 on BOTH registries, both with provenance** (run 43072390794,
JSR Rekor `3815373888`; release.md § "3.0.4"). Before it, **3.0.3** — the first release
in D1's order (run 43061998593: CI's tag, the page, JSR Rekor `3814264552`, npm SLSA); release.md
§ "3.0.3". Before it, **3.0.2 on BOTH registries, both with provenance** — JSR
`@jrmarcum/binaryang@3.0.2` (Rekor `3771557608`) and npm `@synapticforge1/binaryang@3.0.2`
(`latest`, SLSA provenance), GitHub Release `v3.0.2` by `github-actions[bot]` — release.md
§ "3.0.2", the restructured workflow's first fully green run. **3.0.0 and 3.0.1 are on JSR only**
(npm went from 2.2.2 to 3.0.2; release.md § "3.0.0", § "3.0.1"). **The history was rewritten a second
time on 2026-10-28** (§ "The second purge"): every hash from 2026-10-13 on changed again. **The repo is
`synapticforge1/binaryang` since 2026-10-20** (§ "The move to `synapticforge`"; the JSR package name
is unchanged), and **its history was rewritten on 2026-10-22, pushed 2026-10-23** — every commit
hash changed (§ "The history purge").

**The release pattern — SETTLED; read this before any section below** (re-stated 2026-10-23, drift
B3):

1. `CHANGELOG.md` § X.Y.Z on a `release/X.Y.Z` branch, gated on the committed tree, merged
   `--no-ff`; `main` pushed UNBUMPED; CI green (auto-tag too, until it was retired 2026-11-10).
2. The CI half of the gate from a FRESH CLONE from GitHub of that commit.
3. **The consumer check** (workspace letter H6, rule 3): wasmtk's suite against the UNPUBLISHED
   build — wasmtk's own `upstream/binaryang` setup does it from their side, so this step is a
   letter asking for it, and a red consumer suite on a patch or minor blocks the release. Skipped
   only when nothing a consumer imports or produces changed, and that said in the record.
4. No tag and neither registry has X.Y.Z; `bun run bump [patch|minor|major]` — the level is the
   owner's call, but **never below the compatibility FLOOR**: the bump refuses unless the committed
   `api-surface.json` is this tree's surface, prints the floor the surface diff since the last tag
   demands (removed / changed → major, added → minor), refuses a lower level, and for a patch or
   minor runs the previous release's tests against this tree (`scripts/release/api-surface.ts`,
   `previous-tests.ts`, `tests/accepted-changes.json`). `version_sync` green.
5. `bun run release` — its guards, then `bump to vX.Y.Z`, and **`main` ONLY** pushed as a user
   (D1, 2026-11-10; until then `main` + the tag in one push). `publish.yml` runs on that push:
   **six jobs** (§ "The publish workflow's jobs" below) — `checks` (no token; is it a release, both
   registries free, the floor check `api-surface.ts --release-check`, check, tests, dry run) →
   `npm-build` (the npm package proven, no token; skipped while npm publishing is off) → `tag`
   (CI's tag, only once both are green) → `release` (the page) → `jsr` (credential) → `npm`
   (credential). 🔁 2026-11-13 (review rounds 1–3): `npm-build` runs BEFORE the tag; until then
   it ran beside `jsr`, after the tag. ✅ **Order measured by 3.0.3** (run 43061998593, all six
   green); the round-1 change to it is UNMEASURED until the next release — read every job of a
   release run, and on a failure use "Re-run failed jobs" (the jobs skip what is done), never a
   new tag.
6. Read both registries back (Rekor id on JSR, the attestation on npm), run the package as a user
   from each, record it in [release.md](release.md) § "Release History", newest first.

**The compatibility gate** (workspace letter H6, built 2026-10-23; `../../workspace/cmem/layout-and-packaging.md`
§ "The compatibility gate"):

- **Rule 1, the snapshot** — `api-surface.json` at the repo root: per export subpath every symbol
  and member `deno doc` reports, with kind and a 12-hex fingerprint of its normalised declaration
  (docs, locations, resolution paths dropped; a re-export fingerprinted by what it points AT, not
  by line — an attribution header added above a type once read as 17 "changed" symbols); per CLI
  tool its flags; the pass names. Shipped in neither package. `bun run surface` writes it,
  `surface:check` compares, `surface:floor` reports the floor since the last tag.
- **Rule 5, re-baseline in its own commit** — CI's Gates job runs `surface:check` on every push.
- **Inverted before trusted** — an added export → minor, a changed signature → major, a removed
  `export` → major (that one first read as patch: `deno doc` keeps documenting a non-exported type an
  exported signature uses, as `private`, which is now excluded); the bump refused a patch against a
  minor floor and a stale snapshot, and passed a minor. The previous-tests check counts testcases and
  fails on zero (its first run printed "? tests").
- 🔧 **Its first release (1.16.0) found a defect:** the root CLI's usage text names the version
  ("binaryang 1.16.0 — …"), so the bump commit itself read as "usage text changed" and CI's
  `surface:check` went red on `d81463f32` — every bump would have. The publish was NOT stopped
  (publish.yml runs only `--release-check`, which passed). Fixed 2026-10-24: `usageText` replaces
  the tree's OWN version (its `jsr.json`) by `<version>` before fingerprinting; re-baselined once
  in its own commit. 🔧 **The other half of that trap, 2026-11-09:** a help line that names the
  NEXT release ("Until 3.0.0 …") reads as changed at the bump that reaches it. The 3.0.0 bump
  found it (§ "3.0.0"). **Rule: no help or usage text names a version of this package**; check
  with the version set to the target before bumping — `bun run bump <level>`, then
  `surface:check`, and undo the bump if it fails.
- **Rule 4, deprecate before removing**, and the README's `### ⚠️ Breaking Changes` table — written
  when the deprecation lands, with the migration.

A patch while `main` holds unreleased work went from a branch cut from the last tag (release.md
§ "1.6.1"); since D1 CI releases only from `main`, so such a patch is a question for the owner
first. `RELEASE_PAT` stays closed as not needed (owner, 2026-09-29), and auto-tag.yml — the
dispatch path that never published (§ "The auto-tag dispatch path does not publish") — is
retired (2026-11-10).

The sections below this one are in the order they were found (the provenance half, then the
release-process half from § "The release process"). A later section can narrow an earlier one;
where they differ, the pattern above is current.

## RULE — never bump the version in the same change that merges to `main`

**Merge first, unbumped. Bump as its own commit afterwards.**

🔧 **The manifest is `jsr.json` since 2026-10-12** (Bun migration B1, [bun-migration.md](bun-migration.md)).
Wherever this file says `deno.json` for the version, the bump, `RELEASE_FILES` or the tag check,
read `jsr.json`. The release records below keep the name that was true when they were written.
Both publish commands are `deno publish --config jsr.json`. While a `deno.json` exists, Deno
takes the package from `deno.json` and ignores `jsr.json`. **Since B4, `deno task bump` /
`deno task release` are `bun run bump` / `bun run release`** (the scripts are `node:`-only and
run on Bun; the release script's cold type check still runs `deno task check` in a fresh
`DENO_DIR` until B5).

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
5. push main                        # auto-tag tags vX.Y.Z — and, with no RELEASE_PAT, DISPATCHES
                                    # publish.yml, which FAILS (0-for-4; 1.9.0 below)
6. git fetch origin --tags && git push origin :refs/tags/vX.Y.Z && git push origin vX.Y.Z
                                    # YOUR tag push is what publishes (a push event by a member)
```

Both files, together: `tests/binaryen-ts/version_sync.test.ts` fails the publish otherwise, and
`deno task bump` rewrites both.

⚠️ Two consequences of the rule being _"tag exists"_ rather than _"version increased"_: deleting a
tag re-arms that version (the next merge re-tags and attempts a republish, which JSR rejects as
immutable, so the job goes red rather than doing something silently wrong), and a downgrade triggers
a publish too. There is no monotonicity check.

🚨 **A tag publishes from ANY branch.** `publish.yml` keys on `push: tags: [v*]` with no branch
constraint, so pushing a `v*` tag from a feature or release branch publishes immediately — the one
thing reachable from a branch push that can. (Recorded in 1.5.2's scope; see
[project.md](project.md).)

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

- `permissions: id-token: write` (plus `contents: read` for checkout; `contents: write` for the
  GitHub Release until 2026-11-09, when the page moved to its own `release` job — letters H30 /
  H32; `id-token` was not touched)
- `deno publish` called **directly**, never through `deno task publish` — the task wraps a script
  that spawns `deno publish` via `Deno.Command`, and OIDC detection does not propagate into the
  subprocess
- no `--token` / `DENO_AUTH_TOKEN` (their presence disables OIDC), and no `--no-provenance`
- the JSR package linked to the GitHub repo — ✅ verified for `@jrmarcum/binaryang`

🔧 **The jobs WERE restructured on 2026-11-09** (next section) — for the credential's exposure,
not for provenance. Every requirement above still holds in the `jsr` job, which is where
`deno publish` now runs.

## The publish workflow's jobs (open-work 54, 2026-11-09; D1 order 2026-11-10)

The owner's call ("restructure the publish workflow"), on workspace correspondence C30 and C34
from S3D. **Why:** `id-token: write` IS the publishing credential — JSR and npm trusted
publishing both take the workflow's OIDC token, and every step of a job that holds it can mint
one. Until then the one `publish` job held it while `bun install` and the whole test suite ran,
and `npm` held it while it installed and built: every dev dependency ran beside it.

🔒 **Re-ordered 2026-11-10 to the owner's D1** (workspace letter H33): the workflow runs on a push
of `main`, not on a tag; CI makes the tag (`tag`, new) and the page comes BEFORE the publish.
The table is the current shape; [release.md](release.md) § "How a release is made" is the flow.

- **job:** `checks`
  - token: none
  - what it runs: the VERSION only (since 2026-11-18, letter H37 — the checks run locally in `bun
    run release`: the review set, then `bun run gate --release`): `workflow.ts release-state` (no
    tag = new, the tag here = re-run, elsewhere = stop); for a new number `registry.ts free` (JSR
    AND npm — npm never reuses a number, C34 (2))
- **job:** `tag`
  - token: contents: write
  - what it runs: only once `checks` is green and `npm-build` green or skipped (its RESULT, never
    the variable): `github.ts tag` — the annotated tag on this commit (REST), read back; at this
    commit = done, elsewhere = refused
- **job:** `release`
  - token: contents: write
  - what it runs: `github.ts release` (H32), from the tag, before the publish
- **job:** `jsr`
  - token: id-token
  - what it runs: sparse checkout of the published files + `registry.ts`, nothing installed;
    `jsr-has` (a re-run skips the upload); `oidc-check`; **`uploaded=true` written BEFORE** `deno
    publish`; provenance read-back
- **job:** `npm-build`
  - token: none
  - what it runs: BEFORE the tag, while `NPM_PUBLISH` is `true`: `bun install`, `npm:prove`, `npm pack` → the tarball as an artifact
- **job:** `npm`
  - token: id-token
  - what it runs: sparse checkout of `registry.ts` + `jsr.json`; npm 11.21.2, exact
    (`--ignore-scripts`); the artifact; `jsr-wait`; `npm-tarball` (ours, this version, no `scripts`,
    provenance on); `npm-state` (served → skip); `npm publish <tgz> --ignore-scripts`; provenance
    read-back

- **`uploaded`, not `deno publish`'s exit** (C34 (1)): `deno publish` uploads, THEN signs. 1.13.2
  failed after its upload (release.md § "1.13.2"), and everything gated on the step was skipped.
  Now `npm` runs on `uploaded` and first waits for JSR to answer 200 (until D1 `release` did too).
- **Re-runs are safe in every job**: `tag` keeps a tag already at this commit, `release` an
  existing page, `jsr` skips an upload JSR already has, `npm` one npm already serves;
  `upload-artifact` overwrites. Queued per commit, never cancelled (`concurrency`, C30 (2)).
- **Every action pinned to a commit hash** (the comment names its release, read with
  `git ls-remote` on 2026-11-09: checkout v6.1.0, setup-bun v2.2.0, setup-deno v2.0.5 — its `v2`
  is a branch at that commit — setup-node v4.4.0, upload-artifact v7.0.2, download-artifact
  v8.0.2).
- **Measured before landing:** `deno publish --dry-run` on the sparse tree publishes the same 136
  files as the full tree, slow-types check included (Deno 2.9.6); `registry.ts` against the real
  registries — JSR has 2.2.2 / not 9.9.9, npm 2.2.2 published / 9.9.9 free, provenance on both
  (Rekor `3541668152`), a real tarball of 2.2.2 accepted and refused as 2.2.3.
- **Held by tests** (`publish_preflight_wiring.test.ts`, `workflow_steps.test.ts`): a
  credentialed job's `run:` lines, its one sparse credential-less checkout, the `jsr` sparse list
  equal to `jsr.json`'s include, `uploaded` before the upload, `jsr-wait` first, the npm check
  before JSR, every action hash-pinned; the registry logic on a mock network. Nine mutants, each
  caught by its own test.
- **A push that is not a release stops in `checks`** after `release-state` (until D1 a non-tag
  dispatch ran `checks` only; before that it ran `deno publish` from any ref).
- **First run, 3.0.0 (run 42699750914):** `checks`, `jsr` (provenance), `release` (the page, by
  `github-actions[bot]`, no tag made) ✅ — measured on GitHub. `npm-build` ❌: `npm pack
  --pack-destination` needs the folder to exist (fixed for 3.0.1, a test holds it).
- **Second run, 3.0.1 (42704308757):** `npm-build` and the artifact hand-off ✅; `npm` ❌ — the
  tarball path `npm-pack/x.tgz` is a GitHub shorthand to npm (fixed for 3.0.2: an absolute path,
  a test holds it).
- ✅ **Third run, 3.0.2 (42712133150): every job green** — npm's OIDC trusted publishing and SLSA
  provenance from the proven tarball MEASURED. The workflow is proven end to end.

⚠️ The inherited version of this comment cited **wasmtk** as precedent for calling `deno publish`
directly. wasmtk has **no provenance on any published version**, so it was never evidence for
anything. Corrected rather than repeated.

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


## Moved sections

§ "npm as a SECOND registry", § "Measured history, 2026-08-26", § "`--allow-slow-types` was
removed", § "The auto-tag dispatch path does not publish", § "The verification step was tested
against both sides", § "The history purge", § "The second purge": moved to
[publishing-to-4.1.1.md](archive/publishing-to-4.1.1.md)
§ "Never run `deno publish` locally", § "The flow", § "Version rule — sub-version capped at 9", §
"`publish:dry` is in the local gate but NOT in the test suite", § "Preconditions", § "Recovery
recipes", § "Repo hygiene and the memory routing rule", § "The move to `synapticforge`": moved to
[publishing-release-flow.md](publishing-release-flow.md)
