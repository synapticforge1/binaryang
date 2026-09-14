# binaryen-ts — the predecessor's memory, summarized

binaryen-ts brought a wing of 14 files (3,586 lines) into the merge, at `cmem/binaryen-ts/`. On
2026-09-14 it was **corrected and summarized into this one file**, and the directory was removed.
The policy is in [INDEX.md](INDEX.md) § "Cleanup policy": cmem is working memory, and git is the
archive.

**How to read it.** There is one section per wing file. Each section says what the file was and how
it ended, then gives:

- **Kept** — what still matters, tagged by kind:
  - `[decision]`
  - `[lesson]`
  - `[reference]`
  - `[trigger]` — a condition that makes something act
  - `[baseline]` — a measurement to compare against
  - `[correction]` — a wing claim that is no longer true
  - `[open]`
- **Already in the core** — pointers to where the rest lives now.
- **History** — a summary, with commits.
- **Full text** — the whole file, one command away: `git show 9758fc736:cmem/binaryen-ts/<file>`.

**`⟶ S6` marks a wing rule the S6 convergence superseded**, and names what replaced it
([ir-convergence.md](ir-convergence.md), [divergences.md](divergences.md)). Do not carry those rules
forward.

**Paths were rewritten to this tree** and checked on `c6bbf7d71`:

- `src/{ir,binary,encoder,parser,passes,api,interop,tools,wasm}/…` → `src/binaryen-ts/…`
- `tests/{binary,passes,…}/*_test.ts` → `tests/binaryen-ts/…/*.test.ts`
- `upstream/src/…` → `WebAssembly/binaryen/src/…`

**The full texts are not corrected**, so translate a path from them before following it.

**Two ID families live here:**

- **UP-1…UP-7** — upstream findings from wabt-ts.
- **WT-1…WT-2k** — the wasmtk migration series.

Both are cited from `src/`, `tests/` and `scripts/`. Their index is in the `phases.md` section, and
their root causes are in the `correctness.md` section.

**Open items this summary found** were verified and moved to [open-work.md](open-work.md).

## `binaryen-ts/correctness.md` (1,213 lines) — the fail-loud contract and the bug log

The predecessor's load-bearing record: the robustness contract, then every correctness sweep newest-first — the
multi-value writer and `try_table` catch scope (2026-08-25), three "look for code issues" sweeps, the
`noUncheckedIndexedAccess` rollout (261 errors → 0, 4 real defects), the region-body class, UP-1…UP-7 (wabt-ts's
upstream findings, all fixed), corpus round-trip closure, the duplicate-dispatcher sweep, the TranslateEH scoping,
the 2026-07-07 fail-loud audit (20 fixes), Tiers 1–4 / A–C, the branch-depth fix and the WT-1…WT-2k series from
the wasmtk migration. Every fix carries a regression test; suites grew 310 → 501 across it. It ended with every
listed defect fixed and one live gap, TranslateEH.

**Kept**
- [decision] **The robustness contract**: every name / type / index / opcode / label / type-id resolution in
  parser → pass → encoder either succeeds or THROWS (`WasmEncodeError` / `WasmBinaryError` / `WatParseError` /
  `TypeError`); no silent fallback may emit valid-but-wrong wasm. Non-MVP constructs out of scope fail loudly.
  Owner policy with it: fix footguns immediately; defer only when the fix itself risks rejecting valid input.
- [lesson] **Valid ≠ semantically equivalent.** Every WT-2 miscompile validated. Instance: WT-2c #4, `makeIf`
  mistyped → DCE deleted a loop back-edge, `_fib` returned 0.
- [lesson] **A decode rule with no matching encode rule hides itself**; a round trip proves only that the halves
  agree. Pin against an outside oracle with a fixture whose candidate readings disagree. Instance: `try_table`
  catch depths resolved one frame too deep on BOTH sides (2026-08-25), caught only by a V8 fixture where depth 0
  and 1 give different verdicts; tests in `tests/binaryen-ts/binary/eh.test.ts`.
- [reference] **Scope rule**: a `try_table`'s own label is NOT in scope for its catch destinations, and a `try`'s
  own label not for its `delegate` (spec; wabt-ts hit the same pair — ir-convergence § "The block/label family").
- [reference] **Type indices**: every site that EMITS a type index must resolve against the table
  `encodeTypeSection` actually emits (`mod.heapTypes` when non-empty, else the deduped table) — the orderings are
  unrelated, so the wrong table is right only by luck. Instances: WT-2d (tag section), the six multi-result
  blocktype sites (2026-08-25, `blockTypeIndex` + `ensureHeapFuncType`, which appends into a working COPY so
  encoding never mutates the caller's module). Test with a fixture declaring types in the opposite order from
  the dedupe walk (`BLOCK_TYPE_INDEX_ORDER`, `tests/binaryen-ts/binary/multivalue.test.ts`).
  ⟶ S6 7c: a DECODED `call_indirect` / block header now records the index it named (`typeIndex` on the node,
  `written_type_index.test.ts`); `PassRunner` drops it before the first pass, so derived indices still need the rule.
- [reference] **`!` only where the bound is visible in the same function** (`reader.ts`: each byte read sits under
  a throwing `checkBounds`). Widen a helper's parameter to `| undefined` rather than scatter `!` — absent is the
  same answer as wrong kind.
- [reference] **Start function is a reachability root** like exports and element segments:
  `remove-unused-module-elements.ts` and `inlining.ts` both seed from `module.start` (verified in code). Any new
  pruning pass or new module-level root goes in both. The encoder tests `mod.start != null` LOOSELY on purpose
  (absent field = no start). Test: `tests/binaryen-ts/binary/start_section.test.ts`.
- [reference] **UP-1 packed get**: packedness comes from the field's `StorageType` (`packedGetSubop`), not the
  IR's `signed` flag; the WAT parser rejects a get/get_s/get_u that disagrees — a front door must never silently
  repair invalid source into a different instruction.
- [reference] **UP-6 tag index space**: imported tags take the low end; decoder naming, `buildIndices` and the tag
  rebuild must agree or every `throw` retargets. `StripEH` drops tag imports too.
- [reference] **Heap types and blocktype indices are `s33`** (write signed; U32 and S33 differ from index 64 —
  the regression builds 70 types). **Stack-polymorphic pop**: an empty-stack pop after `unreachable`/`br`/`return`/`throw` yields
  `unreachable`, never a `nop` (the `nop` grew an expression on every round trip). **WT-2k**: when the popped
  value sits BELOW ≥1 statement, `pop()` spills it to a temp local so it is not re-evaluated after a write to its
  state; a `Pop` is exempt. Test `tests/binaryen-ts/binary/decoder_reorder.test.ts`.
- [reference] Multi-value `values.length` is not arity (an entry may leave several values) → ir-convergence § 6.
- [correction] **"Dead" exports**: the decisive test is the `deno.json` exports map, not the `export` keyword.
  Kept on purpose, do not re-flag: `isAbstractHeapType` (public discriminator of `HeapType`); `get/setLowMemoryUnused`
  in `./compat/binaryen` (live API that does nothing, JSDoc says so); the `ExpressionId*` constants (upstream parity).
  Removing `materializeFakeGlobals` was safe only because fake globals are deliberately never materialized —
  **check whether "dead" code is a missing call before deleting it.**
- [correction] **Two "not a bug" verdicts were later reversed** — do not restore either: the unknown-section-id
  skip was called spec-compliant (2026-07-07, 2026-08-24) and now THROWS (`wasm-parser.ts` "unknown section id",
  2026-08-25 sweep #5); `locals[idx]?.type ?? i32` was kept as defensive decoding and now throws (`localTypeAt` /
  `globalTypeAt`). The "custom/name section documented drop" is also gone: C3 keeps custom sections, N1 P4 reads names.
- [baseline] Negative sweeps, so nobody re-runs them: all 23 MVP load/store opcodes and all 128 numeric opcodes
  (0x45–0xC4) round-trip byte-identically (fixture per opcode, V8 decides legality, demand byte identity).
- [trigger] **Multiple tables**: the encoder still refuses >1 table (`checkSingleTable`, elem + `call_indirect`
  encode against table 0). The day it is lifted, the element and indirect-call encoders must thread the real
  index; the decoder already resolves `call_indirect`'s table index and throws out of range.
- [trigger] **Flatten** throws on multi-result calls, EH, and value-carrying branches (it models no tuples). The day
  Asyncify must handle EH or multi-value code, Flatten is the blocker.

### TranslateEH

**✅ IMPLEMENTED 2026-09-14 (owner decision 7: implement)** — `src/binaryen-ts/passes/translate-eh.ts`, registered as
`TranslateToExnref` (upstream's `--translate-to-exnref` resolves to it), opt-in. Upstream:
`WebAssembly/binaryen/src/passes/TranslateEH.cpp`, 823 lines, legacy `try` → `try_table`. The record of the build:
- [decision] **Upstream's shapes, with one departure (divergence H1): no scratch or tuple locals.** binaryen-ts has no
  tuple kinds, and its `Pop` is a stack placeholder a catch region already starts with, so a catch body is spliced in
  after the block that delivers its values. The same placeholder moves an exnref into its local and a split
  multi-value result into a `br`.
- [decision] **Two things the decoder leaves raw, resolved in the pass:** a `br` may target a legacy try's own label
  (the outermost replacement takes the try's name), and a `delegate` may name any enclosing label (resolved outward
  to the nearest try whose BODY encloses it, or the caller — upstream's IRBuilder rule). Analysis is keyed by NODE
  IDENTITY, not label, so a reused name cannot misresolve. A surviving legacy node throws.
- [measured] **Gates.** `tests/binaryen-ts/passes/translate_eh.test.ts`: 14 fixtures, each run in V8 as legacy AND
  translated against hand-written outcomes, validated by wabt-ts, re-decoded legacy-free, and run on wasmtime where
  installed; six mutants (catch scope as delegate target, no try label, no `*_ref`, one shared exnref local, no `br`
  out of a catch, delegate to a plain label as the caller) each failed exactly the fixture that pins it.
  `deno task translate-eh <testsuite>/legacy <out>`: the spec's legacy files, **70 / 70 behavioural assertions** in
  V8 as legacy, translated, and translated then `-Oz`; inverted twice (pass disabled; no `*_ref` → 61 / 70).
  Wasmtime 48.0.2 compiles all 6 translated spec modules, plain and `-Oz`, and refuses the 5 legacy ones with a `try`.
- [lesson] **Building the fixtures found two silent miscompiles elsewhere**, both fixed first (`dd3c138ec`,
  `2e02963bc`): wabt-ts's binary writer leaked a `delegate`'s label (every later named branch one frame too deep),
  and binaryen-ts's decoder dropped a multi-result `if` / `loop` / `try` / `try_table`'s extra values (decode → encode
  wrote `unreachable`). Neither was reachable from the corpus. And **four fixture failures were the fixture's own
  WAT** (stack order in folded form, an untaken `br_if` leaving its value) — which is why each fixture is checked
  against legacy V8 BEFORE the pass is blamed.
- [open] **binaryen-ts's `-Oz` on UNtranslated legacy EH breaks 30 of the 70 spec assertions** (seen inverting the
  gate). Translated first, `-Oz` holds 70 / 70. Tracked in open-work.md.
- [baseline] Measured 2026-08-24: `wasmtime compile` (47.0.3) rejects legacy EH outright — "legacy_exceptions
  feature required for try instruction" — on our fixture and on `WebAssembly/binaryen/test/passes/dwarf_with_exceptions.wasm`;
  `-W` offers only `exceptions` (the new proposal). V8 accepts legacy EH, and every binaryen-ts EH test validated
  against V8 only — the suite was green while the target runtime refused the output.
- [decision] The old blocker ("behind multi-value") is gone: a `catch $tag` branches to a block carrying the tag's
  params, i.e. multi-result blocks, delivered in binaryen-ts Tiers 5–8. IR pieces exist (`TryExpr`, `TryTableExpr`,
  `CatchClause.isRef`, `ThrowRef`, `Rethrow`, `Pop`, `ExnRef`).
- [measured] **Step 0 DONE 2026-09-14** (for owner decision 7), on wasmtime **48.0.2**. Two modules were built
  with wabt-ts `wat2wasm`, then run through binaryen-ts decode → encode, plain and after `-Oz`: a `try_table`
  catching a tag payload, and a `catch_all_ref` → `throw_ref` rethrow caught by an outer `try_table`. **All 4
  accepted by `wasmtime run -W exceptions=y`**, with the right values (`f(0)=7 f(4)=5`; `f(0)=0 f(4)=12`),
  identical to V8. Legacy `try` through the same path is still refused by 48.0.2: "legacy_exceptions feature
  required for try instruction", and `-W` still offers only `exceptions`. So the encoder side of a TranslateEH
  output is known-good; the pass itself is what does not exist. The probe script was session scratch, not kept.
- [history] Scope as written, all ✅ 2026-09-14: (0) above; (1) `try` + `catch`/`catch_all` → `try_table` + block
  scaffolding; (2) `rethrow $l` → an `exnref` local per nesting depth of rethrow-targeted trys, filled via
  `catch_ref`/`catch_all_ref`, then `throw_ref`; (3) `delegate $l`; (4) registered opt-in; (5) tested on wasmtime.
- [correction] **Demand has moved since the scoping.** The note said to ask wasmtk whether wasic should emit
  `try_table` instead. They chose to migrate wasic (their top next-work item, 2026-08-24; wabt-ts measured
  `try_table` at parity on Wasmtime/Wasmer/V8/Bun, and wasmtk themselves ran a hand-written `try_table` on
  wasmtime with no flags), and the multi-value writer was fixed in exchange for dropping this ask. The 1.5.2
  `-Oz` `try_table` miscompile (handoffs § 3) suggests they emit it now. TranslateEH is therefore a compatibility
  shim for already-built legacy binaries, not a pipeline step. The owner decided to implement it anyway (2026-09-14).

**Already in the core**
- best-practices.md § "One authoritative enumeration…" (walk rule, `deepCopy` 29/79, PickLoadSigns `-1`→`255`);
  § "Producer/consumer pairs…"; § "A test for a fix is not coverage until it FAILS…"; § "Make the defect
  UNREPRESENTABLE" (catch records, `catch_all` sentinel, `RefAsOp`, load/store bytes+signed); § "A node LITERAL…"
- testing.md § "The behavioural harnesses" (fuzzer reach, `equiv_check`); § "`noUncheckedIndexedAccess` is ON at the
  root, OFF in `tests/binaryen-ts/`"; § "A fixture believed valid must be said to an engine" (legacy EH is V8-only)
- TranslateEH, closed 2026-09-14 → project.md § "Live gaps carried from the predecessors"; divergences.md H1

**Superseded by S6 (rules not to carry forward)**
- ⟶ S6 5 (`365e9277c`): the region-body class — decoder `oneOrBlock` (unstamped) vs `sealFrame` (stamped), and
  `encodeRegionBody` unpacking anonymous blocks at the four sites. Every region slot now holds a `RegionExpr`;
  `sealFrame` returns one, `oneOrBlock` is gone, `encodeRegionBody` just emits children, and a `Region` in an operand
  slot throws. The 25-case matrix survives as `tests/binaryen-ts/binary/region_body.test.ts`. Divergences R1/R2.
- ⟶ S6 7b(i) (`02d77f533`): block parameters are no longer spilled at decode. They stay on the node; `PassRunner.run`
  calls `lowerBlockParams`, which re-encodes and re-decodes with `{ lowerBlockParams: true }` — that is where the
  entry spill, `rewriteLoopBranch` (the untaken-`br_if` restore) and the `br_table` trampoline still live. Divergence B1.
- ⟶ S6 6A (`2b5850a8a`): multi-value branch values no longer travel as `tuple.make` — `Break`/`Switch`/`Return` hold
  `values: Expression[]`; `TupleMake` is deleted (divergence V1: do not port it back).
- ⟶ S6 4: the `(bytes, signed, resultType)` → opcode inversion — `LoadExpr`/`StoreExpr` hold `opcode`, one table in
  `src/binaryen-ts/ir/memory-access.ts`. (The inversion had an inverse rotation bug the opcode sweep missed, `b8b3150db`.)
- ⟶ S6 3 + `949bee3b8`: `Try`'s parallel `catchTags`/`catchBodies` and its length guard → catch records, `tag?: Var`.
- ⟶ S6 2: memarg offset `number` → `bigint`; memory64 offsets survive. Multi-memory (Tier B "throws") now decodes
  with a memory index on the node (`tests/binaryen-ts/binary/multi_memory.test.ts`).

**History, summarized**
- WT series (wasmtk migration, binaryen-ts ≤ v1.4.2): WT-1 LEB signed-overflow boundary; WT-2/2b validity (imported
  functions named `$func${globalIndex}` — the whole "call need N got M" cluster); WT-2c six behavioural miscompiles
  (elem segments dropped; three `block.type = lastChild.type` recomputes; CoalesceLocals identity loss → Symbol
  markers); WT-2d/2e single-arm `if`, tag exports, flag-4 elem segments; WT-2f inlining wrapper fallthru, CFG
  `call_indirect` order, `"func"` export kind; WT-2g catch-body wrapper; WT-2h/2i/2j three LocalCSE invalidation bugs
  (2j root-caused wasmtk's `skipBinaryenOpt`); WT-2k decoder reorder (TinyGo `tinygo_launch`, 2026-07-09).
- Pre-WT branch-depth fix (`IfExpr.name` + `bodyFrameLabel`, `control_flow_regression.test.ts`); v1.3.4 EH-aware
  CFG; Tiers 1–4 / A–C (310 → 341); fail-loud audit 2026-07-07 (v1.3.6, 20 fixes; WAT calls all typed `None`).
- 2026-08-24/25: UP-1…UP-7 (table below); multi-value blocks and block/`if`/loop inputs (drift checked for
  CONVERGENCE, gen1 = gen2); four dead exports removed → next release 1.5.0; multi-value WRITER; two code-issues
  sweeps; `noUncheckedIndexedAccess` 261 → 0; EH opcodes on the wrong frame now throw (suite → 501).

The UP-n / WT-n index is in § `binaryen-ts/phases.md` below.

Full text: `git show 9758fc736:cmem/binaryen-ts/correctness.md`

## `binaryen-ts/passes.md` (333 lines) — the optimization pass set and pass-authoring invariants

What each pass in `src/binaryen-ts/passes/` does, the shared walk utilities, CoalesceLocals' CFG liveness, the
label-reference and reachability-root enumerations, Inlining, the `wasm-opt` CLI, `PassOptions`, and a long
staged record of the Asyncify port (all five stages done 2026-07-05…09, differentially matched against
`wasm-opt --asyncify` v130 and real TinyGo goroutine output). Ended with Asyncify published (v1.4.1 / v1.4.2) and
its wasmtk integration left to wasmtk.

**Kept**
- [reference] **`mapExpression` rebuilds every ancestor** (`_mapChildren` spreads each node), so identity-keyed
  `Set.has(node)` fails after any descendant rewrite. Mark with a `Symbol`-keyed property — spread copies symbol
  keys. Live: `_INEFFECTIVE` (coalesce-locals.ts), `_PICK_SIGN` (pick-load-signs.ts). Instance WT-2c #5.
- [reference] **Walk API** (`src/binaryen-ts/ir/walk.ts`): `mapExpression` bottom-up, `walkExpression` pre-order,
  `visitChildren`, `mapChildrenShallow` (direct children only — Flatten's prelude hoisting needs it). Both central
  switches throw on an unhandled kind. `mapExpression` on a region returns a region (`asRegion`).
- [reference] **Evaluation order matters to CFG, Flatten and liveness**: `call_indirect` evaluates operands BEFORE
  the table index (field now `callee`); `walk.ts` and `cfg.ts` both honour it (WT-2f miscompile, 2026-07-08 fix).
  [open] `mapExpression`/`walkExpression` still visit a `Break`'s condition before its values → open-work.md.
- [reference] **Label references a pruning pass must honour — seven**: `Break.target`, `Switch.targets[]` +
  `defaultTarget`, `BrOn.target`, `TryTable.catches[].target`, `Try.delegateTarget`, `Rethrow.target`
  (`remove-unused-names.ts` collects all). The authoritative list is the encoder's `resolveLabel` call sites —
  check a label-reasoning pass against that, not against intuition. `Try.delegateTarget` is the one legacy-EH
  producers hit (verified reachable): without it, a label named only by `try…delegate` is stripped, giving
  `unresolved branch label`. `TryTable` catch targets pinned in `eh.test.ts`; `Rethrow.target` names a
  try label, unstrippable today — [trigger] correct-by-accident the day try labels become strippable.
  ⟶ S6 `d85635eb1`: field names were `name`/`label`/`catches[].dest`; every single-label reference is now `target`.
- [reference] **Reachability roots** (exports, element segments, `module.start`) — see correctness above; the
  failure is silent (the module instantiates and does less).
- [reference] **EH-aware CFG** (`cfg.ts`, v1.3.4): a try pushes its handlers on `handlerStack` during its body;
  throwing instructions and calls add edges to every enclosing handler; a throwing call SPLITS its block so a
  wrapping `local.set`'s kill cannot strip a handler-live local. `try_table` catch targets are pushed the same
  way (1.5.2, `tests/binaryen-ts/passes/try_table_oz.test.ts`, handoffs § 3). Loop back-edges propagate live-in.
- [reference] **Inlining**: thresholds from upstream `pass.h` (size ≤ 2 always; single-caller non-exported ≤ 10;
  `optimizeLevel ≥ 3` multi-caller ≤ 20; never self). `deepCopy` is `mapExpression(e => ({...e}))` (one parent per
  node). Dead-callee removal matches the `inlineable` set, not `name.split("$")`. Non-param locals are re-zeroed
  including ref/v128 (`zeroForType`). Split inlining ports `WebAssembly/binaryen/src/passes/Inlining.cpp:740-1240`,
  opt-in `partialInliningIfs` (default 0, as upstream); return-call inlining keeps callee returns.
  ⟶ S6 5: size thresholds now count through `countsTowardSize`, so regions do not move them (best-practices §
  "A node COUNT is behaviour").
- [reference] RemoveUnusedBrs keeps the block type (the new tail child must be `none`); allow-lists such as
  LocalCSE's `_exprKey` must default conservatively; `createPass` normalises case and `-`/`_` (kebab names resolve).
- [decision] **Asyncify ABI matches upstream exactly** (TinyGo depends on it): `$__asyncify_state` (0/1/2),
  `$__asyncify_data` → `{stackPos@0, stackEnd@4}`, five control functions (exported in host mode, internal in
  import mode where `asyncify.*` imports are redirected and removed). Opt-in, never in `-Oz`. Saves only locals live
  across a suspend (`computeRelevantLocals`) — smaller frames than `wasm-opt`. Port of
  `WebAssembly/binaryen/src/passes/Asyncify.cpp`. The nested-goroutine crash was WT-2k, not Asyncify.
- [open] Asyncify gaps (verified in `asyncify.ts`): wasm64 and multi-memory throw "not yet supported"; EH/tuples/
  value branches rejected via Flatten. Wiring into wasmtk's `--lang=go` is wasmtk's work.
- [correction] Asyncify gap "(4) list options miss binary-parsed modules because the reader drops the name section"
  is superseded by N1 P4 (`138148881`, `src/binaryen-ts/binary/names.ts`); `asyncify.ts` ~541–545 still states the
  old limitation, and its multi-memory guard (~263) says loads carry no memory index — both stale; neither re-probed.

**Already in the core**
- "The 19 placeholder kinds are a roadmap" ⟶ superseded by S5's ratchet (`PHANTOM_BUDGET` in
  `scripts/check-operator-mapping.ts`, now 6) → divergences.md K1; LocalCSE C1 → divergences.md; block params
  before any pass → divergences.md B1; `-Oz` `try_table` miscompile → handoffs.md § 3

**History, summarized**
- binaryen-ts Phase 4.1 CFG liveness + CoalesceLocals; Phases 5 / 5.1 / 5.2 Inlining, split and return-call
  inlining; Phase 6 native `wasm-opt` CLI (`src/binaryen-ts/tools/wasm-opt.ts`); `-O0` skips passes.
- Asyncify: Stage 1 `2902fca` ABI + options; 2 `3b35d97` analysis; 3a `2e30ea4` Flatten (surfaced `mapChildrenShallow`);
  3b `62a4573` flow; 4 `c446a3d` locals; 5 `62f0fb0` registered. Import mode 2026-07-08; liveness-minimized saving
  2026-07-09 (v1.4.2); audit-hardening 2026-07-08 (suite 397 → 401). Tests in `tests/binaryen-ts/passes/asyncify*.test.ts`.

Full text: `git show 9758fc736:cmem/binaryen-ts/passes.md`

## `binaryen-ts/architecture.md` (187 lines) — per-subsystem design

Map of `src/ir/`, the 3-phase WAT parser, binary parser and encoder invariants, proposal support (GC, EH, SIMD,
multi-value, tail calls), the three optimization tiers, the binaryen.js interop and `npm:binaryen` facade, the
WASM-kernel runtime, and binaryen-ts Phase 11 cross-runtime rules. Mostly still accurate as a map; several
representation details and all the runtime rules are superseded.

**Kept**
- [decision] **The WAT parser is deliberately not a port** of upstream's streaming pull-parser: tokenizer → S-expr →
  IR (`src/binaryen-ts/parser/`), debuggability over speed. Route construction through the factories, never
  hand-built literals (Tier 1). ⚠️ Its role changed: it is internal only; external WAT goes wabt-ts → bytes →
  decoder → divergences.md W4, ir-convergence.md.
- [reference] **Factories compute result types** (LUB / `unreachable`); a region's type is its contents', the
  declared type stays on the construct (S6 5).
- [reference] **Decoder invariants still in code**: imported functions named `$func${globalIndex}` when unnamed;
  `br`/`br_if`/`br_table` pop per `_branchValueArity`; imported arities from `importedFuncTypeIndices`; multi-value
  calls and blocks seed N−1 typed `Pop`s (`pushMultiValueCall`); `funcTypes` is `(FuncType | null)[]` with
  `funcTypeAt` throwing on out-of-range or non-function.
- [reference] **Encoder**: two-pass sections; `resolveRef` throws on a name miss (the WT-2b `?? 0` class); label stack
  with the function frame seeded as a phantom at the bottom; start section (8) between export and element.
- [reference] **GC**: with GC types present a function's own signature must be a declared `{ kind: "func" }` heap
  type or `encodeWasm` throws `unresolved GC function type` (documented at `src/binaryen-ts/ir/module.ts:751`).
  `ref.eq` is `0xd3`, unprefixed.
- [reference] **SIMD**: `0xFD` + U32 LEB sub-opcode; SIMD prefix checks must precede scalar ones in
  `inferUnaryType`/`inferBinaryType` (`i32x4.splat` misclassifies otherwise).
- [decision] **Three optimization tiers** (binaryen-ts Phase 0): native passes (default); `hybridMode` → system
  `wasm-opt` subprocess; in-process binaryen.js (`src/binaryen-ts/interop/binaryen-js.ts`, a factory namespace per
  `WebAssembly/binaryen/src/js/binaryen.js-post.js`, not the C-API shape). [open] the hybrid path feeds
  `Module.toWat()` output, which is invalid WAT → divergences.md K4.
- [decision] **`./compat/binaryen`** (`src/binaryen-ts/api/binaryen-compat.ts`): migrating code changes only its
  import; upstream numeric constants mirrored exactly; `Module.optimize()` runs the in-tree `PassRunner` (bytes may
  differ from upstream, both valid); unrecognised type IDs throw (`_idToValTypeStrict`). SIMD/GC/EH factories and
  Relooper are omitted. `else_` there is a public parameter — do not rename it with the IR field.
- [baseline] **WASM kernels** (`src/binaryen-ts/wasm/`, `wasm-runtime.ts`): per-call boundary tax ~2–3 ns (WASM
  `add_i32` ~3.6 ns vs ~0.34 ns native); a kernel pays only if per-op savings × ops per call exceeds it, so single-i32
  dispatch never does. Kernel selection deferred (binaryen-ts Phase 10) → project.md § "Live gaps".

**Already in the core / superseded**
- Phase 11 cross-runtime rules ("no `Deno.*` in `src/`", `node:` everywhere, browser-safe subpath list, no
  `import.meta.main`, `lib: [deno.ns, esnext, dom]`) → superseded by project.md § "Runtime portability, layered"
  (library layer: no `node:` either; checked by `scripts/check-portability.sh`) and § "Decided at the pre-merge
  reconciliation" (Node 22.18 floor has `import.meta.main`; `lib` is now `esnext, deno.ns, deno.window, dom`)
- One tree, two verb sets; the bridge → ir-convergence.md
- ⟶ S6 5 / 7b(i) / 6A / 4: null-name block unpacking, decode-time block-param spill, `tuple.make` branch values,
  derived load/store opcodes — replaced as listed under correctness above
- ⟶ S6 1: `ref.as_non_null` on `RefAs` with a `RefAsOp` discriminant → no operator field; the extern conversions took
  their own kind (`ExternConvertExpr`, X1)
- ⟶ S6 step 4 (b): numeric local/global/type/memory indices → `Var` fields (ir-convergence § "The (b) decision")
- ⚠️ UP-7 "`AnyRef` shim on locals is a live bug" — FIXED (Tier 3; `readValTypeByte` doc records it). Live
  `npm:binaryen` tests "gated on `BINARYEN_LIVE=1`" — gate removed, they run (`binaryen_interop.test.ts`)

**History, summarized:** binaryen-ts Phase 7 GC, Phase 8 EH, Phase 9 SIMD, Phase 12.1 compat constants, Phase 13
tail calls (`return_call*` = `Call`/`CallIndirect` with `isReturn`); multi-value 2026-08-24.

Full text: `git show 9758fc736:cmem/binaryen-ts/architecture.md`

## `binaryen-ts/INDEX.md` (100 lines) — file table, memory triggers, regression ladder

The wing's index, holding the "update the project memory" and "look for code issues" triggers and a seven-rung
ladder. Superseded by `cmem/INDEX.md` and working-rules.md.
**Kept:**
- [lesson] **A gate is triggered by a CHANGE, not by a batch.** Adding tests that pass as written, with `src/`
  untouched, cannot regress anything, so it needs no corpus-harness re-run.
- [reference] **"Look for code issues" covers tested AND untested paths**, above all silent fallbacks (`?? 0`, a bare
  `nop`, a guessed default). Each becomes a typed error (`WasmEncodeError`/`WasmBinaryError`/`WatParseError`/
  `TypeError`). Defer only if the fix could reject valid input.
**Already in the core:** the ladder → cmem/testing.md § "Running" / § "The behavioural harnesses" / § "CI gate"; exit
codes → cmem/best-practices.md § "An exit code is not evidence".
**History:** its `scripts/verify_roundtrip.ts` rung is now `tests/binaryen-ts/binary/corpus_roundtrip.test.ts`.
Full text: `git show 9758fc736:cmem/binaryen-ts/INDEX.md`

## `binaryen-ts/best-practices.md` (294 lines) — method rules for a parser/optimizer/encoder

§§ 1 and 3–6 converged with wabt-ts and were merged. **§§ 2b–2d were not**; core § "Where to go for the rest" points
here for them.
**Kept:**
- [lesson] **§ 2b Close the SHAPE, not the arm.** When fixing a silent fallback, delete the duplicate enumeration, make
  `default` throw, bind to `never`. Instance, 2026-08-25 (3 of 7 findings were an earlier fix that closed one
  instance and left the mechanism open): `encodeExportSection` gained `case "tag"` but no `default` — its
  `default:` now binds `never` and throws — and the encoder's private child walk missed `TupleMake`. **Grep
  for the failure your own comments describe** — all three had one. (General rule → cmem/best-practices.md
  § "Fix the class, not the instance — then guard the class".)
- [lesson] **Fix a shape → enumerate every site in the same sitting, then test the enumeration.** The region-container
  bug was fixed at WT-2f and WT-2g, then resurfaced in `try` bodies and `if` arms. It closed only with one helper
  (`encodeRegionBody`, `src/binaryen-ts/encoder/wasm-encoder.ts`) plus the matrix below.
- [lesson] **§ 2c A placeholder must not be representable as real data.** `funcTypes` filled struct slots with the
  valid `{params:[],results:[]}`, so a `call_indirect` naming a struct silently built a zero-arity call (WT-2b;
  `src/binaryen-ts/binary/wasm-parser.ts:627`). Use `null` or throw, **then put the sentinel in the TYPE** —
  `(FuncType | null)[]` broke the build at two sites the grep had missed.
- [lesson] **From `noUncheckedIndexedAccess` (261 → 0 errors in `src/`):** a big error count is not a big edit count
  (five accessors removed 61 — fix the helper, not the call sites). The `!` rule that came with it is in
  the correctness section above.
- [lesson] **§ 2d A value read and discarded is a decision.** `r.readU32(); // table index` was followed by a
  hard-coded table 0. **A wrong decode made harmless by a guard in another file is a load-bearing coincidence**: the
  encoder refused more than one table, but the bridge and `/compat` read the decoder directly. The wider sweep is open
  → cmem/open-work.md.
- [lesson] **When the IR gains a capability, grep every PRODUCER, not only the readers.** The WAT parser still
  truncated `(result i32 i32)` after the decoder gained multi-value.
- [lesson] **A borrowed war story is a search query.** wazmrt's `try_table` off-by-one described our own symmetric
  decoder+encoder bug. **Evidence must be able to disagree with you**: the V8 fixture gives a tag one value and two
  candidate targets taking one and two.
- [lesson] **Shorter rules:** decide commit granularity before editing (no hunk staging; a broken bisect point is worse
  than a coarse one); identify the LAYER before naming a cause (WT-2k); record wrong hypotheses (WT-2i's
  reverted `nextLocal` fix). "Dead" code may be a missing call → the correctness section above.
**Already in the core:** round trip ≠ correctness and one enumeration → cmem/best-practices.md § "Producer/consumer
pairs…" / § "One authoritative enumeration…"; 2c quoted → § "Make the defect UNREPRESENTABLE"; fuzz reach → § "A green
suite…"; exports map → cmem/project.md § "The merge — how it was prepared"; who is blocked → project.md § "Live
gaps…"; version push, type cache → cmem/publishing.md § "RULE — never bump…" / § "Recovery recipes".
Full text: `git show 9758fc736:cmem/binaryen-ts/best-practices.md`

## `binaryen-ts/bridge.md` (312 lines) — the binaryen-ts ↔ wabt-ts ↔ wasmtk contract

It held the pipeline, five decisions, the naming MUST, the constructor-API contract, the UP-1…UP-7 bridge view, and the
T13.22 catch-scope coupling. All of it closed at the merge. The bridge is now `src/bridge/`, and S6 step 5 deletes it.
**Kept:**
- [decision] **Encoder ownership:** binaryen-ts's encoder is canonical for OPTIMIZED output; wabt-ts's serves the
  format tools and round-trip fidelity. The wabt-ts IR is a tree with no parent context or upward references, which is
  what made the bridge a single post-order constructor walk.
- [reference] The catch-scope rule, the seven label references RemoveUnusedNames must count, and the GC
  func-heap-type rule are kept once, in the correctness, passes and architecture sections above.
- [lesson] **A probe that cannot discriminate is not a refutation** (wabt-ts). Depths 1 and 2 both returned 111; a byte
  comparison against a known-correct reference settled it.
**Already in the core:** naming rule, `scripts/check-naming.sh` → cmem/project.md § "Upstream names are reserved";
paths, front door → cmem/ir-convergence.md § "The bridge and the WAT routes into binaryen-ts"; T13.22 → project.md
§ "The merge — how it was prepared".
**History:** landed as "implement Phase 7: wabt-ts → binaryen-ts IR bridge" (`60ea8aec0`). The UP series added
`makeRefAsNonNull`, 4 array-bulk factories, `addTagImport`, `setStart`; UP-7 introduced `ValueType = ValType | RefType`;
A1 closed in 1.5.2 (`50a959baa`); T13.22 closed at `5404946dd`, gated by `tests/bridge/try_table_catch_scope.test.ts`.
Full text: `git show 9758fc736:cmem/binaryen-ts/bridge.md`

## `binaryen-ts/testing.md` (186 lines) — how binaryen-ts was tested

**Kept:**
- [reference] **Region matrix — `tests/binaryen-ts/binary/region_body.test.ts`.** Every region owner (`block`, `loop`,
  `if` arms, `try` body and handler, `try_table`, inner named blocks, nesting, void) × falls-through vs
  exits-via-`br`. **25 cases** (counted), each run as a V8-checked fixture, a bare round trip and a full `-Oz`. The
  wing records 5 red with `encodeRegionBody` reverted; not re-run. ⚠️ The file header still says "three of these
  thirteen".
- [reference] **Corpus round-trip design** (`tests/binaryen-ts/binary/corpus_roundtrip.test.ts`, verified in the file):
  (1) with no corpus it IGNORES rather than fails; (2) entity counts are exact, but expression counts must
  **converge** (gen 1 = gen 2) — spilled block params and `br_table` trampolines add nodes once, whereas
  `unreachable-pops` grew every trip (4 → 5 → 6); (3) every file lands in one bucket, totals reconcile;
  `MIN_ROUNDTRIPPING = 80`.
- [reference] **Fuzzer hazards** (`tests/binaryen-ts/passes/optimize_fuzz.test.ts`, default 350, `FUZZ_ITERS`): a
  `local.tee K` re-read by a sibling (WT-2j); K written in `if` arms and read by a later sibling (WT-2i); repeated pure
  subexpressions over a small local pool; dead/live sets, drops, `select`, nested blocks. It asserts validity plus
  bit-identical results and bisects to the first bad pass. Teeth: WT-2i reverted → seed 4; WT-2j → seed 18.
- [reference] **Not fuzzed: the dangling-stack family** (tuple calls, catch-param `Pop` threading). Covered instead by
  `tests/binaryen-ts/passes/optimize_pipeline.test.ts` (46_TemplateEscapes) and `tests/binaryen-ts/binary/eh.test.ts`.
- [reference] **Placement:** `tests/binaryen-ts/binary/control_flow_regression.test.ts` (branch depth, single-arm `if`,
  tag exports, WT-2b); `tests/binaryen-ts/parser/wat_parser.test.ts` (inference, fail-loud resolution);
  `tests/binaryen-ts/encoder/wasm_encoder.test.ts` (a None-typed local throws).
- [trigger] **`scripts/binaryen-ts/verify_roundtrip.ts` still exists.** The day it is run: it hard-panicked Deno 2.9.5
  before any output (recorded, not re-run). Use the test.
**Already in the core:** `noUncheckedIndexedAccess` → cmem/testing.md § "`noUncheckedIndexedAccess` is ON at the root…";
panic → § "A crashed run is not a green run"; fuzz reach (re-verified 0 `makeLoad`/`makeBreak`), `equiv_check` →
§ "The behavioural harnesses"; test type-check → § "CI gate".
**History:** corpus "80 exact, 0 drift, 90 of 90" on 2026-08-24 (the core's 91 is current; the test skipped until
`456423b54`); "513 tests, 1 ignored" → 1043 / 0 (`cec3a3381`).
Full text: `git show 9758fc736:cmem/binaryen-ts/testing.md`

## `binaryen-ts/publishing.md` (193 lines) — JSR release flow for `@jrmarcum/binaryen-ts`

The package is archived and frozen (cmem/project.md § "The retirement"). What the merged flow inherited is in the core.
**Kept:**
- [trigger] **"Future-proofing (not yet applied)" is still not applied**: `scripts/release/` runs no cold type
  check before the tag push, so a stale local type cache is caught only by `publish.yml`, after the tag is
  public. Recovery: bump (v1.2.4). [correction] The wing's remedy, `--reload`, would not catch a stale
  resolved VERSION; only a fresh `DENO_DIR` proves a chain → cmem/best-practices.md § "🆕 `--reload` does
  not invalidate a resolved VERSION — only a fresh `DENO_DIR` proves a chain".
- [correction] **A local publish leaves `rekorLogId: ""`; a JSR recording failure left `null`.** The Sigstore log line
  proves the upload, not the recording.
**Already in the core:** no local publish, flow, no minor mode, dirty-tree guard (v1.2.3), stale cache (v1.2.4),
clobbered tags, JSR link, action pins, submodule remnant → cmem/publishing.md § "The release process" / § "Recovery
recipes"; the 1.3.5–1.4.3 provenance gap → § "Measured history, 2026-08-26".
**History:** 1.3.6–1.3.9 were identical-code probes ruling out local publish, Deno version, command, JSR-wide, repo link
(JSR support contacted 2026-07-08); v1.5.0 set by hand, `39a76d526`, `rekorLogId=2590420167`.
Full text: `git show 9758fc736:cmem/binaryen-ts/publishing.md`

## `binaryen-ts/phases.md` (177 lines) — delivery status: phases, WT series, UP tiers

**Kept — ID index** [reference]. UP-*/WT-* are cited from `src/`, `tests/` and `scripts/`; root causes are in
`binaryen-ts/correctness.md`.

| id | what | state |
| -- | ---- | ----- |
| binaryen-ts Phase 0 / 0.1 | IR, builder, pass infra, DCE, API, interop / in-process binaryen.js bridge | ✅ |
| binaryen-ts Phase 1 / 2 / 3 | WAT parser / binary parser / encoder + round trip | ✅ |
| binaryen-ts Phase 4 (4.1) · 5 (5.1, 5.1c, 5.2) · 6 | core passes, CFG liveness · Inlining, split/partial, CLI, return-call · `wasm-opt` CLI + RemoveUnusedNames | ✅ |
| binaryen-ts Phase 7 (7.1) · 8 (8.1) · 9 | GC · EH (inline try, EH-aware DCE, StripEH) · SIMD | ✅ |
| binaryen-ts Phase 10 | WASM-kernel runtime + dogfood embed; **kernel selection deferred** | ⬚ partial |
| binaryen-ts Phase 11 (11.1–11.6) · 12 (12.1) · 13 | `node:`, JSR hardening, licence, JSDoc, guard, bump, auto-tag, release driver · `npm:binaryen` facade (`./compat/binaryen`) · tail calls | ✅ |
| WT-1 | LEB128 signed-overflow parser fix: `readI32`/`readI64` rejected valid max-length LEBs; corpus 74 → 84 files; `tests/binaryen-ts/binary/reader.test.ts` | ✅ |
| WT-2 / WT-2b | round-trip validity, compile failures 16 → 7; bench 7/7 vs `npm:binaryen@^116`, size 1.12× ours larger | ✅ |
| WT-2a | in no wing table; `control_flow_regression.test.ts` names the DWARF-wasm round-trip validity bugs so | — |
| WT-2c | six behavioural miscompiles via `scripts/binaryen-ts/equiv_check.ts` | ✅ |
| WT-2d / WT-2e | wasmtk rounds 1–2: single-arm `if`; tag exports/type index; flag-4 elem segments | ✅ |
| WT-2f / WT-2g | round 3: inlining wrapper, CoalesceLocals call_indirect order, WAT export kind / round 4: catch handler in a spurious block | ✅ |
| WT-2h / 2i / 2j | rounds 5–6: catch-param Pop; tuple-call Pops; three LocalCSE invalidation bugs | ✅ |
| WT-2k | decoder reordered a stack-held value past a write of its state (2026-07-09); `decoder_reorder.test.ts` | ✅ v1.4.2 |
| UP-1 · UP-5 | packed `get_u` sub-opcode (wrong bytes; packedness now from the field's `StorageType`, `packedGetSubop`) · start section parsed and silently dropped — the worst of the seven; closed with reachability roots | ✅ Tier 1 `dd88e034b` |
| UP-3 · UP-4 · UP-6 | array bulk ops (`copy` = dest THEN src) · `ref.as_non_null` (0xd4; `RefAsOp` later dropped, S6 1) · tag imports | ✅ Tier 2 `f664ba579` |
| UP-7 · UP-2 | typed-ref locals collapsed to `anyref` (wrong bytes; V8 rejects the bare round trip) · `tuple.make` enum only — really the multi-value blocktype project (branches, block inputs); `tuple.make` later deleted, S6 6A | ✅ Tier 3 · Tiers 5–8 |

Rest of the sequence: Tier 4 corpus closure; Sweeps 1–3 (`if`-arm aliasing, 4 dead exports, duplicate dispatchers);
Tier 9 (multi-value writer, catch scope, RemoveUnusedNames); Sweep 4 (7 fail-loud findings).
**Kept:**
- [open] **Phase 10 kernel selection** is still in cmem/open-work.md § "Repo work". (**TranslateEH**, listed here
  with it, was implemented 2026-09-14 — § "TranslateEH" above.)
- [lesson] **To hold a release, leave `deno.json` at a version whose tag already exists** — auto-tag no-ops, so no push
  can publish.
**Already in the core:** "cannot ship alone" and custom sections (C3 `4c162c584`) → cmem/project.md § "Live gaps…";
phase numbering → § "'Phase N' is ambiguous here, permanently".
**History:** Asyncify landed in 5 stages, 2026-07-05→07 (`2902fca5f`…`62f0fb0ef`), matching `wasm-opt --asyncify`
v130. The 2026-07-07 sweep made 20 fixes, 6 of them miscompiles (v1.3.6).
Full text: `git show 9758fc736:cmem/binaryen-ts/phases.md`

## `binaryen-ts/overview.md` (95 lines) — what binaryen-ts was, pre-merge

⚠️ **STALE:** it says three projects merge. Two did, and wasmtk stays a consumer (cmem/project.md § "Scope: two
projects, not three"). Its version (v1.3.9) and layout are pre-merge.
**Kept:**
- [reference] **The IR is a tree:** one parent per expression, never reuse a node, and factories always build new
  objects. Binaryen IR has an `unreachable` type the spec lacks.
- [correction] **"The pass runner auto-fixes non-nullable locals after each pass" is false of the code.**
  `Pass.requiresNonNullableLocalFixups` (`src/binaryen-ts/passes/pass.ts:54`) is `false` in every pass, `run()` never
  reads it, and no fixup pass exists. The JSDoc at `pass.ts:223` and the comment at `inlining.ts:551` still rely
  on it → [open-work.md](open-work.md).
- [reference] **Upstream references**, present in the clone at `wasmExamples/binaryen-ts/upstream/`:
  `WebAssembly/binaryen/src/parser/lexer.h`, `…/parser/wat-parser.cpp`, `…/src/wasm.h`, `…/src/passes/*.cpp`,
  `…/src/binaryen-c.h` (constructor-API shape), `…/src/js/binaryen.js-post.js` (`/compat`, interop).
- [decision] **Out of scope:** WAT printer, `wasm-as`, validation → wabt-ts; `wasm2js`, interpreter → the runtimes;
  `wasm-merge` → wasmtk; `wasm-ctor-eval`, `wasm-reduce`, Relooper, `wasm2c` → out.
Full text: `git show 9758fc736:cmem/binaryen-ts/overview.md`

## `binaryen-ts/handoffs.md` (163 lines) — two letters to wabt-ts, 2026-08-25

(1) "Multi-value blocks fixed; `dest` changed meaning" (pre-release); (2) "v1.5.0 live; T13.22 actionable". Both were
answered, and T13.22 closed at `5404946dd`.
**Kept:** nothing beyond the bridge.md items.
**Already in the core:** the no-writes-into-siblings convention → cmem/handoffs.md.
**History:** letter 2 retracted "1.5.0 cannot ship alone" and the `$__exn_tag` claim, since wasic emits legacy `try`
and `delegate` is the operative case.
Full text: `git show 9758fc736:cmem/binaryen-ts/handoffs.md`

## `binaryen-ts/licensing.md` (40 lines) — JSR licence rules

**Already in the core, entirely** → cmem/licensing.md: single SPDX, full-text `LICENSE`, bonus files, Phase 11's 352
JSDoc errors, `makeConst` in JSDoc. The core's layout (wabt-ts's copyright pair, `NOTICE.md`) supersedes this one.
Full text: `git show 9758fc736:cmem/binaryen-ts/licensing.md`

## `binaryen-ts/binaryang.md` (155 lines) — the merge plan, 2026-08-25

All of it landed, and the core records it.
**Kept:**
- [baseline] **Pre-merge sizes, binaryen-ts / wabt-ts:** `src/` 23,256 / 31,344 LOC (38 files each); tests 513 in 37
  files / 393 in 130; subpaths 11 / 8. 21 tracked paths collided (`deno.json`, lock, 3 workflows, `.gitignore`,
  README, 3 licences, 8 cmem files, 3 release scripts).
- [lesson] **"No `src/` file name collides" was true and the wrong measure**: the build-and-ship paths collided.
**Already in the core:** decisions, history recipe, layout, narrow root → cmem/project.md § "Settled decisions";
promotion → § "Layout and the promotion rule"; 56 collisions → § "The convergence indicator"; the cmem 10:1 trap →
cmem/best-practices.md § "Why this file is a selection…".
**History:** planning retracted "drop the `-ts`"; wabt-ts had 8 subpaths, not 5; 4 `src/` dirs collided, not 5.
Full text: `git show 9758fc736:cmem/binaryen-ts/binaryang.md`

## `binaryen-ts/binaryang-kickoff.md` (138 lines) — the brief handed to the merge team

Steps 0–6 and the gates were executed. Step 0 (safe.directory) → `cmem/local/environment.md` (private). The
step-2 gate said 906 tests and 908 were measured. The step list omitted the agreed requote → cmem/project.md § "The
merge — how it was prepared" (P1).
**Kept:** nothing; it restates binaryang.md.
Full text: `git show 9758fc736:cmem/binaryen-ts/binaryang-kickoff.md`
