# Delivery status

Merged topic file (§2.2). Supersedes `binaryen-ts/phases.md` and `wabt-ts/phases.md` **as the
statement of where things stand**. Both wings stay as the origin record and remain the place to look
for per-phase detail — they are not stale, they are historical, which is a different thing.

Unblocked by §2.1: this file describes one release flow, and until `scripts/release/` existed there
were two.

## 🚨 "Phase N" is AMBIGUOUS in this repository, and always will be

The two projects numbered their phases independently and the numbers collide on live topics:

| Phase | in `binaryen-ts`         | in `wabt-ts`       |
| ----- | ------------------------ | ------------------ |
| 4     | core optimisation passes | WAT text format    |
| 7     | GC proposal              | binaryen Bridge    |
| 8     | **EH proposal**          | **wasm2ts** (stub) |

Phase 8 is the one that bites: it is _shipped EH support_ on one side and _an unimplemented stub
that throws_ on the other. A note saying "Phase 8 is done" is true and false in the same repository.

**Rule: never write a bare phase number.** Write `binaryen-ts Phase 8` or `wabt-ts Phase 8`. This is
not tidiness — the phase histories are frozen and cannot be renumbered without destroying the link
between the record and the commits it describes, so the ambiguity is permanent and has to be handled
at every use.

## Where binaryang actually is

**`@jrmarcum/binaryang@1.5.4`**, published 2026-09-02 with provenance. `main` carries a large
unreleased set on top — [unreleased.md](unreleased.md); what is outstanding is
[open-work.md](open-work.md).

| version   | what it carried                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.5.1** | the merge itself, plus the signpost releases of both predecessors                                                                                                                     |
| **1.5.2** | the T13.50 bridge de-coarsening, the `-Oz` `try_table` miscompile, the `compat/binaryen` pass API. Shipped ahead of the ladder because wasmtk was blocked on the miscompile           |
| **1.5.3** | release trigger, all four `br_on_*` forms, one `scripts/release/`, the convergence indicator scripted, the bridge at `src/bridge/`, the last ten symbols documented, `.gitattributes` |
| **1.5.4** | `wasm2wat` emits FOLDED output by default (`--linear` opts out), and the export-kind rejection found by A3                                                                            |

Both predecessors ended at a terminal **1.5.1**. Their phase tables are closed.

### 1.5.2 and 1.5.3 — the scope, summarized

`cmem/scope-1.5.2.md` scoped branch `release/1.5.2` (opened 2026-08-27) and tracked its deferred
items through 1.5.3. **Everything in it shipped**, so it was retired on 2026-09-14 under the
summarize-when- complete policy ([INDEX.md](INDEX.md)). Full text:
`git show cff3284b8:cmem/scope-1.5.2.md`.

| release | merge       | tag                    | what landed, by commit                                                                                                                                                                                                                                                                               |
| ------- | ----------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.5.2   | `6ee0eef1d` | `v1.5.2` → `740fbb119` | bridge de-coarsening, all shapes (`50a959baa`); `-Oz` store live across a `try_table` catch edge (`d5485a740`); user-facing README (`9083abdab`)                                                                                                                                                     |
| 1.5.3   | `1e1479f3f` | `v1.5.3` → `384f37ecc` | releases routed through the trigger that works (`74bee7522`); `br_on_*`, three defects (`7ff0408f4`); one release flow (`b955443a6`); convergence indicator scripted (`71d7772a0`); bridge to `src/bridge/` (`e76e2b7ca`); last ten symbols documented (`6d118b33e`); `.gitattributes` (`ec3a07de0`) |

Where the substance lives now: the de-coarsening and its lessons in [bridge.md](bridge.md); the
never-bump-in-the-merge rule and what "tag exists" implies in [publishing.md](publishing.md); the
bridge's location in [overview.md](overview.md); the retirement ladder in
[transition.md](transition.md).

Two lessons that lived only in that file:

- **Merge duplicated tooling as a UNION, not a pick.** Each predecessor's release scripts held a
  guard the other lacked — wabt-ts's `--dry-run` and `release-guard.ts`, binaryen-ts's `main.ts`
  version rewrite — so choosing either side would have silently dropped one.
- **Never give a branch the same name as a tag.** `release/1.5.2`, not `v1.5.2`, so
  `git checkout v1.5.2` cannot be ambiguous between `refs/heads` and `refs/tags`. Likewise the task
  is `release`, not `publish`, one keystroke from `publish:dry`, which does something unrelated and
  reversible.

Loose ends it held, resolved: "pass the provenance finding to wasmtk" was never recorded as sent,
and became moot when wasmtk 2.0.2 published with provenance (`rekorLogId=2666522017`); "doc
references mapped on plausibility" is carried in [open-work.md](open-work.md).

## The versioning rule — a genuine convergence

**Sub-version capped at 9**: `1.0.9 → 1.1.0`, `1.9.9 → 2.0.0`, major uncapped (`9.9.9 → 10.0.0`).
Both projects adopted this independently and stated it in the same words, which is why it survived
the merge without a decision. Enforced by `deno task bump`.

⚠️ **`bump` has no minor mode.** binaryen-ts set 1.5.0 by hand because Sweep 2 removed exported
symbols — a breaking change whether or not anything imported them. A release that is not a patch
still needs a human to type the number. See [publishing.md](publishing.md).

## Live gaps — carried forward, not closed by the merge

These outlived both projects. Each names its owning tree, per the rule above. Recorded at the merge
(2026-08-31); the state column was re-checked 2026-09-14, and a ✅ row is kept as history of what
the merge carried.

| gap                                                   | where                          | state                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`wasm2ts` is a stub that throws** (wabt-ts Phase 8) | `src/wabt-ts/tools/wasm2ts.ts` | the project's long-term goal — WASI Preview 1 capable TypeScript output. Deferred pending wasmtk QA/QC                                                                                                                                   |
| **TranslateEH**                                       | binaryen-ts                    | ⚠️ **a live gap, not a leftover TODO** — scoped and measured 2026-08-24. `binaryen-ts/correctness.md` § "TranslateEH"                                                                                                                    |
| **Custom-section preservation**                       | binaryen-ts                    | ✅ **CLOSED 2026-09-11 (C3, `4c162c584`)** — every custom section is kept and written back where it stood. Was: parse→encode dropped DWARF `.debug_*` / `name` / `producers`                                                             |
| **Phase 10 kernel selection**                         | binaryen-ts                    | deferred until real-corpus profiling; single-op dispatch regresses                                                                                                                                                                       |
| **Diagnostic offset accuracy**                        | both                           | ✅ **MEASURED 2026-08-31 (A3, `deno task offsets`)** — 0 missed rejections, and it found the export-kind defect. Was UNMEASURED, not clean: T13.35's cheap oracle was false for every multi-byte construct. See [testing.md](testing.md) |
| **Diagnostic wording**                                | wabt-ts                        | at close: reader 689/711, validator 2446/2683, parser 816/1229. None at ceiling, and the parser's remainder is largely cases where OUR message is better                                                                                 |
| **Nothing ships against the bridge**                  | `src/bridge/`                  | still true — no `src/` file imports it, no export-map entry, tests only. **S6 deletes it** ([ir-convergence.md](ir-convergence.md)); `deno task bridge` is the acceptance gate                                                           |

## Two lessons the phase records paid for, and the merge must not lose

**A snapshot column headed "now" silently becomes false.** wabt-ts's conformance table carried a
`now` header for a campaign-close reading until someone noticed. It is `at close <date>`, and the
harnesses are the only current answer. The same file also carried "all five metrics" above a
seven-row table: **re-derive a count from its own table; never quote one.**

**A coupling constrains whoever must act atomically — which is not automatically both parties.**
binaryen-ts recorded "1.5.0 cannot ship alone" because the wabt-ts bridge compensated for its
`try_table` bug. The coupling was real; the conclusion was wrong. wabt-ts pinned an exact version,
so publishing broke nothing, and they were waiting for a version to upgrade _to_. **Withholding the
release was not protecting them — it was what kept them stuck.** When recording a blocker, name who
is blocked and on what, or a true fact about a dependency becomes a false conclusion about a
release. See [best-practices.md](best-practices.md).

## Where the detail lives

Per-phase scope, gotchas and the campaign logs stay in the wings, and they are still worth opening:

- **[binaryen-ts/phases.md](binaryen-ts/phases.md)** — core Phases 0–13, the WT-series wasmtk
  critical path, the UP-1…UP-7 tiers and four "look for code issues" sweeps.
- **[wabt-ts/phases.md](wabt-ts/phases.md)** — Phases 1–8, the **TS ↔ C++ file mapping** (open the
  C++ alongside when porting — still live guidance for `src/wabt-ts/`), the per-phase gotchas (IR
  field names that differ from intuition, keyword-token mapping, fold-form invariants, validator
  architecture, the CLI pipelines) and the post-v1.3.5 conformance campaign.

⚠️ Both wings' **`overview.md`** still say all _three_ projects merge. That is the stale claim on
each side; [overview.md](overview.md) here is the authority.
