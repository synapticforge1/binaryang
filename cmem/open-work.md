# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

**State, 2026-09-29:** 🚀 **`binaryang@1.7.1` is published** (tag `v1.7.1`, `ced5ca508`;
[publishing.md](publishing.md) § 1.7.1) and `main` = the release plus cmem. One fix is unreleased
([unreleased.md](unreleased.md)). **18 open items, none blocking**, numbered below. Re-derive any
number before quoting it.

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

1. ⬚ **Folded `wasm2wat` prints no `;; label = @N` on an unnamed block / loop / `if`**, which
   upstream `--fold-exprs` and `wasm-tools --fold-instructions` both print; linear output has it.
   A branch inside still prints its depth as `br_if 0 (;@1;)`, pointing at an `@1` the folded text
   never shows. Text only, never bytes. Found 2026-09-29 while closing W18 (folded layout) and left
   out of it on purpose, to keep that change one thing. Any fix moves folded text (a text-only
   re-baseline, as W18's).

## Optimizer and IR

2. ⬚ **`mapExpression` / `walkExpression` visit a branch's condition BEFORE its values**, which
   reverses wasm's evaluation order.
   - `deriveTypes` orders branch operands itself (`cd37142a6`), but any other order-sensitive
     visitor is exposed.
   - `operandsInOrder` (`ir/phantoms.ts`) is the one correct ordering, and a fix could route through
     it.
   - It may move `-Oz` bytes, so it wants its own measured commit.
3. ⬚ **The size gap to upstream at `-Oz` is mostly COVERAGE: 60.3 KB of 109.5 KB**
   ([names.md](names.md) § "Names under optimization, priced", measured 2026-09-19).
   - The missing passes: Inlining (ours runs at `-O3` only), DAE, DuplicateFunctionElimination,
     Precompute, MergeBlocks, SimplifyGlobals.
   - It shows in what survives: we keep 3,943 functions to upstream's 2,663.
   - The cheapest probe is scheduling Inlining at `-O2` / `-Oz`. The earlier "wait for stage 2" is
     lifted: stage 2 is done.
4. ⬚ **LocalCSE is an allow-list of kinds**, so it never reuses what sits under an unlisted kind
   (`extract_lane`, any SIMD). Upstream reuses it.
   - Its share of the **42.1 KB** our twelve passes lose to upstream's same twelve is unmeasured.
   - That 42.1 KB is the budget items 4–6 draw from.
5. ⬚ **LocalCSE runs after SimplifyLocals and CoalesceLocals at `-Oz`**, so the tee it adds is never
   cleaned up: +4 bytes on a repeated binary (measured scoping K3, 2026-09-14).
6. ⬚ **LocalCSE treats a multi-value `return` as opaque** (as it once did `tuple.make`).
7. ⬚ **`RemoveUnusedModuleElements` does not prune unused TYPES.** On the probe it kept 2 type
    entries to upstream's 1 (4 bytes). Not measured over the corpus: the script that would have
    priced it (`scratchpad/names/types.ts`) was session scratch and is gone. Rebuild it: the
    Type-section total, ours vs upstream, at `-Oz`.
8. ⬚ **9 node LITERALS in `src/` bypass their factory** and hand-compute `type` (re-counted
    2026-09-29: inlining 5, optimize-instructions 2, local-cse 1, simplify-locals 1; it was 26
    before the WAT parser was deleted).
    - Count them with `grep -rnE "kind: ExpressionKind\.\w+," src` outside `ir/expressions.ts`.
    - The `br_if` one was wrong. The rest want each literal's type compared to the factory's.
9. ⬚ **Asyncify refuses `call_ref`** (K1's leftover; `passes/asyncify.ts`: "call_ref is not yet
    supported"). Upstream instruments it as an indirect call.
10. ⬚ **`deriveTypes` keeps a plain allocation INEXACT** under custom descriptors
    (`ir/derive-types.ts`, the `StructNew` case), because it does not know the module's features.
    Only the `_desc` forms derive exact. Valid either way; it is less precise than the spec's
    typing.
11. ⬚ **Delete S7's read-back in `wat2wasm`.** `writeBinaryIr` still re-reads its own bytes
    (`binary-writer.ts`, `readBinaryIr`) to predict the text forms, which costs +26–35% on
    `wat2wasm`.
    - The re-read existed only because two front ends built different trees. There is one front end
      now, so predict from the module in hand, delete the read-back, and re-measure.
    - The prediction hash keeps it safe: a residual disagreement prints as predicted, never wrong
      ([ir-convergence.md](ir-convergence.md) § "S7", and § "One front end", stage 2's ⏭️ line).

## Conformance

12. ⬚ **Rank 4 of the wasmtk-ranked list: the five gaps that unblock nothing for wasmtk.** Ranked
    last on their numbers despite 121 occurrences ([handoffs.md](handoffs.md) §§ 4–6). Ranks 1–3 and
    exact types shipped.
13. ⬚ **Bring `proposals/` into the gate.** `spec-prepare` reads the testsuite's top level only.
    Custom descriptors was measured by a scratch harness and its findings pinned. This is the
    owner's call, since behaviour needs a V8 flag per proposal ([testing.md](testing.md) § "The
    proposal testsuites").

## Quality passes — the lens plan (agreed 2026-09-02)

Each round adds a LENS and re-runs every lens below it. Each lens repeats until a pass turns up
nothing new; the re-runs are the point, since fixing a hardening issue can introduce a code issue.
The rounds were named for versions 1.5.6 / 1.5.7 before the releases overtook them, so they keep the
names as labels only.

| round     | lenses, in order                            | state                                                                                    |
| --------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **1.5.5** | code                                        | ✅ passes 1–7, register empty, converged — [testing.md](testing.md) § "The 1.5.5 passes" |
| **1.5.6** | hardening → then code again                 | 14. ⬚ not started                                                                        |
| **1.5.7** | security → then hardening → then code again | 15. ⬚ not started                                                                        |

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

16. ⬚ **A2 — `wasm2ts` is a stub that throws.** The long-term goal is WASI Preview 1 capable
    TypeScript output. **Blocked, and not close:** as of 2026-09-02 the wasmtk side had a long way
    to go before there is anything to implement against.
17. ⬚ **Diagnostic usefulness** ("is the message actionable?") is the one hardening axis never
    attempted. Offsets (A3) and wording are measured ([wabt-ts.md](wabt-ts.md)).
18. ⬚ **Port the three CI shell scripts to Deno/TypeScript** (owner, 2026-09-29: scripting is
    TypeScript only, as a rule). `scripts/check-naming.sh` (git ls-files + awk: a bare
    `binaryen` / `wabt` path component outside `compat/`, `interop/`, `comparison/`; prints
    offenders, empty means pass), `scripts/check-portability.sh` (git grep: no `Deno.*` in
    `src/` / `main.ts`, no `node:` imports outside `tools/` / `cli/`, JSDoc lines skipped; exit 1
    on a hit) and `scripts/cli-smoke.sh` (every dispatcher command under a runtime; prints the
    wat2wasm output's sha256). Callers to change with them: `.github/workflows/ci.yml` lines 53,
    60, 133 (the smoke step runs on Deno, Node 22.18, Node 24 and Bun 1.4.0, so its port must run
    on all four — or stay a thin launcher), [working-rules.md](working-rules.md) § "The gate",
    and `cli_io_errors.test.ts`'s comment. ⚠️ Keep the two lessons the scripts carry: naming
    strips the permitted `-ts` components and tests what remains (the old `grep -v` passed
    everything once `src/binaryen-ts/` existed); portability skips JSDoc (a check that cries wolf
    gets disabled). Invert each port against a planted violation before trusting it.

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
