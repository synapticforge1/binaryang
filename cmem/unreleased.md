# Unreleased on `main` — what the next release note must say

**As of 2026-10-20: the last release is `v1.13.0`; nothing user-visible is unreleased on `main`**
(check it rather than trust this line: `git log --oneline v1.13.0..main -- src/ main.ts jsr.json`).
`jsr.json` reads 1.13.0; the version line arms a release, so the next bump is the owner's
decision, never a side effect of work.

**Folded away** under the cleanup policy ([INDEX.md](INDEX.md)): every entry this file held since
1.5.4 shipped — in **1.6.0** (One front end, `./binary` and `./encoder` removed, the IR record
changes, the post-M8 and Q1–Q8 fixes, S7), **1.6.1** (the CLI from JSR), **1.7.0** (`./interop`
removed, wasmtk's items 1–5 with custom descriptors, `--converge`, the minify passes, Flatten
complete), **1.7.1** (u64 limits and the 1-byte-page cap), **1.7.2** (`wasm2wat` text as upstream /
wasm-tools: N10, W18, M2a; `array.new_default` defaultability) or **1.8.0** (diagnostics DG1–DG6,
the `wat2wasm` CLI validating by default, the reader stopping at its first error, Q10–Q13,
`LowerCustomPageSizes` with its `#pagesize=` exports, `wasm-opt` validating its input) or **1.8.1**
(wasmtk's § 20: L3 trap kind, L4 placeholder, C7 `getFunctionInfo` shape) or **1.9.0** (the
interpreter and its tools, `./definitions`, the optimizer within 2%) or **1.10.0** (`wasm-bundle`,
`(@reloc data)`, the `.wit` beside the bundle) or **1.11.0** (`./ir`, browser-loadable exports,
the enums as const objects, `Opcode` as the 582 instructions, the reserved-SIMD reader fix, the
Asyncify fix for TinyGo 0.43, the Bun toolchain) or **1.12.0** (the deprecated subpaths and type
names removed) or **1.12.1** (Asyncify restores a paused call's operands) or **1.13.0** (the code
lens C1–C17 — `wasmValidate`'s `result`, the reader's malformed heap types and runaway counts,
five more refusals, two where upstream wabt accepts; open-work 30 and 31 steps 1–15, the
optimizer within 0.7% of upstream -Oz on real compiler output and below it at -O2; the passes
`MergeLocals`, `PrecomputePropagate`, `MergeSimilarFunctions`; `Module.optimizeStack`; the
CodeFolding crash shipped 1.11.0 – 1.12.1; the browser recipe). The public summary of each is
`CHANGELOG.md` § that version; the full notes as gathered, BREAKING items field by field:
`git show 769b4d3c0:cmem/unreleased.md` (to 1.7.0), this file at `7aa54e95c` (1.7.1 → 1.7.2), at
`fb5068e47` (1.8.0), at `99f2a5b16` (1.8.1), at `82113369e` (1.9.0), at `23b9f36fb` (1.10.0), at
`fc021fe08` (1.11.0), at `604b33cf8` (1.12.0), at `e03d38f33` (1.12.1), and at `2b74934bf`
(1.13.0).

## How to use this file

Add an entry when a change on `main` is one a release note must carry — say which kind:

- ⚠️ **BREAKING** — a removed or renamed export, a changed IR field, a changed default. Makes the
  release a MINOR, typed by hand ([publishing.md](publishing.md) § "`bump` has no minor mode").
- **Behaviour** — output bytes move, or an input is accepted / refused that was not.
- **Silent fix** — was wrong without saying so; say what a user may have shipped.
- **NEW** — an export, a pass, a CLI flag.

⚠️ **wasmtk pins binaryang EXACTLY** and wants each release to say which of their reported items it
contains ([handoffs.md](handoffs.md)).

## Since 1.13.0

Nothing yet.
