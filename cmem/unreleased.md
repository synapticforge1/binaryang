# Unreleased on `main` — what the next release note must say

**The diagnostic fixes of 2026-09-29, below** (§ "Since 1.7.2"). Check it rather than trust this
line: `git log --oneline v1.7.2..main -- src/ main.ts deno.json`. `deno.json` reads 1.7.2; the
version line arms a release ([publishing.md](publishing.md)), so the next bump is the owner's
decision, never a side effect of work.

**Folded away 2026-09-29** under the cleanup policy ([INDEX.md](INDEX.md)): every entry this file
held since 1.5.4 shipped — in **1.6.0** (One front end, `./binary` and `./encoder` removed, the IR
record changes, the post-M8 and Q1–Q8 fixes, S7), **1.6.1** (the CLI from JSR), **1.7.0**
(`./interop` removed, wasmtk's items 1–5 with custom descriptors, `--converge`, the minify passes,
Flatten complete), **1.7.1** (u64 limits and the 1-byte-page cap — wasmtk's letter of 2026-09-29) or
**1.7.2** (`wasm2wat` text as upstream / wasm-tools: references by name N10, folded layout and label
comments W18, one-line declaration constants, empty offset / item M2a; `array.new_default`
defaultability). The public summary of each is `CHANGELOG.md` § that version; the full notes as
gathered, BREAKING items field by field: `git show 769b4d3c0:cmem/unreleased.md` (to 1.7.0), and
this file at `7aa54e95c` (1.7.1 → 1.7.2).

## How to use this file

Add an entry when a change on `main` is one a release note must carry — say which kind:

- ⚠️ **BREAKING** — a removed or renamed export, a changed IR field, a changed default. Makes the
  release a MINOR, typed by hand ([publishing.md](publishing.md) § "`bump` has no minor mode").
- **Behaviour** — output bytes move, or an input is accepted / refused that was not.
- **Silent fix** — was wrong without saying so; say what a user may have shipped.
- **NEW** — an export, a pass, a CLI flag.

⚠️ **wasmtk pins binaryang EXACTLY** and wants each release to say which of their reported items it
contains ([handoffs.md](handoffs.md)).

## Since 1.7.2

Diagnostic usefulness (open-work 16, 2026-09-29; [testing.md](testing.md) § "Diagnostic usefulness",
DG1–DG4 in [divergences.md](divergences.md)). No byte of any output moves (baseline IDENTICAL).

- **Silent fix — binary diagnostics show their offset.** Every binary tool's diagnostic printed
  `file:0:0`; it now prints upstream's `file:0000025`. `formatError(s)` chooses text coordinates
  only when the location has a line (new export `formatLocation`); a location with neither prints the
  filename alone, where it printed `<binary>:0x00000000` / `file:0:0`. A consumer parsing our
  diagnostic text sees the new form.
- **Silent fix — a type mismatch names its instruction**: `type mismatch in i32.add`, where it said
  `in opcode` (also `in ternary`, `in load_splat`, `in load_zero`).
- **Behaviour — the binary reader stops at its first error** (`ReadBinaryOptions.stopOnFirstError`
  now defaults to `true`, as upstream; `false` collects the rest), and **`wasmValidate` does not
  validate a module that failed to decode.** A malformed binary reports one error — the real one —
  where it reported up to 9. `errors[0]` and every `result` are unchanged.
- **Behaviour — `wasm-opt` validates its input** (`validate`, default true; `--no-validate` skips
  both checks, as upstream `--no-validation`): an invalid module is refused as `input module is not
  valid:` with located diagnostics, where it was optimized and then blamed on the optimizer. A
  binary that does not decode still throws `WasmBinaryError`. A WAT input's parse errors carry its
  filename, where they said `<input>`.
- **NEW — `formatErrors(list, ErrorFormat.Long, source)`** prints each text error's source line and
  a caret under its column; the `wat2wasm` and `wasm-opt` CLIs do, as upstream's tools.
- **Silent fix — optimization no longer emits INVALID modules around `br_on_*`** (Q10–Q12 in
  [divergences.md](divergences.md)): a value on the stack under a `br_on_cast` (any `br_on_*`)
  that a later instruction consumes was spilled at every -O level, and at -O3 `Inlining` moved a
  `br_on` operand, or a multi-result operand, into its wrapper block. Anything optimized with such
  code failed to validate — loud, not wrong. Found by the proposals gate.
- **Silent fix — allocations are exact in a module that speaks exact types** (Q13, open-work 9):
  `--flatten` wrote invalid modules around `struct.new_desc`. A module without custom descriptors
  or exact types is unchanged.
- **NEW — `LowerCustomPageSizes`** (`wasm-opt --lower-custom-page-sizes`): memories with a custom
  page size become 64 KiB-page memories with a `<memory>#pages` global and explicit bounds checks,
  so V8 — which has no custom-page-sizes support — runs them with the proposal's behaviour. ⚠️ **A
  lowered memory is exported and imported as `<name>#pagesize=<ps>`** (e.g. `mem#pagesize=1`), with
  its size beside it as `<name>#pages`: a host reads `exports['mem#pagesize=1']`, not
  `exports.mem`, and a native 64 KiB-page importer does not link to it, as the proposal requires
  (P1). Shared custom-page memories are refused. `memory.grow` zero-fills the rounding slack it
  exposes (L2), so bytes a host wrote past the logical size never come back as fresh memory.
- **Silent fix — `wasm-opt -o -`** (stdout) was refused as "a missing output path"; and a bad
  argument now prints one line instead of a stack trace.
- Repo only: `deno task proposals` (the testsuite's `proposals/` in the gate, V8 experimental
  flags); an original the engine will not compile now FAILS `spec-behaviour` instead of agreeing;
  `deno task diagnostics`; the CI scripts are TypeScript (`deno task naming` /
  `portability`, `scripts/cli-smoke.ts`), and the naming check now exits 1 on a violation.
