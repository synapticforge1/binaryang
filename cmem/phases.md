# Phase delivery status

Condensed. The canonical line-by-line per-phase record lives in the gitignored `CLAUDE.md`; this
table is the portable summary. Current version: **v1.3.9** on JSR. Asyncify + Flatten + the
four-pass fail-loud audit sweep (20 correctness fixes; see [correctness.md](correctness.md)) first
shipped in **v1.3.6**; **v1.3.7–v1.3.9 are identical-code re-publishes** from the JSR provenance
investigation (see [publishing.md](publishing.md) § "JSR-side provenance recording stopped"). v1.3.5
and earlier predate the audit sweep.

## Core phases

| Phase | Status     | Scope                                                                                                                                                                                                                                   |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | ✅         | Foundation: IR types, expressions, module builder, pass infra, DCE, API, interop (`BinaryenInterop.create` closed under Phase 0.1)                                                                                                      |
| 1     | ✅         | WAT text parser (tokenizer → S-expr → IR)                                                                                                                                                                                               |
| 2     | ✅         | WASM binary parser (`.wasm → IR`)                                                                                                                                                                                                       |
| 3     | ✅         | WASM binary encoder (`IR → .wasm`); full round-trip                                                                                                                                                                                     |
| 4     | ✅         | Core optimization passes (8 passes). 4.1: CFG-based dataflow liveness for CoalesceLocals                                                                                                                                                |
| 5     | ✅         | Inlining (`Inlining` + `InliningOptimizing`). 5.1: split/partial inlining + cleanup wiring; 5.1c CLI flag; 5.2 return-call inlining                                                                                                     |
| 6     | ✅         | `wasm-opt` native CLI + RemoveUnusedNames                                                                                                                                                                                               |
| 7     | ✅         | GC proposal — heap types, struct/array/ref, parser+encoder+WAT. 7.1: call_indirect type-ref, table.get/set, multi-segment CoalesceLocals                                                                                                |
| 8     | ✅         | EH proposal — tags, throw/throw_ref/rethrow/try_table. 8.1: WAT inline-body try, EH-aware DCE, StripEH pass                                                                                                                             |
| 9     | ✅         | SIMD proposal — v128, all lane types, 0xFD prefix, parser+encoder+WAT                                                                                                                                                                   |
| 10    | ✅ Partial | WASM-kernel runtime + dogfood embed pipeline; demo kernel + boundary benchmark. Kernel selection deferred (single-op dispatch regresses)                                                                                                |
| 11    | ✅         | Cross-runtime migration (`Deno.*` → `node:`) + JSR publish hardening + license rework + 100% JSDoc. 11.1 CI green; 11.2 housekeeping; 11.3 publish guard; 11.4 `deno task bump`; 11.5 auto-tag; 11.6 release driver + CI provenance fix |
| 12    | ✅         | `npm:binaryen` compatibility facade (`/compat`). 12.1: programmatic module construction + `runPasses`                                                                                                                                   |
| 13    | ✅         | Tail-call proposal binary support (`return_call` / `return_call_indirect`)                                                                                                                                                              |
| 0.1   | ✅         | Phase 0 closure — in-process binaryen.js bridge                                                                                                                                                                                         |

## Wasmtk-migration critical path (WT series)

| Phase                 | Status | Scope                                                                                                                                                                    |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WT-1                  | ✅     | LEB128 signed-overflow parser fix; corpus 74 → 84 files, 1,432 → 82,912 expressions                                                                                      |
| WT-2 / WT-2b          | ✅     | Binary-parser round-trip validity (9 MVP-critical files validate); `WebAssembly.compile` failures 16 → 7 (remaining 7 deferred non-MVP)                                  |
| WT-2 (bench)          | ✅     | Head-to-head vs `npm:binaryen@^116` on `-Oz`: 7/7 validate, ~14× faster; honest code-size aggregate **1.12× (ours larger)** after correcting for dropped custom sections |
| WT-2c                 | ✅     | Six behavioral miscompiles via `equiv_check.ts` (elem segments, LocalCSE×2, Vacuum/SimplifyLocals type, makeIf LUB, CoalesceLocals identity)                             |
| WT-2d / WT-2e         | ✅     | wasmtk integration rounds 1–2: single-arm if arm-inversion; tag exports/type-index; flag-4 element segments                                                              |
| WT-2f                 | ✅     | round 3: inlining wrapper fallthru; CoalesceLocals call_indirect operand/target order; WAT export-kind `func→function`                                                   |
| WT-2g                 | ✅     | round 4: try/catch handler re-emitted wrapped in spurious block (`encodeCatchBody`)                                                                                      |
| WT-2h / WT-2i / WT-2j | ✅     | rounds 5–6: catch-param Pop seeding; multi-value tuple call Pops; three distinct LocalCSE invalidation bugs (WT-2j root-caused wasmtk's `skipBinaryenOpt`)               |

See [correctness.md](correctness.md) for the full root-cause detail on every WT fix.

## Versioning

Sub-version-capped-at-9: `1.0.9 → 1.1.0`, `1.9.9 → 2.0.0`, major uncapped (`9.9.9 → 10.0.0`).
Enforced by `deno task bump`. See [publishing.md](publishing.md).

## Recently completed

- **Asyncify** (`--asyncify` port, for TinyGo goroutines) — ✅ **COMPLETE, all 5 stages**
  (2026-07-05 → 2026-07-07): `2902fca` runtime support + `3b35d97` ModuleAnalyzer + `2e30ea4`
  flatten pass (+`mapChildrenShallow` walk.ts fix) + `62a4573` flow + `c446a3d` locals/intrinsics
  (runnable) + `62f0fb0` wire/register/CLI. Registered `"Asyncify"` (opt-in), runnable e2e that
  **differentially matches `wasm-opt --asyncify` v130**. Follow-up (wasmtk side): wire into
  `--lang=go` + a TinyGo-build goroutine e2e; publish binaryen-ts. Full detail in
  [passes.md](passes.md) § "Asyncify".

- **Fail-loud audit sweep** (2026-07-07, post-Asyncify, four passes) — mechanical grep sweeps + four
  parallel subagent code-review agents, every finding verified behaviorally / against upstream. **20
  correctness fixes incl. 6 real behavioral miscompiles**; ~15 regression tests + a 20k-iteration
  differential-fuzz confirmation; 379 → 394; shipped in v1.3.6. Highlights: the
  `inferFuncResultType`/`inferGlobalType` TODO-stub root cause (call typed `None` → Asyncify
  None-local), `parseLoop` dropping `(result)`, Flatten `local.tee` clobber, `PickLoadSigns`
  (inert + wrong classification), inlining ref/v128 non-param reset, multi-table +
  multi-value-blocktype silent corruption, compat `_idToValType` mistype, `struct.get`/`array.get`
  typing. One subagent "live miscompile" finding was verified WRONG and rejected. Full detail in
  [correctness.md](correctness.md) § "Fail-loud audit sweep".

## UP-series — wabt-ts upstream findings (2026-08-24)

Seven findings filed by the wabt-ts team; re-verified against v1.4.3 before acting. Three of the
seven produced wrong bytes, not one as reported. Detail in [correctness.md](correctness.md) § "The
UP-1…UP-7 series"; bridge view in [bridge.md](bridge.md).

| Tier    | Content                                                                                                      | Suite     | Status      |
| ------- | ------------------------------------------------------------------------------------------------------------ | --------- | ----------- |
| Tier 1  | UP-1 packed `get` sub-opcode; UP-5 start section (+ pass reachability seeding); tests type-checked; repo fmt | 405 → 424 | ✅ Done     |
| Tier 2  | UP-6 tag imports; UP-4 `ref.as_non_null`; UP-3 four GC array bulk ops                                        | 430 → 438 | ✅ Done     |
| Tier 3  | UP-7 typed refs end-to-end (IR records + builder + parser shim + `gcFuncTypeIndex`)                          | 438 → 448 | ✅ Done     |
| Tier 4  | Corpus round-trip closure: `ref.null` heap-type collapse + signed heap index + phantom-pop `nop`             | 448 → 453 | ✅ Done     |
| Tier 5  | UP-2 `tuple.make` + multi-result blocks (p=0, r>1); multi-value `br`/`br_if`/`br_table`                      | 454 → 462 | ✅ Done     |
| Tier 6  | Block + `if` INPUTS via spill-to-locals; `loop` inputs rejected (br_if fall-through hazard)                  | 462 → 464 | ✅ Done     |
| Tier 7  | LOOP inputs via back-edge branch rewrite (incl. `br_if` fall-through restore)                                | 464 → 465 | ✅ Done     |
| Tier 8  | `br_table` dispatch trampoline for mixed targets; `try`/`try_table` inputs; convergence-based drift          | 465 → 467 | ✅ Done     |
| Sweep 1 | "Look for code issues": `if`-arm node aliasing, dropped unknown export kind, Flatten multi-result mis-typing | 467 → 472 | ✅ Done     |
| Sweep 2 | Dead-export removal (4 unreachable) + the two reachable ones documented                                      | 472       | ✅ Done     |
| Sweep 3 | Duplicate-dispatcher class: `deepCopy` shared subtrees, PickLoadSigns could not see a use inside a `br`      | 472 → 473 | ✅ Done     |
| —       | (nothing outstanding on multi-value)                                                                         | —         | ⬜ Deferred |

**No bump/publish until every known bug is addressed** (owner decision, 2026-08-24). That bar is met
as of Sweep 3: **all seven** UP findings are fixed (UP-2 included — multi-value landed in Tiers
5–8), and the upstream corpus round-trips at **80 exact, 0 structural drift, 0 validate failures, 90
of 90 files accounted for**, with the 10 non-parsing files verified as deliberate fail-loud
rejections.

**The next release is 1.5.0, not 1.4.4** — Sweep 2 removed exported symbols, which is a breaking
change regardless of whether anything imported them. `deno task bump` has no minor mode, so set the
version by hand. See [publishing.md](publishing.md). `deno.json` is deliberately still at 1.4.3
while the bump is held: its tag exists on the remote, so `auto-tag.yml` no-ops and no push can
publish.

## Deferred / not-yet-done

- Phase 10 kernel selection (deferred until real-corpus profiling).
- **TranslateEH — SCOPED 2026-08-24, and it is a live gap, not a leftover TODO.** See
  [correctness.md](correctness.md) § "TranslateEH" for the measurement and the plan.
- Custom-section preservation (parse→encode drops DWARF `.debug_*`/`name`/`producers` — fine for
  production `-Oz`, must be acknowledged).
- `br_table` mixing a parametrised loop with other targets IS handled (dispatch trampoline); nothing
  outstanding there.

**Done, previously listed here:** `scripts/verify_roundtrip.ts` was promoted to a real test
([corpus_roundtrip_test.ts](../tests/binary/corpus_roundtrip_test.ts)) once the parser was provably
clean; it skips when `upstream/` is absent, so CI is unaffected.
