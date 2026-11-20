# Archive: binaryen-ts.md closed sections, to 4.1.1

This holds the closed sections of binaryen-ts.md (the predecessor wing files handoffs, licensing, binaryang and binaryang-kickoff: letters answered, licence rules now in licensing.md, merge plan and kickoff executed), moved verbatim from `cmem/binaryen-ts.md` on 2026-11-20 (H38 step 4). Read it only when asked.

## `binaryen-ts/handoffs.md` (163 lines) — two letters to wabt-ts, 2026-08-25

(1) "Multi-value blocks fixed; `dest` changed meaning" (pre-release); (2) "v1.5.0 live; T13.22 actionable". Both were
answered, and T13.22 closed at `15cce7426`.
**Kept:** nothing beyond the bridge.md items.
**Already in the core:** the no-writes-into-siblings convention → cmem/handoffs.md.
**History:** letter 2 retracted "1.5.0 cannot ship alone" and the `$__exn_tag` claim, since wasic emits legacy `try`
and `delegate` is the operative case.
Full text: `git show 62c65a9db:cmem/binaryen-ts/handoffs.md`

## `binaryen-ts/licensing.md` (40 lines) — JSR licence rules

**Already in the core, entirely** → cmem/licensing.md: single SPDX, full-text `LICENSE`, bonus files, Phase 11's 352
JSDoc errors, `makeConst` in JSDoc. The core's layout (wabt-ts's copyright pair, `NOTICE.md`) supersedes this one.
Full text: `git show 62c65a9db:cmem/binaryen-ts/licensing.md`

## `binaryen-ts/binaryang.md` (155 lines) — the merge plan, 2026-08-25

All of it landed, and the core records it.
**Kept:**
- [baseline] **Pre-merge sizes, binaryen-ts / wabt-ts:** `src/` 23,256 / 31,344 LOC (38 files each); tests 513 in 37
  files / 393 in 130; subpaths 11 / 8. 21 tracked paths collided (`deno.json`, lock, 3 workflows, `.gitignore`,
  README, 3 licences, 8 cmem files, 3 release scripts).
- [lesson] **"No `src/` file name collides" was true and the wrong measure**: the build-and-ship paths collided.
**Already in the core:** decisions, history recipe, layout, narrow root → cmem/project.md § "Settled decisions";
promotion → § "Layout and the promotion rule"; 56 collisions → § "The convergence indicator"; the cmem 10:1 trap →
cmem/best-practices.md § "Why this file is a selection…".
**History:** planning retracted "drop the `-ts`"; wabt-ts had 8 subpaths, not 5; 4 `src/` dirs collided, not 5.
Full text: `git show 62c65a9db:cmem/binaryen-ts/binaryang.md`

## `binaryen-ts/binaryang-kickoff.md` (138 lines) — the brief handed to the merge team

Steps 0–6 and the gates were executed. Step 0 (safe.directory) → `cmem/local/environment.md` (private). The
step-2 gate said 906 tests and 908 were measured. The step list omitted the agreed requote → cmem/project.md § "The
merge — how it was prepared" (P1).
**Kept:** nothing; it restates binaryang.md.
Full text: `git show 62c65a9db:cmem/binaryen-ts/binaryang-kickoff.md`
