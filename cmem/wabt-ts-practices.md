# wabt-ts — method rules

Summary: wabt-ts's method rules, each paid for by an incident: measuring, oracles, investigating,
producer/consumer pairs, tests and gates, hardening, siblings, and the audit definition. Last
verified 2026-11-20.
Main file: [wabt-ts.md](wabt-ts.md). Moved from it on 2026-11-20 (H38 step 5), unchanged.

## `wabt-ts/best-practices.md` (2,638 lines) — wabt-ts's method rules, each paid for by an incident

wabt-ts's METHOD file (findings lived in `tasks.md`): five thematic sections, then ~140 rules
appended one per incident (T7–T13.47) and a recurrence table; structure from wazmrt. Unchanged since
the merge; the core `best-practices.md` / `testing.md` took the convergent and metric rules. Below
is only what the core does not hold.

**Kept** — one rule, one citing incident:

### Measuring

- [lesson] A metric that stops before the failing stage is an UPPER BOUND: 230 parse-clean vs 180
  V8-valid; `Type.I8` = `0x7a` invisible to parsing and to the bridge (tranche 4).
- [lesson] Read the field the code actually sets: `hasErrors(result.errors)` missed silent
  `Result.Error`s — gap 903, real 314 (T9.5).
- [lesson] A fix that makes a metric WORSE is information: 1961→1779 led to the writer's half (T11).
- [lesson] A new check rejecting valid input: suspect its INPUTS before loosening — ten false
  rejections were ten masked bugs (T9.3/T9.4).
- [lesson] For every "X succeeds" metric build "NOT-X fails": a misspelled instruction became a
  silent deletion, green on six metrics; `assert_malformed` caught it (T10.5).
- [lesson] Say where the probe sits: 1227/1229 at `parseWatModule`, 1229/1229 via `wat2wasm` (T12).
- [lesson] Run the whole panel, not the metric being moved — round-trip, not the target, caught a
  wrong-index-space count check (T12.8, 2120→2051).
- [lesson] `0/0` or `0/all` is a harness bug until proven: `w.buffer ?? w` on a `Uint8Array`;
  `a.b ?? a` is unsafe on built-ins (T13.11/12 re-measure).
- [lesson] Measure even when "nothing could move" is well argued — a new shared-path `throw` (T13.12).
- [lesson] A corpus may hold an answer key you discard: `assert_malformed` error TEXTS found 70/711
  wrong diagnoses. Ask what a harness parses and never asserts (T13.37).
- [lesson] Conformance metrics grade accept/reject only; the ERROR PATH needs its own axis (T13.29–37).
- [lesson] Classify a difference by PROVENANCE (text-sourced = our output; binary = crafted): 22 of
  83 were our own section-size padding; a match against non-canonical input can be a shared defect (T13.40).
- [lesson] With stacked defects the MESSAGE moves before the count (`(structref)`→`(ref 0)`, zero
  tests fixed, fix correct) (T13.47).

### Oracles — the engine panel

- [reference] V8 fast, **Wasmtime the authority** (2026-08-21, `97e96699e`), Wasmer disagrees usefully (its
  52/21 was the only data on a 73/73 check — it classified the 73 by proposal). Enable proposals by
  EXPLICIT list — `-W all-proposals=y` and `--enable-all` make engines refuse everything; one `-o` per
  module. `scripts/wabt-ts/engine-check.ts`.
- [lesson] A feature-gate rejection is not a verdict: V8 `enable with --experimental…` hid a
  validator rejecting all wide arithmetic; `wasmtime -W wide-arithmetic=y` settled it.
- [lesson] Spec limit or engine limit? Ask Wasmtime before adding a check, and record the exact boundary.
  Spec limits, rejected by both engines: subtype depth 64 ok / 65 rejected, and supertype cycles (T13.34).
  Engine limits, which we accept: `memory i64` at 2^48 pages (V8-valid stays 2119/2120 on purpose) and
  six size cases (T13.35).
- [lesson] A rejection clears only the check you varied: `ref.as_non_null` on i32 failed at the
  RESULT type (T13.14).
- [open] `engine-check.ts` self-tests only a known-INVALID module; the accept-direction guard is absent.

### Investigating

- [lesson] First-error-text triage mislabels (4 wrong hypotheses of 137); repro through the real entry.
- [lesson] Read what the spec test ASSERTS before designing: `local_init.wast` needed no join; reasoning
  from memory about the spec algorithm mis-scoped local-init, and the test settled it in minutes (T9.9).
- [lesson] Never read OUR rendering as the source — the misprint was the bug (T9.10); and validate
  your own probe WAT before blaming the parser (`br_if`).
- [lesson] Budget by failure mode — engine-accepts-wrong-bytes hardest (`é`→`e9`); rank silent
  above loud (UP-5 was ranked sixth).
- [lesson] Pick probe inputs whose wrong answers differ: `align=3` shows the floor to 2 (T12.3).
- [lesson] Probe the OPERATION's boundaries: `1 << n` wraps mod 32, exponents 32..62 accepted, 63
  passed by accident. Shift widths, `|0`, 2^53, LEB widths go in fixtures (T13.26).
- [lesson] About an encoding, compare ENCODINGS; and the input must engage the mechanism — a `$name`
  catch target cannot see stack order, a numeric depth can (T13.22, twice).
- [lesson] Read three findings by hand before believing a probe: 32 flagged, all correct (T13.35).
- [lesson] Read an option's DOC first — `--sections` means strip, not keep; a name that disagrees
  with its use (`keep` as `!keep.has`) misleads editors (T13.41).

### 3. Producer/consumer pairs — the recurring blind spot

(Cited as "§3" by `tests/wabt-ts/reader/reserved_bytes.test.ts`, `tests/wabt-ts/parser/wide_arithmetic.test.ts`.)

- [lesson] Text order ≠ binary order: `memory.init` is `(memory, data)` / `(data, memory)`.
- [lesson] Reader reads N, writer writes N+1 → desync: `readRefType` read one byte of a typed table.
- [reference] `resolveNames` must walk every name-bearing immediate (six instances, Bug G…memidx);
  guard `tests/wabt-ts/ir/encode_correctness.test.ts`: no name-var survives, over the spec suite.
- [decision] The IR must EXPRESS what the format can — a single slot for a plural is the bug
  (`ReturnExpr.value`→`values[]`, `params: ValueType[]`).
- [decision] An encoder never REPAIRS invalid input (funcidx elem encoding, five layers; T11) —
  `tests/wabt-ts/writer/no_repair.test.ts`. `encodeU32Leb128`'s `value >>> 0` WAS the range check; with
  `synthesizeTypes` inventing types, it explained the last 19 `assert_invalid` misses (T13.2). The
  signed LEB pair followed (T13.12).
- [decision] Coarsen at the CONSUMER's boundary, never in an encoder — `coarsenValueType` at entry of
  `src/validator/type-checker.ts`, `src/bridge/type-map.ts`.
- [lesson] A scoping off-by-one recurs in every layer: `try_table` catch target, parser T7.6 → validator T9.8.
- [lesson] One-sided rule: writer's "only valid value" `0x00` vs a reader discarding the byte (T13.5).
- [lesson] Two parsers of one rule; the printer inverts the wrong one — quiet NaN became signalling
  (`src/core/literal.ts`). Assert print∘parse = identity.
- [lesson] A stub on the form the other side emits is a round-trip hole (`try_table` linear branch).
- [lesson] Read a decode beside its encode, for every value the FORMAT allows (T13.26).
- [lesson] Port the upstream option's DEFAULT: `canonicalize_lebs` true, port shipped fixed-width
  (T13.40; `src/writer/stream.ts`, `tests/wabt-ts/writer/minimal_section_size.test.ts`).

### Audit a manual walk against the TYPE, not against a corpus

(Heading cited by `tests/wabt-ts/core/opcode_tables.test.ts`.)

- [reference] Enumerate every `Var`-bearing field of every Expr interface; check each kind's case
  body names it (~30 lines). Found atomic `memidx` unresolved — wrong memory, no corpus reaches it.
- [baseline] Every KIND of member: 2026-08-25 over `src/ir/ir.ts` — `Var` 64 interfaces / 0,
  `Expr` 75 / **1** (`table.get.index`, T13.11). Re-run after adding an IR variant.
- [lesson] Enumerate the SIGNATURE, not the parameter: T9.11 fixed `offset`; T13.15 found `is64`
  dropped in two of the same twelve handlers.
- [lesson] Enumerate the family, ask what each member checks. Tells: `_`-prefixed param siblings use;
  a param siblings take; bare `dropTypes(n)`; a label shared with a leaf; an uncalled helper
  (T13.14); an unused-param lint warning in one handler (ten memarg `offset`s, T9.11).
- [lesson] A shared `case` label asserts interchangeability: T13.11 (`table.get` in a leaf arm),
  T13.16 (`data.drop` in arity 1 — deleted an instruction).
- [lesson] "Consume and ignore" is greppable, incl. arithmetic spellings `& 0x3f`, `!== 0` (T12.6–9);
  and widening a mask is not a range check — `nan:0x0` still became infinity (T12.9).
- [lesson] A name check that runs only when the target is known is half a rule; defer to full scope
  (`pendingTypeUses`, T12.7).
- [lesson] Read a partial switch's `default` before its case count; the DIRECTION of the default decides.
  Over a closed set, reject: `isConstExpr` is safe at 13 kinds; `applyNames`' `return e` let 50 of 87
  kinds fall through (T13.20/T13.21).
- [lesson] Grep the marker LITERAL, not the helper: 13 more `kind: 'nop'` sites beyond `popN` (T10.8).
- [lesson] Run a mechanical scan at a 33% hit rate and triage by hand (T13.16); run the code rather
  than parse it — 317 static gaps (315 false) vs 571 spellings fed to the reader → 2 real.
- [lesson] Audit your latest diff before old code — the fifth pass's only gap was an hour old.
- [lesson] Correct bytes ≠ correct IR: linear `i64.add128` encoded identically with empty operands.
- [lesson] A thoughtful comment on one case marks its complement unexamined: unlabeled `if` pushed
  no label frame (T13.24).

### Tests and gates

- [lesson] Assert the VALUE, not that it parsed (`table.init` indices transposed all of tranche 2).
- [lesson] Put a known gap in the suite as a failing-by-design assertion; it announces closure (T9.7).
- [lesson] A behavioural fixture must use the instruction under test — via `call_indirect` it passed
  with T13.11 live; check WHICH steps flip (one of 69, T13.13).
- [lesson] Pin both directions of a tightening: widening `ref.cast` is valid —
  `tests/wabt-ts/validator/gc_operand_checks.test.ts` 15 invalid + 14 valid (T13.14).
- [lesson] A test's NAME states a property; assert it, not a weaker substring
  (`tests/wabt-ts/parser/malformed_input.test.ts`, T13.38).
- [lesson] A test pinning someone else's DEFECT names the item; when red, assert new AND not-old (UP-1).
- [lesson] Test a guard does NOT fire on the happy path; a wiring gate allowlists git subcommands
  before the guard and asserts the effects still follow (T13.44).
- [lesson] Split a test by privilege, skip LOUDLY (`ignore:`), pin the population (T13.31).
  [correction] `deno task test` now grants run/write, so both halves run (1043 / 0 ignored); the
  comment at `tests/wabt-ts/tools/cli_io_errors.test.ts:27` still says `--allow-read`.
- [reference] Gate what the METHOD depends on: one NUL made grep call `src/bridge/bridge.ts` binary and
  a sweep "clean" (T13.25); scope to what the workflow greps — `cmem/` too (T13.28).
  `tests/wabt-ts/audit/source_hygiene.test.ts` scans src/tests/cmem, asserts `scanned > 100`.
- [lesson] Gate a hand-maintained correspondence with no bug behind it (T13.32): `opcode_tables`,
  `instr_arity`, `const_expr_head_coupling`, `token_type_reachability` tests.
- [lesson] An allowlist entry is a claim per MEMBER — `Reserved` was the defect itself (T13.38).
- [lesson] A command written past a false alarm must still fire AND clear the noise: `deno fmt --ext
  ts -` ignored `deno.json` lineWidth (T13.42).
- [lesson] A doc saying a tool REFUSES something is a test case — `publish.ts` did not (T13.43).
- [lesson] A documented command rots when its section is retitled — state what it COUNTS; an example
  inside a scanned corpus is data — write `<next>` and run the command on the doc.

### Robustness and hardening

- [reference] Fuzz every entrypoint taking outside input (truncate; corrupt to 00/7f/ff; no throw,
  still reports, valid still succeeds): 585 inputs, four tools crashed (T13.29). List then: `wat2wasm`,
  `wasm2wat`, `wasmValidate`, `wasmObjdump`, `wasmStrip`, `/compat` (T13.30).
- [decision] Fix the contract at the BOUNDARY, never at its origin → the "Encoding and decoding" items
  above (T13.29 tools, T13.30 `/compat` one error shape, T13.31 CLI shims).
- [reference] Fuzz questions: survives / terminates / linear (no oracle) vs notices / reports
  accurately (oracle) — a 2^32−1-entry empty type section validated (T13.33).
- [lesson] Hardening's cheap axes decay too (1, 2, 0, 0, 2); two empty passes mean the axis LIST is
  stale — find an oracle (T13.36 corrected, T13.37).
- [lesson] Empty frontier = cheap axes spent; a missing row looks swept (CLI shims, T13.31) —
  derive the population, add the row before auditing.
- [lesson] Disbelieve the comment you just wrote: "subtype checks report the cycle" — they did not (T13.34).
  A comment stating intent is not evidence: `synthesizeTypes`' "dangling reference for the validator"
  was believed for a whole campaign (T13.2).

### Records and judgement

- [lesson] Rank by the corpus the GOAL names: last-ranked T10.1 was 100% of WASI diffs (1→50/270).
- [lesson] Observable = not cosmetic (export order, T10.1); ask if repeating is a FIXED POINT (+4
  bytes per round trip, T10.5).
- [trigger] "Unreachable" is today's code: `getMiscOpcodeTypeInfo`'s benign default
  (`src/validator/type-checker.ts`) was reached one commit later. Record what WOULD reach a trap.
- [lesson] Rank a category by its RULE wherever it applies (UTF-8: quoted +176, binary +528, T12.5);
  test the exemption with the rule (data segments).
- [lesson] A half-built feature no corpus reaches is worse than none (page sizes, T13.4); size by
  assertions UNBLOCKED.
- [lesson] Write the QUESTION into a closed audit ("checks its offset"), and record recurrences (T9.11→T13.15).
- [lesson] Record negatives: what varied, what held fixed, why; plus clean sites and their reason (T13.18).
- [lesson] An unearned fix is a worse trade than the doubt (`instrProducesValue` SIMD loads, T13.18).
- [lesson] Dead code encoding a superseded design is a trap (`Validator.refNullType`, now gone).
- [lesson] A perf note needs its measurement or CALLER — `getExprArity`, above. Correct it in place.

### Siblings and upstream

- [lesson] Measure severity, never inherit it; record root cause (UP-1: "invisible" was engine-rejected).
- [lesson] Re-verifying ≠ re-ranking; an over-correction is still wrong (UP-7); re-read a diagnosis
  against the options listed under it (UP-1 option 2 refuted it).
- [lesson] Review others with the metric your blind spot taught you — decode→encode found all three
  binaryen-ts wrong-bytes findings.
- [lesson] Name the ref measured vs the ref run (HEAD vs v1.3.5); unreleased = absent downstream;
  date a checkout before trusting a grep's absence. Read a sibling's design first (wazmrt page sizes).
- [lesson] Answer an upstream fork by picking the branch; with a cancelling pair the coupled change
  is the unit of work (T13.22).
- [lesson] Their fix may be necessary but not sufficient — check our own layer on the path (multi-value).

**Recurring root causes — audit checklist** (decaying yield):

| root cause                             | occurrences                                     | where to look                                 |
| -------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| unused parameter in a handler family   | T9.11 `offset` → T13.14 `_signed` → T13.15 `is64` | `_` params siblings use; params siblings take |
| shared `case` label, unlike members    | T13.11 leaf/non-leaf → T13.16 arity 0/1          | each multi-label `case`, on its body's axis   |
| helper exists, never called            | T13.14 `isSubtype` → T13.17 → T13.18 align table | a check a sibling performs                    |
| benign `default:` value                | T13.18 `instrInputCount` `return 0` → T13.16     | `default` returning `0`/`false`/`null`/`Ok`   |

Decay: the first pass run FROM the table (T13.18) found no new wrong-answer bug; the pass that writes
a row usually sweeps it. It stays useful for the row's NEXT instance in new code — S6's
`ExpressionKind.Region` defaults (core "Changing a field has EIGHT failure modes") were row 4 again.

**Already in the core** — pointers only (§ = cmem/best-practices.md unless named):

- convergent rules incl. vacuous oracle (T13.41), green gate is a floor → § "The convergent rules"
- numbers from memory; caret+lockfile pin → § "A written result is a CLAIM", § "`--reload` does not…"
- diagnosis (T10.5) → § "Before fixing a hypothesis, TEST it"; cast stops a refactor (T7.4) → §
  "Changing a field has EIGHT failure modes"; lookup table ×3 → § "A vocabulary must be checked
  against the SPEC"; per-file diff → § "A fixed failure can UNMASK another"; heredoc escapes
  (T13.19/T13.28) → § "Do not author file CONTENT…"; guard vs coverage → § "A test for a fix is not…"
- three states; metric blind spots (classifier 2737→2683, atomics absent, invalid corpus T13.14);
  folded/linear and named/numeric differentials (T13.7/8); axis (T13.13); harness skips and broken
  harness scores better (T13.39); fixtures to an engine, legacy EH V8-only; T13.35; snapshot stamps
  (T13.45); `git diff --stat` after reverts; release logic vs wiring (T13.43/44) → cmem/testing.md
- incoming report premises → cmem/working-rules.md § "Tests, measurements and records"

## `wabt-ts/INDEX.md` (215 lines) — the wabt-ts memory index, binding triggers, and the audit definition

Covered the cmem policy (superseded by cmem/INDEX.md), two notation rules, the "update the project
memory" trigger, the "look for code issues" trigger with its audit definition, the regression-gate
trigger, and the files table. The audit definition is cited from
`tests/wabt-ts/audit/source_hygiene.test.ts:20` and `src/ir/resolve-names.ts:312`.

### The audit definition

**The "look for code issues" trigger** is a comprehensive audit, across tested AND untested paths,
for workarounds, dead code (verify each with a grep), bugs, and **silent fall-throughs** — the worst
class.

**The canonical silent fall-through** is a `default:` arm returning a benign value
(`0`/`false`/`null`/`Result.Ok`) where the other arms return real data. `instrInputCount`'s
`default: return 0` caused the `Quaternary` bug, and T13.16 was its inverse. Where a population is
enumerable from source, gate on it (T13.18). Report `file:line` and severity.

**Corpus coverage is NOT the tool.** Enumerate the TYPE, and check the code against it:
- every **`Var`-bearing field** of every `Expr` interface vs. the `resolveNames` case that handles it;
- every **`Expr`-bearing field** of every `Expr` interface vs. that same case body — a second,
  equally necessary axis. The `Var` axis came back clean across 64 interfaces while the `Expr` axis
  found `table.get.index` (T13.11) across 75;
- every **`ExprVisitorDelegate` hook** vs. each walker that must be total (both writers, the validator);
- every **entrypoint accepting outside bytes**, fuzzed by truncation and single-byte corruption.
  Assert only that it does not THROW, plus two guards: malformed input is still REPORTED, and valid
  input still succeeds (T13.29);
- every **`readX` beside its `writeX`**: the decode must invert every value the encode can produce AND every value the WIRE FORMAT allows (T13.26 lived in the second half);
- **`instrInputCount` vs. the max `opN()`** each `buildPlainExpr` case reads, and every member of a
  shared `case` group has the same arity (T13.16). Triage regex false positives by hand; do not
  tighten the scan;
- **every parameter of each handler in a family**, not one parameter across the family. T9.11 fixed `offset` in ten handlers and left `is64` dropped (T13.15);
- **parallel handler families**, where a sibling that does what its neighbour skips is the strongest
  tell. The other tells: a case sharing a label with a genuine LEAF (`table.get` inherited
  `table.size`'s body); an underscore-prefixed parameter (`_signed`); a parameter the sibling takes
  and this one does not; a bare `dropTypes(n)` where siblings call `popAndCheck1Type`; and a helper
  that exists but is never called (T13.14 was fixed by calling `isSubtype`);
- **for the validator, a hand-built INVALID corpus** (~20 lines): bad modules → `wat2wasm` (which
  does not validate) → `wasmValidate`, with V8 as oracle and Wasmtime as authority. Pair every
  tightening with a false-REJECT sweep, re-run with the fix reverted.

**Attached rules:**
- Start from the recurring root-cause table (the best-practices section above), and expect its yield to decay.
- Record the negative results, and the QUESTION an audit asked.
- **Pin the population** (assert a floor on what was scanned): every enumeration is grep-driven, and one control byte hides a file (T13.25).
- A fully green gate is the normal starting condition: T13.11 and T13.12 were found with everything green.

**Kept**
- [decision] **Notate the INTENT of a section at the section.** A shared `case` group, a handler
  family or an opcode table is a membership assertion. State what joining asserts, what breaks in
  each direction, and which gate catches it (T13.11, T13.16, T9.6 → T9.11 → T13.15). A live example
  is the `try_table` INTENT block in `src/bridge/bridge.ts`.
- [lesson] **Write what you did NOT check, the negative results and the calibration INTO the file.** In T9.11 → T13.15 the knowledge existed and the record did not.
- [correction] **The gate is now CI's full list**, not `check && test && fmt && lint`.

**Already in the core:** cmem as the single home; README is not memory → cmem/INDEX.md;
cmem/publishing.md § "Repo hygiene and the memory routing rule". The regression gate →
cmem/working-rules.md § "The gate — on the COMMITTED tree, reading every EXIT CODE". **History:**
the files table described the pre-merge wing; the G1 baseline → cmem/project.md § "The merge — how
it was prepared (2026-08-26)".
