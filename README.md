# wabt-ts

[![JSR](https://jsr.io/badges/@jrmarcum/wabt-ts)](https://jsr.io/@jrmarcum/wabt-ts)
[![JSR Score](https://jsr.io/badges/@jrmarcum/wabt-ts/score)](https://jsr.io/@jrmarcum/wabt-ts)
[![CI](https://github.com/jrmarcum/wabt-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/jrmarcum/wabt-ts/actions/workflows/ci.yml)

A native TypeScript port of [WebAssembly/wabt](https://github.com/WebAssembly/wabt) — the
WebAssembly Binary Toolkit.

## Overview

wabt-ts provides the core wabt tooling as idiomatic TypeScript modules, distributed on
[JSR](https://jsr.io). It requires no compiled binary and runs natively on Deno (primary) and Bun
(secondary). It also adds `wasm2ts`, a new wasm-to-TypeScript ahead-of-time transpiler not present
in the original wabt.

### Tools

| Tool            | Description                                                        |
| --------------- | ------------------------------------------------------------------ |
| `wat2wasm`      | Translate WebAssembly text format (.wat) to binary (.wasm)         |
| `wasm2wat`      | Translate WebAssembly binary (.wasm) to text format (.wat)         |
| `wasm-validate` | Validate a WebAssembly binary                                      |
| `wasm-objdump`  | Inspect sections and structure of a WebAssembly binary             |
| `wasm-strip`    | Strip custom sections (e.g. `name`) from a WebAssembly binary      |
| `wasm2ts`       | Transpile a WebAssembly binary to typed TypeScript (new — pending) |

## Spec conformance

Measured against the official [WebAssembly spec testsuite](https://github.com/WebAssembly/testsuite)
(257 files, 2120 modules) as of 2026-08-24:

|                                                      |                     |
| ---------------------------------------------------- | ------------------- |
| Files the WAT parser accepts                         | **257 / 257**       |
| Modules that encode to wasm V8 accepts               | **2120 / 2120**     |
| Modules V8 accepts that `wasmValidate` also accepts  | **2120 / 2120**     |
| `binary → wasm2wat → wat2wasm` byte-identical        | **2120 / 2120**     |
| Spec `assert_return` assertions the output satisfies | **23,077 / 23,077** |
| Modules the spec calls invalid that we reject        | 2664 / 2737         |

The 73 remaining `assert_invalid` modules are ones **V8 and Wasmtime both accept** — those spec
tests predate proposals that legalised what they assert against, so matching them would mean
diverging from the reference runtime.

Cross-engine questions are settled against **V8, Wasmtime and Wasmer**, with Wasmtime as the
authority (`deno task engine-check <dir-of-wasm>`).

Round-trip fidelity is also **270 / 270** byte-identical over a 272-module corpus of real
WASI-targeting output from the [wasmtk](https://github.com/jrmarcum/wasmtk) compiler.

## Runtime compatibility

| Runtime        | Library API | CLI entry points        |
| -------------- | ----------- | ----------------------- |
| **Deno**       | ✅          | ✅                      |
| **Bun**        | ✅          | — (use the library API) |
| **Node** (18+) | ✅          | —                       |
| **Browser**    | ✅          | —                       |

The library functions (`wat2wasm`, `wasm2wat`, `wasmValidate`, `wasmObjdump`, `wasmStrip`,
`parseWatModule`, `readBinaryIr`, `writeBinaryIr`, `writeWatModule`, `validateModule`, the IR types,
the `/compat` facade, etc.) use only standard Web platform APIs — `TextEncoder` / `TextDecoder`,
`DataView`, typed arrays, `Map` / `Set`, `WebAssembly` — and work unmodified in every modern
runtime. The CLI shims (`if (import.meta.main)` blocks inside each `src/tools/*.ts` entry point) use
`Deno.args` / `Deno.readFile` etc. and are exercised by
`deno run -A jsr:@jrmarcum/wabt-ts/wat2wasm input.wat …`; other runtimes import the library function
directly.

## Usage

### As a library (Deno)

```typescript
import { wasm2wat, wat2wasm } from 'jsr:@jrmarcum/wabt-ts';
```

### As a library (Bun)

```sh
bunx jsr add @jrmarcum/wabt-ts
```

```typescript
import { wasm2wat, wat2wasm } from '@jrmarcum/wabt-ts';
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

### Drop-in `npm:wabt` replacement via `/compat`

If you have code written against [`npm:wabt`](https://www.npmjs.com/package/wabt) (libwabt.js),
`wabt-ts/compat` provides the same async-factory API. Add an import-map entry:

```json
{
  "imports": {
    "wabt": "jsr:@jrmarcum/wabt-ts@^1.2.1/compat"
  }
}
```

…and your existing `import wabt from "wabt"` code compiles unchanged:

```typescript
import wabt from 'wabt';

const w = await wabt();
const m = w.parseWat('input.wat', source, { enable_all: true, exceptions: true });
const { buffer } = m.toBinary({});
m.destroy();

const m2 = w.readWasm(buffer, { readDebugNames: true });
const wat = m2.toText({ foldExprs: false, inlineExport: false });
m2.destroy();
```

Error semantics match upstream: `parseWat` and `readWasm` throw on failure with the formatted error
list as the message. `destroy()` is idempotent. See [src/api/wabt-compat.ts](src/api/wabt-compat.ts)
for the full surface.

## API (Phases 1–6)

### High-level tool functions

```typescript
import { wasm2wat, wasmObjdump, wasmStrip, wasmValidate, wat2wasm } from 'jsr:@jrmarcum/wabt-ts';

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
  constF32,
  constF64,
  constI32,
  constI64,
  LexerSource, // wrap a string or Uint8Array for the parser
  // IR constructors
  makeModule,
  parseWastScript, // (src: string) → { script: WastScript; errors: WabtError[] }
  // WAT parser — text → IR
  parseWatModule, // (src: string) → { module: Module; errors: WabtError[] }
  // Binary reader/writer — binary ↔ IR
  readBinaryIr, // (bytes: Uint8Array, errors, opts?) → Module
  // Validator
  validateModule, // (module: Module, errors: ErrorList, opts?) → Result
  varIndex,
  varName,
  writeBinaryIr, // (module: Module) → Uint8Array
  // WAT writer — IR → text
  writeWatModule, // (module: Module, opts?) → string
} from 'jsr:@jrmarcum/wabt-ts';
```

### Parse WAT text to IR

```typescript
import { parseWatModule } from 'jsr:@jrmarcum/wabt-ts';

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
import { makeErrorList, readBinaryIr, writeBinaryIr, writeWatModule } from 'jsr:@jrmarcum/wabt-ts';

const bytes = await Deno.readFile('module.wasm');
const errors = makeErrorList();
const module = readBinaryIr(bytes, errors);

// IR → WAT text
const wat = writeWatModule(module);

// IR → binary (round-trip)
const roundTripped = writeBinaryIr(module);
```

### Validate a module

```typescript
import {
  formatErrors,
  hasErrors,
  makeErrorList,
  readBinaryIr,
  validateModule,
} from 'jsr:@jrmarcum/wabt-ts';

const bytes = await Deno.readFile('module.wasm');
const errors = makeErrorList();
const module = readBinaryIr(bytes, errors);
validateModule(module, errors);

if (hasErrors(errors)) {
  console.error(formatErrors(errors));
} else {
  console.log('module is valid');
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
[OIDC provenance](https://docs.jsr.io/publishing-packages#publishing-from-github-actions) via GitHub
Actions. The flow is **tag-driven** — never run `deno publish` from a workstation, since that would
publish without provenance.

1. Bump `version` in [deno.json](deno.json).
2. Commit on `main`.
3. Trigger the release by pushing a matching tag:

   ```sh
   deno task publish
   ```

   This runs [scripts/publish.ts](scripts/publish.ts), which refuses if the working tree is dirty or
   the tag already exists, then creates and pushes the `v<version>` tag.

4. The [Publish workflow](.github/workflows/publish.yml) fires on the tag push, verifies that the
   tag matches `deno.json`, type-checks, tests, then runs `deno publish` inside the Actions runner.
   JSR detects the OIDC token and stamps the release with provenance automatically. The workflow
   then runs `gh release create --generate-notes` to create a matching
   [GitHub Release](https://github.com/jrmarcum/wabt-ts/releases).

## Roadmap

> This project is under active development. Phases 1–6 are complete and Phase 7 (binaryen bridge)
> covers ~45 expression kinds — every common compute / control-flow / memory / SIMD /
> reference-types / exception-handling case round-trips through the bridge to V8-validated wasm.

| Phase   | Scope                                                                                                                                                                                                       | Status                                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **1**   | Core infrastructure — types, opcodes, LEB128, literals, errors                                                                                                                                              | ✅ Complete                                                                                                                             |
| **2**   | IR layer — AST nodes, expression visitor, name resolution                                                                                                                                                   | ✅ Complete                                                                                                                             |
| **3**   | Binary round-trip — binary reader + writer                                                                                                                                                                  | ✅ Complete                                                                                                                             |
| **4**   | WAT text format — lexer, parser, WAT pretty-printer                                                                                                                                                         | ✅ Complete                                                                                                                             |
| **5**   | Validator — type checker and full wasm validator                                                                                                                                                            | ✅ Complete                                                                                                                             |
| **6**   | CLI tool wrappers — Deno-compatible entrypoints, remote `deno run` support                                                                                                                                  | ✅ Complete                                                                                                                             |
| **6.1** | Pre-publish housekeeping — JSR/CI hardening (tag-driven publish, GitHub Release auto-creation, `ci.yml`); lint cleanup (71→0); module-level codec singletons + `ModuleContext`/`WatWriter` index-map caches | ✅ Complete                                                                                                                             |
| **6.2** | Release-flow alignment with binaryen-ts — `deno task bump`, atomic publish, `auto-tag.yml` safety net, license fix (JSR rejects compound SPDX); first successful JSR publish                                | ✅ Complete                                                                                                                             |
| **7**   | binaryen bridge — post-order IR walk calling binaryen-ts constructor API                                                                                                                                    | 🟡 In progress (Tiers A+B+C+D + all 4 GC tiers complete; remaining gaps are upstream binaryen-ts or the deferred typed-ref IR refactor) |
| **8**   | `wasm2ts` — new wasm-to-TypeScript AOT transpiler                                                                                                                                                           | Pending                                                                                                                                 |

Phase 7 (binaryen bridge) covers MVP + Tier A (control flow, locals, globals) + Tier B (calls,
select, memory ops) + Tier C (reference types, SIMD lane ops + arithmetic + memory ops, exception
handling: tag defs + throw/throw_ref/try_table cases) + Tier D (memory + table exports, active +
passive data segments) + GC Tier 1 (`ref.eq` / `ref.i31` / `i31.get_s` / `i31.get_u` + 8 abstract
heap types: `anyref` / `eqref` / `i31ref` / `structref` / `arrayref` / `nullref` / `nullfuncref` /
`nullexternref`) + GC Tier 2 (`struct.new` / `struct.new_default` / `struct.get` / `struct.get_s` /
`struct.get_u` / `struct.set` plus `(type $name (struct (field ...) ...))` WAT syntax + packed `i8`
/ `i16` field types) + GC Tier 3 (`array.new` / `new_default` / `new_fixed` / `new_data` /
`new_elem` / `get` / `get_s` / `get_u` / `set` / `len`) + GC Tier 4 (`ref.test` / `ref.cast` with
`(ref [null] H)` heap-type immediates, abstract keywords + user-defined type indices) — full
module-level surface except element segments + start function. Bridge-side deferrals: typed-ref IR
refactor (`(ref $T)` parses but coarsens to `structref` in `Type[]` slots, so V8 round-trip is
blocked when typed-ref params appear); `br_on_cast` / `br_on_cast_fail` (opcodes wired, no IR yet);
upstream binaryen-ts gaps — `ref.as_non_null` (no `makeRefAsNonNull` factory), plain `v128.load`
(encoder's `loadOpcode` has no V128 branch), tag imports + tag exports (no `addTagImport`;
`WasmExport.kind` lacks `"tag"`), element segments (no `addElement`), start function (no
`setStart`), multi-value `return` (no `makeTupleMake`). binaryen-ts is at v1.0.9. Phase 8
(`wasm2ts`) is deferred pending wasmtk QA/QC.

**wasmtk-driven hardening (v1.0.7 → v1.3.1).** The wasmtk integration test suite has surfaced a
stream of latent wabt-ts bugs that previous tests didn't exercise. Pattern: a new module shape
parses wrong, gets fixed at root cause in `src/`, regression test added under `tests/`. Recent
landings include f64/f32 constant integer literals (were being encoded as raw bit patterns producing
subnormals; v1.1.0), multi-value `return` (was dropping all but the first operand; v1.1.1),
`memarg.align` defaulting to byte 0 instead of opcode-natural (broke binaryen's optimizer and caused
runtime corruption; v1.1.1), ~95-entry SIMD opcode-name table drift fixed by regenerating from
upstream wabt `opcode.def` (v1.1.1), SIMD `replace_lane` second-operand + try_table `(catch ...)` +
bare-offset elem segments + legacy `(try (do ...))` syntax (v1.1.3), nested `(call ...)`
operand-order fix in folded form (v1.1.4), Phase 7 Tier D bridge expansion (memory + table exports,
active + passive data segments) plus Bug D — empty-folded ops like `(local.set $x)` / `(drop)` /
`(global.set $g)` / `(return)` / `(i32.store)` now consume operands from the surrounding stack
instead of getting `Nop` placeholders, unblocking wasic's multi-value receive idiom (v1.1.6), Bug F
— `br_if` with a folded f64 condition wrapping `global.get $name` no longer mis-resolves non-first
globals to index 0 (the Bug D stack-pad is now clamped to what's actually available, so optional
operands like `br_if`'s `value` slot stay untouched; v1.1.7), parser support for
`v128.const i8x16/i16x8/i32x4/i64x2/f32x4/f64x2 …` literal forms plus Phase 7 GC Tier 1 — `ref.eq` /
`ref.i31` / `i31.get_s` / `i31.get_u` + the 8 abstract heap types (`anyref`, `eqref`, `i31ref`,
`structref`, `arrayref`, `nullref`, `nullfuncref`, `nullexternref`) parse, encode, and round-trip
through the bridge (v1.1.9), Bug G — `call_indirect (type $name)` no longer mis-resolves named types
to index 0 (`resolveNames` was resolving the `table` var but skipping `typeVar`; critical for
wasic's higher-order array methods which compile to named-type `call_indirect` everywhere; v1.2.0),
the `/compat` subpath export mirroring `npm:wabt`'s async-factory API (v1.2.1), and GC Tiers 2–4 —
struct types + 6 struct instructions (v1.2.3), array types + 9 array instructions (v1.2.4),
`ref.test` / `ref.cast` with heap-type immediates (v1.2.5), and legacy exception handling —
`(try (do …) (catch $tag …) (catch_all …)? (delegate …)?)` now parses to a real `TryExpr` with full
try/catch/catch_all/delegate/end dispatch instead of being coerced to a `block` (the coercion
dropped the dispatch edges, so the catch handler's leading `local.set`s ran on an empty operand
stack and V8 rejected the binary); `rethrow` depth + catch-tag name resolution and a latent
`wasm2wat` catch-body double-emit were fixed alongside (v1.2.9 — unblocks wasic's TypeScript
try/catch/throw output), and a statement-ordering fix — a folded value-producing statement (most
importantly a void `call`, which the parser can't distinguish from a value-returning call without
the callee's signature) was pushed onto the operand stack and only flushed to the statement list at
the block's end, landing AFTER any statements that followed it in source order; so
`(call $f …) (return X)` sank the call past the `return` into dead code and its side effect never
ran. A new `pushStmt` helper drains the operand stack before committing each statement, preserving
source order (a general correctness fix for any `sideEffectingCall(); return X;` shape; v1.3.0 —
unblocks the wasmtk shared-heap stdlib track; same release removed 5 dead private methods surfaced
by a reference-count sweep), and a hex-float literal fix — `parseF32/F64LiteralBits` parsed
`LiteralType.Hexfloat` tokens with JavaScript's `parseFloat()`, which cannot read WAT hex-float
notation (`0x1.921fb54442d18p+2`) and returns `0`; so every hex-float constant (all of wasmtk's
merged `mathlib` polynomial coefficients, π, e, ln2) was encoded as `0`, making the merged `Math.*`
functions return garbage. The fix adds an explicit `parseHexFloatValue` reconstructor and routes
both the f32 and f64 hex-float cases through it (v1.3.1 — unblocks the wasmtk Phase 38 mathlib
suite). The full 272-file wasmtk WAT corpus is wired into the test suite at
[tests/wasmtk/](tests/wasmtk/), so future regressions land as named-file failures in CI. Each fix is
accompanied by a regression test under [tests/](tests/) and a commit message on the
[GitHub history](https://github.com/jrmarcum/wabt-ts/commits/main) that explains the root cause.

**Integration milestone (2026-05-28):** wasmtk's Phase 1 test suite now passes 38/38 against
`@jrmarcum/wabt-ts@1.1.8`. Subsequent releases (v1.1.9 → v1.3.1) continue the hardening loop and add
`/compat`, the four GC tiers, the JSR doc-quality + runtime-compatibility polish, the CI fmt-check +
lint-clean fix, the legacy exception-handling encoder fix (v1.2.9) that unblocks the wasmtk Phase 15
exception suite, the statement-ordering fix (v1.3.0) that stops a void `call` before a `(return …)`
from sinking into dead code, and the hex-float literal fix (v1.3.1) that stops hex-float constants
from being encoded as `0` — unblocking the wasmtk shared-heap stdlib track and the Phase 38 mathlib
suite.

**JSR doc-quality milestone (v1.2.7+):** Every package entrypoint carries an `@module` JSDoc header
(purpose + usage example + pipeline notes), and every exported symbol surfaced through
`src/index.ts` has JSDoc — 265 / 265 symbols documented. JSR's package score reads 100% on both the
"module docs in all entrypoints" and "docs for most symbols" axes.

**Migration milestone — `/compat` (v1.2.1):** wabt-ts exposes `jsr:@jrmarcum/wabt-ts/compat`, a thin
facade over the wabt-ts pipeline that mirrors `npm:wabt`'s (libwabt.js) async-factory API. Once
consumers add an import-map entry — `"wabt": "jsr:@jrmarcum/wabt-ts@^1.2.1/compat"` — existing
`import wabt from "wabt"` source compiles unchanged. See the Usage section below.

**GC proposal completion (v1.1.9 → v1.2.5):** All four GC tiers ship as `~25` new instructions plus
struct/array heap-type definitions, packed `i8` / `i16` field types, and `(ref [null] H)` heap-type
immediates. Caveat: wabt-ts's flat `Type[]` representation for params/results/locals can't yet carry
heap-type indices for typed refs, so `(ref $T)` / `(ref null $T)` syntactic forms parse but coarsen
to `structref` in the binary output. Tier 2–4 tests therefore verify binary encoding (type-section
bytes, instruction opcodes, immediate resolution) rather than V8 round-trip. The proper fix —
`FuncSignature.params: ValueType[]` carrying concrete heap-type metadata — is the next significant
Phase 7 piece.

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
└── NOTICE.md          ← attribution and license explanation
```

## Origin & License

wabt-ts is dual-licensed under either:

- **[MIT License](LICENSE-MIT)** — copyright (c) 2026 Jon Marcum
- **[Apache License 2.0](LICENSE-APACHE)** — required for code derived from
  [WebAssembly/wabt](https://github.com/WebAssembly/wabt)

at your option. See [NOTICE.md](NOTICE.md) for full attribution details.

The original C++ source is preserved in [`upstream/`](upstream/) for reference. Each TypeScript
source file ported from a C++ original carries an attribution header identifying the originating
file and copyright.
