# design-decisions.md — decisions, and how a rule changed

Summary: decisions and their reasons that are not a standing rule (rules are in
[working-rules.md](working-rules.md)). Created 2026-11-18 from the history `INDEX.md` held (memory
guide, letter H38, step 2). Last verified 2026-11-18.

## M1 — the memory's structure (2026-09-14)

- Decision 6: `cmem/` merges BY TOPIC, not by concatenation.
- Each predecessor brought a wing: `cmem/binaryen-ts/` (14 files, 3,586 lines, at `b8b18073916`) and
  `cmem/wabt-ts/` (12 files, 13,219 lines, at `5d488e4bc`).
- The wings are summarized as [wabt-ts.md](wabt-ts.md) and [binaryen-ts.md](binaryen-ts.md); the
  shared core is `cmem/*.md`.
- Every retired or summarized file, where it went, and its `git show`: [project.md](project.md)
  § "Memory: what was retired, and where it went".
- §2.2 is complete: `overview` and `phases` became project.md, `bridge` a summary in
  [ir-convergence.md](ir-convergence.md); licensing, testing and publishing kept their names.

## M2 — all project memory in `cmem/` (owner, 2026-09-14)

- Until 2026-09-14 machine-local memory held what is true of the machine.
- The owner changed it so there is one place to look, and `cmem/` survives a clone.
- Machine-local memory, where it exists, only points here; machine facts go in `cmem/local/`.
- Owner, 2026-11-15: all project information stays in the project folder, for portability.

## M3 — the cleanup policy (owner, 2026-09-14)

- cmem is working memory; git is the archive. "Nothing is deleted" was retired for the core.
- Completed work was SUMMARIZED, with a `git show <commit>:<path>` pointer to the full text.
- Kept in full even when done: decisions (above all DESIGN rows in [divergences.md](divergences.md)),
  recurring lessons, conditional risks with their trigger, baselines, corrections of beliefs.
- Correct while summarizing: paths rewritten to today's tree; stale claims marked as corrections.
- 2026-11-17: the memory guide (letter H38) moves closed items to `cmem/archive/`, grouped by
  release, IDs kept — in place of summarizing them away.

## M4 — why `best-practices.md` is split, not rewritten

- The trap file: 2,894 lines against 294 at the merge (9.8 : 1); a naive merge reads as wabt-ts's
  memory with a few binaryen-ts notes appended, losing the smaller project's reasoning.
- For a rule two teams found separately, both origin stories are the evidence: do not pick a
  surviving vantage point.
- So the shared file opens with only the CONVERGENT rules, each with both derivations named; the
  rules that did not converge are in [wabt-ts.md](wabt-ts.md) and [binaryen-ts.md](binaryen-ts.md).
- 2026-11-17: the ★ best-practices copy is held for the owner's answer (letter H38): not split.

## M5 — the review standard (2026-11-18)

- The workspace's FINAL review standard (letter H37, `../../cmem/review-process.md`) replaces
  binaryang's trial rules of 2026-11-15 (one class at a time, nested tiers, frozen scope and
  depth) and the round-4 process.
- The owner's decisions: the review starts from scratch under the new standard; the release
  script refuses unless a completed review is recorded at the commit, then runs every gate
  locally; browser and runtime coverage moves local with CI's tests.
