# The shared definitions, `./definitions` — open-work item 22 (H9), closed

**Closed 2026-10-08 with the 1.9.0 release and its letter** ([handoffs.md](handoffs.md) § 26).
Placed on the list by the owner 2026-09-30 from wasmtk's § 23 (H9: a subpath for them to
generate their copies from, H10). Built 2026-10-06 in two commits — D2 and D3 (`3c76184d0`),
then D1 (`db153a5cc`). This file is the summary the cleanup policy asks for ([INDEX.md](INDEX.md));
the full record as it stood before the cut is `git show 9907fdc82:cmem/open-work.md` (item 22).
The workspace's design is `../cmem/divergences.md` § "The shared definitions".

## What shipped

`@jrmarcum/binaryang/definitions` (`src/definitions/mod.ts`); the JSON sources ship in the
package at `src/definitions/*.json`, each with `dataVersion` and a `sha256` of its canonical
content (keys sorted, the hash field empty), so a generated copy's header can quote both and a
consumer's gate can prove its copy matches.

- **D2, `features.json`** (22 entries): `name` = the `Features` key, `cli`, `defaultOn`,
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

## What the proof found (all fixed in `db153a5cc`; release notes in `CHANGELOG.md` § 1.9.0)

- Five default-on features were gated NOWHERE in the validator (`simd`, `signExtension`,
  `satFloatToInt`, `bulkMemory`, `referenceTypes`): 254 of 345 gated instructions validated with
  the feature off. One gate now asks D1 for each instruction's feature (`everyExpr`, a hook NOT
  named `on…` — three Proxy delegates answer every `on…` name).
- `i64.add128` / `i64.sub128` left their FIRST operand unchecked.
- `delegate`, `catch_all` and `try_table` had no name in diagnostics.
