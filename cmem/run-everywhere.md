# Runs everywhere — open-work items 28 (2026-10-12 → closed 2026-10-15) and 32 (closed 2026-10-22)

Summary: what holds the claim that binaryang runs on every runtime and browser, the lowering decisions for item 32, and the browser recipe. Last verified 2026-11-20.
Closed record: [archive/run-everywhere-to-4.1.1.md](archive/run-everywhere-to-4.1.1.md).

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

## Open-work 32 — our OUTPUT on every engine: lowering (opened 2026-10-20; measured 2026-10-22)

Item 28 proved binaryang itself runs everywhere. Item 32 is the other half: a module someone
builds may use features an engine lacks, and the 36 known Bun differences
(`tests/bun-known-differences.json`) are exactly that — JavaScriptCore refusing modules V8 runs.
Owner, 2026-10-22: "we should work on item 32 first, because we won't be able to tell what that
will effect on anything else."

**Measured first, nothing built** (scratch `lower/`: `runner.ts` replays one module's spec
invocations under the engine running it — Node 24 → V8, Bun 1.4.3 → JavaScriptCore — values by
bits, a trap as `trap`; `measure.ts` runs each spec module ORIGINAL and LOWERED by upstream
`wasm-opt` 133, on both engines, the ORIGINAL ON V8 the oracle; `mem64-probe.ts` and
`table64-probe.ts` add what the spec never exercises, addresses and indices at and above 2^32):

- **question:** legacy EH `delegate` (5 of the 36)
  - finding: **Solved already**: `check-translate-eh.ts` under Bun — legacy 50 / 70 (all of
    `try_delegate.wast` refused: "delegate target isn't a try block"), **after TranslateToExnref 70
    / 70, and after it -Oz 70 / 70**. Needs documenting, no code.
- **question:** memory64 (most of the 24)
  - finding: JavaScriptCore: "Memory64 is not enabled". Upstream `--memory64-lowering` matches every
    spec behaviour on BOTH engines — `memory_copy64` 4,353, `memory_trap64` 170, `memory_init64`
    154, `address64` 238, `float_memory64` 84, `bulk64` 65, `endianness64` 68, `memory_grow64` 45,
    `memory64` 45, `align64` 48, `load64` 37, `memory_fill64` 25 … — **and is UNSOUND above 2^32**:
    it lowers an address with a bare `i32.wrap_i64`, so (probe) a load at 2^32 READS byte 0, a store
    there OVERWRITES byte 0, and `memory.grow` by 2^32 pages SUCCEEDS (2, not -1); only a static
    offset of 2^32 becomes `unreachable`. Built for programs that never pass 4 GiB.
- **question:** table64
  - finding: Upstream's lowering (`--table64-lowering`, an alias) is **incomplete**: invalid output
    for `table.get` / `table.set` (its own validator: "table.get index must match the table index
    type") — `table_get64`, `table_set64`, `table_fill64`, `table_grow64` and one `table_init64`
    module refused — and **unsound**: `call_indirect` at index 2^32 CALLS ENTRY 0 (probe).
    `table_size64` 36, `call_indirect64`, `table_copy64` / `table_init64` otherwise agree.
- **question:** multi-memory
  - finding: **JavaScriptCore runs it natively** (`memory-multi.wast` 4 / 4 unlowered). Only a
    memory index of 127 and up fails (5 of the 36; 🔧 the limit is a COUNT, 100 memories — § "The
    last two questions" below): real producers essentially never reach it. Lowest priority.
- **question:** which producers emit memory64
  - finding: NOT measured. Known to exist: clang's `wasm64` target (Emscripten `-sMEMORY64`), Rust's
    tier-3 `wasm64-unknown-unknown` — to be checked before claiming. (Measured since: § "The last
    two questions" below.)

**Harness artifacts, not findings** (so they are not mistaken for one later): JavaScriptCore
CANONICALIZES NaN payloads crossing into JavaScript (every "got" was `0x7fc00000` /
`0x7ff8000000000000`; the control, plain 32-bit `float_memory.wast` with no lowering, shows the
same 66 / 84 there); a `v128` export cannot be called through the JS API (both engines throw,
worded differently; the real `spec-behaviour` gate wraps them); and upstream `--all-features`
switches on its compact-imports encoding (`unknown import kind 0x7e`) — pass
`--disable-compact-imports` with it.

**Decided (owner, 2026-10-22): the lowering is SOUND — a lowered module traps where the original
does.** A 64-bit address or index of 2^32 and up becomes an out-of-bounds trap (not upstream's
wrap, and not upstream's `unreachable`, a different trap KIND); `memory.grow` / `table.grow` by
2^32 and up returns -1. The cost is a compare per access. The gate: every spec module above,
lowered, agrees with the original-on-V8 on BOTH engines, plus the >= 2^32 probes, plus
`real_compiler_behaviour.test.ts`. To settle while building: how the out-of-bounds trap is kept
exact (an effective address no 32-bit memory can reach — which needs the lowered memory's maximum
below 65,536 pages, or a refusal when it cannot be); imported / exported 64-bit memories and tables
(the host gives or takes a 64-bit one: lowering changes the interface); limits past 32 bits
(refuse, with a message).

§ "Built (2026-10-22)", § "The record as it stood in open-work.md, verbatim" (including open-work 28.3): moved to [archive/run-everywhere-to-4.1.1.md](archive/run-everywhere-to-4.1.1.md).

### The last two questions, measured — and item 32 closed (2026-10-22)

Owner: "I think we measure each and make the decisions based on the measurements."

**(b) Which producers emit memory64** (the benchmark workload, `benches/browser-opt/src`):

- **producer (installed here):** Zig 0.16 `wasm64-freestanding`, Debug / ReleaseFast
  - emits: a 64-bit memory AND table
  - the module: 1 memory, 17 pages, no max, exported
  - JavaScriptCore, original: refused
  - lowered: runs, checksum 1892226719 ✓
- **producer (installed here):** Rust nightly 1.101 `wasm64-unknown-unknown` (`-Zbuild-std=std,panic_abort`), debug / release
  - emits: the same
  - the module: 1 memory, 17–18 pages, no max, exported
  - JavaScriptCore, original: refused
  - lowered: runs, checksum ✓
- **producer (installed here):** Go, TinyGo
  - emits: no 64-bit wasm target (`js/wasm`, `wasip1/wasm`; `wasm`, `wasm-unknown`, `wasi*`)
- **producer (installed here):** Emscripten 6.0.13 `-O2 -sMEMORY64=1` (workload ported to C), standalone reactor
  - emits: a 64-bit memory AND table
  - the module: 1 memory, 258..258 pages, no imports
  - JavaScriptCore, original: refused ("Memory64 is not enabled")
  - lowered: runs, checksum ✓
- **producer (installed here):** the same as a PROGRAM with its JS glue (`-sENVIRONMENT=node`), and with `-sALLOW_MEMORY_GROWTH` (a 64 MiB `malloc`, 258..32768 pages)
  - emits: the same; imports `fd_write`, `emscripten_resize_heap`
  - the module: the glue uses BigInt but takes the memory FROM the module (no `address: "i64"`)
  - JavaScriptCore, original: `bun x.js` exits 1
  - lowered: the lowered `.wasm` swapped in under the UNCHANGED glue: `bun x.js` prints the checksum, and after growth the grown byte ✓

Decided (owner, from these): the pass stands as built; the two RELEASE builds are committed test
modules (`benches/browser-opt/modules64/`, `build.ts --wasm64`; `.gitignore` excepts them — the
1.10.0 lesson recorded there), run by `memory64_real_compiler.test.ts` on both engines. Rust's
build needed a SHORT target directory: under the long scratch path its build script could not be
run on Windows ("The system cannot find the path specified", the 260-character limit).

Emscripten (measured the same day, once installed): the C port of the workload was first checked as
plain wasm32 (checksum ✓ on both engines). Its glue already crosses the JS boundary with BigInt
pointers, and lowering keeps the i64 signatures, so the glue needs no change — only the `.wasm`
does. Owner: "lets commit the emscripten builds as test modules, since it was part of how we made
our decision" — so `build.ts --wasm64` builds them too (./src/c, `-O2 -m64`: the same bytes as the
deprecated `-sMEMORY64=1`, hash-checked) and `memory64_real_compiler.test.ts` runs them: the
standalone module in the loop, and the program as a child of the test's own runtime, the glue
(`.cjs`, the package being `"type": "module"`; excluded from dprint) unchanged beside the lowered
`.wasm`. A mutant without the lowering fails it on Bun. Rebuilding gave Rust and Zig byte-identical
modules. On Windows, `emcc.bat` through `cmd.exe` mangles quoted arguments; `emcc.exe` spawned directly with
`EMSDK`, `EM_CONFIG`, `EMSDK_PYTHON`, `EMSDK_NODE` set works.

**(c) The multi-memory limit:** JavaScriptCore takes **100** memories and refuses 101 ("there can
be at most 100"); V8 took 1,000. 🔧 This record said "a memory index of 127 and up" — the tests
that met the limit used such indices; the limit is the COUNT. Every real compiler output measured
(the six, and the four wasm64 builds) has exactly one memory. Decided: no multi-memory lowering;
`tests/bun-known-differences.json`'s reason and the README say 100.

**Trap kinds, measured:** original vs lowered on V8, the engine's messages are identical, 8 / 8
(memory out of bounds; `call_indirect` at 2^32 as at a plain out-of-range index; a null entry; a
`table.get`). On JavaScriptCore the lowered kinds are the matching ones (memory, call_indirect,
table access).

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
browser run was "planned" — CI has run one since 2026-10-13 (`92f0be45e`, first in v1.12.1).

