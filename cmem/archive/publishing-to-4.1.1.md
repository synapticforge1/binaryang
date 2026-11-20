# Publishing — closed and historical sections — archive

Holds the npm-as-second-registry plan (done 2026-10-22), the 2026-08 provenance measurements, the retired auto-tag dispatch path, the two history purges and the old release-record pointers. Moved verbatim from `cmem/publishing.md` on 2026-11-20 (H38 step 4).

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
| the release path | `publish.yml` job `npm-build` (`npm:prove`, BEFORE CI tags) and job `npm` (after JSR's, the same version, `npm publish` of the proven tarball, OIDC, no token), then the provenance attestation read back from the registry; **OFF until the repository variable `NPM_PUBLISH` is `true`** — switch it only before a push; if it changed mid-release, "Re-run all jobs", not "Re-run failed jobs" ([release.md](../release.md)) |

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
no `bin`); npm takes `"license": "MIT OR Apache-2.0"`, which JSR cannot ([licensing.md](../licensing.md)).

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
The recipe for the other packages is [jsr-deno-exit-guide.md](../jsr-deno-exit-guide.md) § 5b.


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
before sending reversed it ([handoffs.md](../handoffs.md) § 41, the corrected letter).

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

*(The 1.5.1 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*


## The auto-tag dispatch path does not publish — its cause, and the recovery

🗄️ **History since 2026-11-10: `auto-tag.yml` is RETIRED** (D1, workspace letter H33). CI now
tags inside the run that `main`'s push started — that run's actor is the pusher, not the bot —
and publishes in the same run ([release.md](../release.md) § "How a release is made"). What follows
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
  ([best-practices.md](../best-practices.md) § "When two paths to the same action disagree").
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
  [ir-convergence.md](../ir-convergence.md) and `src/passes/lower-block-params.ts` for the traps its
  message records. Its ancestry was pre-purge and reached the 6 path-bearing commits, so it was
  **re-parented** onto the map's new parent `1729de2a5`. The result, `91dfb6cc2` (was `ade9019d6`,
  in the bundle), keeps the message bytes, names, dates and the same patch (3 files). Its tree took
  the parent's `scripts/spec-prepare.ts`, which the commit never touched; a first attempt that kept
  the old tree carried the path back in through that file. Its fate was
  [open-work.md](../open-work.md) item 43: **deleted 2026-11-05** (owner), after its message was
  folded into [ir-convergence.md](../ir-convergence.md) § R15 and both citations pointed there. No
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

*(The 3.0.2 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 3.0.1 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 3.0.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 2.2.2 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

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

*(The 2.2.1 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 2.2.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 2.1.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 2.0.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.17.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.16.1 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.16.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.15.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.14.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.13.3 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.13.2 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.13.1 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.13.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.12.1 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.12.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.11.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.10.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*

*(The 1.9.0 release record moved to [release.md](../release.md) § "Release History", 2026-11-11 — workspace letter H33, D3.)*
