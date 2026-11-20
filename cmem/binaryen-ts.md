# binaryen-ts — the predecessor's memory, summarized

What the predecessor binaryen-ts knew, summarized once at the merge; this file holds the header and
the correctness record. Last verified 2026-11-20. Other parts: [passes and
architecture](binaryen-ts-passes-architecture.md), [method, tests, release, ID
index](binaryen-ts-method.md); closed sections are in
[archive/binaryen-ts-to-4.1.1.md](archive/binaryen-ts-to-4.1.1.md).

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
- **Full text** — the whole file, one command away: `git show 62c65a9db:cmem/binaryen-ts/<file>`.

**`⟶ S6` marks a wing rule the S6 convergence superseded**, and names what replaced it
([ir-convergence.md](ir-convergence.md), [divergences.md](divergences.md)). Do not carry those rules
forward.

**Paths were rewritten to this tree** and checked on `08383677a`:

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

§ `binaryen-ts/testing.md`: moved to [binaryen-ts-method.md](binaryen-ts-method.md)
§ `binaryen-ts/phases.md` (the UP-n / WT-n ID index): moved to [binaryen-ts-method.md](binaryen-ts-method.md)
§ `binaryen-ts/passes.md`, § `binaryen-ts/architecture.md`: moved to [binaryen-ts-passes-architecture.md](binaryen-ts-passes-architecture.md)

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
- ✅ ~~[trigger] **Multiple tables**: the encoder refuses >1 table (`checkSingleTable`)~~ — LIFTED 2026-09-28
  (writer-inventory W5): the element and indirect-call encoders had long threaded the real index, and the guard
  was all that was left. `multi_table.test.ts`.
- [trigger] **Flatten** throws on multi-result calls, EH, and value-carrying branches (it models no tuples). The day
  Asyncify must handle EH or multi-value code, Flatten is the blocker.

### TranslateEH

**✅ IMPLEMENTED 2026-09-14 (owner decision 7: implement)** — `src/passes/translate-eh.ts`, registered as
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
- [lesson] **Building the fixtures found two silent miscompiles elsewhere**, both fixed first (`c25fec9c4`,
  `606b68dc1`): wabt-ts's binary writer leaked a `delegate`'s label (every later named branch one frame too deep),
  and binaryen-ts's decoder dropped a multi-result `if` / `loop` / `try` / `try_table`'s extra values (decode → encode
  wrote `unreachable`). Neither was reachable from the corpus. And **four fixture failures were the fixture's own
  WAT** (stack order in folded form, an untaken `br_if` leaving its value) — which is why each fixture is checked
  against legacy V8 BEFORE the pass is blamed.
- [lesson] **Inverting the gate found a third defect**: `-Oz` on UNtranslated legacy EH broke 30 of the 70 spec
  assertions. Attributed by running each `-Oz` pass alone — DCE only — and fixed (`cc9467e81`, divergence U1): a
  construct TYPED unreachable is not stack-polymorphic after its `end`. The gate's "disabled pass" inversion now
  fails only on the surviving `try`s, not on behaviour.
- [baseline] Measured 2026-08-24: `wasmtime compile` (47.0.3) rejects legacy EH outright — "legacy_exceptions
  feature required for try instruction" — on our fixture and on `WebAssembly/binaryen/test/passes/dwarf_with_exceptions.wasm`;
  `-W` offers only `exceptions` (the new proposal). V8 accepts legacy EH, and every binaryen-ts EH test validated
  against V8 only — the suite was green while the target runtime refused the output.
- [decision] The old blocker ("behind multi-value") is gone: a `catch $tag` branches to a block carrying the tag's
  params, i.e. multi-result blocks, delivered in binaryen-ts Tiers 5–8. IR pieces exist (`TryExpr`, `TryTableExpr`,
  `TableCatch.isRef`, `ThrowRef`, `Rethrow`, `Pop`, `ExnRef`).
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
- ⟶ S6 5 (`7c2ad5fd3`): the region-body class — decoder `oneOrBlock` (unstamped) vs `sealFrame` (stamped), and
  `encodeRegionBody` unpacking anonymous blocks at the four sites. Every region slot now holds a `RegionExpr`;
  `sealFrame` returns one, `oneOrBlock` is gone, `encodeRegionBody` just emits children, and a `Region` in an operand
  slot throws. The 25-case matrix survives as `tests/binaryen-ts/binary/region_body.test.ts`. Divergences R1/R2.
- ⟶ S6 7b(i) (`4cae28682`): block parameters are no longer spilled at decode. They stay on the node; `PassRunner.run`
  calls `lowerBlockParams`, which re-encoded and re-decoded with `{ lowerBlockParams: true }` — the entry spill,
  `rewriteLoopBranch` and the `br_table` trampoline lived there. Divergence B1. ⟶ Since R15 (2026-09-28) it is a
  TREE pass (`passes/lower-block-params.ts`, positional: locals written before the construct, read back at each
  region's start); the re-decode was invalid for `fac.0` / `if.0`. The decoder's `{ lowerBlockParams }` option
  still exists but no pass path uses it.
- ⟶ S6 6A (`fc103dcc8`): multi-value branch values no longer travel as `tuple.make` — `Break`/`Switch`/`Return` hold
  `values: Expression[]`; `TupleMake` is deleted (divergence V1: do not port it back).
- ⟶ S6 4: the `(bytes, signed, resultType)` → opcode inversion — `LoadExpr`/`StoreExpr` hold `opcode`, one table in
  `src/ir/memory-access.ts`. (The inversion had an inverse rotation bug the opcode sweep missed, `34289e449`.)
- ⟶ S6 3 + `737e9c76f`: `Try`'s parallel `catchTags`/`catchBodies` and its length guard → catch records, `tag?: Var`.
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

Full text: `git show 62c65a9db:cmem/binaryen-ts/correctness.md`
