# Publishing — the release process half

How a release is cut and what to do when it goes wrong: the flow, the version rule, preconditions,
recovery recipes, repo hygiene, the move to the `synapticforge1` organization. Split from
[publishing.md](publishing.md) on 2026-11-20 (H38 step 5). Last verified 2026-11-20.

---

# The release process (§2.2, merged 2026-08-31)

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

*(The 1.6.1 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

## The flow

```sh
git add -A && git commit -F <file>  # commit ALL source changes FIRST -- see the guard below
bun run bump [patch|minor|major]    # SemVer, patch by default: rewrites jsr.json AND main.ts
                                    # (`--dry-run` / `-n` prints the next version, writes nothing)
bun run release                     # guard, cold publish dry run + the type check (`bun check`), commit the bump, tag, push commit + tag atomically
```

**The bump and the release share ONE file list**: `RELEASE_FILES` (`jsr.json`, `main.ts`; `deno.json` until 2026-10-12) in
`scripts/release/release-guard.ts`. `publish.ts` stages exactly those, and the dirty-tree guard
exempts exactly those. 🔧 **Until 2026-09-14 this flow refused at its own guard.** Both halves named
`deno.json` alone, while the bump also rewrites `main.ts`, so the guard returned `[" M main.ts"]`
and exited 1. It failed safe. 1.5.4 went out only because its bump was committed by hand first
(`6f49db43e`), which made the script skip its own commit. `release_guard.test.ts` now checks the
list against `bump_version.ts`'s write sites, and `publish_preflight_wiring.test.ts` checks that the
`git add` stages the list. Verified by a real `deno task bump` with the actual `git status` fed to
the guard (no blockers), then restored.

The tag push fires `publish.yml`, which verifies the tag matches `jsr.json`, runs `bun run check`,
`bun run test` and `bun run test:bun` (since B6), then calls `deno publish` **directly** — never through `deno task`, because that indirection
spawns a subprocess and loses OIDC — then checks provenance. The GitHub Release page is the
`release` job's, after it (since 2026-11-09, `scripts/release/github.ts release`, REST API, no
`gh`; an existing page is done). Since the same day the checks, the JSR publish, the page and
npm are five jobs, and the credential sits only in two that install nothing (§ "The publish
workflow's jobs").

⚠️ **A DISPATCHED release needs a manual step**, because `RELEASE_PAT` is not set (and will not
be — closed as not needed, 2026-09-29: this flow never dispatches). See § "The auto-tag dispatch path does not publish" above. 🔧 This first said "a release currently needs a manual step"; 1.5.4
narrowed it — see "The tag-push path works unaided" at the end of this file.

## Version rule — sub-version capped at 9

🔧 **RETIRED 2026-10-22: the rule is Semantic Versioning 2.0.0** (owner, 2026-09-20, workspace
letter H6): components unbounded, nothing carries; `bun run bump [patch|minor|major]`
(`scripts/release/version.ts`, `tests/wabt-ts/scripts/version_bump.test.ts`, 7 mutants killed).
The cap was already dead in practice — minors 10 to 14 were typed past it by hand — and it had
become a trap: a patch bump of 1.14.9 would have produced 2.0.0. The bump now also asserts each
version line matches exactly once, makes both new texts before writing either, and writes each
through a temporary file and a rename (workspace tooling rule 4). The text below is the old rule,
kept as written.

`1.0.9 → 1.1.0`, `1.9.9 → 2.0.0`, major uncapped (`9.9.9 → 10.0.0`). Both projects adopted this
independently; enforced by `deno task bump`, which rewrites **both** `deno.json` and `main.ts`
(`version_sync.test.ts` fails the publish if they disagree) and preserves formatting by replacing
only the version line rather than round-tripping the JSON.

### ⚠️ `bump` has no minor mode — a non-patch release is typed by hand

🔧 **Retired 2026-10-22:** `bun run bump minor` / `major` (above). What follows — that a removed
export is a break whether or not anything imported it, and that a break's reach is VERIFIED —
still holds; choosing the level is still the owner's.

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

## `publish:dry` is in the local gate but NOT in the test suite

(Since 2026-11-18 the gate is local, `bun run gate`: CI only publishes, letter H37.)

It runs the **slow-types** check, which `deno task check` does not. Moving one constant into another
file made it public API without an explicit type — a `missing-explicit-type` error that **339
passing tests and three full metric runs never saw**.

**Run it whenever a change ADDS or MOVES an exported symbol**, not only when publishing. It also
backs the Node compatibility claim: Node cannot run the sources directly, so the supported path is
the transpiled JSR package, and slow types are what make that transpilation possible. (🔧 Since
open-work 28 part 4, 2026-10-12, Node DOES run the sources directly: they are erasable TypeScript.
The transpiled package is still what consumers get, and slow types still decide its `.d.ts`.)

## Preconditions

The GitHub repo must be linked under "GitHub Actions" in the JSR package settings, or OIDC
provenance is rejected. Verify through the API rather than the settings UI, which has been
unreachable before:

```sh
curl -s https://api.jsr.io/scopes/jrmarcum/packages/binaryang | jq .githubRepository
```

`provenance: true` is **not** a `deno.json` field — it was removed when JSR went OIDC-only. Delete
it if you see `unknown field provenance`.

**Pin actions — `publish.yml` by COMMIT HASH, `ci.yml` by major-version tag.** The release
workflow pins every action to a commit hash (open-work 54, 2026-11-09; a test refuses anything
else), because a moved tag there runs new code beside the publishing credential; `ci.yml`, which
holds no credential, keeps major-version tags (`actions/checkout@v6`, `actions/setup-node@v4`,
`oven-sh/setup-bun@v2`), which auto-flow patches and guard the major boundary. Moving checkout
from v4 to v6 was forced by GitHub's Node 20 runtime deprecation. 🔁 2026-11-13 (review round 1):
this said "pin to the major-version tag" for all, which a maintainer would have applied to
`publish.yml`.

## Recovery recipes

### A dirty tree ships a release containing none of the work

`publish.ts` stages the bump (`RELEASE_FILES`) and nothing else, so on a dirty tree it commits a
bare version bump, tags that, and publishes a release with none of the code. **binaryen-ts v1.2.3
shipped as effectively v1.2.2 with a different version string** — two sessions of fixes sat
uncommitted, and the wasmtk team reported "the bugs you fixed are still there", because they were.

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
carried a submodule-remnant recovery recipe (`git rm --cached` leaves behind a `.git` file and the
`.git/modules/<name>/` storage, worth hundreds of MB). It no longer applies here; the full texts
(`git show 62c65a9db:cmem/<wing>/publishing.md`) keep it for the history.

*(The 1.5.4 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.8.1 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.8.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.7.2 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.7.1 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.7.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.6.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

## The move to `synapticforge` (2026-10-20, after 1.13.0)

The owner moved the repository to the `synapticforge` organization (binaryen-ts and wabt-ts went
first, archived). Checked through the APIs:

- **GitHub transfer, not a new repo:** `api.github.com/repos/jrmarcum/binaryang` redirects to
  `synapticforge/binaryang`, **the same repo id `1347384560`**, not archived, default branch
  `main`, the tags with it (`v1.13.0` …). The old URL redirects for web and `git`, until a repo of
  that name is created under `jrmarcum` again.
- **JSR does NOT follow a transfer.** Before the owner re-linked it, `@jrmarcum/binaryang` read
  `githubRepository: jrmarcum/binaryang` (as binaryen-ts and wabt-ts still do: harmless for them,
  archived). Re-linked by the owner in the package settings on jsr.io; the API then read
  `synapticforge/binaryang`, id `1347384560`, updated 2026-10-20T22:37:13Z. **Check this field
  before any release** after a move: a stale link shows only as publish.yml's provenance failure,
  on a version that can never be republished.
- **The JSR package name is unchanged**, `@jrmarcum/binaryang`: the scope is JSR's, not GitHub's.
  wasmtk's exact pin and every import are untouched.
- **In the repo:** `origin` set to `https://github.com/synapticforge/binaryang.git`; the README's
  CI badge and links, and the Actions URL `scripts/release/publish.ts` prints, name the org.
  `cmem/` keeps the old URL where a dated record says it.
- **Not proven yet** (✅ both proven since: CI / auto-tag on `27e6f2cda`, the publish with
  provenance by 1.13.1): a publish from the org with provenance (the next release), and the org's
  Actions settings — workflow permissions must allow auto-tag's `contents: write` / `actions:
  write` and publish's `id-token: write`, and OIDC must not be restricted (the next push's CI and
  auto-tag show the first part).
- **Other repos** name the old URL in a `git clone` hint or a README (wasmtk
  `scripts/upstream-link.ts`, `cmem/workflow.md`; binaryen-ts / wabt-ts READMEs): the redirect
  covers them; a handoff note if they should change.
- **The first push from the org** (`27e6f2cda`): CI and auto-tag GREEN — the org's workflow
  permissions allow CI's and auto-tag's needs. The publish side (OIDC, provenance) is still the
  next release's to show.

**Renamed the same day: `synapticforge` → `synapticforge1`** (owner: "now my npm organization and
my github organization are named exactly the same 'synapticforge1'"), so the GitHub org matches
the npm org the package publishes under (`@synapticforge1/binaryang`, § "npm as a SECOND
registry"). Checked: `repos/synapticforge/binaryang` redirects to `synapticforge1/binaryang`, the
same repo id `1347384560`; `orgs/synapticforge` is Not Found — the old name is FREE, so its
redirects last only until someone claims it. **JSR did not follow the rename either:** it read
`synapticforge/binaryang` (the 22:37 link) afterwards; re-linked by the owner, then read
`synapticforge1/binaryang`, id `1347384560`, updated 2026-10-20T23:36:03Z (checked through the
API before 1.13.1 was tagged). In the repo:
`origin`, the README, `publish.ts`'s printed URL and the npm manifest's repository / homepage / bugs
name `synapticforge1`.

**Trusted publishing after the move (workspace letter H20, recorded 2026-10-26).** Both paths are
OIDC from `publish.yml`, no token on either. **JSR** links the package to the GitHub repository by
id — `1347384560` followed the transfer and the rename once the owner re-linked it (above), and the
link is what a release must check first. **npm**'s trusted publisher was created on the package
under the `synapticforge1` org AFTER the move (§ "1.13.1", § "1.13.3"), so it was never locked to
the old owner; every release since 1.13.3 (nine, through 2.2.0) published on both registries with
provenance. Not measured: whether npm's policy pins owner / repository IDs the way nuget.org's does
(H20's failure, loader-dotnet). It was created after the move, so the question returns only at a
NEXT transfer or rename — then re-check the JSR link and the npm publisher before the first release.

