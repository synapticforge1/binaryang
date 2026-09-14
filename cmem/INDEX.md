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

## Structure: shared core, project wings

Decision 6 settled that `cmem/` merges **by topic**, not by concatenation, with project-specific
wings retained.

|                     |                                                             |
| ------------------- | ----------------------------------------------------------- |
| `cmem/*.md`         | the shared core — merged topics, and binaryang's own record |
| `cmem/binaryen-ts/` | the binaryen-ts wing, as it stood at `73ab06cb627`          |
| `cmem/wabt-ts/`     | the wabt-ts wing, as it stood at `fa9483aa3`                |

**Nothing in the wings is deleted, and nothing in them is edited.** They are the origin record, and
for the merge itself the evidence of what each side knew before the trees became one. A core topic
file supersedes its wing counterparts for day-to-day reading; the wings stay because "it was already
like that" is unfalsifiable once there is no repository boundary left.

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
- ⬚ **The wings** (below) are still under their "never deleted" rule; replacing them with summaries
  is proposed and awaits the owner's explicit decision.

Applied so far: `scope-1.5.2.md` → [phases.md](phases.md) § "1.5.2 and 1.5.3 — the scope,
summarized".

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
| [bridge.md](bridge.md)                 | **The wabt-ts → binaryen-ts translator**, scheduled for deletion by S6: the binding naming rule, its design constraints, the de-coarsening and T13.22 history.                                                                                                                                                                                                     |
| [overview.md](overview.md)             | **The internal picture**: scope (two projects, not three), the six settled decisions, layout and the promotion rule, the convergence indicator, the binding rules.                                                                                                                                                                                                 |
| [phases.md](phases.md)                 | **Delivery status and versions**: why a bare "Phase N" is ambiguous here, what each release carried, the gaps carried from the predecessors.                                                                                                                                                                                                                       |
| [licensing.md](licensing.md)           | MIT-primary with Apache-2.0 alternative; why binaryang inherits BOTH upstreams' §4 obligations; the two JSR rejection conditions.                                                                                                                                                                                                                                  |

### Records — closed, kept as history

| file                                           | what it holds                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [quality-passes.md](quality-passes.md)         | The 1.5.5 code passes 1–7, per-pass findings, and the method that found them: strengthen a metric whose predicate is weaker than its name.                                                  |
| [text-routes.md](text-routes.md)               | The WAT routes into binaryen-ts: the `wasm-opt` defects, the folded-writer ladder 1 → 421/421, the bridge question — closed by W4's routing.                                                |
| [transition.md](transition.md)                 | The merge and retirement ladder, phases A–D, the archive runbook, and the stale-resolution trap. Complete.                                                                                  |
| [pre-merge-register.md](pre-merge-register.md) | **The reconciliation** of both pre-merge registers: four conflicts, the missing pre-merge action, seven findings neither had, the runtime-floor decisions. Read before quoting either wing. |
| [handoffs.md](handoffs.md)                     | Correspondence drafted here and handed over, dated and left as sent. Nothing is ever written into a sibling repo from this one.                                                             |

## The wings

**binaryen-ts** — `architecture.md` · `correctness.md` · `passes.md` · `phases.md` · `overview.md` ·
`publishing.md` · `testing.md` · `INDEX.md` · `handoffs.md` · `best-practices.md` · `bridge.md` ·
`licensing.md` · `binaryang.md` · `binaryang-kickoff.md`

**wabt-ts** — `tasks.md` (7,564 lines; the phase and decision ledger) · `design-decisions.md` ·
`pre-merge-known-issues.md` · `runtime-tooling.md` · `overview.md` · `publishing.md` · `testing.md`
· `INDEX.md` · `best-practices.md` · `bridge.md` · `licensing.md` · `phases.md`

**The wings are historical, not stale** — a distinction worth keeping. They remain the place to look
for per-phase scope, per-invariant test placement, the TS↔C++ porting map, and the conformance
metric tables. What is _stale_ is narrower and named: both wing `overview.md` files still say all
three projects merge, and every test-file path in them uses the dead `foo_test.ts` form.

✅ **§2.2 is complete.** `overview`, `licensing`, `bridge`, `phases`, `testing` and both halves of
`publishing` are merged topic files. Only `best-practices.md` (2,894 / 294) stays split, for the
reason below — a decision, not a backlog item.

---

## Why `best-practices.md` is split rather than rewritten

It is the trap file: 2,894 lines against 294, a 9.8:1 ratio, and a naive merge reads as wabt-ts's
memory with a few binaryen-ts notes appended — quietly losing the smaller project's reasoning.

The instruction from the register inverts the usual framing, and it is the sharpest thing either
side wrote: **do not pick a surviving vantage point.** Both projects independently derived the same
rules — one authoritative enumeration, an exit code is not evidence, a fixture where both readings
pass proves nothing. **For a rule two teams found separately, both origin stories are the
evidence**, and choosing a survivor discards the strongest thing about it.

So the shared `best-practices.md` opens with **only the convergent rules**, each with both
derivations named, and the wings keep their full enumerations, which are long, project-specific, and
lose nothing by staying where they were paid for.

---

## Reading order for someone new

1. This file.
2. [open-work.md](open-work.md) and [working-rules.md](working-rules.md) — where things stand, and
   how work is done.
3. [pre-merge-register.md](pre-merge-register.md) — what was true before the trees became one.
4. The README — the binding naming rule, the runtime floors, and the settled decisions.
5. [ir-convergence.md](ir-convergence.md) — the largest piece of live work.
6. `wabt-ts/tasks.md` when you need the history behind a specific defect; it is the deepest record
   either project kept.
