# Unreleased on `main` — what the next release note must say

**Nothing, as of 2026-09-29.** `main` = `v1.8.1` plus cmem-only commits (check it rather than trust
this line: `git log --oneline v1.8.1..main -- src/ main.ts deno.json`). `deno.json` reads 1.8.1; the
version line arms a release ([publishing.md](publishing.md)), so the next bump is the owner's
decision, never a side effect of work.

**Folded away** under the cleanup policy ([INDEX.md](INDEX.md)): every entry this file held since
1.5.4 shipped — in **1.6.0** (One front end, `./binary` and `./encoder` removed, the IR record
changes, the post-M8 and Q1–Q8 fixes, S7), **1.6.1** (the CLI from JSR), **1.7.0** (`./interop`
removed, wasmtk's items 1–5 with custom descriptors, `--converge`, the minify passes, Flatten
complete), **1.7.1** (u64 limits and the 1-byte-page cap), **1.7.2** (`wasm2wat` text as upstream /
wasm-tools: N10, W18, M2a; `array.new_default` defaultability) or **1.8.0** (diagnostics DG1–DG6,
the `wat2wasm` CLI validating by default, the reader stopping at its first error, Q10–Q13,
`LowerCustomPageSizes` with its `#pagesize=` exports, `wasm-opt` validating its input) or **1.8.1**
(wasmtk's § 20: L3 trap kind, L4 placeholder, C7 `getFunctionInfo` shape). The public
summary of each is `CHANGELOG.md` § that version; the full notes as gathered, BREAKING items field
by field: `git show 769b4d3c0:cmem/unreleased.md` (to 1.7.0), this file at `7aa54e95c` (1.7.1 →
1.7.2), at `fb5068e47` (1.8.0), and at `99f2a5b16` (1.8.1).

## How to use this file

Add an entry when a change on `main` is one a release note must carry — say which kind:

- ⚠️ **BREAKING** — a removed or renamed export, a changed IR field, a changed default. Makes the
  release a MINOR, typed by hand ([publishing.md](publishing.md) § "`bump` has no minor mode").
- **Behaviour** — output bytes move, or an input is accepted / refused that was not.
- **Silent fix** — was wrong without saying so; say what a user may have shipped.
- **NEW** — an export, a pass, a CLI flag.

⚠️ **wasmtk pins binaryang EXACTLY** and wants each release to say which of their reported items it
contains ([handoffs.md](handoffs.md)).

## Since 1.8.1

- **Silent fix — the tree walkers visit a branch's values before its condition** (open-work 1):
  `mapExpression`, `walkExpression`, `visitChildren`, `mapChildrenShallow` and `mapWithSequences`
  took a `br_if` / `br_table`'s condition first, the reverse of wasm. For a tree built by the
  builder API or a pass with a payload-carrying `throw` among a branch's values, StripEH ran the
  condition before the trap. A module read from text or binary never has that shape; no optimizer
  output moves (0 of 13,285 measured).
- **Behaviour — `CoalesceLocals` coalesces copies** (open-work 2, step 1), as upstream's: a copy
  (`local.set x (local.get y)`) no longer makes x and y interfere, a variable may share a
  parameter's slot, and a copy onto itself is removed. Optimized output moves at `-O2` and above:
  the corpus is −4,675 bytes at -O2, −22,699 at -O3, −6,171 at -Os / -Oz; behaviour unchanged
  (the spec and corpus behaviour gates).
