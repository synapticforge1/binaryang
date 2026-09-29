# Unreleased on `main` — what the next release note must say

**Nothing, as of 2026-09-29.** `main` = `v1.8.0` plus cmem-only commits (check it rather than trust
this line: `git log --oneline v1.8.0..main -- src/ main.ts deno.json`). `deno.json` reads 1.8.0; the
version line arms a release ([publishing.md](publishing.md)), so the next bump is the owner's
decision, never a side effect of work.

**Folded away** under the cleanup policy ([INDEX.md](INDEX.md)): every entry this file held since
1.5.4 shipped — in **1.6.0** (One front end, `./binary` and `./encoder` removed, the IR record
changes, the post-M8 and Q1–Q8 fixes, S7), **1.6.1** (the CLI from JSR), **1.7.0** (`./interop`
removed, wasmtk's items 1–5 with custom descriptors, `--converge`, the minify passes, Flatten
complete), **1.7.1** (u64 limits and the 1-byte-page cap), **1.7.2** (`wasm2wat` text as upstream /
wasm-tools: N10, W18, M2a; `array.new_default` defaultability) or **1.8.0** (diagnostics DG1–DG6,
the `wat2wasm` CLI validating by default, the reader stopping at its first error, Q10–Q13,
`LowerCustomPageSizes` with its `#pagesize=` exports, `wasm-opt` validating its input). The public
summary of each is `CHANGELOG.md` § that version; the full notes as gathered, BREAKING items field
by field: `git show 769b4d3c0:cmem/unreleased.md` (to 1.7.0), this file at `7aa54e95c` (1.7.1 →
1.7.2), and at `fb5068e47` (1.8.0).

## How to use this file

Add an entry when a change on `main` is one a release note must carry — say which kind:

- ⚠️ **BREAKING** — a removed or renamed export, a changed IR field, a changed default. Makes the
  release a MINOR, typed by hand ([publishing.md](publishing.md) § "`bump` has no minor mode").
- **Behaviour** — output bytes move, or an input is accepted / refused that was not.
- **Silent fix** — was wrong without saying so; say what a user may have shipped.
- **NEW** — an export, a pass, a CLI flag.

⚠️ **wasmtk pins binaryang EXACTLY** and wants each release to say which of their reported items it
contains ([handoffs.md](handoffs.md)).

## Since 1.8.0

wasmtk's § 20 ([handoffs.md](handoffs.md)), all for 1.8.1 — owner: "fix all three now and then
release to 1.8.1". Public text: `CHANGELOG.md` § 1.8.1.

- ⚠️ **BREAKING by the rule, released as a PATCH by the owner's decision — `getFunctionInfo`**
  (C7): `params` / `results` are `createType(…)` (`none`, one type, an array for a tuple), as
  binaryen.js; they were always arrays.
- **Silent fix — a lowered out-of-bounds access traps as out of bounds** (L3), not `unreachable`.
- **Behaviour — the lowered-memory placeholder** (L4): an exported lowered memory also exports an
  immutable i32 global under its original name; a lowered importer imports it first. One more
  export and import per lowered memory, which a host passes along.
