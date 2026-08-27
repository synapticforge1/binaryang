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
deno add jsr:@jrmarcum/binaryang     # Deno
npx  jsr add @jrmarcum/binaryang     # Node
bunx jsr add @jrmarcum/binaryang     # Bun
```

Or import directly, no install:

```ts
import { wat2wasm } from 'jsr:@jrmarcum/binaryang/wat2wasm';
```

## Quick start

### Assemble and disassemble

```ts
import { wat2wasm } from '@jrmarcum/binaryang/wat2wasm';
import { wasm2wat } from '@jrmarcum/binaryang/wasm2wat';
import { formatErrors, Result } from '@jrmarcum/binaryang/core/wabt-ts';

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
  console.log(text); // the module, back as WAT
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
import { parseWasm } from '@jrmarcum/binaryang/binary';

const mod = parseWasm(bytes);
console.log(mod.functions.length, mod.exports.length);
```

## Command line

One entry point, seven commands:

```sh
deno run -A jsr:@jrmarcum/binaryang <command> [options]
```

| command                   | does                                                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| `wat2wasm <in.wat>`       | assemble WAT to a WASM binary · `-o <file>`                            |
| `wasm2wat <in.wasm>`      | disassemble to WAT · `-o <file>`                                       |
| `wasm-validate <in.wasm>` | validate · `--enable-all`, `--enable-<feature>`, `--disable-<feature>` |
| `wasm-objdump <in.wasm>`  | dump sections                                                          |
| `wasm-strip <in.wasm>`    | remove custom sections · `-o <file>`, `-s <section>`                   |
| `wasm-opt <in>`           | optimise · `-O0`–`-O4`, `-Os`, `-Oz`, `-S`, `--hybrid`                 |
| `wasm2ts <in.wasm>`       | emit TypeScript — **not yet implemented**                              |

```sh
deno run -A jsr:@jrmarcum/binaryang wat2wasm add.wat -o add.wasm
deno run -A jsr:@jrmarcum/binaryang wasm-opt add.wasm -o add.min.wasm -Oz
```

On Node and Bun, after installing:

```sh
node --experimental-transform-types node_modules/@jrmarcum/binaryang/main.ts wat2wasm add.wat
bun node_modules/@jrmarcum/binaryang/main.ts wat2wasm add.wat
```

> Node needs `--experimental-transform-types`, **not** `--experimental-strip-types`. Strip-only mode
> erases types without generating code, so it rejects TypeScript `enum` and parameter properties.

## What's in the package

| import                                       | contents                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `@jrmarcum/binaryang/wat2wasm` … `/wasm2ts`  | the six WABT tools, one subpath each                                    |
| `@jrmarcum/binaryang/core/wabt-ts`           | `Result`, `ErrorList`, `formatErrors` — the vocabulary tool results use |
| `@jrmarcum/binaryang/ir/wabt-ts`             | the WABT IR                                                             |
| `@jrmarcum/binaryang/ir/binaryen-ts`         | the Binaryen IR and module builder                                      |
| `@jrmarcum/binaryang/api`                    | high-level builder API                                                  |
| `@jrmarcum/binaryang/binary` · `/encoder`    | decode and encode WASM binaries                                         |
| `@jrmarcum/binaryang/passes`                 | optimisation pass registry and runner                                   |
| `@jrmarcum/binaryang/wasm` · `/wasm-runtime` | WASM helpers and a small runtime                                        |
| `@jrmarcum/binaryang/tools/wasm-opt`         | `wasm-opt` as a library                                                 |
| `@jrmarcum/binaryang/compat/binaryen`        | the upstream `npm:binaryen` API shape                                   |
| `@jrmarcum/binaryang/compat/wabt`            | the upstream `wabt.js` API shape                                        |
| `@jrmarcum/binaryang/interop`                | bridge to upstream `binaryen.js` (not available in browsers)            |

**Two IRs, each explicitly named.** They do different jobs — WABT's round-trip fidelity is exact,
Binaryen's IR is what the optimisation passes operate on — so both are kept, and neither is called
`./ir`. There is deliberately no `./ir` subpath: it would read as "the IR" while meaning one of
them.

## Runtime support

Runs on **Deno, Node.js, Bun and modern browsers** from a single source tree.

| runtime  | minimum     | note                                       |
| -------- | ----------- | ------------------------------------------ |
| Deno     | 2.x         |                                            |
| Node.js  | **22.18.0** | CLI needs `--experimental-transform-types` |
| Bun      | **1.4.0**   |                                            |
| browsers | modern      | library surface only, not the CLI          |

**Node.js: supported means not end-of-life.** Node 18 ended 2025-04-30 and Node 20 on 2026-04-30, so
neither is supported. Node 22 is in maintenance until 2027-04-30 and is supported. The floor is
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
| `@jrmarcum/binaryen-ts/ir`                              | `@jrmarcum/binaryang/ir/binaryen-ts`  |
| the WABT IR, via the `wabt-ts` package **root**         | `@jrmarcum/binaryang/ir/wabt-ts`      |
| `Result`, `ErrorList`, `formatErrors`, via the **root** | `@jrmarcum/binaryang/core/wabt-ts`    |

Everything else keeps its name: `./api`, `./binary`, `./encoder`, `./passes`, `./interop`, `./wasm`,
`./wasm-runtime`, `./tools/wasm-opt`, and the six WABT tool subpaths.

**If you imported from the `wabt-ts` package root, you need a named subpath now.** That package
shipped its IR and its core vocabulary through the root; binaryang's root is deliberately narrow,
because a root spanning both IRs would surface every colliding type name at one specifier.

```ts
// was
import { Result, wat2wasm } from 'jsr:@jrmarcum/wabt-ts';
// now
import { wat2wasm } from 'jsr:@jrmarcum/binaryang/wat2wasm';
import { Result } from 'jsr:@jrmarcum/binaryang/core/wabt-ts';
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
and runtime portability is layered (no Deno-specific globals in shipped source; `node:` builtins are
confined to the CLI layer, because they do not reach the browser).

## Licence

MIT, with Apache-2.0 available as an alternative. binaryang is a derivative of the Apache-2.0
WebAssembly/wabt and WebAssembly/binaryen projects and carries `LICENSE-APACHE`, `NOTICE.md` and
per-file attribution headers. See
[`cmem/licensing.md`](https://github.com/jrmarcum/binaryang/blob/main/cmem/licensing.md).
