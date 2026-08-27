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

Read these instead of trusting any snippet if they diverge: `binaryen-ts/src/ir/module.ts`
(`ModuleBuilder`), `binaryen-ts/src/ir/expressions.ts` (every `make*`),
`binaryen-ts/src/ir/types.ts` (`ValType`).

- `ModuleBuilder`: `addFunction`, `addGlobal`, `addMemory`, `addDataSegment`,
  `addPassiveDataSegment`, `addTable`, `addFunctionImport`, `addGlobalImport`, `addTableImport`,
  `addMemoryImport`, `addExport`, `addTag` (v1.0.9, EH), `addHeapType` (v1.0.9, GC), `build`.
- Instruction constructors by category: const/local/global · arithmetic/compare
  (`makeBinary`/`makeUnary` — there is **no** `makeCompare`/`makeConvert`) · control flow · call ·
  memory · reference/GC.

**Critical:** `makeI64Const` takes **`bigint`**, not `number` — call `BigInt(n)`.

**Bridge type mapping (lives on the wabt-ts side):** `wabtTypeToValType(t)` maps 0x7f→I32, 0x7e→I64,
0x7d→F32, 0x7c→F64, 0x7b→V128, 0x70→FuncRef, 0x6f→ExternRef; throws on unknown.

**`Limits` is `bigint` on our side and `number` on theirs (T13.3).** The wabt IR keeps memory and
table limits as `bigint` because a 64-bit memory or table may name a size past 2^53; binaryen-ts's
builder API takes `number`. `limitToNumber(v, what)` converts at the bridge boundary and **THROWS
above 2^53 rather than rounding** — a bridge that quietly halves a table is the same class of bug
the bigint change was made to remove. Any new `addX` call taking a limit must go through it.

**Import constructors are self-contained** (no type-section side-channel). `addMemoryImport.initial`
is required; `addTableImport.initial` optional (default 0); `addTableImport.type` defaults to
FuncRef.

**f32/f64 const reinterpret:** wabt-ts stores raw IEEE-754 bits (`number`/`bigint`); binaryen-ts's
`makeF32Const`/`makeF64Const` take the float value. `bridgeConst` does the bits→float reinterpret
via a shared buffer.

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
- **GC Tier 1** — i31 + ref.eq (v1.1.9). ref.eq (0xd3), ref.i31 (0xfb 0x1c), i31.get_s/_u; 8
  abstract heap types. `gc_tier1.test.ts`.
- **GC Tier 2** — struct.\* (v1.2.3). WAT parser for `(type $name (struct (field …)))`; 6 instrs
  (new/new_default/get/get_s/get_u/set); `addHeapType` up front, wabt→binaryen heap-type-index map
  in `BridgeCtx.heapTypeIdx`; `varIdx` throws on unresolved name-var. `gc_tier2.test.ts`.
- **GC Tier 3** — array.\* (v1.2.4). 10 instrs (new/new_default/new_fixed/new_data/new_elem/get/
  get_s/get_u/set/len). `gc_tier3.test.ts`.
- **GC Tier 4** — ref.test / ref.cast (v1.2.5). `(ref [null] H)` heap-type immediate; new
  `parseRefImmediate`, `resolveHeapTypeVar`, `readHeapTypeVar`, `writeHeapType`,
  `heapTypeForBridge`. `gc_tier4.test.ts`. **`br_on_cast`/`br_on_cast_fail` deferred** —
  enum/name-map entries exist (0x18/0x19) but no IR/parser/writer/bridge wiring.

## Cumulative gotchas

1. **`makeBlock`/`makeIf` infer type from the last child.** For early-exit blocks (last child is
   `br`/`return`/`unreachable`, type `unreachable`) that loses the block's declared signature. Use
   `withDeclaredType(expr, declared)` to override `.type` after construction.
2. **binaryen-ts collapses compare→binary and convert→unary.** No `makeCompare`/`makeConvert`. The
   opcode-name string from `anyOpcodeName(op)` equals the `BinaryOp`/`UnaryOp` enum value, so the
   bridge case is one line.
3. **`makeIf` has no label slot.** The bridge throws on `IfExpr.label !== ''` rather than emit wrong
   wasm.
4. **Align unit conversion.** wabt-ts IR stores `align` in bytes (`0` = "natural"). binaryen-ts
   wants the exponent. `alignBytesToExponent(align, naturalBytes, label)` resolves natural-when-zero
   via `naturalAlignForOpcode(opcode)` then `Math.log2`-encodes. "0 → exponent 0" broke binaryen's
   optimizer.
5. **Anonymous-item names.** binaryen-ts cross-references items by string name.
   `synthesizeAnonymousNames` fills empty
   `funcNames`/`globalNames`/`tableNames`/`memoryNames`/`tagNames` slots with
   `$F0`/`$G0`/`$T0`/`$M0`/`$E0`. New item kinds need the same treatment.
6. **Memory imports use the canonical `memoryNames` slot, not `imp.memory.name`** (often empty) — so
   the memory can later be looked up for an export. Same pattern as funcs/globals/tables.

## RESOLVED 2026-08-25 — the catch-scope coupling is gone (T13.22 / T13.47)

**The pin is `1.5.0` and the bridge fix has landed, together, in `5404946d`.** Bridge suite 28 / 28.
The two off-by-ones no longer exist on either side, so there is nothing left to cancel and nothing
to coordinate. `deno.json` also sets `minimumDependencyAge: "0"` — deliberate; every dependency here
is our own scope plus `@std`.

**Keep the pin EXACT anyway.** Not for the cancellation — for the reason T13.47 found: their encoder
changes what it REQUIRES of callers between versions (exact GC signature matching, declared `func`
heap types), and an import-surface check cannot see that. A caret range would let a
`deno cache --reload` move us onto a version whose preconditions we have never run against.

**And keep `tests/bridge/try_table_catch_scope.test.ts`.** It is the only thing that would catch the
ordering regressing, and its probe must stay NUMERIC — a named catch target cannot see this bug in
either direction.

The history below is kept because the failure mode is reusable: two errors that cancel are invisible
to every test that looks only at the final bytes, and stay invisible until one side fixes its half.

### Historical — the compensation, while it existed

**Do not bump the `@jrmarcum/binaryen-ts` pin without reading this.** The bridge and binaryen-ts
1.0.9 currently hold two off-by-ones that cancel, and upgrading breaks the cancellation.

**The pin is now EXACT (`jsr:@jrmarcum/binaryen-ts@1.0.9`), and that is load-bearing.** It was
`^1.0.9` with `deno.lock` holding 1.0.9 — so the coupling was protected by the LOCKFILE ALONE. JSR's
latest is already 1.4.3, which the caret accepted. That is harmless today because every RELEASED
version still has the old catch scope, but the moment binaryen-ts 1.5.0 publishes, a plain
`deno cache --reload` — no version change of ours, no commit, no review — would silently break our
EH output. Raised by the binaryen-ts team 2026-08-25; they have recorded it as a release blocker on
their side and **1.5.0 does not ship alone**. Keep the pin exact until the coordinated change lands.

`bridgeExpr`'s `try_table` case pushes the try_table's own label and THEN resolves the catch
clauses. Catch targets resolve in the ENCLOSING scope (the try_table's own frame is not counted), so
the bridge hands binaryen-ts a label ONE LEVEL TOO SHALLOW — `dest=$inner` where `$outer` was meant.
binaryen-ts 1.0.9 counts the try_table frame when turning `dest` into a depth, one level too deep,
and the two errors cancel to the correct wire depth.

    our own encoder (V8-verified reference)      catch depth 1   correct
    bridge as shipped (dest=$inner + old shift)  catch depth 1   correct by cancellation
    bridge with the scope fixed ALONE            catch depth 2   WRONG

### v1.5.0 upgrade: surface compatibility holds, and it is NOT the blocker (2026-08-25)

binaryen-ts checked their side and reported that every name our bridge imports from `/ir` still
resolves at v1.5.0. **Independently verified here: 0 missing** — we import 72 names across
`binaryen-bridge.ts` and `type-map.ts` (they counted 66; different de-duplication, same substance),
against 205 exported by their v1.5.0 `/ir`. The four exports their Sweep 2 removed are what makes
1.5.0 a MINOR, and none is reachable from an `exports` subpath.

**And it does not de-risk the upgrade, because the blocker is behavioural, not nominal.** With every
import resolving, **12 of 28 bridge tests still fail** on v1.5.0 (28/28 pass on 1.0.9), all with one
error:

    WasmEncodeError: unresolved GC function type: (structref) -> (i32)

Their `gcFuncTypeIndex` now demands an exactly-matching declared `func` heap type for any GC-typed
signature — the UP-7 typed-ref work landing. **Our `coarsenValueType` maps `(ref $T)` to `structref`
at the boundary, so no key can ever match.** They flagged this area as our `coarsenValueType` "may
be doing unnecessary work"; it is stronger than that — it is now a hard encode failure, and removing
the bridge's last lossy step is the real cost of this upgrade.

**Lesson worth keeping: an import-surface diff is not an upgrade test.** Every name resolving is
necessary and says nothing about what the callee now REQUIRES of its arguments. Only running the
suite found it.

**Also true, with one caveat for us:** `/encoder` appears in `src/` exactly once, in a doc comment
(`binaryen-bridge.ts:12`), never imported — so it is free to change as far as the BRIDGE goes. But
**11 test files import it**, so dropping the mapping breaks the bridge suite.

**Publisher-side note they may want:** Deno refuses a JSR version younger than 24h by default
(`minimumDependencyAge`). 1.5.0 published 22:17:43Z; consumers and their CI cannot adopt it until
~24h later without weakening that policy project-wide.

### The coordinated sequence — and why our fix cannot land first

Confirmed from BOTH sides 2026-08-25. binaryen-ts read our `bridgeExpr` and quoted it exactly; we
read their `wasm-encoder.ts` at the **released v1.4.3 tag** and their `labels.push(e.name ?? "")`
still precedes `resolveLabel`, with `resolveLabel` counting innermost-first. Both bugs are intact,
so the cancellation holds and neither side has moved.

**Their proposed sequence needs one correction.** As written it reads: wabt-ts lands the
`bridgeExpr` ordering fix "gated on the upgrade", binaryen-ts publishes 1.5.0, wabt-ts bumps the
pin. **The fix cannot land on `main` before the pin moves** — with the fix in and the pin still at
1.0.9 there is nothing to cancel, and every `try_table` the bridge emits is one level too deep.
There is no practical gate for it either; it is an ordering change in one function, not a feature
flag.

So the atomic unit is **(ordering fix + pin bump) in ONE commit**, which can only be authored once
1.5.0 exists:

1. binaryen-ts publishes **1.5.0** with their scope fix;
2. wabt-ts lands ordering fix **and** the exact pin bump in a single commit, and re-checks the
   emitted bytes against our own encoder before merging;
3. wabt-ts publishes.

The fix can be PREPARED on a branch beforehand so step 2 is a merge rather than authoring under time
pressure — that satisfies the intent of their step 1 without putting broken bytes on `main`.

**Risk status, agreed:** the pin is now EXACT, so 1.5.0 can no longer float us via a
`deno cache --reload`. It can only stop us upgrading until the paired change lands. Coupling
unchanged, blast radius reduced.

> **Do not "correct" binaryen-ts version numbers to ours.** Their `passes.md` and README cite
> **v1.4.1** (asyncify import mode) and **v1.4.2** (liveness-minimized saving) — those are
> binaryen-ts releases and are right. wabt-ts 1.4.1 is a coincidence of numbering, not the same
> thing. Flagged by them 2026-08-25 precisely because it looks like a stale cross-reference.

So the fix is coupled to the upgrade. **When the pin moves off `1.0.9`:** resolve `tt.catches`
BEFORE `ctx.labelStack.push(name)`, in the same commit, and re-check the byte
`1f 7f 01 00 00 <depth>` against our own encoder's output for the same module. binaryen-ts's stated
contract after their fix is that **`catches[].dest` must name the enclosing label**, which is what
the reordering produces.

Also expected from their side, unverified here: `RemoveUnusedNames` now counts a catch destination
as a label reference.

**This is the T7.6 / T9.8 off-by-one for the THIRD time** — parser, then validator, then here. The
bridge gets skipped in these sweeps because it is dev-only and no published entrypoint reaches it.
That is a reason to deprioritise fixing it, never a reason to leave it out of the enumeration.
Detail, evidence and the probe that nearly got it wrong: `cmem/tasks.md` T13.22.

## Label frames — the bridge keeps its OWN stack, and it has diverged twice

`bridgeExpr` maintains `ctx.labelStack` and resolves `br` depths against it, duplicating what
`resolveNames` already does. Both divergences found so far were off-by-ones in that bookkeeping:

- **T13.22** — `try_table` resolves its catch clauses AFTER pushing its own label; they belong in
  the enclosing scope. Currently cancelled by binaryen-ts 1.0.9; see the ⚠ block above.
- **T13.24** — `if` pushed no frame at all, so every `br` inside one was one frame too shallow.
  Fixed: a sentinel `IF_FRAME` is pushed after the condition is bridged, and `resolveLabel` THROWS
  if a target lands on it (binaryen-ts cannot express a branch to an unlabeled `if`, and resolving
  to the enclosing block is a silent wrong answer).

**Every construct that is a branch target in wasm needs a frame here**, labeled or not — `block`,
`loop`, `if`, `try_table`, and legacy `try` if it is ever bridged (it currently throws). When adding
one, push the frame and decide explicitly what a branch TO it should do; the default of "not
pushing" is never right. Gate: `tests/bridge/label_frames.test.ts`.

## Deferred / blocked (binaryen-ts gaps — file upstream, not a wabt-ts workaround)

**Re-verified 2026-08-24 against the actual checkout (`b78e5b476`, v1.3.5).** The list below used to
be written against the v1.0.9 pin and had gone stale in three places. Full detail and repros:
`cmem/tasks.md` (LIVING LOG, UP-1..UP-7) and the report built from it,
[../scripts/binaryen-ts-upstream-report.md](../scripts/binaryen-ts-upstream-report.md).

**Two of these are NOT bridge-only — they are round-trip defects in `readBinary(b).emitBinary()`,
reachable with no bridge, no builder and no passes** (confirmed by binaryen-ts 2026-08-24,
reproduced here):

- **UP-5, start function — SILENT.** The decoder reads the start funcidx and discards it. Valid in,
  valid out, behaviour changed, no diagnostic. Measured: exported global 42 → 0. The worst of the
  seven and we had ranked it sixth.
- **UP-1, `struct.get_u` — loud.** The decoder collapses `0x04`/`0x0d` onto `signed=false`, so valid
  wasm re-encodes to bytes engines reject.

Still blocked:

- **`struct.get_u` / `array.get_u`** — the encoder picks the sub-opcode with a boolean, so the
  unsigned form is unreachable and `signed=false` on a PACKED field emits the non-packed opcode.
  **V8 and Wasmtime both reject those bytes** (UP-1, the only finding that emits bad bytes).
- `ref.as_non_null` — no factory, no encoder case, no `ExpressionKind` entry (UP-4).
- Multi-value `return` / `br` / `br_if` — `tuple.make` has an enum entry but no factory and no
  encoder case (UP-2).
- GC array bulk ops — `array.fill` / `copy` / `init_data` / `init_elem`, same shape as UP-2 (UP-3).
- Tag IMPORTS — `WasmImport.kind` has no `"tag"` (UP-6). Tag _exports_ work now.
- Start function — no `setStart`, no start section in the IR, and the decoder DISCARDS it (UP-5).
- Typed refs at the **`ModuleBuilder` surface** — `RefType` exists and `FuncTypeDef` accepts it, but
  `addFunction` / `addGlobal` / `addTable` / `addTag` / `addFunctionImport` are still `ValType`-only
  (UP-7). This is the last lossy step in the bridge.
- Custom sections.

**No longer blocked — do not re-add these:** plain `v128.load` (has its own `0xfd 0x00` path;
`loadOpcode` now THROWS instead of silently emitting `i64.load`) · tag exports (`"tag"` is in
`WasmExport.kind`) · element segments (`addElement` is present).

**No remaining wabt-ts-side gaps here.** The typed-ref IR refactor landed as T7.4 (wabt-ts carries
`(ref $T)` precisely end to end — the bridge's `coarsenValueType` is now the ONLY lossy step, which
is what UP-7 is about), and `br_on_cast` / `br_on_cast_fail` landed as T5.3.
