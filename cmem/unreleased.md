# Unreleased on `main` — what the next release note must say

**Nothing, as of 2026-09-29.** `main` = `v1.7.0` plus cmem-only commits (check it rather than trust
this line: `git log --oneline v1.7.0..main -- src/ main.ts deno.json`). `deno.json` reads 1.7.0; the
version line arms a release ([publishing.md](publishing.md)), so the next bump is the owner's
decision, never a side effect of work.

**Folded away 2026-09-29** under the cleanup policy ([INDEX.md](INDEX.md)): every entry this file
held since 1.5.4 shipped — in **1.6.0** (One front end, `./binary` and `./encoder` removed, the IR
record changes, the post-M8 and Q1–Q8 fixes, S7), **1.6.1** (the CLI from JSR) or **1.7.0**
(`./interop` removed, wasmtk's items 1–5 with custom descriptors, `--converge`, the minify passes,
Flatten complete). The public summary of each is `CHANGELOG.md` § that version; the full notes as
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

## Since 1.7.0

(none)
