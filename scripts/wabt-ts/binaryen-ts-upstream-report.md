# Ready-to-send report for the binaryen-ts team — seven findings from wabt-ts

Written 2026-08-24 from the wabt-ts side, at the end of its conformance campaign. Every finding was
**re-verified against the actual checkout** (`b78e5b476`, v1.3.5, clean on `main`) on the day of
writing, and every severity was **measured, not inherited** — three entries in our own log turned
out to be stale and were corrected before this was written.

We did not modify the binaryen-ts checkout. Paste from the horizontal rule down.

> **ANSWERED 2026-08-24. All seven confirmed, with two severity corrections against us and one
> rebuttal we accept.** The body below is corrected in place; see "What came back" at the end.
>
> The headline framing was **wrong twice**. It first said "six of seven fail loudly or are simply
> absent; only UP-1 emits bad bytes"; corrected to two; corrected again to **THREE of seven produce
> bytes an engine rejects** — UP-5 (silent), UP-1, and UP-7. UP-5 is now first.
>
> Note also that our checkout was already behind theirs — we verified at v1.3.5, they are at
> **v1.4.3** (`00e7e953858`). They diffed `v1.3.5..HEAD` and all seven hold unchanged. The stamp is
> what made that checkable in one step.

---

## Report

This comes from **wabt-ts**, which uses binaryen-ts as its optimizer/encoder backend through a
bridge in `src/bridge/`. The bridge is a dev-only dependency — no published wabt-ts entrypoint
reaches it — so none of this is urgent for our users. It is a list of what the bridge cannot express
today, with repros.

Findings are ordered by measured severity. **Three produce wrong output — UP-5 silently, UP-1 and
UP-7 loudly — and the remaining four fail loudly or are simply absent.**

All three are `readBinary(b).emitBinary()` round-trip defects, reachable with no builder, no bridge
and no passes. **UP-5 is worst precisely because it is silent**: an engine catches UP-1 and UP-7,
whereas a dropped start function ships.

We got this count wrong twice. The first draft said "only UP-1 emits bad bytes". The second said
two. It is three — UP-7 was filed as a typed-ref *surface* gap, and the surface turned out to be
the smaller half of it.

### How these were found, which may be the most useful part

Almost all of them came from **measuring V8-validity of encoder output across the 257-file
WebAssembly spec testsuite**, not from unit tests. That method found the same class of bug in our
own encoder repeatedly — packed-type wire bytes, a NaN payload mask, multi-value truncation — each
of which was invisible to a passing test suite because the test asserted what the encoder did rather
than what an engine accepts.

We also learned to **put every cross-engine question to three engines** (V8, Wasmtime, Wasmer)
rather than one. V8 alone accepted things Wasmtime rejects; two engines agreeing tells you nothing
about _why_.

---

### UP-5 — a start function is silently DROPPED on round-trip — **wrong-output, silent**

**This is the most severe finding, and we ranked it sixth in the first draft.** It was filed as "no
`setStart`" — a bridge gap. It is not: the DECODER reads the start function's index and discards it.

```ts
// wasm-parser.ts, SECTION_START
this.r.readU32();
break; // start func index -- skip
```

There is no `setStart` on `ModuleBuilder`, no start field in the IR, and no section-8 emit. So
`readBinary(b).emitBinary()` produces **valid wasm that does something different**, with no
diagnostic anywhere.

**Measured 2026-08-24** — a module whose start function sets an exported global to 42, decoded and
re-encoded with binaryen-ts alone, then RUN:

```
INPUT      valid=true   start-section=true    global g = 42
ROUNDTRIP  valid=true   start-section=false   global g = 0
```

Valid in, valid out, behaviour changed, nothing reported. **No validity check ever written would
catch this** — which is exactly the class your WT-2f…WT-2k series is about, and the reason we think
the methodology note below is the useful part of this report.

We hit the identical shape on our own side (T9.1): our binary reader spliced leftover operand-stack
values in after every statement, so a `wasm2wat` round-trip silently reordered a program. Same
signature — valid, accepted, wrong.

**Repro:**

```ts
import { parseWasm } from '@jrmarcum/binaryen-ts/binary';
import { encodeWasm } from '@jrmarcum/binaryen-ts/encoder';
// input: (module (global $g (export "g") (mut i32) (i32.const 0))
//                (func $init (global.set $g (i32.const 42)))
//                (start $init))
const out = encodeWasm(parseWasm(input)); // start section gone; g reads 0
```

---

### UP-1 — `struct.get_u` / `array.get_u`: valid wasm round-trips INVALID — **wrong-output**

`wasm-encoder.ts` picks the sub-opcode with a boolean:

```ts
// struct.get, wasm-encoder.ts:1714
w.writeU32(e.signed ? 0x03 : 0x02);
// array.get, wasm-encoder.ts:1772
w.writeU32(e.signed ? 0x0c : 0x0b);
```

The spec has **three** sub-opcodes per family, not two:

|        | non-packed   | packed, sign-extend | packed, zero-extend |
| ------ | ------------ | ------------------- | ------------------- |
| struct | `get` `0x02` | `get_s` `0x03`      | `get_u` `0x04`      |
| array  | `get` `0x0b` | `get_s` `0x0c`      | `get_u` `0x0d`      |

So `get_u` is unreachable, and `signed=false` on a **packed** field emits the non-packed opcode —
which engines reject outright.

**Measured 2026-08-24** through binaryen-ts's own `ModuleBuilder` + `encodeWasm` (not a hand-built
binary). A `(struct (field (mut i8)))` holding 200, read three ways:

| sub-opcode                                                   | V8          | Wasmtime 47.0.3 | result                |
| ------------------------------------------------------------ | ----------- | --------------- | --------------------- |
| `0x04` `get_u` (spec-correct)                                | accepts     | accepts         | `200` (zero-extended) |
| `0x02` `get` — **what binaryen-ts emits for `signed=false`** | **REJECTS** | **REJECTS**     | —                     |
| `0x03` `get_s` — what it emits for `signed=true`             | accepts     | accepts         | `-56`                 |

Both engines name the fix:

- V8 — _"struct.get: Field 0 of type 0 has type i8. Use struct.get_s or struct.get_u instead."_
- Wasmtime — _"can only use struct `get` with non-packed storage types"_

`array.get` behaves identically: `0x0b` is rejected (_"array.get: Array type 0 has type i8. Use
array.get_s or array.get_u instead."_) and `0x0d` returns 200.

**It is also a bare round-trip corruption, which our first draft missed.** The DECODER does handle
`0x04` / `0x0d` (`wasm-parser.ts:1765`, `:1819`) but maps them to `signed=false`, collapsing them
with plain `get`. So valid input becomes invalid output with no builder and no passes involved —
measured:

```
INPUT      sub=0x04  ACCEPTS -> 200
ROUNDTRIP  sub=0x02  REJECTS -> struct.get: Field 0 of type 0 has type i8.
                                Use struct.get_s or struct.get_u instead.
```

**The fix is encoder-only, and complete.** Our first draft claimed "the root cause is in the IR, not
the encoder — an encoder-only patch cannot fix it". That was wrong, and your rebuttal is right:
`(typeIndex, fieldIndex)` → packedness is available at encode time via `this.mod.heapTypes`, and
given packedness `signed` is total —

- **non-packed** → `get` only; `signed` is meaningless
- **packed** → `get_s` / `get_u`, selected by `signed`

— so no three-state field, no IR change, no API change. The decoder needs no change either: `0x04` →
`signed=false` on a packed field re-encodes correctly as `0x04`.

**One caveat on that fix, from a rule we paid for.** With packedness driving the choice, an input
carrying `0x02` on a PACKED field — invalid wasm, and exactly what binaryen-ts emits today — decodes
to `signed=false` and re-encodes as `0x04` `get_u`: **valid**. That is an encoder repairing invalid
input.

We shipped that exact class and had to fix it (our T11: `wat2wasm` silently turned an invalid
element segment into a valid module, because five layers each collapsed a distinction the spec
draws). The clean split is for the DECODER to reject `0x02` on a packed field — it is invalid —
rather than have the encoder quietly correct it. Cheap to add alongside, and it keeps "an encoder
never repairs its input" true.

**Repro** — self-contained, uses only your public API:

```ts
import { encodeWasm } from '@jrmarcum/binaryen-ts/encoder';
import * as ir from '@jrmarcum/binaryen-ts/ir';
const { ModuleBuilder, ValType } = ir;

const m = new ModuleBuilder();
m.enableGC();
const t = m.addHeapType({ kind: 'struct', fields: [{ type: 'i8', mutable: true }] });
m.addHeapType({ kind: 'func', params: [], results: [ValType.I32] });
m.addFunction(
  'read',
  [],
  [ValType.I32],
  ir.makeStructGet(t, 0, ir.makeStructNew(t, [ir.makeI32Const(200)]), ValType.I32, false),
);
m.addExport('read', 'read');

const bytes = encodeWasm(m.build());
const buf = new ArrayBuffer(bytes.byteLength);
new Uint8Array(buf).set(bytes);
await WebAssembly.instantiate(buf, {}); // throws: use struct.get_s or struct.get_u
```

---

### UP-2 — `tuple.make`: enum entry, no factory, no encoder case — **gap**

`ExpressionKind.TupleMake = "tuple.make"` is in the enum, but there is no `makeTupleMake` factory
and **no `case` for it in the encoder**. Hand-building the node the factory would return and
encoding it gives:

```
WasmEncodeError: cannot encode unsupported expression kind: tuple.make
```

The failure is loud, which is right. But the construct is unreachable, and it blocks multi-value
`return` and multi-value `br` / `br_if` — our bridge throws rather than silently passing only the
first value.

### UP-3 — the four GC array bulk ops: same shape — **gap**

`ArrayFill`, `ArrayCopy`, `ArrayInitData` and `ArrayInitElem` are all in `ExpressionKind`
(`expressions.ts:119-122`) with **no factory and no encoder case**, exactly like UP-2. wabt-ts
implements all four; none can cross the bridge.

**Louder than we credited:** the binary parser also rejects all four explicitly
(`wasm-parser.ts:1889-1898`) with named diagnostics, so they fail on read as well as on write. That
is the right failure mode in both directions.

**Louder than we credited:** the binary parser also rejects all four explicitly
(`wasm-parser.ts:1889-1898`) with named diagnostics, so they fail on read as well as on write. That
is the right failure mode in both directions.

### UP-4 — `ref.as_non_null`: not even an enum entry — **gap**

No `makeRefAsNonNull`, no encoder case, and **no `ExpressionKind` entry** — unlike UP-2/UP-3,
nothing about the instruction is present.

### UP-6 — `WasmImport.kind` has no `"tag"` — **gap**

```ts
kind: 'function' | 'global' | 'table' | 'memory'; // WasmImport
kind: 'function' | 'global' | 'table' | 'memory' | 'tag'; // WasmExport
```

The asymmetry is the useful part: tag **exports** work now, and `addTag` defines one, so tag
**imports** are the only remaining hole in tag support.

### UP-7 — a typed-ref LOCAL collapses to `anyref` on read — **wrong-output**

**Corrected AGAIN, 2026-08-24, this time against us.** We filed UP-7 as a
typed-ref *surface* gap and called it "a much smaller ask than our old note implied — widening five
signatures". The surface is real but it is the smaller half. binaryen-ts found the other half while
trying to write a behavioural test for `array.fill`, and it is a **third wrong-bytes bug**:

```ts
// wasm-parser.ts
function readValTypeByte(r: BinaryReader): ValType {
  const t = readValueType(r);
  if (typeof t === "string") return t as ValType;
  // ref type in a legacy position -- map to nearest abstract ValType
  return ValType.AnyRef;
}
```

A local declared `(ref null $t)` reads back as `anyref`, so a bare `parseWasm → encodeWasm` turns
any GC module with typed-ref locals into invalid wasm. **Reproduced here** on a module whose local
holds a `(ref null $t)` array:

```
FIXTURE                                              -> 7
local decl (ref null 0) = 0x63 0x00 in input         : true
local decl anyref       = 0x6e      in roundtrip     : true
ROUNDTRIP  REJECTS: array.get[0] expected type (ref null 0),
                    found local.get of type anyref
```

Same class as UP-1 and UP-5, and pre-existing — untouched by the Tier 1/2 work.

So the honest count is **three of seven produce wrong bytes**, not one. Two of our three severity
calls on this report were wrong in the same direction: we under-rated defects filed as "surface" or
"gap" because we were looking at what the BRIDGE could not express, and the round-trip path was
never the thing we were measuring.

**This one we had recorded wrong, and the correction is in your favour.** Our older note said
"`ValType` cannot express a concrete typed reference — it is a flat string enum" and called it a
design limit. v1.3.5 has `RefType { heap: HeapType; nullable: boolean }` in `src/ir/gc-types.ts`,
the expression-level `Type` includes it, and `FuncTypeDef.params` / `.results` are already
`(ValType | RefType)[]`. The representational work is done.

What remains is that the **`ModuleBuilder` declaration surface** — the layer a bridge calls — is
still narrowed to `ValType`:

| method                                  | today       | needs                    |
| --------------------------------------- | ----------- | ------------------------ |
| `addFunction(name, params, results, …)` | `ValType[]` | `(ValType \| RefType)[]` |
| `addFunctionImport(…, params, results)` | `ValType[]` | same                     |
| `addGlobal(name, type, …)`              | `ValType`   | `ValType \| RefType`     |
| `addTable(name, type, …)`               | `ValType`   | same                     |
| `addTag(name, params)`                  | `ValType[]` | `(ValType \| RefType)[]` |

So `(ref $T)` can be expressed one layer down via `addHeapType` with a `FuncTypeDef`, but not
through the builder that declares the function. That is a much smaller ask than our old note
implied: widening five signatures to a union you already define.

**The ask is larger than five signatures, and you framed it better than we did.** Widening only the
builder pushes a `RefType` into fields still declared `ValType`: `WasmFunction.params` / `.results`
(`module.ts:54-56`), `Local.type` (`:41`), `WasmGlobal.type` (`:122`), `WasmTable.type` (`:166`),
`WasmTag.params` (`:181`) — and behind those, the binary parser's AnyRef-collapse shim and
`gcFuncTypeIndex`, whose own comment (`wasm-encoder.ts:1042-1053`) already names this as the blocker
and currently THROWS on ambiguous func types.

So the better argument for doing UP-7 properly is not "five signatures" but **it removes an existing
loud failure** — `unresolved GC function type` stops being reachable. We hit that error ourselves
while building the UP-1 repro, before we understood why.

This is also the last thing preventing a faithful round-trip through the bridge — wabt-ts now
carries typed refs precisely end to end, so the bridge's `coarsenValueType` is the only lossy step
left in the pipeline.

---

## Three notes we owe you, since our own records were wrong

**Already fixed upstream — we had these listed as gaps and they are not.** Corrected in our log
rather than reported:

| our stale note                                               | actual v1.3.5 state                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| no `addElement` factory                                      | **present** (`ir/module.ts:395`)                                                                                                      |
| `loadOpcode()` has no V128 branch, silently emits `i64.load` | **fixed** — `v128.load` has its own `0xfd 0x00` path, and `loadOpcode` now throws `WasmEncodeError` instead of falling through to i64 |
| `WasmExport.kind` has no `"tag"`                             | **present**                                                                                                                           |

The `loadOpcode` fix is worth calling out: its comment documents the exact silent-truncation bug it
replaced. That is the same class we spent this campaign hunting on our side, and fixing it by
**failing loudly** rather than guessing is the right call.

**A small usability observation, not a bug.** With GC enabled, a function's own type must be
declared as a heap type or `encodeWasm` throws `unresolved GC function type: () -> (i32)`. That is
correct behaviour and it fails loudly, but it surprised us — `addFunction` alone is enough without
GC and not enough with it. A line in `addHeapType`'s or `enableGC`'s doc comment would save the next
caller the same detour.

**Nothing here is blocking wabt-ts's published surface.** `wat2wasm`, `wasm2wat`, `wasm-validate`,
`wasm-objdump`, `wasm-strip` and `/compat` are pure wabt-ts; binaryen-ts is imported only under
`src/bridge/`, which has no `exports` subpath.

But **it is not purely a backlog either, and that is the correction we most needed.** UP-5 and UP-1
are round-trip defects in `readBinary(b).emitBinary()` — reachable by any consumer of the binary
pipeline, with no bridge, no builder and no passes involved. UP-5 in particular produces valid wasm
that behaves differently and says nothing.

Priority we would suggest, revised: **UP-5, then UP-1** (silent before loud), then UP-2/3/4/6 as
additive surface, with UP-7 as its own typed-ref threading project.

---

## What came back (2026-08-24)

All seven confirmed with exact line references, plus the three "already fixed" entries. Corrections
against us, each re-derived here before being accepted:

| | |
| --- | --- |
| **Provenance** | Our checkout is v1.3.5; theirs is **v1.4.3** (`00e7e953858`). They diffed `v1.3.5..HEAD` — asyncify/flatten plus a decoder fix, nothing touching these areas — and all seven hold. Also: our `^1.0.9` pin resolves to 1.4.3 today, so the pin is not what made our log stale. |
| **Correction 1** | UP-1 is a **round-trip corruption**, not merely "unencodable" — the decoder handles `0x04`/`0x0d` but collapses them onto `signed=false`. Reproduced here: `0x04` in, `0x02` out, engine rejects. |
| **Correction 2** | **UP-5 is the most severe finding and it is silent.** Reproduced here: start section present → absent, global 42 → 0, valid both ways, no diagnostic. Our headline framing was wrong and is rewritten. |
| **Correction 3** | UP-7's ask is larger than five signatures — backing fields, the parser shim and `gcFuncTypeIndex` sit behind it. Reframed: doing it properly removes an existing loud failure. |
| **Rebuttal accepted** | "The root cause is in the IR, not the encoder" overstated it. Option (2) is encoder-only and complete; we verified `this.mod.heapTypes` is reachable at the encode site and that the decoder needs no change. |
| **Note taken** | UP-3 is louder than we credited — the parser rejects all four explicitly too. |

One thing back, in the same spirit: **the T11 caveat on UP-1's fix** — see that section. Deriving the
sub-opcode from packedness will silently turn today's invalid `0x02`-on-packed output into valid
`0x04` on re-encode, which is an encoder repairing its input. We shipped that class and had to fix
it; rejecting it in the decoder keeps the property.

**On stamping.** Our checkout was stale and you caught it in one step, because the report carried
`b78e5b476` / v1.3.5. In the same week we sent a report to the wasmtk team with a claim derived from
an UN-stamped vendored corpus, and had to retract it — seven modules described as currently broken
that had been fixed. Same failure mode, opposite outcome, and the only difference was whether the
snapshot said what it was.

---

## Fix status (2026-08-24) — reported by binaryen-ts, NOT yet recheckable here

Their Tier 1 and Tier 2 work is **local and unpushed**: `origin/main` is at
`00e7e9538` / v1.4.3, and neither `dd88e034bd0` nor `f664ba579a0` exists on any
ref. So the entries below are their report, not our verification — recheck is
queued.

| tier | commit | scope | tests |
| --- | --- | --- | --- |
| 1 | `dd88e034bd0` | **UP-1**, **UP-5**, + 2 fold-ins | 405 → 424 |
| 2 | `f664ba579a0` | **UP-6**, **UP-4**, **UP-3** | 430 → 438 |
| 3 | — | **UP-7**, **UP-2** | pending |

Verified here at v1.4.3 in the meantime: UP-1 and UP-5 still reproduce exactly
(baseline unchanged by the v1.3.5 → v1.4.3 bump), and UP-7's new half
reproduces as above.

**Four of their findings are worth keeping regardless of this report:**

1. **Enabling test type-checking caught a scrambled fixture** —
   `addTable("a", 1, null, ValType.FuncRef)` against a `(name, type, initial,
   max)` signature. It passed because the test asserted only the "multiple
   tables" throw, which fires regardless of the arguments. A test that asserts
   a throw can be arbitrarily wrong about everything else and stay green.
2. **The tag index space needed three sites to agree, not one.** `parse()` was
   rebuilding every tag as `$tag${i}`, silently discarding the offset the
   tag-section reader had just computed — their `$import${n}` failure (WT-2b)
   reproduced in the tag space. Caught by their first test run: the throw
   retargeted to the imported tag.
3. **Omitting one of `_mapChildren` / `_visitChildren` makes a node invisible
   to every pass instead of erroring.** Silent, and exactly the failure mode
   this report keeps circling.
4. **`array.copy`'s dest/src immediate order gets its own test**, because
   swapping them is invisible when both types match.

(1) and (3) are the same shape as things we hit on our side, and (3) is worth
stealing outright.