# Licensing

Merged topic file (A16). Supersedes `binaryen-ts/licensing.md` and `wabt-ts/licensing.md` (full texts:
`git show 62c65a9db:cmem/<wing>/licensing.md`; summaries in [wabt-ts.md](wabt-ts.md) and [binaryen-ts.md](binaryen-ts.md)).

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

🔧 **CORRECTED 2026-10-23 — the Binaryen half was NOT satisfied, while this file said both were.**
Found by the owner's question "at what point is this project standalone … and potential licensing
issues?": `NOTICE.md` attributed only wabt (and still said "wabt-ts", and pointed at an `upstream/`
directory binaryang does not have), and no file derived from Binaryen carried an attribution header —
though `src/passes/asyncify.ts` calls itself "a faithful port of upstream Binaryen's `Asyncify.cpp`".
binaryen-ts never carried per-file headers (its licensing record covered only JSR's rules), and the
merge inherited that. The verification above counted the wabt headers and never asked about the
other upstream. Fixed (owner: "I agree with 1"):

- **`NOTICE.md`** names binaryang, attributes BOTH upstreams with their Apache notices, describes the
  two header forms, and drops the `upstream/` claim; the original-work holder matches `LICENSE`.
- **30 files carry a Binaryen header**, classified by what each file says of itself, with the
  copyright year READ from each cited upstream file (Binaryen `version_132-38-g67ac1ab072cd`, the
  frozen binaryen-ts's `upstream/` clone): **4 `Ported from`** — the file says it is a port
  (`asyncify`, `inlining`, `local-cse`, `flatten`); **26 `Based on`** — the file names the upstream
  source it was written against ("Reference: `X.cpp`", "Mirrors `X`"): 20 passes and `pass.ts`,
  `ir/expressions`, `ir/module`, `ir/types`, `ir/gc-types`, `tools/wasm-ctor-eval`,
  `compat/binaryen-compat` (the binaryen.js API shape and type ids). Binaryen ships no NOTICE file,
  so §4 here is its licence plus each file's own copyright line.
- **Undecided — the owner's call:** files that came from binaryen-ts's history but name no upstream
  source. Several share a name and role with a Binaryen component — `simplify-locals`,
  `memory-packing`, `dead-argument-elimination`, `remove-unused-types`, `minify-imports-and-exports`,
  `local-graph`, `effects`, `memory64-lowering`, the interpreter (`src/interp/*`) — and others have no
  upstream counterpart that is known (`converge`, `spill-stack-values`, `non-nullable-locals`,
  `lower-custom-page-sizes`, `derive-types`, `phantoms`, `prepare`, `memory-access`, the tools
  `read-wat`, `wasm-bundle`, `wasm-interp`, `witgen`); `lower-block-params` says it is original.
  Attributing a file that is not derived costs nothing; failing to attribute one that is, is the
  violation — so the conservative choice is to attribute every same-named component.

🔑 **A count verifies the thing it counts.** "27 files carry the wabt header" was true and was
recorded as "both obligations satisfied"; the second upstream had no count at all.

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

✅ **Closed** (re-checked 2026-09-14): the JSDoc examples across `src/binaryen-ts/` used to import
from `@jrmarcum/binaryen-ts/*`, a package being retired, and wanted updating to
`@jrmarcum/binaryang/*`. `src/` no longer names either predecessor package except `src/index.ts`'s
module doc, which says binaryang REPLACES them — which is correct.
