# Unreleased on `main` — what the next release note must say

**Four changes, as of 2026-09-29** — § "Since 1.7.1" (check it rather than trust this line:
`git log --oneline v1.7.1..main -- src/ main.ts deno.json`). `deno.json` reads 1.7.1; the
version line arms a release ([publishing.md](publishing.md)), so the next bump is the owner's
decision, never a side effect of work.

**Folded away 2026-09-29** under the cleanup policy ([INDEX.md](INDEX.md)): every entry this file
held since 1.5.4 shipped — in **1.6.0** (One front end, `./binary` and `./encoder` removed, the IR
record changes, the post-M8 and Q1–Q8 fixes, S7), **1.6.1** (the CLI from JSR), **1.7.0**
(`./interop` removed, wasmtk's items 1–5 with custom descriptors, `--converge`, the minify passes,
Flatten complete) or **1.7.1** (u64 limits and the 1-byte-page cap — wasmtk's letter of
2026-09-29). The public summary of each is `CHANGELOG.md` § that version; the full notes as
gathered, BREAKING items field by field: `git show 769b4d3c0:cmem/unreleased.md`.

## How to use this file

Add an entry when a change on `main` is one a release note must carry — say which kind:

- ⚠️ **BREAKING** — a removed or renamed export, a changed IR field, a changed default. Makes the
  release a MINOR, typed by hand ([publishing.md](publishing.md) § "`bump` has no minor mode").
- **Behaviour** — output bytes move, or an input is accepted / refused that was not.
- **Silent fix** — was wrong without saying so; say what a user may have shipped.
- **NEW** — an export, a pass, a CLI flag.

⚠️ **wasmtk pins binaryang EXACTLY** and wants each release to say which of their reported items it
contains ([handoffs.md](handoffs.md)).

## Since 1.7.1

- **Behaviour — `array.new_default` refuses an element type with no default** (`d6b487c2d`).
  `array.new_default` of a `(ref $t)` array validated; `wasm-validate` now rejects it
  ("array.new_default: field 0 of type N is not defaultable"), as wasm-tools and V8 do. A module
  that relied on it was already refused by every engine. No bytes move.
- **Behaviour — `wasm2wat` prints an empty offset or element item as `(offset)` / `(item)`**
  (`79e4c10d1`). It printed nothing, so `wasm2wat` → `wat2wasm` turned an active segment with an
  empty offset PASSIVE and dropped an empty element item. Text of such (invalid) modules changes;
  no corpus module has one.
- **Behaviour — `wasm2wat` prints a reference by its target's name** (`4d6dec1d3`; N10):
  `call $f`, `global.get $g`, `(type $sig)`, `(ref null $pair)`, `struct.get $pair $left`, … where
  it printed indices — as upstream `wasm2wat` and `wasm-tools print` do. The TEXT of every module
  with names changes (420 of 421 corpus files); no bytes. Only `wasm2wat`: the compat `toText()` of
  parsed text keeps the author's indices. New option `WriteWatOptions.namedReferences` (`./wat`
  writer API).
- **Behaviour — folded `wasm2wat` puts each sibling and operand on its own line** (`bee199092`,
  W18), and `(then` / `(else` / `(do` / `(catch` are followed by one — as upstream and wasm-tools
  print folded text. A declaration's constant expression is one line in both modes, as wasm-tools
  (`60fefd723`). An unnamed block / loop / `if` / `try_table` carries `;; label = @N` folded, as
  linear always did (`35b4e5cc7`). The folded TEXT of every module changes; no bytes; linear text
  unchanged.
