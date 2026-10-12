# Leaving Deno, staying on JSR: findings for the `@jrmarcum` packages

**For:** the maintainers (and Claude sessions) of the other packages under `@jrmarcum` on JSR:
`wasmtk`, `universal-wasm-loader` and `s3d-reportcompiler`. JSR listed exactly these plus
`binaryang` on 2026-10-12.
**From:** binaryang, which started this migration on 2026-10-12. Its full working record is
[bun-migration.md](bun-migration.md). This file holds only what carries over to another package.
**Every finding has a date and versions.** Re-measure before acting on one: this is a fast-moving
area.

---

## 1. What happened

On 2026-10-09 the Deno team announced it is joining Cloudflare. The Deno runtime gets about a year
of maintenance releases (fixes and security updates). After that development stops, **around
2027-10**. The project stays open source. Deno Deploy closes sooner (about 2027-04). **JSR keeps
running**, on Cloudflare's infrastructure. The announcement gave no calendar dates; the 2027 dates
are inferred from 2026-10-09.
([linuxiac](https://linuxiac.com/cloudflare-acquires-deno-javascript-runtime-core-development-to-end-in-2027/),
[alternativeto](https://alternativeto.net/news/2026/10/deno-team-joins-cloudflare-as-runtime-development-winds-down/),
[denoland/deno#36995](https://github.com/denoland/deno/issues/36995))

**Owner's direction (2026-10-12):** move development off Deno, toward Bun. **JSR stays the source
of every package.** Whether development code should also run on Node is an open decision (§ 5).

## 2. Two questions to ask of each package

1. **Does the published code call Deno?** Look for `Deno.*` outside doc comments in the files
   `exports` names, and for `jsr:`, `npm:` or `https:` prefixes in their imports. If yes, the
   package does not run on Node or Bun today. **Porting the runtime comes first.** Node and Bun
   users get a package that fails at the first `Deno.` call.
2. **Does the development toolchain use Deno?** `deno test`, `deno check`, `deno fmt`,
   `deno lint`, `deno task`, `Deno.test`, `@std/testing/bdd`, scripts calling `Deno.*`, and CI
   steps using `setup-deno`. If yes, it needs replacing within the year.

binaryang answered "no" to question 1: a gated portability rule had kept `Deno.*` out of its
shipped code. So only its toolchain moves.

## 3. Findings, measured 2026-10-12

Versions: Deno 2.9.7, Bun 1.4.3, Node 24.21.0, npm's `jsr` CLI as of that date, Windows 11.

**F1. `jsr.json` works with Deno, but only by name while a `deno.json` exists.** If `deno.json`
has no `name`, `deno publish` fails with `Missing 'name' field in deno.json`, whether or not
`jsr.json` is present and with or without `workspace`. `deno publish --config jsr.json` succeeds
and publishes the same files, except that the manifest file itself is `jsr.json`. Once
`deno.json` is deleted, `jsr.json` is found automatically.
→ Move `name` / `version` / `license` / `exports` / `publish` into `jsr.json`, remove them from
`deno.json`, and pass `--config jsr.json` to every publish command (CI and dry runs) until
`deno.json` is gone. Keep **one** version source. A copy left in `deno.json` WINS.

**F2. Publishing to JSR still runs Deno, even from Bun or Node.** `npx jsr publish` /
`bunx jsr publish` downloads a Deno binary and runs `deno publish` as a subprocess
([jsr-npm `src/commands.ts`](https://github.com/jsr-io/jsr-npm/blob/main/src/commands.ts)).
**When a `package.json` is present**, it adds `--unstable-sloppy-imports --unstable-byonm
--unstable-bare-node-builtins --no-check`, so **the type check is skipped**.
→ Keep calling `deno publish --config jsr.json` directly in the publish workflow, with
`setup-deno`. GitHub OIDC provenance has been seen to fail silently through a subprocess
(binaryang's `publishing.md`), and the jsr CLI IS a subprocess. Run your own type check in the
gate before publishing. Publishing is the one Deno dependency nobody can remove yet. That is
JSR's to solve before 2027-10.

**F3. Node and Bun cannot import from JSR without installing first.**

| attempt                                        | Node 24.21                         | Bun 1.4.3                 |
| ---------------------------------------------- | ---------------------------------- | ------------------------- |
| bare import, nothing installed                 | `ERR_MODULE_NOT_FOUND`             | fails to resolve          |
| `import … from "jsr:@scope/pkg"`               | `ERR_UNSUPPORTED_ESM_URL_SCHEME`   | not supported (JSR docs)  |
| `npm install jsr:…` / `bun add jsr:…`          | `EUNSUPPORTEDPROTOCOL`             | `Invalid dependency name` |
| `npx jsr add @scope/pkg` / `bunx jsr add …`    | works                              | works                     |
| bare import after that                         | **works**                          | **works**                 |

`jsr add` writes `"@scope/pkg": "npm:@jsr/scope__pkg@^x.y.z"` to `package.json` and
`@jsr:registry=https://npm.jsr.io` to `.npmrc`. Commit both. pnpm 10.9+, yarn 4.9+ and vlt take
`jsr:` natively with no `.npmrc` ([JSR docs](https://jsr.io/docs/npm-compatibility); not
measured here). Bun can also take the scope from `bunfig.toml`
(`[install.scopes] "@jsr" = { registry = "https://npm.jsr.io/" }`, as wasmtk already has; not
measured here).
→ The README install section should list `npx jsr add`, `bunx jsr add`, `pnpm add jsr:` and
`deno add jsr:`, then ONE bare import line for every runtime. Mark "import `jsr:` with no
install" as Deno-only. binaryang's README since 2026-10-12 is a worked example.

**F4. What Node and Bun users receive is compiled JavaScript.** JSR serves a transpiled
`main.js` plus `.d.ts`. binaryang's CLI ran from `node_modules/@jrmarcum/binaryang/main.js` with
**no flags** on Node, and also on Bun and Deno. All three wrote identical bytes. **JSR's npm
tarballs have no `bin` entry**, so `npx <pkg>` does not exist, and a `bin` in your own
`package.json` is not published. Document `node node_modules/@scope/pkg/main.js …`, or a
`package.json` script. The `.d.ts` is generated only for a package with no slow types: never
publish with `--allow-slow-types`.

**F5. `@std/testing/bdd` does not run on Bun.** Its `describe` / `it` call `Deno.test`, so under
`bun test` they fail with `ReferenceError: Deno is not defined`. `@std/assert` and `@std/expect`
are plain code and run on Bun and Node, installed by bare name through `jsr add`. If your tests
already import `'@std/assert'` by bare name through `deno.json`'s import map, those lines need
no change.

**F6. One test suite can run on both Bun and Node.** A probe file importing `describe`, `it` and
`before` from `node:test`, plus `@std/expect` and `@std/assert`, gave **identical verdicts** under
`bun test` and `node --test`. It had nested `describe`, `before`, `it.skip`, an async test and one
deliberate failure; both runtimes reported 2 pass / 1 fail / 1 skip. Bun's own docs call its
`node:test` partial (no mocking, snapshots or fake timers), so check that your tests use none of
those. binaryang's tests use none.

**F7. Node cannot run TypeScript that uses `enum`s or constructor parameter properties** without
`--experimental-transform-types`. Its default type stripping only erases types. Bun runs such
source as it is. binaryang CLI start, whole tree loaded, median of 5: **Bun 106 ms, Deno 184 ms,
Node 581 ms** (with the flag). This affects running the SOURCE only. Consumers get compiled
JavaScript (F4).

**F8. Neither Bun nor Node checks types.** Both strip types and run. `tsc` replaces
`deno check` whichever runtime is chosen (`typescript` 7.0.2 was `latest` on npm on 2026-10-12).
`deno fmt` is dprint's TypeScript plugin, so `dprint` with the same settings should reproduce
its output. binaryang has not measured that yet.

**F9. An unversioned `deno run jsr:@scope/pkg` can run an old release.** It ran binaryang 1.8.1
while JSR's latest was 1.10.0, in a clean directory with `--no-lock`, from Deno's cached copy of
JSR's version list. `--reload=jsr:@scope/pkg` did not refresh it; a full `--reload` did. An
install pins the version in a lockfile instead.

## 4. The steps binaryang is following

Each step is its own branch, gated and merged. Only step 6 cannot be undone, because a JSR
version is permanent.

1. **`jsr.json` is the one manifest** (F1). Point everything that reads the version at it: the
   bump script, the release script, any entry check, the release-file list, and the
   tag/publish workflows. Add a test that fails if `deno.json` carries `name` or `version` again.
   Done in binaryang (merge `ac37cb386`). A dry run must list the same files as before.
2. **Bun/Node project files next to Deno's:** `package.json` (dev dependencies only),
   `.npmrc` or `bunfig.toml` for `@jsr`, `tsconfig.json` copying `deno.json`'s
   `compilerOptions`, and a lockfile. **Done when** `tsc --noEmit` accepts what `deno check`
   accepts.
3. **Format and lint:** `dprint` (expect zero diffs; F8) and a linter. List every Deno lint rule
   that is dropped.
4. **Scripts on `node:` builtins** (`node:child_process`, `node:fs`, `process.argv`,
   `process.exit`), not `Bun.*`. They then run on Bun, Node and still Deno, so each script's
   output can be compared between Deno and the new runtime before Deno goes.
5. **Tests:** `@std/testing/bdd` and `Deno.test` → `node:test` (F6), or `bun:test` if you choose
   Bun-only. **Done when** each file's test count matches the last Deno run, and a deliberately
   broken assertion fails.
6. **CI and the release path:** gate with Bun (and Node, § 5). Keep `setup-deno` +
   `deno publish --config jsr.json` for publishing (F2). Keep a Deno leg in the runtime-support
   matrix while consumers use Deno. Prove it with one real release, checking that provenance was
   recorded (`rekorLogId` from `api.jsr.io`).
7. **Delete `deno.json` and `deno.lock`.** Drop `--config jsr.json`.

## 5. Open: Bun-only, or code that runs on both Bun and Node?

Pending the owner's decision. binaryang's evaluation is in [bun-migration.md](bun-migration.md)
§ "Bun or Node". In short: Bun is faster (F7), runs TypeScript as written, and is one binary. Node
has foundation governance and a published LTS schedule. Bun is owned by one company (Anthropic,
since 2025-12, [announcement](https://www.anthropic.com/news/anthropic-acquires-bun-as-claude-code-reaches-usd1b-milestone)),
and depending on one company's decisions is exactly what is happening to Deno now. (Written by
Claude, an Anthropic model; weigh that.) **binaryang's recommendation:** write for both
(`node:` builtins, `node:test` + `@std/expect`), run on Bun daily, gate on both. Then the runtime
choice becomes a CI setting instead of a second migration.

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

Not in this workspace and not surveyed. Start with the two questions in § 2, then the steps in
§ 4.

## 7. Pitfalls already met

- A copy of `version` left in `deno.json` silently wins over `jsr.json` (F1).
- A `package.json` turns `npx jsr publish` into a publish without a type check (F2).
- `"bin"` in `package.json` does nothing for a JSR package (F4).
- `@std/testing/bdd` imports fine on Bun and then fails when the tests run (F5).
- A green publish run is not proof of provenance. Check `rekorLogId`, with a cache-busting
  query: JSR's API is cached.
- The file that holds `version` is the one that ARMS an auto-tag release. Moving it (step 1)
  means the workflows must read the new file in the same change.
