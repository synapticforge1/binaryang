# Divergences — validation, engines and facades; the numeric IDs; the spec overlaps

DESIGN rows for what the validator and the facades accept or refuse (V1–V4, EF1, RC1, CL12, CL15, CL16), the register of numeric IDs that differ from an authority, and what overlaps the specification.
Last verified 2026-11-20. The register, its classes and the checklist are in [divergences.md](divergences.md).

## DESIGN rows

- **id:** V1
  - vs: wabt
  - what differs: a typed `select` (`0x1c`) with NO types: upstream `wasm-validate` 1.0.41 passes
    it, we refuse it ("invalid arity in select instruction: 0."). Still read, printed and written
    back byte for byte (`FidelityEntry.selectTyped`)
  - class: DESIGN
  - status / authority: 2026-10-09, owner: "refuse … if it will not run on all platforms" —
    wasm-tools, wasmtime, wasmer, WasmEdge, V8 and JavaScriptCore all refuse it;
    `accepts_what_v8_refuses.test.ts`
- **id:** V2
  - vs: wabt
  - what differs: an IMPORTED global's or table's value type naming a type that does not exist (`(import … (global (mut (ref 0))))`, no types): upstream passes it, we refuse it
  - class: DESIGN
  - status / authority: same decision, same six engines refuse; same test
- **id:** V3
  - vs: V8, wasmer
  - what differs: an element segment typed `0x7f` (i32's code, not a reference type), empty: V8 and wasmer load it, we refuse it as malformed
  - class: DESIGN
  - status / authority: same decision: wabt, wasm-tools, wasmtime, WasmEdge and JavaScriptCore refuse it; on `main` before too
- **id:** V4
  - vs: V8, wasmer
  - what differs: `br_on_cast_fail` whose fall-through value the block needs NON-null, the operand
    already non-null (`(param (ref $t))` … `(br_on_cast_fail 1 (ref null any) (ref null $t) …)` in a
    `(block (result (ref $t)))`): V8 and wasmer refine the fall-through by the operand, we type it
    `rt2` as the GC spec does, and refuse
  - class: DESIGN
  - status / authority: same decision: wabt, wasm-tools (which tracks the proposals), wasmtime,
    WasmEdge and JavaScriptCore refuse it; the custom-descriptors mutant that raised it,
    [hardening.md](hardening.md) § "Code lens, pass 1"
- **id:** EF1
  - vs: wasm-tools
  - what differs: an element segment written in the EXPRESSION form with the explicit type `(ref
    func)` and only `ref.func` entries (binary flags 5–7, or text `(elem … (ref func) (ref.func
    $f))`) validates here with function references OFF; wasm-tools refuses it (the explicit typed
    reference needs the proposal). The IR does not record which form the bytes used: such a segment
    is the one the writer encodes as the funcidx form (Wasm 1.0), and the validator reads it so
  - class: DESIGN (a known gap)
  - status / authority: open-work 41, 2026-10-24: the price of accepting every funcidx segment under
    the default features, which every real module with a function table needs; recording the form in
    the IR would close it. `src/ir/elem-form.ts`
- **id:** RC1
  - vs: binaryen, wabt
  - what differs: `return_call_ref` with tail-call OFF: Binaryen 133 refuses it (it needs tail-call
    and GC, having folded function references into GC); binaryang ACCEPTS it, needing
    functionReferences only, as wabt 1.0.41, wasm-tools 1.262 and wasmtime 50 do. Until 2026-10-24
    binaryang refused it too ("tail call not allowed", inherited from wabt-ts), where wabt accepts
  - class: DESIGN (the Binaryen half); the wabt half was a DEFECT, fixed
  - status / authority: open-work 40 (wasmrt's item 4, contract v33): the function-references
    proposal defines the instruction; D1 1.0.1 says `functionReferences`. definitions.md § "D2's
    dependency and preset rules"; `tests/wabt-ts/validator/return_call_ref_gate.test.ts`
- **id:** CL12
  - vs: wabt
  - what differs: ⚖️ **NOT changed — an owner ruling stands in the way** (2026-10-28): D2's
    `requires` is "RECORDED, NOT ENFORCED (owner, 2026-10-24): nothing turns a feature on or off
    with another … as wasmtime 50 and wasm-tools 1.262 do"; enforcing wabt's coupling would reverse
    it. Reclassify as DESIGN if the owner confirms — `wasm-validate --disable-bulk-memory` still
    accepts reference types (`(func (param externref))`, two tables); upstream turns reference types
    off with bulk memory and refuses (`expected valid param type (got -0x11)`). D2 records the
    "requires" relation; the flags do not apply it
  - class: DESIGN
  - status / authority: found 2026-10-28, code lens pass 2, as a DEFECT. **Reclassified DESIGN
    2026-11-05** (owner, confirming the 2026-10-24 ruling: "on CL12 I agree with your
    recommendation"): each feature flag governs its own feature only, as wasmtime and wasm-tools;
    wabt's coupling is a recorded difference, not a defect. No code change. Closed for open-work 50
- **id:** CL15
  - vs: wabt
  - what differs: `wasm-interp --argument`: upstream 1.0.41 takes only the typed form (`f32:8`) and
    refuses a bare value; ours takes both. A typed value whose type is not the parameter's (`f32:8`
    for an i32): upstream passes the bits through (`i32:1090519040`), ours refuses
  - class: FEATURE (bare values) + DESIGN (a mismatch refused: the S2 contract, no guessing)
  - status / authority: 2026-10-28, code lens pass 3 (open-work 53, `interp_arguments.test.ts`). Upstream's `nan:0x1` typed-form reading gives 0 there; ours `nan:0x1`
- **id:** CL16
  - vs: wabt.js
  - what differs: the wabt facade's `toText` defaults: `foldExprs` and `inlineExport` default TRUE
    here, false in libwabt.js (`wabt.post.js`); `readWasm`'s `readDebugNames` defaults true here,
    false there
  - class: DESIGN — three owner rulings: names, [names.md](names.md) "The rule being implemented
    (owner, 2026-09-10)": "**wabt-ts ALWAYS keeps names** … No opt-out"; inline exports,
    [wabt-ts.md](wabt-ts.md) "[decision] Inline exports default ON (upstream `wat-writer.h` defaults
    off)"; folding, [ir-convergence.md](ir-convergence.md) "Owner decision, 2026-09-19 — prefer the
    more ACCURATELY FOLDED form". Taking libwabt.js's `false` defaults for the facade would REVERSE
    those rulings, so it is the owner's call, not a fix
  - status / authority: recorded 2026-10-28, code lens pass 3 (citations corrected the same day: it
    first cited names.md § 4, which decides nothing). Since `1add56c72` `foldExprs` is honoured both
    ways, as the S7 rule "NAMING a form forces it everywhere"
    ([ir-convergence.md](ir-convergence.md)): `false` writes linear, and an explicit `true` now
    FORCES folding where it printed the as-written mix — wasmtk passes neither. Beside it, also
    DESIGN and recorded before: `toBinary`'s `write_debug_names` is ignored, the name section always
    written (N1; [wabt-ts.md](wabt-ts.md) "By design: `write_debug_names` is ignored")

## Numeric IDs — the register (owner, 2026-10-28)

**The rule** (owner, 2026-10-28): "make notations for differences in IDs from here on out. it will
be very important when we start making changes to meet wasm specification documents." Every
difference between a numeric identifier binaryang uses and one an authority uses — a library's
type IDs or feature bits, an opcode, a kind, a section id, any enum value that crosses a boundary —
gets a row here, ours and theirs (or old → new), with the authority, the date and how it was
measured. **Why a register of its own:** `api-surface.json` hashes a `const x: number`'s TYPE,
not its value, so a constant that changes value passes the compatibility gate unseen (it did:
`89a2fcef3`). **The precedent** is the owner's opcode question: D1's opcode set was re-derived from
the specification documents and every one of the 582 attested ([definitions.md](definitions.md)
§ "D1 against the specification", 2026-10-23) — the spec, not a port, is the authority.

**Changed, 2026-10-28** — the binaryen facade (`./compat/binaryen`) mirrored to binaryen.js
132, read from the real package (`comparison/node_modules/binaryen`); commit `a1618195c`
(open-work 52 (a), divergence CL17):

| ID | before | now = binaryen.js 132 | note |
| --- | --- | --- | --- |
| `funcref` | 7 | 18 | |
| `externref` | 8 | 10 | |
| `anyref` | 9 | 34 | |
| `eqref` | 10 | 42 | |
| `i31ref` | 11 | 50 | |
| `structref` | 12 | 58 | |
| `arrayref` | 13 | 66 | |
| `stringref` | 14 | 82 | |
| `nullref` | (reported as `anyref`) | 90 | new export |
| `nullexternref` | (reported as `externref`) | 98 | new export |
| `nullfuncref` | (reported as `funcref`) | 106 | new export |
| `exnref` | (reported as `externref`) | 74 | internal: binaryen.js reports it, exports no constant |
| `nullexnref` | (reported as `externref`) | 122 | internal, likewise |
| `auto` | 15 | −1 | |
| `none` … `v128` | 0 … 6 | 0 … 6 | already equal |
| `Features.MutableGlobals` | 4 | 2 | |
| `Features.NontrappingFPToInt` | 8 | 4 | |
| `Features.SIMD128` | 32 | 8 | |
| `Features.BulkMemory` | 2 | 16 | |
| `Features.SignExt` | 16 | 32 | |
| `Features.StackSwitching` … `RelaxedAtomics` | absent | 65536 … 134217728 | ten flags added (bits 16–20, 22, 23, 25–27) |
| `Features.All` | 0x7fffffff | 268435455 | |
| a new `Module`'s features | `All` | `MVP` (0) | as `getFeatures()` upstream |
| the other Features flags, `ExpressionId`s, `External*` kinds | — | equal | measured the same day |

**Measured equal, not changed** (where the IDs come from): opcodes are the wire bytes, every one
attested against the spec (D1); the IR's `ValType` codes ARE the binary encoding bytes (`i32` 127
= `0x7f`, so `v128.const`'s node shows 123 = `0x7b`); `ExternalKind` 0–4 and `BinarySection` ids
are the binary format's. **Open:** the wabt.js facade's numeric values have not been measured
against libwabt.js; do it before the spec work relies on them.

### Overlaps with the specification — what must match it (owner, 2026-10-28)

The owner, the same day: "If there are any other overlapping items, that should match the spec
also, lets note those also." Every place a definition of binaryang's overlaps one the
specification documents make, with WHAT IT FOLLOWS TODAY and whether that was MEASURED against
the spec text. Only rows marked **spec-attested** were compared with the documents themselves; the
rest match an upstream tool, an engine or the testsuite — evidence, not the authority. A change
made to meet the spec gets its row updated, and a numeric one a row in the table above.

- **overlap:** opcodes: byte, prefix, mnemonic (D1, 582)
  - follows today: the spec
  - against the spec documents: **spec-attested** 2026-10-23 ([definitions.md](definitions.md) § "D1 against the specification"): 499 core + 83 from four proposals' Overviews and legacy EH
- **overlap:** D1's `immediates` (order), `align` (natural alignment), `signature`
  - follows today: the port; proved by decode / re-encode, our validator and V8 (`opcodes.test.ts`)
  - against the spec documents: NOT measured against the spec's binary and validation rules
- **overlap:** binary codes: value and heap types (`0x7f` …), section ids, external kinds, rec / sub prefixes (`0x4e`, `0x50`, `0x4f`), limits flags, memarg flag bits (bit 6 = memory index)
  - follows today: the binary format, by construction (the IR's codes ARE the bytes)
  - against the spec documents: NOT attested row by row against the spec's binary grammar
- **overlap:** feature NAMES and CLI spellings (D2 `name`, `cli`)
  - follows today: `cli`: upstream wabt / wasm-tools spellings (FL1, owner 2026-10-24); `name`: binaryang's `Features` keys
  - against the spec documents: the proposals' own names NOT compared; a rename is a compatibility decision
- **overlap:** D2 "requires" (one feature built on another)
  - follows today: RECORDED, NOT ENFORCED (owner, 2026-10-24) — as wasmtime and wasm-tools; CL12 is that ruling
  - against the spec documents: the proposals' prose; not a spec rule to enforce
- **overlap:** trap messages (D3, 19 classes + exhaustion)
  - follows today: the spec TESTSUITE's `assert_trap` texts (21 messages, prefix rule)
  - against the spec documents: testsuite-bound; the testsuite is the spec's own
- **overlap:** validation messages
  - follows today: upstream wabt's words (DG7, owner 2026-10-28)
  - against the spec documents: the testsuite's `assert_invalid` texts are NOT matched — a known, decided difference
- **overlap:** text format: keywords, abbreviations, string characters, required parts
  - follows today: the spec's text grammar, fixed where measured: a table's linear initializer, empty `(rec)`, control characters in strings, a required segment offset (all 2026-10-28)
  - against the spec documents: NOT attested as a whole against the text grammar
- **overlap:** custom sections: `name` and its subsection ids (0 module, 1 function, 2 local; the extended-name ids), `metadata.code.branch_hint`
  - follows today: upstream wabt's and binaryen's
  - against the spec documents: the spec appendix (name section) and the branch-hinting proposal NOT compared
- **overlap:** numerics: float rounding, NaN propagation, `nearest`, `trunc_sat`, integer edge cases
  - follows today: bit-exact with V8 on every case the interpreter investigator tried (pass 3); f32 integer literals rounded once (F4)
  - against the spec documents: the spec's numerics chapter NOT attested
- **overlap:** implementation limits: pages, table elements, nesting, locals
  - follows today: the engines' (V8's 2^48-page memory etc., classified in pass 1)
  - against the spec documents: the spec appendix's implementation-limits section NOT compared
- **overlap:** library facades' constants (binaryen.js, libwabt.js)
  - follows today: the libraries (the register above)
  - against the spec documents: not the spec's — a library is the authority there
