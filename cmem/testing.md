# Testing

## Running

```bash
deno task check     # type-check (use Deno for both Deno and Bun targets)
deno task test      # deno test — the full suite
deno lint           # lint
deno fmt --check    # format check
deno task publish:dry   # slow-types check -- CI runs it, `deno task test` does NOT
```

**`publish:dry` belongs in the gate whenever a change ADDS or MOVES an exported symbol.** It is the
only step that runs JSR's slow-types check: moving `STRICT_NAME_DECODER` into `src/core/literal.ts`
made it public API without an explicit type, and 339 passing tests plus three full metric runs never
saw it (T12.7 → caught during T13.3).

### Revert experiments: copy the file aside, do NOT `git stash`

Measuring sensitivity means reverting a fix and re-running. On this checkout, **do that with a
byte-level copy aside and back** — `git stash push` and `git checkout --` both re-run the EOL
filter, and with `core.autocrlf=true` a round trip rewrote `binaryen-bridge.ts` from LF to CRLF.
`git diff --stat` went from a surgical 47/10 to **1649 insertions / 1612 deletions**: three real
edits buried in a whole-file diff.

It was caught by reading the diffstat after the experiment instead of trusting the restore, which
is the habit worth keeping — **`git diff --stat` after any revert experiment**, one line, and the
number tells you immediately. Same root cause as the `deno fmt` false alarm below, seen from the
other side.

### `deno fmt --check` — what it covers, and its standing false alarm

**Scope:** `deno.json`'s `fmt.include` is `["src/", "tests/", "scripts/"]` (markdown under
`scripts/` excluded). A test file IS checked, so real drift there fails CI. **`cmem/` is not in scope at all** — every file in it reports
"drift" if you format it by hand, including ones nobody has touched, because these are hand-wrapped
prose. Do not reformat `cmem/` to chase that.

**The false alarm:** on this checkout `deno fmt --check` reports ~104 of 146 files failing with
*"Text differed by line endings."* That is git's autocrlf, not drift, and it has been true for a
long time — so the command's exit status carries no information here and cannot simply be read as
pass/fail.

**How to actually check a file you touched** — normalise the line endings AND pass the project's
options, because `--ext ts` on stdin does **not** read `deno.json`:

```bash
diff <(tr -d '\r' < FILE) \
     <(deno fmt --ext ts --line-width 100 --indent-width 2 --single-quote - < FILE | tr -d '\r')
```

**CORRECTED 2026-08-25 (T13.42).** This command previously read `deno fmt --ext ts - < FILE`, taking
deno's DEFAULTS (lineWidth 80, double quotes) instead of the project's `lineWidth: 100,
singleQuote: true`. It therefore reported every line of 81–100 characters as drift — noise, which is
why its output stopped being read — while missing a real 101-character line. **Two files would have
failed CI**, hidden behind a false alarm that was itself documented and worked around.

The obvious alternative, `deno fmt --check FILE`, gets the width right (it does read `deno.json`)
but reinstates the line-ending false alarm, which is the thing this command exists to dodge. Use the
form above, and **when you write a command to see past a known false alarm, break something on
purpose and confirm it still fires** — a check that can only say "clean" is indistinguishable from
one that is blind.

This matters: during T13.13 that diff caught one genuine stray blank line in
`tests/parser/named_refs.test.ts`, which WOULD have failed CI, sitting inside 104 files of noise
that would not.

Tests use `@std/testing/bdd` (`jsr:@std/testing`) so the same files run under `deno test` and
`bun test`. Import via the `@std/testing` entry in `deno.json`'s import map.

Test tree mirrors `src/`: `tests/core/`, `tests/ir/`, `tests/reader/`, `tests/writer/`,
`tests/parser/`, `tests/validator/`, `tests/bridge/`, `tests/tools/`, `tests/api/`, `tests/audit/`,
`tests/scripts/` (the release preflight — `scripts/publish.ts` cannot be imported by a test)
(the silent-corruption audit regressions), plus `tests/fixtures/` (`.wasm` / `.wat` vectors) and
`tests/wasmtk/` (real-world corpus, below). Full suite is **392 tests / 3109 steps** (plus 1
ignored by design — see `cli_io_errors.test.ts`) as of 2026-08-25. (It read "146 / 1044 as of
2026-06-09" until one update, then "381 / 2689" until the next — and that second one went stale
**the same day**, five tests later. A count in prose goes stale silently, so treat any number here
as the date it carries, not as current; `deno task test | tail -1` is the only current answer.)

## The wasmtk WAT corpus

`tests/wasmtk/` holds **272 real-world WAT files** emitted by wasmtk's wasic compiler. The runner at
`tests/wasmtk/runner.test.ts` walks the directory and asserts each compiles cleanly through
`wat2wasm` + `validate`, reporting failures by filename. **Adding a file = dropping it in the
directory** — the runner picks it up automatically.

- Only **standalone** modules belong — no pre-link files that reference unimported externals (the 6
  `$mathlib_*` files originally there were removed).
- This corpus has surfaced bugs the hand-crafted tests missed: bare-offset elem segments, legacy
  `(try (do …))` syntax, SIMD opcode-name table drift, and more.
- **`tests/wasmtk/roundtrip.test.ts`** runs the _reverse_ direction over the same corpus:
  `wat2wasm → wasm2wat → wat2wasm`, asserting the disassembly RE-COMPILES. This is the structural
  guard for the invalid-`wasm2wat`-output class (the round-5 missing-`$` bug). The plain runner only
  checks the forward direction; this closes the loop. All 272 round-trip clean as of 2026-06-09.

## `tests/wasmtk/` is a FROZEN SNAPSHOT — regenerate before reporting upstream

272 files here; wasmtk's live corpus emits **373**, and no source commit was recorded. Full detail
and the refresh procedure: `tests/wasmtk/PROVENANCE.md`.

**The snapshot has now cost THREE wrong reports to the wasmtk team, all caught by them rather than
by us** — the `KNOWN_INVALID` seven, the legacy-EH scope reported as 6 when it is 10, and the
retracted `needsExceptionTag` five. It also cost them two requests for a source + date stamp before
one was produced (T13.45; the answer was one `git log` in this repository).

**Rule, adopted from wasmtk's own `cmem/testing.md` after the first of those (2026-08-24):
regenerate from the wasmtk checkout before validating against another runtime or stating anything
about wasic.** The snapshot supports "our toolchain handles this shape". It does not support "wasic
emits X" or "wasic has bug Y" — we made exactly that claim about seven modules that had already been
fixed upstream.

## The wasmtk-driven hardening loop (this IS the design)

The convergence pattern is: **real module shape surfaces a wabt-ts bug → fix at root cause + add a
regression test.** This loop is the design, not a transitional phase. wasmtk's Phase 1 suite passes
38/38 against `@jrmarcum/wabt-ts@1.1.8` (2026-05-28 milestone), covering the multi-value receive
idiom (Bug D), `br_if` cond with non-first globals (Bug F), the Tier D bridge surface, and the full
272-file corpus runner. Future wasmtk phases will re-open the loop; expect it.

## What has NOT been enumerated yet

Kept current so a new audit does not restart on ground already swept. **Update this list at the end
of every audit pass** — it is the cheapest thing in the loop and the only record of where the
frontier is (T13.27). As of 2026-08-25 the
following have had a type- or axis-enumeration run against them and are recorded in `tasks.md`:
`resolveNames` (both axes), `applyNames`, `generateNames`, `expr-visitor`, the validator's operand
checks and memarg family, `instrInputCount`, the WAT writer's const-expr coupling, the bridge's
label frames and alignment, `binary-reader.ts`'s memarg / sections / block types / limits /
subtypes, `wasm-strip` (both its identity case and its actual job), and the RELEASE path
(`scripts/publish.ts`, T13.43).

### Hardening axes, and their state

Distinct from the enumeration frontier above. **Three states, not two** — collapsing
"unmeasured" into "clean" means nobody ever returns to it (T13.35):

| axis | state | note |
| --- | --- | --- |
| huge declared counts | **clean** | all 11 sections bail in 0 ms; found T13.33 on the way |
| deep nesting | **clean** | 100 000 blocks, 60 000 folded operands, full round trip |
| algorithmic complexity | **clean** | 5 shapes, growth ~2 per doubling |
| type-graph recursion | **clean** | found T13.34; chains and rec groups linear |
| size amplification | **clean** | no blowup, no `Infinity`/`NaN` in output; 6 `v8=reject` cases are ENGINE limits — **Wasmtime accepts all six** |
| string / name scaling | **clean** | 4 doubling series, growth 0.2–2.3 |
| **diagnostic WORDING** | **measured — found 2 defects (T13.37)** | the real oracle was in the repo all along: every `assert_malformed` command carries the error text the module should produce, and our metric read only the modules. **70 of 711 rejected with wording the spec does not recognise**; now 5. See the harness note below |
| **diagnostic OFFSET** | **UNMEASURED** | attempted in T13.35; the cheap oracle (offset near the corruption) flagged 32 cases and every one examined was CORRECT — reporting the start of a malformed multi-byte construct beats reporting where the decoder stopped. T13.37 measured the WORDS, not this |
| module-level mutable state | **clean** | zero `let`/`var` at module scope in all of `src/`; the two scratch `DataView`s are safe only because the parser has zero `await` — re-check if that changes |
| round-trip CONVERGENCE (text side) | **clean** | the byte-identical metric proves the BINARY fixed point only. 14 shapes + **272/272 corpus files settle at iteration 1** |
| gate vacuity | **clean** | one deliberate `ignore` (prints `ignored`), no `only:`, no empty data-driven table |
| diagnostic usefulness | **not attempted** | beyond offsets: is the message actionable? |

**Never enumerated: NOTHING — the list is empty as of 2026-08-25 (T13.32).**

Read that precisely. It does not mean the code is clean; it means **the cheap axes are spent**.
Every surface here has now had a type- or axis-enumeration run against it, and the last several
passes returned progressively less: T13.27 and T13.32 found no defects at all. The next audit should
either invent a NEW axis — the fuzz axis (T13.29) was the last one to pay, and it paid three times
across T13.29 / T13.30 / T13.31 — or accept a lower yield and say so. **Do not read an empty
frontier as "audited, done".**

**Struck 2026-08-25 (T13.31):** the CLI shims — the `if (import.meta.main)` blocks in
`src/tools/*.ts`. Their file I/O is now guarded and gated; `wasm-validate`'s
`--enable-<feature>` / `--disable-<feature>` / `--enable-all` parsing was read and is sound
(unknown options rejected, kebab-case mapping, `--enable-all` handled). **These were not on this
list at all until the pass that found the bug** — added and struck in the same session, which is
the argument for the standing instruction above: **the frontier record is only as good as the last
person to widen it**, and a missing row looks exactly like a swept one.

**Struck 2026-08-25 (T13.29):** `wasm-objdump`'s rendering — its `sectionMeta` was differentialled
against a byte-level walk of the binary on 5 module shapes (0 mismatches), and it is covered by the
malformed-input fuzz. `src/bridge/type-map.ts` — all 17 wabt→binaryen type mappings produce
byte-identical type sections against our own writer.

**Struck 2026-08-25 (T13.28):** `ir-util.ts`'s `getExprArity` — the correctness question is moot,
it has no production caller at all (one test exercises it; nothing in `src/` does). Kept only
because `ir-util.ts` is re-exported from `src/index.ts`. The perf invariant that cited it has been
corrected in [design-decisions.md](design-decisions.md).

## The conformance metrics — and what each one is BLIND to

Nine numbers. The first seven were exhausted 2026-08-24; the eighth and ninth were added 2026-08-25 (T13.37) and is the only one not at ceiling. **They live outside `deno task test`**; nothing in the
suite will catch a regression in them, so re-measure after any parser / reader / writer / validator
change. Harnesses live in the session scratchpad (~40–120 lines each, cheaper to rewrite than
maintain); `tasks.md` records what each measured and when.

| metric                    | value               | blind to                                                                                    |
| ------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| parse-clean               | 257 / 257           | a file that parses and then encodes to bytes V8 rejects                                     |
| V8-valid                  | **2119 / 2120**     | a decoder that REORDERS a module (T9.1 changed what a program computed) — and, until T13.2, an ENCODER that truncates one: two of these passed only because their limits were wrapped into range first |
| validator agreement       | **2119 / 2119**     | counts only false REJECTIONS — says nothing about what a permissive validator waves through. **Demonstrated, not theoretical:** T13.14 (2026-08-25) found TWELVE GC false accepts with this metric and all six others green and unmoved. The counter-measure is a hand-built INVALID corpus (~20 lines: bad modules → `wat2wasm`, which does not validate → `wasmValidate`, V8 as oracle, Wasmtime as authority) |
| `assert_invalid`          | **2683 / 2683**     | the converse. The denominator read 2737 until `assert_trap (module …)` stopped being classified as `assert_invalid` — **a metric measures the population its classifier hands it**. And for a whole campaign the last 19 read as "modules the engines accept" when 16 were the ENCODER repairing them first (T13.2) — **this metric cannot see the difference between a permissive validator and a rewritten module** |
| round-trip byte-identical | **2119 / 2119**     | a consistently-wrong opcode mapping — reader and writer agree, so the bytes match           |
| **execution**             | **23,077 / 23,077** | anything needing host imports, v128, NaN payloads, `ref.func` args (29,544 skipped)         |
| **`assert_malformed`**    | **1229 / 1229** quoted · **711 / 711** binary | the ACCEPTING direction (which the other six cover) — and **WHY we reject**, which is what the eighth metric below was added for: 70 of the 711 were rejected with wording the spec does not recognise, one of them a genuinely wrong diagnosis. It read 1227 at `parseWatModule` and 1229 through `wat2wasm` until T13.1 moved the label check into the parser — **where you put the probe changes the number** |
| **binary -> IR -> binary** | **30 / 88** | added 2026-08-25 (T13.41). The path `wasm-strip` uses, with NO text in between. **The text round trip is blind to it** — WAT cannot express an arbitrary custom section, so they are dropped before the writer is reached, which is how a tool that relocated every custom section it kept went unnoticed. All 58 differences settle at a fixed point on pass 2 |
| **round-trip FIDELITY** | **2119 / 2119** | input is our OWN encoder output, so a difference is our bug. Report this one. **Never sum it with the line below** — doing so read as 2124 / 2207 and hid T13.40 |
| round-trip of crafted bytes | 27 / 88 | input is a `(module binary …)` blob. A text round trip cannot preserve an encoding choice the text does not record (non-minimal LEBs, explicit vs abbreviated elem flags), so this is not a fidelity measure and 88 / 88 is not the goal |
| **diagnostic wording — reader** | **689 / 711 (97%)** | added 2026-08-25 (T13.37). Our first error vs the text each binary `assert_malformed` says the input should produce |
| **diagnostic wording — validator** | **2446 / 2683 (91%)** | added 2026-08-25 (T13.38), over `assert_invalid`. Healthy on arrival; 0 false accepts |
| **diagnostic wording — parser** | **816 / 1229 (66%)** | added 2026-08-25 (T13.38), over quoted `assert_malformed`. Was **559** — the parser reported a misspelled instruction by blaming a parenthesis |

The three diagnostic rows are blind to the error OFFSET, to every input the spec supplies no string
for, and to whether a message a developer would find useless is nonetheless the spec's own wording.
**They measure AGREEMENT, not quality, and the last stretch is bought by making messages worse:**
~200 of the parser's remaining misses are `(i32.const 0x)`, which the spec calls `unknown operator`
and we call `expected i32 constant` — ours is the better message. Treat those as a ceiling, not a
backlog.

**The whole point is the last column.** Every one of these was added because the existing set could
not see a real bug. `wat2wasm` does not validate, which is how the entire SIMD half of the validator
sat dead for four releases (T9.2) — four metrics and none of them ran the validator at all.

> ### The scratch harnesses had a five-times-too-small denominator until 2026-08-25
>
> They reassembled the pipeline as `resolveNames` + `writeBinaryIr` and **skipped
> `synthesizeTypes`**, so nearly every module emitted dangling type indices and was rejected
> for a fault the harness created (T13.39). Corrected readings on that instrument: agreement
> **2207 / 2207** (was reported 449 / 449), `assert_invalid` **2694 / 2694** (2673 / 2678),
> round-trip **2124 / 2207** (364 / 449), encode throws **0** (13).
>
> **Do not compare those against the campaign table above** — that is a different instrument
> with a different population (2207 vs 2120 modules).
>
> **CORRECTED (T13.40).** This box originally explained the 83 round-trip differences as
> "almost all deliberately non-minimal LEB encodings in `binary-leb128.wast`". That was
> asserted without checking and was wrong — the tally named `elem.wast:19`, which is not
> crafted bytes at all. **22 of them were our own encoder padding every section size to 5
> bytes.** See the round-trip rule below.
>
> **The rule: a harness must call the real entry point.** `wat2wasm` is parse → resolveNames →
> **synthesizeTypes** → writeBinaryIr; `corpus.ts` was the only harness that got this right,
> and the only one that called `wat2wasm` instead of rebuilding it. The defect hid because a
> broken harness SCORES BETTER on a metric that counts rejections.

**Diagnostic wording is the newest, and it was free.** The oracle had been sitting in the testsuite for the whole campaign — `assert_malformed` carries the expected error text, and we read only the modules. Counting rejections cannot distinguish rejecting for the right reason from rejecting for the wrong one; the string can. **Check whether a corpus you already own carries an answer key you are discarding.**

**Execution is the next newest and the reason is structural:** the first five all check bytes or
acceptance. A parser that mapped a token to the wrong opcode would be V8-valid, validator-clean and
byte-identical on round-trip (the reader maps the wrong byte back the same way) — and compute the
wrong answer. Only running it catches that.

**Print what a harness SKIPS.** The execution harness once reported a stable, plausible 2,084 /
2,240 while executing **only nullary functions** — a `WastArg` is `{kind:'value', value: Const}` and
it read `.type` off the wrapper. The real denominator was 26,837. A denominator is a measurement
too.

## The tests that need neither a corpus nor an oracle

The eight metrics above are all corpus-shaped, and a corpus-shaped number can only ever be as
complete as its corpus. **The 257-file snapshot contains no atomics at all**, so the whole threads
proposal was outside every one of them — which is where T13.8 (an arity table that made `wasm2wat`
emit wasm V8 rejects) and T13.9 (every atomic type-checked as `(v128,v128)→v128`) both lived.

Four shapes cover what a corpus cannot, and each found a real bug:

- **A differential between two spellings of the same thing.** Folded vs linear
  (`instr_arity.test.ts`) and `$name` vs numeric (`named_refs.test.ts`) must agree by construction,
  so disagreement is a bug — no oracle needed, and no corpus to be missing from.
- **Enumerate the population from the CODE, not from files.** `opcode_tables.test.ts` drives the
  lexer's own opcode table; `atomics.test.ts` walks every `PREFIX_THREADS` sub-opcode. Anything the
  code claims to support gets exercised whether or not a `.wast` file mentions it.
- **Test the option, not just the path.** `feature_gates.test.ts` asserts each proposal is refused
  with its flag off. Every harness passes `allFeatures()`, which is precisely the configuration in
  which a gate cannot be observed.
- **Enumerate the population out of the SOURCE and gate on it.** T13.18 turns the "every
  instruction belongs here" claim in `instr_arity.test.ts` into a test by reading the parser's own
  `isPlainInstr` labels and diffing them against `instrInputCount`'s. This is the cheapest form of
  the shape below — no fixtures, no oracle, and it converts a hand-maintained list (the thing that
  let `Quaternary` and T13.16 in) into one that polices itself. **Any comment asserting a list is
  complete is a candidate**: if the completeness claim is true, it is testable.
- **Enumerate the TYPE against the code that must be total over it** — no test file at all, just
  ~30 lines of `awk` over `ir.ts`'s interface declarations plus a regex over the switch bodies.
  This is what found the atomic `memidx` gap and T13.11, and it is the only one of the four that
  needs no fixtures. Re-run it after any change that adds an IR variant.

**Every one of these four has an AXIS, and the axis is a choice.** `named_refs.test.ts` originally
varied only WHERE the name appears, pinning every operand to a literal — so it covered
`table.get $t` and still missed T13.11, which lives in `table.get`'s operand rather than its
position. (It now carries both axes; that gap was closed in T13.13.) The type enumeration has the
same property: run on `Var` fields it came back clean across 64 interfaces while an `Expr`-field gap
was live. When adding a corpus-free test, **write down what it varies and what it holds fixed**; the
held-fixed dimension is the new blind spot — and it stays one until someone adds the other axis and
measures it.

**Before trusting "all eight green", ask which proposals the corpus does not contain** — that list
is the blind spot, and it is a real artifact you can produce by diffing the testsuite file names
against the proposals the code implements.

## When the three-engine panel is not available

The oracle rule assumes V8, Wasmer and Wasmtime can all be asked. **Legacy EH breaks that
assumption**: Wasmtime 47.0.3 and Wasmer both reject `try` outright with `legacy_exceptions feature
required`, and `wasmtime -W` exposes no switch for it (only `exceptions`, the standard `try_table`
proposal). V8 is the only engine that will rule on a legacy-EH module at all.

So for that family — and any other where the panel shrinks — **state the oracle you actually had in
the test header**, because a fixture asserting `v8Accepts(binary) === false` reads like a full
cross-check otherwise. And weight severity accordingly: a soundness hole in a family the primary
WASI host will not execute is worth fixing but is not the same proposition as one in a shipping
family (T13.17).

## Fixture convention — say it to an engine

**A test whose fixtures are meant to be valid wasm must assert an engine accepts them**, not merely
that `wat2wasm` returned bytes. `named_refs.test.ts` asserted only the latter for four releases, and
2 of its 64 fixtures were invalid modules the whole time (T13.13) — `array.new_elem` with an elem
segment that is not a subtype of the array element type, and `br_on_cast` targeting a zero-arity
block. Nothing reported it, and had the encoder started emitting garbage for those constructs
nothing would have reported that either.

The check is four lines (`WebAssembly.validate`, then `new WebAssembly.Module` for the message when
it fails); `assertV8Accepts` in `named_refs.test.ts` is the copyable shape. Use it wherever a suite
hand-writes WAT it believes is valid.

## Regression-test placement (where each invariant's test lives)

- `tests/tools/wat2wasm.test.ts` — natural-alignment-when-`align=` omitted.
- `tests/reader/binary-reader.test.ts` — function-import-alongside-defined-function (the Phase 7
  off-by-one in `readCodeSection`).
- `tests/parser/stmt_order.test.ts` — statement ordering (`pushStmt` flush;
  void-call-before-return).
- `tests/parser/empty_folded.test.ts` — Bug D (multi-value receive) + Bug F (br_if global
  resolution).
- `tests/parser/legacy_try.test.ts` — folded/linear/catch_all/delegate/multi-catch parse shape; V8
  compile + throw/catch/catch_all/rethrow runtime; round-trip non-duplication.
- `tests/writer/tag_type_index.test.ts` - T10.7: a tag's type is matched with `valueTypeEquals`, not
  `===`, so a typed-reference param does not make the encode throw; and the fail-loud message names
  the type instead of printing `[object Object]`.
- `tests/writer/nan_payload.test.ts` - T10.4: `nan:0x<n>` names the mantissa exactly, so a quiet NaN
  does not round-trip into a signalling one; plus `return_call_indirect` keeping its table index. 22
  cases.
- `tests/parser/linear_try_table.test.ts` - T10.6: the LINEAR `try_table` form keeps its catch
  clauses and its body (it was a stub that skipped both), and `array.new_fixed` takes its immediate
  element count instead of draining the operand stack. 8 cases.
- `tests/writer/table_init.test.ts` — T10.3: a table initializer is written as the single folded
  instruction the grammar requires, and an inexpressible one throws instead of being silently
  dropped. 6 cases including the nested `(ref.i31 (global.get $g))` form.
- `tests/validator/memarg_offset.test.ts` — T9.11: every memarg handler checks `offset` against the
  memory's index type, not just `onLoad` / `onStore`. 11 cases, each cross-checked against V8,
  including the `0xffffffff` boundary and a 64-bit memory.
- `tests/writer/operand_placeholder.test.ts` — T10.8: a synthesized operand slot-filler
  (`NopExpr.placeholder`) is not written out by either writer. 9 cases, including three T11
  no-repair guards — a starved `local.set`, an explicit `(nop)` operand and a starved `i32.add` must
  all stay invalid to V8 AND to our validator.
- `tests/parser/call_arity.test.ts` — T10.5: linear-form `call` drained the whole operand stack
  instead of popping the callee's arity, so a following instruction's operand slot got a Nop and the
  encoding grew a byte on every round trip. 8 cases; 5 fail on the pre-fix parser and 3 are guards
  (Bug D folded multi-value receive, local-name resolution across the deferred body parse, and a
  V8-executed check that the value is still the one named).
- `tests/writer/export_order.test.ts` — T10.1 / T10.2: the inline `(export "n")` abbreviation is
  illegal on an import and re-orders the export section, so the WAT writer tests before using it. 6
  cases; 5 fail on the pre-fix writer and the sixth guards that inlining still happens when it IS
  faithful (a fix that just disabled the abbreviation would pass the other five).
- `tests/bridge/tier_b.test.ts`, `tier_c.test.ts`, `tier_d.test.ts`, `gc_tier1..4.test.ts` — bridge
  coverage (GC tiers verify binary encoding, not V8 round-trip — typed-ref IR is loose).
- `tests/api/wabt_compat.test.ts` — 12 steps incl. the exact wasmtk call patterns from
  `src/utils.ts` and `src/wasmbundle.ts`.
- `tests/audit/silent_corruption_fixes.test.ts` — the 2026-06-09 audit round-1 Critical+High fixes
  (SIMD float lexer opcodes, tag-import type index, v128.store/load_splat decode, call_ref sigType,
  trunc_sat validation, multi-catch body, SIMD lane validation/arity, natural-align, apply-names
  local.get, Table.init).
- `tests/audit/silent_corruption_fixes_round2.test.ts` — the round-2 fixes (SIMD reader operand
  arity + lane ranges, `writeVar` fail-loud, resolveNames `simd_lane_op.value`/segment-var gaps,
  `parseLimits` memory64 index type, `try_table` unknown-catch-kind fail-loud).

When fixing a footgun/silently-wrong bug, add the regression alongside the invariant note in
[design-decisions.md](design-decisions.md). Fail-loud (throw) over silent-wrong output is the
project contract.

- `tests/parser/wide_arithmetic.test.ts` — the whole wide-arithmetic proposal end to end: all four
  operands reach the IR in BOTH forms, `wasm2wat` can read back what `wat2wasm` writes, the
  validator types all four correctly (Wasmtime-verified; V8 gates the proposal off and cannot
  arbitrate), and an exhaustive lexer-vs-reader sweep guards the CLASS. 15 cases.

- `tests/parser/label_scope.test.ts` — T13.1: out-of-scope branch targets, every legal
  spelling, and the two scopes that are NOT the enclosing block (a `try_table` catch target
  and a legacy `try` delegate).
- `tests/parser/custom_page_sizes.test.ts` — T13.4: the `(pagesize N)` syntax, the log2 wire
  encoding and its position, the malformed/invalid split, the page-size-scaled ceiling, the
  feature gate, and the flag bit being illegal on a table. **No conformance metric reaches
  this** — the proposal is not in the testsuite snapshot, which is why it sat half-built.
- `tests/ir/limits_bigint.test.ts` — T13.3: a 64-bit limit surviving at full width through
  parse, encode, decode and print; the bounds that still apply; and a maximum of zero.
- `tests/writer/no_repair.test.ts` — T13.2: limits that must not be truncated, the table
  bound following its index type, an out-of-range type index staying out of range, and an
  implicit type-use not borrowing from a multi-member rec group.
- `tests/parser/duplicate_ids_and_tokens.test.ts` — T12.9: duplicate ids across every index
  space, NaN payload range (with a V8 round trip proving the in-range ones stay NaNs), lane
  immediates, the token-boundary rule, one `(start …)` per module, and the deferred
  forward type-use check.
- `tests/validator/feature_gates.test.ts` — T13.10: every proposal valid WITH its feature and
  rejected WITHOUT it, the message required to name the feature, and the ratified set still
  validating with no flags. **No metric can see a gate** — every harness passes
  `allFeatures()`, so the suite is the only guard.
- `tests/validator/atomics.test.ts` — T13.9: all 67 atomic opcodes, each required to agree with
  V8 AND round-trip byte-identically, plus width pinning so a uniformly-wrong table cannot
  pass. **The spec-testsuite snapshot has no atomics at all**, so no metric covers any of it.
- `tests/parser/named_refs.test.ts` — T13.7 + T13.13: **two axes.** 64 cases put a `$name` in every
  POSITION the grammar allows (21 fail at v1.3.5); 69 more put a named reference in every OPERAND
  slot, with a decoy at index 0 so a silent fallback is a different program. Both tables assert
  encode + **V8-accepts** + byte-identical round trip. **No metric covers either class.**
  The V8 assertion was added in T13.13 after 2 of the original 64 fixtures turned out to encode to
  modules V8 rejects — the suite had only ever asked whether `wat2wasm` returned bytes.
- `tests/ir/table_get_index.test.ts` — T13.11: `resolveNames` must walk `table.get`'s index
  sub-expression, with `table.set` as the always-was-correct control. Covers a `global.get` and a
  `call` in the index, plus a behavioural case that reads a populated slot through `table.get`
  itself. **Nothing in the seven metrics reaches it** — `table.get` is absent from the wasmtk corpus
  and no spec module pairs it with a named operand. Inverting the fix flips 5 of its 7 steps.
- `tests/core/leb128.test.ts` (signed-range block) — T13.12: all four LEB encoders reject what they
  cannot represent, with the boundary values (±2^31, ±2^63) asserted to still round-trip so the
  check cannot become a blanket refusal. Unreachable from WAT; guards the `writeBinaryIr` entrypoint.
- `tests/core/opcode_tables.test.ts` — T13.6: lexer⇄printer opcode-name symmetry and
  natural-alignment coverage, over the whole opcode population, driven by the lexer's own
  behaviour. Three guarded exemptions: `select` (many-to-one) and the two `ref.*  null`
  disassembly labels.
- `tests/validator/subtype_depth_and_cycles.test.ts` — T13.34: subtyping depth ≤ 63 and an acyclic
  supertype graph, both matched against V8 and confirmed against Wasmtime. **The depth boundary is
  pinned on BOTH sides** (64 types legal, 65 not) because an off-by-one here rejects valid modules,
  and the over-correction guard is explicit: a rec group whose types REFERENCE each other is legal
  and must stay accepted — only the SUPERTYPE graph must be acyclic. Two timing steps pin the
  hardening properties (linear on a 2000-type chain; terminates on a cycle).
- `tests/reader/section_count_truncation.test.ts` — T13.33: a declared section count must match the
  entries present. Six mismatch shapes (including the rec-group inner loop), each asserted against
  V8 as oracle, plus two over-correction guards and a step pinning the two HARDENING properties —
  no section hangs or over-allocates on a 4.29-billion declared count, across all ten countable
  sections.
- `tests/parser/token_type_reachability.test.ts` — T13.32: every `TokenType` member is emitted by
  the lexer, or is on a documented allowlist with a reason. **Guards a silent regression**: deleting
  or mistyping a `KEYWORDS` entry produces no compile error — a `const enum` member simply stops
  being referenced — and the symptom is valid WAT failing to parse with an unrelated message. Three
  of its four steps guard the guard (population pinned, stale exemption, ghost exemption), and the
  emitted-but-unconsumed set is asserted EQUAL to its known list so it cannot grow silently.
- `tests/tools/cli_io_errors.test.ts` — T13.31: the CLI shims report I/O failures instead of
  dumping a stack trace. **Two halves on purpose.** `deno task test` runs `deno test --allow-read`,
  so a subprocess test can never execute in the normal gate — and a test that always skips protects
  nothing, while broadening the whole suite to `-A` for one file gives every other test permissions
  it does not need. So: (1) a SOURCE gate needing only `--allow-read`, asserting no
  `import.meta.main` block calls `Deno.readFile` / `writeFile` / `writeTextFile` directly — this is
  where a regression is reintroduced, and it always runs; (2) the behavioural half, spawning the
  real CLIs, `ignore`d (loudly — Deno prints `ignored`) when `run` / `write` permission is absent.
  **Ask which half of a property can be checked at the lowest privilege; that is the half that runs
  every day.**
- `tests/api/compat_error_shape.test.ts` — T13.30: every throw from `/compat`'s byte surface is an
  `Error` naming its origin, never a bare internal string from a deeper layer. Fuzzed over 585
  truncated / corrupted inputs with the **population pinned** (`threw > 50`) so it cannot go
  vacuous, plus the specific decode-clean / encode-impossible case and a valid round trip as the
  over-correction guard.
- `tests/tools/malformed_never_throws.test.ts` — T13.29: the four binary-consuming tools report
  malformed input rather than throwing. Every truncation (147) and every single-byte corruption to
  0x00 / 0x7f / 0xff (438) of a module covering all section kinds, times four tools — plus two
  over-correction guards (a truncated module must still be REPORTED; the intact module must still
  decode clean). **A fuzz axis, not an enumeration** — it needs no oracle, corpus or fixtures,
  because the property is "does not throw" rather than "is correct".
- `tests/reader/memarg_align_wrap.test.ts` — T13.26: a memarg alignment exponent cannot wrap.
  12 steps — the natural alignment, nine oversized exponents including both wrap points (32, 33) and
  the two that wrapped NEGATIVE and were rejected by accident (31, 63), a round-trip-must-not-repair
  assertion, and a multi-memory case (the memidx is bit 6 of the same byte). **Sensitivity:
  reverting reddens exactly 32/33/34 and the repair test while 31 and 63 stay green** — the
  "rejected for the wrong reason" case made visible.
- `tests/audit/source_hygiene.test.ts` — T13.25: no control bytes in any `.ts` under `src/` or
  `tests/`. **This gate protects the audit method, not the product** — a NUL makes a file BINARY to
  grep, so it drops silently out of every grep-driven enumeration while the sweep still reports
  clean. It pins its own population (`scanned > 100`) so a broken walk cannot pass as a clean tree.
- `tests/bridge/label_frames.test.ts` — T13.24: the bridge accounts for the `if` label frame.
  5 steps, and **the first one guards the guard** — it asserts the two branch depths give
  DIFFERENT answers through our own encoder, so the rest cannot go vacuous. That step exists
  because of T13.22's non-discriminating probe; the lesson is built into the fixture rather than
  only written down. Covers both failure directions plus the fail-loud refusal for a branch whose
  target IS the if.
- `tests/ir/apply_names_total.test.ts` — T13.20: `applyNames` is total on both axes. 13 nesting
  cases (the same `global.get` inside a different previously-unhandled parent each time), 5
  immediates including a check that the DATA and ELEM segment maps never cross, and 3 asserting the
  deliberate exceptions (label vars, local vars, abstract heap keywords) stay exceptions.
  **Sensitivity: reverting the fix reddens 2 of 3 groups and leaves the exceptions group green.**
- `tests/writer/const_expr_head_coupling.test.ts` — T13.21: `constExprOperands` and
  `writeInstrHead` must stay in sync. Reads both switches out of the writer SOURCE, plus a
  behavioural half asserting a folded table initializer does not duplicate its operand and that the
  round trip is a fixed point. Guards a latent trap rather than a live bug — drift writes an operand
  twice and **the output still reparses**, so only a fixed-point or count assertion catches it.
- `tests/parser/instr_arity.test.ts` — T13.8 (folded-vs-linear differential over 74 instructions,
  including a V8 execution case proving the round trip still computes 42)
  **and T13.18 (the totality gate)**. The file's header always claimed "every instruction that takes
  operands belongs here"; T13.18 makes that enforced rather than asserted — it reads `isPlainInstr`'s
  case labels out of the parser SOURCE and fails if any lacks an `instrInputCount` entry, so adding
  an instruction without one is red immediately instead of a quietly wrong IR tree. A second step
  fails if the single allowlisted exception (`SimdLaneOp`, arity is per-opcode and routed through
  `instrInputCountForTok`) ever goes stale. **Inverted before being trusted**: removing the two new
  explicit entries turns it red naming `Rethrow, StructNewDefault`.
- `tests/parser/drop_arity.test.ts` — T13.16: `data.drop` / `elem.drop` consume NO operands. The
  executed wrong-answer case for both (a preceding `(call $bump)` was swallowed and deleted, so
  `run()` returned 0 instead of 7 from a module both engines accept), the stacked-constant case in
  linear AND folded form, a round-trip fixed-point check, and one control asserting genuine arity-1
  instructions still take their operand. **Sensitivity: reverting the fix turns exactly 5 of the 6
  red, and the survivor is the over-correction control.**
- `tests/validator/simd_lane_index_type.test.ts` — T13.15: the SIMD lane memory ops follow the
  memory's index type. 6 valid + 4 invalid across both memory widths, in both directions. Includes
  `v128.load8_splat` on a 64-bit memory — the sibling that was already correct — so a later
  "simplification" onto one shared helper cannot quietly undo the distinction.
- `tests/validator/rethrow_depth.test.ts` — T13.17: `rethrow N` must name an enclosing CATCH frame.
  **V8-only by necessity** — Wasmtime and Wasmer both refuse legacy `try` outright, so the usual
  three-engine cross-check is unavailable for this whole family and the header says so. Two valid
  cases, the second (`rethrow 1` reaching an outer catch through a `block`) because a fix that only
  ever checked depth 0 would pass the first and fail it.
- `tests/validator/gc_operand_checks.test.ts` — T13.14: the GC instructions check WHICH reference
  they got, not merely that they got one. 15 invalid cases (cross-hierarchy `ref.test` / `ref.cast`,
  `array.len` on a non-array, unchecked `ref.i31` / `i31.get_*` / `ref.is_null` / `ref.as_non_null`
  pops, and all four illegal packed-field signedness combinations for `struct.get` / `array.get`),
  each asserted against V8 as oracle so a fixture cannot drift into validity — plus **14 cases that
  were already valid and must STAY valid**, which is the half that constrains the design (widening a
  cast is legal, so the rule is shared-hierarchy and NOT subtyping). **No campaign metric reaches
  any of them**: agreement counts only false rejections, and the spec suite has none of these
  shapes.
- `tests/reader/reserved_bytes.test.ts` — T13.5: the tag attribute byte in both paths and the
  table init form's reserved byte. **Nothing in the seven metrics reaches these** — the writer
  never emits a bad value, so round-trip cannot see it, and the spec suite has no case.
- `tests/reader/binary_malformed.test.ts` — T12.8: section identity/order/size, entry counts,
  the closing `end` of a body, the flag bytes with no defined meaning, and the data-count
  section. Written as hex-dump literals so each module reads as bytes.
- `tests/parser/annotation_lexing.test.ts` — T12.7: annotation body characters and the
  required id, plus the string/comment exemptions annotations.wast asserts as valid, and the
  quoted spelling of an ordinary identifier.
- `tests/parser/type_use_and_label.test.ts` — T12.7: a repeated closing label must match, an
  inline signature must agree with the type it restates (and must not re-intern it), and the
  order/naming rules that reading it recovers.
- `tests/parser/lane_and_nan_context.test.ts` — T12.6: a lane op requires its immediate, and the
  NaN result patterns are rejected in instructions while staying legal per-lane in an
  expected-result v128 (the contextual rule), plus a no-leak check on the flag.
- `tests/parser/name_utf8.test.ts` — T12.5: names must be valid UTF-8 in both the text and binary
  paths, data segments stay exempt, and a BOM in a name stays a character (T7.13 guard).
- `tests/parser/simd_lane_range.test.ts` — T12.4: lane immediates must fit `u8` (malformed) while
  16..255 stays a VALIDATION error, and `v128.const` lane values must fit their width. Both
  boundary directions plus a V8-executed no-wrap check.
- `tests/parser/align_power_of_two.test.ts` — T12.3: `align=N` must be a power of two (parse-time,
  malformed), while an oversized alignment stays a VALIDATION error — one test pins each layer.
- `tests/parser/import_order.test.ts` — T12.2: an import may not follow a definition (the inline
  abbreviation included), with seven legal orderings guarded so the rule is not a blanket
  rejection, plus a V8-executed check that `call` still means what source order says.
- `tests/parser/const_range.test.ts` — T12.1: integer constants are range-checked rather than
  truncated, and a FINITE float literal that rounds to infinity is out of range (`inf` must be
  spelled `inf`). 21 cases including the boundary in both directions.

## The gate covers `scripts/` too (since 2026-08-25)

`deno task check`, `deno lint` and `deno fmt` list `src/`, `tests/` **and `scripts/`** — 172
files. Until T13.43 they listed only the first two, so `publish.ts` (cuts releases),
`bump_version.ts` (writes the version) and four others were type-checked by no gate at all. Both
came back clean when finally run, so that was a **coverage gap, not a defect** — but nothing was
keeping it so, and the file it left unguarded is the one that publishes immutable artifacts.

Markdown under `scripts/` is excluded from `fmt`: the first run reformatted 88 lines of a report
already sent to the wasmtk team.

**`scripts/publish.ts` cannot be imported by a test** — it stages, tags and pushes at import
time. Its decisions therefore live in `scripts/release-guard.ts` and are tested in
`tests/scripts/release_guard.test.ts`. Put new preflight logic there, not in `publish.ts`.

**Two tests, and both are needed.** `release_guard.test.ts` covers the LOGIC;
`publish_preflight_wiring.test.ts` covers the WIRING — that `publish.ts` imports and calls the
guard, that it exits rather than warns, that **no mutating git subcommand runs before it**, that
`release-guard.ts` stays side-effect free, and that `scripts/` stays in the gate. Deleting the
guard block leaves all twelve logic tests passing, which is exactly the defect T13.43 was
(the logic was absent, not wrong). Verified by injecting all four faults; each fails.

Also updated to reflect the test count going 386 -> 391 as those landed.

## CI gate

`.github/workflows/ci.yml` runs `deno fmt --check`, `deno lint`, `deno task check`,
`deno task test`, and `deno publish --dry-run` on every push/PR to `main`. See
[publishing.md](publishing.md).
