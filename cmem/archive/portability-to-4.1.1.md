# Opcode portability — the passes, the lowerings and the probe, to 4.1.1

Passes 1 to 3, the three lowerings built and proven, the run-cost measurement, decision 5 scoped and the committed probe's re-measurement (open-work 34, closed 2026-10-24). Moved from `cmem/portability.md` on 2026-11-20 (H38 step 4); the live notes start at [portability.md](../portability.md).

## Pass 3 — the failure paths of the typed opcodes (2026-10-23)

210 generated modules (scratch `ops/gen3.ts`), each stating its expectation: **192 must trap** —
integer divide / remainder by zero, `div_s` of INT_MIN by −1, every non-saturating `trunc` of NaN
and of an out-of-range float, every memory, SIMD-memory and atomic access at the first address past
a one-page memory, every atomic wider than a byte at an unaligned address, `memory.init` out of
bounds, `memory.init` after `data.drop`, a zero-length `memory.fill` one byte PAST the end — and
**18 must give an exact value**: `rem_s` of INT_MIN by −1 is 0, the `trunc_sat` forms clamp (NaN →
0, too big → the maximum), and zero-length `memory.fill` / `memory.copy` EXACTLY at the end is valid.

**Result: all 11 defining engines and the four stable browsers (Chrome 156, Edge 155, Firefox 158,
ESR 153) match the spec on all 210** — 190 traps, 20 values each. Two expectations were mine and
wrong at first (I had the zero-length-at-the-end cases as traps; every engine said, correctly, they
are valid), corrected by the spec, not by the majority. The interpreters refuse the 114 atomic cases
(no shared memory — pass 1's finding).

🔧 **Harness lesson:** killing a headless browser's launcher leaves Edge's helpers running (18, then
20 processes were left, holding the profile); the probe now stops every process whose command line
names its own throwaway profile, then removes it.

### The wide-arithmetic lowering — built and proven (2026-10-23)

`src/passes/wide-arithmetic-lowering.ts`, `wasm-opt --wide-arithmetic-lowering` (owner decision 2).
Each of `i64.add128`, `i64.sub128`, `i64.mul_wide_s`, `i64.mul_wide_u` becomes a `call` to a helper
added once per instruction USED, returning two `i64`s (multi-value, portable): carry / borrow by an
unsigned compare; `mul_wide_u` from the four 32×32 partial products; `mul_wide_s` as `_u` with the
two's-complement correction per negative operand. Proven, owner: "no guesses please. test and
prove before acting":

- **Exact**: the lowered module, run on V8 (which cannot compile the original) and on
  JavaScriptCore, equals BigInt 128-bit arithmetic over 12 edge values per operand (every pair, and
  add / sub over 12 × 12 × 4 × 3); binaryang's interpreter, running the ORIGINAL, agrees
  (`tests/binaryen-ts/passes/wide_arithmetic_lowering.test.ts`).
- **The test can fail**: three mutants — the carry compared the wrong way, the sign correction
  removed, the borrow dropped — each killed.
- **Portable, measured**: pass 1's four wide-arithmetic modules, lowered through the CLI, give
  wasmtime's ORIGINAL result on all 17 executors — the eight that refused the proposal included
  (V8 ×4, WasmEdge, wasmer, wazero ×2, Firefox ESR 153).
- 🔧 **Found on the way, a guess disproven**: the first helpers declared too few locals — the IR's
  `Func.locals` lists every slot, PARAMS FIRST (its declaration says so; asyncify's helpers do it).
  Shown by printing the module (`add128` declared 0 locals of 1, `mul_wide` 1 of 3) before the fix,
  after a first guess (that a region keeps only its last value) was printed out and found false.

**So wide-arithmetic moves to "portable via lowering", built.** Relaxed SIMD is the other lowering
(decision 2).

### The relaxed-SIMD lowering — built and proven (2026-10-23)

`src/passes/relaxed-simd-lowering.ts`, `wasm-opt --relaxed-simd-lowering`. **Semantics: the spec's
DETERMINISTIC PROFILE** (owner, 2026-10-23, "yes, I agree"): `exec/numerics.rst` — "in the
deterministic profile, every parameter is prescribed to be 0", so `relaxed(R)[A0, …] = A0`. Read per
operator from the spec checkout (`4441525`), prose AND SpecTec (`3.0-numerics.relaxed.spectec`,
`3.2-numerics.vector.spectec` lines 401–405): swizzle, trunc, min / max, q15mulr → the regular
instruction; laneselect → `bitselect`; madd / nmadd → `add(mul(±a, b), c)`, UNFUSED (the note: "the
unfused behaviour is used"); dot → `ivdot`, both operands signed, the i16 pair sums WRAPPING; dot-add
→ that dot, `extadd_pairwise_s`, `add c`. The dot uses its operands twice, so it is one helper.

- 🔑 **wasmtime's `-W relaxed-simd-deterministic` is NOT the spec's profile** — measured on 34 edge
  cases × 2 lanes: it FUSES madd / nmadd (8 lanes: `-2^-104` where unfused gives 0; `-inf` where
  unfused gives NaN) and does NOT wrap the dot-add's i16 intermediate (lane 0 `8000fe01`, spec
  `7ffffe01`); the other 15 instructions match. So the agreed oracle could not referee those five;
  **the spec is the oracle**, through an independent TypeScript reading of it (generator in scratch,
  ported into the committed test). WasmEdge also skips the wrap; binaryang's interpreter fuses madd
  (R = 1 — allowed, not the profile); 🔧 **upstream wabt `wasm-interp` 1.0.41 gets dot-add wrong** on
  all 4 cases, in NONE of the spec's allowed result sets (e.g. `ffd2b6bf005f2fce`, spec
  `0000009100000428`) — an upstream defect, reported here only.
- **Why it matters, measured**: the ORIGINALS on the same 68 modules match the profile on 32
  (Firefox) to 67 (WasmEdge) — V8 37, JavaScriptCore 41, wasmtime native 42 (swizzle ≥ 16, trunc
  NaN / overflow, mixed laneselect masks, min / max of ±0 and NaN, q15mulr saturation, the dot's
  signedness all differ by engine) — and wasmer and wazero refuse all 68.
- **Exact, every engine**: the 68 modules, lowered through the CLI, all validate as plain Wasm 2.0
  (`wasm-tools validate --features=wasm2`) and match the spec on **all 17 executors — 1,156 / 1,156**
  (wasmtime, wasmer, WasmEdge, wabt, binaryang, Node, Deno, Bun, wazero ×2, Playwright Chromium /
  Firefox / WebKit, stock Chrome 156, Edge 155, Firefox 158, ESR 153). NaN lanes compare as any NaN
  (the bits are not fixed off the deterministic profile).
- **The test can fail**: `tests/binaryen-ts/passes/relaxed_simd_lowering.test.ts` (spec reference,
  lowered run on the host engine, the original validated as REFUSED and the lowered as accepted with
  relaxed SIMD off, binaryang's interpreter as a witness on the non-madd instructions) — **23 mutants**
  (each opcode mapping swapped, laneselect operands reordered, nmadd's negation dropped, madd's
  nesting changed, the dot unsigned / its masks / its high half wrong, dot-add's pairwise unsigned,
  skipped, or subtracting c) — **all killed** on the V8 referee.
- **Pass 1's 20 relaxed modules**, lowered: the 17 executors agree with each other and with
  wasmtime-deterministic's result on the originals (pass 1's inputs reach neither the fused nor the
  wrapped edge).

**So relaxed SIMD moves to "portable via lowering", built.**

### The portable target and D4 — built and proven (2026-10-23)

`wasm-opt --target portable` (library `target: 'portable'`, `src/tools/target.ts`), reading D4
(`src/definitions/profiles.json`, [definitions.md](../definitions.md) § D4). The agreed shape: refuse
what the profile excludes, naming the engines; lower what it lowers, before optimization; check the
OUTPUT against the profile again, so no pass can leave it.

- **The validator is the judge of feature use** — measured, not assumed: validating every probe
  module against the portable feature set agreed with "every defining engine ran it" on 782 / 787;
  the 5 others were exactly the opcode-level cases (`br_on_non_null`; legacy `try` / `catch_all` /
  `rethrow` / `delegate`), found in the IR instead. "Needs X ⇔ invalid with X off and every other
  feature on" names each module's feature exactly, up to dependencies (GC also needs typed function
  references).
- **D4's numbers are derived**, from the probe results; two features without a probe were probed
  first (run 5, all 17 executors run both): an EXPORTED mutable global (`mutableGlobals`) and a
  branch-hint section (`codeMetadata`). Run 6 put the wide-arithmetic and relaxed-SIMD ORIGINALS on
  the three executors run 1 lacked. Left unmeasured, by nature: `annotations` (text only),
  `compactImports` (binaryang cannot read it).
- 🔧 **Found by run 6: Safari's engine refuses wide arithmetic** — Playwright WebKit 26.6, "wasm wide
  arithmetic is not enabled" (Bun's JavaScriptCore runs it); the README said it ran on Safari.
  Corrected. **And Bun refuses memory64** — the tier table above said wasmer and wazero only.
- **Order of lowerings**: memory64 then custom page sizes — both orders behave the same on a module
  using both (wasmtime's original result, valid Wasm 2.0), and this one is smaller (640 bytes vs
  789).
- **The corpus**: all 809 probe modules (runs 1–3, 5, 6) through the target — **35 refused, exactly
  the excluded ones** (26 GC, 3 tail calls, 1 multi-memory, 4 custom descriptors, 1
  `br_on_non_null`), **774 accepted, all also under -O2** (no output check tripped). The 774 outputs
  on the 15 defining executors: **772 give the outcome every engine agreed on for the original**
  (11,610 results); the 2 others are `memory.atomic.wait32 / 64`, where browsers' main-thread
  policy splits the originals identically. (Interpreters reported: wabt prints its traps in a
  form the runner reads as errors; binaryang's has its shared-memory gap.)
- **The tests can fail**: `tests/binaryen-ts/tools/target.test.ts` (17) — 13 mutants of the target
  and its `wasm-opt` wiring, all killed (one survived first: a legacy `try` with no handler, now a
  case). `tests/definitions/definitions.test.ts` checks D4 against D1, D2 and the passes.
- 🔧 **Found on the way: the validator does not enforce `multiValue`** — open-work 35.

### The relaxed-SIMD lowering's run cost — measured (2026-10-24)

Owner: "test the SIMD lowering's runtime cost". Scratch `rsbench/` (`gen.ts`, `bench.mjs`,
`wt.ts`): one kernel per relaxed family, a DEPENDENT chain of the one instruction (each result
feeds the next, the result returned so nothing folds), original vs `--relaxed-simd-lowering`;
Node 24.21 (V8) and Bun 1.4.4 (JavaScriptCore) at N = 2·10⁷, median of 7 after a warm-up;
wasmtime 50 at N = 2·10⁸, wall time minus an N = 1 control, median of 3. Re-run on a QUIET machine
after a first run shared the CPU with a gate (it agreed within a few %). Lowered ÷ original:

| kernel | V8 | JSC | wasmtime |
| --- | --- | --- | --- |
| f32 madd | 1.76 | 0.98 | 1.72 |
| f32 nmadd | 2.12 | 1.23 | 2.13 |
| f64 madd | 1.79 | 1.00 | 1.71 |
| swizzle | 0.98 | 0.83 | 1.14 |
| laneselect | 0.97 | 1.00 | 1.07 |
| f32 min | 3.49 | 3.36 | 3.39 |
| f64 max | 4.69 | 4.74 | 4.05 |
| trunc f32 → i32 s | 1.96 | 1.01 | 2.34 |
| q15mulr | 1.64 | 1.64 | 1.64 |
| dot | 2.98 | 2.38 | 2.31 |
| dot add | 4.30 | 1.69 | 1.81 |

Reading: the regular `min` / `max` (NaN and ±0 handled) is 3–5× the relaxed one on every engine
— the largest cost; the dots cost 2–4× on V8. JavaScriptCore's relaxed madd / trunc are already
the deterministic forms (no cost). Every result was the same both ways except laneselect on V8
and wasmtime, whose mask lanes were not all-0 / all-1 — the hardware dependence the lowering
exists to remove. A whole program pays these only on its share of these instructions. README §
"Making a module run without relaxed SIMD" carries the summary.

### Decision 5 scoped — what real compiler output leaves to introduce (2026-10-24)

Measured before building (owner: "proceed with 34"), with scratch `to-introduce.ts` and
`to-scope.ts` (`featuresNeeded` and an IR pattern count, positive control: a module with each
pattern once, every one counted).

- **The optimizer introduces nothing today**: 1,230 modules (the wasmtk corpus and the 809
  probes) × -O1 / -O2 / -O3 / -Os / -Oz = 6,150 outputs, none needing a feature its input did not —
  because no pass consults features at all. Now **enforced**: `bun run optimize-corpus` (a gate
  step) fails an output that needs a feature its input does not (2,105 outputs; a mutant Vacuum
  adding a second memory failed all 2,105, then restored). The step takes ~79 s (was ~45 s).
- **What would be introduced does not occur**: on 11 real compiler modules — the six (rustc
  nightly, Zig 0.16, TinyGo 0.43, debug and optimized), the four memory64 builds (Rust, Zig,
  Emscripten ×2) and the Rust bundle fixture — **0 sign-extension shift pairs** (`(x << 24) >> 24`
  and kin), **0 trapping float truncations**: Rust, Zig and Emscripten already emit sign-extension
  and bulk memory (`memory.copy` / `memory.fill`) themselves. The patterns decision 5 named are
  gone at the source.
- **The one gap: TinyGo 0.43 has no bulk memory** — it ships `$memcpy` (both builds) and
  `$memmove` (opt1) as loops. Replacing them with `memory.copy` is the only candidate measured; it
  needs the owner (recognition by name or by shape, and `memory.copy` traps BEFORE writing where a
  loop writes part of the range first — a behaviour change on the out-of-bounds path).

### The committed probe — D4 re-measured (2026-10-24, open-work 34 a)

`bun run probe <work dir> [executor,…]` (`scripts/probe/`, local only; the wazero Go harness
committed and the stock browsers' paths in gitignored `cmem/local/probe-browsers.json`, owner's
choices). 785 modules (497 typed, 76 templates, 210 failure paths, 2 encodings; every D1 entry
exercised), 17 executors, the lowered outputs too; it compares the measurement with D4 and exits 0
only when they agree. Its full runs found, in order:

- **D4's `probes` double-counted** relaxedSimd (40, really 20) and wideArithmetic (8, really 4):
  the derivation counted run 6's copies of run 1's modules. Fixed in D4 1.1.0 (open-work 40).
- **Its own wrong expectation**: `memory.fill` / `memory.copy` "out of bounds" had length 0 at
  exactly the end (D1 types the length `addr`, so the generic case passed 0), which is IN bounds
  and must not trap; every engine returned 0. Now `len0-at-end`, expecting 0.
- 🔑 **Tail calls were never refused by wasmer.** The runner passed wasmer the flag of each
  module's feature; wasmer 7.5.0 refuses `--enable-tail-call` ITSELF ("No backends support the
  required features", even on a module with only `call`) and runs `return_call`,
  `return_call_indirect` and `return_call_ref` correctly without it. Every other wasmer refusal
  was re-run with no flags at all and stands (GC, relaxed SIMD, wide arithmetic, custom
  descriptors, custom page sizes, i64 memory, `br_on_non_null`); table64 also ran bare, but the
  i64 memory keeps memory64 lowered. The runner now tries the base switches first and a feature's
  flag only after a refusal. **D4: tailCall portable** (owner, 2026-10-24: "Make them portable").
- **Playwright Chromium and WebKit had never run the 497 typed modules** (run 1 had Node, Bun,
  Playwright Firefox and the stock Chrome / Edge only); now they have, and agree with D4.
  `memory.atomic.wait*` traps in Chromium, WebKit, Chrome and Edge — the main thread may not block;
  WebKit says so as "Out of bounds memory access" (Bun, the same engine, waits). Reported as
  browser policy, as D4's threads note says.
- **The final run: 0 D4 differences after the tail-call change, 0 wrong results** — every defining
  engine gives the agreed value or the spec's trap on all 785 originals and the 750 lowered
  outputs. D4's `measured` is 2026-10-24; Edge's build moved to 156. Reported only: relaxed SIMD's
  hardware-dependent values (the reason it is lowered), binaryang's interpreter not running custom
  descriptors, and a NaN sign from `f32x4.sqrt` / `f64x2.sqrt` of a negative lane in both
  interpreters (the spec allows either).

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
  through atomics (an open-work item of its own). ✅ FIXED 2026-10-24 (open-work 38): the interpreter
  matches the engines on all 179 threads probes it can be judged on (2 more: the engines disagree);
  the threads spec suite 267 / 267. (Precompute was never affected: it shares only
  `interp/numeric.ts`.)
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

