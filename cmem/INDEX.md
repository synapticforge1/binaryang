# cmem — committed project memory

> **At session start, read `../../cmem/handoffs.md` for letters addressed to this repo.** The workspace
> session (`../../cmem/INDEX.md`) reviews across the sibling repos and reports there; nothing is ever
> written into this repo from outside. (owner directive, 2026-09-20)

**All project memory lives here**, because `cmem/` survives a clone. 🔧 Until 2026-09-14 the rule
was that machine-local memory held what is true of the machine; the owner changed it so there is one
place to look. Machine-local memory, where it exists, only points here.

🔒 **`cmem/local/` is PRIVATE and gitignored** (owner, 2026-09-14): facts about the development
machine — local paths, account names — live in `cmem/local/environment.md`, which is never committed
because this repo is pushed to GitHub. It exists only on that machine; a clone does not have it.
**Never put a path, account name, token or secret in a committed cmem file** — it goes in
`cmem/local/`, or nowhere.

**Re-derive before quoting any number.** Every figure in these files carries the date it was
measured, not a guarantee. That rule is inherited from both predecessors and has earned itself
repeatedly: numbers in both pre-merge registers had drifted, a count was cited for eight days after
it went stale, and three commit messages on `main` stated results their own diffs contradicted
([best-practices.md](best-practices.md) § "A written result is a CLAIM").

---

## Start here

1. **[open-work.md](open-work.md)** — the single list of what is outstanding. Only open items.
2. **[working-rules.md](working-rules.md)** — how an increment is done: git flow, the gate, tools.
3. **[unreleased.md](unreleased.md)** — what is on `main` and must go in the next release note.
4. The topic file the open item points at.

## Triggers

Binding here as in every repo of the workspace (`../../cmem/INDEX.md` § Triggers, where they are
defined in full; this is binaryang's reading of them):

1. **"update the project memory"** — revise the matching topic file and its line in the tables
   below, absolute dates, update rather than duplicate; then AUDIT: grep the old values across
   `cmem/`, `README.md` and `CHANGELOG.md`, and measure when two files disagree.
2. **"look for code issues"** — audit tested AND untested paths for workarounds, dead code, bugs and
   silent fall-throughs; report `file:line` and severity; fix the safe ones in their own commits;
   judge by OUTPUT, not exit codes ([hardening.md](hardening.md) § the code lens).
3. **"coordinate"** — with a sibling, by letter only ([handoffs.md](handoffs.md)): read its record,
   verify by running its tools, record in our own memory; never write its tree.

## Structure: one flat core, and a summary per predecessor

Decision 6 settled that `cmem/` merges **by topic**, not by concatenation. Each predecessor brought
a project-specific WING directory as well: `cmem/binaryen-ts/` (14 files, 3,586 lines, as it stood at
`b8b18073916`) and `cmem/wabt-ts/` (12 files, 13,219 lines, as it stood at `5d488e4bc`).

|                       |                                                                              |
| --------------------- | ---------------------------------------------------------------------------- |
| `cmem/*.md`           | the shared core — merged topics, and binaryang's own record                  |
| `cmem/wabt-ts.md`     | the wabt-ts wing, corrected and summarized (2026-09-14)                      |
| `cmem/binaryen-ts.md` | the binaryen-ts wing, corrected and summarized (2026-09-14)                  |
| `cmem/local/`         | private, gitignored — machine facts only (above)                             |

The history of the memory itself — the wings summarized, the 2026-09-14 consolidation, and a table
of every retired or summarized file with where it went and its `git show` — is in
[project.md](project.md) § "Memory: what was retired, and where it went".

## Cleanup policy — summarize completed work, keep what ongoing work needs (owner, 2026-09-14)

**cmem is working memory, not an archive; git is the archive.** "Nothing is deleted" was retired as
a practice for the shared core: it made every closed item cost every future reader. Detail removed
from cmem stays recoverable through commits, merge messages and `git log -S`.

- **Completed work is SUMMARIZED**: what landed, the commits and tags it landed in, where its
  substance now lives, and any lesson found nowhere else — plus a `git show <commit>:<path>` pointer
  to the full text it replaces. **A summary without a commit pointer is a loss**, not a summary.
- **Kept in full, even when the work is done:** decisions and their reasons (above all DESIGN rows
  in [divergences.md](divergences.md) — they stop a refactor or an upstream port silently undoing
  them); recurring lessons, as a rule plus one instance; conditional risks with their trigger ("the
  day X, these become exposed"); measurements later work compares against (gate expectations,
  baselines); corrections of beliefs someone could re-derive wrongly.
- **Dropped to the summary:** blow-by-blow narratives of finished stages, superseded intermediate
  counts, retellings of one event across files, completed runbooks, closed correspondence.
- **Check it, do not assert it:** every removed section maps to a summary with a commit pointer, and
  no decision, DESIGN row, open item or trigger is among what was removed.
- **Correct while summarizing.** A summary that carries a stale claim forward is worse than the full
  text, because it looks current: paths are rewritten to today's tree and checked, claims the code
  has overtaken are marked as corrections, and anything found still open is verified in the code and
  moved to [open-work.md](open-work.md).

---

## The shared core

### Live — read these to act

| file | what it holds |
| --- | --- |
| [open-work.md](open-work.md) | **What is outstanding**, and nothing else: one numbered list, each item pointing at its record; the one current state line |
| [working-rules.md](working-rules.md) | **The owner's standing rules**: git flow, messages by file, nothing pushed, the gate on the committed tree, tools, records |
| [unreleased.md](unreleased.md) | **What a release note must say** for everything on `main` since the last release, and how to classify an entry |
| [divergences.md](divergences.md) | **Every divergence from upstream and from engines, classified** — read BEFORE refactoring, optimizing or porting a pass |
| [portability.md](portability.md) | **One profile every widely used engine runs** (open-work 34, closed): the owner's decisions, the engine and version floor, passes 1–3, the lowerings, the target and D4, the committed probe (`bun run probe`; tail calls portable) |
| [ir-convergence.md](ir-convergence.md) | **The IR convergence, S1–S7 and One front end**: one tree, two verb sets; status at the top; the merge log |
| [../docs/ir-map.html](../docs/ir-map.html) | **The IR's layout as a page**, for this repo and its siblings (a snapshot at `f42ae3484`; update it when `src/ir` changes) |
| `local/environment.md` 🔒 | **This machine — PRIVATE, gitignored, absent in a clone**: the exFAT disk, git and Bun quirks, oracles, scratch scripts |

### Topics — how things work and why

| file | what it holds |
| --- | --- |
| [best-practices.md](best-practices.md) | **The rules paid for**: the convergent rules (both origin stories), the workspace's ★ rules and checklist (stamped copies), then binaryang's own |
| [testing.md](testing.md) | **How binaryang is tested**: the gates and what each can see, the corpora, the oracles, the spec-testsuite harness |
| [publishing.md](publishing.md) | **Releases and provenance**: the settled release pattern (read first), the history purge, one section per release, newest first |
| [definitions.md](definitions.md) | **`./definitions` (D1–D4)**: what shipped, the decisions, the proof; every D1 opcode attested by the specification, checked in CI (`spec_opcodes.test.ts`); D2's `requires` (recorded only) and `presets`; `return_call_ref` (items 40–41) |
| [optimizer.md](optimizer.md) | **The optimizer against upstream `wasm-opt`** (items 2, 30, 31): every step with its commit and numbers, the instruments, the lessons |
| [hardening.md](hardening.md) | **The hardening round** (item 13): the contract, the instruments, passes 1–2, the hang check, the code lens pass 1 |
| [interpreter.md](interpreter.md) | **The interpreter, evaluator, `wasm-ctor-eval`, `wasm-interp`** (item 23): per stage, the gate, the measurements |
| [run-everywhere.md](run-everywhere.md) | **"Runs everywhere"** (item 28): what holds each claim in CI, the browser recipe, the record |
| [bundle.md](bundle.md) | **`wasm-bundle`** (item 24): one memory relocated exactly through the Linking format; the rules, decisions, gaps |
| [names.md](names.md) | **N1 — internal names**: the owner's rules, the measurements, the steps as built |
| [one-tree.md](one-tree.md) | **One `src/` tree, one IR subpath** (item 21): the phases, the `Type` / `ExprType` decision, what the gate found |
| [bun-migration.md](bun-migration.md) | **Deno → Bun, JSR kept** (item 26): steps B1–B7, the Bun-and-Node decision, the engine oracle (the V8 referee) |
| [jsr-deno-exit-guide.md](jsr-deno-exit-guide.md) | **For the OTHER `@jrmarcum` JSR packages**: the findings that carry over, the steps, what binaryang built to copy |
| [project.md](project.md) | **What binaryang is and what was decided**: scope, decisions, runtime floors, binding rules, reserved subpaths, versions |
| [licensing.md](licensing.md) | **MIT-primary, Apache-2.0 alternative**: both upstreams' §4 obligations, the attribution rules and which files carry them |
| [handoffs.md](handoffs.md) | **Correspondence with the siblings**: the convention, every letter with its outcome, the workspace letters' outcomes |

### The predecessors — look up an ID, an invariant or a test here

| file                               | what it holds                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [wabt-ts.md](wabt-ts.md)           | **The wabt-ts wing, summarized.** The T-id index (every T-id code, tests or commits cite) and UP-n; the invariants a refactor or port must not undo, each with its test; the method rules and recurring root causes; conformance metrics at campaign close; invariant → test placement; the TS ↔ C++ map; the audit definition. |
| [binaryen-ts.md](binaryen-ts.md)   | **The binaryen-ts wing, summarized.** The fail-loud contract; UP-n / WT-n index; pass-authoring invariants (walk API, label references, reachability roots, EH-aware CFG, Inlining, the Asyncify ABI); per-subsystem design; TranslateEH's scoping; rules S6 superseded, named so nobody ports them back.                  |

✅ **§2.2 is complete.** Every topic both wings carried is merged in the core — `overview` and
`phases` now as [project.md](project.md), `bridge` as a summary in
[ir-convergence.md](ir-convergence.md), and `licensing`, `testing` and both halves of `publishing`
under their own names. Only `best-practices.md` stayed split, for the reason below — a decision,
not a backlog item — and the unconverged half now lives in the two summaries.

---

## Why `best-practices.md` is split rather than rewritten

It is the trap file: 2,894 lines against 294 at the merge (a 9.8:1 ratio; wabt-ts's was 2,638 when
summarized), and a naive merge reads as wabt-ts's
memory with a few binaryen-ts notes appended — quietly losing the smaller project's reasoning.

The instruction from the register inverts the usual framing, and it is the sharpest thing either
side wrote: **do not pick a surviving vantage point.** Both projects independently derived the same
rules — one authoritative enumeration, an exit code is not evidence, a fixture where both readings
pass proves nothing. **For a rule two teams found separately, both origin stories are the
evidence**, and choosing a survivor discards the strongest thing about it.

So the shared `best-practices.md` opens with **only the convergent rules**, each with both
derivations named. The rules that did not converge are kept in [wabt-ts.md](wabt-ts.md) and
[binaryen-ts.md](binaryen-ts.md) — one rule and one citing incident each — with the full
enumerations one `git show` away.

---

## Reading order for someone new

1. This file.
2. [open-work.md](open-work.md) and [working-rules.md](working-rules.md) — where things stand, and
   how work is done.
3. [project.md](project.md) — what binaryang is, what was decided and why, and how it got here.
4. The README — the user-facing surface: subpaths, the runtime floors, migrating.
5. [ir-convergence.md](ir-convergence.md) — the largest piece of live work.
6. [wabt-ts.md](wabt-ts.md) and [binaryen-ts.md](binaryen-ts.md) when code, a test or a commit
   cites a T-id, UP-n, WT-n or a named bug — the indexes are there, with the command for each full
   text.
