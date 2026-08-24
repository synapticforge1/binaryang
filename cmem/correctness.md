# Correctness invariants & the bug log

The load-bearing record. Every fix here has a regression test; reintroducing the old shape defeats
the design. The exhaustive line-by-line version is in the legacy `CLAUDE.md`.

## The unifying robustness contract (durable; also in README §"Robustness & error handling")

**Every name / type / index / opcode / branch-label / type-id resolution in the parser → pass →
encoder pipeline either succeeds or THROWS** (`WasmEncodeError` / `WasmBinaryError` /
`WatParseError` / `TypeError`). **No silent fallback may emit valid-but-wrong wasm.** When proper
support for a non-MVP construct is out of scope, it fails loudly rather than corrupting. This is the
project's deepest lesson: every WT-2 miscompile below was _valid wasm, wrong value_ —
`WebAssembly.compile` validity never caught them. "Valid ≠ semantically equivalent."

## Why behavioral testing exists

The WT-2 series proved that structural round-trip checks (function/global/segment counts) and even
`WebAssembly.compile()` validity miss behavioral miscompiles. Two harnesses close that gap:

- **Differential behavioral-equivalence** (`scripts/equiv_check.ts`): two stubbed instances driven
  by the same call sequence stay bit-identical iff optimization preserved semantics (stubs need only
  be IDENTICAL, not meaningful). Surfaced six real miscompiles the bench had called "valid."
- **Seeded differential optimizer fuzzer** (`tests/passes/optimize_fuzz_test.ts`) — see
  [testing.md](testing.md). Has teeth: verified by reverting each fix.

---

## The UP-1…UP-7 series (2026-08-24) — wabt-ts upstream findings

Seven findings filed by the wabt-ts team from its conformance campaign (their report:
`../wabt-ts/scripts/binaryen-ts-upstream-report.md`). All seven were **re-verified against this
checkout at v1.4.3** before acting — their report was stamped v1.3.5, and nothing between the two
versions touches these paths. Their framing was "six of seven fail loudly or are simply absent —
only UP-1 emits bytes an engine rejects." Verification found that understated: **three of the seven
produce wrong bytes**, and the silent one is worse than the loud one.

Their methodology is worth adopting: measure engine-acceptance of encoder output across a corpus
(they used the 257-file spec testsuite), and put every cross-engine question to more than one
engine. V8 alone accepts things Wasmtime rejects.

| ID   | What                                             | Real severity                                        | Status                  |
| ---- | ------------------------------------------------ | ---------------------------------------------------- | ----------------------- |
| UP-5 | start section parsed and discarded               | **silent miscompile** — the worst of the seven       | ✅ fixed (Tier 1)       |
| UP-1 | `struct.get_u`/`array.get_u` unencodable         | **bare round-trip corruption**, not just unencodable | ✅ fixed (Tier 1)       |
| UP-7 | typed refs stop at the `ModuleBuilder` surface   | **bare round-trip corruption** for typed-ref locals  | ⬜ OPEN (Tier 3)        |
| UP-6 | no tag imports                                   | loud (parser `default` error)                        | ✅ fixed (Tier 2)       |
| UP-4 | `ref.as_non_null` absent entirely                | absent                                               | ✅ fixed (Tier 2)       |
| UP-3 | 4 GC array bulk ops: no factory, no encoder case | loud (both directions)                               | ✅ fixed (Tier 2)       |
| UP-2 | `tuple.make`: enum entry only                    | loud                                                 | ⬜ deferred — see below |

### UP-5 — the start section (fixed) — the most severe of the seven

The parser read the start funcidx and threw it away (`break; // start func index -- skip`); the
encoder had no emit path at all. A module whose start function initialized state round-tripped into
one that instantiated cleanly and **never ran it**: valid wasm, wrong behaviour, no diagnostic.
Measured: an exported global went `42` → `0`. This is the WT-2c element-segment class, and it
outranks UP-1 — UP-1 at least gets caught by the engine.

Fix: `WasmModule.start`, `ModuleBuilder.setStart`, parser materializes it under the existing
`$func${globalIndex}` naming, encoder emits section 8 between export (7) and element (9).

**Wiring the section up is NOT sufficient on its own.** The start function is a reachability root
exactly like an export, so `RemoveUnusedModuleElements` and `Inlining` must seed from it. Without
that, `-Oz` deletes a start function that nothing else references — trading a decoder drop for an
optimizer drop. Verified by reverting the seed: only that test goes red. **Any future pass that
prunes module elements must consider `module.start`.**

The encoder guards with `!= null` (loose) on purpose: a module built against the pre-start
`WasmModule` shape has no field at all, and absent unambiguously means "no start function". A strict
`!== null` treats `undefined` as a real name and emits a section referencing `"undefined"`.

### UP-1 — packed-field `get` sub-opcode (fixed)

The GC spec has THREE sub-opcodes per family (`get` / `get_s` / `get_u`); the encoder chose between
two with `signed ? get_s : get`. So `get_u` was unreachable AND a packed field with `signed = false`
emitted the non-packed `get`, which every engine rejects ("Field 0 of type 0 has type i8. Use
struct.get_s or struct.get_u instead.").

**Worse than reported:** the binary parser decodes `get_u` to `signed = false`, collapsing it with
`get`. So a VALID module using `struct.get_u` came back INVALID from a bare `parseWasm` →
`encodeWasm` — no passes, no builder involved. Same class as the WT-2g catch-handler corruption.

Fix ([wasm-encoder.ts](../src/encoder/wasm-encoder.ts) `packedGetSubop`): derive packedness from the
field's declared `StorageType`. That makes `signed: boolean` sufficient and total — a packed field
admits only `get_s`/`get_u` (selected by `signed`), a non-packed field only `get` (where `signed` is
meaningless). No IR or API change. Out-of-range type/field indices throw rather than guessing.

The wabt-ts report claimed "the root cause is in the IR, not the encoder; an encoder-only patch
cannot fix it" — that is wrong, and their own suggested option (2) is the counterexample.
**Rebutted, and fixed encoder-only.**

The WAT parser now rejects a `get`/`get_s`/`get_u` that disagrees with the field's packedness.
Without that guard the encoder would silently REPAIR invalid source into a different instruction;
the front door must accept-or-throw, never quietly substitute.

### UP-7 — typed refs (OPEN; a third wrong-bytes bug)

Reported as the mildest finding — "the representational work is done, just widen five
`ModuleBuilder` signatures." Both halves of that are wrong:

1. **It is not five signatures.** The IR record types are `ValType` too: `WasmFunction.params` /
   `.results`, `Local.type`, `WasmGlobal.type`, `WasmTable.type`, `WasmTag.params`. Widening only
   the builder pushes a `RefType` into a `ValType`-typed field. Behind those sits the binary
   parser's AnyRef-collapse shim and `gcFuncTypeIndex`, whose own comment already names this as the
   blocker and currently **throws** on ambiguity.
2. **It emits bytes engines reject.** `readValTypeByte` collapses a local's `(ref null 0)` to
   `anyref` on read, so re-encoding a GC module that uses typed-ref locals produces a module V8
   rejects ("array.fill[0] expected type (ref null 0), found local.get of type anyref"). Measured:
   the hand-built `array.fill` fixture returns 7; its bare `parseWasm` → `encodeWasm` is rejected.

Found while trying to write a behavioral test for UP-3 — `array.fill`/`array.copy` need a
`(ref null $t)` local, which the IR cannot express. Those two tests are consequently driven from
hand-built binaries and asserted structurally; they become ordinary behavioral tests once this
lands. Doing UP-7 properly also DELETES an existing loud failure (the `gcFuncTypeIndex` ambiguity
throw), which is a better argument for it than the original "smaller ask" framing.

### UP-2 — `tuple.make` (deferred, correctly) — and what multi-value actually costs

Not a factory-plus-encoder-case job. Multi-value blocktypes already throw on BOTH sides —
`readBlockType` in [wasm-parser.ts](../src/binary/wasm-parser.ts) and `writeBlockType` in
[wasm-encoder.ts](../src/encoder/wasm-encoder.ts). `tuple.make` is the tail of a multi-value
project, not a peer of UP-3/UP-4. Scoping it alongside them would badly understate it.

**Measured 2026-08-24** with three hand-built fixtures, because "multi-value is unsupported" turned
out to be too coarse to plan from:

| case                                            | status                                   |
| ----------------------------------------------- | ---------------------------------------- |
| multi-result FUNCTION `(func (result i32 i32))` | ✅ **already works** — round-trips valid |
| multi-result CALL (N > 1 results)               | ✅ works (WT-2i `pushMultiValueCall`)    |
| multi-result BLOCK, no params (p=0, r=2)        | ❌ throws (loud)                         |
| block WITH INPUTS (p≥1)                         | ❌ throws (loud)                         |

So the gap is narrower than "multi-value": function and call arity already work; only the
**blocktype** path (a type-index blocktype rather than an inline valtype) is missing. That splits
into two pieces of very different cost:

- **Multi-result blocks (p=0, r>1)** — moderate. Decode needs N−1 `Pop`s seeded below the block on
  the operand stack (the `pushMultiValueCall` pattern already in the decoder); encode needs
  `writeBlockType` to emit a type-section index and `collectTypes` to register block signatures.
  This is the piece UP-2's "multi-value `br` / `br_if`" needs.
- **Blocks with inputs (p≥1)** — structurally harder: `BlockExpr` has no notion of consuming values
  from the enclosing stack, so it is an IR-shape change, not a plumbing change.

Corpus impact is exactly **one** file, `lit/control-flow-input.wast.wasm` — upstream's own test for
block inputs, i.e. the _harder_ piece. Nothing else in the 90-file corpus needs either.

**None of this is a bug.** Every unsupported case fails loudly on both sides, which is the contract
working as designed. It is a missing feature, and should be weighed as one.

### Multi-result blocks shipped (2026-08-24); block inputs still rejected

The first of the two pieces is done — `tuple.make` (UP-2) came with it, because it turned out to be
required rather than adjacent.

The blocktype plumbing was the easy half. The load-bearing part was the two places that would
otherwise have **lost values silently** the moment multi-result blocks started decoding:

1. A multi-result block leaves N values on the enclosing stack but is ONE IR node. N−1 typed `Pop`s
   are now seeded beneath it — the same `pushMultiValueCall` shape used for tuple-returning calls.
2. `br` / `br_if` / `br_table` to a multi-result target did
   `_branchValueArity(...) === 1 ? pop() : null`. For N > 1 that popped **nothing** and emitted a
   value-less break, discarding every value the branch carried. Latent while multi-value threw; live
   the instant it didn't. The N values now travel as one `makeTupleMake`, which is exactly what
   `tuple.make` is for: "these N expressions, left to right, leaving N values on the stack". It has
   no wasm opcode, so the encoder emits the operands and nothing else.

Encoder: `writeBlockType` emits a multi-result header as a **non-negative signed LEB** naming a
type-section entry (`writeI32`, not `writeU32` — the same `s33` trap as `writeHeapType`), and
`collectCallIndirectTypes` was generalized to `collectExprTypes` so one walk registers both
`call_indirect` signatures and block headers.

### Block and `if` inputs shipped; LOOP inputs deliberately still rejected

`BlockExpr` has no parameter list, but it does not need one. A parametrised block's entry values are
spilled into fresh locals **before** the construct (a `local.set` appended to the enclosing frame),
and the body is seeded with `local.get`s. Semantically identical — entering a block has no
observable effect — and the temporaries are ordinary locals, so `SimplifyLocals` / `CoalesceLocals`
fold most of them back out.

For `if` this is not merely convenient, it is _required_: **both arms** start with the parameters on
their stack. Relocating the value expressions into the body would duplicate them into both arms and
evaluate them twice. Evaluating once into a local and re-seeding each arm (`frame.paramSeed`) is the
only correct shape.

**Loops with inputs are now supported too, via a branch rewrite.** A loop's parameters are
re-supplied by every back-edge, so the one-time entry spill is not enough — the branch has to write
the temps as well. `rewriteLoopBranch` emits:

```wat
br $loop      →   local.set $t0 v0; … ;  br $loop

br_if $loop   →   local.set $t0 v0; … ;      ;; values evaluated once, into the temps
                  br_if $loop (cond)          ;; loop now carries nothing
                  local.get $t0; …            ;; NOT TAKEN: put them back
```

**That trailing restore is the whole difficulty**, and it is why this was rejected first. A `br_if`
that is _not_ taken leaves its values on the operand stack. Writing the temps unconditionally
without pushing them back strips them from the fall-through path — a silent wrong-value miscompile.
The regression test (`loop back-edge br_if`) is a countdown whose loop result IS the fall-through
value; deleting the restore makes it fail, verified.

Evaluation order is preserved for free: the values precede the condition in the input, and the
emitted `local.set`s precede the branch that carries the condition.

**`br_table` with MIXED targets is handled by a dispatch trampoline.** A table whose targets are all
the same parametrised loop is rewritten directly (one unambiguous set of temps, then a value-less
table). When the targets mix a parametrised loop with a block / `if` / function frame the two
disagree on calling convention — the loop consumes 0 stack values and wants its temps written, the
others still consume their arity from the stack — so no single table serves both. The table is
demoted to selecting a CASE:

```wat
local.set $i                  ;; index
local.set $s0 …               ;; the N values, into SHARED temps, once
block $L0
  block $L1
    block $L2
      local.get $i
      br_table $L0 $L1 $L2    ;; every case label is void
    end
    <case 2>                  ;; reached by falling out of $L2
  end
  <case 1>
end
<case 0>
```

Each case is a single unconditional branch in its own convention, so no case falls through and every
wrapper block is void. Order is preserved: the values are stored before the index, matching the
input where values are pushed before the table's operand.

`try` / `try_table` parameters use the plain entry spill — a branch to their label targets the END
(results), and catch handlers start with the TAG's parameters, not the try's, so only the body is
seeded.

**Round-trip drift is now checked for CONVERGENCE, not equality.** These rewrites legitimately add
`local.set`/`local.get` nodes on the first trip (control-flow-input: 218 → 220 → 220 → 220), so
demanding gen0 == gen1 would flag a working transform. Generation 1 vs generation 2 must match
instead — which still catches the failure that check existed for: the `unreachable-pops` defect grew
on EVERY trip (4 → 5 → 6), verified by reverting its fix. Entity counts (functions, globals, data
segments) stay exact. Applied to both `scripts/verify_roundtrip.ts` and
`tests/binary/corpus_roundtrip_test.ts`.

Corpus is now **80 exact, 0 drift, 0 validate failures, 10 deliberate rejections** —
`lit/control-flow-input.wast.wasm` round-trips. (Note it does not validate under V8 _as input_, so
it exercises decode/encode structure rather than output validity; the behavioural trampoline test
uses a hand-built fixture that does validate.)

`lit/control-flow-input.wast.wasm` now decodes past its block and `if` inputs and stops on a loop
input — so it remains the one corpus file rejected on this feature, but for a materially narrower
reason than before.

### UP-6 / UP-4 / UP-3 (fixed, Tier 2)

- **UP-6 tag imports.** The load-bearing part is the index space: imported tags take the low end,
  ahead of defined ones. THREE sites had to agree — `buildIndices` walking tag imports first, the
  parser numbering defined tags from `importedTagCount`, and `parse()` no longer rebuilding every
  tag as a fresh `$tag${i}` (it was silently discarding the offset the tag-section reader had just
  computed). Missing any one retargets every `throw` and tag export — the `$import${n}` failure of
  WT-2b, reproduced in the tag space. The regression test throws a DEFINED tag from a module that
  also imports one. `StripEH` drops tag imports too, so a stripped module stops demanding a tag from
  its host for nothing.
- **UP-4 `ref.as_non_null`** (0xd4), on the existing `RefAs` placeholder kind plus a new `RefAsOp`
  discriminant — matching upstream's `RefAs`/`RefAsOp` shape rather than adding a parallel node. The
  extern conversions slot in there later.
- **UP-3** `array.fill` / `array.copy` / `array.init_data` / `array.init_elem` (0xfb 0x10–0x13),
  replacing four explicit rejects. `array.copy` carries dest and src heap-type indices separately,
  in that immediate order; a dedicated test asserts the order, because swapping them is invisible
  when both types match.

**Both new node families are wired into BOTH `_mapChildren` and `_visitChildren`** in
[walk.ts](../src/ir/walk.ts). Omitting one makes the node invisible to every pass instead of
erroring — exactly the trap `default: throw` was added to catch.

All five new instructions are pinned against the WAT front door by a test asserting **zero `nop`
fall-throughs** — the WT-2h failure mode where `ref.*` silently became `nop`.

### Confirmed still-fixed (wabt-ts had these listed stale)

`addElement` present; `loadOpcode` throws instead of falling through to i64 (its comment documents
the silent-truncation bug it replaced); `WasmExport.kind` includes `"tag"`.

---

## Corpus round-trip closure (2026-08-24) — the last two upstream-corpus defects

`scripts/verify_roundtrip.ts` over the upstream test tree was down to two failures, both
**pre-existing** (identical at the pre-UP-series HEAD) and both the silent-substitution class. Fixed
together; the corpus is now **79 exact, 0 structural drift, 0 validate failures**.

### `ref.null` collapsed every heap type to `externref`

Both decode sites did `r.readU8()` then `ht === 0x70 ? FuncRef : ExternRef`. Wrong twice over: a
heap type is a signed LEB (`s33`), not one byte; and every non-`func` heap type — `none`,
`noextern`, `eq`, a concrete `$T` — became `extern`. On `unit/input/gc_target_feature.wasm` that
turned a valid `(global (mut eqref) (ref.null none))` into a module V8 rejects with "type error in
constant expression[0] (expected eqref, got externref)". Valid in, invalid out, no passes.

Both sites now share `readRefNullType`, which reads a real heap type and maps an abstract one back
to the `ValType` that names it (`ABSTRACT_HEAP_TO_VALTYPE`) or builds a `RefType` for a concrete
index.

The encoder had the **mirror** defect: `writeHeapType` wrote a concrete index with `writeU32` while
`readHeapType` reads it back signed, so an index ≥ 64 round-tripped to a negative value and resolved
to an abstract heap type instead. Below 64 the two encodings coincide, which is why no fixture ever
caught it — the regression test builds 70 heap types on purpose. Also converted the statically-dead
`ABSTRACT_HEAP_TYPE_BYTE[h] ?? 0x6e` fallback to a throw (the table is
`Record<AbstractHeapType, number>`, so TypeScript already proves it exhaustive).

### `pop()` on an empty operand stack returned a `nop`

An empty stack at a value pop is legal in exactly one situation: **stack-polymorphic code**. After
`unreachable` / `br` / `return` / `throw` the validator lets an instruction pop values that were
never pushed, and the phantom it pops has the bottom type. `unreachable` IS that value; a
`none`-typed `nop` is not a value at all — the identical defect to the catch-param (WT-2h) and
tuple-call (WT-2i) `nop`s, just reached from the empty-stack path rather than the skip-statements
path.

On `unreachable-pops.wasm` (`block (result i32); unreachable; i32.add`) it decoded to
`i32.add(nop, unreachable)`, re-encoded with a spurious leading `nop` opcode, and **grew an
expression on every round-trip**. It now decodes to `(i32.add (unreachable) (unreachable))` —
byte-for-byte what upstream's own `.fromBinary` for that fixture says — and is a fixed point.

### The 11 files that still do not parse are deliberate

Verified identical before and after. Intentionally-malformed crash inputs, fuzz inputs with invalid
magic, component-model files, and loud non-MVP rejections (declarative element segments, `local.get`
in an init expression, multi-value block types). **Note the harness blind spot:**
`verify_roundtrip.ts` `continue`s past a file that fails the initial parse without counting it, so
its "0 failures" summary is not by itself proof that every file was exercised — check the file count
too.

---

## "Look for code issues" sweep (2026-08-24, post-multi-value) — 3 findings

Ran the audit trigger in [INDEX.md](INDEX.md) over the tree after the multi-value work. Three real
issues, all in the two classes that trigger names first: a silent drop and a silently-wrong type,
plus one invariant violation in the freshly-written code.

### `if` with parameters aliased one expression node into both arms

Self-inflicted, from the block-inputs commit. The then-arm and else-arm were seeded with the SAME
`local.get` node objects (`exprs: [...seed]` copies the array, not the nodes). This IR requires
every expression to have exactly one parent — an aliased node is reachable from two tree positions,
so a pass that rewrites or marks by identity (CoalesceLocals stamps a `Symbol` on specific nodes)
would hit both arms at once.

Fix: the frame stores `paramSeed: { slots, types }`, and each arm builds **fresh** reads. Measured
before/after with an identity walk: 1 node reachable twice → 0. Regression test asserts no node is
reachable from two positions.

### Unknown export kind was silently dropped

[wasm-parser.ts](../src/binary/wasm-parser.ts) `readExportSection` ended in `default: break;` — an
unrecognized export kind byte discarded the export and carried on. That is _precisely_ how tag
exports went missing before `case 0x04` was added (the wasmtk team reported it as "tag export
stripped"); the same hole remained open for any other kind. The import section already errored. Now
symmetrical: `unknown export kind 0x..`.

### Flatten mis-typed multi-result calls

[flatten.ts](../src/passes/flatten.ts). Two related defects, both newly reachable now that
multi-result calls decode:

- `buildCallResultTypes` recorded `f.results[0]`, so a 2-result function looked like a plain i32
  function.
- `callEffectiveType` returned `results[0]` for `call_indirect`, and `?? None` for an unresolved
  direct-call target.

The consumer hoists a value-producing expression into ONE temporary local. A multi-result call
therefore had its extra values silently dropped, leaving the operand stack short. Flatten has no way
to model a tuple, so it now **throws** on a multi-result call rather than mis-hoisting, and the map
keeps the full result list so the check can see it. An unresolved call target throws too — the map
covers every import and defined function, so a miss is a dangling reference, and typing it `none`
discarded the call's value exactly as the WAT parser's old `inferFuncResultType` stub did.

**Not changed, deliberately:** the unknown-section-id `default: this.r.seek(end)` stays lenient —
skipping an unknown section is harmless and forward-compatible.

### Dead-export follow-up — "published API surface" was an unchecked assumption

The first pass waved the unreferenced exports through as public API. That was asserted, not
verified. Checking the actual reachability changed the answer for most of them.

**The decisive test is the `exports` map in `deno.json`, not the `export` keyword.** A symbol is
only consumer-reachable if its module is an entry point or is re-exported from one. Two findings:

- **`src/parser/` has NO export subpath at all** and is not re-exported from any entry point, so
  everything in it is internal.
- **`src/passes/index.ts` imports `./asyncify.ts` for its side effect only** (pass registration); it
  re-exports solely from `pass.ts`. Asyncify's own exports are therefore internal too.

Removed (each had exactly ONE reference in the whole tree — its own definition — and no
consumer-reachable path):

| symbol                   | module                 | why it was there                                       |
| ------------------------ | ---------------------- | ------------------------------------------------------ |
| `assertList`             | `parser/sexpr.ts`      | internal helper, never called                          |
| `isAtom`                 | `parser/sexpr.ts`      | internal helper, never called                          |
| `parseWast`              | `parser/wat-parser.ts` | `.wast` multi-module parsing, never wired up           |
| `materializeFakeGlobals` | `passes/asyncify.ts`   | marked **TEST-ONLY** for tests that were never written |

`materializeFakeGlobals` is the one worth remembering: its doc warned "do NOT wire this into
`AsyncifyPass.run`", which reads like a missing call but is the opposite — fake globals are
deliberately never materialized, because Stage 4 `lowerIntrinsics` rewrites every fake
`global.get`/`global.set` to a scratch local before anything validates. That rationale is now a
comment at the fake-global creation site, so removing the function did not take the knowledge with
it. **Check whether "dead" code is really a missing call before deleting it.**

Kept, with the reasoning written down so a future sweep does not re-flag them:

- **`isAbstractHeapType`** — reachable via `./ir`, and it is the public discriminator for the
  exported `HeapType = number | AbstractHeapType` union. Without it a consumer must test
  `typeof h === "string"` and reach into the representation. Unused internally _by design_.
- **`getLowMemoryUnused` / `setLowMemoryUnused`** — reachable via `./compat`. Not dead, but worse:
  **live API that silently does nothing**. The flag is written and read back by no pass. Removing it
  would break the facade's promise that migrating call sites change only the `import` line, so it is
  kept on the same footing as `setFeatures` — and the JSDoc now says plainly that it is
  informational and changes no output, instead of implying an effect.
- The `ExpressionId*` numeric constants in `/compat` are the documented upstream-parity set (Phase
  12.1); unused internally, that is the point.

**Versioning:** removing consumer-reachable-by-name symbols is a breaking change even though none
were reachable in practice, so the next release is **1.5.0**, not 1.4.4 (owner decision).

---

## Second "look for code issues" sweep (2026-08-24) — the duplicate-dispatcher class

The first sweep chased silent fallbacks. This one chased a structural smell instead: **how many
places dispatch on `ExpressionKind`, and do they all know every kind?** `walk.ts` owns the
authoritative enumeration (`_mapChildren` / `_visitChildren`, both of which THROW on an unhandled
kind). Two other files had grown their own hand-written copies, and both had silently fallen behind.

Six new kinds were added this session (`TupleMake`, `RefAs`, `ArrayFill`/`Copy`/`InitData`/
`InitElem`), which is what made the drift worth measuring.

### `deepCopy` shared subtrees across inlined copies (inlining.ts)

`deepCopy` exists for exactly one reason — the IR's one-parent-per-node rule, which inlining would
otherwise break by placing the same callee body at several call sites. Its switch covered **29 of 79
expression kinds**, ending in:

```ts
default:
  // Unknown kind (future IR extension) — return as-is; no children to copy.
  return expr;
```

The comment is false: an unhandled kind can have children. Every SIMD, GC, EH, table and tuple node
was returned as-is, with its subtree shared. Demonstrated with an identity walk — inlining a callee
containing a `SIMDExtract` at two call sites left **1 node reachable from two tree positions**; 0
after the fix.

Fixed by deleting the switch: `deepCopy` is now `mapExpression(expr, (e) => ({ ...e }))`. One
dispatcher instead of two, and a future node cannot silently reintroduce sharing because walk.ts
throws on an unhandled kind.

### PickLoadSigns could not see uses inside a `br` (pick-load-signs.ts)

`_walkWithParent` was a third hand-written child enumerator — ~15 kinds, `default: break;`. It never
descended into a `br`/`br_if` value, a `switch` value, `struct.set`/`array.set`, any SIMD node, a
`try` body, or a `tuple.make`.

**This is a miscompile, not a missed optimization.** The pass flips a narrow load's signedness only
when `signedCount + unsignedCount === totalCount` — every use must re-extend the value. A use the
walk never reaches increments **neither** counter, so it is invisible rather than neutral, and the
flip proceeds as if it did not exist. With one masked use (`x & 0xFF`) and one `br` carrying the
value, the pass flipped `i32.load8_s` to `load8_u` and `-1` silently became `255`.

Fixed by delegating to `visitChildren`. Regression test in
[pick_load_signs_test.ts](../tests/passes/pick_load_signs_test.ts) is behavioural (asserts `-1`
before and after) and verified to fail — "load sign was flipped despite an observing `br` use" —
when `Break` recursion is removed.

### The rule this yields

**There is exactly one authoritative child enumeration, in `walk.ts`.** Anything that needs to
recurse over children must go through `mapExpression` / `walkExpression` / `visitChildren` /
`mapChildrenShallow`, never a private switch. A private switch cannot be kept in sync — both copies
here fell behind without a single test noticing, because falling behind produces _silence_, not an
error. Checked clean this round: `_exprKey` and `_isPure` and Vacuum's removal set are allow-lists
with conservative defaults (unknown kind ⇒ not CSE-able / not pure / not removable), and `cfg.ts`
already ends in `default: visitChildren(...)`.

---

## Fail-loud audit sweep (2026-07-07, post-Asyncify) — four passes, 20 fixes, suite 379 → 394

A multi-pass whole-tree audit (mechanical grep sweeps + four parallel subagent code-review agents,
every finding verified behaviorally / against upstream / rejected if wrong) for silent fallbacks,
fall-throughs, and correctness bugs. **20 genuine issues fixed across four passes, including 6 real
behavioral miscompiles**; ~15 regression tests + a 20k-iteration differential-fuzz confirmation.
Shipped in **v1.3.6**. Pass 1 (the 9 fail-loud conversions) is detailed just below; Pass 2–4 (the
behavioral miscompiles + remaining type-inference gaps) follow under "Deep-audit passes".

**Root-cause find (the load-bearing one):** the WAT parser's `inferFuncResultType` /
`inferGlobalType` were TODO stubs returning `null`, so **every `(call $f)` was typed `None`** and
every `(global.get $g)` typed i32. A `None`-typed call flowed into Asyncify's flatten→flow stages,
which derived a **`None`-typed spill local** from it; the encoder's `valTypeByte` `default` silently
emitted that local as i32 (0x7f) — correct only by accident (the call happened to return i32; an
i64/f64 async import would have been silently corrupted). Fix: first-pass `funcResults` /
`globalTypes` maps ([src/parser/wat-parser.ts](../src/parser/wat-parser.ts)) populated for imports +
inline-signature defined funcs/globals (forward-reference safe); `_firstResultTypeOf` scans inline
`(result …)` only (can't reuse `parseFuncType` — it chokes on named `(param $x …)`).

**The other eight (all silent-wrong → now throw):**

- **Binary parser** ([src/binary/wasm-parser.ts](../src/binary/wasm-parser.ts)): (1) SIMD (0xFD)
  decoder `default` emitted `nop` for unknown/relaxed sub-opcodes (dropped op + operands → stack
  imbalance) — the GC/bulk-memory decoders already threw; this one was missed. (2) `readInitExpr`
  `default` emitted `i32.const 0` for unknown init opcodes — mis-valued the global/offset AND left
  operand bytes unconsumed, desyncing the reader. (3) `readHeapType` `default` returned `Any` for an
  unknown abstract byte (mistyped ref) — now throws like `readValTypeByte`.
- **Encoder** ([src/encoder/wasm-encoder.ts](../src/encoder/wasm-encoder.ts)): `valTypeByte`
  `default` returned 0x7f (i32) for any unknown ValType — the guard that exposed the Asyncify root
  cause above.
- **WAT parser** ([src/parser/wat-parser.ts](../src/parser/wat-parser.ts)): `resolveTypeIndex`
  `?? 0` (9 GC-op call sites → wrong type on `(type $name)` miss); `parseStorageTypeSExpr` `?? I32`
  and `parseHeapType` `?? Any` (silent type fallbacks); `call_indirect (type $x)` with an
  **unresolved** ref silently fell through to an empty signature (wrong arity) — the type ref is
  authoritative, now throws.

### Deep-audit passes (2–4) — behavioral miscompiles + type-inference gaps

Pass 2 ran four subagent audits over passes / binary+encoder / WAT+IR / api+compat; passes 3–4
closed the remainder. Every item was verified with a behavioral repro before fixing.

- **`parseLoop` dropped `(result …)` → invalid wasm**
  ([wat-parser.ts](../src/parser/wat-parser.ts)). It skipped the result clause and hardcoded
  `type: None`, so a value-producing loop encoded a void blocktype (V8: "expected 0 for fallthru,
  found 1"). Now mirrors `parseBlock`. Behavioral: `(loop
  (result i32) (i32.const 5))` → `f()=5`.
- **Flatten `local.tee` clobber → wrong value** ([flatten.ts](../src/passes/flatten.ts)). The tee
  rewrite returned `local.get tee.index` (the ORIGINAL local), clobberable by a later sibling
  operand writing the same local. Now captures into a fresh temp. Behavioral:
  `sub(tee $t 10, tee
  $t 3)` gave `0`, now `7`. Reachable via `--flatten` and Asyncify.
- **`PickLoadSigns` — inert AND wrong** ([pick-load-signs.ts](../src/passes/pick-load-signs.ts)).
  TWO bugs: (a) it counted signed/unsigned COMPARISONS as the flip signal (upstream counts only real
  sign/zero-EXTEND ops and refuses to flip if ANY observing use exists) — a latent miscompile; (b)
  it was silently inert anyway — `toSign` keyed a `Map` by the original `LoadExpr` while
  `mapExpression` rebuilds the node (WT-2c #5 identity-loss), so no flip ever happened. Rewrote to
  match upstream's `totalUsages` guard + symbol-marker identity (survives spread). A subagent
  reported this as a "live −O1 miscompile"; **that was WRONG** (the inertness meant no live
  miscompile) — caught by running it. Behavioral: load8_u feeding `lt_s` stays unsigned (`f()=0`).
- **Inlining didn't reset ref/v128 non-param locals** ([inlining.ts](../src/passes/inlining.ts)).
  `zeroForType` returned `null` for non-numeric types, so a callee's ref/v128 local kept the
  PREVIOUS execution's value when the call site runs repeatedly (loop). Now emits `ref.null` /
  `v128.const 0`.
- **Multiple tables silently encoded against table 0**
  ([wasm-encoder.ts](../src/encoder/wasm-encoder.ts)): `encodeElementSection` + `call_indirect`
  hardcode table 0 (no guard, unlike memories). Added `checkSingleTable` fail-loud guard mirroring
  `checkSingleMemory`.
- **Multi-value type-index blocktype silently decoded to void**
  ([wasm-parser.ts](../src/binary/wasm-parser.ts) `readBlockType`) — read the LEB then returned
  `[]`, so the encoder's multi-value guard never saw it. Now throws.
- **compat `_idToValType(x) ?? i32` at 6 required-type sites**
  ([binaryen-compat.ts](../src/api/binaryen-compat.ts): `addFunction` vars,
  `addGlobal`/`addGlobalImport` type, `local`/`global` get/tee) silently mistyped a bad type ID.
  Added `_idToValTypeStrict` (throws), matching the params/results contract.
- **`struct.get`/`array.get` hardcoded `i32` result type**
  ([wat-parser.ts](../src/parser/wat-parser.ts)) — mistyped any non-i32 field/element. Added a
  heapType-index→TypeDef map; result now follows the declared field/element type (packed `i8`/`i16`
  unpack to `i32`).
- **`resolveLocal` out-of-range index / `global.get $unknown`** silently typed `i32`; both now
  throw.
- **`(func (type $sig))` result-only signature typed the call `None`** — the same None-local class
  as the Pass-1 root cause. Fixed with deferred resolution (`pendingFuncTypeRefs` resolved after the
  first pass, since a `(type)` may follow the func in source order).

**Deliberately left as-is (verified NOT bugs):** section-dispatch `default: seek(end)`
(spec-compliant skip of unknown sections), custom/name-section skips (documented drop), pass-level
`default: return
expr` (unhandled kind = no-op is correct for an optimizer pass), the coarse
ref-type model (`ref.null $type`/`readValTypeByte (ref $T)`→funcref/anyref, `br_on_cast ?? Any` —
documented, consistent), and the binary parser's `locals[idx]?.type ?? i32` / `gi?.type ?? i32`
defensive decoding (fires ONLY on an out-of-range index in a malformed binary that
`WebAssembly.compile` rejects — the parser decodes, it deliberately does not validate; validation is
wabt-ts's role).

## Hardening sweeps — Tiers 1–4 / A–C (post-v1.3.4)

Multi-agent code reviews swept for silent-miscompile bug classes, dead code, facade/CLI defects.
Suite 310 → 341.

- **Tier 1 — WAT-parser typing + encoder index resolution.** Route `return`/`if`/`call_indirect`
  through factories (hand-built literals re-opened `unreachable`-typing bugs). New `resolveRef`
  helper **throws** on a name→index miss at all ~15 entity-reference sites (was `?? 0`).
- **Tier 2 — silent `nop` fall-throughs → loud errors.** WAT unrecognized instruction; encoder
  unknown unary/binary op + default expr kind; binary-parser bulk-memory/table ops (`memory.init`,
  `table.*`, `data.drop`, `elem.drop`, `array.copy/fill/init_*`) + unknown opcodes — all
  decoded/encoded to `nop` (dropping operands → stack imbalance). Now throw.
- **Tier 3 — `select` LUB + encoder edge cases.** `makeSelect` computes the reachable-arm LUB (was
  blind `ifTrue.type`). Encoder throws on multi-value tuple blocktype, `ref.null` of an
  unrepresentable type, load/store with a non-numeric result type (was `default → i64`).
- **Tier 4 — pass correctness.** (a) Vacuum single-child block collapse guards the type. (b)
  Inlining dead-callee removal matched the `inlineable` set instead of `name.split("$")[1]` (`""`
  for `$`-prefixed names → fully-inlined fns never removed).
- **Tier A — type-index resolution + compat signatures + walk guard.**
  `getTypeIndex`/`gcFuncTypeIndex` throw on a miss (was 0). Compat `call_indirect` (table arg must
  be FIRST) + `setMemory` (missing `segments` param) fixed to upstream arg order. `walk.ts`
  `_mapChildren`/`_visitChildren` `default` throws on unhandled `ExpressionKind`.
- **Tier B — non-MVP constructs → loud failures.** Element-segment `ref.null` entries, passive/
  declarative element segments, multiple memories, ambiguous GC func-type matching — all throw.
- **Tier C — compat introspection parity.** `expandType(none)` → `[]`; `getFunctionInfo` reports
  `module`/`base` as `""` + adds a `type` field.
- **Round 3 / dead-code removal** — `v128.load`/`store` SIMD-form encode; real `parseHexFloat`
  (`Number("0x1.8p+1")` is `NaN`); `exprToWat` default throws (was a TODO comment the hybrid
  optimizer re-optimized); `--validate` actually runs `WebAssembly.compile`; `readU32`/`readU64`
  reject junk in the final LEB byte; `br_on_cast`/`_fail` round-trip source heap-type.
  `Module.optimize` hardcoded `optimizeLevel: 2` → parses the level. The 5 SIMD `?? <default>`
  sub-opcode fallbacks → throws.

## Branch-depth corruption (the deepest pre-WT fix)

The IR stored branch labels only for `Block`/`Loop` — `if` had no `name` and the function-frame
label was dropped. A `br` to an `if` or the function frame stored a label the encoder couldn't
reproduce; `resolveLabel` missed and silently `return 0`'d, re-pointing the branch at the
**innermost** frame — correct only when the target _was_ innermost, so it corrupted control flow
from deeper nesting (a branch meant to exit the function instead exited an inner block). Fix:
`IfExpr.name` + `WasmFunction.bodyFrameLabel`, threaded parser → `addFunction` → encoder; the
encoder pushes the `if`'s label and seeds the function-frame label at the bottom of its label stack
(phantom, no opcode); `resolveLabel` **throws** on a genuine miss. `_idToValTypeArray` (compat)
throws on an unrecognized type ID (was dropping → arity change). Regressions in
`tests/binary/control_flow_regression_test.ts`.

---

## The WT (wasmtk-migration) series

### WT-1 — LEB128 signed-overflow (parser)

`readI32`/`readI64` used `shift >= 35` / `>= 70n` overflow checks, rejecting valid 5-byte i32 /
10-byte i64 encodings on the last byte (the `do/while` incremented `shift` unconditionally, unlike
`readU32`). Fix: `>= 35 → > 35`, `>= 70n → > 70n`. Corpus 74 → 84 parseable files; 1,432 → 82,912
expressions. 11 boundary regression tests in `tests/binary/reader_test.ts`.

### WT-2 / WT-2b — binary-parser round-trip correctness (validity)

Found because `verify_roundtrip.ts` originally only checked counts, never `WebAssembly.compile`.
Root causes:

- `makeReturn` typed `unreachable` not the value type (a void block ending in `(return x)` was
  mistyped); `makeBreak`/`makeSwitch` typed per upstream `finalize` (unconditional `br`/any
  `br_table` = `unreachable`, `br_if` follows fallthrough).
- **Imported functions named `$func${globalIndex}`** (was `$import${n}` — the encoder's `funcIndex`
  map missed → every imported call encoded as index 0; **the entire "call need N got M" cluster**).
- `br`/`br_if`/`br_table` pop the branch value for result-typed targets (`_branchValueArity`).
- Block/loop/try frames sealed with the **declared result type** (not last-child-inferred); loop/
  try_table wrapper block is anonymous + stamped with the declared type (reusing the loop label gave
  `(loop $L (block $L))` → back-edge `br` hit the wrong target).
- `call`/`return_call` consult `importedFuncTypeIndices` for imported arities.

### WT-2c — six behavioral miscompiles (pass correctness)

Surfaced by `equiv_check.ts`; all six fixed:

1. **Element segments silently dropped** (`readElementSection` `void seg`'d them) → table
   uninitialized → every `call_indirect` trapped. Added `ModuleBuilder.addElement`. (Also
   retro-explains WT-2's bogus "cube 0.78× smaller" — without elem-seeded reachability,
   `RemoveUnusedModuleElements` deleted table-referenced functions.)
2. **LocalCSE clobbered block result type** (recomputed `block.type` from last child after rewrite;
   when the block exits via `br`/`return` the last child is `unreachable` → overwrote a declared
   `i32`). CSE preserves type — drop the recompute.
3. **Vacuum + SimplifyLocals** had the identical `block.type = lastChild.type` defect — same fix.
4. **`makeIf` type LUB** — used `ifTrue.type` blindly; when `then` is `unreachable` but `else` falls
   through, the `if` was mistyped `unreachable` → DCE deleted everything after it, including a loop
   back-edge `br` (silently broke the loop; `_fib` returned 0). Fixed to the reachable-arm type per
   upstream `If::finalize`.
5. **CoalesceLocals `_rewriteBody` identity loss** — `effectiveSet: Set<Expression>` keyed by
   ORIGINAL node refs, but `mapExpression`'s `_mapChildren` unconditionally spreads, rebuilding
   every ancestor → `effectiveSet.has(e)` always false → **every `local.set` became a `drop`**. Fix:
   pre-walk and stamp a `Symbol`-keyed `_INEFFECTIVE` marker (object spread copies symbol keys,
   surviving every rebuild).
6. **LocalCSE post-write cache staleness** — `_cseBlock` invalidated cache BEFORE each child but
   never AFTER, so a `tee N` created inside a child whose surrounding `set K` writes the slot left
   `lg:K → N` cached for the next child, which read the PRE-set value. Fix: POST-invalidate after
   each child.

### WT-2d / WT-2e — wasmtk integration rounds 1–2 (parser)

- **Single-arm `(if cond (then BODY))` round-tripped with body in the ELSE arm** — pivot on
  `frame.kind` (`"if"` → `frame.exprs` IS the then-arm; `"else"` → `frame.thenExprs` is the
  then-arm). Inverted every wasic break/bounds/null-guard.
- **Tag exports dropped + tag type-index retyped after RemoveUnusedModuleElements** — added export-
  section `case 0x04` (parser, `$tag${index}`), encoder `case "tag"` (kind 0x04), and the GC-mode
  `mod.heapTypes`-indexed lookup in `encodeTagSection` (was using the deduped `getTypeIndex`).
- **Flag-4 (expression-form) element segments silently dropped** — WT-2c only handled
  `segKind === 0`; wabt with reference-types encodes active segments as flag 4 (`ref.func` expr
  list). Rewrote `readElementSection` to decode all 8 flag forms; `readElemExprFuncName()` helper.
  Every `Array.map/filter/forEach` callback dispatch through funcref tables had been trapping at
  runtime.

### WT-2f — round 3 (pass correctness)

1. **Inlining invalid wrapper-block fallthru** — see [passes.md](passes.md) Inlining; append
   explicit `makeUnreachable()`; type the synthesized `br` as `Unreachable` (was `value.type`).
2. **CoalesceLocals dispatched `call_indirect` to the wrong function** — the CFG must visit operands
   before `target` (wasm evaluates the table index last). Explicit `CallIndirect` case in `cfg.ts`.
3. **WAT parser emitted export kind `"func"` not `"function"`** — encoder switch + inliner
   `usedGlobally` both key on `"function"` → standalone-exported fn corrupted on encode AND deleted
   by Inlining. Map `func → function` in `parseExport`.

### WT-2g — round 4 (encoder, EH)

**`try`/`catch` handler body re-emitted wrapped in a spurious `block`** — the binary parser packs a
multi-instruction catch handler into an anonymous `Block`; the generic `encodeExpr` wrapped it in
`0x02…0x0b` (void blocktype), so the `catch` edge's pushed params landed on the wrong stack and the
handler's leading `local.set`s ran on an empty stack ("not enough arguments on the stack for
local.set"). Bare round-trip corruption. Fix: `encodeCatchBody` UNPACKS an anonymous-Block handler,
mirroring function-body unpacking.

### WT-2h / WT-2i / WT-2j — rounds 5–6 + the skipBinaryenOpt root-cause

These are three _distinct_ LocalCSE invalidation bugs plus catch/tuple parser bugs. Keep them
separate:

- **WT-2h** — catch-region operand handling: the catch handler seeded one hard-coded `makePop(I32)`
  regardless of tag arity, and `pop()` blindly took the top `exprs` entry (consuming `nop`
  placeholders). Fix: seed one typed `Pop` per tag param; `pop()` returns the topmost
  _value-producing_ expr, skipping `none`-typed statements (preserving side effects). Surfaced a
  WAT-parser gap: `ref.null`/`ref.func`/`ref.is_null` had no handler (fell to `nop`) — added the
  three handlers.
- **WT-2i** — (1) **multi-value (tuple) call returns**: a `call` returning N>1 results is one IR
  node but N stack values; the decoder modeled only the first consumer → the others popped `nop` →
  dangling stack. `pushMultiValueCall` seeds N-1 typed `Pop`s below the call. (2) **LocalCSE
  substituted a `local.get` across a write nested in an `if`** — `_invalidate` inspected only
  top-level child kind; now `walkExpression`s the whole child subtree. (True behavioral miscompile,
  present-but-unobservable before; `-1` printed as `1` in itoa.) Detour worth noting: `nextLocal` is
  `fn.locals.length` — `fn.locals` ALREADY includes params (`encoder`
  `fn.locals.slice(fn.params.length)` proves it).
- **WT-2j** — a THIRD LocalCSE bug, distinct from WT-2i: `_rewriteExpr` walks a single child's tree
  and substitutes cached `local.get`s WITHOUT invalidating mid-tree. For `add(LEFT, RIGHT)` where
  `LEFT` contains a nested `local.tee K` and `RIGHT` reads `local.get K`, `RIGHT` read the
  entry-time tee (pre-mutation value). Fix: the `Binary` case `_invalidate`s on the ORIGINAL `left`
  before rewriting `right` (within-expression analogue of WT-2i's cross-sibling invalidation).
  **This root-caused wasmtk's `skipBinaryenOpt` workaround** on the wasmmerge path (doubly-merged
  modules miscompiled); unblocks removing it after a binaryen-ts publish.

### WT-2k — decoder reorders a stack-held state-dependent value past a write of its state (2026-07-09)

The deepest `pop()` bug yet, and the direct sequel to WT-2h. The binary keeps a value on the OPERAND
STACK across void statements and consumes it later — Binaryen/TinyGo emit this to avoid a local. The
canonical case is TinyGo's **goroutine trampoline** (`tinygo_launch`), which keeps the caller's
`$__stack_pointer` (`global.get`) live on the stack across `global.set $sp …;
call_indirect; call`,
then a trailing `global.set $sp` RESTORES it. `pop()` (post-WT-2h) returns the topmost
value-producing entry, **skipping `none` statements**. Skipping the `global.set $sp` to grab the
`global.get $sp` beneath it, then placing that `global.get` as the restore's operand, **re-evaluates
`global.get $sp` AFTER `$sp` was overwritten** → `global.set $sp (global.get $sp)` self-assign. The
old shadow-stack pointer is never restored; after each goroutine launch `$sp` points into the
finished frame, so every later allocation corrupts memory — trapping at the linear memory boundary.
Classic "valid wasm, wrong value" (validity never caught it).

**Fix** (`src/binary/wasm-parser.ts` `pop()`): when the chosen value sits BELOW ≥1 statement (a
reorder), **spill** it — replace it in place with `local.set $tmp value` (a fresh temp appended to
`locals`) and return `local.get $tmp`. Evaluation order is preserved exactly as the source's own
local did; a later CoalesceLocals/Vacuum elides the temp where it turns out reorder-safe. **A `Pop`
is exempt** (`kind === "pop"`): it is a stack placeholder that encodes to nothing, so
`local.set
(pop)` would leave the set with no stack value — splice it directly as before (the
WT-2h/WT-2i path). Value-on-top (`i === len-1`, the common case) is unchanged.

**How it was found (worth repeating):** end-to-end nested-goroutine crash → bisected the merged
module function-by-function (splicing `wasm-opt`'s working functions into ours) to the single
culprit `tinygo_launch` → diffed it (only the self-assign differed) → confirmed pure
`readBinary→emitBinary` (no passes) reproduced it → instrumented `pop()` to log reorders → caught
the `global.get` spliced from stack index 0 past the `global.set`. Regression test:
`tests/binary/decoder_reorder_test.ts` (hand-assembled value-on-stack module; verified to fail
without the fix). Suite 403 → 405. NOTE: the earlier "memory-grow ordering" hypothesis (traced via a
`stackPos` instrument) was a RED HERRING — the asyncify save/restore was always correct and matched
`wasm-opt`; the corruption was upstream in the decoder.

## CoalesceLocals try/catch EH-aware CFG (v1.3.4)

See [passes.md](passes.md) "EH-aware CFG". Before v1.3.4 the CFG only added a conservative
`bodyEntry → catchEntry` edge and didn't model that a deep `throw` transfers to the _enclosing_
handler, nor that a `local.set` whose value can throw must not kill the old value on the exceptional
path → a handler-read local looked dead → wrongly coalesced. Found via sibling `wasmtk`. Let wasmtk
drop its "skip Binaryen `-Oz` for exception modules" workaround once it bumps to `^1.3.4`.

## Diagnostic scripts (for the next investigation)

`scripts/{equiv_check,headtohead_bench,diag_sections,bisect_pass,bisect_validation,diff_function,
diff_wat,trace_failing,repro_branch_value,diag_fib,diag_dce,diag_cfg,diag_coalesce}.ts`.
`scripts/verify_roundtrip.ts` validates via `WebAssembly.compile` (promote it to a real test once
the parser is provably clean).

## Owner policy (from auto-memory)

**Fix footguns immediately** — don't defer silent-corruption/footgun fixes; fail-loud is the norm.
Only defer a fix if the fix itself risks rejecting valid input.
