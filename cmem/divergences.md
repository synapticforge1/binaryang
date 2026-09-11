# Divergences from upstream wabt and binaryen — the register

Owner direction, 2026-09-10: binaryang will necessarily diverge from both upstreams — it is building
features they have not (GC text, and more to come), and S6 makes design choices neither made.
**Every divergence is tracked here, classified, and consulted before any refactoring or
optimization** — especially once the initial goals are met and the code base starts being reshaped.

## Why a register, and not notes where each was found

A divergence has two opposite failure modes, and a scattered note cannot prevent either:

- **An INTENDED divergence gets "fixed" back to upstream.** A later refactor or a freshly ported
  upstream pass sees binaryang doing something upstream does not, and "corrects" it — silently
  removing a feature or a fidelity guarantee.
- **A DEFECT gets mistaken for an intended one** and is never fixed, because "we diverge there
  anyway".

And upstream stops being an oracle exactly where we diverge. A byte-level claim that normally leans
on upstream `wat2wasm` / `wasm-opt` must say so when it cannot — see ORACLE GAP below.

## Classes

| class          | meaning                                                                        | what a change must do                                              |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **FEATURE**    | we support something upstream does not                                         | keep it; test against the spec, not upstream                       |
| **DESIGN**     | we represent or process something differently, on purpose, with a recorded why | keep it unless the why is re-decided; do not port upstream over it |
| **ORACLE GAP** | upstream cannot judge this input at all                                        | name the authority actually used (the spec, V8, our own harness)   |
| **DEFECT**     | we differ and should not — open until fixed, then kept here as history         | fix it; pin it with a test whose expected bytes are upstream's     |

**Rule for every probe against upstream:** a difference is not done until it has a row here with a
class. "Valid either way" is not a class.

## Open and intended

| id | vs       | what differs                                                                                                                                | class      | status / authority                                                                                    |
| -- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| G1 | wabt     | GC text syntax — `(ref null any)`, `(sub …)`, heap-type keywords. wabt 1.0.41 has none                                                      | FEATURE    | the spec is the authority; upstream `wat2wasm` cannot be consulted (G2)                               |
| G2 | wabt     | `wast2json` 1.0.41 cannot split 30 GC-proposal spec files; `deno task spec` skips them                                                      | ORACLE GAP | those 30 files are untested by the harness — say so in any claim covering them                        |
| G3 | wabt     | any GC-typed WAT probe: upstream rejects with "unexpected token" — a missing feature, not a verdict                                         | ORACLE GAP | read the error TEXT; use V8 for behaviour, our wabt-ts for assembly                                   |
| R1 | binaryen | body representation: a `RegionExpr` in every region slot (upstream: `Expression*`, often an unnamed `Block`)                                | DESIGN     | S6 decision 5, `7f3ec1d6e`. Passes see one slot; a region is never a branch target                    |
| R2 | binaryen | an all-nop body vacuums to an EMPTY region (`00 0b`); upstream `wasm-opt --vacuum` leaves one `nop` (`00 01 0b`) — probed 2026-09-10        | DESIGN     | consequence of R1; the spec allows an empty body, and ours is a byte smaller                          |
| E1 | wabt     | a binary `if` with an explicit EMPTY `else` (`04 40 … 05 0b`) keeps the `else` through binaryen-ts; wabt's text path drops it               | DESIGN     | fidelity — upstream `wasm-opt` keeps it too (probed). ⬚ wabt-ts drops it: unify in S6                 |
| B1 | binaryen | block PARAMETERS stay on the node through the fidelity phase; lowered to locals only when optimization starts. Upstream lowers at read time | DESIGN     | S6 decision 7b(i), `02d77f533`. `PassRunner` lowers first; no pass may see `params`                   |
| V1 | binaryen | branch/return values held as a LIST (`values: Expression[]`); upstream uses one `value` + `tuple.make`                                      | DESIGN     | S6 decision 6A, `2b5850a8a`. No `tuple.make` kind; do not port one back in                            |
| S2 | binaryen | a NUMERIC select written typed (`0x1c`) stays typed through binaryen-ts; `wasm-opt` rewrites it `0x1b` (probed)                             | DESIGN     | S6 decision 7a, `7171b8b38` — the declared type is on the node. wabt keeps it too                     |
| T1 | wabt     | `call_indirect (type $b)` re-encodes naming an identical `$a` (first structural match) through binaryen-ts                                  | DEFECT     | ⬚ form only — probed: behaviour preserved even with non-final/final GC types; decision 7c             |
| T2 | wabt     | binaryen-ts's encoder DERIVES the type-section order when no type is declared (signatures, tags, then expression uses), reordering input    | DEFECT     | ⬚ form only; decision 7c territory with T1. Measured by the type-order probe, 2026-09-10              |
| W4 | wabt     | binaryen-ts's own `parseWat` is a FOLDED SUBSET: no multi-operand stack sources, stack conditions, block params, or bare linear form        | DESIGN     | owner 2026-09-10: external WAT goes wabt-ts → bytes → decoder (`e18d9f09a`); `parseWat` internal only |
| W5 | wabt     | wabt-ts orders IMPLICIT types wrongly: a block's before its function's own, `call_indirect`'s after every signature. Upstream: text order   | DEFECT     | ⬚ form only. Upstream: explicit types first, then implicit in text order, interleaved                 |
| W6 | wabt     | wabt-ts writes a DataCount section whenever data segments exist; upstream wat2wasm only when `memory.init` / `data.drop` use it             | DEFECT     | ⬚ form only, 3 bytes. 242 corpus modules differ from upstream in section 12 alone                     |

**N1 — NAMES are lost at three hops** (found 2026-09-10, from the W4 route; owner: "so that this
is not skipped"). `$foo` does not survive WAT → wabt-ts → bytes → binaryen-ts:

| hop                     | today                                                                          | upstream                                   |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| wabt-ts binary writer   | writes NO name section — `writeDebugNames` is declared and IGNORED (`_opts`)   | wat2wasm writes one with `--debug-names`   |
| binaryen-ts decoder     | `readNameSection` SKIPS it                                                     | wasm-opt always reads it                   |
| binaryen-ts encoder     | writes none                                                                    | wasm-opt writes it with `-g` (`debugInfo`) |

Class DEFECT, vs both. ⚠️ **The three are coupled to decision 7b(i)**: `lowerBlockParams`
re-decodes `encodeWasm(module)` and refuses a module whose names no longer match its own bytes. Once
the decoder reads real names, an encoder that drops them makes every NAMED module with block
parameters fail that check — so the decoder and encoder halves land together, with the lowering
re-encode keeping names.

The name section follows the code section, so the decoder must SCAN for it first (the bytes are in
memory) and name entities before any body refers to them — and uniquify duplicate or clashing names,
as upstream binaryen does. A flag that promises a feature and does nothing is the `compactImports`
shape again: implement `writeDebugNames`, never leave it ignored.

**wabt-ts vs upstream wat2wasm, byte for byte, on the 421-file corpus: 146 identical** (measured
2026-09-10, default features — `--enable-all` changes what upstream EMITS). 242 differ in the
DataCount section alone (W6); ~33 more in type / function / code / tag sections, consistent with W5.
Never measured before: the corpus baseline pins wabt-ts's OWN output, so any divergence older than
the baseline is invisible to it.

## Closed — defects that were divergences, kept as history

Each is pinned by a test whose expected output is upstream's (or V8's, where upstream cannot reach).

| vs       | what differed                                                                               | fixed       | pinned by                     |
| -------- | ------------------------------------------------------------------------------------------- | ----------- | ----------------------------- |
| wabt     | binaryen-ts WAT accepted nonexistent memory mnemonics (`f32.load8_s` → `f32.load`, …)       | `006326af7` | `memory_mnemonics.test.ts`    |
| wabt     | binaryen-ts WAT wrapped out-of-range `i32.const`, rejected unsigned-range `i64.const`       | `a73daee32` | `int_literal_range.test.ts`   |
| binaryen | i64 narrow stores encoded at the wrong width (cancelled by an inverse decoder rotation)     | `b8b3150db` | `narrow_store_width.test.ts`  |
| both     | binary round trip invented a `nop` in an empty body (both upstreams keep it empty)          | `365e9277c` | `region_fidelity.test.ts`     |
| binaryen | binary round trip dropped an explicit empty `else` (`wasm-opt` keeps it; see E1)            | `365e9277c` | `region_fidelity.test.ts`     |
| wabt     | binaryen-ts WAT dropped values from a multi-value `br_table` (V8 rejected)                  | `87e5766c3` | `branch_values.test.ts`       |
| wabt     | binaryen-ts did not decode typed select `0x1c`, and could not emit a reference-typed select | `b64b2e144` | `typed_select.test.ts`        |
| wabt     | W2: binaryen-ts WAT ignored `(func (type $a))`; threw for undeclared signatures             | `152d0ed76` | `type_use.test.ts`            |
| wabt     | W3: binaryen-ts WAT rejected `(type $t)` on block / loop / if (with params it is now B1)    | `152d0ed76` | `type_use.test.ts`            |
| both     | X1: decoder DROPPED `any.convert_extern` / `extern.convert_any`; V8 rejected the output     | `9d5c886be` | `extern_convert.test.ts`      |
| wabt     | W1: binaryen-ts WAT emitted an `else` for an empty `(else)`; `wat2wasm` omits it            | `ce77680de` | `region_fidelity.test.ts`     |
| binaryen | C1: LocalCSE cached a bare `local.get` / constant; upstream `isRelevant` excludes both      | `5b0cf25c6` | `passes.test.ts` (-Oz −3.9%)  |
| wabt     | S1: a numeric typed select re-encoded untyped through binaryen-ts (now S2, vs binaryen)     | `7171b8b38` | `typed_select.test.ts`        |
| wabt     | wabt-ts's folded `if` DROPPED every condition-slot instruction but the last (its inputs)    | `c309e57a0` | `folded_block_params.test.ts` |

W3 with block PARAMETERS: the binary path keeps them since B1, and external WAT with them reaches
binaryen-ts through wabt-ts since W4's route. Only binaryen-ts's internal `parseWat` still refuses
them, loudly.

**The front-door decision behind W4** (owner, 2026-09-10): the end state is WAT → wabt-ts parser →
wabt-ts binary writer → bytes → binaryen-ts decoder. So binaryen-ts's WAT parser is not a second
front end to be completed — it is internal, and a candidate for retirement once S6 unifies the tree.
Do not invest in its stack-form support ("Stage 1" in ir-convergence is superseded). C1's pin is
upstream's rule, not upstream's bytes: the test FAILS against the pre-fix pass, and the three
invalidation tests it had made vacuous were rebuilt and verified to FAIL with invalidation disabled.

## When refactoring or optimizing — the checklist

1. **Before porting or re-porting an upstream pass**, read the DESIGN rows it touches (R1, R2, E1,
   B1, V1, S2): upstream's code assumes its own IR, and a faithful port of it can silently undo
   ours.
2. **Before "matching upstream" to shave bytes or simplify**, check the row is not DESIGN or
   FEATURE.
3. **Before claiming "byte-identical to upstream"**, check the ORACLE GAP rows — for GC it cannot
   be.
4. **A new difference found by any probe gets a row** before the work that found it is called done.
