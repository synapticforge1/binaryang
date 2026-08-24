# Ready-to-send report for the binaryen-ts team — seven findings from wabt-ts

Written 2026-08-24 from the wabt-ts side, at the end of its conformance
campaign. Every finding was **re-verified against the actual checkout**
(`b78e5b476`, v1.3.5, clean on `main`) on the day of writing, and every
severity was **measured, not inherited** — three entries in our own log turned
out to be stale and were corrected before this was written.

We did not modify the binaryen-ts checkout. Paste from the horizontal rule down.

---

## Report

This comes from **wabt-ts**, which uses binaryen-ts as its optimizer/encoder
backend through a bridge in `src/bridge/`. The bridge is a dev-only dependency —
no published wabt-ts entrypoint reaches it — so none of this is urgent for our
users. It is a list of what the bridge cannot express today, with repros.

Findings are ordered by measured severity. **UP-1 is the only one that emits
bad bytes; the rest fail loudly or are simply absent**, which is the right
failure mode and worth saying explicitly.

### How these were found, which may be the most useful part

Almost all of them came from **measuring V8-validity of encoder output across
the 257-file WebAssembly spec testsuite**, not from unit tests. That method
found the same class of bug in our own encoder repeatedly — packed-type wire
bytes, a NaN payload mask, multi-value truncation — each of which was invisible
to a passing test suite because the test asserted what the encoder did rather
than what an engine accepts.

We also learned to **put every cross-engine question to three engines**
(V8, Wasmtime, Wasmer) rather than one. V8 alone accepted things Wasmtime
rejects; two engines agreeing tells you nothing about *why*.

---

### UP-1 — `struct.get_u` / `array.get_u` are unencodable — **blocking**

`wasm-encoder.ts` picks the sub-opcode with a boolean:

```ts
// struct.get, line ~1692
w.writeU32(e.signed ? 0x03 : 0x02);
// array.get, line ~1750
w.writeU32(e.signed ? 0x0c : 0x0b);
```

The spec has **three** sub-opcodes per family, not two:

| | non-packed | packed, sign-extend | packed, zero-extend |
| --- | --- | --- | --- |
| struct | `get` `0x02` | `get_s` `0x03` | `get_u` `0x04` |
| array | `get` `0x0b` | `get_s` `0x0c` | `get_u` `0x0d` |

So `get_u` is unreachable, and `signed=false` on a **packed** field emits the
non-packed opcode — which engines reject outright.

**Measured 2026-08-24** through binaryen-ts's own `ModuleBuilder` +
`encodeWasm` (not a hand-built binary). A `(struct (field (mut i8)))` holding
200, read three ways:

| sub-opcode | V8 | Wasmtime 47.0.3 | result |
| --- | --- | --- | --- |
| `0x04` `get_u` (spec-correct) | accepts | accepts | `200` (zero-extended) |
| `0x02` `get` — **what binaryen-ts emits for `signed=false`** | **REJECTS** | **REJECTS** | — |
| `0x03` `get_s` — what it emits for `signed=true` | accepts | accepts | `-56` |

Both engines name the fix:

- V8 — *"struct.get: Field 0 of type 0 has type i8. Use struct.get_s or
  struct.get_u instead."*
- Wasmtime — *"can only use struct `get` with non-packed storage types"*

`array.get` behaves identically: `0x0b` is rejected (*"array.get: Array type 0
has type i8. Use array.get_s or array.get_u instead."*) and `0x0d` returns 200.

**The root cause is in the IR, not the encoder.** `StructGetExpr.signed` and
`ArrayGetExpr.signed` are `boolean` — two states for a three-way choice. An
encoder-only patch cannot fix it. Two options:

1. Make the field three-state (e.g. `signed?: boolean` where `undefined` means
   the non-packed `get`), or
2. Derive packedness from the field's declared `StorageType` at encode time —
   the encoder already has `typeIndex` and `fieldIndex`, so it can look the
   field up and pick `0x02` only when the storage type is not `i8`/`i16`.

(2) makes the existing `signed: boolean` correct as written and needs no API
change, which is why we'd suggest it first.

**Repro** — self-contained, uses only your public API:

```ts
import { encodeWasm } from "@jrmarcum/binaryen-ts/encoder";
import * as ir from "@jrmarcum/binaryen-ts/ir";
const { ModuleBuilder, ValType } = ir;

const m = new ModuleBuilder();
m.enableGC();
const t = m.addHeapType({ kind: "struct", fields: [{ type: "i8", mutable: true }] });
m.addHeapType({ kind: "func", params: [], results: [ValType.I32] });
m.addFunction("read", [], [ValType.I32],
  ir.makeStructGet(t, 0, ir.makeStructNew(t, [ir.makeI32Const(200)]), ValType.I32, false));
m.addExport("read", "read");

const bytes = encodeWasm(m.build());
const buf = new ArrayBuffer(bytes.byteLength);
new Uint8Array(buf).set(bytes);
await WebAssembly.instantiate(buf, {});   // throws: use struct.get_s or struct.get_u
```

---

### UP-2 — `tuple.make`: enum entry, no factory, no encoder case — **gap**

`ExpressionKind.TupleMake = "tuple.make"` is in the enum, but there is no
`makeTupleMake` factory and **no `case` for it in the encoder**. Hand-building
the node the factory would return and encoding it gives:

```
WasmEncodeError: cannot encode unsupported expression kind: tuple.make
```

The failure is loud, which is right. But the construct is unreachable, and it
blocks multi-value `return` and multi-value `br` / `br_if` — our bridge throws
rather than silently passing only the first value.

### UP-3 — the four GC array bulk ops: same shape — **gap**

`ArrayFill`, `ArrayCopy`, `ArrayInitData` and `ArrayInitElem` are all in
`ExpressionKind` with **no factory and no encoder case**, exactly like UP-2.
wabt-ts implements all four; none can cross the bridge.

### UP-4 — `ref.as_non_null`: not even an enum entry — **gap**

No `makeRefAsNonNull`, no encoder case, and **no `ExpressionKind` entry** —
unlike UP-2/UP-3, nothing about the instruction is present.

### UP-5 — no `setStart`, and no start section at all — **gap**

`ModuleBuilder` has no `setStart`, and there is no start-section field in the
IR or emit path in the encoder. A module with a start function cannot be
bridged.

### UP-6 — `WasmImport.kind` has no `"tag"` — **gap**

```ts
kind: "function" | "global" | "table" | "memory";   // WasmImport
kind: "function" | "global" | "table" | "memory" | "tag";   // WasmExport
```

The asymmetry is the useful part: tag **exports** work now, and `addTag`
defines one, so tag **imports** are the only remaining hole in tag support.

### UP-7 — typed refs stop at the `ModuleBuilder` surface — **gap**

**This one we had recorded wrong, and the correction is in your favour.** Our
older note said "`ValType` cannot express a concrete typed reference — it is a
flat string enum" and called it a design limit. v1.3.5 has
`RefType { heap: HeapType; nullable: boolean }` in `src/ir/gc-types.ts`, the
expression-level `Type` includes it, and `FuncTypeDef.params` / `.results` are
already `(ValType | RefType)[]`. The representational work is done.

What remains is that the **`ModuleBuilder` declaration surface** — the layer a
bridge calls — is still narrowed to `ValType`:

| method | today | needs |
| --- | --- | --- |
| `addFunction(name, params, results, …)` | `ValType[]` | `(ValType \| RefType)[]` |
| `addFunctionImport(…, params, results)` | `ValType[]` | same |
| `addGlobal(name, type, …)` | `ValType` | `ValType \| RefType` |
| `addTable(name, type, …)` | `ValType` | same |
| `addTag(name, params)` | `ValType[]` | `(ValType \| RefType)[]` |

So `(ref $T)` can be expressed one layer down via `addHeapType` with a
`FuncTypeDef`, but not through the builder that declares the function. That is
a much smaller ask than our old note implied: widening five signatures to a
union you already define.

This is also the last thing preventing a faithful round-trip through the
bridge — wabt-ts now carries typed refs precisely end to end, so the bridge's
`coarsenValueType` is the only lossy step left in the pipeline.

---

## Three notes we owe you, since our own records were wrong

**Already fixed upstream — we had these listed as gaps and they are not.**
Corrected in our log rather than reported:

| our stale note | actual v1.3.5 state |
| --- | --- |
| no `addElement` factory | **present** (`ir/module.ts:395`) |
| `loadOpcode()` has no V128 branch, silently emits `i64.load` | **fixed** — `v128.load` has its own `0xfd 0x00` path, and `loadOpcode` now throws `WasmEncodeError` instead of falling through to i64 |
| `WasmExport.kind` has no `"tag"` | **present** |

The `loadOpcode` fix is worth calling out: its comment documents the exact
silent-truncation bug it replaced. That is the same class we spent this
campaign hunting on our side, and fixing it by **failing loudly** rather than
guessing is the right call.

**A small usability observation, not a bug.** With GC enabled, a function's own
type must be declared as a heap type or `encodeWasm` throws
`unresolved GC function type: () -> (i32)`. That is correct behaviour and it
fails loudly, but it surprised us — `addFunction` alone is enough without GC
and not enough with it. A line in `addHeapType`'s or `enableGC`'s doc comment
would save the next caller the same detour.

**Nothing here is blocking wabt-ts's published surface.** `wat2wasm`,
`wasm2wat`, `wasm-validate`, `wasm-objdump`, `wasm-strip` and `/compat` are
pure wabt-ts; binaryen-ts is imported only under `src/bridge/`, which has no
`exports` subpath. So please treat this as a backlog, not an incident. UP-1 is
the one we would prioritise, because it is the only one that produces bytes an
engine rejects rather than an error the caller can see.
