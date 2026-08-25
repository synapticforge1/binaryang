# Testing

## Running

```sh
deno task check       # type-check all files
deno task test        # run the full suite (484 passed, 1 ignored — verified 2026-08-25; asyncify COMPLETE incl. the in-wasm asyncify.* IMPORT mode for TinyGo goroutines + liveness-minimized saving; +9 flatten; +7 from the 2026-07-08 wasmtk-side audit sweep: call_indirect eval-order + dropped-unreachable regressions, asyncify memory-ensure / import-globals / multi-memory / legacy-alias tests; +2 import-mode tests; +2 the WT-2k decoder value-on-stack reorder regression (decoder_reorder_test.ts); see cmem/passes.md § "In-wasm asyncify-import mode" + cmem/correctness.md § "WT-2k"; +19 Tier 1 of the UP-series (13 gc_packed_get_test + 6 start_section_test) and +14 Tier 2 (6 tag_import_test + 8 gc_bulk_ops_test) — see cmem/correctness.md § "The UP-1…UP-7 series"; +4 on 2026-08-25 for the multi-value block WRITER and the try_table catch scope: 2 in eh_test.ts, 2 in multivalue_test.ts, each teeth-verified by reverting its own fix — see cmem/correctness.md § "The multi-value block WRITER"; +7 from the same day's "look for code issues" sweep — encoder duplicate child enumeration, unknown export kind, non-function type index, call_indirect table index, unknown section id, WAT multi-result truncation, WAT missing operand — see cmem/correctness.md § "Look for code issues" sweep (2026-08-25))
deno task fmt         # format
deno task lint        # lint
deno task ci          # check + test (the bundle CI runs)
deno task publish:dry # validate the JSR manifest without publishing (--allow-dirty)
```

The 1 ignored test is the live `npm:binaryen` interop test, gated on `BINARYEN_LIVE=1`.

Tests are **Deno-only** (`Deno.test` + `@std/assert` via the `imports` map in `deno.json`) — kept on
Deno when the library went cross-runtime (May 2026). The published library is runtime-agnostic and
validated to compile under Node + Bun via the JSR `slow-types` check during publish. The publish
manifest excludes `tests/`, `benches/`, `scripts/`, `upstream/`, `wabt-ts/`, so the test-runner
choice has zero consumer impact.

`@std/assert` is declared once in `deno.json`'s `imports` (`"@std/assert": "jsr:@std/assert@^1"`)
and referenced by mapped name in every test — never an inline `jsr:` specifier (trips
`no-import-prefix`/`no-unversioned-import`).

## Test tree (mirrors `src/`)

`tests/parser/`, `tests/binary/` (+ GC/EH/SIMD parser+encoder; `control_flow_regression_test.ts`,
`reader_test.ts`, `table_ops_test.ts`, `eh_test.ts`), `tests/encoder/`, `tests/passes/`
(`passes_test.ts`, `inlining_test.ts`, `optimize_pipeline_test.ts`, `optimize_fuzz_test.ts`),
`tests/tools/`, `tests/wasm/`, `tests/api/` (`binaryen_compat_test.ts`), `tests/interop/`
(`binaryen_interop_test.ts` — mock factory, zero CI dep; live test gated on `BINARYEN_LIVE=1`).

## `noUncheckedIndexedAccess` is ON for `src/`, OFF for `tests/` (2026-08-25)

The root `deno.json` sets it; `tests/deno.json` is a workspace member that exists only to turn it
back off. The asymmetry is deliberate: in `src/` an unchecked index that turns out to be `undefined`
becomes wrong bytes in a `.wasm`, which is this project's worst failure mode; in a test it becomes a
failed assertion, which is the test working. Doing the ~420 `mod.functions[0]!` edits the flag wants
in the test tree would be churn against files whose purpose is to break loudly.

**The gotcha that costs an hour if you don't know it:** a workspace member INHERITS the root's
`compilerOptions` and merges its own over them. **Omitting the key does not reset it** — the member
config is read either way, so an omitted override looks like it works right up until you check the
error count and find it unchanged. It has to be written out:

```jsonc
// tests/deno.json
{ "compilerOptions": { "noUncheckedIndexedAccess": false } }
```

Verified on Deno 2.9.5. The member is deliberately NOT a JSR package — no `name`, `version` or
`exports` — so `deno publish` at the root still publishes only `@jrmarcum/binaryen-ts`, and
`publish.exclude` keeps `tests/**` (including that config) out of the tarball. Confirmed with
`deno task publish:dry`.

To check one tree at a time: `deno check src/**/*.ts main.ts` (flag on) and
`deno check tests/**/*.ts` (flag off). `deno task check` does both in one invocation and each file
gets the config nearest it.

## The corpus round-trip test (`tests/binary/corpus_roundtrip_test.ts`)

Parse → encode → parse over the whole `upstream/test` tree: **80 exact, 0 structural drift, 0
validate failures, 90 of 90 files accounted for** (2026-08-24). Promoted from
`scripts/verify_roundtrip.ts` once the parser was provably clean — as a script nobody ran it, and
every WT-2 / UP-series defect it would have caught was found by a downstream consumer instead.

**Run the promoted test, not the legacy script.** `scripts/verify_roundtrip.ts` hard-panics Deno
2.9.5 (`Check failed: !job->compile_imports_.empty()`) before producing any output — a runtime
crash, not a finding. The test covers the same ground in 165 ms.

Three design points worth keeping:

- **It SKIPS when `upstream/` is absent** rather than failing, because the corpus is gitignored and
  CI checks out without it. That makes the test free to keep locally without breaking the published
  run.
- **Expression counts are checked for CONVERGENCE, not equality.** Constructs that are legitimately
  rewritten on decode (block/loop/`if` parameters spilled to locals, a mixed-target `br_table`
  turned into a trampoline) add nodes on the first trip. Generation 1 vs 2 must match — which still
  catches what the check existed for: the `unreachable-pops` defect grew on EVERY trip (4 → 5 → 6).
  Entity counts stay exact.
- **Every file lands in exactly one bucket and the totals are reconciled.** The old script silently
  `continue`d past a file that failed the FIRST parse, so "0 failures" was not evidence the corpus
  had been exercised.

The 10 remaining rejections are deliberate: malformed crash fixtures, invalid-magic fuzz inputs,
component-model binaries, and loud non-MVP rejections (declarative element segments, `local.get` in
an init expression, atomics `0xFE`).

⚠️ **The fuzzer's reach is narrower than it looks.** Measured: `optimize_fuzz_test.ts` contains zero
`makeLoad` and zero `makeBreak` calls and no SIMD or GC nodes, so it could not have constructed
either defect found in the 2026-08-24 duplicate-dispatcher sweep. Grep the harness for the node
kinds it emits before assuming it covers a new construct.

## The differential optimizer fuzzer (`tests/passes/optimize_fuzz_test.ts`)

Because every WT-2f…WT-2j optimizer bug was a **behavioral** miscompile (valid wasm, wrong value)
that `WebAssembly.compile` validity never caught, a seeded differential fuzzer generates random
`i32` functions packed with the recurring hazards:

- `local.tee K` whose value a sibling operand re-reads (WT-2j within-expression eval-order)
- writes to `K` nested in `if` branches that a later sibling reads (WT-2i cross-sibling)
- repeated pure subexpressions over a small local pool (CSE candidates)
- plus dead/live sets, drops, `select`, nested blocks

For each function it runs the real pipeline (build IR → encode → `parseWasm` → full `-Oz` → encode),
then asserts the optimized binary is **valid** AND returns **bit-identical** results to the
unoptimized build over edge-case inputs; on divergence it bisects the pipeline to name the first
offending pass and prints a reproducible seed + the function IR.

Deterministic (seeds 1..N), CI-safe; default 350 functions. Crank ad-hoc:

```sh
FUZZ_ITERS=30000 deno test --allow-read --allow-env tests/passes/optimize_fuzz_test.ts
```

**It has teeth** — verified by reverting each fix: WT-2i recursion removed fails at seed 4; WT-2j
`Binary`-case `_invalidate` removed fails at seed 18; both correctly name `LocalCSE` as the first
bad pass. 50k+ functions across multiple seed ranges pass with the fixes in place.

**Not fuzzed**: the dangling-stack family (multi-value tuple calls, catch-param `Pop` threading) —
hand-generating valid tuple-consuming / catch-binding IR is fragile. Covered instead by real-fixture
regression tests in `tests/passes/optimize_pipeline_test.ts` (46_TemplateEscapes) and
`tests/binary/eh_test.ts`.

## The behavioral-equivalence harness (`scripts/equiv_check.ts`)

Not a `Deno.test` — a script. Two stubbed instances driven by the same call sequence stay
bit-identical iff optimization preserved semantics (stubs only need to be IDENTICAL, not
meaningful). This surfaced the six WT-2c miscompiles the validity-only bench had called "valid." See
[correctness.md](correctness.md).

## Regression-test placement convention

When fixing a footgun/silently-wrong bug, add the regression test alongside the invariant note in
[correctness.md](correctness.md). **Fail-loud (throw) over silent-wrong output is the project
contract.** Key files: `tests/binary/control_flow_regression_test.ts` (branch-depth, single-arm if,
tag exports, WT-2b frames), `tests/passes/optimize_pipeline_test.ts` (WT-2i/j behavioral),
`tests/parser/wat_parser_test.ts` (call/global result-type inference + fail-loud type/heap/
call_indirect resolution — the 2026-07-07 audit sweep), `tests/encoder/wasm_encoder_test.ts`
(None-typed local throws), the proposal `*_test.ts` files for GC/EH/SIMD round-trips.

## CI gate

`.github/workflows/ci.yml` runs type-check + lint + test + `deno publish --dry-run` on every push/PR
— catches `slow-types` regressions, manifest changes, excluded-file drift. **Local fmt/lint must
walk the same trees as CI**: CI checks out without submodules, so `deno.json`
`fmt.exclude`/`lint.exclude` mirror `["upstream/", "wabt-ts/", "node_modules/"]` (else local flags
~5500 unrelated issues and "passes locally / fails on CI" diverge). See
[publishing.md](publishing.md) for the stale-type-check- cache gotcha that lets local `check` lie
when a cross-file type dependency changes.

## Test files ARE type-checked (as of 2026-08-24) — this was a real gap

`deno task test` runs with `--no-check`, and `deno task check` used to cover only `src/**/*.ts` and
`main.ts`. **Test files were therefore never type-checked at all**, by any task, including
`deno task ci`. `check` now covers `tests/**/*.ts` too.

Closing it immediately surfaced seven latent type errors, one of them a genuinely wrong fixture:
`tests/encoder/wasm_encoder_test.ts` called `addTable("a", 1, null, ValType.FuncRef)` against a
`(name, type, initial, max)` signature — passing `1` as the element type and the reftype as the max.
The test passed anyway because it only asserted the "multiple tables" throw, which fires regardless
of the arguments. The others were an unsound `Expression as Record<string, unknown>` cast, a
`WebAssembly.instantiate` overload mismatch, and three missing `makeStructNew` arguments in a
brand-new file.

This is the same family as the stale-type-check-cache gotcha in [publishing.md](publishing.md): a
task reports success while never having looked at the code in question. When adding a task that
validates something, check what it actually walks.
