# STATE: binaryang

Updated: 2026-11-19, workspace letters H38 (★ decision), H41, H42 read and acted on

## Version
- Released: **4.0.0 on 2026-11-18** (JSR and npm, provenance on both; release.md § 4.0.0)
- Its publish.yml run 44412712388 is RED in npm's provenance read-back only (npm lagged ~4 min)
- Working branch: `main`

## Now
- 4.0.0 is out; the release review is COMPLETE at ad49dee73
- H38 steps 1–3 and 7 are done, and the ★ copy is decided (best-practices-shared.md); steps 4–6 open
- Workspace notes moved to `../workspace/cmem/` (H42); letters are one file each (H41)

## Review
- Release review (letter H37): scope c2fa549..823eaa063 (the H37 work, accept list, notes)
- Position: complete — first review 4, re-review 1: 3, re-review 2: 2, re-review 3: 0
- Platforms passed: win-x64 (gate 31/31), linux-x64 (Bun leg, baseline, spec, interp, privacy);
  pending: the other four

## Next
1. Letter H39: `host.ts` (every OS call), its import gate, `--self-check`, arm64 rows → `runtime`
2. The npm provenance poll window (open-work, top): widen, test, review, next release
3. H38 steps 4–6: archive closed items, split the files over 25 KB, wrap long lines
4. The carried issues C-H2…C-R2-5 (review-issues.md), when the owner opens them

## Waiting on owner
- "Re-run failed jobs" on publish.yml run 44412712388 (web UI): skips the publish, turns it green

## Read next
- `../workspace/cmem/letters/H39.md`: the host.ts work
- platforms.md: the matrix H39 changes
