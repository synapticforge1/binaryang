# Opcode portability — one profile every widely used engine runs (open-work 34)

Summary: the owner decisions that define the portable profile, the browser floor, the agreed three-tier shape and the profile across the 11 defining engines. Last verified 2026-11-20.
The passes, the lowerings' proofs and the probe's runs: [archive/portability-to-4.1.1.md](archive/portability-to-4.1.1.md).

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
   🔧 **Corrected 2026-10-24: tail calls are PORTABLE** (owner: "Make them portable"). wasmer
   7.5.0 runs every tail call; the 2026-10-23 harness passed it `--enable-tail-call`, a switch
   wasmer itself refuses ("No backends support…", even for a plain `call`). § "The committed
   probe" below.

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
  wazero remain what keeps GC out (and tail calls, as measured then — an artifact, corrected
  2026-10-24).
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
| GC (engine-specific: wasmer / wazero) · tail calls (portable since 2026-10-24) | 18.2 | 119 · 112 | 120 · 121 |
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

## Where the measurements went

- § "Pass 3 — the failure paths of the typed opcodes (2026-10-23)", § "Pass 1 — the 497 opcodes D1
  gives a concrete signature (2026-10-23)", § "Pass 2 — the untyped opcodes and the encoding-level
  features (2026-10-23)": moved to [portability-to-4.1.1.md](archive/portability-to-4.1.1.md)
- § "The wide-arithmetic lowering — built and proven", § "The relaxed-SIMD lowering — built and
  proven", § "The portable target and D4 — built and proven", § "The relaxed-SIMD lowering's run
  cost — measured": moved to [portability-to-4.1.1.md](archive/portability-to-4.1.1.md)
- § "Decision 5 scoped — what real compiler output leaves to introduce", § "The committed probe — D4 re-measured": moved to [portability-to-4.1.1.md](archive/portability-to-4.1.1.md)

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

### The profile across the 11 defining engines (interpreters excluded)

| feature | refused by | tier |
| --- | --- | --- |
| core control / calls / locals / globals, multi-value, sign-ext, sat-conversions, bulk memory, reference types, tables, SIMD-128, extended-const | — | **portable** |
| threads / atomics (pass 1) | — | **portable** |
| exceptions, STANDARD (`try_table`, `throw`, `throw_ref`) | — | **portable** |
| typed function references (`call_ref`, `ref.as_non_null`, `br_on_null`) | — | **portable** |
| … `br_on_non_null` | wasmer ("only numeric types are supported") | engine-specific |
| tail calls | wasmer ("no backend supports") — 🔧 the harness's `--enable-tail-call`, not the engine: corrected 2026-10-24 | engine-specific → **portable** |
| GC (26 templates) | wasmer ("GC is not implemented yet"), wazero (both modes) | engine-specific |
| exceptions, LEGACY (`try` / `catch` / `catch_all` / `rethrow` / `delegate`) | wasmtime, WasmEdge, wazero | **via lowering** — `TranslateToExnref` to the standard form, which is portable |
| memory64 / table64 | wasmer, wazero, Bun (JavaScriptCore; Playwright's newer WebKit runs it) — Bun corrected 2026-10-23 from the results | **via lowering** — `Memory64Lowering` |
| custom page sizes | wasmer, WasmEdge, wazero, V8 ×4, SpiderMonkey, JavaScriptCore ×2 | **via lowering** — `LowerCustomPageSizes` |
| wide-arithmetic (pass 1) | V8 ×4, WasmEdge, wasmer, wazero | **via lowering** — `WideArithmeticLowering` (built 2026-10-23) |
| relaxed SIMD (pass 1) | wasmer, wazero; results vary elsewhere by design | **via lowering** — `RelaxedSimdLowering`, the spec's deterministic profile (built 2026-10-23) |
| multi-memory | wazero | engine-specific (binaryang has no multi-memory lowering) |
| custom descriptors | every engine at its defaults (V8 behind `--experimental-wasm-custom-descriptors`) | engine-specific |

🔑 **What the list review turns on:** wasmer and wazero are the only engines keeping GC (and, as
measured then, tail calls — corrected 2026-10-24, they are portable) out of the portable tier, and
wazero alone multi-memory; neither GC nor tail calls has a practical lowering. So whether GC-language output (Kotlin, Dart, OCaml, …) is portable is exactly
the question of whether wasmer and wazero are prevalent enough to define "portable" (owner
decision 1). The browser builds measured are Playwright's (recent); the STABLE versions in use are
part of that review.

## Open

Open-work 34 CLOSED 2026-10-24; what it delivered is above, and the reference for the other
projects is `docs/opcode-guide.md`. The earlier list here (the engine list's review basis, pass 3,
the two lowerings, the target, decision 5, the interpreter's shared memory) is all done or decided:
decisions 1 and 8, § "Pass 3", the lowering sections, § "Decision 5 scoped" (its one candidate was
item 37), open-work 38. Still true:

- **Re-measure when an engine releases**: `bun run probe <work dir>`; exit 0 means D4 holds.
- binaryang's interpreter does not run custom descriptors (reported by the probe, not defining).
