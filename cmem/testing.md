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
`tests/validator/`, `tests/bridge/`, `tests/tools/`, `tests/api/`, plus `tests/fixtures/` (`.wasm` /
`.wat` vectors) and `tests/wasmtk/` (real-world corpus, below).

## The wasmtk WAT corpus

`tests/wasmtk/` holds **272 real-world WAT files** emitted by wasmtk's wasic compiler. The runner at
`tests/wasmtk/runner.test.ts` walks the directory and asserts each compiles cleanly through
`wat2wasm` + `validate`, reporting failures by filename. **Adding a file = dropping it in the
directory** — the runner picks it up automatically.

- Only **standalone** modules belong — no pre-link files that reference unimported externals (the 6
  `$mathlib_*` files originally there were removed).
- This corpus has surfaced bugs the hand-crafted tests missed: bare-offset elem segments, legacy
  `(try (do …))` syntax, SIMD opcode-name table drift, and more.

## The wasmtk-driven hardening loop (this IS the design)

The convergence pattern is: **real module shape surfaces a wabt-ts bug → fix at root cause + add a
regression test.** This loop is the design, not a transitional phase. wasmtk's Phase 1 suite passes
38/38 against `@jrmarcum/wabt-ts@1.1.8` (2026-05-28 milestone), covering the multi-value receive
idiom (Bug D), `br_if` cond with non-first globals (Bug F), the Tier D bridge surface, and the full
272-file corpus runner. Future wasmtk phases will re-open the loop; expect it.

## Regression-test placement (where each invariant's test lives)

- `tests/tools/wat2wasm.test.ts` — natural-alignment-when-`align=` omitted.
- `tests/reader/binary-reader.test.ts` — function-import-alongside-defined-function (the Phase 7
  off-by-one in `readCodeSection`).
- `tests/parser/stmt_order.test.ts` — statement ordering (`pushStmt` flush; void-call-before-return).
- `tests/parser/empty_folded.test.ts` — Bug D (multi-value receive) + Bug F (br_if global
  resolution).
- `tests/parser/legacy_try.test.ts` — folded/linear/catch_all/delegate/multi-catch parse shape; V8
  compile + throw/catch/catch_all/rethrow runtime; round-trip non-duplication.
- `tests/bridge/tier_b.test.ts`, `tier_c.test.ts`, `tier_d.test.ts`, `gc_tier1..4.test.ts` — bridge
  coverage (GC tiers verify binary encoding, not V8 round-trip — typed-ref IR is loose).
- `tests/api/wabt_compat.test.ts` — 12 steps incl. the exact wasmtk call patterns from
  `src/utils.ts` and `src/wasmbundle.ts`.

When fixing a footgun/silently-wrong bug, add the regression alongside the invariant note in
[design-decisions.md](design-decisions.md). Fail-loud (throw) over silent-wrong output is the
project contract.

## CI gate

`.github/workflows/ci.yml` runs `deno fmt --check`, `deno lint`, `deno task check`, `deno task test`,
and `deno publish --dry-run` on every push/PR to `main`. See [publishing.md](publishing.md).
