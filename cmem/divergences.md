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

| id | vs       | what differs                                                                                                                                | class      | status / authority                                                                        |
| -- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| G1 | wabt     | GC text syntax — `(ref null any)`, `(sub …)`, heap-type keywords. wabt 1.0.41 has none                                                      | FEATURE    | the spec is the authority; upstream `wat2wasm` cannot be consulted (G2)                   |
| G2 | wabt     | `wast2json` 1.0.41 cannot split 30 GC-proposal spec files; `deno task spec` skips them                                                      | ORACLE GAP | those 30 files are untested by the harness — say so in any claim covering them            |
| G3 | wabt     | any GC-typed WAT probe: upstream rejects with "unexpected token" — a missing feature, not a verdict                                         | ORACLE GAP | read the error TEXT; use V8 for behaviour, our wabt-ts for assembly                       |
| R1 | binaryen | body representation: a `RegionExpr` in every region slot (upstream: `Expression*`, often an unnamed `Block`)                                | DESIGN     | S6 decision 5, `7f3ec1d6e`. Passes see one slot; a region is never a branch target        |
| R2 | binaryen | an all-nop body vacuums to an EMPTY region and encodes as nothing; the pre-region port emitted `nop`                                        | DESIGN     | consequence of R1. ⬚ upstream `wasm-opt`'s own output for this case not yet compared      |
| B1 | binaryen | block PARAMETERS stay on the node through the fidelity phase; lowered to locals only when optimization starts. Upstream lowers at read time | DESIGN     | S6 decision 7b(i), owner-decided 2026-09-10; ⬚ not yet implemented                        |
| V1 | binaryen | branch/return values held as a LIST (`values: Expression[]`); upstream uses one `value` + `tuple.make`                                      | DESIGN     | S6 decision 6A, owner-decided 2026-09-10; ⬚ not yet implemented                           |
| C1 | binaryen | LocalCSE CSEs a bare `local.get` and constants; upstream's `isRelevant` excludes both (`LocalCSE.cpp:356`)                                  | DEFECT     | ⬚ open — in the pre-6/7 bug queue                                                         |
| W1 | wabt     | binaryen-ts's WAT path emits an `else` for `(else)` with no instructions; upstream omits it                                                 | DEFECT     | ⬚ open — in the pre-6/7 bug queue                                                         |
| W2 | wabt     | binaryen-ts's WAT path ignores `(func (type $a))` and throws for undeclared signatures once any `(type …)` exists                           | DEFECT     | ⬚ open — in the pre-6/7 bug queue                                                         |
| W3 | wabt     | binaryen-ts's WAT path rejects `(type $t)` on block / loop / if                                                                             | DEFECT     | ⬚ open — pre-6/7 queue for parameter-less types; with parameters it is B1                 |
| X1 | both     | binaryen-ts's decoder DROPS `any.convert_extern` / `extern.convert_any` (`push(pop())`); V8 rejects where the conversion is load-bearing    | DEFECT     | ⬚ open — in the pre-6/7 bug queue; a real node is needed, not a bridge case               |
| S1 | wabt     | a NUMERIC select written typed (`0x1c`) re-encodes untyped (`0x1b`) through binaryen-ts                                                     | DEFECT     | ⬚ form only (valid, same behaviour); S6 decision 7c. Reference-typed select is fixed      |
| T1 | wabt     | `call_indirect (type $b)` re-encodes naming an identical `$a` (first structural match) through binaryen-ts                                  | DEFECT     | ⬚ form only — probed: behaviour preserved even with non-final/final GC types; decision 7c |

## Closed — defects that were divergences, kept as history

Each is pinned by a test whose expected output is upstream's (or V8's, where upstream cannot reach).

| vs       | what differed                                                                               | fixed       | pinned by                    |
| -------- | ------------------------------------------------------------------------------------------- | ----------- | ---------------------------- |
| wabt     | binaryen-ts WAT accepted nonexistent memory mnemonics (`f32.load8_s` → `f32.load`, …)       | `006326af7` | `memory_mnemonics.test.ts`   |
| wabt     | binaryen-ts WAT wrapped out-of-range `i32.const`, rejected unsigned-range `i64.const`       | `a73daee32` | `int_literal_range.test.ts`  |
| binaryen | i64 narrow stores encoded at the wrong width (cancelled by an inverse decoder rotation)     | `b8b3150db` | `narrow_store_width.test.ts` |
| wabt     | binary round trip invented a `nop` in an empty body; dropped an explicit empty `else`       | `365e9277c` | `region_fidelity.test.ts`    |
| wabt     | binaryen-ts WAT dropped values from a multi-value `br_table` (V8 rejected)                  | `87e5766c3` | `branch_values.test.ts`      |
| wabt     | binaryen-ts did not decode typed select `0x1c`, and could not emit a reference-typed select | `b64b2e144` | `typed_select.test.ts`       |

## When refactoring or optimizing — the checklist

1. **Before porting or re-porting an upstream pass**, read the DESIGN rows it touches (R1, B1, V1):
   upstream's code assumes its own IR, and a faithful port of it can silently undo ours.
2. **Before "matching upstream" to shave bytes or simplify**, check the row is not DESIGN or
   FEATURE.
3. **Before claiming "byte-identical to upstream"**, check the ORACLE GAP rows — for GC it cannot
   be.
4. **A new difference found by any probe gets a row** before the work that found it is called done.
