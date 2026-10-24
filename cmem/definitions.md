# The shared definitions, `./definitions` — open-work item 22 (H9), closed

**Closed 2026-10-08 with the 1.9.0 release and its letter** ([handoffs.md](handoffs.md) § 26).
Placed on the list by the owner 2026-09-30 from wasmtk's § 23 (H9: a subpath for them to
generate their copies from, H10). Built 2026-10-06 in two commits — D2 and D3 (`b482b711d`),
then D1 (`d2bcdf769`). This file is the summary the cleanup policy asks for ([INDEX.md](INDEX.md));
the full record as it stood before the cut is `git show d0f3dbabd:cmem/open-work.md` (item 22).
The workspace's design is `../cmem/divergences.md` § "The shared definitions".

## What shipped

`@jrmarcum/binaryang/definitions` (`src/definitions/mod.ts`); the JSON sources ship in the
package at `src/definitions/*.json`, each with `dataVersion` and a `sha256` of its canonical
content (keys sorted, the hash field empty), so a generated copy's header can quote both and a
consumer's gate can prove its copy matches.

- **D2, `features.json`** (22 entries): `name` = the `Features` key, `cli` (and, since data version
  1.1.0 — 2026-10-24, open-work 33 — `cliAliases`: older spellings still accepted, deprecated;
  `satFloatToInt`'s `cli` became upstream's `saturating-float-to-int`; at data version 2.0.0, for
  binaryang 2.0.0, open-work 39: the alias and the `cliAliases` field removed), `defaultOn`,
  `implemented`, `testsuiteDirs`, `onlyIn` / `offIn` for a feature that changes core semantics
  (custom-descriptors relaxes `br_on_cast` everywhere), `note`, `since`. `FEATURE_DEFINITIONS`,
  `featuresForSuite(dir)`. binaryang is its first consumer: `scripts/proposals.ts`, the core spec
  harness and `measure-diagnostics.ts` take their feature sets from it.
- **D3, `verdicts.json`**: 19 trap classes plus `call stack exhausted`, `key` / `message`, with
  the PREFIX rule stated in the data (`uninitialized element 2` matches `uninitialized element`).
  `VERDICT_DEFINITIONS`, `verdictClass(text)`. Proved against the prepared suites: a class for
  every trap / exhaustion message they write (21 distinct across core, the four proposals and
  legacy EH).
- **D1, `opcodes.json`** (582 entries): `name`, `encoding`, `prefix`, `opcode`, `immediates` (in
  binary order; the vocabulary in the data's `rules`), `align` (the natural alignment),
  `signature` (fixed stack types, 498 of 582; null where an immediate or the stack decides),
  `feature` (a D2 name), `class`. `OPCODE_DEFINITIONS`, `opcodeKey()`, `opcodeDefinition()`.
  **Proved** (`tests/definitions/opcodes.test.ts`, each check inverted when written): every entry
  decodes as ONE instruction and re-encodes to its bytes; every signature validates and is refused
  with its first or last operand changed; align is exactly natural; every gated instruction is
  refused with its feature off. binaryang reads it: `opcode.ts`'s name tables and
  `naturalAlignForOpcode` are built from it, `check-operator-mapping.ts` reads it; the SIMD
  differential (`simd_differential.test.ts`) asserts its coverage against it.
- **The gate step `definitions`** (`deno task definitions --check --prepared <roots>`): stamps and
  checks the hashes, regenerates `src/definitions/data.ts` and fails on a difference.

## Decisions

- **D2 and D3 first, D1 later** — wasmtk's order, approved by the owner 2026-10-06 (reversing the
  workspace plan; the workspace session updates its own record).
- **A new export is a MINOR**; wasmtk pins the exact version. Their generator (`scripts/
  gen-definitions.ts` → `src/definitions.generated.ts`, regenerated and diffed by their gate) is
  theirs; which fields they consume is in § 23.
- **What D1 does not prove:** the index space an immediate names beyond what the signature
  check resolves; text shorthands (wasmtk's I2 list) beyond the mnemonic and the memarg's
  `offset=` / `align=`.

## What the proof found (all fixed in `d2bcdf769`; release notes in `CHANGELOG.md` § 1.9.0)

- Five default-on features were gated NOWHERE in the validator (`simd`, `signExtension`,
  `satFloatToInt`, `bulkMemory`, `referenceTypes`): 254 of 345 gated instructions validated with
  the feature off. One gate now asks D1 for each instruction's feature (`everyExpr`, a hook NOT
  named `on…` — three Proxy delegates answer every `on…` name).
- `i64.add128` / `i64.sub128` left their FIRST operand unchecked.
- `delegate`, `catch_all` and `try_table` had no name in diagnostics.

## D1 against the specification — every opcode attested (2026-10-23)

The owner asked whether binaryang's opcode set is "based on wabt" and agreed to re-derive it from
the specification (item 2 of the standalone question; item 1 was the Binaryen attribution,
[licensing.md](licensing.md)). D1's table came to binaryang through wabt-ts's port of wabt; its
CONTENT — bytes, mnemonics — is facts of the specification. Measured, one-time scratch scripts,
read-only sparse clones of the sources:

| source (all fetched 2026-10-23) | opcodes it defines | in D1 with the same opcode AND name |
| --- | --- | --- |
| WebAssembly/spec `4441525` — `document/core/appendix/index-instructions.py`, names through `document/core/util/macros.def` | 499 | **499** |
| WebAssembly/threads `cc535ad` — `proposals/threads/Overview.md` (binary grammar) | 67 | **67** |
| WebAssembly/wide-arithmetic `024d4ce` — `proposals/wide-arithmetic/Overview.md` | 4 | **4** |
| WebAssembly/custom-descriptors `412f62d` — `proposals/custom-descriptors/Overview.md` | 7 | **7** |
| WebAssembly/spec — `proposals/exception-handling/legacy/Exceptions.md` (table) | 6 (`throw` also in the spec) | **6** |

**499 + 83 = 582: no D1 opcode lacks a specification source, and no opcode the specification
defines is missing from D1.** The opcode set rests on the specification, not on wabt.

- **Two names differ only from the instruction INDEX**, which labels `0xfd 0x103` / `0x104`
  `i32x4.relaxed_trunc_f64x2_s` / `_u` (abstract syntax); the TEXT format — the spec's own testsuite
  (`test/core/relaxed-simd`, and the vendored copy in wasmtk) and the SpecTec `specification/` —
  writes D1's `…_s_zero` / `…_u_zero`. An inconsistency inside the spec's documents, not in D1.
- **D1's `ref.test null` / `ref.cast null`** (`0xfb 0x15` / `0x17`) carry their form in the name, by
  D1's own rule; the index names both forms alike. Treated as equal.
- **Licences of what was read:** the spec's `document/` is under the W3C Software and Document
  License, its `proposals/` under CC0; opcode numbers and mnemonics are facts. No source text is
  copied; the snapshot below carries only the extracted facts, each source's repository, commit,
  files and licence.

**The durable form (2026-10-24, open-work 34 b):** `bun run spec-opcodes refresh <dir>` reads local
git checkouts `<dir>/spec`, `<dir>/threads`, `<dir>/wide-arithmetic`, `<dir>/custom-descriptors`
(the extraction above, ported into `scripts/spec-opcodes.ts`) and writes
`tests/definitions/spec-opcodes.snapshot.json`: 583 definitions (582 distinct; `throw` twice), the
sources with full commits, and the two known differences with their reasons.
`tests/definitions/spec_opcodes.test.ts` — in `bun run test`, so CI — reads ONLY the snapshot and
requires D1 to equal it both ways; `bun run spec-opcodes check` runs the same comparison. Mutants
on D1 (renamed, renumbered, wrong prefix, dropped from each source, an extra opcode, a known
difference applied to the wrong name, the ` null` form on the wrong name) each fail it, by test.
**When the specification moves:** clone the four repositories, `refresh`, read the diff of the
snapshot — a new opcode fails the test until D1 has it (`bun run definitions`), a renamed one until
D1 follows or the difference is listed in `KNOWN` with its reason.

## D4 — the portability profiles (2026-10-23)

`src/definitions/profiles.json`, exported as `PROFILE_DEFINITIONS` and `profileDefinition(name)`
(owner decision 3 of open-work 34: "binaryang is the source"). One profile, `portable`: the 14
defining engines with the builds measured; one entry per D2 feature with its tier (portable ·
lowered, naming the pass · excluded), the engines measured refusing it and how many probe modules
exercised it; and the instructions whose tier differs from their feature's (`br_on_non_null`
excluded; the legacy exception instructions lowered by `TranslateToExnref`). Every number DERIVED
from the probe results (scratch `pt-derive.ts` over runs 1–3, 5, 6), not written by hand;
`tests/definitions/definitions.test.ts` checks it against D1, D2 and the registered passes. Adding
it changed `data.ts`'s header to `bun run definitions` — the first intentional definitions change
since the Bun migration (B4). `wasm-opt --target <name>` reads it ([portability.md](portability.md)
§ "The portable target").

⚠️ **"Derived, not written by hand" still let two numbers in wrong**: runs 1 and 6 held the same 24
wide-arithmetic and relaxed-SIMD modules (run 6 re-ran them for the stock browsers), and the
derivation counted both, so `probes` said 40 and 8 where 20 and 4 exist. Found by the committed
probe's first run (open-work 34 a); fixed in D4 1.1.0. A derivation over SEVERAL result sets must
count distinct modules, not results.

## D2's dependency and preset rules; `return_call_ref` (2026-10-24, open-work 40)

Asked by wasmrt (item 4) because contract v33 makes D1's `feature` column and D2's rules the
MEANING of both runtimes' `--features`. All measured the same day, sources read in scratch clones
(spec `4441525`, function-references `74d2ec8`, tail-call `a6003d0`).

**`return_call_ref` (0x15) needs `functionReferences` only.** The function-references proposal
defines it (Overview, instructions and opcode table); the tail-call proposal does not mention it,
and the spec's 3.0 change log lists it under neither. With each feature switched off alone:

| needs | tools |
| --- | --- |
| functionReferences only | wasm-tools 1.262, wasmtime 50, wabt 1.0.41 (`wasm-validate`) |
| tail-call AND gc | Binaryen 133 (no separate function-references: "made part of GC") |
| tail-call AND functionReferences | binaryang before the fix — `tail call not allowed`, from wabt-ts (1.8.1 the same) |

Fixed: D1 1.0.1, `Validator.onCallRefExpr`. divergences.md RC1. (D4 1.1.0 first listed it as an
excluded instruction for wasmer; the committed probe then showed wasmer runs every tail call, and
tail calls became portable — portability.md § "The committed probe".)

**D2 `requires` — RECORDED, NOT ENFORCED** (owner, 2026-10-24, after asking what wasmtime does).
Only what a proposal states: functionReferences → referenceTypes ("based on the reference types
proposal"); gc → referenceTypes, functionReferences ("Both proposals are prerequisites"); relaxedSimd
→ simd (every instruction takes `v128`); customDescriptors → gc (its title). Not recorded, because
not stated: reference types only "add instructions missing from" bulk memory; nothing makes
exceptions depend on reference types in words. What the tools do with gc ON and functionReferences
OFF:

| | GC struct | `call_ref` |
| --- | --- | --- |
| wasm-tools 1.262, wasmtime 50, binaryang | accept | refuse |
| Binaryen 133 | accept | accept (gc implies it) |
| wazmrt 2.0.0 (wasmrt's measurement) | accept | accept |

wasmtime refuses no feature SET for these (gc on with reference-types and function-references off
still runs a GC module); it refuses one configuration: relaxed-simd on, simd off ("cannot disable
the simd proposal but enable the relaxed simd proposal"). Not adopted: recorded only means no set
is refused.

**D2 `presets`**: `wasm1` (mutableGlobals — not in the change log, so 1.0), `wasm2` (+ the six 2.0
sections — exactly `defaultOn`), `wasm3` (+ the nine 3.0 features; its exception handling is the
exnref form, while D2's `exceptions` also gates the legacy instructions), `all`. No `mvp` alias
(2.0.0 removed the alias mechanism).
