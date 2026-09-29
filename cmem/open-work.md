# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

**State, 2026-09-29:** 🚀 **`binaryang@1.8.0` is published** (tag `v1.8.0`, `0b2edf7cd`;
[publishing.md](publishing.md) § 1.8.0), carrying everything below; `main` = the release plus cmem.
Nothing is unreleased ([unreleased.md](unreleased.md)). **Owner's order that day: items 16 and 17
(done), then 11 (found already closed), then 12** — decided the same day (both halves, V8 flags)
and built: `proposals/` is in the gate, and its first run found Q10–Q13 and closed item 9.
Custom-page-sizes runs on V8 through a new lowering pass (owner's choice), and its linking
trade-off P1 was decided the same day (rename the export), which closed 12. The optimizer and
IR items (from 1) are next. **12 open items, none blocking**, numbered below: old 16 and 17
closed, new 16 and 17 came out of them and closed the same day, and 9, 11, 12, 16 and 17 are gone with their numbers kept free.
Re-derive any number before quoting it.

**Owner's order (2026-09-28):** defects and gaps first, then optimizer and IR, then re-evaluate.

**Cut back to open items on 2026-09-29** (the second time; the first was 2026-09-14). The file had
grown to 1,020 lines of finished stages again. Nothing that later work needs was dropped. Each
removed record went to a topic file, and the full text is one `git show` away:

| closed history                                                           | now in                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| One front end (stages 0–5), R15's design, Q1–Q8, Flatten, `--converge`   | [ir-convergence.md](ir-convergence.md) § "Where it stands" and § "The optimizer after One front end" |
| the minify passes, the owner's naming principle, "is the scheme optimal" | [names.md](names.md) § 1a and § "Does optimization RENAME things"                                    |
| N4 (decided: keep), the Q / W rows                                       | [divergences.md](divergences.md)                                                                     |
| `spec-behaviour`, `ENGINE_UNSTABLE`, the proposal suites                 | [testing.md](testing.md)                                                                             |
| releases 1.6.0 / 1.6.1 / 1.7.0, the release pattern, `RELEASE_PAT`       | [publishing.md](publishing.md), [project.md](project.md) § "Versions"                                |
| wasmtk's letter of 2026-09-28 (items 1–5, 5a)                            | [handoffs.md](handoffs.md) § 14–15, `CHANGELOG.md` § 1.7.0                                           |
| everything else: M-series and post-M8 tables, the pre-bump items         | `git show 769b4d3c0:cmem/open-work.md`                                                               |

## Defects and gaps — the owner's first

**None open (2026-09-29).** Closed that day: `array.new_default` defaultability (`d6b487c2d`),
empty offsets / items (M2a), the name section's position (N9, by decision), references by name
(N10), folded layout and its label comments (W18), the diagnostic defects DG1–DG4 found by
measuring the old item 16 ([testing.md](testing.md) § "Diagnostic usefulness"), and the two that
measurement left, numbered 16 and 17 after it: DG5 (`wat2wasm` validates by default, as upstream —
owner: "we want to do the same"; it needed the validator to take labels BY NAME, which it never
could) and DG6 (a text diagnostic at the WORD, not its `(`, underlined as upstream) —
[divergences.md](divergences.md). The CI shell scripts are TypeScript (the old item 17).


## Optimizer and IR

1. ⬚ **`mapExpression` / `walkExpression` visit a branch's condition BEFORE its values**, which
   reverses wasm's evaluation order.
   - `deriveTypes` orders branch operands itself (`cd37142a6`), but any other order-sensitive
     visitor is exposed.
   - `operandsInOrder` (`ir/phantoms.ts`) is the one correct ordering, and a fix could route through
     it.
   - It may move `-Oz` bytes, so it wants its own measured commit.
2. ⬚ **The size gap to upstream at `-Oz` is mostly COVERAGE: 60.3 KB of 109.5 KB**
   ([names.md](names.md) § "Names under optimization, priced", measured 2026-09-19).
   - The missing passes: Inlining (ours runs at `-O3` only), DAE, DuplicateFunctionElimination,
     Precompute, MergeBlocks, SimplifyGlobals.
   - It shows in what survives: we keep 3,943 functions to upstream's 2,663.
   - The cheapest probe is scheduling Inlining at `-O2` / `-Oz`. The earlier "wait for stage 2" is
     lifted: stage 2 is done.
3. ⬚ **LocalCSE is an allow-list of kinds**, so it never reuses what sits under an unlisted kind
   (`extract_lane`, any SIMD). Upstream reuses it.
   - Its share of the **42.1 KB** our twelve passes lose to upstream's same twelve is unmeasured.
   - That 42.1 KB is the budget items 3–5 draw from.
4. ⬚ **LocalCSE runs after SimplifyLocals and CoalesceLocals at `-Oz`**, so the tee it adds is never
   cleaned up: +4 bytes on a repeated binary (measured scoping K3, 2026-09-14).
5. ⬚ **LocalCSE treats a multi-value `return` as opaque** (as it once did `tuple.make`).
6. ⬚ **`RemoveUnusedModuleElements` does not prune unused TYPES.** On the probe it kept 2 type
    entries to upstream's 1 (4 bytes). Not measured over the corpus: the script that would have
    priced it (`scratchpad/names/types.ts`) was session scratch and is gone. Rebuild it: the
    Type-section total, ours vs upstream, at `-Oz`.
7. ⬚ **9 node LITERALS in `src/` bypass their factory** and hand-compute `type` (re-counted
    2026-09-29: inlining 5, optimize-instructions 2, local-cse 1, simplify-locals 1; it was 26
    before the WAT parser was deleted).
    - Count them with `grep -rnE "kind: ExpressionKind\.\w+," src` outside `ir/expressions.ts`.
    - The `br_if` one was wrong. The rest want each literal's type compared to the factory's.
8. ⬚ **Asyncify refuses `call_ref`** (K1's leftover; `passes/asyncify.ts`: "call_ref is not yet
    supported"). Upstream instruments it as an indirect call.
(Item 9, inexact allocations, closed 2026-09-29: it was NOT "valid either way" — `--flatten` made
invalid modules from it. Q13 in [divergences.md](divergences.md).)

10. ⬚ **Delete S7's read-back in `wat2wasm`.** `writeBinaryIr` still re-reads its own bytes
    (`binary-writer.ts`, `readBinaryIr`) to predict the text forms, which costs +26–35% on
    `wat2wasm`.
    - The re-read existed only because two front ends built different trees. There is one front end
      now, so predict from the module in hand, delete the read-back, and re-measure.
    - The prediction hash keeps it safe: a residual disagreement prints as predicted, never wrong
      ([ir-convergence.md](ir-convergence.md) § "S7", and § "One front end", stage 2's ⏭️ line).

## Conformance

Nothing open. Closed 2026-09-29: item 11 (rank 4 of the wasmtk-ranked list — closed since M8e by
the One front end, never recorded: [handoffs.md](handoffs.md) § 4's outcome) and item 12
(`proposals/` in the gate, both halves; custom-page-sizes on V8 through `LowerCustomPageSizes`,
every assertion of the suite honoured — [testing.md](testing.md) § "The proposal testsuites",
[divergences.md](divergences.md) L1, L2, P1). Their numbers are kept free.

## Quality passes — the lens plan (agreed 2026-09-02)

Each round adds a LENS and re-runs every lens below it. Each lens repeats until a pass turns up
nothing new; the re-runs are the point, since fixing a hardening issue can introduce a code issue.
The rounds were named for versions 1.5.6 / 1.5.7 before the releases overtook them, so they keep the
names as labels only.

| round     | lenses, in order                            | state                                                                                    |
| --------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **1.5.5** | code                                        | ✅ passes 1–7, register empty, converged — [testing.md](testing.md) § "The 1.5.5 passes" |
| **1.5.6** | hardening → then code again                 | 13. ⬚ not started                                                                        |
| **1.5.7** | security → then hardening → then code again | 14. ⬚ not started                                                                        |

If a finding fits two lenses, file it under the **lowest** one that would have caught it:

| lens          | question                                    | examples from this codebase                                                                                                 |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **code**      | is it WRONG on valid input?                 | wrong bytes, dropped information, logic contradicting its own docs, one fact duplicated in two places that drifted          |
| **hardening** | does it survive HOSTILE or malformed input? | truncated binaries, absurd section counts, deep nesting, a panic where a typed error is the contract, unbounded work        |
| **security**  | can a consequence be EXPLOITED?             | unbounded allocation from an attacker-controlled length, path traversal in a CLI, ReDoS, integer overflow reaching an index |

⚠️ Converging means THESE invariants no longer discriminate, not that no issues remain. Keep a
per-pass record of what each pass looked for and found, or convergence cannot be told apart from
fatigue.

## Repo work

15. ⬚ **A2 — `wasm2ts` is a stub that throws.** The long-term goal is WASI Preview 1 capable
    TypeScript output. **Blocked, and not close:** as of 2026-09-02 the wasmtk side had a long way
    to go before there is anything to implement against.

## The wasmtk thread — [handoffs.md](handoffs.md)

Nothing is open with wasmtk. § 17 (item 1 fixed in 1.7.1) was answered by § 18: on 1.7.1 their gate
is 64,473 passed / 0 failed / 66 skipped, all 11 of our skips pass, and "none of the 66 is yours". § 11 was sent and answered (their reply reached us 2026-09-29) — closed in
[handoffs.md](handoffs.md).

## Not tasks, by decision

- **When to release is the owner's call, every time — a standing rule, not a task.** The pattern is
  settled ([publishing.md](publishing.md), current-state line). The bump is never made incidentally,
  because the version line arms a release.
- **`RELEASE_PAT` — not needed** (owner, 2026-09-29). The release pattern always pushes the tag
  itself (8 of 8 unaided). The PAT fixes only the `auto-tag` → dispatch path, which the pattern
  never takes ([publishing.md](publishing.md)).
- **Names under optimization — decided** (owner, 2026-09-29):
  - with `-g`, the local and label names the passes leave are KEPT (N4, DESIGN);
  - export and import names are inviolable, and minification is opt-in with a map;
  - the minified scheme is final: separate import/export sequences were rejected
    ([names.md](names.md)).
- **WASM kernels (binaryen-ts Phase 10) — parked** (owner, 2026-09-29: "we may reevaluate way down
  the road when we start talking about optimization and speed of processing").
  - The code stays as it is: `wasm-runtime.ts`, the demo kernel in `src/binaryen-ts/wasm/`, the
    published `./wasm` and `./wasm-runtime`. Only a test and a bench call them.
  - What was never built is kernel SELECTION: which optimizer operations are worth moving to wasm.
    The baseline is a ~2–3 ns boundary cost per call (`add_i32` ~3.6 ns as a kernel vs ~0.34 ns in
    TS), so only an operation doing much work per call can pay.
  - **Trigger to reopen:** work on the optimizer's processing speed. Profile the corpus first; a
    kernel is justified only by a hot operation the profile shows.
  - It is not part of the IR merge: the IR is the tree's shape, this is the passes' speed.
  - The doc mapping of `wasm/demo_bytes` to `./wasm` is correct: `./wasm` exports `DEMO_BYTES`
    (checked 2026-09-29).
- **A local directory path in git history — leave it** (owner, 2026-09-14). The copies in
  `b472b4aa4` and `df3659840` name no account, token or secret, and are not worth a force push. Do
  not re-open.
- **JSR and GitHub descriptions on the predecessors — won't do** (owner, 2026-09-02); they are
  frozen.
- **Converging the two IRs further is not a release task.** It is open-ended by decision 1 and
  tracked by `deno task collisions` ([project.md](project.md)).
- **D4 — never yank, ever** ([project.md](project.md)).
- **The predecessors are frozen**: no change to `binaryen-ts` or `wabt-ts` on GitHub or JSR.
