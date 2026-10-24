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

5. **Optimization takes the browsers' WebAssembly 2.0 support into account** (owner, 2026-10-23:
   "all modern browsers now support wasm preview 2. this should be taken into account with our
   optimization efforts" — clarified with a caniuse-style list as WebAssembly **2.0**, the spec
   version, not WASI Preview 2). → **Target-aware optimization**: given a target profile, passes
   may INTRODUCE features the input does not use (bulk-memory `memory.copy` / `memory.fill` for
   byte loops, sign-extension for shift pairs, multi-value returns for memory spills, …) — smaller
   and usually faster, the owner's two optimizer targets. The profile both LIMITS what the optimizer
   emits and PERMITS what every defining engine runs. Today binaryang's `defaultFeatures()` is
   exactly WebAssembly 2.0 (mutable globals, saturating conversions, sign extension, SIMD,
   multi-value, bulk memory, reference types; every 3.0 feature off), and `wasm-opt` validates input
   against every feature but its passes take no TARGET.

6. **wasmer and wazero DEFINE portability** (owner, 2026-10-23: "wasmer and wazero need to count
   to portability and our runs everywhere efforts"). So the profile is set by all 11 engines, and
   GC, tail calls, `br_on_non_null` and multi-memory stay **engine-specific** until both support
   them (neither GC nor tail calls has a practical lowering). They join the "runs everywhere"
   evidence ([run-everywhere.md](run-everywhere.md)) beside the browsers and JS runtimes.

7. **Browsers: the cross-platform, commonly used engines only** (owner, 2026-10-23: "The only
   outlier is ladybird browser that is still in development and only available on mac and linux.
   I think we should stick to cross platform common browser engines only.") — **V8**,
   **SpiderMonkey**, **JavaScriptCore**. Ladybird (its own engine, in development, macOS / Linux
   only) is excluded until it ships widely. JavaScriptCore stays: Safari is Apple-only, but the
   engine is cross-platform (Playwright WebKit on Windows, WebKitGTK, Bun) and carries all of iOS.
   **How each is measured** (owner: "javascript core is covered by bun isn't it? … I can install
   Firefox"):
   - **V8** — Chrome stable (156 on this machine) and Edge stable (155): installed, ready.
   - **SpiderMonkey** — Firefox stable AND Firefox ESR (the Extended Support Release: frozen for
     about a year, security fixes only; enterprises, schools, Debian and Tor Browser run it — the
     real floor for Firefox users), both to be installed by the owner. ⚠️ Playwright drives its OWN
     patched Firefox: the harness for a stock install (WebDriver BiDi, or a probe page that records
     its results) is to be proved before its numbers are trusted.
   - **JavaScriptCore** — Bun stands for CURRENT JavaScriptCore (it and Playwright's WebKit
     accepted and refused exactly the same in passes 1 and 2), but Bun pins a WebKit newer than any
     shipped Safari; the floor of Safari versions IN USE (older iOS stays for years) comes from
     published compatibility data (MDN browser-compat-data / caniuse) against the usage review. No
     Mac or device cloud is needed for that.

### Stable browsers, measured as their users run them (2026-10-23)

The owner installed Firefox and Firefox ESR (scoop). **Four stock browsers**: Chrome 156.0, Edge
155.0, Firefox 158.0.1, Firefox ESR 153.5.1 — each identified by the user agent its page reported,
not by the path launched. **Harness: no automation.** A local server serves a probe page and the
modules; the browser opens it headless (`-headless` / `--headless=new`, a throwaway profile), runs
every module and POSTs its results back (scratch `ops/browser-probe.ts`). Proved on Firefox 158
first: its pass-2 results discriminate (66 values, 5 expected traps, 5 refusals), not a blanket
"ok". (Playwright drives its OWN patched Firefox, 155 — older than the stable 158.)

- **Pass 2: identical to Playwright's builds** — every expected value and trap, no value differs
  from any engine, and they refuse only what every browser refuses (custom descriptors, custom
  page sizes). **Even ESR 153 runs GC, tail calls, standard exceptions, typed function references,
  memory64 and multi-memory** — so the stable browsers do NOT narrow the portable tier; wasmer and
  wazero remain what keeps GC and tail calls out.
- **Pass 1** — two differences, both explained:
  - 🔑 **Chrome 156 and Edge 155 TRAP on `memory.atomic.wait32` / `wait64`: "Atomics.wait cannot be
    called in this context".** A browser forbids a BLOCKING wait on the page's main thread; it is
    allowed in a Worker. A platform rule, not missing support — and Playwright's Chromium did not
    enforce it, which is what a stock-browser harness is for. Firefox 158 / ESR 153 let this probe's
    wait through (its value does not match, so it returns at once). **Rule for the profile:**
    atomic waits are portable only off the main thread in browsers.
  - **Firefox ESR 153 refuses wide-arithmetic** ("unrecognized opcode"), which Firefox 158 runs —
    ESR's year of lag, as expected; wide-arithmetic is already outside the portable tier pending its
    lowering.
- All other values match the engines (relaxed SIMD aside, which varies by design).

### Safari's floor, from published data — and what it removes (2026-10-23)

Source: **MDN browser-compat-data 8.1.7** (npm `@mdn/browser-compat-data`, CC0, data timestamp
2026-10-22; its `webassembly.*` features; the first version supporting each BY DEFAULT — no flag,
no prefix, not partial). Cross-checked against our own stable-browser measurements where both
exist: BCD has wide-arithmetic in Firefox 155 and absent from Chrome — exactly what ESR 153
(refuses), Firefox 158 (runs) and Chrome 156 (refuses) did.

🔑 **Safari ships three features our JavaScriptCore columns ran ONLY as "preview" (Safari
Technology Preview), and not at all on iOS: memory64, multi-memory, relaxed SIMD** (and
wide-arithmetic). Bun and Playwright's WebKit 26.6 are newer than any shipped Safari — owner
decision 7's caveat, now measured. Consequences: **memory64 is portable only via
`Memory64Lowering`** (already its tier); **multi-memory stays engine-specific** (it was, for
wazero); relaxed SIMD is via its planned lowering.

| feature | Safari / iOS | Chrome | Firefox |
| --- | --- | --- | --- |
| multi-value · sign-ext · sat-conversions · bulk memory · reference types | 13.1 – 15.1 | ≤ 96 | ≤ 79 |
| threads / atomics | 15.2 | 74 | 79 |
| SIMD-128 | 16.4 | 91 | 89 |
| extended-const | 17.4 | 114 | 112 |
| typed function references | 18 | 119 | 120 |
| exceptions, standard (exnref, BCD `exceptionsFinal`) | 18.4 | 137 | 131 |
| GC · tail calls (engine-specific: wasmer / wazero) | 18.2 | 119 · 112 | 120 · 121 |
| memory64 · multi-memory · relaxed SIMD · wide-arithmetic | preview only | 133 · 120 · 114 · — | 134 · 125 · 146 · 155 |

The portable tier as measured needs **Safari / iOS 18.4** (March 2025), set by standard exceptions;
a floor of 16.4 would have dropped standard exceptions, typed function references and
extended-const (and made `TranslateToExnref` point the wrong way). **Decided by decision 8 below.**

### 🔒 Decision 8 — the version floor: supported browsers on supported operating systems (2026-10-23)

Owner, asked which versions are out of support: "We need to throw out browser versions for os
versions that have reached end of life and are no longer supported also." So a browser version
counts only if its VENDOR supports it on an OS its vendor still supports. Support status, looked up
2026-10-23 (sources conflict in places; re-check before quoting):

- **Safari** follows iOS. Supported: **iOS 27** (current), **iOS 26** (security releases, e.g.
  26.7), **iOS 18** for devices that cannot upgrade (iPhone XS / XS Max / XR; 18.7.10, 2026-08).
  OUT: iOS 15 / 16 (best-effort legacy patches only), iOS 12 and older.
- **Chrome / Edge**: only the CURRENT stable is supported (each version loses support when the next
  ships; Chrome 156 current on 2026-10-23). OUT: versions stranded on retired operating systems —
  150 (macOS 12 Monterey), 138 (Big Sur), 128 (Catalina), 109 (Windows 7 / 8 / 8.1).
- **Firefox**: current (158) and **ESR 153**. OUT: ESR 140 (ended 2026-09-29), and **ESR 115**,
  which exists only for Windows 7 / 8 / 8.1 and macOS 10.12–10.14 — retired operating systems.

**Result — the floor is Safari 18.4+ (every supported iOS line runs ≥ 18.7), current Chrome and
Edge, Firefox current + ESR 153, and the portable tier STANDS AS MEASURED.** The excluded versions
are exactly the ones that would have shrunk it (Chrome 109 / 128 and ESR 115 lack standard
exceptions; 109 and ESR 115 also typed function references).

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
(`src/definitions/profiles.json`, [definitions.md](definitions.md) § D4). The agreed shape: refuse
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

### The browser engine map (from the owner's list, corrected 2026-10-23)

- **Three engines cover every browser listed**: Chromium / **V8** — Chrome, Edge, Opera, Samsung
  Internet, UC, QQ, Baidu, Android Browser, KaiOS, Chrome for Android; WebKit / **JavaScriptCore** —
  Safari, and EVERY browser on iOS (WebKit's rule, so Chrome on iPhone has Safari's support);
  **SpiderMonkey** — Firefox (the list's "JavaScriptCore (SpiderMonkey)" is a mix-up). The probe
  already runs all three.
- **"Wasm 2.0" in such lists is often 3.0 or neither**: 2.0 is SIMD, bulk memory, multi-value,
  reference types, sign extension, saturating conversions, mutable-global import / export;
  exception handling, GC, extended-const, tail calls, memory64 and typed function references are
  **3.0**; threads is its own proposal, in neither. A browser "supporting Wasm 2.0" may still lack
  GC or exnref — so the profile is decided per FEATURE, against the STABLE version in use, and
  Safari's stable version decides 3.0 features for all of iOS.
- **Components (WASI Preview 2) are NOT run by any browser** — measured 2026-10-23 with a minimal
  component (`wasm-tools`, header `0d 00 01 00`): Chromium 153, Firefox 155, WebKit 26.6, Node 24,
  Deno 2.9.8 and Bun 1.4.4 all refuse it at the version field, and none exposes a component API;
  wasmtime 50 runs it. Browser delivery of a component goes through a translation (`jco`-style),
  and optimization applies to the core modules inside — a separate scope if ever wanted.

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
| memory64 / table64 | wasmer, wazero, Bun (JavaScriptCore; Playwright's newer WebKit runs it) — Bun corrected 2026-10-23 from the results | **via lowering** — `Memory64Lowering` |
| custom page sizes | wasmer, WasmEdge, wazero, V8 ×4, SpiderMonkey, JavaScriptCore ×2 | **via lowering** — `LowerCustomPageSizes` |
| wide-arithmetic (pass 1) | V8 ×4, WasmEdge, wasmer, wazero | **via lowering** — `WideArithmeticLowering` (built 2026-10-23) |
| relaxed SIMD (pass 1) | wasmer, wazero; results vary elsewhere by design | **via lowering** — `RelaxedSimdLowering`, the spec's deterministic profile (built 2026-10-23) |
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
- **Pass 3, the trap paths of the typed opcodes** (divide by zero, out of bounds, invalid
  conversion): pass 2 covered traps only for the untyped ones.
- **The two lowerings** (owner decision 2), the portable target and D4.
- **Target-aware optimization** (owner decision 5): passes that use a feature the target profile
  permits and the input lacks — after D4 gives the profile, each measured for size AND run speed.
- binaryang's interpreter: shared memories (pass 1) and custom descriptors are unsupported.
