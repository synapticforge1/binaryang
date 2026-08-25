<!--
  Relocated from the repo root (TASKS.md) into cmem/ on 2026-06-09 so all
  project memory lives in one committed, portable place. This is the GRANULAR
  implementation status / decision log; cmem/phases.md is the distilled
  summary. See cmem/INDEX.md for the policy.
-->

# TASKS.md — wabt-ts Progress & Decisions

This file tracks implementation status, open questions, and architectural decisions.
All project context authoritative source: `CLAUDE.md`.

## Tranche ledger — numbering, including items found after the original scope

The original T1–T6 scope was derived by clustering **parse** failures. Anything
that parses and then misencodes was invisible to it (see the blind-spot entry
below), so a second family — T7 — was opened for semantic correctness, and
several parse-side items surfaced that no original tranche covered. Those get
`T5.n` / `T6.n` where they belong to an existing feature area, and `T8.n`
where they are genuinely new.

**Numbering rule:** a decimal extends an existing tranche's feature area; a new
integer opens a new area. Never renumber a closed item — the commit messages
reference these ids.

**Picking the next id — do NOT eyeball the ledger.** The ledger table below is
ordered by when an item was CLOSED, not by number, and detailed write-ups live
further down the file under `### T<n>.<m>` headings. An id can therefore exist
in one place and not the other. On 2026-08-25 a round of work was written up as
T13.11 because that looked free from the prose; T13.11–T13.13 were already
taken, and every heading, code comment and test name had to be renumbered.
Take the max of BOTH:

```sh
# highest id in the tranche you are extending (here: 13)
grep -ohE '\bT13\.[0-9]+' cmem/tasks.md | sort -t. -k2 -n | tail -1
```

Then check the candidate does not already appear in `src/` or `tests/` from an
earlier item: `grep -rn "T13.<next>" src/ tests/`, substituting the number.

**Write the placeholder, never a literal candidate id.** A well-formed id in
this file is indistinguishable from a real one, so an example id written into
these instructions is immediately reported as taken by the command directly
above them. The first draft of this block did that twice — once in the example,
and once again in the sentence warning about the example. Any id-shaped literal
in this ledger is data, whether or not it was meant as one.

**Every item gets a ledger row, not just a write-up.** The row is the index;
the `### T<n>.<m>` section is the detail. T13.14–T13.18 were written up in full
across three sessions and registered in the ledger by none of them — so the one
place a reader looks first said the work did not exist. If you only have time
for one, write the row.

**Status vocabulary**, as used in the headings and the ledger:

| form | means |
| --- | --- |
| `### T<n>.<m> — DONE.` | fixed, gated by a regression test, metrics re-measured |
| `done — <metric delta>` (ledger) | same, with the number it moved; `no metric moved` is a legitimate and common result |
| `~~T<n>.<m>~~ … closed` | absorbed into another item or invalidated — kept struck through, never deleted |
| a `RETRACTED` note in the body | the finding itself was wrong; the entry stays with the correction, because the wrong claim may already have gone upstream |
| `### T<n>.<m> — NO DEFECTS FOUND` | a full audit pass that found nothing. Gets an id and a ledger row like any other, because "clean" and "never examined" are indistinguishable from the code. The body must say what was VARIED and why each answer holds, so the next pass can check the reasoning rather than re-derive it (T13.27) |
| `### T<n>.<m> — BLOCKED (…)` | diagnosed and understood, deliberately NOT fixed, because applying the fix alone would make things worse. The heading must name the TRIGGER that unblocks it, and the ledger row must say `BLOCKED, not done` — a blocked item read as a done one is how a coupled fix ships half-applied (T13.22) |

### Closed

| id | Scope | Result |
| --- | --- | --- |
| T1 | Numeric literals (negative hex, hex-float exponent, NaN payload separators) | done — +25 files |
| T2 | Small grammar gaps + GC array bulk ops | done — +34 files |
| T3 | Multi-memory | done — +35 files |
| T4 | table64 / memory64 index types + table definition shapes | done — +16 files |
| T6.1 | Block params / multi-value block results | done (absorbed during T7) |
| T6.2 | Elem segment typed-ref element types | done (absorbed during T4) |
| T6.3 | Table inline-elem forms | done (absorbed during T4) |
| T7.1 | Parser robustness — never throw, never hang, readable diagnostics | done |
| T7.2 | Packed-type wire bytes; `br_table` / `try_table` name resolution | done |
| T7.3 | Quoted identifiers, UTF-8 strings, type-use signatures, block types | done — +3 parse, +5 encode |
| T7.4 | Typed-ref IR refactor (`ValueType`) | done — encode +13 |
| T7.5 | Multi-value branches (`br` / `br_if` / `br_table`) | done — encode +14 |
| T7.6 | `try_table` catch target depth | done — encode +2 |
| T5 | GC `(rec …)` recursive type groups and `(sub …)` subtyping | done — parse +7, encode +5 |
| T5.1 | `any.convert_extern` / `extern.convert_any` | done — parse +1, encode +1 |
| T8.3 | WAT writer emitted multi-instruction const exprs as one folded paren | done (found via T5.1) |
| T7.7 | Relaxed SIMD aliased onto low SIMD opcodes (opcode packing too narrow) | done — encode +7 |
| T6.4 | `(module definition …)` / `(module instance …)` | done — parse +5, encode +5 |
| T5.2 | Abbreviated heap-type immediate (`ref.cast i31ref`) | done — parse +3, encode +3 |
| T8.1 | Block type-use + inline signature | done |
| T8.2 | `select` with several result groups | done |
| T8.4 | Tag declared with a type-use | done (new) |
| T8.5 | Folded `if` condition spanning several instructions | done (new) |
| T6.5 | `(@annotation …)` custom annotations | done — parse +1, encode +1 |
| T5.3 | `br_on_cast` / `br_on_cast_fail` — never implemented | done — parse +2 (257/257), encode +2 |
| T9.1 | Binary reader had no `pushStmt` — silent reordering | done — round-trip INVALID 60 → 27 |
| T7.8 | Type-uses that resolve against an incomplete type index space | done — encode +6 |
| T7.11 | Element segments against a non-nullable table | done — encode +2 |
| T7.12 | `br_on_null` / `br_on_non_null` carrying branch values | done — encode +2 |
| T7.13 | UTF-8 BOM stripped from names | done — encode +1 |
| T7.14 | Explicit type-use overwritten by a structural signature match | done — encode +1 |
| T9.2 | Our validator rejecting modules V8 accepts | done — agreement 1702 → 2120/2120 |
| T9.3 | Validator on `ValueType`; real reference subtyping | done — assert_invalid caught 1806 → 1834 |
| T9.4 | The 10 valid modules T9.3's lattice rejected | done — agreement back to 2120/2120 |
| T9.5 | Modules the spec says are invalid that we validated clean | done — assert_invalid 2395 → 2532/2737 |
| T9.6 | Module-level structural checks that did not exist | done — assert_invalid 2532 → 2579/2737 |
| T9.7 | Declared subtyping, ref.eq, select, defaultability, type scope | done — assert_invalid 2579 → 2629/2737 |
| T11 | The pipeline rewrote an INVALID module into a valid one | done — assert_invalid 2629 → 2632/2737 |
| T9.8 | One-armed `if` arity; try_table catch-clause label types | done — assert_invalid 2632 → 2641/2737 |
| T9.9 | Immediate-vs-immediate rules, and local-init tracking | done — assert_invalid 2641 → 2658/2737 |
| T9.10 | The last invalid modules V8 rejects that we did not | done — **ours: 0 remaining** |
| T10.1 | Export ORDER not preserved across a `wasm2wat` round-trip | done — round-trip 1961 → 2041 / 2120 |
| T10.2 | Inline `(export …)` emitted on IMPORTED items — unparseable output | done (same fix) — hard failures 12 → 1 |
| T10.5 | Linear-form `call` drained the whole operand stack | done — WASI corpus 50 → 225 / 270 |
| T10.8 | A synthesized operand slot-filler was written out as a real `nop` | done — WASI corpus **270 / 270** |
| T9.11 | Ten of the twelve memarg handlers never checked the offset | done — 4 SIMD false-accepts closed |
| T12.1 | Out-of-range integer and float constants silently truncated/overflowed | done — malformed 666 → 698 / 1229 |
| T12.2 | An import after a definition was accepted and silently RENUMBERED the module | done — malformed 698 → 714 / 1229 |
| T12.3 | A non-power-of-two `align=N` was accepted and silently CHANGED | done — malformed 714 → 828 / 1229 |
| T12.4 | SIMD lane immediates and `v128.const` lane values wrapped silently | done — malformed 828 → 869 / 1229 |
| T12.5 | A wasm NAME must be valid UTF-8 — neither path checked | done — quoted 869 → 1045, **binary 110 → 638** |
| T12.6 | A missing lane immediate compiled as lane 0; NaN result patterns accepted as literals | done — quoted 1045 → 1087 |
| T12.7 | Annotations skipped at the CHARACTER level; a closing label and an inline signature both read and discarded | done — quoted 1087 → **1183**; closes T12.6 |
| T12.8 | The binary reader resynchronised instead of reporting | done — binary 638 → **711 / 711**, the metric is CLOSED |
| T12.9 | Duplicate ids, `nan:0x0`, lane immediates, token boundaries, a second `(start …)`, forward type uses | done — quoted 1183 → **1227 / 1229** at the parser, **1229 / 1229** through `wat2wasm` |
| T13.1 | The parser now reports an out-of-scope branch target | done — quoted **1229 / 1229** at the parser too |
| T13.2 | The last 19 `assert_invalid` modules — 16 were the ENCODER repairing them | done — **2683 / 2683**; the metric is CLOSED |
| T13.3 | `Limits.initial` / `max` are `bigint` — a 64-bit limit could not be REPRESENTED | done — V8-valid 2118 → **2119**, agreement and round-trip likewise; **breaking API change** |
| T13.4 | Custom page sizes, wired end to end — the proposal was half-built and semantically wrong | done — no metric covers it; design taken from wazmrt |
| T13.5 | Three more reserved bytes read into nowhere — tag attribute (×2), table init reserved | done — no metric could see them; found by grepping the SHAPE |
| T13.6 | Two type-level table audits made PERMANENT — lexer⇄printer names, natural-alignment coverage | done — both clean; 3 exemptions found and each guarded |
| T13.7 | A NAMED reference in every position the grammar allows | done — 64/64 on `main`, **21 fail at v1.3.5**; the class that blocked wasmtk |
| T13.8 | `instrInputCount` disagreed with `buildPlainExpr` for 3 atomic families | done — **`wasm2wat` was emitting INVALID wasm for every atomic store/RMW** |
| T13.9 | The validator type-checked every ATOMIC as `(v128,v128)→v128` | done — a false REJECTION of every atomic memory op; 67 opcodes now agree with V8 |
| T13.10 | 9 of 21 feature flags gated NOTHING | done — all 21 gate now, plus `--enable-*` CLI flags; **no metric moved, the project's own tests were the canary** |
| T13.11 | `resolveNames` never walked `table.get`'s INDEX sub-expression | done — valid WAT failed to encode outright; **T13.7's own 64-case guard covers `table.get` and still missed it** |
| T13.12 | The two SIGNED LEB encoders still repaired out-of-range input | done — bitwise-or-zero / `asIntN` wrapped silently while both unsigned siblings threw |
| T13.13 | T13.7's guard varied only ONE axis, and 2 of its own 64 fixtures were invalid wasm | done — operand axis added (69 cases, no new product bug), fixtures fixed, V8-validity now asserted |
| T10.3 | A non-nullable table element type lost its initializer | done — testsuite 2088 → 2102 / 2120 |
| T10.6 | Linear `try_table` was a stub; `array.new_fixed` drained the stack | done — testsuite 2102 → 2111 / 2120 |
| T10.7 | Tag type matched by identity, so a typed-ref param made encode THROW | done — hard failures 1 → 0 |
| T10.4 | NaN payloads mangled; `return_call_indirect` lost its table index | done — **round-trip 2120 / 2120** |
| T13.14 | 12 GC operand checks a sibling handler already had — cross-hierarchy `ref.test`/`ref.cast`, unchecked `ref.i31`/`i31.get_*`/`ref.is_null`/`ref.as_non_null`, packed-field signedness | done — all 12 were FALSE ACCEPTS; **no metric could see them** (agreement counts only false rejections) |
| T13.15 | The SIMD lane memory ops ignored the memory INDEX TYPE | done — wrong in BOTH directions on a 64-bit memory; **T9.11 fixed `offset` for these same two handlers and left `is64`** |
| T13.16 | `data.drop` / `elem.drop` sat in the arity-1 group and SWALLOWED the preceding instruction | done — **wrong code emitted**: both engines accept, it runs, it returns a different answer |
| T13.17 | `rethrow` ignored its depth, so a rethrow with no enclosing catch validated | done — legacy EH only, where **V8 is the sole available oracle** |
| T13.18 | Removed a dead duplicate alignment table; made `instrInputCount` total behind a source-enumeration gate | done — **no new wrong-answer bugs; 3 axes verified CLEAN** and recorded as such |
| T13.19 | The ledger did not index its own last 5 items or say how to pick the next id; 3 code sections did not declare their membership invariants | done — no product change; **the numbering procedure is now documented and self-tested**, and the 3 sections that have each been joined wrongly now carry INTENT blocks |
| T13.20 | `applyNames` walked 37 of 87 expression kinds — `resolveNames`'s sibling, never run through the same two-axis enumeration | done — **published API produced silently INCONSISTENT naming**; axis 1 is now generic and cannot miss a kind, axis 2 an explicit 55-kind table |
| T13.21 | `constExprOperands` and `writeInstrHead` are coupled in the WAT writer and nothing said so | done — latent, not live: drift writes an operand TWICE and the output still REPARSES (T10.6's shape). Both now carry INTENT blocks and a source-enumeration gate |
| T13.22 | The bridge resolves `try_table` catch targets AFTER pushing the try_table's own label — the T7.6 / T9.8 off-by-one in a third layer | **BLOCKED, not done** — it cancels a matching off-by-one in binaryen-ts 1.0.9, so fixing it alone turns correct bytes into wrong ones. Lands with the dependency bump |
| T13.47 | binaryen-ts shipped **1.5.0** with their half of the catch-scope fix. Upgrade attempted, verified, **NOT landed** | **BLOCKED, and not by what we were waiting for.** Our half is done and proven (full 2x2 vs our own encoder; 3 of 4 cells emit bytes **V8 still accepts**). Blocked by (1) Deno's 24h `minimumDependencyAge` — CI hits it too; (2) **12 of 28 bridge tests fail** on 1.5.0 with `unresolved GC function type`: their `gcFuncTypeIndex` wants an exact declared func heap type, our `coarsenValueType` maps `(ref $T)` -> `structref`, so no key can match. **Their import-surface check (0 of 72 missing, verified here) did not predict it.** Asked them about a compatibility path before de-coarsening |
| T13.46 | The corpus was still the stale 2026-05-25 snapshot — stamping it made it honest, not current | done — **regenerated all 417 wasic sources from wasmtk `4600ba9`** (verified level with `origin/main`): 413 compiled, 4 are wasic compile failures. Corpus **272 -> 421** (413 fresh + 8 preserved non-wasic fixtures). **encode 421/421, validate 421/421, round-trip 421/421**, up from 265/272 validating. `KNOWN_INVALID` **emptied** — all seven fired their "now VALIDATES" assertion simultaneously, proving the gate was right and only its INPUT was stale. The 373-vs-413 count difference with wasmtk is recorded UNRECONCILED on purpose |
| T13.45 | `tests/wasmtk/PROVENANCE.md` said the snapshot date and source commit were **unknown**. Both were false — one `git log --diff-filter=A` in THIS repo answers it | done — raised by the wasmtk team after **asking twice**. The corpus is a single capture (`fbafca9e`, 2026-05-25 21:50), not an accretion; source bounded to wasmtk **`e147d28`** because the next upstream commit is 3 days later. **The snapshot has caused THREE wrong reports to them, not one** (KNOWN_INVALID seven, EH scope 6-vs-10, retracted `needsExceptionTag` five) — all caught by the recipient. Stamped and gated; the file-count assertion catches a refresh that skips re-stamping |
| T13.44 | T13.43's test covered `releaseBlockers` but **not that `publish.ts` calls it** — delete the guard block and all 12 cases still pass, because the pure function is untouched | done — structural gate on the WIRING: guard imported and called, **no mutating git subcommand before it** (every `['git', <sub>]` extracted in source order and classified against a read-only allowlist), refuses rather than warns, `release-guard.ts` stays side-effect free so it stays importable, `scripts/` stays in the gate, and the mutations still exist AFTER the guard so it cannot pass vacuously. **Verified by injecting all four faults** |
| T13.43 | **`deno task publish` would have released a version containing none of the work.** It stages `deno.json` and nothing else, then tags and pushes — and the tag is what JSR publishes. Two documents said it "refuses if the working tree is dirty"; **no such check existed**, and `publish.ts` force-tagged regardless | done — live at the time: **56 dirty paths, 15 unreleased user-visible fixes**, and a JSR version is immutable. Dirty-tree + remote-tag guards added ahead of any mutation (refuses, exit 1, stages nothing). Untestable by construction — `publish.ts` pushes at IMPORT time — so the pure part moved to `scripts/release-guard.ts` with 12 cases, the most important being the one that must NOT block. Same pass: `scripts/` was covered by **no gate at all** (check, lint and fmt all listed only `src/` + `tests/`); now 164 -> 172 files |
| T13.42 | The documented per-file format check passed `--ext ts -` on stdin, which **does not read `deno.json`** — so it used lineWidth 80 instead of 100 and drowned in its own false positives, while `deno fmt --check FILE` drowned in the CRLF false alarm | done — **two files would have failed CI on push** (a 101-char import from T13.29, a template literal from T13.30), invisible behind a standing, documented, worked-around false alarm. Corrected command validated BOTH ways: clears 11 of 12 false alarms and still fires on a deliberately re-broken file |
| T13.41 | **`wasm-strip` relocated every custom section it kept** — the writer emitted all customs in one block at the END and `Custom` carried no position. `dylink.0` must be FIRST, so stripping debug info from a dynamically-linked module broke it | done — `--sections` **0 / 265 -> 265 / 265**. The corpus could not see it: `wat2wasm` emits no customs, so every strip input had **nothing to strip** and the identity oracle passed vacuously. 3 encoder-waste axes clean (empty sections, duplicate types, stray datacount). **Ninth metric added: binary -> IR -> binary, 30 / 88** — the path `wasm-strip` uses, invisible to the text round trip because WAT drops customs |
| T13.40 | **Every section header the writer emitted was 4 bytes too long** — `patchU32Leb` wrote a fixed-width 5-byte LEB and left the back-patch padding; upstream wabt canonicalises by default and that half was never ported. Also: the round-trip metric summed two populations | done — **wasmtk WASI corpus 628,201 -> 607,845 bytes, 3.2% smaller**. Split by input source, round-trip FIDELITY was already **2119 / 2119** (our own output) and the 83 "failures" were re-encodings of crafted bytes; binary-sourced 5/88 -> **27/88**. Raised by the owner. My "almost all non-minimal LEB" explanation of those 83 was asserted WITHOUT CHECKING and was wrong |
| T13.39 | The session conformance harnesses reassembled the `wat2wasm` pipeline and **omitted `synthesizeTypes`**, so nearly every module was rejected for a fault the harness created | done — **the denominator was 5x too small**: agreement 449/449 -> **2207/2207**, `assert_invalid` 2673/2678 -> **2694/2694**, round-trip 364/449 -> **2124/2207**; the 13 "throws" and 5 "false accepts" were both artifacts. Invisible because a broken harness SCORES BETTER on a rejection-counting metric. Same-instrument conclusions stand; the absolute numbers written into `cmem/` this session did not, and are corrected in place |
| T13.38 | The spec answer key applied to the other two populations: `assert_invalid` (validator, 2683) and quoted `assert_malformed` (parser, 1229). The validator was fine; **the parser reported a misspelled instruction by blaming a parenthesis** | done — the most common WAT authoring error produced `unexpected ( in function body`, or leaked the internal token name `Reserved`, and never named the operator. One helper wired into 3 sites; **559 -> 816 / 1229**. T13.32 reachability gate had `Reserved` on its "never consumed, and fine" allowlist — **the symptom sat in a passing test the whole time** |
| T13.37 | The spec testsuite carries the EXPECTED ERROR TEXT for every `assert_malformed`, and our metric read only the modules | done — **70 of 711 rejected with wording the spec does not recognise**; one was a real misdiagnosis (a 4-byte file reported as truncated when its MAGIC was wrong, because the version was read before the magic was compared), the rest two LEB faults sharing one name. 608 -> **689/711 exact**. All conformance metrics unchanged, which is the point |
| T13.36 | Fourth hardening pass: module-level mutable state, text-side round-trip CONVERGENCE, gate vacuity | **NO DEFECTS FOUND.** Zero `let`/`var` at module scope in all of `src/`; 272/272 corpus files reach a text fixed point at iteration 1. **Also corrects my own over-claim** that "hardening does not decay" — 2 findings in 4 passes, last two empty |
| T13.35 | Third hardening pass: size amplification, string/name scaling, diagnostic accuracy | **NO DEFECTS FOUND.** Two axes clean. The third is **INCONCLUSIVE, not clean** — the cheap oracle flagged 32 cases and every one examined was correct behaviour. Six `ours=ACCEPT / v8=reject` size cases: **Wasmtime accepts all six**, so they are engine limits and we are right |
| T13.34 | Subtyping depth (capped at 63 by the GC proposal) and supertype CYCLES were both unchecked | done — **both engines reject, we accepted**: a 2000-deep chain and `$a <: $b <: $a` validated clean. Second hardening pass. The cycle half was found by DISBELIEVING a comment I had just written claiming something else reported it |
| T13.33 | `readTypeSection` put the section bound in the loop CONDITION, so a declared count outrunning the entries ended the loop silently | done — **`(type count 4294967295)` with no entries decoded to zero types and validated clean**; V8 rejects it. One reader of eleven. Found by HARDENING (does it notice?) after fuzzing (does it throw?) had passed. 3 hardening axes clean: no hang on huge counts, no stack overflow at 100k nesting, no superlinear scaling |
| T13.32 | The lexer — the last frontier item. 182 `TokenType` members differentialled against lexer/parser references | **NO DEFECTS FOUND** — 2 never-emitted members, both deliberate and already explained in place. Gated anyway: **a deleted `KEYWORDS` entry is not a compile error, it is valid WAT quietly failing to parse.** The frontier list is now empty |
| T13.31 | All five CLI shims dumped a Deno stack trace on a mistyped filename | done — **10 of 10 failure cases**: uncaught `NotFound` / `IsADirectory` with Deno internals and our absolute source path, for a typo. `cliRead` / `cliWrite` now print one line and exit 1. **The frontier list did not mention the CLI shims at all** |
| T13.30 | `/compat.toBinary` threw the binary writer's raw internal string, undocumented, while its two siblings throw formatted errors they document | done — the **wasmtk-facing migration surface**. Reachable with no caller mistake: decode succeeds, encode cannot. Also verified `wat2wasm` never throws across 2505 malformed-text inputs |
| T13.29 | All four binary tools threw uncaught `RangeError` on malformed input | done — **~102 of 585 fuzz inputs crashed each of `wasm2wat` / `wasm-validate` / `wasm-objdump` / `wasm-strip`**, whose contract is `{ errors, result }`. T7.1's "never throw" rule applied to the binary path at last. `leb128.ts` still throws by design; the conversion is at the reader boundary |
| T13.28 | The T13.25 hygiene gate covered `src/` + `tests/` only; five control bytes had accumulated in `cmem/` | done — `cmem/tasks.md` and `design-decisions.md` were BINARY to grep, and **the documented id-lookup command had its `\b` collapsed to a backspace**. Gate extended to every file the workflow greps. Also: `ModuleContext.getExprArity` is dead and a perf invariant rested on it |
| T13.27 | Six axes over `binary-reader.ts` and `wasm-strip` | **NO DEFECTS FOUND** — recorded so the next pass starts elsewhere. `wasm-strip` (a published, MUTATING entrypoint never audited before) is a byte-identical no-op on 10 custom-section-free modules and removes exactly the custom sections on 4 more |
| T13.26 | `readMemArg` decoded alignment with `1 <<`, so an exponent of 32 WRAPPED to align=1 | done — **`assert_invalid` 2671 → 2673**, the first metric to move in many rounds. Silent T11-class REPAIR: an invalid module disassembled to `align=1` and re-encoded to one both engines accept |
| T13.25 | A NUL byte in `binaryen-bridge.ts` made it BINARY to grep — an alignment sweep skipped the file and reported clean | done — self-inflicted, and it attacks the AUDIT METHOD: every enumeration here is grep-driven. Sentinel made visible; `tests/audit/source_hygiene.test.ts` gates the tree. Re-run sweep: **0 alignment mismatches across 23 load/store opcodes** |
| T13.24 | The bridge pushed no label frame for `if`, so every `br` inside one was off by one | done — **wrong in BOTH directions**: `br 0` silently retargeted the enclosing block (valid module, different answer), `br 1` rejected valid input. Not cancelled by anything. Found by scoping T13.22 |
| T13.23 | The binaryen-ts pin was `^1.0.9` with only the lockfile holding it at 1.0.9, while JSR latest is 1.4.3 | done — **pin made EXACT**; a `deno cache --reload` after their 1.5.0 would otherwise have broken EH output with no version change of ours. Two upstream notes also resolved: their multi-value-writer bug is shadowed by our own bridge throw, and their `delegate` pass bug has **zero exposure** here |

### Open — parse side: NONE

All 257 spec-testsuite files now parse clean. The parse metric is exhausted;
everything remaining is on the encode side (T7.x), measured against V8.

| id | Scope | Files |
| --- | --- | --- |
| ~~T6.5~~ | ~~`(@annotation …)` custom annotations~~ | closed |
| ~~T5.3~~ | ~~`br_on_cast` / `br_on_cast_fail`~~ | closed |
| ~~T8.3~~ | ~~multi-instruction constant expressions in the WAT writer~~ | closed |

### Open — encode side: NONE

**All 257 spec-testsuite files encode to wasm V8 accepts — 2120/2120 modules.**
Both original metrics are exhausted:

| metric | campaign start | now |
| --- | --- | --- |
| parse-clean | 107 / 257 | **257 / 257** |
| fully V8-valid | 180 / 257 | **257 / 257** |

Everything remaining WAS round-trip fidelity (T10) plus the two T9 items.
**All of it is closed as of 2026-08-24** — see "T10 IS CLOSED" below.

### A third metric — round-trip fidelity

The campaign's two metrics (parse-clean, V8-validity) both measure the ENCODE
path. T9.1 was invisible to both: a reordered module is still perfectly valid
wasm. The decode path needs its own number — for each testsuite module we can
encode, `binary -> wasm2wat -> wat2wasm`, then compare bytes AND re-validate.

|  | before T9.1 | after T9.1 | after T7.8-T7.14 |
| --- | --- | --- | --- |
| byte-identical | 1942 / 2105 | 1954 / 2105 | **1960 / 2120** |
| V8-INVALID after round-trip | 60 | 27 | **27** |
| files affected | 76 | 70 | **71** |

The denominator grew because modules that could not encode at all are now in
the population.

**The byte-identity number badly understated T9.1.** The metric that matters
is the second row: 33 modules went from producing INVALID wasm to producing
valid wasm, zero regressions (set-diffed by module, not counted). Always
re-validate a round-trip, don't just diff it — "the bytes moved" and "the
output is broken" are different findings and the first hides the second.

### T10 — the remaining round-trip differences, by cause

**Re-measured 2026-08-21 after the whole T9/T11 sequence: 159 differing
modules, 26 V8-invalid after round-trip.** The seven groups below still
describe it; T10.3 grew (it now covers the elem/array modules T7.11 made
encodable) and T10.6 shrank as the validator work fixed some of the same
producers. Re-run the harness before starting any of them.

This WAS the only campaign metric with open work. **It is exhausted too as of
2026-08-24** — 2120/2120 on the spec testsuite and 270/270 on the wasmtk WASI
corpus. The seven groups below are kept for the record of what each one was
and how it was actually diagnosed; every row is struck through.

**No binaryen-ts involvement, so T10 has no upstream dependency.** The
round-trip path is wabt-ts end to end — `wasm2wat` is our `readBinaryIr` →
`generateNames` → our `writeWatModule`, and `wat2wasm` is our `parseWatModule`
→ `resolveNames` → `synthesizeTypes` → our `writeBinaryIr`. binaryen-ts is
imported in exactly two files, both under `src/bridge/`, which this path never
touches. That matches agreed decision #2 (*binaryen-ts encoder = canonical for
optimized wasm; wabt-ts encoder = format tools and round-trip fidelity only*) —
round-trip fidelity is explicitly ours. T10.1 lives in `wat-writer.ts` and
T10.5 in `binary-reader.ts`; neither is blocked on the upstream findings or on
re-verifying the stale submodule pin.

Classified by evidence (differing binary SECTION + V8 rejection message +
sampled diffs), not by guessing. Some of these may fall out of the remaining
T7 work; re-measure before starting any of them.

| id | Cause | Modules / files | Severity |
| --- | --- | --- | --- |
| ~~**T10.1**~~ | **CLOSED 2026-08-24.** **Export ORDER was not preserved.** The WAT writer attached exports inline to the item they name, so re-parsing rebuilt the export section grouped per item — `a, b, ac` came back as `a, ac, b`. Export order is observable through `WebAssembly.Module.exports()`. `buildExportMap` now tests the abbreviation before using it and falls back to standalone `(export "n" (func $f))` fields in the module's own order. | 69 / 21 | closed |
| ~~**T10.2**~~ | **CLOSED 2026-08-24, same fix.** The writer emitted the inline `(export …)` abbreviation on IMPORTED items, e.g. `(import "M" "f" (func $f0 (export "Mf.call") (result i32)))`. That abbreviation has no place in the import grammar, so **our own parser rejected our own output** — the whole "reparse FAILS" group. | 11 / 6 | closed |
| ~~**T10.3**~~ | **CLOSED 2026-08-24.** The WAT writer dropped `Table.init`, so a non-nullable element type re-encoded to the plain form the spec forbids (there is no default value for it) and V8 rejected the result. New `writeFoldedConstExpr` emits the single folded instruction the table grammar requires, and the writer now THROWS rather than dropping anything it cannot express. | 10 / 4 | closed |
| ~~**T10.4**~~ | **CLOSED 2026-08-24.** The WAT writer stripped the quiet bit before printing a NaN payload, so `f32.const` bits 0x7fffffff came back as 0x7fbfffff — a QUIET NaN turned SIGNALLING. `nan:0x<n>` names the mantissa exactly; the printer was the inverse of a parser nothing calls. | 11 / 6 | closed |
| ~~**T10.5**~~ | **MOSTLY CLOSED 2026-08-24.** Diagnosed wrong for the whole campaign: the dominant producer was not the binary reader but the PARSER — linear-form `call` drained the entire operand stack instead of popping the callee's arity, so a value belonging to a later instruction was swallowed and that instruction's slot got a Nop. Fixed by deferring function-body parsing until every signature is known. What remains is the genuine multi-value case, refiled as **T10.8**. | 39 / 33 | closed → T10.8 |
| ~~**T10.6**~~ | **CLOSED 2026-08-24, and it was two parser bugs rather than a Nop problem.** Linear `try_table` was a stub that skipped its catch clauses AND its body to the matching `end` and built a plain `BlockExpr` (3 modules); `array.new_fixed` drained the operand stack instead of taking its immediate element count (1 module). | 9 / 7 | closed |
| ~~**T10.8**~~ | **CLOSED 2026-08-24.** A multi-result producer is ONE node on the decoder's operand stack, so a second consumer got a Nop stand-in that both writers then emitted as a real instruction. `NopExpr.placeholder` now marks a synthesized slot-filler and neither writer emits one — it means "the value is already on the stack", which wasm spells by writing nothing. | 45 files | closed |
| ~~**T10.7**~~ | **CLOSED 2026-08-24.** `tagTypeIndex` compared signature params with `===`, so two structurally identical `(ref $t)` params never matched and a well-formed module made the encode THROW — with `[object Object]` in the message, because the diagnostic cast each param to a number. The `align64` LEB overflow had already been fixed earlier in the campaign. | 2 / 2 | closed |

**Round-trip fidelity against the WASI corpus is now 270 / 270.** The whole
`+nop` family is gone from the spec testsuite too; what is left there is
exactly T10.3 (14 modules, `table`), T10.4 (13, NaN payloads), T10.6 (4,
`INVALID code`) and T10.7 (1 throw).

## T10 IS CLOSED - round-trip fidelity is 2120 / 2120 (2026-08-24)

All four campaign metrics are now exhausted:

| metric | campaign start | now |
| --- | --- | --- |
| parse-clean | 107 / 257 | **257 / 257** |
| fully V8-valid | 180 / 257 | **257 / 257** |
| validator agreement | 1702 / 2120 | **2120 / 2120** |
| `assert_invalid` rejected | 2395 / 2737† | **2664 / 2683** (all 19 left are ones V8 accepts) |
| **round-trip byte-identical** | 1942 / 2105 | **2120 / 2120** |
| **wasmtk WASI corpus round-trip** | 1 / 270 | **270 / 270** |

**T10.7 - done 2026-08-24.** `tagTypeIndex` in the binary writer resolves the
type-section entry matching a tag's signature, and compared the params with
`===`. A `ValueType` is an abstract `Type` - a number, where identity IS
equality - OR a typed reference, which is an OBJECT. So two structurally
identical `(ref $t)` params compared unequal, nothing matched, and the writer
took its fail-loud branch on a well-formed module. `valueTypeEquals` had been in
`ir.ts` all along; this was one more site the T7.4 ValueType refactor did not
reach, the same family as the `select` annotation still being cast to a byte.

The `[object Object]` in the message was the second half, and the reason it
stayed a mystery: the diagnostic rendered each param with
`(p as number).toString(16)`, so the one output that could have named the cause
named nothing. **A fail-loud path is only as useful as what it prints** - the
T9.5 rule ("a validator failure must REPORT") has a writer-side twin.

**T10.4 - done 2026-08-24, and it was the printer that was wrong.**
`printF32Literal` stripped the quiet bit before emitting the payload, on the
stated theory that "the parser always ORs it back in". TWO parsers disagreed:

| function | behaviour |
| --- | --- |
| `src/core/literal.ts` `parseF32Literal` | forced the quiet bit ON |
| `src/parser/wast-parser.ts` `parseF32LiteralBits` | read the payload EXACTLY |

The second is the one `wat2wasm` calls, and the one the spec agrees with:
`nan:0x<n>` names the mantissa exactly, with no special treatment of the quiet
bit - `float_literals.wast` writes both `nan:0x400000` (which IS the canonical
quiet NaN) and `nan:0x7fffff`. **So the printer was the exact inverse of a
function nothing called**, and `f32.const` bits 0x7fffffff round-tripped to
0x7fbfffff: valid wasm, different value, same class as T9.1. Both `literal.ts`
halves now match the spec and the WAT parser, and a print/parse round-trip over
every payload shape is asserted.

Fixed alongside, the LAST differing module: the WAT writer never emitted
`return_call_indirect`'s TABLE index. It did not fail to reparse -
`parseVarOpt` defaults it to 0 - so every `return_call_indirect` against a
table other than 0 came back pointing at table 0. `call_indirect` two cases
above it in the same switch writes the index; this one just did not. Bug G's
lesson at the writer instead of the resolver.

### What T10 cost, and what it was worth

Seven filed items became nine real bugs, and **three of the seven were
misdiagnosed**:

- **T10.5** was filed against the binary reader; the dominant cause was the
  PARSER draining the operand stack for `call`.
- **T10.6** was filed as a Nop problem; it was a `try_table` parser stub plus
  `array.new_fixed` draining the stack.
- **T10.8** did not exist as an item at all - it was folded into T10.5's
  description and turned out to be 45 of the 60 affected files on its own.

The classification had been done once, carefully, months of work earlier, and
carried forward as fact. Re-measuring each item before starting it cost one
~40-line harness apiece.

**Two corpora, and neither could see everything.** T10.1 and T10.5 lived almost
entirely in the wasmtk WASI corpus (100% and 82% of its differences, against 43%
and 30% of the testsuite's). T10.3, T10.4, T10.6 and T10.7 did not occur in real
WASI modules at all. Either corpus alone would have called the work finished
somewhere in the middle.

**T10.6 - done 2026-08-24, and it was not a Nop problem at all.** The item was
filed as "the same Nop substitution applied to an instruction that genuinely
needs its operand". Reproducing it found two unrelated parser bugs:

1. **Linear `try_table` was a stub** - 3 of the 4 modules (throw_ref.wast#0,
   try_table.wast#1, try_table.wast#2). It skipped the catch clauses AND the
   body to the matching `end` and built a plain `BlockExpr`. The reason the
   body came out EMPTY rather than merely un-caught: catch clauses are
   parenthesised IMMEDIATES that come before the body, and `parseInstrList`
   stops at the first `(catch ...)` because a catch clause is not an
   instruction. **Our own `wasm2wat` emits linear form**, so a round trip
   silently gutted any module using `try_table` - V8 said "expected 1 elements
   on the stack for fallthru, found 0", because the block's declared result had
   nothing left to produce it. The linear branch now reads the clauses with the
   same `parseTryTableCatch` the folded branch uses, so the two cannot drift.

2. **`array.new_fixed` drained the operand stack** - array.wast#3. Same class
   as T10.5's `call`, except the arity needs no module context whatsoever: it
   is the SECOND IMMEDIATE (`array.new_fixed $T N elem1 ... elemN`). V8 named it
   exactly: `array.new_fixed[0] expected type f32, found local.get of type
   i32`.

**A "linear form is a stub" comment is a round-trip bug waiting to happen in
this codebase**, because the WAT writer is linear-only - anything the parser
only supports folded is unreachable from our own `wasm2wat` output. Worth
grepping for the next one.

| metric | before | after |
| --- | --- | --- |
| spec testsuite byte-identical | 2102 / 2120 | **2111 / 2120** |
| differing modules | 18 | **9** |
| files affected | 10 | **6** |
| V8-invalid after round-trip | 5 | **1** |
| WASI corpus | 270 / 270 | 270 / 270 |
| parse-clean, V8-valid, agreement, assert_invalid | - | all unmoved |

Regression test: `tests/parser/linear_try_table.test.ts` (8 cases; 6 fail on
the pre-fix parser, and 2 are guards - the folded form and a folded
`array.new_fixed` must keep working).

**T10.3 — done 2026-08-24.** The binary reader already captured `Table.init`;
the WAT writer dropped it, with a `NOTE (T10.3)` at the drop site explaining
why. The blocker was real: this writer is LINEAR (post-order) by design, and
the table grammar takes ONE FOLDED instruction there with no `(item …)` /
`(offset …)` wrapper to hold a linear sequence — wrapping the linear output in
parens reparses as a folded expression with a bogus operand.

`writeFoldedConstExpr` supplies the folded form. Two decisions kept it from
becoming a second copy of the instruction set:

- **It handles CONSTANT expressions only**, and that grammar is closed by the
  spec — const family, `ref` forms, `global.get`, extended-const arithmetic, GC
  allocations — the same list the validator's constant-expression check
  enforces (T9.6). Surveying the testsuite first showed why that is enough:
  across every `Table.init` in all 257 files there are six shapes, 22 of 23 are
  a single LEAF instruction, and the only nested one is
  `ref.i31 (global.get $g)`.
- **The instruction's own text still comes from the ordinary delegate.** An
  `onXExpr` callback writes a node's opcode and immediates and never touches
  its children — the post-order visitor is what supplies those — so folding
  needs the operand ORDER and nothing else. No immediate formatting is
  duplicated.

And the drop is now **fail-loud**: a table initializer the folded emitter
cannot express throws instead of vanishing, which is the behaviour that let
this hide in the first place.

| metric | before | after |
| --- | --- | --- |
| spec testsuite byte-identical | 2088 / 2120 | **2102 / 2120** |
| differing modules | 32 | **18** |
| files affected | 14 | **10** |
| V8-invalid after round-trip | 15 | **5** |
| WASI corpus | 270 / 270 | 270 / 270 |
| parse-clean · V8-valid · agreement · assert_invalid | — | all unmoved |

The whole `table` group is gone. Remaining: T10.4 (13 modules, NaN payloads),
T10.6 (4, INVALID code) and T10.7 (1 throw).

Regression test: `tests/writer/table_init.test.ts` (6 cases; 5 fail on the
pre-fix writer, and the sixth is the guard that a table with NO initializer is
left alone).

**T10.8 — done 2026-08-24.** The residue of T10.5, and the part its original
description actually named. Both decoders build a TREE from a stack machine, so
every operand slot has to be filled; when the value is not on the decoder's
operand stack the slot got a bare `{ kind: 'nop' }`. The commonest reason is a
multi-result producer — `call $two` is ONE node however many values it pushes,
so the first `local.set` takes the call and the second is left with nothing.

`NopExpr.placeholder` now marks a synthesized slot-filler, `operandPlaceholder(loc)`
is the one way to build one, and NEITHER writer emits it: a placeholder means
"the value is already on the stack", which wasm spells by writing nothing.

**Marking only the obvious site was worth 45 of the 60 files.** The first pass
converted `popN` in both decoders and the ~95 `stack.pop() ?? nop` sites in the
reader, and took the corpus to 270/270 — but the spec testsuite only to
2074/2120. The parser makes placeholders in **13 more places**: `buildPlainExpr`'s
`op0()`…`op4()` accessors, the two folded-`if` condition slots, and four
`operands[operands.length - 1] ?? …` callee slots. Converting those took the
testsuite to **2088/2120** and files affected from 27 to 14. When a marker has
to be applied at every construction site, grep for the literal — do not assume
the helper is the only one.

**The T11 no-repair rule is what shapes the design.** Skipping ALL nops in an
operand slot would have been simpler, but `(local.set $x (nop))` is invalid
wasm a user can write, and eliding its operand could turn it valid. So the
marker distinguishes a synthesized slot-filler from a `nop` the source really
wrote, and only the former is dropped. Verified both ways: `assert_invalid` is
unmoved at 2664/2737, and three hand-built invalid shapes (a starved
`local.set`, an explicit `(nop)` operand, a starved `i32.add`) are still
rejected by V8 AND by our validator.

| metric | before | after |
| --- | --- | --- |
| **wasmtk WASI corpus byte-identical** | **225 / 270** | **270 / 270** |
| spec testsuite byte-identical | 2043 / 2120 | **2088 / 2120** |
| differing modules (testsuite) | 77 | **32** |
| files affected (testsuite) | 48 | **14** |
| parse-clean | 257 / 257 | 257 / 257 |
| V8-valid modules | 2120 / 2120 | 2120 / 2120 |
| validator agreement | 2120 / 2120 | 2120 / 2120 |
| assert_invalid rejected | 2664 / 2737 | 2664 / 2737 |

Regression test: `tests/writer/operand_placeholder.test.ts` (9 cases — the
parser's and the reader's placeholder both marked, no padding byte emitted, a
round-trip fixed point, a V8-executed check that the multi-value semantics
survive, an explicitly written `nop` preserved, and three T11 no-repair cases).

**T10.5 — done 2026-08-24, and it was diagnosed wrong.** The item was filed
against the binary READER ("the reader cannot attribute every value to an
operand slot"). Measuring it found the dominant producer was the PARSER:

    i32.const 0        ;; the address for the i32.store below
    f64.const 5
    f64.const 3
    call $f            ;; takes TWO args, but drained all three
    i32.store          ;; ... so its address slot got a Nop placeholder

`instrInputCount` returns -1 for `call` because the arity is the CALLEE's param
count, not a property of the token, and `parseLinearPlainInstr` read -1 as
"consume the whole operand stack". Our own `wasm2wat` emits LINEAR form, so a
round trip is exactly what triggers it — which is why it was invisible to every
other metric.

**Severity was understated, and the reason is worth keeping.** The item read as
cosmetic because a nop pushes nothing, so the starved `i32.store` still found
its address on the stack and the module ran correctly. But the nop is a byte,
and the next round trip adds another: `core_UnsignedIntegerComparison.wat` went
517 → 521 → 525 → 529 … +4 every pass, forever. **"Still valid" and "still
correct" are not the same as "converges".** Round-tripping a module through a
build pipeline more than once grew it without bound.

The fix needs the callee's signature, which may be declared LATER in the file —
199 of the 270 corpus modules contain at least one forward reference (487 calls
against 5470 backward). So function BODIES are now parsed after the whole module
field list: `parseFuncModuleField` records the body's token index and skips it,
`parseModuleFieldList` flushes the queue through `parsePendingBodies`. The token
stream is a random-access array, so this costs one balanced-paren skip per
function and a cursor assignment per body. Nested `(module …)` fields recurse
through `parseModuleFieldList`, so each field list owns its own queue.

`varArityForTok` returns -1 when the arity cannot be determined, which keeps the
old draining behaviour — including for `br`, `return`, `throw`, `call_indirect`,
`call_ref`, `struct.new` and `array.new_fixed`, which have the same shape and
are NOT yet resolved. They did not appear in the measurement; extend the switch
if they do.

One side effect: body diagnostics are now appended after those from later module
fields. Errors carry their own locations, so list order is presentation.

| metric | before | after |
| --- | --- | --- |
| **wasmtk WASI corpus byte-identical** | **50 / 270** | **225 / 270** |
| spec testsuite byte-identical | 2041 / 2120 | 2043 / 2120 |
| differing modules (testsuite) | 79 | 77 |
| files affected (testsuite) | 50 | 48 |
| parse-clean | 257 / 257 | 257 / 257 |
| V8-valid modules | 2120 / 2120 | 2120 / 2120 |
| validator agreement | 2120 / 2120 | 2120 / 2120 |
| assert_invalid rejected | 2664 / 2737 | 2664 / 2737 |

The testsuite barely moves because its remaining differences are dominated by
T10.3 / T10.4 / T10.6 / T10.8; the corpus is where this bug lived. **Two
yardsticks, and only one of them could see the bug** — same lesson as T10.1.

Regression test: `tests/parser/call_arity.test.ts` (8 cases; 5 fail on the
pre-fix parser, and 3 are guards that must keep passing — the Bug D folded
multi-value receive idiom, local-name resolution across the deferred parse, and
a V8-executed check that the store still uses the address the source named).

**T10.1 + T10.2 — done 2026-08-24.** One fix in `wat-writer.ts`'s
`buildExportMap`, because both were the same root: the inline `(export "n")`
abbreviation was applied unconditionally. It is not always faithful, in two
independent ways — it is illegal on an import, and it re-orders the export
section. The writer now tests both up front and falls back to standalone
`(export "n" (func $f))` fields, in the module's own order, when either fails.

The order test is **exact, not conservative**: under full inlining the emitted
sequence is a stable sort of `module.exports` by the position at which
`writeModule` visits each item, and a stable sort is the identity exactly when
those positions are non-decreasing. So a module whose exports already line up
keeps the abbreviation — the fallback fires only where it had to.

It is **all-or-nothing per module** on purpose: standalone exports are written
after every item, so inlining only SOME of them pushes the rest to the end and
re-orders the section again.

Note the emission order is imports, then funcs, tables, memories, globals, tags
— which is NOT the index space, so "every item exported exactly once" is not
enough for the order to survive. `(export "g" (global …))` before
`(export "f" (func …))` already fails it.

| metric | before | after |
| --- | --- | --- |
| spec testsuite byte-identical | 1961 / 2120 | **2041 / 2120** |
| differing modules | 159 | **79** |
| V8-invalid after round-trip | 26 | **15** |
| hard failures (`wasm2wat`/reparse) | 12 | **1** |
| files affected | 70 | **50** |
| **wasmtk WASI corpus byte-identical** | **1 / 270** | **50 / 270** |

The WASI number is the one that matters against the standing goal, and it came
in where the classification predicted (~49). The corpus's export group is gone
entirely; what is left there is T10.5 nop padding on 220 modules and the six
wasic-invalid ones.

Upstream wabt defaults `inline_export` to FALSE (`wat-writer.h:33`) and wabt-ts
defaulted it to TRUE. That divergence is what made both bugs reachable from
`wasm2wat` with no flags. The default stays TRUE — with the feasibility test in
front of it, it is now safe — so output stays readable where it can be.

Regression test: `tests/writer/export_order.test.ts` (6 cases; 5 of them fail
on the pre-fix writer, and the sixth is the guard that inlining still happens
when it is faithful).

### Two encoder bugs the last validator item uncovered

Chasing the final `assert_invalid` case turned up defects that had nothing to
do with validation:

1. **`select`'s result annotation was mis-encoded.** The binary writer wrote it
   with `this.s.writeU8(t as number)` — a cast the T7.4 `ValueType` refactor
   left behind. A `(ref $t)` annotation is an OBJECT, so the cast wrote `0x00`
   and EVERY typed-ref `select (result …)` produced an invalid value type.
   Same class as the type-key stringification in T10.7.
2. **`resolveNames` never resolved that annotation's heap-type var.**
   `resolveModuleValueTypes` walks declarations only. This was invisible while
   the writer was casting the annotation to a byte; fixing (1) made the
   writer's fail-loud guard fire immediately, which is exactly what that guard
   is for.

Note the standing "no name-var survives resolveNames" guard did NOT catch (2):
it walks the spec testsuite plus one hand-built module, and no testsuite module
writes `select (result (ref $t))`. A guard is only as wide as its corpus.

### WASI Preview 1 — the goal, and what measuring against it found

**Standing goal (recorded in `CLAUDE.md`): transpiled output must be WASI
Preview 1 capable until Preview 2 is the BROWSER standard, then migrate — and
the same for p3 and beyond.** Target the preview that is deployable today, keep
the next in view, switch on the browser rather than on the publication date.

The wasmtk corpus is the right yardstick for it: **270 of its 272 files import
`wasi_snapshot_preview1`**. Running them through the toolchain (2026-08-21):

| stage | result |
| --- | --- |
| encode | **270 / 270** |
| our validator | 263 / 270 |
| round-trip byte-identical | **1 / 270** |

Two findings, both more useful than anything the spec testsuite was saying:

1. **7 corpus modules are INVALID wasm** — all failing the same way (a function
   falls through without producing its declared result), rejected by V8,
   Wasmtime and Wasmer. Listed in `KNOWN_INVALID` in
   `tests/wasmtk/runner.test.ts`, asserted to *stay* invalid so the list
   shrinks when wasic is fixed.

   **CORRECTED 2026-08-24: these are STALE SNAPSHOT BYTES, not live wasic
   bugs.** We reported them upstream in the present tense; wasmtk rebuilt all
   seven from current wasic and every one is valid and exits 0 on Wasmtime with
   correct output. Re-derived on this side by recompiling from the checkout —
   frozen INVALID, current valid, all seven. The assertion's SHAPE is right (it
   goes red when a listed file validates, forcing the list to shrink); what
   defeated it is that `tests/wasmtk/` is FROZEN, so the trigger never fires —
   it re-checked bytes predating the fix and **masked it instead of tracking
   it**. See `tests/wasmtk/PROVENANCE.md`.

2. **The corpus gate never validated.** Its comment said "wat2wasm returns
   Result.Ok on a clean compile + validate" — `wat2wasm` is parse →
   resolveNames → synthesizeTypes → writeBinaryIr, with no `validateModule` in
   it at all. So the gate asserted something it never checked, for the life of
   the corpus, which is exactly how those 7 went unnoticed until T9.5's
   stack-arity check made the validator good enough to see them. The gate now
   really validates, with every proposal enabled.

**Round-trip on this corpus is 1/270, against 1961/2120 on the spec
testsuite.** Real WASI-targeting modules are a far harsher probe.

**Classified (2026-08-21): every one of the 269 differences is already in T10
scope — and only TWO of the seven groups appear at all.**

| group | spec testsuite | WASI corpus |
| --- | --- | --- |
| **T10.1** export order | 69 / 159 (43%) | **269 / 269 (100%)** |
| **T10.5** inert nop padding | 48 / 159 (30%) | 220 / 269 (82%) |
| T10.2 / .3 / .4 / .6 / .7 | 42 / 159 | **0** |

**Acted on 2026-08-24: the corpus went 1 / 270 → 270 / 270.** T10.1 (with T10.2)
took it to 50, where the classification predicted ~49; T10.5 to 225; T10.8 to
all of it. The prediction that "T10.1 + T10.5 together" would reach ~263 was
close — the last 45 needed T10.8, which had been folded into T10.5's
description. See the T10 section above for each fix and its before/after.

No new causes; nothing needs re-scoping. The seven modules the classifier calls
"INVALID after round-trip" are the same seven wasic already emits invalid —
they go in invalid and come out invalid, not a round-trip regression.

**But the PRIORITY inverts.** T10 was ranked by severity on the testsuite:
T10.6 and T10.3 first because they produce invalid wasm, T10.1 last as "valid,
wrong order". Against the WASI goal that ordering is wrong — T10.2, .3, .4, .6
and .7 do not occur in real WASI-targeting modules at all, while **T10.1 occurs
in 100% of them**. Fixing T10.1 alone would take the corpus from 1/270 to ~49;
T10.1 + T10.5 together to ~263/270 (everything except the seven wasic-invalid
ones).

Both orderings are correct for their own yardstick. **Which one to use depends
on the goal**, and the standing goal is WASI capability — so T10.1 first, then
T10.5. T10.1 is done; T10.5 is next.

**This is the reusable part.** The severity ranking and the frequency ranking
disagreed, and the frequency one was measured on the corpus the goal names. It
also turned out to be the cheaper fix and to close a second item (T10.2) for
free. Rank remaining work against the yardstick the GOAL names, not the one the
campaign happened to start with.

### Open — T12: `assert_malformed`. The only tranche with work in it

**Numbering:** a new integer, per the ledger rule — nothing in T1–T11 covers
"input the spec says must fail to PARSE". Opened 2026-08-24.

**Ranked by MEASURED consequence, not by case count.** Every category below was
probed to see what accepting it actually produces, because T10 was mis-ordered
for the whole campaign by inheriting a severity ranking instead of measuring
one. The result inverted the count order: the biggest categories are the mildest.

| id | scope | cases | measured consequence |
| --- | --- | --- | --- |
| ~~T12.1~~ | **DONE.** Out-of-range integer / float constants | 68 | **silent WRONG VALUE** — `(i32.const 0x100000000)` → `0`, `(f32.const 1e39)` → `inf`; V8 accepts and runs |
| ~~T12.2~~ | **DONE.** Import after a function/global/table/memory/tag definition | 12 | **silent REORDER** — was accepted and emitted first, shifting every index space |
| ~~T12.3~~ | **DONE.** `align=0`, `align=7` and other non-powers-of-two | 114 | **silent WRONG VALUE** — `align=3` was emitted as `align=2`; the severity was under-rated on the first pass |
| ~~T12.4~~ | **DONE.** SIMD lane immediates AND `v128.const` lane values | 13 + the simd_const cases | **silent WRONG VALUE** — lane 256 → 0, and `v128.const i8x16 -129` → **127** |
| ~~T12.5~~ | **DONE.** Malformed UTF-8 in names | 186 quoted **+ 528 binary** | name silently REPLACED with U+FFFD — and the same rule fixed most of T12.8 |
| ~~T12.6~~ | **DONE.** `unexpected token` — two silent defaults, then the block/type-use remainder closed by T12.7 | 82 | had **silent WRONG VALUE** in it after all |
| ~~T12.7~~ | **DONE.** Illegal character, empty annotation id, mismatching label, inline function type | 77 (+19 more it reached) | two of the four were WRONG VALUE, not just a missing rejection |
| ~~T12.8~~ | **DONE.** The remaining BINARY `assert_malformed` cases | 73 (was 601 — T12.5 closed 528) | the reader resynchronised instead of reporting |
| ~~T12.9~~ | **DONE.** The remaining QUOTED cases — duplicate ids (16), `nan:0x0` (10), lane immediates (13), token boundaries (6), second `(start …)` (1), forward type use (1) | 46 | every one a silent WRONG VALUE |

**T12.1 — done 2026-08-24.** Integers went through `BigInt.asIntN(32, n)` with
no range check; floats were IEEE-rounded with no range check. The legal integer
span is the UNION of the signed and unsigned ranges (`[-2^31, 2^32)` for i32),
because the text format lets a 32-bit value be written either way. For floats, a
FINITE literal that rounds to infinity is out of range — `inf` must be spelled
`inf`, which is why the check is gated on the literal FORM
(`isFiniteLiteralForm`) and not on the resulting bits. Gating on bits alone
rejected legitimate `inf`, caught immediately by the probe.

**Two existing test expectations were wrong and are corrected**, not weakened:
`hex_float_rounding.test.ts` and `decimal_float_rounding.test.ts` asserted that
`0x1.ffffff8p127` and `3.5e38` *overflow to infinity*. They go through
`wat2wasm`, so they were asserting parser behaviour, and `const.wast` settles
it — `(f32.const 0x1.ffffffp127)` and the decimal midpoint are both
`assert_malformed` "constant out of range", while the value just below the
boundary is a plain valid module. The underlying rounding functions still
return infinity, which is correct IEEE behaviour and is exactly what the
parser's range check reads.

Regression: `tests/parser/const_range.test.ts` (21 cases, 17 fail pre-fix,
including boundary cases in both directions).

**T12.2 — done 2026-08-24.** Imports occupy the low indices of every index
space, so the spec forbids one from following a definition. We accepted them and
emitted the import FIRST, renumbering everything the module already referred to.
Not theoretical — the module runs and returns a different answer:

    (func $defined (result i32) (i32.const 111))
    (import "host" "imported" (func $imported (result i32)))
    (func (export "which") (result i32) (call 0))

    source order:   call 0 is $defined      -> 111
    what we emitted: call 0 is the import   -> 999

V8 accepts the result, so nothing downstream catches it. Same class as T12.1.

The check lives in `parseModuleFieldList` and watches whether
`module.imports.length` GREW, not whether the `import` keyword appeared — the
inline abbreviation `(func $g (import "m" "g"))` is an import too and would
otherwise have slipped through. Verified against seven legal orderings
(type/export between imports, elem/data/start after definitions, imports only,
the inline abbreviation first) so the rule did not become a blanket rejection.

Regression: `tests/parser/import_order.test.ts` (15 cases, 8 fail pre-fix,
including a V8-executed check that `call` still means what source order says).

**T12.3 — done 2026-08-24, and it was mis-ranked when the tranche was opened.**
The table said "align silently DISCARDED (falls back to natural)". Probing it
properly for the fix showed worse: the raw number flowed into a `log2` that
FLOORS, so `align=3` was emitted as **`align=2`** — a changed module, not a
dropped annotation. binaryen's optimizer reads the alignment as a HARD
constraint (see the `naturalAlignForOpcode` note in `design-decisions.md`, where
getting this field wrong made it bail on rewrites and produce OOB at runtime).

So this belonged with T12.1 and T12.2 in the silent-wrong-value group, not below
them. **Ranking by measurement is only as good as the measurement** — the
opening probe checked whether the align survived, not what it survived AS.

`align=0` had a second problem: 0 is also `parseAlignOpt`'s "no `align=` given"
sentinel, so an explicit `align=0` was indistinguishable from writing nothing.
Rejecting it at parse time keeps the sentinel unambiguous with no IR change.

**The layer split is deliberate.** The power-of-two rule is the text grammar's,
so it is MALFORMED and belongs in the parser. "Alignment must not exceed the
operand's natural alignment" is a VALIDATION rule — `align=8` on an `i32.load`
is well-formed and invalid, and T9.6 already rejects it there. Conflating them
would have moved a diagnostic to the wrong layer; a test pins each side.

Regression: `tests/parser/align_power_of_two.test.ts` (14 cases, 11 fail
pre-fix).

**T12.4 — done 2026-08-24, and the entry named only half of it.** The table said
"SIMD lane index out of range". Reading the spec cases showed THREE rules across
TWO layers, and the third was not in the entry at all:

| input | verdict | source |
| --- | --- | --- |
| lane index 256+ | **MALFORMED**, "i8 constant out of range" | simd_lane.wast |
| lane index 16..255 | **INVALID**, "invalid lane index" | simd_lane.wast — already rejected since T9.6 |
| `v128.const` lane VALUE out of width | **MALFORMED**, "i8 constant out of range" | simd_const.wast |

**255 and 256 must fail in different layers**, which is exactly why the parser
checks only that the immediate fits `u8` and leaves the lane-COUNT comparison to
the validator. Collapsing them into one parse check would have merged the spec's
two distinct diagnostics — the same layer discipline as T12.3's
power-of-two vs not-larger-than-natural split.

All three wrapped instead of erroring. The sharpest is
`(v128.const i8x16 -129 …)` → **127**: a sign flip on every lane, in a module
V8 accepts and runs. As for scalar constants the legal span is the UNION of the
signed and unsigned ranges, so an i8 lane may be written `-128`…`255` —
`laneFits` encodes that once for all three widths.

Regression: `tests/parser/simd_lane_range.test.ts` (17 cases, 14 fail pre-fix,
including both boundary directions and a V8-executed check that an accepted
`-128` stays `-128`).

**T12.5 — done 2026-08-24, and it was ranked LAST of the wrong-value work when
it was the highest-leverage item in the tranche.** The entry read "name
mangled", 186 cases, on the strength of the quoted metric alone. But
`utf8-import-module.wast`, `utf8-import-field.wast` and
`utf8-custom-section-id.wast` are **176 BINARY cases each**, and the rule is the
same on both sides of the pipeline:

| | before | after |
| --- | --- | --- |
| `assert_malformed` quoted | 869 / 1229 | **1045 / 1229** |
| `assert_malformed` binary | 110 / 711 | **638 / 711** |

Both decoders were lenient `TextDecoder`s, which silently substitute U+FFFD, so
an invalid import or export name became a DIFFERENT, valid-looking name — and a
name is the module's public contract, the one thing a host links against.

**The exemption is as important as the rule.** Data segments are arbitrary
bytes: `(data "\0cf")` is legal. They go through `parseTextList`, names through
`parseQuotedText`, and only the latter is checked. That separation already
existed, which is why the fix is two decoders and no restructuring.

**`ignoreBOM: true` on the strict decoder is load-bearing**, and omitting it
cost a regression that the metrics caught immediately: without it `TextDecoder`
STRIPS a leading U+FEFF, silently renaming the export. That is T7.13, and
V8-valid dropped 257 → 256 the moment the decoder went in. Fixed before commit.

Regression: `tests/parser/name_utf8.test.ts` (17 cases, 16 fail pre-fix — six
invalid encodings in each of the two paths, the data-segment exemption, and the
BOM guard).

**T12.6 — the two silent defaults are fixed 2026-08-24; the rest is genuinely
"rejection not made".** The category was filed as such, but reading the 54
remaining cases found two more silent-WRONG-VALUE shapes hiding in it:

1. **A missing lane immediate compiled as lane 0.** `parseSimdLane` returned 0
   whenever the next token was not a number, so
   `(i8x16.extract_lane_s (local.get 0) (v128.const …))` — no lane at all —
   became `extract_lane_s 0`. There is no default lane.
2. **`nan:canonical` / `nan:arithmetic` were accepted as LITERALS**, silently
   becoming the canonical NaN bit pattern. They are `assert_return` RESULT
   PATTERNS, meaning "any canonical NaN".

**(2) could not be a global rule, and the metric caught me getting that
wrong.** A v128 result may carry the patterns PER LANE —
`(v128.const f32x4 nan:canonical nan:canonical …)` is legal and pervasive in
`simd_f32x4.wast` — and those lanes go through the same `parseF32Bits` an
instruction const uses. Rejecting them outright dropped **parse-clean 257 →
249** across eight SIMD files. The fix is a scoped `allowNanPatterns` flag set
only while parsing an expected result, saved and restored so it cannot leak.

That is the second time in this tranche that a rule turned out to be
CONTEXTUAL rather than absolute (T12.3's parse-vs-validate split was the
first), and both times the giveaway was a legal shape breaking, not reasoning.

**Still open in T12.6** (~12): block type-use combined with inline params or
results, and a NAMED param in a `call_indirect` type-use.

Regression: `tests/parser/lane_and_nan_context.test.ts` (15 cases, 14 fail
pre-fix, including the per-lane v128 result and a no-leak check).

**T12.7 — three things read and then thrown away, 2026-08-24.** Filed as four
separate categories; they turned out to be one shape repeated. In each, the
parser or lexer CONSUMED the text and looked at nothing:

1. **An annotation was skipped at the CHARACTER level.** `(@id …)` is
   transparent, and we implemented "transparent" literally — count parens,
   stop at the matching `)`. That is right about the BODY being untokenised
   and wrong about the rest, because an annotation still has a grammar:
   `annot ::= '(@' (idchar+ | string) (token | annot)* ')'`. The ID is
   REQUIRED and adjacent to the `@`, so `(@)`, `(@ x)`, `(@(@a)x)` and `(@"")`
   are malformed; and the body is a TOKEN sequence, so a control byte, a DEL
   or a raw non-ASCII character cannot appear in it.
2. **The closing label of a linear block.** `block $a … end $l` repeats the
   label at the `end` and the repeat must match. All five sites were
   `if (peek() === Var) this.drop()`. A typo'd closing label named a different
   block and the module compiled.
3. **The inline signature beside a `(type $t)`.** A type use may RESTATE its
   signature, and the restatement has to agree. `parseBlockType` called
   `skipInlineBlockSig` and `settleTypeUse` returned early, so
   `(type $sig (func))` with `(result i32)` emitted a function whose declared
   signature was neither of the two the source wrote.

(2) and (3) are silent-WRONG-VALUE, not merely a missing rejection — which is
the third time this tranche a category filed as "rejection not made" contained
one. **"We consume it and ignore it" is the tell**, and it is worth grepping
for directly rather than waiting for a metric: a `drop()` whose result is never
used, and a `skip…` helper that returns `void`.

**Reading the inline part instead of skipping it closed T12.6's remainder for
free.** A skip cannot see ORDER or NAMES, so the same rewrite rejected
`(result …)` before `(param …)` and a NAMED param in a block or
`call_indirect` type use — while `parseFuncSignature` still allows names,
because a real `(func (param $x i32) …)` needs them.

**A quoted id is a NAME.** `(@"…")` and `$"…"` take the T12.5 UTF-8 rule with
them, plus non-emptiness and no RAW control characters. That last check is on
the SOURCE text, not the decoded bytes, because an escaped tab is legal while a
literal tab byte is not — checking the bytes would have rejected both. The
shared `decodeStringToken` / `STRICT_NAME_DECODER` moved to
`src/core/literal.ts` so the lexer and the parser apply one rule, not two.

**The EXEMPTIONS are what make it safe**, and annotations.wast asserts them:
strings and comments inside an annotation are skipped whole and stay
unchecked (a body string containing parens, and `(@a (;bla;) (; ) ;)`, are both
VALID), and data segments keep their T12.5 exemption.

quoted assert_malformed **1087 → 1183 / 1229**; the other six metrics unmoved.
Regressions: `tests/parser/annotation_lexing.test.ts` and
`tests/parser/type_use_and_label.test.ts` (61 cases, 42 fail pre-fix).

**Still open** (46 quoted): duplicate ids across func/local/global/memory/
table/field (16), `nan:0x0` (10), signed lane immediates and `i8x16.shuffle`
lane-length/range (12), a `br_table` label that runs into the next token (5),
unknown type (1), two start sections (1), plus the 73 binary cases in T12.8.

**T12.8 — the binary reader resynchronised instead of reporting, 2026-08-24.
Binary 638 → 711 / 711; that half of the metric is CLOSED.**

The decoder was written to keep going, and every one of the ways it did that
produced a DIFFERENT MODULE rather than a diagnostic:

- an unknown section id fell into `default` and was skipped;
- `if (this.pos !== sectionEnd) this.pos = sectionEnd` realigned silently
  whenever a section's contents disagreed with its declared size;
- every entry loop was guarded by `this.pos < end`, so a section claiming more
  entries than it held simply produced fewer — `(table 1 …)` with no table
  entry decoded to a module with no tables;
- there was no duplicate- or order- check at all, so a module with two code
  sections decoded to the SECOND one's bodies;
- a function body missing its `end` decoded as though it had had one;
- `readU8() !== 0` made mutability 0x02, 0x04 and 0xff all MUTABLE, and
  `alignFlags & 0x3f` made memarg flags 0x80 an alignment exponent of 0 — a
  different instruction, in a module V8 runs. **Those two are T12.7's "we
  consume it and ignore it" spelled arithmetically**, which is worth carrying
  forward: a mask and a `!== 0` are discards too.
- the data-count section was read and thrown away with the comment "we don't
  store it". It is load-bearing: `memory.init` and `data.drop` require it (the
  code section is decoded BEFORE the data section, so it is the only way to
  know a data index is in range at that point), and when present it must agree
  with the data section's own count.

**The order is NOT numeric id order, and getting that wrong would have been
invisible in this metric.** The tag section is id 13 but sits between memory
and global; the data-count section is id 12 but sits between elem and code. A
numeric comparison accepts an order no producer may emit AND rejects a legal
one — and only the second half shows up as a failure. `sectionOrderRank` in
`src/core/binary.ts` holds the one order, the same one `writeBinaryIr` emits,
so the two cannot drift.

**One check was written in the wrong index space, and only a DIFFERENT metric
saw it.** The function/code count check first read
`count !== m.funcs.length - m.numFuncImports`; `m.funcs` holds defined
functions only (imports live in `m.imports`), so every module with a function
import was rejected. The `assert_malformed` number was identical either way —
round-trip dropped 2120 → 2051 across 14 files and named the error. That is
the fourth time in the campaign that the metric which caught a regression was
not the one the work was aimed at, and it is the argument for running the whole
panel on every change rather than the one being moved.

Regression: `tests/reader/binary_malformed.test.ts` (22 steps, all 6 groups
fail pre-fix), built from hex-dump literals so each module reads as bytes.

**T12.9 — the last of the quoted gap, 2026-08-24. 1183 → 1227 / 1229 at the
parser, and 1229 / 1229 through `wat2wasm`.**

Six shapes were left, and unlike the tranche's own severity ranking predicted,
**every one of them was a silent WRONG VALUE rather than a missing rejection**:

- **A duplicate identifier was simply UNREACHABLE.** Every lookup resolves a
  name by scanning for the FIRST match (`module.types.find(t => t.name === …)`
  and the same shape for funcs, globals, tables, memories, tags), so a second
  binding did not collide — the module still referred to something, just never
  to the item written last. The index space spans imports AND definitions,
  which is why `checkDuplicateIds` walks `module.imports` first.
- **`nan:0x0` emitted INFINITY.** The payload was MASKED into the mantissa
  field instead of checked, and a payload of 0 leaves no bits set, so
  `f32.const nan:0x0` produced 0x7f800000. The same mask truncated an
  oversized payload into a different NaN. (The mask was 0x3fffff for four
  releases and lost `nan:0x400000` exactly this way — the shape recurred
  because the fix then was to widen the mask instead of to check.)
- **A signed lane index had its sign dropped**, and `i8x16.shuffle` filled any
  missing lane with zero and let a `Uint8Array` store wrap `-1` to 255 and
  `256` to 0.
- **A token does not end at a quote.** `$"l"0` and `data"a"` are each ONE
  reserved token, because a string continues a token the same way an idchar
  does. Stopping at the closing quote turned `(br_table $"l"0)` into a branch
  to `$l` followed by a stray `0` that read as a second target, and
  `(data"a")` into a well-formed data segment.
- **A second `(start …)` overwrote the first**, so the module ran a different
  function than the one it names first.
- **A type use may refer FORWARD**, so T12.7's restatement check saw an empty
  type table and compared nothing whenever the type was declared later.

**The forward-reference fix is worth more than the one case it closes.**
Deferring the check to the end of the field list (`pendingTypeUses`, alongside
`pendingBodies`) makes T12.7's rule apply to forward references too — a gap
the metric could not see, because no spec case happens to combine a forward
reference with a mismatched restatement. A rule that only fires when its
operand happens to be already known is half a rule.

**The last two are a HARNESS boundary, not a gap.** `(br_table $l0)` with an
undefined label is rejected by `resolveNames`, which `wat2wasm` runs and the
parser-only harness does not. Name resolution is genuinely a post-parse pass
here, so the number measured at `parseWatModule` under-reports the tool by
exactly those two; measured at `wat2wasm` it is 1229 / 1229. Both numbers are
worth keeping — the parser-only one is the stricter statement.

Regression: `tests/parser/duplicate_ids_and_tokens.test.ts` (34 steps, all six
groups fail pre-fix), including a V8 round trip proving the in-range NaN
payloads still come back as NaNs and not infinities.

## T13 — the last two gaps, and a correction to what the 19 were

**T13.1 — an out-of-scope branch target is now the PARSER's error
(2026-08-24).** Labels are lexical and fully known at parse time, so
`(block $l (br $l0))` is malformed, not invalid. `resolveNames` already said
so, but it is a separate pass that `parseWatModule` does not run — which is why
the quoted metric read 1227 at the parser and 1229 through `wat2wasm`.
`checkLabelScopes` closes that, and it CHECKS ONLY: it resolves nothing and
rewrites no `Var`, so the worst it can do is report an error that is not there,
which parse-clean sees at once. Resolution stays in `resolveNames`, which still
owns it for IR that never came from text.

**Writing it found a live trap in `ExprVisitor`.** A `try … delegate` returns
after `onDelegateExpr` and never fires `endTryExpr` — and that is CORRECT:
`delegate` REPLACES `end` as the block terminator, which the binary writer, the
WAT writer and the validator all depend on. But it means a delegate that pushes
in `beginTryExpr` and pops in `endTryExpr` LEAKS its label into everything that
follows. The first draft did exactly that and the test caught it. Any new
delegate that maintains a stack has to pop in `onDelegateExpr` too.

**T13.2 — 16 of the 19 `assert_invalid` modules were never a validator gap.**

The ledger recorded them as *"modules V8 and Wasmtime both accept — those spec
tests predate proposals that legalised what they assert against, so matching
them would mean diverging from the reference runtime."* Re-deriving them showed
the engines were accepting a **different module**: our own pipeline rewrote
each one into validity before anything validated it.

    (memory 0x1_0000_0000)            emitted as (memory 0)
    (memory i64 0x1_0000_0000_0001)   emitted as (memory i64 1)
    (func (type 42))                  emitted as (func (type 0))
    (rec (type (func)) (type $ft (func))) (func $f)
                                      given (type $ft) — a type in a rec group

Three repairs, one class (T11, "an encoder must never repair invalid input"):

1. **`encodeU32Leb128` began `let v = value >>> 0`.** That WAS the range check,
   and it wraps: 2^32 encoded as 0, 2^48+1 as 1. It also hid a second bug —
   a 64-bit memory's limits are **u64 on the wire** and we wrote them as u32,
   so no 64-bit size above 2^32 could survive an encode at all.
2. **`synthesizeTypes` called `ensureTypeFor(item.sig)` for a type-use naming
   an index that does not exist.** The comment said that would leave "a
   dangling reference for the validator to report"; `ensureTypeFor` APPENDS a
   matching type when none exists, so what it actually left was a valid module
   pointing at a different type. **A comment stating the intent is not evidence
   the code does it** — this one had been read and believed for a whole
   campaign.
3. **`synthesizeTypes` reused any structurally-matching function type for an
   implicit type-use.** An implicit type-use denotes a SINGLETON rec group, and
   type identity is compared up to the rec group, so a `(func)` inside a
   two-member `(rec …)` is a different type. `type-rec.wast` says so in a
   comment on the assertion itself: `;; the implicit type of $f is not $ft`.

**The V8-valid metric was partly earned by those repairs, and it goes DOWN.**
Two spec modules that had counted as V8-valid — a 2^48-page `memory i64` and a
2^64-1-element `table i64` — passed only because we truncated them first.
V8-valid is now **2118 / 2120**, and that is the honest number: V8 rejects both
for its own implementation limits, at any faithful encoding.

**The three-engine panel settled the memory64 one, and V8 would have got it
wrong.** Wasmtime — the authority — ACCEPTS 2^48 pages and rejects 2^48+1 with
"memory size must be at most", which is exactly the spec ruling and exactly
what we now emit. Wasmer rejected all four with *"invalid var_u32: integer
representation too long"* — it reads 64-bit limits as u32, which is precisely
the bug we had just fixed, and is the divergence detector earning its place
again.

**Fixing the encoder exposed a validator bug the repair had been hiding.**
`onTable` capped elements at 2^32-1 regardless of index type, so
`(table i64 0 0x1_0000_0000 funcref)` — which `table64.wast` declares VALID —
was rejected the moment 64-bit limits stopped being truncated before the check
ran. Agreement caught it; the `assert_invalid` number was identical either way.
That is the fifth time in this campaign that the metric which caught a
regression was not the one the work was aimed at.

**One representational limit remains, and it is now fail-loud rather than
silent.** `Limits.initial` / `max` are JS numbers, exact only to 2^53, so
`(table i64 0 0xffff_ffff_ffff_ffff funcref)` — a module the spec calls valid —
cannot be encoded: `Number()` rounds it to 2^64 and the writer now REFUSES with
a message naming the cause, where it used to wrap to 0. Lifting it means
`Limits` holding `bigint` (~25 sites, and a breaking change to an exported
type). It would not move any metric — V8 and Wasmtime both reject a table that
size on their own implementation limits — so it is recorded, not done.

Regressions: `tests/parser/label_scope.test.ts` (20 steps; 2 of 3 groups fail
pre-fix) and `tests/writer/no_repair.test.ts` (23 steps; all 4 groups fail
pre-fix).

**T13.3 — `Limits.initial` / `max` hold `bigint` (2026-08-24).** T13.2 left one
representational limit: the fields were `number`, exact only to 2^53, and they
are u64 for a 64-bit memory or table. `0xffff_ffff_ffff_ffff` was ROUNDED to
2^64 on the way in, so once the encoder stopped wrapping silently it had to
REFUSE a module the spec calls valid — `table64.wast` writes exactly that shape
twice.

The change is ~20 sites in `src/` plus five test files, and it is **breaking on
an exported type**, deliberately: a consumer reading `limits.initial` as a
number now gets a compile error at the one site that has to handle the wider
range. The precedent is T7.4's `ValueType` and T12.6's `WastAction.args`.

Three things fell out of it:

- **A dead twin disappeared.** `checkLimits` (the `number` version) had no
  callers left once `onMemory` and `onTable` moved onto the 64-bit bounds. With
  `Limits` on `bigint` there is nothing for it to do at all — one rule, one
  copy.
- **`!limits.max` was also true for a max of ZERO**, so `(memory 0 0 shared)`
  was reported as having no maximum. Same falsy-zero shape the campaign has hit
  before; it is now `=== undefined`.
- **The bridge converts at its own boundary and REFUSES rather than rounds.**
  binaryen-ts's builder API is `number`, so `limitToNumber` throws above
  2^53 — a bridge that quietly halves a table is the bug this change removes,
  not a new place to reintroduce it.

**Verified with the engine panel, and it is unanimous where it matters:**
Wasmtime accepts `(table i64 0 0xffff_ffff_ffff_ffff funcref)`,
`(table i64 0xffff_ffff_ffff_ffff funcref)`, `(table i64 0 0x1_0000_0000
funcref)` and `(memory i64 0x1_0000_0000_0000)`, and rejects
`(memory i64 0x1_0000_0000_0001)` with "memory size must be at most" — the spec
ruling exactly. Wasmer still rejects every 64-bit limit with *"invalid var_u32:
integer representation too long"*, which is the u32-limits bug seen from
outside.

V8-valid 2118 → **2119 / 2120**, agreement 2118 → **2119 / 2119**, round-trip
2118 → **2119 / 2119**. The one module left is the 2^48-page `memory i64`,
which Wasmtime accepts and V8 rejects on its own implementation limit.

**And it caught a break I had already shipped.** `deno publish --dry-run` is in
CI but NOT in `deno task test`, and T12.7's move of `STRICT_NAME_DECODER` into
`src/core/literal.ts` made it public API without an explicit type — a
`missing-explicit-type` slow-types error that three full metric runs and 339
passing tests never saw. **Run the dry-run when the change touches an exported
symbol**, not just when publishing.

**Still not supported: custom page sizes.** `pagesize` has a lexer keyword and
`Limits.pageSize` exists in the IR, reader and writer, but the PARSER has no
syntax for it — `(memory 1 (pagesize 1))` fails with "expected ), got (". No
metric covers it because the proposal is not in this testsuite snapshot. Found
while writing the T13.3 test; recorded, not fixed.

**T13.4 — custom page sizes, end to end (2026-08-24). Modelled on wazmrt.**

T13.3's test found `(memory 1 (pagesize 1))` failing to parse, and looking at
it properly turned up a proposal that was HALF-BUILT and semantically wrong
throughout — `customPageSizes` in `feature.ts`, `Limits.pageSize` in the IR,
the flag bit handled in both the reader and the writer, and not one rule
enforced anywhere:

- **The field's meaning disagreed with itself.** `pageSize` was documented as
  BYTES while the reader and writer passed the raw wire value through, and the
  wire field is the **LOG2**. A decoded 64 KiB memory therefore carried 16, and
  the WAT writer printed `(pagesize 16)`. Now `pageSizeLog2`, which cannot be
  read the wrong way.
- **The parser had no syntax at all.**
- **Nothing validated the size.** The proposal admits exactly 1 and 65536 —
  **not every power of two**, and that is the trap: the field is already a
  log2, so every value looks like a power of two by construction and a
  power-of-two test accepts the fourteen sizes between.
- **The memory ceiling was the constant 65536**, i.e. 2^32/65536 with the
  division already done — right only for the standard page size. With 1-byte
  pages a 32-bit memory may legitimately declare 2^32-1 pages, and the constant
  rejected the proposal's own valid modules. The ceiling is
  `2^addr_bits / pageSize`.
- **The reader accepted the flag bit on a TABLE**, which has no page size.
  Whether the bit is legal is a property of the POSITION, not of the value —
  after the fact an explicit log2 of 16 is indistinguishable from no flag.

**What wazmrt is worth reading for.** It shipped this in 2026-08 and runs the
four spec files clean, and its notes carry the two facts that cost it the most:
the not-every-power-of-two trap above, and what happens when a trailing
`(pagesize …)` is silently DROPPED — the module builds, runs, and answers a
`memory.grow` wrong, because the memory was never the one the text asked for.
That is 18 assertions in `custom-page-sizes-invalid.wast` and the same
"assembled a module the source did not write" class this campaign keeps
finding. Its conformance ledger also records that the item was carried as "2
assertions" and was worth **69 skips** — a module the assembler cannot build
sends every assertion targeting it into NoTarget. **Size an item by assertions
UNBLOCKED, not by failures closed.**

**Two rules are ours rather than theirs.** The layer split — a non-power-of-two
has no log2 and is MALFORMED at parse, while an encodable-but-illegal
`(pagesize 2)` is a well-formed module that is INVALID — follows T12.3, and the
spec suite asserts both with different expectations. And the flag is keyed on
**PRESENCE**, not on `!== 16`: wazmrt collapses an explicit `pagesize 65536`
into the default, which a runtime can afford because the memory type is
identical, but it changes the bytes and round-trip fidelity is a metric here.
**Wasmtime accepts the explicit encoding**, so preserving it is not merely
conservative.

**The panel:** Wasmtime (authority) accepts all three shapes we emit,
`(pagesize 1)`, an explicit `(pagesize 65536)`, and one after `shared`. V8
rejects them with "invalid memory limits flags 0x8" and Wasmer with "the custom
page sizes proposal must be enabled" — both proposal gates, neither a ruling.

**No metric moved, and none could:** the proposal is not in our 257-file
testsuite snapshot (wazmrt's checkout has 284 files). That is exactly why this
sat half-built through a whole conformance campaign — **a feature no corpus
reaches is not covered by a corpus-shaped test, however many of them pass.**

Regression: `tests/parser/custom_page_sizes.test.ts` (15 steps, all 4 groups
fail pre-fix).

**T13.5 — three more reserved bytes read into nowhere (2026-08-24).** Found by
grepping for the shape T12.8 named, not by a metric — **no metric could see
them.** Binary `assert_malformed` is 711 / 711 and the spec suite has no case
for either byte.

    tag section    attribute byte     spec says 0x00 (exception)
    tag IMPORT     attribute byte     the same byte, the other path
    table 0x40     reserved byte      spec says 0x00

All three were `this.readU8(); // …` with the result discarded, so `0x01`,
`0xff` and `0x03` decoded to EXACTLY the same module as `0x00`.

**The producer already knew the rule**, which is what makes this a clean example
of the §3 asymmetry: `binary-writer.ts` emits `0x00` at both tag sites with the
comment *"attribute = exception (only valid value)"*, and `0x40 0x00` at the
table site. The writer enforced the rule on itself and the reader accepted
anything — and **round-trip fidelity cannot see that either**, because we never
emit the bad byte, so we never read one back. A one-sided rule is invisible to
every metric built on our own output.

Two things worth carrying: the tag attribute had to be fixed in TWO paths (the
section and the import) — the sibling-case tell from Bug G and the
`atomic_rmw_cmpxchg` memidx fix, again. And this is the third distinct instance
of "consume and ignore" in the binary reader after T12.8 and T13.2, which is
enough repetitions to say the grep belongs in the routine, not in a tranche.

Regression: `tests/reader/reserved_bytes.test.ts` (13 steps, 2 of 3 groups fail
pre-fix). No metric moved.

**T13.6 — a review pass that found nothing, and left two guards behind
(2026-08-24).** Angles checked and CLEARED, recorded so they are not re-run
blind: memory/table checks cover IMPORTS as well as definitions (wazmrt flags
the opposite as a real trap); `checkLabelScopes` covers all four branch-on forms
including `br_on_cast_fail`; every `Var`-bearing Expr variant is mentioned by
its `resolveNames` case (65 variants, 2 apparent misses both false — a
`case A: case B:` fallthrough and `RefValueType`, which is a value type rather
than an Expr); a NAMED heap type resolves in every value-type slot including a
FORWARD reference; `coarsenValueType` is confined to `src/bridge/` as documented;
and the `ValueType === Type.X` comparisons left in the encoders are correct by
design — they exclude typed refs on purpose.

Two audits were worth keeping rather than re-deriving, so they are now tests
(`tests/core/opcode_tables.test.ts`) driven by the LEXER's own behaviour rather
than a regex over its source:

- **lexer ⇄ printer symmetry**, every named opcode. A disagreement RENAMES an
  instruction across a round trip, and the SIMD name table has drifted before —
  caught by the wasmtk corpus, not by anything here.
- **natural-alignment coverage**, every memarg-bearing opcode. A missing entry
  is not a missing feature: the writer fills `align = 0` from that table, so the
  opcode is emitted with exponent 0, which binaryen reads as a hard constraint.

**Three exemptions turned up, and each one is now guarded rather than merely
skipped** — the "the exemption is part of the rule" practice: `select` is
legitimately many-to-one (0x1b untyped, 0x1c annotated, both spelled `select`),
and `ref.test null` / `ref.cast null` are DISASSEMBLY labels for the nullable
opcodes whose text form puts nullability in the immediate. All four spellings
are asserted to round-trip byte-identically, and the WAT is asserted not to
contain the label.

**Two of my own tooling bugs are worth the note.** The Var audit first reported
374 of 571 rows "unresolved" because the capture stopped at the first `)` in
`S(0x61)` — it looked like it had run when it had barely started. And the align
audit named three token types that match nothing (`LoadSplat`, `LoadZero`,
`LoadExtend`); the SIMD loads are all `TokenType.Load`, so the population was
complete, but only a sanity line saying "these names matched no rows" made that
visible. **An audit needs to report the size of the population it examined**,
or a clean result is indistinguishable from an empty one.

### Will a wasic WASI program LOAD on every runtime here? — 2026-08-24

wasmtk pulls our revised version and runs its own suite; what they need from us
is to be in sync on what actually loads. So: all 272 frozen-snapshot corpus
files, compiled by us, put to every runtime installed on this machine.

| runtime | loads | what fails |
| --- | --- | --- |
| V8 (Deno / Node 24.19) | **265 / 272** | the 7 `KNOWN_INVALID` snapshot files |
| Bun 1.3.14 (JavaScriptCore) | **265 / 272** | the same 7 |
| Wasmtime 47.0.3 | **259 / 272** | those 7 + the 6 legacy-EH |
| Wasmer 7.2.1 | **259 / 272** | **exactly the same 13** |
| wazero 1.12.0 | **251 / 272** | those 13 + 8 more |

Encode is 272 / 272 — nothing here is a wabt-ts defect. The two groups:

- **The 7** are the `KNOWN_INVALID` files, which are stale snapshot bytes fixed
  upstream in current wasic (see PROVENANCE). Every engine agrees they are bad.
- **The 6 legacy-EH** are the ones already reported and queued for migration to
  `try_table`. **Wasmer independently reproduces Wasmtime's verdict, file for
  file** — `legacy_exceptions feature required for try instruction`, the same
  six — which is the strongest confirmation yet that this is the real blocker
  and not a Wasmtime quirk.

**The migration will NOT buy wazero compatibility, and that is worth knowing
before it is done.** wazero's extra 8 —
`13_SecureMatrixManagerIntegration`, `15_panic`, `15_Trap-On-Error`,
`46_BasicEscapeSeqs`, `46_HexUnicodeEscapes`, `46_Phase46Combined`,
`46_TemplateEscapes`, `6b_testing-and-benchmarking` — all fail with *"tag
section not supported as feature exception-handling is disabled"*. wazero's CLI
refuses **any module carrying a tag section**, legacy or standard, so moving to
`try_table` changes nothing there. Its Go API has feature toggles the CLI does
not expose; a wazero-hosted wasic program needs either the embedding API or no
EH at all.

### The threads proposal is outside every metric's population — and had two bugs in it

**The 257-file testsuite snapshot contains NO atomics.** No `atomic.wast`, no
shared-memory file, not one `atomic.load` / `store` / `rmw` in any file. So the
whole threads proposal sits outside the population every conformance metric
measures, and nothing in seven numbers could ever have looked at it. Two real
bugs were living there:

- **T13.8** (above): `instrInputCount` one too high for atomic store / rmw /
  cmpxchg, so `wasm2wat` output of any such module was rejected by V8.
- **T13.9**: `getOpcodeTypeInfo` has a `PREFIX_MISC` (0xfc) branch whose comment
  says, in as many words, "they are NOT SIMD and must use the misc table;
  otherwise they fall through to the SIMD default and get type-checked as
  `(v128,v128)→v128`". **There was no `PREFIX_THREADS` (0xfe) branch**, so every
  atomic did exactly that: our validator REJECTED every atomic memory op with
  "expected [v128] but got [i32]". A false rejection — the worse class — and the
  same sibling-case gap the neighbouring comment describes, one prefix over.

The fix DERIVES the table rather than writing it out: the range 0x10–0x4e
repeats a 7-wide cycle (`T.op` i32, `T.op` i64, `op8_u` i32, `op16_u` i32,
`op8_u` i64, `op16_u` i64, `op32_u` i64), so a single `(sub - 0x10) % 7` covers
all sixty-odd loads, stores, rmw and cmpxchg. A hand-copied table of that size
is precisely what drifted for SIMD — the `S()` note in `type-checker.ts` is
about exactly that.

All **67** atomic opcodes now agree with V8 and round-trip byte-identically
(`tests/validator/atomics.test.ts`), and the test pins the WIDTHS too: a
uniformly-wrong table would still "agree" if it rejected everything, so the
mistyped counterparts are asserted to be rejected.

**The general lesson, and it is not about atomics.** A corpus-shaped metric can
only ever be as complete as its corpus, and ours is missing a whole proposal.
Before trusting "all seven green", ask which proposals the corpus does not
contain — that list IS the blind spot.

### T13.10 — DONE. Nine feature flags gated nothing; all 21 do now.

*(Originally deferred past 1.4.0. The owner's call was to fix everything known
before wasmtk starts using it, and that was right: this is the same
reads-as-covered-does-nothing class as every other bug in the tranche, and
shipping a version number on a public option that silently does not work is
worse than the release risk.)*

Measured proposal by proposal, only `multiMemory` and `customPageSizes` were
enforced. **Nine claimed to be off and were not**: threads, gc, memory64,
tailCall, exceptions, relaxedSimd, extendedConst, functionReferences,
wideArithmetic. (The other ten are ON in `defaultFeatures()` and correctly so —
`defaultFeatures` was right in intent all along; the enforcement was missing.)

`SharedValidator.requireFeature(flag, proposal, loc)` gates at the point of USE
rather than from a post-hoc scan, so an imported 64-bit memory needs the
proposal exactly as much as a defined one. 39 delegate hooks in `validator.ts`
cover the instruction families, and module-level facts are gated in
`shared-validator.ts` (shared/64-bit memories, 64-bit tables, tags, struct and
array type definitions).

**Three of the nine had no hook to hang a gate on**, which is the part worth
remembering: relaxed SIMD and wide arithmetic are ordinary unary/binary/ternary
nodes distinguished only by their OPCODE, and extended-const is ordinary
arithmetic distinguished only by appearing in an INITIALIZER. A gate keyed on
expression kind would have missed all three; `gateOpcode` keys on the opcode
range and on `inInitExpr` instead.

**No conformance metric moved — and none could.** Every harness passes
`allFeatures()`, which is exactly the configuration a gate cannot affect. **The
canary was the project's own test suite**: five files validated GC / EH /
tail-call modules with the DEFAULT features and passed only because the gates
were inert. They now declare the features they exercise, which is the same
"a consumer gets a compile error at the site that must handle it" property the
breaking type changes were chosen for.

**The CLI needed flags in the same change.** `wasm-validate` took a filename and
nothing else, so gating alone would have made it reject most modern wasm with no
way to opt in — a worse regression than the bug. It now takes
`--enable-<feature>`, `--disable-<feature>` and `--enable-all`, with the
hyphenated spelling wabt uses (`--enable-multi-memory`), and an unknown flag
prints the full list instead of being ignored.

**A follow-up pass found the gate INCOMPLETE, which is the useful part.** Gating
the instructions left GC *types* open: `(param anyref)`, `(result anyref)`,
`eqref` globals, `i31ref` locals and `structref` tables all validated with
`gc: false` — and with them `any.convert_extern` / `extern.convert_any`, which
have no delegate hook at all and were reachable only through their anyref
result. **A proposal is used by its TYPES as much as by its instructions**, so
the gate belongs in `checkValueType`, the choke point every signature, global,
table, elem segment and type field already flows through. A concrete `(ref $T)`
gates on `functionReferences` there too. The rule has to stop exactly at the GC
set: `funcref` and `externref` are reference types, ratified and on by default,
and catching them would reject ordinary modules — asserted explicitly.

Regression: `tests/validator/feature_gates.test.ts` — every proposal asserted
valid WITH its feature and rejected WITHOUT it, the error required to name the
feature, and the ratified set asserted to still validate with no flags at all so
the gates cannot degrade into a blanket refusal.

### Superseded note — why this was briefly deferred

*(Kept because the reasoning was half right and the half that was wrong is worth
remembering: calling it "a feature, not a fix" reclassified a bug to justify
deferring it. The cost estimate was real — no infrastructure, and the CLI needed
new flags — but that is an argument about SIZE, not about whether it belongs in
the release.)*

`wasmValidate(binary, { features })` is public API, and measured proposal by
proposal, only **multiMemory** and **customPageSizes** are actually gated.
`defaultFeatures()` accepts SIMD, GC, memory64, tail calls, exceptions,
reference types, bulk memory, sign extension, saturating float→int, mutable
globals, multi-value, relaxed SIMD, extended const and function references —
fourteen proposals it claims to have switched off. wazmrt's phrasing fits: *a
proposal that ships without a bit here is not "enabled by default"; it is
unrefusable.*

**Deliberately deferred**, and the reasoning matters more than the finding.
Adding fourteen gates is a per-proposal detection walk over the whole module,
and it can only ever ADD rejections. 1.4.0 exists to unblock wasmtk; shipping a
broad new rejection path in the same release risks breaking a caller that
happens to use `defaultFeatures()` — which is the one thing this release must
not do. It is a feature, not a fix, and it wants its own tranche and its own
before/after on the corpus.

Recorded in `runtime-tooling.md` as a known API limitation so a consumer is not
misled in the meantime.

### Pre-release audit for 1.4.0 — one serious bug, found by a NEW differential

Asked for before the bump, and the bump is what made it worth doing properly:
1.4.0 unblocks a downstream team, so a silent-corruption bug shipping in it
would be expensive.

**T13.7 — a named reference in every position (64 cases).** Built because the
bug wasmtk hit had a shape no metric covers: the PARSER accepts a construct,
`resolveNames` misses it, and the writer's fail-loud `writeVar` throws. All 64
pass on `main`. **Against the v1.3.5 tag, 21 of them fail** — named memory
operands do not parse at all, `table.grow`/`table.fill` throw on "funcref",
`ref.null $t` and `br_on_cast` fail, and both `try_table` catch forms throw.
That is the measure of what the release is worth, and it is why the audit is
now a test rather than a one-off.

### T13.11 — DONE. `resolveNames` never walked `table.get`'s index.

Found on 2026-08-25 by a **post-1.4.0 "look for code issues" audit**, with the
whole gate already green: lint clean, `deno task check` clean, 363 tests
passing, all seven conformance metrics exhausted.

`table.get` was grouped with `table.size` in the `resolveNames` switch:

```ts
case 'table.get':
case 'table.size':
  return [Result.Ok, { ...e, table: this.resolveTableVar(e.table, loc) }];
case 'table.set': {
  const [rI, index] = this.resolveExpr(e.index);      // the sibling, correct
  const [rV, value] = this.resolveExpr(e.value);
  ...
}
```

`table.size` IS a leaf. `table.get` is not — it carries the element index as a
sub-expression — so any name-var inside that index survived into the binary
writer. Because `writeVar` is fail-loud now (the T13.7-era change), the whole
module failed to encode rather than emitting index 0:

```
(table.get $t (global.get $g))  ->  unresolved name-var "$g" for var
(table.get $t (call $f))        ->  unresolved name-var "$f" for var
```

So this is **louder** than the atomic `memidx` gap (which silently hit the wrong
memory) but the same shape: a case that resolves SOME of its children, with a
correct sibling three lines below it in the same switch.

**Why every corpus was blind to it**, structurally rather than by luck:
`table.get` appears in **zero** files of the 272-file wasmtk corpus, and no
spec-testsuite module pairs it with a named operand. The same reason the atomic
`memidx` gap survived.

**The part worth carrying forward: T13.7's guard covers `table.get` and still
missed it.** `tests/parser/named_refs.test.ts` case 67 is

```wat
(module (table $t 1 funcref) (func (drop (table.get $t (i32.const 0)))))
```

The named reference is the **table**, and the table var was always resolved
correctly. The operand is the literal `(i32.const 0)`, which holds no name at
all. T13.7 varied the named reference across every POSITION the grammar allows
and held the OPERANDS constant as literals — and this bug lives in the operand,
not the position. **A guard is only as wide as the axis it varies**, which is
the T13.7 lesson ("a guard is only as wide as its corpus") one level up:
positions were the axis, operands were not.

Found by widening the audit that caught the `memidx` gap — every `Var`-bearing
field vs. its case body — to also cover every `Expr`-typed field vs. its case
body. Run mechanically over `ir.ts`, that audit reports **exactly one** miss
across all 75 sub-expression-bearing interfaces, and this was it. The `Var` half
of the same audit now comes back clean.

Regression: `tests/ir/table_get_index.test.ts`. **Inverted before being
trusted** (the standing rule): with the fix reverted, 5 of its 7 steps fail and
the `table.set` control stays green.

**One near-miss in the test itself, worth recording.** The first behavioural
fixture reached the table through `call_indirect` and **passed with the bug
still in place** — `call_indirect` has its own, correct resolve case. A
behavioural fixture has to go through the instruction under test, not through a
neighbour that reaches the same state. The shipped fixture uses `table.get`
directly, populates only table slot 3, and reads it via `ref.is_null`, so a
resolve that fell back to global 0 reads the empty slot and the assertion flips.

### T13.12 — DONE. The two signed LEB encoders still repaired their input.

Same audit, secondary finding, and a pure asymmetry-in-a-family: both UNSIGNED
encoders were hardened for T11/T13 with an explicit range check and a comment
explaining the repair they used to do, and the two SIGNED ones next to them were
left on the wrapping normalisation.

```ts
encodeU32Leb128:  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw   // hardened
encodeU64Leb128:  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw                   // hardened
encodeS32Leb128:  let v = value | 0;                     // WRAPS: 2^31 -> -2^31, 2^32 -> 0
encodeS64Leb128:  let v = BigInt.asIntN(64, value);      // WRAPS: 2^63 -> -2^63
```

**Not reachable from WAT**, and that was checked rather than assumed before
changing it, because the standing footgun policy defers a fail-loud fix only if
it risks rejecting valid input. The parser normalises an i32 literal into signed
range before it reaches the IR (`i32.const 2147483648` is stored as
`-2147483648`) and rejects anything outside u32/s32 range outright; the binary
decoder returns `result | 0`; and the two other `writeS32Leb` call sites pass
small non-negative type indices (`writeHeapType`, block-type index). So nothing
valid can reach the new check.

It is still worth fixing: `writeBinaryIr` is a published entrypoint, so a
hand-built IR could hand an encoder a value it cannot represent and get a
silently different module back — the T11 rule verbatim.

Regression: appended to `tests/core/leb128.test.ts` — the out-of-range values
throw, and the boundary values themselves (±2^31, ±2^63) still round-trip, so
the check cannot degrade into a blanket refusal.

### Audits from the same pass that came back CLEAN

Negative results, recorded so the next audit does not re-run them blind. Each is
a documented drift risk with a named invariant behind it:

- **`expr-visitor` totality** — every sub-expression field on all 75 Expr
  interfaces is walked. Clean.
- **`resolveNames` `Var` coverage** — all 64 `Var`-bearing interfaces resolve
  every one of their vars. Clean. (The `table.get` gap was an `Expr` field, which
  is why the `Var`-only audit did not see it.)
- **`instrInputCount` vs. `buildPlainExpr`'s `opN()` usage** — cross-checked
  mechanically, token by token, against the max `opN()` each case actually reads.
  **Zero mismatches**, so the T13.8 / Quaternary class is currently closed.
- **Validator feature gating** — all nine T13.10 gates plus `multiMemory` and
  `customPageSizes` are enforced at the point of use. `annotations`,
  `codeMetadata` and `compactImports` remain ungated, correctly: they are
  text-format / custom-section concerns with no validator surface.
- **Bare `{ kind: 'nop' }` construction sites** — both remaining ones are real
  `nop` instructions (the `Opcode.Nop` reader case, the `TokenType.Nop` parser
  case), not operand slot-fillers. The T10.8 `operandPlaceholder` invariant holds.

**The gate after both fixes:** 364 tests / 2509 steps passing, lint clean,
`deno task check` clean.

**And the metrics were RE-MEASURED, not reasoned about** — the binding rule says
"measure, do not assume," and it applies here even though the argument for "no
metric can move" was a good one (`table.get` with a named operand is absent from
both corpora; six of the seven metrics start from bytes, downstream of a
text-side name-resolution failure). The argument was good and it was also
insufficient: **T13.12 adds a `throw` to a path every single encode runs
through**, so a bad bound would have turned valid modules into hard failures
across the board. That is exactly the shape a metric catches and reasoning does
not.

Measured 2026-08-25 on the post-fix tree:

| metric | measured | recorded |
| --- | --- | --- |
| parse-clean (257-file spec testsuite) | **257 / 257** | 257 / 257 |
| encode + V8-accepts | **2119 / 2120** | 2119 / 2120 |
| round-trip byte-identical | **2119 / 2119** | 2119 / 2119 |
| hard failures (throws) anywhere in the above | **0** | — |
| wasmtk WASI corpus, encode | **272 / 272** | 270 / 270 |
| wasmtk WASI corpus, round-trip | **272 / 272** | 270 / 270 |

Every spec-testsuite number is identical to the recorded value, and **zero
throws** confirms the new LEB bounds are unreachable from both corpora.

**Name the population** (the standing rule, and it matters here): the corpus
figures read 272, not the recorded 270, because this harness walks all 272
`.wat` files while the recorded metric was taken over the 270 that import
`wasi_snapshot_preview1`. Larger population, same result — **not** an
improvement, and not a contradiction. Do not "correct" the recorded 270 to 272
without re-deriving which population is meant.

Harnesses are session-scratchpad throwaways as always (~50 lines each). Two
bugs in writing them, worth knowing because both produced a plausible ZERO
rather than an error: `writeBinaryIr(m)` returns a `Uint8Array`, and
`w.buffer ?? w` silently takes the underlying `ArrayBuffer` instead — the
`instanceof Uint8Array` guard then rejected all 2120 modules and printed
`0 / 2120`. Earlier, a wrong guess at the wast-command shape printed `0 / 0`.
**A conformance harness that reports zero is far more likely to be broken than
to be reporting a catastrophe** — sanity-check the DENOMINATOR first (2120 and
272 are the known populations; hitting them exactly is the signal the walk is
right).

**`deno fmt --check` reports 106 of 146 files failing with "Text differed by
line endings."** That is the known autocrlf artifact on this checkout, NOT
drift. Verify a touched file by diffing it against `deno fmt` output with line
endings normalised, which was done for all four files in this change and came
back clean.

### T13.13 — DONE. The guard had one axis, and two of its fixtures were invalid.

The open item left by T13.11: `tests/parser/named_refs.test.ts` covers
`table.get $t` and still missed the bug, because it varies WHERE the name
appears and pins every operand to a literal. Closing it meant adding the other
axis — a named reference inside every OPERAND slot — which found two things,
neither of them the one being looked for.

**The operand axis itself is clean: 69 / 69.** Every instruction that takes
sub-expressions now gets `(global.get $g)` in its operand slots, with `$decoy`
deliberately at global 0 so a silent fallback to index 0 is a different program
rather than a coincidence. Encode, V8-accepts, and byte-identical round trip all
pass. **No product bug beyond T13.11 lives on this axis** — a negative result,
and worth having as one, because "we never looked" and "we looked and it is
clean" are different states.

Sensitivity measured the right way (WHICH steps flip, not how many): reverting
the T13.11 fix turns **exactly `table.get index` red and nothing else**. That is
the evidence the other 68 pass on merit rather than vacuously.

**The real finding was in the guard, not the product: 2 of the original 64
fixtures encode to modules V8 REJECTS.**

| fixture | what V8 says |
| --- | --- |
| `array.new_elem $t $e` | `segment type (ref func) is not a subtype of array element type` — the elem segment was `(elem $e func $f)` against an array of `(ref null $ft)` |
| `br_on_cast $l (ref $t)` | `br_on_cast must target a branch of arity at least 1` — the target was a bare `(block $l)` |

Both passed for four releases because **the suite only ever asked whether
`wat2wasm` returned a non-empty buffer.** It never asked an engine. So for those
two constructs the guard asserted "the encoder produced bytes" about input that
was not a valid module in the first place — and if the encoder had started
producing garbage there, nothing would have noticed.

Fixed: both fixtures corrected, and `assertV8Accepts` now runs on **both** case
tables, so a fixture cannot drift into invalidity unnoticed again. Inverting
that check (restoring the two original fixtures) turns exactly those two steps
red, which is how it was confirmed rather than assumed.

**How they were found is the reusable part, and it was an accident.** Two of the
three fixtures that failed while building the operand axis had been copy-pasted
straight out of the existing test file. Triaging "is this my fixture or a real
bug?" is what surfaced that the originals were invalid too. **Copying a fixture
from an existing suite imports its assumptions, including the ones nobody
checked** — and when a borrowed fixture fails under a stricter assertion, ask
whether the source suite was ever asserting that property at all.

`tests/parser/named_refs.test.ts` is now 64 position cases + 69 operand cases,
135 steps. Gate: **366 tests / 2579 steps**, lint, typecheck and `deno fmt`
clean (the file is under `tests/`, which IS in the formatter's `include` list —
unlike `cmem/`, which is not in scope at all).

### T13.14 — DONE. Twelve GC operand checks a sibling handler already had (2026-08-25).

**All twelve are FALSE ACCEPTS**: our validator returned `Result.Ok`, and V8 and
Wasmtime 47.0.3 both reject. Four roots, and every one is the asymmetry-in-a-
family shape — a check that exists for one member of an instruction family and
silently does nothing for its siblings.

| root | site | what was missing |
| --- | --- | --- |
| 1 | `popAnyRef` (`type-checker.ts`), used by `ref.test` / `ref.cast` / `array.len` | asked only "is this SOME reference"; never compared the operand to the immediate |
| 2 | `onRefI31` / `onI31Get` / `onRefIsNull` | bare `dropTypes(1)` — **no check at all** |
| 3 | `onRefAsNonNull` | PEEKED the operand but never CHECKED it |
| 4 | `onStructGet` / `onArrayGet` (`shared-validator.ts`) | packed-field signedness ignored |

The cases, each confirmed against both engines:

    ref.test  funcref            against (ref null any)
    ref.test  externref          against (ref null any)
    ref.test  anyref             against (ref null func)
    ref.cast  externref          to      (ref null i31)
    array.len on (ref $struct)  /  array.len on funcref
    i31.get_s on anyref         /  i31.get_s on funcref
    ref.i31   on i64                        (needs i32)
    ref.is_null on i32
    ref.as_non_null on i32 whose result type AGREES
    struct.get on a packed i8 field  /  struct.get_u on a non-packed i32 field
    array.get  on a packed i8 element / array.get_u on a non-packed i32 element

**The tell for root 1 was one screen away.** `onBrOnCast` in the same file has
checked `isSubtype(to, from)` since T9.x, with a comment explaining why it was
added — and its two siblings were never given the equivalent. `isSubtype` was
already on `SharedValidator`; the machinery existed and simply was not called.

**Root 3 is the subtle one and is worth remembering as a shape.** `ref.as_non_
null` LOOKED correct under a first probe, because `(func (param i32) (result
anyref) (ref.as_non_null …))` is rejected — but on the RESULT type, not the
operand. `nonNullable()` returns a non-reference unchanged, so the i32 was
popped and pushed straight back; make the declared result agree with the wrong
operand and it validates clean. **A rejection is only evidence for the check you
think it is if you have varied everything else** — the first probe had two
reasons to fail and credited the wrong one.

**Root 4 is T9.11 exactly.** `onStructGet` declared the flag as `_signed` — the
underscore that means "deliberately unused" — and dropped it; `onArrayGet` did
not take it at all even though `validator.ts` had `e.signed` in hand. Same
"unused parameter in a family of parallel handlers is a missing check".

**The rule for root 1 is SHARED HIERARCHY, not subtyping.** Both engines accept a
WIDENING cast (`(ref $s)` tested against `(ref null any)`), so a subtype test in
either direction would have been wrong in the other direction. New
`topOfAbstract()` in `type-checker.ts` names the root of each of the four
hierarchies (`any` / `func` / `extern` / `exn`); `popCastOperand` compares tops
and reports only when both are known — an unknown type index is reported
elsewhere and must not produce a second, misleading error.

**Measured, both directions.** Spec testsuite: **449 / 449** V8-accepted modules
still accept — **zero false rejects** — and `assert_invalid` is unchanged at
2671 / 2678 with the same 7 pre-existing misses (`align`, `unreached-invalid`,
`block`, `return_call_ref`, `type-rec`), verified by re-running the sweep with
the three validator files reverted and getting a byte-identical result. wasmtk
corpus: **272 / 272 encode, 265 / 272 validate** — the 7 are the known
`KNOWN_INVALID` stale-snapshot files, unchanged.

**No campaign metric moved, and none could have.** Validator agreement counts
only false REJECTIONS, so it is structurally blind to this entire class; and no
spec-testsuite or wasmtk-corpus module contains any of these shapes. Found by
enumerating a FAMILY and asking what each member checks — the same method as
T13.11 and T13.12, on a fully green gate (367 tests, lint, typecheck).

Regression: `tests/validator/gc_operand_checks.test.ts` — 15 invalid cases
(each asserted against V8 as oracle so a fixture cannot drift into validity),
14 valid cases that must STAY valid (the guard against over-correcting root 1
into a subtype test), and one step asserting every rejection carries a
diagnostic rather than a bare `Result.Error`. 30 steps.

### T13.15 — DONE. The SIMD lane ops ignored the memory index type (2026-08-25).

`onSimdLoadLane` and `onSimdStoreLane` each declared `_is64` and dropped it,
hard-coding the address operand as i32. Their siblings `onLoadSplat` and
`onLoadZero`, two screens up in the same file, do exactly
`const addrType = is64Memory ? _I64 : _I32` — and `SharedValidator` was already
computing and passing the right value to all four.

Wrong in BOTH directions at once on a 64-bit memory:

| module | ours (before) | V8 | Wasmtime |
| --- | --- | --- | --- |
| `v128.load8_lane` / `store8_lane`, **i64** address | **reject** | accept | accept |
| `v128.load8_lane` / `store8_lane`, **i32** address | **accept** | reject | reject |

So it was simultaneously the loud T13.11 failure (valid input refused) and the
silent T13.14 one. The rest of the memory64 family is correct — `i32.load`,
`memory.fill`, `memory.grow`, `atomic.load`, `v128.load`, `table.get` on an i64
table all check out — which is what makes this a narrow gap rather than a
missing feature.

**The reusable part: this is the SECOND time this exact pair of handlers has
been caught dropping a parameter its siblings use.** T9.11 fixed `offset` for
`onSimdLoadLane` / `onSimdStoreLane` among ten memarg handlers and left `is64`
behind, because that audit enumerated ONE PARAMETER across the family rather
than the whole SIGNATURE of each member. See best-practices.md.

Regression: `tests/validator/simd_lane_index_type.test.ts`, 10 steps — 6 valid
(including `v128.load8_splat` on a 64-bit memory, the sibling that was already
right, so a later "simplification" onto one shared helper cannot quietly undo
the distinction) and 4 invalid, in both directions on both memory widths.

### T13.16 — DONE. `data.drop` / `elem.drop` swallowed a value and DELETED it (2026-08-25).

**The worst failure mode in the audit definition, reached in one line of table
data.** Both instructions are `[] -> []` — the segment is an IMMEDIATE and
nothing comes off the operand stack — but `instrInputCount` had them in the
arity-**1** group, sharing a `case` label with genuine one-operand instructions
(`table.get`, `ref.test`, `memory.grow`, `throw_ref`, `ref.is_null`). So
`parseFoldedInstr`'s deficit fill popped a value belonging to the surrounding
scope, and `buildPlainExpr` has no slot to put it in, so it was discarded
without a trace.

```wat
(func (export "run") (result i32)
  (call $bump)      ;; sets $g to 7 — SWALLOWED AND DELETED
  (data.drop $d)
  (global.get $g))  ;; returns 0
```

V8 and Wasmtime both ACCEPT the emitted module. It runs. It returns **0 instead
of 7**. There is no diagnostic anywhere in the pipeline. This is the same class
as the v1.3.0 statement-ordering bug (a void call sinking past a `return` into
dead code), reached by a different route — and the same STRUCTURE as T13.11: a
`case` label shared with instructions that do not match. There the leaf was
`table.size` and the non-leaf `table.get`; here the arity-1 group absorbed two
arity-0 members.

**Found by the `instrInputCount` vs `buildPlainExpr` axis** already named in the
audit definition — declared arity vs the maximum `opN()` the case actually
reads. `data.drop` and `elem.drop` read NO operands and were declared 1. Four of
the six mismatches the scan reported were regex artifacts of stacked `case`
labels (`BrOnCast`, `BrOnNull`, `BrOnNonNull`, `ArrayInitData` all check out by
hand) — **the axis is worth running even at a 33% true-positive rate**, because
the two true positives were a wrong-answer bug.

Fix: move both into the arity-0 group beside `memory.size` / `table.size`.

**Nothing moved, measured against a reverted baseline**: round-trip 364 / 449
byte-identical and parse-clean 257 / 257, byte-identical to the run with the
change backed out. No spec-testsuite or wasmtk-corpus module puts a stacked
value immediately before a `data.drop`, which is why five metrics and 367 tests
were green over it.

Regression: `tests/parser/drop_arity.test.ts`, 6 steps — the executed
wrong-answer case for both `data.drop` and `elem.drop`, the stacked-constant
case in linear AND folded form, a round-trip fixed-point check, and one control
asserting genuine arity-1 instructions still take their operand. **Sensitivity
measured the right way**: reverting the fix turns exactly 5 of the 6 red, and
the one that stays green is the over-correction control.

### T13.17 — DONE. `rethrow` ignored its depth (2026-08-25).

`SharedValidator.onRethrow(loc, _depth)` declared the depth and dropped it, and
`TypeChecker.onRethrow()` did not take one at all — it just went unreachable. So
`(func (rethrow 0))`, a rethrow in a function with no `try` anywhere, validated
clean, as did a rethrow naming an ordinary `block` or the try BODY rather than a
catch handler.

`rethrow N` re-raises the exception caught by the Nth enclosing CATCH, so the
label it names must BE a catch handler — that is where the caught exception
lives. `onCatch` already sets `labelType = LabelType.Catch` on the frame, so the
fix is a `getLabel(depth)` plus a comparison: **the machinery existed and was
never called**, the same shape as T13.14's `isSubtype`.

**Oracle caveat, and it is the interesting part.** Legacy EH is the one family
where the standing three-engine rule CANNOT be applied: Wasmtime 47.0.3 and
Wasmer both refuse `try` outright (`legacy_exceptions feature required`), and
`wasmtime -W` has no switch for it — the same wall the 10-module wasic report
hit. **V8 is the only engine that can rule on these modules at all**, so the
test says so in its header rather than implying a cross-check that was not run.
The rule itself is unambiguous in the legacy EH proposal independently of any
engine.

Severity is LOW for that same reason: these modules do not run on the primary
WASI host. Recorded and fixed as a soundness hole, not as something reachable
from the wasmtk pipeline.

Regression: `tests/validator/rethrow_depth.test.ts`, 6 steps — 4 invalid plus
two valid ones, the second of which (`rethrow 1` reaching an outer catch through
an intervening `block`) exists because a fix that only ever checked depth 0
would pass the first and fail it.

### T13.18 — DONE. A silent landing pad, closed; and three axes verified CLEAN (2026-08-25).

**The first audit driven by the recurrence table**, and the honest headline is
that it found **no new wrong-answer bugs**. What it produced was one dead-code
removal, one hardening, and three negative results — recorded because "we looked
and it is clean" is a different state from "we never looked", and the difference
is invisible six months later unless someone writes it down.

**Removed: `getOpcodeNaturalAlign`.** A second natural-alignment table beside the
canonical `naturalAlignForOpcode`, against the standing "do not duplicate the
table" invariant. Exported, never called, and silently incomplete — it returned
`0` (*no alignment constraint*) for all 14 SIMD splat / lane / zero memory ops.
Every live call site guards on `natAlign > 0`, so a caller reaching for it would
have skipped alignment checks on exactly those opcodes: the T9.6 / T9.11 gap a
third time, primed rather than live. Differentialled against the canonical table
across the whole opcode space first — **it never CONTRADICTS it on a real memory
opcode**, it is only incomplete — and confirmed not re-exported from the package
root, so removal is not an API change. Found by the recurrence table's *"a helper
that exists and is never called"* row.

**Hardened: `instrInputCount`'s `default: return 0`.** A token with no entry
silently becomes zero-arity — the linear parser pops nothing and every operand
becomes a placeholder. **This has already cost one bug**: `Quaternary` (wide
arithmetic) had no entry, and while the BYTES came out right (`pushStmt` flushes
operands in order and a placeholder emits nothing), the **IR tree was wrong** —
which is what the bridge and `wasm2ts` read. T13.16 was its inverse. `Rethrow`
and `StructNewDefault` are now explicit, and the gate below makes the table
self-policing.

**The gate is the durable part.** `tests/parser/instr_arity.test.ts` already
carried the claim *"every instruction that takes operands belongs here"* in its
header — as a claim, with a hand-maintained list underneath it, which is exactly
how Quaternary and T13.16 got in. T13.18 reads `isPlainInstr`'s case labels out
of the parser source and fails if any lacks an `instrInputCount` entry, plus a
second step that fails if the single allowlisted exception (`SimdLaneOp`, whose
arity is per-OPCODE and routed through `instrInputCountForTok`) ever goes stale.
**Inverted before being trusted**: removing the two new entries turns it red
naming `Rethrow, StructNewDefault`.

#### Three axes that came back clean — negative results worth keeping

- **`instrProducesValue` omits the SIMD loads.** `SimdLoadSplat` / `SimdLoadLane`
  are distinct token types that DO produce a v128 and fall to
  `default: return false` — the precise setup the comment above them documents
  for the `call` operand-scrambling bug. Runtime-checked in four shapes (nested,
  linear-then-folded-consumer, statement position before a `return`): **all
  correct**. Folded parsing collects children explicitly, and in the linear case
  the placeholder legitimately means "already on the runtime stack". Not changed
  — an unearned fix to a delicate function is a worse trade than the doubt.
- **The 87-token arity enumeration.** `isPlainInstr` lists 87 instruction tokens
  and `instrInputCount` covered 84; all three absences are legitimate (`Rethrow`
  and `StructNewDefault` are genuinely zero-arity, `SimdLaneOp` is routed). **No
  live victim of `default: return 0` remains.**
- **The two natural-alignment tables never disagree.** Differentialled over the
  whole core + SIMD + threads opcode space: 0 memory opcodes where both give a
  real alignment and they differ.

**Gate: 371 tests / 2633 steps**, lint and typecheck clean. Every conformance
number byte-identical to baseline — agreement 449 / 449, `assert_invalid`
2671 / 2678, round-trip 364 / 449, wasmtk corpus 272 / 272 encode and 265 / 272
validate.

### T13.19 — DONE. The ledger did not describe itself, and three sections did not declare their invariants (2026-08-25).

No product change. Two record-keeping defects and one class of missing in-code
notation, all found by asking what a NEW reader or editor would have to infer.

**The ledger did not index its own recent work.** T13.14-T13.18 were written up
in full across three sessions and registered in the tranche ledger by none of
them — so the one table a reader consults first said the work did not exist.
Five rows added. The rule now says explicitly: **every item gets a ledger row,
not just a write-up; if you only have time for one, write the row.** The
write-up is the detail, the row is the index, and an unindexed detail is
findable only by someone who already knows it is there.

**The numbering scheme was half documented.** The "Numbering rule" paragraph
covered what a decimal versus an integer MEANS, and nothing covered how to pick
the next one — which is not obvious, because the ledger is ordered by CLOSE DATE
while the write-ups are ordered by number, so an id can exist in one and not the
other. That is exactly how this session's work was first numbered T13.11, three
ids into territory already used, and had to be renumbered across every heading,
code comment and test name. There is now a documented command that takes the max
of both, a second check against `src/` and `tests/`, and the status vocabulary
(`DONE`, `done — <metric delta>`, struck-through-when-absorbed, and how a
RETRACTED finding is recorded).

**Fixed alongside:** T13.16 was sitting ahead of T13.15 in the file — inserted
in the order written rather than numeric order.

#### The example that matched its own search

Worth its own note because it took three attempts. The documented command is
`grep -ohE '\bT13\.[0-9]+' cmem/tasks.md | sort -t. -k2 -n | tail -1`, and
running it returned **T13.19** — because the illustrative id in the instructions
directly above it was itself a well-formed id in the file being searched. The
second draft returned the id embedded in the sentence WARNING about the first
literal. Only the third, which uses a `<next>` placeholder throughout and
describes the trap without instancing it, returns the true answer.

Note this paragraph is written under its own rule: it names no example id,
because doing so would break the command a few lines above it. That constraint
is permanent for this file — **prose here is inside the searched corpus**, so
an id written to illustrate a point is indistinguishable from an id recording
one. Re-run the lookup after editing this section; it is the test.

Generalised in best-practices.md: **an example that satisfies its own matcher is
data, not documentation.** Any doc that lives inside the corpus a tool scans -
an id ledger, a fixture directory, a rule file a linter reads — has this
property, and the check is one line: run the documented command against the
documentation.

#### Sections that now declare their own invariants

The other half of the round, and the one with teeth. Three code sections carry a
**membership assertion** that nothing at the section stated, and all three have
already been joined wrongly by an edit that looked locally reasonable:

| section | the unstated assertion | the defect it produced |
| --- | --- | --- |
| `resolveExpr`'s `table.size` arm | every member is a LEAF | T13.11 — `table.get` joined it and stopped walking its own operand |
| `instrInputCount`'s `return 1` group | every member pops exactly one operand | T13.16 — `data.drop` joined it and the parser DELETED the preceding instruction |
| the memarg handler family | each handler owes FOUR things: memidx, align, offset, `is64` | T9.6, T9.11, T13.15 — three audits, each certifying one of the four |

Each now opens with an INTENT block stating what joining asserts, what breaks in
each direction where both directions differ, and which gate catches it (or that
none does). `resolveExpr`'s `default:` arm additionally says it is an ENTRY
CONDITION — nodes with no `Var` and no `Expr` field — rather than a description
of what happens to land there, because returning `e` unchanged is
indistinguishable from correctly resolving a leaf.

The durable form is in best-practices.md: **a comment explaining what the code
DOES is close to worthless** — the code says that already and the comment goes
stale. Notate the constraint the code cannot express, which is the reason a
wrong edit will not be caught by the type checker.

**Gate: 371 tests / 2633 steps**, lint and typecheck clean, the three annotated
files `deno fmt`-clean. No behavioural change and no metric re-measured, because
nothing executable was touched.

### T13.20 — DONE. `applyNames` walked 37 of 87 expression kinds (2026-08-25).

`applyNames` is `resolveNames`'s sibling — same two axes, opposite direction.
Every `Expr`-typed field must be recursed into, every `Var`-typed field naming a
module-level entity must be rewritten. `resolveNames` is total on both, made so
one painful case at a time by Bug G, the atomic `memidx` gap and T13.11. **The
same enumeration had never been run against `applyNames`, and 50 kinds fell to
`default: return e`.**

The symptom is not a crash and not invalid output — it is silent
INCONSISTENCY. The same reference is named or not depending only on which
parent it sits under:

```wat
global.set $myglobal      ;; handled kind — named
global.get 0              ;; identical reference inside memory.fill — not
```

Also unrewritten: `memory.init` / `table.init` segments, `data.drop` /
`elem.drop`, every `struct.*` and `array.*` typeVar, `throw` tags, the
multi-memory `memidx` on atomics and SIMD lane ops, and `call_ref` sigTypes.

**Why nothing caught it:** `applyNames` is published from `src/index.ts` and
used by NO internal pipeline — `wasm2wat` and `/compat.applyNames()` both call
`generateNames` instead. No corpus, metric or test reaches it. Found through the
recurrence table's *"a helper that exists and is never called"* row, which is
the third finding that row has produced.

**The fix splits the axes by how knowable they are**, and that split is the
durable part:

- **Axis 1 (recurse into children) is now GENERIC** — it walks every
  `Expr`-typed field whatever the kind, so it cannot miss one by construction.
  A hand-written per-kind list is precisely what failed.
- **Axis 2 (rewrite `Var` immediates) stays an explicit 55-kind table**, because
  which NAME SPACE a var belongs to is per-kind knowledge that cannot be read
  off the field name: `segment` is a data index on `memory.init` and an elem
  index on `table.init`. Inferring it from the field name would silently rename
  a reference to a real but wrong entity — Bug G's failure mode — so a test
  asserts the two maps never cross.

**Deliberate non-rewrites are now documented and tested rather than
incidental:** LABEL vars (`labelNames` is per-function and this pass has no
function context, so renaming would be a guess) and LOCAL vars (this pass has
already shipped that bug once, renaming a local index through `funcNames`).

Regression: `tests/ir/apply_names_total.test.ts`, 21 steps — 13 nesting cases
for axis 1, 5 immediates for axis 2 including the data/elem cross-check, and 3
asserting the exceptions stay exceptions. **Sensitivity:** reverting the fix
turns 2 of the 3 groups red and leaves the exceptions group green, which is
what it should do.

### T13.21 — DONE. Two coupled switches in the WAT writer, with nothing saying so (2026-08-25).

Found by scoping the T13.20 shape across the rest of `src/` rather than stopping
at the one instance.

`writeFoldedConstExpr` renders the grammar slots taking exactly one folded
constant instruction (the table initializer, T10.3). It splits on operand count:

```ts
if (operands.length === 0) this.writeExprList([e]);   // leaf: the whole expr
else { this.writeInstrHead(e); /* ...then each operand... */ }
```

So any kind `constExprOperands` returns a NON-EMPTY list for must have a
`writeInstrHead` case. Missing one, `writeInstrHead`'s `default` falls back to
`writeExprList([e])` — the full linear rendering, operands included — and the
loop then writes those operands a SECOND time.

**The failure mode is the bad kind: the output REPARSES.** Confirmed by deleting
the `ref.i31` case and round-tripping a table initializer —

    correct:  (table $T0 2 (ref i31) (ref.i31 (i32.const 7)))
    drifted:  (table $T0 2 (ref i31) (i32.const 7 ref.i31 (i32.const 7)))

both parse; the second is a different module. Same shape as the `writeCatch`
duplication (T10.6), where the handler body was written by the callback AND
walked again by the visitor.

**The two switches agreed** — this was a latent trap, not a live bug, and it is
recorded as one. Neither function's signature hints at the other, so both now
carry INTENT blocks naming the coupling and its failure mode, and
`tests/writer/const_expr_head_coupling.test.ts` reads both out of the source and
fails on drift. Inverted before being trusted: deleting the `ref.i31` case turns
both the structural and the behavioural half red with actionable messages.

#### Scoping the shape — every Expr-kind walk in `src/`

The point of the round. All 24 `switch (x.kind)` sites enumerated; 11 are over
`Expr` (the rest switch on imports, frames or catch clauses). Result:

| site | cases | verdict |
| --- | --- | --- |
| `expr-visitor.ts` | 94 | total |
| `ir-util.ts` (`getExprArity`) | 94 | total |
| `resolve-names.ts` | 89 | total (verified twice, both axes) |
| `apply-names.ts` | 55 + generic children | **was 37/87 — T13.20** |
| `binaryen-bridge.ts` | 57 | partial, `default` THROWS — fail-loud, correct |
| `validator.ts` `isConstExpr` | 13 | partial, `default: return false` — an ALLOWLIST, safe by direction |
| `wat-writer.ts` `constExprOperands` | 13 | partial by design, but COUPLED — **T13.21** |
| `wat-writer.ts` `writeInstrHead` | 8 | the other half of the coupling |
| `generate-names.ts` `generateLabelNames` | 5 | partial — **verified benign, see below** |

**The rule that falls out: a partial switch is safe or not according to the
DIRECTION of its default.** `isConstExpr` rejects on sight and the bridge
throws, so neither can be silently wrong. `applyNames` returned the node
unchanged and `writeInstrHead` fell back to a plausible-looking render — both
silently wrong. When reviewing a partial switch, read the `default` first: it,
not the case count, decides whether the gap matters.

#### Negative result: `generateLabelNames` is partial and it is fine

`generate-names.ts` recurses only through block-like kinds (`block`, `loop`,
`if`, `try`, `try_table`), so a block nested in an OPERAND position is never
reached and gets no synthetic label. **Verified benign**, three cases including
two-level operand nesting with `br`s at different depths: correct runtime
values, byte-identical round trip.

Two reasons it holds, and both are worth having written down because they are
what a future change could invalidate: `wasm2wat` builds its IR from the BINARY
READER, whose stack-to-tree conversion puts blocks in statement position, so the
unwalked shape does not arise on the path that uses this; and an unnamed label
is legal anyway — the writer emits a depth. If either changes, re-check.

**Gate: 375 tests / 2656 steps**, lint and typecheck clean. Every conformance
number byte-identical — agreement 449 / 449, `assert_invalid` 2671 / 2678,
round-trip 364 / 449, wasmtk corpus 272 / 272 encode and 265 / 272 validate.
Neither finding is reachable from any metric, which is now the expected result
rather than a surprise.

### T13.22 — BLOCKED (fix is written, must land WITH the binaryen-ts upgrade). The bridge's catch scope compensates for a binaryen-ts off-by-one (2026-08-25).

**Status: deliberately not fixed.** The bug is real and understood; applying it
alone would turn correct output into incorrect output against the binaryen-ts we
build on today. It lands in the same change as the dependency bump, not before.

Raised by the binaryen-ts team, who asked us to answer it both ways: *"if their
bridge compensates for our old off-by-one, remove the shift; if it was already
spec-correct, they were the ones being mis-encoded."* **It is the first branch.**

#### What is wrong

`bridgeExpr`'s `try_table` case pushes the try_table's own label onto
`ctx.labelStack` and THEN resolves the catch clauses:

```ts
const name = nameForLabel(ctx, tt.label);
ctx.labelStack.push(name);                     // <-- own label pushed
try {
  const body = ...;
  const catches = tt.catches.map((c) => buildCatchClause(c, ctx));   // <-- resolved here
```

Catch targets resolve in the ENCLOSING scope — the try_table's own frame is not
counted. `resolveNames` gets this right (it resolves catches, then pushes) and
its depths are V8-verified. The bridge therefore reads a correct depth against a
stack that is one frame too deep, and hands binaryen-ts a label one level too
shallow.

Instrumented on `(block $outer (drop (block $inner (try_table (catch $err
$outer) …))))`:

```
catch target={"kind":"index","value":1}  stack=["$outer","$inner","$L0"]  -> dest=$inner
```

Depth 1 in the enclosing scope IS `$outer`; the bridge resolved it to `$inner`.

#### Why it currently produces correct bytes

binaryen-ts 1.0.9 — the version `deno.lock` pins — counts the try_table's own
frame when it turns `dest` into a depth. One level too deep, against our one
level too shallow. They cancel exactly:

| | emitted catch depth | correct? |
| --- | --- | --- |
| our own encoder (reference, V8-verified) | **1** | yes |
| bridge as shipped (`dest=$inner` + their old shift) | **1** | yes, by cancellation |
| bridge with the scope fixed alone (`dest=$outer`) | **2** | **NO** |

The wire evidence is one byte in `1f 7f 01 00 00 <depth>`.

#### Why the fix is held

Applying the ordering fix against binaryen-ts 1.0.9 emits depth 2 and breaks a
module that works today. The two changes are coupled. **The trigger is the
binaryen-ts upgrade**: when the import map moves off `^1.0.9`, resolve catches
BEFORE `ctx.labelStack.push(name)` in the same commit, and re-run the byte check
above.

Their breaking change, stated as they gave it: **`catches[].dest` must name the
enclosing label.** Two consequences they flagged that we should expect —
`RemoveUnusedNames` now counts a catch destination as a label reference, and
none of it is on JSR yet.

#### The third layer, and the rule that predicted it

This is the SAME off-by-one for the third time: parser (T7.6) → validator (T9.8)
→ bridge. `best-practices.md` already says, in as many words, *"When you fix a
scoping rule in one layer, grep for the other layers that implement it."*
Nobody grepped the bridge — twice. The bridge is easy to skip because it is
dev-only and no published entrypoint reaches it; that is a reason to deprioritise
FIXING it, never a reason to leave it off the enumeration.

#### What we could NOT verify, and will not assert

- **Their note that our earlier report was right "including the untestable
  half".** There is no record of that exchange anywhere in this repo — not in
  `cmem/`, not in `scripts/`, not in git history. `binaryen-ts-upstream-report.md`
  carries seven findings and none concerns try_table catch decoding or writing.
  We are not disputing it; we cannot confirm it, and said so rather than
  agreeing to be agreeable. **This is our own documented failure mode**: an
  exchange whose scope was never written down is operationally lost.
- **Their `RemoveUnusedNames` / `$__exn_tag` consequence.** Their pass is not
  ours to check. But the premise deserves a look on their side: the frozen
  wasmtk snapshot contains **zero `try_table` modules** — its `$__exn_tag`
  modules use LEGACY `try`/`catch` — so unless wasic has migrated, that shape
  has no catch-destination-to-block for the pass to strip. Flagged to them with
  the standing caveat that **our snapshot is not evidence about current wasic**,
  and with the reminder that our own earlier `$__exn_tag` finding was RETRACTED
  for exactly that reason (see `scripts/wasmtk-eh-parity-report.md`).

#### Method note: the probe that nearly produced a wrong refutation

The first attempt compared RUNTIME results between the two orderings and got
111 from both — which reads as "no bug, note refuted". It was a bad probe.
Patching the depth byte directly shows why:

    depth 0 -> 222      depth 1 -> 111      depth 2 -> 111

Depths 1 and 2 are indistinguishable in that shape (2 lands on the function
body, which yields the same value), so the fixture could not separate the
hypothesis from its negation. The byte-level comparison against a known-correct
reference encoder is what settled it. Generalised in `best-practices.md`.

### T13.23 — DONE. The binaryen-ts pin is now EXACT, and two upstream notes resolved against our side (2026-08-25).

binaryen-ts's reply to T13.22. Three things changed as a result, one of them a
defensive change to `deno.json`.

#### The pin was protected by a lockfile alone — now exact

They checked our side and reported it back precisely: `deno.json` asked
`^1.0.9`, `deno.lock` held exactly `1.0.9`, and **JSR's latest is already
1.4.3** — which the caret accepts. So nothing but the lockfile was holding the
coupling together.

That is harmless *today*, because every RELEASED binaryen-ts still has the old
catch scope, so a refresh resolves a version our compensation still cancels.
It stops being harmless the moment **1.5.0** publishes: a plain
`deno cache --reload` — no version change of ours, no commit, no review — would
silently break our EH output.

**Changed `deno.json` to an exact pin** (`jsr:@jrmarcum/binaryen-ts@1.0.9/ir`
and `/encoder`). Verified: type-check clean, 27 bridge tests pass, `deno.lock`
unchanged at 1.0.9, `deno publish --dry-run` succeeds. They have recorded it as
a RELEASE BLOCKER on their side and **1.5.0 does not ship alone**.

**The general lesson, which is not about this dependency.** A caret range plus a
lockfile is not a pin — it is a pin *until someone reloads*. Where a version
constraint is load-bearing for CORRECTNESS rather than for compatibility, say so
in the specifier, because the lockfile is the thing most likely to be
regenerated by a routine command. See best-practices.md.

#### Note 1 — the report exists; we were grepping for the wrong one

They identified it. It is **not** in the 7-finding
`scripts/binaryen-ts-upstream-report.md`, which is why the grep came up empty: it
was a **later, separate ask**, and it opened by explicitly excluding try_table
("one thing, and it isn't try_table"). Identifying marks: the repro
`(module (func (result i32) (block $b (result i32 i32) (i32.const 1) (i32.const 2)) (drop)))`,
the error `multi-value block type (type index 0) is not supported (at offset 0x3)`,
and a four-row table. **The "untestable half" was the multi-value WRITER**, not
anything about try_table.

**Their four-row table reproduces exactly here** — and with a nuance worth
sending back:

| case | through our bridge |
| --- | --- |
| single-value block | bridged, V8 accepts |
| multi-value FUNCTION result | bridged, V8 accepts |
| try_table single-value handler | bridged, V8 accepts |
| **multi-value BLOCK** | **our bridge THROWS first** |

`bridgeExpr` raises *"Bridge: multi-value blocks (func_type BlockType) not yet
supported"* before binaryen-ts is ever reached. Our own pipeline handles the
same module fine (V8 accepts). So **their writer fix is necessary but not
sufficient for us**: lifting our own bridge restriction is the second half, and
until both land the shape stays unreachable.

**It left no trace on our side either.** Neither `cmem/` nor `scripts/` nor git
history records that ask. Their conclusion is the right one and we accept it:
the standing "write down what you asked" rule caught a real instance — a report
that reached them and was never filed here. That is now two independent
confirmations of the same failure mode (this, and T9.11's unrecorded scope).

#### Note 3 — they corrected their own instance; our exposure is nil

They withdrew the `$__exn_tag` framing rather than re-derive it from our frozen
snapshot, which is the right call. The corrected finding: their pass was missing
**four** label kinds, not one, and the operative one for legacy EH is
**`delegate`** — a block label named only by a `try…delegate` target got
stripped, and their pipeline died with `unresolved branch label: "$l0_1"`.
Confirmed on their side by reverting just that collection line; V8 accepts the
fixture, so it is live. `rethrow` targets a try label, which the pass never
strips, so it is unaffected.

**Measured exposure for wabt-ts: none.** `bridgeExpr` has no legacy-`try` case at
all — `(try $l0 (do (nop)) (delegate 0))` raises *"Bridge: expression kind not
yet supported: try"* before any binaryen-ts pass runs. Our own pipeline encodes
the same module and V8 accepts it. So the defect is real and cannot reach us
through the bridge.

#### Note 4 — accepted, and the distinction kept

They accepted the precision and are recording both facts separately: what the
REGISTRY holds (latest 1.4.3) versus what we RESOLVE (locked 1.0.9). Those are
different claims and conflating them is what would have made "not on JSR yet"
read as "you are safe".

#### The probe rule went upstream

Our non-discriminating-probe correction — depth 1 and depth 2 both returning
111, only depth 0 differing — is now in their best-practices, credited here.
They had written a rule about the same failure mode this week from the other
direction. Worth noting because it is the first method rule to travel BETWEEN
the two projects rather than being rediscovered in each.

### T13.24 — DONE. The bridge never pushed a label frame for `if` (2026-08-25).

**Found by scoping T13.22's shape** — enumerating every `ctx.labelStack`
push/pop in the bridge against the cases that need one — which took about five
minutes and is the second finding that enumeration has produced.

`bridgeExpr` keeps its own label stack and resolves `br` depths against it.
`block`, `loop` and `try_table` each push a frame. **`if` did not.** But an `if`
is a branch target in wasm whether or not it carries a label, so every `br`
inside one resolved ONE FRAME TOO SHALLOW — and it was wrong in both directions
at once:

| module | our encoder | bridge (before) |
| --- | --- | --- |
| `br 0` from inside `then` (targets the if) | **222** | **111** — silently retargeted the enclosing block: a VALID module returning a different number |
| `br 1` from inside `then` (targets `$outer`) | **111** | **throws** `br depth 1 out of range (stack size 1)` — valid input rejected |

Unlike T13.22 this is **not cancelled by anything**. It is a live bridge defect,
bounded only by the bridge being dev-only.

#### Why it read as covered

The `if` case DOES handle labels — it rejects a labeled `if` outright because
binaryen-ts's `makeIf` has no label slot, with a comment explaining exactly
that. So the file looks like someone thought about `if` and labels. What was
missed is that an **unlabeled** if still occupies a depth. **The comment
answered the question that was asked and nobody asked the other one** — the same
shape as T9.11 certifying `offset` and leaving `is64`.

#### The fix, and why half of it is a hard failure

- **A sentinel frame (`IF_FRAME`) is pushed for every `if`**, after the
  condition is bridged (the condition is evaluated before the if is entered, so
  a `br` inside it targets the enclosing scope). That alone fixes `br 1` and
  every depth measured through an if.
- **`resolveLabel` THROWS when a target lands on that frame.** binaryen-ts
  genuinely cannot express a branch to an unlabeled `if`, and the only
  alternative — resolving to whatever encloses it — is precisely the silent
  wrong answer being fixed. Converting silently-wrong into fail-loud is the
  correct end state here, not a stopgap; it becomes expressible when `makeIf`
  grows a label slot.

Regression: `tests/bridge/label_frames.test.ts`, 5 steps. **The first step
guards the guard** — it asserts the two depths give DIFFERENT answers through
our own encoder, so the rest cannot go vacuous. That is a direct consequence of
T13.22's non-discriminating probe; the lesson is now built into the fixture
rather than only written down. Sensitivity: reverting the fix reddens 3 of the 5.

#### A near-miss worth recording: `git stash` flipped the file's line endings

Measuring sensitivity by `git stash push` on the bridge file, then restoring
from a byte copy, left the working tree file **CRLF** where its siblings are
**LF**. `core.autocrlf=true` converts on checkout, so the stash round trip
rewrote every line. `git diff --stat` went from a surgical 47/10 to
**1649 insertions / 1612 deletions** — a whole-file diff that would have buried
three real edits in a commit and made review impossible.

Caught by reading the diffstat after the experiment rather than trusting the
restore. **On this checkout, prefer a plain byte-level copy aside and back for
revert experiments; `git stash` and `git checkout --` both re-run the EOL
filter.** Verify with `git diff --stat` afterwards — the number is the check,
and it is one line. Related: the standing `deno fmt --check` CRLF false alarm in
[testing.md](testing.md), same root cause seen from the other side.

### T13.25 — DONE. A control byte made a source file invisible to grep, and a sweep reported clean anyway (2026-08-25).

**Self-inflicted, and the most instructive finding of the round** because it
attacks the audit METHOD rather than the product.

T13.24's `IF_FRAME` sentinel was written as a literal **NUL byte** (`'\0if'`)
rather than the intended visible string. Everything downstream stayed green —
`deno check`, `deno lint`, `deno fmt`, all 376 tests — because a NUL is a legal
character in a TypeScript string literal. What broke was silent and off to one
side:

```
$ grep -rn "naturalAlignForOpcode" src/
Binary file src/bridge/binaryen-bridge.ts matches
```

grep classifies a file containing a NUL as BINARY and prints that line INSTEAD
of the matches. The bridge dropped out of an alignment-duplication sweep
entirely — **and the sweep reported clean.**

**Why this is worse than an ordinary bug.** Every enumeration in INDEX.md's
audit definition is grep- or regex-driven over the source: `Var`-bearing fields
vs `resolveNames` cases, `Expr`-bearing fields, delegate hooks vs walkers, arity
tables, handler families, the source-enumeration gates added in T13.18 and
T13.21. One invisible byte silently narrows the population every one of them
measures, and each still reports success. It is the audit definition's own
worst-case shape — a silent fall-through — relocated into the tooling.

Caught only because `grep` printed "Binary file … matches" where match lines
were expected, and that looked wrong enough to chase.

Fixed twice over: `IF_FRAME` is now the visible `'<if-frame>'` (which cannot
collide with a real label either — those always begin with `$`), and
`tests/audit/source_hygiene.test.ts` scans every `.ts` under `src/` and `tests/`
for control bytes other than TAB / LF / CR. **It pins its own population too**
(`scanned > 100`), so a broken directory walk cannot report a clean tree —
the guard-the-guard step T13.24 introduced, now standard. Inverted before
trusting: re-introducing the NUL turns it red naming the file and offset.

#### Also this round: the bridge alignment differential is CLEAN

Scoping T13.18's shape (a duplicated natural-alignment table) into the bridge.
It calls the canonical `naturalAlignForOpcode` at five of seven memarg sites,
but the plain `load` and `store` cases pass `LoadInfo.bytes` from the bridge's
OWN opcode decode — a second source of truth for the same fact.

**Differentialled end to end across 23 load/store opcodes** with `align=`
omitted, so both encoders must fall back to natural alignment: bridge output
decoded and compared against our own encoder's. **0 mismatches.** The two tables
agree everywhere they overlap.

Recorded as a negative result rather than left unstated: the duplication is real
and remains a latent drift risk, but it is not currently wrong, and the next
person should not have to re-derive that. This sweep is also the one the NUL had
silently excluded the bridge from — it was re-run after the fix, which is the
only reason there is a result here at all.

### T13.26 — DONE. A memarg alignment exponent WRAPPED, and the pipeline repaired an invalid module (2026-08-25).

**The first finding in many rounds to move a conformance metric**:
`assert_invalid` 2671 → **2673**, closing both `align.wast` false-accepts.

`readMemArg` decoded the alignment as `1 << alignLog2`. **JS shift operands are
taken mod 32**, so an absurd exponent wrapped into a plausible one:

    exponent 32  ->  1 << 32  ===  1     decoded as align=1
    exponent 33  ->  1 << 33  ===  2     decoded as align=2

A *small* alignment is smaller than the opcode's natural alignment, so
`checkAlign` waved it through — and V8 and Wasmtime both reject those modules.

**The severity is the round trip, not the false accept.** The pipeline REPAIRS
the module:

| step | verdict |
| --- | --- |
| input, align exponent 32 | V8 **reject**, Wasmtime **reject** |
| `wasm2wat` | prints `i32.load align=1` |
| `wat2wasm` of that text | V8 **ACCEPT**, Wasmtime **ACCEPT** |

An invalid input silently becomes a valid, different program. That is the **T11
class** — "the pipeline must never turn invalid input into valid output" —
reached through the DECODER. T11 was fixed in five places at once (parser,
binary reader, binary writer, WAT writer, validator) and this is a sixth,
missed because it is not about element types at all: the shared property is
"a layer normalises something it should have preserved or rejected".

#### Why it read as covered, and the reusable part

**Exponents 31 and 63 wrap to a NEGATIVE number** (`1 << 31` is -2147483648).
Negative is also smaller than natural alignment, but it happened to be rejected
by a different check — so **spot-checking a large exponent gave the right answer
for the wrong reason**. Only 32..62 expose the bug, and the boundary that
matters is where the SHIFT wraps, not anywhere a person would think to probe.

The general lesson: **when a value is derived by a bit operation, the
interesting boundaries belong to the OPERATION, not to the domain.** A reviewer
probing alignment thinks in natural alignments — 1, 2, 4, 8, 16, then "something
huge". Every one of those is either valid or accidentally-rejected. The
dangerous inputs sit at 32 and 33 because that is where `<<` folds, and nothing
about alignment suggests them. The regression test pins 31 and 63 alongside 32,
33, 34 and 62 for exactly this reason.

Fix: `2 ** alignLog2`, which cannot wrap. The decoder keeps decoding faithfully
and the validator does the judging — the division of labour used everywhere else
in this reader. Verified across exponents 2 / 4 / 31 / 32 / 33 / 63: all six now
agree with V8, and a `grep` for other `1 <<` sites in `src/` found no further
shift-wrap risk.

Regression: `tests/reader/memarg_align_wrap.test.ts`, 12 steps — the natural
alignment, nine oversized exponents including both wrap points and both
accidentally-rejected ones, the round-trip-must-not-repair assertion, and a
multi-memory case (the memidx lives in bit 6 of the same byte, so a fix that
masked differently could have broken it). **Sensitivity:** reverting turns
exactly 32 / 33 / 34 and the repair test red, and leaves 31 and 63 green —
which is the documented "rejected for the wrong reason" made visible.

#### How it was found

Reader/writer memarg symmetry, read side by side, during the first real audit
pass over `binary-reader.ts` (3059 lines, the largest surface never enumerated
here). The two agree on the flag bit; the bug was one line further on. **Reading
a decode and its matching encode next to each other is a cheap axis** and this
file had never had it applied.

#### Negative results from the same pass

Recorded so the next auditor does not re-derive them:

- **Section dispatch is total** — 14 of 14 `BinarySection` members have a case,
  so the `default: this.pos = sectionEnd` is unreachable; unknown ids are
  rejected loudly upstream by the `sectionOrderRank(...) < 0` check.
- **`SECTION_ORDER` is complete and in spec order** — all 13 non-custom
  sections, so no valid section can be misread as malformed.
- **The T10.8 placeholder discipline holds** — 104 `operandPlaceholder` sites in
  the reader and 15 in the parser; the only two bare `{ kind: 'nop' }` literals
  are genuine `Opcode.Nop` / `TokenType.Nop` instructions, which must NOT carry
  the placeholder marker or the writers would drop them.
- **Writer/reader opcode coverage** — every opcode the writer emits as a literal
  enum constant has a reader case. (Weak: the writer emits most opcodes
  generically from the IR, so this axis says less than its clean result
  suggests. Noted rather than claimed.)

### T13.27 — NO DEFECTS FOUND. Six axes across the binary reader and the strip tool, all clean (2026-08-25).

A full audit pass that found nothing. Recorded because **"clean" and "never
examined" are indistinguishable from the code** and imply different next
actions — the standing rule this project adopted in T13.18 and has been applying
since. Each entry below says what was varied and WHY the answer is what it is,
so a future pass can check whether the reasoning still holds rather than
re-deriving it.

Driven by the axis T13.26 validated: **read a `readX` next to its `writeX`**,
plus the "probe the operation's boundaries" rule, applied to the parts of
`binary-reader.ts` (3059 lines) that T13.26 did not reach, and then to a
published tool that had never been audited at all.

| axis | result | why it holds |
| --- | --- | --- |
| `readBlockType` accepts any byte 0x41–0x7f as a value type | **clean** | permissive at decode, but every bogus byte (0x41, 0x50, 0x55, 0x5e, 0x5f, 0x60) is rejected DOWNSTREAM by the validator. Tested against V8 as oracle: 8/8 agree |
| `readLimits` flag byte | **clean** | rejects any undefined bit (`flags & ~0x0f`), and the custom-page-size field is read LAST so it cannot mis-frame following fields. Both were past bugs and both carry their comment |
| `readMutability` | **clean** | rejects `> 1` outright |
| `readSubType` / `writeSubType` | **symmetric** | 0x4f final / 0x50 non-final, count, supertype indices, then the comptype — the writer emits exactly what the reader expects |
| `wasm-strip` on modules with NO custom sections | **clean, 10/10** | byte-identical no-op across func, data, elem, start, multi-memory, tag + try_table, GC struct, SIMD, atomics, memory64 |
| `wasm-strip` on modules WITH custom sections | **clean, 4/4** | removes exactly the custom sections and returns bytes identical to the custom-free original — one section, two sections, empty payload, empty NAME |

`wasm-strip` is worth singling out: it is a PUBLISHED entrypoint that MUTATES a
module, and it had never been audited. A strip that altered anything beyond the
custom sections would be silent corruption of user data with no diagnostic
anywhere. It does not.

#### The honest reading

This is the shape T13.18's decay note predicted, now visible on a second axis
family. The high-yield rows of the recurrence table have been swept; the encode/
decode axis paid off once (T13.26) and then went quiet within the same file. Two
consecutive passes over `binary-reader.ts` produced one real bug and six clean
results.

That is not an argument for stopping — it is an argument for **recording the
sweep so the next pass starts somewhere else.** The parts of this codebase never
enumerated are now: `wasm-objdump`'s rendering, `type-map.ts`, `ir-util.ts`'s
`getExprArity` for CORRECTNESS rather than totality, and the lexer beyond the
opcode tables T13.6 fixed.

### T13.28 — DONE. The hygiene gate did not cover the files the workflow actually greps (2026-08-25).

T13.25 gated `src/` and `tests/` against control bytes. **`cmem/` and
`README.md` were not in scope**, and five control bytes had accumulated there —
so `cmem/tasks.md` and `cmem/design-decisions.md` were BINARY to grep, and
searching project memory is itself a grep.

| file | byte | what it should have read |
| --- | --- | --- |
| `cmem/tasks.md` | `0x08` | `\b` inside the documented id-lookup regex |
| `cmem/tasks.md` | `0x0c` | `\0c` in a WAT data-segment escape example |
| `cmem/design-decisions.md` | `0x00` | `\0` in the sentence explaining the T13.25 NUL |
| `cmem/design-decisions.md` | `0x0c` | `\0c`, same example |
| `cmem/best-practices.md` | `0x0c` | `\0c`, same example |

**The `0x08` is the one that matters.** T13.19 documented the command for
picking the next tranche id — `grep -ohE '\bT13\.[0-9]+' cmem/tasks.md` — and
the `\b` in it had collapsed to a literal backspace. **The instruction the
ledger gives for the single most routine bookkeeping step was silently
corrupt**, and would have produced a regex matching nothing for anyone who
copied it.

The `0x00` is the more embarrassing one: it sat inside the prose explaining the
NUL-byte hazard, three lines from the rule telling people not to write NULs.

#### Root cause, and why it kept happening

Every one is a two-character escape sequence (`\b`, `\0`) that a shell heredoc
collapsed into the single byte it names, while writing these files through
`python - <<'PY'` one-liners. The quoting is the hazard, not the content — the
same class that mangled a regex three separate times in T13.19 and produced the
original `IF_FRAME` NUL in T13.24.

**The durable fix is the gate, not the discipline.** Extended
`tests/audit/source_hygiene.test.ts` to `src/`, `tests/`, `cmem/` and
`README.md`, and to `.md` as well as `.ts`. Inverted before trusting: injecting
a NUL into `cmem/overview.md` turns it red naming the file and offset.

**Scope a hygiene gate to every file the WORKFLOW greps, not just the files that
compile.** The original scope was drawn around what the compiler reads, which is
the wrong boundary for a property that exists to keep the audit method working —
and `cmem/` is the most-grepped directory in the project.

#### Also found: `ModuleContext.getExprArity` is dead, and a performance invariant rests on it

Working the frontier list (`ir-util.ts`'s `getExprArity` for CORRECTNESS rather
than totality), the correctness question turned out to be moot: **it has no
production caller.** One test in `tests/audit/silent_corruption_fixes.test.ts`
exercises it; nothing in `src/` does.

Two things follow, both about the RECORD rather than the code:

- Its doc comment says the context is *"reused across validator, binary writer,
  and bridge"*. Only the WAT writer extends `ModuleContext`, and it never calls
  this method. The comment is false.
- `design-decisions.md` carries a **performance invariant** — "`ModuleContext`
  builds `funcSigsByIndex` and `tagArityByIndex` once … `getExprArity` runs for
  every expression during validator and writer walks, so the cost compounds."
  The justifying path does not run. `ModuleContext.getFuncSig` /
  `getTagArity` have no other callers either; `binary-reader.ts` has its own
  free function of the same name, which is what actually gets used.

**Not removed.** `ir-util.ts` is re-exported from `src/index.ts`, so all three
are published API and deleting them is a breaking change — unlike
`getOpcodeNaturalAlign` (T13.18) and `Validator.refNullType`, which were both
internal. Recorded here, and the invariant in `design-decisions.md` corrected to
say what is actually true, so the next reader does not defend a hot path that
has no traffic.

### T13.29 — DONE. All four binary tools THREW on malformed input (2026-08-25).

`wasm2wat`, `wasmValidate`, `wasmObjdump` and `wasmStrip` are published
entrypoints whose contract is `{ errors, result }`. On untrusted bytes they
threw an uncaught `RangeError` instead — **~102 of 585 truncated or
single-byte-corrupted modules, for every one of the four.** A consumer doing the
correct thing:

```ts
const { text, errors, result } = wasm2wat(untrustedBytes);
if (result !== Result.Ok) { /* handle */ }
```

got a crash. For tools whose entire job is processing untrusted binary input,
that is the contract broken exactly where it matters.

**This is T7.1's rule at the other front door.** "Parser robustness — never
throw, never hang, readable diagnostics" was done for the WAT parser and never
for the binary path. Same rule, same argument, other entrypoint — and nobody
went looking because the WAT side had been dealt with.

#### The fix, and what deliberately did NOT change

Every exception came from `core/leb128.ts`'s `decode*Leb128` — `LEB128 sequence
is truncated` (48) and `LEB128 u32 overflow` (19).

**`leb128.ts` still throws, and that is correct.** It is a pure decoder, and its
other callers (the WAT parser, the bridge) want the throw. Softening it there
would have traded a loud bug for a silent one across three subsystems. The
defect was that nothing converted the throw at the READER's boundary:

- the four `readXLeb` helpers now catch, report a positioned diagnostic, park
  the cursor at end-of-input (so a caller ignoring `hadError` cannot spin), and
  return a safe zero — after which the existing `hadError` / `ok()` machinery
  halts decoding on its own;
- `readBinaryIr` carries a backstop `try/catch`, because **one unconverted throw
  anywhere in 3000 lines of decoder reproduces the entire bug**, and a
  four-entrypoint contract should not rest on having found all of them.

`wasmStrip` needed a second, different guard. It RE-ENCODES, and a module can
decode cleanly and still be un-encodable — index validity is the VALIDATOR's
job, not the reader's, so a corrupted binary whose func references a type the
type section no longer contains reaches the writer with no decode error. The
binary writer is deliberately fail-loud (T10.7) and must stay so; the TOOL
catches. Two inputs hit this.

#### Method

Found by fuzzing the published surface rather than by enumeration: every
truncation (147) plus every single-byte corruption to 0x00 / 0x7f / 0xff (438)
of one module exercising every section kind. 585 inputs, four tools, about
fifteen lines of harness — and it is the first axis this session that was not a
type or table enumeration.

**Worth keeping as a standing axis:** any entrypoint that accepts bytes from
outside gets the truncate-and-corrupt sweep. It needs no oracle (the property is
"does not throw", not "is correct"), no corpus, and no fixtures.

Regression: `tests/tools/malformed_never_throws.test.ts`, 10 steps — both sweeps
for all four tools, plus two guards against over-correcting: a truncated module
must still be REPORTED (swallowing everything would pass the throw assertions),
and the intact module must still decode clean.

**No metric moved and none could** — all seven operate on well-formed input by
construction.

### T13.30 — DONE. `/compat` threw two different SHAPES of error, and the undocumented one was the surprise (2026-08-25).

Found by **scoping T13.29** — that fixed the four byte-consuming CLI tools; the
shape is "every published entrypoint that accepts outside input", and two were
left: `wat2wasm` (text) and `/compat`.

The `/compat` module docs are explicit and asymmetric:

    parseWat(filename, source, features?)  — throws on parse error
    readWasm(buffer, opts?)                — throws on decode error
    toBinary(opts) -> { buffer }           — "encodes the IR"

The first two surface failures as `new Error(formatErrors(errors))`. The third
documented no throw at all and propagated the binary writer's own internal
string. **The same API failed in two different shapes depending on which method
you called, and the method that surprised you was the one whose contract did not
mention failing.**

**Reachable with no mistake by the caller.** A module can decode cleanly and
still be un-encodable — index validity is the VALIDATOR's job, not the
reader's — so `readWasm` of a corrupted binary whose func references a type the
type section no longer holds hands back a module, and `toBinary` is where it
dies. 2 of 585 fuzz inputs.

`/compat` is the **wasmtk-facing migration surface** (`jsr:@jrmarcum/wabt-ts/compat`,
consumed as `import wabt from "wabt"`), which makes this the more consequential
half of the same shape fixed in `wasmStrip` under T13.29.

Fix: `toBinary` wraps the writer's throw in an error naming itself
(`toBinary: the module could not be encoded: …`) and the doc comment now says it
throws and why. **The binary writer still throws and must** (T10.7) — it refuses
to emit bytes it cannot justify; what changed is the shape at the boundary and
the honesty of the docs.

Regression: `tests/api/compat_error_shape.test.ts`, 3 steps — every throw across
585 fuzz inputs must be an `Error` naming its origin (with the population pinned
at `threw > 50` so it cannot go vacuous), the specific decode-clean /
encode-impossible case, and a valid round trip as the over-correction guard.

#### Negative results from the same sweep

- **`wat2wasm` never threw** across 314 truncations + 2191 single-character
  corruptions using structurally meaningful characters (parens, quote, `$`,
  backslash, space, semicolon). T7.1's parser-robustness rule holds, and the
  fail-loud writer is not reachable from malformed TEXT because parse errors
  stop the pipeline before `writeBinaryIr`.
- **`/compat parseWat` throws only contractually** — 62 of 62 throws were
  documented parse errors.

#### The method note

Two findings in two sessions from the same one-paragraph harness, on surfaces
that six conformance metrics and 380 tests never touch. **The fuzz axis is
cheap because the property needs no oracle** — but its real value here was as a
SHAPE to scope: T13.29 fixed four entrypoints, and asking "which others take
outside input?" produced this one directly.

### T13.31 — DONE. Every CLI shim dumped a Deno stack trace on a mistyped filename (2026-08-25).

The `if (import.meta.main)` blocks in `src/tools/*.ts` are published
entrypoints — `deno run -A jsr:@jrmarcum/wabt-ts/wasm-validate module.wasm` is in
the README. Each read its input with a bare `await Deno.readFile(path)`, so a
missing file or a directory escaped uncaught:

```
error: Uncaught (in promise) NotFound: The system cannot find the file
specified. (os error 2): readfile 'nosuchfile.wasm'
    const binary = await Deno.readFile(input);
    at async Object.readFile (ext:deno_fs/30_fs.js:1:9754)
    at async file:///D:/…/src/tools/wasm-validate.ts:150:20
```

**Five tools, two failure modes, ten for ten.** A wall of Deno internals plus
the absolute path of our own source, in response to a typo — and local paths
leaked into whatever the user pastes into a bug report. Exit code was already 1,
so only the output was wrong.

Same rule as T13.29 ("report, do not throw") and T13.30 ("name the origin"), one
layer further out: `cliRead` / `cliWrite` in each tool print
`<tool>: cannot read '<path>': <reason>` and exit 1. The write path was
unguarded too and is now covered.

#### The frontier list was itself incomplete

The CLI shims were **not on the "what has NOT been enumerated" list at all** —
that list tracked library surfaces and silently omitted a whole published
entrypoint class. Added, along with a note that **the frontier record is only as
good as the last person to widen it**: an audit that works from the list will
never reach what the list forgot, and a missing row looks exactly like a swept
one.

#### The test needed splitting, and the reason is worth knowing

`deno task test` runs `deno test --allow-read`. A subprocess test needs `run`
and `write`, so it could never execute in the normal gate — and **a test that
always skips protects nothing.** Broadening the whole suite to `-A` for one file
is the wrong trade: every other test would gain permissions it does not need.

So `tests/tools/cli_io_errors.test.ts` has two halves:

1. a **source gate** needing only `--allow-read`, which therefore always runs:
   no `import.meta.main` block may call `Deno.readFile` / `writeFile` /
   `writeTextFile` directly. This is where a regression would actually be
   reintroduced, and it catches it at the definition site. A second step asserts
   each tool DEFINES `cliRead` and passes its own name, so the first cannot pass
   vacuously against a tool that simply does no I/O.
2. the **behavioural half**, spawning the real CLIs, `ignore`d when `run` /
   `write` permission is absent — loudly (Deno prints `ignored`), not silently.

**Scoping a test's permissions is a design decision, not a detail.** The
question to ask is which half of the property can be checked at the lowest
privilege, because that is the half that will run every day.

Sensitivity: reverting one tool to `Deno.readFile` turns the source gate red
naming the tool and the call. Verified by hand as well — all ten failure cases
now print one line, and the happy paths (`wat2wasm -o`, `wasm2wat`,
`wasm-validate`, `wasm-objdump`) still work.

**Gate: 381 tests / 2689 steps** with 1 ignored by design; conformance unchanged.

### T13.32 — NO DEFECTS FOUND, but the lexer's token reachability is now pinned (2026-08-25).

The last item on the frontier list: the lexer beyond the opcode tables T13.6
made permanent. **No bug.** What came out of it is a gate against a regression
that would otherwise be invisible, and the frontier list is now empty.

#### What the enumeration showed

`TokenType` has 182 members. Differentialled against `TokenType.X` references in
`wast-lexer.ts` (produces) and `wast-parser.ts` (consumes):

| | count | verdict |
| --- | --- | --- |
| emitted by the lexer | 180 | — |
| consumed by the parser | 173 | — |
| **emitted by neither** | **2** | both deliberate, see below |
| emitted but never consumed | 7 | correct; see below |

**The two never emitted are deliberate**, and both were already explained
somewhere:

- `SimdLoadSplat` — superseded. `v128.load8_splat` lexes as `TokenType.Load`
  carrying a SIMD sub-opcode (`op(TokenType.Load, S(0x07))`), not as its own
  token type.
- `LparAnn` — deliberately abandoned, and `wast-lexer.ts` says so IN PLACE:
  annotation bodies contain arbitrary reserved characters, so they are skipped
  at the CHARACTER level; *"emitting LparAnn and letting the normal lexer
  continue produced 'unexpected char' on the first `,`"*.

**The seven emitted-but-unconsumed are correct too.** `Invalid` and `Reserved`
are sentinels; `After`, `Before`, `Code`, `Input`, `Output` are wabt SCRIPT
keywords the parser never implemented — and they appear in **zero** spec-testsuite
files. An unhandled token yields a parse error, which is the right outcome for an
unsupported feature.

#### Why it still got a gate

Neither dead member is a bug, but the SET is worth pinning, and the reason is
the other direction:

**A member stops being emitted when its `KEYWORDS` entry is deleted or
mistyped — and that is not a compile error. It is valid WAT quietly failing to
parse, with the error surfacing somewhere unrelated.** A `const enum` member
with no remaining reference produces no diagnostic at all.

`tests/parser/token_type_reachability.test.ts` pins the never-emitted set to a
documented allowlist, so that regression becomes a red test naming the token.
Four steps, and three of them guard the guard:

- the population is pinned (`members.length > 150`) so a broken enum scrape
  cannot pass vacuously;
- an allowlist entry that starts being emitted fails (stale exemption);
- an allowlist entry whose member no longer exists fails (ghost exemption);
- the emitted-but-unconsumed set is asserted EQUAL to its known list, so it
  cannot grow silently — growth there usually means a parser case was dropped.

**Sensitivity:** deleting the `['after', bare(TokenType.After)]` keyword mapping
turns two steps red, naming the token. That is exactly the shape of the
regression being guarded.

#### The frontier is empty

Every surface on the "what has NOT been enumerated yet" list has now had an axis
run against it. That is not a claim that the code is clean — it is a claim that
the CHEAP axes are spent, and the next pass should either invent a new axis (the
fuzz axis in T13.29 was the last one that paid, and it paid three times) or
accept a lower yield. Recorded plainly rather than left implicit, so nobody
reads the empty list as "audited, done".

### T13.33 — DONE. The type section silently truncated on a count/content mismatch (2026-08-25).

Found through a **hardening** lens rather than a bug hunt, and that framing is
why it was found at all — see the method note at the end.

    (type count 4294967295)  with no entries  ->  decoded to ZERO types,
                                                  reported nothing, validated
                                                  clean. V8 rejects it.

Ten of the eleven section readers check the section bound INSIDE the loop and
report when the input runs out:

```ts
for (let i = 0; i < count && this.ok(); i++) {
  if (this.pos >= end) return this.shortSection();
```

`readTypeSection` put the same bound in the loop CONDITION instead —

```ts
for (let g = 0; g < groupCount && this.pos < end && this.ok(); g++) {
```

— so running out of input was **indistinguishable from finishing normally**.
Both of its loops had it, the rec-group inner loop included. One reader of
eleven: the asymmetry-in-a-family shape again, and the tenth time it has paid
here.

Every mismatch shape is affected, not just the enormous one: count 5 with no
entries, count 2 with one entry, a rec group of 4 with one entry. All decoded
clean; V8 rejects all of them.

Fixed to match the ten siblings. Metrics unchanged — agreement still 449 / 449,
so the tightening rejects nothing that was valid.

#### Three hardening axes that came back CLEAN

Recorded because "clean" and "never examined" are different states, and because
these are the axes a future reader would otherwise re-derive:

- **Enormous declared counts do not hang or over-allocate.** A 14-byte module
  declaring 4 294 967 295 entries fails in 0 ms in every one of the eleven
  sections — none loops or allocates before checking the remaining input. (The
  TYPE section failed silently, which is the bug above, but it still failed
  fast.) Pinned by a step in the regression test that asserts both properties
  across all ten countable sections.
- **Deep nesting does not overflow the stack.** Every layer here is recursive —
  the parser's descent, `resolveNames`, the validator walk, both writers. 100 000
  nested `block`s round-trip in 40 ms; 60 000 nested folded `i32.add` operands in
  55 ms. Full `wat2wasm -> validate -> wasm2wat -> wat2wasm` each time.
- **No superlinear scaling.** Five shapes (exports, locals, types,
  globals+references, funcs+calls) measured at 250 / 500 / 1000 / 2000. Growth
  factors per doubling cluster around 2 (range 0.6–2.6); nothing approaches the
  4 that would signal quadratic. The `nameIndexMap` and `funcSigsByIndex`
  precomputations recorded in design-decisions.md are holding.

#### The method note, which is the reusable part

**T13.29's fuzzing could not have found this, and the reason is the question it
asked.** That sweep fed the tools 585 truncated and corrupted modules and
asserted *does it throw?* — a property needing no oracle, which is exactly why
it was cheap. This module does not throw. It decodes, returns a Module, and
reports success.

The hardening question is different: *does it NOTICE?* Same malformed inputs,
different property, and the second one needs an oracle — which is why it costs
more and why it was not on the fuzz axis.

**So "we fuzzed it" is a claim about ONE property.** When a robustness sweep
comes back clean, the useful follow-up is not more inputs but a different
question about the same inputs: does it survive / does it notice / does it
report accurately / does it terminate / does it stay linear. Each is a separate
axis over the same corpus, and this one paid on the first try after the
survive-axis had been declared clean.

### T13.34 — DONE. Two limits on the subtyping graph that both engines enforce and we did not (2026-08-25).

Second hardening pass, probing the TYPE graph for hangs and blowup. It found no
hang — and two silent accepts.

**1. Subtyping DEPTH is capped at 63.** The GC proposal fixes the limit so a
subtype check can be O(1) (a depth-indexed display rather than a walk).
**Wasmtime rejects deeper chains and so does V8** (`type 64: subtyping depth is
greater than 63`), so this is a spec limit rather than a V8 quirk — unlike the
2^48-page memory case, where Wasmtime accepts and V8 does not. We accepted
chains of any length: a 2000-deep chain validated clean here and loads nowhere.

The boundary is exact and both sides are pinned: 64 types is 63 ancestors and is
legal; 65 types is 64 ancestors and is not. An off-by-one rejects valid modules.

**2. Supertype CYCLES were accepted.** `$a` extending `$b` extending `$a`, a
3-cycle, and the self-referential `$a extending $a` all validated clean. Both
engines reject: `type 0: invalid supertype`.

Both fixes live in one new `SharedValidator.checkSubtypingDepth`, called after
the whole type section is registered (a type may legally name a supertype
declared later in its own rec group). Memoised, so a 2000-type chain is linear.

#### The cycle half is a lesson about trusting your own comment

The depth check was written first, with a cycle guard and this comment:

> `state` marks a node as in-progress, and meeting an in-progress node returns 0
> and **lets the ordinary subtype checks report the cycle**.

**Nothing reported the cycle.** The claim was plausible, written immediately
after reading the surrounding code, and false. It would have been believed by the
next reader — including me, later.

It was caught only because the probe that produced the depth finding also
included a cycle case, and the result line said `ACCEPT(!)`. Had the comment gone
unchecked, this entry would record one fix and quietly ship the other bug behind
a sentence asserting it was handled.

This is T13.24's rule turned on my own work: **a thoughtful comment about one
case is evidence the neighbouring case was never tested.** The reporting itself
was free — a depth walk must already detect cycles to terminate, so `inProgress`
had the answer and was discarding it.

#### Cycles vs. legal recursion — the distinction the fix must not blur

A rec group whose types REFERENCE each other is the entire point of rec groups
and is legal. Only the SUPERTYPE graph must be acyclic. Conflating the two would
reject ordinary GC modules, so the regression test pins mutual field references
(`$a` has a field of type `$b` and vice versa) as ACCEPTED alongside the rejected
supertype cycles.

#### Hardening axes clean in the same pass

- **Long subtype chains are linear**, not quadratic: 2000 types validate in
  ~12 ms, and the memoised walk is pinned by a timing step.
- **Large mutually-recursive rec groups are linear** — 400 types, 4 ms — and
  **two identical 300-type rec groups** compare structurally in 4 ms, so the
  canonical-key machinery is not blowing up.

#### And a claim in the record, verified

The five remaining `assert_invalid` misses were extracted and checked
individually: **there is no module among them that we accept and V8 rejects.**
They are modules V8 accepts too — a permissive engine against a stricter spec,
not our defect. This confirms the standing note ("every remaining miss is a
module V8 accepts too") rather than inheriting it, and rules out the remaining
`type-rec.wast` miss being the same family as this fix.

### T13.35 — NO DEFECTS FOUND. Three more hardening axes, and one oracle that did not hold up (2026-08-25).

Third hardening pass. Two axes clean, one **inconclusive** — and the
inconclusive one is the entry worth reading, because it is a probe that failed
in a way I nearly did not notice.

#### Size amplification — CLEAN, and the classification is the point

Probed everything where a small input drives a size-derived computation or an
allocation: `(memory 65536)` and one over, memory64 at 2^32 and 2^48, tables at
2^32-1 and i64, custom page sizes 1 and 65536, data and elem segments at
0xffffffff offsets, and a memarg offset of 2^64-1 on a 64-bit memory.

**No hangs, no allocation blowup, and no nonsense in the disassembly** — the
output was scanned for `Infinity` / `NaN` / exponent notation, which is the
shape the `(pagesize Infinity)` bug took, and none appeared.

Six of these are `ours=ACCEPT / v8=reject`, and that is where the pass could
have gone badly wrong. **Wasmtime accepts all six.** Every one is a V8
implementation limit, not a spec limit, so accepting them is correct — the same
situation as the 2^48-page `memory i64` already recorded in the metrics table.
Had this been run against V8 alone, the obvious next move would have been to add
six limits and start rejecting valid modules.

#### String and name scaling — CLEAN

Four doubling series, each measured through a full
`wat2wasm -> validate -> wasm2wat -> wat2wasm`: a single export name from 4 000
to 32 000 characters; a data segment where EVERY byte needs escaping (the worst
case for the escaper) to 32 000 bytes; 500 to 4 000 separate data segments; and
250 to 2 000 exports each carrying a 200-character name.

Growth factors per doubling: **0.2 to 2.3, clustering at 1–2**. Nothing
approaches the 4 that signals quadratic. The escaper is linear, and the
`nameIndexMap` precomputation holds under many long names.

#### Diagnostic accuracy — INCONCLUSIVE, and the oracle is why

This was the one row of the axis table from T13.33 never run: *does it REPORT
accurately?* It needs an oracle, which is what makes it expensive.

The cheap oracle I could build: corrupt byte N, and check the reported error
offset is at or shortly after N. Across 317 corruptions that produced an error,
it flagged 32 as suspicious.

**All the flagged cases I examined are correct**, and the oracle was wrong:

- `LEB128 u32 overflow` for a corruption at byte 13 reported offset **9** — and
  9 is where that LEB *starts* (`86 80 80 80 00`, a 5-byte non-minimal encoding
  of 6). Reporting the start of the malformed construct is BETTER than reporting
  where the decoder gave up. The oracle's "offset must not precede the
  corruption" rule is simply false for any multi-byte construct.
- `unexpected end of binary` reported at end-of-file for a corruption that
  altered a length. Pointing at where the input ran out is standard decoder
  behaviour.

So the axis is **neither clean nor dirty — it is unmeasured**, and this is
recorded as unmeasured rather than as a pass. The cost estimate in T13.33 ("the
last two rows cost an oracle, which is why they get skipped") is confirmed
rather than defeated.

**The reusable part:** this is the T13.22 non-discriminating-probe lesson in a
new form. There the probe could not tell the hypothesis from its negation; here
the probe *could* discriminate but was measuring the wrong property, so its
"failures" were correct behaviour. **A probe that produces findings is not
thereby a good probe** — before believing 32 flagged cases, read three of them.
Had I reported them as defects, the "fix" would have made the diagnostics worse
by pointing at the corrupted byte instead of the construct that contains it.

#### Where this leaves hardening

Four axes are now swept clean (huge counts, deep nesting, algorithmic
complexity, size amplification, string scaling) and two have paid (T13.33's
count/content mismatch, T13.34's subtyping depth and cycles). The remaining
unrun axis is **diagnostic quality**, which needs a real oracle and is
open work rather than a gap in the record.

### T13.36 — NO DEFECTS FOUND. Three axes clean, and a claim of mine that needs correcting (2026-08-25).

Fourth hardening pass.

#### Module-level mutable state — CLEAN

A shared mutable cache at module scope leaks between calls and breaks under
reentrancy, and nothing had ever checked for one. Enumerated every module-scope
binding across `src/`:

**Zero `let` and zero `var` at module scope, in the whole of `src/`.** Every
module-level container is a `ReadonlyMap` / `ReadonlySet` lookup table built
once at load — opcode names, keywords, token names, heap-type maps, the SIMD
unary set, the subtype parent tables.

The only mutable module state is `F32_BUF` / `F64_BUF` (`ArrayBuffer` + `DataView`
scratch, a recorded performance invariant). They are safe: written and read on
ADJACENT lines, and `wast-parser.ts` contains **zero `await`**, so nothing can
interleave between the write and the read. Worth stating explicitly, because
that safety argument is a property of the parser being synchronous — if it ever
gains an `await`, these become a live hazard.

#### Round-trip CONVERGENCE, text side — CLEAN

T10.5's lesson was "valid and correct do not imply CONVERGES": a stray nop was
inert, correct, and grew the module 4 bytes per round trip forever. The
byte-identical round-trip metric proves the BINARY side reaches a fixed point.
**The TEXT side is asserted nowhere.**

Iterated `wat -> binary -> wat -> binary -> …` and watched both sizes:

- 14 hand-built shapes covering blocks, folded arithmetic, multi-value, memory /
  data / elem, globals + start, SIMD, atomics, GC, `try_table`, legacy `try`,
  if/else, loop + `br_if`, `br_table` — **all settle at iteration 1**;
- the full **272-file wasmtk corpus — 272 / 272 settle at iteration 1**, none
  later, none never, none failing the pipeline.

Settling at iteration 1 means the first output already equals the second: the
fixed point is immediate, not merely eventual.

#### Gate vacuity — CLEAN

A hardening check on the test suite rather than the product, since a dozen test
files were added this session. Looked for tests that can silently not run:

- exactly **one** `ignore`, the deliberate permission-gated block in
  `cli_io_errors.test.ts`, which Deno prints as `ignored` rather than passing
  silently;
- **no `only:`** anywhere (one would silently disable the rest of a file);
- **no data-driven table that parses to zero entries** — a `for (const x of
  TABLE) it(...)` over an empty table generates no tests and reports success.

#### A claim of mine, corrected

After T13.33 I wrote, in `overview.md` and `best-practices.md`:

> **hardening does not decay the way bug-hunting does**, because the input space
> is not exhausted by finding a bug in it

That was written after ONE successful pass and is **too strong**. The record now:

| pass | axes | findings |
| --- | --- | --- |
| 1 (T13.33) | counts, nesting, complexity | **1** |
| 2 (T13.34) | type graph | **2** |
| 3 (T13.35) | size amplification, string scaling, diagnostics | 0 |
| 4 (T13.36) | module state, convergence, gate vacuity | 0 |
| 5 (T13.37) | diagnostic WORDING (binary reader), against the spec's expected error texts | **2** |
| 6 (T13.38) | the same oracle applied to the VALIDATOR and the PARSER populations | **2** |
| 7 (T13.41) | encoder waste; `wasm-strip` fidelity; the binary -> IR -> binary path | **1** |
| 7 (T13.42) | the format-check procedure itself (same pass) | **1** |
| 8 (T13.43) | the RELEASE path and the gate-coverage surface | **1 + a gate gap** |
| 8 (T13.44) | the call site of the guard T13.43 added (same pass) | **1** |

Two findings in four passes, the last two empty — the same curve enumeration
showed. The accurate statement is narrower: **the input space is not exhausted,
but the CHEAP hardening axes are consumed at the same rate as the cheap
enumeration axes.** What remains on this lens is the expensive row — diagnostic
quality — which needs a real oracle (T13.35).

**Updated 2026-08-25, one pass later.** That prediction held, and cost less than
"expensive" implied: the fifth pass ran the one axis this note named as
remaining, the oracle it needed turned out to be sitting in the testsuite
already, and it produced **2 findings** (T13.37). So the curve is 1, 2, 0, 0, 2 —
not a decay to zero but a decay *of the cheap axes*, with the rate set by how
hard the next oracle is to obtain rather than by how much is left to find.
**Two empty passes in a row meant the axis list was stale, not that the code was
clean.**

Corrected in place rather than deleted, per the standing rule: the correction is
the useful artifact, because it tells the next reader the claim was tested.

### T13.47 — BLOCKED, and the blocker is not the one we were waiting for (2026-08-25).

binaryen-ts published **1.5.0** with their half of the T13.22 catch-scope fix,
which is what the coupling had been waiting on since the pin was made exact. The
upgrade was attempted, verified, and **not landed**. `main` is unchanged at
`1.0.9`; the work sits on branch `t13.22-binaryen-1.5.0` (`23f31299`).

#### Our half is done and proven

`bridgeExpr`'s `try_table` now builds its catch clauses BEFORE pushing the
try_table's own label. Measured against our own encoder as reference:

| | binaryen-ts 1.0.9 | binaryen-ts 1.5.0 |
| --- | --- | --- |
| bridge **old** | MATCH — the cancellation | throws / silently depth 0 |
| bridge **fixed** | wrong: depth +1 | **MATCH** |

The whole 2×2 was measured, not reasoned. That matters because it is the
empirical case for one atomic commit, and because **three of the four cells emit
bytes V8 still ACCEPTS** — V8 is no guard for this class, only a byte comparison
against a second encoder is.

**The probe had to be built to discriminate, and the first one was not.** A
catch target written as a NAME cannot see this bug in either direction: the
bridge resolves a name to a name, insensitive to what is on the label stack.
Only a NUMERIC depth separates the hypotheses. The first probe used `$outer`,
reported a clean MATCH in a configuration that was actually broken, and would
have licensed the merge. Same shape as T13.22's original misdiagnosis, which is
the second time this exact trap has been walked into on this exact item.

#### Blocker 1 — the dependency-age gate

1.5.0 published at `2026-08-25T22:17:43Z`. Deno refuses a JSR version younger
than 24 hours by default (`minimumDependencyAge`), and **CI hits the same wall**.
Landing on the day would mean lowering that policy project-wide — a supply-chain
decision, not a workaround, and not worth it for 24 hours. "1.5.0 is live" and
"1.5.0 is adoptable" are a day apart.

#### Blocker 2 — the real one, and it was invisible to the compatibility check

binaryen-ts checked their side and reported that every name our bridge imports
from `/ir` still resolves at v1.5.0. **Verified here independently: 0 missing**,
72 imported against 205 exported.

And with all 72 resolving, **12 of 28 bridge tests fail**. All 28 pass on 1.0.9.
One root cause:

    WasmEncodeError: unresolved GC function type: (structref) -> (i32)

Their `gcFuncTypeIndex` now demands an exactly-matching declared `func` heap type
for any GC-typed signature — the UP-7 typed-ref work landing. Our
`coarsenValueType` maps `(ref $T)` → `structref` at the boundary, a deliberate
accommodation to their older flat `ValType` surface, so **no key can ever
match**, for any GC module.

They had flagged the area — *"their `coarsenValueType` may be doing unnecessary
work"* — but it is not now-redundant work, it is a hard encode failure. Removing
the bridge's last lossy step is the actual cost of this upgrade, and it is a
larger change than the catch-scope fix it was meant to accompany.

**Asked back before starting it**, because a compatibility path on their side is
a decision they can make once and every GC-using consumer of `ModuleBuilder` will
otherwise hit this the same way.

#### A false alarm, checked rather than assumed

Importing their source as local `file:///` modules (to test against the exact
v1.5.0 tag without waiting out the age gate) produced 13 type errors under our
`exactOptionalPropertyTypes`. **The same method against 1.0.9 produces 30**, so
the errors are an artifact of the method and say nothing about 1.5.0. A control
run was the whole cost of not filing that as a finding.

#### Not the blocker, recorded so it is not re-derived

`/encoder` appears in `src/` exactly once, in a doc comment
(`binaryen-bridge.ts:12`), and is never imported there — binaryen-ts are right
that it is free to change as far as the BRIDGE is concerned. But **11 test files
import it**, so the mapping is not free to drop.

### T13.46 — DONE. The corpus refresh the stamp made possible (2026-08-25).

T13.45 stamped the snapshot, which made it honest, not current. This made it
current, and it is the answer to a question the wasmtk team had raised three
times in different forms.

Regenerated all 417 `tests/wasi/wasm_wasi/*.ts` from wasmtk `4600ba9`, **verified
level with `origin/main` first** — refreshing from a stale checkout would have
manufactured a new stale snapshot, which is the failure being fixed. 413
compiled; 4 are wasic compile failures and are simply absent
(`18zl_VarGateBlockEscape`, `18zm_VarGateLoopClosure`,
`33_IntersectionBasePrefixGuard`, `34_InlinePredicateUnresolvable`).

| | before | after |
| --- | --- | --- |
| files | 272 (frozen 2026-05-25) | **421** |
| encode | 272 / 272 | **421 / 421** |
| validate | **265 / 272** | **421 / 421** |
| round-trip | 272 / 272 | **421 / 421** |
| `KNOWN_INVALID` | 7 | **empty** |

**8 files had no wasic source** and had to survive: `18_symbol_table`,
`1_fib-rs`, `1_fib-rs-opt`, `1_fib-zig-opt`, `1_fizzbuzz_wat`,
`1_helloWorld_wat`, `1_helloworld`, `1_print` — Rust / Zig / hand-written WAT
from other producers. A delete-and-replace would have dropped them silently;
`PROVENANCE.md` now names them so the next refresh cannot.

**`KNOWN_INVALID` emptied itself.** All seven fired their *"now VALIDATES — wasic
appears fixed"* assertion simultaneously. The gate was correct for its entire
life; only its INPUT was stale, which is the one thing it structurally could not
detect. The mechanism stays, with a note that new entries carry a date and a
reason.

**Deliberately NOT reconciled:** wasmtk count their live corpus at 373; we
generate 413 from the same checkout. Which sources constitute "the corpus" is a
fact about wasmtk, and inferring it from file counts on our side is precisely the
move that produced three wrong reports. Recorded as an open question in
`PROVENANCE.md` rather than guessed.


### T13.45 — DONE. The snapshot's provenance was recoverable all along, and "unknown" had never been checked (2026-08-25).

Raised by the wasmtk team, who had **asked twice** for a source + date stamp on
`tests/wasmtk/` and pointed out that the snapshot has now caused **three** wrong
reports to them, not the one we had recorded.

#### The three

| report | what we said | what is true |
| --- | --- | --- |
| `KNOWN_INVALID` seven | "genuinely invalid wasm — V8, Wasmtime and Wasmer all reject them", present tense | all seven fixed in current wasic |
| legacy-EH scope | **6** modules affected | **10** — our snapshot is missing four |
| `needsExceptionTag` | five modules declare `$__exn_tag` and never use it | retracted; does not hold against current wasic |

All three were the same mistake — reading a fixture set as evidence — and **all
three were caught by the recipient rather than by us.**

#### The stamp took one command

`PROVENANCE.md` said *"Snapshot date: unknown — accreted file-by-file rather than
taken at once"* and *"Source commit: unknown"*. Both were false, and neither
needed anything the wasmtk team had:

    git log --diff-filter=A -- 'tests/wasmtk/*.wat'

returns **exactly one commit** — `fbafca9e`, 2026-05-25 21:50:17 -0400, which
added 278 `.wat` in one go; a same-day follow-up removed the 6 `$mathlib_*`
pre-link files, leaving 272. Nothing has touched them since. So the corpus is a
single point-in-time capture, not an accretion.

In the wasmtk repository the last commit before that timestamp is **`e147d28`**
(11:25 the same day, "phase 22 stress test bug fixes") and the next is **three
days later**, so the window holds exactly one candidate.

The bound is on the CAPTURE, not the compiler: the files came from a wasmtk
working tree at or just after `e147d28` and could include uncommitted local
work. But a bound of one commit is not "unknown".

**The claim sat in the file for three months, was repeated to the wasmtk team,
and cost them two requests.** Nobody had run the command, because "we don't
know" reads like a finding rather than an assumption.

#### Gated

`tests/wasmtk/provenance.test.ts` — the stamp is now non-optional: a source
commit matching a git hash, a real date, the "FROZEN SNAPSHOT" warning and the
re-derive rule still present, and the incident count still recorded so the rule
keeps its weight.

The load-bearing assertion is the **file count**: the declared "Files here" must
equal the `.wat` on disk. A refresh that moves files without re-stamping is
exactly the failure mode, and the one most likely to be committed in a hurry.
Verified by injecting all three faults — reverting the stamp to "unknown",
changing the declared count, and dropping the warning — each fails.

#### Not ours

The 373-file live corpus is wasmtk's, and the number checks out against what we
cite. There is nothing for them to fix: **the stale copy is in our repository**,
which is why the stamp is our obligation and not theirs.

### T13.44 — DONE. Gating the WIRING of the release preflight, not just its logic (2026-08-25).

T13.43 added the dirty-tree guard and `tests/scripts/release_guard.test.ts` to
cover it. That test proves `releaseBlockers` returns the right answer. **It does
not prove `publish.ts` asks the question** — delete the entire guard block and
all twelve cases still pass, because the pure function is untouched.

That is the same gap that produced T13.43 in the first place: the logic was
obvious, two documents described it, and the script simply did not do it. A
regression test for a guard has to gate the CALL SITE, or it protects the part
that was never the problem.

#### What is gated

`tests/scripts/publish_preflight_wiring.test.ts` reads the source and asserts
five structural properties:

1. **the guard is imported and called** — `release-guard.ts` and
   `releaseBlockers(`;
2. **nothing that mutates git state runs before it.** Every `['git', '<sub>']`
   invocation is extracted in source order and classified against a READ_ONLY
   allowlist (`status`, `ls-remote`, `rev-parse`, `diff`, `config`, `log`);
   anything else appearing before the guard fails. A new subcommand is opted in
   deliberately — unknown means mutating;
3. **it refuses rather than warns** — a `Deno.exit(1)` must follow the call, or
   the script prints a complaint and releases anyway, which is worse than no
   guard because the output looks checked;
4. **`release-guard.ts` stays side-effect free** — no `Deno.Command`, no
   `Deno.exit`, no top-level `await`. This is the property whose ABSENCE made
   `publish.ts` untestable; if the guard module acquires a side effect,
   importing it from a test starts doing something and the logic migrates back
   inline;
5. **`scripts/` stays inside the gate** — parses `deno.json` and checks the
   `check` task, `lint.include` and `fmt.include` all still mention it.

Plus a documentation coupling: `cmem/publishing.md` must name
`release-guard.ts`, so a rewrite of the release docs has to look at the module
whose absence the old prose papered over.

**It also asserts the mutations still exist after the guard** (`add`, `commit`,
`tag`, `push`). Without that the whole file passes vacuously on a script that no
longer releases anything — the T13.41 lesson, applied to the gate itself.

#### Verified by breaking it four ways

A gate nobody has seen fail is indistinguishable from a gate that cannot fail
(T13.42). Each was injected, measured, and reverted from a byte-level copy:

| injected fault | result |
| --- | --- |
| guard block deleted entirely | **FAILS** at step 4 of 7 |
| `git add` hoisted above the guard | **FAILS** at step 5 |
| `scripts/` removed from `deno.json` | **FAILS** at step 6 |
| `Deno.Command` added to `release-guard.ts` | **FAILS** at step 6 |
| (restored) | 1 passed, 7 steps |

#### Why a source-text gate is the right tool here

It is blunt, and the alternative is executing a release. `publish.ts` stages,
tags and pushes at import time, so there is no way to exercise the real script
in-process; the behavioural half would need `--allow-run` and `--allow-write`,
which `deno task test` does not grant. Reading the source is the only check that
runs on every commit, and the project already uses that shape for exactly this
reason — `token_type_reachability.test.ts`,
`const_expr_head_coupling.test.ts`, `source_hygiene.test.ts`.

The limitation is worth stating: it gates STRUCTURE, not behaviour. It cannot
tell whether `releaseBlockers` is called with the right argument, only that it
is called before anything is mutated. The behaviour is covered by
`release_guard.test.ts`; the two are complements and neither is sufficient
alone.

### T13.43 — DONE. `deno task publish` would have released a version containing none of the work, and two documents said it refused to (2026-08-25).

Eighth hardening pass, aimed at the surface T13.42 exposed: **the gates and
commands are themselves code, and two of them had already turned out to be
broken** (the format check, the ledger-count grep). The release path is the
highest-consequence member of that surface and had no test at all.

#### The documented contract

`CLAUDE.md:1231` and `cmem/publishing.md:221`, in the same words:

> `deno task publish` runs `scripts/publish.ts`: **refuses if the working tree is
> dirty or the tag already exists**, then creates and pushes the matching
> `v<version>` tag.

#### What the script actually did

    git add deno.json          # stages ONE file
    git commit -m "bump to vX" # if anything is staged
    git tag -f vX              # FORCE, overwriting any existing tag
    git push origin main vX

**No dirty-tree check existed anywhere in the file.** And `cmem/publishing.md`
contradicted itself — line 130 describes the real behaviour ("commits
`deno.json` if it is still dirty, tags, and pushes both") while line 221
promises a refusal that was never implemented.

#### Why that is severe rather than untidy

The tag is exactly what JSR publishes. The script stages `deno.json` and
nothing else. So on a dirty tree the sequence is: commit a bare version bump →
tag it → push → `publish.yml` runs `deno publish` against that tag → **a
release containing none of the work**. JSR versions are immutable; the only
remedy is to burn the next version number.

This was live, not theoretical. At the moment of the finding the tree held
**56 dirty paths carrying 15 unreleased user-visible fixes**, and `git diff
--stat -- deno.json` confirmed the commit would have captured 2 changed lines
in 1 file. `deno task bump && deno task publish` was the documented flow, and
it would have shipped v1.4.1 as a no-op.

#### The fix

Two guards, ahead of anything that mutates state:

- **dirty tree** — refuse unless the only dirty path is `deno.json`, listing up
  to ten of the paths that would be left out. Untracked files count: a new
  source file that was never committed is absent from the tag, so the release
  is missing it *while every local check passes*, because the file is on disk.
- **remote tag exists** — refuse. A LOCAL tag is re-creatable and step 3 still
  force-writes it deliberately (retry safety, which was the original comment's
  point). A remote tag has already triggered `publish.yml`, so that version is
  either live on JSR or failed for a reason a re-push will not change.

Verified against the live dirty tree: refuses, exits **1**, and stages
**nothing**.

#### Why it had no test, and what changed

`publish.ts` stages, tags and pushes **at import time** — it is top-level script
code — so nothing could import it to check its logic without performing a
release. That is the reason a four-release-old script had zero coverage, and it
is structural, not an oversight.

The pure part now lives in `scripts/release-guard.ts` (`releaseBlockers`,
`statusPath`), which `publish.ts` imports and
`tests/scripts/release_guard.test.ts` tests: clean tree, deno.json-only,
modified / staged / deleted / untracked blockers, rename paths, CRLF, and
precision cases (`deno.json.bak` and `scripts/deno.json` must still block — the
exclusion is an exact path match, not a substring).

**The most important case there is the one that must NOT block.** A guard that
always refuses fails safe exactly once and is then deleted by whoever needs to
ship.

#### The gate gap underneath it (same pass)

`scripts/` was covered by **nothing**: `deno task check` listed only
`src/**` and `tests/**`, and `deno.json`'s `lint.include` and `fmt.include` were
`["src/", "tests/"]`. Six files including the release driver, type-checked by no
gate, linted by no gate, on a repo where CI runs all three.

Both came back clean when run by hand, so this is a **coverage gap, not a
defect** — but nothing was keeping it that way, and the file it left unguarded
is the one that cuts releases. `scripts/` is now in all three; the file count
went 164 → 172. Markdown under `scripts/` is excluded from `fmt`, because the
first run reformatted 88 lines of a report already sent to the wasmtk team.

### T13.42 — DONE. The documented format check used the wrong line width, so two CI-failing files sat undetected behind the CRLF false alarm (2026-08-25).

Found while format-checking the T13.41 edits. `src/tools/wasm-strip.ts` reported
drift on an import line **I had not touched** — added earlier in the session by
T13.29.

#### Two checks, each wrong in a different way

`deno fmt --check src tests` reports ~104 of 164 files failing with *"Text
differed by line endings"* on this checkout — git's `autocrlf`, not drift. That
is already recorded, and the recorded workaround was a per-file diff with line
endings normalised:

    diff <(tr -d '\r' < FILE) <(deno fmt --ext ts - < FILE | tr -d '\r')

**That command does not read `deno.json`.** Reading from stdin with `--ext ts`
takes deno's DEFAULTS — `lineWidth` 80, double quotes — while the project sets
`lineWidth: 100, singleQuote: true`. So it reports every line between 81 and 100
characters as drift, which is noise, and the noise is why its output stops being
read.

The obvious alternative, `deno fmt --check FILE`, does read `deno.json` and gets
the width right — but reintroduces the line-ending false alarm, which is the
thing the diff form existed to avoid.

**Neither could see a real defect.** The import was **101 characters** against a
limit of 100.

#### The corrected check

Normalise line endings AND pass the project's options explicitly:

    diff <(tr -d '\r' < FILE) \
         <(deno fmt --ext ts --line-width 100 --indent-width 2 --single-quote - < FILE | tr -d '\r')

Validated both directions, which is the part that matters:

- over every source file changed this session it clears **11 of 12** false
  alarms the naive `deno fmt --check FILE` reports;
- re-breaking `wasm-strip.ts` on purpose, it still reports the drift — a check
  that only ever says "clean" is worthless;
- and it found **a second real one** the old procedure had also missed:
  `src/api/wabt-compat.ts`, a template literal from T13.30 that `deno fmt` wants
  split across three lines.

Both are fixed. `deno fmt --check` now passes on both files, and the corrected
sweep is clean across every changed file.

#### Why this is the interesting part

**A standing false alarm is not free.** The CRLF noise had been recorded,
explained, and worked around — and the workaround was wrong, so the noise went
on hiding real failures for the whole session. Two files would have failed CI on
push, on a branch where every other gate was green and being re-run after every
edit.

The rule this earns: **when you write a command to see past a known false alarm,
verify it still fires on a real fault.** Injecting one is usually a one-line
edit and a few seconds, and it is the only step that distinguishes "clean" from
"blind". The same discipline is already recorded for guard TESTS (invert it
before trusting it) and for harnesses (give it an input it must fail on) — a
diagnostic COMMAND written into the docs deserves it too, and this is the second
time in two days a documented command turned out not to work (the other was the
ledger count command in `publishing.md`).

### T13.41 — DONE. `wasm-strip` removed the sections you named and silently MOVED the ones you kept (2026-08-25).

Seventh hardening pass, following the structural class T13.40 exposed: **a
defect shared between our reader and our writer is invisible to every metric**,
because the corpus inputs are our own output. Section-size padding was one
instance; this pass looked for others.

#### Three encoder-waste axes — CLEAN

Direct follow-ons from T13.40, all with oracles needing no external truth, over
the 272-module wasmtk corpus:

- **empty sections emitted** (a section whose count is 0 says nothing): none;
- **duplicate type-section entries** (`synthesizeTypes` appending a signature
  the type section already has): 0 modules, 0 redundant entries;
- **`datacount` emitted with no data segments**: none.

#### `wasm-strip` — the identity half was clean, and it was the wrong half

`wasm-strip` round-trips a module through `readBinaryIr` → `writeBinaryIr`, so
any infidelity there rewrites a module the tool promised only to strip. Over the
corpus: strip **failed 0**, was **idempotent 272 / 272**, never grew a module,
and — the exact oracle — was the **identity on all 272** modules that have no
custom section to remove.

That looked like a clean sweep and was a coverage illusion: `wat2wasm` emits no
custom sections, so **every input had nothing to strip**. The tool's actual job
was untested. Injecting custom sections and asserting `strip(module + custom)
== module` gave 265 / 265 for a custom at the front, at the back, and both. But
the `sections` option — remove only the named ones — scored **0 / 265**.

#### The defect

Custom sections may legally appear anywhere between the known sections.
`writeCustomSections()` emitted them **all in one block at the end**, and
`Custom` carried no position at all. So:

    in   custom"other" type func memory global export code data
    out  type func memory global export code data custom"other"

A tool asked to remove `bloat` removed `bloat` **and relocated everything
else**. Legal bytes, valid module, and wrong for at least one real section: the
dynamic-linking convention requires **`dylink.0` to be FIRST**, so stripping a
debug section out of a dynamically-linked module produced something a linker
will not load.

**My first probe of this scored 0 / 265 for the wrong reason** — I had assumed
`sections` meant *keep these*. The doc comment is explicit ("Names of custom
sections to strip"), and re-reading it before filing was what stopped a false
finding. The corrected oracle still scored 0 / 265, which is when it became
real.

#### The fix

`Custom.precedingSection?: BinarySection | null` records the known section a
custom followed — `null` for "before any of them", `undefined` for "position not
known". The reader stamps it; `write()` walks an explicit `ORDER` table and
emits each anchor's customs after its section, with unanchored ones appended
last exactly as before, so **hand-built IR is unaffected**.

`--sections` went **0 / 265 → 265 / 265**. Every conformance metric unchanged.

#### A misnamed local, fixed while in there

The filter read `const keep = new Set(opts.sections)` and then
`filter((c) => !keep.has(c.name))`. The name says keep, the use says remove, and
a reader trusting the name would invert the condition and turn strip into its
opposite. Renamed, with an INTENT block naming both the direction and the new
position guarantee.

#### A ninth metric, because the eight could not see this

`binary → IR → binary`, with no text in between — which is exactly what
`wasm-strip` does, and what nothing had ever measured. The text round trip is
blind to it: WAT cannot express an arbitrary custom section, so they are dropped
before the writer is reached.

Over the 88 V8-valid crafted binaries: **30 / 88 byte-identical** (was 27),
0 decode failures, 0 writer throws, and all 58 differences settle at a fixed
point on the second pass. The remainder is the same inherent set as the text
round trip — non-minimal LEBs the tests wrote deliberately, explicit-vs-
abbreviated elem flags — plus one benign case: `custom.wast` interleaves customs
between ten EMPTY known sections, and we do not emit empty sections, so 390
bytes come back as 360 with all 22 customs in their original relative order.

Regression: `tests/writer/custom_section_position.test.ts` — a custom at each of
four positions surviving a binary round trip, relative order preserved among
several at one anchor, the `dylink.0`-shaped strip case, default strip still
removing everything and returning the original bytes exactly, a guard-the-guard
check that the base module has enough sections for "position N" to mean
anything, and an over-correction guard that hand-built IR still appends at the
end. Verified sensitive: restoring append-at-the-end fails 6 steps.

### T13.40 — DONE. Every section header we emitted was 4 bytes too long, and the round-trip metric was reporting two populations as one (2026-08-25).

Raised by the owner, looking at the round-trip figure from T13.39. I had reported
**2124 / 2207** and explained the 83 differences as *"almost all deliberately
non-minimal LEB encodings in `binary-leb128.wast` that cannot round-trip
byte-identically by construction"* — asserted without checking, and the file
tally did not support it: `elem.wast:19` and `simd_const.wast:6` are ordinary
modules, not crafted byte blobs.

#### The classification that settled it

The decisive split is **where the input binary came from**, because for a
`(module …)` text block the input is OUR OWN encoder's output — so a difference
there is our bug, while for a `(module binary …)` block the input is bytes the
testsuite crafted and we have no obligation to reproduce them:

| input source | differing |
| --- | --- |
| module **TEXT** — our own encoder's output | **0 / 2119** |
| module **BINARY** — bytes crafted by the test | 83 / 88 |

**Round-trip fidelity was already 100%**, and 2119 / 2119 is exactly the figure
the campaign recorded. T10 is genuinely closed. Summing the two populations into
"2124 / 2207" invented a regression that was not there and hid a real defect that
was.

#### The real defect: we padded every section size

Reading the `elem.wast` differences by hand — four of them, per the standing rule
— the input was **minimally** encoded and OUR OUTPUT was not:

    in   01 04 01 60 00 00              type section, size 4
    out  01 84 80 80 80 00 01 60 00 00  type section, size 4 written in FIVE bytes

`reserveU32Leb` reserves the maximum width (5) for a size not known until the
body has been written, and `patchU32Leb` wrote a **fixed-width** 5-byte LEB and
left the padding. Legal — 5 is the maximum for a u32, so every engine accepts it
— but it made every section header 4 bytes larger than necessary, in every
binary the writer has ever produced.

**Upstream wabt canonicalises by default.** `canonicalize_lebs = true` in
`binary-writer.h`, and `WriteFixupU32Leb128Size` computes the real length and
`MoveData`s the body to close the gap. wabt-ts never ported that half.

The fix is the same idea, reserving the maximum up front instead of guessing:
`patchU32Leb` now encodes minimally and `copyWithin`s the measured body down
over the unused bytes. The reserve/patch pair is strictly LIFO — a function body
patches before the code section containing it, and an enclosing `sizePos` sits at
a lower offset than any shift — so nesting is safe. That invariant is now written
at `reserveU32Leb`, because it is what makes the shift legal.

**Cost on the corpus that matters** — the 272-file wasmtk WASI corpus:
**628,201 → 607,845 bytes, 20,356 saved (3.2%)**, every module still validating.

#### Byte-identity against a non-canonical input can mean you SHARE its defect

`float_literals.wast` moved from matching to differing, which looks like a
regression and is the opposite. Its input is itself padded
(`01 85 80 80 80 00`) — so our padded output matched it **by coincidence, two
wrongs cancelling**. Now we emit minimal and correctly differ.
`binary_leb128_64.wast` moved the other way, from differing to matching, for the
same reason.

That is worth carrying: a round-trip metric compares against whatever the input
happened to be, so a match is evidence of fidelity **only when the input is
canonical**. Against a non-canonical input, a match may be telling you that you
reproduce its non-canonicality.

#### What is left, and why it is not a backlog

Binary-sourced differences went **83 → 61**; the metric's own reading of that
population went 5 / 88 → **27 / 88**. The remainder are inherent to the text
format being lossy about encoding choices that carry no semantics — verified by
hand, not assumed this time:

- non-minimal LEBs the test wrote deliberately (`82 00` for 2) — the text form
  does not record the padding, so nothing downstream could restore it;
- an element segment written with explicit flags `02` + table index 0 where the
  abbreviated `00` form means the same thing.

Both re-encode to a **fixed point at pass 2** — all 61 do — so there is no
unbounded growth of the T10.5 kind.

#### Metric reporting

`rt.ts` now prints the two populations separately and labels the first
**ROUND-TRIP FIDELITY**. Reporting them as one number is what made a 100% result
look like 96% and buried a 3.2% size defect underneath it.

Regression: `tests/writer/minimal_section_size.test.ts` — every section header
minimal across bodies chosen to straddle the 1→2 and 2→3 byte LEB boundaries
(128 and 16384, since the shift distance varies with the real size), the shifted
body still validating AND still computing the right answer under V8, a
guard-the-guard check that the 2- and 3-byte cases genuinely occur, and
self-round-trip byte-identity. Verified sensitive: restoring the fixed-width
write fails 7 steps.

### T13.39 — DONE. The session's conformance harnesses omitted a required pipeline stage, and every number quoted from them this session was wrong (2026-08-25).

Found while building the T13.38 probe: a validator-diagnostics run reported
**2073 modules rejected with the identical message** `function type variable out
of range: 0 (max 0)`. That is not a plausible product defect, and reading three
by hand — the rule from T13.35 — showed it was the probe.

`wat2wasm` is **parse → resolveNames → synthesizeTypes → writeBinaryIr**. The
scratch harnesses encoded a parsed `assert_invalid` / `module` node with
`resolveNames` then `writeBinaryIr`, **skipping `synthesizeTypes`** — the pass
that back-fills the type section for inline-declared signatures. Without it
almost every module emits dangling type indices, so:

- **the validator rejected nearly everything for a fault the harness created**,
  not for the spec violation under test;
- valid modules failed to encode and were `catch { continue; }`-ed out of the
  denominator entirely — the "print what a harness SKIPS" rule, violated by a
  harness written after that rule was recorded.

Correcting it moved every figure, in the same direction:

| metric | as quoted this session | corrected |
| --- | --- | --- |
| validator agreement | 449 / 449 | **2207 / 2207** |
| `assert_invalid` rejected | 2673 / 2678 | **2694 / 2694** |
| round-trip byte-identical | 364 / 449 | **2124 / 2207** — but see T13.40: that sums two populations that must not be summed. Fidelity is **2119 / 2119** |
| encode throws | 13 | **0** |
| `assert_invalid` false accepts | 5 | **0** |

The denominator was **five times too small**. The five "false accepts" and the
thirteen "throws" were both artifacts. `corpus.ts` was unaffected — it calls
`wat2wasm` itself rather than reassembling the pipeline, which is exactly why it
was right.

**What this does and does not invalidate.** Every "conformance unchanged" check
this session used the SAME instrument before and after each change, so the
*conclusions* stand — a consistent instrument still detects change, which is all
those checks were asked to do. What does not stand is the absolute numbers, and
several were written into `cmem/` (the T13.37 entry among them). Corrected in
place.

**The lesson is narrower than "check your harness".** The defect was invisible
because the output looked RIGHT: 2673 of 2678 rejected is a plausible,
publishable-looking figure, and `assert_invalid` is a metric where rejecting
things scores well — so a harness that broke every module scored *better*, not
worse. A metric that counts rejections cannot distinguish a validator doing its
job from a harness handing it rubble. **Reassembling a pipeline inside a harness
is the bug; call the real entry point.**

### T13.38 — DONE. The most common mistake in hand-written WAT was reported by blaming a parenthesis (2026-08-25).

Sixth hardening pass, and the direct extension of T13.37: that pass graded the
BINARY reader's diagnostics against the spec's expected error texts. Two more
populations carry the same answer key and had never been read — `assert_invalid`
(2683 cases, the **validator**) and quoted `assert_malformed` (1229 cases, the
**parser**).

The validator came back healthy: **2446 / 2683 exact (91%)**, 0 false accepts.

The parser did not: **559 / 1229 (45%)**, with 634 wholly disjoint. One shape
dominated — the spec says `unknown operator`, we said something about a bracket:

    (i32.load32 (local.get 0))     ->  "unexpected ( in function body"
    local.get 0 i32.load32         ->  "unexpected Reserved in function body"
    (block (i32.frobnicate))       ->  "expected ), got ("
    (module (frobnicate 1))        ->  "expected ), got ("

A misspelled instruction is the most common error in hand-written WAT. The first
message blames a parenthesis; the second **leaks an internal token-class name**
to the author; the third and fourth mention neither the instruction nor that one
was involved. None names `i32.load32`.

**The fix is one helper, because the lexer already knew.** `TokenType.Reserved`
is emitted for a word the lexer does not recognise and for **no other reason** —
so a Reserved token is by definition not a valid anything, and naming it is
correct wherever it appears. `unknownOperatorText()` returns its source text
(looking one token past a `(`, since the folded form puts the operator there),
and `reportUnexpected(fallback)` prefers it over the positional message. Wired
into three sites: `noProgress`, the leftover-input check after a function body,
and `expect()`.

Result: all four shapes now read `unknown operator "i32.load32"`, and the
population went **559 → 816 / 1229**.

**The gate had been recording the symptom for a whole tranche.** T13.32's
token-reachability test lists tokens the lexer emits and the parser never
consumes, as a "known and fine" allowlist — and `Reserved` was on it. The parser
never looking at unrecognised words IS this defect, sitting in a passing test,
described as benign. That test now fails if `Reserved` returns to the list, and
carries a note: **ask what the lexer emits a token FOR before excusing it.**

**A test can pin the weaker of two behaviours by being satisfied with it.**
`malformed_input.test.ts` had a case literally named *"names the offending token
and where it is"* whose assertion was `/in function body/` — which the old
message satisfied while naming a paren. Strengthened to assert the operator text.

**Where the remaining 367 are, and why chasing them would make things worse.**
Roughly 200 are `(i32.const 0x)` — a malformed hex literal, which the spec's
reference implementation also calls `unknown operator` because its lexer
reserves the token. We say `expected i32 constant`, which is strictly more
useful. **This metric measures AGREEMENT, not quality**, and the last stretch of
it is bought by making messages worse. Recorded as a ceiling, not a backlog.

Regression: `tests/parser/unknown_operator.test.ts` — 5 shapes × (spec wording,
names the operator, leaks no token-class name, keeps a source position), plus
two over-correction guards (an ordinary unexpected-token error keeps its own
message; every real instruction the typos resemble still compiles) and a guard
that the rejection itself survives — the leftover check exists because an
unknown instruction once parsed to an EMPTY body with `wat2wasm` reporting
success. Verified sensitive: neutering the helper fails 17 steps.

### T13.37 — DONE. The spec testsuite has carried a diagnostic-quality oracle since day one and we had never read it (2026-08-25).

Fifth hardening pass. T13.35 left **diagnostic accuracy** recorded as UNMEASURED
rather than clean, because the cheap oracle it used — "the reported offset must
not precede the corrupted byte" — turned out to be false for every multi-byte
construct in the format. That record is what sent this pass looking for a real
one, and there was one already in the repo.

#### The oracle

Every `assert_malformed` command in the spec testsuite carries **the error text
the module is supposed to produce**:

    (assert_malformed (module binary "\00asm" "\01\00\00\00" ...)
                      "integer representation too long")

Our `assert_malformed` metric reads the modules and ignores the strings. It
scores **711 / 711 binary cases rejected** — and has since the campaign closed.

**Rejecting for the wrong reason is indistinguishable from rejecting for the
right one when you only count rejections.** The expected text is the only thing
in either corpus that can tell them apart, and it is free: no engine, no
subprocess, no external truth. First measurement across all 711:

| | |
| --- | --- |
| not rejected at all | 0 |
| our message CONTAINS the spec's | 608 |
| shares at least one word | 33 |
| completely DISJOINT wording | **70** |

70 modules we reject while describing something the spec does not recognise.

#### Finding 1 — a genuinely wrong diagnosis, not a vocabulary gap

The disjoint set grouped almost entirely into pairs that were mere wording — but
one group was not. Several 4-byte inputs expecting `magic header not detected`
got **`unexpected end of binary`**. The 8-byte cases reported the magic
correctly, so it was length-dependent, which is the tell for an ordering bug:

`readModule` read the magic, then read the VERSION, and only then compared the
magic. On a 4-byte input the version read hit the end of the buffer and errored
first — so a file whose magic is wrong was reported as a file that was too
short. Two different faults, and we named the one the user had not made.

Fixed by comparing each field before reading the next, and aligning the version
message to the spec's `unknown binary version`.

#### Finding 2 — two faults sharing one name

The spec names two distinct LEB failures:

    "integer too large"                the terminating byte carries value bits
                                       beyond the target width
    "integer representation too long"  the encoding runs past the maximum byte
                                       count for that width

The decoders **already tell these apart** — they are two separate branches, one
checking the final byte's value bits and one checking the byte count — and then
threw `LEB128 u32 overflow` from both, discarding at the point of reporting a
distinction the code had in hand. Same for u64, s32, s64: eight sites, four
pairs. Each now carries the spec's name for its own fault.

`LEB128 sequence is truncated` became `unexpected end of section or function`,
which contains the spec's shorter `unexpected end` as a substring so it matches
both spellings. That trades a hint about WHICH decoder failed for the vocabulary
a wasm developer expects; the error's byte offset still points at the LEB, so
the hint was redundant.

#### Result

| | before | after |
| --- | --- | --- |
| message contains the spec's | 608 | **689 / 711 (97%)** |
| completely disjoint | 70 | **5** |

The five that remain are cases where a different fault is legitimately noticed
first — a truncation before the byte that would have carried a malformed limits
flag, a bad type marker reached before the over-long integer containing it. Each
is a defensible ordering, not a wrong answer, and forcing them to match would
mean deferring an error we have already found.

**Every conformance metric is unchanged**: corpus 272 / 272 encode and 265 / 272
validate; agreement, `assert_invalid` and round-trip all byte-identical to the
pre-change baseline.

> **CORRECTED (T13.39).** This paragraph originally quoted those three as
> `449 / 449`, `2673 / 2678` and `364`. Those came from a harness that omitted
> `synthesizeTypes`; the real figures are **2207 / 2207**, **2694 / 2694** and
> **2124 / 2207**. The claim of NO CHANGE still holds — the same instrument ran
> either side of the edit — but the absolute numbers were wrong.
That is not a null result, it is the *point* — this pass changed what we SAY
about inputs we already handled correctly, and the metrics confirm it changed
nothing about which inputs those are.

#### Gate

`tests/core/leb128_diagnostics.test.ts` — 4 decoders x (out-of-range value,
over-long encoding, the two not confused with each other, the widest legal
encoding still decoding, truncation). The regression it exists for is
**collapse**: an edit that merges the two branches or gives them a shared
message still rejects every input and moves no metric, so only the wording can
catch it. Verified sensitive — collapsing the two strings fails 12 steps.

The offset half of the axis stays UNMEASURED. This oracle checks the WORDS.

**T13.8 — `instrInputCount` disagreed with `buildPlainExpr` for three atomic
families, and `wasm2wat` was emitting INVALID WASM.**

    AtomicStore        listed 3, reads op0/op1        -> 2
    AtomicRmw          listed 3, reads op0/op1        -> 2
    AtomicRmwCmpxchg   listed 4, reads op0/op1/op2    -> 3

`design-decisions.md` has carried this invariant since Bug D, with the failure
mode written down — "too high pulls bogus nops". It is worse than that. The
linear parser pops `nInputs` off the stack, so one too many took a PLACEHOLDER
into the address slot and left a real operand unconsumed — and a placeholder
emits nothing (T10.8), so **the operand was simply gone**. `wasm2wat` emits
linear form, so:

    (i32.atomic.store (i32.const 0) (i32.const 5))
    (drop (i32.atomic.rmw.add (i32.const 0) (i32.const 37)))
    (i32.atomic.load (i32.const 0))        -- computes 42

round-tripped through `wasm2wat` → `wat2wasm` and came back **rejected by V8**.
Proven both ways: with the fix the round trip still computes 42; without it,
V8 refuses the disassembly.

**Not one of the seven metrics moved, before or after.** parse-clean stops at
the parser; the spec testsuite's atomic modules never reach the round-trip
metric; everything else starts from bytes. Two documented invariants pointed
straight at it — "audit `opN()` calls when adding an opcode" and the arity note
itself — and neither had ever been checked mechanically.

**The method is the durable part**, and it generalises past atomics: write the
instruction FOLDED, where operands are inline children and the arity table is
not consulted for them; disassemble to LINEAR, where the table is what pops
them; re-encode; compare bytes. A folded/linear differential tests the two
halves of the parser against each other with no oracle needed. 74 instructions
covered — core, SIMD, atomics, GC, bulk memory/table, control flow, EH,
relaxed-SIMD, wide arithmetic — 8 failed, all three atomic families, and 74/74
pass now.

### wasmtk's reply, 2026-08-24 — one ask confirmed with a blocker ON US, one RETRACTED

Both asks were checked against current wasic rather than accepted. Both results
re-verified here.

**Ask 1 confirmed, and the blocker turned out to be ours.** The report said
"wabt-ts supports `try_table` end to end; nothing needed on our side". That is
true of `main` and **false of v1.3.5**, which is what their `deno.lock` pins.
Re-derived against the v1.3.5 tag in a clean worktree: `(catch $tag $lbl)`,
`(catch_ref …)`, `(catch_all $lbl)`, `(catch_all_ref …)` and multi-catch all
**throw** `unresolved name-var`; only bare `try_table`, numeric `(catch 0 0)`
and legacy `try` encode. **At the pinned version wabt-ts can emit only the form
Wasmtime refuses.**

Bisected: fixed by **`d30b8599`, "Fix packed-type wire bytes, br_table and
try_table name resolution", 2026-08-21** — its parent `7f84d430`, 17 minutes
earlier, throws on every named catch form. `resolveNames` was not resolving a
`try_table` catch clause's tag or target, so the writer's fail-loud `writeVar`
fired. Verified end to end on `main`: catch / catch_all / multi-catch modules
are accepted by **Wasmtime, V8 and Wasmer, 3/3, zero disagreements**.

**It is unreleased**, so *their EH migration is blocked solely on a wabt-ts
version bump*. That is the concrete cost of leaving `deno.json` at 1.3.5 while
`main` moved: a downstream team with the work written and unable to land it.

**Ask 2 RETRACTED — the frozen snapshot again, and this one was ours.** The
"five modules declare `$__exn_tag` and never use it" finding came from grepping
`tests/wasmtk/*.wat`. Current wasic emits a real `throw` in every one
(`tag_occurrences=2 throws=1`). So `needsExceptionTag` is not firing spuriously,
neither candidate cause applies, and **wazero stays at 251, not 256** — the
modules legitimately need a tag and wazero's CLI rejects any tag section, which
was our own finding applied to a wrong premise.

Corrected expectation after the migration: Wasmtime/Wasmer **265**, V8/Bun
**265**, wazero **251**.

**They confirmed the one thing we got right by checking instead of assuming:**
we nearly proposed dropping `(export "__exn_tag")` and found `utils.ts` reads it
for the uncaught-error path. Their words: "they talked themselves out of
suggesting we drop it, which saved a real regression."

### Does the try_table migration reach parity? Yes — and wazero needs a second, cheaper fix

Asked directly, so measured directly rather than inferred from the arithmetic.
Four minimal modules, every runtime here:

| shape | V8 | Bun | Wasmtime | Wasmer | wazero |
| --- | --- | --- | --- | --- | --- |
| legacy `try`/`catch` — what wasic emits today | accept | accept | **REJECT** | **REJECT** | REJECT |
| `try_table` — the migration target | accept | accept | **accept** | **accept** | REJECT |
| a tag declared and never used | accept | accept | accept | accept | **REJECT** |
| no tag section at all | accept | accept | accept | accept | **accept** |

**Row 2 is the answer: migrating to `try_table` puts Wasmtime and Wasmer at
parity with V8 and Bun, and costs nothing on V8/Bun** — they accept both forms.
On this frozen snapshot that is 259 → 265 / 272, exactly V8's and Bun's number,
with the residual 7 being the stale `KNOWN_INVALID` files that current wasic has
already fixed. (Their scope is **10 modules, not 6** — the snapshot is missing
four — so the denominator differs on their side; the conclusion does not.)

**Rows 3 and 4 are the finding worth having.** wazero's extra 8 fail for the
SAME reason as the 6 — `tag section not supported as feature
"exception-handling" is disabled` — because its CLI refuses any module carrying
a tag section at all. But **five of those eight declare `$__exn_tag` and never
use it**: `15_panic`, `46_BasicEscapeSeqs`, `46_HexUnicodeEscapes`,
`46_Phase46Combined`, `46_TemplateEscapes` each contain the string `$__exn_tag`
exactly ONCE, the declaration itself — no `throw`, no `catch`, no `try_table`,
and no promise machinery either.

So wazero's 21 decompose as: 7 stale-snapshot + 3 that genuinely throw
(`13_SecureMatrixManagerIntegration`, `15_Trap-On-Error`,
`6b_testing-and-benchmarking`) + 6 legacy-EH + **5 that pay for a tag nothing
references**. Row 3 vs row 4 is exactly that experiment: same module, tag
present and tag absent, and wazero flips.

⚠️ **CORRECTION to the first write-up of this, which said "wasic emits the tag
unconditionally". It does not.** `wasic.ts:20010` already gates it —
`this.needsExceptionTag ? '(tag $__exn_tag (export "__exn_tag") (param i32 i32))' : ''`
— and the flag is set at exactly three sites, every one of which ALSO emits WAT:
a `throw` statement (10907), a `try`/`catch` (14720), and `Promise.reject`
(7870). In these five modules none of that WAT is present. **So the condition
is right and it is firing without its output**, which is a much narrower bug
than "unconditional" and points somewhere specific: either the throw/catch lived
in code that was not emitted, or `needsExceptionTag` — a plain instance field
(`private needsExceptionTag = false`, 1600) — is not reset between compilations.
Distinguishing those needs the `.ts` sources, which our WAT-only snapshot does
not have; wasmtk can tell instantly.

**The `(export "__exn_tag")` is NOT dead and must stay.** `utils.ts:317-333`
reads `wasiInstance.exports.__exn_tag` and uses it as
`err.is(tag)` / `err.getArg(tag, 0|1)` to pull the (ptr, len) of the message out
of linear memory, printing `error: Uncaught (in Wasm) Error: <msg>` to stderr.
An exported tag is the only way JS can obtain a module's `WebAssembly.Tag`, so
without it an uncaught wasic error degrades to an opaque trap. And dropping the
export would not buy wazero anything regardless — **wazero rejects the tag
SECTION, not the export** — so the two questions are independent: keep the
export, and fix the flag so the section is absent when nothing uses it.

**What no fix reaches:** the 3 that really throw. wazero's Go embedding API has
feature toggles its CLI does not expose, so a wazero-hosted wasic program that
uses exceptions needs the embedding API regardless of which EH encoding it uses.

### A latent coupling to a WAT spelling we do not produce

wasmtk's Go-leaf 2-page floor is a regex,
`\(memory\s+\(export\s+"memory"\)\s+(\d+)\)`. **Our WAT writer never emits
text that matches it.** We always write the index comment first —
`(memory (;0;) 2)`, or `(memory (;0;) (export "memory") 1)` when the export is
inlined — so `\(memory\s+\(export` cannot match either spelling.

It works today because `watBase` is wasic's OWN generated text
(`wasic.ts:19996` writes the inline form directly), not something that has been
through `readWasm → toText`. But `wasmbundle.ts:197–198` does exactly that round
trip for merged leaf WAT, and the T10.1 work made our inline-export decision
CONDITIONAL — so the spelling is now a property of the module, not a constant.
If that text ever reaches the floor, the floor silently does not apply and the
TinyGo init flag at byte 65536 lands out of bounds. Worth pinning with a test on
their side, or matching both spellings.

### `/compat` re-verified against wasmtk's CURRENT call sites

Replayed from `origin/main`: `parseWat(path, wat, {enable_all:true})`
(`utils.ts`), `{enable_all:true, exceptions:true}` (`wasic.ts`),
**`{exceptions:true}` alone** (`wasmbundle.ts:372`), `readWasm(bytes,
{readDebugNames:true})` → `toText({foldExprs:false, inlineExport:false})`
(`wasmbundle.ts:197`), and `wast.ts`'s reparse. All produce identical bytes;
`inlineExport:false` is honoured; page counts survive the round trip.

The partial-features call is safe because **`parseWat` ignores the features bag
entirely** (`_features`) — the parser does not gate on proposals, so a caller
passing only `{exceptions:true}` gets the same result as `enable_all`. Worth
stating plainly since our own `defaultFeatures()` has GC, memory64,
multi-memory, threads and tail calls OFF and the mismatch looks alarming until
you read the facade.

**Neither T13.3 nor T13.4 is visible through `/compat`** — it exposes `wabt()`,
`WabtModule`, `WasmModule`, `Features` and the option types, and no `Limits` or
IR. The `^1.3.5` range they pin accepts the release.

### Cross-engine support for what we emit — measured 2026-08-24

Prompted by "can the page-size shapes be made compatible with Wasmer and V8?".
Every cell below is a run, not a claim, against Wasmtime 47.0.3, Deno/Node V8
(node 24.19), Bun 1.3.14 (JavaScriptCore), Wasmer 7.2.1 and wazero 1.12.0.

| shape | Wasmtime | V8 | Bun/JSC | Wasmer | wazero |
| --- | --- | --- | --- | --- | --- |
| plain MVP, SIMD, our real WASI corpus output | ✅ | ✅ | ✅ | ✅ | ✅ |
| `memory64` / `table64` | ✅ | ✅ | ❌ *"Memory64 is not enabled"* | ❌ | ❌ *limits byte not in 0x00–0x03* |
| GC (`struct.new`) | ✅ | ✅ | — | — | ❌ *`invalid byte: 0x5f != 0x60`* |
| multi-memory | ✅ | ✅ | — | — | ❌ *at most one memory* |
| tail call | ✅ | ✅ | — | — | ❌ *feature disabled* |
| exceptions | ✅ | ✅ | — | — | ❌ *feature disabled* |
| `(pagesize 1)` | ✅ | ❌ | ❌ | ❌ | ❌ |
| explicit `(pagesize 65536)` | ✅ | ❌ | ❌ | ❌ | ❌ |

**Custom page sizes cannot be made compatible by choosing a different
encoding, with exactly one exception.** A byte-paged memory is a different
memory TYPE, so there is no encoding of it that an engine without the proposal
will take. V8 has no flag at all — the full `--*wasm*` list has nothing for it,
and `--wasm-max-mem-pages` is documented in "64KiB memory pages", i.e. the
fixed size is baked in. wazero's decoder allowlists limits bytes 0x00–0x03.
Wasmer's `--enable-all` gets it past the PARSER and then fails with *"No
backends support the required features"* — the proposal is unimplemented in its
compilers, not merely switched off.

**The exception is an explicit `(pagesize 65536)`**, which denotes exactly the
same memory type as a plain `(memory 1)`. Emitting it WITHOUT the flag bit
would be accepted everywhere. We deliberately keep the bit (T13.4) because
round-trip fidelity is a metric here — but that is a WRITER-OPTION-shaped
choice, not a law, and it is the only page-size compatibility lever that exists.

**The tooling bug this question found.** `engine-check` passes Wasmtime an
explicit proposal list and passed Wasmer NOTHING — so the one engine kept for
"disagrees for different reasons" was the only one running on defaults, and its
verdicts were a mix of real rejections and default-off gates. That is the exact
trap the file's own header warns about, left in the file itself. It now gets
`--enable-all`, and its reason extractor reads the `╰─▶` continuation line
where the cause actually is (the first line is only "failed to validate
<path>", which made every rejection its own group of one).

**Bun and Node.** The LIBRARY API works on Bun: byte-for-byte identical output
to Deno on a round-trip smoke test, i64 exports included. Two caveats that are
about tooling, not the code — `bun test tests/` takes a path FILTER, not a
directory, so it walks the sibling `binaryen-ts/` and `wasmtk/` checkouts and
dies on their imports; and `@std/assert` needs the import map. Node cannot run
the sources directly (`--experimental-strip-types` rejects `enum`, and
`src/core/types.ts` is built on them); the supported Node path is the published
JSR package, which is why the `deno publish --dry-run` slow-types check matters.

**On "page size had something to do with Go and its GC" — FOUND, and it is
wasmtk's, not ours.** My first answer ("nothing records such a link") was
searching a wasmtk checkout dated **2026-07-02**, and the work is dated
2026-07-08 — six days later. Verified at `origin/main` (2026-08-10).

It is the **mergeable Go leaf**: `modc --lang=go --go-target=wasm-unknown`
builds a TinyGo freestanding leaf (0 imports, no `memory.grow`) that
`wasmmerge`s into a wasic bundle. TinyGo guards every exported function on a
runtime-"initialized" flag that its `_initialize` sets, **and emits that flag at
the fixed address 65536 — the first byte of page 1**. So `mergeOneWasmImport`
(`src/wasic.ts` ~20095–20110 at origin/main) does two things when a merged leaf
carries `$<prefix>__initialize`: injects `(call $<prefix>__initialize)` at the
top of `_start`, because nothing calls it after the merge and the leaf's exports
would otherwise trap; and floors the merged memory at two pages with
`Math.max(2, parseInt(n))`, purely so the byte at 65536 exists. The caveat
travels with it: the address is hardcoded by TinyGo, so **the host must not use
page 1** — fine for small wasic hosts, and large-memory hosts should stay on the
reactor/bindgen path.

**The connection is the CONSTANT 65536, not the custom-page-sizes proposal** —
and that is exactly why it interacts. "Two pages, so byte 65536 exists" is true
only at the standard page size; under `(pagesize 1)` two pages is two BYTES.
wabt-ts now emits `(pagesize …)` end to end (T13.4), so the assumption is worth
stating rather than leaving implicit.

Three things worth carrying back to wasmtk, none of them ours to fix:

1. **The floor is a REGEX on WAT text**, `\(memory\s+\(export\s+"memory"\)\s+(\d+)\)`,
   so it matches ONLY `(memory (export "memory") N)`. It silently no-ops on a
   memory that carries a MAX, an `i64` index type, a `(pagesize …)` clause, or a
   non-inline export — the same "silently did not apply" shape as wazmrt's
   dropped `(pagesize …)`, and the reason the page-size interaction above is
   double-guarded by accident rather than by design.
2. **`wasmbundle.ts`'s master WAT does NOT use the same floor.** It is
   `Math.max(1, ceil(dataOffset / 65536) + (anyDroppedAllocator ? 1 : 0))` — a
   floor of **1**, not 2, with the +1 conditional. The write-up describes it as
   "same 2-page floor, different reason"; it is not the same floor. If a merged
   Go leaf can reach the bundle path, the byte at 65536 is not guaranteed there.
3. **Line refs drift.** The cited `wasic.ts:20132-20149` and `:19943` are
   ~20095–20110 and 19904 at origin/main (with two more `Math.max(2, …)` sites
   at 20285 and 20448). Cite the SHAPE — `mergeOneWasmImport`, the
   allocator-unification path — the way the wasmtk team corrected us to do on
   `scripts/wasmtk-eh-report.md`.

**Our two breaking changes do not reach them.** wasmtk maps
`"wabt": "jsr:@jrmarcum/wabt-ts@^1.3.5/compat"`, and the `/compat` facade
exposes `wabt()`, `WabtModule`, `WasmModule`, `Features` and the option types —
**no `Limits`, no IR**. Neither `initial`/`max` becoming `bigint` (T13.3) nor
`pageSize` becoming `pageSizeLog2` (T13.4) is visible through it, and the caret
range accepts the release.

`tests/go_merge_tests.ts` is 7 hand-counted `ok()` assertions gated on TinyGo
being on PATH ("the CI image has none — skips cleanly"). **TinyGo 0.41.1 IS
installed on this machine**, so that gate does not skip here and the test is
runnable locally against an origin/main checkout.

**The separate wazero fact still stands** and is easy to conflate with the
above: wazero is the Go RUNTIME, and it rejects the GC proposal outright
(`invalid byte: 0x5f != 0x60`), along with custom page sizes, memory64 and
multi-memory.

### A SEVENTH metric — `assert_malformed`. 666 / 1229, and it is OPEN

`assert_invalid` covers modules that PARSE and then fail validation. Nothing
measured the other direction: text the spec says must **fail to parse at all**.
Building it found two real defects immediately, and it is the first campaign
metric that is not exhausted.

| | start | after the two fixes below |
| --- | --- | --- |
| quoted text | 356 / 1229 | **666 / 1229** |
| binary | 110 / 711 | 110 / 711 (untouched) |

**Fix 1 — an unknown instruction was silently DELETED, and it was OUR
regression.** `(i32.addd (i32.const 40) (i32.const 2))` parsed to an EMPTY
function body and `wat2wasm` returned Ok; the failure surfaced at the engine as
"expected 1 element on the stack", pointing nowhere near the typo.

Bisected to **T10.5's deferred body parsing, six commits earlier**. Before it, a
body that failed to parse left the cursor mid-body and the enclosing
`expect(Rpar)` failed loudly (`expected ), got (`). Deferring made
`parsePendingBodies` restore the cursor unconditionally, so the leftovers were
never looked at again — and `parseInstrList` compounds it by breaking out of its
loop and returning `Result.Ok` regardless of why.

`PendingBody` now records `endPos` and the parse must land exactly there, so
ANY unconsumed body content is reported, not just typos. Worth ~230 of the
metric.

**Fix 2 — digit separators were accepted anywhere.** `num ::= d | num '_'? d`;
`readNum` consumed a `_` unconditionally, so `1_`, `1__2`, `0x1_`, `1_.0` all
lexed as numbers. The rejection machinery already existed — `getNumberToken`
falls back to a Reserved token when an id-char trails the literal — it just
never saw the `_`, because `readNum` had eaten it. Leaving a malformed
separator UNCONSUMED is the whole fix. Worth ~80.

**What is still open (563 quoted + 601 binary), by the spec's own expected
message:**

| count | expected message | example |
| --- | --- | --- |
| 186 | malformed UTF-8 encoding | `(@a �)` |
| 114 | alignment / must be a power of two | `align=0`, `align=7` |
| 82 | unexpected token | field-order and block-type shapes |
| 55 | constant out of range | `(i32.const 0x100000000)` |
| 32 | illegal character | |
| 24 | inline function type | |
| 14 | mismatching label | `(func block end $l)` |
| 13 | i8 constant out of range | `(i8x16.extract_lane_s 256 …)` |
| 12 | import after function/global/table | |

Plus the 601 binary cases, which are a separate decoder-hardening job.

**This is the natural next tranche.** Note the shape of what is left: almost all
of it is the parser being LENIENT rather than wrong — accepting input no
producer emits. That is why six metrics could sit exhausted while this one sat
at 29%.

Regression: `tests/parser/malformed_input.test.ts` (17 cases; 11 fail pre-fix).

### CORRECTION (2026-08-24): the `assert_invalid` denominator was polluted

**`(assert_trap (module …) "msg")` was being reported as `assert_invalid`.**
The two assertions say OPPOSITE things: `assert_invalid` means the module must
fail validation, while `assert_trap` with a module means it is well-formed and
VALID and traps on INSTANTIATION (an out-of-bounds data/elem segment, or a
trapping start function).

54 such commands — data.wast, data1.wast, elem.wast, linking*.wast, start.wast —
were counted into the `assert_invalid` population. They are valid modules, we
correctly ACCEPT them, and so every one scored as a miss.

| | before | after |
| --- | --- | --- |
| correctly rejected | 2664 / **2737** | 2664 / **2683** |
| MISSED | **73** | **19** |

Nothing about our validator changed — only what we were counting. **† Every
historical `assert_invalid` figure in this file (2395, 2532, 2579, 2629, 2632,
2641, 2658, 2664 … / 2737) carries the same +54 pollution.** The DELTAS between
them are still valid, because the 54 were a constant; the denominators are not.
They are left as written rather than rewritten, since each records what was
actually measured at the time.

**The conclusion survives, at a fifth of the size.** Re-checked after the fix:
all 19 real remainders are still accepted by V8, so there is still nothing here
for us to fix. But "73" was five parts artefact to one part finding, and the
cross-engine exercise below spent its effort on a population that was mostly
valid modules — which is exactly why V8 and Wasmtime returned a flat accept.

Regression: `tests/parser/assert_trap_module.test.ts`.

### Cross-engine check of the 73 (2026-08-21) — see the correction above

The 73 `assert_invalid` modules wabt-ts still accepts are all ones **V8**
accepts too. Re-checked against **Wasmtime 47.0.3**, which is now the project's
accept/reject authority (see `CLAUDE.md`, "Oracle rule"):

| engine | accepted | rejected |
| --- | --- | --- |
| V8 (harness oracle) | 73 | 0 |
| **Wasmtime 47.0.3 (authority)** | **73** | **0** |
| Wasmer 7.2.1 | 52 | 21 — all FEATURE GATES |

Wasmer's 21 are `multiple memories` (14), `memory64 must be enabled` (4) and
`rec group usage requires the gc proposal` (3): `wasmer validate` has those
proposals off by default. Not a disagreement about validity.

**Conclusion: no disagreement from the AUTHORITY, so there is nothing here to
fix.** These spec tests predate proposals that legalised what they assert
against; matching them would mean diverging from Wasmtime.

**Wasmer earned its seat on the panel here.** V8 and Wasmtime both returned a
flat 73/73 accept — correct, and carrying no information beyond "no
disagreement". Wasmer's 21 rejections were the only DATA the exercise produced:
they classified the modules by the proposal each one needs. Not a validity
ruling, and it changed no verdict, but two engines agreeing tells you nothing
about *why*. Hence the standing rule: run all three, Wasmtime decides.
`deno task engine-check <dir>` does it, and self-tests against a known-invalid
module before reporting.

Two harness traps recorded in `best-practices.md` §1: enable proposals
explicitly (`-W all-proposals=y` fails on stock Windows Wasmtime — it pulls in
unsupported `stack-switching`), and give every module its own `-o` path (reusing
one made three I/O collisions score as REJECT until a known-invalid module was
run through to check the harness).

### T9.11 — `deno lint` was reporting a missing validator check, not dead code

Ten `no-unused-vars: 'offset' is never used` warnings sat in
`shared-validator.ts` and read as dead-parameter noise. They were not.

T9.5 added `checkMemArgOffset` — a memarg `offset=N` must fit the memory's
INDEX TYPE, u32 for a 32-bit memory — and wired it into `onLoad` and `onStore`
and **into none of the other ten handlers that take an offset**:
`onLoadSplat`, `onLoadZero`, `onSimdLoadLane`, `onSimdStoreLane` and the six
atomic ones. Each declared the parameter and ignored it, which is exactly what
the lint was saying.

Same shape as the T9.6 alignment gap: a check that exists, reads as covered,
and silently does nothing for a whole opcode family.

Four were reachable false-ACCEPTS, all of which V8 rejects:
`v128.load8_splat`, `v128.load32_zero`, `v128.load8_lane`, `v128.store8_lane`
with `offset=0x100000000` on a 32-bit memory. The atomic ones were already
caught earlier in the pipeline but are now wired the same way so they cannot
drift back.

**Neither corpus could see it** — agreement stayed 2120/2120 and
`assert_invalid` 2664/2737, because no spec-testsuite module writes an
out-of-range offset on a SIMD memory op. Five metrics missed this; a lint
warning found it.

**The reusable rule: an unused parameter in a handler whose SIBLINGS use it is
a missing check, not dead code.** Read the unused-variable warnings in a family
of parallel handlers before silencing them.

Regression test: `tests/validator/memarg_offset.test.ts` (9 out-of-range cases
cross-checked against V8, plus the `0xffffffff` boundary that a `>=` would
wrongly reject, plus a 64-bit memory where the same offset is legal).

### JSR score — checked, and the `deno doc --lint` count is not it

`deno doc --lint src/index.ts` reports ~788 `missing-jsdoc` errors. **They are
not what JSR scores.** The published `@jrmarcum/wabt-ts@1.3.5` reads
`"score": 100` from `https://jsr.io/api/scopes/jrmarcum/packages/wabt-ts` with
every one of those already present — they are interface FIELDS (543 in
`ir.ts` alone) and class MEMBERS, including private ones, which JSR's
documentation metric does not count. Do not chase them expecting the score to
move.

Two findings from the same run WERE real and are fixed:

- **`validateModule` is exported; `ValidateOptions` was not reachable from the
  package root**, so a consumer could not name its own options type
  (`private-type-ref`). Now re-exported from `src/index.ts`, and it carries
  JSDoc instead of a stale line comment claiming it is an empty placeholder.
- **`WastParser.parseInstrList` was public and took the module-private
  `ExprCtx`.** Every call site is inside the class; it is now `private`, which
  narrows the published surface as well as clearing the diagnostic.

### Wasmtime will not run wasic's legacy `try`/`catch` output (2026-08-24)

Putting the round-tripped WASI corpus to the three-engine panel found **6
modules the AUTHORITY rejects and V8 accepts**:

    15_Exceptions, 15_IdiomaticCatch_Stress, 15_LexicalShadowing_Stress,
    15_TestCase1-NestedEscalation, 15_recover,
    18_Multi-ScopeScaleAndMemoryLongevityTest

Wasmtime 47.0.3 and Wasmer 7.2.1 give the same reason:

    Invalid input WebAssembly code at offset 823:
    legacy_exceptions feature required for try instruction

**This is not a feature gate we can switch on.** Unlike the multi-memory /
memory64 / gc rejections in the 73-module cross-check, `wasmtime -W` has no
`legacy-exceptions` option at all — only `exceptions`, which is the STANDARD
proposal (`try_table` / `exnref`). Wasmtime cannot run the legacy encoding,
full stop.

**Nothing here is ours to fix, and the round trip is byte-identical for all
six** — they go in rejected and come out rejected. It is wasic emitting the
superseded legacy EH proposal for every TypeScript try/catch/throw, which
wabt-ts supports precisely because wasic emits it (see the legacy-`try`
invariant in `design-decisions.md`).

**But it matters to the standing WASI goal**, which names Wasmtime as the
primary p1 host: *if Wasmtime will not run it, it does not work, whatever V8
says.* Six corpus modules do not work. **Worth reporting to the wasmtk side**
alongside the seven `KNOWN_INVALID` ones — the fix is for wasic to emit
`try_table`, which wabt-ts already supports end to end.

Note this is the SECOND finding the panel produced that V8 alone could not
see, and again it came from an engine disagreeing rather than agreeing.


**ANSWERED 2026-08-24 — confirmed, with three corrections against us.** wasmtk
reproduced it and verified both of our load-bearing premises independently
rather than trusting them (`wasmtime -W help` offers only `exceptions[=y|n]`;
a hand-written `try_table` module runs with no `-W` flags). Their corrections:

- **Scope is 10 modules, not 6** — our snapshot is missing four
  (`56_AsyncReject`, `60_AsyncAll`, `64_ReportModuleTryCatch`,
  `64_ReportThrowTemplate`).
- **Two shapes need migrating, not three** — a bare `(catch_all H)` with no
  `rethrow` is never emitted; `catch_all` is generated only inside the
  `hasFinally` branch and always carries `(rethrow 0)`.
- **Our `src/wasic.ts` line refs were stale** (~13976/13992/13994 → actual
  14749 / 14756 / 14772 / 14774). The doc-block ref was exact.

They took the V8-only-gate lesson as theirs and queued "add Wasmtime to the EH
gate" **with** the migration rather than after it — migrating alone fixes the
instance and leaves the blind spot — noting `wasmtk wast` has the same shape.
The migration is their top `next-work.md` item; they deliberately did not bolt
it onto a review, since handler bodies becoming branch targets is a real
structural change.

### Post-campaign audit — 2026-08-24 (the "look for code issues" trigger)

Ran the audit the way `INDEX.md` now defines it: **enumerate the type, check the
code against it.** Corpus coverage found none of this.

**Clean** (recorded so the next pass does not redo them):

- every `ExprVisitorDelegate` hook (99) vs. the walkers that must be total —
  binary writer, WAT writer, validator: **99/99 each**;
- every `Var`-bearing `Expr` field (65 kinds, 99 fields) vs. `resolveNames`
  **and both writers** — clean (the `TryExpr` "gap" is a false positive: block-
  like exprs use `begin`/`end` hooks, and `delegate` round-trips byte-identical);
- `apply-names`' two gaps are deliberate and documented; the bridge's
  `call_indirect` uses `ci.sig` directly; `generate-names` names declarations,
  not references;
- the binary reader routes every memarg through ONE `readMemArg()`, so no
  per-site divergence is possible;
- **dest/src immediate order** for `memory.copy`, `memory.init`, `table.copy`,
  `table.init` and `array.copy` — all five correct behaviourally and
  byte-identical on round trip. Checked because binaryen-ts flagged
  `array.copy` as a case where "swapping them is invisible when both types
  match"; ours is right.

**Found — dead code that was actively misleading.** `Validator.refNullType`
was uncalled: the COARSENING helper T9.3 replaced, sitting directly below the
live call site with an inviting doc comment, collapsing a `ref.null $T` to its
abstract supertype. That is the same shape as binaryen-ts's UP-7, and a future
edit could plausibly have re-wired to it. Removed, with its now-orphaned
`heapTypeNameToType` / `Type` import.

**Found — `i64.add128` / `i64.sub128` (wide arithmetic), two defects.**

1. `instrInputCount` had no `TokenType.Quaternary` entry, so it fell to
   `default: return 0` while `buildPlainExpr` reads `op0()`…`op3()`. The LINEAR
   form popped nothing and all four operands became placeholders. **The bytes
   were correct anyway** — `pushStmt` flushes the orphaned operands in source
   order and a placeholder emits nothing (T10.8) — which is precisely why no
   metric saw it. The IR TREE was wrong, and that is what the bridge and
   `wasm2ts` read. Third instance of the documented
   `instrInputCount` ↔ `opN()` mismatch, after two SIMD ones.
2. The binary reader could not decode `0xfc 0x13` / `0x14` at all
   (`unknown misc opcode: 19`), so **`wasm2wat` could not read back a module
   our own `wat2wasm` had just written.** A producer/consumer mismatch inside
   one toolchain — best-practices §3. Added `MiscOpcode.I64Add128` /
   `I64Sub128` and the decode.

Both fixed; all six metrics unmoved.

**Second audit pass (same day) found the first fix covered only HALF the
proposal.** `add128` / `sub128` were fixed from the reported symptom;
`i64.mul_wide_s` / `i64.mul_wide_u` (0xfc 0x15 / 0x16) sat with the identical
defect — encodable, not decodable. They lex to `TokenType.Binary`, so the arity
was already right; only the reader was missing.

They were found by generalising the question instead of fixing the instance:
**for every opcode the LEXER can produce, can the READER decode it?** Feed each
of the 571 spellings to the reader as a synthetic body and look for the
specific "unknown … opcode" diagnostic. Result after the fix: **0 / 571**.

A first, STATIC version of that sweep (matching `case` labels in the reader
source) reported 317 gaps — 315 of them false, because the SIMD and atomics
decoders dispatch by RANGE (`if (op >= 0x00 && op <= 0x06)`) rather than by
case label. The empirical version is both simpler and correct. Inverted before
trusting it: with the fix stashed it reports exactly the two real gaps.

The sweep is now the last case in the regression file, so the CLASS is guarded
rather than the four instances. Regression:
`tests/parser/wide_arithmetic.test.ts` (9 cases).

**FIXED — and it was not latent for long.** `getMiscOpcodeTypeInfo`'s
`default:` returned `(v128,v128,v128) → v128`. It was logged as unreachable and
deliberately left alone. **Adding wide-arithmetic reader support in the very
next commit made it reachable**, and the consequence was the opposite of the
T9.2 incident it echoes: instead of wrong operands validating clean, **every
well-typed wide-arithmetic module was REJECTED** with
`expected [v128, v128] but got [i64, i64]`.

`onQuaternary` was worse — it hard-coded the v128×4 shape and ignored the
opcode entirely, so it rejected the only instructions that actually reach it
(`i64.add128` / `i64.sub128` are the ONLY `TokenType.Quaternary` spellings; the
relaxed-SIMD quaternary ops it was written for do not exist).

Fixed by giving all four wide-arithmetic opcodes real type info —
`mul_wide_*` is `[i64,i64] → [i64,i64]`, `add128`/`sub128` is
`[i64×4] → [i64,i64]` — with the SECOND result pushed by the `onBinary` /
`onQuaternary` special cases, since `OpcodeTypeInfo` carries only one. The misc
`default:` now returns all-`Void` (inert) rather than a SIMD signature.

**Neither corpus nor the agreement metric could see any of this.** V8 gates the
proposal off entirely (`Invalid opcode 0xfc13 (enable with --experimental-…)`),
so it rejects these modules for an unrelated reason and agreement stays
2120/2120. **Wasmtime is the oracle here**, and with `-W wide-arithmetic=y` it
agrees with us on all three probes:

| module | before | after | Wasmtime |
| --- | --- | --- | --- |
| well-typed `add128` | REJECT | **accept** | accept |
| well-typed `mul_wide_s` | REJECT | **accept** | accept |
| `add128` with f32 operands | REJECT | REJECT | reject |

Two lessons, both recorded in `best-practices.md`: **"unreachable" is a
property of today's code, not of the defect** — this one became reachable one
commit later, from a change that never touched it. And **a hard-coded shape in
a handler that ignores its opcode is the same bug as a lying default**, just
harder to grep for.

Regression: `tests/parser/wide_arithmetic.test.ts` (15 cases; 5 of the 6
validator cases fail pre-fix).

### A FIFTH metric — execution. 23,077 / 23,077 (2026-08-24)

Every metric the campaign had checks **bytes or acceptance**: parse-clean,
V8-validity, validator agreement, `assert_invalid`, round-trip byte-identity.
None ran a single instruction.

That leaves a real hole. Suppose the parser mapped a token to the WRONG opcode
— `i32.sub` emitting `i32.add`'s byte. V8 accepts it (a valid instruction),
the validator agrees (well-typed), and the binary reader maps that byte back to
`i32.add` consistently, so **round-trip is byte-identical**. All five metrics
green, program computes the wrong answer. Only execution catches it.

**Result: 23,077 of 23,077 executed `assert_return` assertions pass, zero
failures, across the spec testsuite.** 29,544 skipped — modules needing host
imports, v128 (cannot cross the JS boundary), NaN payloads (JS canonicalises
them), and `ref.func` arguments.

Harness: `assert_return` + `invoke`, compiled through our own pipeline,
instantiated on V8, compared by BITS for floats. It lives in the session
scratchpad.

**Four harness bugs had to be fixed before the number meant anything, and the
first run said "156 failures".** Every one was the harness:

| bug | effect |
| --- | --- |
| `action` commands skipped | stateful `grow`/`size` sequences never advanced |
| NaN payload compared by bits | unrepresentable through a JS `number`, so unscorable — not wrong |
| **`toJs` read `.type` off the `WastArg` wrapper** | a `WastArg` is `{kind:'value', value: Const}`, so every invoke WITH ARGUMENTS was silently skipped — **2,240 assertions instead of 26,837** |
| reference arguments skipped | the `init(externref)` that POPULATES the table in every GC test file never ran, so every slot stayed null and every downstream assertion failed |

The third is the one to remember: the harness reported a healthy-looking
2,084/2,240 while executing **only nullary functions**. A metric can be
precise, stable, and measuring almost nothing.

**And `ref.extern` arguments are expressible after all** — an externref is any
JS value, so `(ref.extern N)` maps to a stable per-N sentinel. Skipping them
was what made the entire GC cluster look broken.

### A frozen snapshot read as a live signal — both projects, one week (2026-08-24)

`tests/wasmtk/` is a 272-file snapshot of wasmtk's build output. Its live
corpus is **373**. No source commit was recorded, because files accreted one at
a time as wasic surfaced new shapes.

That was invisible until we asked a question whose answer changes over time,
and then it put a false claim in a report we sent upstream (the seven
`KNOWN_INVALID` modules — see the retraction above and
`scripts/wasmtk-eh-report.md`).

**wasmtk hit the identical pattern independently in the same week**: a frozen
vendored `proposals/threads/` snapshot read as a live signal. Neither case was
carelessness. **A snapshot is indistinguishable from current data unless
something records its provenance** — the same reason this project pins an
upstream SHA rather than saying "the checkout".

Fixed here by `tests/wasmtk/PROVENANCE.md`, which records what the directory
is, that it is 272 against 373, that the source commit is unknown, and the rule
that no present-tense claim about wasic may be derived from it. wasmtk's
`cmem/testing.md` already required regenerating before validating against
another runtime; ours did not, and that is exactly the gap.

**The reusable rule: stamp any vendored copy with source + date in the same
change that creates it.** An un-stamped snapshot does not announce itself — it
reads as current until something expensive proves otherwise.

### A fourth metric — validator agreement

`wat2wasm` does not run the validator, so nothing in the campaign exercised it
and two whole classes of bug hid there: rules that were never feature-gated,
and opcode-table keys left stale by T7.7. The metric is simple — for every
testsuite module V8 accepts, does `wasmValidate` agree? **2120/2120.**

**T9.3 (done)** moved the validator onto `ValueType`, so reference subtyping
is real: defined-type `(sub …)` chains walked transitively, structural type
identity via canonical keys (rec-group-relative, so groups shaped alike key
alike), and producers reporting their true type (`ref.cast` the cast-to type,
`ref.func` the function's own `(ref $T)`, `ref.as_non_null` /
`br_on_non_null` dropping nullability).

**Measure BOTH directions.** Agreement only counts false rejections; it says
nothing about what a permissive validator waves through. Adding the
`assert_invalid` direction changed the verdict on T9.3 from "regression" to
"worth it":

|  | before T9.3 | after |
| --- | --- | --- |
| modules V8 accepts that we accept | 2120 / 2120 | 2110 / 2120 |
| `assert_invalid` modules we reject | 1806 / 2737 | **1834 / 2737** |

**CORRECTION (T9.5).** Both `assert_invalid` figures above are wrong. The
harness asked `hasErrors(result.errors)`, but the validator signals failure
through `result`, and `dropTypes` returned `Result.Error` without recording a
message — so every stack underflow read as "accepted". Measured on `result`
the same two points are **2395** and **2423**: the absolute numbers were off by
~590, the **+28 delta was exactly right**. Measure the field the code sets.

**T9.4 then closed the 10** — without widening the lattice, which is the thing
T9.3 existed to stop doing. Every one of them turned out to be a SECOND bug the
coarse lattice had been hiding: `array.new_elem` still reporting the bare
`Type.Ref` placeholder (5 modules), `br_on_null` skipping its result push in
unreachable code and so changing the stack height (1), the canonical key
rendering a same-rec-group supertype by index instead of by position (2), and
`br_on_cast_fail` passing `rt1` through where the branch carries `rt1 \ rt2` —
a nullable `rt2` absorbs the null case, so the difference is NON-nullable (2).

Final: **2120/2120 agreement AND 1834/2737 assert_invalid** — 28 more real
errors caught, zero false rejections.

| id | Scope | Files |
| --- | --- | --- |
| ~~T9.5~~ | **DONE.** The "903" was a measurement artefact (see the correction above); the real figure was 314. Fixing the silent report alone accounted for the difference. Three real gaps then fell out: `checkSignature` peeked without an ARITY check (`peekType` answers the `Type.Any` wildcard below the frame base, and `br` only peeks — so `(block (result i32) (br 0))` validated) **+102**; a 32-bit memory's page limit is 65536, not 2^32-1; and a memarg `offset` must fit the memory's index type, newly reachable because T9.2 widened the reader to u64. **2395 → 2532 / 2737**, agreement unmoved at 2120/2120. Regression test `tests/validator/rejects_invalid.test.ts`. | — |
| ~~T9.6~~ | **DONE.** Of the 205, **74 are also accepted by V8** — those spec tests predate proposals that legalised what they assert against — leaving 131 genuinely ours. Six categories closed: SIMD-memory ALIGNMENT (the validator kept its own partial natural-align table with no SIMD entries, so the check silently did nothing — `core/opcode.ts` already owns the canonical one and CLAUDE.md says not to duplicate it); LANE INDICES for `i8x16.shuffle` and `load*_lane` / `store*_lane`; IMMUTABILITY of struct fields and array elements; UNKNOWN type indices in value types; FINAL supertypes (an absent `(sub …)` is implicitly final); and CONSTANT EXPRESSIONS (only the const family, ref forms, `global.get`, extended-const arithmetic and GC allocations). **2532 → 2579 / 2737**, agreement unmoved at 2120/2120. Regression test `tests/validator/structural_checks.test.ts`. | — |
| ~~T9.7~~ | **DONE.** Declared `(sub …)` relationships are now checked STRUCTURALLY, not just for finality — kind match, struct fields kept in order and appendable, mutable fields exact / immutable narrowable, func params contravariant and results covariant (**+17**, the whole category). Plus: `ref.eq` operands must be eq-hierarchy (`anyref` is a SUPERTYPE of `eqref`, so it does not qualify); a bare `select` is numeric/vector-only AND both operands must be the same type; a non-defaultable table element type needs an initializer; `array.copy`'s source element must be assignable to the destination's; and a type's scope bound is "everything before it plus the rest of its own rec group", not the section size — which closed the cross-group forward reference T9.6 had left as a documented failing case. **2579 → 2629 / 2737**, agreement unmoved at 2120/2120. Regression test `tests/validator/subtype_decl.test.ts`. | — |
| ~~T9.8~~ | **DONE.** A one-armed `if` falls through producing what it was given, so its block type's params and results must match — the missing `else` is not modelled in the type checker, so this is checked from the IR. And a `try_table` CATCH CLAUSE hands its target operands determined by the catch KIND (`catch` → the tag's params, `catch_ref` → params plus a NON-NULL `(ref exn)`, `catch_all` → nothing, `catch_all_ref` → `(ref exn)`); only the tag immediate was bounds-checked. **2632 → 2641 / 2737**. Two mistakes while adding the catch check, both caught by the agreement metric rather than by reasoning: depths were read AFTER `beginTryTable` pushed the try_table's own label (the same off-by-one T7.6 fixed in the parser — 6 valid modules rejected), and `catch_ref` was modelled as the nullable `exnref` (1 more). Regression test `tests/validator/control_arity.test.ts`. | — |
| ~~T9.9~~ | **DONE.** Five rules relating two IMMEDIATES, or an immediate to a declaration, none visible to the operand stack: `br_on_cast`'s rt2 must be a SUBTYPE of rt1; `table.copy` / `table.init` element compatibility; `array.*_data` needs a numeric element and `array.*_elem` a reference one; a global's initializer may only name globals declared BEFORE it (a self-reference is an unknown global). Plus local-init tracking — see the correction below. **2641 → 2658 / 2737**, agreement unmoved at 2120/2120. Tests `tests/validator/gc_operand_rules.test.ts` and `tests/validator/local_init.test.ts`. | — |
| ~~T9.10~~ | **DONE — the validator now rejects every invalid module V8 rejects.** `call_ref` / `return_call_ref` expected any `funcref` rather than `(ref null $t)` for the NAMED type; `call_indirect` / `return_call_indirect` accepted a table of ANY reference type instead of a function table (and `return_call_indirect` still hard-coded an i32 index, missed when call_indirect got table64 in T9.2); `array.*_elem` never compared the segment's element type to the array's; and a bare abstract heap keyword was lexed as a VALUE type. **2658 → 2664 / 2737, and all 73 still accepted are modules V8 accepts too.** Tests `tests/validator/call_and_heaptype.test.ts`. | — |

### Correction: local-init was mis-scoped, and reading the spec test settled it

T9.8 deferred `uninitialized local` with the reasoning *"it needs the
function-references init-tracking algorithm — an init set per control frame,
intersected at an `if` join — and a conservative approximation would reject
valid code, which is the one thing this campaign hasn't done."*

That was wrong on the central point. `local_init.wast`'s own `assert_invalid`
cases decide it:

```wat
(if … (then (local.set $x …)) (else (local.set $x …)))
(drop (local.get $x))          ;; INVALID
```

If the rule intersected at a join, setting the local in **both** arms would
leave it initialised. It does not. The real rule is plain **frame-scoped
rollback**: an initialisation inside a control frame is undone at `end`, an
`else` arm does not see what `then` initialised, and there are no joins at all.

So it was neither large nor an approximation — no risk of false rejections, and
agreement held at 2120/2120 on the first run. **The lesson is the reusable
part**: the deferral came from reasoning about the algorithm from memory rather
than reading what the spec test actually asserts. The evidence was already in
the repo and took minutes to check.

### T11 — the pipeline rewrote an INVALID module into a valid one (DONE)

Raised as "we should not be creating invalid modules", and on review the
framing in the T9.6 note was wrong twice over. The funcidx encoding is not
lossy for the case I first flagged — but the parser, reader, both writers and
the validator ALL conflated two segments the spec keeps distinct:

| spelling | element type |
| --- | --- |
| `(elem (i32.const 0) $g)` / `… func $g` | **`(ref func)`**, non-nullable — every entry is a function index |
| `(elem (i32.const 0) funcref (ref.func $g))` | `funcref`, nullable |

elem.wast has the first as VALID and the second as INVALID against the same
`(ref func)` table. Five sites, each hiding the next:

1. **parser** recorded `funcref` for the funcidx elemlist;
2. **binary reader** decoded flags 0-3 as `funcref` — and after a first pass at
   the fix, flags 4 as `(ref func)`. The two forms imply DIFFERENT types and
   one default cannot serve both;
3. **binary writer** used the funcidx encoding for any all-`ref.func` segment
   (T7.11), widening an explicit `funcref` declaration;
4. **WAT writer** gated the `func $a $b` shorthand on the NULLABLE `funcref` —
   backwards, since that spelling MEANS `(ref func)` — so the declaration was
   lost in the text too, and fixing only the binary side dropped round-trip
   fidelity 1961 → 1779 before this was found;
5. **validator** never compared a segment's element type to its table's.

Net effect and the reason it earns its own item: `wat2wasm` silently REPAIRED
the invalid module. A tool that quietly turns invalid input into valid output
is worse than one that rejects it.

A T7.11 test asserted the repaired behaviour was correct; it is now inverted.
T7.11's fix had been too broad. Regression test
`tests/writer/elem_type_fidelity.test.ts`.

### Open — T9: found during the campaign, invisible to both metrics

Neither the parse metric nor the V8-validity metric exercises these, so they
survived the whole campaign unnoticed. Both are real; neither blocks a
testsuite file.

| id | Scope | Found |
| --- | --- | --- |
| ~~T9.1~~ | **DONE.** The binary READER had no `pushStmt` equivalent. `endFrame` splices leftover operand-stack values in AFTER every statement (`[...stmts, ...stack]`), so any decoded expression that produces a value nobody consumes is re-emitted at the END of its block — past the statements that followed it in the original. This is the same defect the parser fixed in v1.3.0, on the other side of the round-trip. Confirmed to change program semantics, silently: `(block (result i32) (global.get $g) (global.set $g (i32.const 9)))` returns 1, and 9 after a `wasm2wat` round-trip. Fixed by a module-level `pushStmt(stack, stmts, expr)` that drains pending values first, wired into all 42 statement-commit sites. Round-trip fidelity over the testsuite: 1942 -> 1954 of 2105 modules byte-identical, 76 -> 70 files affected, zero regressions. Regression test `tests/reader/stmt_order.test.ts`. | T5.3 |
| ~~T9.2~~ | **DONE.** Measured properly (run `wasmValidate` over every spec-testsuite module V8 accepts; any disagreement is our bug) this was SEVEN bugs across 418/2120 modules, not one: MVP restrictions with no feature gate (218), every SIMD opcode-table key still on the pre-T7.7 `<< 8` packing and therefore DEAD (77), segment offsets checked as i32 regardless of index type (56), table ops hard-coding i32 (39), the reference lattice as originally logged (~30), MVP's imported-global-only rule for constant expressions (7), and the memarg offset read as u32 when memory64 makes it u64 (1). Agreement 1702 → **2120/2120**. Regression test `tests/validator/agreement.test.ts`. | T5.3 |

### Why the numbering changed shape

T5.1 / T5.2 sit under T5 because they are GC-proposal surface, the same area.
T6.4 / T6.5 were in the original T6 list and just had no id. T8 is new: block
type-use and the `select` annotation are core-spec syntax, not part of any
proposal area the original scope named — they were missed because the files
carrying them failed earlier for other reasons, so their first error never
mentioned them.


---

## LIVING LOG — binaryen-ts findings, to file upstream when the tranches close

**This is a running record, not a snapshot.** Every time work on this side
hits a binaryen-ts limitation, add it to "Open findings" below with an
`UP-n` id, the tranche that surfaced it, and — importantly — a *measured*
severity. When the T-series repair tranches finish, this section becomes the
upstream report.

### Working rules for this log

1. **Measure severity, never inherit it.** The first entry (`UP-1`) was
   originally described from CLAUDE.md as "functionally invisible under V8";
   probing V8 directly showed it produces modules V8 **rejects**. Every entry
   states how its severity was established.
2. **Re-verify against the actual checkout before filing.** CLAUDE.md says the
   submodule is pinned at `6c6f81f66` (v1.0.9); the working checkout is
   **v1.3.5** (`b78e5b476`), and three previously-listed gaps are already
   fixed there. Stale entries are worse than no entries.
3. **Record the root cause, not just the symptom** — several of these are IR
   shape limits that an encoder patch would not fix.
4. **Do not modify the binaryen-ts checkout.** It stays clean on `main`; this
   side only reads it. Fixes are the binaryen-ts team's to make.

### Severity scale

| Level | Meaning |
| --- | --- |
| **blocking** | Emits bytes V8 rejects, or cannot emit the construct at all |
| **wrong-output** | Emits bytes V8 accepts that mean something other than intended |
| **gap** | Construct unsupported; fails loudly or is simply absent |
| **design-limit** | Works as designed, but the design cannot express what we need |

### Already fixed upstream — do NOT file; correct our notes instead

| Our older note said | Actual state in v1.3.5 |
| --- | --- |
| no `addElement` factory | **present** (`ir/module.ts`) |
| `loadOpcode()` has no V128 branch, silently emits `i64.load` | **fixed** — throws `WasmEncodeError`; its fix comment documents that exact silent-truncation bug |
| `WasmExport.kind` has no `"tag"` | **present** (`ir/module.ts`) |

### Open findings

**RE-VERIFIED 2026-08-24 against the actual checkout** (`b78e5b476`, v1.3.5,
clean on `main`) per rule 2, and every severity re-measured per rule 1. Six of
the seven stand; **UP-7 was stale and is restated**. The report built from this
is `scripts/binaryen-ts-upstream-report.md`.

**ANSWERED the same day, and TWO SEVERITIES WERE STILL WRONG.** binaryen-ts
confirmed all seven with exact line refs and corrected us:

- **UP-5 is the most severe finding, and it is SILENT** — we had it sixth, as a
  bridge "gap". The decoder reads the start funcidx and throws it away, so
  `readBinary(b).emitBinary()` produces valid wasm that behaves differently
  with no diagnostic. Reproduced here: start section present → absent, exported
  global 42 → 0.
- **UP-1 is a round-trip corruption**, not merely "unencodable" — the decoder
  handles `0x04`/`0x0d` but collapses them onto `signed=false`. Reproduced
  here: `0x04` in, `0x02` out, engine rejects. No builder, no passes.
- **Our "root cause is in the IR, not the encoder" was wrong** — rebuttal
  accepted, see below.
- Their checkout is **v1.4.3** (`00e7e953858`); ours is v1.3.5. They diffed and
  all seven hold. Our `^1.0.9` pin resolves to 1.4.3 today, so the PIN is not
  what made this log stale — the checkout is.

| id | Finding | Severity | Surfaced by |
| --- | --- | --- | --- |
| UP-5 | **A start function is silently DROPPED on round-trip** — the decoder reads the funcidx and discards it. Valid in, valid out, behaviour changed, no diagnostic | **wrong-output, SILENT** | Tier D |
| UP-1 | `struct.get_u` / `array.get_u`: the decoder collapses `0x04`/`0x0d` onto `signed=false`, so **valid wasm round-trips INVALID** — both engines reject | **wrong-output** | GC tiers / T7 review |
| UP-2 | `tuple.make` has an `ExpressionKind` entry but no factory **and no encoder case** | **gap** | multi-value branches |
| UP-3 | Same for all four GC array bulk ops (`array.fill` / `copy` / `init_data` / `init_elem`) | **gap** | tranche 2 |
| UP-4 | `ref.as_non_null` — **not even an `ExpressionKind` entry** | **gap** | Tier C |
| UP-6 | `WasmImport.kind` has no `"tag"` — asymmetric, since `WasmExport.kind` now does | **gap** | Tier C |
| UP-7 | **RESTATED TWICE.** A typed-ref LOCAL collapses to `anyref` on READ (`readValTypeByte`), so a bare `parseWasm → encodeWasm` turns any GC module with typed-ref locals INVALID. The narrowed `ModuleBuilder` surface is the smaller half | **wrong-output** (was "design-limit", then "gap") | typed-ref refactor |

Details for each follow.


#### UP-1 — `struct.get_u` / `array.get_u` unencodable (blocking)

The bytes produced instead are REJECTED by V8.
`wasm-encoder.ts` selects the opcode with `e.signed ? 0x03 : 0x02`, so the
unsigned form 0x04 is never emitted. Same shape for `array.get_u` (0x0d vs
`array.get` 0x0b). The root cause is in the IR, not just the encoder:
`StructGetExpr.signed` is a `boolean`, so it has only two states and cannot
distinguish the THREE spec opcodes — `struct.get` 0x02 (non-packed),
`get_s` 0x03 (packed, sign-extend), `get_u` 0x04 (packed, zero-extend). A fix
needs a three-state field (or to derive packedness from the field type), not
just an encoder tweak.

**Severity — measured, 2026-08-21, not inherited.** An earlier note in
CLAUDE.md called this "functionally invisible under V8, which recovers
signedness from the packed field type". **That is wrong.** Probing V8 directly
with a `(struct (field (mut i8)))` read three ways:

**Re-measured 2026-08-24 against v1.3.5, through binaryen-ts's OWN
`ModuleBuilder` + `encodeWasm`** (not a hand-built binary), and put to both
engines. `(struct (field (mut i8)))` holding 200, read three ways:

| sub-opcode | V8 | Wasmtime 47.0.3 | result |
| --- | --- | --- | --- |
| `0x04` `get_u` (spec-correct) | accepts | accepts | `200` (zero-extended) |
| `0x02` `get` — **what binaryen-ts emits for `signed=false`** | **REJECTS** | **REJECTS** | — |
| `0x03` `get_s` — what it emits for `signed=true` | accepts | accepts | `-56` (sign-extended) |

The messages name the fix precisely:

- V8: *"struct.get: Field 0 of type 0 has type i8. Use struct.get_s or
  struct.get_u instead."*
- Wasmtime: *"can only use struct `get` with non-packed storage types"*

The array half behaves identically: binaryen-ts emits `0x0b` for
`signed=false`, V8 rejects it (*"array.get: Array type 0 has type i8. Use
array.get_s or array.get_u instead."*), and `0x0d` `array.get_u` returns 200.

So this is not a cosmetic wire divergence: any consumer reading a PACKED field
unsigned through binaryen-ts gets a module V8 refuses to compile. That raises
it from "worth reporting" to "blocking for packed GC fields".

#### UP-2 — `tuple.make`: enum entry, no factory, no encoder case (gap)

`ExpressionKind.TupleMake = "tuple.make"` is in the enum, but there is **no
`makeTupleMake` factory and no `case` for it in the encoder**. Verified
2026-08-24 by hand-building the node the factory would return and encoding it:

    WasmEncodeError: cannot encode unsupported expression kind: tuple.make

So the enum entry is the only part that exists. Good failure mode — the
encoder's `default` branch throws rather than emitting something wrong — but
the construct is unreachable. Blocks multi-value `return` AND, since our
multi-value branch work, multi-value `br` / `br_if`.

#### UP-3 — the four GC array bulk ops: same shape (gap)

`ArrayFill`, `ArrayCopy`, `ArrayInitData` and `ArrayInitElem` are all in
`ExpressionKind` with **no factory and no encoder case**, exactly like UP-2.
The four instructions we implemented in tranche 2 have no bridge path.

#### UP-4 — `ref.as_non_null`: not even an enum entry (gap)

Stronger than the old note. There is no `makeRefAsNonNull`, no encoder case,
and **no `ExpressionKind` entry at all** — unlike UP-2/UP-3, nothing about the
instruction is present.

#### UP-5 — No `setStart`, and no start section at all (gap)

Confirmed 2026-08-24: `ModuleBuilder` has no `setStart`, and there is no
start-section field in the IR or emit path in the encoder. Start functions
cannot be bridged.

#### UP-6 — `WasmImport.kind` has no `"tag"` (gap)

Confirmed 2026-08-24: `WasmImport.kind` is
`"function" | "global" | "table" | "memory"`. The asymmetry is the useful part
— `WasmExport.kind` DOES include `"tag"` now (see the fixed table above), and
`addTag` defines one, so tag imports are the only remaining hole in tag
support.

#### UP-7 — typed refs stop at the `ModuleBuilder` surface (gap) — RESTATED

**The old entry said "`ValType` cannot express a concrete typed reference — it
is a flat string enum". That is no longer the finding.** v1.3.5 has
`RefType { heap: HeapType; nullable: boolean }` in `src/ir/gc-types.ts`, the
expression-level `Type` is `ValType | TupleType | None | Unreachable | RefType`,
and `FuncTypeDef.params` / `.results` are already `(ValType | RefType)[]`.

What is still narrow is the **`ModuleBuilder` declaration surface**, which is
the layer a bridge actually calls:

| method | today | needs |
| --- | --- | --- |
| `addFunction(name, params, results, …)` | `ValType[]` | `(ValType \| RefType)[]` |
| `addFunctionImport(…, params, results)` | `ValType[]` | same |
| `addGlobal(name, type, …)` | `ValType` | `ValType \| RefType` |
| `addTable(name, type, …)` | `ValType` | same |
| `addTag(name, params)` | `ValType[]` | `(ValType \| RefType)[]` |

So a `(ref $T)` param can be expressed one layer down (`addHeapType` with a
`FuncTypeDef`) but not through the builder that declares the function. This is
a much smaller ask than the original entry implied — widening five signatures
to a union the codebase already defines, not a representational change.

**Re-measured 2026-08-24; this is exactly what rule 2 exists for.** The stale
version would have asked the binaryen-ts team to build something they had
already built.

### Framing for the report

Several of these were found by measuring **V8 validity** of encoder output
across the 257-file WebAssembly spec testsuite rather than by unit tests —
that method is worth mentioning to them, since it is what surfaced the
silent-wrong-bytes class in our own encoder too (packed-type wire bytes,
NaN payload mask, multi-value truncation).

### Filed — 2026-08-24

The T-series tranches closed on 2026-08-24, which is this log's stated trigger.
Report written to
[`scripts/binaryen-ts-upstream-report.md`](../scripts/binaryen-ts-upstream-report.md).

**Rule 2 earned its place.** Re-verifying before filing changed three of the
seven entries:

- **UP-7 was wrong in the report's favour.** It claimed `ValType` "cannot
  express a concrete typed reference" and called it a design limit. v1.3.5 has
  `RefType`, the expression `Type` includes it, and `FuncTypeDef` already
  accepts it — only the `ModuleBuilder` DECLARATION surface is narrow. Filing
  the stale version would have asked them to build something they had built.
- **UP-2 / UP-3 were understated.** Both were logged as "no factory". The
  encoder has no `case` for those kinds either, so it is not one missing
  function per instruction.
- **UP-4 was overstated in the opposite direction** — it is not just a missing
  factory, there is no `ExpressionKind` entry at all.

And the three entries in the "already fixed upstream" table were re-confirmed
present, so the report says so explicitly rather than staying silent about our
own stale notes.

**UP-1's severity was re-measured, not carried over** — this time through
binaryen-ts's OWN `ModuleBuilder` + `encodeWasm` rather than a hand-built
binary, and put to Wasmtime as well as V8. Both reject. That is the difference
between "we think this is wrong" and a report they can act on in one reading.

### Answered — 2026-08-24, and two of our severities were still wrong

Re-verifying before filing (rule 2) caught three stale entries. It did **not**
catch two mis-ranked severities, and the recipient did:

| we said | actually |
| --- | --- |
| UP-5: "no `setStart`" — a bridge gap, ranked 6th of 7 | **the most severe finding, and silent.** The decoder discards the start funcidx; `readBinary(b).emitBinary()` yields valid wasm with different behaviour and no diagnostic |
| UP-1: "unencodable", blocking | **a round-trip corruption** — valid `0x04` in, `0x02` out, engine rejects. No builder, no passes |
| "six of seven fail loudly; only UP-1 emits bad bytes" | **two of seven produce wrong output, and the silent one is worse** |

Both reproduced here before being accepted, not taken on trust.

**The rebuttal we accepted.** We wrote *"the root cause is in the IR, not the
encoder — an encoder-only patch cannot fix it"*, then offered as option (2)
exactly such a patch. They pointed out option (2) is complete: packedness is
available at encode time via `this.mod.heapTypes`, and given packedness
`signed` is total (non-packed → `get` only; packed → `get_s`/`get_u`). Verified
both halves. **We undersold our own recommendation with the sentence above it.**

**What we sent back.** Deriving the sub-opcode from packedness makes today's
invalid `0x02`-on-packed decode and re-encode as valid `0x04` — an encoder
repairing its input, our T11 class. The clean split is for the DECODER to
reject it.

### UP-7 corrected a second time — and we over-corrected the first time

We restated UP-7 once (design-limit → gap) when re-verifying showed `RefType`
already exists, and called it *"a much smaller ask than our old note implied —
widening five signatures"*. **That over-corrected.** binaryen-ts found the
other half while writing a behavioural test for `array.fill`:

```ts
function readValTypeByte(r: BinaryReader): ValType {
  const t = readValueType(r);
  if (typeof t === "string") return t as ValType;
  return ValType.AnyRef;      // ref type in a legacy position
}
```

A local declared `(ref null $t)` reads back as `anyref`. Reproduced here:
fixture returns 7; `0x63 0x00` in the input becomes `0x6e` in the round-trip;
V8 rejects with *"array.get[0] expected type (ref null 0), found local.get of
type anyref"*. **Third wrong-bytes finding**, pre-existing, untouched by their
Tier 1/2 work.

**The count went 1 → 2 → 3, wrong in the same direction each time.** We
under-rated everything filed as "surface" or "gap" because we were measuring
what the BRIDGE could not express. The round-trip path —
`readBinary(b).emitBinary()`, no builder, no passes — was never what we
measured, and all three wrong-bytes findings live there.

That is the same blind spot the campaign's own third metric exists to cover:
parse-clean and V8-validity both measure the ENCODE path, and T9.1 was
invisible to both. **We built a round-trip metric for ourselves and then
reviewed someone else's codebase without one.**

### Their Tier 1 / Tier 2 fixes are NOT yet recheckable

`origin/main` is `00e7e9538` / v1.4.3; neither `dd88e034bd0` (Tier 1: UP-1,
UP-5) nor `f664ba579a0` (Tier 2: UP-6, UP-4, UP-3) exists on any ref — their
work is local and unpushed. Recheck is queued; the checkout is a plain clone of
`github.com/jrmarcum/binaryen-ts.git`, so pulling is self-serve.

Verified at v1.4.3 in the meantime: UP-1 and UP-5 reproduce unchanged, so the
baseline did not move with the version bump.

**Four of their process findings are worth keeping**, independent of this
report:

1. **Enabling test type-checking caught a scrambled fixture** —
   `addTable("a", 1, null, ValType.FuncRef)` against `(name, type, initial,
   max)`. It passed because the test asserted only a throw, which fired
   regardless of the arguments. *A test that asserts a throw can be arbitrarily
   wrong about everything else and stay green.*
2. **A tag index space needed three sites to agree**; `parse()` rebuilt every
   tag as `$tag${i}`, discarding the offset the reader had computed — their
   `$import${n}` bug reproduced in a new index space.
3. **Omitting one of `_mapChildren` / `_visitChildren` makes a node invisible
   to every pass instead of erroring.** Silent-skip rather than loud-fail.
4. **`array.copy`'s dest/src immediate order gets its own test**, because
   swapping them is invisible when both types match — the same shape as our
   `memory.init` `(memory, data)` vs `(data, memory)` note.

### The lesson this pair of exchanges is actually about

Two reports went out the same day. One carried a version stamp; one rested on
an un-stamped vendored corpus.

| | binaryen-ts report | wasmtk report |
| --- | --- | --- |
| snapshot identified? | **yes** — `b78e5b476`, v1.3.5 | **no** — 272 files, no commit, no date |
| what happened | recipient noticed in one step, diffed, confirmed all seven still hold | we asserted seven modules were currently broken; all seven had been fixed — **retracted** |

Same failure mode, opposite outcomes, and the only difference was whether the
snapshot said what it was. See `tests/wasmtk/PROVENANCE.md`.

**And re-verifying is not the same as re-ranking.** Rule 2 got the facts
current; it did not re-ask "which of these is worst, and why". Severity
ordering is a separate judgement from freshness, and ours was wrong in the way
that matters most — we ranked the loud failure above the silent one, when
silent is the one that ships.

### Append new findings here

When a tranche hits a binaryen-ts limitation, add a row to **Open findings**
and a `#### UP-n` block below, following the working rules above: measured
severity, root cause, and the tranche that surfaced it. If a tranche completes
without hitting one, note that too — an empty pass is evidence the remaining
gaps are narrowing.

- *Legacy EH / `try_table` catch depth (V8-valid 214 → 216): **no new
  binaryen-ts finding**. The bug was ours — catch targets were resolved with
  the try_table's own label pushed, one too deep.*
- *T5 (`rec` / `sub`, parse 233 → 240, V8-valid 216 → 221): **no new
  binaryen-ts finding**. Worth noting the bridge has no rec/sub concept at
  all, but nothing in it was newly blocked.*
- *T5.1 + T8.3 (parse 240 → 241, V8-valid 221 → 222): **no new binaryen-ts
  finding.** The bridge has no case for either conversion instruction, but
  nothing previously working broke — it simply has no path, same as the other
  GC gaps already filed as UP-3.*
- *T7.7 (relaxed SIMD, V8-valid 222 → 229): **no new binaryen-ts finding.**
  The bug was ours — the `(prefix << 8) | sub` opcode packing could not hold a
  sub-opcode >= 0x100.*
- *T6.4 + T5.2 (parse 241 → 249, V8-valid 229 → 237): **no new binaryen-ts
  finding.** `module definition` / `instance` are script-level constructs the
  bridge never sees.*
- *T8.1/8.2/8.4/8.5 (parse 249 → 254, V8-valid 237 → 242): **no new
  binaryen-ts finding** — all four were parser abbreviation forms.*
- *T6.5 (annotations, parse 254 → 255, V8-valid 242 → 243): **no new
  binaryen-ts finding.** Annotations are skipped in the lexer and never reach
  the IR, so the bridge cannot see them.*
- *T5.3 (br_on_cast, parse 255 → 257, V8-valid 243 → 245): **no new
  binaryen-ts finding**, but note the bridge has no `br_on_cast` case — same
  GC gap already filed as UP-3, now with two more instructions behind it.*
- *T7 remaining clusters (stack residue, tail-call types, singles): in
  progress.*

---



**Current published version:** `@jrmarcum/wabt-ts@1.3.1` on JSR.
Versioning follows the sub-version-capped-at-9 rule (1.0.9 → 1.1.0 →
… → 1.2.4 → 1.2.5 → 1.2.6 → 1.2.7 → 1.2.8 → 1.2.9 → 1.3.0; major uncapped). Latest meaningful
landings: f64/f32 const integer-literal encoding (v1.1.0); multi-value
`return`, `memarg.align` natural defaults, full SIMD opcode-name table
regen from upstream `opcode.def` (v1.1.1); repo hygiene + submodule
removal + fork detach (v1.1.2); SIMD `replace_lane` second operand +
try_table `(catch ...)` clauses + bare-offset elem segments + legacy
`(try (do ...))` + validator SIMD opcode-info entries + wasmtk WAT
corpus integration (v1.1.3); nested `(call ...)` operand order fix
(v1.1.4); v1.1.5 was a no-op version bump that shipped without the
local Bug D / Tier D changes; Phase 7 Tier D bridge expansion (memory
+ table exports, data segments) plus Bug D fix (empty-folded ops
consume preceding stack values) plus SimdShuffleOp/SimdStoreLane arity
correction (v1.1.6); Bug F fix (Bug D pad clamped to available stack —
fixes `br_if` / `br` with a single folded f64 cond mis-resolving
non-first globals; v1.1.7); v1.1.8 is a no-op version bump;
parseV128Literal — full WAT `v128.const i8x16/i16x8/i32x4/i64x2/f32x4/
f64x2 …` literal support — plus Phase 7 GC Tier 1 (`ref.eq` /
`ref.i31` / `i31.get_s` / `i31.get_u` + 8 abstract heap types in the
Type enum; latent reader bug fixed where ref.eq was building
CompareExpr instead of RefEqExpr) (v1.1.9); Bug G fix
(`call_indirect (type $name)` now resolves named types correctly —
resolveNames was resolving `table` but skipping `typeVar`, so every
named type collapsed to index 0; critical for wasic's higher-order
array methods) (v1.2.0); `/compat` subpath export — thin facade
mirroring `npm:wabt`'s async-factory API so consumers can migrate
with a one-line import-map flip (v1.2.1); v1.2.2 was a doc-only
update; GC Tier 2 — `struct.new` / `struct.new_default` / `struct.get`
/ `struct.get_s` / `struct.get_u` / `struct.set` instructions plus
`(type $name (struct (field …) …))` WAT type-section syntax with
packed `i8` / `i16` fields and `(mut type)` mutability qualifier;
parseValueType now accepts `(ref $T)` / `(ref null $T)` (coarsens
to `Type.StructRef` placeholder — typed-ref IR refactor pending)
(v1.2.3); GC Tier 3 — 9 `array.*` instructions plus
`(type $name (array (mut? T)))` type-section round-trip (v1.2.4);
GC Tier 4 — `ref.test` / `ref.cast` with `(ref [null] H)` heap-type
immediates including abstract keywords (`any` / `eq` / `i31` / etc.)
and user-defined type indices (v1.2.5); v1.2.6 was a doc-only update
(README + repo-history cleanup); JSR doc-quality sweep — `@module`
headers added to all 6 tool entrypoints (was 1/7), every exported
symbol surfaced through `src/index.ts` documented (265 / 265, was
51%); README "Runtime compatibility" section documenting that the
library API uses only Web platform APIs and works on Deno / Bun /
Node 18+ / Browser unmodified (v1.2.7); CI fmt-check + lint fix
(`deno fmt` across the tree + removed unused `Result` import from
`src/api/wabt-compat.ts` that was leftover from an early draft;
all 5 CI steps now green: fmt-check, lint, type-check, test,
publish:dry) (v1.2.8); legacy EH `(try (do …) (catch $tag …)
(catch_all …)? (delegate …)?)` now parses to a real `TryExpr` with
full try/catch/catch_all/delegate/end dispatch instead of being
coerced to a `BlockExpr` (the coercion dropped the dispatch edges and
produced binaries V8 rejected with "not enough arguments on the stack
for local.set"); plus a latent WAT-writer double-emit of catch handler
bodies fixed, and `rethrow` depth + catch-tag resolution added to
`resolveNames` (v1.2.9 — reported against 1.2.8 via wasmtk Phase 15
exception suite); statement-ordering fix — a value-producing instruction
at statement position (most importantly a void `call`, which the parser
can't distinguish from a value-returning call without the callee's
signature) was pushed to the operand stack and only committed to the
statement list by the enclosing block's end-of-body `flushStack`, which
appends AFTER every genuine statement; so a folded
`(call $f) … (return X)` sank the call past the `return` into dead code
and its side effect never ran. New `pushStmt` helper drains the operand
stack into `stmts` before committing each statement, preserving source
order; routed all 10 statement-position push sites through it. Also
removed 5 dead private methods surfaced by a reference-count sweep
(`expectLpar` / `parseInlineExports` in wast-parser, `readU64Leb` +
orphaned `decodeU64Leb128` import in binary-reader, `openNewline` /
`writeRefKind` in wat-writer) (v1.3.0 — reported via wasmtk's shared-heap
stdlib track; the call-sinking shape silently dropped any
`sideEffectingCall(); return X;` pattern); hex-float literal fix —
`parseF32LiteralBits` / `parseF64LiteralBits` handled
`LiteralType.Hexfloat` with JavaScript's `parseFloat()`, which cannot
parse WAT hex-float notation (`0x1.921fb54442d18p+2`): `parseFloat`
reads the leading `0`, stops at `x`, and returns `0`. So **every**
hex-float constant — all of wasmtk's merged `mathlib` polynomial
coefficients, π, e, ln2, etc. — was silently encoded as `0`, making the
merged Math.* functions return garbage (and trapping the f64→string
helper's `i64.trunc_f64_s` on the resulting NaN/Inf). The fix adds an
explicit `parseHexFloatValue` reconstructor (sign · integer-hex ·
fraction-hex · binary-exponent → double; exact for normal numbers) and
routes the `Hexfloat` case (both f32 and f64) through it; the decimal
`Float` case still uses `parseFloat`. (v1.3.1 — reported via wasmtk's
Phase 38 mathlib suite; `parseHexFloat` already existed and was correct
in `core/literal.ts`, but `parseF*LiteralBits` in the parser never
called it.)

**Integration milestone (2026-05-28):** wasmtk's Phase 1 test suite
passes 38/38 against `@jrmarcum/wabt-ts@1.1.8`. The wasmtk-driven
hardening loop (real module shape → wabt-ts bug surfaced → root-cause
fix + regression test) has converged for Phase 1. Future wasmtk
phases will re-open it; the loop is the design, not a transitional
phase.

**Migration milestone (v1.2.1):** `/compat` ships at
`jsr:@jrmarcum/wabt-ts@^1.2.1/compat`, mirroring the upstream
`npm:wabt` (libwabt.js) public API shape. Consumers add an import-map
entry and existing `import wabt from "wabt"` code compiles unchanged.
The wasmtk migration path documented in wasmtk's VISION.md § Stage
0.5 is unblocked. Mirrors the precedent set by `binaryen-ts/compat`
(binaryen-ts v1.2.2).

**GC milestone (v1.1.9 → v1.2.5):** All four planned GC tiers ship:
Tier 1 (i31 + ref.eq + 8 abstract heap types, v1.1.9), Tier 2
(`struct.*` + type-section struct heap types, v1.2.3), Tier 3
(`array.*`, v1.2.4), Tier 4 (ref.test / ref.cast with heap-type immediates,
v1.2.5). ~25 new instructions plus heap-type infrastructure across
parser / IR / reader / writer / validator / bridge. Caveat — wabt-ts's
flat `Type[]` representation for params/results/locals can't carry
heap-type indices, so `(ref $T)` / `(ref null $T)` syntactic forms
parse but coarsen to `Type.StructRef` in the binary output. V8
round-trip is blocked when typed-ref params appear; tier 2–4 tests
verify binary encoding (type-section bytes, opcode bytes, immediate
resolution) rather than runtime instantiation. The proper fix —
`FuncSignature.params: ValueType[]` carrying concrete heap-type
metadata — is the next significant Phase 7 piece. `br_on_cast` /
`br_on_cast_fail` deferred (opcodes wired but no IR/parser/bridge
yet); upstream binaryen-ts gaps unchanged.

**JSR doc-quality milestone (v1.2.7+):** All 7 package entrypoints
(`src/index.ts`, `src/tools/wat2wasm.ts`, `wasm2wat.ts`,
`wasm-validate.ts`, `wasm-objdump.ts`, `wasm-strip.ts`, `wasm2ts.ts`,
`src/api/wabt-compat.ts`) carry `@module` JSDoc headers describing
purpose + usage example + pipeline. Every exported symbol surfaced
through `src/index.ts` is documented — 265 / 265 (was 142 / 265 =
53.6% before the sweep). JSR's package-quality score reads complete
on both "module docs in all entrypoints" and "docs for most symbols"
axes. New exports must come with at least a one-line JSDoc to keep
the score at 100%; `deno doc --json src/index.ts` enumerates the
surface if you ever want to re-audit. Two JSR-score items remain
that can't be set in code — "compatible runtime" tags are set on
the JSR package settings page (web UI); mark Deno / Bun / Node /
Browser there.

**CI hardening (v1.2.8):** `.github/workflows/ci.yml` runs
`deno fmt --check`, `deno lint`, `deno task check`, `deno task test`,
and `deno publish --dry-run` on every push and PR to `main`.
v1.2.7's doc sweep had landed without running `deno fmt`, so CI
broke on the format-check step. Fixed in v1.2.8 by running
`deno fmt` across the tree + removing one unused `Result` import
from `src/api/wabt-compat.ts`. Lesson: run `deno task ci` locally
before pushing — `ci` is wired in `deno.json` and runs check + test
back-to-back; `deno fmt --check && deno lint && deno task ci &&
deno publish --dry-run` is the full local equivalent.

---

## 2026-08-21 — Multi-value branches (V8-valid 200 → 214)

The largest remaining T7 cluster, `expected N elements on the stack`, was two
separate defects in the branch IR.

1. **`br` and `br_if` truncated their carried values to the first.**
   `BrExpr.value?: Expr` / `BrIfExpr.value?: Expr` held ONE operand, so a
   branch to a label with N results emitted a single value and V8 rejected the
   function. Exactly the defect `ReturnExpr.values: Expr[]` had already fixed
   for `return`; both are now `values: Expr[]` in stack order. Failing shape
   straight out of func.wast:
   `(func (result i32 f64) (br 0 (i32.const 79) (f64.const 8)))`.

2. **`br_table` took the WRONG operand as its index.** The index is the TOP
   operand and carried values sit below it, but the node used `op0()` — so the
   FOLDED form `(br_table $a $b (i32.const 7) (local.get 0))` put the carried
   value in the index slot and dropped the real index. The LINEAR form
   happened to work, which is why the v1.3.4 br_table test passed and this
   stayed hidden. Now the last operand is the index and the rest go to a new
   `values` array.

The v1.3.4 operand-order invariants had to survive this change and do:
`br_if`'s cond is still read from the END of the operand list, and a padded
Nop still collapses to "no carried value" (a Nop produces nothing, so it can
never be a real branch value). `tests/parser/branch_value.test.ts` passes
untouched.

Reader: `br` / `br_if` now pop `brTargetResultCount` values and restore stack
order instead of popping one. `br_table` keeps carried values as preceding
statements, matching how the binary stream orders them.

Bridge: binaryen-ts has no `makeTupleMake` in v1.0.9, so a branch carrying
several values has no representation there. New `bridgeBranchValue` throws a
clear "needs makeTupleMake" rather than silently passing only the first —
which is the bug this change fixed.

Measured **fully V8-valid 200 → 214**; modules ok 1904 → 1919, rejected
40 → 25. The stack-arity cluster went from 14 files to 4.

Regression: `tests/parser/multi_value_branch.test.ts` — every case executes in
V8 and checks the actual returned tuple, plus the folded/linear br_table split
and the v1.3.4 invariants.

**Two probe mistakes worth remembering.** Both of my first `br_if` test cases
were invalid WAT, not parser bugs: `br_if` leaves its values on the stack when
NOT taken, so nothing may follow it inside a block whose result those values
are. Check the WAT before blaming the parser.

### Remaining (25 modules / ~18 files)

| Cluster | Files |
| --- | --- |
| `expected N elements on the stack` (residue) | 4 |
| relaxed SIMD `reached end while decoding` | 4 |
| legacy EH `catch kind generates …` | 3 |
| `i8x16.splat expected i32` | 2 |
| misc singles | 5 |

---

## 2026-08-21 — Typed-ref IR refactor DONE (V8-valid 187 → 200)

The deferred refactor CLAUDE.md had carried since v1.2.3. `(ref $T)` /
`(ref null $T)` now survive as concrete types instead of coarsening to
structref.

### The shape

`FuncSignature { params: Type[] }` could not carry a heap-type index next to a
`Ref` / `RefNull` code — the `Type` enum's values ARE single wire bytes, but a
typed reference encodes as the `0x64` / `0x63` marker FOLLOWED BY a heap type.
So the parser stored `Type.StructRef` as a placeholder and the writer emitted
a structref byte. Anything using a typed ref in a signature, local, global,
table, or element type parsed and encoded fine and was then rejected by V8 —
**invisible to the parse-clean metric, which is why it was never in a tranche.**

```ts
export interface RefValueType { kind: 'ref'; heapType: Var; nullable: boolean }
export type ValueType = Type | RefValueType;
```

Widened: `FuncSignature.params` / `.results`, `LocalDecl.type`, `Global.type`,
`Table.elemType`, `ElemSegment.elemType`, `Field.type`, `SelectExpr.resultType`.

### Precision where it matters, coarsening only where the target is flat

- **Encoders are precise.** New `writeValueType` emits the two-part encoding;
  `readValType` decodes it. **`readRefType` had to change too** — it read a
  single byte, so a typed table element type left the heap type in the stream
  and shifted every following field (`(table $x 1 (ref null $t))` came back as
  `(table 0 ref null)`).
- **`resolveNames` walks every value-type slot** via a new
  `resolveModuleValueTypes`, so a `$T` heap type reaches the writer resolved.
  Without it the writer's fail-loud guard fired on the first `$T` — the guard
  doing its job again.
- **The validator's type-checker and the binaryen bridge coarsen** through
  `coarsenValueType`, applied at their boundaries (a handful of methods) rather
  than at ~20 call sites. Their surfaces are genuinely flat: binaryen-ts's
  `ValType` has no typed-ref case, and the type-checker compares by identity.
  Encoders must NEVER coarsen — that was the bug.
- **`(ref null func)` still collapses to the one-byte `funcref`**, since the
  abstract nullable form IS funcref. Keeping it concrete would emit two bytes
  where one is correct. `typeKey` in synthesize-types distinguishes concrete
  refs so two different `(ref $T)` signatures don't dedupe onto one entry.

### Sizing, in hindsight

The scope said 80 `.params`/`.results` call sites and predicted the validator
would be the deep end. The call-site count was right but the difficulty was
not: because `Type` is assignable INTO `ValueType`, the compiler stayed silent
until the *read* sites were reached, and several were hidden behind
`writeU8(t as number)` casts that silenced it further. **Widening one function
signature at a time and re-running `deno task check` was the productive loop**
— the error count walked down 49 → 43 → 31 → 16 → 14 → 12 → 8 → 5 → 1 → 0.

### Result

Spec testsuite **fully V8-valid 187 → 200**; modules ok 1886 → 1904, rejected
58 → 40. The entire typed-ref cluster is gone: `expected structref, got
(ref $t)`, `call_ref expected (ref null …)`, `local.set expected structref`,
`array.new expected structref`, the `fallthru` mismatches.

The GC array-bulk module from tranche 2 — encoding-only-verified at the time
because `(ref $arr)` coarsened — now runs in V8 and returns 42. Its test moved
from byte assertions to execution.

Regression: `tests/ir/typed_refs.test.ts`. Also removed a duplicated
`typeName` switch found in `wasm-objdump.ts` while wiring the display helper.

### Remaining (V8-rejected, 40 modules / ~28 files)

| Cluster | Files |
| --- | --- |
| `expected N elements on the stack` | 14 |
| relaxed SIMD `reached end while decoding` | 4 |
| `not enough arguments on the stack` | 3 |
| `catch kind generates …` (legacy EH) | 3 |
| `i8x16.splat expected i32` | 2 |
| misc singles | 6 |

---

## 2026-08-21 — T7 batch 2 (V8-valid 182 → 187, parse-clean 230 → 233)

Answering "is the 1 remaining write-failure covered by a tranche?" — **no**,
and chasing it found two silent-corruption bugs that no tranche covered either.
Tranches were derived from parse failures; none of this is visible there.

1. **Quoted identifiers were a different name from their bare spelling.**
   `id ::= '$' idchar+ | '$' '"' string '"'` — the quoted form is an alternate
   spelling of the SAME identifier, escapes resolved, so `$"fh"` denotes
   exactly `$fh`. The lexer returned the raw source slice including the
   quotes, so the two never matched. New `varTokenText` normalizes at every
   identifier read site (`parseVar`, `parseBindVarOpt`, params, locals, heap
   type vars).

2. **Raw non-ASCII characters in WAT strings were truncated to one byte.**
   `decodeStringToken` did `bytes.push(ch)` with a UTF-16 code unit, so `é`
   (U+00E9) emitted `e9` instead of UTF-8 `c3 a9`, and U+F61A emitted `1a`
   instead of `ef 98 9a`. WAT strings are BYTE strings and the source is
   UTF-8, so a raw character contributes its UTF-8 encoding. This corrupted
   data segments and import/export names — and produced a VALID module with
   the wrong bytes in it, the worst failure mode of the lot. Escaped
   spellings (`\ef\98\9a`, `\u{f61a}`) were always correct, which is why an
   isolated round-trip test would have passed: the test has to compare the
   spellings against EACH OTHER, not against themselves.

3. **`(func $f (type $t) …)` with no inline signature got an EMPTY one.**
   The whole signature comes from `$t`. Without it the emitted type was
   `() -> ()` while the body pushed a value → "expected 0 elements on the
   stack". It must be resolved BEFORE the body parses, because local slot
   numbering starts at `sig.params.length`; a forward-referenced type still
   falls back to `synthesizeTypes`. This was the bulk of the stack cluster:
   20 → 13 files.

4. **Multi-value block results were truncated to the first type, and block
   params were not parsed at all.** The old code admitted it:
   `// multi-value: use func_type index (simplified: use first type)`.
   Anything beyond the single-result shorthand needs a function type index in
   the blocktype slot. `parseBlockType` now parses `(type $t)?  (param …)*
   (result …)*` and interns a function type via a new `currentModule`
   reference (same per-function lifecycle as `localScope`). This also closed
   the T6 `block-param` item — parse-clean 230 → 233 (block, if, loop, fac).

Metric now: **parse-clean 233/257, fully V8-valid 187, 1944 modules → 1886 ok
/ 58 rejected / 0 failed.** Write-failures are gone.

Regression: `tests/parser/signatures_and_strings.test.ts`. The UTF-8 tests
compare the three spellings of one character against each other; the type-use
test executes a function whose local sits after two adopted params; the
block-type tests execute multi-value and param'd blocks in V8.

### Remaining, by V8 rejection reason

| Cluster | Files | Notes |
| --- | --- | --- |
| `expected N elements on the stack` | 13 | Residue after the type-use fix; needs its own diagnosis. |
| typed-ref coarsening | ~12 | The IR refactor scoped in the previous entry. Unchanged. |
| relaxed SIMD encoding | 4 | `reached end while decoding` — immediates likely wrong. |
| `not enough arguments on the stack` | 3 | local_set / simd_store / store. |
| misc singles | ~5 | duplicate export name, invalid local index, memory ordering. |

---

## 2026-08-21 — The parse metric has a blind spot; new T7 scope

### The measurement problem

Every tranche so far was scoped and measured by **parse-clean count**. That
metric cannot see a module that parses perfectly and then encodes to bytes V8
rejects — exactly the failure mode of the two latent bugs CLAUDE.md had
documented as unfixed. Neither was in ANY tranche, because tranches were
derived from parse failures.

Stronger metric, now to be used alongside parse-clean: **parse → resolveNames
→ synthesizeTypes → writeBinaryIr → `WebAssembly.validate`**, per text module.
`synthesizeTypes` is required — omitting it yields an empty type section and
"no signature at index 0". Two harness attempts produced nonsense aggregates
before that was spotted; validate any such harness against a known-good file
before trusting its numbers.

At the T4 cut: **230/257 files parse clean, but only 180 had every module
V8-validate.** 1937 text modules → 1863 ok / 67 rejected / 7 write-failed.

### Fixed in this pass

1. **`Type.I8` / `I16` had the wrong wire bytes** (0x7a / 0x79 → **0x78 /
   0x77**). The old values continued the numeric value-type sequence
   (v128 = 0x7b); the GC proposal does not continue it there. wabt-ts's own
   binary writer emitted packed struct/array fields V8 rejects outright
   ("invalid value type 0x7a") — invisible through the bridge because
   binaryen-ts re-encodes its own way, and invisible to the parse metric.
   CLAUDE.md flagged this at v1.2.3 with "separate fix needed". Every call
   site used the symbol rather than the raw value, so the change was safe.
2. **`br_table` never resolved its index expression.** The case resolved the
   label targets but never recursed into `e.value`. The visitor DOES walk it,
   so the writer reached names the resolver never touched. Bug F class.
3. **`try_table` never resolved its catch clauses** — body only. A
   `try_table (catch $e $l)` emitted tag 0 and label 0, silently dispatching
   the wrong tag to the wrong block. Per the spec the catch clauses are
   checked in the context extended with the try_table's own label, so they
   resolve inside the label push.

Now 182 files fully V8-valid; write-failures 7 → 1.

**Standing guard added** (`tests/ir/encode_correctness.test.ts`): after
`resolveNames`, NO name-var may survive anywhere in the IR — asserted over a
hand-built module exercising every index space AND over the whole spec
testsuite. This closes the Bug G / Bug F class permanently rather than one
instance at a time. `ref.null.refType` is the one deliberate exception
(abstract heap keywords are not names in any index space).

### T7 — semantic correctness. Remaining clusters, by V8 rejection reason

| Cluster | Mods / files | Notes |
| --- | --- | --- |
| `expected N elements on the stack` | 31 / 20 | Largest. Folded-form arity or stack-shape bug; needs its own diagnosis pass. |
| **typed-ref coarsening** | ~21 / ~12 | `expected structref, got (ref $t)`, `call_ref expected (ref null …)`, `local.set expected structref`, `array.new expected structref`, `br_on_non_null expected subtype`. The limitation below. |
| relaxed SIMD encoding | 6 / 6 | `reached end while decoding`, `i8x16.splat expected i32` — opcodes mis-encoded or missing immediates. |
| `not enough arguments on the stack` | 3 / 3 | local_set / simd_store / store. |
| misc singles | ~5 / 5 | duplicate export name, invalid local index, elem const-expr arity. |

### The typed-ref refactor, scoped

`FuncSignature { params: Type[]; results: Type[] }` cannot carry a heap-type
index alongside a `Ref` / `RefNull` type code, so the parser stores
`Type.StructRef` as a placeholder for `(ref $T)` / `(ref null $T)` and the
writer emits structref bytes. Any module with a typed ref in a signature,
local, global, or element type parses and encodes but is then rejected.

Target shape (as CLAUDE.md sketched):

```ts
type ValueType = Type | { kind: 'ref'; heapType: Var; nullable: boolean };
interface FuncSignature { params: ValueType[]; results: ValueType[] }
```

**Sizing: 80 `.params` / `.results` call sites and 54 `Type[]` annotations
across validator (22), ir (17), writer (13), reader (13), bridge (11), tools
(2), parser (2).** The validator is the deep end — its type-checker compares
types by identity throughout and would need subtype-aware comparison.

Recommended sequencing: take the cheaper T7 clusters first (the stack-arity
cluster is 20 files and is probably a contained parser bug), then the
typed-ref refactor as a dedicated piece of work with the V8-validity metric as
its acceptance test. It is not a tranche-sized change.

---

## 2026-08-21 — Tranche 4: table64 / memory64 index types (214 → 230/257)

Measured 214 → **230/257 clean, zero regressions** — exactly the +14 projected,
plus two files from the table-definition shapes that turned out to live in the
same code path.

1. **`(table $t i64 30 30 funcref)`** — `i32` / `i64` in that slot is the
   table's INDEX TYPE, not its element type. Element types are always
   REFERENCE types, so a ValueType there must be classified first; the parser
   consumed `i64` as the elemtype, read `30 30` as the limits, then hit the
   real element type with "expected ), got ValueType". `parseLimits` already
   knew how to consume the index type — only the classification was wrong.
2. **`(memory i64 (data "…"))`** — the inline-data branch matched only a bare
   `(data`, so the index-type spelling fell through to `parseLimits` and
   reported "expected limit initial value". **The synthesized data-segment
   offset must be `i64.const` for a 64-bit memory** — an `i32.const` offset
   parses fine and then produces a binary V8 rejects, which is why the test
   asserts V8 acceptance rather than a successful parse.

`parseTableModuleField`'s non-import branch was restructured around the two
real shapes, which also closed four adjacent gaps:

- `(table $t64 i64 funcref (elem $f))` — abbreviated inline elem WITH an index
  type.
- `(table $t 10 funcref (ref.null func))` — table initializer expression
  (fills every slot; the `Table.init` IR field already existed).
- `(table $t funcref (elem (ref.func $f) (ref.null func)))` — inline elem list
  of element EXPRESSIONS, not just a bare funcidx list. Same abbreviation
  already fixed for standalone `(elem …)` segments in v1.3.6.
- `(elem (table $t) (i32.const 1) (ref func) (ref.func $d))` — an elem segment
  whose element type is the parenthesized typed-ref form, which starts with
  `(` and so missed the bare-ValueType check.

Still failing and NOT a T4 regression: `(table $x (ref null $t) (elem $tf))`
parses but V8 rejects it — the typed-ref IR coarsens `(ref $T)` to structref,
the pre-existing limitation documented in CLAUDE.md.

Regression: `tests/parser/table_memory_types.test.ts`. The table-initializer
and inline-elem-expression tests instantiate and read the table back
(`table.get(i)`) so a wrong slot count or ordering cannot pass.

**Remaining: 27 files.** T5 (GC `(sub …)` / `(rec …)`) and T6 (block params,
`module definition`, annotations) plus the newly catalogued
`any.convert_extern` / `extern.convert_any` GC conversions.

---

## 2026-08-21 — Tranche 3: multi-memory (spec testsuite 179 → 214/257)

Smaller than scoped: the IR ALREADY carried `memidx: Var` on every memory op,
and the binary writer already knew the multi-memory memarg encoding (bit 6 of
the align field signals a memory index follows). Three things were missing,
and accepting the new syntax exposed a fourth.

1. **`parseMemidxOpt` accepted only `(memory $m)`**, not the BARE var the spec
   grammar uses on instructions — `i32.load $mem offset=0`,
   `memory.size $mem`. Every bare memory index failed with "expected ), got
   Var"; 33 files on its own. Now falls through to `parseVarOpt`.
2. **`resolveNames` never walked `memidx` on ANY memory instruction** — the
   Bug G class again. A NAMED memory reached the binary writer as an
   unresolved name-var and hit its fail-loud guard. New `resolveMemoryVar`
   wired into load / store / atomic_* / memory.size / grow / fill / copy /
   init / simd_load_lane / simd_store_lane. **`memory.size` needed its own
   case** — it is a leaf with no sub-expressions, so it fell through the
   "nothing to resolve" default while still carrying a memidx.
3. **`memory.init` transposed its indices**, exactly like `table.init`: the
   one-var form names the DATA segment and the two-var form is
   `memory.init $memidx $dataidx`, so they swap when a second var appears.
4. **SIMD lane ambiguity, introduced by accepting bare memory indices.**
   `v128.load8_lane memarg laneidx` ends with a MANDATORY lane index, so a
   lone integer is the LANE, not a memory. Upstream disambiguates by
   lookahead — a bare Nat is a memory index only when followed by `offset=`,
   `align=`, or a second Nat — and `parseSimdLaneMemidxOpt` now does the same.
   **The existing Tier C bridge tests caught this**, which is exactly what
   they are for; `(v128.load8_lane 3 …)` had started reading lane 3 as
   memory 3.

**Latent WAT-writer bug surfaced by the round-trip test:** `onMemoryInitExpr`
emitted the BINARY operand order (dataidx then memidx) rather than the TEXT
order (memory first). Any non-zero memory therefore re-parsed transposed and
V8 rejected it with "invalid data segment index". Invisible until multi-memory
`memory.init` could be written at all.

Measured 179 → **214/257 clean, zero regressions** (projection said 216; the
two-file gap is files the scope counted under multi-memory that carry a second
blocker — the "files containing" vs "solo blocker" split predicted this).

Regression: `tests/parser/multi_memory.test.ts` — V8-executed proofs that
named memories are distinct (store 1234/9999 into two memories and read back),
per-memory `memory.size`, cross-memory `memory.copy`, `memory.fill`, both
`memory.init` forms, name resolution (including the unknown-name error),
round-trip with an explicit `memory.init 1 0` operand-order assertion, and all
five SIMD lane disambiguation shapes.

**Remaining: 43 files.** Next is T4 (table64 / memory64 index types, projected
+14). Also newly catalogued while diagnosing: `any.convert_extern` /
`extern.convert_any` (GC conversions, 3 files) and table definitions with an
inline init expression / typed-ref elem type (`(table $t 10 funcref
(ref.null func))`, `(table $t 3 3 (ref i31) …)`).

---

## 2026-08-21 — Tranche 2: small grammar gaps (spec testsuite 145 → 179/257)

Six grammar gaps plus one missing instruction family. Measured 145 → **179/257
clean, zero regressions** — exactly the +34 the scope projected.

1. **Every `table.*` table index is OPTIONAL** (defaults to table 0).
   `table.get/set/size/grow/fill/copy/init` called `parseVar()`
   unconditionally, which REPORTS an error when the next token isn't a var —
   so bare `table.size` and `(table.fill (i32.const 0) …)` failed even though
   the `?? varIndex(0)` fallback produced the right index. Now `parseVarOpt`.
2. **`table.init` transposed its indices.** The text form is
   `table.init $tableidx $elemidx`, and the ONE-var form names the ELEM
   segment — so the two must SWAP when a second var appears (upstream wabt
   documents exactly this). wabt-ts read segment-then-table with no swap, so
   every two-var `table.init` targeted the wrong table AND the wrong segment.
   Silent corruption, not a parse error. Regression test executes both forms
   in V8 against two tables and two elem segments.
3. **`(module quote "a" "b")` concatenates** its text pieces, exactly as
   `(module binary …)` already did via `parseTextList`. The quote branch read
   a single string and choked on the second.
4. **`(either r1 r2)`** alternative results. The `Either` token and upstream's
   `ParseEither` both existed; nothing here ever consumed it, so every
   relaxed-SIMD file failed outright. New `ExpectedConst` variant carrying
   `alternatives`.
5. **`(data (global.get $g) "…")`** — the bare-offset branch required
   `(X.const …)` specifically. Any `(` still present at that point is the
   offset (`(memory …)` / `(offset …)` are handled above and data chunks are
   Text), so the condition is now just `Lpar`. Same shape as the elem
   bare-offset fix.
6. **`(ref struct)` / `(ref array)` / `(ref exn)` in type position.** Those
   keywords have dedicated token types, so `parseValueType`'s `(ref …)` branch
   rejected them. Now routed through `parseHeapTypeVar` — the same canonical
   entry `ref.null` and `ref.test` use.

**Four GC array bulk instructions implemented from scratch** — `array.fill`
(0xfb 0x10), `array.copy` (0x11), `array.init_data` (0x12), `array.init_elem`
(0x13). None existed at any layer. Wired through opcode enum + name map,
TokenType, lexer, IR (`ArrayFillExpr` / `ArrayCopyExpr` /
`ArrayInitSegmentExpr`), expr-visitor, ir-util arity, parser (incl.
`instrInputCount` — fill/init take 4 operands, copy takes 5, and a new
`op4()` helper), resolve-names (`array.copy` resolves BOTH type vars;
`init_data` / `init_elem` resolve their segment against the data vs elem
scope respectively), binary writer, binary reader, validator
(`checkArrayTypeIndex` + `onCall` signatures), and the WAT writer.
`array.copy`'s two type immediates are DESTINATION FIRST in both text and
binary.

V8 execution is not reachable for typed-ref GC code through this path —
`(ref $T)` coarsens to structref in the flat IR — so the tests verify binary
encoding (opcode bytes + resolved immediates) and wasm2wat round-trip,
matching the convention already set by the GC tier tests.

Regression: `tests/parser/t2_grammar.test.ts`.

**Remaining: 78 files. Next is T3 (multi-memory), projected +37 → 216/257.**

---

## 2026-08-21 — Parser robustness + Tranche 1 (spec testsuite 120 → 145/257)

### Robustness: the parser must report, never crash

Mutation-fuzzing the spec testsuite (3598 truncated / bracket-stripped /
quote-stripped variants) found that malformed input could **hang the process
and exhaust memory**, which is worse than the throw originally scoped.

1. **Infinite loops on non-consuming sub-parsers.** `parseValueType` reports an
   error and returns null WITHOUT consuming the offending token. Two loops had
   no progress check, so they appended a list entry plus an error forever:
   the struct-field shorthand loop (`(module (type $s (struct (field i1` →
   OOM) and `select (result …)` (no `break` at all). New private helper
   `noProgress(before, what)` compares `this.pos` and reports the offending
   token; both loops now break on it. **`parseFieldType` cannot return null**
   (it defaults to i32), so only a positional check catches that one — an
   `else break` would not have.
2. **`nan:0x7f_ffff` escaped as a raw `SyntaxError`** from `BigInt()`. The
   NaN-payload branch neither stripped the `_` separators its sibling
   hexfloat/float branches already strip, nor guarded the call. New
   `parseNanPayload()` validates the `0x…` spelling and returns null.
3. **Top-level backstop.** `runParse()` wraps lex+parse for both
   `parseWatModule` and `parseWastScript`; an escaping exception becomes a
   loud `internal parser error: …` entry plus the partial result, so a caller
   feeding untrusted text never needs try/catch. It reports rather than
   swallows — an exception there is a wabt-ts bug.
4. **Diagnostics named their tokens as ordinals.** `<token:163>` came from the
   parser's LOCAL `tokenName` switch falling through; `TOKEN_NAMES` in
   token.ts already covers all 168 members, so the default now delegates to
   `tokenTypeName`. (`TokenType` is a `const enum` — there is no runtime
   reverse mapping, so a new member must be added to that map.)

**Silent-corruption bug found in passing:** the f32 NaN payload mask was
`0x3fffff` (22 bits) instead of `0x7fffff` (23). `f32.const nan:0x400000` —
payload = exactly the quiet bit — masked to zero and emitted `0x7f800000`,
which is **infinity, not a NaN**. `literal.ts`'s `F32_MANTISSA_MASK` already
had it right. Verified against V8.

Regression: `tests/parser/robustness.test.ts` (NaN payload separators +
malformed-payload reporting + the 23-bit mask + a V8 NaN check, the three
former hangs, deeply unbalanced input, and a sweep asserting no testsuite
diagnostic renders a raw ordinal).

### Tranche 1 — numeric literals (+25 files, exactly as projected)

1. **Negative hex integers.** `parseNatText` called `BigInt('-0x7fffffff')`,
   which THROWS: JS accepts a sign only on decimal and a radix prefix only
   unsigned. The old comment claimed the opposite. Now the sign is split off
   any radix-prefixed literal and re-applied. Affected i32/i64 consts, v128
   integer lanes, and invoke arguments.
2. **Hex floats required a `p` exponent.** The grammar makes it optional
   (`hexfloat ::= '0x' hexnum '.'? hexfrac? (('p'|'P') sign? num)?`), so
   `0x1.5` and the `0x0123456789ABCDEF.` form the SIMD files use throughout
   were rejected. Regex relaxed, absent exponent = 2^0, plus a guard so the
   looser pattern does not accept `0x.`.
3. NaN-payload separators — done in the robustness pass above.

Measured 120 → **145/257**, zero regressions; the +25 matches the scope's
projection exactly, and `const.wast` / `simd_splat.wast` (the two former
crashes) are now clean. Regression: `tests/parser/numeric_literals.test.ts`
(V8-executed values, not just parse success).

**Remaining: 112 files. Next tranche is T2 (small grammar), projected +34 →
179/257.** The tranche table below is unchanged apart from T1 being done.

---

## 2026-08-20 — WAST spec-testsuite parse gap: scope of the remaining 137 files

**Status: SCOPED, NOT FIXED.** The working tree is at **120/257 clean** (up from
107 after the v1.3.6 ref-value work). This section scopes the remaining 137.

### Corpus and method

`wasmtk/tests/module/wasm_wast/testsuite-main/` — the real 257-file WebAssembly
spec testsuite. Method: parse every file, cluster the first error, then confirm
each cluster's root cause with a MINIMAL REPRO through the parser rather than
inferring it from the error text. This mattered — four hypotheses read off the
error messages were wrong:

- underscores in numeric literals work fine (they are NOT the cause of the
  "expected i32 constant" cluster)
- `(module quote "…")` works; only the MULTI-string form fails
- relaxed SIMD instructions parse fine; those files fail on `(either …)`
- `noexn` is 0x74, not the 0x68 the hierarchy suggests (already fixed)

A file is counted against a feature when it CONTAINS that syntax, so "solo
blocker" = the file's only detected blocker. **The projections below are
calibrated**: spiking the single highest-value fix (`neg-hex-int`) moved
failures 137 → 121, exactly the 16 files predicted.

### Confirmed root causes

| Feature | Root cause (repro-confirmed) | Files w/ | Solo |
| --- | --- | --- | --- |
| `multi-mem-imm` | optional memory index immediate on load/store, `memory.*`, `data.drop`, SIMD lane ops | 39 | 33 |
| `table-opt-index` | `table.get/set/size/grow/fill/copy/init` require a table var; it is OPTIONAL (folded *and* linear) | 31 | 8 |
| `neg-hex-int` | `parseNatText` calls `BigInt("-0x…")`, which THROWS — JS rejects sign+radix. Its comment claims the opposite | 22 | 16 |
| `quote-multi-text` | `(module quote "a" "b")` — multi-string form; `parseTextList` already exists and is wired for `binary` but not `quote` | 21 | 7 |
| `table-index-type` | `(table $t i64 …)` — index type on tables (`parseLimits` does it for memory only) | 13 | 1 |
| `gc-sub-rec` | `(type (sub …))` / `(rec …)` — GC subtyping + recursive type groups | 12 | 5 |
| `hexfloat-trail-dot` | `0x1.` — hex float, trailing dot, no fraction digits, no exponent | 11 | 6 |
| `data-bare-offset` | `(data (global.get 0) "a")` — bare offset expr; exact parallel of the elem fix already shipped | 10 | 2 |
| `ref-abstract-type` | `(ref struct)` / `(ref array)` in type position — `parseValueType`'s `(ref …)` branch rejects the dedicated-token keywords | 9 | 1 |
| `block-param` | `(block (param i32) (result i32) …)` — multi-value block signatures | 7 | 2 |
| `either-result` | `(either r1 r2)` alternative assert results (upstream has `ParseEither`) | 6 | 6 |
| `module-definition` | `(module definition …)` / `(module instance …)` — multi-module linking | 5 | 0 |
| `array-bulk` | `array.copy` / `fill` / `init_data` / `init_elem` | 4 | 2 |
| `elem-typed-reftype` | `(elem … (ref $t) …)` / `(ref 1)` elem types | 4 | 1 |
| `nan-payload-uscore` | `nan:0x7f_ffff` — payload parser skips underscore stripping AND **throws a raw SyntaxError** out of the parser | 4 | 0 |
| `memory-index-type` | `(memory i64 (data …))` | 4 | 1 |
| `annotations` | `(@name …)` custom annotations | 1 | 0 |
| `table-inline-elem` | `(table $t funcref (elem (ref.func $f)))` | 1 | 0 |
| *(select.wast)* | `select (result i32) (result)` — EMPTY `(result)` annotation | 1 | 0 |

91 of the 137 files have a single blocker; 46 need a combination.

### Recommended tranches (cumulative, calibrated projection)

| Tranche | Contents | +files | Running total |
| --- | --- | --- | --- |
| **T1 literals** | `neg-hex-int`, `hexfloat-trail-dot`, `nan-payload-uscore` | +25 | **145/257** |
| **T2 small grammar** | `table-opt-index`, `quote-multi-text`, `either-result`, `data-bare-offset`, `array-bulk`, `ref-abstract-type` | +34 | **179/257** |
| **T3 multi-memory** | memory-index immediate across IR + parser + reader/writer + validator + WAT writer + bridge | +37 | **216/257** |
| **T4 i64 index types** | `table-index-type`, `memory-index-type` | +14 | **230/257** |
| **T5 GC sub/rec** | `(sub …)` / `(rec …)` + type-section encoding + validator subtyping | +9 | **239/257** |
| **T6 structural** | `block-param`, `elem-typed-reftype`, `table-inline-elem`, `module-definition`, `annotations` | +17 | **256/257** |

Ordering rationale: T1 and T2 are contained fixes (literal parsing and single
grammar productions) returning 59 files for far less work than T3. T3 is the
biggest single win but is a genuine cross-cutting feature — the memory index
has to reach the IR and every consumer, so it should not be started until the
cheap tranches are banked. T5 and T6 are proposal-scale features.

### Two robustness bugs worth fixing regardless of tranche

1. **The parser THROWS on malformed input.** `nan:0x7f_ffff` escapes as a raw
   `SyntaxError` from `BigInt()` (const.wast, simd_splat.wast). A parser must
   report an error, never crash the caller. Same underlying call as
   `neg-hex-int`, so T1 fixes both — but audit `parseNatText`'s other callers
   for the same pattern.
2. **`tokenName()` renders unnamed tokens as `<token:163>`.** Every diagnostic
   in this survey had to be post-processed through the `TokenType` enum to be
   readable. Fill in the name map (or fall back to `TokenType[n]`).

---

## 2026-06-09 — Silent-corruption audit (two rounds, unreleased)

A two-pass fail-loud audit (6 + 4 parallel review agents) of the whole `src/` tree for workarounds,
silent-wrong-output bugs, fallthroughs, and dead code. ~18 root-cause fixes landed in the working
tree (deno.json is at v1.3.2; these fixes are not yet committed/bumped/published). Full invariant list with rationale is
in [design-decisions.md](design-decisions.md) (sections "2026-06-09 silent-corruption audit" +
"Round 2"); regressions in `tests/audit/silent_corruption_fixes*.test.ts`. Suite 131 → **146 tests
/ 1044 steps**, all green; lint + fmt clean; the 272-file wasmtk corpus still passes (it now flows
through the fail-loud `writeVar`).

**Round 1 — Critical+High:** SIMD float opcode values in the lexer realigned to `opcode.ts` (div/
ceil/min/pmin/… were shifted; f64x2 pmin/pmax collided with the convert ops); tag type index
resolved from signature instead of hardcoded 0 (writer + validator) **and** the binary reader's
tag-import decode now consumes the attribute byte before the type index (bonus bug a round-trip test
surfaced — every imported tag had resolved to type 0); v128.store/loadN_splat decode split
(0x0b was decoded as load_zero, dropping an operand); `resolveNames` resolves `call_ref`/
`return_call_ref` `sigType`; `trunc_sat` routed through `getMiscOpcodeTypeInfo` (was validated as
v128); multi-`catch` body assignment; SIMD lane-op validation + `replace_lane` arity; deleted the
duplicate `naturalAlignForOpcode` in the WAT writer; `applyNames` no longer rewrites `local.get`
through `funcNames`; `Table.init` resolved + emitted (0x40 form).

**Round 2 (completeness sweep) — more of the same class:** `decodeSimdOp` operand arity is now
per-opcode (`SIMD_UNARY_OPS` set + `v128.bitselect`→ternary; everything else binary) — the old code
popped 2 for every arith op, corrupting all unary SIMD; **the lane load/store ranges were also
wrong** (load_lane `0x54-0x57`, store_lane `0x58-0x5b`; the old code used `0x54-0x5b` for load and
`0x5e-0x61`, which are unary demote/promote/abs/neg, for store). `writeVar` is now FAIL-LOUD on a
name-var (the root of the Bug-G family). `resolveNames` closed three more leaks: `simd_lane_op.value`
(replace_lane scalar), `elemSegment.tableVar`, `dataSegment.memoryVar`. `parseLimits` detects the
`i64`/`i32` index type (memory64 from text was always `is64:false` — it matched the nonsense
`i64x2` SIMD token). `try_table` fails loud on an unknown catch-kind byte instead of desyncing.
Dead code removed: `WastParser.ok()`, `TypeEntry.tailcallTarget?`, five unused `WatWriter`
`*Imports` fields.

**Known-open / deliberately deferred:** relaxed-SIMD ternary decode (blocked by the `(prefix<<8)|sub`
opcode-encoding collision for sub ≥ 0x100); table64-from-text (index type precedes the reftype);
`writeMemArg`'s inline `:0` for a named multi-memory memidx; and the round-1 Medium/Low items not yet
swept (`parseNatText` multi-underscore, `assert_trap (module)` mislabel, `wabt-compat`
`write_debug_names` ignored, `wasm-objdump -h` no-op).

---

## Phase Status Overview

| Phase | Scope | Status |
| --- | --- | --- |
| **1** | Core Infrastructure | ✅ Complete |
| **2** | IR Layer | ✅ Complete |
| **3** | Binary Round-trip | ✅ Complete |
| **4** | WAT Text Format | ✅ Complete |
| **5** | Validator | ✅ Complete |
| **6** | CLI Tool Wrappers | ✅ Complete |
| **6.1** | Pre-publish housekeeping (JSR/CI hardening + lint + perf invariants) | ✅ Complete |
| **6.2** | Release-flow alignment with binaryen-ts (bump task, atomic publish, license fix) | ✅ Complete |
| **7** | binaryen Bridge | 🟡 In progress (Tiers A+B+C+D + all 4 GC tiers complete; remaining gaps are upstream binaryen-ts or the deferred typed-ref IR refactor) |
| **8** | wasm2ts (new) | ⬜ Not started — deferred pending wasmtk QA/QC |

## Out of Scope — wabt Components Not Ported

These wabt components were evaluated and explicitly excluded. Do not add them
without revisiting the decisions below.

| Component | wabt source | Reason excluded |
| --- | --- | --- |
| Interpreter (`wasm-interp`) | `src/interp/` | Deno/Bun have native V8/JSC wasm JIT — 10–50× faster |
| Spec test runner (`spectest-interp`) | `src/tools/spectest-interp.cc` | Only useful alongside the interpreter |
| C code generator (`wasm2c`) | `src/c-writer.cc` | Wrong target; `wasm2ts` is the TS-target equivalent |
| Linker (`wasm-link`) | `src/tools/wasm-link.cc` | wasmtk handles this via wasmbundler |
| Decompiler (`wasm-decompiler`) | `src/decompiler.cc` | Not needed for the wasmtk toolchain |
| Fuzzing harnesses | `fuzzers/` | Development tooling for the C++ project only |

## In Scope — wabt Components Being Ported

| Component | Purpose | Phase | Status |
| --- | --- | --- | --- |
| `wat2wasm` | WAT text → wasm binary | Phase 4 (parser) + Phase 6 (CLI) | ✅ Complete |
| `wasm2wat` | wasm binary → WAT text | Phase 4 (writer) + Phase 6 (CLI) | ✅ Complete |
| `wasm-validate` | Validate wasm binary with structured errors | Phase 5 (validator) + Phase 6 (CLI) | ✅ Complete |
| `wasm-objdump` | Inspect sections, imports, exports | Phase 6 (CLI) | ✅ Complete |
| `wasm-strip` | Strip name/debug sections from binary | Phase 6 (CLI) | ✅ Complete |
| `wasm2ts` | Transpile wasm → typed TypeScript (new) | Phase 8 + Phase 6 (CLI) | ⬜ Deferred |

---

## Decisions Log

Decisions are recorded here when made. The context behind each matters
more than the rule — if priorities change, revisit the WHY before changing course.

### JSR scope: `@jrmarcum/wabt-ts`
**Date:** 2026-05-21
**Decision:** Use the personal scope `@jrmarcum/wabt-ts` on JSR, matching the GitHub
remote (`github.com/jrmarcum/wabt-ts`).
**Why:** Simpler to publish without creating a separate org scope; if wasmtk grows
into a formal org, the package can be transferred later.
**Affects:** `deno.json`, `README.md`, all import examples.

### Provenance publishing via GitHub Actions

**Date:** 2026-05-21
**Decision:** `.github/workflows/publish.yml` publishes on `v*` tag push with `--provenance`.
**Why:** JSR requires OIDC provenance (`id-token: write`) for attestation; workflow
type-checks and runs tests before publishing.
**Affects:** `.github/workflows/publish.yml`.

### Tag-driven publish — `deno task publish` must not call `deno publish` directly

**Date:** 2026-05-25
**Decision:** `deno task publish` runs `scripts/publish.ts`, which creates and pushes
a `v<version>` tag. The actual `deno publish` invocation lives inside the GitHub
Actions workflow at `.github/workflows/publish.yml`, never in a task that could be
invoked locally. `deno task publish:dry` (which runs `deno publish --dry-run --allow-dirty`)
is the only `deno publish` invocation safe to run from a workstation.
**Why:** JSR provenance requires the GitHub Actions OIDC token. A local
`deno publish` would succeed but produce a release with no provenance, breaking
the chain for that version. The earlier task definition (`"publish": "deno publish"`,
mirrored from binaryen-ts) had this footgun; the script makes the safe path the
default.
**Affects:** `scripts/publish.ts`, `deno.json` (`tasks.publish`, `tasks.publish:dry`),
`.github/workflows/publish.yml` (calls `deno publish` directly, not `deno task publish`).

### CI workflow: lint + fmt + check + test + publish dry-run on every push/PR

**Date:** 2026-05-25
**Decision:** `.github/workflows/ci.yml` runs `deno fmt --check`, `deno lint`,
`deno task check`, `deno task test`, and `deno publish --dry-run --allow-dirty`
on every push and pull request to `main`. Mirrors the binaryen-ts setup.
**Why:** Catch lint regressions, formatting drift, type errors, and JSR manifest
breakage before they land. The publish dry-run validates the same slow-types
lint and include/exclude manifest that the real publish workflow will check —
no surprises on tag push.
**Affects:** `.github/workflows/ci.yml`.

### Text codecs are module-level singletons in hot-path files

**Date:** 2026-05-25
**Decision:** `TextEncoder` and `TextDecoder` are constructed once at module
scope in `src/writer/stream.ts`, `src/writer/wat-writer.ts`,
`src/reader/binary-reader.ts`, and `src/parser/lexer-source.ts`. Per-call
instantiation is forbidden in those files.
**Why:** `TextEncoder` / `TextDecoder` are stateless under `.encode()` /
`.decode()`, but their constructors are non-trivial in V8. They were previously
being allocated per import name, per quoted string, per name-section entry, and
per `sliceText()` call — all hot paths during wat2wasm / wasm2wat on large
modules.
**Affects:** the four files above; new code in them must reuse the file-level
`TEXT_ENCODER` / `TEXT_DECODER` constant.

### `ModuleContext` pre-computes function and tag arity index maps

**Date:** 2026-05-25
**Decision:** `ModuleContext` constructor builds `funcSigsByIndex: FuncSignature[]`
and `tagArityByIndex: number[]`, populated in a single pass over imports + defs.
`getFuncSig` and `getTagArity` are O(1) indexed reads.
**Why:** The previous implementation walked `module.imports` linearly on every
lookup. `getExprArity` calls these for every `call`/`call_ref`/`throw`/`return_call`
expression during validator and writer walks, so the cost compounded with both
function count and module size. The flat index space (imports first, then
defined funcs/tags) matches the convention `idx < numFuncImports` already
encoded the same way.
**Affects:** `src/ir/ir-util.ts` — `ModuleContext` constructor, `getFuncSig`,
`getTagArity`.

### `WatWriter` pre-computes `nameIndexMap` for `resolveVarIndex`

**Date:** 2026-05-25
**Decision:** `WatWriter` constructor builds a `Map<string, number>` keyed by
`"kind:name"`, populated in a single pass over imports + defs by kind.
`resolveVarIndex` is an O(1) `Map.get` for name-based Vars (index-based Vars
return the raw `v.value` as before).
**Why:** The previous implementation did two linear scans (imports, then defs)
per call. `buildExportMap` and `writeExport`'s `isInlineExport` each call it
once per export, so the cost grew quadratically on modules with many name-based
exports.
**Affects:** `src/writer/wat-writer.ts` — `WatWriter` constructor,
`buildNameIndexMap`, `resolveVarIndex`.

### Lint cleanup: switch `ValidateOptions` from `interface` to `type`

**Date:** 2026-05-25
**Decision:** `export interface ValidateOptions {}` became
`export type ValidateOptions = Record<string, never>`.
**Why:** Deno's `no-empty-interface` rule only fires on empty `interface`
declarations, not on type aliases. The placeholder is kept for future feature
flags; switching to a type alias preserves the intent without disabling the
lint rule globally.
**Affects:** `src/validator/shared-validator.ts:20`.

### Release flow: `deno task bump` + atomic publish (mirrors binaryen-ts)

**Date:** 2026-05-25
**Decision:** Adopt binaryen-ts's release ergonomics — `scripts/version.ts` +
`scripts/bump_version.ts` + `scripts/publish.ts` with sub-version-capped-at-9
versioning (`1.0.9 → 1.1.0`, `1.9.9 → 2.0.0`; major uncapped). `deno task bump`
rewrites `deno.json`; `deno task publish` stages, commits, force-tags locally,
and pushes commit + tag atomically (`git push origin main vX.Y.Z`).
**Why:** Same rule + same flow keeps the two sibling projects in lockstep so a
contributor familiar with one can release the other without re-learning. The
atomic push avoids races with `auto-tag.yml` (it sees the tag already exists
and no-ops).
**Affects:** `scripts/version.ts`, `scripts/bump_version.ts`, `scripts/publish.ts`,
`deno.json` (`tasks.bump`, `tasks.publish`).

### `auto-tag.yml` safety-net workflow

**Date:** 2026-05-25
**Decision:** A new workflow auto-creates `vX.Y.Z` when it detects a `deno.json`
version bump on `main` without a corresponding tag, then explicitly dispatches
`publish.yml` on that tag.
**Why:** Catches the case where someone bumps and commits manually without
going through `deno task publish`. The explicit `gh workflow run` dispatch is
required because GitHub's recursion guard prevents `GITHUB_TOKEN`-authored
pushes from auto-firing workflows.
**Affects:** `.github/workflows/auto-tag.yml`.

### CI publish step calls `deno publish` directly, not `deno task publish`

**Date:** 2026-05-25 (lesson recorded; the workflow already did this)
**Decision:** `.github/workflows/publish.yml` invokes `deno publish` directly.
The `deno task publish` indirection is reserved for local use by
`scripts/publish.ts`.
**Why:** `deno task publish` runs the script, which would spawn
`deno publish` as a subprocess via `Deno.Command`. JSR's OIDC token detection
runs in the workflow's primary process and does not propagate cleanly through
the subprocess, so a CI publish via the task ends up flagged "No provenance".
binaryen-ts learned this the hard way at v1.0.6/v1.0.7 — calling out the
constraint here so it does not regress.
**Affects:** `.github/workflows/publish.yml` — the "Publish to JSR" step.

### JSR license: declare `MIT`, not the compound `MIT OR Apache-2.0`

**Date:** 2026-05-25
**Decision:** `deno.json` and `package.json` declare `"license": "MIT"`. The
`LICENSE` file contains the full MIT License text plus a trailing pointer to
`LICENSE-APACHE` for the alternative. `LICENSE-MIT` and `LICENSE-APACHE`
remain as separate full-text files for downstream consumers who need
Apache-2.0.
**Why:** JSR's license detector rejects compound SPDX expressions and tries
to match `LICENSE` against the SPDX template for whatever is declared. The
v1.0.2 publish failed with "license ... was not recognized" because the field
was `"MIT OR Apache-2.0"` (a valid SPDX expression, but not a recognized
single identifier on JSR) and `LICENSE` was a dual-license notice that did
not match either SPDX template. Switching to MIT-declared + Apache-shipped
matches sibling binaryen-ts.
**Affects:** `LICENSE`, `deno.json`, `package.json`, `CLAUDE.md` license section.

### WAT parser fold-form fix + local-scope wiring

**Date:** 2026-05-25
**Decision:** Reproduced and fixed two related WAT-parser bugs that made
folded-form WAT (the most common authoring style, used pervasively by
wasmtk's wasic) fail to parse. wasmtk reported the blocker against
v1.0.3: all 270 of its tests failed because `(local.set $ptr (global.get
$heap))` and similar patterns errored out with "expected ), got (".
**Why this matters:** folded form is canonical WAT and any real WAT input
will use it. Without this fix wabt-ts cannot replace the compiled wabt
binary that wasmtk currently shells out to.

**Two underlying bugs, both in `src/parser/wast-parser.ts`:**

1. **`parseFoldedInstr` ran the sub-expression loop BEFORE consuming
   immediates.** WAT fold-form is `( opcode immediate-args
   folded-sub-expr* )` — immediates come first in the token stream. The
   sub-expression loop was gated on `peekIsInstr`, which returns false
   for `Var` / `Nat` / etc., so the loop exited zero-iterations whenever
   an immediate was present. `buildPlainExpr` then consumed the
   immediate but had no operand to plug into the operand slot, leaving
   the next `(` as an unexpected token.
   Fix: dry-run `buildPlainExpr` with empty operands to advance past
   the immediates (errors suppressed so they're not double-reported),
   loop over `(`-prefixed sub-expressions into `innerCtx`, then rewind
   to the immediate position and re-invoke `buildPlainExpr` with the
   real operands. Forward past the already-parsed sub-expressions
   after the second invocation. Two `buildPlainExpr` calls per folded
   instr, cheap.

2. **Function-local names were silently discarded.** The parser had
   `parseFuncSignature` return `{ sig, bindings }` (params name →
   slot index) but every caller destructured only `sig`. The
   `(local $name type)` form skipped the name entirely with
   `this.drop()`. The `Func` IR has no field for param/local names,
   so `local.get $name` carried an unresolved name-var that
   `resolveNames` couldn't resolve (its `localScope` was always
   empty — populated to a fresh `NameScope()` per function but never
   filled in).
   Fix: `parseFuncModuleField` now builds a combined
   `Map<string, number>` of param-name + local-name → slot index (with
   the `$` prefix to match `parseParams`'s convention), stashes it on
   the parser as `this.localScope` for the duration of the function
   body, and the `local.get` / `local.set` / `local.tee` cases in
   `buildPlainExpr` call a new `resolveLocal(v)` helper that converts
   name-vars to index-vars when in scope.

**Affects:** `src/parser/wast-parser.ts` only (no IR shape change).
Regression coverage in `tests/parser/folded.test.ts` (7 tests, including
the exact wasmtk repro and the full heap-allocator pattern). Full suite:
91 passing.

**Open follow-up:** the `resolveNames` pass at
`src/ir/resolve-names.ts` still populates an empty `localScope` per
function (the populator was never written). The parser-side fix means
this dead code is no longer load-bearing for the WAT-source path, but
it remains a bug for any IR that comes from another source (binary
reader, manual construction) and uses name-vars in local refs. Worth
fixing in a follow-up; for now, the parser short-circuits the issue
for WAT input.

### Latent wabt-ts bugs surfaced by Phase 7 bridge work + wasmtk integration

**Date:** 2026-05-25 (recurring pattern)
**Decision:** Eight pre-existing wabt-ts bugs were caught and fixed across
the v1.0.4 → v1.0.7 release window. Each one was latent in `main` and only
fired when modules combined features no existing test had exercised.

**Why this matters:** the bridge is a powerful integration test for the
whole wabt-ts pipeline (WAT parser → IR → bridge → binaryen-ts encoder →
wabt-ts reader → wabt-ts validator). Round-tripping a single small module
exercises every link of that chain. wasmtk feeding wabt-ts real-world WAT
(its 270-test wasic suite) is an even stronger probe. The pattern is:
**a new module shape that the test suite hadn't covered surfaces a bug;
investigate and fix at the root cause in `src/` rather than working around
in the bridge.**

**Bugs caught + fixed (chronological):**

1. **`readCodeSection` off-by-one** (Phase 7 MVP).
   `src/reader/binary-reader.ts` used `m.funcs[funcBase + i]` with
   `funcBase = m.numFuncImports`. But `m.funcs` is the array of DEFINED
   funcs only (imports live in `m.imports`); the index space already
   starts at 0. Fixed to `m.funcs[i]`. No prior test combined imports +
   defined funcs.

2. **`Load` / `AtomicLoad` arity** (Phase 7 Tier B).
   `src/parser/wast-parser.ts` `instrInputCount` listed `Load` and
   `AtomicLoad` at arity 2 alongside `Binary` / `Compare` / `Store`. They
   are arity 1 (single operand: the address). The phantom second operand
   popped the real address off the parser's stack as a Nop. Moved both
   into a dedicated arity-1 case. No prior test used linear-form
   (non-folded) `local.get N i32.load`.

3. **`readTableSection` extension peek**
   (Phase 7 Tier B).
   `src/reader/binary-reader.ts` peeked a byte AFTER the reftype to
   detect a "table with init expression" extension. The reference-types
   proposal actually puts a `0x40` tag BEFORE the reftype, not a flag
   after. The misplaced peek treated the limits flag (`0x01` for
   "has-max") as a hasInit indicator, corrupting all following section
   reads with phantom "else outside if" errors at arbitrary offsets.
   Fixed to look for `0x40` first; remaining path is the simple
   `reftype limits` form. No prior test had a non-imported `(table N
   funcref)` with explicit max.

4. **Folded WAT — immediates parsed after sub-expressions**
   (v1.0.4, reported by wasmtk).
   `src/parser/wast-parser.ts` `parseFoldedInstr` ran the sub-expr loop
   first, then `buildPlainExpr` (which consumes the opcode's immediates
   like `$ptr` for `local.set`). The loop's `peekIsInstr` returned false
   for the immediate token, so the loop exited with zero operands and
   the next `(` showed up as an unexpected token. wasmtk's
   `(local.set $ptr (global.get $heap))` failed, blocking 270/270
   tests. Fix: dry-run buildPlainExpr first to advance past immediates,
   then loop over sub-expressions, then rewind and re-invoke with the
   real operands. Regression test:
   `tests/parser/folded.test.ts`.

5. **Function-local names silently discarded**
   (v1.0.4, surfaced alongside #4).
   `src/parser/wast-parser.ts` had `parseFuncSignature` return a
   bindings map for param names but every caller destructured only the
   sig. `(local $name type)` skipped the name with `this.drop()`. With
   no scope populated, `local.get $name` produced an unresolved
   name-var that the bridge / binary writer couldn't disambiguate from
   a globally-scoped name. Fix: parser builds a per-function
   `localScope` map (params + named locals) and resolves
   `local.get` / `local.set` / `local.tee` name-vars to index-vars at
   parse time. Regression test:
   `tests/parser/folded.test.ts` ("local names with `$` prefix bind
   correctly for both params and locals").

6. **`flushStack` reversed sub-expression order**
   (v1.0.5, reported by wasmtk).
   `src/parser/wast-parser.ts` `flushStack` popped stack values LIFO into
   `stmts`, reversing the order. Invisible for single-result blocks but
   produced swapped operands in folded form:
   `(i32.sub (local.get $a) (local.get $b))` emitted `i32.sub b a`.
   Commutative for `i32.add` (silent failure), wrong for `i32.sub` /
   `i32.div_s` / etc. Fix: forward iteration into `stmts`. Regression
   test: `tests/tools/wat2wasm.test.ts`
   ("preserves operand order in folded binary expressions" + the
   non-commutative coverage).

7. **No type-section synthesis from inline signatures**
   (v1.0.5, reported by wasmtk).
   The WAT parser stored inline `(param ...) (result ...)` on
   `Func.sig` / `Tag.sig` / `Import.func.sig` / `Import.tag.sig` but
   never back-filled `module.types`. The binary writer's function +
   import sections emitted type-index references, so the resulting
   binary had a function-section entry pointing at type 0 with no type
   entries — binaryen reported `invalid type index 0 / 0`. Fix: new
   `src/ir/synthesize-types.ts` pass that walks all sig-bearing items
   and appends missing type entries. Called from `wat2wasm.ts` after
   `resolveNames`, before `writeBinaryIr`. Regression test:
   `tests/tools/wat2wasm.test.ts` ("synthesizes a type section…").

8. **`resolveNames` default case didn't recurse into operand children**
   (v1.0.6, reported by wasmtk).
   `src/ir/resolve-names.ts` `resolveExpr`'s default case
   `return [Result.Ok, e]` silently dropped every sub-expression for
   any expression kind not explicitly listed (drop, select, binary,
   unary, compare, convert, loads, stores, atomics, simd, memory.copy
   / fill, table.get / set / grow / fill, ref.is_null, br_on_*,
   throw_ref, return, ternary, quaternary, memory.grow). Inside those
   kinds, nested `call $name` / `ref.func $name` / `local.get $name`
   kept their name vars; the binary writer fell back to "index 0"
   because there was no other fallback. wasmtk hit this with
   `(select (call $__malloc ...) ...)` in cabi_realloc: `$__malloc`
   is absolute index 2 but the call was emitted as index 0
   (`$proc_exit`). Fix: ~20 explicit recursive cases added for every
   kind with Expr children; default is now reserved for true leaves
   (`nop`, `unreachable`, `const`, `memory.size`, `ref.null`,
   `atomic_fence`, `rethrow`, `code_metadata`). Regression tests:
   `tests/tools/wat2wasm.test.ts`
   ("resolves call \$name nested inside drop / select", + drop-only).

9. **`parseTagModuleField` missing inline-export loop**
   (v1.0.7+, reported by wasmtk Phase 3 work).
   `src/parser/wast-parser.ts` `parseTagModuleField` parsed
   `(tag $name ...)` without the `while (this.matchLpar(TokenType.Export))`
   loop that every sibling field parser (func / global / memory / table)
   carried, so `(tag $exn (export "exn") (param i32 i32))` failed with
   "expected ), got (" when the parser hit the inline export's `(`.
   wasic emits this shape for every exception tag export — any wasmtk
   file using `try`/`catch`/`throw` would fail to parse. Fix: copied the
   inline-exports block from `parseGlobalModuleField` verbatim, computing
   `tagIdx = numTagImports + tags.length` and pushing
   `{ kind: ExternalKind.Tag, var: varIndex(tagIdx) }` exports before
   parsing the optional inline import. Regression coverage:
   `tests/parser/wast-parser.test.ts` "parseWatModule — tags" (4 tests:
   plain tag, single inline export, multiple inline exports, import).

10. **SIMD opcode-name table had stale opcode values**
    (v1.0.9, surfaced by Phase 7 Tier C SIMD memory-op work).
    `src/core/opcode.ts` `EXTENDED_OPCODE_NAMES` mapped
    `v128.bitselect` / `v128.any_true` to 0xfd58 / 0xfd59 and
    `v128.store{8,16,32,64}_lane` to 0xfd5e-0x61 (an older draft
    encoding). The lexer was already spec-correct (bitselect=0xfd52,
    store8_lane=0xfd58, etc.), so the WAT parser produced spec-correct
    opcodes — but `anyOpcodeName(0xfd58)` returned `"v128.bitselect"`
    instead of `"v128.store8_lane"`. Any consumer that round-tripped
    SIMD opcodes through a name lookup (the binaryen bridge does this
    when calling `makeSIMDLoadStoreLane`) got the wrong instruction
    encoded. The duplicate keys at 0x60/0x61 (store32/64_lane vs.
    i8x16.abs/neg) compounded the bug — Map.get returned whichever
    entry was inserted later. Initial fix (v1.0.9): replaced the four
    bad bitselect/any_true/store_lane entries with the spec values;
    added the missing `v128.store` (0x0b) and `v128.const` (0x0c)
    entries that the lexer already used. Superseded by the comprehensive
    audit-driven regeneration in bug #14 below. Regression coverage:
    `tests/bridge/tier_c.test.ts` "v128.store8_lane" round-trip.

11. **f64/f32 const integer literals encoded as raw bit patterns**
    (v1.1.0, reported by wasmtk worker-pools). `parseFloatBits` and
    `parseFloatLiteralBits` in `src/parser/wast-parser.ts` treated
    `f64.const 1` as bit pattern `0x0000000000000001` instead of value
    `1.0`. Result: `1` → smallest positive subnormal (5e-324), `10` →
    5e-323, `100` → 4.94e-322, etc. Every f64 program silently broke
    because comparisons against integer literals became comparisons
    against tiny subnormals and loop counters never advanced past 0.
    Second bug in the same function: f64 bits reassembled as
    `(hi * 2^32) + lo` lost precision above 2^53 (any negative f64 or
    large-mantissa value drifted ~3e-12 from spec). Fix: split into
    width-specific helpers — `parseF32Bits` (returns `number`) and
    `parseF64Bits` (returns `bigint`). Integer literals are routed
    through `setFloat32` / `setFloat64`; NaN-with-payload encoding
    honors the sign bit. Module-level `F32_BUF` / `F64_BUF` DataViews
    avoid per-call allocation. Regression: `tests/tools/wat2wasm.test.ts`
    ("f64.const integer literals are float values, not raw bit
    patterns", "f32.const integer literals…").

12. **Multi-value `return` dropped all but the first operand**
    (v1.1.1, reported by wasmtk regex helpers). `ReturnExpr` stored
    `value?: Expr` and `parseLinearPlainInstr` captured only
    `operands[0]` for the variable-arity `Return` token. A function
    declared `(result i32 i32)` with `(return (i32.const 10)
    (i32.const 20))` emitted bytes for only the first value, and V8
    rejected the binary as missing operands. Implicit-return form (just
    leaving N values on the stack at function end, no `return` keyword)
    was unaffected because it bypasses `ReturnExpr` entirely. Fix:
    `ReturnExpr.value?: Expr` → `ReturnExpr.values: Expr[]`. Parser
    captures the full `operands` array. Expr-visitor dispatches each
    child in stack order before `onReturnExpr`. Binary reader pops
    `funcResultCount` values via `popN`. Bridge handles 0/1 values
    directly; multi-value throws with a "needs binaryen-ts
    makeTupleMake" message. apply-names / resolve-names walk the array.
    Regression: 5 tests in `tests/tools/wat2wasm.test.ts` (folded
    multi-value, unfolded multi-value, mixed i32+i64, single-value
    guard, void guard).

13. **`memarg.align` defaulted to byte 0 instead of opcode-natural**
    (v1.1.1, reported by wasmtk 1_StaticGlobalInitialization /
    1_recursion / 1_WasiStringBufferIntegrity). The parser stores
    `align = 0` as a "no explicit `align=N`" sentinel, but
    `writeMemArg` in `src/writer/binary-writer.ts` wrote the raw byte
    value as if it were the LEB exponent. Every memory op without an
    explicit alignment encoded `align byte = 0` (1-byte alignment). V8
    accepted the binary, but binaryen's optimizer reads the alignment
    field as a hard constraint and refuses some rewrites — producing
    out-of-bounds memory accesses and "Invalid typed array length: 1"
    crashes on optimized output. Fix: new
    `naturalAlignForOpcode(op)` helper in `src/core/opcode.ts`
    covers core loads/stores + SIMD memory + atomics (~80 entries);
    `writeMemArg` now takes the opcode, resolves natural when
    `align = 0`, then `Math.log2`-encodes. Bridge's
    `alignBytesToExponent` had the same "0 → exponent 0" bug and got
    the same fix. Regression: 2 tests in
    `tests/tools/wat2wasm.test.ts` ("memory ops default to natural
    alignment when align= is omitted", "explicit align=N keyword
    still log2-encodes correctly").

14. **`EXTENDED_OPCODE_NAMES` had massive SIMD drift**
    (v1.1.1, surfaced by Phase 7 Tier C bridge work). ~95 SIMD entries
    were at wrong positions (i64x2 compares listed at 0x41-0x46
    instead of spec 0xd6-0xdb), ~30 were missing entirely (extmul,
    extend_low/high families), and the relaxed-SIMD entries were
    written as `| 0x100+` that silently collided via JS bitwise OR
    truncation with low SIMD opcodes. The lexer was always
    spec-correct; only the name lookup was wrong. Bridge surfaced it
    because `anyOpcodeName()` is used for name-based factory dispatch
    into binaryen-ts (e.g. for `makeSIMDLoadStoreLane`). Fix:
    regenerated the SIMD section from upstream wabt `opcode.def` via
    new `scripts/gen_simd_opcode_table.ts`; added the missing 0xfc
    MISC entries (memory.copy/fill/init, table.copy/init/grow/size/fill,
    elem.drop, data.drop, i64.add128/sub128/mul_wide_s/u).
    Relaxed-SIMD opcodes ≥ 0x100 are documented as unsupported by the
    16-bit `(prefix << 8) | byte` key scheme (LEB128 encoding required;
    separate todo if a consumer needs them). New
    `scripts/audit_opcodes.ts` diffs against upstream and exits
    non-zero on any mismatch — wire into CI to catch future drift.

15. **SIMD `*.replace_lane` dropped the scalar operand**
    (v1.1.3, surfaced by Phase 7 Tier C bridge work, then verified by
    the wasmtk WAT corpus integration). `SimdLaneOpExpr` only had an
    `operand` field (the vec); the parser captured `operand: op0()`
    for every SIMD lane op including the six replace_lane variants
    (`i8x16/i16x8/i32x4/i64x2/f32x4/f64x2.replace_lane`), silently
    dropping the scalar replacement value. V8 rejected the resulting
    binaries as missing operands. Fix: added optional `value?: Expr`
    to `SimdLaneOpExpr` (set for replace_lane, undefined for
    extract_lane). Parser dispatches arity per-opcode via new
    `instrInputCountForTok` + `isReplaceLaneOpcode` helpers. Binary
    reader pops two operands for replace_lane (vec then scalar).
    `expr-visitor` dispatches the second operand when present.
    Bridge uses `makeSIMDReplace` for replace and `makeSIMDExtract`
    for extract. Regression coverage: 3 tests in
    `tests/bridge/tier_c.test.ts` (i32x4 / i8x16 / f64x2 replace_lane).

16. **`try_table (catch ...)` clauses dropped silently**
    (v1.1.3, surfaced by Phase 7 EH bridge work). The WAT parser's
    `parseFoldedInstr` TryTable branch coerced every `try_table` to
    a plain `BlockExpr` and rejected `(catch ...)` clauses with
    "expected ), got (". Fix: split the Try (legacy) and TryTable
    (new EH proposal) cases. New TryTable parses up to N catch
    clauses (`catch` / `catch_ref` / `catch_all` / `catch_all_ref`)
    before the body via `parseTryTableCatch`, building `TableCatch[]`
    entries on a real `TryTableExpr`. Helper `isCatchKeyword`
    identifies the four catch tokens. Single-catch and single-
    catch_all forms round-trip through bridge → encoder → V8;
    multi-catch and catch_ref tests deferred on a V8 / binaryen-ts
    encoder quirk in catch-block-type computation. Regression
    coverage: 2 tests in `tests/bridge/tier_c.test.ts`.

17. **Bare-offset `(elem (i32.const N) $f1 $f2)` form rejected**
    (v1.1.3, surfaced by the wasmtk WAT corpus). `parseElemModuleField`
    handled `(elem (table $t) (offset ...) ...)` and
    `(elem $name (offset ...) ...)` and `(elem declare ...)` but had
    no fallthrough for the standalone bare-offset form where the
    parenthesized expression after `elem` is the offset directly
    (table 0 implicit, active segment). The parser fell through to
    the elem-list parsing and choked on the `(i32.const ...)` as
    "expected ), got (". wasic emits this shape for every active
    table segment — 38 files in the corpus were affected. Fix:
    added a `peek() === Lpar && peek(1) !== Item` branch that
    invokes `parseOffsetExpr` and sets `kind = 'active'`. Regression
    coverage: `tests/wasmtk/runner.test.ts` (all 38 previously
    failing files now compile).

18. **Legacy `(try (do ...) (catch ...) (delegate ...))` syntax rejected**
    (v1.1.3, surfaced by the wasmtk WAT corpus 15_* exception tests
    and `18_Multi-ScopeScaleAndMemoryLongevityTest`). The old EH
    proposal wraps the protected body in `(do ...)` and uses
    `(catch $tag ...)` / `(catch_all ...)` / `(delegate $target)`
    sub-blocks; the previous stub called `parseInstrList` directly
    on whatever followed the block type, which choked on `(do`.
    Wasic still emits this form alongside try_table. Fix: parse
    each sub-block, consume tag/target vars where applicable, fold
    all instructions into a single body. Dispatch semantics are not
    modeled (legacy try is superseded by try_table), but the lexer
    advances correctly so the rest of the module parses. New
    helper `isTryLegacySubBlock` identifies the four sub-block
    keywords. Unblocks 6 wasmtk files. **Superseded by entry 25
    (v1.2.9)** — the "fold all instructions into a single body,
    don't model dispatch" shortcut was itself the root cause of a
    later V8-rejection bug; legacy try now builds a real `TryExpr`.

19. **Cosmetic: `undefined func "$$name"` in error messages**
    (v1.1.3). `Var.name` from the lexer already includes the `$`
    prefix; the `addError` calls in `resolve-names.ts` wrapped it
    in `"$${v.name}"`, producing doubled dollar signs (`$$mathlib_exp`)
    in user-facing error messages. Fix: three one-line removals of
    the literal `$` in `addError` calls (undefined-name + undefined-
    label paths). No regression test (cosmetic only); the wasmtk
    corpus output verifies single-`$` formatting at runtime.

20. **Bug D: empty-folded ops drop preceding stack values**
    (v1.1.6, reported by wasmtk-side multi-value-receive idiom).
    `parseFoldedInstr` passed `innerCtx.stmts` directly to
    `buildPlainExpr` regardless of opcode arity. When the user wrote
    `(local.set $x)` / `(drop)` / `(global.set $g)` / `(return)` /
    `(i32.store)` with no inline children, the parser supplied 0
    operands and `buildPlainExpr`'s `op0()` / `op1()` fallback
    inserted `Nop` placeholders — leaving any preceding stack values
    untouched. `flushStack` then appended those orphaned values
    AFTER the empty-folded ops in `stmts`, producing binaries V8
    rejected as "not enough arguments on the stack for X". Critical
    for wasic's multi-value receive idiom:
    `(call $two_returns) (local.set $b) (local.set $a)`.
    Fix: after the sub-expr loop in `parseFoldedInstr`, compute
    `nInputs = instrInputCountForTok(tok)` and fall back to popping
    the deficit from the surrounding `ctx.stack`. For variable-arity
    opcodes (`call` / `return` / `br` / `br_table` / `throw`), if no
    children supplied, drain the surrounding stack (matches linear-
    form behavior). The multi-value case works incidentally because
    the first local.set absorbs the whole CallExpr; subsequent
    local.sets get `Nop` values (runtime no-ops); V8's type validator
    accepts the resulting sequence. Regression coverage:
    `tests/parser/empty_folded.test.ts` (5 cases).

21. **`SimdShuffleOp` / `SimdStoreLane` arity entries in `instrInputCount`
    table were wrong** (v1.1.6, surfaced by Bug D fix). The arity
    table listed `SimdShuffleOp` as 3 and `SimdStoreLane` as 4 (with
    an `// approx` comment), but `buildPlainExpr` only ever reads
    `op0()` and `op1()` for both — `simd_shuffle` takes 2 v128
    operands (left + right), `simd_store_lane` takes 2 (address +
    vec). The wrong arities went unnoticed because the old
    `parseFoldedInstr` passed `innerCtx.stmts` directly (whatever
    count the user supplied); the Bug D fix made the parser respect
    the table, exposing the mismatch. Also added the missing
    `SimdLoadLane` entry (= 2; previously defaulted to 0). Fix in
    `src/parser/wast-parser.ts` `instrInputCount`. Regression
    coverage: existing SIMD bridge tests (`tier_c.test.ts`).

22. **Bug F: `(br_if N (f64.eq (global.get $i) ...))` mis-resolves
    non-first globals** (v1.1.7, surfaced by wasmtk Phase 1 testing
    after v1.1.6 shipped Bug D). The v1.1.6 Bug D fix in
    `parseFoldedInstr` unconditionally padded the operand array with
    `popN(ctx, deficit, loc)` when `innerCtx.stmts.length < nInputs`.
    For `br_if` (`instrInputCount = 2`, cond required + value
    optional) with one inline child, the empty outer stack returned a
    `Nop` placeholder; the parser then built
    `BrIf{cond=Nop, value=CompareExpr}` (swapped relative to spec).
    `resolveNames` only recurses into `BrIf.cond`, not `.value`, so
    the `global.get $i` inside the CompareExpr kept its name var
    unresolved; the binary writer defaulted to index 0. Only fired
    when the global was NOT the first one declared and a folded f64
    compare/etc wrapped the global.get. Variants that worked: `(if
    (f64.eq (global.get $i) ...))` (the if-cond path is separate),
    `(br_if 0 (global.get $i))` (single-child + no f64 wrapper has
    `innerCtx.stmts.length == nInputs` after the Bug D pad), and the
    same pattern with $i as the only global (index 0 happened to be
    correct). Fix: clamp the Bug D fix's pop count to what the outer
    stack actually has —
    `const available = Math.min(deficit, ctx.stack.length); operands
    = available > 0 ? [...popN(ctx, available, loc), ...innerCtx.stmts]
    : innerCtx.stmts;`. Leaves optional-operand ops alone when the
    user supplies the single-child form, while still popping for the
    Bug D scenarios where the outer stack actually has values.
    Regression: `tests/parser/empty_folded.test.ts` "Bug F: (br_if N
    (f64.eq (global.get $i) ...)) resolves $i correctly".

23. **Latent reader bug: `case Opcode.RefEq` built `CompareExpr`
    instead of `RefEqExpr`** (v1.1.9, surfaced by GC Tier 1 work).
    The pre-existing `Opcode.RefEq = 0xd3` case in
    `src/reader/binary-reader.ts` decoded ref.eq as
    `{ kind: 'compare', opcode: Opcode.RefEq, left, right }` — using
    the `CompareExpr` shape for what is semantically a typed-reference
    op. Invisible until a consumer cared about the IR shape (the bridge
    needs to dispatch on `kind` to pick the right binaryen-ts factory).
    GC Tier 1 introduced `RefEqExpr`; the reader case was switched at
    the same time. Pattern lesson: when adding a new ref-typed IR shape,
    audit the reader for any case currently piggybacking on a
    structurally-similar but semantically-different node kind.

24. **Bug G: `call_indirect (type $name)` mis-resolves named types to
    index 0** (v1.2.0, reported by wasmtk Phase 1 work). `resolveNames`
    for `call_indirect` / `return_call_indirect` resolved the `table`
    var but skipped the `typeVar` entirely. Any `(call_indirect
    (type $name) ...)` with a named-but-not-first type silently kept
    the name-var unresolved; the binary writer's `writeVar` fallback
    then emitted index 0 for every named type. Invisible when the
    named type happened to BE index 0; broken otherwise. Numeric
    `(type N)` already worked (already index-kind vars). Critical for
    wasic's higher-order array methods (map / filter / find / reduce /
    …), which compile to named-type `call_indirect` everywhere. Fix:
    new private `resolveTypeVar` helper on `ResolveContext` (mirroring
    `resolveFuncVar` / `resolveTableVar` / etc.); `call_indirect` /
    `return_call_indirect` cases now run `typeVar` through it.
    Regression: `tests/parser/bug_g_repro.test.ts` — round-trip via
    `wasm2wat` shows the right numeric indices, plus a runtime
    instantiate that calls through a `$double` function via `(type
    $i32ret)` and asserts the return value.

25. **Legacy try/catch dropped the dispatch wrapper during encoding**
    (v1.2.9, reported against 1.2.8 via the wasmtk Phase 15 exception
    suite — `15_Exceptions`, `15_panic`, `15_recover`,
    `15_TestCase1-NestedEscalation`). This is the root-cause fix for the
    shortcut taken in entry 18. The WAT parser coerced legacy
    `(try (do …) (catch $tag …))` into a plain `BlockExpr`, merging the
    catch handler instructions into the body and dropping the
    try/catch/catch_all/delegate/end opcode edges. The catch body's
    leading `local.set`s (which the EH runtime feeds from the tag's
    params via the catch edge) then ran on an empty operand stack, so
    V8 rejected the binary ("not enough arguments on the stack for
    local.set @+N"). wasic emits this shape for every TypeScript
    try/catch/throw, so it blocked the entire Phase 15 suite plus any
    production wasmtk program with exception handling.

    The whole rest of the pipeline already handled the `TryExpr` IR node
    (expr-visitor walk, binary writer's try/catch/catch_all/delegate/end
    encoding, binary reader, WAT writer, validator) — only the parser
    refused to build one. Fix:
    + `src/parser/wast-parser.ts`: both the folded
      `(try (do …) (catch …) …)` form and the linear
      `try … catch … end` / `try … delegate $l` form now build a real
      `TryExpr` (`body` + `Catch[]` + optional `delegate`) instead of a
      `BlockExpr`. The linear `try_table` stub (skip-to-`end`) was split
      out and left unchanged.
    + `src/ir/resolve-names.ts`: the `try` case now resolves each
      catch's `tag` (tag scope) and the `delegate` target (label,
      resolved against the *outer* scope after the try's own label is
      popped). Added a `rethrow` case resolving its `depth` like a `br`
      target — addresses the `NestedEscalation` "rethrow not targeting
      catch or catch_all" symptom, which was a downstream effect of the
      erased try scope (numeric depths now match real catch frames; a
      named `rethrow $label` also resolves).
    + `src/writer/wat-writer.ts`: fixed a **second, latent bug** exposed
      once a `TryExpr` with catch bodies finally reached the writer.
      `writeCatch` walked the handler body AND the ExprVisitor's `try`
      case walked `c.body` again, duplicating every handler instruction
      in `wasm2wat` output. Dropped the redundant walk from `writeCatch`
      (the visitor owns it).

    Handler bodies emit a leading `nop` before each stack-consuming op
    (e.g. `nop; local.set`): a folded `(local.set $x)` with no inline
    operand gets a `Nop` value placeholder because at parse time the
    catch body stack is empty, but the runtime's `catch` edge pushes the
    tag's params, so the `local.set` consumes them and the `nop` is
    harmless. (The div-by-zero in the original reproducer is a WASM
    *trap*, not a catchable exception, so it correctly propagates past
    the handler — the catch is for `throw`n tags.) Regression:
    `tests/parser/legacy_try.test.ts` — parse-shape checks (folded /
    linear / catch_all / delegate / multi-catch), V8 compile + run
    checks (throw→catch tag delivery `g()==42`, catch_all, nested
    rethrow→outer handler), and a `wasm2wat` round-trip
    non-duplication check. Note: the binaryen bridge
    (`src/bridge/binaryen-bridge.ts`) still does not map legacy
    `TryExpr` — that path is binaryen-ts-gated and not the production
    encode path for legacy try (the wabt-ts encoder is).

26. **A folded value-producing statement sank past a later `(return …)`**
    (v1.3.0, reported via wasmtk's shared-heap stdlib track). The parser
    builds expression trees with two lists per scope: `ctx.stack` (operand
    values that a following instruction might still consume) and
    `ctx.stmts` (committed statements). `instrProducesValue` returns `true`
    for `call` — conservatively, because the parser can't know the callee's
    arity without its signature — so EVERY call is pushed onto `ctx.stack`.
    A void call at statement position is never consumed as an operand, so it
    lingered on the stack until the enclosing block's end-of-body
    `flushStack`, which appends leftover stack values to the END of
    `ctx.stmts` — i.e. AFTER every genuine statement that followed the call
    in source order. So `(call $f …) (local.set …) (return X)` parsed as
    `local.set; return; call`, sinking the call past the `return` into dead
    code; its side effect (e.g. a cross-function store) never ran. The
    smoking gun was byte-level: jsr body `… 0f 10 00 0b` (`return; call;
    end`) vs npm `10 00 … 0f 0b` (`call; …; return; end`). General
    correctness bug — silently dropped any `sideEffectingCall(); return X;`
    shape; masked in the existing suite only because that shape is rare
    (most side-effecting calls are inlined or feed the return expression),
    but it hard-blocked the shared-heap stdlib track.

    Fix: new module-level `pushStmt(ctx, expr)` helper that drains
    `ctx.stack` into `ctx.stmts` (preserving order) BEFORE committing each
    statement. By the push site, the deficit-fill in `parseFoldedInstr` /
    `parseLinearPlainInstr` has already popped whatever operands the current
    instruction consumes, so any leftover stack values are genuinely in
    statement position and sequenced before `expr`. Routed all 10
    statement-position push sites through it (folded + linear plain instrs,
    and every void block / loop / if / try / try_table). Does NOT touch
    operand consumption, so the Bug D multi-value receive idiom
    (`(call $two) (local.set $b) (local.set $a)`) is unaffected — verified
    by a guard test. Regression: `tests/parser/stmt_order.test.ts` —
    runtime instantiate + observe the store landed, covering the W/X/Y
    characterization (call+arg before explicit return; call before trailing
    fallthrough value; call before `(drop …)` + return), two-call ordering,
    and the multi-value guard. Same commit removed 5 dead private methods
    surfaced by a corpus-wide reference-count sweep: `expectLpar` /
    `parseInlineExports` (`src/parser/wast-parser.ts`), `readU64Leb` plus its
    now-orphaned `decodeU64Leb128` import (`src/reader/binary-reader.ts`),
    and `openNewline` / `writeRefKind` (`src/writer/wat-writer.ts`).

**Affects:** `src/core/opcode.ts`, `src/parser/wast-parser.ts`,
`src/reader/binary-reader.ts`, `src/ir/ir.ts`, `src/ir/expr-visitor.ts`,
`src/ir/resolve-names.ts`, `src/ir/apply-names.ts`,
`src/ir/synthesize-types.ts` (new),
`src/writer/binary-writer.ts`, `src/writer/wat-writer.ts`,
`src/bridge/binaryen-bridge.ts`, `src/tools/wat2wasm.ts`,
`src/validator/type-checker.ts`.
Tooling: `scripts/audit_opcodes.ts` (new),
`scripts/gen_simd_opcode_table.ts` (new). Regression coverage in
`tests/reader/binary-reader.test.ts`, `tests/parser/folded.test.ts`,
`tests/parser/wast-parser.test.ts`, `tests/parser/legacy_try.test.ts`
(new — legacy try/catch, entry 25), `tests/tools/wat2wasm.test.ts`,
`tests/wasmtk/runner.test.ts` (new — 272 wasmtk WAT files), and the
bridge test files.

### Validator SIMD opcode-info — resolved 2026-05-25 (v1.1.3)

**Original gap:** `src/validator/type-checker.ts` `getOpcodeTypeInfo` had
a default `return oi(_V128, _V128, _V128, _V, 0)` for any opcode not in
its explicit switch. SIMD opcodes (0xfd-prefixed) all fell through and
got typed as `(v128, v128) → v128`. Real splat is `i32 → v128`, real
extract_lane is `v128 → i32`, etc. The validator reported type mismatch
on any SIMD function; the Tier C SIMD bridge tests bypassed
`validateModule` and used `WebAssembly.compile` directly.

**Fix (v1.1.3):** added 50+ explicit entries for the opcodes whose
signature differs from the `(v128, v128) → v128` default:

+ splats: i8x16/i16x8/i32x4 (i32 input), i64x2 (i64), f32x4 (f32),
  f64x2 (f64), all producing v128
+ any_true / all_true: (v128) → i32
+ bitmask: (v128) → i32
+ shifts: (v128, i32) → v128
+ v128 → v128 unary family: abs / neg / popcnt / sqrt / ceil / floor /
  trunc / nearest / extend_low/high / extadd_pairwise / convert /
  trunc_sat / demote / promote / v128.not

The default is preserved for the bulk of SIMD ops (lane-wise
add/sub/mul/div/min/max/eq/ne/lt/gt/le/ge/and/or/xor/andnot/etc.) — that
signature is correct for them. Bridge tests no longer need to bypass
validateModule. **Affects:** `src/validator/type-checker.ts`.

### Phase 7 bridge handshake — satisfied as of binaryen-ts v1.0.9

**Date:** 2026-05-25
**Decision:** The "wait for binaryen-ts Phase 2 instruction decoder" milestone
established 2026-05-21 is met. The full instruction-level constructor API
(`makeI32Const`, `makeBinary`, `makeBlock`, all control-flow + memory + ref/GC
constructors) is stable and exported from
`binaryen-ts/src/ir/expressions.ts` as of binaryen-ts v1.0.9. Phase 7 is
unblocked.
**Why:** binaryen-ts has progressed through Phases 0–9 (WAT parser, binary
parser, binary encoder, opt passes, inlining, `wasm-opt` CLI, GC, EH, SIMD)
on top of the Phase 11.x JSR publish hardening. The bridge inherits a richer
constructor surface than originally scoped — GC and EH constructors are
available too.
**Next step (not yet done):** dry-run map a small wabt IR
(a function with const/local.get/i32.add, plus an import, a global, a memory)
onto binaryen-ts constructor calls and confirm the shapes line up before
committing to a full `ExprVisitorDelegate`-driven bridge.
**Affects:** `CLAUDE.md` (binaryang Cross-Project Architecture, Phase 7
detail, phase delivery plan), `README.md` (roadmap row), this file.

### IR expression representation: deferred pending Phase 2
**Date:** 2026-05-21
**Status:** Open — must decide before starting Phase 2.
**Options:**
- A. **Discriminated union** (`{ kind: 'i32.const'; value: number }`) — idiomatic
  modern TypeScript, works well with exhaustive `switch`, tree-shakes cleanly.
- B. **Class hierarchy** — closer to the C++ original, easier to add methods,
  but heavier and less ergonomic with TypeScript's type narrower.
**Recommendation:** Option A (discriminated union) for expression nodes;
plain interfaces for Module/Func/Global top-level IR nodes.

### Binary reader API style: resolved (Phase 3)

**Date:** 2026-05-22
**Decision:** Option A — all sections decoded inline inside a single `BinaryReader` class.
The IR is built directly during decode (no separate delegate layer), with an operand stack
per control-flow frame performing the flat→tree conversion inline.
**Why:** The ExprVisitorDelegate pattern (already in Phase 2) covers the output side.
Adding a second delegate layer for the input would duplicate the pattern without benefit.
A single decoder class reads cleanly from the C++ reference and stays maintainable.
**Affects:** `src/reader/binary-reader.ts` — `BinaryReader` class + `readBinaryIr()` entry point.

### Interpreter (Phase 7) dropped — Deno/Bun provide native wasm execution

**Date:** 2026-05-21
**Decision:** The wasm interpreter is dropped from scope entirely, not just deferred.
**Why:** Deno (V8) and Bun (JavaScriptCore) both include a native wasm JIT. Running wasm
through a TypeScript interpreter would be 10–50× slower with no benefit for the
wasmtk use case. The only scenario that would justify it — a JS runtime with no native
wasm support — is not on the horizon for this project.
**Affects:** `src/interp/` directory is a permanent placeholder only; no code goes there.
Phase 7 removed from the active roadmap.

### wasm-link excluded — wasmtk handles linking via wasmbundler

**Date:** 2026-05-21
**Decision:** `wasm-link` will not be ported.
**Why:** wasmtk already has wasmbundler for linking wasm modules. Duplicating that
capability here would create maintenance overlap with no benefit.
**Affects:** No `src/tools/wasm-link.ts` file.

### wasm-decompiler, wasm2c, spectest-interp, fuzzers excluded

**Date:** 2026-05-21
**Decision:** These four components are out of scope.
**Why:**

- `wasm-decompiler` — not needed for the wasmtk toolchain.
- `wasm2c` — wrong target language; `wasm2ts` is the TypeScript-target equivalent.
- `spectest-interp` — only useful alongside the interpreter, which is dropped.
- Fuzzing harnesses — development tooling for the C++ project; not a public API concern.

**Affects:** No corresponding files in `src/tools/` or `src/`.

### wabt-ts stays pure TypeScript — no wasm compilation of this repo's modules

**Date:** 2026-05-21
**Decision:** wabt-ts does not compile its own modules to wasm.
**Why:** The value of this port is readable, portable TypeScript. Maintaining binary
artifacts alongside source would add a build step, complicate JSR publishing, and provide
negligible performance benefit for build-time tooling. Deno/Bun execute the output wasm;
they don't need wabt-ts itself to be wasm.
**How it plays out:** wasmtk uses `wat2wasm`/`wasm2ts` from this package to compile its own
pure-compute modules to wasm. The `.wasm` files and `wasm2ts`-generated TypeScript wrappers
live in wasmtk's repo, not here.
**Affects:** No `wasm/` folder in this repo. `deno.json` publish config includes no `.wasm`
files. Phase 9 is removed from this project's scope.

### Phase 4 parser: `func` keyword maps to `TokenType.Func`, not `TokenType.Function`

**Date:** 2026-05-22
**Decision:** In the WAT token map, the keyword `func` (used in module field declarations) resolves to `TokenType.Func` — a refkind token carrying `Type.FuncRef` — not to `TokenType.Function`. This matches the C++ `wast-lexer.cc` classification where `func` is treated as a reference kind keyword. Any parser switch on module fields must case on `TokenType.Func` (and optionally `TokenType.Function` as a fallback).
**Why:** `func` appears both as a module-field keyword `(func ...)` and as a reference kind `(ref func)` / `funcref`. The lexer resolves ambiguity at the token level by always classifying it as a refkind. `function` (the reserved JS keyword) maps to `TokenType.Function` and is unused in normal WAT.
**Affects:** `isModuleField()`, `parseModuleField()`, `parseFuncModuleField()` in `wast-parser.ts`; same pattern applies to any future parser code that checks for the `func` field keyword.

### Phase 4 parser: token.ts `LiteralType` name collision

**Date:** 2026-05-22
**Decision:** `token.ts` exports its own `LiteralType` const enum (describing token literal payload variants) which collides with `literal.ts`'s `LiteralType` export (describing parsed literal kinds). Do not `export *` from `token.ts` in `index.ts`. The public API exports only `lexer-source.ts` and `wast-parser.ts`.
**Why:** Both enums have the same name but different semantics. TypeScript's `export *` chaining in `index.ts` produces TS2308 ambiguity errors when both are in scope.
**Affects:** `src/index.ts` — `token.ts` and `wast-lexer.ts` are not part of the public re-export surface.

### `literal.ts` precision note
**Date:** 2026-05-21
**Decision:** f64 hex float parsing uses JavaScript's double arithmetic. Values
with full 52-bit mantissa precision parsed from hex float strings may incur
up to 0.5 ULP of rounding error in the intermediate computation.
**Why:** BigInt-based exact hex float parsing would require significant extra code;
the error is negligible for test-vector workloads. Revisit if the WAT parser
conformance tests reveal failures.
**Affects:** `src/core/literal.ts` — `parseHexFloat()`.

---

## Phase 1 — Core Infrastructure ✅

### Phase 1 source files

- [x] `src/index.ts` — public API entry point with `@module` JSDoc
- [x] `src/core/types.ts` — `Type` enum, `Index`/`Address`/`Offset`, predicates, `typeName()`
- [x] `src/core/binary.ts` — magic bytes, `BinarySection`, limit flags, `ExternalKind`
- [x] `src/core/result.ts` — `Result.Ok/Error`, `succeeded()`, `failed()`, `combineResults()`
- [x] `src/core/feature.ts` — `Features` interface, `defaultFeatures()`, `allFeatures()`
- [x] `src/core/error.ts` — `Location`, `WabtError`, `ErrorList`, `formatError()`
- [x] `src/core/leb128.ts` — all 8 encode/decode functions (u32/u64/s32/s64)
- [x] `src/core/opcode.ts` — all core opcodes (0x00–0xd6), `MiscOpcode` (0xfc group), `opcodeName()`
- [x] `src/core/literal.ts` — integer parsers, float parsers (hex float, inf, nan, decimal), float printers

### Tests (31 tests, 282 steps — all passing)
- [x] `tests/core/binary.test.ts`
- [x] `tests/core/leb128.test.ts`
- [x] `tests/core/literal.test.ts`
- [x] `tests/core/opcode.test.ts`
- [x] `tests/core/result.test.ts`
- [x] `tests/core/types.test.ts`

### Infrastructure
- [x] `deno.json` — scope corrected to `@jrmarcum/wabt-ts`; `publish` section added
- [x] `.github/workflows/publish.yml` — provenance publishing on `v*` tag
- [x] `CLAUDE.md` — Phase 1 status updated

### Known limitations / follow-up
- `literal.ts`: SIMD `v128` literal parsing (hex byte sequences) not yet implemented —
  needed in Phase 4 (WAT parser). C++ reference: `ParseV128Literal` in `literal.cc`.
- `opcode.ts`: SIMD (0xfd group) and threads (0xfe group) opcode tables not yet added —
  needed in Phase 3 (binary reader) and Phase 4. C++ reference: `opcode.def`.
- `error.ts`: `formatError(ErrorFormat.Long)` requires the caller to supply the source
  line text. The WAT lexer (Phase 4) will need to thread that through.

---

## Phase 2 — IR Layer ✅

**Completed:** 2026-05-21. 39 tests passing (315 steps).

### Phase 2 design decisions

- **Expr representation:** discriminated union (`{ kind: 'i32.const'; value: number }`) — see Decisions Log.
- **IR shape:** tree-structured expression nodes + section metadata envelope for binary layout info (byte offsets, raw sizes, section ordering needed for wasm-objdump). Flat stack-machine representation rejected — WAT output and binaryen bridge both require a tree; objdump needs only the metadata envelope.
- **Traversal order:** post-order (children before parent) to map cleanly onto binaryen constructor API.
- **Stack-to-tree algorithm:** operand stack maintained during decode; push leaf nodes, pop operands when building composites. Edge cases to verify in dry-run: multi-value blocks, unreachable code after `unreachable`/`br`/`return`, `br_table` label resolution.
- **Bridge type mapping:** `wabtTypeToValType(t: Type): ValType` lives on the wabt-ts side (see CLAUDE.md for mapping table and full binaryen-ts constructor API reference).

### IR source files

- [x] `src/ir/ir.ts` — Module, Func, Expr discriminated union (50+ variants), Global, Table, Memory, section metadata envelope
- [x] `src/ir/ir-util.ts` — ModuleContext with label stack, LabelType enum, getExprArity
- [x] `src/ir/expr-visitor.ts` — post-order ExprVisitor with optional ExprVisitorDelegate, NopDelegate
- [x] `src/ir/apply-names.ts` — applyNames: apply name-section NameMaps to index-based Vars in IR
- [x] `src/ir/resolve-names.ts` — resolveNames: resolve symbolic name Vars to index Vars with error accumulation
- [x] `src/ir/generate-names.ts` — generateNames: fill unnamed entities with synthetic names (numeric or alpha scheme)

### Tests (39 tests, 315 steps — all passing)

- [x] `tests/ir/ir.test.ts` — Var factories/predicates, BlockType, Const factories, sigEquals, makeModule, totalFuncs/Globals, ExprVisitor (post-order, block, if, abort, visitFunc, NopDelegate), generateNames, resolveNames

### IR C++ references

- `upstream/include/wabt/ir.h` (~2500 lines) — main IR definitions
- `upstream/src/ir.cc`
- `upstream/include/wabt/expr-visitor.h`

---

## Phase 3 — Binary Round-trip ✅

**Completed:** 2026-05-22. 40 tests passing (331 steps, all prior phases included).

### Phase 3 source files

- [x] `src/reader/binary-reader.ts` — full wasm binary decoder → Module IR; `readBinaryIr()` entry point
- [x] `src/reader/binary-reader-ir.ts` — re-export shim preserving C++ source naming
- [x] `src/reader/binary-reader-nop.ts` — re-exports `NopDelegate` as `BinaryReaderNop`
- [x] `src/writer/stream.ts` — `MemoryStream` growable buffer with back-patch support
- [x] `src/writer/binary-writer.ts` — IR → wasm binary encoder; `writeBinaryIr()` entry point

### Tests (16 new tests — all passing)

- [x] `tests/reader/binary-reader.test.ts` — empty module, type section, round-trip add function,
  i32/i64/f32/f64 constants, linear memory, mutable global, function import, block, if/else,
  passive/active data segments, local declarations, section metadata, error cases

### Phase 3 design decisions

- **Single-class decoder:** all section decoding inline in `BinaryReader`; no separate delegate
  for the IR-building path. See Decisions Log.
- **Flat→tree conversion:** per-frame operand stack during `decodeBody`; value-producing
  instructions push to `frame.stack`, statement-level pop operands and push to `frame.stmts`.
  `frame.flush()` produces `[...stmts, ...stack]` as the block body.
- **Block result routing:** nodes go to parent `stack` if `blockResultCount > 0`, else `stmts`.
  Loops always go to `stmts` (their `br` targets the loop header, not the exit).
- **Multi-memory memarg:** bit 6 of the align byte (0x40) signals an explicit `memidx` follows.
- **DataCount section:** always written if `dataSegments.length > 0` (over-inclusive but valid
  for all standard runtimes).

### Binary reader/writer C++ references

- `upstream/src/binary-reader.cc` (~3000 lines)
- `upstream/src/binary-writer.cc`
- `upstream/include/wabt/binary-reader.h`

---

## Phase 4 — WAT Text Format ✅

**Completed:** 2026-05-22. 86 tests passing (522 steps, all phases included).

**Prerequisite for:** `wat2wasm`, `wasm2wat` tools.

### Phase 4 source files

- [x] `src/parser/lexer-source.ts` — source buffer abstraction
- [x] `src/parser/token.ts` — token kinds and token struct
- [x] `src/parser/wast-lexer.ts` — WAT/WAST lexer
- [x] `src/parser/wast-parser.ts` — WAT/WAST parser (`parseWatModule`, `parseWastScript`)
- [x] `src/writer/wat-writer.ts` — IR-to-WAT pretty printer (`writeWatModule()` entry point)

### Phase 4 tests

- [x] `tests/writer/wat-writer.test.ts` — 13 describe groups, 40 assertions; empty module,
  type entries, imports, funcs (const/binary/block/if/else/call), globals, tables, memories,
  exports (standalone + inline), start, data segments, element segments, load/store alignment,
  section ordering
- [x] `tests/parser/wast-lexer.test.ts` — 69 tests; structural tokens, keywords, value types,
  refkinds, core opcodes, extended opcodes (SIMD/atomics/misc), identifiers, strings, numerics,
  align=/offset=, nan patterns, errors, full WAT snippet
- [x] `tests/parser/wast-parser.test.ts` — 17 describe groups; module fields (types, imports,
  funcs, globals, memories, tables, exports, start, data, elem), instruction parsing (folded +
  linear form), const expressions, multiple fields, error handling, WAST script commands

### Dependencies added to Phase 1 at start of Phase 4

- [x] `opcode.ts`: `EXTENDED_OPCODE_NAMES` map + `extendedOpcodeName()` + `anyOpcodeName()`
  covering SIMD (0xfd, ~150 ops), atomics (0xfe, ~50 ops), misc (0xfc, 8 ops)
- [ ] `literal.ts`: `parseV128Literal()` implementation (needed by parser, not writer) — **implement after Phase 5**

### Phase 4 design decisions

- **WAT writer output: linear (unfolded) format.** Each instruction on its own line, children before parent. The post-order ExprVisitor already handles recursion; delegates only emit the opcode and operands for each node, not its children.
- **Block-like expressions:** `beginBlockExpr`/`endBlockExpr` callbacks bracket the body. Indent increases by 2 inside each block; `else` un-indents then re-indents.
- **Inline exports** (default on): the export map is pre-built before module traversal; `(export "name")` appears inline inside `(func ...)` / `(global ...)` etc.
- **Standalone imports** (default): `(import "m" "f" (...))` emitted before all definitions. Inline import mode available via `inlineImport: true` option.
- **`naturalAlignForOpcode`**: maps core load/store opcodes to natural alignment (1/2/4/8 bytes); extended ops default to 1. The `align=N` keyword is omitted when the alignment matches natural.

---

## Phase 5 — Validator ✅

**Completed:** 2026-05-22. 87 tests passing (557 steps, all phases included).

**Prerequisite for:** `wasm-validate` CLI tool (Phase 6), and strengthens `wat2wasm` correctness.

### Phase 5 source files

- [x] `src/validator/type-checker.ts` — operand stack type checker (TypeChecker class); tracks
  value/label stacks; handles unreachable code polymorphism; delegates to opcode type-info table
- [x] `src/validator/shared-validator.ts` — module-structure validator (SharedValidator class);
  resolves local/global/func/table/memory/tag indices; manages local declarations; delegates
  all stack checks to TypeChecker
- [x] `src/validator/validator.ts` — IR-walking validator (ModuleValidator class, ExprVisitorDelegate);
  walks module fields in spec order; calls SharedValidator per instruction; `validateModule()` entry point

### Phase 5 tests (1 new test suite — all passing)

- [x] `tests/validator/validator.test.ts` — empty module, simple arithmetic (accept/reject),
  local variables (param/local/out-of-range), globals (get/set mutability), exports (valid/duplicate/bad-index),
  start function (accept/reject params/results), control flow (block/unreachable/if-else),
  br targeting outer block, direct call (valid/bad-index), type mismatch (wrong operand type),
  multiple errors collected in a single pass

### Phase 5 design decisions

- **Three-layer architecture:** TypeChecker (pure operand/label stack) ← SharedValidator (module state + index resolution + error reporting) ← Validator (IR walk via ExprVisitorDelegate)
- **Operand stack at function entry:** empty. Params are registered as locals (SVLocalDecl), not pushed onto the type stack. This matches the C++ SharedValidator which calls `BeginFunction(results_only)`.
- **TypeChecker error reporting:** error callback pattern — TypeChecker calls `errorCallback(msg)` and the SharedValidator wraps it into `addError(errors, currentLoc, msg)`.
- **`hadError` flag:** helpers that add errors but return a plain value (e.g. `resolveVar`) set `this.hadError`; callers fold it into the final `combineResults()` chain.

---

## Phase 6 — CLI Tool Wrappers ✅

**Completed:** 2026-05-22. 87 tests passing (557 steps, all phases included).

### Phase 6 source files

- [x] `src/tools/wat2wasm.ts` — `wat2wasm(src, opts)` → `{ binary, errors, result }`
- [x] `src/tools/wasm2wat.ts` — `wasm2wat(binary, opts)` → `{ text, errors, result }`
- [x] `src/tools/wasm-validate.ts` — `wasmValidate(binary, opts)` → `{ errors, result }`
- [x] `src/tools/wasm-objdump.ts` — `wasmObjdump(binary, opts)` → `{ text, errors, result }`
- [x] `src/tools/wasm-strip.ts` — `wasmStrip(binary, opts)` → `{ binary, errors, result }`
- [x] `src/tools/wasm2ts.ts` — stub; throws (Phase 8 deferred)

Each file: exports a typed library function + `if (import.meta.main)` CLI block using `Deno.args`.

### Phase 6 design decisions

- **`wat2wasm`**: parse → `resolveNames` → encode. `resolveNames` converts name Vars to index Vars before the binary writer runs.
- **`wasm2wat`**: decode with `readDebugNames: true` → `generateNames` (fill unnamed entities) → `writeWatModule`. No `applyNames` needed — the reader sets names directly on `func.name` etc., and the WAT writer reads those fields.
- **`wasm-validate`**: decode (read errors) → `validateModule` (validation errors) → `combineResults`. Both passes share the same `ErrorList`.
- **`wasm-strip`**: decode with `readDebugNames: false` (keeps name section in `module.customs`) → clear `module.customs` → re-encode.
- **`wasm-objdump`**: decode with `readDebugNames: true` → render `module.sectionMeta` as section header table. Counts derived from module arrays, not `SectionMeta.count` (which is always 0).
- **Library exports in `index.ts`**: tool functions and option/result types exported from the main package entry point under Phase 6.

---

## Phase 6.1 — Pre-publish housekeeping ✅

**Completed:** 2026-05-25. 87 tests still passing (557 steps). No behavioral
change to wat2wasm / wasm2wat / wasm-validate / wasm-objdump / wasm-strip; this
phase tightens publishing safety, eliminates lint debt, and locks in hot-path
performance invariants that future code must preserve.

### Phase 6.1 deliverables

#### JSR / CI hardening

- [x] `.github/workflows/ci.yml` — fmt-check / lint / type-check / test / publish dry-run on every push and PR to `main` (mirrors binaryen-ts CI shape)
- [x] `.github/workflows/publish.yml` — bumped `actions/checkout@v6`, added `contents: write` permission, tag-vs-`deno.json` version verification, `gh release create --generate-notes` after the JSR publish
- [x] `scripts/publish.ts` — developer-side task that pushes the release tag (guards against publishing locally without provenance)
- [x] `deno.json` — added `publish`, `publish:dry`, `ci` tasks; added `@std/expect` to the import map
- [x] License/SPDX setup already correct from Phase 1 (`MIT OR Apache-2.0` — derivative of Apache-2.0 upstream)

#### Lint cleanup — 71 errors → 0

- [x] Removed dead imports across `src/` and `tests/` (~20 symbols)
- [x] Prefixed 14 unused delegate parameters with `_` to satisfy `SharedValidator` / `ExprVisitorDelegate` interface contracts
- [x] Deleted 3 genuinely dead helpers (`blockTypeLoc`, `noLoc`, stale scaffolding locals)
- [x] Replaced `const w = this; w.foo()` aliasing with direct `this.foo()` in `wat-writer.ts` (171 references rewritten; `no-this-alias` rule)
- [x] `interface ValidateOptions {}` → `type ValidateOptions = Record<string, never>` (`no-empty-interface` rule)
- [x] `let kind` → `const kind` in `binary-reader.ts:550` (`prefer-const`)
- [x] Switched `tests/parser/wast-lexer.test.ts` off raw `jsr:` specifiers (`no-unversioned-import`)

#### Performance invariants (Tier 1 + Tier 2)

- [x] **Text codec singletons** — `TextEncoder` / `TextDecoder` hoisted to module-level constants in `stream.ts`, `wat-writer.ts`, `binary-reader.ts`, `lexer-source.ts`
- [x] **`ModuleContext` index maps** — `funcSigsByIndex` and `tagArityByIndex` pre-computed in constructor; `getFuncSig` / `getTagArity` now O(1) instead of O(imports)
- [x] **`WatWriter.nameIndexMap`** — `"kind:name" → idx` map pre-computed in constructor; `resolveVarIndex` now O(1) Map.get instead of two linear scans (imports + defs)

### Phase 6.1 known follow-up

- **`deno fmt --check` reports 35 unformatted files.** Pre-existing as of the
  start of this phase — not caused by the housekeeping work. The new `ci.yml`
  workflow runs `deno fmt --check`, so CI will fail on `main` until either:
  (a) `deno fmt` is run across the repo to reformat in one commit, or
  (b) the `fmt` config in `deno.json` is adjusted to match the codebase's
  actual style (compact `case X: return Y;` on one line, etc.). Pick before
  the first push that should trigger CI.

---

## Phase 6.2 — Release-flow alignment with binaryen-ts ✅

**Completed:** 2026-05-25. First successful JSR publish achieved. No source
behavior change — the work is entirely in the release scripts, CI workflows,
and license metadata. 87 tests still passing.

### Phase 6.2 deliverables

- [x] `scripts/version.ts` — shared helper exporting `DENO_JSON_URL`, `readCurrentVersion()`, `nextVersion()` under the sub-version-capped-at-9 rule
- [x] `scripts/bump_version.ts` — rewrites `deno.json` `version` field, prints `current -> next` and the next-step instructions
- [x] `scripts/publish.ts` — rewritten to stage + commit (only if dirty) + force-tag locally + atomic `git push origin main vX.Y.Z`. Replaces the earlier "refuse on dirty tree" approach, which broke the natural `bump → publish` flow.
- [x] `deno.json` — added `bump` task; `publish` task now invokes `scripts/publish.ts`; `publish:dry` runs `deno publish --dry-run --allow-dirty` for local manifest validation
- [x] `.github/workflows/auto-tag.yml` — safety-net workflow: on every push to `main`, if `deno.json` version has no matching tag, create + push the tag and dispatch `publish.yml` on it
- [x] `.github/workflows/publish.yml` comment updated to record why CI calls `deno publish` directly (subprocess invocation through `Deno.Command` breaks JSR OIDC provenance detection — lesson from binaryen-ts v1.0.6/v1.0.7)
- [x] License switched from compound `"MIT OR Apache-2.0"` to `"MIT"` in `deno.json` and `package.json`; `LICENSE` rewritten to full MIT text + Apache-alternative pointer (JSR rejects compound SPDX expressions)
- [x] `.gitignore` adds `/upstream/`, `/binaryen-ts/`, `/wasmtk/` so editor/search tools skip the submodule working trees (git itself still tracks them via `.gitmodules`)
- [x] First successful JSR publish — see [@jrmarcum/wabt-ts on JSR](https://jsr.io/@jrmarcum/wabt-ts)

### Phase 6.2 known footgun (recorded so we don't recur)

`deno task publish` is for **local use only.** CI invokes `deno publish`
directly. If a future contributor "consolidates" the workflow to call
`deno task publish`, every release will be flagged "No provenance" on JSR
because `Deno.Command("deno publish")` does not propagate the OIDC token
correctly. The publish workflow has a comment explaining this — keep it.

---

## Phase 7 — binaryen Bridge 🟡 In progress

**Status:** MVP shipped 2026-05-25. The bridge round-trips the canonical
Phase 7 starter module (`(module (import ...) (global ...) (memory 1) (func
... local.get / i32.add) (export ...))`) through binaryen-ts's encoder back
into a wabt-ts-validated wasm binary. Expression coverage will expand
kind-by-kind.

### Phase 7 deliverables (so far)

- [x] `src/bridge/type-map.ts` — `wabtTypeToValType(t: Type): ValType`
- [x] `src/bridge/binaryen-bridge.ts` — `bridgeToBinaryen(module): WasmModule`, direct post-order recursion
- [x] `tests/bridge/dry_run.test.ts` — end-to-end round-trip via parser → bridge → binaryen-ts encoder → wabt-ts decoder + validator
- [x] `@jrmarcum/binaryen-ts@^1.0.9` added to `deno.json` imports (`/ir` and `/encoder` subpath maps)
- [x] **Tier A** — 18 expression kinds: `const`, `local.get`/`set`/`tee`, `global.get`/`set`, `unary`, `binary`, `compare`, `convert`, `drop`, `return`, `nop`, `unreachable`, `block`, `loop`, `if`/`else`, `br`, `br_if`, `br_table`. Label-stack + `bridgeBlockType` + `withDeclaredType` machinery added to handle name-based break targets and the early-exit-block type inference quirk. 9 tests in `tests/bridge/tier_a.test.ts`.
- [x] **Tier B** — 7 more expression kinds: `call`, `call_indirect`, `select`, `load`, `store`, `memory.size`, `memory.grow`. Added `funcSigs` + `tableNames` to `BridgeCtx`; `synthesizeAnonymousNames` post-processor for empty wabt names → `$F0` / `$G0` / `$T0`; `alignBytesToExponent` (wabt stores bytes, binaryen-ts encoder expects exponent); `loadInfo` / `storeBytes` opcode→info tables. 8 tests in `tests/bridge/tier_b.test.ts`.
- [x] **Tier C (partial)** — `ref.null` (with name-var → ValType mapping for `funcref`/`externref`/`func`/`extern`), `ref.func` (uses canonical funcNames), `ref.is_null`, `v128.const` (added in v1.0.5; verified flows cleanly), SIMD splat (via existing `unary` case — wabt classifies it as UnaryExpr), lane-wise SIMD arithmetic (via existing `binary`/`unary`), `simd_lane_op` extract variants (`makeSIMDExtract`), `simd_shuffle` (`makeSIMDShuffle`). 9 tests in `tests/bridge/tier_c.test.ts`. Bridge now covers ~35 expression kinds. **SIMD tests compile through V8's native validator** because wabt-ts's own validator has no opcode-info entries for SIMD ops (defaults `(v128, v128) → v128`, which mis-types splat); fixing the validator's SIMD coverage is a separate future task.
- [x] **Tier C — SIMD memory ops** (2026-05-25 follow-up): `load_splat` / `load_zero` / `simd_load_lane` / `simd_store_lane` cases added. The WAT lexer routes every `v128.load*_splat` / `v128.load*_zero` / `v128.load*x*` to `TokenType.Load` (→ `LoadExpr`), so the bridge's `load` case routes 0xfd-prefix opcodes through `makeSIMDLoad`. New dedicated cases also exist for binary-reader IR (`LoadSplatExpr`, `LoadZeroExpr`, `SimdLoadLaneExpr`, `SimdStoreLaneExpr`). 7 tests in `tests/bridge/tier_c.test.ts`. **Plain `v128.load` is intentionally not covered** — binaryen-ts v1.0.9's encoder `loadOpcode()` has no `ValType.V128` branch, so `makeLoad(16, …, V128)` silently emits `i64.load`. Surfaced as a separate binaryen-ts gap; revisit when binaryen-ts grows a SIMD-aware factory.
- [x] **Tier C — EH** (2026-05-25 follow-up): tag defs (`bridgeTag` + `module.tags` walk), `throw`, `throw_ref`, `try_table` cases. `tagNames: string[]` added to `BridgeCtx` (synthesizes anonymous tags as `$E0`, `$E1`, …). `buildCatchClause` maps the four `CatchKind` variants (Catch / CatchRef / CatchAll / CatchAllRef) onto binaryen-ts's `CatchClause { tag, dest, isRef }`. 3 tests in `tests/bridge/tier_c.test.ts` (throw with no operands, throw with i32, throw with i32+i64). **`try_table` / `throw_ref` tests are blocked by a wabt-ts parser limitation** — `parseLinearBlockInstr` and the folded variant currently coerce `try_table` to a plain `BlockExpr` and reject `(catch ...)` clauses with "expected ), got (". Bridge handlers exist for the moment when the parser lands the catches. **Tag imports and tag exports still throw** because binaryen-ts v1.0.9 has no `addTagImport` and `WasmExport.kind` doesn't include `"tag"`.
- [x] **Tier D — module-level coverage** (2026-05-28): memory exports
  (`addExport(..., "memory")`), table exports (`addExport(..., "table")`),
  active + passive data segments (`addDataSegment` / `addPassiveDataSegment`).
  Added `memoryNames: string[]` to `BridgeCtx` (parallel to funcNames /
  globalNames / tableNames / tagNames); `synthesizeAnonymousNames` now
  synthesizes `$M0` / `$M1` / … for anonymous memories. `bridgeImport` for
  memory now uses the canonical ctx name (was passing the raw import name,
  which broke memory-export lookup). New `bridgeDataSegment` helper handles
  active (with single-expression constant offset, multi-memory rejected) +
  passive; `declared` segment kind silently skipped (meaningless for data).
  10 tests in `tests/bridge/tier_d.test.ts` (memory + table exports,
  passive + active data segments, segment offset via imported global,
  combined module-level features). Bridge now covers all module-level
  surface except element segments + start (both blocked by binaryen-ts gaps).
- [ ] **Tier C (still deferred)** — `ref.as_non_null` (binaryen-ts has no factory), GC (`struct.*`, `array.*`, `ref.eq`, `ref.i31`, `i31.get`). SIMD `replace_lane`, `try_table` end-to-end, and bare-offset elem segments shipped in v1.1.3.
- [ ] **Tier D (still deferred)** — Element segments (`addElement` factory missing from binaryen-ts v1.0.9); start function (no `setStart`); tag exports (no `"tag"` variant on `WasmExport.kind`).

### Bridge design (locked in)

- **Direct recursion, not `ExprVisitorDelegate`-driven.** binaryen-ts
  constructors are bottom-up (children passed into composites). A recursive
  `bridgeExpr(e, ctx)` falls out cleanly; a delegate-driven walk would need
  its own operand stack to reassemble the tree, which is strictly more
  complex with no benefit. The earlier CLAUDE.md sequencing note that
  mentioned `ExprVisitorDelegate` was wrong — recursion is the right shape.
- **No intermediary format.** The bridge calls binaryen-ts constructors
  directly. No third IR.
- **`makeI64Const` takes `bigint`, not `number`** — handled in `bridgeConst`.

### Findings surfaced by the MVP / Tier A / Tier B / Tier C + wasmtk integration

Each round-trip test exercises the full pipeline (WAT parser → IR →
synthesizeTypes → bridge → binaryen-ts encoder → wabt-ts reader → wabt-ts
validator) and has caught real bugs that no narrower test exercised. For
the latest comprehensive list with file paths and regression-test
references, see the **Latent wabt-ts bugs surfaced by Phase 7 bridge
work + wasmtk integration** entry in the decisions log above (eight bugs
fixed across v1.0.3 → v1.0.7).

The short summary, grouped by what surfaced them:

- **MVP** — `readCodeSection` off-by-one; f32/f64 bit-vs-value
  representation mismatch.
- **Tier B** — `Load`/`AtomicLoad` arity-2 misclassification;
  load/store `align` unit mismatch (bytes vs. log2 exponent);
  `readTableSection` extension-peek byte misalignment.
- **wasmtk-driven** (v1.0.4–v1.0.7) — folded-form parser sub-expr loop
  ran before immediate consumption; function-local names silently
  discarded; `flushStack` reversed operand order;
  `synthesizeTypes` pass missing; `resolveNames` default case didn't
  recurse into operand children.

Known but not fixed:

- **Validator SIMD opcode-info gap.** `getOpcodeTypeInfo` defaults
  unknown opcodes to `(v128, v128) → v128`, mis-typing every SIMD op.
  Bridge produces correct binaries; V8 validates them; wabt-ts's own
  validator does not. Tier C SIMD tests bypass `validateModule` and
  use `WebAssembly.compile` directly.

### Expansion plan (tier-by-tier)

Each tier is independent — add a `case` in `bridgeExpr` (or a helper) and a
test in `tests/bridge/`. Throw with the expression kind named on any kind
not yet covered, so adding support means moving a throw to a case.

- **Tier A — core compute + control flow.** ✅ Done (2026-05-25).
- **Tier B — common patterns.** ✅ Done (2026-05-25).
- **Tier C — proposal-gated.** ✅ Partial (2026-05-25). Done: ref.null,
  ref.func, ref.is_null, v128.const, SIMD splat / lane-wise arith
  (via unary/binary), extract_lane, shuffle, SIMD memory ops
  (load_splat, load_zero, simd_load_lane, simd_store_lane), tag defs +
  throw + throw_ref + try_table cases. Deferred: ref.as_non_null,
  SIMD replace_lane, plain v128.load (binaryen-ts gap), try_table /
  throw_ref end-to-end tests (wabt-ts parser doesn't accept `(catch …)`
  clauses yet), tag imports + tag exports (binaryen-ts gap), GC. Each
  deferred kind throws "not yet supported" with the kind named.

### Bridge gotchas — running list (cumulative through Tier C)

1. **`makeBlock` / `makeIf` infer type from last child.** Early-exit blocks
   (last child is `br` / `return` / `unreachable`) come out typed as
   `unreachable`, which the encoder writes into the binary block_type slot
   verbatim — wrong when the WAT declares a result type. The bridge
   overrides via `withDeclaredType(expr, declared)`. Same fix-up applies
   to any new block-like constructor (`try_table` when EH lands).
2. **Compare → binary, convert → unary.** binaryen-ts has no
   `makeCompare` / `makeConvert`; `BinaryOp` / `UnaryOp` enum values are
   identical to wabt's `anyOpcodeName()` strings. One-line cases. Same
   trick works for SIMD lane-wise arithmetic and SIMD splat (the latter
   is classified as UnaryExpr by wabt, splat is a unary op in binaryen).
3. **`makeIf` has no label slot.** Labeled `if` targeted by `br` would
   silently lose its name; the bridge throws on `IfExpr.label !== ''`.
   Revisit when binaryen-ts grows a label slot or when a wasmtk-generated
   module needs labeled `if`.
4. **Block label names are stringly-typed in binaryen-ts.** A
   `BridgeCtx.labelStack: string[]` translates wabt's depth-based br
   targets to binaryen-ts's name targets. Anonymous blocks (empty label)
   get synthetic `$L0`, `$L1`, … via `nameForLabel`. Same will apply to
   `try_table` catch labels when EH lands.
5. **Align unit conversion.** wabt-ts IR stores `align` in bytes;
   binaryen-ts's encoder writes the wasm `memarg.align` exponent. The
   bridge's `alignBytesToExponent` does the `Math.log2`. Apply to any
   memory-touching instruction (SIMD load/store ops in the deferred
   Tier C subset, atomics, etc.).
6. **Anonymous-item names.** binaryen-ts cross-references items by
   string name. `synthesizeAnonymousNames` fills empty wabt names with
   `$F0` / `$G0` / `$T0`. Tags (EH) and heap types (GC) will need the
   same treatment when those tiers land.
7. **f32/f64 const are bits in wabt, value in binaryen-ts.** wabt-ts
   `Const` stores `bits: number` (f32) / `bits: bigint` (f64) — the raw
   IEEE 754 bit pattern. binaryen-ts `makeF32Const(value)` /
   `makeF64Const(value)` take the actual float. `bridgeConst`
   reinterprets via a shared buffer.
8. **`makeCall(target, operands, resultType)` only supports ≤ 1 result.**
   The bridge throws "multi-value call not yet supported" if a wabt sig
   has `results.length > 1`. Same for `makeCallIndirect`.
9. **`call_indirect` table arg is a string name in binaryen-ts.** The
   bridge looks up the table name from `ctx.tableNames` (which
   `synthesizeAnonymousNames` populated with `$T0` for an anonymous
   `(table 1 funcref)`).
10. **`ref.null` refType is a name-var.** wabt parses `(ref.null
    funcref)` / `(ref.null extern)` as `RefNullExpr { refType: Var
    { kind: 'name', name: "funcref" | "extern" | … } }`. The bridge's
    `refTypeVarToValType` translates to a binaryen-ts `ValType`.

Out of scope (each currently throws with a clear "not yet supported"):
element segments, data segments, exports of memory / table / tag, start
function, custom sections.

### Reference: stable constructor surface

See `CLAUDE.md` → "binaryang Cross-Project Architecture" → "binaryen-ts
constructor API" for the authoritative reference. Read
`binaryen-ts/src/ir/expressions.ts` and `binaryen-ts/src/ir/module.ts`
directly when adding new cases — the CLAUDE.md snippet is illustrative,
not exhaustive.

---

## Phase 8 — wasm2ts (New Module) ⬜ — deferred pending wasmtk QA/QC

New work — no C++ counterpart. Modeled on `wasm2c` (`upstream/src/c-writer.cc`)
but targets TypeScript output.

### Phase 8 source files

- [ ] `src/writer/ts-writer.ts` — wasm-to-TypeScript code generator

### Design notes

- Input: binary wasm module parsed via Phase 3 reader
- Output: idiomatic TypeScript class with typed imports/exports interface
- Wasm → TypeScript type mapping: see CLAUDE.md Phase 8 section

### wasmtk reverse-compilation reference

wasmtk (`wasmtk/` submodule, `https://github.com/jrmarcum/wasmtk.git`) already
compiles TypeScript → WAT. wasm2ts is the reverse of that pipeline:

```text
wasmtk:  TypeScript  →  WAT  →  wasm binary
wasm2ts: wasm binary →  IR   →  TypeScript
```

**Key design principle:** wasm2ts output should be TypeScript that wasmtk can
compile back to equivalent WAT. Study `wasmtk/` to understand:

- What TypeScript patterns wasmtk recognises (functions, exports, imports, globals)
- What WAT each pattern compiles to
- Use those same mappings in reverse for wasm2ts code generation

This creates a useful round-trip verification: TS → WAT (wasmtk) → wasm → TS
(wasm2ts) → WAT (wasmtk) should produce semantically equivalent WAT at each
cycle. Any divergence in the second WAT output is a code-gen bug.

### C++ reference

- `upstream/src/c-writer.cc` — structural model (replace C emit with TS emit)
