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

- ⚠️ **BREAKING: `WasmFunction.params` / `.results` are `sig`** (S6 step 5 item 6 (M6a)) — one
  `FuncSignature`, as a tag's has been since M2c. `ModuleBuilder.addFunction` is unchanged.
- ⚠️ **BREAKING: `WasmModule.heapTypes` is `types`** (wabt-ts's name; S6 step 5 item 6 (M5b)), and
  `ModuleBuilder.addHeapType` is `addType`. `FieldType` gains `name` (`''` where the module gave none).
  Fixed with it: the WAT parser dropped a written field name.
- ⚠️ **BREAKING: a type entry carries its `sub` and rec group** (wabt-ts's shape; S6 step 5 item 6
  (M5a)). `TypeDef` gains `name`, `sub?` and `recGroupSize?`; `FuncTypeDef.params` / `.results` are
  `sig.params` / `sig.results`, and `ArrayTypeDef.element` is `field`.
- ⚠️ **BREAKING: an import EMBEDS its entity** (wabt-ts's union; S6 step 5 item 6 (M4)).
  `WasmImport` was flat (`kind: 'function' | …`, `params?`, `initial?`, `shared?`, …); it is now
  `{ kind: ExternalKind.Func; module; field; func: WasmFunction }` and one arm per kind. `base` is
  `field`; the internal name lives on the entity (`imp.func.name`), or use the new `importName(imp)`.
  `ModuleBuilder.add*Import` signatures are unchanged (table / memory also take a `Limits`).
  binaryen-ts now reads an imported table64, an imported custom page size, and imported sizes past
  2^53 — all refused since M2g.
- ⚠️ **BREAKING: segments are wabt-ts's records** (S6 step 5 item 6 (M3)). `DataSegment`
  `{ passive, memory? }` is `{ kind: SegmentKind, memoryVar: Var }`; `ElementSegment`
  `{ mode, table, data: string[] }` is `{ kind, tableVar: Var, elemType: ValueType, elemExprs: RegionExpr[] }`
  — `declarative` is spelled `declared`. New exports `elemFuncEntry`, `elemFuncNames`.
- ⚠️ **BREAKING (types): `WasmGlobal.init` is optional** (S6 step 5 item 6 (M2h)), as wabt-ts's
  `Global.init` is — absent means missing. `encodeWasm` and `Module.toWat()` throw for a defined global
  without one; `ModuleBuilder.addGlobal` still requires it.
- ⚠️ **BREAKING: a table or memory holds a `Limits` record** (wabt-ts's; S6 step 5 item 6 (M2g)).
  `WasmMemory` `{ initial, max, shared, is64 }` is `{ limits }` — `initial` / `max?` as `bigint`, `isShared`,
  `is64`, `pageSizeLog2?`; `WasmTable` `{ type, initial, max }` is `{ elemType, limits, init? }`. `max` is
  ABSENT when unbounded, not `null`. `ModuleBuilder.addMemory` / `addTable` take a `Limits` or the old
  numbers; new export `limitsOf`. Imports are unchanged (flat) for now.
- ⚠️ **BREAKING (types): a custom section's `precedingSection` is optional** — `BinarySection | null`,
  absent when the position is not known (S6 step 5 item 6 (M2f)); such a section is written after
  every known section, as wabt-ts writes one.
- ⚠️ **BREAKING: `WasmExport.kind` is wabt-ts's `ExternalKind`** (`Func = 0` … `Tag = 4`, the binary's
  kind byte; S6 step 5 item 6 (M2e)), was `'function' | 'table' | 'memory' | 'global' | 'tag'`.
  `ModuleBuilder.addExport`'s kind argument likewise. Fixed on the way: `Module.toWat()` wrote an export
  as `(function $f)` — not WAT — and now writes `(func $f)`; the text parser refuses an unknown export
  keyword instead of storing it.
- ⚠️ **BREAKING: `WasmExport.value` is `WasmExport.var`**, a `Var` (S6 step 5 item 6 (M2d)). A name is
  `varName('$f')`, an index `varIndex(0)`. `ModuleBuilder.addExport` still takes a token (`"$f"` / `"0"`);
  the compat API's `getExportInfo().value` is still the name.
- ⚠️ **BREAKING: `WasmTag.params` is `WasmTag.sig`** (`{ params, results }`, S6 step 5 item 6 (M2c)). A tag
  whose type has results (invalid) now re-encodes naming its own type instead of appending one.
- ⚠️ **BREAKING: a constant expression is a `RegionExpr`** (S6 step 5 item 6 (M2)). `WasmGlobal.init`,
  `DataSegment.offset` and `ElementSegment.offset` were one `Expression` (offsets `| null`); read
  `.children`. An absent offset is a MISSING field. `ModuleBuilder.addGlobal` / `addDataSegment` still
  accept an expression (or a list, or a region).
- ⚠️ **BREAKING (types): binaryen-ts's expression types ARE wabt-ts's** (S6 step 5 item 5 (6c)).
  `Expression` is `Expr`; each node type (`BlockExpr`, `LoadExpr`, …) is `Extract<Expr, { kind }>` —
  same names, but READONLY: build a changed node (`{ ...e, field }`) rather than assigning into one.
  `RefNullExpr` has `refType` (item 5 (6b)); `BrOnExpr.opcode` is an `Opcode`; `RefTypeImmediate` is
  an alias of `br_on`'s `from`. `dropWrittenTypeIndex` returns the node instead of mutating it.
  `CodeMetadataExpr` is in the union: an optimization run strips it, a plain `encodeWasm` throws.
- **binaryen-ts reads, writes and optimizes the threads proposal's atomics and `call_ref` /
  `return_call_ref`** (S6 step 5 item 5 (5); divergence K1 closed). They were refused
  (`unknown opcode 0xfe` / `0x14`). New nodes `AtomicLoadExpr` … `AtomicFenceExpr`, `CallRefExpr`
  (wabt-ts's shapes), kind members `AtomicLoad` / `AtomicStore`, and factories `makeAtomicLoad` …
  `makeAtomicFence`, `makeCallRef`. Byte-identical round trip. Asyncify refuses `call_ref`.
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
- ⚠️ **BREAKING: a construct's type is what it DECLARES** (S6 step 5 item 5 (3); `./ir/binaryen-ts`).
  `BlockExpr` / `LoopExpr` / `IfExpr` / `TryExpr` / `TryTableExpr` `type` is a `BlockResult` (`'none'`
  | a value type | a list) — never `'unreachable'`, and REQUIRED (item 5 (4)). `BrOnExpr.from` /
  `to` are `?: RefTypeImmediate` (no present `undefined`). `makeBlock(children, name?, type?)` and
  `makeIf(cond, then, else?, name?, type?)` no longer INFER a type from the children / arms: omitted
  means `none`, as in text. `blockOf(region, type, name?)` and `asStatement(e, type)` take the type
  as a required argument. `makeLoop` / `makeTry` / `makeTryTable` take a `BlockResult`. The encoder
  no longer writes an `unreachable` after a construct typed `unreachable`; it throws. The compat
  API's `block` / `if` / `loop` still take their type from their contents.
- ⚠️ **BREAKING (types only): `ExpressionKind` is a const object plus a same-named union type**, not
  an enum (S6 step 5 item 5 (2); `./ir/binaryen-ts`). Values unchanged — they were already the kind
  strings. `ExpressionKind.Block` as a value and `ExpressionKind` as a type work unchanged, and a plain
  `'block'` is now an `ExpressionKind`; a member used as a TYPE is `typeof ExpressionKind.Block`
  (e.g. `Extract<Expression, { kind: typeof ExpressionKind.Block }>`).
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
  Then item 4 (a): **`CallIndirectExpr.typeIndex?: number` → `typeVar?: Var`** (`34901c5fc`, owner
  decision) — the decoder records `varIndex(i)`; read it with `requireIndex`.
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

- ⚠️ **BREAKING: `Func.body` is a `RegionExpr`** (S6 step 5 item 6 (M6b); `./ir/wabt-ts`) — read
  `.children` for the instruction list, as every other sequence in the tree is read.
- ⚠️ **BREAKING: `Func.localDecls` and `Func.localNames` are `Func.locals`** (S6 step 5 item 6 (M6c);
  `./ir/wabt-ts`). One slot per local, PARAMS FIRST, each `{ type, name? }` — binaryen-ts's `Local`.
  The run-length grouping was already re-derived by the writer, so emitted bytes are unchanged. New
  export `localNameEntries(locals)` for the name-section / text-writer shape.
- **A function declaring more than 1,000,000 locals is now REFUSED** (M6c). Five bytes can declare
  2^32 locals; with a slot per local the decoder ran out of memory before the spec's own "too many
  locals" check (on their sum) could refuse the module.
- ⚠️ **BREAKING (types): `Custom.data` is `Uint8Array | null`** (S6 step 5 item 6 (M2f); `./ir/wabt-ts`).
  `null` marks the `name` section's PLACE: a binary read with names now keeps that entry in
  `module.customs`, and the writer generates the names there. Only a section named `name` may have
  no payload; the writer throws for any other.
- ⚠️ **BREAKING: a constant expression is a `RegionExpr`** (S6 step 5 item 6 (M2), owner 2026-09-16;
  `./ir/wabt-ts`). `Global.init`, `Table.init`, `ElemSegment.offset` / `elemExprs[i]` and
  `DataSegment.offset` were `Expr[]`; read `.children`. Where one may be absent it is an OPTIONAL
  field and absent means MISSING — an imported global, a table without an initializer, a passive or
  declared segment — no longer `[]`. The binary writer throws for a required one that is missing.
- ⚠️ **BREAKING: `ValueType` is a value type** (S6 step 5 item 4 (b), `eec6912fd`; `./ir/wabt-ts`).
  It was `Type | RefValueType`; it is `ValType | RefValueType`, so `Type.Void`, `Type.Any`, the
  packed `Type.I8` / `Type.I16` and the type-definition forms no longer fit. **`StorageType`** (new)
  is a field's type — `Field.type` is one. `ValType` / `isValType` are now defined in
  `./core/wabt-ts` (still re-exported by `./ir/binaryen-ts`). `valueTypeName` and `isRefValueType`
  accept any `Type`.
- **Every expression node may carry `type?: ExprType`** (S6 step 5 item 5 (4); `./ir/wabt-ts`) —
  new, `ExprType` = binaryen-ts's `Type`; wabt-ts does not set it. ⚠️ **BREAKING:** `Catch.loc` and
  `TableCatch.loc` are optional (read them through `locOf`).
- ⚠️ **BREAKING: an expression node's `loc` is optional** (S6 step 5 item 5 (1); `./ir/wabt-ts`).
  Every `Expr` interface's `loc` is `loc?: Location`, as on binaryen-ts's nodes; absent means
  unknown. wabt-ts's parser and reader still set it. **`locOf(e)`** (new) returns it or the
  (frozen) unknown location — use it where a `Location` is required.
- ⚠️ **BREAKING: `CallIndirectExpr.typeVar` is optional and `typeUse` is gone** (item 4 (a),
  `34901c5fc`; `./ir/wabt-ts`). An inline signature has no `typeVar` until `synthesizeTypes`
  interns one (it was `varIndex(0)`); how the type was written is `FidelityEntry.typeUse`. The
  binary writer THROWS and the validator REPORTS a `call_indirect` with no type.

- ⚠️ **BREAKING: bodies are regions** (S6 step 5 stage (d), `ddc45cbb1` + `e9c029ffb`;
  `./ir/wabt-ts`). `BlockExpr.body` → **`children`**. `LoopExpr` / `TryExpr` / `TryTableExpr`
  `body`, `Catch.body` and `IfExpr.ifTrue` are a **`RegionExpr`** (`{ kind: 'region', children,
  loc }`, a new `Expr` kind, built with `region()`) — read `.children`. **`IfExpr.ifFalse` is
  `RegionExpr | null`**: `null` is no `else` (it was `[]`), an empty region an explicit empty one.
  `Func.body` is unchanged.

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
- **StripEH and Inlining build no construct typed `unreachable`** (S6 step 5 item 5 (3b)): a replaced
  `throw` (or an inlined call that never returns, or a void `return_call`) becomes statements spliced
  in place, not a block the encoder followed with an extra `unreachable`; an inlined body's block
  declares the callee's results. -O3 over the corpus: 143 modules smaller, −903 bytes, none larger;
  old and new run identically (708 calls + memory). New public helper `mapWithSequences` / `Sequence`
  (`binaryen-ts/ir/walk.ts`); `stripEHNode` returns `Expression | Sequence`.
- **LocalCSE follows upstream's `isRelevant`** (`5b0cf25c6`): -Oz −3.9% over the corpus, 0 of 421
  modules larger.

## Correctness fixes that were silent before

- **binaryen-ts kept a table64 a table64** (S6 step 5 item 6 (M2g)). The table reader took the whole
  flag byte as "has a maximum": a 64-bit table decoded as a 32-bit one and was re-encoded as one — 11
  spec binaries, some left invalid. Also now read, not refused: memory / table sizes past 2^32, table
  initializers; kept, not ignored: a custom page size.
- **binaryen-ts keeps a type's SUBTYPING and its rec groups** (S6 step 5 item 6 (M5a)). A
  `(sub $super)` declaration was read into nowhere and never written, and a `(rec …)` group was
  flattened into singletons — both silent, and both change what the module MEANS. 83 spec binaries
  carry rec groups; all 83 re-encoded differently before this, and 68 whole binaries now round-trip
  byte for byte that did not.
- **binaryen-ts keeps an element segment's ELEMENT TYPE and its entries** (S6 step 5 item 6 (M3)).
  The type was discarded — a `(ref func)` or `externref` segment came back as `funcref`, which makes an
  invalid module (a `funcref` segment against a `(ref func)` table) look valid — and an entry could only
  be a function index: `ref.null` was refused, `global.get` unreadable. 175 spec binaries that
  re-encoded DIFFERENTLY now round-trip byte for byte, and 97 that were refused do too. A module whose
  only table is imported no longer gains an empty table section.
- **binaryen-ts reads constant expressions of more than one instruction** (S6 step 5 item 6,
  2026-09-17): extended-const and GC initializers and offsets decode and round-trip byte for byte (53
  spec binaries that were refused). Found on the way and fixed: an element segment with a typed
  reference element type (`(ref $t)`, `externref`, …) was read with a ONE-byte type, and came back empty
  or as `funcref` — silently; it is now refused until element types are carried.
- **binaryen-ts no longer truncates a constant expression** (M2g). A global / offset / table
  initializer of more than one instruction (extended-const, GC) lost all but its first, silently; it is
  now refused (43 spec binaries) — reading them is still to come. An imported table64 is refused too.
- **wabt-ts keeps the `name` section where it was** (S6 step 5 item 6 (M2f)). A binary laid out `name`,
  then `producers` — clang's and rustc's layout — was written back with the name section moved last.
  (Names wabt-ts could not fully parse were already kept as bytes, in place.)
- **wabt-ts keeps a table's PRESENT-but-empty initializer** (S6 step 5 item 6 (M2)). `40 00 70 00 01 0b`
  was written back as `70 00 01`: an empty initializer read as none. Invalid modules only.
- **Two optimizer passes had no case for `call_ref`**, found while porting it (item 5 (5)) — no
  release carried `call_ref` through binaryen-ts, so no shipped output was affected: LocalCSE reused
  a `global.get` across a `call_ref` that writes the global, and the CFG drew no exceptional edge
  from a throwing `call_ref`, so CoalesceLocals dropped a set live on a `catch` path.
- **binaryen-ts's WAT parser gives a construct its DECLARED type** (S6 step 5 item 5 (3a)). An
  unannotated `block` / `if` / `try` / `try_table` whose body ends unreachable — `(block
  (unreachable))`, an `if` whose arms both trap, a typed `if` likewise — was typed `unreachable`, and
  the encoder wrote an `unreachable` after its `end` that the source did not have. Valid output, one
  byte per such construct longer; now identical to the binary decoder's.

- **wabt-ts REJECTS non-value types in value positions** (`eec6912fd`). It accepted modules V8 and
  upstream reject: a binary local, param, result, global or block result of a packed (`0x78`) or
  non-type byte (`0x40`, `0x60`), and text `(local i8)` / `(param i16)` / `(result i8)`. The reader now
  reports upstream's "expected valid local type" / "… block signature type"; the text parser
  "expected value type, got i8". ⚠️ A module that relied on the old leniency now fails to load —
  but no valid module does (spec corpus unchanged at 100%).
- **wabt-ts's binary round trip kept an explicit EMPTY `else`** (`e9c029ffb`): `04 40 01 05 0b` was
  written back as `04 40 01 0b`. Same behaviour, different bytes; binaryen-ts and `wasm-tools` keep it
  (divergence E1). Text is unchanged — `wat2wasm` still omits an empty `(else)`, as upstream.
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
