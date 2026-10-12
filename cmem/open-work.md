# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

**State, end of 2026-10-09:** `binaryang@1.10.0` is the last release (`wasm-bundle` —
[bundle.md](bundle.md), [publishing.md](publishing.md) § 1.10.0). **On `main`, UNRELEASED and
NOT PUSHED:** item 21 closed — one `src/` tree, one declaration per name (collisions 88 → 0, the
compat names renamed with deprecated aliases), one IR subpath `./ir` with the three old ones
deprecated ([one-tree.md](one-tree.md)); round 13 (hardening) passes 1–2 — malformed input gets
a typed answer everywhere, the weakest nesting ceiling ~384 → ~930; and the interpreter's HANG
CHECK, interval 2 s set from measured run times ([hardening.md](hardening.md)). The next release
is a MINOR, 1.11.0 (new exports, deprecations, one type-level breaking change —
[unreleased.md](unreleased.md)), typed by hand when the owner says. wasmtk's letter
[handoffs.md](handoffs.md) § 27 SENT by the owner; it asks their measurement once wasic marks its
addresses. **Next: round 13 goes on — the code lens again, then a hardening pass that re-runs
`deno task hostile` until a pass finds nothing; deeper nesting ceilings are the OWNER's priority
call. Then 14 (security); 25 after the `./ir` release; 15 stays blocked on wasmtk. 4 open items,
none blocking**; numbers 2–7, 9–12, 16, 17, 21, 22, 23, 24 are gone and kept free. Re-derive any
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

**None open.** (Item 27 closed 2026-10-12: the interpreter's constant-expression evaluator never
checked that an expression left a value, so `(offset nop)` on an unvalidated module escaped as a
bare `TypeError`; now `Stop(invalid)` — [hardening.md](hardening.md) § "2026-10-12 — open-work 27".
Its number is kept free.)

28. ⬚ **"Runs everywhere" is not true today; bring it back into line** (owner, 2026-10-12:
    "Sounds like our run everywhere motto needs some effort to bring it back into line. We need
    to work on that effort."). Measured 2026-10-12, during Bun migration B4:
    - **Browsers: 15 of 22 exports do not even BUNDLE for the browser**
      (`bun build --target=browser`). They include `./wat2wasm`, the README's quick-start import,
      and the library entries `./api`, `./passes`, `./compat/binaryen`. Only `./ir`, `./ir/*`,
      `./core/wabt-ts`, `./compat/wabt`, `./wasm`, `./wasm-runtime` and `./definitions` are
      clean. One cause: each `src/tools/*.ts` imports `node:process` (and some `node:fs`) at
      the TOP for its CLI `main()`, which makes the module unloadable in a browser even for its
      pure library function. `src/passes/memory-packing.ts` imports `tools/wasm-ctor-eval.ts`,
      which spreads that to `./api`, `./passes` and `./compat/binaryen`. The portability gate
      checks DIRECT `node:` imports outside the CLI layer, not what is reachable through
      imports, so it stayed green. The README's "modern browsers" claim is untested: no CI job
      runs a browser.
    - **Node 26+ cannot run the TypeScript source**: it removed `--experimental-transform-types`
      (strip-only), and `src/` has `enum`s and constructor parameter properties. Node 24 keeps
      the flag until its end of life, 2028-04-30. The PUBLISHED package (JSR's compiled JS) runs
      on Node 26 unchanged.
    - **Engines differ, as measured** ([bun-migration.md](bun-migration.md) § "The engine
      oracle"): Bun's JavaScriptCore lacks memory64 and accepts 70 invalid core modules. V8
      versions: Node 24 13.6, Node 26 14.6, Deno 2.9.7 15.0, Chrome stable 156 = **15.6** (the
      newest V8 anywhere, 2026-10-07). Nesting-depth ceilings differ per runtime stack (the
      `hostile` depth table).
    **Proposed plan, owner to order:** (1) tools: move the Node-only parts INSIDE each `main()`
    (`globalThis.process`, an on-demand `import('node:fs/promises')`), so every export bundles
    for the browser with the API unchanged, and move `packMemory` out of the CLI layer; (2) a
    reachability portability gate: bundle every export for the browser in CI and fail on any
    `node:`; (3) a REAL browser job: headless Chrome running the library on the corpus, the
    same hash as the other runtimes; (4) decide erasable-only TypeScript (`enum` → const object
    plus type, parameter properties → fields) so Node ≥ 26 runs the source. That changes
    exported types and is a minor at least; (5) a BYTES-in / bytes-out optimizer export:
    `wasmOpt(inputPath)` reads a FILE with `node:fs` and its byte-level core `_nativeOptimize`
    is private, so a page has no way to optimize bytes it holds. Accepting a `Uint8Array` as
    well is additive. The binaryen.js-shaped `readBinary → optimize → emitBinary` already takes
    bytes, but is blocked by (1).

    **The use case that justifies the browser (owner, 2026-10-12):** a page optimizes a wasm
    module ON THE USER'S MACHINE and hands it back (a download, or straight to
    `WebAssembly.instantiate`), "beneficial if the wasm file being called was never optimized
    to start with. At least it would run faster in the browser once downloaded." Caveats, as
    discussed: it runs AFTER the download, so the first download is not smaller; the client pays
    the optimization time unless the result is cached (Cache API / IndexedDB); a site that
    controls its module should optimize at build time instead. The browser path serves modules
    the site does NOT control (third-party, user-supplied, playgrounds). Run it in a Web Worker,
    keep the original, and fall back to it if the optimized bytes fail the browser's validation.
    **Measure before building on it:** a few unoptimized (debug / `-O0`) modules; in Chrome,
    compile time and run time before vs after, and the optimizer's own time in the browser. No
    run-time speedup has been measured yet, so promise none.

Items 18–20, from wasmtk's § 20, were fixed for 1.8.1 the day they arrived: L3 (a
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
| **1.5.6** | hardening → then code again                 | 13. ◐ passes 1 (the contract) and 2 (the weakest ceiling, ~384 → ~930) DONE 2026-10-09, and the fuel question answered by a sound HANG CHECK (2 s); open: the code lens again, then a hardening re-run until clean; deeper ceilings are the owner's call — [hardening.md](hardening.md) |
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
25. ⬚ 🗓️ **Remove the deprecated IR subpaths and names — in a minor AFTER the one that ships
    `./ir`** (open-work 21 phase 4, owner 2026-10-09: "I agree with your suggestion. Proceed").
    Remove `./ir/binaryen-ts`, `./ir/wabt-ts`, `./core/wabt-ts` from `deno.json` (the files stay
    as `./ir`'s internal barrels or fold into `src/ir/index.ts`), and the deprecated `Type` alias
    of `ExprType` in `src/ir/binaryen-ts.ts` and `src/api/index.ts`, and the deprecated `Features`
    / `WasmModule` aliases in `src/compat/wabt-compat.ts`; `ir_subpath.test.ts` and
    `compat_type_names.test.ts` then pin the new surface. A letter to wasmtk first: they pin
    `compat/*` and `wasm-validate`, not the IR subpaths, and declare their own types for the
    compat names, but say so. **When is the owner's call** — not before the `./ir` release is out.

26. ⬚ 🗓️ **Move the development toolchain from Deno to Bun; JSR stays the source** (owner,
    2026-10-12). Deno runtime development ends around 2027-10 (the team joined Cloudflare). The
    published package is already runtime-neutral; tests, scripts, fmt / lint / check and CI are
    not. Steps B1–B7 with findings and risks: [bun-migration.md](bun-migration.md). **B1 (`jsr.json`
    is the one manifest) is merged.** ✅ **Decided 2026-10-12: code that runs on both Bun and Node, with Bun as the main runtime**
    (bun-migration.md § "Bun or Node"). B2 (project files, `tsc`) is next.
    The README's install and CLI instructions no longer depend on Deno (2026-10-12). B6 (the release path) is the one step
    that cannot be undone. The deadline is about a year away, so the owner orders it against
    items 13 and 14.

(Item 21 closed 2026-10-09: one `src/` tree by concept, one declaration per name, one IR
subpath — [one-tree.md](one-tree.md): the four phases, the decisions, what the gate found. Its
number is kept free; the follow-up is item 25 above.)

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
  - The code stays as it is: `wasm-runtime.ts`, the demo kernel in `src/wasm/`, the
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
