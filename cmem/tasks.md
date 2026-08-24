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
| T9.8 | One-armed `if` arity; try_table catch-clause label types | done — assert_invalid 2632 → 2641/2737 |
| T9.9 | Immediate-vs-immediate rules, and local-init tracking | done — assert_invalid 2641 → 2658/2737 |
| T9.10 | The last invalid modules V8 rejects that we did not | done — **ours: 0 remaining** |
| T10.1 | Export ORDER not preserved across a `wasm2wat` round-trip | done — round-trip 1961 → 2041 / 2120 |
| T10.2 | Inline `(export …)` emitted on IMPORTED items — unparseable output | done (same fix) — hard failures 12 → 1 |
| T10.5 | Linear-form `call` drained the whole operand stack | done — WASI corpus 50 → 225 / 270 |
| T10.8 | A synthesized operand slot-filler was written out as a real `nop` | done — WASI corpus **270 / 270** |
| T9.11 | Ten of the twelve memarg handlers never checked the offset | done — 4 SIMD false-accepts closed |
| T12.1 | Out-of-range integer and float constants silently truncated/overflowed | done — malformed 666 → 698 / 1229 |
| T12.2 | An import after a definition was accepted and silently RENUMBERED the module | done — malformed 698 → 714 / 1229 |
| T12.3 | A non-power-of-two `align=N` was accepted and silently CHANGED | done — malformed 714 → 828 / 1229 |
| T12.4 | SIMD lane immediates and `v128.const` lane values wrapped silently | done — malformed 828 → 869 / 1229 |
| T12.5 | A wasm NAME must be valid UTF-8 — neither path checked | done — quoted 869 → 1045, **binary 110 → 638** |
| T12.6 | A missing lane immediate compiled as lane 0; NaN result patterns accepted as literals | done — quoted 1045 → 1087 |
| T12.7 | Annotations skipped at the CHARACTER level; a closing label and an inline signature both read and discarded | done — quoted 1087 → **1183**; closes T12.6 |
| T12.8 | The binary reader resynchronised instead of reporting | done — binary 638 → **711 / 711**, the metric is CLOSED |
| T12.9 | Duplicate ids, `nan:0x0`, lane immediates, token boundaries, a second `(start …)`, forward type uses | done — quoted 1183 → **1227 / 1229** at the parser, **1229 / 1229** through `wat2wasm` |
| T10.3 | A non-nullable table element type lost its initializer | done — testsuite 2088 → 2102 / 2120 |
| T10.6 | Linear `try_table` was a stub; `array.new_fixed` drained the stack | done — testsuite 2102 → 2111 / 2120 |
| T10.7 | Tag type matched by identity, so a typed-ref param made encode THROW | done — hard failures 1 → 0 |
| T10.4 | NaN payloads mangled; `return_call_indirect` lost its table index | done — **round-trip 2120 / 2120** |

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

Everything remaining WAS round-trip fidelity (T10) plus the two T9 items.
**All of it is closed as of 2026-08-24** — see "T10 IS CLOSED" below.

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

**Re-measured 2026-08-21 after the whole T9/T11 sequence: 159 differing
modules, 26 V8-invalid after round-trip.** The seven groups below still
describe it; T10.3 grew (it now covers the elem/array modules T7.11 made
encodable) and T10.6 shrank as the validator work fixed some of the same
producers. Re-run the harness before starting any of them.

This WAS the only campaign metric with open work. **It is exhausted too as of
2026-08-24** — 2120/2120 on the spec testsuite and 270/270 on the wasmtk WASI
corpus. The seven groups below are kept for the record of what each one was
and how it was actually diagnosed; every row is struck through.

**No binaryen-ts involvement, so T10 has no upstream dependency.** The
round-trip path is wabt-ts end to end — `wasm2wat` is our `readBinaryIr` →
`generateNames` → our `writeWatModule`, and `wat2wasm` is our `parseWatModule`
→ `resolveNames` → `synthesizeTypes` → our `writeBinaryIr`. binaryen-ts is
imported in exactly two files, both under `src/bridge/`, which this path never
touches. That matches agreed decision #2 (*binaryen-ts encoder = canonical for
optimized wasm; wabt-ts encoder = format tools and round-trip fidelity only*) —
round-trip fidelity is explicitly ours. T10.1 lives in `wat-writer.ts` and
T10.5 in `binary-reader.ts`; neither is blocked on the upstream findings or on
re-verifying the stale submodule pin.

Classified by evidence (differing binary SECTION + V8 rejection message +
sampled diffs), not by guessing. Some of these may fall out of the remaining
T7 work; re-measure before starting any of them.

| id | Cause | Modules / files | Severity |
| --- | --- | --- | --- |
| ~~**T10.1**~~ | **CLOSED 2026-08-24.** **Export ORDER was not preserved.** The WAT writer attached exports inline to the item they name, so re-parsing rebuilt the export section grouped per item — `a, b, ac` came back as `a, ac, b`. Export order is observable through `WebAssembly.Module.exports()`. `buildExportMap` now tests the abbreviation before using it and falls back to standalone `(export "n" (func $f))` fields in the module's own order. | 69 / 21 | closed |
| ~~**T10.2**~~ | **CLOSED 2026-08-24, same fix.** The writer emitted the inline `(export …)` abbreviation on IMPORTED items, e.g. `(import "M" "f" (func $f0 (export "Mf.call") (result i32)))`. That abbreviation has no place in the import grammar, so **our own parser rejected our own output** — the whole "reparse FAILS" group. | 11 / 6 | closed |
| ~~**T10.3**~~ | **CLOSED 2026-08-24.** The WAT writer dropped `Table.init`, so a non-nullable element type re-encoded to the plain form the spec forbids (there is no default value for it) and V8 rejected the result. New `writeFoldedConstExpr` emits the single folded instruction the table grammar requires, and the writer now THROWS rather than dropping anything it cannot express. | 10 / 4 | closed |
| ~~**T10.4**~~ | **CLOSED 2026-08-24.** The WAT writer stripped the quiet bit before printing a NaN payload, so `f32.const` bits 0x7fffffff came back as 0x7fbfffff — a QUIET NaN turned SIGNALLING. `nan:0x<n>` names the mantissa exactly; the printer was the inverse of a parser nothing calls. | 11 / 6 | closed |
| ~~**T10.5**~~ | **MOSTLY CLOSED 2026-08-24.** Diagnosed wrong for the whole campaign: the dominant producer was not the binary reader but the PARSER — linear-form `call` drained the entire operand stack instead of popping the callee's arity, so a value belonging to a later instruction was swallowed and that instruction's slot got a Nop. Fixed by deferring function-body parsing until every signature is known. What remains is the genuine multi-value case, refiled as **T10.8**. | 39 / 33 | closed → T10.8 |
| ~~**T10.6**~~ | **CLOSED 2026-08-24, and it was two parser bugs rather than a Nop problem.** Linear `try_table` was a stub that skipped its catch clauses AND its body to the matching `end` and built a plain `BlockExpr` (3 modules); `array.new_fixed` drained the operand stack instead of taking its immediate element count (1 module). | 9 / 7 | closed |
| ~~**T10.8**~~ | **CLOSED 2026-08-24.** A multi-result producer is ONE node on the decoder's operand stack, so a second consumer got a Nop stand-in that both writers then emitted as a real instruction. `NopExpr.placeholder` now marks a synthesized slot-filler and neither writer emits one — it means "the value is already on the stack", which wasm spells by writing nothing. | 45 files | closed |
| ~~**T10.7**~~ | **CLOSED 2026-08-24.** `tagTypeIndex` compared signature params with `===`, so two structurally identical `(ref $t)` params never matched and a well-formed module made the encode THROW — with `[object Object]` in the message, because the diagnostic cast each param to a number. The `align64` LEB overflow had already been fixed earlier in the campaign. | 2 / 2 | closed |

**Round-trip fidelity against the WASI corpus is now 270 / 270.** The whole
`+nop` family is gone from the spec testsuite too; what is left there is
exactly T10.3 (14 modules, `table`), T10.4 (13, NaN payloads), T10.6 (4,
`INVALID code`) and T10.7 (1 throw).

## T10 IS CLOSED - round-trip fidelity is 2120 / 2120 (2026-08-24)

All four campaign metrics are now exhausted:

| metric | campaign start | now |
| --- | --- | --- |
| parse-clean | 107 / 257 | **257 / 257** |
| fully V8-valid | 180 / 257 | **257 / 257** |
| validator agreement | 1702 / 2120 | **2120 / 2120** |
| `assert_invalid` rejected | 2395 / 2737† | **2664 / 2683** (all 19 left are ones V8 accepts) |
| **round-trip byte-identical** | 1942 / 2105 | **2120 / 2120** |
| **wasmtk WASI corpus round-trip** | 1 / 270 | **270 / 270** |

**T10.7 - done 2026-08-24.** `tagTypeIndex` in the binary writer resolves the
type-section entry matching a tag's signature, and compared the params with
`===`. A `ValueType` is an abstract `Type` - a number, where identity IS
equality - OR a typed reference, which is an OBJECT. So two structurally
identical `(ref $t)` params compared unequal, nothing matched, and the writer
took its fail-loud branch on a well-formed module. `valueTypeEquals` had been in
`ir.ts` all along; this was one more site the T7.4 ValueType refactor did not
reach, the same family as the `select` annotation still being cast to a byte.

The `[object Object]` in the message was the second half, and the reason it
stayed a mystery: the diagnostic rendered each param with
`(p as number).toString(16)`, so the one output that could have named the cause
named nothing. **A fail-loud path is only as useful as what it prints** - the
T9.5 rule ("a validator failure must REPORT") has a writer-side twin.

**T10.4 - done 2026-08-24, and it was the printer that was wrong.**
`printF32Literal` stripped the quiet bit before emitting the payload, on the
stated theory that "the parser always ORs it back in". TWO parsers disagreed:

| function | behaviour |
| --- | --- |
| `src/core/literal.ts` `parseF32Literal` | forced the quiet bit ON |
| `src/parser/wast-parser.ts` `parseF32LiteralBits` | read the payload EXACTLY |

The second is the one `wat2wasm` calls, and the one the spec agrees with:
`nan:0x<n>` names the mantissa exactly, with no special treatment of the quiet
bit - `float_literals.wast` writes both `nan:0x400000` (which IS the canonical
quiet NaN) and `nan:0x7fffff`. **So the printer was the exact inverse of a
function nothing called**, and `f32.const` bits 0x7fffffff round-tripped to
0x7fbfffff: valid wasm, different value, same class as T9.1. Both `literal.ts`
halves now match the spec and the WAT parser, and a print/parse round-trip over
every payload shape is asserted.

Fixed alongside, the LAST differing module: the WAT writer never emitted
`return_call_indirect`'s TABLE index. It did not fail to reparse -
`parseVarOpt` defaults it to 0 - so every `return_call_indirect` against a
table other than 0 came back pointing at table 0. `call_indirect` two cases
above it in the same switch writes the index; this one just did not. Bug G's
lesson at the writer instead of the resolver.

### What T10 cost, and what it was worth

Seven filed items became nine real bugs, and **three of the seven were
misdiagnosed**:

- **T10.5** was filed against the binary reader; the dominant cause was the
  PARSER draining the operand stack for `call`.
- **T10.6** was filed as a Nop problem; it was a `try_table` parser stub plus
  `array.new_fixed` draining the stack.
- **T10.8** did not exist as an item at all - it was folded into T10.5's
  description and turned out to be 45 of the 60 affected files on its own.

The classification had been done once, carefully, months of work earlier, and
carried forward as fact. Re-measuring each item before starting it cost one
~40-line harness apiece.

**Two corpora, and neither could see everything.** T10.1 and T10.5 lived almost
entirely in the wasmtk WASI corpus (100% and 82% of its differences, against 43%
and 30% of the testsuite's). T10.3, T10.4, T10.6 and T10.7 did not occur in real
WASI modules at all. Either corpus alone would have called the work finished
somewhere in the middle.

**T10.6 - done 2026-08-24, and it was not a Nop problem at all.** The item was
filed as "the same Nop substitution applied to an instruction that genuinely
needs its operand". Reproducing it found two unrelated parser bugs:

1. **Linear `try_table` was a stub** - 3 of the 4 modules (throw_ref.wast#0,
   try_table.wast#1, try_table.wast#2). It skipped the catch clauses AND the
   body to the matching `end` and built a plain `BlockExpr`. The reason the
   body came out EMPTY rather than merely un-caught: catch clauses are
   parenthesised IMMEDIATES that come before the body, and `parseInstrList`
   stops at the first `(catch ...)` because a catch clause is not an
   instruction. **Our own `wasm2wat` emits linear form**, so a round trip
   silently gutted any module using `try_table` - V8 said "expected 1 elements
   on the stack for fallthru, found 0", because the block's declared result had
   nothing left to produce it. The linear branch now reads the clauses with the
   same `parseTryTableCatch` the folded branch uses, so the two cannot drift.

2. **`array.new_fixed` drained the operand stack** - array.wast#3. Same class
   as T10.5's `call`, except the arity needs no module context whatsoever: it
   is the SECOND IMMEDIATE (`array.new_fixed $T N elem1 ... elemN`). V8 named it
   exactly: `array.new_fixed[0] expected type f32, found local.get of type
   i32`.

**A "linear form is a stub" comment is a round-trip bug waiting to happen in
this codebase**, because the WAT writer is linear-only - anything the parser
only supports folded is unreachable from our own `wasm2wat` output. Worth
grepping for the next one.

| metric | before | after |
| --- | --- | --- |
| spec testsuite byte-identical | 2102 / 2120 | **2111 / 2120** |
| differing modules | 18 | **9** |
| files affected | 10 | **6** |
| V8-invalid after round-trip | 5 | **1** |
| WASI corpus | 270 / 270 | 270 / 270 |
| parse-clean, V8-valid, agreement, assert_invalid | - | all unmoved |

Regression test: `tests/parser/linear_try_table.test.ts` (8 cases; 6 fail on
the pre-fix parser, and 2 are guards - the folded form and a folded
`array.new_fixed` must keep working).

**T10.3 — done 2026-08-24.** The binary reader already captured `Table.init`;
the WAT writer dropped it, with a `NOTE (T10.3)` at the drop site explaining
why. The blocker was real: this writer is LINEAR (post-order) by design, and
the table grammar takes ONE FOLDED instruction there with no `(item …)` /
`(offset …)` wrapper to hold a linear sequence — wrapping the linear output in
parens reparses as a folded expression with a bogus operand.

`writeFoldedConstExpr` supplies the folded form. Two decisions kept it from
becoming a second copy of the instruction set:

- **It handles CONSTANT expressions only**, and that grammar is closed by the
  spec — const family, `ref` forms, `global.get`, extended-const arithmetic, GC
  allocations — the same list the validator's constant-expression check
  enforces (T9.6). Surveying the testsuite first showed why that is enough:
  across every `Table.init` in all 257 files there are six shapes, 22 of 23 are
  a single LEAF instruction, and the only nested one is
  `ref.i31 (global.get $g)`.
- **The instruction's own text still comes from the ordinary delegate.** An
  `onXExpr` callback writes a node's opcode and immediates and never touches
  its children — the post-order visitor is what supplies those — so folding
  needs the operand ORDER and nothing else. No immediate formatting is
  duplicated.

And the drop is now **fail-loud**: a table initializer the folded emitter
cannot express throws instead of vanishing, which is the behaviour that let
this hide in the first place.

| metric | before | after |
| --- | --- | --- |
| spec testsuite byte-identical | 2088 / 2120 | **2102 / 2120** |
| differing modules | 32 | **18** |
| files affected | 14 | **10** |
| V8-invalid after round-trip | 15 | **5** |
| WASI corpus | 270 / 270 | 270 / 270 |
| parse-clean · V8-valid · agreement · assert_invalid | — | all unmoved |

The whole `table` group is gone. Remaining: T10.4 (13 modules, NaN payloads),
T10.6 (4, INVALID code) and T10.7 (1 throw).

Regression test: `tests/writer/table_init.test.ts` (6 cases; 5 fail on the
pre-fix writer, and the sixth is the guard that a table with NO initializer is
left alone).

**T10.8 — done 2026-08-24.** The residue of T10.5, and the part its original
description actually named. Both decoders build a TREE from a stack machine, so
every operand slot has to be filled; when the value is not on the decoder's
operand stack the slot got a bare `{ kind: 'nop' }`. The commonest reason is a
multi-result producer — `call $two` is ONE node however many values it pushes,
so the first `local.set` takes the call and the second is left with nothing.

`NopExpr.placeholder` now marks a synthesized slot-filler, `operandPlaceholder(loc)`
is the one way to build one, and NEITHER writer emits it: a placeholder means
"the value is already on the stack", which wasm spells by writing nothing.

**Marking only the obvious site was worth 45 of the 60 files.** The first pass
converted `popN` in both decoders and the ~95 `stack.pop() ?? nop` sites in the
reader, and took the corpus to 270/270 — but the spec testsuite only to
2074/2120. The parser makes placeholders in **13 more places**: `buildPlainExpr`'s
`op0()`…`op4()` accessors, the two folded-`if` condition slots, and four
`operands[operands.length - 1] ?? …` callee slots. Converting those took the
testsuite to **2088/2120** and files affected from 27 to 14. When a marker has
to be applied at every construction site, grep for the literal — do not assume
the helper is the only one.

**The T11 no-repair rule is what shapes the design.** Skipping ALL nops in an
operand slot would have been simpler, but `(local.set $x (nop))` is invalid
wasm a user can write, and eliding its operand could turn it valid. So the
marker distinguishes a synthesized slot-filler from a `nop` the source really
wrote, and only the former is dropped. Verified both ways: `assert_invalid` is
unmoved at 2664/2737, and three hand-built invalid shapes (a starved
`local.set`, an explicit `(nop)` operand, a starved `i32.add`) are still
rejected by V8 AND by our validator.

| metric | before | after |
| --- | --- | --- |
| **wasmtk WASI corpus byte-identical** | **225 / 270** | **270 / 270** |
| spec testsuite byte-identical | 2043 / 2120 | **2088 / 2120** |
| differing modules (testsuite) | 77 | **32** |
| files affected (testsuite) | 48 | **14** |
| parse-clean | 257 / 257 | 257 / 257 |
| V8-valid modules | 2120 / 2120 | 2120 / 2120 |
| validator agreement | 2120 / 2120 | 2120 / 2120 |
| assert_invalid rejected | 2664 / 2737 | 2664 / 2737 |

Regression test: `tests/writer/operand_placeholder.test.ts` (9 cases — the
parser's and the reader's placeholder both marked, no padding byte emitted, a
round-trip fixed point, a V8-executed check that the multi-value semantics
survive, an explicitly written `nop` preserved, and three T11 no-repair cases).

**T10.5 — done 2026-08-24, and it was diagnosed wrong.** The item was filed
against the binary READER ("the reader cannot attribute every value to an
operand slot"). Measuring it found the dominant producer was the PARSER:

    i32.const 0        ;; the address for the i32.store below
    f64.const 5
    f64.const 3
    call $f            ;; takes TWO args, but drained all three
    i32.store          ;; ... so its address slot got a Nop placeholder

`instrInputCount` returns -1 for `call` because the arity is the CALLEE's param
count, not a property of the token, and `parseLinearPlainInstr` read -1 as
"consume the whole operand stack". Our own `wasm2wat` emits LINEAR form, so a
round trip is exactly what triggers it — which is why it was invisible to every
other metric.

**Severity was understated, and the reason is worth keeping.** The item read as
cosmetic because a nop pushes nothing, so the starved `i32.store` still found
its address on the stack and the module ran correctly. But the nop is a byte,
and the next round trip adds another: `core_UnsignedIntegerComparison.wat` went
517 → 521 → 525 → 529 … +4 every pass, forever. **"Still valid" and "still
correct" are not the same as "converges".** Round-tripping a module through a
build pipeline more than once grew it without bound.

The fix needs the callee's signature, which may be declared LATER in the file —
199 of the 270 corpus modules contain at least one forward reference (487 calls
against 5470 backward). So function BODIES are now parsed after the whole module
field list: `parseFuncModuleField` records the body's token index and skips it,
`parseModuleFieldList` flushes the queue through `parsePendingBodies`. The token
stream is a random-access array, so this costs one balanced-paren skip per
function and a cursor assignment per body. Nested `(module …)` fields recurse
through `parseModuleFieldList`, so each field list owns its own queue.

`varArityForTok` returns -1 when the arity cannot be determined, which keeps the
old draining behaviour — including for `br`, `return`, `throw`, `call_indirect`,
`call_ref`, `struct.new` and `array.new_fixed`, which have the same shape and
are NOT yet resolved. They did not appear in the measurement; extend the switch
if they do.

One side effect: body diagnostics are now appended after those from later module
fields. Errors carry their own locations, so list order is presentation.

| metric | before | after |
| --- | --- | --- |
| **wasmtk WASI corpus byte-identical** | **50 / 270** | **225 / 270** |
| spec testsuite byte-identical | 2041 / 2120 | 2043 / 2120 |
| differing modules (testsuite) | 79 | 77 |
| files affected (testsuite) | 50 | 48 |
| parse-clean | 257 / 257 | 257 / 257 |
| V8-valid modules | 2120 / 2120 | 2120 / 2120 |
| validator agreement | 2120 / 2120 | 2120 / 2120 |
| assert_invalid rejected | 2664 / 2737 | 2664 / 2737 |

The testsuite barely moves because its remaining differences are dominated by
T10.3 / T10.4 / T10.6 / T10.8; the corpus is where this bug lived. **Two
yardsticks, and only one of them could see the bug** — same lesson as T10.1.

Regression test: `tests/parser/call_arity.test.ts` (8 cases; 5 fail on the
pre-fix parser, and 3 are guards that must keep passing — the Bug D folded
multi-value receive idiom, local-name resolution across the deferred parse, and
a V8-executed check that the store still uses the address the source named).

**T10.1 + T10.2 — done 2026-08-24.** One fix in `wat-writer.ts`'s
`buildExportMap`, because both were the same root: the inline `(export "n")`
abbreviation was applied unconditionally. It is not always faithful, in two
independent ways — it is illegal on an import, and it re-orders the export
section. The writer now tests both up front and falls back to standalone
`(export "n" (func $f))` fields, in the module's own order, when either fails.

The order test is **exact, not conservative**: under full inlining the emitted
sequence is a stable sort of `module.exports` by the position at which
`writeModule` visits each item, and a stable sort is the identity exactly when
those positions are non-decreasing. So a module whose exports already line up
keeps the abbreviation — the fallback fires only where it had to.

It is **all-or-nothing per module** on purpose: standalone exports are written
after every item, so inlining only SOME of them pushes the rest to the end and
re-orders the section again.

Note the emission order is imports, then funcs, tables, memories, globals, tags
— which is NOT the index space, so "every item exported exactly once" is not
enough for the order to survive. `(export "g" (global …))` before
`(export "f" (func …))` already fails it.

| metric | before | after |
| --- | --- | --- |
| spec testsuite byte-identical | 1961 / 2120 | **2041 / 2120** |
| differing modules | 159 | **79** |
| V8-invalid after round-trip | 26 | **15** |
| hard failures (`wasm2wat`/reparse) | 12 | **1** |
| files affected | 70 | **50** |
| **wasmtk WASI corpus byte-identical** | **1 / 270** | **50 / 270** |

The WASI number is the one that matters against the standing goal, and it came
in where the classification predicted (~49). The corpus's export group is gone
entirely; what is left there is T10.5 nop padding on 220 modules and the six
wasic-invalid ones.

Upstream wabt defaults `inline_export` to FALSE (`wat-writer.h:33`) and wabt-ts
defaulted it to TRUE. That divergence is what made both bugs reachable from
`wasm2wat` with no flags. The default stays TRUE — with the feasibility test in
front of it, it is now safe — so output stays readable where it can be.

Regression test: `tests/writer/export_order.test.ts` (6 cases; 5 of them fail
on the pre-fix writer, and the sixth is the guard that inlining still happens
when it is faithful).

### Two encoder bugs the last validator item uncovered

Chasing the final `assert_invalid` case turned up defects that had nothing to
do with validation:

1. **`select`'s result annotation was mis-encoded.** The binary writer wrote it
   with `this.s.writeU8(t as number)` — a cast the T7.4 `ValueType` refactor
   left behind. A `(ref $t)` annotation is an OBJECT, so the cast wrote `0x00`
   and EVERY typed-ref `select (result …)` produced an invalid value type.
   Same class as the type-key stringification in T10.7.
2. **`resolveNames` never resolved that annotation's heap-type var.**
   `resolveModuleValueTypes` walks declarations only. This was invisible while
   the writer was casting the annotation to a byte; fixing (1) made the
   writer's fail-loud guard fire immediately, which is exactly what that guard
   is for.

Note the standing "no name-var survives resolveNames" guard did NOT catch (2):
it walks the spec testsuite plus one hand-built module, and no testsuite module
writes `select (result (ref $t))`. A guard is only as wide as its corpus.

### WASI Preview 1 — the goal, and what measuring against it found

**Standing goal (recorded in `CLAUDE.md`): transpiled output must be WASI
Preview 1 capable until Preview 2 is the BROWSER standard, then migrate — and
the same for p3 and beyond.** Target the preview that is deployable today, keep
the next in view, switch on the browser rather than on the publication date.

The wasmtk corpus is the right yardstick for it: **270 of its 272 files import
`wasi_snapshot_preview1`**. Running them through the toolchain (2026-08-21):

| stage | result |
| --- | --- |
| encode | **270 / 270** |
| our validator | 263 / 270 |
| round-trip byte-identical | **1 / 270** |

Two findings, both more useful than anything the spec testsuite was saying:

1. **7 corpus modules are INVALID wasm** — all failing the same way (a function
   falls through without producing its declared result), rejected by V8,
   Wasmtime and Wasmer. Listed in `KNOWN_INVALID` in
   `tests/wasmtk/runner.test.ts`, asserted to *stay* invalid so the list
   shrinks when wasic is fixed.

   **CORRECTED 2026-08-24: these are STALE SNAPSHOT BYTES, not live wasic
   bugs.** We reported them upstream in the present tense; wasmtk rebuilt all
   seven from current wasic and every one is valid and exits 0 on Wasmtime with
   correct output. Re-derived on this side by recompiling from the checkout —
   frozen INVALID, current valid, all seven. The assertion's SHAPE is right (it
   goes red when a listed file validates, forcing the list to shrink); what
   defeated it is that `tests/wasmtk/` is FROZEN, so the trigger never fires —
   it re-checked bytes predating the fix and **masked it instead of tracking
   it**. See `tests/wasmtk/PROVENANCE.md`.

2. **The corpus gate never validated.** Its comment said "wat2wasm returns
   Result.Ok on a clean compile + validate" — `wat2wasm` is parse →
   resolveNames → synthesizeTypes → writeBinaryIr, with no `validateModule` in
   it at all. So the gate asserted something it never checked, for the life of
   the corpus, which is exactly how those 7 went unnoticed until T9.5's
   stack-arity check made the validator good enough to see them. The gate now
   really validates, with every proposal enabled.

**Round-trip on this corpus is 1/270, against 1961/2120 on the spec
testsuite.** Real WASI-targeting modules are a far harsher probe.

**Classified (2026-08-21): every one of the 269 differences is already in T10
scope — and only TWO of the seven groups appear at all.**

| group | spec testsuite | WASI corpus |
| --- | --- | --- |
| **T10.1** export order | 69 / 159 (43%) | **269 / 269 (100%)** |
| **T10.5** inert nop padding | 48 / 159 (30%) | 220 / 269 (82%) |
| T10.2 / .3 / .4 / .6 / .7 | 42 / 159 | **0** |

**Acted on 2026-08-24: the corpus went 1 / 270 → 270 / 270.** T10.1 (with T10.2)
took it to 50, where the classification predicted ~49; T10.5 to 225; T10.8 to
all of it. The prediction that "T10.1 + T10.5 together" would reach ~263 was
close — the last 45 needed T10.8, which had been folded into T10.5's
description. See the T10 section above for each fix and its before/after.

No new causes; nothing needs re-scoping. The seven modules the classifier calls
"INVALID after round-trip" are the same seven wasic already emits invalid —
they go in invalid and come out invalid, not a round-trip regression.

**But the PRIORITY inverts.** T10 was ranked by severity on the testsuite:
T10.6 and T10.3 first because they produce invalid wasm, T10.1 last as "valid,
wrong order". Against the WASI goal that ordering is wrong — T10.2, .3, .4, .6
and .7 do not occur in real WASI-targeting modules at all, while **T10.1 occurs
in 100% of them**. Fixing T10.1 alone would take the corpus from 1/270 to ~49;
T10.1 + T10.5 together to ~263/270 (everything except the seven wasic-invalid
ones).

Both orderings are correct for their own yardstick. **Which one to use depends
on the goal**, and the standing goal is WASI capability — so T10.1 first, then
T10.5. T10.1 is done; T10.5 is next.

**This is the reusable part.** The severity ranking and the frequency ranking
disagreed, and the frequency one was measured on the corpus the goal names. It
also turned out to be the cheaper fix and to close a second item (T10.2) for
free. Rank remaining work against the yardstick the GOAL names, not the one the
campaign happened to start with.

### Open — T12: `assert_malformed`. The only tranche with work in it

**Numbering:** a new integer, per the ledger rule — nothing in T1–T11 covers
"input the spec says must fail to PARSE". Opened 2026-08-24.

**Ranked by MEASURED consequence, not by case count.** Every category below was
probed to see what accepting it actually produces, because T10 was mis-ordered
for the whole campaign by inheriting a severity ranking instead of measuring
one. The result inverted the count order: the biggest categories are the mildest.

| id | scope | cases | measured consequence |
| --- | --- | --- | --- |
| ~~T12.1~~ | **DONE.** Out-of-range integer / float constants | 68 | **silent WRONG VALUE** — `(i32.const 0x100000000)` → `0`, `(f32.const 1e39)` → `inf`; V8 accepts and runs |
| ~~T12.2~~ | **DONE.** Import after a function/global/table/memory/tag definition | 12 | **silent REORDER** — was accepted and emitted first, shifting every index space |
| ~~T12.3~~ | **DONE.** `align=0`, `align=7` and other non-powers-of-two | 114 | **silent WRONG VALUE** — `align=3` was emitted as `align=2`; the severity was under-rated on the first pass |
| ~~T12.4~~ | **DONE.** SIMD lane immediates AND `v128.const` lane values | 13 + the simd_const cases | **silent WRONG VALUE** — lane 256 → 0, and `v128.const i8x16 -129` → **127** |
| ~~T12.5~~ | **DONE.** Malformed UTF-8 in names | 186 quoted **+ 528 binary** | name silently REPLACED with U+FFFD — and the same rule fixed most of T12.8 |
| ~~T12.6~~ | **DONE.** `unexpected token` — two silent defaults, then the block/type-use remainder closed by T12.7 | 82 | had **silent WRONG VALUE** in it after all |
| ~~T12.7~~ | **DONE.** Illegal character, empty annotation id, mismatching label, inline function type | 77 (+19 more it reached) | two of the four were WRONG VALUE, not just a missing rejection |
| ~~T12.8~~ | **DONE.** The remaining BINARY `assert_malformed` cases | 73 (was 601 — T12.5 closed 528) | the reader resynchronised instead of reporting |
| ~~T12.9~~ | **DONE.** The remaining QUOTED cases — duplicate ids (16), `nan:0x0` (10), lane immediates (13), token boundaries (6), second `(start …)` (1), forward type use (1) | 46 | every one a silent WRONG VALUE |

**T12.1 — done 2026-08-24.** Integers went through `BigInt.asIntN(32, n)` with
no range check; floats were IEEE-rounded with no range check. The legal integer
span is the UNION of the signed and unsigned ranges (`[-2^31, 2^32)` for i32),
because the text format lets a 32-bit value be written either way. For floats, a
FINITE literal that rounds to infinity is out of range — `inf` must be spelled
`inf`, which is why the check is gated on the literal FORM
(`isFiniteLiteralForm`) and not on the resulting bits. Gating on bits alone
rejected legitimate `inf`, caught immediately by the probe.

**Two existing test expectations were wrong and are corrected**, not weakened:
`hex_float_rounding.test.ts` and `decimal_float_rounding.test.ts` asserted that
`0x1.ffffff8p127` and `3.5e38` *overflow to infinity*. They go through
`wat2wasm`, so they were asserting parser behaviour, and `const.wast` settles
it — `(f32.const 0x1.ffffffp127)` and the decimal midpoint are both
`assert_malformed` "constant out of range", while the value just below the
boundary is a plain valid module. The underlying rounding functions still
return infinity, which is correct IEEE behaviour and is exactly what the
parser's range check reads.

Regression: `tests/parser/const_range.test.ts` (21 cases, 17 fail pre-fix,
including boundary cases in both directions).

**T12.2 — done 2026-08-24.** Imports occupy the low indices of every index
space, so the spec forbids one from following a definition. We accepted them and
emitted the import FIRST, renumbering everything the module already referred to.
Not theoretical — the module runs and returns a different answer:

    (func $defined (result i32) (i32.const 111))
    (import "host" "imported" (func $imported (result i32)))
    (func (export "which") (result i32) (call 0))

    source order:   call 0 is $defined      -> 111
    what we emitted: call 0 is the import   -> 999

V8 accepts the result, so nothing downstream catches it. Same class as T12.1.

The check lives in `parseModuleFieldList` and watches whether
`module.imports.length` GREW, not whether the `import` keyword appeared — the
inline abbreviation `(func $g (import "m" "g"))` is an import too and would
otherwise have slipped through. Verified against seven legal orderings
(type/export between imports, elem/data/start after definitions, imports only,
the inline abbreviation first) so the rule did not become a blanket rejection.

Regression: `tests/parser/import_order.test.ts` (15 cases, 8 fail pre-fix,
including a V8-executed check that `call` still means what source order says).

**T12.3 — done 2026-08-24, and it was mis-ranked when the tranche was opened.**
The table said "align silently DISCARDED (falls back to natural)". Probing it
properly for the fix showed worse: the raw number flowed into a `log2` that
FLOORS, so `align=3` was emitted as **`align=2`** — a changed module, not a
dropped annotation. binaryen's optimizer reads the alignment as a HARD
constraint (see the `naturalAlignForOpcode` note in `design-decisions.md`, where
getting this field wrong made it bail on rewrites and produce OOB at runtime).

So this belonged with T12.1 and T12.2 in the silent-wrong-value group, not below
them. **Ranking by measurement is only as good as the measurement** — the
opening probe checked whether the align survived, not what it survived AS.

`align=0` had a second problem: 0 is also `parseAlignOpt`'s "no `align=` given"
sentinel, so an explicit `align=0` was indistinguishable from writing nothing.
Rejecting it at parse time keeps the sentinel unambiguous with no IR change.

**The layer split is deliberate.** The power-of-two rule is the text grammar's,
so it is MALFORMED and belongs in the parser. "Alignment must not exceed the
operand's natural alignment" is a VALIDATION rule — `align=8` on an `i32.load`
is well-formed and invalid, and T9.6 already rejects it there. Conflating them
would have moved a diagnostic to the wrong layer; a test pins each side.

Regression: `tests/parser/align_power_of_two.test.ts` (14 cases, 11 fail
pre-fix).

**T12.4 — done 2026-08-24, and the entry named only half of it.** The table said
"SIMD lane index out of range". Reading the spec cases showed THREE rules across
TWO layers, and the third was not in the entry at all:

| input | verdict | source |
| --- | --- | --- |
| lane index 256+ | **MALFORMED**, "i8 constant out of range" | simd_lane.wast |
| lane index 16..255 | **INVALID**, "invalid lane index" | simd_lane.wast — already rejected since T9.6 |
| `v128.const` lane VALUE out of width | **MALFORMED**, "i8 constant out of range" | simd_const.wast |

**255 and 256 must fail in different layers**, which is exactly why the parser
checks only that the immediate fits `u8` and leaves the lane-COUNT comparison to
the validator. Collapsing them into one parse check would have merged the spec's
two distinct diagnostics — the same layer discipline as T12.3's
power-of-two vs not-larger-than-natural split.

All three wrapped instead of erroring. The sharpest is
`(v128.const i8x16 -129 …)` → **127**: a sign flip on every lane, in a module
V8 accepts and runs. As for scalar constants the legal span is the UNION of the
signed and unsigned ranges, so an i8 lane may be written `-128`…`255` —
`laneFits` encodes that once for all three widths.

Regression: `tests/parser/simd_lane_range.test.ts` (17 cases, 14 fail pre-fix,
including both boundary directions and a V8-executed check that an accepted
`-128` stays `-128`).

**T12.5 — done 2026-08-24, and it was ranked LAST of the wrong-value work when
it was the highest-leverage item in the tranche.** The entry read "name
mangled", 186 cases, on the strength of the quoted metric alone. But
`utf8-import-module.wast`, `utf8-import-field.wast` and
`utf8-custom-section-id.wast` are **176 BINARY cases each**, and the rule is the
same on both sides of the pipeline:

| | before | after |
| --- | --- | --- |
| `assert_malformed` quoted | 869 / 1229 | **1045 / 1229** |
| `assert_malformed` binary | 110 / 711 | **638 / 711** |

Both decoders were lenient `TextDecoder`s, which silently substitute U+FFFD, so
an invalid import or export name became a DIFFERENT, valid-looking name — and a
name is the module's public contract, the one thing a host links against.

**The exemption is as important as the rule.** Data segments are arbitrary
bytes: `(data "f")` is legal. They go through `parseTextList`, names through
`parseQuotedText`, and only the latter is checked. That separation already
existed, which is why the fix is two decoders and no restructuring.

**`ignoreBOM: true` on the strict decoder is load-bearing**, and omitting it
cost a regression that the metrics caught immediately: without it `TextDecoder`
STRIPS a leading U+FEFF, silently renaming the export. That is T7.13, and
V8-valid dropped 257 → 256 the moment the decoder went in. Fixed before commit.

Regression: `tests/parser/name_utf8.test.ts` (17 cases, 16 fail pre-fix — six
invalid encodings in each of the two paths, the data-segment exemption, and the
BOM guard).

**T12.6 — the two silent defaults are fixed 2026-08-24; the rest is genuinely
"rejection not made".** The category was filed as such, but reading the 54
remaining cases found two more silent-WRONG-VALUE shapes hiding in it:

1. **A missing lane immediate compiled as lane 0.** `parseSimdLane` returned 0
   whenever the next token was not a number, so
   `(i8x16.extract_lane_s (local.get 0) (v128.const …))` — no lane at all —
   became `extract_lane_s 0`. There is no default lane.
2. **`nan:canonical` / `nan:arithmetic` were accepted as LITERALS**, silently
   becoming the canonical NaN bit pattern. They are `assert_return` RESULT
   PATTERNS, meaning "any canonical NaN".

**(2) could not be a global rule, and the metric caught me getting that
wrong.** A v128 result may carry the patterns PER LANE —
`(v128.const f32x4 nan:canonical nan:canonical …)` is legal and pervasive in
`simd_f32x4.wast` — and those lanes go through the same `parseF32Bits` an
instruction const uses. Rejecting them outright dropped **parse-clean 257 →
249** across eight SIMD files. The fix is a scoped `allowNanPatterns` flag set
only while parsing an expected result, saved and restored so it cannot leak.

That is the second time in this tranche that a rule turned out to be
CONTEXTUAL rather than absolute (T12.3's parse-vs-validate split was the
first), and both times the giveaway was a legal shape breaking, not reasoning.

**Still open in T12.6** (~12): block type-use combined with inline params or
results, and a NAMED param in a `call_indirect` type-use.

Regression: `tests/parser/lane_and_nan_context.test.ts` (15 cases, 14 fail
pre-fix, including the per-lane v128 result and a no-leak check).

**T12.7 — three things read and then thrown away, 2026-08-24.** Filed as four
separate categories; they turned out to be one shape repeated. In each, the
parser or lexer CONSUMED the text and looked at nothing:

1. **An annotation was skipped at the CHARACTER level.** `(@id …)` is
   transparent, and we implemented "transparent" literally — count parens,
   stop at the matching `)`. That is right about the BODY being untokenised
   and wrong about the rest, because an annotation still has a grammar:
   `annot ::= '(@' (idchar+ | string) (token | annot)* ')'`. The ID is
   REQUIRED and adjacent to the `@`, so `(@)`, `(@ x)`, `(@(@a)x)` and `(@"")`
   are malformed; and the body is a TOKEN sequence, so a control byte, a DEL
   or a raw non-ASCII character cannot appear in it.
2. **The closing label of a linear block.** `block $a … end $l` repeats the
   label at the `end` and the repeat must match. All five sites were
   `if (peek() === Var) this.drop()`. A typo'd closing label named a different
   block and the module compiled.
3. **The inline signature beside a `(type $t)`.** A type use may RESTATE its
   signature, and the restatement has to agree. `parseBlockType` called
   `skipInlineBlockSig` and `settleTypeUse` returned early, so
   `(type $sig (func))` with `(result i32)` emitted a function whose declared
   signature was neither of the two the source wrote.

(2) and (3) are silent-WRONG-VALUE, not merely a missing rejection — which is
the third time this tranche a category filed as "rejection not made" contained
one. **"We consume it and ignore it" is the tell**, and it is worth grepping
for directly rather than waiting for a metric: a `drop()` whose result is never
used, and a `skip…` helper that returns `void`.

**Reading the inline part instead of skipping it closed T12.6's remainder for
free.** A skip cannot see ORDER or NAMES, so the same rewrite rejected
`(result …)` before `(param …)` and a NAMED param in a block or
`call_indirect` type use — while `parseFuncSignature` still allows names,
because a real `(func (param $x i32) …)` needs them.

**A quoted id is a NAME.** `(@"…")` and `$"…"` take the T12.5 UTF-8 rule with
them, plus non-emptiness and no RAW control characters. That last check is on
the SOURCE text, not the decoded bytes, because an escaped tab is legal while a
literal tab byte is not — checking the bytes would have rejected both. The
shared `decodeStringToken` / `STRICT_NAME_DECODER` moved to
`src/core/literal.ts` so the lexer and the parser apply one rule, not two.

**The EXEMPTIONS are what make it safe**, and annotations.wast asserts them:
strings and comments inside an annotation are skipped whole and stay
unchecked (a body string containing parens, and `(@a (;bla;) (; ) ;)`, are both
VALID), and data segments keep their T12.5 exemption.

quoted assert_malformed **1087 → 1183 / 1229**; the other six metrics unmoved.
Regressions: `tests/parser/annotation_lexing.test.ts` and
`tests/parser/type_use_and_label.test.ts` (61 cases, 42 fail pre-fix).

**Still open** (46 quoted): duplicate ids across func/local/global/memory/
table/field (16), `nan:0x0` (10), signed lane immediates and `i8x16.shuffle`
lane-length/range (12), a `br_table` label that runs into the next token (5),
unknown type (1), two start sections (1), plus the 73 binary cases in T12.8.

**T12.8 — the binary reader resynchronised instead of reporting, 2026-08-24.
Binary 638 → 711 / 711; that half of the metric is CLOSED.**

The decoder was written to keep going, and every one of the ways it did that
produced a DIFFERENT MODULE rather than a diagnostic:

- an unknown section id fell into `default` and was skipped;
- `if (this.pos !== sectionEnd) this.pos = sectionEnd` realigned silently
  whenever a section's contents disagreed with its declared size;
- every entry loop was guarded by `this.pos < end`, so a section claiming more
  entries than it held simply produced fewer — `(table 1 …)` with no table
  entry decoded to a module with no tables;
- there was no duplicate- or order- check at all, so a module with two code
  sections decoded to the SECOND one's bodies;
- a function body missing its `end` decoded as though it had had one;
- `readU8() !== 0` made mutability 0x02, 0x04 and 0xff all MUTABLE, and
  `alignFlags & 0x3f` made memarg flags 0x80 an alignment exponent of 0 — a
  different instruction, in a module V8 runs. **Those two are T12.7's "we
  consume it and ignore it" spelled arithmetically**, which is worth carrying
  forward: a mask and a `!== 0` are discards too.
- the data-count section was read and thrown away with the comment "we don't
  store it". It is load-bearing: `memory.init` and `data.drop` require it (the
  code section is decoded BEFORE the data section, so it is the only way to
  know a data index is in range at that point), and when present it must agree
  with the data section's own count.

**The order is NOT numeric id order, and getting that wrong would have been
invisible in this metric.** The tag section is id 13 but sits between memory
and global; the data-count section is id 12 but sits between elem and code. A
numeric comparison accepts an order no producer may emit AND rejects a legal
one — and only the second half shows up as a failure. `sectionOrderRank` in
`src/core/binary.ts` holds the one order, the same one `writeBinaryIr` emits,
so the two cannot drift.

**One check was written in the wrong index space, and only a DIFFERENT metric
saw it.** The function/code count check first read
`count !== m.funcs.length - m.numFuncImports`; `m.funcs` holds defined
functions only (imports live in `m.imports`), so every module with a function
import was rejected. The `assert_malformed` number was identical either way —
round-trip dropped 2120 → 2051 across 14 files and named the error. That is
the fourth time in the campaign that the metric which caught a regression was
not the one the work was aimed at, and it is the argument for running the whole
panel on every change rather than the one being moved.

Regression: `tests/reader/binary_malformed.test.ts` (22 steps, all 6 groups
fail pre-fix), built from hex-dump literals so each module reads as bytes.

**T12.9 — the last of the quoted gap, 2026-08-24. 1183 → 1227 / 1229 at the
parser, and 1229 / 1229 through `wat2wasm`.**

Six shapes were left, and unlike the tranche's own severity ranking predicted,
**every one of them was a silent WRONG VALUE rather than a missing rejection**:

- **A duplicate identifier was simply UNREACHABLE.** Every lookup resolves a
  name by scanning for the FIRST match (`module.types.find(t => t.name === …)`
  and the same shape for funcs, globals, tables, memories, tags), so a second
  binding did not collide — the module still referred to something, just never
  to the item written last. The index space spans imports AND definitions,
  which is why `checkDuplicateIds` walks `module.imports` first.
- **`nan:0x0` emitted INFINITY.** The payload was MASKED into the mantissa
  field instead of checked, and a payload of 0 leaves no bits set, so
  `f32.const nan:0x0` produced 0x7f800000. The same mask truncated an
  oversized payload into a different NaN. (The mask was 0x3fffff for four
  releases and lost `nan:0x400000` exactly this way — the shape recurred
  because the fix then was to widen the mask instead of to check.)
- **A signed lane index had its sign dropped**, and `i8x16.shuffle` filled any
  missing lane with zero and let a `Uint8Array` store wrap `-1` to 255 and
  `256` to 0.
- **A token does not end at a quote.** `$"l"0` and `data"a"` are each ONE
  reserved token, because a string continues a token the same way an idchar
  does. Stopping at the closing quote turned `(br_table $"l"0)` into a branch
  to `$l` followed by a stray `0` that read as a second target, and
  `(data"a")` into a well-formed data segment.
- **A second `(start …)` overwrote the first**, so the module ran a different
  function than the one it names first.
- **A type use may refer FORWARD**, so T12.7's restatement check saw an empty
  type table and compared nothing whenever the type was declared later.

**The forward-reference fix is worth more than the one case it closes.**
Deferring the check to the end of the field list (`pendingTypeUses`, alongside
`pendingBodies`) makes T12.7's rule apply to forward references too — a gap
the metric could not see, because no spec case happens to combine a forward
reference with a mismatched restatement. A rule that only fires when its
operand happens to be already known is half a rule.

**The last two are a HARNESS boundary, not a gap.** `(br_table $l0)` with an
undefined label is rejected by `resolveNames`, which `wat2wasm` runs and the
parser-only harness does not. Name resolution is genuinely a post-parse pass
here, so the number measured at `parseWatModule` under-reports the tool by
exactly those two; measured at `wat2wasm` it is 1229 / 1229. Both numbers are
worth keeping — the parser-only one is the stricter statement.

Regression: `tests/parser/duplicate_ids_and_tokens.test.ts` (34 steps, all six
groups fail pre-fix), including a V8 round trip proving the in-range NaN
payloads still come back as NaNs and not infinities.

### A SEVENTH metric — `assert_malformed`. 666 / 1229, and it is OPEN

`assert_invalid` covers modules that PARSE and then fail validation. Nothing
measured the other direction: text the spec says must **fail to parse at all**.
Building it found two real defects immediately, and it is the first campaign
metric that is not exhausted.

| | start | after the two fixes below |
| --- | --- | --- |
| quoted text | 356 / 1229 | **666 / 1229** |
| binary | 110 / 711 | 110 / 711 (untouched) |

**Fix 1 — an unknown instruction was silently DELETED, and it was OUR
regression.** `(i32.addd (i32.const 40) (i32.const 2))` parsed to an EMPTY
function body and `wat2wasm` returned Ok; the failure surfaced at the engine as
"expected 1 element on the stack", pointing nowhere near the typo.

Bisected to **T10.5's deferred body parsing, six commits earlier**. Before it, a
body that failed to parse left the cursor mid-body and the enclosing
`expect(Rpar)` failed loudly (`expected ), got (`). Deferring made
`parsePendingBodies` restore the cursor unconditionally, so the leftovers were
never looked at again — and `parseInstrList` compounds it by breaking out of its
loop and returning `Result.Ok` regardless of why.

`PendingBody` now records `endPos` and the parse must land exactly there, so
ANY unconsumed body content is reported, not just typos. Worth ~230 of the
metric.

**Fix 2 — digit separators were accepted anywhere.** `num ::= d | num '_'? d`;
`readNum` consumed a `_` unconditionally, so `1_`, `1__2`, `0x1_`, `1_.0` all
lexed as numbers. The rejection machinery already existed — `getNumberToken`
falls back to a Reserved token when an id-char trails the literal — it just
never saw the `_`, because `readNum` had eaten it. Leaving a malformed
separator UNCONSUMED is the whole fix. Worth ~80.

**What is still open (563 quoted + 601 binary), by the spec's own expected
message:**

| count | expected message | example |
| --- | --- | --- |
| 186 | malformed UTF-8 encoding | `(@a �)` |
| 114 | alignment / must be a power of two | `align=0`, `align=7` |
| 82 | unexpected token | field-order and block-type shapes |
| 55 | constant out of range | `(i32.const 0x100000000)` |
| 32 | illegal character | |
| 24 | inline function type | |
| 14 | mismatching label | `(func block end $l)` |
| 13 | i8 constant out of range | `(i8x16.extract_lane_s 256 …)` |
| 12 | import after function/global/table | |

Plus the 601 binary cases, which are a separate decoder-hardening job.

**This is the natural next tranche.** Note the shape of what is left: almost all
of it is the parser being LENIENT rather than wrong — accepting input no
producer emits. That is why six metrics could sit exhausted while this one sat
at 29%.

Regression: `tests/parser/malformed_input.test.ts` (17 cases; 11 fail pre-fix).

### CORRECTION (2026-08-24): the `assert_invalid` denominator was polluted

**`(assert_trap (module …) "msg")` was being reported as `assert_invalid`.**
The two assertions say OPPOSITE things: `assert_invalid` means the module must
fail validation, while `assert_trap` with a module means it is well-formed and
VALID and traps on INSTANTIATION (an out-of-bounds data/elem segment, or a
trapping start function).

54 such commands — data.wast, data1.wast, elem.wast, linking*.wast, start.wast —
were counted into the `assert_invalid` population. They are valid modules, we
correctly ACCEPT them, and so every one scored as a miss.

| | before | after |
| --- | --- | --- |
| correctly rejected | 2664 / **2737** | 2664 / **2683** |
| MISSED | **73** | **19** |

Nothing about our validator changed — only what we were counting. **† Every
historical `assert_invalid` figure in this file (2395, 2532, 2579, 2629, 2632,
2641, 2658, 2664 … / 2737) carries the same +54 pollution.** The DELTAS between
them are still valid, because the 54 were a constant; the denominators are not.
They are left as written rather than rewritten, since each records what was
actually measured at the time.

**The conclusion survives, at a fifth of the size.** Re-checked after the fix:
all 19 real remainders are still accepted by V8, so there is still nothing here
for us to fix. But "73" was five parts artefact to one part finding, and the
cross-engine exercise below spent its effort on a population that was mostly
valid modules — which is exactly why V8 and Wasmtime returned a flat accept.

Regression: `tests/parser/assert_trap_module.test.ts`.

### Cross-engine check of the 73 (2026-08-21) — see the correction above

The 73 `assert_invalid` modules wabt-ts still accepts are all ones **V8**
accepts too. Re-checked against **Wasmtime 47.0.3**, which is now the project's
accept/reject authority (see `CLAUDE.md`, "Oracle rule"):

| engine | accepted | rejected |
| --- | --- | --- |
| V8 (harness oracle) | 73 | 0 |
| **Wasmtime 47.0.3 (authority)** | **73** | **0** |
| Wasmer 7.2.1 | 52 | 21 — all FEATURE GATES |

Wasmer's 21 are `multiple memories` (14), `memory64 must be enabled` (4) and
`rec group usage requires the gc proposal` (3): `wasmer validate` has those
proposals off by default. Not a disagreement about validity.

**Conclusion: no disagreement from the AUTHORITY, so there is nothing here to
fix.** These spec tests predate proposals that legalised what they assert
against; matching them would mean diverging from Wasmtime.

**Wasmer earned its seat on the panel here.** V8 and Wasmtime both returned a
flat 73/73 accept — correct, and carrying no information beyond "no
disagreement". Wasmer's 21 rejections were the only DATA the exercise produced:
they classified the modules by the proposal each one needs. Not a validity
ruling, and it changed no verdict, but two engines agreeing tells you nothing
about *why*. Hence the standing rule: run all three, Wasmtime decides.
`deno task engine-check <dir>` does it, and self-tests against a known-invalid
module before reporting.

Two harness traps recorded in `best-practices.md` §1: enable proposals
explicitly (`-W all-proposals=y` fails on stock Windows Wasmtime — it pulls in
unsupported `stack-switching`), and give every module its own `-o` path (reusing
one made three I/O collisions score as REJECT until a known-invalid module was
run through to check the harness).

### T9.11 — `deno lint` was reporting a missing validator check, not dead code

Ten `no-unused-vars: 'offset' is never used` warnings sat in
`shared-validator.ts` and read as dead-parameter noise. They were not.

T9.5 added `checkMemArgOffset` — a memarg `offset=N` must fit the memory's
INDEX TYPE, u32 for a 32-bit memory — and wired it into `onLoad` and `onStore`
and **into none of the other ten handlers that take an offset**:
`onLoadSplat`, `onLoadZero`, `onSimdLoadLane`, `onSimdStoreLane` and the six
atomic ones. Each declared the parameter and ignored it, which is exactly what
the lint was saying.

Same shape as the T9.6 alignment gap: a check that exists, reads as covered,
and silently does nothing for a whole opcode family.

Four were reachable false-ACCEPTS, all of which V8 rejects:
`v128.load8_splat`, `v128.load32_zero`, `v128.load8_lane`, `v128.store8_lane`
with `offset=0x100000000` on a 32-bit memory. The atomic ones were already
caught earlier in the pipeline but are now wired the same way so they cannot
drift back.

**Neither corpus could see it** — agreement stayed 2120/2120 and
`assert_invalid` 2664/2737, because no spec-testsuite module writes an
out-of-range offset on a SIMD memory op. Five metrics missed this; a lint
warning found it.

**The reusable rule: an unused parameter in a handler whose SIBLINGS use it is
a missing check, not dead code.** Read the unused-variable warnings in a family
of parallel handlers before silencing them.

Regression test: `tests/validator/memarg_offset.test.ts` (9 out-of-range cases
cross-checked against V8, plus the `0xffffffff` boundary that a `>=` would
wrongly reject, plus a 64-bit memory where the same offset is legal).

### JSR score — checked, and the `deno doc --lint` count is not it

`deno doc --lint src/index.ts` reports ~788 `missing-jsdoc` errors. **They are
not what JSR scores.** The published `@jrmarcum/wabt-ts@1.3.5` reads
`"score": 100` from `https://jsr.io/api/scopes/jrmarcum/packages/wabt-ts` with
every one of those already present — they are interface FIELDS (543 in
`ir.ts` alone) and class MEMBERS, including private ones, which JSR's
documentation metric does not count. Do not chase them expecting the score to
move.

Two findings from the same run WERE real and are fixed:

- **`validateModule` is exported; `ValidateOptions` was not reachable from the
  package root**, so a consumer could not name its own options type
  (`private-type-ref`). Now re-exported from `src/index.ts`, and it carries
  JSDoc instead of a stale line comment claiming it is an empty placeholder.
- **`WastParser.parseInstrList` was public and took the module-private
  `ExprCtx`.** Every call site is inside the class; it is now `private`, which
  narrows the published surface as well as clearing the diagnostic.

### Wasmtime will not run wasic's legacy `try`/`catch` output (2026-08-24)

Putting the round-tripped WASI corpus to the three-engine panel found **6
modules the AUTHORITY rejects and V8 accepts**:

    15_Exceptions, 15_IdiomaticCatch_Stress, 15_LexicalShadowing_Stress,
    15_TestCase1-NestedEscalation, 15_recover,
    18_Multi-ScopeScaleAndMemoryLongevityTest

Wasmtime 47.0.3 and Wasmer 7.2.1 give the same reason:

    Invalid input WebAssembly code at offset 823:
    legacy_exceptions feature required for try instruction

**This is not a feature gate we can switch on.** Unlike the multi-memory /
memory64 / gc rejections in the 73-module cross-check, `wasmtime -W` has no
`legacy-exceptions` option at all — only `exceptions`, which is the STANDARD
proposal (`try_table` / `exnref`). Wasmtime cannot run the legacy encoding,
full stop.

**Nothing here is ours to fix, and the round trip is byte-identical for all
six** — they go in rejected and come out rejected. It is wasic emitting the
superseded legacy EH proposal for every TypeScript try/catch/throw, which
wabt-ts supports precisely because wasic emits it (see the legacy-`try`
invariant in `design-decisions.md`).

**But it matters to the standing WASI goal**, which names Wasmtime as the
primary p1 host: *if Wasmtime will not run it, it does not work, whatever V8
says.* Six corpus modules do not work. **Worth reporting to the wasmtk side**
alongside the seven `KNOWN_INVALID` ones — the fix is for wasic to emit
`try_table`, which wabt-ts already supports end to end.

Note this is the SECOND finding the panel produced that V8 alone could not
see, and again it came from an engine disagreeing rather than agreeing.


**ANSWERED 2026-08-24 — confirmed, with three corrections against us.** wasmtk
reproduced it and verified both of our load-bearing premises independently
rather than trusting them (`wasmtime -W help` offers only `exceptions[=y|n]`;
a hand-written `try_table` module runs with no `-W` flags). Their corrections:

- **Scope is 10 modules, not 6** — our snapshot is missing four
  (`56_AsyncReject`, `60_AsyncAll`, `64_ReportModuleTryCatch`,
  `64_ReportThrowTemplate`).
- **Two shapes need migrating, not three** — a bare `(catch_all H)` with no
  `rethrow` is never emitted; `catch_all` is generated only inside the
  `hasFinally` branch and always carries `(rethrow 0)`.
- **Our `src/wasic.ts` line refs were stale** (~13976/13992/13994 → actual
  14749 / 14756 / 14772 / 14774). The doc-block ref was exact.

They took the V8-only-gate lesson as theirs and queued "add Wasmtime to the EH
gate" **with** the migration rather than after it — migrating alone fixes the
instance and leaves the blind spot — noting `wasmtk wast` has the same shape.
The migration is their top `next-work.md` item; they deliberately did not bolt
it onto a review, since handler bodies becoming branch targets is a real
structural change.

### Post-campaign audit — 2026-08-24 (the "look for code issues" trigger)

Ran the audit the way `INDEX.md` now defines it: **enumerate the type, check the
code against it.** Corpus coverage found none of this.

**Clean** (recorded so the next pass does not redo them):

- every `ExprVisitorDelegate` hook (99) vs. the walkers that must be total —
  binary writer, WAT writer, validator: **99/99 each**;
- every `Var`-bearing `Expr` field (65 kinds, 99 fields) vs. `resolveNames`
  **and both writers** — clean (the `TryExpr` "gap" is a false positive: block-
  like exprs use `begin`/`end` hooks, and `delegate` round-trips byte-identical);
- `apply-names`' two gaps are deliberate and documented; the bridge's
  `call_indirect` uses `ci.sig` directly; `generate-names` names declarations,
  not references;
- the binary reader routes every memarg through ONE `readMemArg()`, so no
  per-site divergence is possible;
- **dest/src immediate order** for `memory.copy`, `memory.init`, `table.copy`,
  `table.init` and `array.copy` — all five correct behaviourally and
  byte-identical on round trip. Checked because binaryen-ts flagged
  `array.copy` as a case where "swapping them is invisible when both types
  match"; ours is right.

**Found — dead code that was actively misleading.** `Validator.refNullType`
was uncalled: the COARSENING helper T9.3 replaced, sitting directly below the
live call site with an inviting doc comment, collapsing a `ref.null $T` to its
abstract supertype. That is the same shape as binaryen-ts's UP-7, and a future
edit could plausibly have re-wired to it. Removed, with its now-orphaned
`heapTypeNameToType` / `Type` import.

**Found — `i64.add128` / `i64.sub128` (wide arithmetic), two defects.**

1. `instrInputCount` had no `TokenType.Quaternary` entry, so it fell to
   `default: return 0` while `buildPlainExpr` reads `op0()`…`op3()`. The LINEAR
   form popped nothing and all four operands became placeholders. **The bytes
   were correct anyway** — `pushStmt` flushes the orphaned operands in source
   order and a placeholder emits nothing (T10.8) — which is precisely why no
   metric saw it. The IR TREE was wrong, and that is what the bridge and
   `wasm2ts` read. Third instance of the documented
   `instrInputCount` ↔ `opN()` mismatch, after two SIMD ones.
2. The binary reader could not decode `0xfc 0x13` / `0x14` at all
   (`unknown misc opcode: 19`), so **`wasm2wat` could not read back a module
   our own `wat2wasm` had just written.** A producer/consumer mismatch inside
   one toolchain — best-practices §3. Added `MiscOpcode.I64Add128` /
   `I64Sub128` and the decode.

Both fixed; all six metrics unmoved.

**Second audit pass (same day) found the first fix covered only HALF the
proposal.** `add128` / `sub128` were fixed from the reported symptom;
`i64.mul_wide_s` / `i64.mul_wide_u` (0xfc 0x15 / 0x16) sat with the identical
defect — encodable, not decodable. They lex to `TokenType.Binary`, so the arity
was already right; only the reader was missing.

They were found by generalising the question instead of fixing the instance:
**for every opcode the LEXER can produce, can the READER decode it?** Feed each
of the 571 spellings to the reader as a synthetic body and look for the
specific "unknown … opcode" diagnostic. Result after the fix: **0 / 571**.

A first, STATIC version of that sweep (matching `case` labels in the reader
source) reported 317 gaps — 315 of them false, because the SIMD and atomics
decoders dispatch by RANGE (`if (op >= 0x00 && op <= 0x06)`) rather than by
case label. The empirical version is both simpler and correct. Inverted before
trusting it: with the fix stashed it reports exactly the two real gaps.

The sweep is now the last case in the regression file, so the CLASS is guarded
rather than the four instances. Regression:
`tests/parser/wide_arithmetic.test.ts` (9 cases).

**FIXED — and it was not latent for long.** `getMiscOpcodeTypeInfo`'s
`default:` returned `(v128,v128,v128) → v128`. It was logged as unreachable and
deliberately left alone. **Adding wide-arithmetic reader support in the very
next commit made it reachable**, and the consequence was the opposite of the
T9.2 incident it echoes: instead of wrong operands validating clean, **every
well-typed wide-arithmetic module was REJECTED** with
`expected [v128, v128] but got [i64, i64]`.

`onQuaternary` was worse — it hard-coded the v128×4 shape and ignored the
opcode entirely, so it rejected the only instructions that actually reach it
(`i64.add128` / `i64.sub128` are the ONLY `TokenType.Quaternary` spellings; the
relaxed-SIMD quaternary ops it was written for do not exist).

Fixed by giving all four wide-arithmetic opcodes real type info —
`mul_wide_*` is `[i64,i64] → [i64,i64]`, `add128`/`sub128` is
`[i64×4] → [i64,i64]` — with the SECOND result pushed by the `onBinary` /
`onQuaternary` special cases, since `OpcodeTypeInfo` carries only one. The misc
`default:` now returns all-`Void` (inert) rather than a SIMD signature.

**Neither corpus nor the agreement metric could see any of this.** V8 gates the
proposal off entirely (`Invalid opcode 0xfc13 (enable with --experimental-…)`),
so it rejects these modules for an unrelated reason and agreement stays
2120/2120. **Wasmtime is the oracle here**, and with `-W wide-arithmetic=y` it
agrees with us on all three probes:

| module | before | after | Wasmtime |
| --- | --- | --- | --- |
| well-typed `add128` | REJECT | **accept** | accept |
| well-typed `mul_wide_s` | REJECT | **accept** | accept |
| `add128` with f32 operands | REJECT | REJECT | reject |

Two lessons, both recorded in `best-practices.md`: **"unreachable" is a
property of today's code, not of the defect** — this one became reachable one
commit later, from a change that never touched it. And **a hard-coded shape in
a handler that ignores its opcode is the same bug as a lying default**, just
harder to grep for.

Regression: `tests/parser/wide_arithmetic.test.ts` (15 cases; 5 of the 6
validator cases fail pre-fix).

### A FIFTH metric — execution. 23,077 / 23,077 (2026-08-24)

Every metric the campaign had checks **bytes or acceptance**: parse-clean,
V8-validity, validator agreement, `assert_invalid`, round-trip byte-identity.
None ran a single instruction.

That leaves a real hole. Suppose the parser mapped a token to the WRONG opcode
— `i32.sub` emitting `i32.add`'s byte. V8 accepts it (a valid instruction),
the validator agrees (well-typed), and the binary reader maps that byte back to
`i32.add` consistently, so **round-trip is byte-identical**. All five metrics
green, program computes the wrong answer. Only execution catches it.

**Result: 23,077 of 23,077 executed `assert_return` assertions pass, zero
failures, across the spec testsuite.** 29,544 skipped — modules needing host
imports, v128 (cannot cross the JS boundary), NaN payloads (JS canonicalises
them), and `ref.func` arguments.

Harness: `assert_return` + `invoke`, compiled through our own pipeline,
instantiated on V8, compared by BITS for floats. It lives in the session
scratchpad.

**Four harness bugs had to be fixed before the number meant anything, and the
first run said "156 failures".** Every one was the harness:

| bug | effect |
| --- | --- |
| `action` commands skipped | stateful `grow`/`size` sequences never advanced |
| NaN payload compared by bits | unrepresentable through a JS `number`, so unscorable — not wrong |
| **`toJs` read `.type` off the `WastArg` wrapper** | a `WastArg` is `{kind:'value', value: Const}`, so every invoke WITH ARGUMENTS was silently skipped — **2,240 assertions instead of 26,837** |
| reference arguments skipped | the `init(externref)` that POPULATES the table in every GC test file never ran, so every slot stayed null and every downstream assertion failed |

The third is the one to remember: the harness reported a healthy-looking
2,084/2,240 while executing **only nullary functions**. A metric can be
precise, stable, and measuring almost nothing.

**And `ref.extern` arguments are expressible after all** — an externref is any
JS value, so `(ref.extern N)` maps to a stable per-N sentinel. Skipping them
was what made the entire GC cluster look broken.

### A frozen snapshot read as a live signal — both projects, one week (2026-08-24)

`tests/wasmtk/` is a 272-file snapshot of wasmtk's build output. Its live
corpus is **373**. No source commit was recorded, because files accreted one at
a time as wasic surfaced new shapes.

That was invisible until we asked a question whose answer changes over time,
and then it put a false claim in a report we sent upstream (the seven
`KNOWN_INVALID` modules — see the retraction above and
`scripts/wasmtk-eh-report.md`).

**wasmtk hit the identical pattern independently in the same week**: a frozen
vendored `proposals/threads/` snapshot read as a live signal. Neither case was
carelessness. **A snapshot is indistinguishable from current data unless
something records its provenance** — the same reason this project pins an
upstream SHA rather than saying "the checkout".

Fixed here by `tests/wasmtk/PROVENANCE.md`, which records what the directory
is, that it is 272 against 373, that the source commit is unknown, and the rule
that no present-tense claim about wasic may be derived from it. wasmtk's
`cmem/testing.md` already required regenerating before validating against
another runtime; ours did not, and that is exactly the gap.

**The reusable rule: stamp any vendored copy with source + date in the same
change that creates it.** An un-stamped snapshot does not announce itself — it
reads as current until something expensive proves otherwise.

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
| ~~T9.8~~ | **DONE.** A one-armed `if` falls through producing what it was given, so its block type's params and results must match — the missing `else` is not modelled in the type checker, so this is checked from the IR. And a `try_table` CATCH CLAUSE hands its target operands determined by the catch KIND (`catch` → the tag's params, `catch_ref` → params plus a NON-NULL `(ref exn)`, `catch_all` → nothing, `catch_all_ref` → `(ref exn)`); only the tag immediate was bounds-checked. **2632 → 2641 / 2737**. Two mistakes while adding the catch check, both caught by the agreement metric rather than by reasoning: depths were read AFTER `beginTryTable` pushed the try_table's own label (the same off-by-one T7.6 fixed in the parser — 6 valid modules rejected), and `catch_ref` was modelled as the nullable `exnref` (1 more). Regression test `tests/validator/control_arity.test.ts`. | — |
| ~~T9.9~~ | **DONE.** Five rules relating two IMMEDIATES, or an immediate to a declaration, none visible to the operand stack: `br_on_cast`'s rt2 must be a SUBTYPE of rt1; `table.copy` / `table.init` element compatibility; `array.*_data` needs a numeric element and `array.*_elem` a reference one; a global's initializer may only name globals declared BEFORE it (a self-reference is an unknown global). Plus local-init tracking — see the correction below. **2641 → 2658 / 2737**, agreement unmoved at 2120/2120. Tests `tests/validator/gc_operand_rules.test.ts` and `tests/validator/local_init.test.ts`. | — |
| ~~T9.10~~ | **DONE — the validator now rejects every invalid module V8 rejects.** `call_ref` / `return_call_ref` expected any `funcref` rather than `(ref null $t)` for the NAMED type; `call_indirect` / `return_call_indirect` accepted a table of ANY reference type instead of a function table (and `return_call_indirect` still hard-coded an i32 index, missed when call_indirect got table64 in T9.2); `array.*_elem` never compared the segment's element type to the array's; and a bare abstract heap keyword was lexed as a VALUE type. **2658 → 2664 / 2737, and all 73 still accepted are modules V8 accepts too.** Tests `tests/validator/call_and_heaptype.test.ts`. | — |

### Correction: local-init was mis-scoped, and reading the spec test settled it

T9.8 deferred `uninitialized local` with the reasoning *"it needs the
function-references init-tracking algorithm — an init set per control frame,
intersected at an `if` join — and a conservative approximation would reject
valid code, which is the one thing this campaign hasn't done."*

That was wrong on the central point. `local_init.wast`'s own `assert_invalid`
cases decide it:

```wat
(if … (then (local.set $x …)) (else (local.set $x …)))
(drop (local.get $x))          ;; INVALID
```

If the rule intersected at a join, setting the local in **both** arms would
leave it initialised. It does not. The real rule is plain **frame-scoped
rollback**: an initialisation inside a control frame is undone at `end`, an
`else` arm does not see what `then` initialised, and there are no joins at all.

So it was neither large nor an approximation — no risk of false rejections, and
agreement held at 2120/2120 on the first run. **The lesson is the reusable
part**: the deferral came from reasoning about the algorithm from memory rather
than reading what the spec test actually asserts. The evidence was already in
the repo and took minutes to check.

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

**RE-VERIFIED 2026-08-24 against the actual checkout** (`b78e5b476`, v1.3.5,
clean on `main`) per rule 2, and every severity re-measured per rule 1. Six of
the seven stand; **UP-7 was stale and is restated**. The report built from this
is `scripts/binaryen-ts-upstream-report.md`.

**ANSWERED the same day, and TWO SEVERITIES WERE STILL WRONG.** binaryen-ts
confirmed all seven with exact line refs and corrected us:

- **UP-5 is the most severe finding, and it is SILENT** — we had it sixth, as a
  bridge "gap". The decoder reads the start funcidx and throws it away, so
  `readBinary(b).emitBinary()` produces valid wasm that behaves differently
  with no diagnostic. Reproduced here: start section present → absent, exported
  global 42 → 0.
- **UP-1 is a round-trip corruption**, not merely "unencodable" — the decoder
  handles `0x04`/`0x0d` but collapses them onto `signed=false`. Reproduced
  here: `0x04` in, `0x02` out, engine rejects. No builder, no passes.
- **Our "root cause is in the IR, not the encoder" was wrong** — rebuttal
  accepted, see below.
- Their checkout is **v1.4.3** (`00e7e953858`); ours is v1.3.5. They diffed and
  all seven hold. Our `^1.0.9` pin resolves to 1.4.3 today, so the PIN is not
  what made this log stale — the checkout is.

| id | Finding | Severity | Surfaced by |
| --- | --- | --- | --- |
| UP-5 | **A start function is silently DROPPED on round-trip** — the decoder reads the funcidx and discards it. Valid in, valid out, behaviour changed, no diagnostic | **wrong-output, SILENT** | Tier D |
| UP-1 | `struct.get_u` / `array.get_u`: the decoder collapses `0x04`/`0x0d` onto `signed=false`, so **valid wasm round-trips INVALID** — both engines reject | **wrong-output** | GC tiers / T7 review |
| UP-2 | `tuple.make` has an `ExpressionKind` entry but no factory **and no encoder case** | **gap** | multi-value branches |
| UP-3 | Same for all four GC array bulk ops (`array.fill` / `copy` / `init_data` / `init_elem`) | **gap** | tranche 2 |
| UP-4 | `ref.as_non_null` — **not even an `ExpressionKind` entry** | **gap** | Tier C |
| UP-6 | `WasmImport.kind` has no `"tag"` — asymmetric, since `WasmExport.kind` now does | **gap** | Tier C |
| UP-7 | **RESTATED TWICE.** A typed-ref LOCAL collapses to `anyref` on READ (`readValTypeByte`), so a bare `parseWasm → encodeWasm` turns any GC module with typed-ref locals INVALID. The narrowed `ModuleBuilder` surface is the smaller half | **wrong-output** (was "design-limit", then "gap") | typed-ref refactor |

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

**Re-measured 2026-08-24 against v1.3.5, through binaryen-ts's OWN
`ModuleBuilder` + `encodeWasm`** (not a hand-built binary), and put to both
engines. `(struct (field (mut i8)))` holding 200, read three ways:

| sub-opcode | V8 | Wasmtime 47.0.3 | result |
| --- | --- | --- | --- |
| `0x04` `get_u` (spec-correct) | accepts | accepts | `200` (zero-extended) |
| `0x02` `get` — **what binaryen-ts emits for `signed=false`** | **REJECTS** | **REJECTS** | — |
| `0x03` `get_s` — what it emits for `signed=true` | accepts | accepts | `-56` (sign-extended) |

The messages name the fix precisely:

- V8: *"struct.get: Field 0 of type 0 has type i8. Use struct.get_s or
  struct.get_u instead."*
- Wasmtime: *"can only use struct `get` with non-packed storage types"*

The array half behaves identically: binaryen-ts emits `0x0b` for
`signed=false`, V8 rejects it (*"array.get: Array type 0 has type i8. Use
array.get_s or array.get_u instead."*), and `0x0d` `array.get_u` returns 200.

So this is not a cosmetic wire divergence: any consumer reading a PACKED field
unsigned through binaryen-ts gets a module V8 refuses to compile. That raises
it from "worth reporting" to "blocking for packed GC fields".

#### UP-2 — `tuple.make`: enum entry, no factory, no encoder case (gap)

`ExpressionKind.TupleMake = "tuple.make"` is in the enum, but there is **no
`makeTupleMake` factory and no `case` for it in the encoder**. Verified
2026-08-24 by hand-building the node the factory would return and encoding it:

    WasmEncodeError: cannot encode unsupported expression kind: tuple.make

So the enum entry is the only part that exists. Good failure mode — the
encoder's `default` branch throws rather than emitting something wrong — but
the construct is unreachable. Blocks multi-value `return` AND, since our
multi-value branch work, multi-value `br` / `br_if`.

#### UP-3 — the four GC array bulk ops: same shape (gap)

`ArrayFill`, `ArrayCopy`, `ArrayInitData` and `ArrayInitElem` are all in
`ExpressionKind` with **no factory and no encoder case**, exactly like UP-2.
The four instructions we implemented in tranche 2 have no bridge path.

#### UP-4 — `ref.as_non_null`: not even an enum entry (gap)

Stronger than the old note. There is no `makeRefAsNonNull`, no encoder case,
and **no `ExpressionKind` entry at all** — unlike UP-2/UP-3, nothing about the
instruction is present.

#### UP-5 — No `setStart`, and no start section at all (gap)

Confirmed 2026-08-24: `ModuleBuilder` has no `setStart`, and there is no
start-section field in the IR or emit path in the encoder. Start functions
cannot be bridged.

#### UP-6 — `WasmImport.kind` has no `"tag"` (gap)

Confirmed 2026-08-24: `WasmImport.kind` is
`"function" | "global" | "table" | "memory"`. The asymmetry is the useful part
— `WasmExport.kind` DOES include `"tag"` now (see the fixed table above), and
`addTag` defines one, so tag imports are the only remaining hole in tag
support.

#### UP-7 — typed refs stop at the `ModuleBuilder` surface (gap) — RESTATED

**The old entry said "`ValType` cannot express a concrete typed reference — it
is a flat string enum". That is no longer the finding.** v1.3.5 has
`RefType { heap: HeapType; nullable: boolean }` in `src/ir/gc-types.ts`, the
expression-level `Type` is `ValType | TupleType | None | Unreachable | RefType`,
and `FuncTypeDef.params` / `.results` are already `(ValType | RefType)[]`.

What is still narrow is the **`ModuleBuilder` declaration surface**, which is
the layer a bridge actually calls:

| method | today | needs |
| --- | --- | --- |
| `addFunction(name, params, results, …)` | `ValType[]` | `(ValType \| RefType)[]` |
| `addFunctionImport(…, params, results)` | `ValType[]` | same |
| `addGlobal(name, type, …)` | `ValType` | `ValType \| RefType` |
| `addTable(name, type, …)` | `ValType` | same |
| `addTag(name, params)` | `ValType[]` | `(ValType \| RefType)[]` |

So a `(ref $T)` param can be expressed one layer down (`addHeapType` with a
`FuncTypeDef`) but not through the builder that declares the function. This is
a much smaller ask than the original entry implied — widening five signatures
to a union the codebase already defines, not a representational change.

**Re-measured 2026-08-24; this is exactly what rule 2 exists for.** The stale
version would have asked the binaryen-ts team to build something they had
already built.

### Framing for the report

Several of these were found by measuring **V8 validity** of encoder output
across the 257-file WebAssembly spec testsuite rather than by unit tests —
that method is worth mentioning to them, since it is what surfaced the
silent-wrong-bytes class in our own encoder too (packed-type wire bytes,
NaN payload mask, multi-value truncation).

### Filed — 2026-08-24

The T-series tranches closed on 2026-08-24, which is this log's stated trigger.
Report written to
[`scripts/binaryen-ts-upstream-report.md`](../scripts/binaryen-ts-upstream-report.md).

**Rule 2 earned its place.** Re-verifying before filing changed three of the
seven entries:

- **UP-7 was wrong in the report's favour.** It claimed `ValType` "cannot
  express a concrete typed reference" and called it a design limit. v1.3.5 has
  `RefType`, the expression `Type` includes it, and `FuncTypeDef` already
  accepts it — only the `ModuleBuilder` DECLARATION surface is narrow. Filing
  the stale version would have asked them to build something they had built.
- **UP-2 / UP-3 were understated.** Both were logged as "no factory". The
  encoder has no `case` for those kinds either, so it is not one missing
  function per instruction.
- **UP-4 was overstated in the opposite direction** — it is not just a missing
  factory, there is no `ExpressionKind` entry at all.

And the three entries in the "already fixed upstream" table were re-confirmed
present, so the report says so explicitly rather than staying silent about our
own stale notes.

**UP-1's severity was re-measured, not carried over** — this time through
binaryen-ts's OWN `ModuleBuilder` + `encodeWasm` rather than a hand-built
binary, and put to Wasmtime as well as V8. Both reject. That is the difference
between "we think this is wrong" and a report they can act on in one reading.

### Answered — 2026-08-24, and two of our severities were still wrong

Re-verifying before filing (rule 2) caught three stale entries. It did **not**
catch two mis-ranked severities, and the recipient did:

| we said | actually |
| --- | --- |
| UP-5: "no `setStart`" — a bridge gap, ranked 6th of 7 | **the most severe finding, and silent.** The decoder discards the start funcidx; `readBinary(b).emitBinary()` yields valid wasm with different behaviour and no diagnostic |
| UP-1: "unencodable", blocking | **a round-trip corruption** — valid `0x04` in, `0x02` out, engine rejects. No builder, no passes |
| "six of seven fail loudly; only UP-1 emits bad bytes" | **two of seven produce wrong output, and the silent one is worse** |

Both reproduced here before being accepted, not taken on trust.

**The rebuttal we accepted.** We wrote *"the root cause is in the IR, not the
encoder — an encoder-only patch cannot fix it"*, then offered as option (2)
exactly such a patch. They pointed out option (2) is complete: packedness is
available at encode time via `this.mod.heapTypes`, and given packedness
`signed` is total (non-packed → `get` only; packed → `get_s`/`get_u`). Verified
both halves. **We undersold our own recommendation with the sentence above it.**

**What we sent back.** Deriving the sub-opcode from packedness makes today's
invalid `0x02`-on-packed decode and re-encode as valid `0x04` — an encoder
repairing its input, our T11 class. The clean split is for the DECODER to
reject it.

### UP-7 corrected a second time — and we over-corrected the first time

We restated UP-7 once (design-limit → gap) when re-verifying showed `RefType`
already exists, and called it *"a much smaller ask than our old note implied —
widening five signatures"*. **That over-corrected.** binaryen-ts found the
other half while writing a behavioural test for `array.fill`:

```ts
function readValTypeByte(r: BinaryReader): ValType {
  const t = readValueType(r);
  if (typeof t === "string") return t as ValType;
  return ValType.AnyRef;      // ref type in a legacy position
}
```

A local declared `(ref null $t)` reads back as `anyref`. Reproduced here:
fixture returns 7; `0x63 0x00` in the input becomes `0x6e` in the round-trip;
V8 rejects with *"array.get[0] expected type (ref null 0), found local.get of
type anyref"*. **Third wrong-bytes finding**, pre-existing, untouched by their
Tier 1/2 work.

**The count went 1 → 2 → 3, wrong in the same direction each time.** We
under-rated everything filed as "surface" or "gap" because we were measuring
what the BRIDGE could not express. The round-trip path —
`readBinary(b).emitBinary()`, no builder, no passes — was never what we
measured, and all three wrong-bytes findings live there.

That is the same blind spot the campaign's own third metric exists to cover:
parse-clean and V8-validity both measure the ENCODE path, and T9.1 was
invisible to both. **We built a round-trip metric for ourselves and then
reviewed someone else's codebase without one.**

### Their Tier 1 / Tier 2 fixes are NOT yet recheckable

`origin/main` is `00e7e9538` / v1.4.3; neither `dd88e034bd0` (Tier 1: UP-1,
UP-5) nor `f664ba579a0` (Tier 2: UP-6, UP-4, UP-3) exists on any ref — their
work is local and unpushed. Recheck is queued; the checkout is a plain clone of
`github.com/jrmarcum/binaryen-ts.git`, so pulling is self-serve.

Verified at v1.4.3 in the meantime: UP-1 and UP-5 reproduce unchanged, so the
baseline did not move with the version bump.

**Four of their process findings are worth keeping**, independent of this
report:

1. **Enabling test type-checking caught a scrambled fixture** —
   `addTable("a", 1, null, ValType.FuncRef)` against `(name, type, initial,
   max)`. It passed because the test asserted only a throw, which fired
   regardless of the arguments. *A test that asserts a throw can be arbitrarily
   wrong about everything else and stay green.*
2. **A tag index space needed three sites to agree**; `parse()` rebuilt every
   tag as `$tag${i}`, discarding the offset the reader had computed — their
   `$import${n}` bug reproduced in a new index space.
3. **Omitting one of `_mapChildren` / `_visitChildren` makes a node invisible
   to every pass instead of erroring.** Silent-skip rather than loud-fail.
4. **`array.copy`'s dest/src immediate order gets its own test**, because
   swapping them is invisible when both types match — the same shape as our
   `memory.init` `(memory, data)` vs `(data, memory)` note.

### The lesson this pair of exchanges is actually about

Two reports went out the same day. One carried a version stamp; one rested on
an un-stamped vendored corpus.

| | binaryen-ts report | wasmtk report |
| --- | --- | --- |
| snapshot identified? | **yes** — `b78e5b476`, v1.3.5 | **no** — 272 files, no commit, no date |
| what happened | recipient noticed in one step, diffed, confirmed all seven still hold | we asserted seven modules were currently broken; all seven had been fixed — **retracted** |

Same failure mode, opposite outcomes, and the only difference was whether the
snapshot said what it was. See `tests/wasmtk/PROVENANCE.md`.

**And re-verifying is not the same as re-ranking.** Rule 2 got the facts
current; it did not re-ask "which of these is worst, and why". Severity
ordering is a separate judgement from freshness, and ours was wrong in the way
that matters most — we ranked the loud failure above the silent one, when
silent is the one that ships.

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
