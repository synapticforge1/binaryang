# The project — binding rules enforced in CI

Summary: the upstream-names rule, the layered runtime-portability rule and the no-external-dependencies statement, with their checks. Last verified 2026-11-20.
Main file: [project.md](project.md). Moved from it on 2026-11-20 (H38 step 5), unchanged.

## Binding rules — enforced in CI

### Upstream names are reserved

**A bare upstream project name (`binaryen`, `wabt`) may appear in a path ONLY where upstream
compatibility is the subject — `compat/` and `interop/`. It must never name a directory or module
holding binaryang's own implementation.** Agreed 2026-08-25, binding from the first commit, carried
in the README. The qualified form (`src/binaryen-ts/`) is permitted: the `-ts` suffix is what
distinguishes our port from the project it ports. Why it is a must: breaking it puts the same word
on our code and theirs, and invites the reader to assume binaryang vendors the upstream projects
rather than implementing them — a claim about provenance that must not be made by accident.

**The check is `scripts/check-naming.ts`** (`deno task naming`; a shell script until 2026-09-29,
when scripting became TypeScript-only — it now also exits 1 on a violation). ⚠️ Its original one-liner silently stopped working at
the merge: it ended with `grep -viE '(binaryen|wabt)-ts'`, which matches anywhere in the path, so
once `src/binaryen-ts/` existed it discarded every file in both trees and returned empty on a tree
that still held the known violation. The replacement strips the permitted components and tests what
remains, verified to find the violation (`binaryen-bridge.ts`, renamed `bridge.ts` at A3) before the
rename and nothing after. **A rule whose check cannot fail is decorative.**

**An import ALIAS must not shadow a resolvable package** (adopted from wasmtk, 2026-08-31). The
naming check looks at paths, never an import map: wasmtk aliased `"binaryen"` to their compat facade
while the same specifier could resolve real `npm:binaryen` — one alias, two packages by
configuration. It does not bite binaryang (every alias is `@std/*`), and it is recorded because this
project's natural aliases are exactly the two reserved names. **The hazard is not the name, it is
the ambiguity.**

### Runtime portability, layered

Owner direction 2026-08-26: avoid Deno-specific functions, for Deno, Node, Bun **and the web**. Four
targets make the rule layered, and the layers are the part worth keeping:

| layer                                               | may use                | may not use        | why                                                       |
| --------------------------------------------------- | ---------------------- | ------------------ | --------------------------------------------------------- |
| **library** — the exported surface                  | web-standard APIs only | `Deno.*`, `node:*` | must run in a browser                                     |
| **CLI** — `tools/`, `main.ts` (`interop/` until 1.7.0) | `node:*` builtins      | `Deno.*`           | not browser code; `node:` works on Deno, Node **and** Bun |

⚠️ **`node:` looks like the portable answer and is not, for library code** — porting `Deno.readFile`
to `node:fs/promises` was right for the six CLI tools because tools are not browser code. **The
check is `scripts/check-portability.ts`** (`deno task portability`), and both of its checks must be
blind to JSDoc (the `Deno.*` one skips lines starting `*`; the `node:` one matches only a line that
starts `import` / `const` / `let`): a first pass
flagged `const node: BlockExpr` and a doc comment showing consumers a `node:` import — neither a
violation. A portability check that cries wolf gets disabled.

### No external dependencies — the goal, and what it excludes

🗓️ **Owner, 2026-09-28:** binaryang has **no external dependencies** — and "external" EXCLUDES the
standard Node and Deno packages (`node:*` builtins, `@std/*`), which are kept for compatibility.
Measured the same day: shipped code (`src/`, `main.ts`) imports only its own files and `node:*`
builtins (within the layers above); `@std/*` is used by tests only; nothing shipped spawns a tool
on the default path. `wast2json` and `wasm-tools` are TEST tooling only ([testing.md](testing.md)).

🗓️ **Owner, 2026-09-28:** external tools are FINE for testing and comparison; the claim is that
the END PRODUCT does not use them — and later the same day: **the CLI and the published code must
not reference them at all.** So the one exception, the opt-in hybrid bridge (`./interop`'s
`BinaryenInterop`, `optimize(flags, hybridMode)`, `wasm-opt --hybrid`), LEFT the product for the
committed, isolated [`comparison/`](../comparison/README.md) suite (`37c55a3a0`; owner chose
committed over gitignored). It was BREAKING and shipped in **1.7.0** (2026-09-29). `-S` is native
now. The statement, as it may be made publicly (it is in the README):

> binaryang's reader, validator, writers, text tools and optimizer are entirely its own
> TypeScript; it has no external dependencies beyond the standard Node and Deno packages, and calls
> no external tool. Upstream tools (`wast2json`, `wasm-tools`, upstream binaryen) are used only by
> the repository's tests and its separate comparison suite — never by the published package.

What remains, and is fine: ~25 comment lines citing wasm-tools and ~287 mentioning "upstream" in
`src/` (owner: keep — they explain behaviour; the Apache-2.0 "Ported from" headers must stay); the
`compat/*` subpaths reproduce upstream's API SHAPES without loading upstream; the `--hybrid`
refusal message and the CLI help's description of `compat/binaryen`.

**How to apply:** before changing shipped code, keep it true — re-measure with the greps of
2026-09-28: `Deno.(run|Command)` / `child_process` / `spawn(` and non-relative imports in `src/`
and `main.ts` (only `node:*` builtins may appear), and nothing outside `comparison/` imports from
it. A new comparison against upstream goes in `comparison/`, named `*.compare.ts`.

