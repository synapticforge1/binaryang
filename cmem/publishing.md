# Publishing — JSR provenance and the release process

Merged topic file, **both halves**: the provenance half at A16, the release process at §2.2
(2026-08-31, once `scripts/release/` made it one flow — the second half starts at "The release
process" below). The wing files it merged are summarized in [binaryen-ts.md](binaryen-ts.md) and
[wabt-ts.md](wabt-ts.md), each with its `git show` command.

**Latest (2026-10-26 UTC): 2.2.1 on BOTH registries, both with provenance** — JSR
`@jrmarcum/binaryang@2.2.1` (Rekor `3490805794`) and npm `@synapticforge1/binaryang@2.2.1`
(published by GitHub Actions, SLSA provenance) — § "2.2.1". **The repo is
`synapticforge1/binaryang` since 2026-10-20** (§ "The move to `synapticforge`"; the JSR package name
is unchanged), and **its history was rewritten on 2026-10-22, pushed 2026-10-23** — every commit
hash changed (§ "The history purge").

**The release pattern — SETTLED; read this before any section below** (re-stated 2026-10-23, drift
B3):

1. `CHANGELOG.md` § X.Y.Z on a `release/X.Y.Z` branch, gated on the committed tree, merged
   `--no-ff`; `main` pushed UNBUMPED; CI and auto-tag green.
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
5. `bun run release` — its guards, then `bump to vX.Y.Z`, `main` + tag in ONE push as a user;
   `publish.yml` repeats the floor check on the tag (`api-surface.ts --release-check`) and
   publishes to JSR, then npm.
6. Read both registries back (Rekor id on JSR, the attestation on npm), run the package as a user
   from each, record it here as § X.Y.Z, newest first.

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
  in its own commit.
- **Rule 4, deprecate before removing**, and the README's `### ⚠️ Breaking Changes` table — written
  when the deprecation lands, with the migration.

A patch while `main` holds unreleased work goes from a branch cut from the last tag (§ "1.6.1").
The pattern never dispatches, so `RELEASE_PAT` is closed as not needed (owner, 2026-09-29) — § "The
auto-tag dispatch path does not publish".

The sections below this one are in the order they were found (the provenance half, then the
release-process half from § "The release process"), followed by every release, newest first. A
later section can narrow an earlier one; where they differ, the pattern above is current.

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

### The score was 88 at 1.5.1, and provenance was not why

_Historical: binaryang has scored 100 since the three settings below were set; 1.5.4 read 100 on
2026-09-02._

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
on 2026-08-31. What is worth keeping is how the gap was located, because the obvious route is a dead
end.

⚠️ **`deno doc --lint` is NOT a doc-coverage check, and its number does not track JSR's.** The two
have different denominators: the lint counts nested interface members, JSR counts declarations.
binaryang saw **701** lint errors against 98.1%; wasmtk saw the lint **clean on all 16 entrypoints**
against 98.04%. The same discrepancy from opposite sides, confirmed independently in both repos.

**Chasing the lint number to fix the JSR one means several hundred filler comments on struct fields,
and does not move the score.**

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

_Relocated from machine-local memory 2026-08-31, where it was the only copy — the same move wabt-ts
made with its formatter notes, and for the same reason: this is PROJECT knowledge and would not
survive a clone. Machine-level facts (`safe.directory`, the repack failure) stayed outside at the
time; since 2026-09-14 the owner's rule is that they live under `cmem/` too — in the PRIVATE,
gitignored `cmem/local/environment.md`, since they name local paths and accounts._

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

## The auto-tag dispatch path does not publish — its cause, and the recovery

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

## 1.6.1 — a patch from a branch (2026-09-28) — 🚀 PUBLISHED

✅ **Released 2026-09-28** — owner: "Tag from the branch". On `release/1.6.1` (cut from `v1.6.0`):
`deno task bump` → 1.6.1, committed (`b880e0708`); the preflight guards run by hand
(`scratchpad/preflight161.ts`: clean tree, tag absent on origin, cold `deno task check`,
`checkEntry` — all ok); `git tag v1.6.1`; `git push origin release/1.6.1 v1.6.1` — the TAG and the
branch only, `main` NOT pushed. "Publish to JSR" run 36497043241: success; JSR `1.6.1_meta.json`
serves `.` → `./main.ts`. Verified from JSR: `deno run -A --min-dep-age 0
jsr:@jrmarcum/binaryang@1.6.1 --version` prints `binaryang 1.6.1`, `--help` the usage, and a
command runs (exit 1 on a missing file). Without `--min-dep-age 0` Deno refuses for 24 hours —
the wall recorded below. `release/1.6.1` (bumped) is merged into `main` (`078c71c1f`): `main`
reads **1.6.1**, so auto-tag no-ops when `main` is pushed. The next release was to be 1.6.2; the
owner made it **1.7.0** (a minor — `./interop` removed), released 2026-09-29.

The record as written before the release:

Owner: the JSR CLI fix ships as **1.6.1**, and a patch carries the fix ALONE — `main` holds 26+
unreleased commits (new passes, fixes) that belong to the next minor. So the fix was built on
`release/1.6.1`, cut from the `v1.6.0` tag, gated there (all steps exit 0), and merged into `main`
UNBUMPED.

⚠️ **`deno task release` cannot ship it as it stands**: its last step is `git push origin main
vX.Y.Z`, which pushes LOCAL `main` — the unreleased work — to origin. A tag publishes from any
branch (`publish.yml` keys on `push: tags`), so the branch path is: on `release/1.6.1`, `deno task
bump` (1.6.1 in `deno.json` AND `main.ts`), commit, run the preflight guards by hand (the cold
`deno task check` in a fresh `DENO_DIR`, and `checkEntry`), `git tag v1.6.1`, push the TAG (and the
branch). Then merge `release/1.6.1` into `main`: `main` reads 1.6.1, the tag exists, and auto-tag
no-ops on the next push of `main`. Needs the owner's go — it is the irreversible step.

**Release preflight 0d (new in this fix): `checkEntry`** — runs the `.` export as a user does:
`--help`, `--version` (must print the version being released), `wasm-validate` on a valid and on
a missing file (0 and 1: a no-op entry exits 0 both times), and an `import` that must run nothing.
Through 1.6.0 no check ran the entry a user runs, which is how the CLI stayed unreachable from JSR
for every published binaryang version.

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
spawns a subprocess and loses OIDC — and finally creates a GitHub Release.

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

## ✅ The tag-push path works unaided — 1.5.4, 2026-09-02

**1.5.4 was released with `deno task release` and published from the tag push, with NO manual
re-push.** Confirmed on JSR: `latest=1.5.4`, score 100, `rekorLogId=2692137018`, not yanked. It is
the first evidence that `deno task release` works end to end on its own; 1.5.3 had needed the
recovery recipe.

⚠️ **This narrows the earlier finding rather than overturning it.** The `actorNotScopeMember`
failure is on the `workflow_dispatch` path, which is what `RELEASE_PAT` exists for. A developer tag
push authenticates as the developer, so it was never the path at risk. The earlier note that "every
release will need the manual step" was too broad — every DISPATCHED release does.

**So `RELEASE_PAT` stayed an open owner action** (until 2026-09-29: closed as not needed — the
current-state line at the top), and the recovery recipe above still applies to
any release that falls through to dispatch. The record, by path: `push: tags` has succeeded **6 of
6** across three packages (binaryang 1.5.3 among them) before 1.5.4 added a seventh; the `auto-tag`
→ `workflow_dispatch` path has succeeded **0 of 4**.

## ✅ 1.8.1 — a patch by `deno task bump`, released 2026-09-29

**Published from the tag push, unaided.** JSR: `binaryang@1.8.1`, `rekorLogId=3007105518`, not
yanked, `latestVersion` 1.8.1; tag `v1.8.1` at `80a64bced`; CI, Auto-tag and Publish green. Owner,
2026-09-29: "I want to fix all three now and then release to 1.8.1" — wasmtk's § 20: L3 (a lowered
out-of-bounds access traps as out of bounds), L4 (the placeholder export), C7 (`getFunctionInfo`
shaped as binaryen.js). ⚠️ **A PATCH by the owner's decision although C7 changes a return shape,
which the rule counts as BREAKING** — told before the choice; the CHANGELOG states the shape change
first. The pattern, unchanged: fixes merged UNBUMPED (`a547a9533`) after a green gate, `main`
pushed and CI green, JSR checked (1.8.1 absent), `deno task bump` (a patch), `deno task release`.

Verified from JSR itself, through wasmtk's call shapes (`compat/wabt` → `compat/binaryen`
`readBinary` → `runPasses(["LowerCustomPageSizes"])` → `emitBinary`): the lowered load traps "memory
access out of bounds"; the exporter carries `mem` (a Global) beside `mem#pagesize=1` and `mem#pages`;
a lowered importer asks `global mem` first; `getFunctionInfo` gives `results === none` for a void
function and `=== i32` for an i32 one.

## ✅ 1.8.0 — a hand-typed MINOR, released 2026-09-29

**Published from the tag push, unaided.** JSR: `binaryang@1.8.0`, `rekorLogId=3006244345`, not
yanked, `latestVersion` 1.8.0; tag `v1.8.0` at `fffd9f9cc`; CI, Auto-tag and Publish green. Owner,
2026-09-29: "lets go ahead and bump and release". A MINOR by the rule in unreleased.md — changed
DEFAULTS: the `wat2wasm` CLI validates, `stopOnFirstError` defaults to true, diagnostic text moves,
lowered memories export as `#pagesize=` — typed by hand, as 1.6.0 and 1.7.0 were. It carries the day's
work: DG1–DG6, Q10–Q13, `LowerCustomPageSizes` (L1, L2, P1), `proposals/` in the gate —
`CHANGELOG.md` § 1.8.0. The pattern, unchanged:

1. every change merged after a green gate on its committed tree; release notes merged UNBUMPED
   (`575edc0fb`); `main` pushed (18 commits) — CI green on all four runtime legs, Node 22.18
   included (the first CI run of `scripts/cli-smoke.ts`, which this machine cannot run on 22.18),
   Auto-tag a no-op;
2. JSR checked first (cache-busted): 1.8.0 absent, latest 1.7.2; 1.8.0 typed in `deno.json` and
   `main.ts`, `version_sync.test.ts` green;
3. `deno task release` — cold type check and entry check passed; bump committed, tagged, branch and
   tag pushed together.

Verified from JSR itself (a scratch directory, `--minimum-dependency-age=0`): `--version` prints
`binaryang 1.8.0`; the published `wat2wasm` refuses `invalid.wat` with upstream's exact line
(`invalid.wat:5:6: error: type mismatch in i32.add, …`, `^^^^^^^` under the word) and exit 1, and
`--no-check` writes it. CI and Publish were followed through the public GitHub API by a Deno script;
⚠️ its `head_sha` needs the FULL hash — a short one matches no run and waits forever.

## ✅ 1.7.2 — a patch by `deno task bump`, released 2026-09-29

**Published from the tag push, unaided.** JSR: `binaryang@1.7.2`, `rekorLogId=3002349065`, not
yanked, `latestVersion` 1.7.2; tag `v1.7.2` at `7f410842e`; CI, Auto-tag and Publish green. Owner,
2026-09-29: "merge the fixes once they are tested and passing, then update the project memory
files, bump and push"; "1.7.2 is correct" — a patch, as 1.5.4's default-text change was: nothing
removed or renamed, one optional writer option added, and `wasm2wat`'s TEXT changes for nearly every
module (the CHANGELOG says so first). It carries `array.new_default`'s defaultability, M2a, N10
and W18 — `CHANGELOG.md` § 1.7.2. The pattern, unchanged:

1. five fix branches merged, each after a green gate on its committed tree; release notes and
   memory merged UNBUMPED (`706dac230`); `main` pushed — CI green, Auto-tag a no-op;
2. `deno task bump` → 1.7.2 in `deno.json` and `main.ts`;
3. `deno task release` — cold type check and entry check passed; bump committed, tagged, branch and
   tag pushed together.

Verified from JSR itself (a scratch directory, `--min-dep-age 0`): `--version` prints
`binaryang 1.7.2`, and `wasm2wat` from the published package prints named references (`call $f`,
`global.get $g`). 🔧 New this release: CI and Publish were followed, and the gate run, by Deno
scripts rather than shell loops (owner rule: scripting is TypeScript) — in the session scratchpad;
porting the repo's own `.sh` gate steps is open-work.md's item 20.

## ✅ 1.7.1 — a patch by `deno task bump`, released 2026-09-29

**Published from the tag push, unaided.** JSR: `binaryang@1.7.1`, `rekorLogId=3001574645`, not
yanked, `latestVersion` 1.7.1; tag `v1.7.1` at `fd61a9b53`; CI, Auto-tag and Publish green. Owner,
2026-09-29: "lets release 1.7.1". It carries the u64-limits fix (wasmtk's letter of 2026-09-29,
item 1; merge `a7c48aa6d`). The pattern, unchanged:

1. fix merged (`a7c48aa6d`), full gate green on the committed tree; release notes merged UNBUMPED
   (`59215d55f`); `main` pushed — CI green, Auto-tag a no-op (`v1.7.0` existed);
2. `deno task bump` → 1.7.1 in `deno.json` and `main.ts` (a patch, so the task, not a hand edit);
3. `deno task release` — cold type check and entry check passed; it committed the bump, tagged,
   and pushed branch and tag together.

Verified from JSR itself (a scratch directory, `--min-dep-age 0` past the 24-hour wall):
`jsr:@jrmarcum/binaryang@1.7.1 --version` prints `binaryang 1.7.1`, and wasmtk's path
(`compat/wabt` `parseWat` → `toBinary` → `wasmValidate`) rejects their modules as invalid.

## ✅ 1.7.0 — a hand-typed MINOR, released 2026-09-29 (UTC)

**Published from the tag push, unaided.** JSR: `binaryang@1.7.0`, `rekorLogId=2991848417`, 667
symbols, not yanked, `latestVersion` 1.7.0; tag `v1.7.0` at `098a4c472`; Publish green; GitHub
Release created. Owner, 2026-09-28: "lets release 1.7.0 if there is no further open items" — the
list held 2 stale markers (closed) and 21 backlog items, none a blocker; the owner chose to release.
The flow, as for 1.6.0:

1. release notes merged UNBUMPED (`741b69ae4`), gate green on the committed tree (every step
   exit 0), `main` pushed — CI green, Auto-tag a no-op (`v1.6.1` existed);
2. 1.7.0 typed BY HAND in `deno.json` and `main.ts` (`version_sync` checked first);
3. `deno task release` — cold type check and entry check passed; it committed the bump, tagged,
   and pushed branch and tag together.

⚠️ This machine has no `gh`: CI and Publish were followed through the public GitHub API
(`/repos/jrmarcum/binaryang/actions/runs?head_sha=…`) and JSR's (`/versions/1.7.0`).

## ✅ 1.6.0 — a hand-typed MINOR, released 2026-09-28

**Published from the tag push, unaided — the eighth `push: tags` success.** JSR:
`binaryang@1.6.0`, `rekorLogId=2987187551`, 647 symbols, not yanked; tag `v1.6.0` at
`5a85daeda`; CI, Auto-tag and Publish green. What it took, in the documented order:

1. merge unbumped (`3bf01f174`), gate green on the committed tree, push `main` — CI green, the
   `v1.5.4` tag already existing so auto-tag did nothing;
2. version typed BY HAND in `deno.json` and `main.ts` (owner: 1.6.0 — `deno task bump` makes
   patches only; the release unpublished `./binary` and `./encoder`, BREAKING);
3. `deno task release` — its new cold type check (fresh `DENO_DIR`, `1b2f2361e`) ran first and
   passed; it committed the bump, tagged, and pushed branch and tag together.

⚠️ **A version is immutable.** Once a release is out, "publish it" can only mean a NEW version.
Asked the same day to "bump and publish 1.6.0" again, the answer was that it already was — check
`https://api.jsr.io/scopes/jrmarcum/packages/binaryang/versions/<v>` (cache-busted, above) before
arming anything.

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
  the old tree carried the path back in through that file. Its fate is
  [open-work.md](open-work.md) item 43.

After the deletion, a scan of every local branch, every tag and `origin` finds **0** commits with a
drive path. The frozen predecessors' remote-tracking refs (`wabt-ts/*`, `binaryen-ts/*`) reach 2,
in their own history, which this repo does not rewrite.

Before deleting, the pre-purge bundle was unpacked into a scratch repo. Every deleted tip, and every
old id still cited in tracked files (the "before" column above, and `b8fafaa3f` in the ★ 6.1 copy),
was found in it: 424 checked, 0 missing. The control, today's `main` tip, was correctly absent.
**Old ids now resolve only through that bundle** (`cmem/local/backups/`, with a name → hash list
of the deleted branches). The same run found two old ids the purge had missed in `working-rules.md`
(step 16's), rewritten through the map.

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

## 2.2.1 — a PATCH from `main` (2026-10-26 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

The owner's go: "we should bump and release the fix for wasm-strip". One fix: `wasm-strip`
copies the sections it keeps instead of re-encoding the module (open-work 45, `1a4b06f43`;
CHANGELOG § 2.2.1).

1. `CHANGELOG.md` § 2.2.1 on `release/2.2.1` (`23dc941b9`), gated 17 / 17, merged (`3c0328047`),
   pushed unbumped: CI and auto-tag GREEN. A FRESH CLONE of `3c0328047` from GitHub: 17 / 17
   (counted from its 17 step logs). The fix's own branch had run the full gate, 29 / 29.
2. **The consumer step (rule 3) SKIPPED, by its own rule:** since `v2.2.0` the shipped code
   changed in one file, `src/tools/wasm-strip.ts`, and no consumer imports it (wasmtk, LeptonPad,
   the runtimes and the loaders grep clean).
3. No tag, neither registry had 2.2.1. `bun run bump patch`: floor PATCH; **v2.2.0's tests on
   this tree: 6,336, 0 failed, 0 accepted**; it reported one STALE entry in
   `tests/accepted-changes.json` (2.2.0's, which only the 2.1.0 tests needed) — harmless, to
   drop at the next re-baseline. `surface:check` matches; `version_sync` 3 / 3; `bun run
   release`: `bump to v2.2.1` (`a420a88c0`), `main` + `v2.2.1` in one push.
4. auto-tag and publish.yml GREEN on the bump: **JSR** 2.2.1 created 2026-10-26T16:36:48Z, not
   yanked, **Rekor log id `3490805794`**; **npm** at 16:38:35Z, `latest`, SLSA provenance; GitHub
   Release `v2.2.1`. As a user: npm `--version` prints `binaryang 2.2.1`; its `wasm-strip -s name`
   on the bundle fixture `strbin_rust.wasm` gives upstream wabt's `-R name` bytes exactly (SHA-256
   `24c2d397…`) and `wasm-bundle` takes the result, where 2.2.0's output is refused ("relocations
   are stale"); JSR's `wasm-strip` (strip all) gives upstream's bytes exactly (`424aad5f…`) — the
   fix, as published. JSR needed `--minimum-dependency-age=0` to fetch a version minutes old
   (§ "Consumers hit a 24-hour wall").
5. ⚠️ **CI on the bump commit `a420a88c0` was CANCELLED, not failed:** every job green (Gates —
   tests on Node 24 and Bun, baseline, surface, publish dry run, npm proof — and all seven CLI
   jobs) except **Browsers**, which hit its 20-minute `timeout-minutes` inside "Install the
   browsers" (Playwright's download hung, 16:33:52 → 16:53:46Z) before any test ran. The same
   tree minus the version line passed Browsers on `3c0328047`. A re-run needs a GitHub login
   (no `gh`, no token here); CI on the next push is the check. ✅ **It reported GREEN, every
   job, Browsers included:** CI and auto-tag on `50d10b1a9` (the record's own push, the same
   code), 2026-10-26 — so the cancellation was the download timeout, nothing in the release.

## 2.2.0 — a MINOR from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

The owner's go: "update the project memory files, bump and push". It carries open-work 42: the
reference-type rule as wasm-tools has it (owner: "wasm-tools' rule"), four validator gaps the
runtimes found (an out-of-range type in `ref.test` / `ref.cast` / `br_on_cast`, `stringref`,
mutable-global import / export with the feature off, the overlong `call_indirect` table index),
and D2 2.2.0's `typeRules` / `encodingRules` (CHANGELOG § 2.2.0); the opcode guide on 2.2.0.

1. `CHANGELOG.md` § 2.2.0 on `release/2.2.0` (`cc8cd3996`), gated 17 / 17, merged (`569370ea3`),
   pushed unbumped: CI and auto-tag GREEN. A FRESH CLONE of `569370ea3`: 17 / 17 (17 step logs).
2. No tag, neither registry had 2.2.0. `bun run bump minor` stopped as designed: floor MINOR (D2's
   new types), **v2.1.0's tests: 6,268, 1 failed** — "gates a concrete (ref $T) on
   functionReferences", the old type rule. Listed in `tests/accepted-changes.json` (`71afda46d`,
   merged `56cc9bb8b`), replacing 2.1.0's four entries, which the check reported STALE: only the
   release just before is run. Re-run: 6,268, 1 failed, 1 accepted; `surface:check` matches;
   `version_sync` 3 / 3; `bun run release`: `bump to v2.2.0` (`7e1e272e8`), `main` + `v2.2.0`.
3. CI, auto-tag and publish.yml GREEN on the bump: **JSR** 2.2.0 created 2026-10-24T08:27:20Z, not
   yanked, **Rekor log id `3438521434`**; **npm** at 08:29:35Z, `latest`, SLSA provenance; GitHub
   Release `v2.2.0`. As a user: JSR `--version` prints `binaryang 2.2.0`; npm's `wasm-validate
   --disable-mutable-globals` on a module exporting a mutable global — 2.1.0: OK; 2.2.0: "mutable
   globals cannot be exported", INVALID — the fix, as published.

## 2.1.0 — a MINOR from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

The owner's go: "release 2.1.0". It carries the default-features fix (every module with a
function table was INVALID to `wasm-validate` / `wat2wasm` with no flags, since 1.5.3 at least;
open-work 41), `return_call_ref` under function references and D2's `requires` / `presets` (40),
two validator feature checks (41), tail calls portable under `--target portable` and D4
re-measured (34), and the opcode guide (CHANGELOG § 2.1.0).

1. `CHANGELOG.md` § 2.1.0 on `release/2.1.0` (`dd99e9390`), gated 17 / 17, merged (`65a3794a0`),
   pushed unbumped: CI and auto-tag GREEN. A FRESH CLONE of `65a3794a0`: 17 / 17 (counted from its
   17 step logs, not from "0 failed").
2. No tag, neither registry had 2.1.0. `bun run bump minor` STOPPED, as designed: the floor
   MINOR (D2's six additions), but **v2.0.0's tests on this tree: 6,231, 4 failed** — all in
   `target.test.ts`, all the intended tail-call change (three expected a tail call refused, one
   the old measurement date). Listed in `tests/accepted-changes.json` with version and reason, in
   their own commit (`ec6dc1bba`, merged `989a957fd`) — the list's first entries. Re-run: 6,231,
   4 failed, 4 accepted; `surface:check` matches; `version_sync` 3 / 3; `bun run release`:
   `bump to v2.1.0` (`e3af69711`), `main` + `v2.1.0` in one push.
3. CI, auto-tag and publish.yml GREEN on the bump: **JSR** 2.1.0 created 2026-10-24T06:50:01Z,
   not yanked, **Rekor log id `3436968278`**; **npm** at 06:51:39Z, `latest`, SLSA provenance;
   GitHub Release `v2.1.0`. As a user: JSR `--version` prints `binaryang 2.1.0`; npm's
   `wasm-validate` with no flags passes `benches/browser-opt/modules/rust-release.wasm`, which
   2.0.0 called INVALID — the fix, as published.

🔧 The accepted-changes merge was first made with an inline `-m` (no attribution line); undone
locally before any push and remade with `-F`.

## 2.0.0 — the first MAJOR, from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

The owner's go: "2.0.0 is accepted", then "bump and push". One breaking change — the
`sat-float-to-int` spelling (deprecated in 1.17.0) removed with `cliAliases`, D2 data version 2.0.0
(open-work 39) — and the interpreter running shared memory and atomics (38). CHANGELOG § 2.0.0;
README § Breaking Changes, the 2.0.0 row.

1. `CHANGELOG.md` § 2.0.0 on `release/2.0.0`, gated 17 / 17, merged (`6869f92c7`), pushed
   unbumped: CI and auto-tag GREEN. A FRESH CLONE of `6869f92c7`: 17 / 17.
2. No tag, neither registry had 2.0.0; `bun run bump major`: the floor MAJOR, exactly the three
   intended entries (`FeatureDefinition.cliAliases`, `--disable-sat-float-to-int` on `wat2wasm`
   and `wasm-validate`). The previous release's tests are NOT run for a major — by design (rule 3:
   a major may break them). `surface:check` matches on the bumped tree; `version_sync` 3 / 3;
   `bun run release`: `bump to v2.0.0` (`0ee193d95`).
3. CI, auto-tag and publish.yml GREEN on the bump: **JSR** 2.0.0 created 2026-10-24T04:28:47Z, not
   yanked, **Rekor log id `3436248876`**; **npm** at 04:31:00Z, `latest`, SLSA provenance and npm's
   publish attestation; GitHub Release `v2.0.0`. As a user: JSR `--version` prints
   `binaryang 2.0.0`; npm's `wat2wasm --disable-sat-float-to-int` exits 1 ("unknown option") — the
   break, as published — and its `wasm-interp` runs a shared-memory module (`notify() => i32:0`).

## 1.17.0 — a MINOR from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

The owner's go: "bump the version, update the project memory files, then push". It carries
every command's `--help` / `--version` (open-work 36), `--memcpy-to-bulk-memory` (37), the
`saturating-float-to-int` spelling with `sat-float-to-int` deprecated and D2 at 1.1.0 (33), multi-value
off enforced (35), and the relaxed-SIMD cost in the README (CHANGELOG § 1.17.0).

1. `CHANGELOG.md` § 1.17.0 on `release/1.17.0`, gated 17 / 17, merged (`30ab803b4`), pushed
   unbumped: CI and auto-tag GREEN (the Browsers job within its new time limit). A FRESH CLONE of
   `30ab803b4`: 17 / 17.
2. No tag, neither registry had 1.17.0; `bun run bump minor`: no major in the floor, **v1.16.1's
   tests on this tree: 6,152, 0 failed**; `surface:check` matches on the bumped tree;
   `version_sync` 3 / 3; `bun run release`: `bump to v1.17.0` (`e19525bb0`).
3. CI (surface check included), auto-tag and publish.yml GREEN on the bump: **JSR** 1.17.0 created
   2026-10-24T03:24:52Z, not yanked, **Rekor log id `3434909247`**; **npm** at 03:27:04Z,
   `latest`, SLSA provenance and npm's publish attestation; GitHub Release `v1.17.0`. As a user:
   `deno run … jsr:@jrmarcum/binaryang@1.17.0 wasm-opt --version` prints `binaryang 1.17.0`;
   `npx @synapticforge1/binaryang@1.17.0 wasm-validate --help` lists
   `--disable-saturating-float-to-int` and the deprecated `--disable-sat-float-to-int`.

## 1.16.1 — a PATCH from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

The owner's go: "just to check lets bump to 1.16.1 and push". **No package change** — nothing
shipped differs from `v1.16.0` (`src/`, `main.ts`, `jsr.json`, README, NOTICE, `package.json`;
`scripts/**` is excluded from the package). It proves the gate's fix (`102ddb64f`) where 1.16.0's
bump went red.

1. `CHANGELOG.md` § 1.16.1 on `release/1.16.1` (`f8878d1f6`), gated 17 / 17, merged (`e802e08f6`),
   pushed unbumped: CI and auto-tag GREEN (the Browsers job with its new cache step). A FRESH
   CLONE of `e802e08f6`: 17 / 17.
2. No tag, neither registry had 1.16.1; `bun run bump`: floor PATCH, **v1.16.0's 6,151 tests on
   this tree, 0 failed**; on the bumped tree `surface:check` MATCHES ("binaryang 1.16.1 — …" in the
   usage text); `version_sync` 3 / 3; `bun run release`: `bump to v1.16.1` (`158552e95`).
3. **CI GREEN on the bump commit** (`surface:check` included — 1.16.0's went red there), auto-tag
   and publish.yml GREEN: **JSR** 1.16.1 created 2026-10-24T01:26:01Z, not yanked, **Rekor log id
   `3432040093`**; **npm** at 01:27:36Z, `latest`, SLSA provenance and npm's publish attestation;
   GitHub Release `v1.16.1`. As a user, Deno from JSR and npx from npm both print
   `binaryang 1.16.1`.

## 1.16.0 — a MINOR from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

The owner's go: "bump. update the project memory files and push to main". It carries
`wasm-opt --target portable` and D4, `WideArithmeticLowering`, `RelaxedSimdLowering`, the README's
Breaking Changes table and Safari corrections, and Binaryen attribution (CHANGELOG § 1.16.0). The
FIRST release through the compatibility gate.

1. `CHANGELOG.md` § 1.16.0 on `release/1.16.0` (`d92ed0fed`), gated 17 / 17, merged
   (`c8f754014`), pushed unbumped. CI and auto-tag GREEN on it — after the Browsers job sat in
   "Install the browsers" ~35 min (a download stall; no `timeout-minutes` yet: fixed after, below).
2. A FRESH CLONE from GitHub of `c8f754014`: 17 / 17 exit 0.
3. No tag, neither registry had 1.16.0; `bun run bump minor` — the gate's first real run: floor
   MINOR (33 additions, the usage-text patches), and **v1.15.0's tests on this tree: 6,108, 0
   failed, 0 accepted**; `version_sync` 3 / 3; `bun run release`: `bump to v1.16.0`
   (`d81463f32`), `main` + `v1.16.0` in one push.
4. publish.yml and auto-tag GREEN on `d81463f32`: **JSR** 1.16.0 created 2026-10-24T00:44:06Z, not
   yanked, **Rekor log id `3431051155`**; **npm** `@synapticforge1/binaryang@1.16.0` at
   00:45:43Z, `latest`, attestations `https://slsa.dev/provenance/v1` and npm's publish
   attestation; GitHub Release `v1.16.0` (00:44:13Z). As a user: `deno run -A --min-dep-age 0
   jsr:@jrmarcum/binaryang@1.16.0 --version` and `npx -y @synapticforge1/binaryang@1.16.0
   --version` both print `binaryang 1.16.0`.
5. 🔧 **CI went RED on the bump commit — the gate's own defect, not the release's:** `surface:check`
   read the bump as "CLI binaryang: usage text changed" (the root usage names the version). The
   publish was not stopped (publish.yml runs only `--release-check`, which passed). Fixed in
   `102ddb64f` (`usageText`, version → `<version>`; mutant killed), re-baselined in `0f3ffe2de`
   (§ "The compatibility gate" above).
6. After the release, the Browsers CI job (owner: "I agree with your 3 suggestions"):
   `timeout-minutes: 20`, `actions/cache@v6` on Playwright's browsers keyed on `bun.lock`, apt
   retries with 30 s timeouts (`e6f784c5c`).

## 1.15.0 — a MINOR from `main` (2026-10-23 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

The owner's go: "continue with H19" (the plan's steps 1–4), then "yes" to the minor bump. It
carries `SSANoMerge` (open-work 31, step 16) and says the history was rewritten (CHANGELOG
§ 1.15.0); the first release on the rewritten history.

1. H19 step 1: the 24 public refs force-pushed (§ "The history purge", "Pushed"). `CHANGELOG.md`
   § 1.15.0 on `release/1.15.0` (`e06c5cefd`), gated 17 / 17, merged (`3e023a302`), pushed
   unbumped. CI GREEN on `7553eb632` (🔧 **1 h 1 m 39 s**: the Browsers job, which has no
   `timeout-minutes`, so a hang there would run GitHub's 6-hour default — ✅ since 2026-10-24 it
   has `timeout-minutes: 20`, a cache of Playwright's browsers, and apt retries with 30 s
   timeouts, owner: "I agree with your 3 suggestions") and on `3e023a302`
   (4 m 41 s). The nine error annotations on a green CI run are `test:bun`'s KNOWN JavaScriptCore
   differences: the same nine on the last green run before it — not a failure.
2. A FRESH CLONE from GitHub of `3e023a302`: 17 / 17 exit 0.
3. No tag, neither registry had 1.15.0; `bun run bump minor` (`jsr.json`, `main.ts`), `version_sync`
   3 / 3; `bun run release`: every guard passed, `bump to v1.15.0` (`bc97aa573`), `main` +
   `v1.15.0` in one push.
4. publish.yml, CI and auto-tag GREEN on `bc97aa573`: **JSR** 1.15.0 created
   2026-10-23T18:57:53Z, not yanked, **Rekor log id `3423023791`**; **npm**
   `@synapticforge1/binaryang@1.15.0` at 19:01:00Z, `latest`, published by **GitHub Actions** (the
   trusted publisher), attestation `https://slsa.dev/provenance/v1`; GitHub Release `v1.15.0`. As a
   user: `deno run -A --min-dep-age 0 jsr:@jrmarcum/binaryang@1.15.0 --version` and `npx -y
   @synapticforge1/binaryang@1.15.0 --version` both print `binaryang 1.15.0`.

🔧 **Waiting on CI without `gh`:** the unauthenticated Actions API (60 requests an hour) was
exhausted for most of an hour, so `ci-wait.ts` printed only 403s while CI ran. The Actions PAGES
(`/actions/workflows/ci.yml`, `/actions/runs/<id>`) are not rate-limited and show each run's
state, jobs and annotations — read them when the API is refused.

## 1.14.0 — a MINOR from `main` (2026-10-22 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

The owner's go: "lets update the project memory files, then bump and push"; the version chosen
as a minor ("1.14.0": a new pass, `Memory64Lowering`, and its two flags; nothing removed). It
carries open-work 32 (CHANGELOG § 1.14.0).

1. `CHANGELOG.md` § 1.14.0 and the open-work state on `release/1.14.0`, gated 17 / 17 (the full
   29 / 29 had run on the commit before), merged; `main` pushed unbumped at `b7db9be09`: CI and
   auto-tag GREEN. 🔧 Scratch `ci-wait.ts` was given a SHORT sha and listed nothing until asked:
   the API's `head_sha` filter matches only a full sha. It now refuses anything but 40 hex digits.
2. The CI half of the gate from a FRESH CLONE from GitHub of `b7db9be09`: 17 / 17 exit 0.
3. No tag, neither registry had 1.14.0; 1.14.0 typed BY HAND in `jsr.json` and `main.ts`,
   `version_sync` green. The release guard refused once: an untracked `--help/` of gate logs (a
   `gate.ts --help` run had taken `--help` as its scratch path), removed. `bun run release`:
   `bump to v1.14.0` (`99c60dee0`), `main` + `v1.14.0` in one push.
4. publish.yml GREEN with CI and auto-tag: **JSR** 1.14.0 created 2026-10-22T07:03:39Z, not
   yanked, **Rekor log id `3379566195`**; **npm** `@synapticforge1/binaryang@1.14.0` at 07:05:40Z,
   `latest`, published by **GitHub Actions** (the trusted publisher), attestation
   `https://slsa.dev/provenance/v1`; GitHub Release `v1.14.0`. As a user: `deno run -A
   --min-dep-age 0 jsr:@jrmarcum/binaryang@1.14.0 --version` and `npx -y
   @synapticforge1/binaryang@1.14.0 --version` (Node 24, `npx-cli.js` run by `node`: `fnm exec`
   cannot spawn the `.cmd` shim) both print `binaryang 1.14.0`; npx took about 5 minutes on its
   first, uncached run, so give it a long timeout.

## 1.13.3 — a PATCH from `main` (2026-10-22 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

The owner's go: "yes" to 1.13.3 (after "should we just rerun 1.13.2?" — no: the JSR job would fail
on the existing version, and npm's job waits for it). The same package as 1.13.2, released again
for provenance; carries no code change.

1. The workflows' bash logic moved to `scripts/release/workflow.ts` first (owner rule; merge
   after a 28 / 28 gate), then `CHANGELOG.md` § 1.13.3 on `release/1.13.3`, gated, merged; `main`
   pushed unbumped at `fd01060cf`: CI and auto-tag GREEN.
2. 🔧 **The fresh-clone check caught a flake first:** `test:bun` failed `hang_check.test.ts` "waits
   for its interval" — 99.75 ms for a 100 ms interval: the interpreter arms by `Date.now()` (whole
   ms), the test measured `performance.now()`. Since 1.11.0, hit once. The bound is now 99, with
   the reason in the test (`3d995e98f`, gated 28 / 28, merged at `ed65b841c`, CI GREEN; the clone
   check 17 / 17). publish.yml runs `test:bun` before `deno publish`: the flake could have stopped
   the release halfway.
3. No tag, neither registry had 1.13.3, JSR linked to `synapticforge1/binaryang`; `bun run bump`,
   `version_sync` green; `bun run release`: `bump to v1.13.3` (`5d812889a`), `main` + `v1.13.3`.
4. publish.yml GREEN, both jobs: **JSR** 1.13.3 created 2026-10-22T04:01:47Z, **Rekor log id
   `3375011478`**; **npm** `@synapticforge1/binaryang@1.13.3` at 04:04:40Z, `latest`, published by
   **GitHub Actions** (the trusted publisher), attestation `https://slsa.dev/provenance/v1` — the
   first npm publish by the workflow, and `workflow.ts`'s first run in CI (both read-backs passed).
   CI and auto-tag GREEN; GitHub Release `v1.13.3`. As a user: `deno run … jsr:@jrmarcum/
   binaryang@1.13.3 --version` and `npx @synapticforge1/binaryang@1.13.3 --version` (no install)
   both print `binaryang 1.13.3`.

## 1.13.2 — a PATCH from `main` (2026-10-21 UTC) — ⚠️ ON JSR WITHOUT PROVENANCE, NOT on npm

The owner's go: "are we ready to publish 1.3.2 which should fix the provenance?" (1.13.2), "and the
readme", then "Yes, release 1.13.2". Meant as the first npm publish by the workflow, with
provenance; it carries the README for both registries (no code change).

1. `CHANGELOG.md` § 1.13.2 on `release/1.13.2`, gated (28 / 28), merged; `main` pushed unbumped at
   `359910148`: CI and auto-tag GREEN; a fresh clone from `synapticforge1/binaryang`: 17 / 17.
2. No tag, 1.13.2 on neither registry, JSR linked to `synapticforge1/binaryang`; `bun run bump`,
   `version_sync` green; `bun run release` committed `bump to v1.13.2` (`b86b1b66a`) and pushed
   `main` + `v1.13.2`.
3. **publish.yml FAILED at "Publish to JSR (with provenance)"** — `deno publish` exited non-zero
   AFTER the upload: JSR has 1.13.2 (created 2026-10-21T01:11:33Z, `latest`, not yanked) with
   **`rekorLogId: null`**, still null 3 minutes later. Everything after the step was skipped: the
   GitHub Release, the provenance check, and the whole `npm` job (`needs: publish`), so **npm has
   no 1.13.2** and the trusted publisher is still untried. CI and auto-tag were green.
4. **Cause, from the step's log** (the owner pasted it: the public API gives a step's conclusion,
   not its output): every check passed (the 19 exports, the slow-types check), then
   `Publishing @jrmarcum/binaryang@1.13.2 ...`, then `error: Failed to publish … Caused by:
   expected value at line 1 column 1` — a JSON parser handed an empty or non-JSON body (an HTML
   error page, a blank 5xx). After the upload that leaves JSR's task poll and the provenance round
   trip (Fulcio's certificate, Rekor's entry, the attestation sent to JSR); the null `rekorLogId`
   says the attestation never completed. WHICH server answered so the log does not say: an
   inference, not a measurement. Before the log: Same workflow, org and JSR link as
   1.13.1 an hour earlier, which got provenance (Rekor `3346116525`) — so a signing-side failure
   (Sigstore / Rekor) is the leading guess, not a finding. The annotations at the top of the run
   page are NOT it: they are the Bun test leg's 36 known JavaScriptCore differences (e.g. the
   table64 `agreement.test.ts` case), which that step expects and passes on.
5. **Recovery:** a re-run cannot work (the JSR job would fail on the existing 1.13.2, and `npm`
   waits for it); the plan is **1.13.3** once the cause is known — both registries, both with
   provenance. JSR 1.13.2 stays as it is (immutable).

## 1.13.1 — a PATCH from `main` (2026-10-20; 2026-10-21T00:08Z UTC) — 🚀 PUBLISHED by `bun run release`, the FIRST from the org, provenance recorded

The owner's go: "lets update the project memory files, bump and publish"; a patch, JSR only (the
npm job off). It carries the README's links to the new org; no code change.

1. The JSR link re-made by the owner and checked through the API FIRST (`synapticforge1/binaryang`,
   23:36:03Z) — after the move and again after the rename, JSR kept the old name.
2. `CHANGELOG.md` § 1.13.1 and the rename fixes on a branch, gated (28 / 28, the npm step among
   them), merged; `main` pushed unbumped at `ba1213373`: CI and auto-tag GREEN.
3. A FRESH CLONE from `github.com/synapticforge1/binaryang` of that commit: the CI steps, 17 / 17.
4. JSR 1.13.1 404, no remote tag; `bun run bump` (`jsr.json` + `main.ts`), `version_sync` green;
   `bun run release` committed `bump to v1.13.1` (`09e0c7d9d`) and pushed `main` + `v1.13.1`.
5. publish.yml GREEN (the `npm` job skipped: `NPM_PUBLISH` unset), with CI and auto-tag; JSR 1.13.1
   created 2026-10-21T00:08:58Z, not yanked, **Rekor log id `3346116525`**, `latestVersion` 1.13.1;
   GitHub Release `v1.13.1`; `deno run … jsr:@jrmarcum/binaryang@1.13.1 --version` prints it.
   **This proves the org's publish side:** OIDC is not restricted there, and JSR accepts the
   provenance of `synapticforge1/binaryang`.

**npm, after this release** (the owner: "I am not seeing what you are saying in the account
settings"): npm's docs put the trusted publisher on the PACKAGE's settings page (Packages → the
package → Settings → Trusted publishing), and `npm trust`'s docs say "The package you're
configuring must already exist on the npm registry". So the first npm version is a manual publish
by the owner — `npm login` as `synapticforgeun`, then `npm publish --provenance=false` from a
`dist/` built and proved at `v1.13.1` (the manifest asks for provenance, which only CI can make) —
then the trusted publisher (`npm trust github @synapticforge1/binaryang --file publish.yml --repo
synapticforge1/binaryang --allow-publish`, npm ≥ 11.15, or the page), then `NPM_PUBLISH=true`.
npm: a new trusted-publisher configuration must complete its first publish within 2 days.

## 1.13.0 — a MINOR from `main` (2026-10-20; 21:37Z UTC) — 🚀 PUBLISHED by `bun run release`, provenance recorded

The owner's go: "lets go ahead and push a release after we update the project memory files"; the
version chosen as a minor ("1.13.0"): it adds `Module.optimizeStack` and three passes, removes
nothing. It carries the code lens C1–C17 and open-work 30 / 31 steps 1–15 (CHANGELOG § 1.13.0).

0. 🚨 **The release check found WRONG output first.** Re-running `benches/browser-opt/measure.ts`
   for the CHANGELOG's figures: rust-debug and zig-releasefast at -O3 / -Os / -Oz computed wrong
   results in all three browsers, from open-work 31 step 4 (Local2Stack). Nothing had been pushed.
   Fixed, gated and merged (`065f8dd54`), with a test that runs the six modules' workload; the
   benchmark re-run on the fix: every variant agrees in Chrome 155, Firefox 155, Safari 26.6
   ([optimizer.md](optimizer.md) § "Open-work 31"). **A release that re-measures is a release
   that re-checks**: the figures were the reason to run it, and the run was the only test of
   those modules' behaviour.
1. `CHANGELOG.md` § 1.13.0 on `release/1.13.0`, gated (27 / 27), merged; `main` pushed unbumped at
   `43e0461e1`: CI and auto-tag GREEN (scratch `ci-wait.ts`, the public Actions API; `gh` is not
   installed here).
2. The CI half of the gate from a FRESH CLONE of that commit (on an NTFS disk): 16 / 16 exit 0 — install,
   fmt, lint, `bun run test`, `bun run test:bun` (the 36 listed), check, naming, portability,
   browser, baseline, `publish:dry`, comparison, browsers, the three smokes.
3. JSR 1.13.0 404, no remote tag; 1.13.0 typed BY HAND in `jsr.json` and `main.ts`;
   `version_sync` green. `.claude/` (the editor's session settings, untracked) went into
   `.git/info/exclude` so the guard's clean-tree check passes: local only, nothing committed.
   `bun run release` (cold publish dry run, check, entry check) committed `bump to v1.13.0`
   (`9d065cf17`) and pushed `main` + `v1.13.0` together.
4. publish.yml GREEN, with CI and auto-tag; JSR 1.13.0 created 2026-10-20T21:37:03Z, not yanked,
   **Rekor log id `3344028471`**, `latestVersion` 1.13.0; GitHub Release `v1.13.0` exists.
   Verified as a user: `deno run -A --min-dep-age 0 jsr:@jrmarcum/binaryang@1.13.0 --version`
   prints `binaryang 1.13.0`.

## 1.12.1 — a PATCH from `main` (2026-10-13; 2026-10-14T03:40Z UTC) — 🚀 PUBLISHED by `bun run release`, provenance recorded

The owner's go: "update the project memory files, commit and bump and push". It carries the § 33
Asyncify fix (a paused call's operands restored on the rewind), the only user-facing change.

1. `CHANGELOG.md` § 1.12.1 on `release/1.12.1`, gated, merged; `main` pushed unbumped at
   `c902fe91c`: CI (the Browsers job included) and auto-tag GREEN.
2. The suite from a FRESH CLONE of that commit: install, tsc, `bun run test` (5,910; 1 skip),
   `bun run test:bun` (the 36 listed), `bun run publish:dry`: all exit 0.
3. JSR 1.12.1 404, no remote tag; `bun run bump` (a patch, `jsr.json` + `main.ts`), `bun run
   release` committed `bump to v1.12.1` (`926d3e4e3`) and pushed `main` + `v1.12.1` together.
4. publish.yml GREEN, with CI and auto-tag; JSR 1.12.1 created 2026-10-14T03:40:26Z, not yanked,
   **Rekor log id `3248420107`**, `latestVersion` 1.12.1.

## 1.12.0 — a MINOR from `main` (2026-10-13 UTC) — 🚀 PUBLISHED by `bun run release`, provenance recorded

The owner's go: "wasmtk has been notified already and is awaiting release 1.12.0 for testing. do the
release". It removes the subpaths and type names 1.11.0 deprecated (open-work 25; BREAKING, hence a
minor). Every step checked through the APIs:

1. `CHANGELOG.md` § 1.12.0 (and handoffs § 32 SENT) on `release/1.12.0`, gated, merged; `main`
   pushed unbumped at `d82d59dac`: CI and auto-tag GREEN.
2. The suite from a FRESH CLONE of that commit: install, tsc, `bun run test` (5,907; 1 skip, the
   external corpus), `bun run test:bun` (the 36 listed), `bun run publish:dry`: all exit 0.
3. 1.12.0 typed by hand in `jsr.json` and `main.ts`; `version_sync` green; JSR 404, no remote tag;
   `bun run release` (cold publish dry run, tsc, entry check) committed `bump to v1.12.0`
   (`a86765385`) and pushed `main` + `v1.12.0` together.
4. publish.yml GREEN, with CI and auto-tag; JSR 1.12.0 created 2026-10-13T01:39:42Z, not yanked,
   **Rekor log id `3247710678`**, `latestVersion` 1.12.0.

## 1.11.0 — a MINOR from `main` (2026-10-13 UTC) — 🚀 PUBLISHED by `bun run release`; the first publish through the Bun workflow (B6 / B7), provenance recorded

The owner's go ("lets update the project memory files and then ship 1.11.0"). Every step checked
through the GitHub and JSR APIs:

1. `main` pushed unbumped at `f9787a52b` (101 commits) — ⚠️ **CI RED, the Gates job's Bun leg.**
   The log needs admin rights, so it was found by timing: `bun test` fails a test slower than 5 s
   by default (`node --test` has none), and `fold_prediction`'s corpus test takes ~4 s here.
   Bun's Linux build was NOT the cause (Bun 1.4.3 for Linux in WSL, with Deno 2.9.7, gave exactly
   the 36 listed differences). Fixed by `--timeout=600000` in `scripts/test.ts` (a 3 s mutant
   reproduced the CI failure exactly), pushed `b343909ae`: CI GREEN, which confirmed the diagnosis.
2. The suite from a FRESH CLONE of the commit (the 1.10.0 rule): install, tsc, `bun run test`
   (5,906; 1 skip: the corpus test, whose external corpus a clone lacks), `bun run test:bun` (the
   36 listed), `bun run publish:dry`: all exit 0.
3. `CHANGELOG.md` § 1.11.0 committed (the Unreleased section, plus what it lacked: browser-loadable
   exports, `wasmOpt` bytes, `InstrCode`, the enums and `Opcode` breaking entries, the reserved-SIMD
   reader fix, the Asyncify and interpreter fixes).
4. 1.11.0 typed BY HAND in `jsr.json` and `main.ts` (a minor; `bun run bump` only patches);
   `version_sync` green; JSR `1.11.0` 404, no remote tag. `bun run release`: the cold `deno publish
   --dry-run` in an empty `DENO_DIR`, `bun run check`, the entry check, then `bump to v1.11.0`
   (`fd5e96acf`), tag, and ONE push of `main` + `v1.11.0`.
5. The tag push fired publish.yml (Bun, the dev dependencies, Node 24, `bun run check`, both test
   legs, then the bare `deno publish`): **GREEN end to end**, with CI and auto-tag green on the same
   commit. JSR: 1.11.0 created 2026-10-13T01:12:58Z, not yanked, **Rekor log id `3247643457`**;
   `latestVersion` 1.11.0.

**What this proves:** B6 and B7 of the Bun migration (open-work 26, now closed): auto-tag with no
Deno, publish.yml judged by CI's checks, and `deno publish` with no deno.json all hold on a real
release, provenance included.

## 1.10.0 — a MINOR from `main` (2026-10-09) — 🚀 PUBLISHED by the hand-pushed tag; the dispatch path failed again, 0-for-5

The owner's go ("lets do the 1.10.0 release"), after item 24 (`wasm-bundle`) merged on a green
gate. Every step verified through the GitHub API:

1. `main` pushed unbumped at `8bd38cc59` — ⚠️ **CI RED on the Test step.** The job log needs admin
   rights through the API, so it was found by reasoning instead: the three `wasm-bundle` fixture
   binaries were never committed, because `.gitignore`'s repo-wide `*.wasm` kept them out. Every
   local run (and the full local gate) passed on files only this disk had. Fixed by an anchored
   exception (`!/tests/binaryen-ts/tools/fixtures/bundle/*.wasm`) plus the binaries, proven by the
   full suite from a FRESH CLONE (exit 0), merged and pushed: `947537f1c`, CI green.
2. The version typed BY HAND — 1.10.0, a MINOR for `./tools/wasm-bundle` — in `deno.json` and
   `main.ts` with the CHANGELOG heading, on `release/1.10.0`; `version_sync.test.ts` run; JSR
   checked first (`packageVersionNotFound`, latest 1.9.0); merged `--no-ff`, pushed `48586b485`.
3. Auto-tag tagged `v1.10.0` and dispatched `publish.yml`, which FAILED as documented (0-for-5).
4. `git fetch origin --tags`, the tag confirmed on the bump commit, deleted and re-pushed by hand:
   the push-triggered run GREEN end to end, provenance verified. JSR: 1.10.0 created
   2026-10-09T15:38:11Z (UTC), not yanked, a Rekor log id present; `latestVersion` 1.10.0.

**The rule this adds:** before a release, run the suite from a fresh clone of the commit. A green
gate on the working tree cannot see a file the ignore rules kept out of the commit
([best-practices.md](best-practices.md) § "A fixture the ignore rules swallowed").

## 1.9.0 — a MINOR from `main` (2026-10-08) — 🚀 PUBLISHED by the hand-pushed tag; the dispatch path failed, 0-for-4 now

The owner's go ("perform items 1 through 3"), after items 23 and 2 closed. Every step verified
through the GitHub API (`gh` is not installed; a Deno poll on `actions/runs?head_sha=`):

1. `main` pushed unbumped at `d0f3dbabd` (115 commits past `v1.8.1`); CI green on Deno, Node 22 /
   24 and Bun; auto-tag a no-op (`v1.8.1` existed).
2. The version typed BY HAND in `deno.json` and `main.ts` — 1.9.0, a MINOR for the new exports
   (`./definitions`, `./tools/wasm-ctor-eval`, `./tools/wasm-interp`) — its own commit on a
   branch, merged `--no-ff`, pushed (`b536bc2be`); `version_sync.test.ts` run first.
3. ⚠️ **Auto-tag tagged `v1.9.0` with `GITHUB_TOKEN` and DISPATCHED `publish.yml`** (no
   `RELEASE_PAT`): check and test green, then "Publish to JSR (with provenance)" FAILED — the
   `actorNotScopeMember` path, now 0-for-4 (the 2026-09-29 "this flow never dispatches" was
   wrong: it dispatches whenever a bump reaches `main` without a developer tag push). JSR had no
   1.9.0 (cache-busted versions API: `packageVersionNotFound`).
4. **Recovery, as the workflow's own warning says:** `git fetch origin --tags`, confirm the tag
   names the bump commit, `git push origin :refs/tags/v1.9.0 && git push origin v1.9.0` from the
   developer's machine — a PUSH event by a scope member; `publish.yml` ran on it and went GREEN
   end to end (version-vs-tag check, type-check, test, OIDC, "Publish to JSR (with provenance)",
   "Create GitHub Release", "Verify provenance was recorded on JSR"). JSR: 1.9.0 created
   2026-10-09T01:04:50Z (UTC), not yanked, a Rekor log id present; `latestVersion` 1.9.0.

**The rule this settles:** after a bump reaches `main`, push the tag yourself (or run
`deno task release`, which pushes it); the auto-tag dispatch will fail and say so. Or set
`RELEASE_PAT`.
