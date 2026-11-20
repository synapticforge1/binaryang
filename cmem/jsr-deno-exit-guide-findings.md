# Leaving Deno, staying on JSR — the findings F1 to F8

The measurements (2026-10-12, Deno 2.9.7, Bun 1.4.3, Node 24.21.0) the guide's steps and rules cite
as F1, F2 and so on. Split from [jsr-deno-exit-guide.md](jsr-deno-exit-guide.md) on 2026-11-20 (H38
step 5). Last verified 2026-11-20.

## 3. Findings, measured 2026-10-12

Versions: Deno 2.9.7, Bun 1.4.3, Node 24.21.0, npm's `jsr` CLI as of that date, Windows 11.

**F1. `jsr.json` works with Deno, but only by name while a `deno.json` exists.** If `deno.json`
has no `name`, `deno publish` fails with `Missing 'name' field in deno.json`, whether or not
`jsr.json` is present and with or without `workspace`. `deno publish --config jsr.json` succeeds
and publishes the same files, except that the manifest file itself is `jsr.json` — **for a package
with NO dependencies only** (binaryang, where this was measured). Once `deno.json` is deleted,
`jsr.json` is found automatically.
⚠️ **With dependencies, `--config jsr.json` beside a `deno.json` SILENTLY corrupts the upload**
(measured by s3d-reportcompiler, Deno 2.9.8, 2026-10-26; workspace correspondence C20): it prints
"Successfully published", but every trailing-slash import-map entry (`"pkg/": "npm:pkg@x/"`) — and,
when the dependencies are only in `package.json`, every bare dependency — is rewritten in the
uploaded files to a RELATIVE path (`./pkg/…`) that cannot load. Of S3D's eight variants, only one
equalled the real registry's bytes: `jsr.json` carrying `imports` + `nodeModulesDir`, NO
`deno.json`, no `--config`. A dry run cannot show it (it does not print the rewritten files), and
binaryang cannot reproduce it (no import map to corrupt) — **the check is S3D's**: publish each
variant to a fake JSR on `127.0.0.1` (`JSR_URL=http://127.0.0.1:<port>/`, a dummy `--token`,
`--no-provenance`), save the uploaded tarball and read its import specifiers; positive control =
the baseline upload equals what the real registry serves. Record:
`../S3D-ReportCompiler/cmem/bun-migration.md` § "Step 1, measured".
→ **No dependencies:** move `name` / `version` / `license` / `exports` / `publish` into `jsr.json`,
remove them from `deno.json`, and pass `--config jsr.json` to every publish command (CI and dry
runs) until `deno.json` is gone. **With dependencies:** do NOT publish through `--config jsr.json`
beside a `deno.json`; move the manifest, the import map and `nodeModulesDir` into `jsr.json` and
delete `deno.json` in the SAME step (§ 4, step 1 folded into step 7, as S3D did), then prove the
upload's specifiers with the fake-registry check. Either way, keep **one** version source. A copy
left in `deno.json` WINS.

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
✅ **But it need not be an INSTALLED Deno** (binaryang, 2026-10-28; jsr 0.14.3, Deno 2.9.6 / 2.9.8,
Bun 1.4.4). Deno publishes itself on npm as `deno` (maintainers `ry`, `denobot`), so `bun x
deno@<exact> publish --dry-run` runs the real `deno publish`, type check included, on a machine
or CI runner with no Deno. **jsr's `--no-check` cannot be undone:** it passes your flags through,
but Deno refuses `--check` beside `--no-check` ("cannot be used with"), measured. So a dry run
meant to catch type errors before a tag must not go through `npx jsr`. The real publish in the
publish workflow stays `setup-deno` + a direct `deno publish`, for provenance. Recipe: § 5a "No
installed Deno".

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
`--experimental-transform-types` (and Node 26 has no such flag). 🔧 binaryang removed both
constructs on 2026-10-12 (§ 5a, "Erasable TypeScript"), so Node 22–26 run its source with no flag. Its default type stripping only erases types. Bun runs such
source as it is. binaryang CLI start, whole tree loaded, median of 5: **Bun 106 ms, Deno 184 ms,
Node 581 ms** (with the flag). This affects running the SOURCE only. Consumers get compiled
JavaScript (F4).

**F8. Neither Bun nor Node checks types when it RUNS a file.** Both strip types and run. `tsc`
replaces `deno check` whichever runtime is chosen (`typescript` 7.0.2 was `latest` on npm on
2026-10-12). 🔧 **Since Bun 1.4.3 Bun HAS a checker, `bun check`** (found 2026-10-15; binaryang
uses it — § 5a "Type checking: `bun check`"), so a Bun project no longer needs `tsc` for this.
`deno fmt` is dprint's TypeScript plugin, so `dprint` with the same settings should reproduce
its output. binaryang has not measured that yet.

**F9. An unversioned `deno run jsr:@scope/pkg` can run an old release.** It ran binaryang 1.8.1
while JSR's latest was 1.10.0, in a clean directory with `--no-lock`, from Deno's cached copy of
JSR's version list. `--reload=jsr:@scope/pkg` did not refresh it; a full `--reload` did. An
install pins the version in a lockfile instead.

**F10. Bun's WebAssembly engine is JavaScriptCore, not V8.** Deno and Node use V8. Every `.wasm`
in the spec testsuite corpora, validated by each runtime's own engine (core 5,924, legacy 18,
`proposals/` 811 modules): **Node agreed with Deno on all 6,753**, while Bun 1.4.3 disagreed on
**300**. JavaScriptCore has no memory64 / table64 (refuses 227 valid core modules), accepts 70
modules the spec says must be rejected (`unreached-invalid` 64, typed function references 6), and
has no legacy `try_delegate`.
→ Any test or script that uses the host engine as an ORACLE (`WebAssembly.validate`, `Module`,
`Instance` to judge correctness or run behaviour) gives different answers on Bun. Run those on a
CURRENT V8, or classify each Bun difference. Do not pin it blind. **The V8 version matters too:**
Node 22's V8 12.4 differs from Deno's 15.0 on 71 core modules (no table64) and failed binaryang's
behaviour gate (11 DIVERGE, 32 refused); Node 24 (13.6) passed it; Node 26 (14.6) cannot run
TypeScript with enums at all. Chrome stable is V8 15.6. V8 flags are `--v8-flags=…` in Deno and
passed directly in Node (`node --experimental-wasm-…`); Bun has none. binaryang's wiring
(owner, 2026-10-12: Deno for JSR only, "not the V8 items"): oracle scripts run on Node 24 through
fnm, named once in `scripts/v8.ts` (`bun scripts/v8.ts scripts/…` from `package.json`), and
everything else on Bun. Measured equal to Deno's results. **wasmtk and the loader run WebAssembly as their product, so their own tests meet this
head-on.**

**F11. Importing a `.wasm` file directly works on Deno and Node, NOT on Bun.** Measured
2026-10-12 with `import { add } from "./add.wasm"` (a two-function module):

| runtime | result |
| --- | --- |
| Deno 2.9.7 | works (WebAssembly ES-module integration) |
| Node 22.23.3, 24.21.0, 26.11.1 | works, with NO flag (`--experimental-wasm-modules` is no longer needed) |
| Bun 1.4.3 | FAILS, "Export named 'add' not found": `import x from "./add.wasm"` gives the file's PATH as a string (an asset import), not the module |
| browsers | not measured (WebAssembly ES-module integration is not generally shipped there, to our knowledge) |

→ Code meant to run everywhere cannot import `.wasm`. It has to obtain the BYTES (a file read,
`fetch`, or an embedded `Uint8Array`) and call `WebAssembly.instantiate` with explicit
imports. That is universal-wasm-loader's job, so the owner made it the next project (2026-10-12):
"since wasm is not directly importable the same way it is in bun and node as it is in deno, our
next project needs to be the universal wasm load project. That transition will make the rest
easier." (The owner's premise, measured: Node CAN import `.wasm` directly; Bun is the outlier,
and browsers are unmeasured.)

