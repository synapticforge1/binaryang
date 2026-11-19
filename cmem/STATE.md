# STATE: binaryang

Updated: 2026-11-19, at the end of the review of 7d3a1feee..review-bun

## Version
- Released: **4.0.0 on 2026-11-18** (JSR and npm, provenance on both; release.md § 4.0.0)
- Its publish.yml run 44412712388 is RED in npm's provenance read-back only (npm lagged ~4 min)
- Next: **4.1.0** (owner, 2026-11-19); what it carries: unreleased.md
- Working branch: `main`

## Now
- Bun runs with memory64 on; the Bun known-differences list is EMPTY; no test skips anywhere
- H39 is merged and reviewed (`src/host.ts`, its gate, `--self-check`; `-o NUL` on Deno fixed)
- H38 steps 1–3 and 7 are done, and the ★ copy is decided (best-practices-shared.md); steps 4–6 open
- Letter H43 (Tooling rule 15) recorded: working-rules (scratch bounded, "commit" empties it,
  helper scripts TypeScript), review-process (reviewer folders, links removed first)

## Review
- Last: 7d3a1feee..review-bun, COMPLETE at d1dfa0856 (first review: hardening 1, owner 2, queued
  Q-H1; re-review 1: 0); the review of H39 before it, complete at f1a55034f
- Platforms passed: win-x64 (gate 31/31), linux-x64 (fresh WSL clone, 0 skips); pending: four
- **The review set for 4.1.0** (owner, 2026-11-19): these two reviews, v4.0.0..review-h39 and
  7d3a1feee..review-bun; no fresh full review. Since d1dfa0856 only `cmem/` changed

## Next
1. `publish.ts` reads the FIRST `review-complete:` line; older ones are relabelled — fix it
2. The npm provenance poll window (open-work, top); H38 steps 4–6 (archive, split, wrap)
3. The carried issues C-H2…C-R2-5 (review-issues.md), when the owner opens them

## Pushed
- 2026-11-19: `main` at bb5a2f475 on origin (read back). Answers in the workspace letters:
  H39, H41, H42, H43 (the workspace commits them and closes per repo)

## Waiting on owner
- "Re-run failed jobs" on publish.yml run 44412712388 (web UI): skips the publish, turns it green

## Read next
- design-decisions.md: Bun runs with memory64 on; engine limits; no skips
- unreleased.md: what 4.1.0 must say
