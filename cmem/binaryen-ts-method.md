# binaryen-ts: method, tests, release and delivery index

The predecessor's method rules, bridge decisions, test design, JSR release notes, the UP-n / WT-n ID index and the overview. Last verified 2026-11-20. The rest is in [binaryen-ts.md](binaryen-ts.md).

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
Full text: `git show 62c65a9db:cmem/binaryen-ts/INDEX.md`

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
Full text: `git show 62c65a9db:cmem/binaryen-ts/best-practices.md`

## `binaryen-ts/bridge.md` (312 lines) — the binaryen-ts ↔ wabt-ts ↔ wasmtk contract

It held the pipeline, five decisions, the naming MUST, the constructor-API contract, the UP-1…UP-7 bridge view, and the
T13.22 catch-scope coupling. All of it closed at the merge. The bridge became `src/bridge/`, and S6 step 5 deleted it (M8e, 2026-09-18).
**Kept:**
- [decision] **Encoder ownership:** binaryen-ts's encoder is canonical for OPTIMIZED output; wabt-ts's serves the
  format tools and round-trip fidelity. The wabt-ts IR is a tree with no parent context or upward references, which is
  what made the bridge a single post-order constructor walk.
- [reference] The catch-scope rule, the seven label references RemoveUnusedNames must count, and the GC
  func-heap-type rule are kept once, in the correctness, passes and architecture sections above.
- [lesson] **A probe that cannot discriminate is not a refutation** (wabt-ts). Depths 1 and 2 both returned 111; a byte
  comparison against a known-correct reference settled it.
**Already in the core:** naming rule, `scripts/check-naming.ts` → cmem/project.md § "Upstream names are reserved";
paths, front door → cmem/ir-convergence.md § "The bridge and the WAT routes into binaryen-ts"; T13.22 → project.md
§ "The merge — how it was prepared".
**History:** landed as "implement Phase 7: wabt-ts → binaryen-ts IR bridge" (`e5ff34368`). The UP series added
`makeRefAsNonNull`, 4 array-bulk factories, `addTagImport`, `setStart`; UP-7 introduced `ValueType = ValType | RefType`;
A1 closed in 1.5.2 (`d6d22559c`); T13.22 closed at `15cce7426`, gated by `tests/bridge/try_table_catch_scope.test.ts`.
Full text: `git show 62c65a9db:cmem/binaryen-ts/bridge.md`

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
`8f5945b83`); "513 tests, 1 ignored" → 1043 / 0 (`b940e6c6b`).
Full text: `git show 62c65a9db:cmem/binaryen-ts/testing.md`

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
(JSR support contacted 2026-07-08); v1.5.0 set by hand, `e52d68f07`, `rekorLogId=2590420167`.
Full text: `git show 62c65a9db:cmem/binaryen-ts/publishing.md`

## `binaryen-ts/phases.md` (177 lines) — delivery status: phases, WT series, UP tiers

**Kept — ID index** [reference]. UP-*/WT-* are cited from `src/`, `tests/` and `scripts/`; root causes are in
`binaryen-ts/correctness.md`.

- **id:** binaryen-ts Phase 0 / 0.1
  - what: IR, builder, pass infra, DCE, API, interop / in-process binaryen.js bridge
  - state: ✅
- **id:** binaryen-ts Phase 1 / 2 / 3
  - what: WAT parser / binary parser / encoder + round trip
  - state: ✅
- **id:** binaryen-ts Phase 4 (4.1) · 5 (5.1, 5.1c, 5.2) · 6
  - what: core passes, CFG liveness · Inlining, split/partial, CLI, return-call · `wasm-opt` CLI + RemoveUnusedNames
  - state: ✅
- **id:** binaryen-ts Phase 7 (7.1) · 8 (8.1) · 9
  - what: GC · EH (inline try, EH-aware DCE, StripEH) · SIMD
  - state: ✅
- **id:** binaryen-ts Phase 10
  - what: WASM-kernel runtime + dogfood embed; **kernel selection deferred**
  - state: ⬚ partial
- **id:** binaryen-ts Phase 11 (11.1–11.6) · 12 (12.1) · 13
  - what: `node:`, JSR hardening, licence, JSDoc, guard, bump, auto-tag, release driver · `npm:binaryen` facade (`./compat/binaryen`) · tail calls
  - state: ✅
- **id:** WT-1
  - what: LEB128 signed-overflow parser fix: `readI32`/`readI64` rejected valid max-length LEBs; corpus 74 → 84 files; `tests/binaryen-ts/binary/reader.test.ts`
  - state: ✅
- **id:** WT-2 / WT-2b
  - what: round-trip validity, compile failures 16 → 7; bench 7/7 vs `npm:binaryen@^116`, size 1.12× ours larger
  - state: ✅
- **id:** WT-2a
  - what: in no wing table; `control_flow_regression.test.ts` names the DWARF-wasm round-trip validity bugs so
  - state: —
- **id:** WT-2c
  - what: six behavioural miscompiles via `scripts/binaryen-ts/equiv_check.ts`
  - state: ✅
- **id:** WT-2d / WT-2e
  - what: wasmtk rounds 1–2: single-arm `if`; tag exports/type index; flag-4 elem segments
  - state: ✅
- **id:** WT-2f / WT-2g
  - what: round 3: inlining wrapper, CoalesceLocals call_indirect order, WAT export kind / round 4: catch handler in a spurious block
  - state: ✅
- **id:** WT-2h / 2i / 2j
  - what: rounds 5–6: catch-param Pop; tuple-call Pops; three LocalCSE invalidation bugs
  - state: ✅
- **id:** WT-2k
  - what: decoder reordered a stack-held value past a write of its state (2026-07-09); `decoder_reorder.test.ts`
  - state: ✅ v1.4.2
- **id:** UP-1 · UP-5
  - what: packed `get_u` sub-opcode (wrong bytes; packedness now from the field's `StorageType`,
    `packedGetSubop`) · start section parsed and silently dropped — the worst of the seven; closed
    with reachability roots
  - state: ✅ Tier 1 `862d0bea9`
- **id:** UP-3 · UP-4 · UP-6
  - what: array bulk ops (`copy` = dest THEN src) · `ref.as_non_null` (0xd4; `RefAsOp` later dropped, S6 1) · tag imports
  - state: ✅ Tier 2 `2823a8eeb`
- **id:** UP-7 · UP-2
  - what: typed-ref locals collapsed to `anyref` (wrong bytes; V8 rejects the bare round trip) ·
    `tuple.make` enum only — really the multi-value blocktype project (branches, block inputs);
    `tuple.make` later deleted, S6 6A
  - state: ✅ Tier 3 · Tiers 5–8

Rest of the sequence: Tier 4 corpus closure; Sweeps 1–3 (`if`-arm aliasing, 4 dead exports, duplicate dispatchers);
Tier 9 (multi-value writer, catch scope, RemoveUnusedNames); Sweep 4 (7 fail-loud findings).
**Kept:**
- [parked] **Phase 10 kernel selection** — parked by the owner 2026-09-29 until optimizer speed is
  on the table; cmem/open-work.md § "Not tasks, by decision". (**TranslateEH**, listed here
  with it, was implemented 2026-09-14 — § "TranslateEH" above.)
- [lesson] **To hold a release, leave `deno.json` at a version whose tag already exists** — auto-tag no-ops, so no push
  can publish.
**Already in the core:** "cannot ship alone" and custom sections (C3 `4a50b96eb`) → cmem/project.md § "Live gaps…";
phase numbering → § "'Phase N' is ambiguous here, permanently".
**History:** Asyncify landed in 5 stages, 2026-07-05→07 (`673890bd5`…`952d15177`), matching `wasm-opt --asyncify`
v130. The 2026-07-07 sweep made 20 fixes, 6 of them miscompiles (v1.3.6).
Full text: `git show 62c65a9db:cmem/binaryen-ts/phases.md`

## `binaryen-ts/overview.md` (95 lines) — what binaryen-ts was, pre-merge

⚠️ **STALE:** it says three projects merge. Two did, and wasmtk stays a consumer (cmem/project.md § "Scope: two
projects, not three"). Its version (v1.3.9) and layout are pre-merge.
**Kept:**
- [reference] **The IR is a tree:** one parent per expression, never reuse a node, and factories always build new
  objects. Binaryen IR has an `unreachable` type the spec lacks.
- [correction] **"The pass runner auto-fixes non-nullable locals after each pass" was false of the code** —
  `requiresNonNullableLocalFixups` was `false` in every pass and nothing read it — **and is TRUE since 2026-09-14**
  (`ce1972630`). Probing found it reachable through Flatten (an `if` typed `(ref $T)` left a read no set covered;
  V8 refused the module), not through Inlining. `non-nullable-locals.ts` ports upstream's
  `handleNonDefaultableLocals`; `PassRunner.run` calls it after each pass declaring the flag, now `true` on twelve.
- [reference] **Upstream references**, present in this repo's gitignored clone at
  `upstream/binaryen/` (moved in from the binaryen-ts checkout 2026-10-26; `version_132` + 38
  checked out, `version_133` fetched — check it out to read the source the 133 oracle runs):
  `WebAssembly/binaryen/src/parser/lexer.h`, `…/parser/wat-parser.cpp`, `…/src/wasm.h`, `…/src/passes/*.cpp`,
  `…/src/binaryen-c.h` (constructor-API shape), `…/src/js/binaryen.js-post.js` (`/compat`, interop).
- [decision] **Out of scope:** WAT printer, `wasm-as`, validation → wabt-ts; `wasm2js`, interpreter → the runtimes;
  `wasm-merge` → wasmtk; `wasm-ctor-eval`, `wasm-reduce`, Relooper, `wasm2c` → out.
Full text: `git show 62c65a9db:cmem/binaryen-ts/overview.md`
