# The project — closed history, to 4.1.1

The release table 1.5.1 to 1.7.2, the retirement ladder and the merge-preparation tables, and the history of the memory itself. Moved from `cmem/project.md` on 2026-11-20 (H38 step 4); the live notes start at [project.md](../project.md).


## Versions — the release table, 1.5.1 to 1.7.2

| version   | what it carried                                                                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.5.1** | the merge itself, plus the signpost releases of both predecessors — published 2026-08-27 with provenance (`rekorLogId=2618802426`)                                                                                                                                                                                   |
| **1.5.2** | merge `9489cfaec`, tag → `b9205faab`: bridge de-coarsening (`d6d22559c`), the `-Oz` `try_table` miscompile (`bfed70edb`), the `compat/binaryen` pass API, a user-facing README (`e6df098f1`). Shipped ahead of the ladder because wasmtk was blocked on the miscompile                                               |
| **1.5.3** | merge `755846dba`, tag → `1d11741d1`: release trigger (`37e911d6a`), all four `br_on_*` forms (`814596760`), one `scripts/release/` (`dbb52414c`), the convergence indicator (`a62e721d5`), the bridge at `src/bridge/` (`b8ee5d219`), the last ten symbols documented (`69cdf7925`), `.gitattributes` (`d56f08154`) |
| **1.5.4** | `wasm2wat` emits FOLDED output by default (`--linear` opts out), and the export-kind rejection found by A3 — published 2026-09-02 (`rekorLogId=2692137018`)                                                                                                                                                          |
| **1.6.0** | ⚠️ a MINOR: `./binary` and `./encoder` removed — ONE FRONT END (one reader, one IR, one writer), the post-M8 and Q1–Q8 fixes, S7's text-form record — tag `v1.6.0` → `5a85daeda`, published 2026-09-28 (`rekorLogId=2987187551`) |
| **1.6.1** | a patch from `release/1.6.1` (cut from `v1.6.0`): the CLI runs from JSR (`.` → `main.ts`) — published 2026-09-28 |
| **1.7.0** | ⚠️ a MINOR: `./interop` and hybrid mode removed (the `comparison/` suite); wasmtk's items 1–5 incl. custom descriptors; `--converge`; the three minify passes; Flatten complete — tag `v1.7.0` → `098a4c472`, published 2026-09-29 (`rekorLogId=2991848417`) |
| **1.7.1** | a patch: every memory / table limit is a u64 on the wire, and 1-byte pages cap a 32-bit memory at 2^32-1 pages (wasmtk, 2026-09-29) — tag `v1.7.1` → `fd61a9b53`, published 2026-09-29 (`rekorLogId=3001574645`) |
| **1.7.2** | a patch: `wasm2wat` text as upstream / wasm-tools print it — references by name (N10), folded layout and label comments (W18), one-line declaration constants, empty offset / item (M2a) — and `array.new_default` requires a defaultable element; no bytes moved — tag `v1.7.2` → `7f410842e`, published 2026-09-29 (`rekorLogId=3002349065`) |


## The retirement — the ladder, summarized (2026-09-02)

**Summary.** Scoped 2026-08-26 as 30 items over four phases: **A** the merge (17 items, complete
2026-08-26, gate: 908 tests, baseline IDENTICAL over 421 files / 1,557,602 bytes, the six tools
byte-identical on Deno, Node and Bun); **B** binaryang 1.5.1 plus signpost releases of both
predecessors; **C** consumer migration; **D** the break at 1.5.2 and archiving. The whole blast
radius was measured, not assumed: **binaryang → wasmtk → LeptonPad**, with each predecessor
reporting exactly one JSR dependent.

| step | what                                           | result                                                                                                                                                     |
| ---- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | wasmtk green against binaryang, control-first  | ✅ 2026-08-26 — identical to the control against the old pins, including the pinned `br_on_cast.wast` known failure                                        |
| B2   | binaryang 1.5.1                                | ✅ 2026-08-27, with provenance                                                                                                                             |
| B3–5 | signposts                                      | ✅ binaryen-ts `4bf1726f200` (in `README.md`); wabt-ts `b6d1d4354` (in the `@module` JSDoc of `src/index.ts` — its JSR page renders JSDoc, not the README) |
| B6   | point the four descriptions at binaryang       | 🛑 **CLOSED as won't-do** (owner, 2026-09-02)                                                                                                              |
| C1–2 | wasmtk swaps two import-map lines, republishes | ✅ wasmtk 2.0.1 (2026-08-27) depends on binaryang for both compat paths and neither predecessor; 2.0.2 (2026-08-31, `rekorLogId=2666522017`) on 1.5.3      |
| C3   | LeptonPad's `build:wasm` still runs            | ✅ 2026-08-31 — the artifact validates, instantiates and computes; no predecessor pulled                                                                   |
| D2   | JSR `isArchived` on both                       | ✅ 2026-09-02, verified live                                                                                                                               |
| D3   | archive both GitHub repos                      | ✅ 2026-08-27                                                                                                                                              |


## The merge — how it was prepared (2026-08-26): the summary and the outcome table

**Summary.** Before any file moved, the two predecessors' pre-merge registers were reconciled into
one (the kickoff brief: _"two views of the same merge is how things get missed twice"_). It found
four conflicts — two of them a document contradicting itself — one agreed pre-merge action missing
from the plan, and seven findings in neither register. Its decisions are above; its measurements
were re-derived against `binaryen-ts@1163f77e9a7` and `wabt-ts@5d488e4bc`. Full text:
`git show f2ee1a41f:cmem/pre-merge-register.md`.

| item | outcome                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1   | `fmt.singleQuote` requote in binaryen-ts, its own commit BEFORE the move — `eba0207cf39`, 104 files, 4,302 / 4,302, pure. Agreed by both sides, omitted from the plan                     |
| N1   | two test-file conventions (`_test.ts` 38 / `.test.ts` 130) — moot: the merge unified them (230 `.test.ts`, 0 `_test.ts`)                                                                  |
| N3   | "unify the CLI" was not mechanical: six extractions plus a `Deno` → `node:` port (53 `Deno.*` on 43 lines), preserving `wasm-validate`'s `--enable-*` surface (T13.10)                    |
| N4   | binaryen-ts `--version` printed `1.3.4` for two minor releases — fixed at source, `b8b18073916`: `bump` rewrites `main.ts` and fails loudly; a sync test catches hand-set versions        |
| G1   | the emitted-byte baseline, captured while "before" still existed — [testing.md](../testing.md)                                                                                               |
| A0   | T13.22, the compensating pair across the repository boundary — closed BEFORE the merge, which would otherwise have made it permanently invisible ([ir-convergence.md](../ir-convergence.md)) |

## Memory: what was retired, and where it went

Moved here from [INDEX.md](../INDEX.md) on 2026-10-23 (workspace letter H6: the INDEX holds policy,
triggers, one line per file and the reading order; the history of the memory itself lives here).
The policy that produced every row is INDEX § "Cleanup policy".

🔧 **The wings were summarized on 2026-09-14** (owner: "the wing docs get both corrected and
summarized"). Until then they were kept unedited as the origin record — the evidence of what each
side knew before the trees became one. That evidence is intact in git: every wing file is one
`git show 62c65a9db:cmem/<wing>/<file>` away, and each summary section names its command.

**Consolidated 2026-09-14** (branch `cmem-consolidation`): machine-local memory moved in,
`open-work.md` cut to open items with its closed history moved to topic files, stale status lines
corrected in place. **Nothing was dropped**, and that was checked rather than asserted: every commit
hash, backticked identifier, measured ratio and quantity in the old core and in memory was
snapshotted first and verified present afterwards, with each deliberate exception listed and
reasoned — and the check was inverted (a mutated copy fails it, naming exactly what was removed).

| retired or summarized | now in | full text |
| --- | --- | --- |
| `scope-1.5.2.md` | [project.md](../project.md) § "Versions" | `git show 65afb827c:cmem/scope-1.5.2.md` |
| `overview.md`, `phases.md`, `transition.md`, `pre-merge-register.md` | [project.md](../project.md) | `git show f2ee1a41f:cmem/<file>` |
| `bridge.md`, `text-routes.md` | [ir-convergence.md](../ir-convergence.md) § "The bridge and the WAT routes into binaryen-ts"; binding rules here | `git show f2ee1a41f:cmem/<file>` |
| `quality-passes.md` | the plan in [open-work.md](../open-work.md); the passes in [testing.md](../testing.md) | `git show f2ee1a41f:cmem/quality-passes.md` |
| `handoffs.md` letters (file kept, as a log) | [handoffs.md](../handoffs.md) | `git show f2ee1a41f:cmem/handoffs.md` |
| `divergences.md` N1 and parity prose, the X1 record | [names.md](../names.md), [testing.md](../testing.md), a summary in place | `git show f2ee1a41f:cmem/divergences.md` |
| the wabt-ts wing, `cmem/wabt-ts/` (12 files) | [wabt-ts.md](../wabt-ts.md) | `git show 62c65a9db:cmem/wabt-ts/<file>` |
| the binaryen-ts wing, `cmem/binaryen-ts/` (14 files) | [binaryen-ts.md](../binaryen-ts.md) | `git show 62c65a9db:cmem/binaryen-ts/<file>` |
| `open-work.md` again (1,020 lines → open items), `unreleased.md` (all shipped), 2026-09-29 | [open-work.md](../open-work.md)'s own table of where each record went | `git show 3bd64ece7:cmem/<file>` |
| `ir-convergence.md` § "Scope" — the Stage 1–3 plan (drift B4, 2026-10-23) | a summary in place, its four lessons kept | `git show 8147adc90:cmem/ir-convergence.md` |
| `publishing.md` — the dispatch sections "3 of 3", "The fix: RELEASE_PAT", "ROOT CAUSE" (drift B3, 2026-10-23) | publishing.md § "The auto-tag dispatch path does not publish" | `git show 8147adc90:cmem/publishing.md` |
| `open-work.md` — six stacked "State" paragraphs, 2026-10-09 → 10-22 (H6, 2026-10-23) | a summary in place | `git show b94a1c6ae:cmem/open-work.md` |
