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
- **NEW / Behaviour — `RemoveUnusedTypes`** (open-work 6; 2, step 2), last at every `-O` level:
  types nothing refers to are removed and every reference renumbered, as upstream's writer leaves
  them out. The corpus is −10.3 KB at -O1 / -O2 / -Os / -Oz, −12.5 KB at -O3. A plain read and write
  keeps the type section as it was.
- **Silent fix — `OptimizeInstructions` folded `i64.extend8_s` / `i64.extend16_s` of a constant
  wrong above 2^53** (open-work 2, step 3a): the fold went through a JS number, which rounds away
  the low bits it extends. Valid output, wrong value; only a module holding such a constant
  operand, at `-O2` and above.
- **Behaviour — `OptimizeInstructions` covers more** (open-work 2, step 3a): a store's conversion
  or mask folded into the store, an extend of a load into the extending load, `if (eqz c)` arms
  swapped, `eqz(eqz x)` in a condition, the constants of an add / sub tree gathered into one.
  Corpus −9.8 KB at -O2 / -Os / -Oz, −26.5 KB at -O3; behaviour unchanged (the spec and corpus
  behaviour gates).
- **Behaviour — `SimplifyLocals` sinks a set into the get that reads it** (open-work 2, step 3b),
  along straight-line code, past whatever its effects may pass; the only read becomes the value
  itself, otherwise a `local.tee`. It merged only an adjacent set and get before. Corpus −14.2 KB
  at -O2 / -Os / -Oz, −20.7 KB at -O3; behaviour unchanged (the spec and corpus behaviour gates,
  the optimizer fuzzer). Internal: a shared effect analysis, `ir/effects.ts` (not a subpath).
- **Behaviour — `RemoveUnusedBrs` covers more** (open-work 2, step 3c): a `return` ending a function
  body becomes its value, a cheap `if` with a numeric result becomes a `select`, `if (c) br` becomes
  `br_if`. Corpus −2.1 KB at -O2 / -Os / -Oz, −3.0 KB at -O3; behaviour unchanged.
- **Behaviour — the default `-O` schedule re-runs passes** (open-work 2, step 4a): CoalesceLocals
  again after SimplifyLocals / LocalCSE at -O2 and above, and SimplifyLocals after Inlining at -O3.
  Corpus −2.9 KB at -O2 / -Os / -Oz, −8.3 KB at -O3.
