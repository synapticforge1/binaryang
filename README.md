# binaryang

[![JSR](https://jsr.io/badges/@jrmarcum/binaryang)](https://jsr.io/@jrmarcum/binaryang)
[![JSR Score](https://jsr.io/badges/@jrmarcum/binaryang/score)](https://jsr.io/@jrmarcum/binaryang)
[![npm](https://img.shields.io/npm/v/@synapticforge1/binaryang)](https://www.npmjs.com/package/@synapticforge1/binaryang)
[![CI](https://github.com/synapticforge1/binaryang/actions/workflows/ci.yml/badge.svg)](https://github.com/synapticforge1/binaryang/actions/workflows/ci.yml)

A WebAssembly toolchain in TypeScript — a port of both
[Binaryen](https://github.com/WebAssembly/binaryen) and [WABT](https://github.com/WebAssembly/wabt)
in one package, with no binary dependency and no WASM blob to load.

Assemble and disassemble WAT, validate and inspect modules, build and optimise IR — from a single
source tree that runs on Deno, Node, Bun and modern browsers.

> Supersedes `@jrmarcum/binaryen-ts` and `@jrmarcum/wabt-ts`. If you are migrating from either, see
> [Migrating](#migrating) — it is a package rename plus two subpaths.

## Install

The same package is published to two registries, under two names. The code, the version and the
subpaths are identical; only the package name in an import differs.

| registry                                                                    | package name                | best for                                 |
| --------------------------------------------------------------------------- | --------------------------- | ---------------------------------------- |
| [npm](https://www.npmjs.com/package/@synapticforge1/binaryang) (from 1.13.1) | `@synapticforge1/binaryang` | Node, Bun, pnpm, yarn: no `.npmrc`, `npx` |
| [JSR](https://jsr.io/@jrmarcum/binaryang) (the source)                      | `@jrmarcum/binaryang`       | Deno; any runtime through `jsr add`      |

**From npm:**

```sh
npm install @synapticforge1/binaryang    # or: bun add / pnpm add / yarn add
```

```ts
import { wat2wasm } from '@synapticforge1/binaryang/wat2wasm';
```

**From JSR:**

```sh
npx  jsr add @jrmarcum/binaryang         # Node (npm)
bunx jsr add @jrmarcum/binaryang         # Bun
pnpm add jsr:@jrmarcum/binaryang         # pnpm 10.9+ (yarn 4.9+: yarn add jsr:@jrmarcum/binaryang)
deno add jsr:@jrmarcum/binaryang         # Deno
```

```ts
import { wat2wasm } from '@jrmarcum/binaryang/wat2wasm';
```

Only Deno can import JSR packages without installing them first. Node and Bun reject the `jsr:`
prefix, and so do `npm install` and `bun add`. `npx jsr add` / `bunx jsr add` record the package
as an `npm:@jsr/jrmarcum__binaryang` alias in `package.json` and write an `.npmrc` pointing the
`@jsr` scope at JSR's registry. Commit both. pnpm 10.9+ and yarn 4.9+ understand `jsr:` natively
and need no `.npmrc`. On Deno, `import … from 'jsr:@jrmarcum/binaryang/wat2wasm'` also works with
no install.

Either way, Node and Bun receive compiled JavaScript with type declarations, so no TypeScript setup
is needed. **The examples below use the JSR name; from npm, write `@synapticforge1/binaryang`
where they say `@jrmarcum/binaryang`.**

## Quick start

### Assemble and disassemble

```ts
import { wat2wasm } from '@jrmarcum/binaryang/wat2wasm';
import { wasm2wat } from '@jrmarcum/binaryang/wasm2wat';
import { formatErrors, Result } from '@jrmarcum/binaryang/ir';

const source = `
  (module
    (func (export "add") (param i32 i32) (result i32)
      (i32.add (local.get 0) (local.get 1))))
`;

const { binary, errors, result } = wat2wasm(source, { filename: 'add.wat' });
if (result !== Result.Ok) {
  console.error(formatErrors(errors));
} else {
  console.log(binary.length); // 41

  const { text } = wasm2wat(binary, {});
  console.log(text); // the module, back as WAT — in the form it was written (folded here)
  // ...or wasm2wat(binary, { fold: false }) for the flat stack-machine form throughout
}
```

Every tool returns its outcome as a `Result` with an `errors` list rather than throwing, so a
malformed input is a value you inspect. `formatErrors` renders it for humans.

### Build a module

```ts
import { BinaryOp, createModule, ValType } from '@jrmarcum/binaryang/api';

const mod = createModule((b, e) => {
  b.addFunction(
    'add',
    [ValType.I32, ValType.I32],
    [ValType.I32],
    e.binary(BinaryOp.AddI32, e.localGet(0, ValType.I32), e.localGet(1, ValType.I32)),
  );
  b.addExport('add', 'add');
});

const bytes = mod.toBinary();
console.log(mod.toWat());

const { exports } = new WebAssembly.Instance(new WebAssembly.Module(bytes));
console.log((exports.add as (a: number, b: number) => number)(19, 23)); // 42
```

### Read a module's structure

```ts
import { readBinary } from '@jrmarcum/binaryang/compat/binaryen';

const mod = readBinary(bytes); // the upstream binaryen.js shape
console.log(mod.getNumExports(), mod._inner.functions.length); // `_inner` is the Binaryen IR
```

## Command line

One entry point, seven commands:

```sh
npx binaryang <command> [options]                                   # installed from npm
npx @synapticforge1/binaryang <command> [options]                   # from npm, no install
node node_modules/@jrmarcum/binaryang/main.js <command> [options]   # Node, installed from JSR
bun  node_modules/@jrmarcum/binaryang/main.js <command> [options]   # Bun, installed from JSR
deno run -A jsr:@jrmarcum/binaryang <command> [options]             # Deno, no install
```

| command                   | does                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wat2wasm <in.wat>`       | assemble and validate WAT to a WASM binary, as upstream · `-o <file>` · `--no-check` · `--enable-all`, `--enable-<feature>`, `--disable-<feature>` · `--no-text-form`¹                                                                                                                                                                                                       |
| `wasm2wat <in.wasm>`      | disassemble to WAT, every instruction in its written form¹ · `-o <file>` · `--linear` / `--fold` for one form throughout                                                                                                                                                                                                                                                     |
| `wasm-validate <in.wasm>` | validate · `--enable-all`, `--enable-<feature>`, `--disable-<feature>`                                                                                                                                                                                                                                                                                                       |
| `wasm-objdump <in.wasm>`  | dump sections                                                                                                                                                                                                                                                                                                                                                                |
| `wasm-strip <in.wasm>`    | remove custom sections · `-o <file>`, `-s <section>`                                                                                                                                                                                                                                                                                                                         |
| `wasm-opt <in>`           | optimise · `-O0`–`-O4`, `-Os`, `-Oz`, `-S`                                                                                                                                                                                                                                                                                                                                   |
| `wasm-ctor-eval <in>`     | run constructors at build time and write their memory and globals into the module · `--ctors=a,b`, `--kept-exports=a,b`, `--ignore-external-input`, `-o <file>`, `-S`                                                                                                                                                                                                        |
| `wasm-interp <in>`        | run exported functions on the interpreter and print each result · `--run-all-exports`, `--run-export=NAME`, `--argument=V`, `--dummy-import-func`                                                                                                                                                                                                                            |
| `wasm-bundle <in>...`     | bundle modules into one with ONE memory, each image relocated exactly through its `linking` / `reloc.*` sections (`wasm-ld --emit-relocs`, or `(@reloc data)` marks in WAT) · `-o <file>`, `--on-conflict=prefix\|alias\|exclude`, `--alias a.wasm=m`, `--unmarked=guess`, `--start=NAME`, `-S` · writes `<out>.wit` (the interface, from core signatures) unless `--no-wit` |
| `wasm2ts <in.wasm>`       | emit TypeScript — **not yet implemented**                                                                                                                                                                                                                                                                                                                                    |

¹ `wat2wasm` → `wasm2wat` transpiles verbatim: `wat2wasm` records how each instruction was written —
bare or folded, and grouped how — in a `binaryang.text-form` custom section, and `wasm2wat` gives it
back that way: linear stays linear, folded stays folded, a mix stays the same mix (the plain nested
fold where nothing is recorded, as for any other tool's binary). `--no-text-form` omits the record —
upstream `wat2wasm`'s bytes exactly. Optimizing drops it, and so does `wasm-strip`.

```sh
npx binaryang wat2wasm add.wat -o add.wasm                                  # from npm
npx binaryang wasm-opt add.wasm -o add.min.wasm -Oz
node node_modules/@jrmarcum/binaryang/main.js wat2wasm add.wat -o add.wasm  # from JSR
```

The installed package is compiled JavaScript (`main.js`), so Node needs no flags. The npm package
declares `binaryang` as its command. JSR packages cannot (no `bin` entry), so after a JSR install
a `package.json` script gives the same short form:

```json
{ "scripts": { "binaryang": "node node_modules/@jrmarcum/binaryang/main.js" } }
```

```sh
npm run binaryang -- wat2wasm add.wat -o add.wasm
```

> Node needs no flag, for the installed package (compiled JavaScript) or for this repository's
> source (erasable TypeScript, which Node's default type stripping runs, from 22.18 through 26).

## What's in the package

Each import below is the JSR name; from npm, each starts with `@synapticforge1/binaryang` instead.

| import                                               | contents                                                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@jrmarcum/binaryang/wat2wasm` … `/wasm2ts`          | the six WABT tools, one subpath each                                                                                                                                   |
| `@jrmarcum/binaryang/ir`                             | the IR: its records, the expression factories, the module builder, the value and GC types, and the vocabulary tool results use (`Result`, `ErrorList`, `formatErrors`) |
| `@jrmarcum/binaryang/api`                            | high-level builder API                                                                                                                                                 |
| `@jrmarcum/binaryang/passes`                         | optimisation pass registry and runner                                                                                                                                  |
| `@jrmarcum/binaryang/wasm` · `/wasm-runtime`         | WASM helpers and a small runtime                                                                                                                                       |
| `@jrmarcum/binaryang/tools/wasm-opt`                 | `wasm-opt` as a library                                                                                                                                                |
| `@jrmarcum/binaryang/tools/wasm-ctor-eval`           | `wasm-ctor-eval` as a library (`ctorEval(module, options)`)                                                                                                            |
| `@jrmarcum/binaryang/tools/wasm-interp`              | `wasm-interp` as a library (`interpModule(module, options)`)                                                                                                           |
| `@jrmarcum/binaryang/tools/wasm-bundle`              | `wasm-bundle` as a library (`bundle(inputs, options)`, `wasmBundle(paths, options)`)                                                                                   |
| `@jrmarcum/binaryang/compat/binaryen`                | the upstream `npm:binaryen` API shape                                                                                                                                  |
| `@jrmarcum/binaryang/compat/wabt`                    | the upstream `wabt.js` API shape                                                                                                                                       |

**No external dependencies.** binaryang's reader, validator, writers, text tools and optimizer are
entirely its own TypeScript; it has no external dependencies beyond the standard Node and Deno
packages, and calls no external tool. Upstream tools (`wast2json`, `wasm-tools`, upstream binaryen)
are used only by the repository's tests and its separate comparison suite — never by the published
package. The `compat/*` subpaths reproduce upstream's API _shapes_; they do not load upstream.

**One IR, one subpath.** The reader, writers and validator and the optimisation passes all work on
one IR, and `./ir` exports it under both WABT's names (`Expr`, `Module`) and Binaryen's
(`Expression`, `WasmModule`) — the same types. One name means one thing: `Type` is the value-type
enum (`Type.I32`); the type of a node's `type` field is `ExprType`.

## Runtime support

Runs on **Deno, Node.js, Bun and modern browsers** from a single source tree.

| runtime  | minimum     | tested in CI                                           | note                              |
| -------- | ----------- | ------------------------------------------------------ | --------------------------------- |
| Deno     | 2.x         | 2.x                                                    |                                   |
| Node.js  | **22.18.0** | 22.18.0, latest 22, 24, 26                             | no flags¹                         |
| Bun      | **1.4.0**   | 1.4.0                                                  |                                   |
| browsers | modern      | Chromium, Chrome, Edge, Brave, Opera, Firefox, WebKit² | library surface only, not the CLI |

¹ Node users receive compiled JavaScript: the npm package's, or JSR's own build. binaryang's
TypeScript **source** (a clone of this
repository) also runs on Node with no flag: it is ERASABLE TypeScript, with no `enum`s and no
constructor parameter properties, which Node's default type stripping accepts, Node 26 included.
The compiler option `erasableSyntaxOnly` keeps it that way.

² Every export is bundled for the browser target in CI and must not import a Node builtin; the
library's command-line paths load Node's file system only when they run. CI then RUNS the library
in each of these browsers, headless (WebKit is Safari's engine): every export loads, and `wat2wasm`
and `wasmOpt` give byte-identical output to Deno, Node and Bun on 421 modules, which each browser's
engine accepts. The browser recipe below runs there too.

### Making a module run on Safari and Bun

binaryang runs everywhere; a module you build may not. JavaScriptCore — the engine in Safari and in
Bun — refuses some features V8 (Chrome, Node, Deno) accepts. Two passes rewrite a module so it
runs there, with the same behaviour:

| the module uses | JavaScriptCore says | run |
| --------------- | ------------------- | --- |
| a 64-bit memory or table (memory64) | "Memory64 is not enabled" | `--memory64-lowering` |
| legacy exception handling (`try` … `delegate`) | "delegate target isn't a try block" | `--translate-to-exnref` |

```sh
npx binaryang wasm-opt in.wasm --memory64-lowering --translate-to-exnref -o out.wasm
```

```ts
import { wasmOpt } from '@jrmarcum/binaryang/tools/wasm-opt';
const out = await wasmOpt(bytes, { passes: ['memory64-lowering', 'translate-to-exnref'] });
```

**`--memory64-lowering` keeps the module's behaviour**, unlike Binaryen's pass of the same name: an
address, index or length of 2^32 or more still traps out of bounds (Binaryen's wraps it, so a
load reads the wrong bytes and a store overwrites them). A lowered memory holds at most 65,535
pages (4 GiB less one page) and a lowered table 2^32 − 2 elements; a module that starts larger is
refused with a message. An imported or exported 64-bit memory or table becomes a 32-bit one, so
the host supplies or receives a 32-bit one. Every spec module with a 64-bit memory or table is
checked lowered, against the original, on V8 and on JavaScriptCore (`bun run lowering`).
Multi-memory has no pass: Bun's JavaScriptCore runs it (up to 100 memories; V8 has no such limit),
but Safari ships it only in Technology Preview (MDN browser-compat-data, 2026-10), so a module for
Safari should use one memory — which is all any compiler measured emits.

### Making a module run without wide arithmetic

The wide-arithmetic instructions (`i64.add128`, `i64.sub128`, `i64.mul_wide_s`, `i64.mul_wide_u`)
run on Safari, Bun, Firefox and wasmtime, but V8 (Chrome, Edge, Node, Deno), WasmEdge, wasmer,
wazero and Firefox ESR refuse them. `--wide-arithmetic-lowering` rewrites each to plain `i64`
arithmetic — exact for every input, a 128-bit result as the proposal defines it — through one small
helper function per instruction used:

```sh
npx binaryang wasm-opt in.wasm --wide-arithmetic-lowering -o out.wasm
```

### Optimizing in the browser

A page can shrink a WebAssembly module it does **not** control (third-party, user-supplied, a
playground's) on the user's machine. Expect a **size** win, not speed. Measured in Chrome,
Firefox and Safari's engine on real compiler output (Rust, Zig, TinyGo; debug and release builds of
one compute workload): code bytes −0.1% to −27%, 60 ms to 1.7 s to optimize, and **no run-time
speedup**, not even on the debug builds; the engines' own optimizing tiers already did that work. A
site that builds its own module should optimize it at build time instead.

[`examples/browser-optimize`](https://github.com/synapticforge1/binaryang/tree/main/examples/browser-optimize)
is the recipe, two files to copy and bundle side by side. It runs `wasmOpt` in a Worker with a time
limit, keeps the original whenever the browser refuses the input, the optimizer fails or the result
is no smaller, and caches results by the input's SHA-256 (Cache API):

```ts
import { optimizeInBrowser } from './optimize.ts';

const original = new Uint8Array(await (await fetch(url)).arrayBuffer());
const { bytes, optimized, reason } = await optimizeInBrowser(original);
const { instance } = await WebAssembly.instantiate(bytes, imports);
```

**Node.js: every current LTS line is supported and tested** (Node 22 "Jod" and Node 24
"Krypton" as of 2026-10). Supported means not end-of-life: Node 18 ended 2025-04-30 and Node 20 on
2026-04-30, so neither is supported. Node 22 is in maintenance until 2027-04-30. The floor is
**22.18.0** rather than 22.0 because `import.meta.main` was backported to the v22 line in 22.18.0.

**Bun: 1.4.0 is the Zig → Rust rewrite.** The floor sits on that boundary so binaryang never spans
two different implementations of the same runtime. Bun 1.3 is not end-of-life and is still not
supported here — the one place the two runtimes are governed differently, said plainly rather than
buried.

## Migrating

### ⚠️ Breaking Changes

Every release that removed or renamed something you could import. From the release after 1.15.0
on, a break is a **major** version, and the release tooling refuses a lower one (Semantic
Versioning, checked against a committed snapshot of the API); the three below came out as minors,
before that rule.

| Version | What changed                                                                                                                                  | How to migrate                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1.12.0  | `./ir/binaryen-ts`, `./ir/wabt-ts`, `./core/wabt-ts` removed (deprecated in 1.11.0); type names `Type` in `./api`, `Features` / `WasmModule` in `./compat/wabt` removed | import from `./ir`, which exports the same names from the same declarations; use `ExprType`, `WabtFeatures`, `WabtWasmModule` |
| 1.7.0   | `./interop` removed, with `Module.optimize(flags, hybridMode)`'s `hybridMode` and `wasm-opt --hybrid`                                         | run upstream `wasm-opt` directly to compare; the `compat/*` APIs are unchanged                                                         |
| 1.6.0   | `./binary` and `./encoder` removed; the Binaryen IR took wabt-ts's record shapes                                                              | read with `readBinary` from `./compat/binaryen`, write with `module.emitBinary()` or `toBinary()` from `./api`; CHANGELOG § 1.6.0 lists the renames |

### From the predecessors

From either predecessor, this is a package rename plus two subpaths.

| was                                                     | now                                   |
| ------------------------------------------------------- | ------------------------------------- |
| `@jrmarcum/binaryen-ts/compat`                          | `@jrmarcum/binaryang/compat/binaryen` |
| `@jrmarcum/wabt-ts/compat`                              | `@jrmarcum/binaryang/compat/wabt`     |
| `@jrmarcum/binaryen-ts/ir`                              | `@jrmarcum/binaryang/ir` ¹            |
| the WABT IR, via the `wabt-ts` package **root**         | `@jrmarcum/binaryang/ir`              |
| `Result`, `ErrorList`, `formatErrors`, via the **root** | `@jrmarcum/binaryang/ir`              |

¹ Binaryen's `Type` union is `ExprType` there. (Through 1.11.0 these three were also
`./ir/binaryen-ts`, `./ir/wabt-ts` and `./core/wabt-ts`, deprecated in 1.11.0 and removed after.)

Everything else keeps its name: `./api`, `./passes`, `./wasm`, `./wasm-runtime`, `./tools/wasm-opt`,
and the six WABT tool subpaths. (`./binary` and `./encoder` were removed at 1.6.0, and `./interop` —
the bridge to upstream binaryen.js — at 1.7.0.)

**If you imported from the `wabt-ts` package root, you need a named subpath now.** That package
shipped its IR and its core vocabulary through the root; binaryang's root is deliberately narrow,
because a root spanning both IRs would surface every colliding type name at one specifier.

```ts
// was
import { Result, wat2wasm } from 'jsr:@jrmarcum/wabt-ts';
// now
import { wat2wasm } from 'jsr:@jrmarcum/binaryang/wat2wasm';
import { Result } from 'jsr:@jrmarcum/binaryang/ir';
```

The six WABT tools were previously separate published entry points that self-executed. They are now
registered in one CLI dispatcher, which is what lets them run on Node and Bun rather than Deno
alone.

**Pinned to an old version? Nothing breaks.** `@jrmarcum/binaryen-ts` and `@jrmarcum/wabt-ts` each
get a final 1.5.1 release pointing here and are then archived. Every published version keeps
resolving — nothing is yanked.

## Contributing

Project memory lives in [`cmem/`](https://github.com/synapticforge1/binaryang/tree/main/cmem/) — start
with [`cmem/INDEX.md`](https://github.com/synapticforge1/binaryang/blob/main/cmem/INDEX.md). Two rules are
binding and enforced in CI: upstream project names are reserved for upstream-compatibility paths,
and runtime portability is enforced (no Deno-specific globals in shipped source, and no top-level
import of a `node:` builtin anywhere in it, because those do not load in a browser; the CLI loads
Node's file system only when it runs, and every export is bundled for the browser in CI).

## Licence

MIT, with Apache-2.0 available as an alternative. binaryang is a derivative of the Apache-2.0
WebAssembly/wabt and WebAssembly/binaryen projects and carries `LICENSE-APACHE`, `NOTICE.md` and
per-file attribution headers. See
[`cmem/licensing.md`](https://github.com/synapticforge1/binaryang/blob/main/cmem/licensing.md).
