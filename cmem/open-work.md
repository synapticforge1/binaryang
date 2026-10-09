# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

**State, 2026-10-08 (owner: "finish item 23 then move to item 2. once complete we will publish and
notify wasmtk team"):** `binaryang@1.8.1` is the last release; `main` holds a large UNRELEASED set —
the optimizer steps (item 2: 1–5, LocalCSE, ConstantPropagation; item 23: OI folding through the
evaluator, Precompute — the interpreter itself is internal), `./definitions` (D1 / D2 / D3,
item 22), items 3–8 and 10 closed, six silent fixes ([unreleased.md](unreleased.md): the next
release is a MINOR, 1.9.0) — NOT PUSHED. 22 is done (closes with the release and its letter), 24
has its design decided and waits to be built. **Item 23 CLOSED 2026-10-08** — the interpreter,
the evaluator, `wasm-ctor-eval` and `wasm-interp`, all four stages landed and measured
([interpreter.md](interpreter.md); its number is kept free). **Item 2 CLOSED 2026-10-08** at 1.86%
of upstream `-Oz` on the corpus, the owner's ≤ 2% ([optimizer.md](optimizer.md); its number is
kept free). ✅ **1.9.0 PUBLISHED 2026-10-08** (the owner's "perform items 1 through 3": `main`
pushed, CI green, the bump typed by hand; auto-tag's dispatch FAILED as documented and the tag
re-pushed by hand published — [publishing.md](publishing.md)); wasmtk's letter
[handoffs.md](handoffs.md) § 26 SENT; **item 22
CLOSED** with it ([definitions.md](definitions.md)). **Item 24 BUILT 2026-10-08** (`wasm-bundle`,
the owner's item 3), UNRELEASED: a new export, so the next release is a MINOR, 1.10.0,
typed by hand when the owner says ([bundle.md](bundle.md); its number is kept free); wasmtk's
letter [handoffs.md](handoffs.md) § 27 is DRAFTED, to send with that release. The `.wit` beside
every bundle is a DEFAULT (owner, 2026-10-08; `witgen.ts`, `--no-wit`). ✅ **Gate GREEN on the
branch head `3ba63a8d8` (21 steps, every exit 0; the numbers in [bundle.md](bundle.md)) and
MERGED into `main` 2026-10-09.** Nothing pushed since 1.9.0. **Now: the owner's
call on 1.10.0; then 21 and the rounds 13 / 14. 4 open items, none blocking**; numbers 2–7, 9–12,
16, 17, 22, 23, 24 are gone and kept free. Re-derive any number before quoting it.

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

**None open.** Items 18–20, from wasmtk's § 20, were fixed for 1.8.1 the day they arrived: L3 (a
lowered out-of-bounds access traps as out of bounds), L4 (the placeholder; case 2 at an engine
ceiling) and C7 (`getFunctionInfo` shaped as binaryen.js) — [divergences.md](divergences.md).

Closed 2026-09-29: `array.new_default` defaultability (`d6b487c2d`), empty offsets / items (M2a),
the name section's position (N9, by decision), references by name (N10), folded layout and its label
comments (W18), the diagnostic defects DG1–DG4 found by measuring the old item 16
([testing.md](testing.md) § "Diagnostic usefulness"), and the two that measurement left, numbered 16
and 17 after it: DG5 (`wat2wasm` validates by default, as upstream — owner: "we want to do the
same"; it needed the validator to take labels BY NAME, which it never could) and DG6 (a text
diagnostic at the WORD, not its `(`, underlined as upstream) — [divergences.md](divergences.md). The
CI shell scripts are TypeScript (the old item 17).

## Optimizer and IR

(Item 1 closed 2026-09-30: the walkers visit a `br_if` / `br_table`'s values before its condition.
It was a DEFECT, not only an order: `mapWithSequences` keeps, evaluated, what it mapped before an
operand that becomes a never-falling-through sequence, so StripEH ran a builder-made
`br_if $l (throw $e (i32.const 7)) (call $bump)`'s call before the trap — reachable only from trees
built by the API or a pass; the text reader keeps such a `throw` a statement before the branch. The
"may move `-Oz` bytes" premise was measured: 0 of 13,285 optimizer outputs moved (the corpus and
every prepared spec module, at -O1 … -Oz). The hand-written traversals (`deriveTypes`, `phantoms`,
`cfg`, `non-nullable-locals`) already had wasm's order. `branch_operand_order.test.ts`.)

(Item 2 closed 2026-10-08 at **1.86%** of upstream `wasm-opt -Oz` on the corpus — the owner's
≤ 2% — from 13% on 2026-09-19: [optimizer.md](optimizer.md), every step with its commit, the
method, what the last 15 KB is. Its number is kept free.)

## Conformance

Nothing open. Closed 2026-09-29: item 11 (rank 4 of the wasmtk-ranked list — closed since M8e by the
One front end, never recorded: [handoffs.md](handoffs.md) § 4's outcome) and item 12 (`proposals/`
in the gate, both halves; custom-page-sizes on V8 through `LowerCustomPageSizes`, every assertion of
the suite honoured — [testing.md](testing.md) § "The proposal testsuites",
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
21. ⬚ 🗓️ **Merge `src/binaryen-ts/` and `src/wabt-ts/` into `src/` — SCOPE after the IR work**
    (owner, 2026-09-30: "It looks like we can now phase a merge of the binaryen-ts and wabt-ts
    folders into the src folder … I would like to scope that after our IR work is completed"). Facts
    measured that day, for the scoping:
    - **There is ONE IR already**: `Expression = Expr`, `WasmModule = W.Module`,
      `WasmFunction =
      W.Func` (binaryen-ts `ir/` aliases wabt-ts `ir/ir.ts`). The trees are
      LAYERS, not two IRs: 30 binaryen-ts files import wabt-ts, 0 the other way (wabt-ts 52 files /
      37k lines — IR, reader, writer, validator, text tools; binaryen-ts 43 / 19k — passes, compat,
      `wasm-opt`).
    - **Decision 1** ([project.md](project.md)) says "Two IRs are retained … not a merge task" — its
      premise no longer describes the code; the merge re-decides it.
    - `deno task collisions` = **86** names declared in both trees — the aliases; one tree needs one
      name each, and the indicator itself (it counts per tree) retires with the merge.
    - PUBLIC subpaths name the trees: `./ir/binaryen-ts`, `./ir/wabt-ts`, `./core/wabt-ts` — moving
      files keeps them working (they map to paths), renaming them is BREAKING.
    - Mirrors to move with it: `tests/binaryen-ts|wabt-ts|ir`, `scripts/binaryen-ts|wabt-ts`
      (workspace members with their own `deno.json`), and cmem's path citations (retargeting is part
      of the move — working-rules.md).
    - 🗓️ **Agreed with the owner, 2026-09-30** — worth doing, for simpler optimization, bug finding,
      hardening and security work: one name and one place per concept, one layout for the lens
      rounds to audit. The shape agreed:
      - **Mostly NOT breaking.** Consumers import SUBPATHS, a map in `deno.json`; moving files
        behind them breaks no one (wasmtk uses `compat/wabt`, `compat/binaryen`, `wasm-validate`).
        Only the three tree-named subpaths raise it: keep them as deprecated aliases for a release
        beside new names, remove them in a later MINOR.
      - **Phased:** (1) move files into one tree by concept (`ir/`, `reader/`, `writer/`,
        `validator/`, `passes/`, `tools/`, `compat/`), every subpath kept — the gate green and
        output bytes IDENTICAL; (2) collapse the aliases into single names; (3) remove logic that
        exists twice; (4) then decide the three tree-named subpaths.
      - **Timing:** after the IR work (owner) and BEFORE the hardening and security rounds (items
        13, 14), so those audit the final structure once.

(Item 22 closed 2026-10-08 with the 1.9.0 release and its letter, [handoffs.md](handoffs.md)
§ 26: [definitions.md](definitions.md) — what shipped, the decisions, what the proof found. Its
number is kept free.)

(Item 24 BUILT 2026-10-08 on `main`, unreleased — `wasm-bundle`, `./tools/wasm-bundle`, the
`(@reloc data)` annotation: [bundle.md](bundle.md) — the rules as built, the decisions, what was
measured, the gaps; the letter is [handoffs.md](handoffs.md) § 27. Its number is kept free.)

## The wasmtk thread — [handoffs.md](handoffs.md)

§ 22 (2026-09-30) closed the thread: 1.8.1 pinned, all three fixes hold on five engines, skips 66 →
16 (gate 64,506 / 0 / 16), nothing asked. § 20 was answered in code (items 18–20, 1.8.1) and by
§ 21. § 19 (1.8.0 is out; `LowerCustomPageSizes` offered for the custom-page modules they skip) was
SENT 2026-09-29 and asks nothing — a reply is welcome, above all their custom-page-sizes skip count
with the pass. § 17 (item 1 fixed in 1.7.1) was answered by § 18: on 1.7.1 their gate is 64,473
passed / 0 failed / 66 skipped, all 11 of our skips pass, and "none of the 66 is yours". § 11 was
sent and answered (their reply reached us 2026-09-29) — closed in [handoffs.md](handoffs.md).

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
