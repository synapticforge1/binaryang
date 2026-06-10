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
