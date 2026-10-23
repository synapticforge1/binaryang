# Opcode portability — one profile every widely used engine runs (open-work 34)

Started 2026-10-23 from the owner's question "are the opcodes the same from wasm-tools, wabt and
binaryen? does that differ with wasmtime?", then "we may need to test that amongst all of our wasm
runtime suites and attempt to create a consolidated opcode set that all can decode and run".

## 🔒 Owner decisions (2026-10-23)

1. **The engines that define "portable" are the most widely known and used**, chosen — and
   reviewed — by actual BROWSER use and RUNTIME use, and tested as such. Interpreters (upstream
   wabt's, binaryang's) are reported, not defining.
2. **Build the two lowerings for maximum compatibility**: wide-arithmetic → `i64` arithmetic with
   carries, and relaxed SIMD → deterministic SIMD-128. Both join the existing lowerings
   (`Memory64Lowering`, `TranslateToExnref`, `LowerCustomPageSizes`) as the "portable via lowering"
   tier.
3. **binaryang is the source** of the resulting profile — a definition beside D1–D3 (proposed D4).
4. **wasmrt and wazmrt are excluded for now** ("we can adjust those once we know what we need here
   from the others"): they implement the profile afterwards, they do not shape it.

## The shape agreed (proposal, refined by the measurements)

- **Three tiers**, per FEATURE with the opcode list as evidence (memory64, multi-memory, custom
  page sizes and extended-const are encodings, not opcodes): **portable** (runs, and agrees, on
  every defining engine) · **portable via lowering** (binaryang rewrites it into the first tier) ·
  **engine-specific** (only when the target names its engines).
- **Each feature's tier is set by the weakest defining engine** — the measurements say what each
  engine costs, which is what the owner's review of the list weighs.
- **Enforced, not documented**: a portable target in binaryang validates against the profile,
  applies each lowering, and refuses the rest naming the engines that would; the optimizer must
  never introduce an opcode outside its input's profile. wasmtk / `wasic` emits the portable tier;
  the loader fixtures stay inside it; wasmrt / wazmrt implement it.
- **A committed probe re-measures** the engine matrix, so the profile moves when an engine catches
  up (V8 wide-arithmetic) instead of going stale.

## Pass 1 — the 497 opcodes D1 gives a concrete signature (2026-10-23)

Method: one generated module per D1 entry with a signature (498; `elem.drop` needs a segment, moved
to pass 2) — fixed inputs (`1`, `1.5`, `2.5`, a mixed `v128`, memory pre-filled with a byte
pattern, a shared memory for atomics), the opcode, its results folded into one `i64` export `t`.
Assembled by `wasm-tools parse`, every module valid under `wasm-tools validate --features=all`
(497 / 497 — the generator checked before any engine was trusted). Scratch scripts this session
(`ops/gen.ts`, `runner.ts`, `js-run.mjs`, a Go harness for wazero, `analyze.ts`); not committed.

| executor | ran | did not run |
| --- | --- | --- |
| wasmtime 50.0.0 | 497 | — |
| Bun 1.4.4 (JavaScriptCore) | 497 | — |
| SpiderMonkey (Playwright Firefox 155) | 497 | — |
| V8 (Node 24.21, V8 13.6) | 493 | wide-arithmetic 4 ("invalid numeric opcode") |
| WasmEdge 0.18.1 | 493 | wide-arithmetic 4 |
| wazero 1.12.0 compiler / interpreter | 473 / 473 | wide-arithmetic 4, relaxed SIMD 20 |
| wasmer 7.5.0 | 473 | wide-arithmetic 4, relaxed SIMD 20 ("no backend supports") |
| upstream wabt `wasm-interp` 1.0.41 | 489 | wide-arithmetic (mistyped / not implemented), wait / notify / fence |
| binaryang `wasm-interp` | 430 | all 67 atomics: "unsupported: a shared memory" |

**Values**: identical wherever two executors ran an opcode, except (a) relaxed SIMD — 5 of 20 differ,
by the proposal's design, no majority; (b) `f32x4.sqrt` / `f64x2.sqrt` on a negative lane: the NaN's
SIGN (`ffc00000` on the engines and wazero, `7fc00000` on both interpreters) — the spec leaves it to
the implementation, so not a defect; the probe compares NaN results as NaN from pass 2 on.

**So far:** 473 opcodes run, agreeing, on every engine (all but wide-arithmetic and relaxed SIMD) —
406 if the two interpreters must run them too. Found on the way:

- **binaryang's interpreter refuses every shared memory** — it cannot run, ctor-eval or precompute
  through atomics (an open-work item of its own).
- **wazero 1.12 does not decode relaxed SIMD and mis-reports it**: its errors read the 2-byte LEB
  sub-opcode as one byte and name an opcode that is not there. It still refuses each one.

The decoder-membership sweep that preceded this (wazmrt's `opcode-sweep.ts`, ported): wasm-tools
626 · wasmtime's decoder 626 (compiles ≤ 574: it refuses legacy `rethrow`, stack-switching,
custom-descriptors, `memory.discard`, shared-everything-threads, and `-W stack-switching` makes this
build refuse every module) · Binaryen 133 667 (56 of its own: stringref, FP16 SIMD, …) · binaryang
582 (= wasmrt = wazmrt) · wabt 543 (no GC, no custom descriptors).

## Pass 2 — the untyped opcodes and the encoding-level features (in progress)

The 85 entries D1 leaves untyped (control, calls, tail calls, locals / globals, tables, reference
types, typed function references, exceptions both legacy and exnref, GC, custom descriptors) plus
`elem.drop`, and the features that are encodings rather than opcodes (memory64, multi-memory,
custom page sizes, extended-const, multi-value). Per the owner's engine decision, pass 2 adds REAL
browser engines — Playwright Chromium (V8 as Chrome / Edge ship it) and WebKit (Safari's engine;
Bun's JavaScriptCore is not the build Safari ships) — and Deno beside Node and Bun.

## Open

- **The defining engine list and its review basis** (owner decision 1): which engines, at which
  versions (the stable release in use, not a trunk build — Playwright's browsers are recent builds),
  and the prevalence data the list is reviewed against.
- **The two lowerings** (owner decision 2), the portable target and D4 — after pass 2 fixes the
  tiers.
