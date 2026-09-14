# cmem — committed project memory

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

## Structure: one flat core, and a summary per predecessor

Decision 6 settled that `cmem/` merges **by topic**, not by concatenation. Each predecessor brought
a project-specific WING directory as well: `cmem/binaryen-ts/` (14 files, 3,586 lines, as it stood at
`73ab06cb627`) and `cmem/wabt-ts/` (12 files, 13,219 lines, as it stood at `fa9483aa3`).

|                       |                                                                              |
| --------------------- | ---------------------------------------------------------------------------- |
| `cmem/*.md`           | the shared core — merged topics, and binaryang's own record                  |
| `cmem/wabt-ts.md`     | the wabt-ts wing, corrected and summarized (2026-09-14)                      |
| `cmem/binaryen-ts.md` | the binaryen-ts wing, corrected and summarized (2026-09-14)                  |
| `cmem/local/`         | private, gitignored — machine facts only (above)                             |

🔧 **The wings were summarized on 2026-09-14** (owner: "the wing docs get both corrected and
summarized"). Until then they were kept unedited as the origin record — the evidence of what each
side knew before the trees became one. That evidence is intact in git: every wing file is one
`git show 9758fc736:cmem/<wing>/<file>` away, and each summary section names its command.

**Consolidated 2026-09-14** (branch `cmem-consolidation`): machine-local memory moved in,
`open-work.md` cut to open items with its closed history moved to topic files, stale status lines
corrected in place. **Nothing was dropped**, and that was checked rather than asserted: every commit
hash, backticked identifier, measured ratio and quantity in the old core and in memory was
snapshotted first and verified present afterwards, with each deliberate exception listed and
reasoned — and the check was inverted (a mutated copy fails it, naming exactly what was removed).

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

Applied so far, each with its full text at the commit named:

| retired or summarized                                                | now in                                                                                                                               | full text                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `scope-1.5.2.md`                                                     | [project.md](project.md) § "Versions"                                                                                                | `git show cff3284b8:cmem/scope-1.5.2.md`    |
| `overview.md`, `phases.md`, `transition.md`, `pre-merge-register.md` | [project.md](project.md)                                                                                                             | `git show 1672c2a5a:cmem/<file>`            |
| `bridge.md`, `text-routes.md`                                        | [ir-convergence.md](ir-convergence.md) § "The bridge and the WAT routes into binaryen-ts"; binding rules in [project.md](project.md) | `git show 1672c2a5a:cmem/<file>`            |
| `quality-passes.md`                                                  | the plan in [open-work.md](open-work.md); the passes in [testing.md](testing.md)                                                     | `git show 1672c2a5a:cmem/quality-passes.md` |
| `handoffs.md` letters (file kept, as a log)                          | [handoffs.md](handoffs.md)                                                                                                           | `git show 1672c2a5a:cmem/handoffs.md`       |
| `divergences.md` N1 and parity prose, the X1 record                  | [names.md](names.md), [testing.md](testing.md), a summary in place                                                                   | `git show 1672c2a5a:cmem/divergences.md`    |
| the wabt-ts wing, `cmem/wabt-ts/` (12 files)                         | [wabt-ts.md](wabt-ts.md)                                                                                                             | `git show 9758fc736:cmem/wabt-ts/<file>`     |
| the binaryen-ts wing, `cmem/binaryen-ts/` (14 files)                 | [binaryen-ts.md](binaryen-ts.md)                                                                                                     | `git show 9758fc736:cmem/binaryen-ts/<file>` |

---

## The shared core

### Live — read these to act

| file                                   | what it holds                                                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [open-work.md](open-work.md)           | **What is outstanding**, and nothing else: owner actions, the IR convergence's next steps, open defects and follow-ups, conformance gaps, the wasmtk thread. Each item points at its record.                                                   |
| [working-rules.md](working-rules.md)   | **The owner's standing rules for every increment**: branch → `merge --no-ff`, messages by file, nothing pushed, the version stays; CI's gate on the committed tree by exit code; rebuilding the spec corpus; installed oracles; sibling repos. |
| [unreleased.md](unreleased.md)         | **Everything on `main` since 1.5.4 that a release note must say** — API-visible IR and tool changes, byte-moving behaviour changes, silent correctness fixes.                                                                                  |
| [ir-convergence.md](ir-convergence.md) | **The IR convergence, S1–S7**: one tree, two verb sets. Status at the top, the worst-condition method, every stage's measurements and decisions (including the K3 scoping), and a merge log generated from git.                                |
| [divergences.md](divergences.md)       | **Every divergence from upstream wabt and binaryen, classified** — FEATURE, DESIGN, ORACLE GAP, DEFECT. Read BEFORE refactoring, optimizing, or porting an upstream pass: a faithful port can silently undo a DESIGN row.                      |
| `local/environment.md` 🔒              | **This machine and disk — PRIVATE, gitignored, absent in a clone**: `safe.directory` on `D:`, the repack failure that grows `.git`, CRLF checkouts, the `python` Store stub that hangs, Deno quirks.                                           |

### Topics — how things work and why

| file                                   | what it holds                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [best-practices.md](best-practices.md) | **The rules paid for** — first the convergent rules both predecessors derived independently (each with both origin stories), then every rule binaryang paid for since: the eight silent breaks of a field change, make the defect unrepresentable, the local gate must be CI's, results attributed to the property in view, a written result is a claim, and more. |
| [testing.md](testing.md)               | **How binaryang is tested**: the gates and what each can see, the corpora, the convergent philosophy (three states, every metric's blind spot), independent oracles, the spec-testsuite harness and its must-reject axis, A3's diagnostic offsets.                                                                                                                 |
| [publishing.md](publishing.md)         | **Provenance and the release process**: never bump in the change that merges, provenance fails silently, the `actorNotScopeMember` root cause and `RELEASE_PAT`, never publish locally, recovery recipes, 1.5.4's unaided tag push.                                                                                                                                |
| [names.md](names.md)                   | **N1 — internal names**: 63,930 in the corpus, the owner's rules, per-kind and per-hop measurements, the six steps as built, `wasm-tools` as the label oracle.                                                                                                                                                                                                     |
| [project.md](project.md)               | **What binaryang is and what was decided**: scope, the settled and pre-merge decisions (export map, clean break, runtime floors), layout and the promotion rule, the binding rules (reserved names, import aliases, layered portability), the convergence indicator, versions 1.5.1–1.5.4, and summaries of the retirement and the merge.                          |
| [licensing.md](licensing.md)           | MIT-primary with Apache-2.0 alternative; why binaryang inherits BOTH upstreams' §4 obligations; the two JSR rejection conditions.                                                                                                                                                                                                                                  |
| [handoffs.md](handoffs.md)             | **Correspondence with the sibling repos** — the live convention (never write into a sibling; draft here), a log of every letter with its outcome, and the lessons found only there. New drafts go at its end.                                                                                                                                                      |

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
