# Archive: best-practices.md merge framing, to 4.1.1

This holds the merge-time framing sections of best-practices.md ("Why this file is a selection and not a rewrite", "The convergence is stronger than either side claimed"), moved verbatim from `cmem/best-practices.md` on 2026-11-20 (H38 step 4). Read it only when asked.

## Why this file is a selection and not a rewrite

At 9.8:1 this was the trap file of the whole cmem merge. A naive merge reads as wabt-ts's memory
with a few binaryen-ts notes appended, quietly losing the smaller project's reasoning — and the
smaller project is the one that independently _confirmed_ the rules.

The instruction from the pre-merge register inverts the usual framing, and it is the sharpest thing
either side wrote:

> **Do not pick a surviving vantage point.** Both sides independently derived the same rules. For a
> rule two teams found separately, **both origin stories are the evidence**, and choosing a survivor
> discards the strongest thing about it.

So each rule below names **both** derivations. Where a rule cost one project a specific defect, that
defect is the citation.

## 🆕 The convergence is stronger than either side claimed

Measured while merging: **four section titles are identical between the two files**, written
independently by two teams that never compared them.

| binaryen-ts                                           | wabt-ts                                               |
| ----------------------------------------------------- | ----------------------------------------------------- |
| §1 Producer/consumer pairs — the recurring blind spot | §3 Producer/consumer pairs — the recurring blind spot |
| §3 Verifying a change                                 | §1 Verifying a change                                 |
| §4 Investigating a defect                             | §2 Investigating a defect                             |
| §5 Status, scope and memory                           | §5 Recording what you found                           |

Two codebases, two ledgers, no shared document — and the same four headings, in a different order.
That is not style converging; it is the same failure modes teaching the same lessons twice.

---
