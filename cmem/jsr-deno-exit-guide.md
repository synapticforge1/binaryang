# Leaving Deno, staying on JSR: findings for the `@jrmarcum` packages

What carries over to another package when it leaves Deno and stays on JSR: the questions, the steps, the decision, npm as a second registry, the pitfalls. Last verified 2026-11-20.

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
of every package.** Decided the same day: code that runs on both Bun and Node, with Bun as the main runtime (§ 5).

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

## 4. The steps binaryang is following

Each step is its own branch, gated and merged. Only step 6 cannot be undone, because a JSR
version is permanent.

1. **`jsr.json` is the one manifest** (F1). Point everything that reads the version at it: the
   bump script, the release script, any entry check, the release-file list, and the
   tag/publish workflows. Add a test that fails if `deno.json` carries `name` or `version` again.
   Done in binaryang (merge `8c00be4b1`). A dry run must list the same files as before.
   ⚠️ **A package with dependencies cannot take this step alone** (F1's caveat, C20): publishing
   through `--config jsr.json` while `deno.json` exists rewrites its import-map dependencies into
   broken relative paths and still reports success. Fold this step into step 7 — the manifest,
   the import map and `nodeModulesDir` move into `jsr.json` and `deno.json` goes, in one step —
   and prove it by the UPLOAD (the fake-registry check in F1), not by the exit code or a dry run.
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
   `deno publish` for publishing (F2) — with `--config jsr.json` only while `deno.json` still
   exists, and NO `--config` once it is gone (C26: S3D released 1.1.0 attested that way, Rekor
   `3544353215`; binaryang's `publish.yml` has run a bare `deno publish` since B7). Keep a Deno leg in the runtime-support
   matrix while consumers use Deno (since 2026-10-28 binaryang's leg runs Deno from npm, with no
   `setup-deno` — § 5a "No installed Deno"; only the publish workflow installs Deno). Prove it with one real release, checking that provenance was
   recorded (`rekorLogId` from `api.jsr.io`). **For a package with dependencies, the release gate
   reads the UPLOAD:** keep the fake-registry capture (F1) as a committed check that compares every
   rewritten import specifier with the expected list before a tag — a green `deno publish` is not
   evidence that the package loads. **A reusable one:** S3D's `scripts/jsr-upload-check.ts`
   (C26). It checks that the uploaded files are `publish.include`, that every import specifier is
   the source's resolved through `jsr.json`'s `imports`, in order, that everything else is
   byte-identical, and that there is no `deno.json`. It is inverted (made to fail on purpose) to
   prove it works, and runs in CI and in `publish.yml` before the real publish. ⚠️ **The fake
   registry must answer `GET …/versions/<v>` with 404:** answered with 200, `deno publish` took
   the version as already published, uploaded NOTHING and exited 0 (measured by S3D, C26).
7. **Delete `deno.json` and `deno.lock`.** Drop `--config jsr.json`. (With dependencies, this is
   where step 1 happens too — see step 1's caveat.)

## 5. Decided: code that runs on both Bun and Node, with Bun as the main runtime

**Owner, 2026-10-12: "We want code that runs on both, but bun as the main runtime."** For
every package this means: `node:` builtins and web standards in scripts, never `Bun.*`;
tests on `node:test` + `@std/expect` / `@std/assert`, never `bun:test`; `@types/node` rather
than `@types/bun`, so a Bun-only API fails the type check; Bun for daily commands; CI on
Bun and Node.

binaryang's evaluation is in [bun-migration.md](bun-migration.md)
§ "Bun or Node". In short: Bun is faster (F7), runs TypeScript as written, and is one binary. Node
has foundation governance and a published LTS schedule. Bun is owned by one company (Anthropic,
since 2025-12, [announcement](https://www.anthropic.com/news/anthropic-acquires-bun-as-claude-code-reaches-usd1b-milestone)),
and depending on one company's decisions is exactly what is happening to Deno now. (Written by
Claude, an Anthropic model; weigh that.) **binaryang's recommendation:** write for both
(`node:` builtins, `node:test` + `@std/expect`), run on Bun daily, gate on both. Then the runtime
choice becomes a CI setting instead of a second migration.

## 5b. npm as a SECOND registry, for every package (owner, 2026-10-13)

Owner: "I think it would be good to add this repo to npm also just in case the jsr gets shut down
for some reason. We probably need to do this for all of our repos just make sure we have adequate
coverage." **JSR stays the source; npm is added beside it.** binaryang's plan, with the reasoning,
is its `cmem/publishing.md` § "npm as a SECOND registry". ⏸ **For binaryang it is PARKED as a
contingency** (owner, same day: "I am leaving it on jsr until it becomes necessary to do
otherwise"); an npm and GitHub organization, `synapticforge`, now exists for that day. Each package
decides for itself; binaryang's choice is not a rule for the others. What carries over:

- **JSR's npm layer is not coverage.** JSR already serves every package to npm clients as
  `@jsr/<scope>__<name>` from `npm.jsr.io`, but that registry goes with JSR. The copy must be on
  registry.npmjs.org.
- **Your DEPENDENCIES must be on npmjs.org too, or the copy is not coverage.** `@std/*` packages
  live only on JSR. A package that imports `@std/path` at runtime, published to npm, still breaks
  the day JSR does. Replace them with `node:` builtins or web APIs, or with npm packages, or
  vendor the few functions used. (binaryang's published code has no dependencies at all. Its
  TESTS use `@std/assert` / `@std/expect` through JSR; that is a dev-time exposure, recorded there.)
- **Ship compiled JavaScript and `.d.ts`.** Node refuses to strip types inside `node_modules`, so
  a `.ts`-only npm package does not load on Node. `tsc` with `rewriteRelativeImportExtensions` if
  sources import `./x.ts`. A package written in JavaScript plus `.d.ts` (universal-wasm-loader)
  needs no build.
- **Generate the npm manifest from `jsr.json`** at build time, so there is still ONE version source
  (F1). Put `bin` there: npm runs a CLI through `npx`, which JSR cannot. `license` may be an SPDX
  expression (`"MIT OR Apache-2.0"`) on npm.
- **Prove the TARBALL, not the tree:** pack it, install it into a scratch project outside the repo,
  import every export and run the CLI on each supported runtime. JSR's own npm build of the same
  version (`npm.jsr.io`) is an independent reference for the export list and types.
- **Publish order follows dependencies.** wasmtk depends on binaryang, so binaryang goes to npm
  first, and wasmtk's npm manifest names the npm package, not `@jsr/…`.
- **The first npm publish claims a name permanently.** Choose the name (the scoped `@jrmarcum/…`
  matches JSR) and set up npm trusted publishing (GitHub OIDC, provenance) before it; check
  provenance on that first publish rather than assume it.
- Per package: **universal-wasm-loader** is the easiest (JS + `.d.ts`, one export, no imports).
  **wasmtk** needs its runtime port (§ 6) and its `jsr:@std` / `npm:binaryen` imports settled
  first, and binaryang on npm. **s3d-reportcompiler**: its own plan
  (`../S3D-ReportCompiler/cmem/bun-migration.md`). Repos that are not JSR
  packages (the Rust and Zig runtimes) are a different registry question, not covered here.

## 7. Pitfalls already met

- A copy of `version` left in `deno.json` silently wins over `jsr.json` (F1).
- `deno publish --config jsr.json` beside a `deno.json` publishes a package whose dependency
  imports point at relative paths that do not exist, and reports success (F1's caveat; measured
  by s3d-reportcompiler, C20). Read the upload, not the exit code.
- A `package.json` turns `npx jsr publish` into a publish without a type check (F2), and adding
  `--check` does not restore it: Deno refuses the pair (measured 2026-10-28, jsr 0.14.3).
- Bun resolves no `npm:` import specifier (Bun 1.4.4, 2026-10-28). A doc that says "works under
  Deno and Bun" may be wrong; binaryang's said exactly that and was. Measure it.
- A Deno version written in several files drifts. Keep one pin and a test that refuses copies
  (§ 5a "No installed Deno").
- "No Deno installed" is a claim you can only check by taking Deno off the PATH, and a shim folder
  shared with Bun hides it from a simple filter (§ 5a "No installed Deno", step 3).
- `"bin"` in `package.json` does nothing for a JSR package (F4).
- `@std/testing/bdd` imports fine on Bun and then fails when the tests run (F5).
- A green publish run is not proof of provenance. Check `rekorLogId`, with a cache-busting
  query: JSR's API is cached.
- The file that holds `version` is the one that ARMS an auto-tag release. Moving it (step 1)
  means the workflows must read the new file in the same change.
- A fake JSR that answers `GET …/versions/<v>` with 200 makes `deno publish` upload nothing and
  exit 0. Answer 404 (C26, measured by S3D).
- A package that renders through Chrome: pagination differs by platform (13 samples: 100 pages on
  Windows, 103 on GitHub's Ubuntu runner), so a test that pins a page count fails in CI (C26,
  measured by S3D).

## Moved sections

§ 3. Findings, measured 2026-10-12 (F1 to F8): moved to [jsr-deno-exit-guide-findings.md](jsr-deno-exit-guide-findings.md)
§ 5a, "Bun as the main runtime", "Type checking: `bun check`", "The engine referee", "Every current
Node LTS line", "Erasable TypeScript", "The web: every export must LOAD in a browser": moved to
[jsr-deno-exit-guide-runtime.md](jsr-deno-exit-guide-runtime.md)
§ 5a, "Lint off Deno", "Formatting off Deno", "Tests off Deno", "Deleting deno.json", "No installed
Deno", "Six traps s3d-reportcompiler measured": moved to
[jsr-deno-exit-guide-tooling.md](jsr-deno-exit-guide-tooling.md)
§ 6. Notes per package: moved to [jsr-deno-exit-guide-to-4.1.1.md](archive/jsr-deno-exit-guide-to-4.1.1.md)
