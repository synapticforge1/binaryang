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

**State, end of 2026-10-12 (this supersedes the 2026-10-09 line above; all merged to `main`, NOT
PUSHED; the version stays 1.10.0):**
- **Done this session:** item 26 B1, B2 and B4 (the Bun migration; scripts run from Bun);
  item **27** closed (interp `Stop(invalid)`); item **28** parts 1, 2, 4 and 5 (every export loads
  in a browser, held by `bun run browser` with `--external 'node:*'` plus `bun run portability`;
  `wasmOpt` takes bytes; the source is erasable TypeScript, so Node 22–26 run it with NO flag;
  every current Node LTS tested by `bun run lts` through fnm, and CI by `setup-node`). The guide for
  the other JSR packages is [jsr-deno-exit-guide.md](jsr-deno-exit-guide.md).
- **Who runs what** (owner, 2026-10-12): **Deno for JSR only** (`deno publish --config jsr.json`
  and its dry run; `deno check` / `test` / `fmt` remain until B3 / B5). **The V8 referee** for
  the engine-oracle steps is Node 24 through fnm, named once in `scripts/v8.ts`, with Node 26 for
  custom-descriptors and Bun for wide-arithmetic, each measured equal to Deno's results.
  **Everything else** runs on Bun. fnm holds Node 22, 24 and 26.
- **The next release is a MINOR, 1.11.0** ([unreleased.md](unreleased.md)): new exports,
  deprecations, the `./ir` subpath, and now a type-level BREAKING change (the 19 exported `enum`s
  are const objects).
- **6 open items:** 13 (hardening; code lens pass 1 on the unmerged `code-lens-13`), 14
  (security), 15 (`wasm2ts`, blocked on wasmtk), 25 (remove the deprecated subpaths, after
  1.11.0), 26 (Bun migration: B3, B5, B6, B7), 28 (part 3, a headless browser; the in-browser
  optimization measurement; precise operator unions, a follow-up).
- ⚠️ **`code-lens-13` CONFLICTS with `main` in one file, `src/ir/derive-types.ts`** (everything
  else auto-merges). The branch adds a NEW constructor parameter property there
  (`private readonly discarded?: Discarded`) in the constructor part 4 converted. Merging means
  resolving that hunk AND converting the property to the `declare` form; `erasableSyntaxOnly` (on
  in tsconfig and deno.json) refuses it otherwise. Its own process still applies first: one
  convergence re-run that adds no row.
- **Dates:** Node 26 becomes LTS on 2026-10-28 (ready: it runs the source; `bun run lts` will
  require it that day). Node 22's end of life (2027-04-30) needs NO action: `bun run lts` follows
  the schedule. Deno keeps working after its development ends (owner, 2026-10-12).
- **Owner, 2026-10-12: the NEXT project is universal-wasm-loader** (Bun cannot import `.wasm`;
  the guide's F11), worked in ITS repo, not from here.

**State, end of 2026-10-13 (supersedes the 2026-10-12 paragraph where they differ; all merged to
`main` and PUSHED; owner: "lets update the project memory files and then ship 1.11.0"):**
- 🚀 **1.11.0 PUBLISHED** 2026-10-14T01:12:58Z (UTC) with provenance (Rekor `3247643457`), the first
  publish through the Bun workflow: B6 / B7 proven, **item 26 CLOSED**. ([publishing.md](publishing.md) § "1.11.0".)
- **Item 26, the Bun migration: DONE (closed with the 1.11.0 publish).** B3 (Biome for `deno lint`, dprint for
  `deno fmt` byte for byte, each with a canary; no `biome-ignore` left), B5 (the suite on
  `node:test`: `bun run test` on Node 24 is the verdict, `bun run test:bun` must fail exactly 36
  listed JavaScriptCore differences), B6 (auto-tag off Deno; publish.yml runs CI's checks, then
  the one direct `deno publish`), B7 (no `deno.json`; `deno publish` finds `jsr.json` itself; the
  standalone `comparison/` runs again). **B6 / B7 proven by the 1.11.0 publish (Rekor `3247643457`).** [bun-migration.md](bun-migration.md) has each step.
- **Who runs what:** Deno for `deno publish` (and `deno doc` in one test, and the Deno-run
  `comparison/`); Node 24 for the test verdict and the engine-oracle scripts; Bun for everything
  else.
- **Item 28:** `Opcode` is the union of the 582 real instructions, generated from `opcodes.json`
  (`src/definitions/instr-code.ts`); the 43 opcode casts are gone; the reader now refuses a reserved
  SIMD sub-opcode it used to accept. Open: the headless-browser run (Playwright or Puppeteer: the
  owner's call) and the in-browser optimization measurement.
- **wasmtk's Asyncify report (handoffs.md §§ 28-29, the reply SENT by the owner):** TinyGo 0.43's
  goroutine builds crashed `Asyncify`; the cause was an analysis divergence (upstream stops
  propagation at the bottom-most runtime); fixed, and wasmtk's reproducer runs correctly
  (`wg-counter: 45` on wasmtime and wasmer).
- **1.11.0** carries all of it ([unreleased.md](unreleased.md)): a MINOR (new exports, type-level
  BREAKING entries: the enums as const objects, `Opcode` narrowed).
- **5 open items:** 13, 14, 15, 25 (now schedulable: 1.11.0 shipped), 28. 29 (npm as a second
  registry) PARKED as a contingency. The `code-lens-13` conflict above still stands.
- ⚠️ This machine's exFAT drive can fail a big `git merge`; check status and `MERGE_HEAD`, and if
  clean, retry (`local/environment.md`, private).

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
    - 🔧 **FIXED 2026-10-12 by part 4** (the source is erasable TypeScript; Node 22.18–26 run it with
      no flag). As found: **Node 26+ cannot run the TypeScript source**: it removed `--experimental-transform-types`
      (strip-only), and `src/` has `enum`s and constructor parameter properties. Node 24 keeps
      the flag until its end of life, 2028-04-30. The PUBLISHED package (JSR's compiled JS) runs
      on Node 26 unchanged.
    - **Engines differ, as measured** ([bun-migration.md](bun-migration.md) § "The engine
      oracle"): Bun's JavaScriptCore lacks memory64 and accepts 70 invalid core modules. V8
      versions: Node 24 13.6, Node 26 14.6, Deno 2.9.7 15.0, Chrome stable 156 = **15.6** (the
      newest V8 anywhere, 2026-10-07). Nesting-depth ceilings differ per runtime stack (the
      `hostile` depth table).
    **Progress (2026-10-12, owner: "Work on 27 first then 28"):** parts **1, 2 and 5 DONE** on
    branch `run-everywhere-1`. All 22 exports bundle for the browser; `bun run browser` (new, in
    CI) and `bun run portability` (now tree-wide: no top-level runtime `node:` import anywhere)
    hold it, and each was shown to FAIL on the old form of a tool. 🔧 **That proof was
    incomplete** (owner, 2026-10-12: "Bun silently stubs out a top-level node:fs import"): the old
    tool used `node:process`, whose missing default export makes Bun FAIL the build, while
    `node:fs` is STUBBED, so a used top-level `node:fs` import in a library file passed
    `check-browser.ts`. `check-portability.ts` caught it, so nothing shipped through the gap.
    Fixed: the bundle uses `--external 'node:*'`. The `node:fs` mutant now fails, a `node:path` one
    fails 14 of 22, and the old regression still fails 2. `wasmOpt` takes bytes.
    **Part 4 DONE too (owner: option "1", 2026-10-12), branch `erasable-ts`:** the 49 non-erasable
    constructs are gone. 29 constructor parameter properties became `declare` fields plus
    assignments, the same runtime shape. 20 `enum`s (19 exported) became `const X = {…} as const` +
    `type X` + a type-only `declare namespace X`, so `X.Member` works as a value AND as a type.
    Every value was computed and checked against the old enum objects (572 members, all equal).
    `erasableSyntaxOnly` is on in `tsconfig.json` and `deno.json`, so it cannot come back. Node
    22, 24 AND 26 now run the source with NO flag, the same CLI hash as Deno and Bun. The flag left
    every script, CI and the docs; CI tests Node 26. What the stricter types exposed:
    `exp.kind in ExternalKind` (relied on reverse keys; every export read as unknown, caught by
    cli-smoke); `Opcode` used across the IR for COMBINED `(prefix << 16) | sub` values that are
    not members (so the `Opcode` TYPE is deliberately `number`, the strictness it always had; a
    precise union is a follow-up); a name-section set holding unknown ids. **Open:** part 3 (a real
    headless-browser run: headless Chrome, V8 15.6, running the library on the corpus with the
    same hash as the other runtimes; it may also be the engine REFEREE once Deno is gone, item 26);
    the in-browser optimization measurement (below). **Precise operator types DONE 2026-10-13**
    (owner: "Precise operator types first", then "One generated instruction union"). ⚠️ The
    follow-up's premise was wrong: "a union of each table's values" would have made the ~116
    instructions no table names (atomics, relaxed SIMD) unrepresentable, against S6 stage 1
    ([ir-convergence.md](ir-convergence.md)). Instead `scripts/definitions.ts` generates
    `src/definitions/instr-code.ts` from `opcodes.json`: `InstrCode` (the 582 real instructions, in
    the IR's encoding), `INSTR_CODES`, `isInstrCode`; `Opcode = InstrCode`, so every operator type
    narrows with it. Measured first: every value the code uses (the `Opcode` / `MiscOpcode` /
    `GcOpcode` tables, all 9 operator tables) is among the 582. The 244 prefixed table members are
    hex literals (values proven identical); all **43 opcode casts are gone**: the binary reader's
    misc / SIMD / atomic decoders ask `isInstrCode` first, the lexer's keyword table checks each
    entry at load, the parser reads typed tokens. **What the types found:** the SIMD decoder took
    ANY sub-opcode as a binary op (reserved `0xfd 0x9a` validated clean, `wasm2wat` printed
    `<opcode:0xfd009a>`, V8 refused it); fixed, `reserved_subopcodes.test.ts` (fails 22 cases on the
    old reader). Public: `InstrCode` / `INSTR_CODES` / `isInstrCode` beside `Opcode`
    ([unreleased.md](unreleased.md): a type-level BREAKING entry and a behaviour fix).

    **Node LTS policy (owner, 2026-10-12): "support and test all currently available lts
    versions."** As of 2026-10-12 that is Node 22 "Jod" (22.23.3) and Node 24 "Krypton" (24.21.0),
    both in CI's `runtimes` matrix (22.18 floor, latest 22, latest 24, and latest 26 ahead of its
    LTS on 2026-10-28; no flag on any). fnm holds 22, 24 and 26. Locally, **`bun run lts`**
    (`scripts/check-lts.ts`) takes the lines from Node's release schedule (`nodejs/Release`
    `schedule.json`: LTS started, end of life not reached) and runs `cli-smoke` on each through
    `fnm exec` (fnm 1.39.0, owner's choice, 2026-10-12). Same hash on v22 and v24. A line fnm
    lacks FAILS, naming `fnm install <n>`. ⚠️ **DATE: Node 26 enters LTS on 2026-10-28** (the
    schedule; Node 24 enters maintenance 2026-10-20). From that day `bun run lts` REQUIRES v26, and
    Node 26 removed `--experimental-transform-types`, so it fails until part 4 makes the source
    run on it, or until a leg tests the COMPILED package. That makes part 4 urgent: 16 days.
    🔧 **Resolved the same day:** part 4 is done, and Node 26 runs the source (measured with the
    portable 26.11.1).

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
    compat names, but say so. **When is the owner's call** — the `./ir` release (1.11.0) went out 2026-10-14, so it can be scheduled now.

(Item 26 closed 2026-10-14 (UTC) with the 1.11.0 publish: the development toolchain moved from Deno
to Bun, JSR kept as the source. B1–B7 are in [bun-migration.md](bun-migration.md); the proof of the
last two, the first publish through the new workflow, recorded provenance, Rekor log id
`3247643457`. Deno remains for `deno publish`, one `deno doc` test and the Deno-run `comparison/`.
Its number is kept free.)

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
- **29. npm as a second registry — PARKED as a contingency** (owner, 2026-10-13). First: "I think
  it would be good to add this repo to npm also just in case the jsr gets shut down … We probably
  need to do this for all of our repos"; then, after creating the `synapticforge` organization on
  npm and GitHub: "I am leaving it on jsr until it becomes necessary to do otherwise." The GitHub
  repo stays `jrmarcum/binaryang` and the JSR scope stays `@jrmarcum` (both "not now" / "no").
  - The plan is kept, ready: [publishing.md](publishing.md) § "npm as a SECOND registry"; for the
    other repos, [jsr-deno-exit-guide.md](jsr-deno-exit-guide.md) § 5b.
  - **Trigger to reopen:** JSR announces an end or degrades, or a consumer needs the package from
    npm. The npm name is chosen THEN; `@synapticforge/binaryang` was free on 2026-10-13.
  - Not blocked by anything; B6 is still the natural place for the release-path half.
- **A local directory path in git history — leave it** (owner, 2026-09-14). The copies in
  `b472b4aa4` and `df3659840` name no account, token or secret, and are not worth a force push. Do
  not re-open.
- **JSR and GitHub descriptions on the predecessors — won't do** (owner, 2026-09-02); they are
  frozen.
- **Converging the two IRs further is not a release task.** It is open-ended by decision 1 and
  tracked by `deno task collisions` ([project.md](project.md)).
- **D4 — never yank, ever** ([project.md](project.md)).
- **The predecessors are frozen**: no change to `binaryen-ts` or `wabt-ts` on GitHub or JSR.
