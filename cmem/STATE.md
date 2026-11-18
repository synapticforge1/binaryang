# STATE: binaryang

Updated: 2026-11-18, during the 4.0.0 release

## Version
- Released: 3.0.4 on 2026-11-11 (JSR and npm, provenance on both)
- Releasing: **4.0.0** (owner, 2026-11-18: "release"; level 4.0.0, the gate's floor is MAJOR —
  readBinary's changed declaration). CHANGELOG § 4.0.0
- Working branch: `main` (review-310 merged)

## Now
- The release review is COMPLETE at ad49dee73 (review-issues.md: `review-complete:`)
- Then: push `main` unbumped, `bun run bump major`, `bun run release`, watch publish.yml
- H38 steps 1–3 and 7 are done; steps 4–6 open

## Review
- Release review (letter H37): scope c2fa549..823eaa063 (the H37 work, accept list, notes)
- Position: complete — first review 4, re-review 1: 3, re-review 2: 2, re-review 3: 0
- Platforms passed: win-x64 (gate 31/31), linux-x64 (Bun leg, baseline, spec, interp, privacy);
  pending: the other four

## Next
1. Finish the 4.0.0 release; record it in release.md § "Release History"
2. H38 steps 4–6: archive closed items, split the 19 files over 25 KB, wrap long lines
3. The carried issues C-H2…C-R2-5 (review-issues.md), when the owner opens them

## Waiting on owner
- The ★ best-practices copy (held by letter H38)

## Read next
- review-issues.md (gitignored): the review's issues, fixes and counts
- release.md: the release steps
