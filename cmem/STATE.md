# STATE: binaryang

Updated: 2026-11-19, at the release of 4.1.1

## Version
- Released: **4.1.1 on 2026-11-19** (JSR and npm, provenance on both; release.md § 4.1.1);
  publish.yml run 44639032099 RED in npm's provenance read-back only (npm lagged ~3 min)
- 4.1.0 on 2026-11-19, run 44621909375 green in every job
- 4.0.0's run 44412712388 is GREEN since its re-run (attempt 2, 2026-11-19 21:58Z: publish
  skipped, provenance found on the first read); attempt 1 was red only because npm lagged ~4 min
- Unreleased on main: nothing (unreleased.md)
- Working branch: `main`

## Now
- Bun runs with memory64 on; the Bun known-differences list is EMPTY; no test skips anywhere
- H39 is merged and reviewed (`src/host.ts`, its gate, `--self-check`; `-o NUL` on Deno fixed)
- H38 steps 1–3 and 7 are done, and the ★ copy is decided (best-practices-shared.md); steps 4–6 open
- Letter H43 (Tooling rule 15) recorded: working-rules (scratch bounded, "commit" empties it,
  helper scripts TypeScript), review-process (reviewer folders, links removed first)

## Review
- Last: the 4.1.0 release notes and their fixes (N-1…N-4, B-1…B-3; six re-reviews, the last on
  accept-4.1.0), COMPLETE at 18733943a (`review:record`). Queued below the floor: Q-H2…Q-H4
- Before it: d1dfa0856..review-line, COMPLETE at decbdb093 —
  six rounds; the review line failed open twice, so the owner chose option C: the record is
  its own file, `bun run review:record` → `cmem/local/review-complete` (recorded, read back)
- Platforms passed: win-x64 (gate 31/31), linux-x64 (fresh WSL clone, 0 skips); pending: four
- **The review set for 4.1.0** (owner, 2026-11-19): v4.0.0..review-h39, 7d3a1feee..review-bun and
  d1dfa0856..review-line; together every shipped change and the release tooling since 4.0.0

## Next
1. **The npm provenance poll window** (open-work, top): 12 × 15 s, and npm lagged ~4 min at 4.0.0
   and ~3 min at 4.1.1 — both runs red in that step only. Lengthen it before the next release
2. Tell wasmtk what 4.1.0 and 4.1.1 contain (handoffs.md)
3. H38 steps 4–6 (archive, split, wrap)
4. The carried issues C-H2…C-R2-5 and queued Q-H2…Q-H4 (review-issues.md), when the owner opens them

## Pushed
- 2026-11-19: `main` at e77d6fdd1 (`bump to v4.1.1`), tag `v4.1.1` (read back); issue #1 answered
  and closed by the owner.
- 2026-11-19: Dependabot #2 (setup-node 7.1.0) and #3 (checkout 7.0.1) taken in through
  `actions-bump` (reviewed; gate 30/31 → the privacy fix, re-reviewed; main 6fa2bd3d0, both PRs
  closed as merged, run 44629579556 green). Issue #1 fixed on `issue-1` (review 0 in all five;
  gate 31/31; linux-x64 fresh clone 6790/6790).
- 2026-11-19: `main` at 1ffb9f125 (`bump to v4.1.0`) on origin, tag `v4.1.0` (read back). Answers in the workspace letters:
  H39, H41, H42, H43 (the workspace commits them and closes per repo)

## Waiting on owner
- The `v*` ruleset is a BRANCH ruleset (refs/heads/v*): recreate it as a TAG ruleset (restrict
  updates, deletions, force pushes; not creations). The `main` ruleset (27683565) is right:
  deletions and force pushes only (2026-11-19)
- "Re-run failed jobs" on publish.yml run 44639032099 (web UI): skips the publish, turns it green
- Note on issue #1 that the fixes shipped in 4.1.1 (closed already)

## Read next
- design-decisions.md: Bun runs with memory64 on; engine limits; no skips
- release.md § 4.1.0: how this release went
