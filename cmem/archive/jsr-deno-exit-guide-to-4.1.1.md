# Leaving Deno, staying on JSR — closed per-package surveys — archive

Holds the per-package surveys of wasmtk, universal-wasm-loader and s3d-reportcompiler (2026-10-12 to 2026-10-28). Moved verbatim from `cmem/jsr-deno-exit-guide.md` on 2026-11-20 (H38 step 4).

## 6. Notes per package

### wasmtk (2.0.3 on JSR), surveyed read-only 2026-10-12

**The most work, because its published code calls Deno (question 1 is "yes").**
- `Deno.*` outside doc comments in exported files: `src/rt.ts` 22 lines, `main.ts` 20,
  `src/jstyper.ts` 4, `src/wast.ts` 2. Only `src/gowasic.ts` guards with `typeof Deno`. On Node
  or Bun these calls fail at runtime. This is a **runtime port**: web-standard or `node:` APIs,
  feature-detected where Deno behaviour must stay.
- **`jsr:` and `npm:` prefixes inside source files:** about 30 `jsr:@std/…` imports (some
  pinned, e.g. `@std/path@1.0.2` next to `@std/path@^1.1.2` in the import map),
  `jsr:@jrmarcum/binaryang/wat2wasm`, and `npm:binaryen@^116.0.0`. Node rejects the `jsr:`
  prefix (F3). Move them to bare names in the import map / `package.json`, which also merges the
  duplicate `@std/path` versions. Not measured here: how JSR's npm tarball rewrites a `jsr:` import
  inside published code. Check one before relying on it.
- Tests: 506 `Deno.test` and 133 `@std/testing/bdd` imports (F5). 28 files declare an `enum`
  (F7, if Node must run the source).
- **Already has a `package.json` and a `bunfig.toml`.** The `package.json` carries
  `"version": "2.0.3"`, a **second version source** next to `deno.json` (F1: keep one). Its
  `"bin": {"wasmtk": "./main.ts"}` is NOT published by JSR (F4). And with a `package.json`
  present, `npx jsr publish` would skip the type check (F2). Its publish workflow should keep
  `deno publish` directly.
- Pins `binaryang@1.8.1`. binaryang's 1.9.0 and 1.10.0 are out; unrelated to this migration.

### universal-wasm-loader (1.0.8 on JSR), surveyed read-only 2026-10-12

**The least work.** Hand-written JavaScript plus `.d.ts`, one export, no imports. `Deno` appears
only in doc comments. Question 1 is "no". The work is step 1 (`jsr.json`), a README install
section (F3), its 9 `Deno.*` uses in tests and scripts, and CI. It has no TypeScript to check,
so step 2 shrinks to checking the `.d.ts` files with `tsc`. It is the SPEC 3.0.0 reference
implementation for nine sibling loaders, which have no JSR packages.

### s3d-reportcompiler (1.0.4 on JSR)

In the workspace since 2026-10-26 and MIGRATING under this guide; its own record supersedes any
survey here: `../S3D-ReportCompiler/cmem/bun-migration.md`. It is the first package with
dependencies (8, `npm:` and `jsr:`) to take these steps, and it found what binaryang could not:
F1's `--config jsr.json` corrupts dependency imports silently (§ "Step 1, measured" there; C20),
so it folded step 1 into step 7; and six more traps from its steps 2–4 (workspace correspondence
C21) — read its record before § 4 step 2 onward. **Steps 5–7 done, and 1.1.0 released attested**
(Rekor `3544353215`, 2026-10-28). Its five findings from them are recorded in this guide (C26):
§ 4 step 6, the `deno check --doc` note under B7, § 5a "No installed Deno" items 7–8, and § 7.
Its record: `../S3D-ReportCompiler/cmem/bun-migration.md` § "binaryang's guide update of
2026-10-28 — reviewed".

