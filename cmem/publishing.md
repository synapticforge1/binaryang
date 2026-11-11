# Publishing — JSR provenance and the release process

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
   `tag` (CI's tag) → `release` (the page) → `jsr` (credential); `checks` → `npm-build` → `npm`
   (credential). ✅ **Measured by 3.0.3** (run 43061998593, all six green) — read every job of a
   release run, and on a failure use "Re-run failed jobs" (the jobs skip what is done), never a
   new tag.
6. Read both registries back (Rekor id on JSR, the attestation on npm), run the package as a user
   from each, record it in [release.md](release.md) § "Release History", newest first.

**The compatibility gate** (workspace letter H6, built 2026-10-23; `../../cmem/layout-and-packaging.md`
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

## 🆕 npm as a SECOND registry — a PARKED contingency (owner, 2026-10-13; open-work 29)

✅✅ **DONE 2026-10-22 (UTC): 1.13.3 was published to npm BY THE WORKFLOW** — the trusted
publisher (`_npmUser`: GitHub Actions), SLSA provenance, read back by `workflow.ts provenance npm`
(§ "1.13.3"). Each release now goes to both registries from one tag. Open-work 29 is CLOSED.

✅ **ON npm since 2026-10-21 (UTC): `@synapticforge1/binaryang@1.13.1`**, the first version
published BY HAND by the owner (`npm publish --provenance=false` from `dist/` built and proved at
`v1.13.1`; published by `synapticforgeun`; no provenance on this one version, as planned). The
public metadata answered 404 for about a minute after the org's package list already showed it
(scratch `npm-wait.ts`). Checked as a user from npmjs.org: `npm install` then `npx binaryang
--version` → `binaryang 1.13.1`; `npx @synapticforge1/binaryang --version` with no install;
Node 22 imports `./wat2wasm` and runs what it builds; Bun imports `./wasm-validate`. Then, owner:
"steps 1 and 2 are complete" — the trusted publisher configured on the package, and the
REPOSITORY variable `NPM_PUBLISH=true` set (neither is readable from the public APIs; the next
release's `npm` job is their proof, and its provenance read-back the evidence). **npm's 2-day
window:** a new trusted-publisher configuration must complete a publish within 2 days, so the
next release should come by 2026-10-22, or the configuration be re-checked first.

▶ **REOPENED 2026-10-20 and BUILT, nothing published** (owner: set up on npm; "Build and prove,
no publish"). The name is **`@synapticforge1/binaryang`**: npm user `synapticforgeun`, npm org
`synapticforge1` (owner, 2026-10-20). 🔧 It was first built as `@synapticforge/binaryang`, the
GitHub org's spelling; an npm scope is the npm org's (or user's) name, so that one was not the
owner's to publish under. Renamed before any publish. As built, against the plan below:

| plan | built |
| ---- | ----- |
| compiled JS + `.d.ts` | `tsconfig.npm.json` (extends the type check; `rewriteRelativeImportExtensions`), tsc 7.0.2 emit into `dist/`, 0 `.ts` imports left |
| a generated manifest | `scripts/npm/build.ts` `npmManifest()`: name, `jsr.json`'s version, the 19 exports as `{ types, default }`, `bin: { binaryang: ./main.js }` (shebang added at build), `license: "MIT OR Apache-2.0"`, `engines.node >=22.18`, repository / homepage / bugs on `synapticforge1/binaryang`, `publishConfig: { access: public, provenance: true }`; `npm_manifest.test.ts` |
| licence + notice files | README, LICENSE, LICENSE-MIT, LICENSE-APACHE, NOTICE.md copied in |
| `src/definitions/*.json` | COPIED, as JSR ships them (no code imports them; consumers may) |
| proof before any publish | `scripts/npm/prove.ts`, in CI's Gates job: pack (833 KiB, 245 files, no `.ts` source), install the tarball into a scratch consumer, every export imports and runs nothing on Node 22 / 24 / 26 and Bun, `cli-smoke.ts` on the INSTALLED `main.js` gives the source's hash on each, `npm exec binaryang --version`, the `.d.ts` type-check for a consumer with `types: []`, every export of the installed package bundles for the browser, the export list equals JSR's own npm build (`npm.jsr.io`, read from its tarball: the registry metadata omits `exports`). 7 build mutants, all caught (a wrong `types` path survived the first run: TypeScript falls back to the `.d.ts` beside the `.js`, so the proof now checks every path the manifest names) |
| the release path | `publish.yml` job `npm`: after JSR's, same tag, `npm:prove` then `npm publish` from `dist/` (OIDC, no token), then the provenance attestation read back from the registry; **OFF until the repository variable `NPM_PUBLISH` is `true`** |

**Measured on the way:** npm 11's `pack --json` prints an OBJECT keyed by package name (npm 10:
an array); `npm` on Windows is a `.cmd` shim that `fnm exec` cannot spawn ("program not found"), so
the proof runs `node <npm-cli.js>` beside the chosen Node.

**Left to the owner, in order:** (1) on npmjs.com, a trusted publisher for
`@synapticforge1/binaryang` (in the `synapticforge1` org): GitHub Actions, repository
`synapticforge1/binaryang`, workflow `publish.yml` —
check npm's current docs on whether the package must exist first (then one manual first publish
with a token, from a `bun run npm:build` of a released tag); (2) the repository variable
`NPM_PUBLISH=true`; (3) the next release then publishes to both, and its provenance is checked.
Nothing claims the name until (1)–(3).

⏸ **Parked the same day:** the owner created a `synapticforge` organization on npm and GitHub, then
decided "I am leaving it on jsr until it becomes necessary to do otherwise." The repo stays
`jrmarcum/binaryang`, the JSR scope `@jrmarcum`. **Trigger to reopen:** JSR announces an end or
degrades, or a consumer needs npm. Then the name is chosen (`@synapticforge/binaryang` was free on
2026-10-13; the GitHub org existed, created 2026-10-13, 0 repos; npmjs.com blocks scripted checks,
so the npm org was not verified from here). The plan below is kept so that day starts from it.

Owner: "I think it would be good to add this repo to npm also just in case the jsr gets shut down
for some reason. We probably need to do this for all of our repos just make sure we have adequate
coverage." **JSR stays the source**; npm would be added beside it, not instead. Nothing is built
or published.

**Why, beyond JSR's survival** (JSR is run by the Deno team, now Cloudflare; the announcement says
it keeps running): a plain `npm install` with no `.npmrc`; a `bin` so `npx` runs the CLI (JSR has
no `bin`); npm takes `"license": "MIT OR Apache-2.0"`, which JSR cannot ([licensing.md](licensing.md)).

**Facts, 2026-10-13 (re-derive before acting):** the published code has NO runtime dependencies
(the only `jsr:` strings in `src/` are 8 doc-comment examples). `binaryang` and
`@jrmarcum/binaryang` are both FREE on registry.npmjs.org (404). JSR already serves npm clients
1.10.0 as `@jsr/jrmarcum__binaryang` from `npm.jsr.io`, which needs `@jsr:registry=…` in the user's
`.npmrc`: a stopgap that dies with JSR, so it is not the coverage asked for.

**What an npm package needs that JSR does for us:**

| need | why | plan |
| ---- | --- | ---- |
| compiled JS + `.d.ts` | Node will NOT strip types inside `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`); JSR compiles for its npm layer, npm does not | `tsc` emit to `dist/` with `rewriteRelativeImportExtensions` (99 `src` files import `./x.ts`) |
| a manifest | `package.json` is `private`, and `version_sync` REFUSES `name` / `version` / `exports` / `bin` there (B2), so `jsr.json` stays the one manifest | GENERATE `dist/package.json` from `jsr.json` at build time: name, version, the 22 exports mapped to `dist/`, `types`, `bin`, `license: "MIT OR Apache-2.0"`, `engines` (Node ≥ 22.18), `files` |
| the CLI | `bin` needs a JS entry with `#!/usr/bin/env node` | the built `main.js`; check how `main.ts` detects being the entry (`import.meta.main` notes in `src/tools/wasm-opt.ts`) |
| licence + notice files | Apache §4 obligations travel with every copy | `LICENSE`, `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE.md`, `README.md` in `files` |
| `src/definitions/*.json` | in JSR's `publish.include`, yet no `src` file imports them | decide: copy, or drop from both |

**Proof before any publish** (the gate's style: shown, not assumed): pack the tarball, install it
into a scratch project OUTSIDE the repo, import all 22 exports and run the CLI through `npx` on
Node 22 / 24 / 26 and Bun — the same CLI hash as the source runs; `tsc` against the shipped `.d.ts`;
the browser check over `dist/`; and diff the export list and types against JSR's own npm build of
the same version (`npm.jsr.io`), which is an independent reference.

**Release path:** one tag publishes to BOTH (the npm job after JSR's; versions are immutable on
both, so a failed second job is re-run alone, never re-tagged). npm's trusted publishing (GitHub
OIDC, provenance) replaces any token, and like JSR's provenance it must be CHECKED on the first
publish, not assumed (§ "The one thing to understand"). This lands with or after B6, which rebuilds
CI and the release path anyway.

**The owner's calls:** the npm name (`@synapticforge/binaryang` under the org; scoped
`@jrmarcum/binaryang` matches JSR exactly; unscoped `binaryang` is shorter for `npx`; all free on
2026-10-13); the npm account and its 2FA /
trusted-publisher setup; WHEN the first npm publish happens. A first publish claims a name
permanently, so it is never done without the owner's word.

**Dependencies must be on npmjs.org too.** The published code has none, but the TESTS use
`@std/assert` / `@std/expect`, which exist only on JSR (B5 keeps them deliberately, through JSR's
npm layer). If JSR went away, the package would survive and the test suite would not install.
Decide with B5: keep (accepting that), vendor them, or move to `node:assert` / an npm library.

**Order across the repos:** a package whose npm build depends on another of ours needs that one on
npm FIRST. wasmtk pins `@jrmarcum/binaryang` (`compat/*`, `wasm-validate`), so binaryang goes first.
The recipe for the other packages is [jsr-deno-exit-guide.md](jsr-deno-exit-guide.md) § 5b.

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

| job | token | what it runs |
| --- | --- | --- |
| `checks` | none | `workflow.ts release-state` (no tag = new, the tag here = re-run, elsewhere = stop); for a new number `registry.ts free` (JSR AND npm — npm never reuses a number, C34 (2)); `api-surface.ts --release-check`; `check`, both test legs; `deno publish --dry-run` on a sparse checkout of `jsr.json`'s include list (the `jsr` job's tree) |
| `tag` | contents: write | `github.ts tag` — the annotated tag on this commit (REST), read back; at this commit = done, elsewhere = refused |
| `release` | contents: write | `github.ts release` (H32), from the tag, before the publish |
| `jsr` | id-token | sparse checkout of the published files + `registry.ts`, nothing installed; `jsr-has` (a re-run skips the upload); `oidc-check`; **`uploaded=true` written BEFORE** `deno publish`; provenance read-back |
| `npm-build` | none | `bun install`, `npm:prove`, `npm pack` → the tarball as an artifact |
| `npm` | id-token | sparse checkout of `registry.ts` + `jsr.json`; npm 11 (`--ignore-scripts`); the artifact; `jsr-wait`; `npm-tarball` (ours, this version, no `scripts`, provenance on); `npm-state` (served → skip); `npm publish <tgz> --ignore-scripts`; provenance read-back |

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
2026-08-25 and 2026-08-26.

🔧 **CORRECTED 2026-10-23 (drift B7) — the next claim was WRONG, and was never sent.** It read:
_"Whatever broke wasmtk is not a global JSR or GitHub change … That window is refuted by these
dates"_ — but the dates were 2026-08-25/26, AFTER the window, so they could not refute it. Measured
2026-10-23, every version of the five `@jrmarcum` packages, 2026-06-01 → 09-01, from JSR's version
API (one-time scratch script, `rekorLogId` per version):

| span (UTC)              | published in the scope                                         | provenance          |
| ----------------------- | -------------------------------------------------------------- | ------------------- |
| 06-02 → 06-07           | wabt-ts 1.3.1–1.3.2, binaryen-ts 1.3.3, wasmtk 1.6.2–1.6.4     | all attested        |
| **06-10 00:02 → 06-11** | **binaryen-ts 1.3.5, wabt-ts 1.3.3, wasmtk 1.6.5**             | **none — all three** |
| 06-15 → **07-03 03:52** | wasmtk 1.7.0–1.11.2, loader 1.0.7–1.0.8, wabt-ts 1.3.4–1.3.5   | all attested        |
| **07-08 00:36 → 07-30** | **binaryen-ts 1.3.6–1.4.3 (7), wasmtk 1.11.3–2.0.0 (10)**      | **none — 17 of 17** |
| 07-31 → 08-24           | nothing published                                              | —                   |
| 08-25 → 08-31           | wabt-ts, binaryen-ts, binaryang 1.5.1–1.5.3, wasmtk 2.0.1–2.0.2 | all attested        |

So the scope-wide record SUPPORTS wasmtk's window: **both outages hit every package that published
in them, and nothing in either repo explains the start or the end** — the start falls between
07-03 03:52 and 07-08 00:36, the end somewhere between 07-30 22:26 and 08-25 00:06 (nothing
published in between). Binaryen-ts's "month-long tail" below was not a second cause either: it is
the same outage, seen through a package that kept publishing into it. What is NOT shown: which
side (JSR, GitHub OIDC, Sigstore) — only that it was outside the repos. 🔑 A task's premise is not
evidence: workspace letter H5 asked us to SEND this note ("your measurements refute"); measuring
before sending reversed it ([handoffs.md](handoffs.md) § 41, the corrected letter).

🆕 **Both siblings lost provenance on the same day — 2026-06-10.** wabt-ts at 1.3.3 and binaryen-ts
at 1.3.5 (and wasmtk 1.6.5 the next day — table above). wabt-ts recovered on its next release;
binaryen-ts stayed dark for a month. A shared single-day failure across independent repos reads as
transient infrastructure, not configuration. (🔧 2026-10-23: binaryen-ts's "month" was two
outages, not one tail — it published nothing between 06-10 and 07-08, and its July versions fell
inside the second outage, as wasmtk's did.)

## `--allow-slow-types` was removed

binaryen-ts passed `--allow-slow-types` because `interop/binaryen-js.ts`'s `BinaryenInterop.create`
does a runtime-configurable `await import(path)`, which JSR cannot statically resolve.

**Measured 2026-08-26: the merged tree passes the slow-types check without it.** Keeping it is not
neutral — JSR's own warning says a slow-types package ships **no `.d.ts` for Node users**, and Node
support is one of binaryang's published capabilities.

It also closed a gate mismatch: CI's dry-run ran `deno publish --dry-run --allow-dirty` while the
real publish ran `deno publish --allow-slow-types`, so the gate was verifying a different
configuration from the one that ships. They now run the same command.

*(The 1.5.1 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

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

## The auto-tag dispatch path does not publish — its cause, and the recovery

🗄️ **History since 2026-11-10: `auto-tag.yml` is RETIRED** (D1, workspace letter H33). CI now
tags inside the run that `main`'s push started — that run's actor is the pusher, not the bot —
and publishes in the same run ([release.md](release.md) § "How a release is made"). What follows
is why the dispatched runs failed; it is the reason the new shape keeps everything in ONE run.

Summarized 2026-10-23 (drift B3) from three sections written as they were found — "3 of 3", "The
fix: `RELEASE_PAT`" and "ROOT CAUSE" (2026-08-26 / 27); full text: `git show
8147adc90:cmem/publishing.md`, lines 431–573.

**The cause:** JSR authorises the OIDC token's ACTOR. `auto-tag` pushes its tag with
`GITHUB_TOKEN`, which GitHub's recursion guard stops from firing `publish.yml`, so it DISPATCHES
`publish.yml` instead — and a dispatched run's actor is `github-actions[bot]`, not a member of the
`@jrmarcum` scope:

```
error: Failed to publish @jrmarcum/binaryang@1.5.3
Caused by:
    The actor that this request was authenticated for is not authorized as a
    scope member for this scope. (actorNotScopeMember)
```

One field of the runs API explained every observation: every dispatched run (`workflow_dispatch`,
actor the bot) failed — binaryen-ts, wabt-ts, binaryang 1.5.2 and 1.5.3, then 1.9.0 and 1.10.0, when
a bumped `main` was pushed without its tag — and every tag pushed by a person (`push`, actor
`jrmarcum`) succeeded. Provenance was never the variable: the publish was rejected at
authorisation.

**The decision:** the release path never dispatches. `bun run release` pushes `main` and the tag
together, as a user, so `auto-tag` finds the tag already there and does nothing. Every release has
been published by a tag a user pushed — unaided since 1.5.4 (§ "The tag-push path works unaided"),
and for 1.9.0 and 1.10.0 by re-pushing the tag after the dispatch failed. **`RELEASE_PAT` is NOT set — closed as not needed (owner, 2026-09-29)**;
`auto-tag.yml` still reads it, so setting one later would route its tag push through `push: tags`.
If ever set, it must belong to a JSR scope member, or the tag would push and the publish fail the
same way. A reusable workflow (`workflow_call`) was rejected because it changes the OIDC claim
shape JSR attests, testable only by burning a version.

**Recovery, when a bumped `main` reaches GitHub without its tag** (auto-tag then tags it and the
dispatch fails): nothing was published, so nothing is burnt. Re-push the same tag from a
workstation, where the pusher is a real user:

```sh
git push origin :refs/tags/vX.Y.Z
git tag -a vX.Y.Z -m "vX.Y.Z" HEAD
git push origin vX.Y.Z          # actor = a scope member -> push:tags -> publishes
```

Executed for 1.5.3: same commit, same YAML, only the actor different — `event=push`,
`conclusion=success`, provenance recorded (`rekorLogId=2620472173`).

Kept as lessons:

- **A correlation can become a resting place.** "Dispatch fails, tag push works" was treated as an
  unexplained pattern across four failures before one field named the mechanism
  ([best-practices.md](best-practices.md) § "When two paths to the same action disagree").
- **`secrets` is not dependably readable in a step-level `if:`.** `auto-tag.yml` turns the PAT's
  presence into a step output (`yes` / `no`, never the value) and gates on that;
  `if: secrets.RELEASE_PAT != ''` looks right and can evaluate the wrong way.

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

## `publish:dry` is in CI but NOT in `deno task test`

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

**Pin actions to the major-version tag** (`actions/checkout@v6`, `denoland/setup-deno@v2`,
`actions/setup-node@v4`, `oven-sh/setup-bun@v2`): mutable, auto-flows patches, guards the major
boundary. Moving checkout from v4 to v6 was forced by GitHub's Node 20 runtime deprecation.

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

## 🔒 The history purge (workspace letter H19, 2026-10-22) — EVERY public hash changed

Owner: "start" (H19: purge personal information from git history), then "only public facing items
are what we are cleaning" and "items in the public facing history should be cleaned in the
history". What was public: GitHub's three branches (`main`, `release/1.5.3`, `release/1.6.1`),
local `main` (ten commits not yet pushed) and the 21 tags — 12,948 commits. Purged from them:
the owner's personal address as author / committer (1,783 / 1,782 commits) and tagger (3 of the
5 annotated tags), now the GitHub noreply address; and 54 versions of five files holding an
absolute path on the owner's machine (`cmem/open-work.md` 33, `CLAUDE.md` 12 — tracked once,
gitignored now — `cmem/testing.md` 4, `scripts/spec-prepare.ts` 3, `cmem/working-rules.md` 2),
the path prefix now `<workspace>`. No commit or tag message held one; no file held the address.

**How:** not `filter-branch` (which recreates every commit it walks and drops signatures): a
scratch Bun script (`h19/rewrite.ts`, plumbing only) rewrote a commit ONLY when its tree, a parent
or its own author / committer address changed. **The 11,187 upstream wabt / binaryen commits by
other authors are byte-identical, hashes kept**; 1,761 commits, 1,021 trees and the 5 annotated
tags were rewritten; one signature dropped (the one signed commit of the owner's). The tagged trees
differ from the originals only in `scripts/spec-prepare.ts` (owner, asked: "Clean them too" —
letter H19's rule 4 keeps tagged trees identical for Go's checksum database, which binaryang does
not have, and `scripts/` was never in a published package). The 372 local-only branches were left
as they were — ✅ **deleted 2026-10-26** (owner: "delete the never-pushed local branches if they
are now irrelevant"; § "Local branches deleted" below).

**Verified before the push:** a re-scan of the public refs finds the address on 0 commits / 0 tags
and 0 path-bearing files; every rewritten commit has the original's message bytes, author and
committer NAMES and DATES and parent structure, its tree differing only in the five files;
`git fsck --connectivity-only` clean; `main`'s tree identical. The 772 commit hashes cited in 36
tracked files were rewritten through the map (only tokens naming exactly one rewritten commit;
444 distinct, all resolving in the new history), except `tests/wabt-ts/wasmtk/PROVENANCE.md`,
which cites other repos' commits. Then `user.email` was set locally to the noreply address.
Machine-local: the pre-purge bundle, its ref list and the full old → new map are in
`cmem/local/backups/`.

**Published releases name the OLD hashes forever** (JSR / npm provenance, Rekor): the map, tag by
tag (commit hashes):

| tag | before | after |
| --- | --- | --- |
| `v1.5.1` | `a19166ebd` | `b10a5044c` |
| `v1.5.2` | `740fbb119` | `b9205faab` |
| `v1.5.3` | `384f37ecc` | `1d11741d1` |
| `v1.5.4` | `395f536fc` | `6f49db43e` |
| `v1.6.0` | `64d22e06f` | `5a85daeda` |
| `v1.6.1` | `dade0c785` | `b880e0708` |
| `v1.7.0` | `f644c9a2b` | `098a4c472` |
| `v1.7.1` | `ced5ca508` | `fd61a9b53` |
| `v1.7.2` | `30929db92` | `7f410842e` |
| `v1.8.0` | `0b2edf7cd` | `fffd9f9cc` |
| `v1.8.1` | `531d82f1b` | `80a64bced` |
| `v1.9.0` | `82113369e` | `b536bc2be` |
| `v1.10.0` | `23b9f36fb` | `48586b485` |
| `v1.11.0` | `fc021fe08` | `fd5e96acf` |
| `v1.12.0` | `604b33cf8` | `a86765385` |
| `v1.12.1` | `e03d38f33` | `926d3e4e3` |
| `v1.13.0` | `2b74934bf` | `9d065cf17` |
| `v1.13.1` | `840b7d79a` | `09e0c7d9d` |
| `v1.13.2` | `37cf58485` | `b86b1b66a` |
| `v1.13.3` | `a021ef19d` | `5d812889a` |
| `v1.14.0` | `e2d44d66c` | `99c60dee0` |

Branches: `release/1.5.3` `d0ef9f8f1` → `896477cc0`, `release/1.6.1` = `v1.6.1`; GitHub's `main`
before the push `9cc85f0e7` → `eff6af062`. **Not in our control:** GitHub serves old commits by
hash until its own garbage collection (a full purge is a GitHub Support request — the owner's);
any OLD clone (wasmtk's `upstream/binaryang`, scratch clones) carries the old history and must be
re-cloned, never pushed from. The frozen wabt-ts and binaryen-ts repos keep their own old hashes.

**Pushed 2026-10-23** (owner: "continue with H19"). Checked first, by a one-time script: each of
the 24 refs on GitHub held the map's OLD value (`main` GitHub's `9cc85f0e7`) and each local ref the
NEW one (`main` a descendant of `eff6af062`); the address on 0 commits / 0 tags of the public refs,
the commits since the purge clean. One `git push` with a `--force-with-lease=<ref>:<old>` per ref:
24 forced updates, `main` `9cc85f0e7` → `7553eb632`; read back, every ref on GitHub equals the
local one. 🔑 **No publish ran for the 21 re-pointed tags:** `publish.yml` fires on a `v*` tag push,
but GitHub creates no tag events when more than three tags are pushed at once (Actions showed only
CI and auto-tag on `main`). A push of three tags or fewer WOULD have started a publish per tag;
each would have failed on JSR's existing version, but push such tags with that in mind.

**Local branches deleted (2026-10-26).** 398 of the 399 local branches besides `main` were deleted.
None had been pushed, and some still held the pre-purge history (H25 §3(a)). A one-time script
classified them first:
- 388 were in `main`, directly or through the H19 map.
- 10 pre-purge branches had no change missing from pre-purge `main` (`git cherry`: 0 unique).
- **Kept:** `wip/r15-tree-pass`, with 1 unmerged commit. It is cited by name in
  [ir-convergence.md](ir-convergence.md) and `src/passes/lower-block-params.ts` for the traps its
  message records. Its ancestry was pre-purge and reached the 6 path-bearing commits, so it was
  **re-parented** onto the map's new parent `1729de2a5`. The result, `91dfb6cc2` (was `ade9019d6`,
  in the bundle), keeps the message bytes, names, dates and the same patch (3 files). Its tree took
  the parent's `scripts/spec-prepare.ts`, which the commit never touched; a first attempt that kept
  the old tree carried the path back in through that file. Its fate was
  [open-work.md](open-work.md) item 43: **deleted 2026-11-05** (owner), after its message was
  folded into [ir-convergence.md](ir-convergence.md) § R15 and both citations pointed there. No
  local branch holds an unmerged commit any more (`git branch --no-merged main` is empty; the
  others are merged work branches); the patch is only in the machine-local backup bundles.

After the deletion, a scan of every local branch, every tag and `origin` finds **0** commits with a
drive path. The frozen predecessors' remote-tracking refs (`wabt-ts/*`, `binaryen-ts/*`) reach 2,
in their own history, which this repo does not rewrite.

Before deleting, the pre-purge bundle was unpacked into a scratch repo. Every deleted tip, and every
old id still cited in tracked files (the "before" column above, and `b8fafaa3f` in the ★ 6.1 copy),
was found in it: 424 checked, 0 missing. The control, today's `main` tip, was correctly absent.
**Old ids now resolve only through that bundle** (`cmem/local/backups/`, with a name → hash list
of the deleted branches). The same run found two old ids the purge had missed in `working-rules.md`
(step 16's), rewritten through the map.

*(The 3.0.2 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 3.0.1 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 3.0.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 2.2.2 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

## 🔒 The second purge (open-work 46, 2026-10-28) — every hash from 2026-10-13 on changed AGAIN

Owner: "fix item 46". The first purge cleaned TEXT only (its scans were `git grep -I` / `git log
-G`, which skip binaries); five committed benchmark modules carried the owner's user profile, the
toolchain layout and the project tree in DWARF and in Rust's panic strings, public from
`f9b74f213` (2026-10-13; now `22ecb4ab2`) until item 44 replaced them on 2026-10-26.

**Scanned first, binaries included:** every blob reachable from GitHub's refs and local `main`,
104,719, read byte for byte — machine paths in exactly **5 binary blobs**, one historical version of
each module; the 63 text hits are the old folder's NAME in prose (`wasmExamples/binaryen-ts/…`,
H27's class, fixed at HEAD), no drive path.

**How:** the first purge's plumbing-only script, adapted (scratch `h46/rewrite.ts`): in each of
the five blobs, each machine-specific path PREFIX (the Rust sysroot, the cargo home, the Zig lib,
the Zig cache, the project tree) replaced by a label of the SAME LENGTH padded with `_`
(`<rust-sysroot>____…`) — nothing after a prefix touched, so every length, offset and section stays
put; a commit rewritten only when its tree or a parent changed; no address change (the commits carry
the noreply address since H19; the maintainer address is allowed since 2026-10-26). **383 of 13,138
commits rewritten**, 12,755 unchanged (everything before 2026-10-13 keeps its hash), 215 trees, no
signature dropped, no annotated tag.

**Verified before the push** (scratch `h46/verify.ts`): every rewritten commit has the original's
message bytes and author / committer lines, its tree differing ONLY at the five module paths (346
of 383; the rest differ only in a parent); `main`'s tree identical; each cleaned module the same
length and section layout, its CODE section unchanged (the bytes changed lie in the DWARF custom
sections, and in the two Rust modules' data-section panic strings), and `run(300)` =
`1892226719` on original and cleaned alike, all five, on V8; a rescan of the rewritten refs finds 0
binary blobs with a machine path; `fsck` clean. 151 commit hashes cited in 12 tracked files
rewritten through the map (`cite-map.ts`, as H19's, also judging a prefix against the map's old
side). Machine-local: the pre-rewrite bundle (`cmem/local/backups/`, all 31 refs, proven to
restore identically) and the full old → new map.

**Published releases name the OLD hashes forever** (JSR / npm provenance, Rekor). Tag by tag
(commit hashes; the "before" column is the first purge's "after"):

| tag | before | after |
| --- | --- | --- |
| `v1.12.1` | `a8c264620` | `926d3e4e3` |
| `v1.13.0` | `65b16f99e` | `9d065cf17` |
| `v1.13.1` | `710592f53` | `09e0c7d9d` |
| `v1.13.2` | `ee59fad76` | `b86b1b66a` |
| `v1.13.3` | `225f76a8a` | `5d812889a` |
| `v1.14.0` | `7ebcee3ad` | `99c60dee0` |
| `v1.15.0` | `ae9e87162` | `bc97aa573` |
| `v1.16.0` | `02a866672` | `d81463f32` |
| `v1.16.1` | `cef4a669f` | `158552e95` |
| `v1.17.0` | `f8473c620` | `e19525bb0` |
| `v2.0.0` | `4cf6624af` | `0ee193d95` |
| `v2.1.0` | `b7fdb9de5` | `e3af69711` |
| `v2.2.0` | `6e1923397` | `7e1e272e8` |
| `v2.2.1` | `78392bab4` | `a420a88c0` |

Unchanged: `v1.5.1` … `v1.12.0`, `release/1.5.3`, `release/1.6.1` (all before 2026-10-13).
**Not in our control, as after the first purge:** GitHub serves the old commits by hash until its
own garbage collection (a GitHub Support request — the owner's; one request can name both purges);
every OLD clone carries the old history — wasmtk's `upstream/binaryang` must be re-cloned again,
and never pushed from.

*(The 2.2.1 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 2.2.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 2.1.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 2.0.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.17.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.16.1 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.16.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.15.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.14.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.13.3 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.13.2 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.13.1 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.13.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.12.1 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.12.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.11.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.10.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.9.0 release record moved to [release.md](release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*
