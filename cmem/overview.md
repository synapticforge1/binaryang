# Overview

`wabt-ts` is a **TypeScript port of [WebAssembly/wabt](https://github.com/WebAssembly/wabt)**, the
C++ WebAssembly binary toolkit. It is forked from upstream wabt and being ported to native
TypeScript for integration with the **wasmtk** project.

## Goal

wasmtk currently shells out to the compiled wabt binary for `wat2wasm` and `wasm2wat`. The
TypeScript port removes the binary dependency and unlocks new tools — most notably `wasm2ts`.

**Long-term goal:** progressively compile pure-compute wasmtk modules to WebAssembly, using
`wasm2ts` output as the TypeScript-side integration layer. End state: a wasmtk where all practical
modules run as wasm with fully-typed TypeScript interfaces.

wasmtk uses a **Deno backend**. All design decisions favor Deno compatibility and clean TypeScript
public APIs. See [runtime-tooling.md](runtime-tooling.md).

## Repo layout

```text
wabt-ts/
├── upstream/              ← original wabt C++ source (reference only, not built)
│   ├── src/ include/      ← C++ source + headers — open alongside the .ts when porting
│   └── test/ docs/ …
├── src/                   ← TypeScript source (this project)
│   ├── core/              ← Phase 1: types, opcodes, leb128, literals, errors, result
│   ├── ir/                ← Phase 2: Expr union, visitor, apply/resolve/generate-names
│   ├── reader/            ← Phase 3: binary reader → IR
│   ├── writer/            ← Phase 3+4: binary writer, stream, WAT pretty-printer
│   ├── parser/            ← Phase 4: lexer-source, wast-lexer, token, wast-parser
│   ├── validator/         ← Phase 5: type-checker, shared-validator, validator
│   ├── bridge/            ← Phase 7: binaryen-bridge, type-map
│   ├── api/               ← wabt-compat facade (jsr:.../compat)
│   ├── tools/             ← Phase 6 CLI tools (only place Deno.* I/O is allowed)
│   └── index.ts           ← public API surface for wasmtk
├── tests/                 ← core/ reader/ writer/ parser/ validator/ bridge/ tools/ api/ wasmtk/ fixtures/
├── binaryen-ts/           ← peer-project submodule (bridge target; read-only reference)
├── wasmtk/                ← consumer submodule (reference for wasm2ts reverse-compilation)
├── deno.json              ← Deno config, import map, tasks
├── package.json           ← Bun config (no tsconfig.json / vitest.config.ts — deleted)
└── cmem/                  ← this portable project-memory folder
```

The original wabt C++ source is preserved in `upstream/` as reference — open it alongside the
corresponding `.ts` file when porting, or diff against it when pulling upstream changes. The
per-phase TS↔C++ file mapping lives in [phases.md](phases.md).

## Sibling projects

- **binaryen-ts** — TypeScript port of binaryen; the optimize/encode back end. wabt-ts calls its
  constructor API directly through the Phase 7 bridge. See [bridge.md](bridge.md). The two will
  eventually merge into **binaryang**.
- **wasmtk** — the consumer; compiles TypeScript → WAT today, and is the reference for the planned
  `wasm2ts` reverse compiler (Phase 8).

## Production pipeline (binaryang cross-project)

```text
validate(wabt-ts) → strip(wabt-ts) → bridge → optimize(binaryen-ts) → encode(binaryen-ts)
```

binaryen-ts is the canonical encoder for *optimized* wasm; wabt-ts's encoder serves format tools
(`wasm2wat`/`wat2wasm` round-trips, strip, validate). wabt-ts's WAT parser is the front door for
all external `.wat` input.
