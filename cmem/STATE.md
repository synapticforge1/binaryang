# STATE: binaryang

Updated: 2026-11-19, at the end of the review of v4.0.0..review-h39

## Version
- Released: **4.0.0 on 2026-11-18** (JSR and npm, provenance on both; release.md § 4.0.0)
- Its publish.yml run 44412712388 is RED in npm's provenance read-back only (npm lagged ~4 min)
- Next: **4.1.0** (owner, 2026-11-19); what it carries: unreleased.md
- Working branch: `main`

## Now
- H39 is built and reviewed: `src/host.ts`, the host check in `bun run portability`,
  `--self-check` (no skipped status), arm64 rows `runtime`; `-o NUL` on Deno fixed
- H38 steps 1–3 and 7 are done, and the ★ copy is decided (best-practices-shared.md); steps 4–6 open
- Workspace notes moved to `../workspace/cmem/` (H42); letters are one file each (H41)

## Review
- Review of v4.0.0..review-h39 (owner: "review", 2026-11-19): COMPLETE at f1a55034f
- Position: first review 1 (basic, found by privacy), the gate 1, re-review 1: 0, the owner's
  overrule 1, re-review 2: 0
- Platforms passed: win-x64 (gate 31/31), linux-x64 (fresh WSL clone: self-check, portability,
  privacy, baseline, test:bun with the 36 listed, spec, interp); pending: the other four

## Next
1. The 36 Bun known differences: the owner's choice (fix the 2 wording tests; route the 34?)
2. `publish.ts` reads the FIRST `review-complete:` line; the old one is relabelled — fix it
3. H39: answer in `../workspace/cmem/letters/H39.md` once pushed; mac-x64 `--self-check` when met
4. The npm provenance poll window (open-work, top); H38 steps 4–6 (archive, split, wrap)
5. The carried issues C-H2…C-R2-5 (review-issues.md), when the owner opens them

## Waiting on owner
- "Re-run failed jobs" on publish.yml run 44412712388 (web UI): skips the publish, turns it green
- The 36 Bun known differences: option 1 or 2 (asked 2026-11-19)

## Read next
- unreleased.md: what 4.1.0 must say
- platforms.md: per engine, `host` per OS (H39), and the matrix
