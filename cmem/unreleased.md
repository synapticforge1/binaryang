# Unreleased on `main` — what the next release note must say

**As of 2026-10-09: `main` = `v1.10.0`, PUBLISHED 2026-10-09 (the owner's go: "lets do the
1.10.0 release"; the hand-pushed tag) — nothing unreleased** (check it rather than trust this
line: `git log --oneline v1.10.0..main -- src/ main.ts deno.json`). `deno.json` reads 1.10.0; the
version line arms a release, so the next bump is the owner's decision, never a side effect of
work.

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
`(@reloc data)`, the `.wit` beside the bundle). The public summary of
each is `CHANGELOG.md` § that version; the full notes as gathered, BREAKING items field by field:
`git show 769b4d3c0:cmem/unreleased.md` (to 1.7.0), this file at `7aa54e95c` (1.7.1 → 1.7.2), at
`fb5068e47` (1.8.0), at `99f2a5b16` (1.8.1), at `82113369e` (1.9.0), and at `23b9f36fb` (1.10.0).

## How to use this file

Add an entry when a change on `main` is one a release note must carry — say which kind:

- ⚠️ **BREAKING** — a removed or renamed export, a changed IR field, a changed default. Makes the
  release a MINOR, typed by hand ([publishing.md](publishing.md) § "`bump` has no minor mode").
- **Behaviour** — output bytes move, or an input is accepted / refused that was not.
- **Silent fix** — was wrong without saying so; say what a user may have shipped.
- **NEW** — an export, a pass, a CLI flag.

⚠️ **wasmtk pins binaryang EXACTLY** and wants each release to say which of their reported items it
contains ([handoffs.md](handoffs.md)).

## Since 1.10.0

The 1.10.0 notes as gathered, entry by entry, are `git show 23b9f36fb:cmem/unreleased.md`; the
public summary is `CHANGELOG.md` § 1.10.0.

- **Internal — one source tree** (2026-10-09, open-work 21 phase 1, [project.md](project.md)
  § "Layout"): `src/binaryen-ts/` and `src/wabt-ts/` merged into `src/` by concept. Every public
  subpath keeps its name and module; no emitted byte moved (`baseline` 421 / 421). Say so in the
  note only for someone who imported FILES by path rather than subpaths (JSR does not allow it).
- ⚠️ **BREAKING (type level only) — `./ir/binaryen-ts`'s reference record is read-only**
  (2026-10-09, open-work 21 phase 2): `RefType` is now the IR's `RefValueType` (its `heapType` and
  `nullable` were writable in binaryen-ts's own copy), and `BlockParams` has read-only fields, as
  the IR's. Code that ASSIGNS to those fields stops compiling; nothing that reads or builds them
  changes, and no value at run time changes. Nothing in this repository assigned them. With it, 84
  names `./ir/binaryen-ts` declared a second time (`ArrayCopyExpr` … `TableCatch`, `ValueType`,
  `StorageType`, `FuncSignature`, `Catch`, `DataSegment`, `Local`) are re-exports of the one
  declaration in `./ir/wabt-ts` — the same types, proven name by name.
- **NEW — `funcAt(module, var)` and `funcSignature(module, func)`** in `./ir/wabt-ts`
  (2026-10-09, open-work 21 phase 3): the function a reference names (imports first) and its
  declared signature; three tools had a private copy each.
- **NEW — `./ir`** (2026-10-09, open-work 21 phase 4, [one-tree.md](one-tree.md)): one subpath
  exporting everything `./ir/wabt-ts`, `./ir/binaryen-ts` and `./core/wabt-ts` export, proven by
  `ir_subpath.test.ts`. **A new export: the release is a MINOR, 1.11.0.** `Type` there is core's
  enum; binaryen-ts's union is `ExprType` (the same type).
- **DEPRECATED — `./ir/binaryen-ts`, `./ir/wabt-ts`, `./core/wabt-ts`**, and `Type` as the union's
  name in `./ir/binaryen-ts` and `./api` (now an alias of `ExprType`): they stay this release and go
  in a later minor (open-work item 25). Say "import from `./ir`" in the note, with the `Type` →
  `ExprType` line for `./ir/binaryen-ts` users.
- **DEPRECATED — `./compat/wabt`'s `Features` and `WasmModule` type names** (2026-10-09, owner:
  "renaming the compat pair seems the correct path"): renamed `WabtFeatures` / `WabtWasmModule`, the
  old names re-exported as deprecated aliases (`compat_type_names.test.ts` pins them). Type names
  only — nothing at run time. wasmtk declares its own local types for these
  (`WabtWasmModule`, `WasmFeatures`), so its build does not depend on them; say so in the letter.
  `deno task collisions` = **0**.
- **Behaviour (hardening, open-work 13 pass 1, [hardening.md](hardening.md)) — malformed input now
  gets a TYPED answer everywhere.** Say in the note:
  - `readForPasses` / `compat/binaryen` `readBinary`: an invalid module the reader can decode (an
    out-of-range index, an unbalanced stack) threw a plain `Error` in an internal stage's words; it
    is now a `WasmBinaryError` carrying the VALIDATOR's diagnostic at an offset in the file. A
    caller that matched on the old message text sees different text (13% of a mutation fuzz).
  - A module nested too deeply for a recursive walker: every tool and library entry answers with
    its own typed error saying so (`NESTING_TOO_DEEP`), where a bare `RangeError` escaped. The
    LIMITS themselves are unchanged in this pass (writers ~400 blocks, most stages ~2,000).
  - The interpreter: a deeply nested valid function is `Stop(unsupported)`, no longer
    `trap: call stack exhausted` (a claim about the program); invalid-module checks are
    `Stop(invalid)`, a new `StopReason`.
  - `wasm-interp` and `wasm-ctor-eval` validate their input file and refuse an invalid one (they ran
    it). `wasm-bundle`: a malformed `linking` / `reloc.*` section is a `BundleError` naming the input.
- **Behaviour — deeper nesting through the text route and the writers** (2026-10-09, open-work 13
  pass 2): name resolution's recursion was its lowest ceiling (~384 nested blocks); split into a
  dispatcher it follows ~700 cold / ~1,500 warm, so `wat2wasm`, `writeWasm`, `writeWat` and
  `wasm-opt`'s output accept modules nested about twice as deep. No output byte changes.
- **NEW — the hang check** (2026-10-09, owner: "the cheap sound version ... after say 20s minimum
  intervals", [hardening.md](hardening.md)): the interpreter stops a loop that PROVABLY never exits
  — back at its top with the same locals and stack, nothing else changed in between — with a `Stop`
  of the new reason `hang`. `InterpreterOptions.hangCheck` (ms, default 20,000; `null` off),
  `wasm-interp --hang-check=SECONDS` / `--no-hang-check`; `wasm-ctor-eval` gets the default (a
  stopped constructor is kept, as with fuel). Fuel is unchanged.
- **NEW** — `readValidForPasses` (from `ir/prepare.ts`), `readValidWat` (`tools/read-wat.ts`), and
  `isStackExhausted` / `NESTING_TOO_DEEP` / `nestingTooDeep` (`core/error.ts`, public through
  `./ir` and `./core/wabt-ts`); `deno task hostile` (repo only).
