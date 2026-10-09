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
CLOSED** with it ([definitions.md](definitions.md)). **Now: item 24** (`wasm-bundle`, the owner's
item 3). Then 21 and the rounds 13 / 14. **5 open items, none blocking**; numbers 2–7, 9–12, 16,
17, 22, 23 are gone and kept free. Re-derive any number before quoting it.

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

24. ⬚ 🗓️ **`wasm-bundle` — take wasmtk's `wasmbundle` into our tools, and wasmtk imports it back**
    (owner, 2026-09-30: "incorporating wasmtk's wasmbundle into our cli tools and offload that from
    wasmtk. And import it back for use there"; "we will probably want to call it wasm-bundle in our
    tools section"). Nothing is written into wasmtk from here: they drop their copy and pin ours by
    their own session, from a letter, once there is a release to pin. Facts read from their tree
    2026-09-30 (re-derive before acting):
    - **What it is:** `src/wasmbundle.ts` (413 lines) bundles N standalone `.wasm` (WASI programs or
      libraries) into ONE library: export-name conflicts resolved (interactive prompt, or
      `--on-conflict=prefix|alias|exclude`, `--alias a.wasm=m`), WASI imports deduplicated, every
      module's data RELOCATED into one memory, `_start` kept, then `-Oz`. The merging itself is
      `src/wasmmerge.ts` (991 lines) — REGEXES over printed WAT (`readWasm` → `toText` →
      `parseWat`), which `wasic.ts` also uses; the data relocation decides "never a pointer" by
      operator (`ARITH_NEVER_PTR`, 13 `i32` ops) — a heuristic. Their tests: `bundle_tests.ts` (179
      lines), `merge_tests.ts` (245), `wasmmerge_guard_tests.ts`.
    - **So it is a REWRITE on the IR, not a port of the text:** index spaces (types, functions,
      globals, tables, memories, tags, data, elems) renumbered on the tree — which also retires I2's
      regexes for this path (`../cmem/divergences.md` I2). Upstream binaryen's `wasm-merge`
      (installed here) is the reference for the linking half.
    - ✅ **Decided 2026-10-06, owner: ONE memory, relocated EXACTLY — no multi-memory mode, ever**
      ("no future multiple memories that breaks 'runs everywhere'"; "exact relocation instead of
      guessed. This is why I want it in this repository and out of wasmtk. This repository has more
      experience with this side of the process"). Why, as weighed that day: multi-memory breaks WASI
      (`fd_write` reads the one exported `memory`), wasmtk's host bindings (one `memory` export),
      cross-module pointers, and wazero (it failed exactly the two multi-memory modules in wasmtk's
      § 20 run). Exact means the PRODUCER marks its data addresses — a relocation section as
      `wasm-ld` objects carry, or position-independent code with a `__memory_base` global — so
      nothing is guessed; a module without the marks is refused, or relocated by today's
      range-scoped rule with a printed warning, never silently. Which marking wasmtk's producers
      (`wasic`, the Go / Zig / Rust wrappers) emit is settled with wasmtk by letter when this item
      starts. **Letter § 24 SENT 2026-10-06** ([handoffs.md](handoffs.md)): proposes the
      tool-conventions Linking format (`linking` + `reloc.*`, `wasm-ld --emit-relocs`) and asks
      wasmtk to measure, per producer, whether it can emit it. Building waits on that answer.
      **Answered: § 25** (2026-10-06, measured): Rust yes; Zig and TinyGo only object +
      `wasm-ld --emit-relocs` (TinyGo's own build runs `wasm-opt` after linking, leaving STALE
      relocations: 0/48 address sites correct); wasic needs our part first. **The design points it
      fixes:**
      - consume relocations as the module is READ, each tied to its instruction node, before
        anything rewrites a byte — our own reader → writer re-encodes the padded LEBs `wasm-ld`
        writes at relocation sites, so a byte offset is valid only against the original bytes;
      - VERIFY every relocation against the code it names, and refuse a stale one as a missing one
        (their site check is the start: `i32.const` + 5-byte LEB, `call` / `ref.func`);
      - bundle BEFORE optimisation; `linking` with no `reloc.CODE` = nothing to relocate;
      - `reloc..debug_*`: drop the DWARF sections with a printed note (proposed default) or
        relocate;
      - for wasic: a WAT form that marks an address and an assembler writing `linking` / `reloc.*`
        from it. ✅ **Decided 2026-10-06, owner: an ANNOTATION in the WAT** — the text format's
        standard annotation syntax (annotations proposal), e.g.
        `(i32.const 1024 (@reloc data $str_0))`, one file, through our parser; we define the
        annotation's meaning and document it for wasmtk (not a relocation list beside the WAT, not
        wasm-ld objects only). The exact spelling is ours to propose when the item starts. (wasmtk's
        current rule, their header: "range-scoped … but still address-based, not dataflow-exact".)
    - **Scope questions:** whether `wasmmerge.ts`'s `wasic` path moves too or stays theirs; what
      stays in wasmtk (`witgen`'s WIT emission beside the output; the interactive prompt belongs to
      a CLI — ours or theirs).
    - **Surface:** a `wasm-bundle` CLI tool and a `./wasm-bundle` subpath — a new export, so a
      MINOR; their pin moves to four specifiers (five with item 22's `./definitions`).

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
