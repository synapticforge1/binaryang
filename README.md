# wabt-ts

A native TypeScript port of [WebAssembly/wabt](https://github.com/WebAssembly/wabt) — the WebAssembly Binary Toolkit.

## Overview

wabt-ts provides the core wabt tooling as idiomatic TypeScript modules, distributed on [JSR](https://jsr.io). It requires no compiled binary and runs natively on Deno (primary) and Bun (secondary). It also adds `wasm2ts`, a new wasm-to-TypeScript ahead-of-time transpiler not present in the original wabt.

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

### As a library (Bun)

```sh
bunx jsr add @jrmarcum/wabt-ts
```

```typescript
import { wat2wasm, wasm2wat } from "@jrmarcum/wabt-ts";
```

### Run tools remotely via Deno

```sh
deno run -A jsr:@jrmarcum/wabt-ts/wat2wasm input.wat -o output.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm2wat input.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm-validate input.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm-objdump input.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm2ts input.wasm -o output.ts
```

## Development

**Requirements:** [Deno](https://deno.land/) v2+

```sh
# Type-check
deno task check

# Run tests
deno task test

# Lint / format
deno lint
deno fmt
```

Tests use `@std/testing/bdd` from JSR, which is compatible with both `deno test` and `bun test`.

No build step is required — JSR publishes TypeScript source directly.

## Roadmap

> This project is under active development. Phases 1–2 are complete.

| Phase | Scope | Status |
| --- | --- | --- |
| **1** | Core infrastructure — types, opcodes, LEB128, literals, errors | ✅ Complete |
| **2** | IR layer — AST nodes, expression visitor, name resolution | ✅ Complete |
| **3** | Binary round-trip — binary reader + writer | Pending |
| **4** | WAT text format — lexer, parser, WAT pretty-printer | Pending |
| **5** | Validator — type checker and full wasm validator | Pending |
| **6** | `wasm2ts` — new wasm-to-TypeScript AOT transpiler | Pending |
| **7** | Interpreter — evaluate need vs. Deno/V8 native wasm JIT | Dropped |
| **8** | CLI tool wrappers — Deno-compatible entrypoints, remote `deno run` support | Pending |

Phases 3 and 4 (`wat2wasm` / `wasm2wat`) are the highest priority as they are immediately required by [wasmtk](https://github.com/jrmarcum/wasmtk).

## Repository Layout

```text
wabt-ts/
├── upstream/          ← original wabt C++ source (reference only, not built)
├── src/
│   ├── core/          ← Phase 1: types, opcodes, LEB128, literals, errors
│   ├── ir/            ← Phase 2: AST nodes, expression visitor, name resolution
│   ├── reader/        ← Phase 3: binary reader
│   ├── writer/        ← Phase 3 + 4: binary writer, WAT writer
│   ├── parser/        ← Phase 4: lexer, token, WAT parser
│   ├── validator/     ← Phase 5: type checker, validator
│   ├── tools/         ← Phase 8: CLI entrypoints
│   ├── interp/        ← Phase 7: interpreter (deferred)
│   └── index.ts       ← public API surface
├── tests/
│   └── fixtures/      ← .wasm and .wat test vectors
├── deno.json
├── LICENSE            ← dual-license notice (MIT OR Apache-2.0)
├── LICENSE-MIT        ← MIT license text
├── LICENSE-APACHE     ← Apache License 2.0 text (upstream compliance)
├── NOTICE.md          ← attribution and license explanation
└── CLAUDE.md          ← Project context for AI-assisted development
```

## Origin & License

wabt-ts is dual-licensed under either:

- **[MIT License](LICENSE-MIT)** — copyright (c) 2026 Jon Marcum
- **[Apache License 2.0](LICENSE-APACHE)** — required for code derived from [WebAssembly/wabt](https://github.com/WebAssembly/wabt)

at your option. See [NOTICE.md](NOTICE.md) for full attribution details.

The original C++ source is preserved in [`upstream/`](upstream/) for reference. Each TypeScript
source file ported from a C++ original carries an attribution header identifying the originating
file and copyright.
