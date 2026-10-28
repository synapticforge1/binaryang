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
bun run comparison   # install binaryen.js here, type-check, then run the tests on Node (the V8 referee)
bun scripts/v8.ts comparison/scripts/headtohead_bench.ts   # a script, on the same referee
```

No Deno (2026-10-28, open-work 51; it ran on Deno until then). `package.json` here pins upstream
binaryen.js — `binaryen` 132, and 116 as `binaryen-116` for the scripts — with its own `bun.lock`,
so the root install never fetches its 50 MB. `tsconfig.json` is the root's strictness with
`noUncheckedIndexedAccess` off, as this tree always had. The tests are `node:test`, run on the
referee through `scripts/v8.ts` (`node --test`), as the root suite runs.

Needs, per test: upstream `wasm-opt` on PATH (v133 measured 2026-10-28: 23 passed, none skipped);
the network for the first `bun install`.

## Isolation, and how it is enforced

- **Not published:** `jsr.json`'s `publish.include` names only `main.ts` and `src/`, and the npm
  package is built from `src/`.
- **Not run by `bun run test`:** the tests are named `*.compare.ts`, which no runner discovers by
  itself — only `bun run comparison`, which names them, runs them. The gate runs that step; CI does
  not — its tools are not installed there.
- **Not type-checked by `bun run check`:** that check runs in CI, where binaryen.js is not
  installed; `bun run comparison` checks this tree itself. Not linted (Biome's scope excludes it).
- **Formatted:** dprint covers it, as everything else.
- **One direction only:** nothing outside this directory imports from it; it imports from `src/` and
  from `tests/binaryen-ts/passes/asyncify_helpers.ts`, never the other way.

Not here, deliberately: `scripts/spec-prepare.ts` and `scripts/check-translate-eh.ts` use
`wast2json` / `wasm-tools` only to SPLIT the spec testsuite's `.wast` scripts into test inputs — the
gate needs them, and they compare nothing.
