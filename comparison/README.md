# comparison/ — binaryang measured against upstream

binaryang's published package uses no external tool (see the root README, "No external
dependencies"). Measuring it AGAINST upstream is still worth doing, and this is where that lives —
never in `src/`, never in the CLI.

| path                                    | what                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `interop/binaryen-js.ts`                | `BinaryenInterop` — the bridge to upstream binaryen.js / the `wasm-opt` subprocess. Published as `./interop` until 1.7.0             |
| `tests/binaryen_interop.compare.ts`     | the bridge itself (mocked), and against real `npm:binaryen`                                                                          |
| `tests/upstream_wasm_opt.compare.ts`    | our `-O2` beside upstream `wasm-opt -O2` — both valid, both compute the same (was the hybrid-mode test)                              |
| `tests/asyncify_vs_wasm_opt.compare.ts` | Asyncify's analyzer and end-to-end output against `wasm-opt --asyncify` (split from the native tests in `tests/binaryen-ts/passes/`) |
| `scripts/*.ts`                          | upstream `npm:binaryen` side by side with ours: `headtohead_bench`, `diag_roundtrip`, `diff_wat`, `trace_failing`                    |

```sh
deno task comparison     # type-check, then run the tests (each skips loudly without its tool)
```

Needs, per test: upstream `wasm-opt` on PATH (v133 measured 2026-09-28: 18 passed, none skipped);
network for `npm:binaryen`.

## Isolation, and how it is enforced

- **Not published:** `deno.json`'s `publish.include` names only `main.ts` and `src/`.
- **Not run by the gate or by a bare `deno test`:** the tests are named `*.compare.ts`, which Deno
  does not discover — only `deno task comparison`, which names them, runs them. (A `test.exclude` in
  the config was tried and rejected: it also blocks the explicit path.) Not type-checked or linted
  by the gate, and not in CI — its tools are not installed there.
- **Formatted:** as a workspace member it IS covered by the gate's `deno fmt --check` — formatting
  only, which is harmless.
- **One direction only:** nothing outside this directory imports from it; it imports from `src/` and
  from `tests/binaryen-ts/passes/asyncify_helpers.ts`, never the other way.

Not here, deliberately: `scripts/spec-prepare.ts` and `scripts/check-translate-eh.ts` use
`wast2json` / `wasm-tools` only to SPLIT the spec testsuite's `.wast` scripts into test inputs — the
gate needs them, and they compare nothing.
