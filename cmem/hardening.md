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

**The fuel question — answered by a HANG CHECK (owner, 2026-10-09).** The default fuel is
1,000,000,000 instructions; at ~760k instructions/s (a counted loop) or 63k–117k fuel/s (a bare
`(loop (br 0))`), an infinite loop under `wasm-interp` ran 22 minutes to 4 hours before fuel
stopped it. In general no interpreter can know a loop is infinite (the halting problem); a change
in values proves nothing (a counter changes every pass and may never exit). What CAN be proven: a
loop that comes back to its top with the same locals and operand stack, having run nothing that
could change anything else, repeats forever. The owner chose that, "after say 20s minimum
intervals ... the best of fuel and trust but verify": fuel stays the deterministic bound; the check
(`InterpreterOptions.hangCheck`, default 2,000 ms — see below; `wasm-interp --hang-check=SECONDS`,
`--no-hang-check`) samples one loop per interval and stops only on the proof — a `Stop` with the
new reason `hang`. Sound by construction (`HANG_SAFE` lists the instructions that cannot change
state outside the frame; anything else spoils the sample). Measured: 0–5% (noise) while no check is
due; a spin is caught on its second pass once one is; the clock is read every 65,536 instructions,
so a slow branch spin is noticed up to ~1 s late. Tests: `tests/binaryen-ts/interp/hang_check.test.ts`.

**The interval, set from a measurement (owner, 2026-10-09: "I agree" — 20 s → 2 s).** Every call
timed with the check off (scratch `runtime/`):

| workload | calls | mean | median | p99 | p99.9 | max | over 2 s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| the spec testsuite (six corpora) | 58,371 | 0.30 ms | 0.002 ms | 0.13 ms | 7.5 ms | 1.36 s | 0 |
| wasmtk's producer programs (`tests/wasi/wasm_wasi`, every export, stand-in imports) | 588 | 7.0 ms | 0.09 ms | 92 ms | 446 ms | 0.45 s | 0 |

Two more calls ran to fuel (100M instructions, 11–17 s): the Zig `1_fib` programs' `_start` under
stand-in imports — a loop through a host call (likely a read or write retried against a host that
answers zero), which the check cannot prove by design; fuel stops it. **The interval is set from
the TAIL, not the mean:** it decides the check's cost (an interval shorter than a run samples during
ordinary work — at 0 a loop calling a function ran 16× slower) and how soon a stuck loop is
reported, never WHETHER a loop is judged stuck. 2 s sits just above the slowest real run, so no
ordinary run is ever sampled, and a stuck spin is reported in 2–3 s instead of 20.

**Noted, not fixed:** a bare `(loop (br 0))` runs ~10× slower per instruction than a counted loop —
every branch is a thrown JavaScript exception. A speed item for the interpreter, not hardening.

## Code lens, pass 1 — 2026-10-09 (owner: "proceed with the code lens")

**The question** ([open-work.md](open-work.md) § "Quality passes"): is it WRONG on VALID input? The
method that paid in 1.5.5 — find a check whose predicate is weaker than its name — pointed at our
own instrument: the hostile fuzz classes an outcome as typed or untyped, so a stage that REFUSES a
valid input with a typed error passes it. The same mutants were asked the code question instead:

- **valid-mutants** (scratch `code13/valid-mutants.ts`): every input BOTH our validator
  (all features) and V8 call valid must pass `readForPasses`, `compat.readBinary`, `-O2` and `-Oz`
  (output valid to ours AND V8), and the interpreter without an `invalid` stop; every input where
  the two validators DISAGREE is listed with V8's message; and `result` must agree with `errors`.
- **behaviour-mutants**: for valid inputs with function-only imports, every export the
  interpreter completes (zero arguments, stand-in imports answering zeros) is run in V8 and
  compared; then the `-O2` / `-Oz` outputs in V8 against the original in V8. Positive control: a
  planted off-by-one in the comparison was reported.
- **originals**: our verdict against V8's on every original spec + proposal module (6,735) — the
  guard that a new refusal refuses nothing valid; the same list before and after every fix.

**Found and fixed** (branch `code-lens-13`, four commits, gate green on each):

| # | defect | how it showed | commit |
| --- | --- | --- | --- |
| C1 | `wasmValidate`'s `result` was `Ok` with an error in `errors` (a block type naming a non-function type reported without failing); `wasm-validate` printed the error, "OK", exit 0 | V8 disagreed on a producer mutant | `4657c32ed` |
| C2 | optimizer: values a polymorphic point DISCARDS stood as bare statements; `Inlining` wrapped the code after them in a block → invalid | producer mutant, `-O2` output invalid to both | `4657c32ed` |
| C3 | optimizer: a consumer the reader gave a discarded value as an OPERAND (`(i64.add (i32.shl …) (… (unreachable)))`) looked live; `OptimizeInstructions` made it reachable and invalid | producer mutant | `4657c32ed` |
| C4 | the phantom collapse ended a sequence with a node only TYPED unreachable (`select` over unreachable operands pushes when written) → a void function ended with a value. ON MAIN BEFORE | spec `unreached-valid` mutant | `5a306c769` |
| C5 | reader: heap type `0x7f` kept as an unchecked name; a multi-byte negative heap type decoded as `(-v) & 0x7f` (padded `func` misread, -112 read as `func`) | spec mutants, V8 "Unknown heap type" | `5a306c769` |
| C6 | reader: an unknown SIMD sub-opcode fell to the binary default and was accepted | spec mutant | `5a306c769` |
| C7 | `wasm-interp` defaulted v128 to `ref.null` → `invalid` stops on valid modules (relaxed SIMD, run whole) | interpreter `invalid` on spec originals | `5a306c769` |
| C8 | data / element segment flags read bit by bit, undefined bits ignored | spec mutants, V8 "illegal flag value" | `6f56c26fb` |
| C9 | `br_on_cast` flags past 3 accepted | spec mutant | `6f56c26fb` |
| C10 | `br_on_null` / `br_on_non_null` operand dropped unchecked (an i32 validated) | spec mutant | `6f56c26fb` |
| C11 | `br_on_cast(_fail)` operand dropped unchecked (not checked against its source type) | spec mutant | `6f56c26fb` |
| C12 | `ref.null` of a type index past the section accepted (code and const exprs) | spec mutants | `6f56c26fb` |
| C13 | `wasm-interp` defaulted a NON-NULLABLE reference to `ref.null` (results no valid run has; V8 refuses the call) | behaviour run, V8 TypeError | `6f56c26fb` |
| C14 | a SIMD / atomic sub-opcode ≥ 0x10000 aliased a real one (`(prefix << 16) \| op`); the validator THREW | a second spec sample crashed the harness | `834e88b20` |
| C15 | a count read from the input drove a READING loop past the end, every read failing silently: 10–14 s per validation for a one-byte change (local-group count 0x80 → ~2.8M groups in a 5-byte body), HOURS for 2^32-1; nine such loops (locals, params, results, fields, elem entries / exprs, `br_table` targets, `try_table` catches, `select` types, supertypes) | the all-corpus throw-check ran an hour without finishing; rerun with a progress file showed the slow inputs | `3a8c7277e` |
| C16 | a typed `select` (`0x1c`) with NO types read as the bare one: validated, and written back as `0x1b` | 8-oracle panel: only ours and upstream wabt accepted | `ecd54abef` |
| C17 | an IMPORTED global's / table's value type was never range-checked (`(mut (ref 0))` with no types) | 8-oracle panel: only ours and upstream wabt accepted | `ecd54abef` |

C15 is a hardening-lens defect (unbounded work from tiny input), found by the code lens's own
instrument; C16 and C17 make us stricter than upstream wabt on purpose — [divergences.md](divergences.md)
V1, V2.

**The oracle panel** (owner, 2026-10-09: "continue to refuse … if it will not run on all
platforms"). A disputed input is asked of every validator and engine on this machine — ours,
upstream wabt 1.0.41, wasm-tools 1.261, wasmtime 49 (`compile -W gc=y,function-references=y,
exceptions=y,memory64=y,multi-memory=y,tail-call=y,relaxed-simd=y,wide-arithmetic=y,
custom-page-sizes=y`; `-W all-proposals=y` turns on stack switching, which this build cannot
compile), wasmer 7.5 (`validate`, no `--enable-all`: that finds no backend), WasmEdge 0.18,
Node 24 (V8), Bun 1.4 (JavaScriptCore). A tool's column counts only once it accepts every VALID
original (two were wrong until their flags were fixed). **Rule: a module any of them refuses for
a reason other than a feature it lacks or an implementation limit, we refuse too.** Scratch
`code13/oracles.ts`.

**What was measured to bound the fixes:** wasmtk's 406 producer modules at `-O2` / `-Oz`: 812
outputs byte-identical before and after (on `5a306c769`). The originals list against V8 unchanged
by every fix (no module V8 accepts is refused). Producer corpus, all 406, 14,622 inputs (2,822
valid): nothing found after C1–C3. Behaviour: producer corpus with mutants, 4,082 export calls and
5,404 optimized runs agree with V8 (the one difference was V8's `RangeError` for stack exhaustion
against our `trap`, the same verdict).

**Not defects (classified):** V8 does not enable custom descriptors, custom page sizes, wide
arithmetic or exact types here; V8's implementation limits (2^48-page memories, 2^32-element
tables); V8 lagging the spec on `br_on_cast` typing of some spec originals (the spec gate's
must-accept axis passes them against the manifest); an instantiation trap is the right answer for
a segment out of bounds.

**Decided — the `br_on_cast_fail` typing question** (was open). A custom-descriptors mutant
(`br_on_cast_fail.3`, byte 16 → 0: the parameter becomes `(ref $t)`) that V8 accepts and we
refuse ("type mismatch in end"), on `main` before too. By the GC spec `br_on_cast_fail $l rt1 rt2`
falls through with `rt2` = `(ref null $t)`, which the block's `(ref $t)` cannot take; V8 and
wasmer refine the fall-through by the operand's non-nullness. The panel: wabt, wasm-tools (which
tracks the proposals), wasmtime, WasmEdge and JavaScriptCore refuse it. Under the owner's rule it
stays refused — [divergences.md](divergences.md) V4. Likewise the element segment typed `0x7f`
(V3: only V8 and wasmer load it).

**Convergence — at 2026-10-09: NOT yet shown.** After C14 the four spec quarters, the proposals,
the producer corpus and the behaviour run had nothing left but classified V8 gaps and V3 / V4; C15
was found by the throw-check after that, and C16 / C17 by the panel. No full re-run had been made
on `ecd54abef`.

**✅ Convergence SHOWN 2026-10-15 — pass 1 CLOSED.** The branch merged onto 1.12.1 (`435a1cac7`,
full gate green on it; the merge decisions are in its message), and the re-run was made on THAT
tree, so it also covers what the merge changed. The instruments are the 2026-10-09 scripts ported
to `node:` builtins with their logic unchanged, run on Node 24 (the V8 referee); **positive
control:** pointed at the branch's base `7f5d08904`, valid-mutants re-found C1 on the producer
sample (`RESULT-DISAGREES-WITH-ERRORS`, V8 "block type index N is not a signature").

| run | inputs | result |
| --- | --- | --- |
| valid-mutants, spec, 4 quarters (stride 4, offsets 0–3) | 209,168 | only classified rows |
| valid-mutants, proposals (811 modules) | 28,926 | the same 13 kinds, the same counts as 2026-10-09 |
| valid-mutants, producer corpus (all 415; 406 on 2026-10-09) | 14,968 (2,928 valid) | NOTHING FOUND |
| behaviour-mutants, spec (stride 4) | 34,532; 8,355 export calls, 2,826 optimized runs | NOTHING FOUND |
| behaviour-mutants, producer corpus | 9,988; 4,048 export calls, 5,548 optimized runs | NOTHING FOUND |
| throw-check: core, legacy, proposals, producer | 253,696 | nothing thrown, nothing over 1 s (slowest 24 ms) |

"Classified rows", every one already on the 2026-10-09 list: V8's implementation limits (memory
and table sizes); V8 lagging the spec on `br_on_cast` / `br_on_cast_fail` typing of the spec
originals `br_on_cast.4/.6/.7`, `br_on_cast_fail.4/.6/.7` (and mutants of them that keep the
shape); V3 (the element type `0x7f`); V4 (`br_on_cast_fail.3` @16); proposals V8 does not enable.
No REFUSED, OPT-INVALID, INTERP-INVALID or result / errors disagreement anywhere; no new kind, so
nothing went to the panel. The 2026-10-09 behaviour rows (`type-equivalence`, `local_init`: our
values against V8's `TypeError`) are gone — C13 makes those exports stop — and the producer
`RangeError`-against-`trap` row did not recur.

**Next (round 13 goes on):** a hardening re-run (`bun run hostile`, which should now also report a
SLOW validation) until a pass finds nothing, then the code lens again.

**Found in my own gate runner (scratch, not the repo):** the `interp` step's legacy corpus was
passed `translate-eh`'s flat output instead of a `spec:prepare`d corpus, so it ran **0** assertions
in every gate of 2026-10-09 and read as green. The legacy corpus is 70 / 0 / 0 on the tree after
every merge of that day (run once found). The runner now prepares it as
[working-rules.md](working-rules.md) § "The gate" says, and fails any interp corpus that ran nothing.

## 2026-10-12 — open-work 27: a constant expression with no value (closed)

**Found** by `hostile` while Bun migration B4 compared old and new scripts (it reported the same
thing under Deno, Node and Bun, so it was on `main` before the migration). Over the prepared core
corpus, stride 7 (847 modules, 29,054 mutants), the interpreter's row read `ok 3190 typed 656
UNTYPED 3`: `elem.85.wasm` with byte 13 set to 0, three times, `TypeError: Cannot read
properties of undefined (reading 'type')` in `address()`.

**The mutant was a red herring.** The ORIGINAL module fails the same way. `elem.85.wasm` is the
spec suite's `assert_invalid` "constant expression required": a table and an element segment whose
offset is `nop; end`. The validating reader refuses it; `hostile` (by design) runs the interpreter
on the NON-validating read. Byte 13 is the table's minimum, which the defect does not care about.
The mutant only happened to be where `hostile` looked. Rule kept: **reproduce on the unmutated
input before reasoning about the mutation.**

**Cause:** `Interpreter.evaluate()`, which every constant expression goes through (global inits,
table inits, element items and offsets, data offsets), returned `stack.splice(length - results)`
and never checked that the expression had produced anything. With no value it returned `[]`, the
caller destructured `undefined`, and an offset reached `address()` → `undefined.type`. A global
with an empty initializer took the other path: stored as `undefined`, a crash deferred to the read.

**Fix:** `evaluate()` throws `invalid('a constant expression left N values, M expected')` when
fewer than `results` values remain, after restoring the stack. That is `Stop(invalid)`, the
`StopReason` pass 1 introduced for exactly this. One check covers all five call sites.

**Tests** (`tests/binaryen-ts/interp/interpreter.test.ts`, describe "… (open-work 27)"): the
testsuite's 21 bytes, the byte-13 mutant, an empty global initializer, and a valid control that must
still instantiate. All three defect cases FAILED before the fix (two `TypeError`s; the global
silently instantiated). **Measured after** (same corpus, same stride): the interp row went from
`ok 3190 typed 656 UNTYPED 3` to `ok 3187 typed 662 UNTYPED 0`, the same 3,849 modules. "TOTAL —
nothing escaped untyped, nothing ran away", exit 0. The other 3 that moved, from ok to typed, were
the deferred case: modules that instantiated with a missing value and only LOOKED fine. The interp
gate is unchanged.

## Code lens, pass 2 — 2026-10-28 (owner: "look for code issues")

**The question**, as pass 1: is it WRONG on valid input, plus the workspace trigger's checklist
(workarounds, grep-verified dead code, silent fall-throughs, comments that lie), over tested and
untested paths. Read-only investigators per area (validator and reader, CLI tools, dead code,
silent paths); every claim then reproduced here before it was fixed or recorded.

**The instruments**, pass 1's scripts ported from Deno to `node:` / Bun with their logic unchanged
(scratch `code2/`), over the prepared core corpus (5,924 modules, every 7th = 847):

| run | inputs | result on `406d98277` (2.2.2 + record) |
| --- | --- | --- |
| valid-mutants | 29,901 (2,872 valid) | one kind: `br_on_cast.4` (original and 2 mutants), V8 lagging the spec — classified in pass 1 |
| behaviour-mutants | 19,737; 4,830 export calls, 1,578 optimized runs | NOTHING FOUND |

**Positive control:** the same two scripts on v1.12.1's source (before pass 1's fixes):
valid-mutants found 13 kinds (C1 `RESULT-DISAGREES-WITH-ERRORS`, C5, C8, C9, C11, C12, C16 …, and
the C7 `INTERP-INVALID` rows); behaviour-mutants found C13 (`type-equivalence.12`, ours values,
V8 `TypeError`). So the instruments still see what they saw, and today's tree gives them nothing.
**What the mutants did not reach, the reading did** — every defect below was found by reading and
then reproduced, none by the instruments.

**Found and fixed** (branch `fix/code-lens-2`, one commit each, a test red on the old code):

| # | defect | commit |
| --- | --- | --- |
| CL1 | `struct.new_desc` in a constant expression: the descriptor operand was never checked for constness (`isConstExpr` looked at the fields only) | `ac0efc668` |
| CL2 | `wasm-strip`, `wasm2wat`, `wasm-objdump` SKIPPED an option they did not know; `wasm-strip in.wasm --output=out.wasm` (upstream's spelling) stripped `in.wasm` IN PLACE and never wrote `out.wasm`. Now unknown options exit 1, `--output=FILE` (and strip's `--section=`) work, `-o` / `-s` with no value is refused | `0c8595baf` |
| CL3 | SIMD lane, load-lane, store-lane and shuffle mismatches named no instruction (or the wrong one); now upstream's words | `3989cf65b` |
| CL4 | the writer encoded a memarg alignment exponent ≥ 64 (the flags field cannot hold it) — now refused loudly | `36bef4488` |
| CL5 | `wasm-interp` printed `-0.0` as `0` and every NaN alike; now `-0` and `nan:0x<payload>`, signed | `1619bbfb0` |
| — | comments that no longer described the code (eleven files) | `76faf9d8b` |
| — | dead code removed, each symbol grep-verified, none on the published surface; the reader's section `default` (a silent skip, unreachable today) now REPORTS | `cc8a0ca1e` |

**Found and recorded, not fixed** (open-work 50; the CLI ones are divergences CL6–CL13):

- `branch-hints.ts:93` — a branch hint is checked only by the byte at its offset, so an offset
  inside an immediate whose value is 4 or 13 passes as `if` / `br_if` (`(func i32.const 4 drop)`,
  hint at 2: OK). wasm-tools accepts both; our own rule, failing on some inputs.
- `validator.ts:902` `tagTypeIndex` — a library-built tag with no `typeVar` falls back to the first
  matching type, else type 0, and is checked against THAT. Functions with no `typeVar` are refused
  instead. Not reachable from the CLI (text fills `typeVar`, binary always has it).
- The CLI differences from upstream: divergences CL6–CL13.
- The 2^63 alignment: upstream wabt writes it as `align=1`; we print it imprecisely (the test
  pins the exponent byte instead).

**Ruled out** (classified): `i64.add128` refused with wide arithmetic off (upstream is the lax
one); binary diagnostic offsets (DG7's residue); label names (N2, N8); inline exports and folding
(S7); `--disable-mutable-globals` refusing an exported mutable global (wasm-tools agrees; only the
message lacks a location — open-work 50).

## Code lens, pass 3 — 2026-10-28 (owner: "look for code issues", again)

**Scope:** what pass 2 had not read — the optimizer passes, the interpreter and the tools on it,
the text parser and writer, the IR helpers and both compat facades and `./api`. Four read-only
investigators, one per area, each told to REPRODUCE every finding against an oracle (V8 through
`scripts/v8.ts`; upstream wabt 1.0.41, binaryen 133 `wasm-opt`, wasm-tools; the real binaryen.js
132 from `comparison/node_modules`); every finding then re-reproduced here before it was fixed.
Today's own new code (the Deno pin, the comparison port, CI) was reviewed separately: clean.

**Fixed** (branch `fix/code-lens-3`, one commit each, a test red on the old code, green on Node
and Bun):

The labels are P3.n — not L*n*, which the divergence register already uses (L1–L4).

| # | defect | how it showed | commit |
| --- | --- | --- | --- |
| P3.1 | an integer-spelled `f32.const` rounded twice (`Number(n)` to f64, then f32): `18014399583223809` → 0x1p+54, not 0x1.000002p+54; just below FLT_MAX's midpoint refused | upstream wabt and wasm-tools bytes; then 2,000 literals against an independent single rounding (divergence F4: both oracles truncate some HEX integers) | `72980b421` |
| P3.2 | `memory.copy`'s count typed at the destination's address type — a valid copy between 64- and 32-bit memories refused everywhere | upstream accepts, V8 runs | `c23454efa` |
| P3.3 | compat `align` 0 (binaryen.js's natural alignment) could not be written | the real binaryen.js; now byte-identical on twelve forms | `43b697eb9` |
| P3.4 | **Inlining copied a callee's `return_call` / `_indirect` / `_ref` as it was — it returned from the CALLER**: `(i32.add (call $tailer x) (global.get $g))` lost the add at -O2 / -Oz / --inlining (-O3 for two forms); a void tail call into a caller with results was an invalid module. Now an ordinary call leaving the wrapper; a callee with a tail call under a `try` is not inlined at a plain call site (that conversion would let the try catch) — a mutant without the guard returned 78 for −1 | V8 | `863665701` |
| P3.5 | **SimplifyLocals sank a local write past a CALL inside a `try`**: the catch saw the old value (`f(1)` 0 for 1) at --simplify-locals, -O2, -O3, -Oz, try_table and legacy try. Inside a try a call now ends every pending sink | V8 | `99ee4a71f` |
| P3.6 | Inlining left a branch to the callee's FUNCTION FRAME (`br_if 0`) naming a label the caller lacks: -O2 and up refused a valid module ("cfg: branch to "$l0_frame"…"); the fuzzer met it 3 times in ~390 | upstream optimizes it; V8 equal | `233cf6fce` |
| P3.7 | `wasm-ctor-eval`: a cut constructor set `ref.null` into a non-nullable local (invalid); repacked data segments renumbered under a `data.drop` (invalid); an empty constructor kept its export | upstream wabt's validator; upstream ctor-eval 133 | `44abe120a` |
| P3.8 | `wasm-interp --argument` read by `Number()` / `BigInt()` (NaN for `inf`, `0x1p3`, `nan:0x1`, unreadable text; double-rounded f32; `4294967296` → 0) and `--fuel=abc` = unlimited, all exit 0 | upstream wasm-interp; now the WAT literal parsers, range checks, the typed form (CL15) | `27d09fb07` |
| P3.9 | `./api` `if` / `block` declared no result: a value-producing one wrote an invalid module silently; the module's doc example threw | wasm-tools | `91710d52b` |
| P3.10 | an unknown local name got "cannot be resolved at IR level — wabt-ts's IR…", not upstream's `undefined local variable` | upstream wabt | `13fc3549a` |
| P3.11 | wabt compat `toText({ foldExprs })` ignored (now honoured both ways: `false` linear, an explicit `true` FORCES folding where it printed the as-written mix); false comments in both facades, the writer and gc-types | — | `1add56c72` |
| P3.12 | a table's LINEAR initializer (`(table 1 funcref ref.null func)`, as `wasm-tools print` writes it) refused: the parser read one parenthesised instruction, not an `expr` (owner: "fix the two text-format gaps"; CL22) | wasm-tools bytes, custom sections stripped; our round trip | `0fcbba54f` |
| P3.13 | an EMPTY `(rec)` group dropped by the parser and the binary reader (CL23): kept in the fidelity table as the type index it preceded, written back in place by both writers; optimization still drops it | wasm-tools bytes; a wasm-tools binary round-trips unchanged | `2c1fc41b4` |

(`4cf3dfd64` made P3.1's test type-check: the commit after it is the gate's subject.) **Measured
around P3.4–P3.6:** the six benchmark modules' -Oz output is byte-identical from the commit before
P3.4 (`43b697eb9`) to the branch tip, and across P3.5 and P3.6 singly — none of the six uses tail
calls, exceptions or frame branches in an inlined callee. P3.12 and P3.13 leave the 421-file byte
baseline identical.

**Recorded, not fixed** — open-work 52 and divergences CL16–CL19, CL21, CL24: the binaryen.js
facade's public numeric values (mirroring them is already decided; the release level is open)
and defaults; the wabt.js facade's missing `validate()` and its ignored `parseWat` features;
`wasm-opt` judging its output with the host engine; three passes that swallow every exception;
LowerBlockParams' refusal of a catch to a parametrised loop; `parseS32Literal`'s wrap. CL16 (the
facade's defaults) is DESIGN, three owner rulings, not open. **The compat records were reviewed
against the earlier decisions the same day** (owner: "please review these decisions and report
any that still conflict"): none reverses a ruling; CL16's citation, CL17's missing citation (and
the stale decision line in binaryen-ts.md), a stale range in open-work 52 and these labels'
collision with L1–L4 were corrected, and CL24 added.

**Checked clean** (the investigators' lists, in their reports): the interpreter core against V8
bit for bit — memory and table bounds at 2^32 / 2^64, integer edge cases, float conversions and
rounding, 55 SIMD edge cases, exceptions, GC, tail calls a million deep; OptimizeInstructions'
peepholes, and RemoveUnusedBrs, CodeFolding, Vacuum, DCE, LocalCSE, CoalesceLocals, MergeLocals,
SSANoMerge, PrecomputePropagate, Flatten on multi-value, branches, EH, GC, tail calls (~390
wasm-smith modules); the text format's literals, escapes, names, annotations, abbreviations and
~85 smith modules round-tripped; `generateNames` / `applyNames` across all six index spaces.
**Process slips, owned:** a merge message given with `-m` and one mutant made with `sed -i` —
both against the owner's file rule; one commit (`72980b421`) passed lint but failed `bun run
check`, fixed by the next. Since then every commit ran lint, check and fmt first.
