# STATE: binaryang

Updated: 2026-11-18, at the end of the session

## Version
- Released: 3.0.4 on 2026-11-11 (JSR and npm, provenance on both)
- Working branch: `h37` (local; from `main` 715f58abd, where the review's fixes landed)

## Now
- The review for the next release is COMPLETE under the final standard (letter H37), on `main`
- H37 (a)–(g) done on `h37`, uncommitted: `bun run gate` 31/31 on win-x64 (2026-11-18)
- H38 steps 1–3 and 7 are done; steps 4–6 open

## Review
- Run for: the next release (from 3.0.4), from scratch (owner, 2026-11-18)
- Position: complete — first review 7, re-review 1: 2, re-review 2: 0; full suite passed
- Open issues: basic 0, hardening 0, licensing 0, security 0, privacy 0
- Platforms passed: win-x64, linux-x64 (Ubuntu 26.04, Bun only); pending: the other four

## Next
1. Commit `h37`, then merge to `main` (the owner's word); the changed publish.yml is
   first exercised in full at the next real release
2. H38 steps 4–6: archive closed items, split the 19 files over 25 KB, wrap long lines
3. The carried issues C-H2…C-R2-5 (review-issues.md), when the owner opens them

## Waiting on owner
- "commit" / "push" for `h37`
- The ★ best-practices copy (held by letter H38)
- Closed 2026-11-18: n-2 (rewrites, M6); the GitHub settings checklist (owner verified)

## Read next
- review-issues.md (gitignored): the review's issues, fixes and counts
- ../../cmem/review-process.md: the standard (§ 13, the work items)
