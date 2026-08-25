# Cross-project architecture (binaryen-ts ↔ wabt-ts ↔ wasmtk)

These decisions were agreed between binaryen-ts and wabt-ts and must be respected in both projects.
The eventual merger target is **binaryang** (all three projects merge into one — design package
boundaries to keep that merge clean). The ecosystem roles are in [overview.md](overview.md).

## Agreed pipeline

```text
WAT / .wasm input
    ↓  wabt-ts parser         → wabt format IR (tree-shaped, post-order traversable)
    ↓  IR bridge              → binaryen optimization IR   ← the architectural join
    ↓  binaryen-ts passes     → optimized binaryen IR
    ↓  binaryen-ts encoder    → .wasm output
    ↓  wasmtime               → native execution
    ↓  canonical ABI          → component boundary (wasmtk's concern)
```

Plus the **direct path** for pure optimization (no prior wabt-ts step):
`.wasm → binaryen-ts parseWasm() → binaryen IR → passes → encoder`. Both are first-class; the bridge
path is the production route when wabt-ts tools (validate, strip) have already processed the module.
Re-serializing to binary between steps just to use the direct path is wasteful and wrong.

## The five agreed decisions

| Decision                 | Resolution                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Binary encoder ownership | binaryen-ts encoder = canonical output for **optimized** wasm; wabt-ts encoder = format tools + round-trip fidelity only                                                 |
| WAT parser front door    | wabt-ts WAT parser = front door for **all external input** (user `.wat`, wasmtk source); binaryen-ts WAT parser = internal IR construction, tests, pass development only |
| Bridge architecture      | Bridge = wabt-ts calling the binaryen-ts constructor API directly; not a separate translation layer                                                                      |
| wabt-ts IR shape         | Tree-shaped (not flat stack-machine list); post-order traversable; no parent context to resolve a child; no upward references                                            |
| binaryang merger         | All three projects eventually merge into binaryang                                                                                                                       |

## IR bridge design constraints

The bridge reduces to a single recursive post-order walk over the wabt format IR, calling binaryen
constructor functions at each node. For this to work:

- wabt-ts expression nodes must be resolvable bottom-up (children before parents)
- no node may require parent context to be constructed
- the binaryen-ts constructor API must be flat, stable, complete for all MVP opcodes

The original binaryen C API (`BinaryenConst()`, `BinaryenBinary()`, `BinaryenAddFunction()`, …)
shows the right shape; the TS constructor API inherits it intentionally: `makeI32Const`,
`makeBinary`, `makeBlock`, `ModuleBuilder.addFunction`, etc.

## Constructor API status — stable + complete for MVP

Phase 0 established it; Phases 2 (binary parser, first client to call a constructor for every MVP
opcode) and 3 (encoder, first to invert every opcode to bytes) stabilized it. All MVP factories are
present and exercised: `makeI32Const`/`makeI64Const`/`makeF32Const`/`makeF64Const`, `makeLocalGet`/
`makeLocalSet`/`makeLocalTee`, `makeGlobalGet`/`makeGlobalSet`, `makeBinary`, `makeUnary`,
`makeReturn`, `makeCall`, `makeCallIndirect`, `makeIf`, `makeBlock`, `makeLoop`, `makeBreak`,
`makeSwitch`, `makeSelect`, `makeDrop`, `makeNop`, `makeUnreachable`, `makeLoad`, `makeStore`,
`makeMemorySize`, `makeMemoryGrow`, `makeMemoryCopy`, `makeMemoryFill`, `makeRefNull`,
`makeRefFunc`, `makeRefIsNull` (+ GC/EH/SIMD/table factories from later phases). Added 2026-08-24
for the UP-series: `makeRefAsNonNull`, `makeArrayFill`, `makeArrayCopy`, `makeArrayInitData`,
`makeArrayInitElem`, `ModuleBuilder.addTagImport`, `ModuleBuilder.setStart`.

## Handshake status with wabt-ts (all complete)

1. Module-level constructor signatures (`addFunction`/`addGlobal`/`addMemory`/`addFunctionImport`/
   `addExport`) shared for boundary validation. ✅
2. Phase 2 instruction decoder reached MVP opcode completeness. ✅
3. wabt-ts dry-run mapping wabt IR nodes → binaryen constructor calls. ✅ (tier_a/tier_b/dry_run
   test files in the sibling wabt-ts repo).
4. Both sides reviewed for structural mismatch. ✅ — **wabt-ts shipped the production bridge** as
   commit `cf44fb59` ("Phase 7: wabt-ts → binaryen-ts IR bridge") in
   `src/bridge/binaryen-bridge.ts` + `src/bridge/type-map.ts`. wabt-ts imports
   `@jrmarcum/binaryen-ts@^1.0.9/ir` + `/encoder`. The constructor API proved sufficient for the MVP
   expression kinds wabt-ts targeted plus imports/ exports/defined entities/module wiring. **Bridge
   scope expansion is now driven by wabt-ts's needs**, not by binaryen-ts's API surface.

## Bridge gaps filed by wabt-ts (UP-1…UP-7, 2026-08-24)

The wabt-ts team filed seven findings for constructs its bridge could not express or could not
round-trip (`../wabt-ts/scripts/binaryen-ts-upstream-report.md`). Severity analysis and per-item
detail live in [correctness.md](correctness.md) § "The UP-1…UP-7 series"; the bridge-facing summary:

| ID   | Bridge impact                                             | Status                |
| ---- | --------------------------------------------------------- | --------------------- |
| UP-1 | packed struct/array field reads                           | ✅ fixed              |
| UP-5 | modules with a start function                             | ✅ fixed (`setStart`) |
| UP-6 | tag imports (`addTagImport`)                              | ✅ fixed              |
| UP-4 | `ref.as_non_null` (`makeRefAsNonNull`)                    | ✅ fixed              |
| UP-3 | `array.fill`/`copy`/`init_data`/`init_elem` (4 factories) | ✅ fixed              |
| UP-7 | typed refs (`(ref $T)`) through the declaration surface   | ✅ fixed              |
| UP-2 | `tuple.make` / multi-value `return`, `br`, `br_if`        | ✅ fixed              |

**Do not re-add these to the gap list** — wabt-ts's own notes had them stale and they are confirmed
present: `ModuleBuilder.addElement`, the `v128.load` encoder path (and `loadOpcode` throwing rather
than falling through to i64), and `"tag"` in `WasmExport.kind`.

### UP-7 landed — `coarsenValueType` is no longer needed at the boundary

wabt-ts described it as "widening five `ModuleBuilder` signatures to a union you already define,"
and noted that `coarsenValueType` was the last lossy step in their pipeline. Two corrections found
during the fix, both worth passing back:

1. It was not five signatures. The IR record types were `ValType` too (`WasmFunction.params` /
   `.results`, `Local.type`, `WasmGlobal.type`, `WasmTable.type`, `WasmTag.params`), so widening the
   builder alone would have pushed a `RefType` into a `ValType`-typed field.
2. It was not merely an expressiveness gap — the binary parser collapsed a local's `(ref null $T)`
   to `anyref`, so binaryen-ts corrupted any GC module with typed-ref locals on a bare parse→encode
   round-trip. That affected the direct path too, not only the bridge.

Both are fixed: a new `ValueType = ValType | RefType` runs through every declaration position, and
resolving it deleted `gcFuncTypeIndex`'s "ambiguous GC function type" throw, which only existed
because the collapse made two func heap types indistinguishable. **wabt-ts can drop
`coarsenValueType` and pass concrete typed references straight through.**

### UP-2 landed too, and multi-value goes further than the original ask

`tuple.make` exists, and with it multi-value `br` / `br_if` / `br_table`. The blocktype path came
with it: multi-result blocks, and block / `if` / `loop` / `try` / `try_table` **inputs** (spilled to
locals, with a back-edge branch rewrite for loops and a dispatch trampoline for a `br_table` whose
targets mix a parametrised loop with other frames). Multi-result functions and calls already worked.

So the bridge can now express the full multi-value surface. Detail and the remaining caveats are in
[correctness.md](correctness.md) § "UP-2".

### Multi-value blocks are only usable from a RELEASE (2026-08-25)

The team re-filed against published v1.4.3, where `readBinary` still refuses a type-index blocktype:
everything above sits on `main`, above the tag. Chasing their report also found the encode half
broken — a multi-result blocktype resolved against the wrong type table — so the writer only started
working on 2026-08-25. Nothing in this section is reachable from JSR until 1.5.0 ships.

### `try_table` catch destinations changed meaning (BREAKING for bridge code)

**If wabt-ts constructs `TryTableExpr` nodes directly, `catches[].dest` must now name the ENCLOSING
label.** A `try_table`'s own label is not in scope for its handlers — depth 0 is the immediately
enclosing frame — and until 2026-08-25 both our decoder and our encoder were shifted one frame
deeper. They were shifted _symmetrically_, so a parse→encode round-trip was byte-identical and the
bug was invisible from the binary side; but a correct `dest` handed in from the bridge would have
encoded one frame wrong. Bridge code written against the old behaviour needs the shift removed.

This is the shape that matters for the EH migration: `$__exn_tag (param i32 i32)` hands its two
values to the handler as the results of the enclosing block, so the catch destination is an ordinary
multi-value block label — and it is the _only_ spelling of that shape.

### Courtesy note wabt-ts raised, now documented

With GC enabled, a function's own signature must be declared as a `{ kind: "func" }` heap type or
`encodeWasm` throws `unresolved GC function type: () -> (i32)`. `addFunction` alone is enough
without GC and not enough with it. This is correct fail-loud behaviour, but it surprised them
mid-repro (and bit a fixture in our own new test file), so `ModuleBuilder.addHeapType` and
`enableGC` now document it with a worked example.

## Working with the sibling repos

`../wabt-ts/` is the user's actual wabt-ts development repo (the cross-project IR-bridge work
happens there). Consult it when changes here affect the bridge boundary; **never write to it from
inside this repo.** Its portable memory is at `../wabt-ts/cmem/` (notably `bridge.md`, which
documents this same boundary from the wabt-ts side). wasmtk's portable memory is at
`../wasmtk/cmem/`. The `npm:binaryen` compat facade (`/compat`, see
[architecture.md](architecture.md)) is what unblocked wasmtk's migration off `npm:binaryen` — wasmtk
call sites change only the `import` statement.
