# STATE: binaryang

Updated: 2026-11-27, 4.2.0 released, verified as a user, its record pushed

## Version
- Released: **4.2.0 on 2026-11-25** (JSR and npm, provenance on both; release.md § 4.2.0);
  publish.yml run 45712317393 green in every job, first attempt
- 4.1.2 on 2026-11-20, run 44782414500 green in every job, first attempt
- 4.1.1 on 2026-11-19 (release.md § 4.1.1);
  publish.yml run 44639032099 GREEN since the owner's re-run (attempt 1 red only in npm's
  provenance read-back: npm lagged ~3 min)
- 4.1.0 on 2026-11-19, run 44621909375 green in every job
- Unreleased on main: nothing (unreleased.md)
- Working branch: none (main)

## Now
- Bun runs with memory64 on; the Bun known-differences list is EMPTY; no test skips anywhere
- H39 is merged and reviewed (`src/host.ts`, its gate, `--self-check`; `-o NUL` on Deno fixed)
- H38 is done in all seven steps (4–6 on 2026-11-20); `check-cmem`: all limits hold
- Letter H43 (Tooling rule 15) recorded: working-rules (scratch bounded, "commit" empties it,
  helper scripts TypeScript), review-process (reviewer folders, links removed first)

## Review
- Last: the 4.2.0 release notes and accept list, 6 rounds (round 6 no findings), COMPLETE at
  36e6141c8 (`review:record`); before it the fixes batch, 11 rounds, the last with no items
- Platforms passed at 36e6141c8: win-x64 (gate 32/32, 7,189 Bun tests; gate --release 34/34 at
  the bump), linux-x64 (fresh WSL clone: every step incl. spec, wat2wasm, size ratchet,
  --self-check); pending: four

## Next
1. Nothing queued; the next work is the owner's call
2. Workspace: binaryang's C49 answer committed there (71fea74, 2026-11-25; C48's in 543ff2e)

## Pushed
- 2026-11-27: `main` at ff1178746 (the 4.2.0 record, run 46089585871 green: not a release);
  the backup branch `fixes-batch-before-trailers` deleted (owner).
- 2026-11-25: `main` at 3d7046355 (`bump to v4.2.0`), tag `v4.2.0` (read back); `main` at
  5b4388137 unbumped before it (run 45709775698 green); `release/4.2.0`, `accept-4.2.0`.
- 2026-11-20: `main` at cb857e212 (`bump to v4.1.2`), tag `v4.1.2` (read back).
- 2026-11-19: rulesets read back — `main` (27683565: the default branch; deletion, force push)
  and a TAG ruleset (27687370, `refs/tags/v*`: deletion, force push, update; creation allowed,
  so CI tags). A history purge needs both switched off for it.
- 2026-11-19: `main` at e77d6fdd1 (`bump to v4.1.1`), tag `v4.1.1` (read back); issue #1 answered
  and closed by the owner.

## Waiting on owner
- Note on issue #1 that the fixes shipped in 4.1.1 (closed already)

## Read next
- design-decisions.md: Bun runs with memory64 on; engine limits; no skips
- release.md § 4.2.0: how this release went
