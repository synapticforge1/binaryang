# Overview

`wabt-ts` is a **TypeScript port of [WebAssembly/wabt](https://github.com/WebAssembly/wabt)**, the
C++ WebAssembly binary toolkit. It is forked from upstream wabt and being ported to native
TypeScript for integration with the **wasmtk** project.

## Goal

wasmtk currently shells out to the compiled wabt binary for `wat2wasm` and `wasm2wat`. The
TypeScript port removes the binary dependency and unlocks new tools — most notably `wasm2ts`.

**Long-term goal:** progressively compile pure-compute wasmtk modules to WebAssembly, using
`wasm2ts` output as the TypeScript-side integration layer. End state: a wasmtk where all practical
modules run as wasm with fully-typed TypeScript interfaces.

wasmtk uses a **Deno backend**. All design decisions favor Deno compatibility and clean TypeScript
public APIs. See [runtime-tooling.md](runtime-tooling.md).

## Conformance state (2026-08-24; three re-measured 2026-08-25) — re-measure before quoting

Eight metrics over the 257-file WebAssembly spec testsuite
(`wasmtk/tests/module/wasm_wast/testsuite-main/`). **The first seven are exhausted as of 2026-08-24.** The
eighth — **diagnostic wording, 689 / 711** — was added 2026-08-25 (T13.37) and is the only one not at ceiling:
it grades our error MESSAGES against the text each `assert_malformed` command says the module should produce,
an answer key that had sat unread in the testsuite for the whole campaign. Detail, method and
the harnesses: [tasks.md](tasks.md), [testing.md](testing.md).

**Re-measured 2026-08-25** after T13.11 / T13.12 (a change to `resolveNames` and to a LEB encoder
every encode runs through): parse-clean **257 / 257**, encode+V8 **2119 / 2120**, round-trip
**2119 / 2119**, **zero throws** — identical to the values below. The other four were not re-run;
they were unreachable from those changes. The standing instruction stays: **re-measure before
quoting**, and re-measure whatever a change could plausibly touch even when the argument for "it
cannot" is a good one.

| metric              | what it answers                                      | value                                                              |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| parse-clean         | files `parseWastScript` accepts                      | **257 / 257**                                                      |
| V8-valid            | files whose every module encodes to wasm V8 accepts  | **256 / 257** (2119 / 2120 modules) — the 1 is a 2^48-page `memory i64`, which **Wasmtime accepts** and V8 rejects on its own implementation limit. It used to pass only because the encoder truncated it (T13.2) |
| validator agreement | modules V8 accepts that `wasmValidate` also accepts  | **2119 / 2119**                                                    |
| `assert_invalid`    | modules the spec calls invalid that we reject        | **2683 / 2683** — and re-measured 2026-08-25 after T13.26, which closed both `align.wast` misses on the local harness (2671 → 2673 of 2678 there). **This is the metric that finally moved**, after a long run of findings none of them could see |
| round-trip          | `binary → wasm2wat → wat2wasm` byte-identical        | **2119 / 2119**                                                    |
| execution           | spec `assert_return` assertions our output satisfies | **23,077 / 23,077**                                                |
| `assert_malformed`  | text or bytes the spec says must FAIL TO PARSE that we reject | **1229 / 1229** quoted · **711 / 711** binary                       |

Against the wasmtk WASI corpus (`tests/wasmtk/`, **REFRESHED 2026-08-25** from wasmtk `4600ba9` —
see `tests/wasmtk/PROVENANCE.md`): **421 files, encode 421 / 421, validate 421 / 421, round-trip
421 / 421.**

It was a frozen 272-file snapshot from 2026-05-25 until then, of which 265 / 272 validated. The 7
that did not were the `KNOWN_INVALID` set — all seven already fixed upstream, with the stale bytes
the only thing still saying otherwise. On the refresh every one of them fired the gate's "now
VALIDATES" assertion at once, and `KNOWN_INVALID` is now empty.

**Populations still differ, so re-derive before quoting.** 421 = 413 regenerated from wasic + 8
non-wasic fixtures (Rust / Zig / hand-written WAT). The wasmtk team count their live corpus at
**373**; we generate 413 from the same checkout and have deliberately NOT reconciled that — which
sources constitute "the corpus" is a fact about wasmtk, and inferring it here is the move that
produced three wrong reports.

**Each metric was blind to bugs the others caught**, which is the campaign's most reusable finding —
see [best-practices.md](best-practices.md). The newest two exist because the others could not see
their failure modes: **execution** because the rest check bytes or acceptance and
none runs an instruction, and **`assert_malformed`** because every other metric
measures the REJECTING direction or our own output.

**Two of them cannot be pushed higher, and both numbers are honest rather than
short.** The 19 `assert_invalid` misses closed only once we stopped REPAIRING
those modules (T13.2), and V8-valid went DOWN in the same change — a 2^48-page
`memory i64` had been passing because the encoder truncated it. Wasmtime, the
authority, accepts what we now emit.

## Current state (2026-08-25)

**Tranche 13 is complete; every conformance metric is exhausted.** What it
changed, beyond the numbers:

- **The encoder no longer repairs invalid input.** `encodeU32Leb128` began
  `let v = value >>> 0`, which WAS the range check — 2^32 encoded as 0. That,
  plus `synthesizeTypes` inventing a type for an unresolvable type-use and
  reusing a rec-group member for an implicit one, is what the last 19
  `assert_invalid` misses actually were: not a permissive validator, but our own
  pipeline rewriting the module before anything validated it (T13.2).
- **`Limits.initial` / `max` are `bigint`** and **`Limits.pageSize` is now
  `pageSizeLog2`** — two BREAKING changes to an exported type, both deliberate.
  See [publishing.md](publishing.md). **Shipped in v1.4.0 (2026-08-25).**
- **Custom page sizes work end to end** (T13.4) — parser, reader, writer,
  validator, feature gate. The proposal had a flag, an IR field and half a
  decoder, and no rule enforced anywhere.
- **An out-of-scope branch target is now the parser's error** (T13.1), so the
  quoted `assert_malformed` number no longer depends on where the probe sits.
- **Every `Features` flag now GATES** (T13.10). Nine of twenty-one were inert —
  a caller could switch `gc` off and validate a GC module. Gating covers types
  as well as instructions, and `wasm-validate` gained
  `--enable-<feature>` / `--disable-<feature>` / `--enable-all` in the same
  change, because a gated validator without flags rejects most modern wasm.
- **Two atomic bugs, in a proposal no metric can see** (T13.8, T13.9). The
  arity table was one too high for atomic store / rmw / cmpxchg, so `wasm2wat`
  output of any such module was **rejected by V8**; and the validator had no
  `PREFIX_THREADS` branch, so every atomic was type-checked as
  `(v128,v128)→v128` and **falsely rejected**. See the blind spot below.
- **Three reserved bytes were read and discarded** (T13.5) — the tag attribute
  in both paths and the table init form's marker; **the opcode-name and
  natural-alignment tables were audited against the lexer's own population**
  (T13.6); and a `$name` was checked in all 64 grammar positions (T13.7), where
  21 fail at v1.3.5.
- **Cross-runtime reality is measured, not assumed** — Wasmtime, V8, Bun/JSC,
  Wasmer and wazero, over the whole WASI corpus. The matrix and what each
  runtime refuses are in [tasks.md](tasks.md); the short version is that only
  Wasmtime implements custom page sizes, and wazero's CLI refuses any module
  carrying a tag section.

### Hardening pass 3: two axes clean, one UNMEASURED (T13.35, 2026-08-25)

Size amplification and string/name scaling are clean — no blowup, no `Infinity`/`NaN` leaking
into disassembly, growth ~2 per doubling everywhere. Six size cases where V8 rejects and we
accept were classified by **Wasmtime accepting all six**: engine limits, not spec limits, so
accepting them is correct. Against V8 alone the obvious move would have been to add six limits
and start rejecting valid modules.

The third axis — *does it report accurately?* — is recorded as **UNMEASURED, not clean.** The
cheap oracle flagged 32 of 317 errors and every flagged case examined turned out CORRECT: a
`LEB128 u32 overflow` reported at the START of the malformed LEB rather than at the corrupted
byte, which is the better diagnostic. **A probe that produces findings is not thereby a good
probe** — see [best-practices.md](best-practices.md). The axis table in
[testing.md](testing.md) now distinguishes clean / unmeasured / not-attempted, because
collapsing the middle one into "clean" means nobody returns to it.

Probing the TYPE graph for hangs and blowup found no hang — and two silent accepts that
**both Wasmtime and V8 reject**: a subtyping chain deeper than 63 (a GC-proposal limit that
makes subtype checks O(1)), and supertype CYCLES (`$a <: $b <: $a`, and `$a <: $a`).

Two things worth carrying:

- **Asking Wasmtime is what made this actionable.** V8 rejecting a deep chain could equally
  have been an engine implementation limit — exactly the situation with the 2^48-page
  `memory i64` already in the metrics table, which Wasmtime ACCEPTS and V8 rejects. Wasmtime
  rejected at the same boundary, so it was a spec limit and a real gap.
- **The cycle half was found by disbelieving a comment I had just written**, which claimed the
  ordinary subtype checks would report cycles. They did not. See
  [best-practices.md](best-practices.md).

Also verified rather than inherited: the five remaining `assert_invalid` misses contain **no
module we accept that V8 rejects** — they are modules V8 accepts too, confirming the standing
note instead of trusting it.

### Hardening is a different lens, and it paid immediately (T13.33, 2026-08-25)

Run right after the frontier list emptied and two consecutive enumeration passes found
nothing. Asking *what would an adversary or an accident do to this?* rather than *what is
wrong with this code?* found a correctness bug in the first probe: `readTypeSection` put its
section bound in the loop CONDITION, so a declared count outrunning the entries ended the loop
silently — `(type count 4294967295)` with no entries decoded to ZERO types and validated
clean. One reader of eleven.

**T13.29's fuzzing could not have found it.** That asked *does it throw?*; this asked *does it
NOTICE?* Same inputs, different property — and the second needs an oracle, which is why it
costs more and why it is where defects survive. Three cheap hardening axes came back clean in
the same pass: no hang or over-allocation on 4.29-billion counts, no stack overflow at 100 000
nested blocks or 60 000 nested operands, and no superlinear scaling across five shapes.

Hardening is the natural move when the enumeration axes stop paying. **CORRECTED after
T13.36:** this originally read "hardening does not decay the way bug-hunting does" — written
from one successful pass and too strong. Four passes in, the record is 1, 2, 0, 0 findings.
The input space is not exhausted, but the CHEAP hardening axes are consumed at the same rate
as the cheap enumeration ones, because what runs out is the supply of properties checkable
WITHOUT an oracle. See [best-practices.md](best-practices.md).

**REVISED after T13.37 and again after T13.38.** The fifth pass ran the axis that correction
named as remaining — diagnostic quality — and found **2**; the sixth applied the same oracle to
the validator and parser populations and found **2 more**, making the record 1, 2, 0, 0, 2, 2. The
oracle it needed was not expensive at all: every `assert_malformed` command in the spec
testsuite carries the error text the module should produce, and our metric had been reading
the modules and discarding the strings for the whole campaign. **Two empty passes in a row
meant the axis list was stale, not that the code was clean.** The sixth pass also found that the
**scratch conformance harnesses had been omitting `synthesizeTypes`** (T13.39), making their
denominator five times too small — a measurement defect that scored WELL, because
`assert_invalid` counts rejections and a harness that breaks every module rejects everything.

Following that thread one step further (T13.40, raised by the owner) found the round-trip figure
was **summing two populations that must not be summed**. Split by whether the input binary was
our own output or bytes the testsuite crafted, fidelity was already **2119 / 2119** — and the
other half was hiding a real defect: `patchU32Leb` left the back-patch padding in place, so
**every section header we ever emitted was 4 bytes too long**. Fixing it shrank the wasmtk WASI
corpus by 3.2%. Upstream wabt canonicalises by default; that branch was never ported.

### The audit frontier is empty, and that means something narrower than it sounds (T13.32)

`cmem/testing.md`'s "what has NOT been enumerated yet" list reached empty on 2026-08-25.
**Read it precisely: the CHEAP AXES ARE SPENT, not the code is clean.** The yield curve is in
the log — the last several passes returned progressively less, and two (T13.27, T13.32) found
nothing at all.

The next audit should either invent a NEW axis — the fuzz axis was the last new one and paid
three times across T13.29 / T13.30 / T13.31, on surfaces no conformance metric touches — or
accept a lower yield and say so.

T13.32 itself found no defect and still added a gate, for a reason worth generalising: a
deleted or mistyped `KEYWORDS` entry is **not a compile error** — a `const enum` member simply
stops being referenced — and the symptom is valid WAT quietly failing to parse. **A
hand-maintained correspondence is the unit worth gating, not a bug.**

### Every published entrypoint now reports instead of crashing (T13.29 / T13.30 / T13.31)

Three passes down the same axis, each one layer further out:

- **T13.29** — the four byte-consuming library functions threw uncaught `RangeError` on ~102 of
  585 malformed inputs each.
- **T13.30** — `/compat.toBinary` threw the binary writer's raw internal string, undocumented,
  while its two siblings threw documented formatted errors. The wasmtk-facing migration surface.
- **T13.31** — all five CLI shims dumped a Deno stack trace (with our absolute source path) on a
  mistyped filename. 10 of 10 failure cases.

In every case the throw itself was CORRECT at its origin — `leb128.ts` and the binary writer are
deliberately fail-loud and were not softened. What was missing each time was a conversion at the
boundary where the contract changes. See [design-decisions.md](design-decisions.md).

### Fuzzing the published surface: two findings, two sessions (T13.29 / T13.30)

Listing the exported functions that take a `Uint8Array` or `string` from the caller gives
eight — `wat2wasm`, `wasm2wat`, `wasmValidate`, `wasmObjdump`, `wasmStrip`, and `/compat`'s
`parseWat` / `readWasm` plus the `WasmModule` methods. **Six had never been fuzzed; two of
those six were broken.** T13.29 (all four byte-consuming tools threw uncaught `RangeError`)
and T13.30 (`/compat.toBinary` threw an undocumented, differently-shaped error on the
wasmtk-facing migration surface).

Cleared as negative results in the same sweep: `wat2wasm` never threw across 2505 malformed
TEXT inputs, and `/compat parseWat` throws only contractually.

### The published binary tools crashed on malformed input (T13.29, 2026-08-25)

`wasm2wat`, `wasm-validate`, `wasm-objdump` and `wasm-strip` promise
`{ errors, result }` and threw an uncaught `RangeError` instead — on **~102 of 585** truncated
or single-byte-corrupted modules, each. Anyone feeding untrusted wasm to a published tool got a
crash where the contract promises a reported error.

T7.1 ("never throw, never hang") had been applied to the WAT parser and never to the binary
front door. `core/leb128.ts` still throws by design — the conversion belongs at the reader
boundary, not at the decoder. Found by **fuzzing rather than enumeration**, which is the first
new axis in a while and the cheapest: the property is "does not throw", so it needs no oracle.

### Two passes over the binary reader: one real bug, then nothing (T13.26 / T13.27)

`binary-reader.ts` is 3059 lines and had never been enumerated. Reading each `readX` beside
its `writeX` found **T13.26** — a memarg alignment exponent decoded with `1 <<`, which wraps
mod 32, so exponent 32 became align 1. That was a silent T11-class REPAIR (an invalid module
disassembled and re-encoded into a valid, different one) and it moved `assert_invalid` for
the first time in many rounds.

The next pass over the same file found **nothing**: block types, limits flags, mutability and
sub-types all clean, plus `wasm-strip` — a published MUTATING entrypoint never audited before
— verified a byte-identical no-op on 10 shapes and an exact custom-section remover on 4 more
(T13.27, recorded as `NO DEFECTS FOUND` with an id, because "clean" and "never examined" are
indistinguishable from the code).

**The frontier is now tracked explicitly** in [testing.md](testing.md) under "What has NOT been
enumerated yet" — read it before starting an audit, update it when finishing one.

### The audit method has its own failure mode, and it fired TWICE (T13.25 / T13.28, 2026-08-25)

T13.25 gated `src/` and `tests/` against control bytes after our own NUL sentinel made
`binaryen-bridge.ts` binary to grep. **The gate was scoped to what the compiler reads, and
`cmem/` is what the WORKFLOW reads** — three days later five control bytes had accumulated
there, `tasks.md` and `design-decisions.md` were binary to grep, and the `\b` inside the
ledger's own documented id-lookup command had collapsed to a backspace, so the instruction
for the most routine bookkeeping step in the project matched nothing (T13.28).

Gate now covers `src/`, `tests/`, `cmem/` and `README.md`, `.md` as well as `.ts` — and it
immediately caught four MORE bytes introduced while writing up the rule about them. Same
root cause every time: a two-character escape (`\b`, `\0`) collapsed by shell quoting while
editing through one-liners. **The durable answer is the gate, not the discipline.**

### The audit method has its own failure mode, and it fired (T13.25, 2026-08-25)

A NUL byte written into `binaryen-bridge.ts` — our own sentinel — made grep treat the file
as BINARY. It printed `Binary file … matches` instead of the matches, the bridge dropped out
of an alignment-duplication sweep, and **the sweep reported clean**. Type-check, lint, fmt
and 376 tests stayed green throughout, because a NUL is legal in a TS string literal.

Every enumeration in the audit definition is grep-driven, so this invalidates RESULTS rather
than producing wrong output, and no green gate can see it. Now gated
(`tests/audit/source_hygiene.test.ts`), and the standing instruction is to **pin the
population** in any source enumeration — assert a floor on what was scanned — so a walk that
silently finds nothing fails instead of passing.

### The bridge keeps its own label stack, and it has diverged twice (T13.22 / T13.24)

`bridgeExpr` maintains `ctx.labelStack` and resolves `br` depths against it, duplicating
work `resolveNames` already does correctly. Both divergences found so far are off-by-ones
in that bookkeeping: **T13.22** resolves `try_table` catch clauses after pushing the
try_table's own label (currently cancelled by binaryen-ts 1.0.9, held for the coordinated
fix), and **T13.24** pushed no frame at all for `if` — so every `br` inside one was one
frame too shallow, silently retargeting the enclosing block in one direction and rejecting
valid input in the other. T13.24 is fixed; nothing cancelled it.

The second was found by SCOPING the first — enumerating every `labelStack` push/pop
against the cases that need one, about five minutes. See [bridge.md](bridge.md).

### The binaryen-ts pin is a CORRECTNESS pin (T13.22 / T13.23, 2026-08-25)

`deno.json` names `@jrmarcum/binaryen-ts@1.0.9` **exactly, with no caret**, and that is
load-bearing rather than cautious. The bridge is bug-compatible with 1.0.9: its own
`try_table` catch-scope off-by-one cancels a matching one in that version, so a newer
binaryen-ts silently emits the wrong catch depth. It was `^1.0.9` with only `deno.lock`
holding the real version while JSR already carried 1.4.3 — a `deno cache --reload` would
have floated it with no commit and nothing to review. **binaryen-ts have gated their 1.5.0
on the coordinated fix; ours is written and held.** Detail: [bridge.md](bridge.md) ⚠
block, `tasks.md` T13.22 / T13.23.

None of this reaches a consumer — no published entrypoint touches the bridge.

### Post-1.4.0 audit (2026-08-25) — six findings, then hardening: 2 in the first four passes, 2 more in the fifth

A "look for code issues" pass run AFTER the release, starting from lint clean,
`deno task check` clean, 363 tests passing and all seven metrics exhausted.
Neither finding moved a metric, and neither could.

- **`resolveNames` never walked `table.get`'s index sub-expression** (T13.11).
  It shared a `case` label with `table.size`, which IS a leaf, and inherited its
  body — so a name inside the index survived into the fail-loud `writeVar` and
  **valid WAT failed to encode at all**: `(table.get $t (global.get $g))` and
  `(table.get $t (call $f))` both died with `unresolved name-var`. Its sibling
  `table.set` handled both of its operands correctly three lines below.
- **The two SIGNED LEB encoders still repaired their input** (T13.12). Both
  unsigned encoders were hardened in T13.2 and the signed pair beside them was
  left on `value | 0` / `BigInt.asIntN(64, …)`, which wrap. Unreachable from WAT
  — verified, not assumed — but `writeBinaryIr` is a published entrypoint.
- **Twelve GC operand checks that a sibling handler already had** (T13.14).
  `wasmValidate` ACCEPTED twelve module shapes that V8 and Wasmtime 47.0.3 both
  reject — cross-hierarchy `ref.test` / `ref.cast`, `array.len` on a non-array,
  wholly unchecked `ref.i31` / `i31.get_*` / `ref.is_null` / `ref.as_non_null`
  operands, and all four illegal packed-field signedness combinations for
  `struct.get` / `array.get`. Four roots, every one the same asymmetry:
  `onBrOnCast` had checked its type relationship since T9.x and its two
  siblings never did; `onStructGet` declared the signedness flag as `_signed`
  and dropped it while `onArrayGet` did not take it at all.

- **`data.drop` / `elem.drop` swallowed a value and the compiler DELETED it**
  (T13.16). Both are `[] -> []`, but `instrInputCount` had them in the arity-1
  group beside `table.get` / `ref.test` / `memory.grow`, so the folded parser
  popped a value from the surrounding scope into a slot that does not exist and
  discarded it. `(call $bump) (data.drop $d)` emitted a module **V8 and Wasmtime
  both accept, that runs, and that returns the wrong answer**, with no
  diagnostic anywhere. The worst failure mode in the audit definition, and the
  same structure as T13.11: a `case` label shared with instructions that do not
  match.
- **The SIMD lane ops ignored the memory index type** (T13.15). `onSimdLoadLane`
  / `onSimdStoreLane` declared `is64` and dropped it, so on a 64-bit memory a
  correct i64 address was REJECTED and an incorrect i32 one accepted — both
  failure modes at once. **T9.11 fixed the `offset` parameter for this same pair
  of handlers and left `is64` behind.**
- **`rethrow` ignored its depth** (T13.17). `(func (rethrow 0))` with no `try`
  anywhere validated clean. Low severity, and for a reason worth recording:
  legacy EH is the one family the three-engine panel cannot judge — Wasmtime and
  Wasmer both refuse `try` outright — so V8 is the only oracle, and these
  modules do not run on the primary WASI host regardless.

**Why no metric could catch T13.14, and what to do instead:** validator
agreement asks "of the modules V8 accepts, how many do we accept?" — it counts
false REJECTIONS only, so a permissive validator is *structurally* outside its
population, and `assert_invalid` only covers the invalid modules the spec suite
happens to contain, which include none of these. The counter-measure is a
hand-built INVALID corpus, and it is about twenty lines. See
[best-practices.md](best-practices.md).

**The method note that matters more than either bug:** T13.7's own 64-case
named-reference guard *covers* `table.get`, and still missed T13.11. It varied
only WHERE the name appears, pinning every operand to a literal; this bug lives
in the operand. And the type-enumeration audit that found the atomic `memidx` gap
came back clean here — because it had only ever been run on `Var`-typed fields,
and this was an `Expr`-typed field. **A guard, and an audit, is only as wide as
the axis it varies.** Both axes are now written into the audit definition in
[INDEX.md](INDEX.md).

A follow-up (T13.13) closed the axis gap that let T13.11 through: the guard now
carries **both** axes — 64 named-reference POSITIONS and 69 named-reference
OPERANDS — and asserts V8 accepts each encoding. The operand axis came back
69 / 69 clean, but adding it exposed that **2 of the original 64 fixtures were
themselves invalid wasm**, unnoticed for four releases because the suite only
checked that `wat2wasm` returned bytes.

Gate after all four: **367 tests / 2609 steps**, lint and typecheck clean, and
the metrics **re-measured rather than assumed** — parse-clean 257 / 257,
encode+V8 2119 / 2120, round-trip 2119 / 2119, wasmtk corpus 272 / 272 encode
and round-trip, **zero throws**. Worth doing despite a solid argument that
nothing could move: T13.12 adds a `throw` to a path every encode runs through,
and only a measurement can show it never fires. Detail and the
population caveat on the corpus figure: [tasks.md](tasks.md).

**Then two more (T13.20, T13.21), both from the same starting point.**
`applyNames` — `resolveNames`'s sibling, published from the package root and
used by no internal pipeline — had never been run through the two-axis
enumeration that made `resolveNames` correct, and **50 of 87 expression kinds
fell through**, so naming came out silently inconsistent (a `global.get` named
at statement position and numeric inside `memory.fill`). Scoping that SHAPE
across the rest of `src/` rather than stopping at the instance then found
T13.21: two coupled switches in the WAT writer whose drift writes an operand
twice and **still reparses**. The scoping pass took ten minutes and produced the
thing the bug report could not — a map of all 24 `switch (x.kind)` sites, the
ones that are fine, and why. See [tasks.md](tasks.md).

**The rule that came out of it:** a partial switch over expression kinds is safe
or not according to the DIRECTION of its `default`. `isConstExpr` covers 13
kinds and is completely safe because anything off its allowlist is rejected on
sight; `applyNames` returned the node unchanged. Read the `default` before the
case count.

**An earlier pass (T13.18) run FROM the recurrence table found no new
wrong-answer bugs** — one dead duplicate alignment table removed, one silent
`default: return 0` landing pad hardened behind a self-policing gate, and three
axes verified CLEAN and recorded as such. That is the expected shape: a
recurrence table's yield decays as it is used, because the pass that writes a
row usually sweeps it. Detail, including why the three negative results are
written down, is in [tasks.md](tasks.md) and
[best-practices.md](best-practices.md).

T13.16 is the one that should worry a reader most, and no metric moved for it
either: round-trip and parse-clean came back **byte-identical to a reverted
baseline**, because no spec-testsuite or wasmtk-corpus module puts a stacked
value immediately before a `data.drop`. Five metrics, 367 tests and a clean lint
were all green over a compiler that deleted an instruction. It was found by the
`instrInputCount` vs `buildPlainExpr` axis named in the audit definition — a scan
whose six hits included four regex artifacts, which is a reminder that **a noisy
mechanical enumeration is still worth running and triaging by hand.**

T13.14 tightens the validator, so it needed the measurement in the OTHER
direction as well — the one a false-accept fix can break. **449 / 449
V8-accepted spec modules still validate (zero false rejects)**, and
`assert_invalid` is unchanged at 2671 / 2678 on that harness with the same 7
pre-existing misses. Both numbers were re-run **with the three edited validator
files reverted** and came back byte-identical, which is what makes them a
baseline rather than a coincidence of the new code. wasmtk corpus validation is
unchanged at 265 / 272 (the 7 are the known `KNOWN_INVALID` stale-snapshot
files). A tightening change needs both directions measured; the false-reject
sweep is the one that is easy to skip and the only one that can show
over-correction.

### The blind spot the metrics cannot cover

**The 257-file testsuite snapshot contains NO atomics** — no `atomic.wast`, no
shared-memory file, not one `atomic.load` / `store` / `rmw`. The whole threads
proposal sits outside the population every metric measures, and two real bugs
lived there undisturbed. A corpus-shaped metric is only as complete as its
corpus: **the proposals the corpus lacks ARE the blind spot**, and that list is
worth producing before trusting "all eight green".

The tests added for this reason need neither a corpus nor an oracle, and each
found something the corpus metrics could not — see [testing.md](testing.md):
folded-vs-linear (arity), named-vs-numeric references, every atomic opcode
against V8, and the feature gates.

**Open, and not ours to fix:** wasmtk's legacy-EH emission — Wasmtime and Wasmer
both reject it, file for file, and `try_table` reaches parity. Written up in
`scripts/wasmtk-eh-parity-report.md`, together with a RETRACTED second finding
(an "unused `$__exn_tag`") that came from grepping the frozen snapshot and does
not hold against current wasic.

## Repo layout

```text
wabt-ts/
├── upstream/              ← original wabt C++ source (reference only, not built)
│   ├── src/ include/      ← C++ source + headers — open alongside the .ts when porting
│   └── test/ docs/ …
├── src/                   ← TypeScript source (this project)
│   ├── core/              ← Phase 1: types, opcodes, leb128, literals, errors, result
│   ├── ir/                ← Phase 2: Expr union, visitor, apply/resolve/generate-names
│   ├── reader/            ← Phase 3: binary reader → IR
│   ├── writer/            ← Phase 3+4: binary writer, stream, WAT pretty-printer
│   ├── parser/            ← Phase 4: lexer-source, wast-lexer, token, wast-parser
│   ├── validator/         ← Phase 5: type-checker, shared-validator, validator
│   ├── bridge/            ← Phase 7: binaryen-bridge, type-map
│   ├── api/               ← wabt-compat facade (jsr:.../compat)
│   ├── tools/             ← Phase 6 CLI tools (only place Deno.* I/O is allowed)
│   └── index.ts           ← public API surface for wasmtk
├── tests/                 ← core/ reader/ writer/ parser/ validator/ bridge/ tools/ api/ wasmtk/ fixtures/
├── binaryen-ts/           ← peer-project submodule (bridge target; read-only reference)
├── wasmtk/                ← consumer submodule (reference for wasm2ts reverse-compilation)
├── deno.json              ← Deno config, import map, tasks
├── package.json           ← Bun config (no tsconfig.json / vitest.config.ts — deleted)
└── cmem/                  ← this portable project-memory folder
```

The original wabt C++ source is preserved in `upstream/` as reference — open it alongside the
corresponding `.ts` file when porting, or diff against it when pulling upstream changes. The
per-phase TS↔C++ file mapping lives in [phases.md](phases.md).

## Sibling projects

- **binaryen-ts** — TypeScript port of binaryen; the optimize/encode back end. wabt-ts calls its
  constructor API directly through the Phase 7 bridge. See [bridge.md](bridge.md). The two will
  eventually merge into **binaryang**.
- **wasmtk** — the consumer; compiles TypeScript → WAT today, and is the reference for the planned
  `wasm2ts` reverse compiler (Phase 8).

## Production pipeline (binaryang cross-project)

```text
validate(wabt-ts) → strip(wabt-ts) → bridge → optimize(binaryen-ts) → encode(binaryen-ts)
```

binaryen-ts is the canonical encoder for _optimized_ wasm; wabt-ts's encoder serves format tools
(`wasm2wat`/`wat2wasm` round-trips, strip, validate). wabt-ts's WAT parser is the front door for all
external `.wat` input.
