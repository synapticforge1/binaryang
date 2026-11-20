# Bun migration — the Deno role, the test runner, B7 and B8

Summary: what Deno is still used for (JSR publish and its type check, run by Bun), how the suite runs on Node and Bun, and how the Deno-free machine works. Last verified 2026-11-20.
The main file is [bun-migration.md](bun-migration.md); the lint and formatting tools are in [bun-migration-tooling.md](bun-migration-tooling.md).

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
   - ✅ **But not an INSTALLED one** (2026-10-28, § "B8"): Deno's own npm package `deno` runs the
     same `deno publish` with its type check, through `bun x deno@<pin>`. `bunx jsr publish` stays
     rejected: Deno refuses `--check` beside the `--no-check` it adds (measured, jsr 0.14.3).
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

## B7: no `deno.json` (2026-10-13)

Owner: "proceed with item 26" (after B6). Done; the next release proves B6 and B7 together.

- **Deleted:** `deno.json`, `deno.lock`, `tests/binaryen-ts/deno.json`, `scripts/binaryen-ts/deno.json`
  (`git rm`). Their `tsconfig.json` siblings already did the same job for `tsc`; the reason for the
  binaryen-ts trees' relaxed `noUncheckedIndexedAccess` moved into `tests/binaryen-ts/tsconfig.json`.
- **`deno publish` finds `jsr.json` by itself:** `--config jsr.json` is gone from publish.yml and
  `bun run publish:dry` (new). Proven: the dry run lists the SAME 122 files as main's
  `--config jsr.json` dry run (taken in a temporary worktree), the same `@jrmarcum/binaryang@1.10.0`.
- ⚠️ **With no deno.json, `deno publish` type-checks with `tsconfig.json`'s compilerOptions, but
  does NOT resolve the `@types/node` they name.** `main.ts`'s `import.meta.main` (declared by Deno's
  types and by `@types/node`, by neither in that check) failed the dry run. Fixed in the code, not
  the config: `(import.meta as { main?: boolean }).main`, true on every runtime. tsconfig.json
  carries the warning.
- **The cold release guard moved, it did not go:** `scripts/release/publish.ts` ran a cold `deno
  task check`; the Deno type check publish.yml still runs is the one inside `deno publish`, so the
  guard is now `deno publish --dry-run` in an empty `DENO_DIR`, then `bun run check`. (That guard
  is what would have caught `import.meta.main`.) Its test in `publish_preflight_wiring` pins the new
  call and the order.
- **Tests:** `version_sync`'s second test is now "there is no deno.json (or deno.jsonc)";
  `harness_wiring` keeps only the `TEST_DIRS` check; "keeps scripts/ inside the gate" reads
  biome.jsonc, dprint.json and tsconfig.json; B6's tests expect a bare `deno publish` (any other
  `deno publish …` fails) and no `deno task check`.
- **CI:** the `deno task check` step is gone (`bun run check` is THE type check); Deno is installed
  for the JSR dry run only; the runtimes matrix keeps its Deno leg (`deno run -A main.ts` works
  without a config, checked).
- **`comparison/` is standalone, and runs again.** It was broken since B2: with the root
  package.json and node_modules beside it, Deno resolved `npm:` from node_modules and refused
  `npm:binaryen` ("Could not find a matching package"), unseen because it is outside the gate by
  design. `comparison/deno.json` now carries `"nodeModulesDir": "none"`, its own import map
  (`@std/assert` 1.0.19) and the root's strictness; `comparison/deno.lock` pins binaryen 116.0.0 and
  132.0.0 (the only stable 116.x / 132.x, so the old pins exactly). `bun run comparison`: 18 passed,
  the two live-binaryen tests RAN (not ignored). The gate runner runs it too.
- **Comments:** 41 `deno task <name>` references became `bun run <name>` wherever package.json has
  the script (two naming wabt-ts's own `engine-check` left as they are); the shipped data.ts header
  stays frozen until the next definitions release, as B4 decided. ⚠️ The rename was meant for
  COMMENTS but ran on whole files, and turned one ASSERTION, `not.toContain('deno task test')`,
  into `not.toContain('bun run test')`: it then forbade the very step it guards. The gate caught it
  (the targeted test run had come before the rename). A mechanical rename touches comment lines
  only, and its non-comment hits are read one by one (`git show | grep -v` comment prefixes).

## B5: the suite on `node:test` (2026-10-13)

Owner: "move on to 26 and 28"; decided: `@std/assert` / `@std/expect` KEPT via JSR, and **Node 24
(the V8 referee) authoritative**, Bun too, with its engine differences listed.

- **Baseline first, per file.** Deno's JUnit reporter records only TOP-LEVEL tests (a whole
  `describe` is one case), so it cannot count. The default reporter, parsed for LEAVES (a test or
  step with no children): **346 files, 5,901 leaf tests**. Every later run was diffed against it,
  file by file.
- **Step 1, mechanical (merged `af782c616`):** 291 files `@std/testing/bdd` → `node:test` (all
  imported exactly `{ describe, it }`; 4 of them in `tests/wabt-ts/wasmtk/`, ours, 848 leaves);
  588 `Deno.test` → `test`; one options form and three `{ ignore }` → `{ skip }`. `@std/*` reach
  Node and Bun as `package.json` aliases to `npm:@jsr/std__assert@1.0.19` / `std__expect@1.0.19`
  (deno.lock's versions) with `.npmrc` pointing `@jsr` at `npm.jsr.io`. **Deno runs `node:test`**,
  so the converted suite ran under `deno task test` with the baseline's counts exactly.
- **Step 2, the Deno APIs (~120 calls, 31 files):** `tests/test_fs.ts` gives the file calls the
  tests used (`readTextFile`, `readDir` with `isFile`, `makeTempFile`, `remove` refusing a
  non-empty directory unless `recursive`, …) the SAME names and semantics on `node:fs`, so 96 call
  sites changed `Deno.x` → `fsx.x` only (comment lines and strings untouched). `tests/run_ts.ts`
  (`runTs` / `runTsAsync`) runs `main.ts` as a child of the CURRENT runtime (`deno run -A`,
  `node file.ts`, `bun file.ts`); the 4 CLI tests use it. `wasmtime` via `spawnSync`.
  `ir_subpath` lists exports with `deno doc --json` and keeps calling `deno`: a JSR question
  (owner: Deno for JSR). The 3 `Deno.permissions` probes and their `skip`s are gone (no
  permission model on Node / Bun; the gate ran Deno with `-A`). `Deno.env` / `Deno.cwd` →
  `process`.
- **`scripts/test.ts`:** `bun run test` = `node --test` on the referee (fnm when installed, else
  `node` from PATH only if it IS Node 24: CI pins it with `setup-node`). `bun run test:bun` = `bun
  test`, whose failures must be EXACTLY `tests/bun-known-differences.json` — EMPTY since
  2026-11-19 (it was 36: memory64 / table64 24, cleared by `BUN_JSC_useWasmMemory64=1`,
  `scripts/bun-engine.ts`; an error's wording 2, now either engine's words for one reason;
  100+ memories 5 and legacy `delegate` 5, now `tests/engine_limits.ts`: JavaScriptCore's exact
  refusal, then a second oracle, the values V8 also checks): an unlisted
  failure fails, and so does a listed test that passes (stale). Both legs require EVERY tracked
  test file to have run a test ("a step that ran nothing passes").
- **Proof:** Node 24: 346 files, 5,901 leaves, 0 differ, 0 fail. Bun: the same 5,901, the 36
  listed failures. Mutants: an injected failing assertion fails both legs; the list losing an entry
  fails ("not a known difference"); gaining a passing one fails ("passes now"); an emptied test
  file fails both legs ("ran no test from"). `harness_wiring` also checks `TEST_DIRS` names every
  tree under `tests/` (5,902 leaves since).
- **tsc over the tests:** `tests/tsconfig.json` and `tests/binaryen-ts/tsconfig.json` (the latter
  with `noUncheckedIndexedAccess` off, as its `deno.json`), in `bun run check`: 201 + 145 files,
  0 errors, a planted error caught in each.
- **CI:** `setup-node` 24, then `bun run test` and `bun run test:bun` replace `deno task test`.
  `deno task check` stays until B7.
- **Fixed on the way:** `lower_custom_page_sizes`' trap regex `/out of bounds/` → `/i` (V8 "out
  of bounds", JavaScriptCore "Out of bounds"): 5 failures that were the TEST's, not the engine's.
- **Traps met:** (1) node's JUnit writes a raw `>` inside attribute values (`folded -> linear`), so
  a `[^>]*` tag pattern lost 99 cases' `file`: parse attributes as `name="…"` pairs. (2) A file
  that registers NO test still appears in node's JUnit, as one case named by its own path. (3)
  The converter's import scan looped forever on a trailing `// comment`: bound every scan.
  (4) Biome's `noShadowRestrictedNames` caught a helper named `unescape`.
  (5) **CI found what this machine could not:** `bun test` fails any test slower than 5 s by
  default (node --test has no limit); `fold_prediction`'s corpus test, ~4 s here, timed out on
  GitHub's runner on the first push (2026-10-13) and the Bun leg failed as "not a known
  difference". `scripts/test.ts` passes `--timeout=600000`; a 3 s mutant reproduces the CI failure
  exactly. Read from the timing, not the log (job logs need admin rights): the next CI run is the
  confirmation.

## B8: no installed Deno on the development machine (2026-10-28)

**Owner, 2026-10-28:** "It would remove the need for deno on this machine though … I am slowly
migrating everything to bun, including wasmtk." Deno stays where it is the AUTHORITY (JSR's
publish and type check, JSR's view of the exports, the Deno consumer's run); it stops being a
tool you install. **How:** Deno's own npm package (`deno`, maintainers ry and denobot), pinned and
run by Bun: `bun x deno@2.9.6 …`. Measured against the installed Deno 2.9.8:

| use | was | now | proof |
| --- | --- | --- | --- |
| `publish:dry` | `deno publish --dry-run --allow-dirty` | `bun x deno@2.9.6 publish …` | `Success Dry run complete`; every export `Check`ed |
| release cold dry run (`publish.ts`) | `spawnSync('deno', …)` | `spawnSync('bun', ['x', 'deno@2.9.6', …])` | the same command; the wiring test pins it, and that no `--no-check` appears |
| `api-surface.ts` | `deno doc --json` | `bun x deno@2.9.6 doc --json` | output BYTE-IDENTICAL on all 19 entries (3,676,250 B), the same 62 `@types/node` warnings; `surface:check` matches |
| `tests/ir/ir_subpath.test.ts` | `deno doc --json` | the same | 4 / 4 |
| cli-smoke, Deno leg | `deno run -A scripts/cli-smoke.ts "deno run -A"` | `bun scripts/cli-smoke.ts "bun x deno@2.9.6 run -A"` | the same output hash as installed Deno and as Bun (`7dbdcd45…`) |

**Proved with Deno OFF the PATH** (a PATH holding a copy of Bun's shim and no scoop shims): all
five pass. **Why not `bunx jsr publish`:** finding 2 — it forces `--no-check`, and the cold run
exists to catch what CI's `deno publish` type check would fail after the tag is public.
**Not changed:** `publish.yml` (`setup-deno` + `deno publish` directly, for provenance) and the
CI `runtimes` Deno leg — CI runners, not this machine. **Then, the same day** (owner: "fix the
four files. yes the CI should use npm's deno leg"): the pin, written in four files, is one
constant in `scripts/deno.ts` (code imports `denoCommand`; `package.json`, CI and the smoke run
the file as a launcher), guarded by `tests/wabt-ts/scripts/deno_pin.test.ts`; and CI installs no
Deno: the gates job lost its `setup-deno`, and the runtimes Deno leg is `setup: bun`, `invoke: bun
scripts/deno.ts run -A`. **publish.yml alone keeps `setup-deno`** — its `deno publish` is called
directly, for provenance (finding 2's subprocess lesson). Bumping Deno: one edit, then
`surface:check` and the dry run.

**Then the comparison suite, PORTED off Deno the same day** (owner: "then port it so it also is
deno free"; not npm's Deno — no Deno at all). Bun 1.4.4 resolves no `npm:` specifier (measured:
"Cannot find package 'npm:binaryen@116.0.0'"), so binaryen.js became a real dependency:
`comparison/package.json` pins `binaryen` 132.0.0 and `binaryen-116` (`npm:binaryen@116.0.0`),
exactly `deno.lock`'s two, with its own `bun.lock` — not the root's, which would fetch 50 MB on
every install for a suite CI never runs. `Deno.test` → `node:test` (the asyncify test's six
`t.step`s → a nested `describe`); `Deno.Command` / temp files / `Deno.args` / `Deno.exit` →
`node:` builtins; `deno check` → `bun check -p comparison/tsconfig.json` (the root's strictness,
`noUncheckedIndexedAccess` off as before; the root's `noPropertyAccessFromIndexSignature`, which
deno.json lacked, found one `exports.f`). Run by `node --test` through `scripts/v8.ts`, the V8
referee, as the root suite — the engine Deno's run used. `comparison/deno.json` and `deno.lock`
deleted. **Proof, Deno's last run against the new one:** the same 24 test names, every one ok
(23 tests + 1 suite; Deno counted 18 + 6 steps); `diag_roundtrip`, `diff_wat`, `trace_failing`
stdout byte-identical, their four WAT dumps identical, and `headtohead_bench`'s size and validity
columns identical (timing columns vary run to run); a planted wrong expectation fails the step
(22 / 1, exit 1). Found on the way: `interop/binaryen-js.ts` claimed `npm:binaryen` "works under
Deno and Bun without setup" (false for Bun; its default is `binaryen` now), and the scripts'
`_diffs/` output was never gitignored. **Option, not taken:** `@deno/doc` (deno_doc as WASM, JSR,
0.210.0) would answer `deno doc` with no Deno binary at all, but its JSON is the library's, not
the CLI's, and every `api-surface.json` hash would have to be shown unchanged first.

