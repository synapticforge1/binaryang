# N1 — names: the scope

Scoped 2026-09-11, owner-requested ("so that this is not skipped"; "a fidelity issue that we need to
scope"). Every number below is MEASURED — scripts in the session scratchpad, re-runnable by their
description. The register entry is N1 in [divergences.md](divergences.md).

## The rule being implemented (owner, 2026-09-10)

- **wabt-ts ALWAYS keeps names** — it is the fidelity half and never optimizes. Acceptance: **WAT →
  `wat2wasm` → `wasm2wat` reconstitutes the WAT, names included.** No opt-out; removal is the
  separate, explicit `wasm-strip`.
- **Reading and writing without optimization keeps names** (binaryen-ts decode → encode too).
- **Optimized output follows a `-g`-style `debugInfo` option** (default off, as upstream).
- **Export and import names are the interface, not N1** — inviolable, already pinned.
- How optimization treats internal vs exported names is a **future owner discussion**; not here.

## 1. Which names are at stake — 63,930 of them in the corpus

The `name` section's twelve subsections, and how many the 421 corpus sources write. ⚠️ Corrected
2026-09-11 while building P1–P3: the scope's regex counts missed two-thirds of the params and locals
and 40% of the labels. The figures below are from the PARSE TREE (P1's `localNames`, P3's
acceptance), and the scope's first estimate of "~43,000" was 63,930.

| sub | kind     | corpus source names (modules)                              | home in wabt-ts IR                                     | home in binaryen-ts IR                  |
| --: | -------- | ---------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------- |
|   0 | module   | 0 (0)                                                      | `Module.name`                                          | ✗ none                                  |
|   1 | function | 8,298 (420)                                                | `Func.name` (imports: `imp.func.name`)                 | `WasmFunction.name` / `WasmImport.name` |
|   2 | local    | 14,973 params + 25,444 locals = 40,417 (scope said 24,694) | `Func.localNames` (P1) — `LocalDecl` is `{type,count}` | `Local.name?` (params: ✗)               |
|   3 | label    | 13,611: 5,925 block + 7,686 loop (scope said 8,308)        | `label` on block/loop/if/try/try_table                 | block names are REGENERATED (fresh)     |
|   4 | type     | 78 (44)                                                    | `TypeEntry.name`                                       | ✗ `TypeDef` has none                    |
|   5 | table    | 2 (2)                                                      | `Table.name`                                           | `WasmTable.name`                        |
|   6 | memory   | 3 (3)                                                      | `Memory.name`                                          | `WasmMemory.name`                       |
|   7 | global   | 1,488 (416)                                                | `Global.name`                                          | `WasmGlobal.name`                       |
|   8 | elem     | 2 (2)                                                      | `ElemSegment.name`                                     | `ElementSegment.name`                   |
|   9 | data     | 10 (3)                                                     | `DataSegment.name`                                     | `DataSegment.name`                      |
|  10 | field    | 0 (GC only)                                                | `Field.name`                                           | ✗                                       |
|  11 | tag      | 21 (21)                                                    | `Tag.name`                                             | `WasmTag.name`                          |

## 2. What upstream keeps (probed, wabt 1.0.41 / binaryen 132)

| tool                             | kinds written                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `wat2wasm` (default)             | none                                                                                                |
| `wat2wasm --debug-names`         | module, function (imports too), local, type, table, memory, global, elem, data, tag — **NOT label** |
| `wasm-opt` (no flags, no passes) | none — strips even a plain round trip                                                               |
| `wasm-opt -g`                    | everything it was given                                                                             |
| `wasm-opt -O2 -g`                | only what survives: functions left, type; locals gone                                               |

**Upstream cannot reconstitute its own labels**: `wat2wasm --debug-names` → `wasm2wat` gives back 13
of 15 names on the probe module — `$the_block` and `$the_loop` are lost. Field names cannot be
probed at all (upstream cannot parse GC text — oracle gap G1). So under the owner's rule, **label
and field names go BEYOND upstream: a FEATURE row.** Cost of keeping names, re-measured after P2 as
the size with the name section minus the size without, per module: upstream's `--debug-names` adds
**359,868 bytes (+23.8%)** over the corpus; ours adds **446,858 (+29.5%)** — the difference is the
13,611 labels. (The scope first said 311,456 / +20.2%; that did not survive a direct measurement.
The owner accepted the cost, decision 3.)

## 3. Where each hop loses them — measured over the corpus

| hop                                      | kept of 63,930 source names — scoped                | after P2 + P3 (2026-09-11)                                          |
| ---------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| A. our `wat2wasm` → our `wasm2wat`       | **2**                                               | ✅ **63,930 / 63,930**, and a byte fixed point 421/421, both forms  |
| B. upstream `--debug-names` → our reader | **2** — the reader reads NOTHING (defect below)     | ✅ 50,319 — every name upstream writes; it writes no label (13,611) |
| C. upstream-named bytes → binaryen-ts    | **0**: 7,611 / 7,611 functions get a synthetic name | ⬚ P4                                                                |
| D. binaryen-ts re-encode                 | 0 modules carry a name section                      | ⬚ P5                                                                |

What each component does, found by reading and confirmed by the probes:

| component                 | state                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| wabt-ts **parser**        | resolves `$param` / `$local` to slots and DISCARDS the names — there is no field to keep them in. Entity names and labels are kept                                                                                                                                                                                                                                                                |
| wabt-ts **binary writer** | writes no name section; `writeDebugNames` is declared and ignored (`_opts`)                                                                                                                                                                                                                                                                                                                       |
| wabt-ts **reader**        | 🐛 **has never read a name.** `readNameSection` is handed the payload from `nameStart` — BEFORE the section's own name — so it parses the string `"name"` as subsections (`0x04` read as "type names") and skips to the end. Even fixed, it reads only subsections 0 and 1, and only DEFINED functions. And it CONSUMES the section, so a wabt-ts binary round trip drops a name section outright |
| wabt-ts **WAT writer**    | writes entity names; never param or local names ("local might have no name — that's fine")                                                                                                                                                                                                                                                                                                        |
| wabt-ts `applyNames`      | holds all twelve kinds in `ModuleNames`; wired into nothing; its expression rewriter is partial                                                                                                                                                                                                                                                                                                   |
| binaryen-ts **decoder**   | skips the name section. Builds every reference name from its index on the spot — ~40 sites (`$func${i}` ×13, `$tag` ×9, `$global` ×6, `$table` ×6, `$data` ×4, `$elem` ×2)                                                                                                                                                                                                                        |
| binaryen-ts **encoder**   | writes no name section                                                                                                                                                                                                                                                                                                                                                                            |

## 4. What depends on names — the constraints on the design

- **binaryen-ts refers BY NAME.** Calls, `global.get`, exports, elements name their targets, so a
  name read from the section must be the name EVERY reference site uses: one index→name table per
  namespace, built before any section that refers to it. The name section comes AFTER the code, so
  the decoder must pre-scan for it (the bytes are in memory).
- **Uniqueness.** Name-section names are arbitrary UTF-8 and may repeat; binaryen-ts needs them
  unique as keys. Upstream binaryen uniquifies. Whether the ORIGINAL spelling must still be
  re-emitted (fidelity) is an owner question below.
- **Block-parameter lowering (7b(i))** re-decodes `encodeWasm(module)` and refuses a module whose
  names no longer match its bytes. Once the decoder reads real names, the encoder must write them —
  at least in that re-encode — or every named module with block parameters fails. **Decoder and
  encoder land together.**
- **Identifiers in text.** A name from a foreign binary may not be a valid WAT identifier; the WAT
  writer must spell it so the text re-reads (probe upstream `wasm2wat` on odd names first).
- **The baseline moves.** Our `wat2wasm` output gains a name section in every corpus module (~+20%,
  more with labels): a deliberate re-baseline, in its own commit, saying why. Byte parity with
  upstream is then measured against `wat2wasm --debug-names`, with the label subsection as a
  documented FEATURE difference.
- **Optimization** drops names unless `debugInfo` — decided at the encode after `PassRunner`, never
  in the fidelity path.
- **Other consumers** start seeing names once the reader works: `wasm2wat`, `wasm-objdump`, the
  wabt-compat `readWasm` (all default `readDebugNames: true`). Their outputs change for named input.

## 5. The plan — six steps, each its own gated commit

| step | what                                                                                                                                            | size   | acceptance                                                                            | status                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| P1   | wabt-ts IR: a home for PARAM and LOCAL names; the parser keeps them; the WAT writer writes them                                                 | medium | a text-only round trip (parse → WAT writer) keeps every param/local name              | ✅ `acc5e7e23`, merged `e127d1aad`                      |
| P2   | wabt-ts binary writer: a name section, ALWAYS, all kinds incl. labels (and fields); `writeDebugNames` removed or made truthful; **re-baseline** | medium | bytes = upstream `--debug-names` for its ten kinds; labels extra and documented       | ✅ `ab9d48b1e` — 426/426 name sections equal upstream's |
| P3   | wabt-ts reader: fix the slice; read all twelve subsections; keep the section on a round trip                                                    | medium | **the owner's test: corpus WAT → `wat2wasm` → `wasm2wat` keeps every name**           | ✅ `b76dde783` — 63,930 / 63,930; fixed point 421/421   |
| P4   | binaryen-ts decoder: pre-scan; per-namespace name tables at the ~40 sites; locals; labels as block names; uniquify                              | large  | upstream-named bytes → IR names = the section's (C: 0 synthetic)                      | ⬚                                                       |
| P5   | binaryen-ts encoder: a name section; fidelity path always; after `PassRunner` only under `debugInfo`; kept in the lowering re-encode            | medium | decode → encode byte-identical on named input; `-O2 -g` vs upstream `wasm-opt -O2 -g` | ⬚ **and delete `tests/binaryen-ts/wabt_reference.ts`**  |
| P6   | `readWat` and `wasm-opt`: names flow end to end                                                                                                 | small  | `$foo` through every route                                                            | ⬚                                                       |

P4 and P5 merge together (the lowering constraint). Nothing here touches exported or imported names
except to keep pinning them.

⚠️ **"P1–P3 are independent of P4–P5" was wrong.** Nothing in binaryen-ts changed, but its tests
compare binaryen-ts's output with wabt-ts's BYTES, and those bytes gained a name section in P2 —
nine test files failed on the name section alone. They now compare against
`tests/binaryen-ts/wabt_reference.ts` (wabt-ts's bytes with the name section cut out, byte-level).
That is a deliberate, temporary narrowing: once P5 writes names, binaryen-ts's output has a section
the reference lacks and every one of those comparisons FAILS — the signal to delete the helper, not
to strip binaryen-ts's side too. (Its decode → encode users feed the stripped bytes in and would
keep passing, which is why P5's row names the file.)

## Found while building P2 and P3 (2026-09-11)

- **`wasm2wat` invented names, always** — `generateNames` gave every unnamed entity `$f0`, `$t0`, …
  Harmless while no binary carried names; once they did, the invented ones went into the next
  `wat2wasm`'s name section as if the author had written them, and WAT → `wat2wasm` → `wasm2wat` no
  longer reconstituted the WAT. Upstream only does it under `--generate-names`. Now the same: an
  option, default off (`generateNames`, CLI `--generate-names`). Unnamed entities print as upstream
  prints them — `(;0;)`, referenced by index. It was an UNREGISTERED divergence; now closed.
- **Names the text format cannot spell plainly** are printed QUOTED — `$"foo bar"` — where upstream
  `wasm2wat` substitutes `_` (a rename: `$foo_bar`). Register row N3.
- **Duplicates** get upstream's `.1`, `.2` suffix at read time (decision 2).
- **When the module cannot hold exactly what the section said**, the reader keeps the section as raw
  bytes too, and the writer writes those back instead of generating: malformed, a subsection id past
  eleven, an index with no entity, an empty name, a duplicate renamed. A binary round trip is then
  lossless either way.
- **A binary without a name section must not gain one** on a binary round trip:
  `Module.hasNameSection` (true for text and hand-built modules, so `(module)` gets upstream's
  10-byte section; the reader sets it to whether the binary had one). The writer generates when that
  is set OR anything is named.
- **Label indices** count every label-introducing instruction in BINARY order — a folded
  `(if (block …))` writes the block first. The writer counts as it writes; the reader numbers with
  the same `ExprVisitor` walk, so they cannot disagree. No oracle checked the order: upstream wabt
  writes no labels and `wasm-tools` is not installed here.
- Found beside it, not N1: the WAT writer prints custom sections as `(@custom …)` and the parser
  cannot read that, so `wasm2wat` → `wat2wasm` drops every custom section (register C2, DEFECT). And
  the folded writer drifted two columns left per block (fixed; hidden while every block had a
  generated label).

⬚ **Follow-ups, cosmetic** — they change text, never bytes, and never lose a name: `wasm2wat` prints
entity and branch REFERENCES by index (`call 0`, `br_if 1 (;@1;)`) where upstream prints
`call $foo`; and folded siblings share a line (`…)))) (if`).

## ✅ Owner decisions (2026-09-11)

1. **Label and GC field names are kept — a new FEATURE**, a deliberate divergence from upstream,
   which writes neither. Register row N2 in divergences.md.
2. **Names are kept as written.** Duplicates should not arise in practice — code with them would
   fault anyway, and the wasmtk bundler already resolves them when it merges modules into one. So no
   side table of original spellings: the name section's names ARE the names. Where a duplicate does
   arrive in a foreign binary, binaryen-ts disambiguates it (as upstream binaryen does) so it can
   use it as a key; that case is not a fidelity target.
3. **The size is accepted** for fidelity's sake: "when we send it through the optimization it just
   goes away" — optimized output follows `debugInfo`, default off. No opt-out beyond `wasm-strip`.
