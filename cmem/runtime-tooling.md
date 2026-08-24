# Runtime & TypeScript rules

## Runtimes

**Primary: Deno.** Secondary compatibility target: **Bun.** Both run TypeScript natively — no
compilation step for development. JSR publishes TypeScript source directly; there is **no
build/emit step**.

| Concern | Deno | Bun |
| --- | --- | --- |
| Config file | `deno.json` | `package.json` |
| Type check | `deno task check` | `deno task check` (use Deno for both) |
| Test runner | `deno task test` (`deno test`) | `bun test` |
| Lint / format | `deno lint` / `deno fmt` | — |
| Consume | `deno publish` → JSR | `bunx jsr add @jrmarcum/wabt-ts` |

No `tsconfig.json`, `tsconfig.build.json`, or `vitest.config.ts` — these were deleted.

**Test compatibility:** tests use `@std/testing/bdd` from JSR (`jsr:@std/testing`), providing
`describe`/`it`/`expect` compatible with both `deno test` and `bun test`. Import via the
`@std/testing` entry in `deno.json`'s import map.

**Runtime compatibility split:** the **library** code (`core/`, `ir/`, `reader/`, `writer/`,
`parser/`, `validator/`, `bridge/`, `api/`) uses only Web platform APIs — `TextEncoder`,
`TextDecoder`, `DataView`, typed arrays, `Map`, `Set`, `WebAssembly`. **Zero `Deno.*` references.**
Only the `if (import.meta.main)` CLI blocks in `src/tools/*.ts` use `Deno.args` / `Deno.readFile` /
`Deno.exit`. Mark Deno/Bun/Node/Browser as compatible on the JSR settings page (web-UI only, not in
`deno.json`).

## What was actually MEASURED, 2026-08-24

The table above is the intent; this is the run. Prompted by "do we have issues
with Bun?", so it is evidence rather than a claim.

- **Bun 1.3.14 (JavaScriptCore): the library works.** A round-trip smoke test —
  `wat2wasm` → `wasmValidate` → `wasm2wat` → `wat2wasm`, plus instantiating and
  calling an i64 export — produces **byte-identical output to Deno**.
- **`bun test tests/` does NOT do what it looks like.** Bun treats the argument
  as a path FILTER, not a directory, so it walks the sibling `binaryen-ts/` and
  `wasmtk/` checkouts inside the repo and dies on their imports. `@std/assert`
  also needs the import map. Neither is a defect in this code; both make a naive
  "run the suite on Bun" read as a catastrophic failure.
- **Node cannot run the sources directly.** `node --experimental-strip-types`
  rejects `enum`, and `src/core/types.ts` is built on them
  (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). The supported Node path is the
  published JSR package, which is transpiled — **which is why the slow-types
  check in `deno publish --dry-run` is load-bearing for the Node claim**, not a
  formality.
- **Bun/JSC rejects `memory64` and `table64`** ("Memory64 is not enabled") where
  V8 accepts them. Relevant to anyone validating our output under Bun.

## KNOWN LIMITATION — `Features` mostly does not gate (2026-08-24)

`wasmValidate(binary, { features })` accepts a full `Features` bag, and only
**`multiMemory`** and **`customPageSizes`** are actually enforced. Measured
proposal by proposal, `defaultFeatures()` still accepts SIMD, GC, memory64, tail
calls, exceptions, reference types, bulk memory, sign extension, saturating
float→int, mutable globals, multi-value, relaxed SIMD, extended const and
function references.

**So a caller cannot currently use `features` to refuse a proposal.** Pass
`allFeatures()` and treat the result as "is this valid wasm at all"; do not rely
on `defaultFeatures()` to reject anything. Tracked as T13.10, deferred past
1.4.0 because fourteen new gates can only add rejections and that release exists
to unblock a downstream consumer.

## The four load-bearing TS compiler rules

### `verbatimModuleSyntax: true`
- Use `import type { Foo }` for type-only imports (not `import { Foo }`).
- Import paths must include `.ts` extensions: `import { x } from './core/types.ts'`.

### `noUncheckedIndexedAccess: true`
`arr[i]` returns `T | undefined`, not `T`.
- Use `for...of` with `.entries()` for index-aware loops: `for (const [i, item] of arr.entries())`.
- When iterating `module.imports` by kind (e.g. only Func imports), maintain a running index
  variable rather than filtering-then-indexing — filtering makes a new array whose indices don't
  correspond to the original index space.
- Never `arr[i]` in a loop without a null/undefined guard — the compiler rejects it.

### `exactOptionalPropertyTypes: true`
Optional properties (`field?: T`) cannot be explicitly assigned `undefined` in object literals —
omit the property entirely. (`makeModule()` omits `start` rather than `start: undefined`.) Pattern
for forwarding optionals:
```typescript
const readOpts: ReadBinaryOptions = {};
if (opts.filename !== undefined) readOpts.filename = opts.filename;
```

### `deno.json` `lib` must include `"deno.window"`
`"deno.ns"` only exposes the `Deno.*` namespace; web globals like `TextEncoder`/`TextDecoder`
require `"deno.window"`. Correct: `"lib": ["ES2022", "deno.ns", "deno.window"]`. Omitting it
produces TS2304 on `TextEncoder`/`TextDecoder` in reader, writer, and test files.

## `Result` is a plain enum, not a generic wrapper

`Result.Ok = 0`, `Result.Error = 1`. There is **no** `Result<T>`, no `ok()` factory, no `.value`
field. Delegate callbacks return `Result` directly; chain with `combineResults(a, b)` (the export
is `combineResults`, **not** `combine`).

**Error-propagation pattern for helpers that don't return `Result`:** when a method adds to an
`ErrorList` but returns a plain value (e.g. `resolveVar` returns `Var`), the `combineResults()`
chain won't see the error. Use a `hadError` boolean flag on the context object, set it inside the
helper when an error is added, and fold it into the final return:
`combineResults(result, this.hadError ? Result.Error : Result.Ok)`.

## Where Deno I/O is allowed

**Do not use `Deno.*` APIs in** `src/core/`, `src/ir/`, `src/reader/`, `src/writer/`,
`src/parser/`, `src/validator/` (or `bridge/`, `api/`). Keep them runtime-agnostic. Deno-specific
I/O belongs only in `src/tools/`.
