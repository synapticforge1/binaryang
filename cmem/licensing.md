# Licensing

wabt-ts is **MIT-primary with Apache-2.0 alternative**, matching sibling binaryen-ts. MIT is what's
declared on JSR/npm; Apache-2.0 ships alongside so downstream consumers whose policies require it
(and to satisfy upstream WebAssembly/wabt attribution) can use that instead.

## Why this arrangement

A TypeScript port is a Derivative Work of the Apache-2.0 upstream. Apache 2.0 §4 permits relicensing
derivatives under different terms but requires the Apache license text and all attribution notices
be retained and redistributed. Shipping `LICENSE-APACHE` + per-file attribution headers satisfies
that. JSR accepts only a single SPDX identifier, so we declare MIT (the more permissive) and provide
Apache-2.0 as the alternative.

## File layout

- `LICENSE` — full MIT text (Copyright (c) 2026 Jon Marcum) + a short trailing note pointing at
  `LICENSE-APACHE`. JSR's license detector matches this against the SPDX MIT template, so the MIT
  text must be the **first content** with no markdown decoration.
- `LICENSE-MIT` — same full MIT text, kept separate so the MIT-or-Apache choice is explicit.
- `LICENSE-APACHE` — full Apache 2.0 text (required for upstream compliance).
- `NOTICE.md` — attribution to WebAssembly/wabt + the dual-license explanation.
- `deno.json` / `package.json` — SPDX `"MIT"`.

## The no-compound-SPDX rule (lesson learned v1.0.2, 2026-05-25)

**Do NOT use the compound expression `"MIT OR Apache-2.0"`** — JSR rejects compound SPDX expressions
and the publish workflow fails with "license … was not recognized". Use the single identifier `MIT`.

## Apache 2.0 compliance checklist (all ✅)

`LICENSE-APACHE` in repo + JSR publish set · `LICENSE` references both license files ·
`NOTICE.md` attribution redistributed · per-file headers on all ported `.ts` files.

## Per-file headers

**Ported files** (derived from a C++ source in `upstream/`):
```typescript
// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/<filename>.cc / include/wabt/<filename>.h
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0
```

**Original files** (no C++ counterpart — e.g. `wasm2ts`, test utilities):
```typescript
// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
```
