# STATE: binaryang

Updated: 2026-11-18, during the 4.0.0 release

## Version
- Released: **4.0.0 on 2026-11-18** (JSR and npm, provenance on both; release.md § 4.0.0)
- Its publish.yml run 44412712388 is RED in npm's provenance read-back only (npm lagged ~4 min)
- Working branch: `main`

## Now
- 4.0.0 is out; the release review is COMPLETE at ad49dee73
- H38 steps 1–3 and 7 are done; steps 4–6 open

## Review
- Release review (letter H37): scope c2fa549..823eaa063 (the H37 work, accept list, notes)
- Position: complete — first review 4, re-review 1: 3, re-review 2: 2, re-review 3: 0
- Platforms passed: win-x64 (gate 31/31), linux-x64 (Bun leg, baseline, spec, interp, privacy);
  pending: the other four

## Next
1. The npm provenance poll window (open-work, top): widen, test, review, next release
2. H38 steps 4–6: archive closed items, split the 19 files over 25 KB, wrap long lines
3. The carried issues C-H2…C-R2-5 (review-issues.md), when the owner opens them

## Waiting on owner
- "Re-run failed jobs" on publish.yml run 44412712388 (web UI): skips the publish, turns it green
- The ★ best-practices copy (held by letter H38)

## Read next
- review-issues.md (gitignored): the review's issues, fixes and counts
- release.md: the release steps
