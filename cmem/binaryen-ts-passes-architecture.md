# binaryen-ts: passes and architecture

What the predecessor knew about the optimization passes (including Asyncify) and the per-subsystem design, still current. Last verified 2026-11-20. The rest is in [binaryen-ts.md](binaryen-ts.md).

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
- [reference] **Walk API** (`src/ir/walk.ts`): `mapExpression` bottom-up, `walkExpression` pre-order,
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
  ⟶ S6 `c1af6a635`: field names were `name`/`label`/`catches[].dest`; every single-label reference is now `target`.
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
  is superseded by N1 P4 (`8c2d0be3d`, `src/binaryen-ts/binary/names.ts`); `asyncify.ts` ~541–545 still states the
  old limitation, and its multi-memory guard (~263) says loads carry no memory index — both stale; neither re-probed.

**Already in the core**
- "The 19 placeholder kinds are a roadmap" ⟶ superseded by S5's ratchet (`PHANTOM_BUDGET` in
  `scripts/check-operator-mapping.ts`, now 6) → divergences.md K1; LocalCSE C1 → divergences.md; block params
  before any pass → divergences.md B1; `-Oz` `try_table` miscompile → handoffs.md § 3

**History, summarized**
- binaryen-ts Phase 4.1 CFG liveness + CoalesceLocals; Phases 5 / 5.1 / 5.2 Inlining, split and return-call
  inlining; Phase 6 native `wasm-opt` CLI (`src/tools/wasm-opt.ts`); `-O0` skips passes.
- Asyncify: Stage 1 `673890b` ABI + options; 2 `bc9a498` analysis; 3a `44fe16a` Flatten (surfaced `mapChildrenShallow`);
  3b `54cdf38` flow; 4 `d162e5e` locals; 5 `952d151` registered. Import mode 2026-07-08; liveness-minimized saving
  2026-07-09 (v1.4.2); audit-hardening 2026-07-08 (suite 397 → 401). Tests in `tests/binaryen-ts/passes/asyncify*.test.ts`.

Full text: `git show 62c65a9db:cmem/binaryen-ts/passes.md`

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
  type or `encodeWasm` throws `unresolved GC function type` (documented at `src/ir/module.ts:751`).
  `ref.eq` is `0xd3`, unprefixed.
- [reference] **SIMD**: `0xFD` + U32 LEB sub-opcode; SIMD prefix checks must precede scalar ones in
  `inferUnaryType`/`inferBinaryType` (`i32x4.splat` misclassifies otherwise).
- [decision] **Three optimization tiers** (binaryen-ts Phase 0): native passes (default); `hybridMode` → system
  `wasm-opt` subprocess; in-process binaryen.js (`src/binaryen-ts/interop/binaryen-js.ts`, a factory namespace per
  `WebAssembly/binaryen/src/js/binaryen.js-post.js`, not the C-API shape). [open] the hybrid path feeds
  `Module.toWat()` output, which is invalid WAT → divergences.md K4.
- [decision] **`./compat/binaryen`** (`src/compat/binaryen-compat.ts`): migrating code changes only its
  import; upstream numeric constants mirrored exactly (⚠️ **not true today** for the reference-type
  IDs, `auto` and the Features bits — measured against binaryen.js 132, 2026-10-28, divergence
  CL17; open-work 52 (a)); `Module.optimize()` runs the in-tree `PassRunner` (bytes may
  differ from upstream, both valid); unrecognised type IDs throw (`_idToValTypeStrict`). SIMD/GC/EH factories and
  Relooper are omitted. `else_` there is a public parameter — do not rename it with the IR field.
- [baseline] **WASM kernels** (`src/binaryen-ts/wasm/`, `wasm-runtime.ts`): per-call boundary tax ~2–3 ns (WASM
  `add_i32` ~3.6 ns vs ~0.34 ns native); a kernel pays only if per-op savings × ops per call exceeds it, so single-i32
  dispatch never does. Kernel selection PARKED (binaryen-ts Phase 10; owner, 2026-09-29) → project.md § "Live gaps".

**Already in the core / superseded**
- Phase 11 cross-runtime rules ("no `Deno.*` in `src/`", `node:` everywhere, browser-safe subpath list, no
  `import.meta.main`, `lib: [deno.ns, esnext, dom]`) → superseded by project.md § "Runtime portability, layered"
  (library layer: no `node:` either; checked by `scripts/check-portability.ts`) and § "Decided at the pre-merge
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

Full text: `git show 62c65a9db:cmem/binaryen-ts/architecture.md`
