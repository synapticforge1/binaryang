# The hardening round — open-work item 13

**The lens** ([open-work.md](open-work.md) § "Quality passes"): does it survive HOSTILE or
malformed input? Truncated binaries, absurd counts, deep nesting, a panic where a typed error is
the contract, unbounded work. Then the code lens again. The round repeats until a pass finds
nothing. Started 2026-10-09 (owner: "proceed", the agreed order after item 21).

**The contract every pass checks:** given hostile or malformed input, every entry point either
works or answers in its OWN typed way — the reader's `WasmBinaryError`, the writers'
`WasmEncodeError`, a tool's `{ errors, result }`, the interpreter's `Stop` / `Trap`, the bundler's
`BundleError`, the Linking codec's `LinkingFormatError` — and never lets a bare JavaScript error
(`RangeError`, `TypeError`, a plain `Error` in an internal stage's words) escape, or runs away.

**The instruments:** `deno task hostile <corpus dir> [stride]` (`scripts/check-hostile.ts`) — a
depth table (500 … 100,000 nested blocks through every stage) and a mutation fuzz (12 truncations
and 24 byte corruptions per module through the reader, the optimizer + writer, the interpreter, the
bundler and `compat/binaryen`). Reported, not gated; exit 1 on anything untyped or slow. Run it on
wasmtk's `tests/wasi/wasm_wasi` (404 real producer binaries: Rust, Zig, TinyGo, wasic) — the
corpus here is text.

## What the August sweep covered, and what it did not

wabt-ts swept the cheap axes in August (T13.29–T13.38, [wabt-ts.md](wabt-ts.md) § "Robustness and
hardening"): a truncate/corrupt fuzz of its five tools, huge declared counts, 100,000-deep nesting,
size amplification. It predates most of today's surface: the optimizer path (`readForPasses` →
passes → writers), the interpreter, `wasm-ctor-eval`, `wasm-interp`, `wasm-bundle` and its Linking
codec, `compat/binaryen`'s readers. And its depth result had DECAYED — the lesson it recorded
itself ("hardening's cheap axes decay too").

## Pass 1 — 2026-10-09: the contract

**Found** (instruments: a depth probe and the fuzz, now `deno task hostile`):

| # | finding | measured |
| --- | --- | --- |
| H1 | **Deep nesting escaped as a bare `RangeError` from every stage.** The August 100,000-block result no longer held. | first failure: writers ~390 blocks, text round trip ~400, `wat2wasm` 500 (folded) / 1,000 (linear), reader ~1,500, `wasm2wat` ~2,000, optimizer / interp / bundle ~2,400, validator ~3,000 |
| H2 | **`readForPasses` let a plain `Error` escape for an invalid module the reader decodes** ("derive-types: no local …", "name-references: branch depth … out of range"): the reader decodes structure and does not validate, and preparation failed in its own words. `compat/binaryen` inherited it. | 281 of 2,145 mutants (13%) |
| H3 | The interpreter's invalid-module checks were plain `Error("interp: …")`. | 5 of 2,145 |
| H4 | `wasm-bundle`'s Linking codec let a truncated LEB in a symbol entry escape as `RangeError` (my own new code). | probe |
| H5 | **Deep NESTING in a valid function made the interpreter report `trap: call stack exhausted`** — a claim about the program, where V8 runs it. | probe |
| H6 | `wasm-interp` / `wasm-ctor-eval` ran a file without validating it (upstream validates). | review |

**Not defects** (measured, recorded): wasm recursion traps `call stack exhausted` at any depth,
infinite recursion included; fuel stops an infinite loop; a 65,536-page memory is refused as a
typed `Stop` / ctor-eval reason; a 2^40-page memory64 maximum is fine; the bundle's page-sum cap is
a `BundleError`; huge counts in a `reloc.*` section fail fast. **Real modules nest shallowly:** 542
modules (the corpus, wasmtk's tests, the Rust and Zig fixtures) peak at depth 25.

**Fixed** (branch `hardening-13`):

- H1: `isStackExhausted(e)`, `NESTING_TOO_DEEP` and `nestingTooDeep(filename)` in `core/error.ts`;
  every boundary maps a stack overflow to its own typed answer — `wat2wasm`, `wasm2wat`,
  `wasmValidate`, `wasmObjdump` (error list); the parser's and reader's existing backstops (the
  shared message instead of "internal … error: Maximum call stack size exceeded");
  `readForPasses` (`WasmBinaryError`); `writeWasm` / `writeWat` (`WasmEncodeError` — the resolve
  step had run OUTSIDE the writer's guard); `PassRunner.run` ("optimizer: …"); the interpreter's
  four outside entries (`Stop('unsupported', …)`); `bundle` (`BundleError`).
- H2: on a preparation failure `readForPasses` asks the VALIDATOR (failure path only — a valid
  module pays nothing) and throws its diagnostics, at offsets into the caller's file, as
  `WasmBinaryError`; if the validator finds the module valid the failure is OURS and is rethrown
  unchanged, never disguised as the caller's.
- H3: `StopReason` gains `'invalid'`; 40 interpreter checks route through `invalid(…)`. The six
  "no exported …" lookups stay `Error` — the caller naming something absent.
- H4: the codec's LEB reads go through one guarded helper (`LinkingFormatError`, with the offset);
  `listSections` stops listing at a malformed tail; the bundler wraps codec errors as `BundleError`
  naming the input.
- H5: a HOST stack overflow is the program's exhaustion (`Trap`) only with ≥ 64 wasm calls active
  (`RECURSION_FLOOR`) — recursion runs the host out hundreds of calls deep (spec `fac-rec`);
  below that it is the interpreter's nesting limit (`Stop`). The `interp` gate is unchanged:
  core 57,608 / 0 FAIL / 40 stopped, legacy 70 / 0 / 0.
- H6: `readValidForPasses` (`ir/prepare.ts`) and `readValidWat` (`tools/read-wat.ts`); the
  `wasm-interp` and `wasm-ctor-eval` file entries read through them.

**After:** `deno task hostile` on 58 modules / 2,041 mutants — UNTYPED **0**, SLOW 0; the depth
table has no RAW cell at any depth to 100,000. A control run of the depth check against the
pre-fix tree reported 18 raw errors. Tests: `tests/binaryen-ts/hardening/hostile_input.test.ts`.

**Left for pass 2 — the CEILINGS (capability, not contract).** Every stage now refuses deep
nesting in its own words, but refuses EARLY: the writers and `wat2wasm` below 500 blocks, most
stages below 2,000. Real modules peak at 25 today; a large `switch` / `match` compiles to one block
per case, so hundreds are reachable. The weakest is name resolution (`ir/resolve-names.ts`):
`resolveExpr` is ONE 720-line `switch`, and V8 sizes its frame for every case at once — every
nesting level pays the whole frame. Splitting it into a small dispatcher and per-kind helpers is the
first move; then the reader's preparation, the validator, the passes' walkers.

## Pass 2 — 2026-10-09: the weakest ceiling

**Changed:** `ResolveContext.resolveExpr` (`ir/resolve-names.ts`) is now a five-way DISPATCHER;
`block`, `loop`, `if`, `try`, `try_table` moved verbatim into `resolveBlock` … `resolveTryTable`,
and the 700-line switch became `resolveOperator`. Nesting now recurses through small frames.
`baseline` IDENTICAL, suite unchanged.

**Measured** (`scratch hostile/ceiling.ts`; warm = after JIT warm-up by a binary search, cold =
one fresh process per depth — the honest number for a real call):

| stage | before (warm) | after (warm) | before (cold) | after (cold) |
| --- | --- | --- | --- | --- |
| `writeWasm` / `writeWat` | ~384 | ~1,500 / ~1,600 | 300 ✓ 400 ✗ | 700 ✓ 1,000 ✗ |
| `wat2wasm` linear | ~384 | ~1,760 | 300 ✓ 400 ✗ | 700 ✓ 1,000 ✗ |
| `wat2wasm` folded | ~384 | ~930 | 300 ✓ 400 ✗ | 700 ✓ 1,000 ✗ |
| `readForPasses` | ~1,400 | ~1,400 | — | — |
| interpreter | ~1,000 | ~1,000 | — | — |
| `wasm2wat`, validator, optimizer | ~2,000–4,000 | unchanged (noise) | — | — |

The floor across all stages rose from ~384 to ~930 warm (to ~700 cold). Pinned at 600 nested
blocks, cold-safe, in `hostile_input.test.ts` (the unsplit resolver fails it).

**Stopped here, deliberately.** The next ceilings are the folded-text parser, the interpreter's
evaluator and the reader's preparation (`nameReferences` / `deriveTypes` through `ExprVisitor`) —
each its own restructuring of a large recursive function. Real modules peak at depth 25 today; a
large `switch` reaches hundreds. Whether to push every stage past a few thousand is the OWNER's
priority call, not a defect: every stage already refuses beyond its ceiling in its own words.

**Also for the owner:** the interpreter's default fuel is 1,000,000,000 instructions; at the
measured ~760k instructions/s (a counted loop) or 63k–117k fuel/s (a bare `(loop (br 0))`), an
infinite loop under `wasm-interp` runs 22 minutes to 4 hours before fuel stops it. A default to
choose, not a defect.

**Found in my own gate runner (scratch, not the repo):** the `interp` step's legacy corpus was
passed `translate-eh`'s flat output instead of a `spec:prepare`d corpus, so it ran **0** assertions
in every gate of 2026-10-09 and read as green. The legacy corpus is 70 / 0 / 0 on the tree after
every merge of that day (run once found). The runner now prepares it as
[working-rules.md](working-rules.md) § "The gate" says, and fails any interp corpus that ran nothing.
