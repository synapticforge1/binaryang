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
kept free). **Now: the 1.9.0 release** — prepared (`CHANGELOG.md` § 1.9.0, wasmtk's letter
[handoffs.md](handoffs.md) § 26 drafted); the push, the version bump (the arming step, typed by
hand: MINOR) and the letter are the owner's go. Then 24, 21 and the rounds 13 / 14. **6 open
items, none blocking**; numbers 2–7, 9–12, 16, 17, 23 are gone and kept free. Re-derive any number
before quoting it.

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
22. ⬚ **H9 — publish the shared definitions D2 / D3 / D1 as a `./definitions` subpath** (placed on
    the list by the owner 2026-09-30, from wasmtk's letter [§ 23](handoffs.md); the design is the
    workspace's `../cmem/divergences.md` § "The shared definitions", letter H9 in
    `../cmem/handoffs.md`). wasmtk is ready to start H10 (generating their copies) as soon as there
    is a version to pin. What they asked, narrowed to their use:
    - **Order: D2 and D3 first, D1 later.** Their runner uses D2 / D3 today; D1 matters to them only
      when their WAT regexes give way to our parser (I2, after one-front-end stage 5). ⚠️ This
      REVERSES the workspace plan (D1 first, proved by regenerating our own opcode table; D3 last,
      after C1). ✅ **Decided 2026-10-06, owner: "I approve the wasmtk order for definitions"** — D2
      and D3 first, D1 later. (The workspace's `../cmem/divergences.md` still reads D1-first; the
      workspace session updates it, not this one.)
    - **Delivery:** a `./definitions` subpath in a normal release (a new export = MINOR), pinned at
      the same exact version as their other three. A TS module of typed constants, and/or the JSON
      sources in the package at a stable path (for the Rust / Zig consumers). **The content hash and
      the version IN the data**, so their generated copy's header quotes them and their gate proves
      the copy matches.
    - **D2, per feature:** the canonical name (the one `allFeatures()` / `Features` uses); the
      spec-testsuite directories it gates, relative to the testsuite root; whether it CHANGES core
      semantics, not only adds (why they scope `custom-descriptors`: on everywhere it relaxes
      `br_on_cast`, and core `br_on_cast.wast` / `br_on_cast_fail.wast` lose 3 `assert_invalid` each
      — possibly the same fact as D2's "snapshots that must NOT receive it" column); the date it
      entered the list. Engine flag spellings stay theirs, keyed by our name.
    - **D3, per verdict class:** for traps a class key and the testsuite's exact `assert_trap`
      message, with the PREFIX rule stated (`"uninitialized element 2"` matches
      `"uninitialized
      element"`); the same for `assert_invalid` / `assert_malformed` later;
      nothing engine-specific. Entries they filed now (H10 asks for it): `unreachable`,
      `out of bounds memory access`, `out
      of bounds table access`,
      `out of bounds array access`, `undefined element`, `uninitialized
      element`,
      `indirect call type mismatch`, `integer divide by zero`, `integer overflow`,
      `invalid conversion to integer`, `cast failure`, `descriptor cast failure`, `null reference`,
      `null structure reference`, `null array reference`, `null i31 reference`,
      `null function
      reference`, `null descriptor reference`, `unaligned atomic`;
      `call stack exhausted` for `assert_exhaustion`. Proposals their gate treats specially:
      `wide-arithmetic` (every file), `custom-descriptors` (scoped), `custom-page-sizes` (through
      `LowerCustomPageSizes`).
    - **D1, later:** mnemonic and legal shorthands, immediate syntax (`offset=` / `align=`), stack
      signature, gating feature; a coarse operator class ("numeric binary") would let them DERIVE
      their 13 never-a-pointer `i32` operators — that judgment stays theirs.
    - Their side (H10), for reference: `scripts/gen-definitions.ts` → committed
      `src/definitions.generated.ts`; their gate regenerates and diffs, inverted once.
    - ✅ **D2 and D3 built 2026-10-06 (unreleased; D1 is what is left of this item).** Sources
      `src/definitions/features.json` (D2: 22 entries — `name` = the `Features` key, `cli`,
      `defaultOn`, `implemented`, `testsuiteDirs`, `onlyIn` / `offIn` for a feature that changes
      core semantics, `note`, `since`) and `verdicts.json` (D3: 19 trap classes +
      `call stack
      exhausted`, `key` / `message`, the PREFIX rule stated in the data). Each
      carries `dataVersion` and a `sha256` of its canonical content (keys sorted, the hash field
      empty). `deno task
      definitions` stamps the hashes and GENERATES
      `src/definitions/data.ts`; `--check` changes nothing and fails on a stale hash or a generated
      module that differs; `--prepared <roots>` also proves D3 has a class for every trap /
      exhaustion message the prepared suites write (21 distinct across core, the four proposals and
      legacy EH — inverted once: dropping `unaligned-atomic` trips all three checks). Subpath
      `./definitions` (`mod.ts`: `FEATURE_DEFINITIONS`, `VERDICT_DEFINITIONS`, `verdictClass(text)`,
      `featuresForSuite(dir)`) — a new export, so the release is a MINOR; the JSON ships in the
      package. binaryang is the first consumer: `scripts/proposals.ts`, the core spec harness and
      `measure-diagnostics.ts` take their feature sets from D2 (`suiteFeatures`), with `spec` and
      `proposals` green on it (custom-descriptors is now off in `threads` / `wide-arithmetic` /
      `custom-page-sizes` too, per its `onlyIn`; none of those suites tests `br_on_cast`).
      `tests/definitions/` asserts the data against the code: one entry per `Features` key in order,
      `defaultOn` = `defaultFeatures()`, every `cli` accepted by `FeatureFlags`, only
      `compactImports` unimplemented. Gate step `definitions`. A letter to wasmtk goes WITH the
      release (§ 24 in [handoffs.md](handoffs.md), to draft then): the version to pin, the field
      list, the prefix rule. **Next: D1** (the opcode + immediate table; their I2 trigger).
    - ✅ **D1 built 2026-10-06 — the item's three definitions are done (unreleased); it closes with
      the release and the letter.** `src/definitions/opcodes.json`, 582 entries: `name`, `encoding`
      (hex, LEB sub-opcode), `prefix`, `opcode`, `immediates` (kinds in binary order — the
      vocabulary is in the data's `rules`), `align` (memarg width), `signature` (fixed stack types,
      `addr` = the memory's index type; 498 of 582 — null where an immediate or the stack decides),
      `feature` (a D2 name), `class` (coarse: wasmtk's "numeric binary" ask). Populated once from
      `opcode.ts` plus rules by mnemonic (scratch `d1populate.ts`), then PROVED, as the data's
      `proof` rule says (`tests/definitions/opcodes.test.ts`): every entry decodes as ONE
      instruction and re-encodes to its bytes; every signature validates (addr i32, and i64 on
      memory64) and is refused with its first or its last operand changed; align is exactly natural
      (one step above is refused); every gated instruction with a signature is refused with its
      feature off. Each check inverted when written (a dropped / extra immediate, a wrong operand, a
      wrong align, a gate removed — the extra immediate survived until the one-instruction count was
      added: its sample byte decoded as `unreachable`). **binaryang now reads D1:** `opcode.ts`'s
      name tables and `naturalAlignForOpcode` (~790 hand-kept lines) are built from it;
      `check-operator-mapping.ts` reads it. What the proof found, all fixed:
      - 🔧 **Five features were gated NOWHERE** — `simd`, `signExtension`, `satFloatToInt`,
        `bulkMemory`, `referenceTypes`: with the feature off, `v128.load`, `i32.extend8_s`,
        `memory.copy`, `table.get`, `ref.null` … validated (254 of 345 gated instructions with a
        signature). They are wabt's default-ON features, which hid it. Now one gate in the validator
        (`everyExpr`, a new `ExprVisitorDelegate` hook) asks D1 for each instruction's feature; the
        other features keep their dedicated handlers, so nothing reports twice. ⚠️ The hook is NOT
        named `on…`: three delegates (text-form, WAT writer, binary writer) are Proxies answering
        every `on…` / `begin…` / `end…` name — named `onAnyExpr` it broke 18 test files, each
        recording every instruction twice.
      - 🔧 **`i64.add128` / `i64.sub128` checked three operands and dropped the fourth** — the FIRST
        — unchecked: an `i32` there validated. A test had pinned the three-type message.
      - 🔧 `delegate`, `catch_all`, `try_table` had no name (a disassembly printed `<opcode:0x1f>`);
        and the lexer gave `delegate` no opcode, unlike `else` / `catch_all`. What D1 does NOT
        prove: the NAME of an index space in an immediate (a `memidx` and a `tableidx` are both one
        LEB) beyond what the signature check resolves; text shorthands (wasmtk's I2 list) beyond the
        mnemonic and the memarg's `offset=` / `align=`.
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
