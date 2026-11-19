# STATE: binaryang

Updated: 2026-11-19, on branch `bun-memory64`, its gate running

## Version
- Released: **4.0.0 on 2026-11-18** (JSR and npm, provenance on both; release.md § 4.0.0)
- Its publish.yml run 44412712388 is RED in npm's provenance read-back only (npm lagged ~4 min)
- Next: **4.1.0** (owner, 2026-11-19); what it carries: unreleased.md
- Working branch: `bun-memory64` (not merged): Bun with memory64 on, the Bun list 36 → 0, no skips

## Now
- `bun-memory64`: 3 commits; the gate on 165874442 is running, then linux-x64, then its review
- H39 is merged and reviewed (`src/host.ts`, its gate, `--self-check`; `-o NUL` on Deno fixed)
- H38 steps 1–3 and 7 are done, and the ★ copy is decided (best-practices-shared.md); steps 4–6 open
- Letter H43 (Tooling rule 15, scratch space bounded) read; not yet recorded or answered

## Review
- Last: v4.0.0..review-h39, COMPLETE at f1a55034f (merged as 7d3a1feee)
- Next: `bun-memory64`, all five classes; Q-H1 goes into its first round
- Platforms passed (last review): win-x64 (gate 31/31), linux-x64 (fresh WSL clone); pending: four

## Next
1. Review `bun-memory64`, with Q-H1 (review-issues.md, "Queued for the NEXT review") in round 1
2. Linux runs need the `upstream/binaryen` corpus copied into the clone (the test fails without it)
3. H43: Tooling rule 15 into working-rules.md and the reviewer brief; clean scratch; answer H43
4. `publish.ts` reads the FIRST `review-complete:` line; the old one is relabelled — fix it
5. H39 answer once pushed; the npm provenance poll window; H38 steps 4–6; carried C-H2…C-R2-5

## Waiting on owner
- "Re-run failed jobs" on publish.yml run 44412712388 (web UI): skips the publish, turns it green

## Read next
- design-decisions.md: Bun runs with memory64 on; engine limits; no skips
- unreleased.md: what 4.1.0 must say
