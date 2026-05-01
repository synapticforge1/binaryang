# wabt-ts

A native TypeScript port of [WebAssembly/wabt](https://github.com/WebAssembly/wabt) — the WebAssembly Binary Toolkit.

## Overview

wabt-ts provides the core wabt tooling as idiomatic TypeScript modules for use in Deno and Node environments, with no binary dependencies. It also adds `wasm2ts`, a new wasm-to-TypeScript ahead-of-time transpiler not present in the original wabt.

### Tools

| Tool | Description |
| --- | --- |
| `wat2wasm` | Translate WebAssembly text format (.wat) to binary (.wasm) |
| `wasm2wat` | Translate WebAssembly binary (.wasm) to text format (.wat) |
| `wasm-validate` | Validate a WebAssembly binary |
| `wasm-objdump` | Inspect sections and structure of a WebAssembly binary |
| `wasm2ts` | Transpile a WebAssembly binary to typed TypeScript (new) |

## Usage

### As a library (Deno)

```typescript
import { wat2wasm, wasm2wat } from "jsr:@jrmarcum/wabt-ts";
```

### As a library (Bun / Node)

```sh
bunx jsr add @jrmarcum/wabt-ts
```

### Run tools remotely

```sh
deno run -A jsr:@jrmarcum/wabt-ts/wat2wasm input.wat -o output.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm2wat input.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm-validate input.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm2ts input.wasm -o output.ts
```

## Roadmap

> This project is under active development. All phases are pending.

| Phase | Scope | Status |
| --- | --- | --- |
| **1** | Core infrastructure — types, opcodes, LEB128, literals, errors | ⬜ Pending |
| **2** | IR layer — AST nodes, expression visitor, name resolution | ⬜ Pending |
| **3** | Binary round-trip — binary reader + writer | ⬜ Pending |
| **4** | WAT text format — lexer, parser, WAT pretty-printer | ⬜ Pending |
| **5** | Validator — type checker and full wasm validator | ⬜ Pending |
| **6** | `wasm2ts` — new wasm-to-TypeScript AOT transpiler | ⬜ Pending |
| **7** | Interpreter — evaluate need vs. Deno/V8 native wasm JIT | ⬜ Deferred |
| **8** | CLI tool wrappers — Deno-compatible entrypoints, remote `deno run` support | ⬜ Pending |
| **9** | wasmtk module compilation — progressively compile wasmtk modules to wasm | ⬜ Pending |

Phases 3 and 4 (`wat2wasm` / `wasm2wat`) are the highest priority as they are immediately required by [wasmtk](https://github.com/jrmarcum/wasmtk).

## Origin & License

This is a derivative work of [WebAssembly/wabt](https://github.com/WebAssembly/wabt), licensed under the [Apache License 2.0](LICENSE).

The original C++ source is preserved in [`upstream/`](upstream/) for reference and attribution. Each TypeScript source file that corresponds to a C++ original carries an attribution header identifying the source file.

Copyright 2016 WebAssembly Community Group participants (original wabt)
