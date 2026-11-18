# STATE: binaryang

Updated: 2026-11-18, at the end of the session

## Version
- Released: 3.0.4 on 2026-11-11 (JSR and npm, provenance on both)
- Working branch: `review-next` (local; from `security-r3`; the review's fixes uncommitted)

## Now
- The review for the next release is COMPLETE under the final standard (letter H37)
- Its fixes sit uncommitted on `review-next`, waiting on the owner's "commit" / "push"
- H38 steps 1–3 and 7 are done; steps 4–6 open

## Review
- Run for: the next release (from 3.0.4), from scratch (owner, 2026-11-18)
- Position: complete — first review 7, re-review 1: 2, re-review 2: 0; full suite passed
- Open issues: basic 0, hardening 0, licensing 0, security 0, privacy 0
- Platforms passed: win-x64, linux-x64 (Ubuntu 26.04, Bun only); pending: the other four

## Next
1. Commit the review's fixes on `review-next`, then merge to `main` (the owner's word)
2. H37 (a) slot file, (b) privacy gate checks review-issues.md is untracked, (c), (f), (g)
3. H37 (d) release script refuses without a completed review; (e) CI only publishes
4. A committed local gate script (the scratch one is not kept)
5. H38 steps 4–6: archive closed items, split the 19 files over 25 KB, wrap long lines

## Waiting on owner
- "commit" / "push" for the review's fixes
- n-2: is "Ported from / Based on" enough for Apache-2.0 §4(b)'s "modified" notice?
- The GitHub settings checklist the security reviewer listed (in review-issues.md)
- The ★ best-practices copy (held by letter H38)

## Read next
- review-issues.md (gitignored): the review's issues, fixes and counts
- ../../cmem/review-process.md: the standard (§ 13, the work items)
