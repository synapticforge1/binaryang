# Testing

## Running

```bash
deno task check     # type-check (use Deno for both Deno and Bun targets)
deno task test      # deno test — the full suite
deno lint           # lint
deno fmt --check    # format check
```

Tests use `@std/testing/bdd` (`jsr:@std/testing`) so the same files run under `deno test` and
`bun test`. Import via the `@std/testing` entry in `deno.json`'s import map.

Test tree mirrors `src/`: `tests/core/`, `tests/reader/`, `tests/writer/`, `tests/parser/`,
`tests/validator/`, `tests/bridge/`, `tests/tools/`, `tests/api/`, `tests/audit/` (the
silent-corruption audit regressions), plus `tests/fixtures/` (`.wasm` / `.wat` vectors) and
`tests/wasmtk/` (real-world corpus, below). Full suite is **146 tests / 1044 steps** as of
2026-06-09.

## The wasmtk WAT corpus

`tests/wasmtk/` holds **272 real-world WAT files** emitted by wasmtk's wasic compiler. The runner at
`tests/wasmtk/runner.test.ts` walks the directory and asserts each compiles cleanly through
`wat2wasm` + `validate`, reporting failures by filename. **Adding a file = dropping it in the
directory** — the runner picks it up automatically.

- Only **standalone** modules belong — no pre-link files that reference unimported externals (the 6
  `$mathlib_*` files originally there were removed).
- This corpus has surfaced bugs the hand-crafted tests missed: bare-offset elem segments, legacy
  `(try (do …))` syntax, SIMD opcode-name table drift, and more.
- **`tests/wasmtk/roundtrip.test.ts`** runs the _reverse_ direction over the same corpus:
  `wat2wasm → wasm2wat → wat2wasm`, asserting the disassembly RE-COMPILES. This is the structural
  guard for the invalid-`wasm2wat`-output class (the round-5 missing-`$` bug). The plain runner only
  checks the forward direction; this closes the loop. All 272 round-trip clean as of 2026-06-09.

## `tests/wasmtk/` is a FROZEN SNAPSHOT — regenerate before reporting upstream

272 files here; wasmtk's live corpus emits **373**, and no source commit was recorded. Full detail
and the refresh procedure: `tests/wasmtk/PROVENANCE.md`.

**Rule, adopted from wasmtk's own `cmem/testing.md` after it cost us a wrong report (2026-08-24):
regenerate from the wasmtk checkout before validating against another runtime or stating anything
about wasic.** The snapshot supports "our toolchain handles this shape". It does not support "wasic
emits X" or "wasic has bug Y" — we made exactly that claim about seven modules that had already been
fixed upstream.

## The wasmtk-driven hardening loop (this IS the design)

The convergence pattern is: **real module shape surfaces a wabt-ts bug → fix at root cause + add a
regression test.** This loop is the design, not a transitional phase. wasmtk's Phase 1 suite passes
38/38 against `@jrmarcum/wabt-ts@1.1.8` (2026-05-28 milestone), covering the multi-value receive
idiom (Bug D), `br_if` cond with non-first globals (Bug F), the Tier D bridge surface, and the full
272-file corpus runner. Future wasmtk phases will re-open the loop; expect it.

## The conformance metrics — and what each one is BLIND to

Seven numbers, all exhausted as of 2026-08-24. **They live outside `deno task test`**; nothing in the
suite will catch a regression in them, so re-measure after any parser / reader / writer / validator
change. Harnesses live in the session scratchpad (~40–120 lines each, cheaper to rewrite than
maintain); `tasks.md` records what each measured and when.

| metric                    | value               | blind to                                                                                    |
| ------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| parse-clean               | 257 / 257           | a file that parses and then encodes to bytes V8 rejects                                     |
| V8-valid                  | **2119 / 2120**     | a decoder that REORDERS a module (T9.1 changed what a program computed) — and, until T13.2, an ENCODER that truncates one: two of these passed only because their limits were wrapped into range first |
| validator agreement       | **2119 / 2119**     | counts only false REJECTIONS — says nothing about what a permissive validator waves through |
| `assert_invalid`          | **2683 / 2683**     | the converse. The denominator read 2737 until `assert_trap (module …)` stopped being classified as `assert_invalid` — **a metric measures the population its classifier hands it**. And for a whole campaign the last 19 read as "modules the engines accept" when 16 were the ENCODER repairing them first (T13.2) — **this metric cannot see the difference between a permissive validator and a rewritten module** |
| round-trip byte-identical | **2119 / 2119**     | a consistently-wrong opcode mapping — reader and writer agree, so the bytes match           |
| **execution**             | **23,077 / 23,077** | anything needing host imports, v128, NaN payloads, `ref.func` args (29,544 skipped)         |
| **`assert_malformed`**    | **1229 / 1229** quoted · **711 / 711** binary | the ACCEPTING direction, which the other six cover. It read 1227 at `parseWatModule` and 1229 through `wat2wasm` until T13.1 moved the label check into the parser — **where you put the probe changes the number** |

**The whole point is the last column.** Every one of these was added because the existing set could
not see a real bug. `wat2wasm` does not validate, which is how the entire SIMD half of the validator
sat dead for four releases (T9.2) — four metrics and none of them ran the validator at all.

**Execution is the newest and the reason is structural:** the first five all check bytes or
acceptance. A parser that mapped a token to the wrong opcode would be V8-valid, validator-clean and
byte-identical on round-trip (the reader maps the wrong byte back the same way) — and compute the
wrong answer. Only running it catches that.

**Print what a harness SKIPS.** The execution harness once reported a stable, plausible 2,084 /
2,240 while executing **only nullary functions** — a `WastArg` is `{kind:'value', value: Const}` and
it read `.type` off the wrapper. The real denominator was 26,837. A denominator is a measurement
too.

## Regression-test placement (where each invariant's test lives)

- `tests/tools/wat2wasm.test.ts` — natural-alignment-when-`align=` omitted.
- `tests/reader/binary-reader.test.ts` — function-import-alongside-defined-function (the Phase 7
  off-by-one in `readCodeSection`).
- `tests/parser/stmt_order.test.ts` — statement ordering (`pushStmt` flush;
  void-call-before-return).
- `tests/parser/empty_folded.test.ts` — Bug D (multi-value receive) + Bug F (br_if global
  resolution).
- `tests/parser/legacy_try.test.ts` — folded/linear/catch_all/delegate/multi-catch parse shape; V8
  compile + throw/catch/catch_all/rethrow runtime; round-trip non-duplication.
- `tests/writer/tag_type_index.test.ts` - T10.7: a tag's type is matched with `valueTypeEquals`, not
  `===`, so a typed-reference param does not make the encode throw; and the fail-loud message names
  the type instead of printing `[object Object]`.
- `tests/writer/nan_payload.test.ts` - T10.4: `nan:0x<n>` names the mantissa exactly, so a quiet NaN
  does not round-trip into a signalling one; plus `return_call_indirect` keeping its table index. 22
  cases.
- `tests/parser/linear_try_table.test.ts` - T10.6: the LINEAR `try_table` form keeps its catch
  clauses and its body (it was a stub that skipped both), and `array.new_fixed` takes its immediate
  element count instead of draining the operand stack. 8 cases.
- `tests/writer/table_init.test.ts` — T10.3: a table initializer is written as the single folded
  instruction the grammar requires, and an inexpressible one throws instead of being silently
  dropped. 6 cases including the nested `(ref.i31 (global.get $g))` form.
- `tests/validator/memarg_offset.test.ts` — T9.11: every memarg handler checks `offset` against the
  memory's index type, not just `onLoad` / `onStore`. 11 cases, each cross-checked against V8,
  including the `0xffffffff` boundary and a 64-bit memory.
- `tests/writer/operand_placeholder.test.ts` — T10.8: a synthesized operand slot-filler
  (`NopExpr.placeholder`) is not written out by either writer. 9 cases, including three T11
  no-repair guards — a starved `local.set`, an explicit `(nop)` operand and a starved `i32.add` must
  all stay invalid to V8 AND to our validator.
- `tests/parser/call_arity.test.ts` — T10.5: linear-form `call` drained the whole operand stack
  instead of popping the callee's arity, so a following instruction's operand slot got a Nop and the
  encoding grew a byte on every round trip. 8 cases; 5 fail on the pre-fix parser and 3 are guards
  (Bug D folded multi-value receive, local-name resolution across the deferred body parse, and a
  V8-executed check that the value is still the one named).
- `tests/writer/export_order.test.ts` — T10.1 / T10.2: the inline `(export "n")` abbreviation is
  illegal on an import and re-orders the export section, so the WAT writer tests before using it. 6
  cases; 5 fail on the pre-fix writer and the sixth guards that inlining still happens when it IS
  faithful (a fix that just disabled the abbreviation would pass the other five).
- `tests/bridge/tier_b.test.ts`, `tier_c.test.ts`, `tier_d.test.ts`, `gc_tier1..4.test.ts` — bridge
  coverage (GC tiers verify binary encoding, not V8 round-trip — typed-ref IR is loose).
- `tests/api/wabt_compat.test.ts` — 12 steps incl. the exact wasmtk call patterns from
  `src/utils.ts` and `src/wasmbundle.ts`.
- `tests/audit/silent_corruption_fixes.test.ts` — the 2026-06-09 audit round-1 Critical+High fixes
  (SIMD float lexer opcodes, tag-import type index, v128.store/load_splat decode, call_ref sigType,
  trunc_sat validation, multi-catch body, SIMD lane validation/arity, natural-align, apply-names
  local.get, Table.init).
- `tests/audit/silent_corruption_fixes_round2.test.ts` — the round-2 fixes (SIMD reader operand
  arity + lane ranges, `writeVar` fail-loud, resolveNames `simd_lane_op.value`/segment-var gaps,
  `parseLimits` memory64 index type, `try_table` unknown-catch-kind fail-loud).

When fixing a footgun/silently-wrong bug, add the regression alongside the invariant note in
[design-decisions.md](design-decisions.md). Fail-loud (throw) over silent-wrong output is the
project contract.

- `tests/parser/wide_arithmetic.test.ts` — the whole wide-arithmetic proposal end to end: all four
  operands reach the IR in BOTH forms, `wasm2wat` can read back what `wat2wasm` writes, the
  validator types all four correctly (Wasmtime-verified; V8 gates the proposal off and cannot
  arbitrate), and an exhaustive lexer-vs-reader sweep guards the CLASS. 15 cases.

- `tests/parser/label_scope.test.ts` — T13.1: out-of-scope branch targets, every legal
  spelling, and the two scopes that are NOT the enclosing block (a `try_table` catch target
  and a legacy `try` delegate).
- `tests/ir/limits_bigint.test.ts` — T13.3: a 64-bit limit surviving at full width through
  parse, encode, decode and print; the bounds that still apply; and a maximum of zero.
- `tests/writer/no_repair.test.ts` — T13.2: limits that must not be truncated, the table
  bound following its index type, an out-of-range type index staying out of range, and an
  implicit type-use not borrowing from a multi-member rec group.
- `tests/parser/duplicate_ids_and_tokens.test.ts` — T12.9: duplicate ids across every index
  space, NaN payload range (with a V8 round trip proving the in-range ones stay NaNs), lane
  immediates, the token-boundary rule, one `(start …)` per module, and the deferred
  forward type-use check.
- `tests/reader/binary_malformed.test.ts` — T12.8: section identity/order/size, entry counts,
  the closing `end` of a body, the flag bytes with no defined meaning, and the data-count
  section. Written as hex-dump literals so each module reads as bytes.
- `tests/parser/annotation_lexing.test.ts` — T12.7: annotation body characters and the
  required id, plus the string/comment exemptions annotations.wast asserts as valid, and the
  quoted spelling of an ordinary identifier.
- `tests/parser/type_use_and_label.test.ts` — T12.7: a repeated closing label must match, an
  inline signature must agree with the type it restates (and must not re-intern it), and the
  order/naming rules that reading it recovers.
- `tests/parser/lane_and_nan_context.test.ts` — T12.6: a lane op requires its immediate, and the
  NaN result patterns are rejected in instructions while staying legal per-lane in an
  expected-result v128 (the contextual rule), plus a no-leak check on the flag.
- `tests/parser/name_utf8.test.ts` — T12.5: names must be valid UTF-8 in both the text and binary
  paths, data segments stay exempt, and a BOM in a name stays a character (T7.13 guard).
- `tests/parser/simd_lane_range.test.ts` — T12.4: lane immediates must fit `u8` (malformed) while
  16..255 stays a VALIDATION error, and `v128.const` lane values must fit their width. Both
  boundary directions plus a V8-executed no-wrap check.
- `tests/parser/align_power_of_two.test.ts` — T12.3: `align=N` must be a power of two (parse-time,
  malformed), while an oversized alignment stays a VALIDATION error — one test pins each layer.
- `tests/parser/import_order.test.ts` — T12.2: an import may not follow a definition (the inline
  abbreviation included), with seven legal orderings guarded so the rule is not a blanket
  rejection, plus a V8-executed check that `call` still means what source order says.
- `tests/parser/const_range.test.ts` — T12.1: integer constants are range-checked rather than
  truncated, and a FINITE float literal that rounds to infinity is out of range (`inf` must be
  spelled `inf`). 21 cases including the boundary in both directions.

## CI gate

`.github/workflows/ci.yml` runs `deno fmt --check`, `deno lint`, `deno task check`,
`deno task test`, and `deno publish --dry-run` on every push/PR to `main`. See
[publishing.md](publishing.md).
