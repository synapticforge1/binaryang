# Divergences — DESIGN rows: the text format, names and custom sections

Decisions to keep where the text reader and writer, the name section and the custom sections differ from upstream wabt (W4, N3, N4, C4–C6, N7, N9, L1, A1, S7, W10a, W13, W15, W17, W18).
Last verified 2026-11-20. The register, its classes and the checklist are in [divergences.md](divergences.md).

## DESIGN rows

- **id:** W4
  - vs: wabt
  - what differs: binaryen-ts's own `parseWat` is a FOLDED SUBSET: no multi-operand stack sources, stack conditions, block params, or bare linear form
  - class: DESIGN
  - status / authority: owner 2026-09-10: external WAT goes wabt-ts → bytes → decoder (`8033ca3c0`);
    `parseWat` internal only. ✅ CLOSED 2026-09-28 — `parseWat` DELETED (One front end stage 5, merge
    `868faea1b`): `readWat` (wabt-ts parser → bytes → the one reader) is the only text route, and it
    reads everything this row listed as missing (tests in `tests/binaryen-ts/text_route/` now assert
    those WORK)
- **id:** N3
  - vs: wabt
  - what differs: `wasm2wat` prints a name that is not all idchars QUOTED (`$"foo bar"`); upstream substitutes `_`, renaming it (`$foo_bar`)
  - class: DESIGN
  - status / authority: fidelity, N1 P3: the text must hold the name the binary did. binaryen prints the same quoted form
- **id:** N4
  - vs: binaryen
  - what differs: after passes with `-g`, binaryen-ts keeps the LOCAL and LABEL names the passes leave; upstream `wasm-opt -O2 -g` drops every local name (params too) and writes no labels
  - class: DESIGN
  - status / authority: ✅ DECIDED (owner, 2026-09-29): KEEP them — `-g` asks for debug names, and
    the ones the passes leave are real. Priced first: 127.4 KB of locals and labels over 421
    modules, under `-g` only; 0 bytes without it ([names.md](names.md) § "Names under optimization,
    priced"). Was provisional since N1 P5 (2026-09-11)
- **id:** C6
  - vs: binaryen
  - what differs: binaryen-ts writes each custom section back where it stood; upstream `wasm-opt` APPENDS them after the known sections and special-cases only `dylink.0`
  - class: DESIGN
  - status / authority: fidelity, C3. Probed on wasm-opt 132, all four of (no passes) / `-g` / `-O2`
    / `-O2 -g`. Restoring the position covers `dylink.0` and clang's layout (`.debug_*`, `name`,
    `producers`), which appending cannot
- **id:** N7
  - vs: binaryen
  - what differs: a name section that names two functions the SAME: binaryen-ts renames the second `dummy.1` and writes that; wabt-ts keeps the section as raw bytes and re-emits it exactly
  - class: DESIGN
  - status / authority: owner decision 2 (N1 P4): "a duplicate is not a fidelity target". Upstream
    binaryen renames too and has no raw fallback; wabt-ts's reader keeps any section it cannot hold
    exactly. Costs 2 bytes on 1 of 376 WASI binaries (`1_fib-rs-test.wasm`, functions 153 and 159
    both `dummy`)
- **id:** L1
  - vs: both
  - what differs: relocation-padded LEB operands (`11 80 80 80 80 00` for `call_indirect 0`, LLVM's) re-encode MINIMALLY (`11 00`), so a linked binary shrinks — 1_fib-rs.wasm by 3,166 bytes
  - class: DESIGN
  - status / authority: both forms are valid and upstream wabt and binaryen normalize the same way. Found 2026-09-11 (C3): it is the only non-name difference in the 376-binary WASI corpus
- **id:** C4
  - vs: wabt
  - what differs: `wasm2wat` prints every custom section, with the position it held — `(@custom "producers" (after data) …)`; `wat2wasm` HONOURS that position
  - class: DESIGN
  - status / authority: fidelity, C2. Upstream prints `@custom` only under `--enable-annotations`,
    prints NO position, and appends on re-assembly; `wasm-tools` is the placement oracle and agrees
    with us on all 15 probed cases
- **id:** C5
  - vs: both
  - what differs: a `(@custom "name" …)` in text IS the name section: written verbatim, and none is generated from the module's `$ids`
  - class: DESIGN
  - status / authority: C2. `wasm2wat` prints that annotation exactly when the reader could not hold
    the section, so the bytes are the superset — this is what makes the text a fixed point. Upstream
    `--debug-names` drops the annotation and keeps the generated one; `wasm-tools` writes BOTH
- **id:** W18
  - vs: wabt / wasm-tools
  - what differs: FOLDED `wasm2wat` layout. (a) It closed every folded expression with a space, so
    siblings and operands shared a line — `(i32.const 0) (i32.const 1)) (i32.store` — where upstream
    `--fold-exprs` and `wasm-tools --fold-instructions` agree on one per line and a newline after
    `(then` / `(else` / `(do` / `(catch`. (b) A DECLARATION's constant expression (global init,
    segment offset, element item, table initializer) broke across lines; here the oracles DISAGREE —
    upstream wabt one instruction per line in a mixed form, wasm-tools ONE line in both modes
  - class: (a) DEFECT (cosmetic), (b) DESIGN
  - status / authority: ✅ CLOSED 2026-09-29: (a) `0068b723e` — as both oracles; (b) `33ec4a28a` — as
    wasm-tools, `(global $g i32 (i32.add (global.get $b) (i32.const 8)))`, by a `oneLine` depth in
    the writer. Text only: 0 of 421 files moved a byte; folded text moved on 421, linear on 0. (c)
    Folded output printed no `;; label = @N` on an unnamed block / loop / `if` / `try_table`, which
    both oracles and our own linear output print — ✅ CLOSED 2026-09-29 (`19b5f5fc5`): one
    `writeLabelComment` for all ten sites, upstream's spacing; folded text moved on 418, bytes 0
- **id:** N9
  - vs: all tools
  - what differs: the `name` section's POSITION is not kept through text: `wasm2wat` → `wat2wasm`
    writes it after every known section, wherever the binary had it (a custom section may sit
    between any two). The text format has no spelling for it — the generated section is not an
    `@custom`
  - class: DESIGN
  - status / authority: ✅ CLOSED (owner, 2026-09-29), was open item M2f. Measured first: **0 of
    6,414 modules** (the spec corpus + wasmtk's `.wasm`) place it anywhere but last — all 457 with a
    name section; wasm-tools does the same (`type func name code` → `type func code name`); the
    spec's appendix expects it once, after the data section. Keeping it would need a non-standard
    annotation no other tool reads, for a case that does not occur. A name section the reader keeps
    RAW (C5, N5) keeps its place like any `@custom`
- **id:** A1
  - vs: wasm-tools
  - what differs: wabt-ts ACCEPTS `(array (field id? fieldtype))` — the spec grammar is `(array
    fieldtype)`, and `(field …)` is the STRUCT form. `wasm-tools` refuses it; upstream wabt and
    binaryen both take it. Our `wasm2wat` prints it only when the field has a NAME, which is the one
    thing the spec form cannot express
  - class: DESIGN
  - status / authority: ✅ RESOLVED 2026-09-11 — and NOT the defect it was filed as. The spec text
    says `(array fieldtype)` (webassembly.github.io/gc/core/text/types.html), but upstream wabt
    parses an array's element with the SAME `ParseField` as a struct's (`wast-parser.cc:1793`, id
    and all) and binaryen takes it too, rejecting only a second field; the testsuite has no case
    either way, so nothing must reject it. We took the form but NOT its `id` — so a field named in
    the binary (subsection 10, N2) was DROPPED by `wasm2wat`, a name lost at the text hop. Now the
    id is read, and the wrapper is printed only when there is a name to keep
- **id:** S7
  - vs: wabt
  - what differs: by default our `wat2wasm` writes a `binaryang.text-form` custom section (last,
    after `name`) recording how each INSTRUCTION was written — bare or folded, grouped how —
    wherever the source is not the plain nested fold, and our `wasm2wat` gives it back that way:
    linear, folded or the same mix; upstream `wat2wasm` writes no such section and upstream
    `wasm2wat` prints one form throughout. Bytes differ from upstream's by that section only (268 of
    1,043 corpus sources; per function until `1f8e8985f`, 122)
  - class: DESIGN
  - status / authority: 🗓️ OWNER, 2026-09-19: "the first rule is fidelity for the wat2wasm and
    wasm2wat… this part transpiles verbatim", and "a mixed form if a mixed form is in the wat… It
    should never change the state unless it goes into optimization". `--no-text-form` / `textForm:
    false` gives upstream's bytes exactly; outside custom sections parity is unchanged. Optimizing
    and `wasm-strip` drop it. `text_form.test.ts`; ir-convergence.md § "S7"
- **id:** W13
  - vs: wabt
  - what differs: a legacy `try` with a `catch` (or a second `catch_all`) AFTER its `catch_all`:
    upstream wabt 1.0.41 accepts it in `wat2wasm` AND `wasm-validate`; we refuse it ("catch after
    catch_all")
  - class: DESIGN
  - status / authority: 2026-09-28 (`0f9e05242`, pre-bump item 3, reported by wasmtk 2026-09-19).
    The legacy-EH grammar is `try … catch* catch_all? end`; **V8 refuses it** ("catch after
    catch-all"), and so does wasm-tools. V8 is the oracle for legacy EH (`rethrow_depth.test.ts`'s
    note). Our text parser already refused a second `catch_all`; the validator now refuses both.
    `catch_after_catch_all.test.ts`
- **id:** W15
  - vs: wabt
  - what differs: a block / loop / if header written `(type $t)` stays the type INDEX in our
    `wat2wasm` (`02 00`), as written — as `wasm-tools` writes it; upstream wat2wasm inlines a `[] ->
    [t]` type as its value type (`02 7f`)
  - class: DESIGN
  - status / authority: the T1 rule: an index as written is kept (S6 decision 7c). Measured
    2026-09-28 in stage 5, when binaryen-ts's retired parser (which gave upstream's bytes) stopped
    being the text route; `text_route/type_use.test.ts` pins wasm-tools' bytes. Not in the 421-file
    parity: no corpus source writes it
- **id:** W17
  - vs: wasm-tools
  - what differs: an explicit `(sub final …)` with NO supertypes is written `0x4f 00` + comptype, as
    the text wrote it; `wasm-tools` writes the bare-comptype shorthand (the spec's meaning of a bare
    comptype is `sub final` with no supertypes). Both decode to the same type
  - class: DESIGN
  - status / authority: the T1 rule, one-to-one: the IR keeps `sub` ABSENT (shorthand) apart from `{
    final: true, supertypes: [] }` (`TypeEntryBase.sub`, `writeSubType`). Measured 2026-09-28
    building custom descriptors: the only 2 of 93 proposal modules not byte-identical to wasm-tools
    (`descriptors.wast` @3, @36). Upstream wabt not measured on it (its `wast2json` cannot read the
    proposal)
- **id:** W10a
  - vs: wabt
  - what differs: where a STATEMENT splits an instruction's operands (`local.get 0` `nop` `local.get
    0` `br_table 0 0`), upstream `wasm2wat --fold-exprs` folds NONE of them (all or nothing); ours
    folds the operands it truly holds — `(br_table 0 0 (local.get 0))` after the `local.get 0` and
    `nop` statements
  - class: DESIGN
  - status / authority: 🗓️ OWNER, 2026-09-19: **keep ours.** "The more accurate the folded nature
    the better our setup treats it": a folded tree is what the parser and the optimizer's text route
    read, and the defects this project found were in the LINEAR / less-folded shapes (post-M8 fixes
    4, 5, 9, 10), not the folded ones. Same bytes either way (checked: both texts assemble to the
    original code through upstream's and our `wat2wasm`). Found measuring post-M8 fixes 9 and 10
    (`kids.ts`)

**The front-door decision behind W4** (owner, 2026-09-10): the end state is WAT → wabt-ts parser →
wabt-ts binary writer → bytes → binaryen-ts decoder. So binaryen-ts's WAT parser is not a second
front end to be completed — it is internal, and a candidate for retirement once S6 unifies the tree.
Do not invest in its stack-form support ("Stage 1" in ir-convergence is superseded). C1's pin is
upstream's rule, not upstream's bytes: the test FAILS against the pre-fix pass, and the three
invalidation tests it had made vacuous were rebuilt and verified to FAIL with invalidation disabled.
