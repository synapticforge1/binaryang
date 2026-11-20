# Releases — how one is made, and every one made

How a release is made, and the records of the two newest releases (4.1.1, 4.1.0); older records are in [archive/release-to-4.1.1.md](archive/release-to-4.1.1.md). Last verified 2026-11-20.

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
that order." The workspace's [`release-process.md`](../../workspace/cmem/release-process.md) § 5 names the
twelve slots U1–U12; this is binaryang's filling of them. §§ 1–4 of that file are binaryang's own
3.0.2 steps (the JS/TS reference), superseded by D1 where they say "the tag push publishes".
🔒 **Amended 2026-11-17 (letter H37; owner: "We want the CI to verify the version, then tag,
create the release page and publish, and skip any version already published"): the CHECKS run
LOCALLY** — the review set and every gate, before the bump is pushed. CI runs no test.

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
   When the previous release's tests fail on purpose, list each in
   `tests/accepted-changes.json` exactly as `bun scripts/release/previous-tests.ts v<previous>`
   names it, `since` the version being bumped TO (decide the level first), with its reason, and
   drop the stale entries — ONE commit on a branch `accept-<new version>`, merged `--no-ff` into
   `main` (as `accept-3.0.3`, `accept-3.0.4` and `accept-3.1.0` were). A major bump runs no
   previous tests: its list documents what changed (`accept-3.1.0` predates 4.0.0's level).
   **The accept commit changes a test file after the recorded review**, so `bun run release`
   would refuse it: review it (all five classes, its own re-review) and `review:record` it before
   merging (first met at 4.1.0, 2026-11-19).
3. **U4 `bun run release`** (`scripts/release/publish.ts`, its logic `release-run.ts`) — FIRST
   the review set (since 2026-11-18): a completed review recorded (`bun run review:record`, one
   hash in the gitignored `cmem/local/review-complete`, since 2026-11-19; a `review-complete:` line
   in `review-issues.md` before) with nothing but the release files and `cmem/` changed since,
   then `bun run gate --release` — every gate locally, plus the compatibility gate and the privacy
   scan of every commit since the previous tag. Then the guards, each a refusal that changes
   nothing (held by running them, review round 1): a clean tree
   (untracked files count), on `main`, `fetch` of `main` AND the tags, `main` contains
   `origin/main`, the tag absent locally AND on origin, neither JSR nor npm knows the number, a
   cold `deno publish --dry-run` in an empty `DENO_DIR`, `bun run check`, the package root a
   working CLI, and **something to push** (a second `bun run release` after a failed run is
   refused: use "Re-run failed jobs"). Then it commits `bump to vX.Y.Z` and pushes **`main` only**,
   reading it back with `git ls-remote`. **No tag, ever** (until 2026-11-10 it force-wrote the tag
   and pushed it with `main`).

**CI — `.github/workflows/publish.yml`, on every push of `main`, one run (U5–U9):**

- **job:** `checks` (U5)
  - holds: `contents: read`
  - does: the VERSION only (since 2026-11-18): `workflow.ts release-state` — NEW, a re-run, or not a
    release (stops); for a NEW one, `registry.ts free` (JSR and npm): a version already published is
    skipped. No test, no dependency
- **job:** `tag` (U6)
  - holds: `contents: write`
  - does: only once `checks` AND `npm-build` are green or `npm-build` was skipped (npm publishing
    off) — decided on `npm-build`'s RESULT, never on the variable again (review rounds 1–2):
    `github.ts tag`, the annotated tag `vX.Y.Z` on this commit through the REST API, read back; at
    this commit already = done, elsewhere = refused
- **job:** `release` (U7)
  - holds: `contents: write`
  - does: `github.ts release`: the GitHub Release page FROM the tag (H32's order), BEFORE the publish
- **job:** `jsr` (U8)
  - holds: `id-token: write`
  - does: skip if JSR has it; `uploaded` written first; `deno publish` direct; Rekor read back, FATAL
- **job:** `npm-build`
  - holds: `contents: read`
  - does: `npm:prove`, pack, artifact — BEFORE the tag
- **job:** `npm` (U8)
  - holds: `id-token: write`
  - does: waits for JSR; the proven tarball checked; skip if npm serves it; `npm publish`; provenance read back, FATAL

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

### 4.1.2 — a PATCH from `main` (2026-11-20 UTC) — 🚀 PUBLISHED to JSR AND npm, provenance on both

**What changed** (`CHANGELOG.md` § 4.1.2): the same package as 4.1.1. The release workflow: npm's
provenance read-back waits 10 min (40 × 15 s), each attempt says what it saw, the key per run
attempt, the npm job's timeout 35 min. Repo-only besides: the previous-tests harness (a failure
re-run alone, both runs bounded over their whole process tree — scripts/run-bounded.ts), and
coalesce_budget's two bounds on process CPU time (Q-H5).

The owner's go: "release" (2026-11-20).

1. Notes (`d83cc2352`) and accept-4.1.2 reviewed (0 in all five). The gate's Node `test` step then
   failed 2 of 4 runs, never naming the test (Q-H6 queued); the bump twice refused on v4.1.1's
   coalesce_budget (20 s wall bound, ~7 s alone) under 57% background CPU. Owner: "Fix the harness".
2. The harness: 057fb046a … e07b2bad3 (four re-reviews: twins vouching, an overclaiming label, no
   time limit, the limit killing fnm only, Ctrl-C orphaning the group — all fixed, the last
   measured on linux-x64). A second accepted entry: v4.1.1's harness test reads today's source.
   fnm and Node 24 installed in the WSL (owner) — the Linux run gained the V8 leg, whose first run
   failed the same test at 28.7 s → Q-H5's root cause: CPU-time bounds (8b53bad31 … daf08d553,
   measured under 24 busy workers; budget bound 40 s).
3. Full suite at `daf08d553`: win-x64 gate 31 / 31; linux-x64 fresh clone: V8 6811 / 6811, Bun
   6811 / 6811, baseline, privacy, --self-check. Merged (`eb812aa9b`), pushed unbumped: run
   44780039195 green. `review:record daf08d553`.
4. `bun run bump patch`: floor patch; previous tests 6794, 2 failed, 2 accepted, at the first try.
   `bun run release`: gate --release 33 / 33; `bump to v4.1.2` (`cb857e212`) pushed, read back.
5. **publish.yml run 44782414500 — GREEN in every job, first attempt:** tag `v4.1.2` (`39a419c77`,
   peels to `cb857e212`) → page (17:21:57Z) → **JSR 4.1.2, Rekor `4027447643`** → npm published
   17:22:40Z, provenance found 17:25:27Z (2 min 47 s — at the old window's edge). `latest` = 4.1.2
   on both. As a user: `bun x @synapticforge1/binaryang@4.1.2 --version` → `binaryang 4.1.2`.

### 4.1.1 — a PATCH from `main` (2026-11-19 UTC) — 🚀 PUBLISHED to JSR AND npm, provenance on both

**What changed** (`CHANGELOG.md` § 4.1.1): GitHub issue #1 (trackoor): `wasm-opt -O2`+ no longer
refuses a valid module with a value left in unreachable code before a block's trailing `br`; the
validator refuses a `sub` type with more than one supertype. Repo-only: Dependabot #2/#3, the
privacy scan and Dependabot's address, the previous-tests work tree.

The owner's go: "release" (2026-11-19), after "push" of the fix.

1. **Review set:** `actions-bump` (review + re-review 1, 0), `issue-1` (review 0 in all five), the
   release branch (round 1: S-1, the harness's inherited GIT_*; re-review 1: B-1, notes wording;
   re-review 2: 0) — `review:record 1ecd7396a`. While verifying S-1's first fix with GIT_DIR at
   this repository, v4.1.0's tests committed "reviewed" onto the branch (local; soft-reset; every
   spawn now gets the env without GIT_*; verified against a canary) — review-issues.md.
2. **The bump's previous tests needed a harness fix first:** v4.1.0's tests failed 2 that were the
   harness's (no commit in the work tree; no binaryen corpus) — fixed in `fea1e9bd6`; 4.1.0's 3
   accepted entries dropped (`accept-4.1.1`, now empty). Full suite: win-x64 gate 31/31; linux-x64
   fresh clone 6794/6794. Merged (`5a187e33c`), pushed unbumped: run 44637169325 green.
3. `bun run bump patch`: floor patch; previous tests 6783, 0 failed, 0 accepted. `bun run release`:
   gate --release **33 / 33** (compatibility: patch); `bump to v4.1.1` (`e77d6fdd1`) pushed, read back.
4. **publish.yml run 44639032099 — RED in its last step only**, as 4.0.0's: version → npm build →
   tag `v4.1.1` (annotated `b381d4bf8`, peels to `e77d6fdd1`) → page by `github-actions[bot]`
   (23:36:59Z) → **JSR 4.1.1, Rekor `4009969936`** → npm: `npm publish` ok (23:37:43Z), then
   "Verify provenance was recorded on npm" timed out at 23:40:30Z; npm showed 4.1.1 at 23:40:50Z
   (~3 min). Read back afterwards: **npm 4.1.1, SLSA provenance v1**; `latest` = 4.1.1 on both.
   "Re-run failed jobs" (owner, web UI) skips the publish and turns it green — **done: GREEN
   (owner, 2026-11-19)**. **Second time: the
   poll window (12 × 15 s) is shorter than npm's lag — fix it before the next release.** Fixed on
   2026-11-20 (branch `npm-provenance-poll`): [publishing.md](publishing.md) § "The provenance read-back".
5. **As a user:** `bun x @synapticforge1/binaryang@4.1.1 --version` → `binaryang 4.1.1`.

### 4.1.0 — a MINOR from `main` (2026-11-19 UTC) — 🚀 PUBLISHED to JSR AND npm, provenance on both

**What changed** (`CHANGELOG.md` § 4.1.0): writing to devices and standard output (`-o NUL` on
Deno on Windows; every Windows device spelling; no `.wit` beside a device; `-o /dev/stdout`,
`/dev/stderr` on every OS; `-o CON` with no console refused by name; with the module on stdout
the report and the minify map go to stderr), and `binaryang --self-check`. Internal: the OS
calls in one module, `src/host.ts` (letter H39).

The owner's go: "release"; level 4.1.0 (owner, 2026-11-19: "I was agreeing to the minor version").

1. **The review set** (H39, Bun memory64, the review line) complete at `decbdb093`; the release
   notes (`9ebc5af62` on `release/4.1.0`) had their own review, which found N-1…N-4 and B-1…B-3
   (owner: "Fix it in 4.1.0", "Fix them in 4.1.0"), fixed on `fix-nul-wit` through re-review 5
   (0 in all five). Full suite at `ae8508b25`: win-x64 gate 31 / 31; linux-x64 fresh WSL clone
   (Bun leg 6783 / 6783 once the gitignored binaryen corpus was copied in, baseline, privacy, spec,
   interp, `--self-check`). Merged (`f37c495c5`, `20e0d0fcc`), pushed unbumped: publish.yml run
   44618931193 green (version only).
2. **`bun run bump minor` refused** (first time since the review check): v4.0.0's tests, 3 failed
   unlisted (they import or grep `src/cli/io.ts`) and 25 entries stale. `accept-4.1.0`
   (`18733943a`) — which changes a test file after the recorded review, so it had re-review 6 (0
   in all five) and `review:record 18733943a` before the merge (`7109de0a9`). The bump then:
   floor minor (`--self-check` added), previous tests 3 failed, 3 accepted.
3. `bun run release`: the review check, `bun run gate --release` **33 / 33** (compatibility: minor;
   privacy since v4.0.0, 47 commit messages), the guards; `bump to v4.1.0` (`1ffb9f125`), `main`
   only pushed, read back.
4. **publish.yml run 44621909375 — GREEN, every job:** version → npm build → tag `v4.1.0`
   (annotated `6894a923b`, peels to `1ffb9f125`, `ls-remote`) → page `binaryang v4.1.0` by
   `github-actions[bot]` (21:46:07Z) → **JSR 4.1.0, Rekor `4007542928`** → **npm 4.1.0, SLSA
   provenance v1** (`registry.ts provenance` passes for both); `latest` = 4.1.0 on both.
5. **As a user:** `bun x @synapticforge1/binaryang@4.1.0 --version` → `binaryang 4.1.0`;
   `deno run -A jsr:@jrmarcum/binaryang@4.1.0 --version` refused by Deno's default minimum
   dependency age, as for 4.0.0 (a fresh version; not ours).

§ 4.0.0 … § 1.5.1 (every release record before 4.1.0, and the 1.5.1 notes on the first tag push and the JSR score): moved to [release-to-4.1.1.md](archive/release-to-4.1.1.md)

## Notes kept from the 1.5.1 record

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
