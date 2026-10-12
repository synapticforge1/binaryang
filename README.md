# binaryang

[![JSR](https://jsr.io/badges/@jrmarcum/binaryang)](https://jsr.io/@jrmarcum/binaryang)
[![JSR Score](https://jsr.io/badges/@jrmarcum/binaryang/score)](https://jsr.io/@jrmarcum/binaryang)
[![CI](https://github.com/jrmarcum/binaryang/actions/workflows/ci.yml/badge.svg)](https://github.com/jrmarcum/binaryang/actions/workflows/ci.yml)

A WebAssembly toolchain in TypeScript — a port of both
[Binaryen](https://github.com/WebAssembly/binaryen) and [WABT](https://github.com/WebAssembly/wabt)
in one package, with no binary dependency and no WASM blob to load.

Assemble and disassemble WAT, validate and inspect modules, build and optimise IR — from a single
source tree that runs on Deno, Node, Bun and modern browsers.

> Supersedes `@jrmarcum/binaryen-ts` and `@jrmarcum/wabt-ts`. If you are migrating from either, see
> [Migrating](#migrating) — it is a package rename plus two subpaths.

## Install

```sh
npx  jsr add @jrmarcum/binaryang         # Node (npm)
bunx jsr add @jrmarcum/binaryang         # Bun
pnpm add jsr:@jrmarcum/binaryang         # pnpm 10.9+ (yarn 4.9+: yarn add jsr:@jrmarcum/binaryang)
deno add jsr:@jrmarcum/binaryang         # Deno
```

Install once per project, then import by the package name. The same import line works on every
runtime:

```ts
import { wat2wasm } from '@jrmarcum/binaryang/wat2wasm';
```

Only Deno can import JSR packages without installing them first. Node and Bun reject the `jsr:`
prefix, and so do `npm install` and `bun add`. `npx jsr add` / `bunx jsr add` record the package
as an `npm:@jsr/jrmarcum__binaryang` alias in `package.json` and write an `.npmrc` pointing the
`@jsr` scope at JSR's registry. Commit both. pnpm 10.9+ and yarn 4.9+ understand `jsr:` natively
and need no `.npmrc`. Node and Bun receive compiled JavaScript with type declarations, so no
TypeScript setup is needed. On Deno, `import … from 'jsr:@jrmarcum/binaryang/wat2wasm'` also works
with no install.

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
node node_modules/@jrmarcum/binaryang/main.js <command> [options]   # Node, after installing
bun  node_modules/@jrmarcum/binaryang/main.js <command> [options]   # Bun, after installing
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
node node_modules/@jrmarcum/binaryang/main.js wat2wasm add.wat -o add.wasm
node node_modules/@jrmarcum/binaryang/main.js wasm-opt add.wasm -o add.min.wasm -Oz
```

The installed package is compiled JavaScript (`main.js`), so Node needs no flags. JSR packages
have no `bin` entry, so `npx binaryang` does not exist. A `package.json` script gives the same
short form:

```json
{ "scripts": { "binaryang": "node node_modules/@jrmarcum/binaryang/main.js" } }
```

```sh
npm run binaryang -- wat2wasm add.wat -o add.wasm
```

> Node needs no flag, for the installed package (compiled JavaScript) or for this repository's
> source (erasable TypeScript, which Node's default type stripping runs, from 22.18 through 26).

## What's in the package

| import                                               | contents                                                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@jrmarcum/binaryang/wat2wasm` … `/wasm2ts`          | the six WABT tools, one subpath each                                                                                                                                   |
| `@jrmarcum/binaryang/ir`                             | the IR: its records, the expression factories, the module builder, the value and GC types, and the vocabulary tool results use (`Result`, `ErrorList`, `formatErrors`) |
| `…/ir/wabt-ts`, `…/ir/binaryen-ts`, `…/core/wabt-ts` | ⚠️ deprecated since 1.11.0 — `./ir` exports all of them; removed in a later minor                                                                                      |
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
enum (`Type.I32`); the type of a node's `type` field is `ExprType` (`./ir/binaryen-ts` called it
`Type`, and still does, deprecated).

## Runtime support

Runs on **Deno, Node.js, Bun and modern browsers** from a single source tree.

| runtime  | minimum     | tested in CI                    | note                                |
| -------- | ----------- | ------------------------------- | ----------------------------------- |
| Deno     | 2.x         | 2.x                             |                                     |
| Node.js  | **22.18.0** | 22.18.0, latest 22, 24, 26      | no flags¹                           |
| Bun      | **1.4.0**   | 1.4.0                           |                                     |
| browsers | modern      | every export bundles for them²  | library surface only, not the CLI   |

¹ Node users receive JSR's compiled JavaScript. binaryang's TypeScript **source** (a clone of this
repository) also runs on Node with no flag: it is ERASABLE TypeScript, with no `enum`s and no
constructor parameter properties, which Node's default type stripping accepts, Node 26 included.
The compiler option `erasableSyntaxOnly` keeps it that way.

² Every export is bundled for the browser target in CI and must not import a Node builtin; the
library's command-line paths load Node's file system only when they run. That proves the exports
LOAD in a browser. A headless-browser run of the library is planned, not yet in CI.

**Node.js: every current LTS line is supported and tested** (Node 22 "Jod" and Node 24
"Krypton" as of 2026-10). Supported means not end-of-life: Node 18 ended 2025-04-30 and Node 20 on
2026-04-30, so neither is supported. Node 22 is in maintenance until 2027-04-30. The floor is
**22.18.0** rather than 22.0 because `import.meta.main` was backported to the v22 line in 22.18.0.

**Bun: 1.4.0 is the Zig → Rust rewrite.** The floor sits on that boundary so binaryang never spans
two different implementations of the same runtime. Bun 1.3 is not end-of-life and is still not
supported here — the one place the two runtimes are governed differently, said plainly rather than
buried.

## Migrating

From either predecessor, this is a package rename plus two subpaths.

| was                                                     | now                                   |
| ------------------------------------------------------- | ------------------------------------- |
| `@jrmarcum/binaryen-ts/compat`                          | `@jrmarcum/binaryang/compat/binaryen` |
| `@jrmarcum/wabt-ts/compat`                              | `@jrmarcum/binaryang/compat/wabt`     |
| `@jrmarcum/binaryen-ts/ir`                              | `@jrmarcum/binaryang/ir` ¹            |
| the WABT IR, via the `wabt-ts` package **root**         | `@jrmarcum/binaryang/ir`              |
| `Result`, `ErrorList`, `formatErrors`, via the **root** | `@jrmarcum/binaryang/ir`              |

¹ Binaryen's `Type` union is `ExprType` there. (Until 1.11.0 these three were `./ir/binaryen-ts`,
`./ir/wabt-ts` and `./core/wabt-ts`, which remain for one release, deprecated.)

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

Project memory lives in [`cmem/`](https://github.com/jrmarcum/binaryang/tree/main/cmem/) — start
with [`cmem/INDEX.md`](https://github.com/jrmarcum/binaryang/blob/main/cmem/INDEX.md). Two rules are
binding and enforced in CI: upstream project names are reserved for upstream-compatibility paths,
and runtime portability is enforced (no Deno-specific globals in shipped source, and no top-level
import of a `node:` builtin anywhere in it, because those do not load in a browser; the CLI loads
Node's file system only when it runs, and every export is bundled for the browser in CI).

## Licence

MIT, with Apache-2.0 available as an alternative. binaryang is a derivative of the Apache-2.0
WebAssembly/wabt and WebAssembly/binaryen projects and carries `LICENSE-APACHE`, `NOTICE.md` and
per-file attribution headers. See
[`cmem/licensing.md`](https://github.com/jrmarcum/binaryang/blob/main/cmem/licensing.md).
