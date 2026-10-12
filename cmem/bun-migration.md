# The Bun migration — moving the toolchain off Deno, keeping JSR (open-work item 26)

**State, 2026-10-12:** step B1 (`jsr.json` is the one package manifest) is on branch
`bun-1-jsr-manifest`. B2–B7 are planned below; nothing in them has started. Re-derive every
count before acting on it.

## Why (owner, 2026-10-12)

The Deno team joined Cloudflare, announced 2026-10-09: about one year of maintenance releases
(fixes and security updates), then **no further development of the Deno runtime, around
2027-10**. The project stays open source. Deno Deploy closes sooner (about 2027-04), which does not
touch us. **JSR keeps running**, on Cloudflare's infrastructure. The announcement gave no calendar
dates; the 2027 dates are inferred from 2026-10-09. Confirm them before relying on them.
Sources: [linuxiac](https://linuxiac.com/cloudflare-acquires-deno-javascript-runtime-core-development-to-end-in-2027/),
[alternativeto](https://alternativeto.net/news/2026/10/deno-team-joins-cloudflare-as-runtime-development-winds-down/),
[denoland/deno#36995](https://github.com/denoland/deno/issues/36995).

Owner's direction: move development to **Bun**, keep **JSR as the source** of the package.

## What does NOT move: the published package is already runtime-neutral

The portability rule is BINDING and gated (`deno task portability`, [project.md](project.md)):
no `Deno.*` in shipped source, `node:` only in the CLI layer. Measured 2026-10-12: the `Deno.*`
hits in `src/` are all JSDoc. The CLI already runs on Bun in CI (`runtimes` job, Bun 1.4.0 floor,
the same `wat2wasm` hash as Deno and Node). So **consumers see no change**. The migration is
about the **development toolchain**.

## What does move: the Deno surface, measured 2026-10-12

| where                    | `Deno.*` uses | what they are                                                                                     |
| ------------------------ | ------------- | ------------------------------------------------------------------------------------------------- |
| `tests/` (348 files)     | 730           | 621 `Deno.test`, file I/O, 6 `Deno.permissions` probes; 287 imports of `@std/testing/bdd`, 308 of `@std/assert`, 45 of `@std/expect` |
| `scripts/`               | 201           | `Deno.Command` (28 in all trees), `Deno.args`, `Deno.exit`, `Deno.execPath`, file I/O, 2 workers   |
| `comparison/`            | 36            | the upstream comparison suite (`npm:binaryen`)                                                     |
| `benches/`               | 7             | `Deno.bench`                                                                                       |
| config and CI            | —             | `deno.json` (tasks, `fmt`, `lint`, `compilerOptions` + 3 workspace members), `deno.lock`, the 3 workflows |

The tools Deno bundles that Bun does not: `deno check` (the type checker), `deno fmt`,
`deno lint`, `deno bench`, the test sanitizers, and permissions.

## Findings — what was checked, and what it showed

1. **`jsr.json` works with Deno, but only by name while `deno.json` exists.** Measured
   2026-10-12 on Deno 2.9.7: with the package fields removed from `deno.json`, `deno publish
   --dry-run` fails (`Missing 'name' field in deno.json`), with or without `workspace`. With
   `--config jsr.json` it succeeds and publishes the same 121 files as before, except that
   `deno.json` is replaced by `jsr.json`. So until `deno.json` is deleted, every publish is
   `deno publish --config jsr.json`. Once `deno.json` is gone, `jsr.json` is found on its own.
2. **Publishing to JSR from Bun still runs Deno.** `bunx jsr publish` (the `jsr` npm CLI)
   downloads a Deno binary and runs `deno publish` as a subprocess. With a `package.json` present it
   also adds `--unstable-sloppy-imports --unstable-byonm --unstable-bare-node-builtins
   --no-check`, so publishing **skips the type check**.
   Source: [jsr-io/jsr-npm `src/commands.ts`](https://github.com/jsr-io/jsr-npm/blob/main/src/commands.ts).
   Consequences:
   - JSR publishing depends on a Deno binary for as long as JSR's tooling does. That is JSR's
     problem to solve after 2027, but it is the one Deno dependency we cannot remove.
   - `publish.yml` keeps calling `deno publish` **directly**. The provenance record
     ([publishing.md](publishing.md)) shows OIDC provenance failing through a subprocess, and
     `bunx jsr publish` is a subprocess.
   - Our own type check must stay in the gate before publish. The jsr CLI's `--no-check` means
     nothing else will catch a type error at publish time.
3. **Bun imports JSR packages by their bare name, after one install step.** JSR's Bun
   instructions (`import * as wasmtk from "@jrmarcum/wasmtk"`, owner 2026-10-12) are correct
   once the package is added. Measured on Bun 1.4.3, 2026-10-12, in an empty project:
   - before any install, `import … from "@std/assert"` fails to resolve;
   - `bun add jsr:@std/assert` is refused (`Invalid dependency name`). Bun has no `jsr:`
     prefix, in imports or in `bun add`;
   - `bunx jsr add @std/assert @jrmarcum/binaryang` writes
     `"@jrmarcum/binaryang": "npm:@jsr/jrmarcum__binaryang@^1.10.0"` (and the `@std/assert` alias) to
     `package.json`, and `@jsr:registry=https://npm.jsr.io` to `.npmrc`
     ([jsr.io/docs/npm-compatibility](https://jsr.io/docs/npm-compatibility)). After that the
     bare import works;
   - **binaryang itself works this way:** `@jrmarcum/binaryang/wat2wasm` from JSR assembled a
     module on Bun and it returned 42. JSR serves Bun a transpiled `main.js` + `_dist/` `.d.ts`,
     which is why slow-types cleanliness matters (§ Other issues).

   For this repo the bare names match: tests already import `'@std/assert'` etc. through
   `deno.json`'s import map, so once `package.json` carries the same aliases (B2) those import
   lines need no rewrite.
3a. **But `@std/testing/bdd` does not run on Bun.** Its `describe` / `it` call `Deno.test`
   underneath. Under `bun test` the import works and then fails with `ReferenceError: Deno is
   not defined` (measured, same project). `@std/expect` and `@std/assert` are plain code and
   run on Bun: `@std/expect` with `bun:test`'s `describe` / `it` gave 1 pass, 1 fail on a
   probe with one deliberate failure. So the 287 `@std/testing/bdd` imports must change. The
   353 `@std/assert` / `@std/expect` imports can stay.
4. **Bun's `node:test` is partial.** Bun's docs call it basic and point to `bun:test`. So
   `node:test` is not a safe way to run one suite on all three runtimes. `bun:test`'s
   `describe` / `it` / `expect` match `@std/testing/bdd` + `@std/expect` closely (both are
   Jest-shaped).

## The plan — each step is one branch, gated, merged `--no-ff`

| step | what                                                                                                                                                                                                                    | done when                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| B1   | **`jsr.json` is the one package manifest.** `deno.json` loses `name` / `version` / `license` / `exports` / `publish`. The bump, release driver, entry check, `RELEASE_FILES`, the three workflows and `version_sync` read `jsr.json`. `version_sync` also fails if `deno.json` names the package again. | ✅ on `bun-1-jsr-manifest`, gate below                                         |
| B2   | **Bun project files next to Deno's.** `package.json` (dev dependencies only: `typescript`, `@types/bun`, `dprint`, a linter, `binaryen` for `comparison/`), `.npmrc` for `@jsr`, `tsconfig.json` with the root's `compilerOptions` and per-folder `tsconfig`s for the 3 `noUncheckedIndexedAccess: false` members, `bunfig.toml` (`install.minimumReleaseAge` in place of `minimumDependencyAge`), `bun.lock`. `tsc --noEmit` must accept the same tree `deno check` does. | both checkers green on the same commit                                         |
| B3   | **Formatting and lint off Deno.** `deno fmt` IS dprint's TypeScript plugin, so `dprint` with the same settings (`lineWidth` 100, `indentWidth` 2, `singleQuote`) should leave the tree byte-identical. Measure that first: `dprint check` on the current tree must report 0 files. Lint: pick a linter and map Deno's `recommended` rules; record each rule dropped. | `dprint check` 0 diffs; linter green; dropped rules listed                    |
| B4   | **Scripts on `node:` builtins.** `Deno.Command` → `node:child_process`, `Deno.args` → `process.argv.slice(2)`, `Deno.exit` → `process.exit`, file I/O → `node:fs`. Not `Bun.*`: `node:` runs on Bun, Deno and Node, so each script can run on Deno and Bun with the outputs diffed, and we are not locked into a new runtime. Corpus scripts first, release scripts last. | each script prints the same thing under `deno run -A` and `bun`                |
| B5   | **Tests on `bun:test`.** `@std/testing/bdd` → `bun:test` (required: it calls `Deno.test`, finding 3a), `Deno.test` → `test`. `@std/assert` and `@std/expect` STAY, by their bare names through JSR's npm layer (finding 3): fewer lines change, and JSR stays the source of our test dependencies too. The 6 `Deno.permissions` probes go. The 6 `t.step` uses become nested `describe`. **Proof: the per-file test counts match** the last Deno run, and an injected failure fails. | test counts equal; injected-mutant check                                       |
| B6   | **CI and the release path on Bun.** `ci.yml` gates with `setup-bun`; the `runtimes` matrix KEEPS its Deno leg (consumers on Deno remain). `publish.yml` keeps `setup-deno` + `deno publish` for provenance (finding 2). `auto-tag` reads `jsr.json` without Deno. `deno task …` → `bun run …` in the gate list in [working-rules.md](working-rules.md). | one release published from the new path, provenance verified (`rekorLogId`)    |
| B7   | **Delete `deno.json` and `deno.lock`.** `--config jsr.json` comes off the publish commands, since `jsr.json` is then found on its own. `version_sync`'s second test turns into "there is no `deno.json`". `cmem/` updated throughout. | gate green with no `deno.json` in the tree                                     |

**B6 is the only step that is hard to undo**, because a JSR version is immutable. The other
steps can sit on `main` in any order after their predecessor, unreleased, behind the usual merge.

## Other issues to account for

- **Releases during the migration:** B1 changes the file that ARMS a release ([publishing.md](publishing.md)
  § RULE). `auto-tag` now reads `jsr.json`. Until B1 is merged AND pushed, a bump must go in
  the file the pushed workflows read. Do not mix the two.
- **The README's Deno instructions stay true.** `deno add jsr:@jrmarcum/binaryang` keeps working
  as long as JSR does. Add Bun instructions (`bunx jsr add @jrmarcum/binaryang`) next to them.
  The README's runtime-support claim should keep Deno until the owner retires it.
- **Slow types:** JSR builds the npm tarball's `.d.ts` only from a slow-types-clean package. That
  check runs inside `deno publish` and is unaffected. The `--no-check` from finding 2 skips the
  type check, not the slow-types check (verify at B6).
- **Lost tooling, by design:** Deno's test sanitizers (leaked ops and resources) and permission
  flags have no Bun equivalent. Some tests asserted under `--allow-*`. Nothing replaces those.
  `Deno.bench` → `mitata` or `bun:test`-timed benches (decide at B4).
- **`import.meta.main`** (10 uses in scripts) works on Bun and Deno. Node needs a different
  test, but Node is not a script runtime here.
- **Workers:** `check-spec-behaviour` and `check-direct-behaviour` kill a `Worker` on timeout.
  Bun has web Workers. Re-measure that `terminate()` really stops a hung module there (the
  "harnesses need fuel" lesson, [best-practices.md](best-practices.md)).
- **Windows:** this machine is Windows. `bun` 1.4.3 is installed (2026-10-12); confirm CRLF
  handling in `dprint` matches `deno fmt` here ([`local/environment.md`](local/environment.md)).
- **Sibling repos** (wasmtk, wazmrt's TS tooling, the TS loaders) face the same deadline. That
  belongs to the workspace session's [handoffs](../../cmem/handoffs.md). Nothing is written to
  them from here. wasmtk consumes binaryang from JSR and is unaffected by B1–B7.
