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
- Kept in full even when done: decisions (above all DESIGN rows, now in [divergences-ir.md](divergences-ir.md),
  [divergences-text.md](divergences-text.md) and [divergences-conformance.md](divergences-conformance.md)),
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
- 2026-11-19, DECIDED (owner, letter H38: "I agree with that"): KEEP the copy, unchanged under its
  stamp, in a file of its own — [best-practices-shared.md](best-practices-shared.md). The 28 rules
  are ~10 KB; the size is our own lessons, which follow the guide (archive, split under 25 KB).

## The review set for 4.1.0 (owner, 2026-11-19)

- Owner, asked whether to run one fresh review of v4.0.0..main: "For this we are going to count
  this towards the review set for 4.1.0, since we just made some changes." The set is the review
  of v4.0.0..review-h39 (complete at f1a55034f) and of 7d3a1feee..review-bun (complete at
  d1dfa0856); together they cover every shipped change since 4.0.0. `bun run release` reads the
  review record (below); only `cmem/` changed after it.

## The review record is its own file, written by a script (owner, 2026-11-19, option C)

- The finding: the release read the latest reviewed commit out of the hand-written review notes,
  and three rounds of fixes (H-1, H-2, H-3 in the review of the review-line change) each met a new
  look-alike spelling that made it silently use an OLDER review. Two consecutive re-reviews
  reported it not closed, so options went to the owner (review standard § 9): a broader net,
  the last line of the notes, a separate file, or accepting the risk. Owner: the separate file.
- `bun run review:record <commit>` (`scripts/release/review-record.ts`) resolves the commit and
  writes only its 40-hex hash and a newline, atomically, to the gitignored
  `cmem/local/review-complete`; the release reads those bytes strictly (any other content
  refuses, naming the file). No prose is parsed; the notes' line is a copy nobody reads.

## H39 — test per engine; every OS call in `src/host.ts` (owner, 2026-11-19)

- Owner: "that way we do not over test something"; "yes for host.ts". What binaryang computes
  is tested per engine; OS testing is `host`'s alone ([platforms.md](platforms.md)).
- `src/cli/io.ts` became `src/host.ts` (the workspace's file name for every TS project); the
  boundary is the third check of `scripts/check-portability.ts`, so one gate holds both the
  browser rule and the host rule. It refuses every import form, `import type` included.
- `--self-check` is a root CLI flag (`binaryang --self-check`), not a command: it checks the
  machine, not a module.
- Each step is `ok` or `FAIL`, never skipped (owner, 2026-11-19: "no skips to track"): a symbolic
  link the account may not make is a FAIL that says so (Windows: Developer Mode or an admin).
- A FAIL line prints the raw error, which can name the temp path (owner, 2026-11-19: "as long as
  it is not public facing it is okay"): it reaches only the user's terminal; no doc shows one.

## Bun runs with memory64 on (owner, 2026-11-19)

- Owner: "We want memory64 on always. If they pass with it on, then they are cleared from the
  failure/skip list." JavaScriptCore has memory64 / table64 behind `useWasmMemory64`, off in
  Bun 1.4.4; `scripts/bun-engine.ts` sets `BUN_JSC_useWasmMemory64=1` for every Bun that
  `scripts/test.ts` and `scripts/gate.ts` start. All 24 memory64 / table64 entries cleared.
- Read at Bun's start only: a `.env` file is too late (measured). No JavaScriptCore option
  lifts the 100-memory cap or accepts `delegate` to a block (option list read 2026-11-19).
- Those 10 (owner: "address the rest"): `tests/engine_limits.ts` `refusedFor` — JavaScriptCore
  refusing with EXACTLY its known message, anything else fails; the test then holds the module
  to values the V8 leg checks against the engine (the interpreter, the translated module, or
  binaryang's validator). Never the component under test judging itself. The list is empty.
- No skips in the tests either: each platform skip is that platform's own check (`/dev/null`,
  a case-sensitive `A.WAT`, Windows' read-only attribute, an endless named pipe, Deno from npm).
  What a machine must provide now FAILS when missing, saying how: symbolic links (Windows:
  Developer Mode or admin), not running as root, `chmod` / `icacls`, the `upstream/binaryen` corpus.

## M6 — Apache-2.0 §4(b) and the ported files (owner, 2026-11-18)

- The question (licensing review, n-2): §4(b) asks that MODIFIED files carry a notice that they
  were changed; the 86 ported files say "Ported from" / "Based on", not "modified".
- The owner's answer: "the files were not changed that were rewritten in typescript from the
  orginal c++". The upstream files are not modified: each TypeScript file is a new rewrite that
  keeps its upstream's copyright and licence header and names its source. No "modified" notice.

## M5 — the review standard (2026-11-18)

- The workspace's FINAL review standard (letter H37, `../../workspace/cmem/review-process.md`) replaces
  binaryang's trial rules of 2026-11-15 (one class at a time, nested tiers, frozen scope and
  depth) and the round-4 process.
- The owner's decisions: the review starts from scratch under the new standard; the release
  script refuses unless a completed review is recorded at the commit, then runs every gate
  locally; browser and runtime coverage moves local with CI's tests.
