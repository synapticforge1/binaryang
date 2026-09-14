# wabt-ts — the predecessor's memory, summarized

wabt-ts brought a wing of 12 files (13,219 lines) into the merge, at `cmem/wabt-ts/`. On 2026-09-14
it was **corrected and summarized into this one file**, and the directory was removed. The policy
is in [INDEX.md](INDEX.md) § "Cleanup policy": cmem is working memory, and git is the archive.

**How to read it.** There is one section per wing file. Each section says what the file was and how
it ended, then gives:

- **Kept** — what still matters, tagged by kind:
  - `[decision]`
  - `[lesson]`
  - `[reference]`
  - `[trigger]` — a condition that makes something act
  - `[baseline]` — a measurement to compare against
  - `[correction]` — a wing claim that is no longer true
  - `[open]`
- **Already in the core** — pointers to where the rest lives now.
- **History** — a summary, with commits.
- **Full text** — the whole file, one command away: `git show 9758fc736:cmem/wabt-ts/<file>`.

**What was corrected, not just shortened:**

- **Paths.** Every file path was rewritten to this tree and checked with `git ls-files` on
  `c6bbf7d71`:
  - `src/<x>` → `src/wabt-ts/<x>`, and `tests/<x>` → `tests/wabt-ts/<x>`.
  - `src/bridge/binaryen-bridge.ts` → `src/bridge/bridge.ts`.
  - The release scripts → `scripts/release/`; the wabt-ts tooling → `scripts/wabt-ts/`.
  - C++ citations → `WebAssembly/wabt/…`.
- **Wing claims the code has overtaken** are marked `[correction]`.

**The full texts are not corrected.** They keep the dead `foo_test.ts` paths and the pre-merge
layout, so translate a path from them before following it.

**Open items this summary found** are not kept here. They were verified and moved to
[open-work.md](open-work.md).

**The T-id index** (in the first section) covers every T-id cited anywhere outside the wing. Code,
tests and commit messages cite T-ids, UP-n and the named bugs, so look them up here first.

## `wabt-ts/tasks.md` (6,760 lines) — the wabt-ts task ledger: T-ids, the conformance campaign, the UP-n upstream log, the decisions log and wabt-ts Phases 1–8

The granular status and decision log of wabt-ts, relocated from the repo-root `TASKS.md` on 2026-06-09.
Top to bottom it holds: the tranche ledger (T1–T13.50) with its numbering rules; the 2026-08-20 →
08-25 conformance campaign (parse-clean → V8-validity → validator agreement → round-trip → execution →
`assert_malformed` → diagnostics, then post-1.4.0 enumeration and hardening passes T13.11–T13.44); the
binaryen-ts upstream log UP-1…UP-7; dated tranche narratives (T1–T7); the 2026-06-09 silent-corruption
audit summary; the wabt-ts Decisions Log; and wabt-ts Phases 1–8 (Phase 7 = bridge, Phase 8 = `wasm2ts`).
It ended at the merge with every tranche closed except T13.50, recorded as post-merge work; T13.50
closed in 1.5.2 (`50a959baa`). Nothing in the ledger is open today; what this summary found still open
in the code is in [open-work.md](open-work.md).

### T-id index — every T-id cited outside the ledger (T1–T5 and T11 added for completeness)

| id | what it was, and how it closed | commit(s) |
| --- | --- | --- |
| T1 | numeric literals: negative hex, optional hex-float exponent, NaN-payload `_` — +25 files (120→145/257) | `a612bba95` |
| T2 | small grammar gaps + the four GC array bulk ops from scratch — +34 (→179) | `e1f7f4562` |
| T3 | multi-memory: bare memidx, `resolveMemoryVar`, `memory.init` index swap — +35 (→214) | `95623ca2e` |
| T4 | table64 / memory64 index types + table definition shapes — +16 (→230) | `7f84d430b` |
| T5 | GC `(rec …)` / `(sub …)` — parse +7, encode +5 | `1c3f60ac3` |
| T5.1 | `any.convert_extern` / `extern.convert_any` — parse +1, encode +1 | `717422d76` |
| T5.2 | abbreviated heap-type immediate (`ref.cast i31ref`) — parse +3, encode +3 | `a37ee51d0` |
| T5.3 | `br_on_cast` / `br_on_cast_fail`, never implemented — parse 257/257, encode +2 | `d5c5bd386` |
| T6.1 | block params / multi-value block results — absorbed during T7 (batch 2) | `777d09977` |
| T6.2 | elem segment typed-ref element types — absorbed during T4 | `7f84d430b` |
| T6.3 | table inline-elem forms — absorbed during T4 | `7f84d430b` |
| T6.4 | `(module definition …)` / `(module instance …)` — parse +5, encode +5 | `a37ee51d0` |
| T6.5 | `(@annotation …)` skipped in the lexer — parse +1, encode +1 | `23201d267` |
| T7.1 | parser robustness: never throw, never hang (`noProgress`, `runParse` backstop), readable token names | `a612bba95` |
| T7.2 | packed-type wire bytes (i8/i16 = 0x78/0x77); `br_table` index and `try_table` catch name resolution | `d30b8599b` |
| T7.3 | quoted ids = bare ids; raw non-ASCII → UTF-8; `(type $t)` supplies the signature; multi-value block types — +3 parse, +5 encode | `777d09977` |
| T7.4 | typed-ref IR refactor: `ValueType = Type \| RefValueType` — encode +13 | `2ae54f811` |
| T7.5 | multi-value `br` / `br_if` / `br_table` (values arrays; `br_table` index is the LAST operand) — encode +14 | `959e4e18c` |
| T7.6 | `try_table` catch target depth resolved one frame too deep — encode +2 | `eb886644d` |
| T7.7 | relaxed SIMD aliased onto low SIMD opcodes: `(prefix<<8)\|sub` packing too narrow — encode +7 | `254ef844b` |
| T7.8 | type-uses resolved against an incomplete type index space — encode +6 | `d08e4d715` |
| T7.9 | `return_call_indirect` tail-call types (2) — **not defined in tasks.md**; ledger commit `a34a78e4a`, closed as a side effect of T7.8 | `d08e4d715` |
| T7.10 | "seven singles" — **not defined in tasks.md**; ledger commit `a34a78e4a`, re-scoped into T7.11–T7.14 | `d08e4d715` |
| T7.11 | element segments against a non-nullable table — encode +2 (later narrowed by T11) | `46fdda15a` |
| T7.12 | `br_on_null` / `br_on_non_null` carrying branch values — encode +2 | `85d45ff91` |
| T7.13 | UTF-8 BOM stripped from names — encode +1 | `85d45ff91` |
| T7.14 | explicit type-use overwritten by a structural signature match — encode +1 | `85d45ff91` |
| T8.1 | block type-use + inline signature | `a3086e583` |
| T8.2 | `select` with several result groups | `a3086e583` |
| T8.3 | WAT writer emitted a multi-instruction const expr as one folded paren (found via T5.1) | `717422d76` |
| T8.4 | tag declared with a type-use | `a3086e583` |
| T8.5 | folded `if` condition spanning several instructions | `a3086e583` |
| T9.1 | binary reader had no `pushStmt` — silent statement reordering; round-trip INVALID 60→27 | `103f26d0a` |
| T9.2 | validator vs V8: seven bugs over 418 modules (ungated MVP rules, dead SIMD table keys…) — agreement 1702→2120/2120 | `9da012683` |
| T9.3 | validator onto `ValueType`; real reference subtyping (canonical rec-group keys) | `d2bc97bda` |
| T9.4 | the 10 valid modules T9.3's lattice rejected — each a second hidden bug; agreement back to 2120 | `c5fe0af81` |
| T9.5 | invalid modules validated clean (arity-less `checkSignature`, 32-bit page limit, memarg offset); harness read `errors` not `result` | `e8072c8b9` |
| T9.6 | module-level structural checks (SIMD align, lane indices, immutability, final supertypes, const exprs) | `7b3a96afd` |
| T9.7 | declared subtyping checked structurally; `ref.eq`, `select`, defaultability, type scope | `a22383e3f` |
| T9.8 | one-armed `if` arity; `try_table` catch-clause label types | `613e2205b` |
| T9.9 | immediate-vs-immediate rules; local-init = frame-scoped rollback (not join intersection) | `44cd27880` |
| T9.10 | last invalid modules V8 rejects (`call_ref` named type, function-table check, elem type) — ours: 0 remaining | `0c4548022` |
| T9.11 | ten memarg handlers never checked `offset` (lint "unused var" was the finding) — 4 SIMD false accepts | `7dee7aba1` |
| T10.1 | export ORDER lost across `wasm2wat` (inline exports) — `buildExportMap` feasibility test; WASI 1→50/270 | `67d043ba1` |
| T10.2 | inline `(export …)` emitted on IMPORTS — our parser rejected our output; same fix | `67d043ba1` |
| T10.3 | non-nullable table lost `Table.init` — `writeFoldedConstExpr`, fail-loud on the inexpressible | `d0dc93639` |
| T10.4 | printer stripped the NaN quiet bit; `return_call_indirect` lost its table index → round-trip 2120/2120 | `9f4eb7765` |
| T10.5 | filed against the reader; was linear `call` draining the whole stack — deferred body parsing; WASI 50→225 | `4c82749b6` |
| T10.6 | linear `try_table` was a stub; `array.new_fixed` drained the stack | `24e637a5a` |
| T10.7 | `tagTypeIndex` compared typed-ref params by `===`, so encode threw — hard failures 1→0 | `9f4eb7765` |
| T10.8 | synthesized slot-filler written as a real `nop` — `NopExpr.placeholder`; WASI 270/270 | `a38ce8bc5` |
| T11 | pipeline REPAIRED an invalid module (funcidx elemlist is `(ref func)`) in five layers | `50472d6c0` |
| T12.1 | out-of-range int/float constants wrapped/overflowed silently — malformed 666→698/1229 | `ac28aca92` |
| T12.2 | import after a definition accepted and RENUMBERED the module — →714 | `bbf05942b` |
| T12.3 | non-power-of-two `align=` accepted and CHANGED (`align=3` → 2) — →828 | `13a9ed889` |
| T12.4 | SIMD lane immediates / `v128.const` lane values wrapped (`-129` → 127) — →869 | `f1efacba8` |
| T12.5 | names not checked as UTF-8 on either path — quoted →1045, binary 110→638/711 | `1760a05a2` |
| T12.6 | missing lane immediate compiled as lane 0; `nan:canonical`/`arithmetic` accepted as literals — →1087 | `9e931cf07` |
| T12.7 | annotation, closing label, inline signature read and discarded — →1183; closed T12.6's remainder | `4eea96063` |
| T12.8 | binary reader resynchronised instead of reporting — binary 711/711, metric closed | `40df4d513` |
| T12.9 | duplicate ids, `nan:0x0`, lane signs, token boundaries, 2nd `(start)`, forward type use — 1227/1229 parser, 1229 via `wat2wasm` | `013e9b7fd` |
| T13.1 | out-of-scope branch target is a PARSER error (`checkLabelScopes`) — quoted 1229/1229 at the parser | `dad8dca75` |
| T13.2 | the last 19 `assert_invalid`: 16 were the ENCODER repairing them (u32 wrap, `ensureTypeFor`, rec-group reuse) — 2683/2683 | `dad8dca75` |
| T13.3 | `Limits.initial`/`max` → `bigint` (breaking by design) — V8-valid 2118→2119/2120 | `f548e66e3` |
| T13.4 | custom page sizes end to end (`pageSizeLog2`, only 1 and 65536) — no metric covers it; modelled on wazmrt | `40554a56f` |
| T13.5 | three reserved bytes read into nowhere (tag attribute ×2, table `0x40 0x00`) — found by grepping the shape | `9e844eb1b` |
| T13.6 | review pass, clean; lexer⇄printer and natural-alignment audits made permanent tests | `6841d4480` |
| T13.7 | a NAMED reference in every grammar position — 64 cases; 21 fail at v1.3.5 | test added in `390fab905` |
| T13.8 | `instrInputCount` one too high for atomic store/rmw/cmpxchg — `wasm2wat` emitted invalid wasm | `390fab905` |
| T13.9 | validator typed every atomic as `(v128,v128)→v128` (no `PREFIX_THREADS` branch) — 67 opcodes agree with V8 | `fbe60e836` |
| T13.10 | 9 of 21 feature flags gated nothing — gates at point of use + `checkValueType`; `--enable-*` CLI flags | `5b31ade4b` |
| T13.11 | `resolveNames` never walked `table.get`'s index sub-expression; T13.7's guard held operands fixed | `4e9610227` |
| T13.12 | the two signed LEB encoders still wrapped out-of-range input | `4e9610227` |
| T13.13 | T13.7's guard varied one axis; operand axis added (69 cases, clean) and 2 of its fixtures were invalid wasm | `4e9610227` |
| T13.14 | 12 GC operand false accepts a sibling handler already checked (cast hierarchy, i31, is_null, as_non_null, packedness) | `4e9610227` |
| T13.15 | SIMD lane memory ops ignored the memory index type — wrong in both directions on memory64 | `4e9610227` |
| T13.16 | `data.drop`/`elem.drop` in the arity-1 group swallowed and DELETED the preceding value | `4e9610227` |
| T13.17 | `rethrow` ignored its depth (must name a catch frame); V8 the only available oracle | `4e9610227` |
| T13.18 | dead `getOpcodeNaturalAlign` removed; `instrInputCount` made total behind a source-enumeration gate; 3 axes clean | `4e9610227` |
| T13.19 | ledger self-description (numbering procedure, status vocabulary); INTENT blocks on 3 membership sections | `4e9610227` |
| T13.20 | `applyNames` walked 37 of 87 kinds — axis 1 made generic, axis 2 an explicit 55-kind table | `4e9610227` |
| T13.21 | `constExprOperands` ⇄ `writeInstrHead` coupling (latent) — INTENT blocks + source gate | `4e9610227` |
| T13.22 | bridge resolved `try_table` catches after pushing its own label — cancelled binaryen-ts 1.0.9's off-by-one; BLOCKED, then fixed atomically with the 1.5.0 pin (T13.47) | `23f312990` WIP, `8e6701519` |
| T13.23 | binaryen-ts pin `^1.0.9` held only by the lockfile → EXACT; two upstream notes resolved (exposure nil) | `4e9610227` |
| T13.24 | bridge pushed no label frame for `if` — `br` wrong both ways; `IF_FRAME` sentinel, branch to unlabeled `if` throws | `4e9610227` |
| T13.25 | a NUL byte made the bridge file BINARY to grep, and a sweep reported clean — `source_hygiene` gate | `4e9610227` |
| T13.26 | `readMemArg` used `1 << exp`: exponent 32 wrapped to align=1 and the round trip repaired it — `assert_invalid` 2671→2673 | `4e9610227` |
| T13.27 | NO DEFECTS FOUND: six axes over the binary reader and `wasm-strip` | `4e9610227` |
| T13.28 | hygiene gate extended to `cmem/` + `README.md` (a `\b` had become a backspace); `ModuleContext.getExprArity` found dead | `4e9610227` |
| T13.29 | four binary tools threw `RangeError` on ~102 of 585 malformed inputs — converted at the reader boundary | `4e9610227` |
| T13.30 | `/compat` `toBinary` threw the writer's raw string — now names its origin, documented | `4e9610227` |
| T13.31 | every CLI shim dumped a Deno stack trace on a bad path — `cliRead`/`cliWrite` | `4e9610227` |
| T13.32 | NO DEFECTS FOUND: lexer token reachability (182 members) — pinned by a gate anyway | `4e9610227` |
| T13.33 | `readTypeSection` bound in the loop CONDITION silently truncated count/content mismatches | `4e9610227` |
| T13.34 | subtyping depth > 63 and supertype cycles accepted — `checkSubtypingDepth` | `4e9610227` |
| T13.35 | NO DEFECTS FOUND: size amplification, string scaling clean; diagnostic OFFSET accuracy INCONCLUSIVE (oracle wrong) | `4e9610227` |
| T13.36 | NO DEFECTS FOUND: module-level state, text-side convergence, gate vacuity; corrected "hardening does not decay" | `4e9610227` |
| T13.37 | spec `assert_malformed` expected texts used as oracle: magic-before-version ordering; two LEB faults named apart — 608→689/711 | `4e9610227` |
| T13.38 | a misspelled instruction was blamed on a parenthesis / leaked `Reserved` — `unknown operator "…"`; parser wording 559→816/1229 | `4e9610227` |
| T13.39 | session harnesses omitted `synthesizeTypes` — every absolute figure that session was wrong (agreement 2207/2207, `assert_invalid` 2694/2694) | `4e9610227` |
| T13.40 | every section header padded to a 5-byte LEB (upstream canonicalises) — WASI corpus −3.2%; round-trip metric split by input source | `4e9610227` |
| T13.41 | `wasm-strip` relocated every kept custom section to the end — `Custom.precedingSection`; `--sections` 0→265/265; ninth metric | `4e9610227` |
| T13.42 | the documented per-file format check ignored `deno.json` (width 80) — two CI-failing files hidden | `4e9610227` |
| T13.43 | `deno task publish` would release a bare version bump from a dirty tree — dirty-tree + remote-tag guards | `4e9610227` |
| T13.44 | the guard's WIRING gated (called before any mutating git command, exits, stays side-effect free) | `4e9610227` |
| T13.45 | wasmtk snapshot "provenance unknown" was one `git log` away — stamped (`fbafca9e`, 2026-05-25) and gated | `68084e476` |
| T13.46 | corpus regenerated from wasmtk `4600ba9`: 272→421 (413 wasic + 8 other); `KNOWN_INVALID` emptied | `162904ba9` |
| T13.47 | binaryen-ts 1.5.0 pin + T13.22 fix in one merge; the 12 bridge failures were two defects (coarsened sigs, undeclared func heap types) — bridge 28/28 | `8e6701519`, merge `5404946dd` |
| T13.48 | `deno task bump --dry-run` performed a real bump (script read no args) — dry run real, unknown args exit 2 | `cf3b99465` |
| T13.49 | pre-merge audit: de-coarsening incomplete (24 vs 5 sites), 5 colliding `src/` dirs, config cost 4 type errors | `002e520e2` |
| T13.50 | finish the bridge de-coarsening (import/tag `(ref $T)` params; `(ref null $T)` global) — OPEN at merge; closed 1.5.2 | scoped `a3d71be50`, closed `50a959baa` |
| T13.50b | **not defined in tasks.md.** Row 3 of T13.50 split out: `ref.null` with a user-defined heap type refused by the bridge — cited by `src/bridge/bridge.ts` and `tests/bridge/gc_decoarsening.test.ts`; fixed in the same commit | `50a959baa` |
| T13.51 | **not defined in tasks.md.** The four `br_on_*` bridge cases — three defects, two outside the bridge (func_type blocktype refusal, inline typed-ref blocktype, undeclared blocktype func heap types); cited by `src/bridge/bridge.ts` | `7ff0408f4` |

Commits are verified by `git log` subject (or message, for T7.12–T7.14 and T13.7); the source file
records only `d30b8599`, `5404946d`, `23f31299`. T13.11–T13.44 landed as ONE commit.

### UP-n index — binaryen-ts findings filed from wabt-ts (this file defines them)

| id | finding (measured severity) | fixed in binaryen-ts history |
| --- | --- | --- |
| UP-1 | `struct.get_u`/`array.get_u` collapsed onto `get` — valid wasm round-trips INVALID (wrong-output) | `dd88e034b`; shipped 1.5.0 (T13.47 flipped two tests that pinned it) |
| UP-2 | `tuple.make`: enum entry, no factory, no encoder case (gap) | `b27176ae1` |
| UP-3 | four GC array bulk ops: no factory, no encoder case (gap) | `f664ba579` |
| UP-4 | `ref.as_non_null`: not even an `ExpressionKind` (gap) | `f664ba579` |
| UP-5 | start function silently DROPPED on round-trip — the most severe, and silent (wrong-output) | `dd88e034b` |
| UP-6 | `WasmImport.kind` had no `"tag"` (gap) | `f664ba579` |
| UP-7 | typed-ref LOCAL read back as `anyref` (`readValTypeByte`) — restated twice (wrong-output) | `979a18e66` |

Report: `scripts/wabt-ts/binaryen-ts-upstream-report.md`. Lessons: re-verify against the actual checkout
before filing (three of seven entries changed); **re-verifying is not re-ranking** — we ranked the loud
failures above the silent one; we reviewed their code without the round-trip metric we had built for
ourselves, and all three wrong-bytes findings lived on that path.

**Kept**

Numbering and status (T13.19) — still in use: code cites T13.50b and T13.51, allocated after the merge.
- [decision] A decimal extends a tranche's area, a new integer opens one; **never renumber a closed id**
  (commit messages cite them). Take the max over the index AND `src/`/`tests/`; write a placeholder,
  never a literal example id, in any text a lookup scans (the example matched its own search, T13.19).
- [decision] Status vocabulary: `DONE` (fixed, regression-gated, metrics re-measured); struck-through =
  absorbed, never deleted; `RETRACTED` keeps the wrong claim with its correction; `NO DEFECTS FOUND`
  gets an id and says what was varied (T13.27); `BLOCKED (…)` names its unblocking trigger, and its row
  says "BLOCKED, not done" (T13.22). Every item gets an index row, not just a write-up.

The invariants the T-ids paid for are kept once, in § `wabt-ts/design-decisions.md` below; the method
lessons in § `wabt-ts/best-practices.md`; the campaign figures in § `wabt-ts/testing.md`. What
none of those holds:
- [decision] Out of scope, do not port without revisiting: `wasm-interp` (and `src/wabt-ts/interp/` stays
  a placeholder), `spectest-interp`, `wasm2c`, `wasm-link` (wasmtk's wasmbundler), `wasm-decompiler`,
  fuzzers. wabt-ts is not compiled to wasm itself.
- [lesson] A mutating script must treat an unrecognised flag as refusal, never consent (T13.48; verified in
  `scripts/release/bump_version.ts`).

Triggers — the day X happens, Y is exposed
- [trigger] `src/wabt-ts/` has no module-scope `let`/`var`. The scratch buffers in
  `parser/wast-parser.ts` (`F32_BUF`/`F64_BUF` and their `DataView`s `F32_VIEW`/`F64_VIEW`) are safe only
  because the parser has zero `await`; the day it gains one, they are a live interleaving hazard (T13.36).
- [trigger] `generateLabelNames` walks only block-like kinds — benign because `wasm2wat`'s IR comes from the
  reader (blocks in statement position) and unnamed labels are legal. If either changes, re-check (T13.21).
- [trigger] `varArityForTok` resolves `call`/`return_call`/`array.new_fixed`; `br`, `return`, `throw`,
  `call_indirect`, `call_ref`, `struct.new` still drain the stack (-1). Extend it the day a measurement
  shows one (T10.5; verified in `src/wabt-ts/parser/wast-parser.ts:1406`).
- [trigger] wasmtk's Go-leaf memory floor "two pages so byte 65536 exists" (TinyGo's init flag) is false
  under `(pagesize 1)`; its WAT regex `\(memory\s+\(export "memory"\)\s+(\d+)\)` never matches our writer's
  `(memory (;0;) …)` spelling. Carried to wasmtk; not ours to fix, status there not re-checked.

Reference the code still relies on
- [reference] Named bugs cited from code/tests: **Bug D** — empty-folded ops (`(local.set $x)`) pop the deficit
  from the enclosing stack (v1.1.6, `empty_folded.test.ts`); **Bug F** — that pop clamped to what the stack
  holds (v1.1.7); **Bug C** — decimal `f32.const` literals rounded twice (via f64), fixed by rounding the exact
  rational once, `decimalToBits` (`5854cc27d`, `decimal_float_rounding.test.ts`; the last of three wasmtk
  spec-runner `const.wast` bugs after A, `br_if`, and B, hex-float); **Bug G** — `call_indirect (type $name)` typeVar never resolved → index 0 (v1.2.0,
  `bug_g_repro.test.ts`). Standing guard for the class: no name-var survives `resolveNames`
  (`tests/wabt-ts/ir/encode_correctness.test.ts`; `ref.null.refType` the one exception).
- [reference] `/compat`: `parseWat` ignores its features bag (`_features`), so partial feature bags equal
  `enable_all`; the facade exposes no `Limits` and no IR, so T13.3/T13.4 never reached wasmtk.
- [reference] Cross-engine support for what we emit (2026-08-24; Wasmtime 47.0.3, V8/Node 24.19, Bun 1.3.14,
  Wasmer 7.2.1, wazero 1.12.0): memory64/table64 fail on Bun, Wasmer and wazero; GC, multi-memory, tail call,
  EH fail on wazero; custom page sizes run on Wasmtime only; **wazero's CLI rejects any module with a tag
  section**, legacy or `try_table`; Wasmtime and Wasmer refuse legacy `try` outright (no `-W` switch).

Corrections someone could re-derive wrongly
- [correction] The 7 `KNOWN_INVALID` wasmtk modules were STALE SNAPSHOT BYTES, not wasic bugs; the
  `$__exn_tag`/`needsExceptionTag` finding was retracted; legacy-EH scope was 10 modules, not 6.
- [correction] The 19 "V8-accepts" `assert_invalid` leftovers were mostly our encoder repairing modules (T13.2).
- [correction] Six `ours=ACCEPT / V8=reject` size cases are V8 implementation limits — Wasmtime accepts all
  six; adding limits would reject valid modules (T13.35).
- [correction] Diagnostic offsets: T13.35's "offset must not precede the corruption" oracle is false for any
  multi-byte construct — reporting a LEB's start is better → measured since as A3 (core).
- [correction] `ModuleContext.getExprArity` (published via `src/wabt-ts/ir/ir-util.ts`) has no production
  caller — only `tests/wabt-ts/audit/silent_corruption_fixes.test.ts` — so its precomputed maps are NOT a
  hot path, and are kept only because `ir-util.ts` is public API. T13.28 corrected the wing, not the code:
  the class doc ("reused across validator, binary writer, and bridge") and the field comment at
  `ir-util.ts:86-90` ("getExprArity calls them for every expression during validator and writer walks")
  are still false → [open-work.md](open-work.md).
- [correction] Phase 3's "DataCount always written if data exists" is superseded by W6 (upstream rule) →
  divergences.md closed table.

**Already in the core** — pointers only:
- Three-engine panel, and legacy EH has V8 as its only oracle (T13.17) → cmem/testing.md § "A fixture believed valid must be said to an engine" (Wasmtime as the accept/reject authority, 2026-08-21 `68842242d`, is not stated as such in the core — kept here as a decision)
- A harness must call the real entry point (T13.39); print what a harness SKIPS (execution harness) → cmem/testing.md §§ "A harness must call the real entry point", "Print what a harness SKIPS"
- Every test has an axis (T13.11/T13.13); four corpus-free tests (atomics blind spot, folded/linear differential of T13.8) → cmem/testing.md §§ "Every test has an AXIS…", "Four tests that need neither a corpus nor an oracle"
- Every metric is blind to something (agreement counts false rejections only; `wat2wasm` does not validate) → cmem/testing.md § "Every metric is blind to something — record what"
- Clean / measured / UNMEASURED; A3 offsets measured → cmem/testing.md §§ "Three states, not two", "A3 — diagnostic offsets are MEASURED"
- wasmtk corpus is a snapshot; regenerate before claiming anything about wasic (T13.45/T13.46) → cmem/testing.md § "The wasmtk corpus is a SNAPSHOT…"; `tests/wabt-ts/wasmtk/PROVENANCE.md` (421 = 413 + 8, 373-vs-413 unreconciled)
- Release guard + wiring tests (T13.43/T13.44); dirty-tree recovery → cmem/testing.md § "The release path is tested, and needs two tests"; cmem/publishing.md § "A dirty tree ships a release containing none of the work"
- `publish:dry` is not in `deno task test` (T13.3's slow-types break) → cmem/publishing.md § "`publish:dry` is in CI but NOT in `deno task test`"
- Never run `deno publish` locally / CI calls `deno publish` directly (OIDC); sub-version cap at 9 → cmem/publishing.md §§ "Never run `deno publish` locally", "Version rule — sub-version capped at 9"
- `minimumDependencyAge` decision (T13.47 Blocker 1) → cmem/project.md, cmem/publishing.md § "Consumers hit a 24-hour wall"
- JSR license MIT not compound → cmem/licensing.md
- CRLF / `deno fmt --check` false alarm and `git stash` EOL rewrite (T13.24, T13.42) → cmem/testing.md § "The `deno fmt --check` line-ending false alarm is RETIRED"; cmem/best-practices.md § "Pin every environment-dependent default in the repository…"
- Heredoc corrupts content (T13.28 root cause) → cmem/best-practices.md § "Do not author file CONTENT through a shell heredoc"
- Resolution of a pinned version vs a fresh cache (related to T13.23, not the same rule) → cmem/best-practices.md § "`--reload` does not invalidate a resolved VERSION…"
- Invert every gate before trusting it (T13.24's guard-the-guard, T13.42) → cmem/testing.md § "Invert every gate before trusting it"
- T13.22 closed before the merge; T13.50/A1 closed 1.5.2 with its two lessons; bridge not exported → cmem/ir-convergence.md (bridge + WAT routes summary)
- Diagnostic wording figures; "a snapshot headed now silently becomes false"; the coupling lesson → cmem/project.md § "Live gaps carried from the predecessors"
- `wasm2ts` stub, WASI Preview 1 goal (wabt-ts Phase 8) → cmem/project.md § "Live gaps…", cmem/open-work.md § "Repo work" (A2)
- Custom-section placement divergences (C2–C6), relocation-padded LEBs (L1), DataCount (W6) → cmem/divergences.md
- Wing test-file paths use the dead `_test.ts` form → cmem/testing.md § "Every test-file path in the wing full texts is DEAD"
- Per-invariant metric tables and the hardening-axis states → § `wabt-ts/testing.md` below

**History, summarized:**
- 2026-05-21 → 05-28: wabt-ts Phases 1–6 (core, IR as discriminated union, single-class binary reader,
  linear WAT writer, three-layer validator, CLI tools), 6.1 (CI, lint 71→0, perf invariants), 6.2 (release
  flow, first JSR publish); Phase 7 bridge MVP and Tiers A–D; 26 wasmtk-driven latent bugs v1.0.3→v1.3.1
  (folded immediates, local names, `flushStack` order, `synthesizeTypes`, SIMD name-table regen via
  `scripts/wabt-ts/gen_simd_opcode_table.ts` + `audit_opcodes.ts`, f64 integer literals, Bug D/F/G, legacy
  `TryExpr`, statement sinking past `return`, hex-float parsed as 0). Phase 1 integration 38/38 at 1.1.8.
- 2026-06-09: two-round silent-corruption audit (~18 fixes; `writeVar` fail-loud) → § "2026-06-09
  silent-corruption audit" below; regressions `tests/wabt-ts/audit/silent_corruption_fixes*.test.ts`.
- 2026-08-20: parse gap scoped (120/257, 19 repro-confirmed causes, calibrated tranche projections T1–T6).
- 2026-08-21: T1–T4, T7 blind spot (parse metric cannot see encode), typed-ref refactor, multi-value branches,
  T5/T6/T8, T9.1–T9.10, T11; Wasmtime made authority (`68842242d`); WASI p1 goal measured (1/270 round-trip).
- 2026-08-24: T10 closed (2120/2120, WASI 270/270), execution metric, T9.11, post-campaign audit (wide
  arithmetic both ways, dead `Validator.refNullType`), `assert_malformed` metric and T12 (666 → 1229/1229,
  711/711), T13.1–T13.10; UP-1…UP-7 filed and answered; 1.4.0 (`02713fa8e`).
- 2026-08-25: post-1.4.0 enumeration and hardening passes T13.11–T13.44 (`4e9610227`), provenance and corpus
  refresh T13.45/T13.46; 1.4.1.
- 2026-08-26: 1.5.0 upgrade T13.47 (`5404946dd`), T13.48, pre-merge audit T13.49, T13.50 scoped; merge.

Full text: `git show 9758fc736:cmem/wabt-ts/tasks.md`

## `wabt-ts/design-decisions.md` (1,149 lines) — the load-bearing invariants of wabt-ts, each with its reason and regression test

The wabt-ts rulebook: invariants that a refactor or an upstream port could silently undo, grouped by
subsystem, each naming the bug that paid for it and the test that pins it. Built up from the v1.1.x
bug fixes, a six-round silent-corruption audit (2026-06-09), and the T10/T12/T13 campaigns
(2026-08-24/25). Nearly all of it is live: every cited test still exists under `tests/wabt-ts/`,
and almost none of it is in the core. Each item is compressed hard; the reasoning and the incident
behind it are in the full text.

**Kept.** Unless marked otherwise, `src/` paths are under `src/wabt-ts/`:

### 2026-06-09 silent-corruption audit

Five tests cite this heading: `tests/wabt-ts/audit/silent_corruption_fixes{,_round2,_round3,_round4,_round5}.test.ts`.
The invariants from each round:
- **Round 1** [decision]: the lexer's SIMD opcode values must equal `core/opcode.ts`, which is the source of truth.
  Tag type indices come from the signature and are never hardcoded to 0 (`tagTypeIndex`, `resolveTagSig`).
  The tag-IMPORT decode must consume the attribute byte. SIMD memory decode goes by exact range:
  `0x00-06` load, `07-0a` load_splat, `0b` v128.store, `5c/5d` load_zero. `resolveNames` resolves
  `call_ref`/`return_call_ref` `sigType`. `trunc_sat` is typed via `getMiscOpcodeTypeInfo`. A legacy
  multi-`catch` assigns each body before opening the next. Lane ops are validated per opcode, with the
  lane range-checked. The WAT writer uses the central `naturalAlignForOpcode`. `applyNames` never
  rewrites `local.get` through `funcNames`. Table init exprs (`0x40 0x00 reftype limits expr`) are
  resolved and emitted.
- **Round 2** [decision]: **`writeVar` is fail-loud on a name-form var** (`writer/binary-writer.ts`),
  which is the root of the Bug-G family, so `resolveNames` completeness is load-bearing. `resolveNames`
  walks `simd_lane_op.value`, elem `tableVar` and data `memoryVar`. SIMD reader arity is per opcode
  (`SIMD_UNARY_OPS`; `v128.bitselect` 0x52 is ternary). `load_lane` is `0x54-57` and `store_lane` is
  `0x58-5b`. `parseLimits` detects `i64` (memory64). An unknown `try_table` catch kind fails loud.
- **Round 3** [decision]: the LEB128 decoders reject an over-range terminating byte (`core/leb128.ts`).
  `parseNatText` strips ALL `_`, and a malformed literal is a parse error, never a `?? 0` default. The
  canonical quiet NaN prints as bare `nan`. `varIndexValue` is fail-loud for segment vars. Active
  table-0 elem uses flags 4 only for funcref, else 6. A `declared` data segment throws. Atomic memargs
  use `naturalAlignForOpcode`. `onTag` propagates `Result.Error`. Bridge `replace_lane` throws on a
  missing value.
- **Round 4** [decision]: a tail call's callee results must equal the ENCLOSING function's results
  (`popAndCheckReturnCall`). `return_call_ref` pops the function reference (`onReturnCallRef`).
  `try_table` catch tags are bounds-checked. `onAtomicFence` propagates the error. The lexer is
  fail-loud on an unterminated string, a bare `$`, and an empty `\u{}`.
- **Round 5** [decision]: `generateNames` (`ir/generate-names.ts`) names carry the leading `$`, keep
  a per-namespace prefix (`$fa`), and are disambiguated against user names (`_1`, `_2`…). The permanent
  guard is the `wasm2wat → wat2wasm` re-compile in the round-5 test.
- **Round 6** [baseline]: no new bugs. It added `tests/wabt-ts/wasmtk/roundtrip.test.ts` (wat2wasm → wasm2wat → wat2wasm over
  the corpus) plus a feature-heavy hand battery.
- [correction] Deferred items the rounds left open, as they stand 2026-09-14:
  - Now closed:
    - The named memidx in `writeMemArg` now goes through `requireIndex`.
    - The relaxed-SIMD ternaries decode as ternary: `reader/binary-reader.ts`, the `0x105-0x10c` / `0x113` branch.
    - The try_table catch branch-type check exists (`checkCatchTarget` in `validator/shared-validator.ts`).
    - The table64 text index type is parsed.
    - `assert_trap (module)` has its own kind.
    - `applyNames` totality closed with T13.20.
  - By design: `write_debug_names` is ignored (N1, documented in `api/wabt-compat.ts`).
  - Still true: `parseHexFloat` (`core/literal.ts`) sums `parseInt` parts, which is imprecise. It is
    lexer-level only; the const path uses `parseF64Bits`.
  - Still true: `wasm-objdump -h` only re-sets a default that is already `true`.
  - Still true: the lexer has a dead `isDigit && !readNum()` guard (`parser/wast-lexer.ts`).

**Tables, performance, IR shape**
- [decision] `TEXT_ENCODER`/`TEXT_DECODER` are module-level singletons. Never construct one inside a
  method in `writer/stream.ts`, `writer/wat-writer.ts`, `reader/binary-reader.ts` or
  `parser/lexer-source.ts`. `WatWriter.nameIndexMap` is built once, keyed `"kind:name"`; the old scan
  was quadratic in the export count.
- [decision] **`naturalAlignForOpcode` in `core/opcode.ts` is the only natural-alignment table.** The
  parser stores it when there is no `align=`; the `0` sentinel was removed 2026-09-11, and both
  resolvers throw on a non-power-of-two. A duplicate was deleted twice: the WAT writer's local copy,
  and `getOpcodeNaturalAlign`, which returned 0 for 14 SIMD ops. Writing exponent 0 broke binaryen's
  optimizer. Test: `tests/wabt-ts/tools/wat2wasm.test.ts`.
- [decision] Seven IR-shape choices:
  - `ReturnExpr.values: Expr[]`.
  - f64 bits are `bigint` (`parseF64Bits`), and an integer-form float literal is IEEE-encoded, never stored as raw bits.
  - `SimdLaneOpExpr.value?` is set for replace_lane only.
  - The bare-offset `(elem (i32.const N) $f…)` form is supported.
  - The GC abstract heap types live in the `Type` enum. Extend it; never add a parallel enum.
  - `ref.eq` is CORE `0xd3`, while every other GC op is `0xfb` via `decodeGcOp`.
  - A new ref-typed opcode must not reuse `CompareExpr`.
- [correction] § "GC type-encoding caveats (fixes deferred)" is fully closed:
  - `Type.I8`/`I16` are now `0x78`/`0x77` (`core/types.ts`).
  - `FuncSignature` holds `ValueType[]` (`ir/ir.ts`), so typed refs are precise.
  - binaryen-ts's encoder is 3-way for get/get_s/get_u (`src/binaryen-ts/encoder/wasm-encoder.ts`).
- [correction] "The WAT writer is linear-only" (T10.3, T10.6) is no longer true. `wasm2wat` emits folded
  output by default since 1.5.4 (`--linear` opts out). The rules still hold, but the reason is now "the
  linear path must round-trip too".

**Parser: statements, arity, scope**
- [decision] **Every statement-position push goes through `pushStmt`**, which flushes `ctx.stack` first.
  Otherwise a void call sank past a `return` (v1.3.0; `tests/wabt-ts/parser/stmt_order.test.ts`).
- [decision] An empty-folded op pops its deficit from the stack. The clamp
  `available = Math.min(deficit, ctx.stack.length)` is load-bearing (Bug D and Bug F; `tests/wabt-ts/parser/empty_folded.test.ts`).
- [decision] **`instrInputCount` must equal the operands `buildPlainExpr` reads, and be TOTAL over
  `isPlainInstr`.** `default: 0` is a silent landing pad: the bytes stay right but the IR tree is wrong,
  and the bridge and `wasm2ts` read the tree.
  - Deliberate zeros are listed explicitly (`Rethrow`, `StructNewDefault`); `SimdLaneOp` is routed by opcode.
  - Every member of a `case` group must share one arity. `data.drop`/`elem.drop` sat in the arity-1
    group and silently deleted code (T13.16; `tests/wabt-ts/parser/drop_arity.test.ts`).
  - Verified by the folded/linear differential in `tests/wabt-ts/parser/instr_arity.test.ts` (T13.8, T13.18).
    Add a case for every new operand-taking opcode.
- [decision] `varArityForTok` resolves `call`/`return_call` by signature and `array.new_fixed` by count.
  **Function bodies are parsed after the whole field list** (`pendingBodies`, `pendingTypeUses`), because
  199 of 270 corpus modules have a forward reference (T10.5). A deferred body must be consumed exactly to
  its `)` (`PendingBody.endPos`); otherwise a typo'd instruction is silently deleted. Body diagnostics
  therefore follow later fields' — list order is presentation (T12.9).
- [decision] A synthesized slot-filler is `NopExpr.placeholder`, built only by `operandPlaceholder(loc)`,
  and neither writer emits it (T10.8). A source-written `nop` is kept: eliding it could turn invalid
  input valid (T11).
- [decision] `checkLabelScopes` CHECKS only; resolution stays in `resolveNames`. `try_table` catches
  resolve in the ENCLOSING scope: they are checked before the table's own label is pushed, and a legacy
  `delegate` after it is popped. `delegate` REPLACES `end`, so `onDelegateExpr` fires instead of
  `endTryExpr` (T13.1). Getting this wrong has happened in three layers: T7.6, T9.8, and T13.22 (see pointer).
- [decision] Legacy `try` parses to a real `TryExpr` (v1.2.9). Leading-`nop` placeholders in handlers
  are harmless. `writeCatch` must not walk the handler body, because the visitor owns it (`tests/wabt-ts/parser/legacy_try.test.ts`).
- [decision] Inline exports default ON (upstream `wat-writer.h` defaults off), guarded by an exact
  feasibility test. An inline `(export "n")` is illegal on an import and REORDERS exports, so
  `buildExportMap` falls back to standalone export fields, all-or-nothing per module (T10.1, T10.2).
- [decision] Text rules from T12:
  - A literal is range-checked BEFORE truncation. Ints use the union of the signed and unsigned ranges
    (i32 `[-2^31, 2^32)`, lanes `-128…255`); floats are gated on the literal form
    (`isFiniteLiteralForm`), never on the bits, so `inf` stays legal (T12.1).
  - A digit separator sits between digits.
  - An import after a definition is malformed, detected by `imports.length` growth (T12.2).
  - `align=N` is a power of two at PARSE, while its size limit stays in the validator (T12.3;
    `tests/wabt-ts/parser/align_power_of_two.test.ts`).
  - A lane immediate fits `u8` at parse, and its bound against the lane count is checked in the
    validator. The immediate is required. `laneFits` checks v128 lane values (T12.4, T12.6).
- [decision] Names and tokens:
  - Names are strict UTF-8 in both paths, via `TextDecoder({ fatal: true, ignoreBOM: true })`. Data
    segments are exempt (T12.5).
  - A `$"…"` id is non-empty, with no RAW control characters. `decodeStringToken` and
    `STRICT_NAME_DECODER` live in `core/literal.ts` (T12.7).
  - An annotation is transparent but has a grammar (T12.7).
  - A closing label must match. An inline signature must agree with its `(type $t)`, checked at the
    end via `pendingTypeUses` (T12.7, T12.9).
  - An id binds once per index space (T12.9).
  - A string can continue a token: `$"l"0` is one Reserved token (T12.9).
  - `nan:0x<n>` names the exact mantissa, and the payload is checked against `[1, 2^bits-1]`, not
    masked (T10.4, T12.9). `nan:canonical`/`nan:arithmetic` are allowed only in expected results
    (`allowNanPatterns`, a scoped save/restore flag, because v128 results use them per lane; T12.6).
- [decision] **`TokenType.Reserved` is the unknown-operator signal.** `unknownOperatorText()` and
  `reportUnexpected(fallback)` serve `noProgress`, the post-body leftover check and `expect()`. The phrase
  `unknown operator` is load-bearing: it is spec-matched across 400+ cases. Parser wording agreement
  (816/1229) is a CEILING, not a backlog: about 200 misses are `(i32.const 0x)`, where our "expected i32
  constant" beats the spec's "unknown operator". `Reserved` must not return to
  `token_type_reachability.test.ts`'s allowlist (T13.38).
- [decision] `(assert_trap (module …))` is the distinct kind `assert_trap_module` (`tests/wabt-ts/parser/assert_trap_module.test.ts`).
  A NAMED reference must survive the whole pipeline in every position (T13.7; `tests/wabt-ts/parser/named_refs.test.ts`).

**Names passes**
- [decision] **`resolveNames` is total on TWO axes: every `Var` field AND every `Expr` field against its
  case body.** A sibling case that does what its neighbour skips is the tell. Instances:
  - `call_indirect.typeVar`, Bug G.
  - The atomic `memidx`.
  - The `table.get` index (T13.11; `tests/wabt-ts/ir/table_get_index.test.ts`).
  - The mechanical sweep on 2026-08-25 covered 75 `Expr`-bearing and 64 `Var`-bearing interfaces.
- [decision] **`applyNames`: axis 1 (`Expr` recursion) is GENERIC and axis 2 (`Var` rewriting) is an
  EXPLICIT table.** `segment` is a data index on `memory.init` but an elem index on `table.init`. Label
  and local vars are never rewritten (T13.20; `tests/wabt-ts/ir/apply_names_total.test.ts`).
  [correction] The header NOTE in `ir/apply-names.ts` still calls the rewriter partial and the
  ExprVisitor fold "a tracked follow-up". T13.20 superseded both.
- [decision] `constExprOperands` and `WatWriter.writeInstrHead` are COUPLED; a mismatch emits operands
  twice (`tests/wabt-ts/writer/const_expr_head_coupling.test.ts`). `writeFoldedConstExpr` covers constant
  exprs only and throws on anything else (T10.3).
- [decision] **INTENT blocks** state what joining a group asserts, what breaks in each direction, and
  which gate catches it, or that none does. Never write "what the code does" (T13.19). Live:
  - `instrInputCount`'s `return 1` group — pops exactly one (T13.16); gate `tests/wabt-ts/parser/instr_arity.test.ts`,
    which reads `isPlainInstr`'s case labels (`SimdLaneOp` the one allowlisted exception).
  - `resolveExpr`'s `table.size` arm (`ir/resolve-names.ts`) — every member a LEAF (T13.11).
  - The memarg handler family in `validator/shared-validator.ts` — owes memidx, align, offset, `is64` (T9.6, T9.11, T13.15).
  - The `try_table` block in `src/bridge/bridge.ts`.
  - Coupling gate for the const-expr writer: `tests/wabt-ts/writer/const_expr_head_coupling.test.ts`.

**Encoding and decoding**
- [decision] All four LEB encoders throw on an unrepresentable value (T13.2 unsigned, T13.12 signed),
  and the boundary values are asserted to round-trip. `core/leb128.ts` keeps throwing; the conversion
  to reported errors is at the reader boundary (`readXLeb` plus a backstop in `readBinaryIr`).
- [decision] **The binary-path tools never throw**: `wasm2wat`, `wasmValidate`, `wasmObjdump` and
  `wasmStrip` return `{ errors, result }`. The cursor is parked at end-of-input after an error.
  `wasmStrip` guards its re-encode (T13.29; `tests/wabt-ts/tools/malformed_never_throws.test.ts`).
- [decision] **A reader REPORTS and never resynchronises.** The section bound is checked INSIDE the loop
  via `shortSection()` or `this.err`, never in the loop condition. Huge counts fail fast AND loud (T12.8,
  T13.33; `tests/wabt-ts/reader/section_count_truncation.test.ts`).
- [decision] Reserved bits are checked, not masked: memarg flags `0x80`, the mutability byte, the tag
  attribute byte, and the table-init reserved byte, in the reader as well as the writer (T12.8, T13.5).
- [decision] The memarg alignment is `2 ** alignLog2`, never `1 <<` (T13.26; `tests/wabt-ts/reader/memarg_align_wrap.test.ts`).
- [decision] Two things live in `core/binary.ts`:
  - `sectionOrderRank` is the single copy of the section order. Tag (13) sits between memory and
    global; data-count (12) sits between elem and code.
  - Data-count is required by `memory.init`/`data.drop` and must agree with the data section (T12.8).
- [decision] **Section sizes are MINIMAL.** `reserveU32Leb` takes 5 bytes, then `patchU32Leb` writes
  the minimal encoding and `copyWithin`s the body down.
  - The pair is strictly LIFO — the invariant is written at `reserveU32Leb`: never hold an offset taken
    after a reserve across its patch.
  - Call sites: `writeSection` (`writer/stream.ts`) and `writeFuncBody` (`writer/binary-writer.ts`).
  - Measured (T13.40): the wasmtk corpus went from 628,201 to 607,845 bytes (3.2%, on the old 272 files).
  - Do not reproduce the non-minimal LEBs of crafted `(module binary …)` blobs.
- [decision] **Custom sections keep their input position.** `Custom.precedingSection` is `null` for
  "before all" and `undefined` for unknown, which means append — so hand-built IR is unchanged.
  - `BinaryWriter` walks an `ORDER` table; a new section must call `writeCustomSectionsAfter(id)`.
  - The anchor is a SLOT, so an absent section still keeps relative order (T13.41; `dylink.0` must be first).
- [decision] Limits and page sizes:
  - `Limits.initial`/`max` are `bigint`, a deliberate breaking change: consumers get a compile error
    where the wider range must be handled. The bridge refuses values above 2^53 (`limitToNumber`).
  - Test an optional number with `=== undefined`, because a max of 0 is a max (T13.3).
  - 64-bit limits are u64 on the wire (T13.2).
  - `pageSizeLog2` is legal only in {0, 16}. A non-power-of-two page size is malformed, `(pagesize 2)`
    is invalid, and a test pins each side.
  - The page ceiling is `2^addr_bits / pageSize`.
  - The page-size flag is rejected on a table and written on PRESENCE, so an explicit
    `(pagesize 65536)` round-trips: Wasmtime accepts it, and dropping the bit is the only cross-engine
    lever (T13.4).
- [decision] `synthesizeTypes` never invents a type for an unresolvable reference, and an implicit
  type-use is its own singleton rec group (T13.2). What `wat2wasm` accepts, `wasm2wat` must read back:
  walk both directions when adding an instruction (`i64.add128`, `0xfc 0x13`/`0x14`).
- [decision] **Decoder diagnostics use the spec's vocabulary.** `integer too large` (value bits) and
  `integer representation too long` (byte count) stay distinct; the gate
  `tests/wabt-ts/core/leb128_diagnostics.test.ts` exists to catch the two branches COLLAPSING. Compare a
  header field before reading the next one — magic before version is read (T13.37). Truncation is
  reported as `unexpected end of section or function`.

**Validator**
- [decision] GC operands:
  - Check SHARED HIERARCHY, not subtyping (`popCastOperand`, `topOfAbstract`); `br_on_cast` still needs `isSubtype`.
  - A bare `dropTypes(n)` is an unchecked pop, and a peek is not a check (`ref.as_non_null`).
  - `struct.get`/`array.get` `signed` is a TRI-STATE (undefined/true/false), enforced both ways by `checkPackedAccess` (T13.14).
  - [lesson] When a probe rejects, confirm it rejected for the reason under test.
- [decision] **Every memarg handler honours BOTH `offset` against the index type AND `is64`** (T9.11,
  T13.15; `tests/wabt-ts/validator/simd_lane_index_type.test.ts`). An underscore-prefixed parameter in a
  family of parallel handlers is the tell.
- [decision] `rethrow N` must name a `LabelType.Catch` frame (T13.17; `tests/wabt-ts/validator/rethrow_depth.test.ts`).
  V8 is the only oracle for legacy EH.
- [decision] Subtyping depth is at most 63 and the supertype graph must be acyclic, checked after the
  whole type section (`checkSubtypingDepth`). Mutual REFERENCES inside a rec group are legal (T13.34;
  `tests/wabt-ts/validator/subtype_depth_and_cycles.test.ts`).
- [decision] Prefixes and features:
  - `getOpcodeTypeInfo` needs a branch per PREFIX before the SIMD default (T13.9).
  - The atomic table is derived from a 7-wide cycle.
  - The misc `default:` is all-`Void`, and `onQuaternary` reads its opcode.
  - The wide-arithmetic oracle is Wasmtime `-W wide-arithmetic=y`, because V8 gates the proposal off.
- [decision] **Every `Features` flag gates at the point of use** (`requireFeature`), plus `checkValueType`.
  `gateOpcode` covers relaxed SIMD, wide arithmetic and extended-const. Gating stops exactly at the GC
  set: `funcref`/`externref` are never gated, and `annotations`, `codeMetadata` and `compactImports`
  have no validator surface and stay ungated. The CLI `--enable-*`/`--disable-*` flags must ship in
  the same change (T13.10). Compare `ValueType`s with `valueTypeEquals`, never `===` (T10.7).

**Bridge** (`src/bridge/bridge.ts`, formerly `binaryen-bridge.ts`; S6 deletes it)
- [decision] **Every branch-target construct pushes a label frame** on `ctx.labelStack`: `block`, `loop`,
  `if`, `try_table`, and legacy `try` if it is ever bridged — "not pushing" is never right. An unlabeled
  `if` pushes `IF_FRAME = '<if-frame>'`, and `resolveLabel` throws on it (T13.24; `tests/bridge/label_frames.test.ts`).
  [lesson] The bridge belongs in every layer sweep even though nothing publishes it.
- [decision] Use `wabtTypeToValueType` (`bridge.ts`, keeps refs concrete) wherever a type crosses into
  binaryen-ts. `wabtTypeToValType` (`src/bridge/type-map.ts`) coarsens, and is only for callers that
  want the abstract type.
- [decision] Func heap types are declared per signature ONLY when a struct or array type exists, and are
  APPENDED after them. Otherwise non-GC modules switch onto the GC path (T13.47).

**Tools, API, scripts, hygiene**
- [decision] CLI blocks never call `Deno.readFile` and friends directly. They use `cliRead`/`cliWrite`,
  now shared in `src/cli/io.ts`, which print `<tool>: cannot read '<path>': <reason>` and exit 1.
  JSDoc examples keep the bare `Deno.readFile` on purpose (T13.31; `tests/wabt-ts/tools/cli_io_errors.test.ts`).
- [decision] Every `/compat/wabt` failure is an `Error` naming its method. `toBinary` wraps writer
  failures, and a method that can fail says so in its doc (T13.30; `tests/wabt-ts/api/compat_error_shape.test.ts`).
  `wasmStrip`'s `sections` option names what to REMOVE.
- [decision] Rules for `scripts/release/release-guard.ts`:
  - It stays side-effect free.
  - Mutating git calls before the guard are refused unless on the `READ_ONLY` set (`status`,
    `ls-remote`, `rev-parse`, `diff`, `config`, `log`).
  - `deno.json` is matched as an exact path.
  - A local tag is force-written, and a remote tag is refused (T13.43; `tests/wabt-ts/scripts/publish_preflight_wiring.test.ts`).
- [decision] `scripts/wabt-ts/engine-check.ts` gives EVERY engine an explicit proposal list, never
  `--enable-all`. Wasmer 7.2.1 refuses every module once `--enable-tail-call`, `-multi-memory` or
  `-memory64` is on. Read the cause from the `╰─▶` line. [correction] The ledger says Wasmer "now gets
  `--enable-all`"; the script superseded that (`engine-check.ts:131-150`). [baseline] Only Wasmtime
  implements custom page sizes (measured 2026-08-24).
- [decision] No control bytes (TAB, LF and CR excepted), and sentinels are visible strings (T13.25).
  `tests/wabt-ts/audit/source_hygiene.test.ts` scans `src/`, `tests/`, `cmem/` and `README.md` (`.ts`
  and `.md`) and pins `scanned > 100` (T13.28). Every entrypoint has `@module` JSDoc and every export
  has JSDoc.
- [decision] `scripts/` is inside `check`, `lint` and `fmt`, with `scripts/**/*.md` excluded from fmt
  (verified in `deno.json`).

**Already in the core:**
- T13.22 compensating pair, closed pre-merge → cmem/ir-convergence.md § "The bridge and the WAT routes into binaryen-ts — history, summarized"; cmem/best-practices.md § "Producer/consumer pairs are the recurring blind spot"
- A harness must call `wat2wasm` (T13.39: 449/449 vs the true 2207/2207) → cmem/testing.md § "A harness must call the real entry point"
- The release path's two tests, and the dirty-tree guard → cmem/testing.md § "The release path is tested, and needs two tests"; cmem/publishing.md
- `deno publish --dry-run` is not in `deno task test` → cmem/publishing.md § "`publish:dry` is in CI but NOT in `deno task test`"
- Custom-section TEXT position and minimal LEB re-encoding → cmem/divergences.md rows C2, C4, L1
- Diagnostic wording at close (689/711) → cmem/project.md § "Live gaps carried from the predecessors"
- Legacy EH oracle limits → cmem/testing.md § "A fixture believed valid must be said to an engine"

**History, summarized:**
- v1.1.7–v1.3.0: Bugs D, F and G, the `pushStmt` fix, legacy EH (v1.2.9), and GC types in `Type` (v1.1.9).
- 2026-05-25: the performance audit. 2026-06-09: six audit rounds, where rounds 2 and 4 removed dead code
  (`WastParser.ok`, `TypeEntry.tailcallTarget`, `typeStackSize`, `SharedValidator.endTryTable`, and others).
- 2026-08-24 (T10, T12, T13.1–T13.10): removed `Validator.refNullType`, which had the same shape as
  binaryen-ts UP-7. 2026-08-25 (T13.11–T13.47): removed `getOpcodeNaturalAlign`. The `@jrmarcum/binaryen-ts@1.0.9`
  exact pin (T13.23) is gone, because the dependency is in-repo since the merge.

Full text: `git show 9758fc736:cmem/wabt-ts/design-decisions.md`

## `wabt-ts/pre-merge-known-issues.md` (362 lines) — the wabt-ts side's pre-merge register, measured 2026-08-25

This was wabt-ts's inventory of what the merge had to settle or must not hide. It listed defects
that survive the merge (A0–A5), mechanical collisions (B1–B3), configuration (C1–C3), licensing (D),
what the merge resolves (E), and do-first actions (G1–G3). The two sides' registers were
reconciled into one on 2026-08-26, and every decision is now in the core. What remains uniquely here
is G1, a few lessons, and the dated measurements.

**Kept:**

### G1 — the emitted-byte baseline
- [baseline] `scripts/wabt-ts/pre-merge-baseline.tsv` (421 corpus files, 1,557,602 bytes) is checked by
  `scripts/wabt-ts/verify-baseline.ts`, which `deno task baseline` runs. A pure relocation must report
  `IDENTICAL`. It is deliberately NOT a test: re-baseline in the same commit as a genuine encoder change
  and say why. It was captured before the merge because the conformance harnesses live in scratchpads
  and could not be rewritten "before" afterwards. Details → cmem/testing.md § "Proving a refactor changed nothing: `deno task baseline`".
- [lesson] A package's public subpaths are not derivable from its file tree. The audit checked `src/`
  directories and tracked paths and missed both `exports` collisions (`.` and `./compat`); binaryen-ts
  found them (B2a).
- [lesson] Merge `cmem/` by TOPIC, not by concatenation. The two sides were 14,023 and 2,296 lines, and
  a naive merge reads as the larger side's memory with notes appended.
- [trigger] A1: the bridge's `ref.null` refusal for a user-defined heap type was a DIFFERENT defect from
  de-coarsening ("do not assume it went away"). It closed as T13.50b in `50a959baa`, gated by
  `tests/bridge/gc_decoarsening.test.ts`; the refusal message no longer appears in `src/bridge/`.
- [decision] A4, wasmtk's "373 vs 413" corpus count, is deliberately NOT reconciled: which sources count
  is wasmtk's call. Recorded in `tests/wabt-ts/wasmtk/PROVENANCE.md`.

**Already in the core:**
- All pre-merge decisions and outcomes are in cmem/project.md § "The merge — how it was prepared (2026-08-26)" and § "Settled decisions":
  - B1 namespacing (`src/wabt-ts/` rather than `src/wabt/`).
  - B2a `./compat/wabt` and `./compat/binaryen`.
  - B3 and a clean break with no shims.
  - C1/G2a `compilerOptions` and the `lib` union.
  - C2/G2/P1 singleQuote (`2c41d3d1371`).
  - C3 `minimumDependencyAge`.
  - A0/T13.22.
- A1/T13.50 de-coarsening closed in 1.5.2 (`50a959baa`) → cmem/project.md § "Versions"; cmem/ir-convergence.md
- A2 `wasm2ts` stub, still open → cmem/open-work.md § "Repo work". A3 offsets MEASURED 2026-08-31 → cmem/testing.md § "✅ A3 — diagnostic offsets are MEASURED (2026-08-31)"
- D licensing → cmem/licensing.md § "The merged repo inherits BOTH upstreams' obligations"
- A5 repack failure → `cmem/local/environment.md` (private and gitignored; machine-level, so correctly outside the committed cmem)
- E2: the `CLAUDE.md` archive does not travel. The rule "project knowledge in `cmem/`, machine facts outside" is now the INDEX cleanup policy.

**History, summarized:** written 2026-08-25 against wabt-ts `3afd6033` (v1.5.0) and binaryen-ts
v1.5.0. G1 was verified in both directions that day. G3's three recommendations were adopted with
one respelling (`src/wabt-ts/`) and one reversal (no shims). Its § F ("mark entries, never delete")
is superseded by the cleanup policy: git holds the evidence.

Full text: `git show 9758fc736:cmem/wabt-ts/pre-merge-known-issues.md`

## `wabt-ts/runtime-tooling.md` (124 lines) — wabt-ts's runtime targets and TypeScript compiler rules

This file covered Deno as primary and Bun as secondary, measured Bun/Node behaviour (2026-08-24),
`Features` gating for callers, the four strict compiler options with idioms for each, the `Result`
enum convention, and the binaryen-ts exact pin. Runtime floors and the layered portability rule have
since been superseded by the core. The compiler idioms and `Result` convention are still live.

**Kept:**
- [reference] Idioms for the strict flags (root config; `tests/binaryen-ts/` opts out of `noUncheckedIndexedAccess`):
  - `verbatimModuleSyntax`: `import type` for type-only imports, with `.ts` extensions.
  - `noUncheckedIndexedAccess`: iterate with `.entries()`. To walk imports by kind, keep a running index;
    never filter and then index, because the filtered indices are not the index space.
  - `exactOptionalPropertyTypes`: omit an optional property rather than assigning `undefined`, and
    forward optionals with `if (x !== undefined) o.x = x`.
- [reference] `Result` is a plain enum (`Result.Ok = 0`, `Result.Error = 1`), not `Result<T>`. Chain with
  `combineResults`, not `combine`. A helper that records an error but returns a value sets a
  `hadError` flag, which is folded into the final result.
- [lesson] `bun test tests/` treats the argument as a path FILTER and walks sibling checkouts, so a naive
  Bun run reads as catastrophic. Node's `--experimental-strip-types` rejects `enum` (`core/types.ts`),
  so Node runs the published, transpiled package. That is why the slow-types check matters for the Node claim.
- [baseline] Bun/JSC rejects memory64 and table64 where V8 accepts them (Bun 1.3.14, 2026-08-24; not
  re-measured on the 1.4.0 floor).
- [reference] For callers, `wasmValidate(binary, { features })` ENFORCES the set (T13.10). `allFeatures()`
  answers "is this valid wasm at all"; `defaultFeatures()` is the ratified set. CLI flags are hyphenated
  as in wabt (`--enable-multi-memory`).

**Already in the core:**
- Runtime floors (Node 22.18.0, Bun 1.4.0) and the layered portability rule (library web-only; CLI `node:*`, not `Deno.*`) → cmem/project.md § "Runtime portability, layered"
- `lib` is now `esnext, deno.ns, deno.window, dom` (the `deno.window` rule survived as part of the union) → cmem/project.md § "Settled decisions"
- A caret plus lockfile is a pin only until reload, and correctness pins go in the specifier → cmem/best-practices.md § "🆕 `--reload` does not invalidate a resolved VERSION"
- CLI matrix Deno / Node 22.18 / Node 24 / Bun 1.4 → cmem/testing.md § "CI gate"

**History, summarized:** the Bun 1.3.14 smoke test was byte-identical to Deno (2026-08-24).
`tsconfig`/`vitest` were deleted early in wabt-ts. [correction] Two statements are superseded. First,
"only `src/tools` may use `Deno.*`": tools now use `node:*` via `src/cli/io.ts` (N3). Second, the
`@jrmarcum/binaryen-ts@1.0.9` pin: the T13.22 cancellation was fixed pre-merge (`5404946d`, pin moved
to 1.5.0), and the dependency was removed by the merge.

Full text: `git show 9758fc736:cmem/wabt-ts/runtime-tooling.md`

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

- [reference] V8 fast, **Wasmtime the authority** (2026-08-21, `68842242d`), Wasmer disagrees usefully (its
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
  `src/wabt-ts/validator/type-checker.ts`, `src/bridge/type-map.ts`.
- [lesson] A scoping off-by-one recurs in every layer: `try_table` catch target, parser T7.6 → validator T9.8.
- [lesson] One-sided rule: writer's "only valid value" `0x00` vs a reader discarding the byte (T13.5).
- [lesson] Two parsers of one rule; the printer inverts the wrong one — quiet NaN became signalling
  (`src/wabt-ts/core/literal.ts`). Assert print∘parse = identity.
- [lesson] A stub on the form the other side emits is a round-trip hole (`try_table` linear branch).
- [lesson] Read a decode beside its encode, for every value the FORMAT allows (T13.26).
- [lesson] Port the upstream option's DEFAULT: `canonicalize_lebs` true, port shipped fixed-width
  (T13.40; `src/wabt-ts/writer/stream.ts`, `tests/wabt-ts/writer/minimal_section_size.test.ts`).

### Audit a manual walk against the TYPE, not against a corpus

(Heading cited by `tests/wabt-ts/core/opcode_tables.test.ts`.)

- [reference] Enumerate every `Var`-bearing field of every Expr interface; check each kind's case
  body names it (~30 lines). Found atomic `memidx` unresolved — wrong memory, no corpus reaches it.
- [baseline] Every KIND of member: 2026-08-25 over `src/wabt-ts/ir/ir.ts` — `Var` 64 interfaces / 0,
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
  (`src/wabt-ts/validator/type-checker.ts`) was reached one commit later. Record what WOULD reach a trap.
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

**History, summarized:** §1–§5 from T7–T11; ranking T10 (2026-08-24); audits T12–T13.28; robustness
T13.29–37; release guard T13.43–44; last T13.45–47 (binaryen-ts 1.5.0). Correction chain T13.36→37.

Full text: `git show 9758fc736:cmem/wabt-ts/best-practices.md`

## `wabt-ts/overview.md` (478 lines) — what wabt-ts was, and its conformance state and T13 story at 2026-08-25

What wabt-ts was: a TypeScript port of WebAssembly/wabt, built so wasmtk would not need the compiled binary, with `wasm2ts` as the long-term goal. The file also held the conformance table, a newest-first retelling of the T13 audit and hardening passes (T13.11–T13.47), the standalone repo layout, and the sibling-project framing. **It is stale in two ways.** It treats wasmtk as part of the merge, but binaryang is two projects and wasmtk stays a consumer. And its layout (`upstream/`, `binaryen-ts/`, `wasmtk/` submodules, `src/bridge/binaryen-bridge.ts`) no longer exists.

**Kept**
- [correction] **The merge was two projects, not three.** → cmem/project.md § "Scope: two projects, not three". Source is now `src/wabt-ts/…`, the bridge is `src/bridge/bridge.ts`, and there are no submodules. The upstream C++ is a clone outside the repo (`wasmExamples/wabt-ts/upstream/`, which exists).
- [decision] **Who encodes what.** wabt-ts's encoder serves the format tools (the `wat2wasm`/`wasm2wat` round trip, strip, validate). binaryen-ts encodes *optimized* wasm. External `.wat` enters through wabt-ts (routing W4 → cmem/ir-convergence.md § "The bridge and the WAT routes into binaryen-ts — history, summarized").
- [decision] **Wasmtime is the authority when V8 and Wasmtime disagree**, and engine limits are told apart
  from spec limits → § "Oracles — the engine panel" above.
- [trigger] **An import-surface diff is not an upgrade test.** When the binaryen-ts side changes what it *requires* of callers, every import still resolves while the bridge breaks: at 1.5.0, 0 of 72 imports were missing and 12 of 28 bridge tests failed (T13.47). With no pin any more, run `tests/bridge/` after S6 or any encoder change.
- [open, unverified] **wasmtk's legacy-EH output is rejected by Wasmtime and Wasmer**, while its `try_table` output reaches parity: `scripts/wabt-ts/wasmtk-eh-parity-report.md`, which also carries a RETRACTED `$__exn_tag` finding. This is wasmtk-side, so it is not tracked in cmem/open-work.md, and it has not been re-checked since 2026-08-25.

**Already in the core**
- `wasm2ts` is a stub (wabt-ts Phase 8) → cmem/project.md § "Live gaps carried from the predecessors"; cmem/open-work.md § "Repo work" (A2)
- Metric blind spots; a corpus lacking atomics hides a whole proposal → cmem/testing.md § "Every metric is blind to something — record what", § "Four tests that need neither a corpus nor an oracle"
- The `Limits` bigint / `pageSizeLog2` breaks and who they reach → cmem/publishing.md § "⚠️ `bump` has no minor mode — a non-patch release is typed by hand"
- T13.22/T13.24 and the bridge's own label stack → cmem/ir-convergence.md § "The bridge and the WAT routes into binaryen-ts — history, summarized"; diagnostic wording at close → cmem/project.md § "Live gaps carried from the predecessors"

**History, summarized:** the campaign closed 2026-08-24 with seven metrics exhausted. T13 ran through T13.47 on 2026-08-25, and 1.4.1 shipped fifteen of its fixes. The wasmtk corpus grew from 272 to 421 files (T13.46), and `KNOWN_INVALID` emptied. In T13.25/T13.28, a NUL and then `\b` bytes made files binary to grep and silently shrank audit sweeps; that is now gated (`source_hygiene.test.ts`, below).

Full text: `git show 9758fc736:cmem/wabt-ts/overview.md`

## `wabt-ts/testing.md` (642 lines) — the wabt-ts gate, conformance metrics, hardening axes and test placement

Covered the gate and its CRLF `fmt` workaround, the byte baseline, the wasmtk corpus and its snapshot rule, the enumeration frontier and hardening axes, and the conformance metrics with their blind spots. Also the four corpus-free test shapes, the three-engine rule, the fixture convention, and ~200 lines of per-invariant test placement. Most of the method merged into the core. What is left is the metric snapshot, the axis states and the placement map.

**Kept**
- [baseline] **Conformance metrics, at campaign close 2026-08-25** (the first seven closed 2026-08-24). This is a snapshot from scratchpad harnesses outside `deno task test`, over the 257-file spec testsuite. The file says "nine" metrics, but the table has 13 rows. The current in-repo instrument → cmem/testing.md § "The spec-testsuite harness — the must-REJECT axis".

| metric | value | blind to |
| --- | --- | --- |
| parse-clean | 257/257 | a file that parses, then encodes to bytes V8 rejects |
| V8-valid | 2119/2120 | a decoder that REORDERS a module (T9.1); an encoder that truncates into range (until T13.2) |
| validator agreement | 2119/2119 | false ACCEPTS — it counts only false rejections. T13.14 found 12 with every metric green. Counter: a hand-built invalid corpus |
| `assert_invalid` | 2683/2683 | a permissive validator vs a REWRITTEN module (T13.2); the denominator is whatever the classifier hands it (2737 → 2683) |
| round-trip byte-identical | 2119/2119 | a consistently wrong opcode mapping (reader and writer agree) |
| execution | 23,077/23,077 | host imports, v128, NaN payloads, `ref.func` args (29,544 skipped) |
| `assert_malformed` | 1229/1229 quoted · 711/711 binary | the accepting direction, and WHY we reject; probe position changes the number (1227 → 1229, T13.1) |
| binary → IR → binary | 30/88 | text round trips drop custom sections before the writer (T13.41); all 58 settle on pass 2 |
| round-trip FIDELITY | 2119/2119 | input is our own output, so a difference is our bug. **Never sum with the next row**: summed, it read 2124/2207 and hid T13.40 |
| round-trip of crafted bytes | 27/88 | non-minimal LEBs and elem-flag choices the text cannot record; 88/88 is not the goal |
| diagnostic wording — reader | 689/711 | the error OFFSET; inputs with no expected string; message quality (T13.37) |
| diagnostic wording — validator | 2446/2683 | same (T13.38); 0 false accepts |
| diagnostic wording — parser | 816/1229 | same (T13.38); ~200 misses are `(i32.const 0x)`, where OUR message is better — a ceiling, not a backlog |

- [correction] **A different instrument, not comparable with the table.** The scratch harnesses skipped `synthesizeTypes` until T13.39. Corrected, over 2207 modules rather than 2120: agreement 2207/2207, `assert_invalid` 2694/2694, round-trip 2124/2207. "83 differences are non-minimal LEBs" was wrong: 22 were our own 5-byte section-size padding (T13.40). Every historical `assert_invalid` denominator /2737 carries +54 `assert_trap (module)` pollution — its deltas are valid, its absolutes are not.
- [baseline] **Hardening axes (T13.33–T13.38).** CLEAN: huge declared counts (4,294,967,295 declared; 11 sections bail in 0 ms), deep nesting (100 000 blocks / 60 000 operands, no stack overflow), complexity (~2× per doubling; 5 module shapes and 4 string/name series), type-graph recursion (a 2000-deep subtype chain in ~12 ms), size amplification, string/name scaling, text round-trip convergence (272/272 at iteration 1), gate vacuity. Diagnostic OFFSET: measured since → cmem/testing.md § "✅ A3 — diagnostic offsets are MEASURED (2026-08-31)". Diagnostic usefulness ("is the message actionable?"): **not attempted** → cmem/open-work.md.
- [baseline] **The enumeration frontier has been EMPTY since T13.32** — the cheap axes are spent, not the code clean. Swept: `resolveNames` (both axes), `applyNames`, `generateNames`, `expr-visitor`, validator operand/memarg checks, `instrInputCount`, WAT-writer const-expr coupling, bridge label frames/alignment, `binary-reader.ts`, `wasm-strip`, the CLI shims, `wasm-objdump`'s `sectionMeta`, and the release path. The next audit should invent a new axis or state a lower yield.
- [correction] **The corpus is 421 files: 413 generated from wasic + 8 non-wasic fixtures**, and all 421 encode, validate and round-trip since T13.46. wasmtk counts its live corpus at **373**; this is deliberately NOT reconciled (A4, above).
- [correction] **`cli_io_errors.test.ts`'s behavioural half now runs:** `deno task test` grants `--allow-run --allow-write` and reports 0 ignored. The wing's "1 ignored by design" is stale.
- [reference] **Invariant → test.** Paths are under `tests/wabt-ts/` unless stated. All 55 tests exist.

| test(s) | pins |
| --- | --- |
| `tools/wat2wasm.test.ts` · `reader/binary-reader.test.ts` | natural alignment when `align=` is omitted · a function import beside a defined function (`readCodeSection` off-by-one) |
| `parser/stmt_order.test.ts` · `parser/empty_folded.test.ts` | statement order (`pushStmt` flush, void call before `return`) · Bug D multi-value receive, Bug F `br_if` global resolution |
| `parser/legacy_try.test.ts` · `parser/wide_arithmetic.test.ts` | legacy try: parse shapes, V8 throw/catch/rethrow, no duplication · wide-arithmetic end to end (Wasmtime-verified), lexer-vs-reader sweep |
| `writer/tag_type_index.test.ts` · `writer/nan_payload.test.ts` | T10.7 tag type matched by `valueTypeEquals` · T10.4 exact NaN mantissa; `return_call_indirect` keeps its table |
| `parser/linear_try_table.test.ts` · `writer/table_init.test.ts` | T10.6 linear `try_table` keeps catches and body · T10.3 table initializer written folded; inexpressible ones throw |
| `writer/operand_placeholder.test.ts` · `parser/call_arity.test.ts` | T10.8 placeholder never written, T11 no-repair guards · T10.5 linear `call` pops only the callee's arity |
| `writer/export_order.test.ts` · `validator/memarg_offset.test.ts` | T10.1/T10.2 inline `(export)` only when faithful · T9.11 every memarg handler checks `offset` against the index type |
| `tests/bridge/tier_b`, `tier_c`, `tier_d`, `gc_tier1`–`4` `.test.ts` | bridge coverage; GC tiers check encoding only (no engine call, verified) |
| `api/wabt_compat.test.ts` · `api/compat_error_shape.test.ts` | wasmtk's exact `/compat` call patterns (now `./compat/wabt`) · T13.30 errors name their origin, fuzz population pinned (`threw > 50`) |
| `audit/silent_corruption_fixes.test.ts` · `_round2.test.ts` | 2026-06-09 audit rounds 1–2 → § "2026-06-09 silent-corruption audit" above |
| `audit/source_hygiene.test.ts` | T13.25/T13.28 no control bytes in `src`, `tests`, `cmem`, `README.md`; population pinned (`scanned > 100`) |
| `parser/label_scope.test.ts` · `parser/custom_page_sizes.test.ts` | T13.1 out-of-scope branch targets, incl. catch/`delegate` scopes · T13.4 `(pagesize N)`, log2 encoding, gate (no metric reaches it) |
| `ir/limits_bigint.test.ts` · `writer/no_repair.test.ts` | T13.3 64-bit limits at full width end to end · T13.2 no truncation; a bad type index stays bad; no rec-group borrowing |
| `validator/feature_gates.test.ts` · `validator/atomics.test.ts` | T13.10 each proposal rejected without its flag, message names it · T13.9 all 67 atomic opcodes vs V8, round trip, width pinning |
| `parser/named_refs.test.ts` · `ir/table_get_index.test.ts` | T13.7+T13.13: 64 name POSITIONS and 69 OPERANDS (decoy at 0), V8 must accept · T13.11 `resolveNames` walks `table.get`'s index |
| `core/leb128.test.ts` (signed block) · `core/opcode_tables.test.ts` | T13.12 all four LEB encoders reject what they cannot represent · T13.6 lexer⇄printer name symmetry, natural alignment |
| `validator/subtype_depth_and_cycles.test.ts` | T13.34 depth ≤ 63 pinned on both sides (64 ok, 65 not); acyclic supertypes; mutually referencing rec groups stay legal |
| `reader/section_count_truncation.test.ts` · `parser/token_type_reachability.test.ts` | T13.33 count must match entries; no hang on 2^32−1 · T13.32 every `TokenType` emitted or allowlisted with a reason |
| `tools/cli_io_errors.test.ts` · `tools/malformed_never_throws.test.ts` | T13.31 CLI I/O errors reported (source gate + behavioural half) · T13.29 585 malformed inputs × 4 tools: never throw, still REPORTED |
| `reader/memarg_align_wrap.test.ts` · `tests/bridge/label_frames.test.ts` | T13.26 alignment exponent cannot wrap (32/33 flip on revert) · T13.24 the `if` frame; step 1 guards the guard |
| `ir/apply_names_total.test.ts` · `writer/const_expr_head_coupling.test.ts` | T13.20 `applyNames` total on both axes · T13.21 `constExprOperands` ⇄ `writeInstrHead` in sync (read from source) |
| `parser/instr_arity.test.ts` · `parser/drop_arity.test.ts` | T13.8 folded vs linear, 74 instrs; T13.18 `isPlainInstr` ⊆ `instrInputCount` · T13.16 `data.drop`/`elem.drop` take no operand |
| `validator/simd_lane_index_type.test.ts` · `validator/rethrow_depth.test.ts` | T13.15 lane ops follow the index type (`load8_splat` control) · T13.17 `rethrow N` names an enclosing catch; V8-only |
| `validator/gc_operand_checks.test.ts` | T13.14 15 invalid GC shapes vs V8; 14 valid ones stay valid (shared hierarchy, not subtyping) |
| `reader/reserved_bytes.test.ts` · `reader/binary_malformed.test.ts` | T13.5 tag attribute and table-init reserved bytes · T12.8 section id/order/size, counts, closing `end`, data count |
| `parser/annotation_lexing.test.ts` · `parser/type_use_and_label.test.ts` | T12.7 annotation characters, required id · T12.7 repeated labels match; an inline signature agrees with its type, is not re-interned |
| `parser/lane_and_nan_context.test.ts` · `parser/name_utf8.test.ts` | T12.6 lane immediates required, NaN patterns per-lane only · T12.5 names valid UTF-8 in both paths; a BOM stays a character (T7.13) |
| `parser/simd_lane_range.test.ts` · `parser/align_power_of_two.test.ts` | T12.4 lane fits `u8` (malformed), 16..255 is a validation error · T12.3 non-power-of-two `align` malformed, oversized invalid |
| `parser/import_order.test.ts` · `parser/const_range.test.ts` | T12.2 no import after a definition; 7 legal orders guarded · T12.1 integers range-checked; a finite float rounding to inf is out of range |
| `wasmtk/runner.test.ts` · `roundtrip.test.ts` · `provenance.test.ts` | corpus forward; reverse (the disassembly re-compiles); the snapshot stamp |

**Already in the core**
- Running; `publish:dry` for moved exports; the test tree → cmem/testing.md § "Running", § "Test tree"
- The CRLF `fmt` apparatus is retired; `git diff --stat` after a revert → cmem/testing.md § "✅ The `deno fmt --check` line-ending false alarm is RETIRED"
- `scripts/wabt-ts/verify-baseline.ts` (`deno task baseline`) → cmem/testing.md § "Proving a refactor changed nothing: `deno task baseline`"
- The snapshot rule → cmem/testing.md § "The wasmtk corpus is a SNAPSHOT, and that has cost real credibility"; harness, axis, fixture and V8-only-oracle rules → § "The convergent testing philosophy"
- Release guard, two tests (`tests/wabt-ts/scripts/`); CI → cmem/testing.md § "The release path is tested, and needs two tests", § "CI gate"

**History, summarized:** test counts went 146 → 381 → 393 (2026-08-25), and every one went stale. The hardening loop with wasmtk began at wasmtk Phase 1, 38/38 against wabt-ts 1.1.8 (2026-05-28).

Full text: `git show 9758fc736:cmem/wabt-ts/testing.md`

## `wabt-ts/phases.md` (209 lines) — wabt-ts phase plan, campaign snapshot, TS ↔ C++ map, per-phase gotchas

Phase status: wabt-ts Phases 1–6.2 were complete. wabt-ts Phase 7 (the bridge) was "in progress, pinned to binaryen-ts 1.5.0"; it is now internal, and S6 deletes it. wabt-ts Phase 8 (`wasm2ts`) was pending. The file also held release highlights 1.1.9–1.3.5, the campaign table, T13 at a glance, the porting map and gotchas. The gotchas were partly overtaken by the S-series IR changes; only those verified against today's code are kept.

**Kept**
- [reference] **TS ↔ C++ map for `src/wabt-ts/`**, from each file's own `Original source:` header. C++ paths are under `WebAssembly/wabt/`, checked in the local clone.

| TS (`src/wabt-ts/…`) | C++ (`WebAssembly/wabt/…`) |
| --- | --- |
| `core/types.ts` · `core/error.ts` | `include/wabt/base-types.h`, `include/wabt/type.h` · `include/wabt/error.h`, `include/wabt/error-formatter.h` |
| `core/binary.ts` · `core/result.ts` · `reader/binary-reader-nop.ts` | `include/wabt/binary.h` · `include/wabt/result.h` · `include/wabt/binary-reader-nop.h` |
| `core/opcode.ts` · `core/feature.ts` · `parser/token.ts` | `include/wabt/opcode.{h,def}` · `include/wabt/feature.{h,def}` · `include/wabt/token.{h,def}` |
| `core/leb128.ts` · `core/literal.ts` | `include/wabt/leb128.h` + `src/leb128.cc` · `include/wabt/literal.h` + `src/literal.cc` |
| `ir/{ir,ir-util,expr-visitor,apply-names,resolve-names,generate-names}.ts` | `include/wabt/<same>.h` + `src/<same>.cc` |
| `reader/binary-reader.ts` · `reader/binary-reader-ir.ts` | `include/wabt/binary-reader.h` + `src/binary-reader.cc` (and `binary-reader-ir`) · `include/wabt/binary-reader-ir.h` + `src/binary-reader-ir.cc` |
| `writer/{binary-writer,stream,wat-writer}.ts` · `parser/{lexer-source,wast-lexer,wast-parser}.ts` | `include/wabt/<same>.h` + `src/<same>.cc` |
| `validator/{type-checker,shared-validator,validator}.ts` | `src/<same>.cc` + `include/wabt/<same>.h` |
| `tools/{wat2wasm,wasm2wat,wasm-validate,wasm-objdump,wasm-strip}.ts` | behavioural counterparts of `src/tools/<same>.cc`; MIT headers (original code) |
| `ir/synthesize-types.ts`, `ir/fidelity.ts`, `core/custom-placement.ts`, `reader/name-section.ts`, `api/wabt-compat.ts`, `tools/wasm2ts.ts` | no C++ counterpart (MIT) |

- [reference] **Gotchas verified today.** `func` lexes to `TokenType.Func` (refkind `FuncRef`), not `TokenType.Function`. Never `export *` from `token.ts` in `index.ts`: its `LiteralType` collides with `literal.ts`. `parseFoldedInstr` consumes immediates before sub-expressions. Locals resolve at parse time (`localScope` / `resolveLocal`), so `resolveNames` owns locals only for binary-read or hand-built IR. The validator is three layers (TypeChecker ← SharedValidator ← Validator); `beginFunction` does NOT push params, and errors route through `setErrorCallback`. `AtomicNotifyExpr` has no `opcode` field (`AtomicWaitExpr` does). `wasm-objdump` counts come from module arrays, not `SectionMeta.count`.
- [correction] **CLI pipelines.** `wat2wasm` = `parseWatModule` → `resolveNames` → **`synthesizeTypes`** → `writeBinaryIr` (the wing omits `synthesizeTypes`). `wasm2wat` runs `generateNames` **only on request** (`--generate-names`). `wasm-strip` is unchanged: `readBinaryIr({readDebugNames:false})` → clear `module.customs` → write.
- [correction] **The wing's "IR field names" list is stale; read `ir/ir.ts`.** Atomic kinds are now dotted (`'atomic.notify'`), and `IfExpr` has `ifTrue`/`ifFalse`, not `then_`/`else_`.

**Already in the core**
- Sub-version capped at 9 → cmem/project.md § "Versions"; "Phase N" ambiguity → § "\"Phase N\" is ambiguous here, permanently"
- A snapshot column headed "now"; re-derive a count from its table → cmem/project.md § "Live gaps carried from the predecessors"
- `/compat` mirrors `npm:wabt`, now `./compat/wabt` → cmem/project.md § "Settled decisions" (decision 5)

**History, summarized:** the campaign (to 2026-08-24) took parse-clean from 107 to 257/257, `assert_invalid` from 2395/2737 to 2664/2683, and wasmtk round-trip from 1/270 to 270/270. Its load-bearing changes were T7.4, T9.1–T9.4, T11 and T10.x, and three items were misdiagnosed until re-measured (T10.5, T10.6, T10.8). Releases: 1.1.9–1.2.5 GC tiers, 1.2.9 legacy try, 1.3.0 statement order, 1.3.4/1.3.5 const bugs, 1.4.0 T13.1–T13.10, 1.4.1 fifteen T13 fixes. T13 recorded T13.1–T13.50 and 8 hardening passes (1/2/0/0/2/2/2/2).

Full text: `git show 9758fc736:cmem/wabt-ts/phases.md`

## `wabt-ts/bridge.md` (273 lines) — wabt-ts Phase 7: the wabt IR → binaryen-ts bridge

Covered the bridge's shape, the binaryen-ts 1.0.9 constructor surface, type mapping, tier coverage and gotchas. Also the T13.22 catch-scope coupling and its coordinated release, T13.24 label frames, and the UP-1..UP-7 binaryen-ts gaps. **The bridge is still live** (`src/bridge/bridge.ts`, 14 test files in `tests/bridge/`) until S6 step 5 deletes it.

### Why direct recursion

`bridgeToBinaryen(module)` is a **post-order recursive walk** over the wabt IR that calls binaryen-ts constructors directly. [decision] **Not delegate-driven.** binaryen-ts constructors are bottom-up: leaves are built first and passed into parents, so a recursive `bridgeExpr` falls out naturally. A delegate/visitor walk would have to maintain its own operand stack to rebuild the tree — strictly more complex, with no benefit. (The old CLAUDE.md "ExprVisitorDelegate" note was wrong.)

**The design constraint that makes it work:** wabt-ts IR nodes support clean post-order recursion — no parent context needed to resolve a child, no upward references. The same reasoning is in `src/bridge/bridge.ts`'s module doc.

### Tier coverage

About 60 expression kinds plus the module surface, tested in `tests/bridge/`:
- **Tier A** — core compute and control flow: locals/globals, unary/compare/convert, return, drop, nop, unreachable, block, loop, if, br, br_if, br_table (`tier_a.test.ts`)
- **Tier B** — call, call_indirect, select, load, store, memory.size, memory.grow (`tier_b.test.ts`)
- **Tier C** (`tier_c.test.ts`) — ref.null / ref.func / ref.is_null; SIMD basics (v128.const, splat, lane arithmetic, extract/replace_lane, shuffle); SIMD memory (load_splat / load_zero / load_lane / store_lane, via `simdLoadOpForOpcode`); EH (tags, throw, throw_ref, `try_table` with `buildCatchClause` over the four `CatchKind`s)
- **Tier D** — memory and table exports; active and passive data segments via `bridgeDataSegment` (`tier_d.test.ts`)
- **GC tiers** (`gc_tier1`–`4.test.ts`) — Tier 1 i31, ref.eq; Tier 2 struct.\*, with `addHeapType` up front and `BridgeCtx.heapTypeIdx`; Tier 3 array.\*; Tier 4 ref.test / ref.cast

The wing's "`br_on_cast` deferred" is stale: it landed in T5.3 and is tested in `tests/bridge/br_on_cast.test.ts`.

**Kept**
- [decision] **`limitToNumber` THROWS above 2^53 rather than rounding** a wabt `bigint` limit into binaryen-ts's `number`. Any new limit-taking call must go through it (T13.3).
- [reference] **Gotchas still true in code.**
  - `makeI64Const` takes a `bigint`.
  - `makeBlock`/`makeIf` infer their type from the last child, so use `withDeclaredType`.
  - There is no `makeCompare` or `makeConvert`.
  - Alignment is bytes in wabt-ts and an exponent in binaryen-ts (`alignBytesToExponent`); treating 0 as exponent 0 once broke the optimizer.
  - `synthesizeAnonymousNames` fills in `$F0`/`$G0`/`$T0`/`$M0`/`$E0`; new item kinds need the same treatment.
  - Memory imports use the `memoryNames` slot.
  - f32/f64 consts reinterpret raw bits as floats.
- [correction] **Labeled `if`s no longer throw.** The wing says the bridge throws on any labeled `if`. Today a labeled `if` carries its name, and only a branch *targeting* an unlabeled `if` throws (`IF_FRAME = '<if-frame>'`, T13.24; it was a NUL sentinel before T13.25).
- [lesson] **Two errors that cancel are invisible to every test that checks final bytes.** T13.22 was the third instance of the T7.6/T9.8 off-by-one. Keep `try_table_catch_scope.test.ts`, and keep its probe NUMERIC: a named target cannot see the bug.

**Already in the core**
- T13.22 closed pre-merge; T13.50/A1 de-coarsening (1.5.2); the move to `src/bridge/`; not exported → cmem/ir-convergence.md § "The bridge and the WAT routes into binaryen-ts — history, summarized"
- An exact pin vs a caret plus lockfile; who a coupling blocks → cmem/project.md § "Live gaps carried from the predecessors"; acceptance 401/421 → 421/421 → cmem/ir-convergence.md § "Step 5 — delete the bridge, and carry its type derivation forward"

**History, summarized**
- **T13.22 / T13.23 / T13.47 (2026-08-25):** the pin was made exact; then the fix and the bump landed in one commit, `5404946d`; bridge tests went from 16/28 to 28/28. Versions 1.4.1/1.4.2 in that story are binaryen-ts's, not wabt-ts's.
- **UP-1..UP-7:** binaryen-ts gaps. UP-5 (start funcidx discarded) failed silently; UP-1 (`struct.get_u`) failed loudly. Detail is in `wabt-ts/tasks.md` and `scripts/wabt-ts/binaryen-ts-upstream-report.md`.

Full text: `git show 9758fc736:cmem/wabt-ts/bridge.md`

## `wabt-ts/publishing.md` (318 lines) — wabt-ts JSR releases 1.4.0 → 1.5.0 and its release flow

Covered the release flow, the version rule, the `auto-tag` `actorNotScopeMember` trap, slow types, never publishing locally, and repo hygiene. It also covered the contents and severity of 1.4.0 (breaking), 1.4.1 (fifteen fixes) and 1.5.0 (nothing user-visible). The predecessor is frozen and archived → cmem/project.md § "The retirement — complete (2026-09-02)".

**Kept**
- [decision] **wabt-ts 1.5.0 skipped the bump rule on purpose**, for version parity with binaryen-ts 1.5.0 when the T13.22 coupling resolved. 1.4.2–1.4.9 never existed; the gap is not a tooling fault.
- [lesson] **Rank a release by failure class:** wrong code from valid input (T13.16), then silent repair of invalid input (T13.26), then loud valid-input-rejected (T13.11, T13.15) or invalid-accepted (T13.14, T13.17). **An unreleased fix is indistinguishable from an absent one downstream.**
- [lesson] **A documented command can go wrong without changing, when the question moves under it.** A `grep -c` of "unreleased" rows silently became a count of released contents once the section was retitled. Ask git (`git diff --stat <last tag>..HEAD -- src/`), not prose.

**Already in the core**
- Never `deno publish` locally; the tag-driven flow; the version rule → cmem/publishing.md § "The release process (§2.2, merged 2026-08-31)"; `auto-tag` dispatch and recovery → § "🚨 ROOT CAUSE of the `workflow_dispatch` publish failures — found 2026-08-27"
- Slow types and the Node path → cmem/publishing.md § "`publish:dry` is in CI but NOT in `deno task test`"; the dirty-tree guard (T13.43) → § "A dirty tree ships a release containing none of the work"
- `Limits` / `pageSizeLog2` / feature-gating breaks → cmem/publishing.md § "⚠️ `bump` has no minor mode — a non-patch release is typed by hand"; hygiene → § "Repo hygiene and the memory routing rule"

**History, summarized:** 1.4.0 (2026-08-25, rekor 2582221500) unblocked wasmtk's EH migration (`d30b8599`). 1.4.1 (rekor 2589519728) came from an owner-pushed tag. 1.5.0 (rekor 2603257282) changed only `src/bridge/`. On 2026-05-25 the repo left the fork network, and `git filter-repo` purged CLAUDE.md/TASKS.md from history.

Full text: `git show 9758fc736:cmem/wabt-ts/publishing.md`

## `wabt-ts/licensing.md` (51 lines) — wabt-ts's MIT-primary / Apache-2.0 arrangement

Covered the MIT declaration with an Apache-2.0 alternative, the licence files, the no-compound-SPDX rule (v1.0.2), and per-file headers. All of it merged into the core, which extends it to both upstreams. **Kept:** nothing beyond the core.

**Already in the core:** the whole file, including the header templates and the SPDX lesson → cmem/licensing.md § "Per-file headers", § "JSR rejects on two conditions, and both still apply". **History:** the file layout was adopted at v1.0.2 (2026-05-25).

Full text: `git show 9758fc736:cmem/wabt-ts/licensing.md`

## `wabt-ts/INDEX.md` (215 lines) — the wabt-ts memory index, binding triggers, and the audit definition

Covered the cmem policy (superseded by cmem/INDEX.md), two notation rules, the "update the project memory" trigger, the "look for code issues" trigger with its audit definition, the regression-gate trigger, and the files table. The audit definition is cited from `tests/wabt-ts/audit/source_hygiene.test.ts:20` and `src/wabt-ts/ir/resolve-names.ts:312`.

### The audit definition

**The "look for code issues" trigger** is a comprehensive audit, across tested AND untested paths, for workarounds, dead code (verify each with a grep), bugs, and **silent fall-throughs** — the worst class.

**The canonical silent fall-through** is a `default:` arm returning a benign value (`0`/`false`/`null`/`Result.Ok`) where the other arms return real data. `instrInputCount`'s `default: return 0` caused the `Quaternary` bug, and T13.16 was its inverse. Where a population is enumerable from source, gate on it (T13.18). Report `file:line` and severity.

**Corpus coverage is NOT the tool.** Enumerate the TYPE, and check the code against it:
- every **`Var`-bearing field** of every `Expr` interface vs. the `resolveNames` case that handles it;
- every **`Expr`-bearing field** of every `Expr` interface vs. that same case body — a second, equally necessary axis. The `Var` axis came back clean across 64 interfaces while the `Expr` axis found `table.get.index` (T13.11) across 75;
- every **`ExprVisitorDelegate` hook** vs. each walker that must be total (both writers, the validator);
- every **entrypoint accepting outside bytes**, fuzzed by truncation and single-byte corruption. Assert only that it does not THROW, plus two guards: malformed input is still REPORTED, and valid input still succeeds (T13.29);
- every **`readX` beside its `writeX`**: the decode must invert every value the encode can produce AND every value the WIRE FORMAT allows (T13.26 lived in the second half);
- **`instrInputCount` vs. the max `opN()`** each `buildPlainExpr` case reads, and every member of a shared `case` group has the same arity (T13.16). Triage regex false positives by hand; do not tighten the scan;
- **every parameter of each handler in a family**, not one parameter across the family. T9.11 fixed `offset` in ten handlers and left `is64` dropped (T13.15);
- **parallel handler families**, where a sibling that does what its neighbour skips is the strongest tell. The other tells: a case sharing a label with a genuine LEAF (`table.get` inherited `table.size`'s body); an underscore-prefixed parameter (`_signed`); a parameter the sibling takes and this one does not; a bare `dropTypes(n)` where siblings call `popAndCheck1Type`; and a helper that exists but is never called (T13.14 was fixed by calling `isSubtype`);
- **for the validator, a hand-built INVALID corpus** (~20 lines): bad modules → `wat2wasm` (which does not validate) → `wasmValidate`, with V8 as oracle and Wasmtime as authority. Pair every tightening with a false-REJECT sweep, re-run with the fix reverted.

**Attached rules:**
- Start from the recurring root-cause table (the best-practices section above), and expect its yield to decay.
- Record the negative results, and the QUESTION an audit asked.
- **Pin the population** (assert a floor on what was scanned): every enumeration is grep-driven, and one control byte hides a file (T13.25).
- A fully green gate is the normal starting condition: T13.11 and T13.12 were found with everything green.

**Kept**
- [decision] **Notate the INTENT of a section at the section.** A shared `case` group, a handler family or an opcode table is a membership assertion. State what joining asserts, what breaks in each direction, and which gate catches it (T13.11, T13.16, T9.6 → T9.11 → T13.15). A live example is the `try_table` INTENT block in `src/bridge/bridge.ts`.
- [lesson] **Write what you did NOT check, the negative results and the calibration INTO the file.** In T9.11 → T13.15 the knowledge existed and the record did not.
- [correction] **The gate is now CI's full list**, not `check && test && fmt && lint`.

**Already in the core:** cmem as the single home; README is not memory → cmem/INDEX.md; cmem/publishing.md § "Repo hygiene and the memory routing rule". The regression gate → cmem/working-rules.md § "The gate — on the COMMITTED tree, reading every EXIT CODE". **History:** the files table described the pre-merge wing; the G1 baseline → cmem/project.md § "The merge — how it was prepared (2026-08-26)".

Full text: `git show 9758fc736:cmem/wabt-ts/INDEX.md`
