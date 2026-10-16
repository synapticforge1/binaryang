# Runs everywhere — open-work item 28 (2026-10-12 → closed 2026-10-15)

**Closed 2026-10-15** (owner: "lets complete item 28 first"). The motto "runs on Deno, Node, Bun
and modern browsers" is held by evidence now, in CI:

| claim | what holds it |
| --- | --- |
| every export loads in a browser | `bun run browser` (bundles each export, `--external 'node:*'`) and `bun run portability` (no top-level runtime `node:` import anywhere) — parts 1, 2 |
| the library RUNS in browsers, with the same output | `bun run browsers` (28.3): Chromium, Chrome, Edge, Brave, Opera, Firefox, WebKit; 421 modules, hashes equal to Deno / Node / Bun |
| the TypeScript source runs on Node with no flag | erasable TypeScript, `erasableSyntaxOnly` on (part 4); `bun run lts` on every current LTS |
| a page can optimize bytes it holds | `wasmOpt` takes a `Uint8Array` (part 5) |
| what in-browser optimization is worth | 28.6's measurement: size, not speed ([optimizer.md](optimizer.md) § "Real compiler output, in three browsers") |
| how to do it safely | 28.7's recipe, `examples/browser-optimize/`, run by `bun run browsers` |

## 28.7 — the browser recipe (2026-10-15)

The owner's decision of 2026-10-13 stands: no browser helper in the package, at most a recipe,
pitched as a size win for modules a site does not control. Built as two files a user copies,
importing the PUBLISHED specifier (`@jrmarcum/binaryang/tools/wasm-opt`, mapped to `src/` by
`examples/browser-optimize/tsconfig.json`), not shipped (`jsr.json`'s include list):

- `optimize-worker.ts`: `wasmOpt(bytes, { optimizeLevel, shrinkLevel, validate: true })` in a
  Worker. `validate: true` compiles the result in that engine, so a result the browser refuses
  comes back as an error.
- `optimize.ts`, `optimizeInBrowser(original, options)`: refuses what the browser refuses
  (`WebAssembly.validate`, which also keeps WAT text away from `wasmOpt`, which reads anything
  without `\0asm` as text); a cache lookup by SHA-256 of the input and the options (a hit is
  re-checked, since the cache outlives browser updates); the Worker with a time limit (10 s);
  the original kept on any error, timeout or no gain; defaults `-Oz` (2 / 2).
- Two checks removed while building it, ONE CHECK PER FACT: a `\0asm` header test that
  `WebAssembly.validate` already implies, and a page-side re-validation of the Worker's result,
  which the Worker had compiled in the same engine. Neither could be shown to decide anything.

**How it is held:** `bun run browsers` bundles the two files as a user would (`bun build`, both
entries side by side) and the harness runs them in each browser: three corpus modules, each equal
to the host's `-Oz` result and the second run from the cache; four cases that must KEEP the
original — malformed bytes with a wasm header, padded WAT text (which `wasmOpt` would shrink), a
1 ms limit, and the recipe's own output again (`-Oz` does not shrink it further: 800 → 800 bytes
on the first module; the host checks that precondition every run). Measured 2026-10-15: chromium
153, Chrome 155, Edge 155, Firefox 155, WebKit 26.6 all pass ("recipe 3 of 3 shrunk, 4 kept").
**Positive controls** (scratch, chromium): the cache never hitting, the time limit ignored, the
original not validated, the no-smaller check dropped — each FAILS the run naming its rule.

**The README** (published): § "Optimizing in the browser" (size, not speed, the 28.6 numbers, with
the measurement's limit: one compute workload), and the runtime footnote, which until now said a
browser run was "planned" — CI has run one since 2026-10-13 (`97ef696d8`, first in v1.12.1).

## The record as it stood in open-work.md, verbatim

28. ⬚ **"Runs everywhere" is not true today; bring it back into line** (owner, 2026-10-12:
    "Sounds like our run everywhere motto needs some effort to bring it back into line. We need
    to work on that effort."). Measured 2026-10-12, during Bun migration B4:
    - **Browsers: 15 of 22 exports do not even BUNDLE for the browser**
      (`bun build --target=browser`). They include `./wat2wasm`, the README's quick-start import,
      and the library entries `./api`, `./passes`, `./compat/binaryen`. Only `./ir`, `./ir/*`,
      `./core/wabt-ts`, `./compat/wabt`, `./wasm`, `./wasm-runtime` and `./definitions` are
      clean. One cause: each `src/tools/*.ts` imports `node:process` (and some `node:fs`) at
      the TOP for its CLI `main()`, which makes the module unloadable in a browser even for its
      pure library function. `src/passes/memory-packing.ts` imports `tools/wasm-ctor-eval.ts`,
      which spreads that to `./api`, `./passes` and `./compat/binaryen`. The portability gate
      checks DIRECT `node:` imports outside the CLI layer, not what is reachable through
      imports, so it stayed green. The README's "modern browsers" claim is untested: no CI job
      runs a browser.
    - 🔧 **FIXED 2026-10-12 by part 4** (the source is erasable TypeScript; Node 22.18–26 run it with
      no flag). As found: **Node 26+ cannot run the TypeScript source**: it removed `--experimental-transform-types`
      (strip-only), and `src/` has `enum`s and constructor parameter properties. Node 24 keeps
      the flag until its end of life, 2028-04-30. The PUBLISHED package (JSR's compiled JS) runs
      on Node 26 unchanged.
    - **Engines differ, as measured** ([bun-migration.md](bun-migration.md) § "The engine
      oracle"): Bun's JavaScriptCore lacks memory64 and accepts 70 invalid core modules. V8
      versions: Node 24 13.6, Node 26 14.6, Deno 2.9.7 15.0, Chrome stable 156 = **15.6** (the
      newest V8 anywhere, 2026-10-07). Nesting-depth ceilings differ per runtime stack (the
      `hostile` depth table).
    **Progress (2026-10-12, owner: "Work on 27 first then 28"):** parts **1, 2 and 5 DONE** on
    branch `run-everywhere-1`. All 22 exports bundle for the browser; `bun run browser` (new, in
    CI) and `bun run portability` (now tree-wide: no top-level runtime `node:` import anywhere)
    hold it, and each was shown to FAIL on the old form of a tool. 🔧 **That proof was
    incomplete** (owner, 2026-10-12: "Bun silently stubs out a top-level node:fs import"): the old
    tool used `node:process`, whose missing default export makes Bun FAIL the build, while
    `node:fs` is STUBBED, so a used top-level `node:fs` import in a library file passed
    `check-browser.ts`. `check-portability.ts` caught it, so nothing shipped through the gap.
    Fixed: the bundle uses `--external 'node:*'`. The `node:fs` mutant now fails, a `node:path` one
    fails 14 of 22, and the old regression still fails 2. `wasmOpt` takes bytes.
    **Part 4 DONE too (owner: option "1", 2026-10-12), branch `erasable-ts`:** the 49 non-erasable
    constructs are gone. 29 constructor parameter properties became `declare` fields plus
    assignments, the same runtime shape. 20 `enum`s (19 exported) became `const X = {…} as const` +
    `type X` + a type-only `declare namespace X`, so `X.Member` works as a value AND as a type.
    Every value was computed and checked against the old enum objects (572 members, all equal).
    `erasableSyntaxOnly` is on in `tsconfig.json` and `deno.json`, so it cannot come back. Node
    22, 24 AND 26 now run the source with NO flag, the same CLI hash as Deno and Bun. The flag left
    every script, CI and the docs; CI tests Node 26. What the stricter types exposed:
    `exp.kind in ExternalKind` (relied on reverse keys; every export read as unknown, caught by
    cli-smoke); `Opcode` used across the IR for COMBINED `(prefix << 16) | sub` values that are
    not members (so the `Opcode` TYPE is deliberately `number`, the strictness it always had; a
    precise union is a follow-up); a name-section set holding unknown ids. **Open:** part 3 (a real
    headless-browser run: headless Chrome, V8 15.6, running the library on the corpus with the
    same hash as the other runtimes; it may also be the engine REFEREE once Deno is gone, item 26);
    the in-browser optimization measurement (below). **Precise operator types DONE 2026-10-13**
    (owner: "Precise operator types first", then "One generated instruction union"). ⚠️ The
    follow-up's premise was wrong: "a union of each table's values" would have made the ~116
    instructions no table names (atomics, relaxed SIMD) unrepresentable, against S6 stage 1
    ([ir-convergence.md](ir-convergence.md)). Instead `scripts/definitions.ts` generates
    `src/definitions/instr-code.ts` from `opcodes.json`: `InstrCode` (the 582 real instructions, in
    the IR's encoding), `INSTR_CODES`, `isInstrCode`; `Opcode = InstrCode`, so every operator type
    narrows with it. Measured first: every value the code uses (the `Opcode` / `MiscOpcode` /
    `GcOpcode` tables, all 9 operator tables) is among the 582. The 244 prefixed table members are
    hex literals (values proven identical); all **43 opcode casts are gone**: the binary reader's
    misc / SIMD / atomic decoders ask `isInstrCode` first, the lexer's keyword table checks each
    entry at load, the parser reads typed tokens. **What the types found:** the SIMD decoder took
    ANY sub-opcode as a binary op (reserved `0xfd 0x9a` validated clean, `wasm2wat` printed
    `<opcode:0xfd009a>`, V8 refused it); fixed, `reserved_subopcodes.test.ts` (fails 22 cases on the
    old reader). Public: `InstrCode` / `INSTR_CODES` / `isInstrCode` beside `Opcode`
    ([unreleased.md](unreleased.md): a type-level BREAKING entry and a behaviour fix).

    **Node LTS policy (owner, 2026-10-12): "support and test all currently available lts
    versions."** As of 2026-10-12 that is Node 22 "Jod" (22.23.3) and Node 24 "Krypton" (24.21.0),
    both in CI's `runtimes` matrix (22.18 floor, latest 22, latest 24, and latest 26 ahead of its
    LTS on 2026-10-28; no flag on any). fnm holds 22, 24 and 26. Locally, **`bun run lts`**
    (`scripts/check-lts.ts`) takes the lines from Node's release schedule (`nodejs/Release`
    `schedule.json`: LTS started, end of life not reached) and runs `cli-smoke` on each through
    `fnm exec` (fnm 1.39.0, owner's choice, 2026-10-12). Same hash on v22 and v24. A line fnm
    lacks FAILS, naming `fnm install <n>`. ⚠️ **DATE: Node 26 enters LTS on 2026-10-28** (the
    schedule; Node 24 enters maintenance 2026-10-20). From that day `bun run lts` REQUIRES v26, and
    Node 26 removed `--experimental-transform-types`, so it fails until part 4 makes the source
    run on it, or until a leg tests the COMPILED package. That makes part 4 urgent: 16 days.
    🔧 **Resolved the same day:** part 4 is done, and Node 26 runs the source (measured with the
    portable 26.11.1).

    **Proposed plan, owner to order:** (1) tools: move the Node-only parts INSIDE each `main()`
    (`globalThis.process`, an on-demand `import('node:fs/promises')`), so every export bundles
    for the browser with the API unchanged, and move `packMemory` out of the CLI layer; (2) a
    reachability portability gate: bundle every export for the browser in CI and fail on any
    `node:`; (3) a REAL browser job: headless Chrome running the library on the corpus, the
    same hash as the other runtimes; (4) decide erasable-only TypeScript (`enum` → const object
    plus type, parameter properties → fields) so Node ≥ 26 runs the source. That changes
    exported types and is a minor at least; (5) a BYTES-in / bytes-out optimizer export:
    `wasmOpt(inputPath)` reads a FILE with `node:fs` and its byte-level core `_nativeOptimize`
    is private, so a page has no way to optimize bytes it holds. Accepting a `Uint8Array` as
    well is additive. The binaryen.js-shaped `readBinary → optimize → emitBinary` already takes
    bytes, but is blocked by (1).

    **The use case that justifies the browser (owner, 2026-10-12):** a page optimizes a wasm
    module ON THE USER'S MACHINE and hands it back (a download, or straight to
    `WebAssembly.instantiate`), "beneficial if the wasm file being called was never optimized
    to start with. At least it would run faster in the browser once downloaded." Caveats, as
    discussed: it runs AFTER the download, so the first download is not smaller; the client pays
    the optimization time unless the result is cached (Cache API / IndexedDB); a site that
    controls its module should optimize at build time instead. The browser path serves modules
    the site does NOT control (third-party, user-supplied, playgrounds). Run it in a Web Worker,
    keep the original, and fall back to it if the optimized bytes fail the browser's validation.
    **Measure before building on it:** a few unoptimized (debug / `-O0`) modules; in Chrome,
    compile time and run time before vs after, and the optimizer's own time in the browser. No
    run-time speedup has been measured yet, so promise none.
    **SCOPE OF WHAT REMAINS (2026-10-13, owner: "Scope item 28 for the items needed to achieve
    this").** Done: parts 1, 2, 4, 5 (every export bundles for the browser, held by `bun run
    browser`; the source runs on Node 22.18–26 with no flag; `wasmOpt` takes bytes) and the precise
    operator types. What "runs everywhere" still lacks is EVIDENCE from a real browser, and the
    browser use case lacks a measurement. Two pieces, in this order (the second uses the first's
    harness), then one optional:
    - **28.3 — a real-browser job.** ✅ **BUILT 2026-10-13** (owner: "1. Playright, 2. chromium based,
      firefox, opera, vivaldi, brave, edge, duckduckgo, 3. commit as test modules", then "add safari
      instead of duckduckgo"): `bun run browsers` (scripts/check-browsers.ts, scripts/browsers/), Playwright
      1.63.0. Here: Chromium 153, Chrome 154, Edge 155, Firefox 155 and Safari's engine (WebKit 26.6) all
      pass: 19 exports load, 421 corpus modules, every hash equal to the host's (smoke `7dbdcd45…`, the
      same as every runtime's), 0 engine refusals, so tests/browser-known-differences.json is empty.
      Brave, Opera, Vivaldi are not installed here (skipped, named). Mutants: a browser-only break
      (`process` touched in `wat2wasm`) fails every browser; a stale list entry fails. CI: a `browsers`
      job (scripts/ci/install-browsers.ts: Playwright's three with `--with-deps`, Brave / Opera /
      Vivaldi from their apt repositories; Chrome and Edge from GitHub's image) runs `--require-all`;
      **UNPROVEN until it runs on GitHub** (the Linux installs cannot be tried here).
      🔧 **On GitHub, 2026-10-13:** the first run failed with no readable cause (job logs need admin
      rights through the API), so failures became annotations; they showed one driver process dying
      at Vivaldi and silencing Firefox and Safari, so each browser got its own process, and every
      driver step a named time bound. Then 7 of 8 passed on Linux, and Vivaldi never became usable
      headless (a new context's `newPage()` never settled; in its default context the launch never
      settled). **Vivaldi REMOVED** (owner: "lets remove vivaldi from the checks. most of the other
      chromium distributions are applicable"): the job runs chromium, Chrome, Edge, Brave, Opera,
      Firefox and WebKit. DuckDuckGo's browser
      cannot be automated (no protocol; it is WebView2 on Windows, WebKit on macOS): Safari's engine
      replaced it. *What (as scoped):* a static page, served locally by Bun, that loads the
      browser bundle of EVERY export and runs, through the library (no CLI): (a) the cli-smoke
      equivalent (`wat2wasm` on a fixed module), whose SHA-256 must equal the Deno / Node / Bun
      hash; (b) a corpus pass: `wat2wasm` → `wasm2wat` round trip, and `wasmOpt` bytes in →
      `WebAssembly.validate` in THAT browser, over a corpus subset. *Engine differences:* as with
      `test:bun`, a per-browser known-differences list, checked both ways (WebKit is JavaScriptCore
      like Bun, so expect the memory64 / table64 family there). *Driver — the owner's call:*
      **Playwright** (1.63.0 is the newest release over two weeks old) drives Chromium, Firefox AND
      WebKit, i.e. V8, SpiderMonkey and JavaScriptCore, the three engines the README's "modern
      browsers" means; its browser downloads are a few hundred MB (CI: `playwright install
      --with-deps`, cached). **puppeteer-core** (25.12.0) is lighter and can drive the installed
      Chrome / Edge (this machine has both, no Firefox), but has no WebKit. *CI:* a `browsers` job;
      budget a few minutes. *Accepted when:* every export loads in each browser; the smoke hash
      matches every runtime's; the corpus pass holds with each browser's listed differences; a
      mutant (an export with a top-level `node:` import, or a browser-only break) fails the job.
    - **28.6 — measure in-browser optimization, BEFORE building on it** (the owner's use case: a
      page optimizes a module it does not control, on the user's machine). *Inputs:* unoptimized
      modules built HERE — this machine has Rust nightly (`wasm32-unknown-unknown`,
      `wasm32-wasip1`), Zig 0.16, TinyGo 0.43 — in debug / `-O0` and release forms, 5–8 modules
      across sizes, each with a fixed workload to time. Kept as fixtures (anchored `.gitignore`
      exceptions: the 1.10.0 lesson) or rebuilt for the measurement; the toolchains are not in CI,
      so this is a recorded LOCAL measurement, not a gate. *Measure,* in a Web Worker, in Chrome
      (and Firefox / WebKit if 28.3 brings them): binaryang's `wasmOpt` time at `-O2` and `-Oz`,
      output size, `WebAssembly.compile` time before vs after, the workload's run time before vs
      after; upstream `wasm-opt` 133 (installed) on the same inputs as the quality reference.
      *Accepted when:* a dated table in cmem, and the decision it supports: whether a browser
      helper is worth shipping, or a documented recipe is enough. No speedup is promised until then.
      ✅ **MEASURED 2026-10-13** ([optimizer.md](optimizer.md) § "Real compiler output, in three
      browsers"; `benches/browser-opt/`, its six modules committed, `results.json` the raw run):
      Chrome 154, Firefox 155, Safari's engine 26.6. Every optimized variant is correct in every
      engine. binaryang optimizes in a Worker in 60 ms – 1.7 s. **There is NO run-time speedup**, from
      ours or upstream's optimizer, even on debug builds: the engines' tiers already optimize; the gain
      is size only (code bytes −0.1% to −27%). Two size gaps to upstream on real compiler output →
      item 30. **DECIDED (owner, 2026-10-13: "I agree with the recommendation for the browser
      interface"):** no browser helper; at most 28.7's recipe, pitched as a size win for modules the
      site does not control, never as speed.
    - **28.7 — optional, after 28.6's numbers:** the browser recipe as documentation (or a helper):
      optimize in a Worker, keep the original, validate the result with `WebAssembly.validate` and
      fall back to the original on failure, cache the result (Cache API / IndexedDB).
    **Decisions for the owner:** (1) the driver, Playwright (all three engines) or puppeteer-core
    (Chromium only, lighter); (2) which browsers gate CI; (3) for 28.6, whether the modules are
    committed as fixtures or rebuilt per measurement.
