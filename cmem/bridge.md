# Phase 7 — binaryen bridge

`bridgeToBinaryen(module)` in `src/bridge/binaryen-bridge.ts` (+ `src/bridge/type-map.ts`) is a
**post-order recursive walk** over the wabt IR that calls binaryen-ts's constructor API directly.
The bridge is a pass over the wabt IR, not a separate format/layer.

## Why direct recursion (not delegate-driven)

binaryen-ts constructors are **bottom-up**: leaves are constructed first and passed into parent
constructors. A recursive `bridgeExpr` falls out naturally. A delegate/visitor walk would have to
maintain its own operand stack to reassemble the tree — strictly more complex with no benefit. (The
old CLAUDE.md "ExprVisitorDelegate" note was wrong; recursion is the right shape.)

**Design constraint that makes this work:** wabt-ts IR expression nodes support clean post-order
recursion — no parent context needed to resolve a child, no upward references.

## binaryen-ts constructor API (stable as of binaryen-ts v1.0.9; submodule pinned `6c6f81f66`)

Read these instead of trusting any snippet if they diverge:
`binaryen-ts/src/ir/module.ts` (`ModuleBuilder`), `binaryen-ts/src/ir/expressions.ts` (every
`make*`), `binaryen-ts/src/ir/types.ts` (`ValType`).

- `ModuleBuilder`: `addFunction`, `addGlobal`, `addMemory`, `addDataSegment`,
  `addPassiveDataSegment`, `addTable`, `addFunctionImport`, `addGlobalImport`, `addTableImport`,
  `addMemoryImport`, `addExport`, `addTag` (v1.0.9, EH), `addHeapType` (v1.0.9, GC), `build`.
- Instruction constructors by category: const/local/global · arithmetic/compare
  (`makeBinary`/`makeUnary` — there is **no** `makeCompare`/`makeConvert`) · control flow · call ·
  memory · reference/GC.

**Critical:** `makeI64Const` takes **`bigint`**, not `number` — call `BigInt(n)`.

**Bridge type mapping (lives on the wabt-ts side):** `wabtTypeToValType(t)` maps 0x7f→I32, 0x7e→I64,
0x7d→F32, 0x7c→F64, 0x7b→V128, 0x70→FuncRef, 0x6f→ExternRef; throws on unknown.

**Import constructors are self-contained** (no type-section side-channel). `addMemoryImport.initial`
is required; `addTableImport.initial` optional (default 0); `addTableImport.type` defaults to
FuncRef.

**f32/f64 const reinterpret:** wabt-ts stores raw IEEE-754 bits (`number`/`bigint`); binaryen-ts's
`makeF32Const`/`makeF64Const` take the float value. `bridgeConst` does the bits→float reinterpret via
a shared buffer.

## Tier coverage (~60 expression kinds + module surface)

- **Tier A** — core compute + control flow. ✅ 18 kinds (locals/globals/unary/compare/convert/
  return/drop/nop/unreachable/block/loop/if/br/br_if/br_table).
- **Tier B** — common patterns. ✅ 7 kinds (call, call_indirect, select, load, store, memory.size,
  memory.grow). `tests/bridge/tier_b.test.ts`.
- **Tier C** — proposal-gated, partial. ✅ ref types (ref.null/func/is_null); SIMD basics
  (v128.const, splat, lane arithmetic, extract/replace_lane, i8x16.shuffle); SIMD memory
  (load_splat/load_zero/simd_load_lane/simd_store_lane — `load` case detects SIMD-prefix opcodes via
  `simdLoadOpForOpcode`); EH (tag defs via `bridgeTag` + `module.tags` walk, throw, throw_ref,
  try_table incl. catch clauses, `buildCatchClause` mapping the four `CatchKind` variants).
- **Tier D** — module-level. ✅ memory + table exports (`addExport(…, "memory"|"table")`); active +
  passive data segments (`bridgeDataSegment`). `tests/bridge/tier_d.test.ts`.
- **GC Tier 1** — i31 + ref.eq (v1.1.9). ref.eq (0xd3), ref.i31 (0xfb 0x1c), i31.get_s/_u; 8 abstract
  heap types. `gc_tier1.test.ts`.
- **GC Tier 2** — struct.\* (v1.2.3). WAT parser for `(type $name (struct (field …)))`; 6 instrs
  (new/new_default/get/get_s/get_u/set); `addHeapType` up front, wabt→binaryen heap-type-index map in
  `BridgeCtx.heapTypeIdx`; `varIdx` throws on unresolved name-var. `gc_tier2.test.ts`.
- **GC Tier 3** — array.\* (v1.2.4). 10 instrs (new/new_default/new_fixed/new_data/new_elem/get/
  get_s/get_u/set/len). `gc_tier3.test.ts`.
- **GC Tier 4** — ref.test / ref.cast (v1.2.5). `(ref [null] H)` heap-type immediate; new
  `parseRefImmediate`, `resolveHeapTypeVar`, `readHeapTypeVar`, `writeHeapType`, `heapTypeForBridge`.
  `gc_tier4.test.ts`. **`br_on_cast`/`br_on_cast_fail` deferred** — enum/name-map entries exist
  (0x18/0x19) but no IR/parser/writer/bridge wiring.

## Cumulative gotchas

1. **`makeBlock`/`makeIf` infer type from the last child.** For early-exit blocks (last child is
   `br`/`return`/`unreachable`, type `unreachable`) that loses the block's declared signature. Use
   `withDeclaredType(expr, declared)` to override `.type` after construction.
2. **binaryen-ts collapses compare→binary and convert→unary.** No `makeCompare`/`makeConvert`. The
   opcode-name string from `anyOpcodeName(op)` equals the `BinaryOp`/`UnaryOp` enum value, so the
   bridge case is one line.
3. **`makeIf` has no label slot.** The bridge throws on `IfExpr.label !== ''` rather than emit wrong
   wasm.
4. **Align unit conversion.** wabt-ts IR stores `align` in bytes (`0` = "natural"). binaryen-ts wants
   the exponent. `alignBytesToExponent(align, naturalBytes, label)` resolves natural-when-zero via
   `naturalAlignForOpcode(opcode)` then `Math.log2`-encodes. "0 → exponent 0" broke binaryen's
   optimizer.
5. **Anonymous-item names.** binaryen-ts cross-references items by string name. `synthesizeAnonymousNames`
   fills empty `funcNames`/`globalNames`/`tableNames`/`memoryNames`/`tagNames` slots with
   `$F0`/`$G0`/`$T0`/`$M0`/`$E0`. New item kinds need the same treatment.
6. **Memory imports use the canonical `memoryNames` slot, not `imp.memory.name`** (often empty) — so
   the memory can later be looked up for an export. Same pattern as funcs/globals/tables.

## Deferred / blocked (binaryen-ts v1.0.9 gaps — file upstream, not a wabt-ts workaround)

`ref.as_non_null` (no `makeRefAsNonNull`) · plain `v128.load` (no `ValType.V128` branch in
`loadOpcode` → silently emits `i64.load`) · tag imports (no `addTagImport`) · tag exports (no `"tag"`
in `WasmExport.kind`) · multi-value `return` (needs `makeTupleMake`) · element segments (no
`addElement`) · start function (no `setStart`) · custom sections.

Remaining wabt-ts-side gap: the **typed-ref IR refactor** for `(ref $T)` precision (currently
coarsens to StructRef — see [design-decisions.md](design-decisions.md)); `br_on_cast` IR wiring.
