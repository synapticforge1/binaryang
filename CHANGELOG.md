# Changelog

## 1.9.0

A minor release: **an interpreter and the tools on it, `./definitions` for other projects to
generate from, and an optimizer within 2% of upstream `wasm-opt -Oz` on the corpus** (825,077
bytes to upstream's 809,986 over 421 modules; it was 13% above at 1.8.1). No valid module's bytes
change through `wat2wasm`, `wasm2wat` or a plain read and write; the optimizer's output moves at
every level, and the behaviour gates hold on every one of them.

### New

- **`wasm-ctor-eval`** (a CLI command and `@jrmarcum/binaryang/tools/wasm-ctor-eval`): runs the
  start function and the exported constructors `--ctors=a,b` names at build time and writes what
  they computed into the module — memory as data segments, globals as their initialisers. A
  constructor that reaches a host call (or a trap, or a value the tool cannot write back) keeps
  the code from there on; a complete one's export goes unless `--kept-exports` names it.
  `--ignore-external-input` assumes empty arguments and environment. Opt-in, never part of `-O`;
  run `-Oz` after it. On the corpus: 7% off a fully optimised module.
- **`wasm-interp`** (a CLI command and `…/tools/wasm-interp`): runs exported functions on the
  interpreter and prints each result; a trap by its message, an import the tool was not given as
  a stop — `--run-all-exports`, `--run-export=NAME` with `--argument=V`, `--dummy-import-func`.
- **`@jrmarcum/binaryang/definitions`**: the shared definitions another project generates its
  copies from — D1 the instruction table (582 entries: encoding, immediates, alignment, stack
  signature, gating feature, class), D2 the feature / proposal list, D3 the spec testsuite's trap
  vocabulary with its prefix rule — each with a `dataVersion` and a content `sha256`;
  `opcodeDefinition()`, `verdictClass()`, `featuresForSuite()`. The JSON sources ship in the
  package.
- New passes: `Precompute` (an expression whose value is known becomes it; a constant condition
  picks its arm), `ConstantPropagation`, `CodeFolding`, `MemoryPacking`. `makeConst(literal)` in
  `./ir/binaryen-ts`.

### Changed — the optimizer

- `OptimizeInstructions` folds every scalar and SIMD operator of constants through one numeric
  core, checked against V8 on every instruction the spec lists; never a trap, never a NaN from an
  operator the spec leaves to the engine, never a relaxed-SIMD operator.
- `LocalCSE` reuses any repeated read-only or trapping expression along straight-line code;
  `SimplifyLocals` sinks a set into its only read; `CoalesceLocals` coalesces copies;
  `RemoveUnusedBrs` turns a tail `return` into its value, a cheap `if` into a `select`, `if (c)
  br` into `br_if`, and a block whose only branch is a leading `br_if` to itself into an `if`;
  `Vacuum` splices unnamed blocks; `DeadArgumentElimination` and `Inlining` (upstream's rules
  and schedule, with the function passes again after it) are new in the `-O2` pipeline; a read
  of an immutable constant global is its constant.
- `Asyncify` accepts `call_ref`.

### Changed — the validator

- With `simd`, `signExtension`, `satFloatToInt`, `bulkMemory` or `referenceTypes` turned OFF,
  their instructions are refused; they validated before. Default-on features are unaffected.
- `delegate`, `catch_all` and `try_table` have names in diagnostics and `wasm-objdump`.

### Fixed

- The WAT parser put a folded instruction's missing operands in the wrong slots (a `select`'s
  value and condition swapped, a param-less `throw` taking a value, a multi-result folded child
  shifting its siblings): the bytes were right, the tree was not, so optimising straight from
  parsed text could compute a different result.
- The optimizer could make an invalid or a wrong module of a body where a value sat on the stack
  beneath a two-result call whose first result a later instruction took.
- `i64.add128` / `i64.sub128` accepted a wrong-typed first operand.
- `wat2wasm` no longer reads its own output back to predict text forms: 12% faster, same bytes.

## 1.8.1

A patch release answering the wasmtk team's check of 1.8.0's custom-page-sizes lowering on five
engines (wasmtime, V8, JavaScriptCore, wasmer, wazero): values, trap positions and linking held on
all of them; the trap and link-error KINDS did not. No valid module's bytes change through
`wat2wasm`, `wasm2wat` or a plain read and write.

⚠️ **`compat/binaryen` `getFunctionInfo(f)` changes shape**: `params` and `results` are each ONE
packed type, as binaryen.js returns them — `binaryen.none` for none, the type itself for one, an
array (standing in for a tuple type) for several. They were always arrays (`[]`, `[i32]`), so code
written for binaryen.js (`results === binaryen.none`) took the wrong branch. `expandType` flattens
either shape. Code that read the arrays directly must now call `expandType`. (Released as a patch
by the maintainer's decision.)

### Fixed — `LowerCustomPageSizes`

- **An out-of-bounds access traps as an out-of-bounds access.** A lowered access past the true size
  trapped as `unreachable` on every engine — at the right place, as the wrong kind. It now makes an
  access that is out of bounds for any memory, so the engine raises its own trap ("memory access out
  of bounds" on V8), for loads, stores, atomics, SIMD and `memory.fill` / `copy` / `init` alike.
- **A mismatched link is an import-TYPE error where the engine allows it.** An exported lowered
  memory also exports, under its original name, an immutable i32 global holding its page size, and
  a lowered importer imports that name first. A 64 KiB-page module importing a lowered 1-byte-page
  memory now fails as "incompatible import type" (wasmtime), where it failed as an unknown import.
  The reverse — a lowered importer of a native memory — fails as a type error on engines that check
  imports in order (JavaScriptCore); wasmtime and V8 report its renamed memory as missing, as no
  lowering can avoid. A JavaScript host passes the extra import along with the others.

## 1.8.0

A minor release: **diagnostics you can act on, `wat2wasm` validating as upstream does, the spec's
`proposals/` in the test gate, and custom page sizes on V8.** No valid module's bytes change
through `wat2wasm`, `wasm2wat` or a plain read and write.

⚠️ **Defaults change — read these first:**

- **The `wat2wasm` CLI validates by default, as upstream's does.** An invalid module is an error at
  its `line:col` and exits 1, where it was written silently. `--no-check` restores the old
  behaviour. Validation uses upstream's default feature set, so a module using GC, exceptions, tail
  calls, memory64, multi-memory … needs `--enable-<feature>` or `--enable-all`, as with
  `wasm-validate`. An unknown option is now refused, where it was ignored. The `wat2wasm()` library
  function does not validate unless asked (`validate: true`, with `features`).
- **The binary reader stops at its first error** (`ReadBinaryOptions.stopOnFirstError` now
  defaults to `true`, as upstream; pass `false` to collect more), and **`wasmValidate` does not
  validate a module that failed to decode.** A malformed binary reports one error, the real one,
  where it reported up to 9. `errors[0]` and every `result` are unchanged.
- **Diagnostic text changes.** Binary diagnostics print `file:0000025` (they printed `file:0:0`);
  a location with neither a line nor an offset prints the filename alone. A type mismatch names its
  instruction (`in i32.add`, not `in opcode`). If you parse our diagnostic text, expect it to move.

### Added

- **`LowerCustomPageSizes`** (`wasm-opt --lower-custom-page-sizes`): a memory with a custom page
  size becomes a 64 KiB-page memory with explicit bounds checks and a `<memory>#pages` global, so
  V8 — which has no custom-page-sizes support — runs the module with the proposal's behaviour,
  traps and `memory.grow` included. A lowered memory is exported and imported as
  `<name>#pagesize=<ps>` (e.g. `mem#pagesize=1`), its size beside it as `<name>#pages`: a host reads
  `exports['mem#pagesize=1']`, and a native 64 KiB-page importer does not link to it, as the
  proposal requires. Shared custom-page memories are refused.
- **Source line and caret under text diagnostics**, as upstream's tools print them:
  `formatErrors(list, ErrorFormat.Long, source)`, used by the `wat2wasm` and `wasm-opt` CLIs. The
  caret underlines the whole token (new optional `Location.endColumn`), and points at an unknown
  operator itself, not the `(` before it.
- `formatLocation`; the `wat2wasm` options `validate` and `features`.

### Changed

- **`wasm-opt` validates its input** (`validate`, default true; `--no-validate` skips both input
  and output checks, as upstream's `--no-validation`). An invalid module is refused as `input module
  is not valid:` with located diagnostics, where it was optimized and then reported as an optimizer
  failure. A WAT input is validated as text, so its errors carry `line:col` and the source line.

### Fixed

- **Optimization emitted INVALID modules around `br_on_*`**: a value on the stack under a
  `br_on_cast` (any `br_on_*`) that a later instruction consumes was spilled at every `-O` level,
  and at `-O3` `Inlining` moved a `br_on` operand, or a multi-result operand, into its wrapper
  block. The output failed to validate — loud, never silently wrong.
- **`--flatten` emitted invalid modules around `struct.new_desc`**: allocations are now typed
  exact in a module that uses custom descriptors or exact types, as the proposal types them.
- **The validator took no label by name**: `(block $l (br $l))` from the text parser threw "var is
  not resolved", for every label kind.
- `wasm-opt -o -` (stdout) was refused as a missing output path; a bad `wasm-opt` argument printed
  a stack trace.

## 1.7.2

A patch release. **`wasm2wat` prints the text upstream `wasm2wat` and `wasm-tools` print**, and one
validator gap is closed. No valid module's bytes change; nothing is removed or renamed.

⚠️ **The text `wasm2wat` prints changes for nearly every module** — references by name and the
folded layout below. If you compare `wasm2wat` output against saved text, expect it to move once.
Assembling that text gives the same bytes as before.

### Changed — `wasm2wat` text

- **A reference prints its target's name** where the definition has one: `call $f`,
  `global.get $g`, `(type $sig)`, `(ref null $pair)`, `struct.get $pair $left`, `memory.init $m $d`,
  exports, `start`, element and data segments — where it printed indices (`call 15` beside
  `(func $f …)`). A name that two entities of one index space would share is never used, so the
  text always assembles back to the same module. Only `wasm2wat` does this: the compat API's
  `toText()` of text you parsed keeps the indices you wrote. New writer option
  `WriteWatOptions.namedReferences`.
- **Folded output puts each sibling expression and each operand on its own line**, with a newline
  after `(then`, `(else`, `(do` and `(catch`, as upstream and wasm-tools do. It ran them together:
  `(i32.const 0) (i32.const 1)) (i32.store …`.
- **An unnamed block, loop, `if` or `try_table` carries `;; label = @N` in folded output**, as it
  always did in linear output — so a branch's `(;@N;)` points at something the text shows.
- **A declaration's constant expression is one line**, folded and linear:
  `(global $g i32 (i32.add (global.get $b) (i32.const 8)))`, as wasm-tools prints it.
- **An empty offset or element item prints `(offset)` / `(item)`.** It printed nothing, so an active
  segment with an empty offset read back as a PASSIVE one, and an empty item was dropped. (Such
  modules are invalid; the text now says what the binary holds.)
- **The LAYOUT changes reach the compat printer too** (added after release, 2026-09-30, reported by
  the wasmtk team): `compat/wabt` `readWasm(bytes).toText()` prints one expression per line and
  `;; label = @N` after each unnamed `block` / `loop` / `if` / `try_table`, with either
  `readDebugNames` setting. Its tokens are unchanged — named references stay `wasm2wat`-only, as
  above — but code that reads the printed text line by line, or compares it against saved text,
  sees it move once.

### Fixed — validation

- **`array.new_default` requires an element type with a default.** `array.new_default` of a
  `(ref $t)` array validated; wasm-tools and V8 reject it, and now so does `wasm-validate`.

## 1.7.1

A patch release: **a memory or table limit above 2^32-1 is invalid, not unencodable.** It
fixes item 1 of the wasmtk team's report of 2026-09-29 (against 1.7.0).

### Fixed — behaviour

- **Every memory and table limit is a u64 in the binary**, as Wasm 3.0 specifies, whatever the
  index type. `(memory 0x1_0000_0000)` or `(table 0x1_0000_0000 funcref)` used to fail in the
  encoder (`toBinary`, `wat2wasm`: "u32 LEB128 out of range"). Now it is written as given and
  `wasm-validate` rejects it as invalid, as `memory.wast` and `table.wast` expect and wasm-tools
  does. Reading such a limit gives the same verdict, where it said malformed ("integer too large").
  No valid module's bytes change.
- **A 32-bit memory with 1-byte pages is capped at 2^32-1 pages** (`memory_max.wast`, from the
  custom-page-sizes proposal). `(memory 0x1_0000_0000 (pagesize 1))` validated.

Not changed, and reported with it: a branch hint before an instruction that is not a branch
(`i32.eq`) is already rejected by `wasmValidate` ("invalid target"). `toBinary` encodes without
validating, as upstream's does.

## 1.7.0

A minor release with **one breaking change**: the package no longer reaches upstream binaryen.
It adds the **custom-descriptors** proposal, fixes every item in the wasmtk team's report of
2026-09-28, and adds `wasm-opt --converge` and the three minify passes.

binaryang now has **no external dependencies** beyond the standard Node and Deno packages, and
calls no external tool: its reader, validator, writers, text tools and optimizer are entirely its
own TypeScript. Upstream tools are used only by the repository's tests and its separate comparison
suite.

### Breaking

- **`@jrmarcum/binaryang/interop` is removed**, with the hybrid mode that used it:
  `Module.optimize(flags, hybridMode)` no longer takes `hybridMode`, and `wasm-opt --hybrid` is
  refused ("removed in 1.7.0"). Both handed optimization to an installed upstream `wasm-opt`. To
  compare against upstream, run upstream `wasm-opt` directly. The `compat/*` APIs are unchanged —
  they reproduce upstream's API shapes without loading upstream.
- **The Binaryen IR gains custom-descriptors shapes** (`./ir/binaryen-ts`, `./ir/wabt-ts`): a new
  expression kind `ref.get_desc` (`RefGetDescExpr`), so an exhaustive `switch` over kinds needs a
  case; an optional `desc` operand on `StructNewExpr`, `RefCastExpr` and `BrOnExpr`, and
  `BrOnOp.CastDescEq` / `CastDescEqFail`; `HeapTypeRef` gains `ExactHeap` (`kind: 'exact'`), with
  `heapExact`, `isExactHeap`, `mapHeapVar` and `heapTypeText`; `TypeEntryBase` gains `describes?`
  and `descriptor?`; a function import may be `exact`.

### Added

- **The custom-descriptors proposal**, behind a new `customDescriptors` feature (off by default,
  on in `allFeatures`): exact heap types `(exact $t)` and exact function imports;
  `(describes $x)` / `(descriptor $y)` type clauses; `struct.new_desc`,
  `struct.new_default_desc`, `ref.get_desc`, `ref.cast_desc_eq`, `br_on_cast_desc_eq` and
  `br_on_cast_desc_eq_fail` — through `wat2wasm`, `wasm2wat`, `wasm-validate` and the optimizer.
  Under the feature, allocations are exact and `br_on_cast`'s cast types need only share a
  hierarchy, as the proposal specifies. Measured on the proposal's testsuite: every `assert_return`
  (271), `assert_trap` (213), `assert_invalid` (157) and `assert_malformed` (127) passes.
- **`wasm-opt --converge` / `-c`** and `optimizeToConvergence` (`./passes`): the pass schedule in
  rounds until one saves under 0.1%, keeping the smallest round. Opt-in, as upstream's.
- **`--minify-imports`, `--minify-imports-and-exports`,
  `--minify-imports-and-exports-and-modules`** — upstream's three passes, with maps identical to
  `wasm-opt` 132's. Opt-in: a renamed interface is a contract change the host applies from the map
  (printed to stdout; `minifyImportsAndExports`, `formatMinifyMap`, `takeMinifyMap` in
  `./passes`).
- **`wasm-opt -S` emits WAT** from the optimized module. It needed `--hybrid` before.
- `allFeatures`, `defaultFeatures` and `Features` are exported from `./wasm-validate` and
  `./core/wabt-ts` (wasmtk item 2).

### Fixed — reported by wasmtk (2026-09-28)

1. A named heap type inside an inline `call_indirect` / `return_call_indirect` signature is
   resolved.
2. The feature exports above.
3. `compat/binaryen`'s `Module.validate()` validates — `1` valid, `0` invalid with the reasons on
   stderr, as upstream. It returned `1` for any module.
4. `@name` placement is checked (after a binding id; once per module), and a branch hint is refused
   when duplicated, outside a function, or on anything but an `if` / `br_if`.
5. `(memory (pagesize N) (data …))` parses, and custom descriptors (above).

### Fixed — bytes move toward the spec

- **Folded text no longer drops operands.** A folded instruction written with more children than
  it takes — `(struct.new_default $s (struct.new $s))`, a void call inside another call's
  parentheses — dropped the extras; they are now emitted ahead of it, as the grammar says. A folded
  `br_on_cast` carrying a value lost its reference the same way.
- **A branch hint before a folded instruction** is recorded at the instruction, as wasm-tools
  records it, not at the expression's first byte.
- **An inline-data memory writes its maximum** (`(memory m m)`, as the spec abbreviation says); it
  wrote none, so the memory could grow.
- **The text-form section** of a module where a multi-value producer feeds a fold changes (3 of
  421 corpus files); the printed text does not.

### Fixed — behaviour

- `struct.new_default` refuses a struct with a non-defaultable field; it validated.
- `wat2wasm` refuses `function` where `func` is meant (`(module (function $f))`, an import or
  export of kind `function`), as upstream and wasm-tools do.
- `parseF32Literal` / `parseF64Literal` (`core/literal.ts`) agree with `wat2wasm` bit for bit: `0x1.5`,
  `1_000.5`, values past bit 52, f32 decimals and `1e39` were wrong; an overflowing finite literal
  is an error, and trailing junk is refused.
- `wat2wasm` explains a limit past its index type with the validator's message.
- `wasm-objdump -d` alone no longer prints section headers; `-h -d` prints both.
- `Flatten` handles value-carrying `br` / `br_if` / `br_table`, multi-value, stack-form code and
  legacy `try`; it refuses only `br_on_*` and `try_table`, as upstream does. Three silent defects
  went with it (a lost trap, an invalid block, a discarded stack value). ⚠️ `flattenFunction` gains
  an optional `tagParams` argument.

## 1.6.1

A patch release: **the CLI runs from JSR.**

- `deno run -A jsr:@jrmarcum/binaryang <command>`, as the README documents it, printed nothing and
  exited 0 on every published version. The package root (`.`) was a module with no dispatcher. It is
  `main.ts` now — the CLI — and it runs its dispatcher only as the program's entry, so importing the
  root runs nothing. The root still exports nothing a library needs; every library subpath is
  unchanged.
- The tools' docs showed per-tool commands (`jsr:@jrmarcum/binaryang/wasm-validate …`) that also did
  nothing. They show the root's form now: `deno run -A jsr:@jrmarcum/binaryang wasm-validate …`.
- The release preflight now runs the package root as a user does — `--help`, `--version`, a
  command, and an import — and refuses to release if it is not the CLI.

It carries none of the work on `main` since 1.6.0 (new passes, fixes): that is the next release.
It contains none of the items in wasmtk's letter of 2026-09-28.

## 1.6.0

A minor release with **breaking changes**: the two IRs converged into one, and binaryen-ts's own
binary decoder and encoder are gone. Every tool and API now reads WebAssembly with one reader and
writes it with one writer (wabt-ts's). If you use only the tools (`wat2wasm`, `wasm2wat`,
`wasm-opt`, …) or the `compat` APIs, nothing you call has moved.

### Migrating

- **`@jrmarcum/binaryang/binary` and `@jrmarcum/binaryang/encoder` are removed.** They exported
  `parseWasm` and `encodeWasm`, which were binaryen-ts's own decoder and encoder. To read a binary into the Binaryen IR, use
  `readBinary` from `@jrmarcum/binaryang/compat/binaryen` (the IR is `module._inner`); to write
  one, `module.emitBinary()`, or `toBinary()` from `@jrmarcum/binaryang/api`.
- **The Binaryen IR (`./ir/binaryen-ts`) has wabt-ts's record shapes.** The main renames:
  - `WasmFunction.params` / `.results` → `sig`; `WasmTag.params` → `sig`;
    `WasmModule.heapTypes` → `types`, `ModuleBuilder.addHeapType` → `addType`;
  - an import embeds its entity (`{ kind: ExternalKind.Func, module, field, func }`), and
    `WasmExport` has `kind: ExternalKind` and `var`;
  - tables and memories hold a `Limits` (`bigint` sizes; `max` absent when unbounded);
  - data and element segments, constant expressions (`RegionExpr`), and region bodies take
    wabt-ts's shapes;
  - `ValType`'s values are the wire bytes; a heap type is a `HeapTypeRef`;
  - an alignment is in bytes; `start` is a `Var`.
- **The wabt-ts IR (`./ir/wabt-ts`)**: `funcs` / `elemSegments` / `customs` → `functions` /
  `elements` / `customSections`; `numFuncImports` and its siblings → `countImports(m, kind)`;
  `Func.body` is a `RegionExpr`, `Func.locals` holds every slot; a module read from a binary names
  every entity.

### Changed

- `wasm2wat` keeps each instruction's written form. `wat2wasm` records it in a
  `binaryang.text-form` custom section (`--no-text-form` omits the section, giving upstream's bytes).
- `wat2wasm` writes a `name` section. `wasm2wat` no longer invents names unless you pass
  `--generate-names`.
- `wasm-opt` removes dead functions at every `-O` level, as upstream does.
- `wasm2wat` prints a tag's type use, `(tag (type N) (param …))`, as upstream does.
- `wat2wasm` accepts `(import "M" "t" (tag (type $t)))`, and writes `(@metadata.code.NAME "…")`
  as a `metadata.code.NAME` section.

### Fixed

- `wasm-opt` no longer changes what a module does in several cases, including a silent `-O2`
  miscompile that shipped in 1.5.4. Each spec-testsuite invocation now behaves the same before and
  after optimization, SIMD included.
- `wasm-opt` no longer emits invalid modules for block parameters, for several unreachable-code
  shapes, or with `--flatten`. Flatten either produces a valid module or names what it does not
  support.
- Modules with more than one table are written and optimized.
- A tag keeps the type it named when several function types are identical.
- `Module.toWat()` prints valid WAT, and hybrid mode (`optimize(…, true)`, `wasm-opt --hybrid`)
  works.
- Relaxed SIMD is read, optimized and written.

### Now refused

These were accepted before and are invalid:

- a bare `ref` / `func` / `extern` value type (`(local ref i32)`);
- a `catch` after `catch_all` in a legacy `try` (V8 refuses it too);
- a tag whose type index does not exist;
- a function declaring more than 1,000,000 locals.
