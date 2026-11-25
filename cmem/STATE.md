# STATE: binaryang

Updated: 2026-11-25, the fixes batch reviewed clean and gated (not yet pushed)

## Version
- Released: **4.1.2 on 2026-11-20** (JSR and npm, provenance on both; release.md § 4.1.2);
  publish.yml run 44782414500 green in every job, first attempt (npm provenance at 2 min 47 s)
- 4.1.1 on 2026-11-19 (release.md § 4.1.1);
  publish.yml run 44639032099 GREEN since the owner's re-run (attempt 1 red only in npm's
  provenance read-back: npm lagged ~3 min)
- 4.1.0 on 2026-11-19, run 44621909375 green in every job
- 4.0.0's run 44412712388 is GREEN since its re-run (attempt 2, 2026-11-19 21:58Z: publish
  skipped, provenance found on the first read); attempt 1 was red only because npm lagged ~4 min
- Unreleased on main: nothing; on local `fixes-batch`: the batch below (unreleased.md § "Pending")
- Working branch: `fixes-batch` (977cf27ab; unpushed)

## Now
- Bun runs with memory64 on; the Bun known-differences list is EMPTY; no test skips anywhere
- H39 is merged and reviewed (`src/host.ts`, its gate, `--self-check`; `-o NUL` on Deno fixed)
- H38 is done in all seven steps (4–6 on 2026-11-20); `check-cmem`: all limits hold
- Letter H43 (Tooling rule 15) recorded: working-rules (scratch bounded, "commit" empties it,
  helper scripts TypeScript), review-process (reviewer folders, links removed first)

## Review
- Last: the fixes batch main..977cf27ab (Q-H2…Q-H6, C-H2…C-H6, C-R2-1/2/5, C48, C49 and every
  finding since), 11 rounds, round 11 NO ITEMS in any class at 977cf27ab; not yet review:record'ed
- Before it: the 4.1.0 release notes and their fixes, COMPLETE at 18733943a (`review:record`)
- Platforms passed at 977cf27ab: win-x64 (gate 32/32, 7,189 Bun tests), linux-x64 (fresh WSL
  clone: every step incl. spec, wat2wasm, size ratchet, --self-check); pending: four
- **The review set for 4.1.0** (owner, 2026-11-19): v4.0.0..review-h39, 7d3a1feee..review-bun and
  d1dfa0856..review-line; together every shipped change and the release tooling since 4.0.0

## Next
1. The owner's "push" for `fixes-batch` (merge --no-ff to main), then a release when asked:
   the API surface is unchanged; the level is the owner's (CLI behaviour changes) — unreleased.md § "Pending"
2. Workspace: binaryang's C49 answer committed there (71fea74, 2026-11-25; C48's in 543ff2e)

## Pushed
- 2026-11-20: `main` at cb857e212 (`bump to v4.1.2`), tag `v4.1.2` (read back).
- 2026-11-19: rulesets read back — `main` (27683565: the default branch; deletion, force push)
  and a TAG ruleset (27687370, `refs/tags/v*`: deletion, force push, update; creation allowed,
  so CI tags). A history purge needs both switched off for it.
- 2026-11-19: `main` at e77d6fdd1 (`bump to v4.1.1`), tag `v4.1.1` (read back); issue #1 answered
  and closed by the owner.
- 2026-11-19: Dependabot #2 (setup-node 7.1.0) and #3 (checkout 7.0.1) taken in through
  `actions-bump` (reviewed; gate 30/31 → the privacy fix, re-reviewed; main 6fa2bd3d0, both PRs
  closed as merged, run 44629579556 green). Issue #1 fixed on `issue-1` (review 0 in all five;
  gate 31/31; linux-x64 fresh clone 6790/6790).
- 2026-11-19: `main` at 1ffb9f125 (`bump to v4.1.0`) on origin, tag `v4.1.0` (read back). Answers in the workspace letters:
  H39, H41, H42, H43 (the workspace commits them and closes per repo)

## Waiting on owner
- Note on issue #1 that the fixes shipped in 4.1.1 (closed already)

## Read next
- design-decisions.md: Bun runs with memory64 on; engine limits; no skips
- release.md § 4.1.0: how this release went
