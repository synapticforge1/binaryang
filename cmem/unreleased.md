# Unreleased on `main` — what the next release note must say

**`deno.json` reads 1.5.4 and is deliberately NOT bumped.** The version line arms a release
([publishing.md](publishing.md)), so the bump happens when the owner decides to ship, not while work
runs. Everything below is merged to `main`, unpushed, and green as of 2026-09-12: **1043 tests / 0
ignored, baseline IDENTICAL, spec 100% on four axes, bridge 421/421 since 2026-09-15.** Re-derive
before quoting.

Gathered 2026-09-14 from `open-work.md` and from machine-local memory, where half of it was the only
copy. ⚠️ **Several of these are API-VISIBLE changes to a PUBLISHED package** — the next version is
not automatically a patch; see [publishing.md](publishing.md) § "`bump` has no minor mode".

⚠️ **wasmtk pins binaryang EXACTLY** (1.5.3 in wasmtk 2.0.2), so nothing here reaches it without
their own bump — and nothing breaks by their standing still.

## What 1.5.4 already shipped (for contrast)

- **`wasm2wat` emits FOLDED output by default**; `--linear` / `{ fold: false }` opts out. A DEFAULT
  change, not a capability change — measured before it was made: emitted wasm bytes unchanged on all
  421 corpus modules, linear text byte-identical to the old baseline, the new default assembling to
  exactly linear's bytes.
- **The export-kind check** (`9b54db228`, found by A3): an out-of-range export kind used to decode;
  it now yields a diagnostic.

## API-visible — binaryen-ts IR (`./ir/binaryen-ts`) and its factories

- ⚠️ **BREAKING at run time: `ValType`'s VALUES are the wire bytes** (S6 step 5 stage V1). Exported
  from `./ir/binaryen-ts` and `./api`. `ValType.I32` is now `0x7f`, not `'i32'` — equal in value to
  wabt-ts's `Type` member of the same name. Code that uses the members symbolically is unaffected;
  code that relied on the STRING (printing a type, `JSON.stringify` of IR, `t === 'i32'`,
  `typeof t === 'string'` to spot a scalar, `Object.values(ValType)`) is not. New public exports
  (`./ir/binaryen-ts`): `valTypeName`, `valTypeFromName`, `isValType`. Every emitted byte is unchanged
  (baseline IDENTICAL). A patch release cannot carry this.
  **Then stage V4:** `ValType` is a const object over wabt-ts's `Type` plus a same-named union type, not
  an enum — the value-type SUBSET of `Type`, so `Type.I32` is assignable to `ValType` and back.
  `ValType.I32` and `ValType` as a type work unchanged; an enum reverse lookup (`ValType[127]`) does
  not, and a member used as a TYPE is `typeof ValType.I32`. wabt-ts's `Type` gains `StringRef`
  (`./core/wabt-ts`).
- ⚠️ **BREAKING: a heap type is a `HeapTypeRef` object** (S6 step 5 stage V2). binaryen-ts's
  `HeapType` was `AbstractHeapType | number`; it is now wabt-ts's `HeapTypeRef` —
  `{ kind: 'abstract', name }` or a `Var`. `RefType.heap`, `ref.test`/`ref.cast`'s `castType` and
  everything that reads them change shape: `{ heap: 0 }` is `{ heap: varIndex(0) }`, and
  `{ heap: AbstractHeapType.Any }` is `{ heap: heapAbstract(AbstractHeapType.Any) }`. A compile error
  for TypeScript consumers; for JavaScript consumers, `h === 0` / `typeof h === 'string'` silently
  stop matching. New exports: `heapAbstract`, `sameHeap` (compare heap types with it, never `===`).
  `isAbstractHeapType` now narrows to the abstract arm. Bytes unchanged.
- ⚠️ **BREAKING: one reference-type record** (S6 step 5 stage V3). binaryen-ts's `RefType.heap` is
  `heapType`; wabt-ts's `RefValueType` (`./ir/wabt-ts`) no longer has `kind: 'ref'`. Both are
  `{ heapType: HeapTypeRef; nullable: boolean }`. Code that built `{ kind: 'ref', … }` gets a compile
  error; code that tested `vt.kind === 'ref'` must use `isRefValueType` / `isRefType`. Bytes unchanged.
- **Field renames and optionality** (S6 step 5 stages A, A2, B — all on binaryen-ts nodes):
  `CallExpr.func` (was `target`) ·
  load/store/`simd.load*` `address` (was `ptr`) · `SIMDShuffleExpr.lanes` (was `mask`) ·
  `LocalGet/Set/TeeExpr.var` (was `index`) · `isReturn?`, `defaultInit?`, `ArrayNewExpr.init?`,
  `BreakExpr.condition?` (were required or `| null`) · `StructGet/ArrayGetExpr.signed?`, three states
  (absent = plain `get`) · `memidx` REQUIRED on every memory access (was optional, absent = 0).
  wabt-ts's `TableFillExpr.dest` (was `start`) and `TableGrowExpr.value` (was `initValue`) and
  `UnaryExpr.value` (was `operand`) moved on `./ir/wabt-ts`.
  Then stages S1–S3: `RefTestExpr`/`RefCastExpr` `heapType` (was `castType`) · `RefFuncExpr.func` a
  `Var` (was `string`; `makeRefFunc` takes a `Var`) · `SelectExpr.resultType` a `ValueType[]`, empty
  for untyped (was `ValueType | null`; `makeSelect` still accepts `null` or one type).
  Then stage L1: every LABEL REFERENCE is a `Var` — `BreakExpr.target`, `SwitchExpr.targets` /
  `defaultTarget`, `BrOnExpr.target`, `RethrowExpr.target`, `CatchClause.target` (were `string`) —
  and `TryExpr.delegate?: Var` (was `delegateTarget: string | null`). The factories still take
  label NAMES. New export `labelName(v)`, which throws on an index-form reference.
  Then stages B1–B3: wabt-ts's `BrTableExpr.condition` (was `value`) · wabt-ts's `BrOnExpr.opcode: Opcode`
  (was `op`, a string union) with ONE `BrOnOp` const of numeric opcodes, re-exported by binaryen-ts
  (wabt-ts's `BrOnOp` was the string union) · binaryen-ts's `BrOnExpr.values` (new).
  Then stage C1: `ConstExpr.value` is wabt-ts's `Const` — `{ type, value }` for integers, `{ type, bits }`
  for FLOATS (raw IEEE 754), `{ type, bytes }` for v128; `Literal` is an alias of it. `'i32' in v` no
  longer works (and still compiles): test `v.type === ValType.I32`. New: `makeF32ConstBits`,
  `makeF64ConstBits`, `f32BitsOf`, `f64BitsOf`, `literalFloat`.
  Then stage L2: a carrier's OWN label is **`label: string`**, `''` for none — `BlockExpr`,
  `LoopExpr`, `IfExpr`, `TryExpr`, `TryTableExpr` (were `name`, spelled three ways:
  `string | null`, `string`, and `string | undefined`). The `make*` factories still take
  `string | null` and map `null` to `''`. ⚠️ **A null test against these still compiles**:
  TypeScript exempts `=== null` from its no-overlap rule, so `block.name === null` becomes
  `block.label === null`, which is always false — test `=== ''`, or truthiness.
  Then stage (b), the catch records: **`TryCatch` → `Catch`, `CatchClause` → `TableCatch`**
  (`11e632b8e`, wabt-ts's and upstream wabt's names; the `tryCatch` / `tryCatchAll` factories keep
  theirs). The shapes did not change on this side.
- **Region bodies** (S6 decision 5, `7f3ec1d6e`): every region slot — `LoopExpr.body`,
  `IfExpr.ifTrue` / `ifFalse`, `TryExpr.body`, `TryCatch.body`, `TryTableExpr.body`,
  `WasmFunction.body` — is a `RegionExpr` (new `ExpressionKind.Region`). Factories and
  `ModuleBuilder.addFunction` accept an `Expression` or a list and wrap it; code READING a body as
  its lone instruction must use `asStatement` or the region's `children`.
- **Load / store hold their `opcode`** (decision 4, `813fce2a4`) instead of `bytes` / `signed`:
  `makeLoad(opcode, offset, align, ptr, memidx?)` and `makeStore(opcode, …)` are opcode-first.
  `loadShape` / `storeShape` / `withSigned` are exported for anyone who read `.bytes`.
- **`AbstractHeapType`** string VALUES changed (`ext` → `extern`, `noext` → `noextern`) and it is a
  const object rather than an `enum` (TypeScript string enums are nominal and could not sit in the
  shared heap-type union). Member names unchanged.
- **`makeTry`** lost two parameters: catch clauses are records, not parallel `catchTags[]` /
  `catchBodies[]`. **`RefAsOp` is gone.**
- **Branch and return values are a list** (decision 6A, `15c6ef763`): `values: Expression[]` on
  break / switch / return; there is no `tuple.make` kind.
- **Block parameters stay on the node** (7b(i), `527759f58`) as `params?: BlockParams` on block /
  loop / if / try / try_table; `PassRunner` lowers them before the first pass.
  `SelectExpr.resultType` (7a).
- **Written type index on the node** (7c, `7a87af4b9`): `CallIndirectExpr.typeIndex` and block
  headers written as an index; dropped by `PassRunner` before the first pass.
- **Renames from Group 3 and the label family** (2026-09-11): `SelectExpr.val1` / `val2`;
  `IfExpr.ifTrue` / `ifFalse`; `BrOnExpr.from` / `to`; `CallIndirectExpr.target` → **`callee`**;
  every single-label reference is **`target`** in BOTH IRs (`BreakExpr.name`, `BrOnExpr.label`,
  `CatchClause.dest`, wabt-ts `RethrowExpr.depth` all renamed); the catch tag is `tag?: Var` on both
  legacy and `try_table` clauses.
- **`CallIndirectExpr.params` / `results` → `sig: FuncSignature`** (owner decision 3, `b034cedb1`),
  and **`makeCallIndirect(table, callee, operands, sig, isReturn?)`** takes the signature as one
  object — five arguments where there were six. `FuncSignature` is a new export. The compat
  facade's binaryen.js-shaped `call_indirect(table, target, operands, params, results)` is
  unchanged.
- **The SIMD lane shifts are a `binary`** (K3, 2026-09-14): `ExpressionKind.SIMDShift`,
  `SIMDShiftExpr`, `SIMDShiftOp` and `makeSIMDShift` are REMOVED. Build a shift with
  `makeBinary(BinaryOp.ShlVecI8x16, vec, count)` — the twelve members keep their names and opcodes,
  now on `BinaryOp`. Code matching `kind === 'simd.shift'` or reading `.vec` / `.shift` must read a
  `binary`'s `left` / `right`, whose types differ (v128, i32). Bytes unchanged; LocalCSE now reuses
  a repeated shift.
- **New pass `TranslateToExnref`** (owner decision 7, `11517b29a`; `translate-to-exnref` resolves
  too): legacy EH — `try` / `catch` / `catch_all` / `delegate` / `rethrow` — into `try_table` and
  `throw_ref`, so a legacy-EH binary runs on Wasmtime and Wasmer. Opt-in; no optimization level
  runs it.
- **Wide arithmetic** in binaryen-ts: `i64.add128` / `sub128` (a new `Quaternary` node) and
  `i64.mul_wide_s` / `_u` (two new `BinaryOp` members).
- **`WasmModule.explicitNames`**: a module decoded from a binary WITH a name section carries its
  names and re-encodes them; `ModuleBuilder.addFunction` takes optional `paramNames`.
- **`WasmModule.customSections`**: every custom section is kept, each with the known section it
  FOLLOWED, and written back into that gap (C3, `4c162c584`).

## API-visible — wabt-ts and the tools

- ⚠️ **BREAKING: a block-type carrier holds its signature, not a header** (S6 step 5 stage (c),
  `38a47be36` + `f4e04989f`; `./ir/wabt-ts`). On `BlockExpr`, `LoopExpr`, `IfExpr`, `TryExpr`,
  `TryTableExpr`: `blockType` is GONE; `type: BlockResult` holds the declared results (`'none'`,
  the value type, or a list of two or more), `typeIndex?` the type index the header named, and
  `params?: { types, values }` the entry parameters — ⚠️ the entry VALUES are children of the
  carrier now, no longer its preceding siblings in the body. `blockTypeOf(e)` gives the header
  (`BlockType`) a node writes; `blockResult` / `blockResults` convert. `FidelityEntry.blockType` is
  gone. The validator REJECTS a node whose `typeIndex` names a different signature than its `type`
  and `params`, or that needs an index and has none.
- ⚠️ **BREAKING: `TableCatch` is `{ loc, tag?, target, isRef }`, and `CatchKind` is GONE** (S6
  step 5 stage (b), `e9f6721e4`; exported from `./ir/wabt-ts`). 1.5.4 had
  `{ kind: CatchKind; tag?; target }`. Read a clause as `tag !== undefined` (catch / catch_ref) ×
  `isRef` (the `_ref` pair) — how the legacy `Catch` always held it, and binaryen-ts's `TableCatch`.
  (An intermediate two-shape union, `b1410d6e8`, was never released.)

- **`wat2wasm` output carries a name section** (N1, `7520ed7d3`) — +29.5% over the corpus, accepted
  by the owner. `WriteBinaryOptions.writeDebugNames` now works and defaults to true.
- **`wasm2wat` no longer invents `$f0`-style names**; ask with `generateNames` / `--generate-names`,
  as upstream.
- **Names that are not all idchars print QUOTED** (`$"foo bar"`), where upstream renames to `_`.
- **`Module` gained a required `hasNameSection`** (use `makeModule`) and `Module.localNamesListed`.
- **`WriteWatOptions.namedLabelTargets`** (`2abb7880c`, default off): `wasm2wat` sets it, so a
  branch to a named label prints `br $outer` (N8, `61d991592`); a text-parsing caller does not.
- **`wasm2wat` prints every custom section with its position** —
  `(@custom "producers" (after data)
  …)` — and `wat2wasm` honours it (C2, `13f0e806e`). A
  `(@custom "name" …)` in text IS the name section and none is generated beside it (C5).
- **An array field may be written `(array (field $name …))`** and the name survives the text (A1,
  `feea95f09`).

## Behaviour changes — bytes move

- **Dead functions are removed at every `-O` level, as upstream** (owner decision, 2026-09-14; was
  divergence I1): `RemoveUnusedModuleElements` now runs before the function passes from `-O2` and
  at the end at `-O1` and up, and `Inlining` removes only functions it inlined. Corpus: `-O1` /
  `-O2` −39% bytes (7,620 → 3,943 functions), `-O3` −13%, `-Os` / `-Oz` unchanged. A caller that
  optimizes a module and then looks for an UNEXPORTED function by name may no longer find it.
- **DataCount only when code names a data segment**, or when the input binary had one — both writers
  (W6, `3db3106dc`); 3 bytes smaller on 273 corpus modules.
- **Implicit types in upstream's order** (W5, `964d80c46`) — this can change what a `(type N)`
  naming an implicit type MEANS. A single typed-ref block result is written inline in both writers.
  wabt-ts's `wat2wasm` now equals upstream on 421/421 outside custom sections.
- **`PassRunner` / `optimize` drops names unless `debugInfo`**; imported memories are named by index
  (`mem1` where two collided on `mem0`).
- **A name section's LOCAL subsection keeps the shape it was read with** (N6, `5d3ebb9ef`); 376 real
  WASI binaries went 366 → 374 byte-identical.
- **LocalCSE follows upstream's `isRelevant`** (`5b0cf25c6`): -Oz −3.9% over the corpus, 0 of 421
  modules larger.

## Correctness fixes that were silent before

- **A binaryen-ts block header WITH parameters kept its written type index** only when that index was
  the first match (`1d8a72be3`): with two identical types, `block (type $b)` re-encoded as
  `block (type $a)` — `02 01` → `02 00`. Valid and the same behaviour; different bytes.
- **Inlining a callee with several results produced invalid modules** at `-O3` — 16 corpus
  modules, whose string and math helpers return pairs: the wrapper declared only the first result.
  It now declares them all, as upstream; and a reference comparison that would have appended a
  trapping `unreachable` after such a body is gone. Loud before (engines refused), not silent.
- **`-O3` removed a recursive function it had inlined** (`426e78eb8`) while the inlined copy still
  called it, so the module could not be encoded ("unresolved call target reference") — three corpus
  modules. Loud, not silent. Every other corpus `-O2` / `-O3` / `-Oz` output is byte-identical.
- **The non-nullable-local fixup runs** (`135a81f99`): `PassRunner` documented it and never did it,
  so Flatten (and Asyncify, which runs it) could leave a non-nullable local read where no set
  covers it — a module V8 refuses. Such a local now becomes nullable with `ref.as_non_null` at its
  reads, as upstream does. Not silent — the engine refused — but it was a documented guarantee the
  code did not keep. No byte change where nothing was broken (corpus `-O2` / `-O3` / `-Oz`
  identical).
- **DCE deleted a value still needed after a void `if` whose arms both throw or trap**
  (`959954015`), so `-Oz` produced a module engines refuse — 30 of the 70 legacy EH spec
  assertions, and not EH-specific. The decoder now keeps every `if`'s declared type, and the
  encoder writes an extra `unreachable` after a construct a pass typed unreachable, as upstream
  does. Decode → encode is still byte-identical (divergence U1).
- **wabt-ts `wat2wasm` wrote a named branch after a legacy `delegate` one frame too deep**
  (`dd3c138ec`): the binary writer leaked the delegate's label. Valid bytes, a different program —
  `br 1` where upstream writes `br 0`; a later function refused the module instead.
- **A multi-result `if` / `loop` / `try` / `try_table` lost its extra values through binaryen-ts's
  decoder** (`2e02963bc`) when a later instruction consumed them one at a time: a plain decode →
  encode wrote `unreachable` into a module that validated and trapped. `block` was already right.
- **memory64 memarg offsets round-trip** — `writeU32` had truncated anything above 2³²: valid wasm,
  wrong address.
- **`catch_ref` / `catch_all_ref`** are supported where the bridge threw "not yet supported".
- **binaryen-ts wrote `i64.store8/16/32` at the wrong WIDTH**, cancelled by an inverse decoder
  rotation so every round trip looked identical (`b8b3150db`).
- **binaryen-ts's WAT parser** wrapped out-of-range `i32.const` silently and rejected valid
  unsigned-range `i64.const` (`a73daee32`), and accepted nonexistent memory mnemonics —
  `f32.load8_s` encoded as `f32.load` (`006326af7`).
- **An emitted unnamed block / if / try captured a `br` meant for the function frame** (V8-valid,
  wrong value); **the decoder invented a `nop` for an empty body and dropped an explicit empty
  `else`** (`365e9277c`).
- **An imported tag's `throw` / `catch` decoded with no payload** (`874caf068`).
- **Two `name` sections**: the first was dropped on a plain read → write; names now come from the
  LAST, as every upstream reads them (N5).
- The full pre-6/7 queue — multi-value `br_table` values, typed `select` `0x1c`, WAT type uses, the
  convert pair as real nodes, an empty `(else)` — is the "Closed" table in
  [divergences.md](divergences.md).

## From the 1.5.5 quality passes

Seven passes, ~20 defects fixed; the corpus went from 383/421 validating and 1/421 byte-identical to
**421/421 and 421/421**, size delta zero. Per-pass register: [testing.md](testing.md). Among them:
C9's `ElementSegment.mode` unblocked passive and declarative segments, `table.init`, `elem.drop` and
six other `0xFC` ops; an element-segment stub had silently emptied every function table; an
anonymous-function name collision turned `(call 1)` into infinite recursion.

## Not release-note material, but true of `main`

- **The bridge carries element segments and the start function.** Both were SILENTLY dropped —
  `module.elemSegments` and `module.start` were never read — so every bridged module's tables were
  empty (any `call_indirect` trapped with "null function") and a start function never ran. The
  module doc had claimed both "will throw"; it has now been wrong twice in the same direction, and
  says so. `deno task bridge` stayed 421/421 across the fix, before AND after: it COMPILES what the
  bridge builds and never runs it, so a module with an empty table is perfectly valid to it. Fixed
  ahead of S6 step 5 deliberately, so bridged output can be RUN and its behaviour measured before
  the bridge is deleted (owner, 2026-09-15). Tests: `tests/bridge/module_surface.test.ts`, which
  instantiates and calls.

- **`deno task bridge` reaches 421/421** (`ed38c084f`): the bridge resolves a `call_indirect`'s
  signature from the type it names. The bridge is internal and unexported, so nothing ships against
  it — but this is S6 step 5's acceptance criterion, met ahead of the step.
- `npm:binaryen` is pinned to **132** in the SOURCE (`dea8ff9cf`), where Deno enforces it — the lock
  had silently resolved 116. See [testing.md](testing.md) § "Independent oracles".
- The corpus round trip over binaryen's own tests runs again and guards every index space
  (`456423b54`); the live binaryen interop tests run on availability (`cec3a3381`).
- **`deno task bump` then `deno task release` works as documented** (owner decision 6, 2026-09-14).
  It used to refuse at its own guard because the bump also dirties `main.ts`. `RELEASE_FILES` in
  `scripts/release/release-guard.ts` is now the one list the release stages and the guard exempts —
  [publishing.md](publishing.md) § "The flow".
