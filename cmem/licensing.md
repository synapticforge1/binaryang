# Licensing

Merged topic file (A16). Supersedes `binaryen-ts/licensing.md` and `wabt-ts/licensing.md`, both kept
in the wings as the origin record.

binaryang is **MIT-primary with Apache-2.0 as an alternative**. MIT is what is declared on JSR;
Apache-2.0 ships alongside for consumers whose policies require it, and to satisfy upstream
attribution.

## The merged repo inherits BOTH upstreams' obligations

This is the substantive change the merge makes, and it is the reason this file exists rather than a
choice between two.

A TypeScript port is a Derivative Work of its Apache-2.0 upstream. **Apache-2.0 §4** permits
relicensing derivatives under different terms but requires the Apache license text and all
attribution notices to be retained and redistributed. binaryang derives from **two** upstreams —
WebAssembly/wabt and WebAssembly/binaryen — so it carries that obligation on both counts, and
dropping either side's trail would be a licence violation rather than an untidiness.

Satisfied by: `LICENSE-APACHE` in the repo and in the publish set · `NOTICE.md` redistributed ·
per-file attribution headers on every ported file.

✅ **Verified after the merge**: 27 files carry the ported-from-wabt Apache header and 10 carry the
MIT header. Per-file headers travel with the file, so relocating `src/…` to `src/wabt-ts/…`
preserved them automatically — but it is worth having checked rather than assumed, because a header
lost in a move is invisible.

## File layout

| file             | purpose                                                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE`        | **The declared package licence — full MIT text**, plus a short trailing note pointing at `LICENSE-APACHE` and `NOTICE.md`. JSR fingerprints this by content hash against the SPDX MIT template, so the MIT text must be the **first content**, with no markdown decoration. |
| `LICENSE-MIT`    | The same full MIT text, kept separate so the MIT-or-Apache choice is explicit.                                                                                                                                                                                              |
| `LICENSE-APACHE` | Full Apache-2.0 text. JSR ignores it; it is what makes the alternative real.                                                                                                                                                                                                |
| `NOTICE.md`      | Attribution to WebAssembly/wabt plus the dual-licence explanation.                                                                                                                                                                                                          |
| `deno.json`      | `"license": "MIT"` — a single SPDX identifier, matching the `LICENSE` content.                                                                                                                                                                                              |

⚠️ **Fixed during the merge, and worth recording because it was invisible in either repo alone.**
The two predecessors disagreed about the copyright line: binaryen-ts said
`Copyright (c) 2024
J.R. Marcum`, wabt-ts said `Copyright (c) 2026 Jon Marcum` — different name form
**and** year. Each was internally consistent, so neither repo could see a problem. The merge took
`LICENSE` from one side and `LICENSE-MIT` from the other and produced a repo whose two copies of
"the same" MIT text named different holders.

Resolved to wabt-ts's pair, and not arbitrarily: wabt-ts is the side carrying the explicit Apache §4
obligation, and its `LICENSE` is the one that already carried the trailing pointer to
`LICENSE-APACHE` and `NOTICE.md` — the signalling binaryang now needs, since it ships both.

## JSR rejects on two conditions, and both still apply

1. **`license` must be a single SPDX identifier.** `"MIT OR Apache-2.0"` is syntactically valid and
   unreliable — JSR may accept the field and still reject the publish. Learned the hard way on
   wabt-ts v1.0.2 (2026-05-25) and independently on binaryen-ts.
2. **`LICENSE` must contain the actual full licence text**, matched by content hash. A pointer
   document ("this project is dual-licensed, see …") has no SPDX fingerprint and is rejected with
   `invalidLicense: The license specified … was not recognized.`

Both sides hit this separately and wrote it down separately, which is the strongest evidence a rule
can have. Symptom: `Publish failed: invalidLicense: …`. Fix: put real licence boilerplate in
`LICENSE` and declare one SPDX identifier matching it.

Bonus licence files are communicated **socially** — their presence in the published tarball signals
the alternative, but JSR records only the `license` field's value.

## Per-file headers

**Ported files** (derived from a C++ source in an upstream clone):

```typescript
// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/<filename>.cc / include/wabt/<filename>.h
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0
```

**Original files** (no upstream counterpart — e.g. `wasm2ts`, `src/cli/`, test utilities):

```typescript
// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
```

## JSR provenance + JSDoc

Provenance publishing requires every exported symbol to carry JSDoc and every file a `@module` tag.
binaryen-ts reached 100% lint-clean coverage in its Phase 11 (352 `deno doc --lint` errors fixed);
do not add a new export without at least a one-line JSDoc.

JSDoc `{@link}` and `@example` snippets are **not type-checked**. When renaming, grep JSDoc as well
as code — Phase 11.2 found stale `makeConst()` references after the real factories had become
per-type `makeI32Const` / `makeI64Const` / `makeF32Const` / `makeF64Const`.

🔓 **Open:** the JSDoc examples across `src/binaryen-ts/` still import from
`@jrmarcum/binaryen-ts/*`. They are documentation of consumer usage, so they are not wrong code, but
they name a package that is being retired. They want updating to `@jrmarcum/binaryang/*` before
1.5.1 — tracked with the migration note (A17).
