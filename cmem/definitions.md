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
  License, its `proposals/` under CC0; opcode numbers and mnemonics are facts. Nothing was copied
  into the repo; a durable check would carry the extracted facts with their source and licence.

**Not yet done — the durable form:** this was a one-time proof. Making the specification the
SOURCE going forward means a committed check (a Bun script and a pinned snapshot of the extracted
facts, with their source commits) that the gate runs, so D1 cannot drift from the spec unseen;
it fits beside D4 (open-work 34), which needs the same source documents for its features.

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
