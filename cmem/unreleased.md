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
- **BREAKING (type level) — the 19 exported `enum`s are const objects now** (2026-10-12,
  open-work 28 part 4, owner: option "1"). `BinarySection`, `NameSectionSubsection`,
  `ExternalKind`, `Opcode`, `MiscOpcode`, `GcOpcode`, `Result`, `Type`, `ErrorLevel`,
  `ErrorFormat`, `LinkingSubsection`, `SymbolKind`, `RelocType`, `NameOpts`, `LabelType`,
  `TokenType`, `LiteralType`, `State`, `DataOffset`. Each is `const X = {…} as const` + `type X` + a
  type-only `namespace X`. Every member keeps its VALUE (572 checked against the old enums), and
  `X.Member` still works as a value and as a type. Say in the note what changes:
  - reverse lookup is gone: `Opcode[0x6a]` no longer gives `"I32Add"`, and `0 in ExternalKind`
    is false (use `Object.values(X).includes(v)`);
  - a plain number no longer passes where `X` is expected (except `Opcode`, below);
    `let r = Result.Ok; r = Result.Error` needs `let r: Result`;
  - the `Opcode` TYPE is `number`, deliberately: the IR stores combined `(prefix << 16) | sub`
    values under it, which are not members, as it always did.
  Why: Node's type stripping (the only mode in Node 26, LTS from 2026-10-28) refuses `enum`s.
  binaryang's source now runs on Node 22–26 with NO flag (`--experimental-transform-types`, which
  Node 26 removed, is not needed anywhere). `erasableSyntaxOnly` keeps it so. Constructor parameter
  properties became fields, which changes nothing outside the class.
- **Behaviour — every export now loads in a browser** (2026-10-12, open-work 28 parts 1–2). 15
  of 22 exports, `./wat2wasm` / `./wasm2wat` / `./wasm-validate` / `./api` / `./passes` /
  `./compat/binaryen` / the `./tools/*` among them, could not even be bundled for a browser: each tool
  imported `node:process` (some also `node:fs`, `node:path`) at the top for its CLI `main()`,
  and library modules reached the tools. Now no shipped file has a top-level runtime `node:`
  import. The CLI reaches `process` through `globalThis` when it runs, and loads `node:fs/promises`
  on demand. `moduleNameOf` / `witNameOf` use a pure `baseName` instead of `node:path`. The CLI is
  unchanged: the same `wat2wasm` hash on Deno, Node 22, Node 24 and Bun. The README's
  "modern browsers" claim is now checked in CI: `bun run browser` bundles every export, and
  `bun run portability` refuses any top-level `node:` import. Say in the note: a page can import
  `./wat2wasm`, `./passes` etc. directly; calling a tool's `main()` in a browser throws a clear
  error naming the library function to call instead.
- **NEW — `wasmOpt` accepts the module's BYTES** (2026-10-12, open-work 28 part 5):
  `wasmOpt(input: string | Uint8Array, options)`. A `Uint8Array` is optimized as given (binary when
  it starts with `\0asm`, WAT text otherwise), with no file system: what a browser page needs. A
  path works as before. Additive, so no caller changes.
- **Silent fix — the interpreter and a constant expression that leaves no value** (2026-10-12,
  open-work 27, found by `hostile` during Bun migration B4). On a module read WITHOUT validation, an
  element or data offset such as `(offset nop)` escaped as a bare `TypeError` ("Cannot read
  properties of undefined (reading 'type')"). An empty global initializer was stored as `undefined`
  and failed later, wherever the global was read. Both are now `Stop(invalid)` at instantiation:
  "a constant expression left 0 values, 1 expected". Who could have hit it: an `Interpreter` /
  `interpModule` caller passing an unvalidated `readForPasses` module. The `wasm-interp` CLI
  validates its input and was never exposed. `hostile` over the core corpus: interp UNTYPED 3 → 0, and 3 modules that silently instantiated with a missing value now stop as invalid.
- **Behaviour — deeper nesting through the text route and the writers** (2026-10-09, open-work 13
  pass 2): name resolution's recursion was its lowest ceiling (~384 nested blocks); split into a
  dispatcher it follows ~700 cold / ~1,500 warm, so `wat2wasm`, `writeWasm`, `writeWat` and
  `wasm-opt`'s output accept modules nested about twice as deep. No output byte changes.
- **NEW — the hang check** (2026-10-09, owner: "the cheap sound version ... after say 20s minimum
  intervals", then 2 s from the measured run times, [hardening.md](hardening.md)): the interpreter stops a loop that PROVABLY never exits
  — back at its top with the same locals and stack, nothing else changed in between — with a `Stop`
  of the new reason `hang`. `InterpreterOptions.hangCheck` (ms, default 2,000 — set from a measurement; `null` off),
  `wasm-interp --hang-check=SECONDS` / `--no-hang-check`; `wasm-ctor-eval` gets the default (a
  stopped constructor is kept, as with fuel). Fuel is unchanged.
- **NEW** — `readValidForPasses` (from `ir/prepare.ts`), `readValidWat` (`tools/read-wat.ts`), and
  `isStackExhausted` / `NESTING_TOO_DEEP` / `nestingTooDeep` (`core/error.ts`, public through
  `./ir` and `./core/wabt-ts`); `deno task hostile` (repo only).
- **Behaviour — the binary reader refuses a SIMD sub-opcode that is no instruction** (2026-10-13,
  open-work 28, found by typing the opcodes). A reserved `0xfd 0x9a` (20 such values inside the
  SIMD range, and any beyond `0x113`) decoded as a binary operator: `wasm-validate` passed the
  module, `wasm2wat` printed `<opcode:0xfd009a>`, and V8 refused it. Now an error, "unknown SIMD
  opcode: 0xfd 0x9a", like the misc / atomic / GC decoders, which already refused theirs (held by
  `reserved_subopcodes.test.ts`). Who could have hit it: anyone reading a malformed binary with a
  reserved SIMD sub-opcode; no valid module changes.
- ⚠️ **BREAKING (type level only) — `Opcode` is the union of the 582 real instructions** (2026-10-13,
  open-work 28, owner: "One generated instruction union"). It was `number`. `Opcode` and every
  operator type (`UnaryOp`, `BinaryOp`, the SIMD ones, `QuaternaryOp`, `BrOnOp`) now accept
  exactly the instructions in `src/definitions/opcodes.json`, in the IR's encoding (the byte, or
  `(prefix << 16) | sub`), generated into `src/definitions/instr-code.ts` (`InstrCode`,
  `INSTR_CODES`, `isInstrCode`). Code that passes a computed `number` where an `Opcode` is expected
  stops compiling: check it with `isInstrCode` first. No value at run time changes; the prefixed
  operator-table members are now hex literals (`0xfd007a`), the same numbers.
- **Silent fix — `Asyncify` on a module that drives its own unwinding (TinyGo 0.43)** (2026-10-13,
  wasmtk's report, [handoffs.md](handoffs.md) §§ 28-29). In import mode (`asyncify.*` imported),
  a function calling `asyncify.stop_unwind` / `start_rewind` (the bottom-most runtime) that ALSO
  reached a suspend was instrumented, where upstream's propagation stops at it; flattening it then
  threw `Flatten: unresolved call target "$asyncify_stop_unwind"`. TinyGo 0.43's goroutine builds
  have such a function (`…asyncifysuspendcatch.0.paniccatch`), so `Asyncify` failed on every one.
  Now the analysis follows upstream (the bottom-most runtime is a propagation barrier; control
  calls judged by name), and Flatten knows the control functions' types. wasmtk's reproducer runs
  correctly after the pass (wasmtime and wasmer: `wg-counter: 45`). Who could have hit it: any
  `Asyncify` / `wasm-opt --asyncify` user on such a module; it failed loudly, it never produced a
  wrong module. Held by `asyncify.test.ts` (two tests, each shown to fail without its fix).
