# Releases — how one is made, and every one made

🔒 **One place for the record (owner, 2026-11-10, workspace letter H33, `release-process.md` § 8
D3):** "releases should be recorded in one place in every project; … release.md should be the file
name with the newest first in the 'Release History' with a summary of what changed in each one."
This file is that place. The per-version records 1.5.1 → 3.0.2 moved here from
[publishing.md](publishing.md) on 2026-11-11 (each spot they left holds a pointer);
`publishing.md` keeps what is not one release: provenance, the workflow's design, npm as the second
registry, the purges, the recovery recipes.

## How a release is made (since 2026-11-10)

🔒 **The owner's order (2026-11-10, D1):** "the CI to check first, then push the tag, and then
create the release page from the tag, then publish the package to the registry for the project in
that order." The workspace's [`release-process.md`](../../cmem/release-process.md) § 5 names the
twelve slots U1–U12; this is binaryang's filling of them. §§ 1–4 of that file are binaryang's own
3.0.2 steps (the JS/TS reference), superseded by D1 where they say "the tag push publishes".

**Local, on the owner's word and level (U1 — "release" = "push", then this; Tooling rule 12):**

1. **U2 Merge first.** The release notes (`CHANGELOG.md` § X.Y.Z, from
   [unreleased.md](unreleased.md)) on a `release/X.Y.Z` branch, gated, merged `--no-ff` into
   `main`; push `main` unbumped and let CI go green.
2. **U3 `bun run bump <level>`** — fetches GitHub's tags first (CI makes them) and refuses unless
   the last release tag reachable from HEAD is `v<jsr.json's version>`; refuses a stale
   `api-surface.json`; computes the FLOOR from the surface diff since that tag and refuses a lower
   level; for a patch or a minor runs that release's tests against this tree
   (`scripts/release/previous-tests.ts`) — an unlisted failure OR a stale
   `tests/accepted-changes.json` entry stops it. It writes `jsr.json` and `main.ts`.
   ⚠️ **The bump after 3.0.4 WILL refuse first, by design** (measured 2026-11-13, review round 2):
   v3.0.4's `publish_preflight_wiring.test.ts` read the release script's SOURCE, which review
   rounds 1–2 replaced with behaviour tests — **11 of its tests fail** on the new tree — and the
   3.0.4 entry (`browsers_wiring.test.ts`, "is a CI job that installs the browsers …") is now
   stale. Before the bump, on a branch `accept-<new version>` merged `--no-ff` into `main` (as
   `accept-3.0.3` / `accept-3.0.4` were), ONE commit: drop the stale entry; list the 11 exactly as
   `bun scripts/release/previous-tests.ts v3.0.4` names them, `since` the version you are about
   to bump TO (decide the level first: a minor makes it 3.1.0, not 3.0.5), reason "review rounds
   1–3 (2026-11-13): the release script's guards are held by running them (release-run.ts), not
   by reading publish.ts's source"; and update the file's `about` line (3.0.4's one entry dropped
   at that release). In the same commit, delete this ⚠️ paragraph and the matching one in
   [unreleased.md](unreleased.md). Then bump again. (Measured end to end in a scratch clone in
   review round 3: the procedure takes the bump from refused to written.)
3. **U4 `bun run release`** (`scripts/release/publish.ts`, its logic `release-run.ts`) — guards
   first, each a refusal that changes nothing (held by running them, review round 1): a clean tree
   (untracked files count), on `main`, `fetch` of `main` AND the tags, `main` contains
   `origin/main`, the tag absent locally AND on origin, neither JSR nor npm knows the number, a
   cold `deno publish --dry-run` in an empty `DENO_DIR`, `bun run check`, the package root a
   working CLI, and **something to push** (a second `bun run release` after a failed run is
   refused: use "Re-run failed jobs"). Then it commits `bump to vX.Y.Z` and pushes **`main` only**,
   reading it back with `git ls-remote`. **No tag, ever** (until 2026-11-10 it force-wrote the tag
   and pushed it with `main`).

**CI — `.github/workflows/publish.yml`, on every push of `main`, one run (U5–U9):**

| job | holds | does |
| --- | --- | --- |
| `checks` (U5) | `contents: read` | `workflow.ts release-state`: jsr.json's version with no tag on GitHub = NEW, its tag on THIS commit = a re-run, elsewhere = not a release (stops). For a NEW one, `registry.ts free` (JSR and npm). Then the compatibility gate (`api-surface.ts --release-check`), `bun run check`, both test legs, `deno publish --dry-run` on the sparse tree `jsr` publishes |
| `tag` (U6) | `contents: write` | only once `checks` AND `npm-build` are green or `npm-build` was skipped (npm publishing off) — decided on `npm-build`'s RESULT, never on the variable again (review rounds 1–2): `github.ts tag`, the annotated tag `vX.Y.Z` on this commit through the REST API, read back; at this commit already = done, elsewhere = refused |
| `release` (U7) | `contents: write` | `github.ts release`: the GitHub Release page FROM the tag (H32's order), BEFORE the publish |
| `jsr` (U8) | `id-token: write` | skip if JSR has it; `uploaded` written first; `deno publish` direct; Rekor read back, FATAL |
| `npm-build` | `contents: read` | `npm:prove`, pack, artifact — BEFORE the tag |
| `npm` (U8) | `id-token: write` | waits for JSR; the proven tarball checked; skip if npm serves it; `npm publish`; provenance read back, FATAL |

⚠️ **Switch the `NPM_PUBLISH` repository variable only BEFORE a push, never between a run and a
re-run of it** (review rounds 3–5, 2026-11-13). GitHub's "Re-running workflows and jobs" page
says that re-running failed jobs (or one job) also re-runs the jobs that depend on them, and that
the jobs not re-run keep their OUTPUTS from the previous attempt; that a re-run uses the same
commit and ref; and that a run can be re-run for up to 30 days, at most 50 times. It does not
mention `vars`, skipped jobs, or whether a job that was not re-run keeps its RESULT, so what
follows is INFERRED, not measured. "Re-run failed jobs" does not re-run `npm-build`, which no
failed job depends on, so (inferred) its earlier result stands whatever the variable says now:
- **turned ON** after `npm-build` was skipped: `npm` stays skipped and the run ends green with
  npm unpublished;
- **turned OFF** after `npm-build` succeeded: `npm` still publishes.

If the variable changed mid-release, use **"Re-run all jobs"**, not "Re-run failed jobs" (offered
for any run, failed or not, within the 30 days). That evaluates every job again, and (inferred)
reads the variable as it is now. Every job then skips what is already
done: the tag at this commit, an existing page, a version JSR or npm already serves. So the same
version is completed, and no new one is needed.

A tag made with `GITHUB_TOKEN` starts no workflow run, which is why it is all one run. The run's
actor is whoever pushed `main` — the owner, a member of the `@jrmarcum` JSR scope. The bot-actor
refusal (`actorNotScopeMember`) belonged to auto-tag.yml's DISPATCHED runs; auto-tag.yml is retired.
✅ **MEASURED by 3.0.3 (2026-11-11, run 43061998593):** CI's tag `v3.0.3` (made by
`github-actions[bot]` inside the run) and JSR's OIDC publish with provenance, in one run that the
owner's push started. **U9:** top-level
`permissions: {}`, every action pinned to a commit hash, a per-commit concurrency group that
queues and never cancels, a time limit on every job; Bun (1.4.4), Deno (2.9.6, as
`scripts/deno.ts`) and npm (11.21.2) at EXACT versions (review round 1, 2026-11-13; `v2.x` and
`npm@11` floated until then), Bun and Deno through their setup actions, **not sha256-pinned** — a
gap kept, as wasmtk's. ⚠️ The round-1 changes to the job graph (`tag` waiting for `npm-build`,
the explicit `if:`s) are proven by the tests and by Bun.YAML, **UNMEASURED on GitHub until the
next release**.

**After (U10–U12):** install as a user — `npx @synapticforge1/binaryang@X.Y.Z --version` and
`deno run -A jsr:@jrmarcum/binaryang@X.Y.Z --version` — and record the version below, newest first,
with the run id and the read-backs. A failure is "Re-run failed jobs" on that run (every job skips
what is done) — never a new tag for the same code, never a moved tag; a changed release job is
rehearsed before it lands ([working-rules.md](working-rules.md) § Git).

**Proof of the D1 change (2026-11-11, branch `h33-release-order`):** `workflow_steps.test.ts` and
`publish_preflight_wiring.test.ts` 75 / 75 on the V8 referee; six mutants (a tag elsewhere not
refused, no tag read-back, a moved tag read as a re-run, a burned npm number passing `free`, the
release script tagging again, `jsr` before the page) each turned exactly its own case red.
Read-only against the real GitHub and registries: `release-state` on this branch's HEAD →
`released` (`v3.0.2` peels to `0d59e5c62`, so the push of this change releases nothing); with
`GITHUB_SHA` = that commit → `rerun`; `free 3.0.2` refused (JSR has it, npm published), `free
3.0.3` passes. Bun.YAML parses the workflow: `on.push.branches [main]`, `permissions {}`, six jobs
with the needs above, 0 unpinned actions.

## Release History

### 3.0.4 — a PATCH from `main` (2026-11-11 UTC) — 🚀 PUBLISHED to JSR AND npm, provenance on both

**What changed** (`CHANGELOG.md` § 3.0.4): The same package as 3.0.3 — **nothing in it changed**.
The project's own checks changed: the test that runs the library in real browsers is now two
faster jobs (Chromium, Firefox and WebKit in Playwright's own container image; Chrome, Edge, Brave
and Opera on GitHub's runner), so a broken package mirror on GitHub's side no longer stalls it.

The owner's go: "release 3.0.4" (after first holding the CI change for the next package change).

1. `CHANGELOG.md` § 3.0.4 on `release/3.0.4` (`df9b58e97`, merge `bf8bf0678`). `bun run bump patch`
   refused first: v3.0.3's `browsers_wiring.test.ts` requires the one-job line the two jobs
   replaced. Listed in `tests/accepted-changes.json` (`accept-3.0.4`, merge `c33726764`; 3.0.3's
   six entries dropped as stale), then: floor PATCH, **v3.0.3's tests on this tree: 6,520, 1
   failed, 1 accepted**. Pushed unbumped: **CI 43071399979 green in all nine jobs**, both browser
   jobs included.
2. `bun run release`: the guards, cold dry run, `bun run check`, the entry check; `bump to v3.0.4`
   (`ba20ef1f4`); `main` only pushed, read back.
3. **publish.yml run 43072390794 — all six jobs green:** CI's tag `v3.0.4` (annotated `f9300fc05`,
   peels to `ba20ef1f4`, `ls-remote`) → page `v3.0.4` by `github-actions[bot]` (17:58:27Z, not a
   draft) → **JSR 3.0.4, Rekor `3815373888`** (17:58:53Z) → **npm 3.0.4, SLSA provenance**
   (18:02:02Z). JSR and npm `latest` = 3.0.4. CI 43072390963 on the bump commit: all nine green.
4. **As a user:** `npx @synapticforge1/binaryang@3.0.4 --version` (Node 24) and `deno run -A
   jsr:@jrmarcum/binaryang@3.0.4 --version` print `binaryang 3.0.4`.

### 3.0.3 — a PATCH from `main` (2026-11-11 UTC) — 🚀 PUBLISHED to JSR AND npm, provenance on both — the FIRST release in the owner's order (D1)

**What changed** (`CHANGELOG.md` § 3.0.3): The same package as 3.0.2 — **nothing in it changed**.
This is the first release made in the project's new release order: CI checks the commit first,
then CI creates the tag, then the GitHub Release page, then the publish to JSR and npm, all in one
run. Until now the tag was pushed by hand before CI had checked anything.

The owner's go: "release", level patch (asked: the package is 3.0.2's; the release proves the new
order on GitHub).

1. "push" first: the D1 work (`c62d32bd9`, merge `ea9c824a8`) pushed; `publish.yml`'s first runs
   on `ea9c824a8` and `ec5675757` stopped in `checks` (`released`), every other job skipped — the
   non-release path, as designed. `CHANGELOG.md` § 3.0.3 on `release/3.0.3` (`163bbc566`, merge
   `ec5675757`), pushed unbumped.
2. `bun run bump patch` REFUSED first: v3.0.2's tests of the release scripts fail against the new
   ones (no local tag, `fetch` among the guards, auto-tag.yml gone). The six listed in
   `tests/accepted-changes.json` with the reason (`0d1d9d84c`, merge `71cb51e60`; DG7's two 2.2.2
   entries dropped as stale), then: floor PATCH, **v3.0.2's tests on this tree: 6,476, 6 failed,
   6 accepted**; `version_sync` 3 / 3; `surface:check` matches.
3. ⚠️ **CI's Browsers job could not pass — a GitHub runner outage, not this change.** Three runs
   (43052056661, 43052419072, 43058379392) and the bump's (43061998594): apt on the runners could
   not resolve the Ubuntu mirrors (`azure.archive.ubuntu.com`, `archive.ubuntu.com`,
   `security.ubuntu.com`; `packages.microsoft.com` answered), on Ubuntu 26.04 AND 24.04, so
   Playwright's `install --with-deps` (181 packages, 114 MB) timed out at 20 minutes; the last run,
   half-recovered, failed on a stale index (`libsoup-3.0` 404, exit 100). Every other CI job
   green. A pin to 24.04 (`b5a747f39`) was the wrong diagnosis and was reverted (`90a0c1cad`).
   **Owner: release through the outage** — 3.0.3's package is 3.0.2's, which passed Browsers on
   2026-11-09. The job's speed-ups (fail fast; Playwright's container) follow on their own branch.
4. `bun run release`: the guards, cold dry run, `bun run check`, the entry check; `bump to v3.0.3`
   (`4281a2521`); **`main` ONLY pushed**, read back. No tag from this machine.
5. **publish.yml run 43061998593 — ALL SIX JOBS GREEN, in the owner's order:** `checks` (new, both
   registries free, the gate) → **`tag`: `v3.0.3` created by CI** (annotated `cb27aec1e`, peels to
   `4281a2521`, `ls-remote`) → **`release`: page `v3.0.3` by `github-actions[bot]`**, published
   16:54:51Z, not a draft → **`jsr`: 3.0.3 at 16:55:21Z, Rekor `3814264552`** — JSR accepted the
   OIDC publish in a run whose tag the bot made (U6, measured) → **`npm`: 3.0.3 at 16:58:54Z, SLSA
   provenance**. JSR `latest` and npm `latest` = 3.0.3.
6. **As a user:** `npx @synapticforge1/binaryang@3.0.3 --version` (Node 24.21.0) and `deno run -A
   jsr:@jrmarcum/binaryang@3.0.3 --version` (`--minimum-dependency-age=0`) print `binaryang 3.0.3`.

### 3.0.2 — a PATCH from `main` (2026-11-09 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 3.0.2): The same package as 3.0.0 and 3.0.1, released again so that **npm** gets it: neither reached npm (both are on JSR), so npm goes from 2.2.2 to 3.0.2. **Coming from npm's 2.2.2, read 3.0.0 below** — a major release with breaking changes. Nothing in the package changed.

The owner's go: "Release 3.0.2, tarball path". No package change from 3.0.0; npm's first 3.x.

1. The tarball-path fix and the 3.0.1 record (`6616820a1`, merge `bed204bab`); `CHANGELOG.md`
   § 3.0.2 on `release/3.0.2` (`128ac06ab`), gated 18 / 18, merged (`0281417fd`), pushed
   unbumped: CI (Browsers included) and auto-tag GREEN; a FRESH CLONE: 18 / 18.
2. No tag, neither registry had 3.0.2. `bun run bump patch`: floor PATCH; **v3.0.1's tests on
   this tree: 6,509, 0 failed, 0 accepted**; `version_sync` 3 / 3; `surface:check` matches;
   `bun run release`: `bump to v3.0.2` (`0d59e5c62`), `main` + `v3.0.2` in one push.
3. **publish.yml run 42712133150 — ALL FIVE JOBS GREEN** (open-work 54 measured end to end):
   **JSR** 3.0.2 at 22:33:53Z, `latest`, **Rekor `3771557608`**; **npm** 3.0.2, `latest`, **SLSA
   provenance** (read back by `registry.ts provenance npm`) — published by the credentialed `npm`
   job from the PROVEN tarball by its absolute path, through OIDC trusted publishing; **GitHub
   Release `v3.0.2`** by `github-actions[bot]`, the tag still `0d59e5c62`. CI 42712133212 and
   auto-tag green.
4. **As a user:** `npx @synapticforge1/binaryang@3.0.2 --version` and `deno run -A
   jsr:@jrmarcum/binaryang@3.0.2 --version` (`--minimum-dependency-age=0`) print `binaryang
   3.0.2`; npm's `wasm-objdump -d` is refused ("-d (disassembly) is not supported yet; use -x
   …", exit 1) and `-x` prints upstream's lines (`type[0] () -> nil`, `func[0] sig=0`) — the
   3.0 changes, as published.

**What the three releases cost, and the lesson** (one day, 3.0.0 → 3.0.2): two defects in the
new workflow's npm half — a missing pack folder, a tarball path npm reads as a GitHub repo —
each reachable only on GitHub, each costing a version, because a re-run runs the TAG's
workflow and scripts. Both were invisible to the dry runs here, which created the folder by hand
and passed absolute paths. **Rule: rehearse a changed release job with the exact commands, in a
fresh folder laid out as the runner's, before landing it** — the dry-run `npm publish` of the
path `registry.ts` outputs (done for 3.0.2) is the check that would have caught both.

### 3.0.1 — a PATCH from `main` (2026-11-09 UTC) — 🚀 on JSR with provenance; ❌ NOT on npm again

**What changed** (`CHANGELOG.md` § 3.0.1): The same package as 3.0.0, released again for **npm**: 3.0.0 reached JSR, but its npm publish failed in the release workflow. 3.0.1's npm publish failed too, so 3.0.1 is on JSR only and npm's first 3.x is 3.0.2 (above). Nothing in the package changed.

The owner's go: "Release 3.0.1", so npm gets 3.x by CI. No package change from 3.0.0.

1. The `npm pack` fix and the 3.0.0 record (`d8a5ea6b2`, merge `826156885`); `CHANGELOG.md`
   § 3.0.1 on `release/3.0.1` (`e321d1f89`), gated 18 / 18, merged (`1ea65a6b1`), pushed
   unbumped: CI (Browsers included) and auto-tag GREEN; a FRESH CLONE: 18 / 18.
2. **`bun run bump patch` stopped, rightly, on a harness defect:** v3.0.0's `deno_pin.test.ts`
   runs `git ls-files`, and `previous-tests.ts` ran the old tests in a temp folder that was no
   git repository (exit 128, no files). First seen now: the test arrived after 2.2.2 and 3.0.0
   was a major. Fixed, not listed as accepted (`6a69598da`, merge `b9243b420`: the folder is
   `git init` + `git add -A`); v3.0.0's tests: 6,508, 0 failed. Pushed unbumped: CI and
   auto-tag green; FRESH CLONE of `b9243b420`: 18 / 18.
3. `bun run bump patch`: floor PATCH; **v3.0.0's tests on this tree: 6,508, 0 failed, 0
   accepted** (two stale 2.2.2 entries reported, harmless); `version_sync` 3 / 3;
   `surface:check` matches; `bun run release`: `bump to v3.0.1` (`1d31887ce`), `main` + tag.
4. **publish.yml run 42704308757:** `checks` ✅, `jsr` ✅ (**JSR 3.0.1** 21:43:39Z, `latest`,
   **Rekor `3770874199`**), `release` ✅ (**GitHub Release `v3.0.1`** by `github-actions[bot]`),
   `npm-build` ✅ (the tarball packed and uploaded — the artifact hand-off MEASURED), **`npm` ❌ at
   "Publish to npm"** after every check passed (artifact downloaded, JSR 200, manifest checked,
   npm `free`): `npm publish npm-pack/<file>.tgz` — npm reads `dir/name.tgz` as a GitHub
   shorthand and runs `git ls-remote ssh://git@github.com/npm-pack/….git` (reproduced with npm
   11; `./…` or an absolute path is read as the file). npm has no 3.0.1 and the number is unused.
   CI and auto-tag green. Fixed: `registry.ts npm-tarball` outputs an ABSOLUTE path
   (`tarballSpec`), tested and inverted; proven end to end here with a dry-run publish of the
   path it outputs. Owner: "Release 3.0.2, tarball path".

### 3.0.0 — a MAJOR from `main` (2026-11-09 UTC) — 🚀 on JSR with provenance; ❌ NOT on npm

**What changed** (`CHANGELOG.md` § 3.0.0): A major release. **The binaryen facade's numbers are now binaryen.js 132's**, `i64.const` refuses its old two-argument form, `wasm-objdump -d` is upstream's disassembly flag (refused for now), and the minimum Bun is 1.4.4 — README § "Breaking Changes" has the migration. It also fixes **two optimizer defects that changed what optimized code computes**, makes many tools behave as upstream wabt's (`wasm2wat` validates, `wasm-validate` is silent on success, `wasm-objdump -x` prints upstream's details), and refuses several inputs it used to accept or guess at.

The owner's go: "update the project memory files, commit, push and then release". Measured
first: the compatibility floor since `v2.2.2` was **MAJOR** (`./compat/binaryen: Features
changed`, open-work 52) — the records said "at least a MINOR", judged, never measured. Owner:
"Land queued, then 3.0.0": CL7 step 2 (`wasm-objdump -d` refused) and CL19 (`i64.const(value,
high?: never)`) landed first (`d8cc83115`, surface `2ae40df52`, merge `592df5f8d`; full gate
30 / 30). CHANGELOG § 3.0.0.

1. `CHANGELOG.md` § 3.0.0 on `release/3.0.0` (`b24fbf91c`), gated 18 / 18 (`surface:check` joined
   the session runner's CI half), merged (`bf7909807`), pushed unbumped: CI (Browsers included)
   and auto-tag GREEN; a FRESH CLONE of `bf7909807` from GitHub: 18 / 18.
2. **`bun run bump major` found a defect, and was undone before any commit:** the new `-d` help
   line said "Until 3.0.0 …", and the fingerprint replaces the tree's own version, so the bump
   read as "usage text changed" — **1.16.0's trap again** (§ "The compatibility gate"). Fixed
   (`894ee8bcd`, surface `8e05a71f3`, merge `7fa877606`; full gate 30 / 30; `surface:check`
   proven with the version set to 3.0.0). Pushed unbumped: auto-tag green; CI green but
   **Browsers CANCELLED at its 20-minute limit inside "Install the browsers"** (Playwright's
   download, no test run — 2.2.1's case); the fresh clone's browsers step passed, and the bump
   commit's CI re-ran it green. FRESH CLONE of `7fa877606`: 18 / 18.
3. **The consumer step:** wasmtk pins 2.2.0 exactly, so nothing reaches it before its own bump.
   Read in its tree: it names the facade's types and features (`binaryen.i32`,
   `Features.All`), sets its shrink level, calls `i64.const` with one argument, and runs no
   `wasm-objdump -d`; `wasmbundle.ts`'s partial `parseWat` feature bag is the one change to tell
   it (the workspace ledger). The workspace's `tools/assembler-parity/diag4.ts` runs upstream's
   `wasm-objdump -d`, not ours.
4. No tag; neither registry had 3.0.0. `bun run bump major`: floor MAJOR (a major runs no
   previous-release tests); `version_sync` 3 / 3; `surface:check` matches; `bun run release`:
   `bump to v3.0.0` (`1222e78d5`), `main` + `v3.0.0` in one push.
5. **The restructured publish.yml's first run** (42699750914; open-work 54): `checks` ✅, `jsr` ✅
   (**JSR 3.0.0** created 21:14:41Z, `latest`, not yanked, **Rekor `3770400455`**), `release` ✅
   (**GitHub Release `v3.0.0` by `github-actions[bot]`**, not a draft, the JSR link on top, the
   tag still `1222e78d5` — H32 measured), **`npm-build` ❌ at "Pack the proven package"** —
   `npm pack --pack-destination ../npm-pack` into a folder that did not exist (ENOENT, exit 38,
   reproduced here; my pre-landing check had made the folder first) — so **`npm` was skipped:
   npm has no 3.0.0**, and the number stays unused (`time` has no 3.0.0). CI (Browsers
   included) and auto-tag green on `1222e78d5`. A re-run cannot help: it runs the tag's
   workflow. Owner: "Release 3.0.1" (§ "3.0.1").

### 2.2.2 — a PATCH from `main` (2026-10-28 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 2.2.2): A patch release: the validator now checks a legacy `delegate` properly, and its type-mismatch messages read as upstream wabt's. Nothing is added, removed or renamed.

The owner's go: "We will release the delegate fix as 2.2.2". It carries the legacy `delegate`
fix (open-work 47, C12), upstream wabt's type-mismatch words (open-work 48, DG7) and the README's
npm 12 note (C21) — CHANGELOG § 2.2.2. The first release on the history rewritten by the second
purge (§ below), which was force-pushed the same day before this release began.

1. `CHANGELOG.md` § 2.2.2 on `release/2.2.2`, gated 17 / 17, merged (`02b774d68`), pushed
   unbumped: CI (Browsers included) and auto-tag GREEN. A FRESH CLONE of `02b774d68` from GitHub:
   17 / 17 (17 step logs). The two fixes' own branches had each run the full gate, 29 / 29.
2. **The consumer step:** the validator, which wasmtk imports (`wasm-validate`), changed, so it is
   not skipped by its rule. wasmtk pins 2.2.0 EXACTLY, so nothing reaches it before its own bump;
   what changes for it was sent in C12's answer (its `try_delegate` pin can go to 0). Its suite
   was not run here (its tree is its own).
3. No tag, neither registry had 2.2.2. `bun run bump patch`: floor PATCH; **v2.2.1's tests on this
   tree: 6,339, 2 failed, 2 accepted** — the two tests that pinned the old mismatch words, listed in
   `tests/accepted-changes.json` in their own commit (`a03a667e7`, merged `ceb18dbda`), replacing
   2.2.0's stale entry. Found on the way: Node's JUnit reporter escapes a quote twice and
   `previous-tests.ts` decodes once, so a test name with a quote is listed as the tool reports it
   (`&quot;`). `surface:check` matches; `version_sync` 3 / 3; `bun run release`: `bump to
   v2.2.2` (`88a0e7c6f`), `main` + `v2.2.2` in one push.
4. CI, auto-tag and publish.yml GREEN on the bump: **JSR** 2.2.2 created 2026-10-28T15:15:39Z,
   not yanked, **Rekor log id `3541668152`**; **npm** at 15:19:13Z, `latest`, SLSA provenance;
   GitHub Release `v2.2.2`. As a user: npm and JSR `--version` print `binaryang 2.2.2`; `wat2wasm`
   refuses `(func (try (do) (delegate 1)))` with `invalid depth: 2 (max 1)` from both registries,
   where npm's 2.2.1 accepted it; `(func (result i32))` reads `type mismatch in implicit return,
   expected [i32] but got []` (2.2.1: `… in function, expected 1 elements on the stack but got 0`) —
   the fixes, as published.

### 2.2.1 — a PATCH from `main` (2026-10-26 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 2.2.1): A patch release with one fix: **`wasm-strip` now leaves every section it keeps exactly as it was.** Nothing is added, removed or renamed.

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

### 2.2.0 — a MINOR from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 2.2.0): A minor release that settles **which features a reference type needs**, as wasm-tools has it, and closes **four validator gaps** where binaryang accepted what wasm-tools refuses (reported by the wasmrt and wazmrt runtimes, which take their `--features` meaning from `./definitions`). `./definitions` now states those rules as data. Nothing is removed or renamed.

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

### 2.1.0 — a MINOR from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 2.1.0): A minor release. Above all a fix: **`wasm-validate` and `wat2wasm` refused every module with a function table under their default features** — every real C, Rust, Zig and TinyGo build with an indirect call — in every release since at least 1.5.3. Also: **tail calls are portable** under `wasm-opt --target portable`, `return_call_ref` needs only function references, the validator gains two feature checks it lacked, and `./definitions` records each feature's prerequisites and the specification's releases. Nothing is removed or renamed.

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

### 2.0.0 — the first MAJOR, from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 2.0.0): A major release, for **one breaking change**: the `sat-float-to-int` feature-flag spelling, deprecated in 1.17.0, is removed — use upstream's `saturating-float-to-int` (README § Breaking Changes). Also new: **the interpreter runs threaded modules** (shared memory and atomics). Nothing else is removed or renamed.

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

### 1.17.0 — a MINOR from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 1.17.0): A minor release: **every command answers `--help`**, `wasm-opt` can **replace TinyGo's libc copy loops with one `memory.copy`**, the saturating float-to-int feature flag takes **upstream's spelling** (the old one still works, deprecated), and **switching multi-value off now works**. Nothing is removed; without the new flags, output does not change.

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

### 1.16.1 — a PATCH from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 1.16.1): A patch release with **no change to the package**: the library, the command line and the documentation are those of 1.16.0. It is released to check this repository's release tooling, whose compatibility check misread 1.16.0's version bump as a change to the command line's help text (the help text names the version). 1.16.0 itself was published correctly.

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

### 1.16.0 — a MINOR from `main` (2026-10-24 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 1.16.0): A minor release: **`wasm-opt --target portable`** makes a module run, with the same behaviour, on every widely used WebAssembly engine, or says exactly which features stop it and which engines refuse them; **two new lowering passes** it uses; and the **portability profile** behind it as data in `./definitions`. Nothing is removed or renamed, and without the new flags no output changes.

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

### 1.15.0 — a MINOR from `main` (2026-10-23 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 1.15.0): A minor release: **one new optimizer pass, `SSANoMerge`**, which makes `-O3`, `-Os` and `-Oz` output smaller on real compiler builds at the same run speed. Nothing is removed or renamed, and output at the other levels does not change.

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

### 1.14.0 — a MINOR from `main` (2026-10-22 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 1.14.0): A minor release: **a module built for 64-bit memory now runs on Safari and Bun** (JavaScriptCore), through a new pass that keeps the module's behaviour where Binaryen's does not. Nothing is removed or renamed, and no other output changes. Tested on the spec suite's 64-bit modules and on real compiler output: Rust, Zig and Emscripten builds, Emscripten's own JavaScript glue unchanged, run to the right result on JavaScriptCore once lowered.

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

### 1.13.3 — a PATCH from `main` (2026-10-22 UTC) — 🚀 PUBLISHED to JSR AND npm by the workflow, provenance on both

**What changed** (`CHANGELOG.md` § 1.13.3): The same package as 1.13.2, released again so that it carries provenance on both registries. 1.13.2's publish to JSR failed after the upload (a registry-side response was not JSON), so JSR 1.13.2 has no provenance and npm never received it. 1.13.3 is published to JSR and, for the first time from the release workflow, to npm as `@synapticforge1/binaryang`, each with provenance. Nothing in the code changed.

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

### 1.13.2 — a PATCH from `main` (2026-10-21 UTC) — ⚠️ ON JSR WITHOUT PROVENANCE, NOT on npm

**What changed** (`CHANGELOG.md` § 1.13.2): - **On npm:** the package is published to npmjs.org as [`@synapticforge1/binaryang`](https://www.npmjs.com/package/@synapticforge1/binaryang), alongside JSR's `@jrmarcum/binaryang` — the same code, version and subpaths. `npm install` needs no `.npmrc`, and the command line runs as `npx binaryang`. From this version on, each release is published to both registries from the same tag, with provenance on both. (1.13.1 is on npm too, published by hand to create the package; it carries no provenance.)

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

### 1.13.1 — a PATCH from `main` (2026-10-20; 2026-10-21T00:08Z UTC) — 🚀 PUBLISHED by `bun run release`, the FIRST from the org, provenance recorded

**What changed** (`CHANGELOG.md` § 1.13.1): - The repository has moved to [github.com/synapticforge1/binaryang](https://github.com/synapticforge1/binaryang); the README's links and CI badge point there. The old address redirects. The package name, `@jrmarcum/binaryang`, is unchanged, and nothing in the code changed.

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

### 1.13.0 — a MINOR from `main` (2026-10-20; 21:37Z UTC) — 🚀 PUBLISHED by `bun run release`, provenance recorded

**What changed** (`CHANGELOG.md` § 1.13.0): A minor release: **an optimizer within 0.7% of upstream `wasm-opt -Oz` on real compiler output, and smaller than upstream at `-O2`**, with three new passes; a validator that could report an invalid module as valid, now fixed; and a reader that stops early on malformed input. Nothing is removed or renamed. No valid module's bytes change through `wat2wasm`, `wasm2wat` or a plain read and write; the optimizer's output moves, and every output still behaves as its input.

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

### 1.12.1 — a PATCH from `main` (2026-10-13; 2026-10-14T03:40Z UTC) — 🚀 PUBLISHED by `bun run release`, provenance recorded

**What changed** (`CHANGELOG.md` § 1.12.1): - **`Asyncify` restores a paused call's operands on the rewind.** It saved only the locals still needed AFTER a call that can unwind, but a rewind runs that call again, so a value read only as its operand came back wrong. Seen as a `call_indirect` whose table index was loaded from memory: the rewind called table slot 0 (`uninitialized element`, or the wrong function). TinyGo 0.43's nested goroutines with a pending `defer` hit it; their output now runs. Asyncify frames grow where operands were missed (upstream's are larger still).

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

### 1.12.0 — a MINOR from `main` (2026-10-13 UTC) — 🚀 PUBLISHED by `bun run release`, provenance recorded

**What changed** (`CHANGELOG.md` § 1.12.0): - ⚠️ **Breaking:** the subpaths `@jrmarcum/binaryang/ir/binaryen-ts`, `…/ir/wabt-ts` and `…/core/wabt-ts`, deprecated in 1.11.0. Import from `@jrmarcum/binaryang/ir`, which exports everything they did, under the same names and from the same declarations. - ⚠️ **Breaking (type level):** the deprecated type names `Type` (the node-type union) in `./api`, which is `ExprType`, and `Features` / `WasmModule` in `./compat/wabt`, which are `WabtFeatures` / `WabtWasmModule`. Nothing changes at run time.

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

### 1.11.0 — a MINOR from `main` (2026-10-13 UTC) — 🚀 PUBLISHED by `bun run release`; the first publish through the Bun workflow (B6 / B7), provenance recorded

**What changed** (`CHANGELOG.md` § 1.11.0): - **`@jrmarcum/binaryang/ir`** — ONE subpath for the IR. It exports everything `./ir/wabt-ts`, `./ir/binaryen-ts` and `./core/wabt-ts` export: the IR's records under both sets of names (`Expr` and `Expression`, `Module` and `WasmModule`, … — the same types), the expression factories, the module builder, the value and GC types, and `Result`, `ErrorList`, `formatErrors`, the feature sets. **One name means one thing there:** `Type` is the value-type enum (`Type.I32`), and the union a node's `type` field holds — `Type` in `./ir/binaryen-ts` and `./api` — is `ExprType`, the same type. - `funcAt(module, var)` and `funcSignature(module, func)`: the function a reference names (imports first in the index space) and its declared signature. - **A hang check for the interpreter.** After 2 seconds of running, and every 2 seconds after (just above the slowest real run measured), it samples a loop as it comes back to its top; if it comes back again with the same locals and operand stack, having changed nothing else, it can never exit, and the run stops with the new `Stop` reason `hang` instead of waiting for fuel. It never stops a loop that could still finish. `wasm-interp --hang-check=SECONDS` (0 checks from the start) and `--no-hang-check`; `InterpreterOptions.hangCheck` in milliseconds, `null` for none.

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

### 1.10.0 — a MINOR from `main` (2026-10-09) — 🚀 PUBLISHED by the hand-pushed tag; the dispatch path failed again, 0-for-5

**What changed** (`CHANGELOG.md` § 1.10.0): A minor release: **`wasm-bundle`** — one module from many, with ONE memory relocated exactly through the producers' own relocation entries, the `.wit` written beside it — and the `(@reloc data)` annotation that lets a text producer mark its addresses. No valid module's bytes change through `wat2wasm`, `wasm2wat`, a plain read and write, or the optimizer at any level (the gate's optimize-corpus number is 1.9.0's).

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

### 1.9.0 — a MINOR from `main` (2026-10-08) — 🚀 PUBLISHED by the hand-pushed tag; the dispatch path failed, 0-for-4 now

**What changed** (`CHANGELOG.md` § 1.9.0): A minor release: **an interpreter and the tools on it, `./definitions` for other projects to generate from, and an optimizer within 2% of upstream `wasm-opt -Oz` on the corpus** (825,077 bytes to upstream's 809,986 over 421 modules; it was 13% above at 1.8.1). No valid module's bytes change through `wat2wasm`, `wasm2wat` or a plain read and write; the optimizer's output moves at every level, and the behaviour gates hold on every one of them.

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

### ✅ 1.8.1 — a patch by `deno task bump`, released 2026-09-29

**What changed** (`CHANGELOG.md` § 1.8.1): A patch release answering the wasmtk team's check of 1.8.0's custom-page-sizes lowering on five engines (wasmtime, V8, JavaScriptCore, wasmer, wazero): values, trap positions and linking held on all of them; the trap and link-error KINDS did not. No valid module's bytes change through `wat2wasm`, `wasm2wat` or a plain read and write.

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

### ✅ 1.8.0 — a hand-typed MINOR, released 2026-09-29

**What changed** (`CHANGELOG.md` § 1.8.0): A minor release: **diagnostics you can act on, `wat2wasm` validating as upstream does, the spec's `proposals/` in the test gate, and custom page sizes on V8.** No valid module's bytes change through `wat2wasm`, `wasm2wat` or a plain read and write.

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

### ✅ 1.7.2 — a patch by `deno task bump`, released 2026-09-29

**What changed** (`CHANGELOG.md` § 1.7.2): A patch release. **`wasm2wat` prints the text upstream `wasm2wat` and `wasm-tools` print**, and one validator gap is closed. No valid module's bytes change; nothing is removed or renamed.

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

### ✅ 1.7.1 — a patch by `deno task bump`, released 2026-09-29

**What changed** (`CHANGELOG.md` § 1.7.1): A patch release: **a memory or table limit above 2^32-1 is invalid, not unencodable.** It fixes item 1 of the wasmtk team's report of 2026-09-29 (against 1.7.0).

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

### ✅ 1.7.0 — a hand-typed MINOR, released 2026-09-29 (UTC)

**What changed** (`CHANGELOG.md` § 1.7.0): A minor release with **one breaking change**: the package no longer reaches upstream binaryen. It adds the **custom-descriptors** proposal, fixes every item in the wasmtk team's report of 2026-09-28, and adds `wasm-opt --converge` and the three minify passes.

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

### 1.6.1 — a patch from a branch (2026-09-28) — 🚀 PUBLISHED

**What changed** (`CHANGELOG.md` § 1.6.1): A patch release: **the CLI runs from JSR.**

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

### ✅ 1.6.0 — a hand-typed MINOR, released 2026-09-28

**What changed** (`CHANGELOG.md` § 1.6.0): A minor release with **breaking changes**: the two IRs converged into one, and binaryen-ts's own binary decoder and encoder are gone. Every tool and API now reads WebAssembly with one reader and writes it with one writer (wabt-ts's). If you use only the tools (`wat2wasm`, `wasm2wat`, `wasm-opt`, …) or the `compat` APIs, nothing you call has moved.

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

### ✅ The tag-push path works unaided — 1.5.4, 2026-09-02

**What changed:** no `CHANGELOG.md` section for 1.5.4; the record below is the summary.

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

### 1.5.1 published — the result

**What changed:** no `CHANGELOG.md` section for 1.5.1; the record below is the summary.

`@jrmarcum/binaryang@1.5.1`, 2026-08-27, **provenance recorded: `rekorLogId=2618802426`**. The
verification step confirmed it in-run rather than leaving it to be discovered later. Smoke-tested
against the PUBLISHED artifact (not local paths): `./wat2wasm`, `./wasm2wat`, `./core/wabt-ts` and
`./binary` in one program, round-tripping and executing correctly.

#### ⚠️ The first tag push produced NO workflow run at all

Pushed the tag before the branch. At that moment the remote's `main` was still the initial
README-only commit, so Actions had no `publish.yml` registered to match a tag event against — the
event passed unmatched and silently. Pushing `main` then registered all three workflows, and
`auto-tag` correctly no-opped because the tag already existed. Net effect: a tag, a green CI run,
and no release.

Fixed by deleting and re-pushing the tag once the workflows were registered.

**This only bites on a repository's first push**, and the intended release flow avoids it entirely,
because there the branch push always comes first. Worth writing down anyway: the symptom is not an
error, it is an _absence_, and absence is the hardest thing to notice.

#### The score was 88 at 1.5.1, and provenance was not why

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

#### How to find the undocumented symbols — the method, not the number

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

#### The `unanalyzable-dynamic-import` warning is benign

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

#### Consumers hit a 24-hour wall

Deno's `minimumDependencyAge` (default 24h) refuses a version this new:

> Could not find version … A newer matching version was found, but it was not used because it was
> newer than the specified minimum dependency date

Expected, not a defect — pass `--min-dep-age=0`, or wait. Worth knowing before wasmtk's migration
(C1): binaryang's own `deno.json` sets `minimumDependencyAge: "0"`, inherited from wabt-ts, but a
consumer's setting is the one that governs.
