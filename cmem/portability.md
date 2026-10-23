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

## Pass 2 — the untyped opcodes and the encoding-level features (2026-10-23)

76 hand-written templates covering all 84 entries D1 leaves untyped plus `elem.drop`, and the
features that are encodings rather than opcodes (memory64 / table64, multi-memory, custom page
sizes, extended-const, multi-value). Each returns an `i64` and states its EXPECTED outcome — a value
or a trap (`unreachable`, a null `ref.as_non_null`, a dropped segment, an uncaught `throw`, a failed
`ref.cast`). Every template validated by `wasm-tools`, and each checked to really contain the opcodes
it covers (printed back and searched). Legacy-EH templates assembled by upstream `wat2wasm` (G4:
wasm-tools cannot parse that syntax).

**13 executors.** Per owner decision 1, REAL browser engines join: Playwright **Chromium 153**,
**Firefox 155**, **WebKit 26.6** (Safari's engine — Bun's JavaScriptCore is not the build Safari
ships), and **Deno 2.9.8** beside Node 24 and Bun 1.4.4. 🔑 **Measurement rule:** JS engines and
browsers run at their DEFAULTS (what their users get); standalone runtimes at their MAXIMUM switches
(an embedder chooses them) — wasmtime every `-W` proposal it has, wazero every experimental feature
(threads, tail call, extended-const, exception handling, typed function references), WasmEdge
`--enable-all`, wasmer its base set plus only the module's own feature flag (it refuses some flag
COMBINATIONS outright, "no backend supports", even for a module needing none of them).

**Results: every engine that ran a template produced exactly the expected value or trap; no value
differs between engines.** (One expectation of mine was wrong — written in decimal where results are
hex; all 13 agreed on it.) binaryang's interpreter stops cleanly on custom descriptors
("unsupported"), as every engine refuses them anyway.

### The profile across the 11 defining engines (interpreters excluded)

| feature | refused by | tier |
| --- | --- | --- |
| core control / calls / locals / globals, multi-value, sign-ext, sat-conversions, bulk memory, reference types, tables, SIMD-128, extended-const | — | **portable** |
| threads / atomics (pass 1) | — | **portable** |
| exceptions, STANDARD (`try_table`, `throw`, `throw_ref`) | — | **portable** |
| typed function references (`call_ref`, `ref.as_non_null`, `br_on_null`) | — | **portable** |
| … `br_on_non_null` | wasmer ("only numeric types are supported") | engine-specific |
| tail calls | wasmer ("no backend supports") | engine-specific |
| GC (26 templates) | wasmer ("GC is not implemented yet"), wazero (both modes) | engine-specific |
| exceptions, LEGACY (`try` / `catch` / `catch_all` / `rethrow` / `delegate`) | wasmtime, WasmEdge, wazero | **via lowering** — `TranslateToExnref` to the standard form, which is portable |
| memory64 / table64 | wasmer, wazero | **via lowering** — `Memory64Lowering` |
| custom page sizes | wasmer, WasmEdge, wazero, V8 ×4, SpiderMonkey, JavaScriptCore ×2 | **via lowering** — `LowerCustomPageSizes` |
| wide-arithmetic (pass 1) | V8 ×4, WasmEdge, wasmer, wazero | **via lowering** — TO BUILD (owner decision 2) |
| relaxed SIMD (pass 1) | wasmer, wazero; results vary elsewhere by design | **via lowering** — TO BUILD (owner decision 2) |
| multi-memory | wazero | engine-specific (binaryang has no multi-memory lowering) |
| custom descriptors | every engine at its defaults (V8 behind `--experimental-wasm-custom-descriptors`) | engine-specific |

🔑 **What the list review turns on:** wasmer and wazero are the only engines keeping GC and tail
calls out of the portable tier, and wazero alone multi-memory; neither GC nor tail calls has a
practical lowering. So whether GC-language output (Kotlin, Dart, OCaml, …) is portable is exactly
the question of whether wasmer and wazero are prevalent enough to define "portable" (owner
decision 1). The browser builds measured are Playwright's (recent); the STABLE versions in use are
part of that review.

## Open

- **The defining engine list and its review basis** (owner decision 1): which engines, at which
  versions (the stable release in use, not a trunk build — Playwright's browsers are recent builds),
  and the prevalence data the list is reviewed against.
- **Whether wasmer and wazero define "portable"** — the one choice that moves GC and tail calls
  between tiers (above).
- **Pass 3, the trap paths of the typed opcodes** (divide by zero, out of bounds, invalid
  conversion): pass 2 covered traps only for the untyped ones.
- **The two lowerings** (owner decision 2), the portable target and D4.
- binaryang's interpreter: shared memories (pass 1) and custom descriptors are unsupported.
