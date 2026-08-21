<!--
  Relocated from the repo root (TASKS.md) into cmem/ on 2026-06-09 so all
  project memory lives in one committed, portable place. This is the GRANULAR
  implementation status / decision log; cmem/phases.md is the distilled
  summary. See cmem/INDEX.md for the policy.
-->

# TASKS.md — wabt-ts Progress & Decisions

This file tracks implementation status, open questions, and architectural decisions.
All project context authoritative source: `CLAUDE.md`.

## Tranche ledger — numbering, including items found after the original scope

The original T1–T6 scope was derived by clustering **parse** failures. Anything
that parses and then misencodes was invisible to it (see the blind-spot entry
below), so a second family — T7 — was opened for semantic correctness, and
several parse-side items surfaced that no original tranche covered. Those get
`T5.n` / `T6.n` where they belong to an existing feature area, and `T8.n`
where they are genuinely new.

**Numbering rule:** a decimal extends an existing tranche's feature area; a new
integer opens a new area. Never renumber a closed item — the commit messages
reference these ids.

### Closed

| id | Scope | Result |
| --- | --- | --- |
| T1 | Numeric literals (negative hex, hex-float exponent, NaN payload separators) | done — +25 files |
| T2 | Small grammar gaps + GC array bulk ops | done — +34 files |
| T3 | Multi-memory | done — +35 files |
| T4 | table64 / memory64 index types + table definition shapes | done — +16 files |
| T6.1 | Block params / multi-value block results | done (absorbed during T7) |
| T6.2 | Elem segment typed-ref element types | done (absorbed during T4) |
| T6.3 | Table inline-elem forms | done (absorbed during T4) |
| T7.1 | Parser robustness — never throw, never hang, readable diagnostics | done |
| T7.2 | Packed-type wire bytes; `br_table` / `try_table` name resolution | done |
| T7.3 | Quoted identifiers, UTF-8 strings, type-use signatures, block types | done — +3 parse, +5 encode |
| T7.4 | Typed-ref IR refactor (`ValueType`) | done — encode +13 |
| T7.5 | Multi-value branches (`br` / `br_if` / `br_table`) | done — encode +14 |
| T7.6 | `try_table` catch target depth | done — encode +2 |
| T5 | GC `(rec …)` recursive type groups and `(sub …)` subtyping | done — parse +7, encode +5 |
| T5.1 | `any.convert_extern` / `extern.convert_any` | done — parse +1, encode +1 |
| T8.3 | WAT writer emitted multi-instruction const exprs as one folded paren | done (found via T5.1) |
| T7.7 | Relaxed SIMD aliased onto low SIMD opcodes (opcode packing too narrow) | done — encode +7 |
| T6.4 | `(module definition …)` / `(module instance …)` | done — parse +5, encode +5 |
| T5.2 | Abbreviated heap-type immediate (`ref.cast i31ref`) | done — parse +3, encode +3 |
| T8.1 | Block type-use + inline signature | done |
| T8.2 | `select` with several result groups | done |
| T8.4 | Tag declared with a type-use | done (new) |
| T8.5 | Folded `if` condition spanning several instructions | done (new) |
| T6.5 | `(@annotation …)` custom annotations | done — parse +1, encode +1 |
| T5.3 | `br_on_cast` / `br_on_cast_fail` — never implemented | done — parse +2 (257/257), encode +2 |
| T9.1 | Binary reader had no `pushStmt` — silent reordering | done — round-trip INVALID 60 → 27 |
| T7.8 | Type-uses that resolve against an incomplete type index space | done — encode +6 |
| T7.11 | Element segments against a non-nullable table | done — encode +2 |
| T7.12 | `br_on_null` / `br_on_non_null` carrying branch values | done — encode +2 |
| T7.13 | UTF-8 BOM stripped from names | done — encode +1 |
| T7.14 | Explicit type-use overwritten by a structural signature match | done — encode +1 |
| T9.2 | Our validator rejecting modules V8 accepts | done — agreement 1702 → 2120/2120 |
| T9.3 | Validator on `ValueType`; real reference subtyping | done — assert_invalid caught 1806 → 1834 |
| T9.4 | The 10 valid modules T9.3's lattice rejected | done — agreement back to 2120/2120 |
| T9.5 | Modules the spec says are invalid that we validated clean | done — assert_invalid 2395 → 2532/2737 |
| T9.6 | Module-level structural checks that did not exist | done — assert_invalid 2532 → 2579/2737 |
| T9.7 | Declared subtyping, ref.eq, select, defaultability, type scope | done — assert_invalid 2579 → 2629/2737 |
| T11 | The pipeline rewrote an INVALID module into a valid one | done — assert_invalid 2629 → 2632/2737 |

### Open — parse side: NONE

All 257 spec-testsuite files now parse clean. The parse metric is exhausted;
everything remaining is on the encode side (T7.x), measured against V8.

| id | Scope | Files |
| --- | --- | --- |
| ~~T6.5~~ | ~~`(@annotation …)` custom annotations~~ | closed |
| ~~T5.3~~ | ~~`br_on_cast` / `br_on_cast_fail`~~ | closed |
| ~~T8.3~~ | ~~multi-instruction constant expressions in the WAT writer~~ | closed |

### Open — encode side: NONE

**All 257 spec-testsuite files encode to wasm V8 accepts — 2120/2120 modules.**
Both original metrics are exhausted:

| metric | campaign start | now |
| --- | --- | --- |
| parse-clean | 107 / 257 | **257 / 257** |
| fully V8-valid | 180 / 257 | **257 / 257** |

Everything remaining is round-trip fidelity (T10) plus the two T9 items.

### A third metric — round-trip fidelity

The campaign's two metrics (parse-clean, V8-validity) both measure the ENCODE
path. T9.1 was invisible to both: a reordered module is still perfectly valid
wasm. The decode path needs its own number — for each testsuite module we can
encode, `binary -> wasm2wat -> wat2wasm`, then compare bytes AND re-validate.

|  | before T9.1 | after T9.1 | after T7.8-T7.14 |
| --- | --- | --- | --- |
| byte-identical | 1942 / 2105 | 1954 / 2105 | **1960 / 2120** |
| V8-INVALID after round-trip | 60 | 27 | **27** |
| files affected | 76 | 70 | **71** |

The denominator grew because modules that could not encode at all are now in
the population.

**The byte-identity number badly understated T9.1.** The metric that matters
is the second row: 33 modules went from producing INVALID wasm to producing
valid wasm, zero regressions (set-diffed by module, not counted). Always
re-validate a round-trip, don't just diff it — "the bytes moved" and "the
output is broken" are different findings and the first hides the second.

### T10 — the remaining round-trip differences, by cause

Re-measured after T7.14: **160 differing modules**, same seven groups. The
counts below are from the original survey; the shape has not changed.

Classified by evidence (differing binary SECTION + V8 rejection message +
sampled diffs), not by guessing. Some of these may fall out of the remaining
T7 work; re-measure before starting any of them.

| id | Cause | Modules / files | Severity |
| --- | --- | --- | --- |
| **T10.1** | **Export ORDER is not preserved.** The WAT writer attaches exports inline to the item they name, so re-parsing rebuilds the export section grouped per item instead of in the original order — `a, b, ac, …` comes back as `a, za, b, zb, …`. Still valid, but export order is observable (`WebAssembly.Module.exports()`). Fix: emit standalone `(export "n" (func $f))` fields in original order, or carry the order. | 69 / 21 | valid, wrong order |
| **T10.2** | **The WAT writer emits an inline `(export …)` on IMPORTED items**, e.g. `(import "M" "f" (func $f0 (export "Mf.call") (result i32)))`. That abbreviation is only legal on definitions, so **our own parser rejects our own output** — this is the whole "reparse FAILS" group (`expected ), got (` on funcs, `expected value type, got (` on globals, `expected limit initial value` on memories/tables). Same root as T10.1; one fix likely closes both. | 11 / 6 | UNPARSEABLE |
| **T10.3** | **A non-nullable table element type loses its initializer.** `wasm2wat` prints `(table $T0 1 (ref func))` and drops `Table.init`. The binary form `0x40 0x00 <reftype> <limits> <init>` is REQUIRED when the element type is non-nullable — there is no default value — so the re-encode emits the plain form and V8 rejects it. **Scoped during T7.11:** the binary reader already captures `init`; the blocker is the WAT WRITER. The table grammar wants ONE FOLDED instruction there (`parseOneInstr`), and the writer is linear-only by design — wrapping its linear output in parens reparses as a folded expression with a bogus operand. Needs a folded emitter for constant expressions. A `NOTE (T10.3)` marker sits at the drop site in `wat-writer.ts`. Now covers the 4 elem/array modules T7.11 made encodable. | 10 / 4 | INVALID |
| **T10.4** | **NaN payloads are mangled.** `f32.const` bits `0x7fffffff` come back as `0x7fbfffff` — the quiet bit is lost, turning a quiet NaN into a signalling one. Valid wasm, different value. Sampled in const / float_literals / float_memory / float_memory64; instance.wast and try_table.wast are in the same bucket but unsampled and may differ. | 11 / 6 | valid, wrong value |
| **T10.5** | **Inert Nop-operand artifacts.** The reader cannot attribute every value to an operand slot — a multi-value block result is one value on its stack, not N — so the consumer decodes with `Nop` operands and the re-encode carries extra `nop`s. Harmless at runtime (see the T9.1 note on why), but the encoding grows and never converges. | 39 / 33 | valid, larger |
| **T10.6** | **Nop operands that are NOT inert.** The same substitution applied to an instruction that genuinely needs its operand on the stack: V8 says "not enough arguments on the stack for br_on_null (need 1, got 0)", "expected 1 elements on the stack for fallthru", "array.new_fixed[0] expected type f32, found local.get of type i32". Produces INVALID wasm. Highest severity of what remains. Files: array, br_on_cast, br_on_cast_fail, br_on_non_null, br_on_null, throw_ref, +1. | 9 / 7 | INVALID |
| **T10.7** | Two hard failures. `align64.wast#25` throws `RangeError: LEB128 u32 overflow`. `try_table.wast#4` throws `binary writer: no (type (func (param [object Object]))) in the type section` — a `ValueType` object stringified into a type-lookup key, i.e. one site the T7.4 typed-ref refactor did not reach. | 2 / 2 | THROWS |

Recommended order when the time comes: T10.6 and T10.3 first (both produce
invalid wasm), then T10.2 (our output is unparseable by us), then T10.7,
T10.4, T10.1, and T10.5 last.

### A fourth metric — validator agreement

`wat2wasm` does not run the validator, so nothing in the campaign exercised it
and two whole classes of bug hid there: rules that were never feature-gated,
and opcode-table keys left stale by T7.7. The metric is simple — for every
testsuite module V8 accepts, does `wasmValidate` agree? **2120/2120.**

**T9.3 (done)** moved the validator onto `ValueType`, so reference subtyping
is real: defined-type `(sub …)` chains walked transitively, structural type
identity via canonical keys (rec-group-relative, so groups shaped alike key
alike), and producers reporting their true type (`ref.cast` the cast-to type,
`ref.func` the function's own `(ref $T)`, `ref.as_non_null` /
`br_on_non_null` dropping nullability).

**Measure BOTH directions.** Agreement only counts false rejections; it says
nothing about what a permissive validator waves through. Adding the
`assert_invalid` direction changed the verdict on T9.3 from "regression" to
"worth it":

|  | before T9.3 | after |
| --- | --- | --- |
| modules V8 accepts that we accept | 2120 / 2120 | 2110 / 2120 |
| `assert_invalid` modules we reject | 1806 / 2737 | **1834 / 2737** |

**CORRECTION (T9.5).** Both `assert_invalid` figures above are wrong. The
harness asked `hasErrors(result.errors)`, but the validator signals failure
through `result`, and `dropTypes` returned `Result.Error` without recording a
message — so every stack underflow read as "accepted". Measured on `result`
the same two points are **2395** and **2423**: the absolute numbers were off by
~590, the **+28 delta was exactly right**. Measure the field the code sets.

**T9.4 then closed the 10** — without widening the lattice, which is the thing
T9.3 existed to stop doing. Every one of them turned out to be a SECOND bug the
coarse lattice had been hiding: `array.new_elem` still reporting the bare
`Type.Ref` placeholder (5 modules), `br_on_null` skipping its result push in
unreachable code and so changing the stack height (1), the canonical key
rendering a same-rec-group supertype by index instead of by position (2), and
`br_on_cast_fail` passing `rt1` through where the branch carries `rt1 \ rt2` —
a nullable `rt2` absorbs the null case, so the difference is NON-nullable (2).

Final: **2120/2120 agreement AND 1834/2737 assert_invalid** — 28 more real
errors caught, zero false rejections.

| id | Scope | Files |
| --- | --- | --- |
| ~~T9.5~~ | **DONE.** The "903" was a measurement artefact (see the correction above); the real figure was 314. Fixing the silent report alone accounted for the difference. Three real gaps then fell out: `checkSignature` peeked without an ARITY check (`peekType` answers the `Type.Any` wildcard below the frame base, and `br` only peeks — so `(block (result i32) (br 0))` validated) **+102**; a 32-bit memory's page limit is 65536, not 2^32-1; and a memarg `offset` must fit the memory's index type, newly reachable because T9.2 widened the reader to u64. **2395 → 2532 / 2737**, agreement unmoved at 2120/2120. Regression test `tests/validator/rejects_invalid.test.ts`. | — |
| ~~T9.6~~ | **DONE.** Of the 205, **74 are also accepted by V8** — those spec tests predate proposals that legalised what they assert against — leaving 131 genuinely ours. Six categories closed: SIMD-memory ALIGNMENT (the validator kept its own partial natural-align table with no SIMD entries, so the check silently did nothing — `core/opcode.ts` already owns the canonical one and CLAUDE.md says not to duplicate it); LANE INDICES for `i8x16.shuffle` and `load*_lane` / `store*_lane`; IMMUTABILITY of struct fields and array elements; UNKNOWN type indices in value types; FINAL supertypes (an absent `(sub …)` is implicitly final); and CONSTANT EXPRESSIONS (only the const family, ref forms, `global.get`, extended-const arithmetic and GC allocations). **2532 → 2579 / 2737**, agreement unmoved at 2120/2120. Regression test `tests/validator/structural_checks.test.ts`. | — |
| ~~T9.7~~ | **DONE.** Declared `(sub …)` relationships are now checked STRUCTURALLY, not just for finality — kind match, struct fields kept in order and appendable, mutable fields exact / immutable narrowable, func params contravariant and results covariant (**+17**, the whole category). Plus: `ref.eq` operands must be eq-hierarchy (`anyref` is a SUPERTYPE of `eqref`, so it does not qualify); a bare `select` is numeric/vector-only AND both operands must be the same type; a non-defaultable table element type needs an initializer; `array.copy`'s source element must be assignable to the destination's; and a type's scope bound is "everything before it plus the rest of its own rec group", not the section size — which closed the cross-group forward reference T9.6 had left as a documented failing case. **2579 → 2629 / 2737**, agreement unmoved at 2120/2120. Regression test `tests/validator/subtype_decl.test.ts`. | — |
| **T9.8** | The 32 still ours: type mismatch 27 (try_table catch-clause label types 5, br_on_cast 6, elem/table element typing 6, array_init_elem 2, unreached-invalid 2, and a tail), uninitialized local 4 (needs local-init tracking for non-defaultable locals), plus 3 singles. | — |

### T11 — the pipeline rewrote an INVALID module into a valid one (DONE)

Raised as "we should not be creating invalid modules", and on review the
framing in the T9.6 note was wrong twice over. The funcidx encoding is not
lossy for the case I first flagged — but the parser, reader, both writers and
the validator ALL conflated two segments the spec keeps distinct:

| spelling | element type |
| --- | --- |
| `(elem (i32.const 0) $g)` / `… func $g` | **`(ref func)`**, non-nullable — every entry is a function index |
| `(elem (i32.const 0) funcref (ref.func $g))` | `funcref`, nullable |

elem.wast has the first as VALID and the second as INVALID against the same
`(ref func)` table. Five sites, each hiding the next:

1. **parser** recorded `funcref` for the funcidx elemlist;
2. **binary reader** decoded flags 0-3 as `funcref` — and after a first pass at
   the fix, flags 4 as `(ref func)`. The two forms imply DIFFERENT types and
   one default cannot serve both;
3. **binary writer** used the funcidx encoding for any all-`ref.func` segment
   (T7.11), widening an explicit `funcref` declaration;
4. **WAT writer** gated the `func $a $b` shorthand on the NULLABLE `funcref` —
   backwards, since that spelling MEANS `(ref func)` — so the declaration was
   lost in the text too, and fixing only the binary side dropped round-trip
   fidelity 1961 → 1779 before this was found;
5. **validator** never compared a segment's element type to its table's.

Net effect and the reason it earns its own item: `wat2wasm` silently REPAIRED
the invalid module. A tool that quietly turns invalid input into valid output
is worse than one that rejects it.

A T7.11 test asserted the repaired behaviour was correct; it is now inverted.
T7.11's fix had been too broad. Regression test
`tests/writer/elem_type_fidelity.test.ts`.

### Open — T9: found during the campaign, invisible to both metrics

Neither the parse metric nor the V8-validity metric exercises these, so they
survived the whole campaign unnoticed. Both are real; neither blocks a
testsuite file.

| id | Scope | Found |
| --- | --- | --- |
| ~~T9.1~~ | **DONE.** The binary READER had no `pushStmt` equivalent. `endFrame` splices leftover operand-stack values in AFTER every statement (`[...stmts, ...stack]`), so any decoded expression that produces a value nobody consumes is re-emitted at the END of its block — past the statements that followed it in the original. This is the same defect the parser fixed in v1.3.0, on the other side of the round-trip. Confirmed to change program semantics, silently: `(block (result i32) (global.get $g) (global.set $g (i32.const 9)))` returns 1, and 9 after a `wasm2wat` round-trip. Fixed by a module-level `pushStmt(stack, stmts, expr)` that drains pending values first, wired into all 42 statement-commit sites. Round-trip fidelity over the testsuite: 1942 -> 1954 of 2105 modules byte-identical, 76 -> 70 files affected, zero regressions. Regression test `tests/reader/stmt_order.test.ts`. | T5.3 |
| ~~T9.2~~ | **DONE.** Measured properly (run `wasmValidate` over every spec-testsuite module V8 accepts; any disagreement is our bug) this was SEVEN bugs across 418/2120 modules, not one: MVP restrictions with no feature gate (218), every SIMD opcode-table key still on the pre-T7.7 `<< 8` packing and therefore DEAD (77), segment offsets checked as i32 regardless of index type (56), table ops hard-coding i32 (39), the reference lattice as originally logged (~30), MVP's imported-global-only rule for constant expressions (7), and the memarg offset read as u32 when memory64 makes it u64 (1). Agreement 1702 → **2120/2120**. Regression test `tests/validator/agreement.test.ts`. | T5.3 |

### Why the numbering changed shape

T5.1 / T5.2 sit under T5 because they are GC-proposal surface, the same area.
T6.4 / T6.5 were in the original T6 list and just had no id. T8 is new: block
type-use and the `select` annotation are core-spec syntax, not part of any
proposal area the original scope named — they were missed because the files
carrying them failed earlier for other reasons, so their first error never
mentioned them.


---

## LIVING LOG — binaryen-ts findings, to file upstream when the tranches close

**This is a running record, not a snapshot.** Every time work on this side
hits a binaryen-ts limitation, add it to "Open findings" below with an
`UP-n` id, the tranche that surfaced it, and — importantly — a *measured*
severity. When the T-series repair tranches finish, this section becomes the
upstream report.

### Working rules for this log

1. **Measure severity, never inherit it.** The first entry (`UP-1`) was
   originally described from CLAUDE.md as "functionally invisible under V8";
   probing V8 directly showed it produces modules V8 **rejects**. Every entry
   states how its severity was established.
2. **Re-verify against the actual checkout before filing.** CLAUDE.md says the
   submodule is pinned at `6c6f81f66` (v1.0.9); the working checkout is
   **v1.3.5** (`b78e5b476`), and three previously-listed gaps are already
   fixed there. Stale entries are worse than no entries.
3. **Record the root cause, not just the symptom** — several of these are IR
   shape limits that an encoder patch would not fix.
4. **Do not modify the binaryen-ts checkout.** It stays clean on `main`; this
   side only reads it. Fixes are the binaryen-ts team's to make.

### Severity scale

| Level | Meaning |
| --- | --- |
| **blocking** | Emits bytes V8 rejects, or cannot emit the construct at all |
| **wrong-output** | Emits bytes V8 accepts that mean something other than intended |
| **gap** | Construct unsupported; fails loudly or is simply absent |
| **design-limit** | Works as designed, but the design cannot express what we need |

### Already fixed upstream — do NOT file; correct our notes instead

| Our older note said | Actual state in v1.3.5 |
| --- | --- |
| no `addElement` factory | **present** (`ir/module.ts`) |
| `loadOpcode()` has no V128 branch, silently emits `i64.load` | **fixed** — throws `WasmEncodeError`; its fix comment documents that exact silent-truncation bug |
| `WasmExport.kind` has no `"tag"` | **present** (`ir/module.ts`) |

### Open findings

| id | Finding | Severity | Surfaced by |
| --- | --- | --- | --- |
| UP-1 | `struct.get_u` / `array.get_u` unencodable; emits `0x02`/`0x0b`, which V8 rejects on a packed field | **blocking** | GC tiers / T7 review |
| UP-2 | No `makeTupleMake` (enum value exists, factory does not) | **gap** | multi-value branches |
| UP-3 | No GC array bulk constructors (`makeArrayFill`, `makeArrayCopy`, `array.init_data` / `init_elem`) | **gap** | tranche 2 |
| UP-4 | No `makeRefAsNonNull` | **gap** | Tier C |
| UP-5 | No `setStart` | **gap** | Tier D |
| UP-6 | No `addTagImport` (tag *exports* now work) | **gap** | Tier C |
| UP-7 | `ValType` cannot express a concrete typed reference | **design-limit** | typed-ref refactor |

Details for each follow.


#### UP-1 — `struct.get_u` / `array.get_u` unencodable (blocking)

The bytes produced instead are REJECTED by V8.
`wasm-encoder.ts` selects the opcode with `e.signed ? 0x03 : 0x02`, so the
unsigned form 0x04 is never emitted. Same shape for `array.get_u` (0x0d vs
`array.get` 0x0b). The root cause is in the IR, not just the encoder:
`StructGetExpr.signed` is a `boolean`, so it has only two states and cannot
distinguish the THREE spec opcodes — `struct.get` 0x02 (non-packed),
`get_s` 0x03 (packed, sign-extend), `get_u` 0x04 (packed, zero-extend). A fix
needs a three-state field (or to derive packedness from the field type), not
just an encoder tweak.

**Severity — measured, 2026-08-21, not inherited.** An earlier note in
CLAUDE.md called this "functionally invisible under V8, which recovers
signedness from the packed field type". **That is wrong.** Probing V8 directly
with a `(struct (field (mut i8)))` read three ways:

| sub-opcode | V8 | result |
| --- | --- | --- |
| `0x04` `get_u` (spec-correct) | accepts | `200` (zero-extended) |
| `0x02` `get` — what binaryen-ts emits | **REJECTS** | "struct.get: Field … is packed" |
| `0x03` `get_s` | accepts | `-56` (sign-extended) |

So this is not a cosmetic wire divergence: any consumer reading a PACKED field
unsigned through binaryen-ts gets a module V8 refuses to compile. That raises
it from "worth reporting" to "blocking for packed GC fields".

#### UP-2 — No `makeTupleMake` (gap)

`ExpressionKind.TupleMake` exists in the enum but
has no constructor. Blocks multi-value `return` AND — new since our
multi-value branch work — multi-value `br` / `br_if`. Our bridge throws
"needs makeTupleMake" rather than passing only the first value.

#### UP-3 — No GC array bulk constructors (gap)

`makeArrayFill`, `makeArrayCopy`, and
(by inspection) the `array.init_data` / `array.init_elem` equivalents are
absent, so the four instructions we implemented in tranche 2 have no bridge
path at all.

#### UP-4 — No `makeRefAsNonNull` (gap)

`ref.as_non_null` is still unbridgeable.

#### UP-5 — No `setStart` (gap)

Start functions cannot be bridged.

#### UP-6 — No `addTagImport` (gap)

Tag imports cannot be bridged (tag *exports* now
work, see the fixed table above).

#### UP-7 — `ValType` cannot express a concrete typed reference (design-limit)

It is a flat
string enum, so `(ref $T)` / `(ref null $T)` have no representation. After our
typed-ref IR refactor wabt-ts carries these precisely and the bridge is now
the only lossy step — it coarsens through `coarsenValueType`. Not a bug on
their side so much as a design limit, but worth raising since it is the last
thing preventing a faithful round-trip through the bridge.

### Framing for the report

Several of these were found by measuring **V8 validity** of encoder output
across the 257-file WebAssembly spec testsuite rather than by unit tests —
that method is worth mentioning to them, since it is what surfaced the
silent-wrong-bytes class in our own encoder too (packed-type wire bytes,
NaN payload mask, multi-value truncation).

### Append new findings here

When a tranche hits a binaryen-ts limitation, add a row to **Open findings**
and a `#### UP-n` block below, following the working rules above: measured
severity, root cause, and the tranche that surfaced it. If a tranche completes
without hitting one, note that too — an empty pass is evidence the remaining
gaps are narrowing.

- *Legacy EH / `try_table` catch depth (V8-valid 214 → 216): **no new
  binaryen-ts finding**. The bug was ours — catch targets were resolved with
  the try_table's own label pushed, one too deep.*
- *T5 (`rec` / `sub`, parse 233 → 240, V8-valid 216 → 221): **no new
  binaryen-ts finding**. Worth noting the bridge has no rec/sub concept at
  all, but nothing in it was newly blocked.*
- *T5.1 + T8.3 (parse 240 → 241, V8-valid 221 → 222): **no new binaryen-ts
  finding.** The bridge has no case for either conversion instruction, but
  nothing previously working broke — it simply has no path, same as the other
  GC gaps already filed as UP-3.*
- *T7.7 (relaxed SIMD, V8-valid 222 → 229): **no new binaryen-ts finding.**
  The bug was ours — the `(prefix << 8) | sub` opcode packing could not hold a
  sub-opcode >= 0x100.*
- *T6.4 + T5.2 (parse 241 → 249, V8-valid 229 → 237): **no new binaryen-ts
  finding.** `module definition` / `instance` are script-level constructs the
  bridge never sees.*
- *T8.1/8.2/8.4/8.5 (parse 249 → 254, V8-valid 237 → 242): **no new
  binaryen-ts finding** — all four were parser abbreviation forms.*
- *T6.5 (annotations, parse 254 → 255, V8-valid 242 → 243): **no new
  binaryen-ts finding.** Annotations are skipped in the lexer and never reach
  the IR, so the bridge cannot see them.*
- *T5.3 (br_on_cast, parse 255 → 257, V8-valid 243 → 245): **no new
  binaryen-ts finding**, but note the bridge has no `br_on_cast` case — same
  GC gap already filed as UP-3, now with two more instructions behind it.*
- *T7 remaining clusters (stack residue, tail-call types, singles): in
  progress.*

---



**Current published version:** `@jrmarcum/wabt-ts@1.3.1` on JSR.
Versioning follows the sub-version-capped-at-9 rule (1.0.9 → 1.1.0 →
… → 1.2.4 → 1.2.5 → 1.2.6 → 1.2.7 → 1.2.8 → 1.2.9 → 1.3.0; major uncapped). Latest meaningful
landings: f64/f32 const integer-literal encoding (v1.1.0); multi-value
`return`, `memarg.align` natural defaults, full SIMD opcode-name table
regen from upstream `opcode.def` (v1.1.1); repo hygiene + submodule
removal + fork detach (v1.1.2); SIMD `replace_lane` second operand +
try_table `(catch ...)` clauses + bare-offset elem segments + legacy
`(try (do ...))` + validator SIMD opcode-info entries + wasmtk WAT
corpus integration (v1.1.3); nested `(call ...)` operand order fix
(v1.1.4); v1.1.5 was a no-op version bump that shipped without the
local Bug D / Tier D changes; Phase 7 Tier D bridge expansion (memory
+ table exports, data segments) plus Bug D fix (empty-folded ops
consume preceding stack values) plus SimdShuffleOp/SimdStoreLane arity
correction (v1.1.6); Bug F fix (Bug D pad clamped to available stack —
fixes `br_if` / `br` with a single folded f64 cond mis-resolving
non-first globals; v1.1.7); v1.1.8 is a no-op version bump;
parseV128Literal — full WAT `v128.const i8x16/i16x8/i32x4/i64x2/f32x4/
f64x2 …` literal support — plus Phase 7 GC Tier 1 (`ref.eq` /
`ref.i31` / `i31.get_s` / `i31.get_u` + 8 abstract heap types in the
Type enum; latent reader bug fixed where ref.eq was building
CompareExpr instead of RefEqExpr) (v1.1.9); Bug G fix
(`call_indirect (type $name)` now resolves named types correctly —
resolveNames was resolving `table` but skipping `typeVar`, so every
named type collapsed to index 0; critical for wasic's higher-order
array methods) (v1.2.0); `/compat` subpath export — thin facade
mirroring `npm:wabt`'s async-factory API so consumers can migrate
with a one-line import-map flip (v1.2.1); v1.2.2 was a doc-only
update; GC Tier 2 — `struct.new` / `struct.new_default` / `struct.get`
/ `struct.get_s` / `struct.get_u` / `struct.set` instructions plus
`(type $name (struct (field …) …))` WAT type-section syntax with
packed `i8` / `i16` fields and `(mut type)` mutability qualifier;
parseValueType now accepts `(ref $T)` / `(ref null $T)` (coarsens
to `Type.StructRef` placeholder — typed-ref IR refactor pending)
(v1.2.3); GC Tier 3 — 9 `array.*` instructions plus
`(type $name (array (mut? T)))` type-section round-trip (v1.2.4);
GC Tier 4 — `ref.test` / `ref.cast` with `(ref [null] H)` heap-type
immediates including abstract keywords (`any` / `eq` / `i31` / etc.)
and user-defined type indices (v1.2.5); v1.2.6 was a doc-only update
(README + repo-history cleanup); JSR doc-quality sweep — `@module`
headers added to all 6 tool entrypoints (was 1/7), every exported
symbol surfaced through `src/index.ts` documented (265 / 265, was
51%); README "Runtime compatibility" section documenting that the
library API uses only Web platform APIs and works on Deno / Bun /
Node 18+ / Browser unmodified (v1.2.7); CI fmt-check + lint fix
(`deno fmt` across the tree + removed unused `Result` import from
`src/api/wabt-compat.ts` that was leftover from an early draft;
all 5 CI steps now green: fmt-check, lint, type-check, test,
publish:dry) (v1.2.8); legacy EH `(try (do …) (catch $tag …)
(catch_all …)? (delegate …)?)` now parses to a real `TryExpr` with
full try/catch/catch_all/delegate/end dispatch instead of being
coerced to a `BlockExpr` (the coercion dropped the dispatch edges and
produced binaries V8 rejected with "not enough arguments on the stack
for local.set"); plus a latent WAT-writer double-emit of catch handler
bodies fixed, and `rethrow` depth + catch-tag resolution added to
`resolveNames` (v1.2.9 — reported against 1.2.8 via wasmtk Phase 15
exception suite); statement-ordering fix — a value-producing instruction
at statement position (most importantly a void `call`, which the parser
can't distinguish from a value-returning call without the callee's
signature) was pushed to the operand stack and only committed to the
statement list by the enclosing block's end-of-body `flushStack`, which
appends AFTER every genuine statement; so a folded
`(call $f) … (return X)` sank the call past the `return` into dead code
and its side effect never ran. New `pushStmt` helper drains the operand
stack into `stmts` before committing each statement, preserving source
order; routed all 10 statement-position push sites through it. Also
removed 5 dead private methods surfaced by a reference-count sweep
(`expectLpar` / `parseInlineExports` in wast-parser, `readU64Leb` +
orphaned `decodeU64Leb128` import in binary-reader, `openNewline` /
`writeRefKind` in wat-writer) (v1.3.0 — reported via wasmtk's shared-heap
stdlib track; the call-sinking shape silently dropped any
`sideEffectingCall(); return X;` pattern); hex-float literal fix —
`parseF32LiteralBits` / `parseF64LiteralBits` handled
`LiteralType.Hexfloat` with JavaScript's `parseFloat()`, which cannot
parse WAT hex-float notation (`0x1.921fb54442d18p+2`): `parseFloat`
reads the leading `0`, stops at `x`, and returns `0`. So **every**
hex-float constant — all of wasmtk's merged `mathlib` polynomial
coefficients, π, e, ln2, etc. — was silently encoded as `0`, making the
merged Math.* functions return garbage (and trapping the f64→string
helper's `i64.trunc_f64_s` on the resulting NaN/Inf). The fix adds an
explicit `parseHexFloatValue` reconstructor (sign · integer-hex ·
fraction-hex · binary-exponent → double; exact for normal numbers) and
routes the `Hexfloat` case (both f32 and f64) through it; the decimal
`Float` case still uses `parseFloat`. (v1.3.1 — reported via wasmtk's
Phase 38 mathlib suite; `parseHexFloat` already existed and was correct
in `core/literal.ts`, but `parseF*LiteralBits` in the parser never
called it.)

**Integration milestone (2026-05-28):** wasmtk's Phase 1 test suite
passes 38/38 against `@jrmarcum/wabt-ts@1.1.8`. The wasmtk-driven
hardening loop (real module shape → wabt-ts bug surfaced → root-cause
fix + regression test) has converged for Phase 1. Future wasmtk
phases will re-open it; the loop is the design, not a transitional
phase.

**Migration milestone (v1.2.1):** `/compat` ships at
`jsr:@jrmarcum/wabt-ts@^1.2.1/compat`, mirroring the upstream
`npm:wabt` (libwabt.js) public API shape. Consumers add an import-map
entry and existing `import wabt from "wabt"` code compiles unchanged.
The wasmtk migration path documented in wasmtk's VISION.md § Stage
0.5 is unblocked. Mirrors the precedent set by `binaryen-ts/compat`
(binaryen-ts v1.2.2).

**GC milestone (v1.1.9 → v1.2.5):** All four planned GC tiers ship:
Tier 1 (i31 + ref.eq + 8 abstract heap types, v1.1.9), Tier 2
(`struct.*` + type-section struct heap types, v1.2.3), Tier 3
(`array.*`, v1.2.4), Tier 4 (ref.test / ref.cast with heap-type immediates,
v1.2.5). ~25 new instructions plus heap-type infrastructure across
parser / IR / reader / writer / validator / bridge. Caveat — wabt-ts's
flat `Type[]` representation for params/results/locals can't carry
heap-type indices, so `(ref $T)` / `(ref null $T)` syntactic forms
parse but coarsen to `Type.StructRef` in the binary output. V8
round-trip is blocked when typed-ref params appear; tier 2–4 tests
verify binary encoding (type-section bytes, opcode bytes, immediate
resolution) rather than runtime instantiation. The proper fix —
`FuncSignature.params: ValueType[]` carrying concrete heap-type
metadata — is the next significant Phase 7 piece. `br_on_cast` /
`br_on_cast_fail` deferred (opcodes wired but no IR/parser/bridge
yet); upstream binaryen-ts gaps unchanged.

**JSR doc-quality milestone (v1.2.7+):** All 7 package entrypoints
(`src/index.ts`, `src/tools/wat2wasm.ts`, `wasm2wat.ts`,
`wasm-validate.ts`, `wasm-objdump.ts`, `wasm-strip.ts`, `wasm2ts.ts`,
`src/api/wabt-compat.ts`) carry `@module` JSDoc headers describing
purpose + usage example + pipeline. Every exported symbol surfaced
through `src/index.ts` is documented — 265 / 265 (was 142 / 265 =
53.6% before the sweep). JSR's package-quality score reads complete
on both "module docs in all entrypoints" and "docs for most symbols"
axes. New exports must come with at least a one-line JSDoc to keep
the score at 100%; `deno doc --json src/index.ts` enumerates the
surface if you ever want to re-audit. Two JSR-score items remain
that can't be set in code — "compatible runtime" tags are set on
the JSR package settings page (web UI); mark Deno / Bun / Node /
Browser there.

**CI hardening (v1.2.8):** `.github/workflows/ci.yml` runs
`deno fmt --check`, `deno lint`, `deno task check`, `deno task test`,
and `deno publish --dry-run` on every push and PR to `main`.
v1.2.7's doc sweep had landed without running `deno fmt`, so CI
broke on the format-check step. Fixed in v1.2.8 by running
`deno fmt` across the tree + removing one unused `Result` import
from `src/api/wabt-compat.ts`. Lesson: run `deno task ci` locally
before pushing — `ci` is wired in `deno.json` and runs check + test
back-to-back; `deno fmt --check && deno lint && deno task ci &&
deno publish --dry-run` is the full local equivalent.

---

## 2026-08-21 — Multi-value branches (V8-valid 200 → 214)

The largest remaining T7 cluster, `expected N elements on the stack`, was two
separate defects in the branch IR.

1. **`br` and `br_if` truncated their carried values to the first.**
   `BrExpr.value?: Expr` / `BrIfExpr.value?: Expr` held ONE operand, so a
   branch to a label with N results emitted a single value and V8 rejected the
   function. Exactly the defect `ReturnExpr.values: Expr[]` had already fixed
   for `return`; both are now `values: Expr[]` in stack order. Failing shape
   straight out of func.wast:
   `(func (result i32 f64) (br 0 (i32.const 79) (f64.const 8)))`.

2. **`br_table` took the WRONG operand as its index.** The index is the TOP
   operand and carried values sit below it, but the node used `op0()` — so the
   FOLDED form `(br_table $a $b (i32.const 7) (local.get 0))` put the carried
   value in the index slot and dropped the real index. The LINEAR form
   happened to work, which is why the v1.3.4 br_table test passed and this
   stayed hidden. Now the last operand is the index and the rest go to a new
   `values` array.

The v1.3.4 operand-order invariants had to survive this change and do:
`br_if`'s cond is still read from the END of the operand list, and a padded
Nop still collapses to "no carried value" (a Nop produces nothing, so it can
never be a real branch value). `tests/parser/branch_value.test.ts` passes
untouched.

Reader: `br` / `br_if` now pop `brTargetResultCount` values and restore stack
order instead of popping one. `br_table` keeps carried values as preceding
statements, matching how the binary stream orders them.

Bridge: binaryen-ts has no `makeTupleMake` in v1.0.9, so a branch carrying
several values has no representation there. New `bridgeBranchValue` throws a
clear "needs makeTupleMake" rather than silently passing only the first —
which is the bug this change fixed.

Measured **fully V8-valid 200 → 214**; modules ok 1904 → 1919, rejected
40 → 25. The stack-arity cluster went from 14 files to 4.

Regression: `tests/parser/multi_value_branch.test.ts` — every case executes in
V8 and checks the actual returned tuple, plus the folded/linear br_table split
and the v1.3.4 invariants.

**Two probe mistakes worth remembering.** Both of my first `br_if` test cases
were invalid WAT, not parser bugs: `br_if` leaves its values on the stack when
NOT taken, so nothing may follow it inside a block whose result those values
are. Check the WAT before blaming the parser.

### Remaining (25 modules / ~18 files)

| Cluster | Files |
| --- | --- |
| `expected N elements on the stack` (residue) | 4 |
| relaxed SIMD `reached end while decoding` | 4 |
| legacy EH `catch kind generates …` | 3 |
| `i8x16.splat expected i32` | 2 |
| misc singles | 5 |

---

## 2026-08-21 — Typed-ref IR refactor DONE (V8-valid 187 → 200)

The deferred refactor CLAUDE.md had carried since v1.2.3. `(ref $T)` /
`(ref null $T)` now survive as concrete types instead of coarsening to
structref.

### The shape

`FuncSignature { params: Type[] }` could not carry a heap-type index next to a
`Ref` / `RefNull` code — the `Type` enum's values ARE single wire bytes, but a
typed reference encodes as the `0x64` / `0x63` marker FOLLOWED BY a heap type.
So the parser stored `Type.StructRef` as a placeholder and the writer emitted
a structref byte. Anything using a typed ref in a signature, local, global,
table, or element type parsed and encoded fine and was then rejected by V8 —
**invisible to the parse-clean metric, which is why it was never in a tranche.**

```ts
export interface RefValueType { kind: 'ref'; heapType: Var; nullable: boolean }
export type ValueType = Type | RefValueType;
```

Widened: `FuncSignature.params` / `.results`, `LocalDecl.type`, `Global.type`,
`Table.elemType`, `ElemSegment.elemType`, `Field.type`, `SelectExpr.resultType`.

### Precision where it matters, coarsening only where the target is flat

- **Encoders are precise.** New `writeValueType` emits the two-part encoding;
  `readValType` decodes it. **`readRefType` had to change too** — it read a
  single byte, so a typed table element type left the heap type in the stream
  and shifted every following field (`(table $x 1 (ref null $t))` came back as
  `(table 0 ref null)`).
- **`resolveNames` walks every value-type slot** via a new
  `resolveModuleValueTypes`, so a `$T` heap type reaches the writer resolved.
  Without it the writer's fail-loud guard fired on the first `$T` — the guard
  doing its job again.
- **The validator's type-checker and the binaryen bridge coarsen** through
  `coarsenValueType`, applied at their boundaries (a handful of methods) rather
  than at ~20 call sites. Their surfaces are genuinely flat: binaryen-ts's
  `ValType` has no typed-ref case, and the type-checker compares by identity.
  Encoders must NEVER coarsen — that was the bug.
- **`(ref null func)` still collapses to the one-byte `funcref`**, since the
  abstract nullable form IS funcref. Keeping it concrete would emit two bytes
  where one is correct. `typeKey` in synthesize-types distinguishes concrete
  refs so two different `(ref $T)` signatures don't dedupe onto one entry.

### Sizing, in hindsight

The scope said 80 `.params`/`.results` call sites and predicted the validator
would be the deep end. The call-site count was right but the difficulty was
not: because `Type` is assignable INTO `ValueType`, the compiler stayed silent
until the *read* sites were reached, and several were hidden behind
`writeU8(t as number)` casts that silenced it further. **Widening one function
signature at a time and re-running `deno task check` was the productive loop**
— the error count walked down 49 → 43 → 31 → 16 → 14 → 12 → 8 → 5 → 1 → 0.

### Result

Spec testsuite **fully V8-valid 187 → 200**; modules ok 1886 → 1904, rejected
58 → 40. The entire typed-ref cluster is gone: `expected structref, got
(ref $t)`, `call_ref expected (ref null …)`, `local.set expected structref`,
`array.new expected structref`, the `fallthru` mismatches.

The GC array-bulk module from tranche 2 — encoding-only-verified at the time
because `(ref $arr)` coarsened — now runs in V8 and returns 42. Its test moved
from byte assertions to execution.

Regression: `tests/ir/typed_refs.test.ts`. Also removed a duplicated
`typeName` switch found in `wasm-objdump.ts` while wiring the display helper.

### Remaining (V8-rejected, 40 modules / ~28 files)

| Cluster | Files |
| --- | --- |
| `expected N elements on the stack` | 14 |
| relaxed SIMD `reached end while decoding` | 4 |
| `not enough arguments on the stack` | 3 |
| `catch kind generates …` (legacy EH) | 3 |
| `i8x16.splat expected i32` | 2 |
| misc singles | 6 |

---

## 2026-08-21 — T7 batch 2 (V8-valid 182 → 187, parse-clean 230 → 233)

Answering "is the 1 remaining write-failure covered by a tranche?" — **no**,
and chasing it found two silent-corruption bugs that no tranche covered either.
Tranches were derived from parse failures; none of this is visible there.

1. **Quoted identifiers were a different name from their bare spelling.**
   `id ::= '$' idchar+ | '$' '"' string '"'` — the quoted form is an alternate
   spelling of the SAME identifier, escapes resolved, so `$"fh"` denotes
   exactly `$fh`. The lexer returned the raw source slice including the
   quotes, so the two never matched. New `varTokenText` normalizes at every
   identifier read site (`parseVar`, `parseBindVarOpt`, params, locals, heap
   type vars).

2. **Raw non-ASCII characters in WAT strings were truncated to one byte.**
   `decodeStringToken` did `bytes.push(ch)` with a UTF-16 code unit, so `é`
   (U+00E9) emitted `e9` instead of UTF-8 `c3 a9`, and U+F61A emitted `1a`
   instead of `ef 98 9a`. WAT strings are BYTE strings and the source is
   UTF-8, so a raw character contributes its UTF-8 encoding. This corrupted
   data segments and import/export names — and produced a VALID module with
   the wrong bytes in it, the worst failure mode of the lot. Escaped
   spellings (`\ef\98\9a`, `\u{f61a}`) were always correct, which is why an
   isolated round-trip test would have passed: the test has to compare the
   spellings against EACH OTHER, not against themselves.

3. **`(func $f (type $t) …)` with no inline signature got an EMPTY one.**
   The whole signature comes from `$t`. Without it the emitted type was
   `() -> ()` while the body pushed a value → "expected 0 elements on the
   stack". It must be resolved BEFORE the body parses, because local slot
   numbering starts at `sig.params.length`; a forward-referenced type still
   falls back to `synthesizeTypes`. This was the bulk of the stack cluster:
   20 → 13 files.

4. **Multi-value block results were truncated to the first type, and block
   params were not parsed at all.** The old code admitted it:
   `// multi-value: use func_type index (simplified: use first type)`.
   Anything beyond the single-result shorthand needs a function type index in
   the blocktype slot. `parseBlockType` now parses `(type $t)?  (param …)*
   (result …)*` and interns a function type via a new `currentModule`
   reference (same per-function lifecycle as `localScope`). This also closed
   the T6 `block-param` item — parse-clean 230 → 233 (block, if, loop, fac).

Metric now: **parse-clean 233/257, fully V8-valid 187, 1944 modules → 1886 ok
/ 58 rejected / 0 failed.** Write-failures are gone.

Regression: `tests/parser/signatures_and_strings.test.ts`. The UTF-8 tests
compare the three spellings of one character against each other; the type-use
test executes a function whose local sits after two adopted params; the
block-type tests execute multi-value and param'd blocks in V8.

### Remaining, by V8 rejection reason

| Cluster | Files | Notes |
| --- | --- | --- |
| `expected N elements on the stack` | 13 | Residue after the type-use fix; needs its own diagnosis. |
| typed-ref coarsening | ~12 | The IR refactor scoped in the previous entry. Unchanged. |
| relaxed SIMD encoding | 4 | `reached end while decoding` — immediates likely wrong. |
| `not enough arguments on the stack` | 3 | local_set / simd_store / store. |
| misc singles | ~5 | duplicate export name, invalid local index, memory ordering. |

---

## 2026-08-21 — The parse metric has a blind spot; new T7 scope

### The measurement problem

Every tranche so far was scoped and measured by **parse-clean count**. That
metric cannot see a module that parses perfectly and then encodes to bytes V8
rejects — exactly the failure mode of the two latent bugs CLAUDE.md had
documented as unfixed. Neither was in ANY tranche, because tranches were
derived from parse failures.

Stronger metric, now to be used alongside parse-clean: **parse → resolveNames
→ synthesizeTypes → writeBinaryIr → `WebAssembly.validate`**, per text module.
`synthesizeTypes` is required — omitting it yields an empty type section and
"no signature at index 0". Two harness attempts produced nonsense aggregates
before that was spotted; validate any such harness against a known-good file
before trusting its numbers.

At the T4 cut: **230/257 files parse clean, but only 180 had every module
V8-validate.** 1937 text modules → 1863 ok / 67 rejected / 7 write-failed.

### Fixed in this pass

1. **`Type.I8` / `I16` had the wrong wire bytes** (0x7a / 0x79 → **0x78 /
   0x77**). The old values continued the numeric value-type sequence
   (v128 = 0x7b); the GC proposal does not continue it there. wabt-ts's own
   binary writer emitted packed struct/array fields V8 rejects outright
   ("invalid value type 0x7a") — invisible through the bridge because
   binaryen-ts re-encodes its own way, and invisible to the parse metric.
   CLAUDE.md flagged this at v1.2.3 with "separate fix needed". Every call
   site used the symbol rather than the raw value, so the change was safe.
2. **`br_table` never resolved its index expression.** The case resolved the
   label targets but never recursed into `e.value`. The visitor DOES walk it,
   so the writer reached names the resolver never touched. Bug F class.
3. **`try_table` never resolved its catch clauses** — body only. A
   `try_table (catch $e $l)` emitted tag 0 and label 0, silently dispatching
   the wrong tag to the wrong block. Per the spec the catch clauses are
   checked in the context extended with the try_table's own label, so they
   resolve inside the label push.

Now 182 files fully V8-valid; write-failures 7 → 1.

**Standing guard added** (`tests/ir/encode_correctness.test.ts`): after
`resolveNames`, NO name-var may survive anywhere in the IR — asserted over a
hand-built module exercising every index space AND over the whole spec
testsuite. This closes the Bug G / Bug F class permanently rather than one
instance at a time. `ref.null.refType` is the one deliberate exception
(abstract heap keywords are not names in any index space).

### T7 — semantic correctness. Remaining clusters, by V8 rejection reason

| Cluster | Mods / files | Notes |
| --- | --- | --- |
| `expected N elements on the stack` | 31 / 20 | Largest. Folded-form arity or stack-shape bug; needs its own diagnosis pass. |
| **typed-ref coarsening** | ~21 / ~12 | `expected structref, got (ref $t)`, `call_ref expected (ref null …)`, `local.set expected structref`, `array.new expected structref`, `br_on_non_null expected subtype`. The limitation below. |
| relaxed SIMD encoding | 6 / 6 | `reached end while decoding`, `i8x16.splat expected i32` — opcodes mis-encoded or missing immediates. |
| `not enough arguments on the stack` | 3 / 3 | local_set / simd_store / store. |
| misc singles | ~5 / 5 | duplicate export name, invalid local index, elem const-expr arity. |

### The typed-ref refactor, scoped

`FuncSignature { params: Type[]; results: Type[] }` cannot carry a heap-type
index alongside a `Ref` / `RefNull` type code, so the parser stores
`Type.StructRef` as a placeholder for `(ref $T)` / `(ref null $T)` and the
writer emits structref bytes. Any module with a typed ref in a signature,
local, global, or element type parses and encodes but is then rejected.

Target shape (as CLAUDE.md sketched):

```ts
type ValueType = Type | { kind: 'ref'; heapType: Var; nullable: boolean };
interface FuncSignature { params: ValueType[]; results: ValueType[] }
```

**Sizing: 80 `.params` / `.results` call sites and 54 `Type[]` annotations
across validator (22), ir (17), writer (13), reader (13), bridge (11), tools
(2), parser (2).** The validator is the deep end — its type-checker compares
types by identity throughout and would need subtype-aware comparison.

Recommended sequencing: take the cheaper T7 clusters first (the stack-arity
cluster is 20 files and is probably a contained parser bug), then the
typed-ref refactor as a dedicated piece of work with the V8-validity metric as
its acceptance test. It is not a tranche-sized change.

---

## 2026-08-21 — Tranche 4: table64 / memory64 index types (214 → 230/257)

Measured 214 → **230/257 clean, zero regressions** — exactly the +14 projected,
plus two files from the table-definition shapes that turned out to live in the
same code path.

1. **`(table $t i64 30 30 funcref)`** — `i32` / `i64` in that slot is the
   table's INDEX TYPE, not its element type. Element types are always
   REFERENCE types, so a ValueType there must be classified first; the parser
   consumed `i64` as the elemtype, read `30 30` as the limits, then hit the
   real element type with "expected ), got ValueType". `parseLimits` already
   knew how to consume the index type — only the classification was wrong.
2. **`(memory i64 (data "…"))`** — the inline-data branch matched only a bare
   `(data`, so the index-type spelling fell through to `parseLimits` and
   reported "expected limit initial value". **The synthesized data-segment
   offset must be `i64.const` for a 64-bit memory** — an `i32.const` offset
   parses fine and then produces a binary V8 rejects, which is why the test
   asserts V8 acceptance rather than a successful parse.

`parseTableModuleField`'s non-import branch was restructured around the two
real shapes, which also closed four adjacent gaps:

- `(table $t64 i64 funcref (elem $f))` — abbreviated inline elem WITH an index
  type.
- `(table $t 10 funcref (ref.null func))` — table initializer expression
  (fills every slot; the `Table.init` IR field already existed).
- `(table $t funcref (elem (ref.func $f) (ref.null func)))` — inline elem list
  of element EXPRESSIONS, not just a bare funcidx list. Same abbreviation
  already fixed for standalone `(elem …)` segments in v1.3.6.
- `(elem (table $t) (i32.const 1) (ref func) (ref.func $d))` — an elem segment
  whose element type is the parenthesized typed-ref form, which starts with
  `(` and so missed the bare-ValueType check.

Still failing and NOT a T4 regression: `(table $x (ref null $t) (elem $tf))`
parses but V8 rejects it — the typed-ref IR coarsens `(ref $T)` to structref,
the pre-existing limitation documented in CLAUDE.md.

Regression: `tests/parser/table_memory_types.test.ts`. The table-initializer
and inline-elem-expression tests instantiate and read the table back
(`table.get(i)`) so a wrong slot count or ordering cannot pass.

**Remaining: 27 files.** T5 (GC `(sub …)` / `(rec …)`) and T6 (block params,
`module definition`, annotations) plus the newly catalogued
`any.convert_extern` / `extern.convert_any` GC conversions.

---

## 2026-08-21 — Tranche 3: multi-memory (spec testsuite 179 → 214/257)

Smaller than scoped: the IR ALREADY carried `memidx: Var` on every memory op,
and the binary writer already knew the multi-memory memarg encoding (bit 6 of
the align field signals a memory index follows). Three things were missing,
and accepting the new syntax exposed a fourth.

1. **`parseMemidxOpt` accepted only `(memory $m)`**, not the BARE var the spec
   grammar uses on instructions — `i32.load $mem offset=0`,
   `memory.size $mem`. Every bare memory index failed with "expected ), got
   Var"; 33 files on its own. Now falls through to `parseVarOpt`.
2. **`resolveNames` never walked `memidx` on ANY memory instruction** — the
   Bug G class again. A NAMED memory reached the binary writer as an
   unresolved name-var and hit its fail-loud guard. New `resolveMemoryVar`
   wired into load / store / atomic_* / memory.size / grow / fill / copy /
   init / simd_load_lane / simd_store_lane. **`memory.size` needed its own
   case** — it is a leaf with no sub-expressions, so it fell through the
   "nothing to resolve" default while still carrying a memidx.
3. **`memory.init` transposed its indices**, exactly like `table.init`: the
   one-var form names the DATA segment and the two-var form is
   `memory.init $memidx $dataidx`, so they swap when a second var appears.
4. **SIMD lane ambiguity, introduced by accepting bare memory indices.**
   `v128.load8_lane memarg laneidx` ends with a MANDATORY lane index, so a
   lone integer is the LANE, not a memory. Upstream disambiguates by
   lookahead — a bare Nat is a memory index only when followed by `offset=`,
   `align=`, or a second Nat — and `parseSimdLaneMemidxOpt` now does the same.
   **The existing Tier C bridge tests caught this**, which is exactly what
   they are for; `(v128.load8_lane 3 …)` had started reading lane 3 as
   memory 3.

**Latent WAT-writer bug surfaced by the round-trip test:** `onMemoryInitExpr`
emitted the BINARY operand order (dataidx then memidx) rather than the TEXT
order (memory first). Any non-zero memory therefore re-parsed transposed and
V8 rejected it with "invalid data segment index". Invisible until multi-memory
`memory.init` could be written at all.

Measured 179 → **214/257 clean, zero regressions** (projection said 216; the
two-file gap is files the scope counted under multi-memory that carry a second
blocker — the "files containing" vs "solo blocker" split predicted this).

Regression: `tests/parser/multi_memory.test.ts` — V8-executed proofs that
named memories are distinct (store 1234/9999 into two memories and read back),
per-memory `memory.size`, cross-memory `memory.copy`, `memory.fill`, both
`memory.init` forms, name resolution (including the unknown-name error),
round-trip with an explicit `memory.init 1 0` operand-order assertion, and all
five SIMD lane disambiguation shapes.

**Remaining: 43 files.** Next is T4 (table64 / memory64 index types, projected
+14). Also newly catalogued while diagnosing: `any.convert_extern` /
`extern.convert_any` (GC conversions, 3 files) and table definitions with an
inline init expression / typed-ref elem type (`(table $t 10 funcref
(ref.null func))`, `(table $t 3 3 (ref i31) …)`).

---

## 2026-08-21 — Tranche 2: small grammar gaps (spec testsuite 145 → 179/257)

Six grammar gaps plus one missing instruction family. Measured 145 → **179/257
clean, zero regressions** — exactly the +34 the scope projected.

1. **Every `table.*` table index is OPTIONAL** (defaults to table 0).
   `table.get/set/size/grow/fill/copy/init` called `parseVar()`
   unconditionally, which REPORTS an error when the next token isn't a var —
   so bare `table.size` and `(table.fill (i32.const 0) …)` failed even though
   the `?? varIndex(0)` fallback produced the right index. Now `parseVarOpt`.
2. **`table.init` transposed its indices.** The text form is
   `table.init $tableidx $elemidx`, and the ONE-var form names the ELEM
   segment — so the two must SWAP when a second var appears (upstream wabt
   documents exactly this). wabt-ts read segment-then-table with no swap, so
   every two-var `table.init` targeted the wrong table AND the wrong segment.
   Silent corruption, not a parse error. Regression test executes both forms
   in V8 against two tables and two elem segments.
3. **`(module quote "a" "b")` concatenates** its text pieces, exactly as
   `(module binary …)` already did via `parseTextList`. The quote branch read
   a single string and choked on the second.
4. **`(either r1 r2)`** alternative results. The `Either` token and upstream's
   `ParseEither` both existed; nothing here ever consumed it, so every
   relaxed-SIMD file failed outright. New `ExpectedConst` variant carrying
   `alternatives`.
5. **`(data (global.get $g) "…")`** — the bare-offset branch required
   `(X.const …)` specifically. Any `(` still present at that point is the
   offset (`(memory …)` / `(offset …)` are handled above and data chunks are
   Text), so the condition is now just `Lpar`. Same shape as the elem
   bare-offset fix.
6. **`(ref struct)` / `(ref array)` / `(ref exn)` in type position.** Those
   keywords have dedicated token types, so `parseValueType`'s `(ref …)` branch
   rejected them. Now routed through `parseHeapTypeVar` — the same canonical
   entry `ref.null` and `ref.test` use.

**Four GC array bulk instructions implemented from scratch** — `array.fill`
(0xfb 0x10), `array.copy` (0x11), `array.init_data` (0x12), `array.init_elem`
(0x13). None existed at any layer. Wired through opcode enum + name map,
TokenType, lexer, IR (`ArrayFillExpr` / `ArrayCopyExpr` /
`ArrayInitSegmentExpr`), expr-visitor, ir-util arity, parser (incl.
`instrInputCount` — fill/init take 4 operands, copy takes 5, and a new
`op4()` helper), resolve-names (`array.copy` resolves BOTH type vars;
`init_data` / `init_elem` resolve their segment against the data vs elem
scope respectively), binary writer, binary reader, validator
(`checkArrayTypeIndex` + `onCall` signatures), and the WAT writer.
`array.copy`'s two type immediates are DESTINATION FIRST in both text and
binary.

V8 execution is not reachable for typed-ref GC code through this path —
`(ref $T)` coarsens to structref in the flat IR — so the tests verify binary
encoding (opcode bytes + resolved immediates) and wasm2wat round-trip,
matching the convention already set by the GC tier tests.

Regression: `tests/parser/t2_grammar.test.ts`.

**Remaining: 78 files. Next is T3 (multi-memory), projected +37 → 216/257.**

---

## 2026-08-21 — Parser robustness + Tranche 1 (spec testsuite 120 → 145/257)

### Robustness: the parser must report, never crash

Mutation-fuzzing the spec testsuite (3598 truncated / bracket-stripped /
quote-stripped variants) found that malformed input could **hang the process
and exhaust memory**, which is worse than the throw originally scoped.

1. **Infinite loops on non-consuming sub-parsers.** `parseValueType` reports an
   error and returns null WITHOUT consuming the offending token. Two loops had
   no progress check, so they appended a list entry plus an error forever:
   the struct-field shorthand loop (`(module (type $s (struct (field i1` →
   OOM) and `select (result …)` (no `break` at all). New private helper
   `noProgress(before, what)` compares `this.pos` and reports the offending
   token; both loops now break on it. **`parseFieldType` cannot return null**
   (it defaults to i32), so only a positional check catches that one — an
   `else break` would not have.
2. **`nan:0x7f_ffff` escaped as a raw `SyntaxError`** from `BigInt()`. The
   NaN-payload branch neither stripped the `_` separators its sibling
   hexfloat/float branches already strip, nor guarded the call. New
   `parseNanPayload()` validates the `0x…` spelling and returns null.
3. **Top-level backstop.** `runParse()` wraps lex+parse for both
   `parseWatModule` and `parseWastScript`; an escaping exception becomes a
   loud `internal parser error: …` entry plus the partial result, so a caller
   feeding untrusted text never needs try/catch. It reports rather than
   swallows — an exception there is a wabt-ts bug.
4. **Diagnostics named their tokens as ordinals.** `<token:163>` came from the
   parser's LOCAL `tokenName` switch falling through; `TOKEN_NAMES` in
   token.ts already covers all 168 members, so the default now delegates to
   `tokenTypeName`. (`TokenType` is a `const enum` — there is no runtime
   reverse mapping, so a new member must be added to that map.)

**Silent-corruption bug found in passing:** the f32 NaN payload mask was
`0x3fffff` (22 bits) instead of `0x7fffff` (23). `f32.const nan:0x400000` —
payload = exactly the quiet bit — masked to zero and emitted `0x7f800000`,
which is **infinity, not a NaN**. `literal.ts`'s `F32_MANTISSA_MASK` already
had it right. Verified against V8.

Regression: `tests/parser/robustness.test.ts` (NaN payload separators +
malformed-payload reporting + the 23-bit mask + a V8 NaN check, the three
former hangs, deeply unbalanced input, and a sweep asserting no testsuite
diagnostic renders a raw ordinal).

### Tranche 1 — numeric literals (+25 files, exactly as projected)

1. **Negative hex integers.** `parseNatText` called `BigInt('-0x7fffffff')`,
   which THROWS: JS accepts a sign only on decimal and a radix prefix only
   unsigned. The old comment claimed the opposite. Now the sign is split off
   any radix-prefixed literal and re-applied. Affected i32/i64 consts, v128
   integer lanes, and invoke arguments.
2. **Hex floats required a `p` exponent.** The grammar makes it optional
   (`hexfloat ::= '0x' hexnum '.'? hexfrac? (('p'|'P') sign? num)?`), so
   `0x1.5` and the `0x0123456789ABCDEF.` form the SIMD files use throughout
   were rejected. Regex relaxed, absent exponent = 2^0, plus a guard so the
   looser pattern does not accept `0x.`.
3. NaN-payload separators — done in the robustness pass above.

Measured 120 → **145/257**, zero regressions; the +25 matches the scope's
projection exactly, and `const.wast` / `simd_splat.wast` (the two former
crashes) are now clean. Regression: `tests/parser/numeric_literals.test.ts`
(V8-executed values, not just parse success).

**Remaining: 112 files. Next tranche is T2 (small grammar), projected +34 →
179/257.** The tranche table below is unchanged apart from T1 being done.

---

## 2026-08-20 — WAST spec-testsuite parse gap: scope of the remaining 137 files

**Status: SCOPED, NOT FIXED.** The working tree is at **120/257 clean** (up from
107 after the v1.3.6 ref-value work). This section scopes the remaining 137.

### Corpus and method

`wasmtk/tests/module/wasm_wast/testsuite-main/` — the real 257-file WebAssembly
spec testsuite. Method: parse every file, cluster the first error, then confirm
each cluster's root cause with a MINIMAL REPRO through the parser rather than
inferring it from the error text. This mattered — four hypotheses read off the
error messages were wrong:

- underscores in numeric literals work fine (they are NOT the cause of the
  "expected i32 constant" cluster)
- `(module quote "…")` works; only the MULTI-string form fails
- relaxed SIMD instructions parse fine; those files fail on `(either …)`
- `noexn` is 0x74, not the 0x68 the hierarchy suggests (already fixed)

A file is counted against a feature when it CONTAINS that syntax, so "solo
blocker" = the file's only detected blocker. **The projections below are
calibrated**: spiking the single highest-value fix (`neg-hex-int`) moved
failures 137 → 121, exactly the 16 files predicted.

### Confirmed root causes

| Feature | Root cause (repro-confirmed) | Files w/ | Solo |
| --- | --- | --- | --- |
| `multi-mem-imm` | optional memory index immediate on load/store, `memory.*`, `data.drop`, SIMD lane ops | 39 | 33 |
| `table-opt-index` | `table.get/set/size/grow/fill/copy/init` require a table var; it is OPTIONAL (folded *and* linear) | 31 | 8 |
| `neg-hex-int` | `parseNatText` calls `BigInt("-0x…")`, which THROWS — JS rejects sign+radix. Its comment claims the opposite | 22 | 16 |
| `quote-multi-text` | `(module quote "a" "b")` — multi-string form; `parseTextList` already exists and is wired for `binary` but not `quote` | 21 | 7 |
| `table-index-type` | `(table $t i64 …)` — index type on tables (`parseLimits` does it for memory only) | 13 | 1 |
| `gc-sub-rec` | `(type (sub …))` / `(rec …)` — GC subtyping + recursive type groups | 12 | 5 |
| `hexfloat-trail-dot` | `0x1.` — hex float, trailing dot, no fraction digits, no exponent | 11 | 6 |
| `data-bare-offset` | `(data (global.get 0) "a")` — bare offset expr; exact parallel of the elem fix already shipped | 10 | 2 |
| `ref-abstract-type` | `(ref struct)` / `(ref array)` in type position — `parseValueType`'s `(ref …)` branch rejects the dedicated-token keywords | 9 | 1 |
| `block-param` | `(block (param i32) (result i32) …)` — multi-value block signatures | 7 | 2 |
| `either-result` | `(either r1 r2)` alternative assert results (upstream has `ParseEither`) | 6 | 6 |
| `module-definition` | `(module definition …)` / `(module instance …)` — multi-module linking | 5 | 0 |
| `array-bulk` | `array.copy` / `fill` / `init_data` / `init_elem` | 4 | 2 |
| `elem-typed-reftype` | `(elem … (ref $t) …)` / `(ref 1)` elem types | 4 | 1 |
| `nan-payload-uscore` | `nan:0x7f_ffff` — payload parser skips underscore stripping AND **throws a raw SyntaxError** out of the parser | 4 | 0 |
| `memory-index-type` | `(memory i64 (data …))` | 4 | 1 |
| `annotations` | `(@name …)` custom annotations | 1 | 0 |
| `table-inline-elem` | `(table $t funcref (elem (ref.func $f)))` | 1 | 0 |
| *(select.wast)* | `select (result i32) (result)` — EMPTY `(result)` annotation | 1 | 0 |

91 of the 137 files have a single blocker; 46 need a combination.

### Recommended tranches (cumulative, calibrated projection)

| Tranche | Contents | +files | Running total |
| --- | --- | --- | --- |
| **T1 literals** | `neg-hex-int`, `hexfloat-trail-dot`, `nan-payload-uscore` | +25 | **145/257** |
| **T2 small grammar** | `table-opt-index`, `quote-multi-text`, `either-result`, `data-bare-offset`, `array-bulk`, `ref-abstract-type` | +34 | **179/257** |
| **T3 multi-memory** | memory-index immediate across IR + parser + reader/writer + validator + WAT writer + bridge | +37 | **216/257** |
| **T4 i64 index types** | `table-index-type`, `memory-index-type` | +14 | **230/257** |
| **T5 GC sub/rec** | `(sub …)` / `(rec …)` + type-section encoding + validator subtyping | +9 | **239/257** |
| **T6 structural** | `block-param`, `elem-typed-reftype`, `table-inline-elem`, `module-definition`, `annotations` | +17 | **256/257** |

Ordering rationale: T1 and T2 are contained fixes (literal parsing and single
grammar productions) returning 59 files for far less work than T3. T3 is the
biggest single win but is a genuine cross-cutting feature — the memory index
has to reach the IR and every consumer, so it should not be started until the
cheap tranches are banked. T5 and T6 are proposal-scale features.

### Two robustness bugs worth fixing regardless of tranche

1. **The parser THROWS on malformed input.** `nan:0x7f_ffff` escapes as a raw
   `SyntaxError` from `BigInt()` (const.wast, simd_splat.wast). A parser must
   report an error, never crash the caller. Same underlying call as
   `neg-hex-int`, so T1 fixes both — but audit `parseNatText`'s other callers
   for the same pattern.
2. **`tokenName()` renders unnamed tokens as `<token:163>`.** Every diagnostic
   in this survey had to be post-processed through the `TokenType` enum to be
   readable. Fill in the name map (or fall back to `TokenType[n]`).

---

## 2026-06-09 — Silent-corruption audit (two rounds, unreleased)

A two-pass fail-loud audit (6 + 4 parallel review agents) of the whole `src/` tree for workarounds,
silent-wrong-output bugs, fallthroughs, and dead code. ~18 root-cause fixes landed in the working
tree (deno.json is at v1.3.2; these fixes are not yet committed/bumped/published). Full invariant list with rationale is
in [design-decisions.md](design-decisions.md) (sections "2026-06-09 silent-corruption audit" +
"Round 2"); regressions in `tests/audit/silent_corruption_fixes*.test.ts`. Suite 131 → **146 tests
/ 1044 steps**, all green; lint + fmt clean; the 272-file wasmtk corpus still passes (it now flows
through the fail-loud `writeVar`).

**Round 1 — Critical+High:** SIMD float opcode values in the lexer realigned to `opcode.ts` (div/
ceil/min/pmin/… were shifted; f64x2 pmin/pmax collided with the convert ops); tag type index
resolved from signature instead of hardcoded 0 (writer + validator) **and** the binary reader's
tag-import decode now consumes the attribute byte before the type index (bonus bug a round-trip test
surfaced — every imported tag had resolved to type 0); v128.store/loadN_splat decode split
(0x0b was decoded as load_zero, dropping an operand); `resolveNames` resolves `call_ref`/
`return_call_ref` `sigType`; `trunc_sat` routed through `getMiscOpcodeTypeInfo` (was validated as
v128); multi-`catch` body assignment; SIMD lane-op validation + `replace_lane` arity; deleted the
duplicate `naturalAlignForOpcode` in the WAT writer; `applyNames` no longer rewrites `local.get`
through `funcNames`; `Table.init` resolved + emitted (0x40 form).

**Round 2 (completeness sweep) — more of the same class:** `decodeSimdOp` operand arity is now
per-opcode (`SIMD_UNARY_OPS` set + `v128.bitselect`→ternary; everything else binary) — the old code
popped 2 for every arith op, corrupting all unary SIMD; **the lane load/store ranges were also
wrong** (load_lane `0x54-0x57`, store_lane `0x58-0x5b`; the old code used `0x54-0x5b` for load and
`0x5e-0x61`, which are unary demote/promote/abs/neg, for store). `writeVar` is now FAIL-LOUD on a
name-var (the root of the Bug-G family). `resolveNames` closed three more leaks: `simd_lane_op.value`
(replace_lane scalar), `elemSegment.tableVar`, `dataSegment.memoryVar`. `parseLimits` detects the
`i64`/`i32` index type (memory64 from text was always `is64:false` — it matched the nonsense
`i64x2` SIMD token). `try_table` fails loud on an unknown catch-kind byte instead of desyncing.
Dead code removed: `WastParser.ok()`, `TypeEntry.tailcallTarget?`, five unused `WatWriter`
`*Imports` fields.

**Known-open / deliberately deferred:** relaxed-SIMD ternary decode (blocked by the `(prefix<<8)|sub`
opcode-encoding collision for sub ≥ 0x100); table64-from-text (index type precedes the reftype);
`writeMemArg`'s inline `:0` for a named multi-memory memidx; and the round-1 Medium/Low items not yet
swept (`parseNatText` multi-underscore, `assert_trap (module)` mislabel, `wabt-compat`
`write_debug_names` ignored, `wasm-objdump -h` no-op).

---

## Phase Status Overview

| Phase | Scope | Status |
| --- | --- | --- |
| **1** | Core Infrastructure | ✅ Complete |
| **2** | IR Layer | ✅ Complete |
| **3** | Binary Round-trip | ✅ Complete |
| **4** | WAT Text Format | ✅ Complete |
| **5** | Validator | ✅ Complete |
| **6** | CLI Tool Wrappers | ✅ Complete |
| **6.1** | Pre-publish housekeeping (JSR/CI hardening + lint + perf invariants) | ✅ Complete |
| **6.2** | Release-flow alignment with binaryen-ts (bump task, atomic publish, license fix) | ✅ Complete |
| **7** | binaryen Bridge | 🟡 In progress (Tiers A+B+C+D + all 4 GC tiers complete; remaining gaps are upstream binaryen-ts or the deferred typed-ref IR refactor) |
| **8** | wasm2ts (new) | ⬜ Not started — deferred pending wasmtk QA/QC |

## Out of Scope — wabt Components Not Ported

These wabt components were evaluated and explicitly excluded. Do not add them
without revisiting the decisions below.

| Component | wabt source | Reason excluded |
| --- | --- | --- |
| Interpreter (`wasm-interp`) | `src/interp/` | Deno/Bun have native V8/JSC wasm JIT — 10–50× faster |
| Spec test runner (`spectest-interp`) | `src/tools/spectest-interp.cc` | Only useful alongside the interpreter |
| C code generator (`wasm2c`) | `src/c-writer.cc` | Wrong target; `wasm2ts` is the TS-target equivalent |
| Linker (`wasm-link`) | `src/tools/wasm-link.cc` | wasmtk handles this via wasmbundler |
| Decompiler (`wasm-decompiler`) | `src/decompiler.cc` | Not needed for the wasmtk toolchain |
| Fuzzing harnesses | `fuzzers/` | Development tooling for the C++ project only |

## In Scope — wabt Components Being Ported

| Component | Purpose | Phase | Status |
| --- | --- | --- | --- |
| `wat2wasm` | WAT text → wasm binary | Phase 4 (parser) + Phase 6 (CLI) | ✅ Complete |
| `wasm2wat` | wasm binary → WAT text | Phase 4 (writer) + Phase 6 (CLI) | ✅ Complete |
| `wasm-validate` | Validate wasm binary with structured errors | Phase 5 (validator) + Phase 6 (CLI) | ✅ Complete |
| `wasm-objdump` | Inspect sections, imports, exports | Phase 6 (CLI) | ✅ Complete |
| `wasm-strip` | Strip name/debug sections from binary | Phase 6 (CLI) | ✅ Complete |
| `wasm2ts` | Transpile wasm → typed TypeScript (new) | Phase 8 + Phase 6 (CLI) | ⬜ Deferred |

---

## Decisions Log

Decisions are recorded here when made. The context behind each matters
more than the rule — if priorities change, revisit the WHY before changing course.

### JSR scope: `@jrmarcum/wabt-ts`
**Date:** 2026-05-21
**Decision:** Use the personal scope `@jrmarcum/wabt-ts` on JSR, matching the GitHub
remote (`github.com/jrmarcum/wabt-ts`).
**Why:** Simpler to publish without creating a separate org scope; if wasmtk grows
into a formal org, the package can be transferred later.
**Affects:** `deno.json`, `README.md`, all import examples.

### Provenance publishing via GitHub Actions

**Date:** 2026-05-21
**Decision:** `.github/workflows/publish.yml` publishes on `v*` tag push with `--provenance`.
**Why:** JSR requires OIDC provenance (`id-token: write`) for attestation; workflow
type-checks and runs tests before publishing.
**Affects:** `.github/workflows/publish.yml`.

### Tag-driven publish — `deno task publish` must not call `deno publish` directly

**Date:** 2026-05-25
**Decision:** `deno task publish` runs `scripts/publish.ts`, which creates and pushes
a `v<version>` tag. The actual `deno publish` invocation lives inside the GitHub
Actions workflow at `.github/workflows/publish.yml`, never in a task that could be
invoked locally. `deno task publish:dry` (which runs `deno publish --dry-run --allow-dirty`)
is the only `deno publish` invocation safe to run from a workstation.
**Why:** JSR provenance requires the GitHub Actions OIDC token. A local
`deno publish` would succeed but produce a release with no provenance, breaking
the chain for that version. The earlier task definition (`"publish": "deno publish"`,
mirrored from binaryen-ts) had this footgun; the script makes the safe path the
default.
**Affects:** `scripts/publish.ts`, `deno.json` (`tasks.publish`, `tasks.publish:dry`),
`.github/workflows/publish.yml` (calls `deno publish` directly, not `deno task publish`).

### CI workflow: lint + fmt + check + test + publish dry-run on every push/PR

**Date:** 2026-05-25
**Decision:** `.github/workflows/ci.yml` runs `deno fmt --check`, `deno lint`,
`deno task check`, `deno task test`, and `deno publish --dry-run --allow-dirty`
on every push and pull request to `main`. Mirrors the binaryen-ts setup.
**Why:** Catch lint regressions, formatting drift, type errors, and JSR manifest
breakage before they land. The publish dry-run validates the same slow-types
lint and include/exclude manifest that the real publish workflow will check —
no surprises on tag push.
**Affects:** `.github/workflows/ci.yml`.

### Text codecs are module-level singletons in hot-path files

**Date:** 2026-05-25
**Decision:** `TextEncoder` and `TextDecoder` are constructed once at module
scope in `src/writer/stream.ts`, `src/writer/wat-writer.ts`,
`src/reader/binary-reader.ts`, and `src/parser/lexer-source.ts`. Per-call
instantiation is forbidden in those files.
**Why:** `TextEncoder` / `TextDecoder` are stateless under `.encode()` /
`.decode()`, but their constructors are non-trivial in V8. They were previously
being allocated per import name, per quoted string, per name-section entry, and
per `sliceText()` call — all hot paths during wat2wasm / wasm2wat on large
modules.
**Affects:** the four files above; new code in them must reuse the file-level
`TEXT_ENCODER` / `TEXT_DECODER` constant.

### `ModuleContext` pre-computes function and tag arity index maps

**Date:** 2026-05-25
**Decision:** `ModuleContext` constructor builds `funcSigsByIndex: FuncSignature[]`
and `tagArityByIndex: number[]`, populated in a single pass over imports + defs.
`getFuncSig` and `getTagArity` are O(1) indexed reads.
**Why:** The previous implementation walked `module.imports` linearly on every
lookup. `getExprArity` calls these for every `call`/`call_ref`/`throw`/`return_call`
expression during validator and writer walks, so the cost compounded with both
function count and module size. The flat index space (imports first, then
defined funcs/tags) matches the convention `idx < numFuncImports` already
encoded the same way.
**Affects:** `src/ir/ir-util.ts` — `ModuleContext` constructor, `getFuncSig`,
`getTagArity`.

### `WatWriter` pre-computes `nameIndexMap` for `resolveVarIndex`

**Date:** 2026-05-25
**Decision:** `WatWriter` constructor builds a `Map<string, number>` keyed by
`"kind:name"`, populated in a single pass over imports + defs by kind.
`resolveVarIndex` is an O(1) `Map.get` for name-based Vars (index-based Vars
return the raw `v.value` as before).
**Why:** The previous implementation did two linear scans (imports, then defs)
per call. `buildExportMap` and `writeExport`'s `isInlineExport` each call it
once per export, so the cost grew quadratically on modules with many name-based
exports.
**Affects:** `src/writer/wat-writer.ts` — `WatWriter` constructor,
`buildNameIndexMap`, `resolveVarIndex`.

### Lint cleanup: switch `ValidateOptions` from `interface` to `type`

**Date:** 2026-05-25
**Decision:** `export interface ValidateOptions {}` became
`export type ValidateOptions = Record<string, never>`.
**Why:** Deno's `no-empty-interface` rule only fires on empty `interface`
declarations, not on type aliases. The placeholder is kept for future feature
flags; switching to a type alias preserves the intent without disabling the
lint rule globally.
**Affects:** `src/validator/shared-validator.ts:20`.

### Release flow: `deno task bump` + atomic publish (mirrors binaryen-ts)

**Date:** 2026-05-25
**Decision:** Adopt binaryen-ts's release ergonomics — `scripts/version.ts` +
`scripts/bump_version.ts` + `scripts/publish.ts` with sub-version-capped-at-9
versioning (`1.0.9 → 1.1.0`, `1.9.9 → 2.0.0`; major uncapped). `deno task bump`
rewrites `deno.json`; `deno task publish` stages, commits, force-tags locally,
and pushes commit + tag atomically (`git push origin main vX.Y.Z`).
**Why:** Same rule + same flow keeps the two sibling projects in lockstep so a
contributor familiar with one can release the other without re-learning. The
atomic push avoids races with `auto-tag.yml` (it sees the tag already exists
and no-ops).
**Affects:** `scripts/version.ts`, `scripts/bump_version.ts`, `scripts/publish.ts`,
`deno.json` (`tasks.bump`, `tasks.publish`).

### `auto-tag.yml` safety-net workflow

**Date:** 2026-05-25
**Decision:** A new workflow auto-creates `vX.Y.Z` when it detects a `deno.json`
version bump on `main` without a corresponding tag, then explicitly dispatches
`publish.yml` on that tag.
**Why:** Catches the case where someone bumps and commits manually without
going through `deno task publish`. The explicit `gh workflow run` dispatch is
required because GitHub's recursion guard prevents `GITHUB_TOKEN`-authored
pushes from auto-firing workflows.
**Affects:** `.github/workflows/auto-tag.yml`.

### CI publish step calls `deno publish` directly, not `deno task publish`

**Date:** 2026-05-25 (lesson recorded; the workflow already did this)
**Decision:** `.github/workflows/publish.yml` invokes `deno publish` directly.
The `deno task publish` indirection is reserved for local use by
`scripts/publish.ts`.
**Why:** `deno task publish` runs the script, which would spawn
`deno publish` as a subprocess via `Deno.Command`. JSR's OIDC token detection
runs in the workflow's primary process and does not propagate cleanly through
the subprocess, so a CI publish via the task ends up flagged "No provenance".
binaryen-ts learned this the hard way at v1.0.6/v1.0.7 — calling out the
constraint here so it does not regress.
**Affects:** `.github/workflows/publish.yml` — the "Publish to JSR" step.

### JSR license: declare `MIT`, not the compound `MIT OR Apache-2.0`

**Date:** 2026-05-25
**Decision:** `deno.json` and `package.json` declare `"license": "MIT"`. The
`LICENSE` file contains the full MIT License text plus a trailing pointer to
`LICENSE-APACHE` for the alternative. `LICENSE-MIT` and `LICENSE-APACHE`
remain as separate full-text files for downstream consumers who need
Apache-2.0.
**Why:** JSR's license detector rejects compound SPDX expressions and tries
to match `LICENSE` against the SPDX template for whatever is declared. The
v1.0.2 publish failed with "license ... was not recognized" because the field
was `"MIT OR Apache-2.0"` (a valid SPDX expression, but not a recognized
single identifier on JSR) and `LICENSE` was a dual-license notice that did
not match either SPDX template. Switching to MIT-declared + Apache-shipped
matches sibling binaryen-ts.
**Affects:** `LICENSE`, `deno.json`, `package.json`, `CLAUDE.md` license section.

### WAT parser fold-form fix + local-scope wiring

**Date:** 2026-05-25
**Decision:** Reproduced and fixed two related WAT-parser bugs that made
folded-form WAT (the most common authoring style, used pervasively by
wasmtk's wasic) fail to parse. wasmtk reported the blocker against
v1.0.3: all 270 of its tests failed because `(local.set $ptr (global.get
$heap))` and similar patterns errored out with "expected ), got (".
**Why this matters:** folded form is canonical WAT and any real WAT input
will use it. Without this fix wabt-ts cannot replace the compiled wabt
binary that wasmtk currently shells out to.

**Two underlying bugs, both in `src/parser/wast-parser.ts`:**

1. **`parseFoldedInstr` ran the sub-expression loop BEFORE consuming
   immediates.** WAT fold-form is `( opcode immediate-args
   folded-sub-expr* )` — immediates come first in the token stream. The
   sub-expression loop was gated on `peekIsInstr`, which returns false
   for `Var` / `Nat` / etc., so the loop exited zero-iterations whenever
   an immediate was present. `buildPlainExpr` then consumed the
   immediate but had no operand to plug into the operand slot, leaving
   the next `(` as an unexpected token.
   Fix: dry-run `buildPlainExpr` with empty operands to advance past
   the immediates (errors suppressed so they're not double-reported),
   loop over `(`-prefixed sub-expressions into `innerCtx`, then rewind
   to the immediate position and re-invoke `buildPlainExpr` with the
   real operands. Forward past the already-parsed sub-expressions
   after the second invocation. Two `buildPlainExpr` calls per folded
   instr, cheap.

2. **Function-local names were silently discarded.** The parser had
   `parseFuncSignature` return `{ sig, bindings }` (params name →
   slot index) but every caller destructured only `sig`. The
   `(local $name type)` form skipped the name entirely with
   `this.drop()`. The `Func` IR has no field for param/local names,
   so `local.get $name` carried an unresolved name-var that
   `resolveNames` couldn't resolve (its `localScope` was always
   empty — populated to a fresh `NameScope()` per function but never
   filled in).
   Fix: `parseFuncModuleField` now builds a combined
   `Map<string, number>` of param-name + local-name → slot index (with
   the `$` prefix to match `parseParams`'s convention), stashes it on
   the parser as `this.localScope` for the duration of the function
   body, and the `local.get` / `local.set` / `local.tee` cases in
   `buildPlainExpr` call a new `resolveLocal(v)` helper that converts
   name-vars to index-vars when in scope.

**Affects:** `src/parser/wast-parser.ts` only (no IR shape change).
Regression coverage in `tests/parser/folded.test.ts` (7 tests, including
the exact wasmtk repro and the full heap-allocator pattern). Full suite:
91 passing.

**Open follow-up:** the `resolveNames` pass at
`src/ir/resolve-names.ts` still populates an empty `localScope` per
function (the populator was never written). The parser-side fix means
this dead code is no longer load-bearing for the WAT-source path, but
it remains a bug for any IR that comes from another source (binary
reader, manual construction) and uses name-vars in local refs. Worth
fixing in a follow-up; for now, the parser short-circuits the issue
for WAT input.

### Latent wabt-ts bugs surfaced by Phase 7 bridge work + wasmtk integration

**Date:** 2026-05-25 (recurring pattern)
**Decision:** Eight pre-existing wabt-ts bugs were caught and fixed across
the v1.0.4 → v1.0.7 release window. Each one was latent in `main` and only
fired when modules combined features no existing test had exercised.

**Why this matters:** the bridge is a powerful integration test for the
whole wabt-ts pipeline (WAT parser → IR → bridge → binaryen-ts encoder →
wabt-ts reader → wabt-ts validator). Round-tripping a single small module
exercises every link of that chain. wasmtk feeding wabt-ts real-world WAT
(its 270-test wasic suite) is an even stronger probe. The pattern is:
**a new module shape that the test suite hadn't covered surfaces a bug;
investigate and fix at the root cause in `src/` rather than working around
in the bridge.**

**Bugs caught + fixed (chronological):**

1. **`readCodeSection` off-by-one** (Phase 7 MVP).
   `src/reader/binary-reader.ts` used `m.funcs[funcBase + i]` with
   `funcBase = m.numFuncImports`. But `m.funcs` is the array of DEFINED
   funcs only (imports live in `m.imports`); the index space already
   starts at 0. Fixed to `m.funcs[i]`. No prior test combined imports +
   defined funcs.

2. **`Load` / `AtomicLoad` arity** (Phase 7 Tier B).
   `src/parser/wast-parser.ts` `instrInputCount` listed `Load` and
   `AtomicLoad` at arity 2 alongside `Binary` / `Compare` / `Store`. They
   are arity 1 (single operand: the address). The phantom second operand
   popped the real address off the parser's stack as a Nop. Moved both
   into a dedicated arity-1 case. No prior test used linear-form
   (non-folded) `local.get N i32.load`.

3. **`readTableSection` extension peek**
   (Phase 7 Tier B).
   `src/reader/binary-reader.ts` peeked a byte AFTER the reftype to
   detect a "table with init expression" extension. The reference-types
   proposal actually puts a `0x40` tag BEFORE the reftype, not a flag
   after. The misplaced peek treated the limits flag (`0x01` for
   "has-max") as a hasInit indicator, corrupting all following section
   reads with phantom "else outside if" errors at arbitrary offsets.
   Fixed to look for `0x40` first; remaining path is the simple
   `reftype limits` form. No prior test had a non-imported `(table N
   funcref)` with explicit max.

4. **Folded WAT — immediates parsed after sub-expressions**
   (v1.0.4, reported by wasmtk).
   `src/parser/wast-parser.ts` `parseFoldedInstr` ran the sub-expr loop
   first, then `buildPlainExpr` (which consumes the opcode's immediates
   like `$ptr` for `local.set`). The loop's `peekIsInstr` returned false
   for the immediate token, so the loop exited with zero operands and
   the next `(` showed up as an unexpected token. wasmtk's
   `(local.set $ptr (global.get $heap))` failed, blocking 270/270
   tests. Fix: dry-run buildPlainExpr first to advance past immediates,
   then loop over sub-expressions, then rewind and re-invoke with the
   real operands. Regression test:
   `tests/parser/folded.test.ts`.

5. **Function-local names silently discarded**
   (v1.0.4, surfaced alongside #4).
   `src/parser/wast-parser.ts` had `parseFuncSignature` return a
   bindings map for param names but every caller destructured only the
   sig. `(local $name type)` skipped the name with `this.drop()`. With
   no scope populated, `local.get $name` produced an unresolved
   name-var that the bridge / binary writer couldn't disambiguate from
   a globally-scoped name. Fix: parser builds a per-function
   `localScope` map (params + named locals) and resolves
   `local.get` / `local.set` / `local.tee` name-vars to index-vars at
   parse time. Regression test:
   `tests/parser/folded.test.ts` ("local names with `$` prefix bind
   correctly for both params and locals").

6. **`flushStack` reversed sub-expression order**
   (v1.0.5, reported by wasmtk).
   `src/parser/wast-parser.ts` `flushStack` popped stack values LIFO into
   `stmts`, reversing the order. Invisible for single-result blocks but
   produced swapped operands in folded form:
   `(i32.sub (local.get $a) (local.get $b))` emitted `i32.sub b a`.
   Commutative for `i32.add` (silent failure), wrong for `i32.sub` /
   `i32.div_s` / etc. Fix: forward iteration into `stmts`. Regression
   test: `tests/tools/wat2wasm.test.ts`
   ("preserves operand order in folded binary expressions" + the
   non-commutative coverage).

7. **No type-section synthesis from inline signatures**
   (v1.0.5, reported by wasmtk).
   The WAT parser stored inline `(param ...) (result ...)` on
   `Func.sig` / `Tag.sig` / `Import.func.sig` / `Import.tag.sig` but
   never back-filled `module.types`. The binary writer's function +
   import sections emitted type-index references, so the resulting
   binary had a function-section entry pointing at type 0 with no type
   entries — binaryen reported `invalid type index 0 / 0`. Fix: new
   `src/ir/synthesize-types.ts` pass that walks all sig-bearing items
   and appends missing type entries. Called from `wat2wasm.ts` after
   `resolveNames`, before `writeBinaryIr`. Regression test:
   `tests/tools/wat2wasm.test.ts` ("synthesizes a type section…").

8. **`resolveNames` default case didn't recurse into operand children**
   (v1.0.6, reported by wasmtk).
   `src/ir/resolve-names.ts` `resolveExpr`'s default case
   `return [Result.Ok, e]` silently dropped every sub-expression for
   any expression kind not explicitly listed (drop, select, binary,
   unary, compare, convert, loads, stores, atomics, simd, memory.copy
   / fill, table.get / set / grow / fill, ref.is_null, br_on_*,
   throw_ref, return, ternary, quaternary, memory.grow). Inside those
   kinds, nested `call $name` / `ref.func $name` / `local.get $name`
   kept their name vars; the binary writer fell back to "index 0"
   because there was no other fallback. wasmtk hit this with
   `(select (call $__malloc ...) ...)` in cabi_realloc: `$__malloc`
   is absolute index 2 but the call was emitted as index 0
   (`$proc_exit`). Fix: ~20 explicit recursive cases added for every
   kind with Expr children; default is now reserved for true leaves
   (`nop`, `unreachable`, `const`, `memory.size`, `ref.null`,
   `atomic_fence`, `rethrow`, `code_metadata`). Regression tests:
   `tests/tools/wat2wasm.test.ts`
   ("resolves call \$name nested inside drop / select", + drop-only).

9. **`parseTagModuleField` missing inline-export loop**
   (v1.0.7+, reported by wasmtk Phase 3 work).
   `src/parser/wast-parser.ts` `parseTagModuleField` parsed
   `(tag $name ...)` without the `while (this.matchLpar(TokenType.Export))`
   loop that every sibling field parser (func / global / memory / table)
   carried, so `(tag $exn (export "exn") (param i32 i32))` failed with
   "expected ), got (" when the parser hit the inline export's `(`.
   wasic emits this shape for every exception tag export — any wasmtk
   file using `try`/`catch`/`throw` would fail to parse. Fix: copied the
   inline-exports block from `parseGlobalModuleField` verbatim, computing
   `tagIdx = numTagImports + tags.length` and pushing
   `{ kind: ExternalKind.Tag, var: varIndex(tagIdx) }` exports before
   parsing the optional inline import. Regression coverage:
   `tests/parser/wast-parser.test.ts` "parseWatModule — tags" (4 tests:
   plain tag, single inline export, multiple inline exports, import).

10. **SIMD opcode-name table had stale opcode values**
    (v1.0.9, surfaced by Phase 7 Tier C SIMD memory-op work).
    `src/core/opcode.ts` `EXTENDED_OPCODE_NAMES` mapped
    `v128.bitselect` / `v128.any_true` to 0xfd58 / 0xfd59 and
    `v128.store{8,16,32,64}_lane` to 0xfd5e-0x61 (an older draft
    encoding). The lexer was already spec-correct (bitselect=0xfd52,
    store8_lane=0xfd58, etc.), so the WAT parser produced spec-correct
    opcodes — but `anyOpcodeName(0xfd58)` returned `"v128.bitselect"`
    instead of `"v128.store8_lane"`. Any consumer that round-tripped
    SIMD opcodes through a name lookup (the binaryen bridge does this
    when calling `makeSIMDLoadStoreLane`) got the wrong instruction
    encoded. The duplicate keys at 0x60/0x61 (store32/64_lane vs.
    i8x16.abs/neg) compounded the bug — Map.get returned whichever
    entry was inserted later. Initial fix (v1.0.9): replaced the four
    bad bitselect/any_true/store_lane entries with the spec values;
    added the missing `v128.store` (0x0b) and `v128.const` (0x0c)
    entries that the lexer already used. Superseded by the comprehensive
    audit-driven regeneration in bug #14 below. Regression coverage:
    `tests/bridge/tier_c.test.ts` "v128.store8_lane" round-trip.

11. **f64/f32 const integer literals encoded as raw bit patterns**
    (v1.1.0, reported by wasmtk worker-pools). `parseFloatBits` and
    `parseFloatLiteralBits` in `src/parser/wast-parser.ts` treated
    `f64.const 1` as bit pattern `0x0000000000000001` instead of value
    `1.0`. Result: `1` → smallest positive subnormal (5e-324), `10` →
    5e-323, `100` → 4.94e-322, etc. Every f64 program silently broke
    because comparisons against integer literals became comparisons
    against tiny subnormals and loop counters never advanced past 0.
    Second bug in the same function: f64 bits reassembled as
    `(hi * 2^32) + lo` lost precision above 2^53 (any negative f64 or
    large-mantissa value drifted ~3e-12 from spec). Fix: split into
    width-specific helpers — `parseF32Bits` (returns `number`) and
    `parseF64Bits` (returns `bigint`). Integer literals are routed
    through `setFloat32` / `setFloat64`; NaN-with-payload encoding
    honors the sign bit. Module-level `F32_BUF` / `F64_BUF` DataViews
    avoid per-call allocation. Regression: `tests/tools/wat2wasm.test.ts`
    ("f64.const integer literals are float values, not raw bit
    patterns", "f32.const integer literals…").

12. **Multi-value `return` dropped all but the first operand**
    (v1.1.1, reported by wasmtk regex helpers). `ReturnExpr` stored
    `value?: Expr` and `parseLinearPlainInstr` captured only
    `operands[0]` for the variable-arity `Return` token. A function
    declared `(result i32 i32)` with `(return (i32.const 10)
    (i32.const 20))` emitted bytes for only the first value, and V8
    rejected the binary as missing operands. Implicit-return form (just
    leaving N values on the stack at function end, no `return` keyword)
    was unaffected because it bypasses `ReturnExpr` entirely. Fix:
    `ReturnExpr.value?: Expr` → `ReturnExpr.values: Expr[]`. Parser
    captures the full `operands` array. Expr-visitor dispatches each
    child in stack order before `onReturnExpr`. Binary reader pops
    `funcResultCount` values via `popN`. Bridge handles 0/1 values
    directly; multi-value throws with a "needs binaryen-ts
    makeTupleMake" message. apply-names / resolve-names walk the array.
    Regression: 5 tests in `tests/tools/wat2wasm.test.ts` (folded
    multi-value, unfolded multi-value, mixed i32+i64, single-value
    guard, void guard).

13. **`memarg.align` defaulted to byte 0 instead of opcode-natural**
    (v1.1.1, reported by wasmtk 1_StaticGlobalInitialization /
    1_recursion / 1_WasiStringBufferIntegrity). The parser stores
    `align = 0` as a "no explicit `align=N`" sentinel, but
    `writeMemArg` in `src/writer/binary-writer.ts` wrote the raw byte
    value as if it were the LEB exponent. Every memory op without an
    explicit alignment encoded `align byte = 0` (1-byte alignment). V8
    accepted the binary, but binaryen's optimizer reads the alignment
    field as a hard constraint and refuses some rewrites — producing
    out-of-bounds memory accesses and "Invalid typed array length: 1"
    crashes on optimized output. Fix: new
    `naturalAlignForOpcode(op)` helper in `src/core/opcode.ts`
    covers core loads/stores + SIMD memory + atomics (~80 entries);
    `writeMemArg` now takes the opcode, resolves natural when
    `align = 0`, then `Math.log2`-encodes. Bridge's
    `alignBytesToExponent` had the same "0 → exponent 0" bug and got
    the same fix. Regression: 2 tests in
    `tests/tools/wat2wasm.test.ts` ("memory ops default to natural
    alignment when align= is omitted", "explicit align=N keyword
    still log2-encodes correctly").

14. **`EXTENDED_OPCODE_NAMES` had massive SIMD drift**
    (v1.1.1, surfaced by Phase 7 Tier C bridge work). ~95 SIMD entries
    were at wrong positions (i64x2 compares listed at 0x41-0x46
    instead of spec 0xd6-0xdb), ~30 were missing entirely (extmul,
    extend_low/high families), and the relaxed-SIMD entries were
    written as `| 0x100+` that silently collided via JS bitwise OR
    truncation with low SIMD opcodes. The lexer was always
    spec-correct; only the name lookup was wrong. Bridge surfaced it
    because `anyOpcodeName()` is used for name-based factory dispatch
    into binaryen-ts (e.g. for `makeSIMDLoadStoreLane`). Fix:
    regenerated the SIMD section from upstream wabt `opcode.def` via
    new `scripts/gen_simd_opcode_table.ts`; added the missing 0xfc
    MISC entries (memory.copy/fill/init, table.copy/init/grow/size/fill,
    elem.drop, data.drop, i64.add128/sub128/mul_wide_s/u).
    Relaxed-SIMD opcodes ≥ 0x100 are documented as unsupported by the
    16-bit `(prefix << 8) | byte` key scheme (LEB128 encoding required;
    separate todo if a consumer needs them). New
    `scripts/audit_opcodes.ts` diffs against upstream and exits
    non-zero on any mismatch — wire into CI to catch future drift.

15. **SIMD `*.replace_lane` dropped the scalar operand**
    (v1.1.3, surfaced by Phase 7 Tier C bridge work, then verified by
    the wasmtk WAT corpus integration). `SimdLaneOpExpr` only had an
    `operand` field (the vec); the parser captured `operand: op0()`
    for every SIMD lane op including the six replace_lane variants
    (`i8x16/i16x8/i32x4/i64x2/f32x4/f64x2.replace_lane`), silently
    dropping the scalar replacement value. V8 rejected the resulting
    binaries as missing operands. Fix: added optional `value?: Expr`
    to `SimdLaneOpExpr` (set for replace_lane, undefined for
    extract_lane). Parser dispatches arity per-opcode via new
    `instrInputCountForTok` + `isReplaceLaneOpcode` helpers. Binary
    reader pops two operands for replace_lane (vec then scalar).
    `expr-visitor` dispatches the second operand when present.
    Bridge uses `makeSIMDReplace` for replace and `makeSIMDExtract`
    for extract. Regression coverage: 3 tests in
    `tests/bridge/tier_c.test.ts` (i32x4 / i8x16 / f64x2 replace_lane).

16. **`try_table (catch ...)` clauses dropped silently**
    (v1.1.3, surfaced by Phase 7 EH bridge work). The WAT parser's
    `parseFoldedInstr` TryTable branch coerced every `try_table` to
    a plain `BlockExpr` and rejected `(catch ...)` clauses with
    "expected ), got (". Fix: split the Try (legacy) and TryTable
    (new EH proposal) cases. New TryTable parses up to N catch
    clauses (`catch` / `catch_ref` / `catch_all` / `catch_all_ref`)
    before the body via `parseTryTableCatch`, building `TableCatch[]`
    entries on a real `TryTableExpr`. Helper `isCatchKeyword`
    identifies the four catch tokens. Single-catch and single-
    catch_all forms round-trip through bridge → encoder → V8;
    multi-catch and catch_ref tests deferred on a V8 / binaryen-ts
    encoder quirk in catch-block-type computation. Regression
    coverage: 2 tests in `tests/bridge/tier_c.test.ts`.

17. **Bare-offset `(elem (i32.const N) $f1 $f2)` form rejected**
    (v1.1.3, surfaced by the wasmtk WAT corpus). `parseElemModuleField`
    handled `(elem (table $t) (offset ...) ...)` and
    `(elem $name (offset ...) ...)` and `(elem declare ...)` but had
    no fallthrough for the standalone bare-offset form where the
    parenthesized expression after `elem` is the offset directly
    (table 0 implicit, active segment). The parser fell through to
    the elem-list parsing and choked on the `(i32.const ...)` as
    "expected ), got (". wasic emits this shape for every active
    table segment — 38 files in the corpus were affected. Fix:
    added a `peek() === Lpar && peek(1) !== Item` branch that
    invokes `parseOffsetExpr` and sets `kind = 'active'`. Regression
    coverage: `tests/wasmtk/runner.test.ts` (all 38 previously
    failing files now compile).

18. **Legacy `(try (do ...) (catch ...) (delegate ...))` syntax rejected**
    (v1.1.3, surfaced by the wasmtk WAT corpus 15_* exception tests
    and `18_Multi-ScopeScaleAndMemoryLongevityTest`). The old EH
    proposal wraps the protected body in `(do ...)` and uses
    `(catch $tag ...)` / `(catch_all ...)` / `(delegate $target)`
    sub-blocks; the previous stub called `parseInstrList` directly
    on whatever followed the block type, which choked on `(do`.
    Wasic still emits this form alongside try_table. Fix: parse
    each sub-block, consume tag/target vars where applicable, fold
    all instructions into a single body. Dispatch semantics are not
    modeled (legacy try is superseded by try_table), but the lexer
    advances correctly so the rest of the module parses. New
    helper `isTryLegacySubBlock` identifies the four sub-block
    keywords. Unblocks 6 wasmtk files. **Superseded by entry 25
    (v1.2.9)** — the "fold all instructions into a single body,
    don't model dispatch" shortcut was itself the root cause of a
    later V8-rejection bug; legacy try now builds a real `TryExpr`.

19. **Cosmetic: `undefined func "$$name"` in error messages**
    (v1.1.3). `Var.name` from the lexer already includes the `$`
    prefix; the `addError` calls in `resolve-names.ts` wrapped it
    in `"$${v.name}"`, producing doubled dollar signs (`$$mathlib_exp`)
    in user-facing error messages. Fix: three one-line removals of
    the literal `$` in `addError` calls (undefined-name + undefined-
    label paths). No regression test (cosmetic only); the wasmtk
    corpus output verifies single-`$` formatting at runtime.

20. **Bug D: empty-folded ops drop preceding stack values**
    (v1.1.6, reported by wasmtk-side multi-value-receive idiom).
    `parseFoldedInstr` passed `innerCtx.stmts` directly to
    `buildPlainExpr` regardless of opcode arity. When the user wrote
    `(local.set $x)` / `(drop)` / `(global.set $g)` / `(return)` /
    `(i32.store)` with no inline children, the parser supplied 0
    operands and `buildPlainExpr`'s `op0()` / `op1()` fallback
    inserted `Nop` placeholders — leaving any preceding stack values
    untouched. `flushStack` then appended those orphaned values
    AFTER the empty-folded ops in `stmts`, producing binaries V8
    rejected as "not enough arguments on the stack for X". Critical
    for wasic's multi-value receive idiom:
    `(call $two_returns) (local.set $b) (local.set $a)`.
    Fix: after the sub-expr loop in `parseFoldedInstr`, compute
    `nInputs = instrInputCountForTok(tok)` and fall back to popping
    the deficit from the surrounding `ctx.stack`. For variable-arity
    opcodes (`call` / `return` / `br` / `br_table` / `throw`), if no
    children supplied, drain the surrounding stack (matches linear-
    form behavior). The multi-value case works incidentally because
    the first local.set absorbs the whole CallExpr; subsequent
    local.sets get `Nop` values (runtime no-ops); V8's type validator
    accepts the resulting sequence. Regression coverage:
    `tests/parser/empty_folded.test.ts` (5 cases).

21. **`SimdShuffleOp` / `SimdStoreLane` arity entries in `instrInputCount`
    table were wrong** (v1.1.6, surfaced by Bug D fix). The arity
    table listed `SimdShuffleOp` as 3 and `SimdStoreLane` as 4 (with
    an `// approx` comment), but `buildPlainExpr` only ever reads
    `op0()` and `op1()` for both — `simd_shuffle` takes 2 v128
    operands (left + right), `simd_store_lane` takes 2 (address +
    vec). The wrong arities went unnoticed because the old
    `parseFoldedInstr` passed `innerCtx.stmts` directly (whatever
    count the user supplied); the Bug D fix made the parser respect
    the table, exposing the mismatch. Also added the missing
    `SimdLoadLane` entry (= 2; previously defaulted to 0). Fix in
    `src/parser/wast-parser.ts` `instrInputCount`. Regression
    coverage: existing SIMD bridge tests (`tier_c.test.ts`).

22. **Bug F: `(br_if N (f64.eq (global.get $i) ...))` mis-resolves
    non-first globals** (v1.1.7, surfaced by wasmtk Phase 1 testing
    after v1.1.6 shipped Bug D). The v1.1.6 Bug D fix in
    `parseFoldedInstr` unconditionally padded the operand array with
    `popN(ctx, deficit, loc)` when `innerCtx.stmts.length < nInputs`.
    For `br_if` (`instrInputCount = 2`, cond required + value
    optional) with one inline child, the empty outer stack returned a
    `Nop` placeholder; the parser then built
    `BrIf{cond=Nop, value=CompareExpr}` (swapped relative to spec).
    `resolveNames` only recurses into `BrIf.cond`, not `.value`, so
    the `global.get $i` inside the CompareExpr kept its name var
    unresolved; the binary writer defaulted to index 0. Only fired
    when the global was NOT the first one declared and a folded f64
    compare/etc wrapped the global.get. Variants that worked: `(if
    (f64.eq (global.get $i) ...))` (the if-cond path is separate),
    `(br_if 0 (global.get $i))` (single-child + no f64 wrapper has
    `innerCtx.stmts.length == nInputs` after the Bug D pad), and the
    same pattern with $i as the only global (index 0 happened to be
    correct). Fix: clamp the Bug D fix's pop count to what the outer
    stack actually has —
    `const available = Math.min(deficit, ctx.stack.length); operands
    = available > 0 ? [...popN(ctx, available, loc), ...innerCtx.stmts]
    : innerCtx.stmts;`. Leaves optional-operand ops alone when the
    user supplies the single-child form, while still popping for the
    Bug D scenarios where the outer stack actually has values.
    Regression: `tests/parser/empty_folded.test.ts` "Bug F: (br_if N
    (f64.eq (global.get $i) ...)) resolves $i correctly".

23. **Latent reader bug: `case Opcode.RefEq` built `CompareExpr`
    instead of `RefEqExpr`** (v1.1.9, surfaced by GC Tier 1 work).
    The pre-existing `Opcode.RefEq = 0xd3` case in
    `src/reader/binary-reader.ts` decoded ref.eq as
    `{ kind: 'compare', opcode: Opcode.RefEq, left, right }` — using
    the `CompareExpr` shape for what is semantically a typed-reference
    op. Invisible until a consumer cared about the IR shape (the bridge
    needs to dispatch on `kind` to pick the right binaryen-ts factory).
    GC Tier 1 introduced `RefEqExpr`; the reader case was switched at
    the same time. Pattern lesson: when adding a new ref-typed IR shape,
    audit the reader for any case currently piggybacking on a
    structurally-similar but semantically-different node kind.

24. **Bug G: `call_indirect (type $name)` mis-resolves named types to
    index 0** (v1.2.0, reported by wasmtk Phase 1 work). `resolveNames`
    for `call_indirect` / `return_call_indirect` resolved the `table`
    var but skipped the `typeVar` entirely. Any `(call_indirect
    (type $name) ...)` with a named-but-not-first type silently kept
    the name-var unresolved; the binary writer's `writeVar` fallback
    then emitted index 0 for every named type. Invisible when the
    named type happened to BE index 0; broken otherwise. Numeric
    `(type N)` already worked (already index-kind vars). Critical for
    wasic's higher-order array methods (map / filter / find / reduce /
    …), which compile to named-type `call_indirect` everywhere. Fix:
    new private `resolveTypeVar` helper on `ResolveContext` (mirroring
    `resolveFuncVar` / `resolveTableVar` / etc.); `call_indirect` /
    `return_call_indirect` cases now run `typeVar` through it.
    Regression: `tests/parser/bug_g_repro.test.ts` — round-trip via
    `wasm2wat` shows the right numeric indices, plus a runtime
    instantiate that calls through a `$double` function via `(type
    $i32ret)` and asserts the return value.

25. **Legacy try/catch dropped the dispatch wrapper during encoding**
    (v1.2.9, reported against 1.2.8 via the wasmtk Phase 15 exception
    suite — `15_Exceptions`, `15_panic`, `15_recover`,
    `15_TestCase1-NestedEscalation`). This is the root-cause fix for the
    shortcut taken in entry 18. The WAT parser coerced legacy
    `(try (do …) (catch $tag …))` into a plain `BlockExpr`, merging the
    catch handler instructions into the body and dropping the
    try/catch/catch_all/delegate/end opcode edges. The catch body's
    leading `local.set`s (which the EH runtime feeds from the tag's
    params via the catch edge) then ran on an empty operand stack, so
    V8 rejected the binary ("not enough arguments on the stack for
    local.set @+N"). wasic emits this shape for every TypeScript
    try/catch/throw, so it blocked the entire Phase 15 suite plus any
    production wasmtk program with exception handling.

    The whole rest of the pipeline already handled the `TryExpr` IR node
    (expr-visitor walk, binary writer's try/catch/catch_all/delegate/end
    encoding, binary reader, WAT writer, validator) — only the parser
    refused to build one. Fix:
    + `src/parser/wast-parser.ts`: both the folded
      `(try (do …) (catch …) …)` form and the linear
      `try … catch … end` / `try … delegate $l` form now build a real
      `TryExpr` (`body` + `Catch[]` + optional `delegate`) instead of a
      `BlockExpr`. The linear `try_table` stub (skip-to-`end`) was split
      out and left unchanged.
    + `src/ir/resolve-names.ts`: the `try` case now resolves each
      catch's `tag` (tag scope) and the `delegate` target (label,
      resolved against the *outer* scope after the try's own label is
      popped). Added a `rethrow` case resolving its `depth` like a `br`
      target — addresses the `NestedEscalation` "rethrow not targeting
      catch or catch_all" symptom, which was a downstream effect of the
      erased try scope (numeric depths now match real catch frames; a
      named `rethrow $label` also resolves).
    + `src/writer/wat-writer.ts`: fixed a **second, latent bug** exposed
      once a `TryExpr` with catch bodies finally reached the writer.
      `writeCatch` walked the handler body AND the ExprVisitor's `try`
      case walked `c.body` again, duplicating every handler instruction
      in `wasm2wat` output. Dropped the redundant walk from `writeCatch`
      (the visitor owns it).

    Handler bodies emit a leading `nop` before each stack-consuming op
    (e.g. `nop; local.set`): a folded `(local.set $x)` with no inline
    operand gets a `Nop` value placeholder because at parse time the
    catch body stack is empty, but the runtime's `catch` edge pushes the
    tag's params, so the `local.set` consumes them and the `nop` is
    harmless. (The div-by-zero in the original reproducer is a WASM
    *trap*, not a catchable exception, so it correctly propagates past
    the handler — the catch is for `throw`n tags.) Regression:
    `tests/parser/legacy_try.test.ts` — parse-shape checks (folded /
    linear / catch_all / delegate / multi-catch), V8 compile + run
    checks (throw→catch tag delivery `g()==42`, catch_all, nested
    rethrow→outer handler), and a `wasm2wat` round-trip
    non-duplication check. Note: the binaryen bridge
    (`src/bridge/binaryen-bridge.ts`) still does not map legacy
    `TryExpr` — that path is binaryen-ts-gated and not the production
    encode path for legacy try (the wabt-ts encoder is).

26. **A folded value-producing statement sank past a later `(return …)`**
    (v1.3.0, reported via wasmtk's shared-heap stdlib track). The parser
    builds expression trees with two lists per scope: `ctx.stack` (operand
    values that a following instruction might still consume) and
    `ctx.stmts` (committed statements). `instrProducesValue` returns `true`
    for `call` — conservatively, because the parser can't know the callee's
    arity without its signature — so EVERY call is pushed onto `ctx.stack`.
    A void call at statement position is never consumed as an operand, so it
    lingered on the stack until the enclosing block's end-of-body
    `flushStack`, which appends leftover stack values to the END of
    `ctx.stmts` — i.e. AFTER every genuine statement that followed the call
    in source order. So `(call $f …) (local.set …) (return X)` parsed as
    `local.set; return; call`, sinking the call past the `return` into dead
    code; its side effect (e.g. a cross-function store) never ran. The
    smoking gun was byte-level: jsr body `… 0f 10 00 0b` (`return; call;
    end`) vs npm `10 00 … 0f 0b` (`call; …; return; end`). General
    correctness bug — silently dropped any `sideEffectingCall(); return X;`
    shape; masked in the existing suite only because that shape is rare
    (most side-effecting calls are inlined or feed the return expression),
    but it hard-blocked the shared-heap stdlib track.

    Fix: new module-level `pushStmt(ctx, expr)` helper that drains
    `ctx.stack` into `ctx.stmts` (preserving order) BEFORE committing each
    statement. By the push site, the deficit-fill in `parseFoldedInstr` /
    `parseLinearPlainInstr` has already popped whatever operands the current
    instruction consumes, so any leftover stack values are genuinely in
    statement position and sequenced before `expr`. Routed all 10
    statement-position push sites through it (folded + linear plain instrs,
    and every void block / loop / if / try / try_table). Does NOT touch
    operand consumption, so the Bug D multi-value receive idiom
    (`(call $two) (local.set $b) (local.set $a)`) is unaffected — verified
    by a guard test. Regression: `tests/parser/stmt_order.test.ts` —
    runtime instantiate + observe the store landed, covering the W/X/Y
    characterization (call+arg before explicit return; call before trailing
    fallthrough value; call before `(drop …)` + return), two-call ordering,
    and the multi-value guard. Same commit removed 5 dead private methods
    surfaced by a corpus-wide reference-count sweep: `expectLpar` /
    `parseInlineExports` (`src/parser/wast-parser.ts`), `readU64Leb` plus its
    now-orphaned `decodeU64Leb128` import (`src/reader/binary-reader.ts`),
    and `openNewline` / `writeRefKind` (`src/writer/wat-writer.ts`).

**Affects:** `src/core/opcode.ts`, `src/parser/wast-parser.ts`,
`src/reader/binary-reader.ts`, `src/ir/ir.ts`, `src/ir/expr-visitor.ts`,
`src/ir/resolve-names.ts`, `src/ir/apply-names.ts`,
`src/ir/synthesize-types.ts` (new),
`src/writer/binary-writer.ts`, `src/writer/wat-writer.ts`,
`src/bridge/binaryen-bridge.ts`, `src/tools/wat2wasm.ts`,
`src/validator/type-checker.ts`.
Tooling: `scripts/audit_opcodes.ts` (new),
`scripts/gen_simd_opcode_table.ts` (new). Regression coverage in
`tests/reader/binary-reader.test.ts`, `tests/parser/folded.test.ts`,
`tests/parser/wast-parser.test.ts`, `tests/parser/legacy_try.test.ts`
(new — legacy try/catch, entry 25), `tests/tools/wat2wasm.test.ts`,
`tests/wasmtk/runner.test.ts` (new — 272 wasmtk WAT files), and the
bridge test files.

### Validator SIMD opcode-info — resolved 2026-05-25 (v1.1.3)

**Original gap:** `src/validator/type-checker.ts` `getOpcodeTypeInfo` had
a default `return oi(_V128, _V128, _V128, _V, 0)` for any opcode not in
its explicit switch. SIMD opcodes (0xfd-prefixed) all fell through and
got typed as `(v128, v128) → v128`. Real splat is `i32 → v128`, real
extract_lane is `v128 → i32`, etc. The validator reported type mismatch
on any SIMD function; the Tier C SIMD bridge tests bypassed
`validateModule` and used `WebAssembly.compile` directly.

**Fix (v1.1.3):** added 50+ explicit entries for the opcodes whose
signature differs from the `(v128, v128) → v128` default:

+ splats: i8x16/i16x8/i32x4 (i32 input), i64x2 (i64), f32x4 (f32),
  f64x2 (f64), all producing v128
+ any_true / all_true: (v128) → i32
+ bitmask: (v128) → i32
+ shifts: (v128, i32) → v128
+ v128 → v128 unary family: abs / neg / popcnt / sqrt / ceil / floor /
  trunc / nearest / extend_low/high / extadd_pairwise / convert /
  trunc_sat / demote / promote / v128.not

The default is preserved for the bulk of SIMD ops (lane-wise
add/sub/mul/div/min/max/eq/ne/lt/gt/le/ge/and/or/xor/andnot/etc.) — that
signature is correct for them. Bridge tests no longer need to bypass
validateModule. **Affects:** `src/validator/type-checker.ts`.

### Phase 7 bridge handshake — satisfied as of binaryen-ts v1.0.9

**Date:** 2026-05-25
**Decision:** The "wait for binaryen-ts Phase 2 instruction decoder" milestone
established 2026-05-21 is met. The full instruction-level constructor API
(`makeI32Const`, `makeBinary`, `makeBlock`, all control-flow + memory + ref/GC
constructors) is stable and exported from
`binaryen-ts/src/ir/expressions.ts` as of binaryen-ts v1.0.9. Phase 7 is
unblocked.
**Why:** binaryen-ts has progressed through Phases 0–9 (WAT parser, binary
parser, binary encoder, opt passes, inlining, `wasm-opt` CLI, GC, EH, SIMD)
on top of the Phase 11.x JSR publish hardening. The bridge inherits a richer
constructor surface than originally scoped — GC and EH constructors are
available too.
**Next step (not yet done):** dry-run map a small wabt IR
(a function with const/local.get/i32.add, plus an import, a global, a memory)
onto binaryen-ts constructor calls and confirm the shapes line up before
committing to a full `ExprVisitorDelegate`-driven bridge.
**Affects:** `CLAUDE.md` (binaryang Cross-Project Architecture, Phase 7
detail, phase delivery plan), `README.md` (roadmap row), this file.

### IR expression representation: deferred pending Phase 2
**Date:** 2026-05-21
**Status:** Open — must decide before starting Phase 2.
**Options:**
- A. **Discriminated union** (`{ kind: 'i32.const'; value: number }`) — idiomatic
  modern TypeScript, works well with exhaustive `switch`, tree-shakes cleanly.
- B. **Class hierarchy** — closer to the C++ original, easier to add methods,
  but heavier and less ergonomic with TypeScript's type narrower.
**Recommendation:** Option A (discriminated union) for expression nodes;
plain interfaces for Module/Func/Global top-level IR nodes.

### Binary reader API style: resolved (Phase 3)

**Date:** 2026-05-22
**Decision:** Option A — all sections decoded inline inside a single `BinaryReader` class.
The IR is built directly during decode (no separate delegate layer), with an operand stack
per control-flow frame performing the flat→tree conversion inline.
**Why:** The ExprVisitorDelegate pattern (already in Phase 2) covers the output side.
Adding a second delegate layer for the input would duplicate the pattern without benefit.
A single decoder class reads cleanly from the C++ reference and stays maintainable.
**Affects:** `src/reader/binary-reader.ts` — `BinaryReader` class + `readBinaryIr()` entry point.

### Interpreter (Phase 7) dropped — Deno/Bun provide native wasm execution

**Date:** 2026-05-21
**Decision:** The wasm interpreter is dropped from scope entirely, not just deferred.
**Why:** Deno (V8) and Bun (JavaScriptCore) both include a native wasm JIT. Running wasm
through a TypeScript interpreter would be 10–50× slower with no benefit for the
wasmtk use case. The only scenario that would justify it — a JS runtime with no native
wasm support — is not on the horizon for this project.
**Affects:** `src/interp/` directory is a permanent placeholder only; no code goes there.
Phase 7 removed from the active roadmap.

### wasm-link excluded — wasmtk handles linking via wasmbundler

**Date:** 2026-05-21
**Decision:** `wasm-link` will not be ported.
**Why:** wasmtk already has wasmbundler for linking wasm modules. Duplicating that
capability here would create maintenance overlap with no benefit.
**Affects:** No `src/tools/wasm-link.ts` file.

### wasm-decompiler, wasm2c, spectest-interp, fuzzers excluded

**Date:** 2026-05-21
**Decision:** These four components are out of scope.
**Why:**

- `wasm-decompiler` — not needed for the wasmtk toolchain.
- `wasm2c` — wrong target language; `wasm2ts` is the TypeScript-target equivalent.
- `spectest-interp` — only useful alongside the interpreter, which is dropped.
- Fuzzing harnesses — development tooling for the C++ project; not a public API concern.

**Affects:** No corresponding files in `src/tools/` or `src/`.

### wabt-ts stays pure TypeScript — no wasm compilation of this repo's modules

**Date:** 2026-05-21
**Decision:** wabt-ts does not compile its own modules to wasm.
**Why:** The value of this port is readable, portable TypeScript. Maintaining binary
artifacts alongside source would add a build step, complicate JSR publishing, and provide
negligible performance benefit for build-time tooling. Deno/Bun execute the output wasm;
they don't need wabt-ts itself to be wasm.
**How it plays out:** wasmtk uses `wat2wasm`/`wasm2ts` from this package to compile its own
pure-compute modules to wasm. The `.wasm` files and `wasm2ts`-generated TypeScript wrappers
live in wasmtk's repo, not here.
**Affects:** No `wasm/` folder in this repo. `deno.json` publish config includes no `.wasm`
files. Phase 9 is removed from this project's scope.

### Phase 4 parser: `func` keyword maps to `TokenType.Func`, not `TokenType.Function`

**Date:** 2026-05-22
**Decision:** In the WAT token map, the keyword `func` (used in module field declarations) resolves to `TokenType.Func` — a refkind token carrying `Type.FuncRef` — not to `TokenType.Function`. This matches the C++ `wast-lexer.cc` classification where `func` is treated as a reference kind keyword. Any parser switch on module fields must case on `TokenType.Func` (and optionally `TokenType.Function` as a fallback).
**Why:** `func` appears both as a module-field keyword `(func ...)` and as a reference kind `(ref func)` / `funcref`. The lexer resolves ambiguity at the token level by always classifying it as a refkind. `function` (the reserved JS keyword) maps to `TokenType.Function` and is unused in normal WAT.
**Affects:** `isModuleField()`, `parseModuleField()`, `parseFuncModuleField()` in `wast-parser.ts`; same pattern applies to any future parser code that checks for the `func` field keyword.

### Phase 4 parser: token.ts `LiteralType` name collision

**Date:** 2026-05-22
**Decision:** `token.ts` exports its own `LiteralType` const enum (describing token literal payload variants) which collides with `literal.ts`'s `LiteralType` export (describing parsed literal kinds). Do not `export *` from `token.ts` in `index.ts`. The public API exports only `lexer-source.ts` and `wast-parser.ts`.
**Why:** Both enums have the same name but different semantics. TypeScript's `export *` chaining in `index.ts` produces TS2308 ambiguity errors when both are in scope.
**Affects:** `src/index.ts` — `token.ts` and `wast-lexer.ts` are not part of the public re-export surface.

### `literal.ts` precision note
**Date:** 2026-05-21
**Decision:** f64 hex float parsing uses JavaScript's double arithmetic. Values
with full 52-bit mantissa precision parsed from hex float strings may incur
up to 0.5 ULP of rounding error in the intermediate computation.
**Why:** BigInt-based exact hex float parsing would require significant extra code;
the error is negligible for test-vector workloads. Revisit if the WAT parser
conformance tests reveal failures.
**Affects:** `src/core/literal.ts` — `parseHexFloat()`.

---

## Phase 1 — Core Infrastructure ✅

### Phase 1 source files

- [x] `src/index.ts` — public API entry point with `@module` JSDoc
- [x] `src/core/types.ts` — `Type` enum, `Index`/`Address`/`Offset`, predicates, `typeName()`
- [x] `src/core/binary.ts` — magic bytes, `BinarySection`, limit flags, `ExternalKind`
- [x] `src/core/result.ts` — `Result.Ok/Error`, `succeeded()`, `failed()`, `combineResults()`
- [x] `src/core/feature.ts` — `Features` interface, `defaultFeatures()`, `allFeatures()`
- [x] `src/core/error.ts` — `Location`, `WabtError`, `ErrorList`, `formatError()`
- [x] `src/core/leb128.ts` — all 8 encode/decode functions (u32/u64/s32/s64)
- [x] `src/core/opcode.ts` — all core opcodes (0x00–0xd6), `MiscOpcode` (0xfc group), `opcodeName()`
- [x] `src/core/literal.ts` — integer parsers, float parsers (hex float, inf, nan, decimal), float printers

### Tests (31 tests, 282 steps — all passing)
- [x] `tests/core/binary.test.ts`
- [x] `tests/core/leb128.test.ts`
- [x] `tests/core/literal.test.ts`
- [x] `tests/core/opcode.test.ts`
- [x] `tests/core/result.test.ts`
- [x] `tests/core/types.test.ts`

### Infrastructure
- [x] `deno.json` — scope corrected to `@jrmarcum/wabt-ts`; `publish` section added
- [x] `.github/workflows/publish.yml` — provenance publishing on `v*` tag
- [x] `CLAUDE.md` — Phase 1 status updated

### Known limitations / follow-up
- `literal.ts`: SIMD `v128` literal parsing (hex byte sequences) not yet implemented —
  needed in Phase 4 (WAT parser). C++ reference: `ParseV128Literal` in `literal.cc`.
- `opcode.ts`: SIMD (0xfd group) and threads (0xfe group) opcode tables not yet added —
  needed in Phase 3 (binary reader) and Phase 4. C++ reference: `opcode.def`.
- `error.ts`: `formatError(ErrorFormat.Long)` requires the caller to supply the source
  line text. The WAT lexer (Phase 4) will need to thread that through.

---

## Phase 2 — IR Layer ✅

**Completed:** 2026-05-21. 39 tests passing (315 steps).

### Phase 2 design decisions

- **Expr representation:** discriminated union (`{ kind: 'i32.const'; value: number }`) — see Decisions Log.
- **IR shape:** tree-structured expression nodes + section metadata envelope for binary layout info (byte offsets, raw sizes, section ordering needed for wasm-objdump). Flat stack-machine representation rejected — WAT output and binaryen bridge both require a tree; objdump needs only the metadata envelope.
- **Traversal order:** post-order (children before parent) to map cleanly onto binaryen constructor API.
- **Stack-to-tree algorithm:** operand stack maintained during decode; push leaf nodes, pop operands when building composites. Edge cases to verify in dry-run: multi-value blocks, unreachable code after `unreachable`/`br`/`return`, `br_table` label resolution.
- **Bridge type mapping:** `wabtTypeToValType(t: Type): ValType` lives on the wabt-ts side (see CLAUDE.md for mapping table and full binaryen-ts constructor API reference).

### IR source files

- [x] `src/ir/ir.ts` — Module, Func, Expr discriminated union (50+ variants), Global, Table, Memory, section metadata envelope
- [x] `src/ir/ir-util.ts` — ModuleContext with label stack, LabelType enum, getExprArity
- [x] `src/ir/expr-visitor.ts` — post-order ExprVisitor with optional ExprVisitorDelegate, NopDelegate
- [x] `src/ir/apply-names.ts` — applyNames: apply name-section NameMaps to index-based Vars in IR
- [x] `src/ir/resolve-names.ts` — resolveNames: resolve symbolic name Vars to index Vars with error accumulation
- [x] `src/ir/generate-names.ts` — generateNames: fill unnamed entities with synthetic names (numeric or alpha scheme)

### Tests (39 tests, 315 steps — all passing)

- [x] `tests/ir/ir.test.ts` — Var factories/predicates, BlockType, Const factories, sigEquals, makeModule, totalFuncs/Globals, ExprVisitor (post-order, block, if, abort, visitFunc, NopDelegate), generateNames, resolveNames

### IR C++ references

- `upstream/include/wabt/ir.h` (~2500 lines) — main IR definitions
- `upstream/src/ir.cc`
- `upstream/include/wabt/expr-visitor.h`

---

## Phase 3 — Binary Round-trip ✅

**Completed:** 2026-05-22. 40 tests passing (331 steps, all prior phases included).

### Phase 3 source files

- [x] `src/reader/binary-reader.ts` — full wasm binary decoder → Module IR; `readBinaryIr()` entry point
- [x] `src/reader/binary-reader-ir.ts` — re-export shim preserving C++ source naming
- [x] `src/reader/binary-reader-nop.ts` — re-exports `NopDelegate` as `BinaryReaderNop`
- [x] `src/writer/stream.ts` — `MemoryStream` growable buffer with back-patch support
- [x] `src/writer/binary-writer.ts` — IR → wasm binary encoder; `writeBinaryIr()` entry point

### Tests (16 new tests — all passing)

- [x] `tests/reader/binary-reader.test.ts` — empty module, type section, round-trip add function,
  i32/i64/f32/f64 constants, linear memory, mutable global, function import, block, if/else,
  passive/active data segments, local declarations, section metadata, error cases

### Phase 3 design decisions

- **Single-class decoder:** all section decoding inline in `BinaryReader`; no separate delegate
  for the IR-building path. See Decisions Log.
- **Flat→tree conversion:** per-frame operand stack during `decodeBody`; value-producing
  instructions push to `frame.stack`, statement-level pop operands and push to `frame.stmts`.
  `frame.flush()` produces `[...stmts, ...stack]` as the block body.
- **Block result routing:** nodes go to parent `stack` if `blockResultCount > 0`, else `stmts`.
  Loops always go to `stmts` (their `br` targets the loop header, not the exit).
- **Multi-memory memarg:** bit 6 of the align byte (0x40) signals an explicit `memidx` follows.
- **DataCount section:** always written if `dataSegments.length > 0` (over-inclusive but valid
  for all standard runtimes).

### Binary reader/writer C++ references

- `upstream/src/binary-reader.cc` (~3000 lines)
- `upstream/src/binary-writer.cc`
- `upstream/include/wabt/binary-reader.h`

---

## Phase 4 — WAT Text Format ✅

**Completed:** 2026-05-22. 86 tests passing (522 steps, all phases included).

**Prerequisite for:** `wat2wasm`, `wasm2wat` tools.

### Phase 4 source files

- [x] `src/parser/lexer-source.ts` — source buffer abstraction
- [x] `src/parser/token.ts` — token kinds and token struct
- [x] `src/parser/wast-lexer.ts` — WAT/WAST lexer
- [x] `src/parser/wast-parser.ts` — WAT/WAST parser (`parseWatModule`, `parseWastScript`)
- [x] `src/writer/wat-writer.ts` — IR-to-WAT pretty printer (`writeWatModule()` entry point)

### Phase 4 tests

- [x] `tests/writer/wat-writer.test.ts` — 13 describe groups, 40 assertions; empty module,
  type entries, imports, funcs (const/binary/block/if/else/call), globals, tables, memories,
  exports (standalone + inline), start, data segments, element segments, load/store alignment,
  section ordering
- [x] `tests/parser/wast-lexer.test.ts` — 69 tests; structural tokens, keywords, value types,
  refkinds, core opcodes, extended opcodes (SIMD/atomics/misc), identifiers, strings, numerics,
  align=/offset=, nan patterns, errors, full WAT snippet
- [x] `tests/parser/wast-parser.test.ts` — 17 describe groups; module fields (types, imports,
  funcs, globals, memories, tables, exports, start, data, elem), instruction parsing (folded +
  linear form), const expressions, multiple fields, error handling, WAST script commands

### Dependencies added to Phase 1 at start of Phase 4

- [x] `opcode.ts`: `EXTENDED_OPCODE_NAMES` map + `extendedOpcodeName()` + `anyOpcodeName()`
  covering SIMD (0xfd, ~150 ops), atomics (0xfe, ~50 ops), misc (0xfc, 8 ops)
- [ ] `literal.ts`: `parseV128Literal()` implementation (needed by parser, not writer) — **implement after Phase 5**

### Phase 4 design decisions

- **WAT writer output: linear (unfolded) format.** Each instruction on its own line, children before parent. The post-order ExprVisitor already handles recursion; delegates only emit the opcode and operands for each node, not its children.
- **Block-like expressions:** `beginBlockExpr`/`endBlockExpr` callbacks bracket the body. Indent increases by 2 inside each block; `else` un-indents then re-indents.
- **Inline exports** (default on): the export map is pre-built before module traversal; `(export "name")` appears inline inside `(func ...)` / `(global ...)` etc.
- **Standalone imports** (default): `(import "m" "f" (...))` emitted before all definitions. Inline import mode available via `inlineImport: true` option.
- **`naturalAlignForOpcode`**: maps core load/store opcodes to natural alignment (1/2/4/8 bytes); extended ops default to 1. The `align=N` keyword is omitted when the alignment matches natural.

---

## Phase 5 — Validator ✅

**Completed:** 2026-05-22. 87 tests passing (557 steps, all phases included).

**Prerequisite for:** `wasm-validate` CLI tool (Phase 6), and strengthens `wat2wasm` correctness.

### Phase 5 source files

- [x] `src/validator/type-checker.ts` — operand stack type checker (TypeChecker class); tracks
  value/label stacks; handles unreachable code polymorphism; delegates to opcode type-info table
- [x] `src/validator/shared-validator.ts` — module-structure validator (SharedValidator class);
  resolves local/global/func/table/memory/tag indices; manages local declarations; delegates
  all stack checks to TypeChecker
- [x] `src/validator/validator.ts` — IR-walking validator (ModuleValidator class, ExprVisitorDelegate);
  walks module fields in spec order; calls SharedValidator per instruction; `validateModule()` entry point

### Phase 5 tests (1 new test suite — all passing)

- [x] `tests/validator/validator.test.ts` — empty module, simple arithmetic (accept/reject),
  local variables (param/local/out-of-range), globals (get/set mutability), exports (valid/duplicate/bad-index),
  start function (accept/reject params/results), control flow (block/unreachable/if-else),
  br targeting outer block, direct call (valid/bad-index), type mismatch (wrong operand type),
  multiple errors collected in a single pass

### Phase 5 design decisions

- **Three-layer architecture:** TypeChecker (pure operand/label stack) ← SharedValidator (module state + index resolution + error reporting) ← Validator (IR walk via ExprVisitorDelegate)
- **Operand stack at function entry:** empty. Params are registered as locals (SVLocalDecl), not pushed onto the type stack. This matches the C++ SharedValidator which calls `BeginFunction(results_only)`.
- **TypeChecker error reporting:** error callback pattern — TypeChecker calls `errorCallback(msg)` and the SharedValidator wraps it into `addError(errors, currentLoc, msg)`.
- **`hadError` flag:** helpers that add errors but return a plain value (e.g. `resolveVar`) set `this.hadError`; callers fold it into the final `combineResults()` chain.

---

## Phase 6 — CLI Tool Wrappers ✅

**Completed:** 2026-05-22. 87 tests passing (557 steps, all phases included).

### Phase 6 source files

- [x] `src/tools/wat2wasm.ts` — `wat2wasm(src, opts)` → `{ binary, errors, result }`
- [x] `src/tools/wasm2wat.ts` — `wasm2wat(binary, opts)` → `{ text, errors, result }`
- [x] `src/tools/wasm-validate.ts` — `wasmValidate(binary, opts)` → `{ errors, result }`
- [x] `src/tools/wasm-objdump.ts` — `wasmObjdump(binary, opts)` → `{ text, errors, result }`
- [x] `src/tools/wasm-strip.ts` — `wasmStrip(binary, opts)` → `{ binary, errors, result }`
- [x] `src/tools/wasm2ts.ts` — stub; throws (Phase 8 deferred)

Each file: exports a typed library function + `if (import.meta.main)` CLI block using `Deno.args`.

### Phase 6 design decisions

- **`wat2wasm`**: parse → `resolveNames` → encode. `resolveNames` converts name Vars to index Vars before the binary writer runs.
- **`wasm2wat`**: decode with `readDebugNames: true` → `generateNames` (fill unnamed entities) → `writeWatModule`. No `applyNames` needed — the reader sets names directly on `func.name` etc., and the WAT writer reads those fields.
- **`wasm-validate`**: decode (read errors) → `validateModule` (validation errors) → `combineResults`. Both passes share the same `ErrorList`.
- **`wasm-strip`**: decode with `readDebugNames: false` (keeps name section in `module.customs`) → clear `module.customs` → re-encode.
- **`wasm-objdump`**: decode with `readDebugNames: true` → render `module.sectionMeta` as section header table. Counts derived from module arrays, not `SectionMeta.count` (which is always 0).
- **Library exports in `index.ts`**: tool functions and option/result types exported from the main package entry point under Phase 6.

---

## Phase 6.1 — Pre-publish housekeeping ✅

**Completed:** 2026-05-25. 87 tests still passing (557 steps). No behavioral
change to wat2wasm / wasm2wat / wasm-validate / wasm-objdump / wasm-strip; this
phase tightens publishing safety, eliminates lint debt, and locks in hot-path
performance invariants that future code must preserve.

### Phase 6.1 deliverables

#### JSR / CI hardening

- [x] `.github/workflows/ci.yml` — fmt-check / lint / type-check / test / publish dry-run on every push and PR to `main` (mirrors binaryen-ts CI shape)
- [x] `.github/workflows/publish.yml` — bumped `actions/checkout@v6`, added `contents: write` permission, tag-vs-`deno.json` version verification, `gh release create --generate-notes` after the JSR publish
- [x] `scripts/publish.ts` — developer-side task that pushes the release tag (guards against publishing locally without provenance)
- [x] `deno.json` — added `publish`, `publish:dry`, `ci` tasks; added `@std/expect` to the import map
- [x] License/SPDX setup already correct from Phase 1 (`MIT OR Apache-2.0` — derivative of Apache-2.0 upstream)

#### Lint cleanup — 71 errors → 0

- [x] Removed dead imports across `src/` and `tests/` (~20 symbols)
- [x] Prefixed 14 unused delegate parameters with `_` to satisfy `SharedValidator` / `ExprVisitorDelegate` interface contracts
- [x] Deleted 3 genuinely dead helpers (`blockTypeLoc`, `noLoc`, stale scaffolding locals)
- [x] Replaced `const w = this; w.foo()` aliasing with direct `this.foo()` in `wat-writer.ts` (171 references rewritten; `no-this-alias` rule)
- [x] `interface ValidateOptions {}` → `type ValidateOptions = Record<string, never>` (`no-empty-interface` rule)
- [x] `let kind` → `const kind` in `binary-reader.ts:550` (`prefer-const`)
- [x] Switched `tests/parser/wast-lexer.test.ts` off raw `jsr:` specifiers (`no-unversioned-import`)

#### Performance invariants (Tier 1 + Tier 2)

- [x] **Text codec singletons** — `TextEncoder` / `TextDecoder` hoisted to module-level constants in `stream.ts`, `wat-writer.ts`, `binary-reader.ts`, `lexer-source.ts`
- [x] **`ModuleContext` index maps** — `funcSigsByIndex` and `tagArityByIndex` pre-computed in constructor; `getFuncSig` / `getTagArity` now O(1) instead of O(imports)
- [x] **`WatWriter.nameIndexMap`** — `"kind:name" → idx` map pre-computed in constructor; `resolveVarIndex` now O(1) Map.get instead of two linear scans (imports + defs)

### Phase 6.1 known follow-up

- **`deno fmt --check` reports 35 unformatted files.** Pre-existing as of the
  start of this phase — not caused by the housekeeping work. The new `ci.yml`
  workflow runs `deno fmt --check`, so CI will fail on `main` until either:
  (a) `deno fmt` is run across the repo to reformat in one commit, or
  (b) the `fmt` config in `deno.json` is adjusted to match the codebase's
  actual style (compact `case X: return Y;` on one line, etc.). Pick before
  the first push that should trigger CI.

---

## Phase 6.2 — Release-flow alignment with binaryen-ts ✅

**Completed:** 2026-05-25. First successful JSR publish achieved. No source
behavior change — the work is entirely in the release scripts, CI workflows,
and license metadata. 87 tests still passing.

### Phase 6.2 deliverables

- [x] `scripts/version.ts` — shared helper exporting `DENO_JSON_URL`, `readCurrentVersion()`, `nextVersion()` under the sub-version-capped-at-9 rule
- [x] `scripts/bump_version.ts` — rewrites `deno.json` `version` field, prints `current -> next` and the next-step instructions
- [x] `scripts/publish.ts` — rewritten to stage + commit (only if dirty) + force-tag locally + atomic `git push origin main vX.Y.Z`. Replaces the earlier "refuse on dirty tree" approach, which broke the natural `bump → publish` flow.
- [x] `deno.json` — added `bump` task; `publish` task now invokes `scripts/publish.ts`; `publish:dry` runs `deno publish --dry-run --allow-dirty` for local manifest validation
- [x] `.github/workflows/auto-tag.yml` — safety-net workflow: on every push to `main`, if `deno.json` version has no matching tag, create + push the tag and dispatch `publish.yml` on it
- [x] `.github/workflows/publish.yml` comment updated to record why CI calls `deno publish` directly (subprocess invocation through `Deno.Command` breaks JSR OIDC provenance detection — lesson from binaryen-ts v1.0.6/v1.0.7)
- [x] License switched from compound `"MIT OR Apache-2.0"` to `"MIT"` in `deno.json` and `package.json`; `LICENSE` rewritten to full MIT text + Apache-alternative pointer (JSR rejects compound SPDX expressions)
- [x] `.gitignore` adds `/upstream/`, `/binaryen-ts/`, `/wasmtk/` so editor/search tools skip the submodule working trees (git itself still tracks them via `.gitmodules`)
- [x] First successful JSR publish — see [@jrmarcum/wabt-ts on JSR](https://jsr.io/@jrmarcum/wabt-ts)

### Phase 6.2 known footgun (recorded so we don't recur)

`deno task publish` is for **local use only.** CI invokes `deno publish`
directly. If a future contributor "consolidates" the workflow to call
`deno task publish`, every release will be flagged "No provenance" on JSR
because `Deno.Command("deno publish")` does not propagate the OIDC token
correctly. The publish workflow has a comment explaining this — keep it.

---

## Phase 7 — binaryen Bridge 🟡 In progress

**Status:** MVP shipped 2026-05-25. The bridge round-trips the canonical
Phase 7 starter module (`(module (import ...) (global ...) (memory 1) (func
... local.get / i32.add) (export ...))`) through binaryen-ts's encoder back
into a wabt-ts-validated wasm binary. Expression coverage will expand
kind-by-kind.

### Phase 7 deliverables (so far)

- [x] `src/bridge/type-map.ts` — `wabtTypeToValType(t: Type): ValType`
- [x] `src/bridge/binaryen-bridge.ts` — `bridgeToBinaryen(module): WasmModule`, direct post-order recursion
- [x] `tests/bridge/dry_run.test.ts` — end-to-end round-trip via parser → bridge → binaryen-ts encoder → wabt-ts decoder + validator
- [x] `@jrmarcum/binaryen-ts@^1.0.9` added to `deno.json` imports (`/ir` and `/encoder` subpath maps)
- [x] **Tier A** — 18 expression kinds: `const`, `local.get`/`set`/`tee`, `global.get`/`set`, `unary`, `binary`, `compare`, `convert`, `drop`, `return`, `nop`, `unreachable`, `block`, `loop`, `if`/`else`, `br`, `br_if`, `br_table`. Label-stack + `bridgeBlockType` + `withDeclaredType` machinery added to handle name-based break targets and the early-exit-block type inference quirk. 9 tests in `tests/bridge/tier_a.test.ts`.
- [x] **Tier B** — 7 more expression kinds: `call`, `call_indirect`, `select`, `load`, `store`, `memory.size`, `memory.grow`. Added `funcSigs` + `tableNames` to `BridgeCtx`; `synthesizeAnonymousNames` post-processor for empty wabt names → `$F0` / `$G0` / `$T0`; `alignBytesToExponent` (wabt stores bytes, binaryen-ts encoder expects exponent); `loadInfo` / `storeBytes` opcode→info tables. 8 tests in `tests/bridge/tier_b.test.ts`.
- [x] **Tier C (partial)** — `ref.null` (with name-var → ValType mapping for `funcref`/`externref`/`func`/`extern`), `ref.func` (uses canonical funcNames), `ref.is_null`, `v128.const` (added in v1.0.5; verified flows cleanly), SIMD splat (via existing `unary` case — wabt classifies it as UnaryExpr), lane-wise SIMD arithmetic (via existing `binary`/`unary`), `simd_lane_op` extract variants (`makeSIMDExtract`), `simd_shuffle` (`makeSIMDShuffle`). 9 tests in `tests/bridge/tier_c.test.ts`. Bridge now covers ~35 expression kinds. **SIMD tests compile through V8's native validator** because wabt-ts's own validator has no opcode-info entries for SIMD ops (defaults `(v128, v128) → v128`, which mis-types splat); fixing the validator's SIMD coverage is a separate future task.
- [x] **Tier C — SIMD memory ops** (2026-05-25 follow-up): `load_splat` / `load_zero` / `simd_load_lane` / `simd_store_lane` cases added. The WAT lexer routes every `v128.load*_splat` / `v128.load*_zero` / `v128.load*x*` to `TokenType.Load` (→ `LoadExpr`), so the bridge's `load` case routes 0xfd-prefix opcodes through `makeSIMDLoad`. New dedicated cases also exist for binary-reader IR (`LoadSplatExpr`, `LoadZeroExpr`, `SimdLoadLaneExpr`, `SimdStoreLaneExpr`). 7 tests in `tests/bridge/tier_c.test.ts`. **Plain `v128.load` is intentionally not covered** — binaryen-ts v1.0.9's encoder `loadOpcode()` has no `ValType.V128` branch, so `makeLoad(16, …, V128)` silently emits `i64.load`. Surfaced as a separate binaryen-ts gap; revisit when binaryen-ts grows a SIMD-aware factory.
- [x] **Tier C — EH** (2026-05-25 follow-up): tag defs (`bridgeTag` + `module.tags` walk), `throw`, `throw_ref`, `try_table` cases. `tagNames: string[]` added to `BridgeCtx` (synthesizes anonymous tags as `$E0`, `$E1`, …). `buildCatchClause` maps the four `CatchKind` variants (Catch / CatchRef / CatchAll / CatchAllRef) onto binaryen-ts's `CatchClause { tag, dest, isRef }`. 3 tests in `tests/bridge/tier_c.test.ts` (throw with no operands, throw with i32, throw with i32+i64). **`try_table` / `throw_ref` tests are blocked by a wabt-ts parser limitation** — `parseLinearBlockInstr` and the folded variant currently coerce `try_table` to a plain `BlockExpr` and reject `(catch ...)` clauses with "expected ), got (". Bridge handlers exist for the moment when the parser lands the catches. **Tag imports and tag exports still throw** because binaryen-ts v1.0.9 has no `addTagImport` and `WasmExport.kind` doesn't include `"tag"`.
- [x] **Tier D — module-level coverage** (2026-05-28): memory exports
  (`addExport(..., "memory")`), table exports (`addExport(..., "table")`),
  active + passive data segments (`addDataSegment` / `addPassiveDataSegment`).
  Added `memoryNames: string[]` to `BridgeCtx` (parallel to funcNames /
  globalNames / tableNames / tagNames); `synthesizeAnonymousNames` now
  synthesizes `$M0` / `$M1` / … for anonymous memories. `bridgeImport` for
  memory now uses the canonical ctx name (was passing the raw import name,
  which broke memory-export lookup). New `bridgeDataSegment` helper handles
  active (with single-expression constant offset, multi-memory rejected) +
  passive; `declared` segment kind silently skipped (meaningless for data).
  10 tests in `tests/bridge/tier_d.test.ts` (memory + table exports,
  passive + active data segments, segment offset via imported global,
  combined module-level features). Bridge now covers all module-level
  surface except element segments + start (both blocked by binaryen-ts gaps).
- [ ] **Tier C (still deferred)** — `ref.as_non_null` (binaryen-ts has no factory), GC (`struct.*`, `array.*`, `ref.eq`, `ref.i31`, `i31.get`). SIMD `replace_lane`, `try_table` end-to-end, and bare-offset elem segments shipped in v1.1.3.
- [ ] **Tier D (still deferred)** — Element segments (`addElement` factory missing from binaryen-ts v1.0.9); start function (no `setStart`); tag exports (no `"tag"` variant on `WasmExport.kind`).

### Bridge design (locked in)

- **Direct recursion, not `ExprVisitorDelegate`-driven.** binaryen-ts
  constructors are bottom-up (children passed into composites). A recursive
  `bridgeExpr(e, ctx)` falls out cleanly; a delegate-driven walk would need
  its own operand stack to reassemble the tree, which is strictly more
  complex with no benefit. The earlier CLAUDE.md sequencing note that
  mentioned `ExprVisitorDelegate` was wrong — recursion is the right shape.
- **No intermediary format.** The bridge calls binaryen-ts constructors
  directly. No third IR.
- **`makeI64Const` takes `bigint`, not `number`** — handled in `bridgeConst`.

### Findings surfaced by the MVP / Tier A / Tier B / Tier C + wasmtk integration

Each round-trip test exercises the full pipeline (WAT parser → IR →
synthesizeTypes → bridge → binaryen-ts encoder → wabt-ts reader → wabt-ts
validator) and has caught real bugs that no narrower test exercised. For
the latest comprehensive list with file paths and regression-test
references, see the **Latent wabt-ts bugs surfaced by Phase 7 bridge
work + wasmtk integration** entry in the decisions log above (eight bugs
fixed across v1.0.3 → v1.0.7).

The short summary, grouped by what surfaced them:

- **MVP** — `readCodeSection` off-by-one; f32/f64 bit-vs-value
  representation mismatch.
- **Tier B** — `Load`/`AtomicLoad` arity-2 misclassification;
  load/store `align` unit mismatch (bytes vs. log2 exponent);
  `readTableSection` extension-peek byte misalignment.
- **wasmtk-driven** (v1.0.4–v1.0.7) — folded-form parser sub-expr loop
  ran before immediate consumption; function-local names silently
  discarded; `flushStack` reversed operand order;
  `synthesizeTypes` pass missing; `resolveNames` default case didn't
  recurse into operand children.

Known but not fixed:

- **Validator SIMD opcode-info gap.** `getOpcodeTypeInfo` defaults
  unknown opcodes to `(v128, v128) → v128`, mis-typing every SIMD op.
  Bridge produces correct binaries; V8 validates them; wabt-ts's own
  validator does not. Tier C SIMD tests bypass `validateModule` and
  use `WebAssembly.compile` directly.

### Expansion plan (tier-by-tier)

Each tier is independent — add a `case` in `bridgeExpr` (or a helper) and a
test in `tests/bridge/`. Throw with the expression kind named on any kind
not yet covered, so adding support means moving a throw to a case.

- **Tier A — core compute + control flow.** ✅ Done (2026-05-25).
- **Tier B — common patterns.** ✅ Done (2026-05-25).
- **Tier C — proposal-gated.** ✅ Partial (2026-05-25). Done: ref.null,
  ref.func, ref.is_null, v128.const, SIMD splat / lane-wise arith
  (via unary/binary), extract_lane, shuffle, SIMD memory ops
  (load_splat, load_zero, simd_load_lane, simd_store_lane), tag defs +
  throw + throw_ref + try_table cases. Deferred: ref.as_non_null,
  SIMD replace_lane, plain v128.load (binaryen-ts gap), try_table /
  throw_ref end-to-end tests (wabt-ts parser doesn't accept `(catch …)`
  clauses yet), tag imports + tag exports (binaryen-ts gap), GC. Each
  deferred kind throws "not yet supported" with the kind named.

### Bridge gotchas — running list (cumulative through Tier C)

1. **`makeBlock` / `makeIf` infer type from last child.** Early-exit blocks
   (last child is `br` / `return` / `unreachable`) come out typed as
   `unreachable`, which the encoder writes into the binary block_type slot
   verbatim — wrong when the WAT declares a result type. The bridge
   overrides via `withDeclaredType(expr, declared)`. Same fix-up applies
   to any new block-like constructor (`try_table` when EH lands).
2. **Compare → binary, convert → unary.** binaryen-ts has no
   `makeCompare` / `makeConvert`; `BinaryOp` / `UnaryOp` enum values are
   identical to wabt's `anyOpcodeName()` strings. One-line cases. Same
   trick works for SIMD lane-wise arithmetic and SIMD splat (the latter
   is classified as UnaryExpr by wabt, splat is a unary op in binaryen).
3. **`makeIf` has no label slot.** Labeled `if` targeted by `br` would
   silently lose its name; the bridge throws on `IfExpr.label !== ''`.
   Revisit when binaryen-ts grows a label slot or when a wasmtk-generated
   module needs labeled `if`.
4. **Block label names are stringly-typed in binaryen-ts.** A
   `BridgeCtx.labelStack: string[]` translates wabt's depth-based br
   targets to binaryen-ts's name targets. Anonymous blocks (empty label)
   get synthetic `$L0`, `$L1`, … via `nameForLabel`. Same will apply to
   `try_table` catch labels when EH lands.
5. **Align unit conversion.** wabt-ts IR stores `align` in bytes;
   binaryen-ts's encoder writes the wasm `memarg.align` exponent. The
   bridge's `alignBytesToExponent` does the `Math.log2`. Apply to any
   memory-touching instruction (SIMD load/store ops in the deferred
   Tier C subset, atomics, etc.).
6. **Anonymous-item names.** binaryen-ts cross-references items by
   string name. `synthesizeAnonymousNames` fills empty wabt names with
   `$F0` / `$G0` / `$T0`. Tags (EH) and heap types (GC) will need the
   same treatment when those tiers land.
7. **f32/f64 const are bits in wabt, value in binaryen-ts.** wabt-ts
   `Const` stores `bits: number` (f32) / `bits: bigint` (f64) — the raw
   IEEE 754 bit pattern. binaryen-ts `makeF32Const(value)` /
   `makeF64Const(value)` take the actual float. `bridgeConst`
   reinterprets via a shared buffer.
8. **`makeCall(target, operands, resultType)` only supports ≤ 1 result.**
   The bridge throws "multi-value call not yet supported" if a wabt sig
   has `results.length > 1`. Same for `makeCallIndirect`.
9. **`call_indirect` table arg is a string name in binaryen-ts.** The
   bridge looks up the table name from `ctx.tableNames` (which
   `synthesizeAnonymousNames` populated with `$T0` for an anonymous
   `(table 1 funcref)`).
10. **`ref.null` refType is a name-var.** wabt parses `(ref.null
    funcref)` / `(ref.null extern)` as `RefNullExpr { refType: Var
    { kind: 'name', name: "funcref" | "extern" | … } }`. The bridge's
    `refTypeVarToValType` translates to a binaryen-ts `ValType`.

Out of scope (each currently throws with a clear "not yet supported"):
element segments, data segments, exports of memory / table / tag, start
function, custom sections.

### Reference: stable constructor surface

See `CLAUDE.md` → "binaryang Cross-Project Architecture" → "binaryen-ts
constructor API" for the authoritative reference. Read
`binaryen-ts/src/ir/expressions.ts` and `binaryen-ts/src/ir/module.ts`
directly when adding new cases — the CLAUDE.md snippet is illustrative,
not exhaustive.

---

## Phase 8 — wasm2ts (New Module) ⬜ — deferred pending wasmtk QA/QC

New work — no C++ counterpart. Modeled on `wasm2c` (`upstream/src/c-writer.cc`)
but targets TypeScript output.

### Phase 8 source files

- [ ] `src/writer/ts-writer.ts` — wasm-to-TypeScript code generator

### Design notes

- Input: binary wasm module parsed via Phase 3 reader
- Output: idiomatic TypeScript class with typed imports/exports interface
- Wasm → TypeScript type mapping: see CLAUDE.md Phase 8 section

### wasmtk reverse-compilation reference

wasmtk (`wasmtk/` submodule, `https://github.com/jrmarcum/wasmtk.git`) already
compiles TypeScript → WAT. wasm2ts is the reverse of that pipeline:

```text
wasmtk:  TypeScript  →  WAT  →  wasm binary
wasm2ts: wasm binary →  IR   →  TypeScript
```

**Key design principle:** wasm2ts output should be TypeScript that wasmtk can
compile back to equivalent WAT. Study `wasmtk/` to understand:

- What TypeScript patterns wasmtk recognises (functions, exports, imports, globals)
- What WAT each pattern compiles to
- Use those same mappings in reverse for wasm2ts code generation

This creates a useful round-trip verification: TS → WAT (wasmtk) → wasm → TS
(wasm2ts) → WAT (wasmtk) should produce semantically equivalent WAT at each
cycle. Any divergence in the second WAT output is a code-gen bug.

### C++ reference

- `upstream/src/c-writer.cc` — structural model (replace C emit with TS emit)
