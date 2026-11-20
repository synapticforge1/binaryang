# Working rules — how an increment is done here

Summary: the owner's standing rules for git, commits and releases, sibling repositories, the owner commands and the session routine. Last verified 2026-11-20.
Other rule files: [working-rules-gate.md](working-rules-gate.md) (the gate),
[working-rules-records.md](working-rules-records.md) (tests, records, privacy, reviews),
[working-rules-tools.md](working-rules-tools.md) (tools, scripts, installed oracles).

The owner's standing rules, held across the S6 run. Each was set or reaffirmed after a real slip.
Until 2026-09-14 they lived only in machine-local memory; they moved here because a rule that does
not survive a clone is not a project rule. The lessons behind them are in
[best-practices.md](best-practices.md); this file is the checklist.

## Git

- **Branch, commit, then `git merge --no-ff` to `main`.** Never commit directly to `main` — two
  docs-only commits did, and the owner had the history REWRITTEN so it would be uniform. Docs-only
  changes follow the same rule.
- **Workflow logic is TypeScript too** (owner, 2026-10-21): a GitHub workflow `run:` block only
  launches; any condition, loop or poll is a subcommand of `scripts/release/workflow.ts` (or a
  script like it: `registry.ts`, `github.ts`), tested in
  `tests/wabt-ts/scripts/workflow_steps.test.ts`.
- 🔒 **The publishing credential sits beside nothing** (owner, 2026-11-09: "restructure the
  publish workflow"; open-work 54, C30 / C34). In `publish.yml` only `jsr` and `npm` hold
  `id-token: write`; they run pinned actions, `deno publish` / `npm publish`, and the standalone
  `scripts/release/registry.ts` — a sparse checkout without a stored credential, nothing
  installed. Anything that runs a dependency goes in `checks` or `npm-build`. Every action is
  pinned to a commit hash. `publish_preflight_wiring.test.ts` holds this; a change it refuses is
  a design question, not a test to loosen ([publishing.md](publishing.md) § "The publish
  workflow's jobs").
- **Rehearse a changed release job exactly, before it lands** (3.0.0 → 3.0.2, 2026-11-09: two
  versions spent on two defects only GitHub saw). A re-run runs the workflow and scripts of the
  commit that STARTED the run — the bump commit since D1 (2026-11-10; the tag's, while a tag
  started it) — so a release-job bug costs a version. Run the job's own commands, with the
  outputs one step hands the next, in a fresh folder laid out as the runner's (no folder made by
  hand, no path typed by hand); for npm, a dry-run `npm publish` of the exact path `registry.ts`
  outputs. 🔁 2026-11-13 (review round 1): this said "the TAG's workflow" and "a plain command
  sequence (tag and push) stays in the workflow" — both from before D1; CI's tag is
  `github.ts tag`, a tested script.
- 🔒 **No `gh` — not here, not in CI** (owner, 2026-11-08, workspace letter H30 /
  `../workspace/cmem/tooling-rules.md` rule 9: "just checking the repo is easier"; "yes change
  those"). The GitHub CLI is not installed and will not be. Check the repo instead: `git
  ls-remote origin` against `origin/*`, `git fetch`, a registry's public API. A workflow writes
  to GitHub through the REST API with its own `GITHUB_TOKEN` from a Bun step —
  `scripts/release/github.ts` (`tag`, `release`; `dispatch` until 2026-11-10), mock-API tested in
  `workflow_steps.test.ts` (since 2026-11-09). A task only GitHub's web UI can do is an OWNER item,
  never "blocked on gh".
- 🔒 **The release order is the owner's (2026-11-10, workspace letter H33, D1): "the CI to check
  first, then push the tag, and then create the release page from the tag, then publish the
  package to the registry".** `bun run release` pushes `main` ONLY — no tag is made, forced or
  pushed from a machine, ever; publish.yml runs on that push: `checks` → `tag` (CI's annotated
  tag, REST) → `release` (the page) → `jsr` / `npm`, one run. `auto-tag.yml` is retired.
  `publish_preflight_wiring.test.ts` holds the order. [release.md](release.md) § "How a release
  is made".
- 🔒 **Every Release page is made by CI** (owner, 2026-11-09, letter H32): publish.yml's
  `release` job, FROM CI's tag and BEFORE the publish (D1; after the registry upload until
  2026-11-10), `contents: write` only, checking out nothing but its script and `jsr.json`; tag on
  GitHub and peeling to `github.sha` first, an existing page is done, then create and read back.
  Never by hand. Only tags cut after the job landed get a page (owner: no backfill).
- 🔒 **Every release is recorded in ONE place** (owner, 2026-11-10, H33 D3):
  [release.md](release.md) § "Release History", newest first, each version with a summary of what
  changed, its run id and read-backs.
- **Messages go through a file**: `git commit -F <file>` and `git merge --no-ff -F <file>`. Write
  the file with a file-writing tool, never a heredoc or a double-quoted `-m` (see "Do not author
  file CONTENT through a shell heredoc" in [best-practices.md](best-practices.md), which lists all
  four ways a tool here corrupts literal text). ⚠️ `-F -` does not read stdin here.
- 🔒 **Helper scripts are TypeScript, run with `bun` — never Python** (owner, 2026-11-19: "why is
  the python script not a typescript script?"), throwaway scratch edits and probes included; for
  an edit, the Edit tool first. 🔧 Python helpers cost three failed attempts that day: the Windows
  `py` launcher ran a bash shebang instead of the edit, and Python inside a heredoc broke regexes.
- **End every message with the attribution line** the session supplies (`Co-Authored-By: …`).
- **Commits are authored with the owner's GitHub noreply address**, set as this clone's LOCAL
  `user.email` (2026-10-22, letter H19; the history was purged of the personal address that
  day — [publishing.md](publishing.md) § "The history purge"). A fresh clone needs it set again
  before its first commit: `git config --local user.email` must print the noreply address.
  (Since 2026-10-26 the workspace also allows the maintainer address on commits — § Records'
  exception; this repo keeps noreply, which the rule leaves as it is.)
- **Never push from a clone made before 2026-10-22** (wasmtk's `upstream/binaryang`, old scratch
  clones): it carries the pre-purge history and would publish it again. Re-clone.
- **Prefer a new commit over `--amend`.**
- **Nothing is pushed** unless the owner says so.
- **A push that is not a release does not wait for GitHub CI** (owner, 2026-10-13: "If we are not
  pushing for a release, all we need to do is make sure the commit is on github and recorded as
  such"). Push, confirm the remote has the commit (`git fetch` then `origin/main` equals `HEAD`),
  record it, move on: the local gate already ran on the committed tree. Wait for CI only for a
  RELEASE (unbumped `main` green, then `publish.yml`; [publishing.md](publishing.md)) or when CI
  itself is what is being fixed (the Linux-only Browsers job, 2026-10-13). 🔧 Before this, every
  push waited out a CI run, ~10 minutes each.
- **`jsr.json` stays at the released version** — the package manifest since B1 of the Bun
  migration (2026-10-12, [bun-migration.md](bun-migration.md)); `deno.json` before that, and
  `deno.json` is gone since B7 (2026-10-13), so `deno publish` reads `jsr.json` by itself (read
  the version there, and the latest release at the top of [release.md](release.md) § "Release
  History" — a number quoted here went stale for two weeks). The version line is what ARMS a
  release — publish.yml releases whenever a push of `main` carries a version with no tag (until
  2026-11-10 `auto-tag` did). See [release.md](release.md); the unreleased changes waiting for it
  are in [unreleased.md](unreleased.md).
- **Docs and memory land in the SAME commit as the code they describe** (workspace floor,
  `../workspace/cmem/working-rules.md` § Git, adopted here 2026-10-22, owner: "yes"): the cmem record,
  `unreleased.md` and `CHANGELOG.md` § Unreleased lines for a change go in that change's commit,
  not on a docs branch after it ("a doc pass scheduled after the release is a doc pass that does
  not happen"). 🔧 Until then each open-work 31 step merged its code first and its record on a
  second branch (step 16: `540e18090`, then `a823117de`). A record of something that happened
  AFTER the commit — a release's publish, CI's verdict, a measurement taken later — is its own
  commit, as before.
- **A re-baseline goes in its OWN commit**:
  `bun scripts/wabt-ts/verify-baseline.ts --write`, with the reason in the message.

§ "The gate — on the COMMITTED tree, reading every EXIT CODE": moved to [working-rules-gate.md](working-rules-gate.md).
§ "Tests, measurements and records" (cited as § Records): moved to [working-rules-records.md](working-rules-records.md).
§ "Tools", § "Installed oracles": moved to [working-rules-tools.md](working-rules-tools.md).

## Sibling repositories

All four repos — `binaryang`, the archived `binaryen-ts` and `wabt-ts`, and `wasmtk` — are siblings
in one parent directory (its absolute path is in the private `cmem/local/environment.md`).

- **Nothing is ever written into a sibling repo from this one.** Draft the note in
  [handoffs.md](handoffs.md) and hand it over; fixes land in the repo that owns the file. During a
  merge the habit of respecting repo boundaries is the first thing to erode.
- **The one exception: an answer to a workspace letter** (letters H41, H42, 2026-11-19): append one
  bullet under `## Answers` in `../workspace/cmem/letters/<ID>.md` — never its status or index line.
  The workspace session commits it. That repo is PUBLIC: no machine paths, credentials or personal facts.
- **Verify a sibling from a scratch COPY**, because `deno` writes `deno.lock` in whatever directory
  it runs in.
- **A sibling may vendor YOUR source.** wasmtk carries `upstream/binaryang/`; measuring "what does
  the consumer use" across its tree counted our own code as theirs and nearly forced a needless
  major version. Exclude vendor directories first.
- **The predecessors are FROZEN** (owner, 2026-09-02): no further change to the `binaryen-ts` or
  `wabt-ts` GitHub repos or JSR packages. Do not re-open their descriptions. The freeze does not
  cover binaryang.

## Owner commands: "commit", "push", "release" (owner, 2026-11-10)

🔒 Written into every project by the workspace session on the owner's direction (2026-11-10:
"please write that into each project"; workspace `cmem/working-rules.md` Tooling rule 12, letter
H34). When the owner says:

- **"commit"** — first run "update the project memory files" (re-derive this repo's `cmem/` from
  its current state), then commit to the branch being worked on. Nothing is pushed.
- **"push"** — perform "commit", then merge the branch into `main`, then push `main` (and the
  working branch) to GitHub (`origin`) and read it back with `git ls-remote`.
- **"release"** — perform "push", then the release process: the workspace's
  `cmem/release-process.md` §§ 5–8 as amended 2026-11-17 — the checks run LOCALLY first
  (`bun run release`: a completed review recorded, then `bun run gate --release`), then CI
  verifies the version, pushes the tag, makes the GitHub Release page from the tag and publishes
  to the registries, skipping a version already published — recorded in `cmem/release.md`
  § "Release History" (newest first, a summary of what changed). The level (patch / minor /
  major) is the owner's: ask if it was not given.

Each command includes the one before it, and none goes further than its own word (a "commit"
never pushes, a "push" never releases). This repo's own gate and merge rules apply at each step.

**The review words** (owner, 2026-11-17; letter H37, `../../workspace/cmem/review-process.md` § 1):

- **"review"** — all five required classes, in order: basic, hardening, licensing, security,
  privacy; the loop of § 9 until a re-review is empty, then the full suite once per platform.
- **"basic review"**, **"hardening review"**, **"licensing review"**, **"security review"**,
  **"privacy review"** — the same loop for that one class.
- **"efficiency review"** — OPTIONAL, never blocks a release; when run, it runs BEFORE the five.

## Session routine and memory (workspace memory guide, letter H38)

- **Start:** read `cmem/STATE.md`, then `cmem/INDEX.md` (a router), then the workspace index
  `../workspace/cmem/workspace-correspondence.md` (letters H41, H42) and the items addressed to
  binaryang in `../workspace/cmem/letters/`; open only the files STATE's "Read next" or the task names.
- **End:** rewrite `cmem/STATE.md` (counts only, no issue content, no machine facts); move items
  closed this session to `cmem/archive/`; record decisions in `design-decisions.md` and rules
  here; run `bun scripts/check-cmem.ts` and fix what it reports.
- **Sub-agents:** a reviewer gets its brief and `STATE.md` and does not browse `cmem/`; any other
  sub-agent gets the task and the exact files picked from the index.
- 🔒 **Scratch space is bounded and cleaned by the session that used it** (letter H43, Tooling
  rule 15 in `../workspace/cmem/tooling-rules.md`; owner: "It can't be an unbounded storage
  space"). Throwaway files go in the session's own scratchpad only, never its path in a tracked
  file. Budget 200 MB: say so before anything larger, remove it when its step is done. Delete when
  the item clears — a script after its run, a probe when its finding is verified, a reviewer's
  folder at triage. Nothing lives only in scratch. **"commit" ends with an empty scratchpad.**
  binaryang's own temp use, in the system temp, is bounded the same way: tests remove their
  folders (review Q-H1); `bun run gate --keep` corpora are removed once their run is used.
  Project notes go in `cmem/`, never the assistant's per-project memory folder (it is empty).
- **Limits** (held by the check): INDEX 3 KB, STATE 60 lines, any other live note 25 KB, any line
  outside a code block 200 characters; `archive/` and `local/` unlimited. The guide's migration
  steps 4–6 are done (2026-11-20: closed items and history to `archive/`, files split by subject,
  wide tables to lists and long lines wrapped).

## Triggers (the workspace's, as binaryang reads them)

1. **"update the project memory"** — revise the matching topic file and its index line, with
   absolute dates, updating rather than duplicating; then grep the old values across `cmem/`,
   `README.md` and `CHANGELOG.md`, and measure when two files disagree.
2. **"look for code issues"** — audit tested and untested paths for workarounds, dead code, bugs
   and silent fall-throughs; report `file:line` and severity; judge by OUTPUT, not exit codes.
3. **"coordinate"** — with a sibling, by letter only ([handoffs.md](handoffs.md)): read its
   record, verify by running its tools, record in our own memory; never write its tree.
