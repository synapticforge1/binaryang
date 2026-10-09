# Unreleased on `main` — what the next release note must say

**As of 2026-10-09: `main` holds item 24 (`wasm-bundle`, a NEW export) past `v1.9.0`, and the
owner's go for 1.10.0 is given** ("lets do the 1.10.0 release"; check the set rather than trust
this line: `git log --oneline v1.9.0..main -- src/ main.ts deno.json`). A MINOR, typed by hand
([publishing.md](publishing.md) § "`bump` has no minor mode"); the entries are under "Since
1.9.0" below until the release folds them.

**Folded away** under the cleanup policy ([INDEX.md](INDEX.md)): every entry this file held since
1.5.4 shipped — in **1.6.0** (One front end, `./binary` and `./encoder` removed, the IR record
changes, the post-M8 and Q1–Q8 fixes, S7), **1.6.1** (the CLI from JSR), **1.7.0** (`./interop`
removed, wasmtk's items 1–5 with custom descriptors, `--converge`, the minify passes, Flatten
complete), **1.7.1** (u64 limits and the 1-byte-page cap), **1.7.2** (`wasm2wat` text as upstream /
wasm-tools: N10, W18, M2a; `array.new_default` defaultability) or **1.8.0** (diagnostics DG1–DG6,
the `wat2wasm` CLI validating by default, the reader stopping at its first error, Q10–Q13,
`LowerCustomPageSizes` with its `#pagesize=` exports, `wasm-opt` validating its input) or **1.8.1**
(wasmtk's § 20: L3 trap kind, L4 placeholder, C7 `getFunctionInfo` shape). The public summary of
each is `CHANGELOG.md` § that version; the full notes as gathered, BREAKING items field by field:
`git show 769b4d3c0:cmem/unreleased.md` (to 1.7.0), this file at `7aa54e95c` (1.7.1 → 1.7.2), at
`fb5068e47` (1.8.0), and at `99f2a5b16` (1.8.1).

## How to use this file

Add an entry when a change on `main` is one a release note must carry — say which kind:

- ⚠️ **BREAKING** — a removed or renamed export, a changed IR field, a changed default. Makes the
  release a MINOR, typed by hand ([publishing.md](publishing.md) § "`bump` has no minor mode").
- **Behaviour** — output bytes move, or an input is accepted / refused that was not.
- **Silent fix** — was wrong without saying so; say what a user may have shipped.
- **NEW** — an export, a pass, a CLI flag.

⚠️ **wasmtk pins binaryang EXACTLY** and wants each release to say which of their reported items it
contains ([handoffs.md](handoffs.md)).

## Since 1.9.0

The 1.9.0 notes as gathered, entry by entry, are `git show 82113369e:cmem/unreleased.md`; the
public summary is `CHANGELOG.md` § 1.9.0.

- **NEW — `wasm-bundle`** (2026-10-08, open-work item 24, [bundle.md](bundle.md)): a CLI command
  and the `./tools/wasm-bundle` subpath (`bundle`, `wasmBundle`, `BundleError`, the option and
  report types). **A new export: the release is a MINOR, 1.10.0.** wasmtk's § 24 / § 25 item; its
  pin moves to a fifth specifier. The public note is `CHANGELOG.md` § Unreleased.
- **NEW — `(@reloc data)` in WAT** (same commit): the assembler writes `linking` + `reloc.CODE` /
  `reloc.GLOBAL` / `reloc.DATA` from the marks. A text that never wrote `(@reloc …)` is unaffected;
  one that did was "skipped as an unknown annotation" before and is now acted on — say so in the
  note.
- **IR** (same commit): `ConstExpr.reloc?`, `DataSegment.relocs?`, `DataSegment.dataLoc?` — all
  optional, absent on every node the reader or parser made before. Not a BREAKING item: nothing a
  consumer built before changes shape. `src/wabt-ts/core/linking.ts` is new.
