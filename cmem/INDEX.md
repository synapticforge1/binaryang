# cmem — committed project memory

Project knowledge lives here because `cmem/` survives a clone. Machine-local memory holds only what
is true of the machine.

**Re-derive before quoting any number.** Every figure in these files carries the date it was
measured, not a guarantee. That rule is inherited from both predecessors and it earned itself twice
during the merge: numbers in both pre-merge registers had drifted, and one consumer pin quoted by
both turned out to come from a bug-report document rather than an import map.

---

## Structure: shared core, project wings

Decision 6 settled that `cmem/` merges **by topic**, not by concatenation, with project-specific
wings retained and reassessed as convergence proceeds.

|                     |                                                             |
| ------------------- | ----------------------------------------------------------- |
| `cmem/*.md`         | the shared core — merged topics, and binaryang's own record |
| `cmem/binaryen-ts/` | the binaryen-ts wing, as it stood at `73ab06cb627`          |
| `cmem/wabt-ts/`     | the wabt-ts wing, as it stood at `fa9483aa3`                |

**Nothing in the wings is deleted.** They are the origin record, and for the merge itself they are
the evidence of what each side knew before the trees became one. A merged topic file supersedes its
wing counterparts for day-to-day reading; the wings stay because "it was already like that" is
unfalsifiable once there is no repository boundary left.

---

## The shared core

| file                                           | what it holds                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [pre-merge-register.md](pre-merge-register.md) | **The reconciliation.** Both pre-merge registers as one document: four conflicts (two of them a document contradicting itself), the pre-merge action that was missing from the plan, seven findings present in neither source, every number re-derived, and the runtime-floor and retirement decisions with their reasoning. Read this before quoting anything from either wing.                       |
| [scope-1.5.2.md](scope-1.5.2.md)               | **The 1.5.2 branch scope.** What the break release carries: the de-coarsening the merge was meant to make cheap, the release-script unification, the convergence indicator as a script, and phases C/D. Merging release/1.5.2 to main publishes.                                                                                                                                                       |
| [transition.md](transition.md)                 | **The execution list.** 30 items across four phases and five entities, the version ladder, the four ordering constraints, and the gates.                                                                                                                                                                                                                                                               |
| [open-work.md](open-work.md)                   | **The single list of what is outstanding.** Owner actions, the wasmtk-ranked conformance gaps with current status, repo work, and the outbound handoffs. Kept in one place because a list split across three documents is a list nobody reads. |
| [handoffs.md](handoffs.md)                     | Correspondence drafted here and handed over. Nothing is ever written into a sibling repo from this one.                                                                                                                                                                                                                                                                                                |
| [overview.md](overview.md)                     | **Merged (A16/1.5.2), authored not merged.** The internal picture the README no longer carries: scope, the six settled decisions, the layout and promotion rule, the convergence indicator and its counting rule, and pointers to both binding rules. Both wing overviews are STALE -- each still says three projects merge.                                                                           |
| [licensing.md](licensing.md)                   | **Merged (A16).** MIT-primary with Apache-2.0 alternative; why the merged repo inherits **both** upstreams' §4 obligations; the copyright-line divergence the merge exposed and how it was resolved; the two JSR rejection conditions both sides learned separately.                                                                                                                                   |
| [bridge.md](bridge.md)                         | **Merged (A16).** The boundary between the two IRs — now an internal module rather than a package boundary — and the binding naming rule.                                                                                                                                                                                                                                                              |
| [publishing.md](publishing.md)                 | **Fully merged (A16 + §2.2).** The binding release rule (never bump in the change that merges), the provenance half, the `actorNotScopeMember` root cause behind every failed dispatch publish, and now the release process itself: never publish locally, the flow, the version rule and why `bump` has no minor mode, and the recovery recipes. |
| [best-practices.md](best-practices.md)         | **Merged (A16), convergent rules only.** The rules **both** projects derived independently, each with both origin stories. The full enumerations stay in the wings; see the file for why that split rather than a rewrite.                                                                                                                                                                             |
| [phases.md](phases.md)                         | **Merged (§2.2).** Where binaryang actually is, the shared versioning rule, and the live gaps carried forward. Opens with the hazard that **"Phase N" is ambiguous in this repository** — the two projects' numbers collide, and Phase 8 is shipped EH on one side and an unimplemented stub on the other. |
| [testing.md](testing.md)                       | **Merged (§2.2).** How binaryang is tested, and the testing philosophy both projects reached independently: three states not two, every metric's blind spot, the four tests needing neither corpus nor oracle, and why every test's held-fixed dimension is its next blind spot. |

## The wings

**binaryen-ts** — `architecture.md` · `correctness.md` · `passes.md` · `phases.md` · `overview.md` ·
`publishing.md` · `testing.md` · `INDEX.md` · `handoffs.md` · `best-practices.md` · `bridge.md` ·
`licensing.md` · `binaryang.md` · `binaryang-kickoff.md`

**wabt-ts** — `tasks.md` (7,564 lines; the phase and decision ledger) · `design-decisions.md` ·
`pre-merge-known-issues.md` · `runtime-tooling.md` · `overview.md` · `publishing.md` · `testing.md`
· `INDEX.md` · `best-practices.md` · `bridge.md` · `licensing.md` · `phases.md`

🔓 **Still wing-scoped, deliberately.** `best-practices.md` (2,894 / 294) — and that one is a
decision rather than a backlog item; see below.

✅ **`phases.md`, `testing.md` and `overview.md` are now merged** (§2.2, 2026-08-27). They waited on
§2.1 for a reason that held: they describe a release and QA process, and until `scripts/release/`
existed there were two of those, so a merged document would have described a flow that did not
exist.

**The wings are historical, not stale** — a distinction worth keeping. They remain the place to look
for per-phase scope, per-invariant test placement, the TS↔C++ porting map, and the conformance
metric tables. What is *stale* is narrower and named: both wing `overview.md` files still say all
three projects merge.

- **`best-practices.md`** — see below.

✅ **§2.2 is complete.** `overview`, `licensing`, `bridge`, `phases`, `testing` and both halves of
`publishing` are merged topic files. Only `best-practices.md` stays split, and for a stated reason
rather than for want of effort.

---

## Why `best-practices.md` is split rather than rewritten

It is the trap file: 2,894 lines against 294, a 9.8:1 ratio, and a naive merge reads as wabt-ts's
memory with a few binaryen-ts notes appended — quietly losing the smaller project's reasoning.

The instruction from the register inverts the usual framing, and it is the sharpest thing either
side wrote: **do not pick a surviving vantage point.** Both projects independently derived the same
rules — one authoritative enumeration, an exit code is not evidence, a fixture where both readings
pass proves nothing. **For a rule two teams found separately, both origin stories are the
evidence**, and choosing a survivor discards the strongest thing about it.

So the shared `best-practices.md` holds **only the convergent rules**, each with both derivations
named. The wings keep their full enumerations, which are long, project-specific, and lose nothing by
staying where they were paid for.

---

## Reading order for someone new

1. This file.
2. [pre-merge-register.md](pre-merge-register.md) — what was true before the trees became one.
3. The README — the binding naming rule, the runtime floors, and the settled decisions.
4. [transition.md](transition.md) — where the work stands.
5. `wabt-ts/tasks.md` when you need the history behind a specific defect; it is the deepest record
   either project kept.
