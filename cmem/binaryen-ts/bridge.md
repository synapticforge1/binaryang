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

## BINDING for binaryang — upstream names are reserved

**A bare upstream project name (`binaryen`, `wabt`) may appear in a path ONLY where upstream
compatibility is the subject — `compat/` and `interop/`. It must never name a directory or module
holding binaryang's own implementation.**

Agreed 2026-08-25, and binding on the binaryang team from the first commit.

**Why it is a must and not a preference.** Both codebases already hold this invariant without ever
having written it down. Every path in either repo containing a bare upstream name refers to
UPSTREAM: `src/api/binaryen-compat.ts` (the `npm:binaryen` API shape), `src/interop/binaryen-js.ts`
(the bridge to upstream binaryen.js), `src/api/wabt-compat.ts` (the wabt.js API shape), `upstream/`
(the literal C++ clone). Own code has always lived under functional names — `ir`, `encoder`,
`passes`, `parser`, `validator`, `writer`.

Breaking it would put the same word on our code and on theirs inside one repository: `src/binaryen/`
a few directories from `compat/binaryen`, meaning opposite things. Beyond the ambiguity, it invites
the reader to assume binaryang vendors the upstream projects rather than implementing them — a claim
about provenance that must not be made by accident.

**Where own code goes.** Functional names, as both projects already do. During convergence, code may
sit under the PORTING project that produced it — `src/binaryen-ts/`, `src/wabt-ts/` — because the
`-ts` suffix is exactly what distinguishes our port from the project it ports. That is the qualified
form and it is permitted; the bare form is not.

**The check** — mechanical, so the rule survives whoever is reading it:

```sh
git ls-files \
  | grep -iE '(^|/)(binaryen|wabt)([-_./]|$)' \
  | grep -viE '(binaryen|wabt)-ts' \
  | grep -viE 'compat|interop'
```

Empty output means the rule holds. Wire it into CI alongside `fmt`/`lint`, where it costs nothing
and cannot rot.

**One known violation to fix at merge time**, found by running it: `wabt-ts`'s
`src/bridge/binaryen-bridge.ts`. binaryen-ts is clean. That file is the bridge INTO the binaryen-ts
IR, so it is the qualified sense — but it is spelled in the bare form, in the single most
load-bearing file the two projects share. Rename it on the way in (`bridge.ts` is sufficient; it
already lives in `bridge/`).

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

### Multi-value blocks: SHIPPED in v1.5.0 (2026-08-25)

The team re-filed against published v1.4.3, where `readBinary` still refused a type-index blocktype
— the decode work sat on `main`, above the tag. Chasing that report also found the encode half
broken (a multi-result blocktype resolved against the wrong type table), so the writer only started
working the same day. **All of it is on JSR as of v1.5.0**, and their whole shape table was
re-verified against it: single-value block, multi-value function result, `try_table` with a
single-value handler, the multi-value block from the report, and the wasic 2-param-tag → 2-value
handler shape — each across input, bare round-trip, full `-Oz`, and the `/compat` facade.

They cannot consume it until they move off the exact `1.0.9` pin, which is the coupled upgrade
below.

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

### The `dest` coupling — ours is SHIPPED; the atomic step is now THEIRS (2026-08-25)

The wabt-ts team replied with byte-level evidence, and the answer is the worse of the two branches I
offered them: **their bridge compensates for our bug, and the two errors cancel.**

Their `buildCatchClause` resolves the catch target against a stack that already has the try_table's
own label pushed, so it hands us a label one level too SHALLOW. Our released encoder then counts the
try_table frame, one level too DEEP. Net: the emitted depth is correct.

```
1f 7f 01 00 00 01     try_table i32 | 1 catch | kind=catch | tag 0 | depth 1   <- correct
```

**Either fix alone produces wrong output.** Removing their ordering bug against a released
binaryen-ts takes the depth 1 → 2. Releasing our fix against their current bridge takes it 1 → 0.
The two changes must land in the same coordinated step, and this is now a **release-gating
constraint on 1.5.0**, not a courtesy note.

Their framing is worth keeping: it is not a deliberate ±1 that either side can delete. It is a SCOPE
bug — catch targets resolve in the ENCLOSING scope, before the try_table's own label is pushed — and
it has now hit them in three separate layers (parser, validator, bridge), none of which grepped for
the others. Same one-authoritative-rule failure as our own four region sites.

**v1.5.0 shipped on 2026-08-25 and this is now a wabt-ts UPGRADE item, not a binaryen-ts release
item.** The framing that held the release ("1.5.0 cannot ship alone") was wrong in direction: they
pin binaryen-ts at an EXACT `1.0.9`, so publishing cannot touch their builds, and their own note
says the fix lands "in the same change as the binaryen-ts upgrade" — they were waiting for a version
to upgrade TO. See [phases.md](phases.md) § "The 'cannot ship alone' framing was WRONG".

**What they need to do, in ONE commit** (either half alone emits the wrong catch depth):

1. move `buildCatchClause` OUT of the `ctx.labelStack.push(name)` in `bridgeExpr`'s `try_table` case
   — catch targets resolve in the ENCLOSING scope;
2. bump the pin `1.0.9` → `1.5.0`.

Worth telling them the jump spans far more than the catch scope: `1.0.9 → 1.5.0` also brings
multi-value blocks, the removed dead exports (which is why it is a minor), and the region-container
fixes.

**Status at wabt-ts 1.4.1 — verified 2026-08-25, compensation STILL PRESENT.** Their version bump
did not touch it: `bridgeExpr`'s `try_table` case still does `ctx.labelStack.push(name)` and then
builds the catch clauses inside that push, so `buildCatchClause` → `resolveLabel` resolves one frame
too shallow. Their own `cmem/bridge.md` opens with it as "⚠ RELEASE BLOCKER — the catch-scope
compensation (T13.22)" and calls the bridge bug-compatible with 1.0.9. They said they would hold it
deliberately, and they have.

**The ACCIDENT risk is gone, though.** `../wabt-ts/deno.json` previously asked for
`jsr:@jrmarcum/binaryen-ts@^1.0.9` — a range admitting every published version — and now pins the
EXACT `1.0.9` (verified by reading their repo, along with `deno.lock`). A `deno cache --reload` can
no longer float them onto a new binaryen-ts. Publishing 1.5.0 therefore cannot silently break them;
it can only keep them from upgrading until the paired fix lands. Coupling unchanged, blast radius
reduced.

A method note from their side worth adopting: their first probe compared RUNTIME RESULTS of the two
orderings and got 111 from both, which read as a refutation. It was not — depth 1 and depth 2 both
return 111 in that shape, and only depth 0 differs, so the probe could not discriminate. The byte
comparison against a known-correct reference is what settled it. That is our own rule ("a fixture
where both readings type-check proves nothing") rediscovered independently on the other side of the
bridge, and it nearly cost them the wrong answer.

### Second handoff drafted (v1.5.0) — upgrade-compatibility facts worth keeping

A follow-up note was drafted for the team once v1.5.0 shipped. **Both handoff notes now live in the
repo at [handoffs.md](handoffs.md)** rather than in a session scratchpad. Two things in the second
one were MEASURED and are repeated here because they answer questions that recur:

- **All 66 names their bridge imports from `/ir` still resolve at v1.5.0** — checked by extracting
  the import list from `../wabt-ts/src/bridge/binaryen-bridge.ts` and diffing it against the live
  `src/ir/index.ts` surface. The four exports Sweep 2 removed (`parseWast`, `isAtom`, `assertList`,
  `materializeFakeGlobals`) are the reason 1.5.0 is a MINOR, but none is reachable from an `exports`
  subpath, so they cannot be what breaks a consumer.
- **`/encoder` is mapped in their `deno.json` but only referenced in a doc comment**, never imported
  in `src/`. The mapping is free to update or drop as far as the bridge is concerned.

The note also flags what most likely reaches them behaviourally across `1.0.9 → 1.5.0` (four months,
not just the catch scope): multi-value blocks now encode as well as decode; typed refs are carried
end-to-end, so their `coarsenValueType` at the boundary may be doing unnecessary work; and region
bodies that used to round-trip to invalid wasm no longer do. It recommends they upgrade behind their
own differential harness rather than trusting the list.

### SENT and answered — what came back, and what I got wrong

The handoff note went out and the wabt-ts team replied point by point (2026-08-25). Outcomes:

- **The `dest` change: confirmed, and it is the bad branch** — their bridge compensates. Promoted to
  the RELEASE BLOCKER entry above.
- **They have no record of the multi-value report.** It is not in their 7-finding upstream report
  (that is UP-1…UP-7) but a later, separate ask, which opened by explicitly excluding try_table:
  "one thing, and it isn't try_table". Identifying marks if it needs re-finding: the repro
  `(module (func (result i32) (block $b (result i32 i32) (i32.const 1) (i32.const 2)) (drop)))`, the
  error `multi-value block type (type index 0) is not supported (at offset 0x3)`, and a four-row
  shape table. It reached us and was never filed on either side.
- **RETRACTED — my `$__exn_tag` / catch-destination claim was the wrong instance.** I told them
  `RemoveUnusedNames` mattered to them because the `$__exn_tag` shape has nothing branching to its
  catch destination. Their snapshot has **zero `try_table` modules** — wasic emits LEGACY
  `try`/`catch`, which has no catch-destination label at all, so that reasoning does not touch their
  modules. They also warned that an earlier finding of theirs from that same frozen snapshot had
  already been retracted; do not re-derive from it.

  The operative instance for legacy EH is **`delegate`**, and it is verified rather than argued:
  revert only the `Try.delegateTarget` line in the pass's collection and a block label named solely
  by a `try…delegate` target is stripped, after which the pipeline dies with
  `unresolved branch label: "$l0_1"`. V8 accepts the fixture, so it is live code. `Rethrow.target`
  names a `try` label, which the pass never strips — not affected.

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
