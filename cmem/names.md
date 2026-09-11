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

## 1. Which names are at stake — 43,000 of them in the corpus

The `name` section's twelve subsections, and how many the 421 corpus sources write:

| sub | kind     | corpus source names (modules) | home in wabt-ts IR                         | home in binaryen-ts IR                  |
| --: | -------- | ----------------------------- | ------------------------------------------ | --------------------------------------- |
|   0 | module   | 0 (0)                         | `Module.name`                              | ✗ none                                  |
|   1 | function | 8,298 (420)                   | `Func.name` (imports: `imp.func.name`)     | `WasmFunction.name` / `WasmImport.name` |
|   2 | local    | 7,245 params + 17,449 locals  | **✗ NONE** — `LocalDecl` is `{type,count}` | `Local.name?` (params: ✗)               |
|   3 | label    | 8,308 (415)                   | `label` on block/loop/if/try/try_table     | block names are REGENERATED (fresh)     |
|   4 | type     | 78 (44)                       | `TypeEntry.name`                           | ✗ `TypeDef` has none                    |
|   5 | table    | 2 (2)                         | `Table.name`                               | `WasmTable.name`                        |
|   6 | memory   | 3 (3)                         | `Memory.name`                              | `WasmMemory.name`                       |
|   7 | global   | 1,488 (416)                   | `Global.name`                              | `WasmGlobal.name`                       |
|   8 | elem     | 2 (2)                         | `ElemSegment.name`                         | `ElementSegment.name`                   |
|   9 | data     | 10 (3)                        | `DataSegment.name`                         | `DataSegment.name`                      |
|  10 | field    | 0 (GC only)                   | `Field.name`                               | ✗                                       |
|  11 | tag      | 21 (21)                       | `Tag.name`                                 | `WasmTag.name`                          |

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
and field names go BEYOND upstream: a FEATURE row.** Cost of keeping names: upstream's name sections
add **311,456 bytes (+20.2%, ~740 per module)** over the corpus — before labels.

## 3. Where each hop loses them — measured over the corpus

| hop                                      | kept of ~43,000 source names                        |
| ---------------------------------------- | --------------------------------------------------- |
| A. our `wat2wasm` → our `wasm2wat`       | **2**                                               |
| B. upstream `--debug-names` → our reader | **2** — the reader reads NOTHING (defect below)     |
| C. upstream-named bytes → binaryen-ts    | **0**: 7,611 / 7,611 functions get a synthetic name |
| D. binaryen-ts re-encode                 | 0 modules carry a name section                      |

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

| step | what                                                                                                                                            | size   | acceptance                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| P1   | wabt-ts IR: a home for PARAM and LOCAL names; the parser keeps them; the WAT writer writes them                                                 | medium | a text-only round trip (parse → WAT writer) keeps every param/local name              |
| P2   | wabt-ts binary writer: a name section, ALWAYS, all kinds incl. labels (and fields); `writeDebugNames` removed or made truthful; **re-baseline** | medium | bytes = upstream `--debug-names` for its ten kinds; labels extra and documented       |
| P3   | wabt-ts reader: fix the slice; read all twelve subsections; keep the section on a round trip                                                    | medium | **the owner's test: corpus WAT → `wat2wasm` → `wasm2wat` keeps 43k/43k names**        |
| P4   | binaryen-ts decoder: pre-scan; per-namespace name tables at the ~40 sites; locals; labels as block names; uniquify                              | large  | upstream-named bytes → IR names = the section's (C: 0 synthetic)                      |
| P5   | binaryen-ts encoder: a name section; fidelity path always; after `PassRunner` only under `debugInfo`; kept in the lowering re-encode            | medium | decode → encode byte-identical on named input; `-O2 -g` vs upstream `wasm-opt -O2 -g` |
| P6   | `readWat` and `wasm-opt`: names flow end to end                                                                                                 | small  | `$foo` through every route                                                            |

P4 and P5 merge together (the lowering constraint). P1–P3 are wabt-ts-only and independent of them.
Nothing here touches exported or imported names except to keep pinning them.

## Owner decisions this needs before P1

1. **Labels (and GC field names) beyond upstream** — required by the reconstitution rule; upstream
   `wat2wasm` does not write them. Confirm as a FEATURE.
2. **Duplicate / invalid names from foreign binaries** — binaryen-ts must uniquify them to use them
   as keys (as upstream binaryen does). Should the ORIGINAL spellings be kept aside and re-emitted
   verbatim on a no-pass round trip (strict fidelity), or is the uniquified name acceptable there?
3. **The size cost** (+20% and more with labels) is the price of "always"; confirm no opt-out beyond
   `wasm-strip`.
