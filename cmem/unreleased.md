# Unreleased on `main` — what the next release note must say

**As of 2026-10-14 (UTC): `main` = `v1.11.0`, PUBLISHED (the owner's "ship 1.11.0"; `bun run
release` pushed the bump and the tag together) — see § "Since 1.11.0"** (check it rather than trust
this line: `git log --oneline v1.11.0..main -- src/ main.ts jsr.json`). `jsr.json` reads 1.11.0;
the version line arms a release, so the next bump is the owner's decision, never a side effect of
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
`(@reloc data)`, the `.wit` beside the bundle) or **1.11.0** (`./ir`, browser-loadable exports,
the enums as const objects, `Opcode` as the 582 instructions, the reserved-SIMD reader fix, the
Asyncify fix for TinyGo 0.43, the Bun toolchain). The public summary of
each is `CHANGELOG.md` § that version; the full notes as gathered, BREAKING items field by field:
`git show 769b4d3c0:cmem/unreleased.md` (to 1.7.0), this file at `7aa54e95c` (1.7.1 → 1.7.2), at
`fb5068e47` (1.8.0), at `99f2a5b16` (1.8.1), at `82113369e` (1.9.0), at `23b9f36fb` (1.10.0), and at `fc021fe08` (1.11.0).

## How to use this file

Add an entry when a change on `main` is one a release note must carry — say which kind:

- ⚠️ **BREAKING** — a removed or renamed export, a changed IR field, a changed default. Makes the
  release a MINOR, typed by hand ([publishing.md](publishing.md) § "`bump` has no minor mode").
- **Behaviour** — output bytes move, or an input is accepted / refused that was not.
- **Silent fix** — was wrong without saying so; say what a user may have shipped.
- **NEW** — an export, a pass, a CLI flag.

⚠️ **wasmtk pins binaryang EXACTLY** and wants each release to say which of their reported items it
contains ([handoffs.md](handoffs.md)).

## Since 1.11.0

- ⚠️ **BREAKING — the three deprecated subpaths and the deprecated type names are REMOVED**
  (2026-10-14, open-work 25, owner: "proceed with item 25"). Gone from `jsr.json`: `./ir/binaryen-ts`,
  `./ir/wabt-ts`, `./core/wabt-ts` (deprecated in 1.11.0; their files stay as `./ir`'s internal
  barrels). Gone as names: `Type` as the node-type union in `./api` (and in the old binaryen-ts
  view), which is `ExprType`; `./compat/wabt`'s `Features` / `WasmModule`, which are `WabtFeatures`
  / `WabtWasmModule`. **The release is a MINOR, 1.12.0.** Who it reaches: anyone importing the three
  subpaths or those names; `./ir` has had everything since 1.11.0. wasmtk checked: its code imports
  none of the three subpaths (only its vendored copy of our old source names them, in doc comments)
  and takes `compat/wabt`'s default export only, never `Features` / `WasmModule`
  ([handoffs.md](handoffs.md) § 32). Held by `ir_subpath.test.ts` (the three are not in `jsr.json`;
  `./ir` exports every name of the three barrels from the same declaration, now with no exception)
  and `compat_type_names.test.ts` (importing the old names must fail `bun run check`, shown by
  bringing one back).

The 1.11.0 notes as gathered, entry by entry, are `git show fc021fe08:cmem/unreleased.md`;
the public summary is `CHANGELOG.md` § 1.11.0.
