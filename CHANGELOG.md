# Changelog

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
