# wabt-ts

[![JSR](https://jsr.io/badges/@jrmarcum/wabt-ts)](https://jsr.io/@jrmarcum/wabt-ts)
[![JSR Score](https://jsr.io/badges/@jrmarcum/wabt-ts/score)](https://jsr.io/@jrmarcum/wabt-ts)
[![CI](https://github.com/jrmarcum/wabt-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/jrmarcum/wabt-ts/actions/workflows/ci.yml)

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
| `wasm-strip` | Strip custom sections (e.g. `name`) from a WebAssembly binary |
| `wasm2ts` | Transpile a WebAssembly binary to typed TypeScript (new — pending) |

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
deno run -A jsr:@jrmarcum/wabt-ts/wasm-strip input.wasm -o stripped.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm2ts input.wasm -o output.ts
```

## API (Phases 1–6)

### High-level tool functions

```typescript
import { wat2wasm, wasm2wat, wasmValidate, wasmObjdump, wasmStrip } from "jsr:@jrmarcum/wabt-ts";

// WAT text → wasm binary
const { binary, errors, result } = wat2wasm(`(module)`, { filename: 'input.wat' });

// wasm binary → WAT text
const { text } = wasm2wat(binary);

// validate
const { errors: errs, result: ok } = wasmValidate(binary);

// section dump
const { text: dump } = wasmObjdump(binary, { details: true });

// strip all custom sections (e.g. name section)
const { binary: stripped } = wasmStrip(binary);
```

### Low-level pipeline (IR access)

```typescript
import {
  // WAT parser — text → IR
  parseWatModule,    // (src: string) → { module: Module; errors: WabtError[] }
  parseWastScript,   // (src: string) → { script: WastScript; errors: WabtError[] }
  LexerSource,       // wrap a string or Uint8Array for the parser

  // WAT writer — IR → text
  writeWatModule,    // (module: Module, opts?) → string

  // Binary reader/writer — binary ↔ IR
  readBinaryIr,      // (bytes: Uint8Array, errors, opts?) → Module
  writeBinaryIr,     // (module: Module) → Uint8Array

  // Validator
  validateModule,    // (module: Module, errors: ErrorList, opts?) → Result

  // IR constructors
  makeModule, varIndex, varName, constI32, constI64, constF32, constF64,
} from "jsr:@jrmarcum/wabt-ts";
```

### Parse WAT text to IR

```typescript
import { parseWatModule } from "jsr:@jrmarcum/wabt-ts";

const { module, errors } = parseWatModule(`
  (module
    (func $add (export "add") (param i32 i32) (result i32)
      local.get 0
      local.get 1
      i32.add)
  )
`);
```

### Binary round-trip

```typescript
import { readBinaryIr, writeBinaryIr, writeWatModule, makeErrorList } from "jsr:@jrmarcum/wabt-ts";

const bytes = await Deno.readFile("module.wasm");
const errors = makeErrorList();
const module = readBinaryIr(bytes, errors);

// IR → WAT text
const wat = writeWatModule(module);

// IR → binary (round-trip)
const roundTripped = writeBinaryIr(module);
```

### Validate a module

```typescript
import { readBinaryIr, validateModule, makeErrorList, hasErrors, formatErrors } from "jsr:@jrmarcum/wabt-ts";

const bytes = await Deno.readFile("module.wasm");
const errors = makeErrorList();
const module = readBinaryIr(bytes, errors);
validateModule(module, errors);

if (hasErrors(errors)) {
  console.error(formatErrors(errors));
} else {
  console.log("module is valid");
}
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

# Bundle of what CI runs (check + test)
deno task ci

# Dry-run the JSR publish manifest (no upload)
deno task publish:dry
```

Tests use `@std/testing/bdd` from JSR, which is compatible with both `deno test` and `bun test`.

No build step is required — JSR publishes TypeScript source directly.

## Publishing

The package is published to [JSR](https://jsr.io/@jrmarcum/wabt-ts) with
[OIDC provenance](https://docs.jsr.io/publishing-packages#publishing-from-github-actions)
via GitHub Actions. The flow is **tag-driven** — never run `deno publish` from a
workstation, since that would publish without provenance.

1. Bump `version` in [deno.json](deno.json).
2. Commit on `main`.
3. Trigger the release by pushing a matching tag:

   ```sh
   deno task publish
   ```

   This runs [scripts/publish.ts](scripts/publish.ts), which refuses if the working
   tree is dirty or the tag already exists, then creates and pushes the
   `v<version>` tag.

4. The [Publish workflow](.github/workflows/publish.yml) fires on the tag push,
   verifies that the tag matches `deno.json`, type-checks, tests, then runs
   `deno publish` inside the Actions runner. JSR detects the OIDC token and
   stamps the release with provenance automatically. The workflow then runs
   `gh release create --generate-notes` to create a matching
   [GitHub Release](https://github.com/jrmarcum/wabt-ts/releases).

## Roadmap

> This project is under active development. Phases 1–6 are complete.

| Phase | Scope | Status |
| --- | --- | --- |
| **1** | Core infrastructure — types, opcodes, LEB128, literals, errors | ✅ Complete |
| **2** | IR layer — AST nodes, expression visitor, name resolution | ✅ Complete |
| **3** | Binary round-trip — binary reader + writer | ✅ Complete |
| **4** | WAT text format — lexer, parser, WAT pretty-printer | ✅ Complete |
| **5** | Validator — type checker and full wasm validator | ✅ Complete |
| **6** | CLI tool wrappers — Deno-compatible entrypoints, remote `deno run` support | ✅ Complete |
| **6.1** | Pre-publish housekeeping — JSR/CI hardening (tag-driven publish, GitHub Release auto-creation, `ci.yml`); lint cleanup (71→0); module-level codec singletons + `ModuleContext`/`WatWriter` index-map caches | ✅ Complete |
| **6.2** | Release-flow alignment with binaryen-ts — `deno task bump`, atomic publish, `auto-tag.yml` safety net, license fix (JSR rejects compound SPDX); first successful JSR publish | ✅ Complete |
| **7** | binaryen bridge — post-order IR walk calling binaryen-ts constructor API | 🟡 In progress (Tiers A+B+C partial; EH/GC deferred) |
| **8** | `wasm2ts` — new wasm-to-TypeScript AOT transpiler | Pending |

Phase 7 (binaryen bridge) is now unblocked — binaryen-ts is at v1.0.9 with the full instruction-level constructor API stable. Phase 8 (`wasm2ts`) is deferred pending wasmtk QA/QC.

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
│   ├── tools/         ← Phase 6: CLI entrypoints
│   └── index.ts       ← public API surface
├── scripts/
│   └── publish.ts     ← developer-side task that pushes a release tag
├── tests/
│   └── fixtures/      ← .wasm and .wat test vectors
├── .github/workflows/
│   ├── ci.yml         ← fmt-check / lint / type-check / test / publish dry-run
│   └── publish.yml    ← JSR publish + GitHub Release on `v*` tag push
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
