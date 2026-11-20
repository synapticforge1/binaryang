# Testing — the interpreter against the manifests, the comparison suite and the proposal testsuites

Summary: the interp gate, the comparison/ suite outside the gate, and the proposals/ gate. Last verified 2026-11-20.
Main file: [testing.md](testing.md).

### ✅ The interpreter against the MANIFESTS — `deno task interp`, in the gate since 2026-10-07

`spec-behaviour` uses V8 as the oracle and never reads `expected`. The interpreter (open-work 23,
`src/interp/`) is a second implementation of the spec, so its oracle is the other one:
**the manifests' own `expected` values**. `scripts/check-interp.ts` replays every `assert_return`,
`assert_trap`, `assert_exhaustion` and `assert_uninstantiable` on it — bits for values,
`nan:canonical` / `nan:arithmetic` as the spec defines them, a trap by its message's prefix (D3's
rule) — with `spectest` as `spec/interpreter` defines it and `register` wiring modules together.
Same prepared corpus as `spec`; ~3 s. Owner: "yes on deno task interp" (2026-10-07).

- **Verdict: 0 FAIL.** A wrong value, a missing or wrong trap, a plain `module` whose instantiation
  traps, or a JS error out of the interpreter is a FAIL.
- **`stopped` is coverage, printed by reason** — an instruction not run yet, a host import not
  given, a `v128` argument. It should only FALL as E3's increments land; a rise is a coverage loss.
  At E3a 15,432 pass / 42,144 stopped; at E3b 25,811 / 31,819; at E3c 32,618 / 25,012; at
  E3d-1 32,687 / 24,961; at E3d-2 33,268 / 24,380 (2026-10-07; 21,868 of those stops were `v128`
  arguments); at E3e, `v128` done, **57,608 / 40** (2026-10-08). What stops now: atomics and shared
  memory, custom descriptors ([interpreter.md](interpreter.md)).
- **The `proposals/` corpora run too, IN the gate since 2026-10-07** (owner: "Yes (runs
  everywhere)"; the ones the `proposals` step prepares, so `interp` runs after it): at E3e
  custom-descriptors 170 pass / 0 FAIL / 317 stopped, custom-page-sizes 31 / 0 / 0, threads
  80 / 0 / 187 (shared memory stops; since 2026-10-24, open-work 38: 267 / 0 / 0, with the
  harness's `spectest.shared_memory` added), wide-arithmetic 99 / 0 / 0. The custom-descriptors corpus
  found BOTH of E3d-2's defects — descriptor operations run as plain ones (85 FAILs, now Stops)
  and an imported function's reference typed by the importer's declaration — while the core suite
  was green.
- **The legacy-EH suite is a SEPARATE corpus** — `testsuite-main/legacy` (`try` / `catch` /
  `rethrow` / `delegate`) is not under the core corpus `spec:prepare` writes, and `translate-eh`'s
  output is flat, not the per-module layout the harness reads. Prepared on its own
  (`spec:prepare <testsuite-main>/legacy <dir>`): 70 / 70 pass, 0 stopped since E3d-1. In the
  gate since 2026-10-07 (the same owner decision) — it is the only check that killed the
  `delegate` mutant.
- `--only=<manifest,…>` runs just those manifests, for reading one area's numbers; never in the
  gate.
- **50 M instructions of fuel per invocation**, and running out is a FAIL, not a stop: every suite
  invocation finishes (clean at 5 M), and without the limit a wrong loop HANGS the run — it did,
  under a mutant, before the limit existed.
- ⚠️ **A STOP taints shared state.** Code that stops PART WAY may already have written memory, a
  table or a global, so the state the suite's next commands assume is not there. The harness
  records which instances share state (an importer and what it imported from, both ways) and,
  when a module stops while being set up OR an invocation stops after it began, marks the whole
  group stopped from then on. Found twice: E3b's Stop on active element segments showed as two
  false FAILs in `linking.wast` (data written, then the start function traps); at E3c,
  `ref_eq.wast`'s bare `(invoke "init")` stopped on `struct.new` and 40 `eq` assertions after it
  compared nulls. A stop BEFORE running (an argument the harness cannot build) taints nothing.
  At E3c the rule holds back 2,601 assertions. And a bare `action` that traps is a FAIL — the
  suite has no expectation for it to fail.
- First runs found real defects, each fixed the same day: the exhaustion check overflowing in its
  own regex (`fac.wast`'s `fac-rec`), an imported mutable global COPIED rather than shared
  (`linking.wast`'s `Mg.mut_glob`), and a module with active element segments set up as if its
  tables were empty (now a Stop until E3c).

**The numeric core has its own oracle, V8, operator by operator**
(`tests/binaryen-ts/interp/numeric_differential.test.ts`): every scalar numeric instruction D1
lists — 136, and the test FAILS if the core answers `null` for one, so coverage is asserted, not
hoped. Operands cross the JS boundary as integer BITS and are reinterpreted inside the module,
because a float passed as a JS number can lose a NaN's payload on the way. Where the spec allows any
arithmetic NaN, both must be NaN and ours must be quiet; `abs` / `neg` / `copysign` /
reinterpretations are exact. It found `f64.ceil` of a signalling NaN returning it UNCHANGED (V8
carried the payload through `Math.ceil`) on its first run.

**Every increment's tests were mutation-tested, with the equivalents named** — E1 14 / 15 (the
survivor computes the same function: JS masks shift counts), E2 9 / 9, E3a 11 / 11, E3b 13 / 13
plus one equivalent (`copyWithin` vs `set` for an overlapping copy), E3c 15 / 15, E3d-1 10 / 11
plus one equivalent (a stack reset before a `try_table` payload; removed), E3d-2 16 / 16 (`exact`
killed only by an interpreter-only test — V8 runs exact types behind a flag). Twice a mutant
survived the WHOLE spec suite and was killed only by a test added for it: a value BELOW a block's
parameters read after the block (E3a), and an active data segment not dropped (E3b). The other way
round once: a non-overlap-safe `table.copy` passed the unit tests and only the suite killed it —
the unit test read the slot both copies leave alike; it now reads the one they leave differently
(E3c). The runners are scratch scripts; each child gets a 90 s timeout, since a mutant may loop
forever.

### The comparison suite — `comparison/`, outside the gate (2026-09-28, `37c55a3a0`)

Everything that measures binaryang AGAINST upstream binaryen (`npm:binaryen`, the `wasm-opt`
binary) lives in the committed `comparison/` directory ([its README](../comparison/README.md)):
the former `./interop` bridge, its tests, our `-O2` beside upstream's, the Asyncify differentials
(split from the native tests, which stayed — shared fixtures and driver in
`tests/binaryen-ts/passes/asyncify_helpers.ts`), and four `npm:binaryen` scripts. Run with
`deno task comparison` — 18 passed, none skipped, with `wasm-opt` v133 (2026-09-28). **Since
2026-10-28 Deno-free** ([bun-migration.md](bun-migration.md) § "B8"): `bun run comparison`
installs binaryen.js from `comparison/package.json`, `bun check`s the tree, and runs it with
`node --test` on the referee — 23 passed, none skipped (the 18 Deno tests plus the 6 steps, the
parent now a suite), the same 24 names and results as Deno's last run.

- **Its tests are `*.compare.ts`**, a name `deno test` does not discover; the task names them. ⚠️
  A config `"test": { "exclude": ["comparison/"] }` was tried first and REJECTED: Deno applies it
  to explicit paths too — `deno test comparison/tests/` then found "No test modules". A bare
  `deno test` and `deno task test` both give 1,308; the suite is in neither.
- It IS covered by `deno fmt --check` (a workspace member), not by `deno task check` or `lint`.
- The split kept every native test: 1,325 → 1,308 = 19 moved out (interop 14, hybrid 2,
  asyncify differentials 3) + 2 added (native `-S`, the `--hybrid` refusal). The 19 became 18
  in `comparison/` — the hybrid pair's CLI-binary-input case had no path left to test.
- Not in it, deliberately: `wast2json` / `wasm-tools` in `spec-prepare` and `translate-eh` —
  they SPLIT test inputs for the gate and compare nothing.

### The proposal testsuites (`proposals/`) — IN the gate since 2026-09-29

🗓️ **Owner, 2026-09-29: both halves, V8's experimental flags included**, accepting that a future
Deno may need a flag adjusted. `deno task proposals <testsuite-main> <outDir>`
(`scripts/check-proposals.ts`) prepares each `proposals/<name>`, runs VALIDITY
(`spec-testsuite.ts --proposal <name>`) and BEHAVIOUR (`check-spec-behaviour.ts --proposal
<name>`, in a process started with that proposal's `--v8-flags`). ONE table says what each needs:
`scripts/proposals.ts` — its feature set, its flags, and why an engine cannot run it.

| proposal           | validity (accept · invalid · malformed bin · malformed text) | behaviour                                | V8 flag                                  |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------- |
| custom-descriptors | 93 · 157 · 111 · 16                                          | 488 invocations, 19 modules, 0 DIVERGE   | `--experimental-wasm-custom-descriptors` |
| custom-page-sizes  | 41 · 19 · 108 · 4                                            | 31 assertions × 7 worlds, LOWERED (below) | none exists — lowered instead            |
| threads            | 114 · 93 · 0 · 19                                            | 321 invocations, 14 modules, 0 DIVERGE   | none needed                              |
| wide-arithmetic    | 2 · 8 · 0 · 0                                                | 99 invocations, 2 modules, 0 DIVERGE     | `--experimental-wasm-wide-arithmetic`    |

**Feature sets are the suite's, not ours.** Every feature on, except what a suite predates or a
proposal turns on: custom descriptors ON for its own suite (the core harness turns it off — it
relaxes `br_on_cast`); `multiMemory` OFF for threads, which predates it and asserts "multiple
memories" invalid five times. With our core set, custom descriptors read 36/93 accepted and threads
5 false accepts — the harness, not the validator.

⚠️ **The flag hazard, and its guard.** A flag Deno's V8 no longer knows is only WARNED about; the
original and every variant then fail to compile ALIKE, which the differential used to count as
`agree`. Since 2026-09-29 an original the engine refuses is `blind` and FAILS the run ("engine
refused ORIGINAL" — 0 across the core suite's 1,342 modules). Inverted: withholding the flag fails
wide-arithmetic (2 refused) and custom descriptors (15).

**What its first run found** — four defects that emitted INVALID modules, every other gate green
(the 2026-09-28 scratch harness had run our ROUND TRIP only, never an optimized variant): a value
under a `br_on_*` spilled at every -O level (Q10), and inlined past at -O3 (Q11), a multi-result
call operand inlined at -O3 (Q12), and `--flatten`'s inexact temporaries for exact allocations
(Q13, open-work 9) — [divergences.md](divergences.md). Q10–Q12 are not descriptor-specific
(`br_on_passthrough.test.ts` uses plain `br_on_cast`); the core suite has no such case. Pinned: 14
`--flatten` refusals of `br_on_*`, as the core suite's.

**custom-page-sizes behaviour — on V8, LOWERED.** V8 15.0 has no support and no flag. Two routes
were measured (wasmtime 49 runs the `.wast` as written; or lower to 64 KiB pages) and 🗓️ **the
owner chose lowering, 2026-09-29: "we want V8 to be able to run it. That is the whole point of
wasmtk, in that it runs everywhere."** So it is a FEATURE, not a test aid:
`LowerCustomPageSizes` (`wasm-opt --lower-custom-page-sizes`,
`src/passes/lower-custom-page-sizes.ts`; its design is in the module doc).

`scripts/check-lowered-page-sizes.ts` (run by `deno task proposals`): the original cannot run on
V8, so the oracle is the spec's expected values, in SEVEN worlds — lowered as read, round trip,
-O1 … -Oz — each optimized BEFORE lowering, so our optimizer is judged on real custom-page
memories and the lowering on everything. 🔧 An earlier note here said lowering "would test the
lowering more than the module we emit"; running the optimized variants first is the answer to it.
Every `module` must instantiate (the linking ones included), all **31** assertions (27
`assert_return`, 4 `assert_trap` — every one in the suite) hold in every world, and the 2
`assert_unlinkable` must fail to link. 4 `module definition`s exceed V8's OWN memory64 cap (262,144
pages — the default-page-size one at `memory_max_i64.wast:18` too, which lowering does not touch);
for those our validator judges the lowered bytes instead.

✅ **P1 — closed by the owner's decision (2026-09-29): no pins.** Under its own name a lowered
memory linked to a NATIVE 64 KiB importer (`custom-page-sizes-invalid.wast:104`), which could then
read and write past the logical size without a trap — not unsafe to the engine (it still
bounds-checks the underlying memory), but the proposal's guarantees lost. A lowered memory is now
exported and imported as `<name>#pagesize=<ps>`, so that link fails as the proposal says, and both
`assert_unlinkable`s hold in every world. The ratchet (`LINKS_ANYWAY`, now empty) is what demanded
the pin go. Working through the question also found L2 — `grow` exposed unzeroed slack a host
could have written — [divergences.md](divergences.md) P1, L2.

Unit tests: `lower_custom_page_sizes.test.ts`, V8 with no flag — sizes, growth across a 64 KiB
boundary and to the declared max, traps at the TRUE size, operand order before a trap,
`memory.copy` / `fill`, a 64-bit memory, active segments, `#pages` linking, the shared refusal. 8
mutants, 8 killed.

