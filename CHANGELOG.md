# Changelog

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
