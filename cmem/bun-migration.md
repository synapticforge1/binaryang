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
| B2   | **Bun project files next to Deno's.** ✅ Built 2026-10-12 on `bun-2-project-files`: `package.json` (private; dev dependencies `typescript` 7.0.2 and `@types/node` ~22.18, the Node floor; script `check`), `tsconfig.json` (deno.json's strictness flags, `types: ["node"]` so a Bun-only API fails), `bun.lock`, and a CI step `bun install --frozen-lockfile && bun run check`. **Scope, by decision:** `tsc` checks the SHIPPED code (`main.ts`, `src/`), 0 errors in 668 ms, and an injected `TS2322` fails it. tests/, scripts/ and comparison/ still use Deno globals; each joins `include` as B4 / B5 converts it, with its own `tsconfig` for the 3 `noUncheckedIndexedAccess: false` members. `.npmrc` / `@std` aliases and `dprint` / a linter come with B3 and B5, when something first needs them. `version_sync` also refuses `name` / `version` / `exports` / `bin` in `package.json`. ⚠️ On this machine's exFAT drive `bun install` cannot write `bun.lock` (`local/environment.md`). | ✅ `tsc` and `deno check` both green on the same commit                       |
| B3   | **Formatting and lint off Deno.** ✅ **LINT half done 2026-10-13 (owner: "add the tsc lint flags and use Biome to replace deno lint")**, see § "B3 lint: Biome and the tsc lint flags" below. ✅ **FORMATTING half done 2026-10-13 (owner: "move on to 26 and 28")**: dprint 0.57.4 replaces `deno fmt`, with the plugins Deno 2.9.7 bundles; byte-identical on the tree and on three damaged copies of it. See § "B3 formatting: dprint replaces deno fmt". (Biome's formatter stays OFF; it is a different style.) | lint: ✅; fmt: ✅ `dprint check` 0 diffs, differential 0 |
| B4   | ✅ **Built 2026-10-12 on `bun-4-scripts`:** all 51 script files are `node:`-only (no `Deno.*` in code, no `@std` / `jsr:` imports), and the 20 tasks are `package.json` scripts. Bun runs them, except the engine oracles, which run on Node (§ "The engine oracle"); `proposals` picks an engine per proposal. tsc checks `scripts/`. **Differential, old Deno vs new, same inputs:** every output identical, and every corpus tree byte-identical (core 7,422, legacy 29, translate-eh 29, proposals 874 files). Expected differences only: the `bump` usage line; the 4 `proposals` summary lines that now name their engine; `hostile`'s DEPTH table, which measures each runtime's stack (its mutation half is identical). Found: item 27 (an interp defect on `main`) and the gen_demo_bytes drift (below). **Original plan:** **Scripts on `node:` builtins, RUN BY BUN** (owner, 2026-10-12: "All of our scripts will now be run from bun instead of deno"; each `deno task` becomes a `package.json` script run by `bun run`). `Deno.Command` → `node:child_process`, `Deno.args` → `process.argv.slice(2)`, `Deno.exit` → `process.exit`, file I/O → `node:fs`. Not `Bun.*`: `node:` runs on Bun, Deno and Node, so each script can run on Deno and Bun with the outputs diffed, and we are not locked into a new runtime. Corpus scripts first, release scripts last. | each script prints the same thing under `deno run -A` and `bun`                |
| B5   | ✅ **DONE 2026-10-13** (§ "B5: the suite on node:test"): 346 files on `node:test`, Deno.* gone from tests, `bun run test` (Node 24, the verdict) and `bun run test:bun` (Bun, 36 listed JavaScriptCore differences) in CI. As planned: **Tests on `node:test`, run by both Bun and Node** (§ "Bun or Node", DECIDED 2026-10-12). `@std/testing/bdd` → `node:test`'s `describe` / `it` (required: bdd calls `Deno.test`, finding 3a), `Deno.test` → `test`. `@std/assert` and `@std/expect` STAY, by their bare names through JSR's npm layer (finding 3): fewer lines change, and JSR stays the source of our test dependencies too. **Decided 2026-10-13 (owner):** `@std/assert` / `@std/expect` are KEPT via JSR (the same "leave it on JSR until necessary" stance as open-work 29; vendoring is the fallback), and **Node 24, the V8 referee, is AUTHORITATIVE for the suite** (220 test files use the host engine), with Bun also running it as a portability leg and a measured, listed set of JavaScriptCore-only differences. The 6 `Deno.permissions` probes go. The 6 `t.step` uses become nested `describe`. **Proof: the per-file test counts match** the last Deno run, and an injected failure fails. | ✅ per-file counts equal (346 files, 5,901 leaves); an injected failure fails both legs |
| B6   | ◐ **PREPARED 2026-10-13 (owner: "proceed with B6"), PROOF PENDING A RELEASE** (§ "B6"). As planned: **CI and the release path on Bun.** `ci.yml` gates with `setup-bun`; the `runtimes` matrix KEEPS its Deno leg (consumers on Deno remain). `publish.yml` keeps `setup-deno` + `deno publish` for provenance (finding 2). `auto-tag` reads `jsr.json` without Deno. `deno task …` → `bun run …` in the gate list in [working-rules.md](working-rules.md). | one release published from the new path, provenance verified (`rekorLogId`)    |
| B7   | ✅ **DONE 2026-10-13** (§ "B7"; owner: "proceed with item 26"). As planned: **Delete `deno.json` and `deno.lock`.** `--config jsr.json` comes off the publish commands, since `jsr.json` is then found on its own. `version_sync`'s second test turns into "there is no `deno.json`". `cmem/` updated throughout. | gate green with no `deno.json` in the tree                                     |

**B6 is the only step that is hard to undo**, because a JSR version is immutable. The other
steps can sit on `main` in any order after their predecessor, unreleased, behind the usual merge.

## B3 lint: Biome and the tsc lint flags (2026-10-13)

Owner: "we need to add the tsc lint flags and use Biome to replace deno lint", and "lets add that
to the bun migration notes".

**The tsc lint flags**, in `tsconfig.json`, and all but one in `deno.json` (so `deno check` holds
`tests/` to them until B5; Deno 2.9.7 does not support `noUncheckedSideEffectImports` and warned
"The following options were ignored" on every run, so that one is tsc-only): `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, `allowUnreachableCode: false`, `allowUnusedLabels: false`,
`noUncheckedSideEffectImports` (the `@tsconfig/strictest` set; `noImplicitReturns` and
`noFallthroughCasesInSwitch` were already on). Measured on the tree first: only two found
anything.
- `noUnusedLocals`: 2 in `src/` (`const _exhaust: never = e`, the exhaustiveness idiom, which
  the flag counts as unread). Now `e satisfies never;`, the same compile-time check, and erased.
  In `tests/`: 5 helpers never called, removed after a grep (`_`-prefixed names exempt
  parameters, not functions), plus the 4 imports only they used.
- `noPropertyAccessFromIndexSignature`: 17 in `src/` and `scripts/` and 417 in `tests/` (mostly
  `instance.exports.add`, an index-signature type). Rewritten to `x['key']` by a fixer that took
  each position from the checker and refused a site whose name or dot did not match.

**Biome 2.5.14** (pinned exact; 2.5.15 was 12 days old) replaces `deno lint`: `biome.jsonc`,
`bun run lint` (`biome lint --error-on-warnings`), CI's Lint step. The LINTER only: Biome's
formatter is off (formatting is B3's other half) and so is import sorting. Scope = `deno lint`'s
(`src/`, `tests/`, `scripts/`, `main.ts`, not the vendored `tests/wabt-ts/wasmtk`). Biome's
recommended set first found 2,257 diagnostics in 378 files; each rule was read before deciding:

| rule | sites | decision, and why |
| --- | --- | --- |
| `noNonNullAssertion` | 1,510 | off: `x[0]!` is the idiom `noUncheckedIndexedAccess` produces; `deno lint` never banned it |
| `useLiteralKeys` | 458 | off: CONTRADICTS `noPropertyAccessFromIndexSignature` (it wants `obj.key`, tsc wants `obj['key']`) |
| `useTemplate` | 154 | off: style; `deno lint` never had it |
| `useIterableCallbackReturn` | 24 | off: expression-bodied `forEach` callbacks, style |
| `noVoidTypeReturn` | 22 | off: `if (…) return this.shortSection();`, a deliberate early return |
| `noExplicitAny` | 21 | ON (deno's `no-explicit-any`): the 21 `deno-lint-ignore` comments became `biome-ignore` with a reason. With them removed, Biome reports exactly those 21 and nothing else (owner asked to see it). **All 21 then FIXED in the code, 2026-10-13** (below) |
| `noAssignInExpressions` | 19 | off: the memo idiom `map.set(k, s = new Set())`; deno's `no-cond-assign` only covered conditions |
| `noImplicitAnyLet` | 15 | off: TS types an unannotated `let` from its assignments; tsc's noImplicitAny reports a true implicit any |
| `useSimpleNumberKeys` | 9 | off: wants opcode keys like `0xfc` in decimal |
| `useImportType` | 6 | fixed (Biome's safe fix): imports used only as types became `import type` |
| `useOptionalChain` | 6 | off: the rewrite turns `boolean` into `boolean \| undefined` (Biome calls it unsafe) |
| `noShadowRestrictedNames` | 2 | fixed: locals `valueOf` → `valueOfExpr`, `escape` → `markEscaped` |
| `noCommaOperator`, `noUselessStringRaw`, `useFlatMap`, `useRegexLiterals`, `noGlobalIsFinite`, `noPrototypeBuiltins` | 1–2 each | fixed (`Number.isFinite`, `Object.hasOwn`, `flatMap`, a regex literal, …) |
| `noUnusedVariables` | 1 | fixed: `funcImportIdx` in `validator.ts`, incremented but never read (tsc counts `x++` as a read) |
| `noApproximativeNumericConstant` | 1 | was `biome-ignore` (the test's `3.14159` is WAT input, not π); the test now uses `3.25`, 2026-10-13 |

**deno lint rules kept on purpose:** `require-await` → `useAwait`, `no-var` → `noVar`, `prefer-const`
→ `useConst`, enabled explicitly; 0 sites today (`require-await` caught 7 during B4). Measured
with the explicit lines removed: `useAwait` and `noVar` are NOT in Biome 2.5.14's recommended
preset (they go silent), while `useConst` IS (its line is kept so a future preset cannot drop it
unseen). **Not carried over** (deno did not
enforce them, and Biome's versions find code deno allowed): `noNamespace` (it flags the 20
type-only namespaces of the enum conversion), `noParameterAssign` (32), `noEmptyBlockStatements`
(34, broader than deno's `no-empty`).

**Checked, not assumed:**
- `biome lint --only=<rule>` runs a rule that is NOT enabled: shown on planted cases before
  trusting its zero counts.
- ⚠️ `biome migrate` (2.5.14) rewrote `"recommended": true` as `"preset": "none"`, which switches
  every rule OFF. The config says `"preset": "recommended"` explicitly. A planted file shows the
  rules really run (`useAwait`, `noVar`, `useConst`, `noExplicitAny`, `noUnusedVariables`,
  `noDebugger` each fire).
- The wiring test "keeps scripts/ inside the gate" reads biome.jsonc's scope now (and tsc's), and
  fails when `scripts/**` is removed from it.

**Every adjustment, where it landed (2026-10-13; owner: "make sure to add all of these adjustment
notations to the bun migration file"):**
- **`package.json`:** dev dependency `@biomejs/biome` 2.5.14 (exact). Script `lint` = `biome lint
  --error-on-warnings && bun scripts/check-lint-canary.ts`. The version came from the npm
  registry's own release dates, because `npm` left PATH with scoop's Node: 2.5.15 was 12 days
  old, under the two-week rule. `bun.lock` was generated on C: and copied back, because D:'s exFAT
  cannot take Bun's lockfile rename (`cmem/local/environment.md`).
- **`biome.jsonc`** (new; `biome.json` deleted): scope, `"preset": "recommended"` spelled out, each
  disabled rule with its reason and count, the three parity rules enabled, formatter and assist
  off. The vendored folder is excluded as `!tests/wabt-ts/wasmtk` (folder form; Biome flagged the
  `/**` form with `useBiomeIgnoreFolder`).
- **`deno.json`:** the `lint` section and the `lint` task REMOVED. Six of the seven tsc lint flags
  were added to `compilerOptions`, for `deno check` over `tests/`. Not `noUncheckedSideEffectImports`:
  Deno 2.9.7 ignores it and warns on every run (seen in the gate's Deno smoke step).
- **`tsconfig.json`:** the seven tsc lint flags.
- **`.github/workflows/ci.yml`, gates job, reordered:** Install Deno → **Install Bun** → **Install dev
  dependencies** (`bun install --frozen-lockfile`) → Format check (`deno fmt --check`) → **Lint
  (`bun run lint`)** → Type-check (`deno task check`) → Type-check (`bun run check`). Bun used to be
  installed after the lint step, and the dev dependencies only inside the tsc step.
- **`cmem/working-rules.md`:** the gate list says `bun run lint` (it said `deno lint`).
- **`tests/wabt-ts/scripts/publish_preflight_wiring.test.ts`:** "keeps scripts/ inside the gate"
  reads `biome.jsonc` (and `tsconfig.json`) instead of `deno.json`'s lint include. Shown to fail
  when `scripts/**` leaves Biome's scope.
- **Ignore comments:** the 21 `// deno-lint-ignore no-explicit-any` became `// biome-ignore
  lint/suspicious/noExplicitAny: <reason>` (Biome requires a reason). 17 are in `tests/` ("test code
  reads untyped IR or engine values") and 4 in `scripts/` ("a diagnostic script reads …": three
  `scripts/binaryen-ts/diag_*.ts` and `check-translate-eh.ts`). The first conversion called all 21
  test code; the list from the removal test corrected that. With the comments removed, Biome
  reports exactly those 21 `noExplicitAny` and nothing else. One new `biome-ignore`:
  `noApproximativeNumericConstant` on a test's `3.14159`. **Superseded the same day: all 22 were
  fixed in the code and no `biome-ignore` remains** ("The 22 suppressions, removed", below).
- **Dead `deno-lint-ignore-file no-import-prefix` comments, 4, DELETED** (owner, 2026-10-13: "yes
  delete the comments if they no longer apply"): `comparison/scripts/` `diag_roundtrip.ts`,
  `diff_wat.ts`, `headtohead_bench.ts`, `trace_failing.ts`. They never applied: `comparison/` was
  outside `deno lint`'s scope, and is outside Biome's. ⚠️ **Corrected 2026-10-13:** "outside `deno
  lint`'s scope" was never measured, and B3's formatting half found that `deno fmt` DOES cover
  `comparison/` as a workspace member, whatever the root's `include` says; `deno lint` probably
  did too, so the comments may have applied. Deleting them stands: `deno lint` no longer runs. Tested on scratch copies first: Biome
  reports nothing without them (a planted `any` / `var` proved the run live). The reason half of
  each comment (the npm: import of upstream binaryen is deliberate) stays as a plain comment.
  `comparison/` stays OUT of Biome's scope; adding it was asked and not taken up. No
  `deno-lint` text remains in the code.
- **Code fixes, by rule:**
  - `useImportType`: `src/ir/ir.ts`, `src/parser/token.ts`, `src/parser/wast-parser.ts`,
    `src/tools/wasm2ts.ts`, `scripts/check-direct-behaviour.ts` (6 imports);
  - `noShadowRestrictedNames`: `constant-propagation.ts` `valueOf` → `valueOfExpr`;
    `dead-argument-elimination.ts` `escape` → `markEscaped`;
  - `noUnusedVariables`: `validator.ts` `funcImportIdx` removed;
  - `noCommaOperator`: `passes/flatten.ts`, `branch_operand_order.test.ts`;
  - `noGlobalIsFinite`: `core/literal.ts` → `Number.isFinite`;
  - `noPrototypeBuiltins`: `passes/asyncify.ts` → `Object.hasOwn`;
  - `useRegexLiterals` and `noUselessStringRaw`: `scripts/check-operator-mapping.ts`;
  - `useFlatMap`: `name_section.test.ts`.
- **tsc-flag fixes:** `noUnusedLocals`: `ir/expr-visitor.ts`, `ir/ir-util.ts` (`satisfies never`);
  tests `binary-reader.test.ts` (3 helpers + 2 imports) and `validator.test.ts` (2 helpers + 2
  imports). `noPropertyAccessFromIndexSignature`: 17 sites in `scripts/check-spec-behaviour.ts`,
  `scripts/definitions.ts`, `src/passes/remove-unused-types.ts`, and 417 in 153 test files.
- **The session's gate runner** (scratch): `lint (biome)` after `bun install --frozen-lockfile`.

**The lint canary, so a silenced linter fails at once (2026-10-13).** The loader's session raised
the same `biome migrate` trap in its own `cmem/linting.md`, with "rerun that test after any
Biome upgrade". A reminder gets skipped, so binaryang made the check AUTOMATIC:
`scripts/check-lint-canary.ts` runs after every lint (`bun run lint` = `biome lint
--error-on-warnings && bun scripts/check-lint-canary.ts`). It writes a snippet built to break six
rules (3 from the recommended preset: `noExplicitAny`, `noDebugger`, `noDoubleEquals`; and the
three parity rules) to a TEMPORARY file under `src/`, lints it through the project's config,
always deletes it, and fails unless every rule fired. Shown: the real config passes, and
`"preset": "none"` fails, naming the three recommended rules. Without the explicit `useAwait` /
`noVar` lines it fails, naming those two.
- stdin does NOT work for this: Biome 2.5.14's `lint --stdin-file-path` echoes the input back
  and reports no diagnostics (measured). The canary's first version used it and failed even on
  the real config, which is how that was found.
- The temporary file is not gitignored on purpose: Biome honours `.gitignore` and would skip it.
- **The canary is the ONLY guard.** Until 2026-10-13 `"preset": "none"` also failed by accident
  (the `biome-ignore` comments became "suppression comment has no effect" warnings). The last
  suppression went that day; measured after: with `"none"`, `biome lint --error-on-warnings`
  passes on all 521 files, and the canary fails naming 3 rules.
- ⚠️ A mutant that silently does nothing proves nothing: the first attempt to remove the explicit
  rules was a text replace that matched nothing, and it "showed" all six still firing. The probe
  that settled it asserts the lines are gone before running.

**The 22 suppressions, removed (2026-10-13).** Owner: "I want to make sure that the
'biome-ignore' comments are necessary. Can we remove them and run the linter … I am hoping that
the issues that were issues are either corrected or addressed in other ways", then "Yes do all
22". With the comments stripped (a scratch probe, tree restored), all 22 still fired (21
`noExplicitAny`, 1 `noApproximativeNumericConstant`): none was stale. Each was then fixed in the
code; **no `biome-ignore` remains**, and `bun run lint` passes.

- **The tree walkers (11 sites, 5 files):** `all` / `first` in `derive_types`, `name_references`,
  `call_indirect_arity`, `phantom_branch_value`, `function_label_arity` were five copies of one
  walk returning `any`. Now ONE typed module, **`tests/expr_walk.ts`**: `allOf(root, kind)` /
  `firstOf(root, kind)` return `ExprOf<K>`, the `W.Expr` member(s) whose `kind` includes `K`. Not
  `Extract<W.Expr, {kind: K}>`: one member covers two kinds (`'any.convert_extern' |
  'extern.convert_any'`) and `Extract` dropped it (`never`). Each file keeps its own parse step.
  `ExprOf` was proven by a type probe (scratch): it finds the two-kind member, narrows `'br'` to
  exactly `BrExpr`, rejects a field `BrExpr` lacks, rejects an unknown kind, and is narrower than
  `W.Expr` (a union-typed `const` is narrowed by its initializer, so that last check needs a
  parameter: the probe's first version passed wrongly).
- **What the types found, that `any` had hidden:**
  - `asyncify.test.ts`: a function `body` built as a `block` behind `as any`. A body is a
    `RegionExpr`; it is now `makeRegion([...], ValType.I32)`, the block's contents. 16 tests pass.
  - `name_references.test.ts`: `all(f.body, 'br_on_null')[0]?.target ?? all(f.body, 'br_on')…`.
    `'br_on_null'` is no kind (the null and cast pairs merged into `br_on`), so the first half
    could never match. Now `all(f.body, 'br_on')[0]!.target`.
  - `derive_types.test.ts`: expected values (`I31_REF`, `typed`, `refS`) were untyped literals
    whose `kind` widened to `string`; now `W.RefValueType`. A deliberate write to a readonly
    `fieldVar` (the test corrupts it) is now an explicit, commented cast.
  - `call_indirect_arity.test.ts`: `operands[0].value.value === 1` → `assert(arg.kind ===
    'const')` and `assertEquals(arg.value, constI32(1))`, which checks the type as well.
  - `noUncheckedIndexedAccess` reached the walkers' results: `[0]!` (the repo idiom), and
    optional fields (`tag` of a catch, `delegate`) asserted where the test knows they are set.
- **Structure scans (2):** `findMemidx` (`atomic_memidx`) and `nameVars` (`table_get_index`) look
  at ANY object, not one kind: `unknown` plus a narrowed view, return types unchanged.
- **`WebAssembly.Exception` (3):** `check-translate-eh.ts` and `translate_eh.test.ts` cast
  `WebAssembly as any`. ⚠️ The session first said neither checker types `Exception` / `Tag`
  (a grep of the `.d.ts` files found no `getArg`). WRONG: TypeScript 7 builds its lib into the
  compiler. A probe passed in `deno check` and tsc (`--lib esnext,dom`), with a negative control
  proving the check live. Now `instanceof WebAssembly.Exception`, `tag instanceof
  WebAssembly.Tag && err.is(tag)`. The tests assert payloads (`thrown(20)`, …), so the path runs.
- **Printers (4):** `irToString` (`optimize_fuzz`) and the three `dump`s in
  `scripts/binaryen-ts/diag_*.ts`: `unknown`, a narrowed view, an `isNode` guard. Output proven
  identical, old vs new, over every function body of every `.wat` under `tests/` (421 files,
  7,620 bodies; 9.7 M chars for `irToString`, 1,018,243 lines for `dump`). The `diag_*` scripts
  read `upstream/test/`, absent on this machine, so they were not run end to end.
- **`noApproximativeNumericConstant` (1):** `wat2wasm.test.ts`' `3.14159` → `3.25`, in the WAT
  and the assertion (exactly representable; the round trip is tested as before).
- **The canary's comment** said the suppressions guarded `"none"` by accident; rewritten (above).

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

## B6: the release path off Deno, except the publish (2026-10-13; proof pending)

Owner: "proceed with B6". Done locally; **the acceptance — one release published from the new path,
provenance verified (`rekorLogId`) — waits for the owner's release** (1.11.0 is next).

- **`auto-tag.yml`:** `setup-bun` instead of `setup-deno`; the version from `jsr.json` by `bun -e`.
  No Deno at all.
- **`publish.yml`:** keeps `setup-deno` and calls `deno publish --config jsr.json` DIRECTLY (provenance:
  finding 2, publishing.md). Before it, the CI gate's tooling: `setup-bun` 1.4.3, `bun install
  --frozen-lockfile`, `setup-node` 24; `deno task check` (until B7) AND `bun run check`; `bun run
  test` (Node 24, the verdict) and `bun run test:bun` replace `deno task test`. The three `deno
  eval` one-liners (version, package name, the Rekor ID parse) are `bun -e`, each shown to give
  the same output (a non-JSON body still yields an empty line).
- **`scripts/release/publish.ts`** (the local release) adds `bun run check` after its cold `deno
  task check`, so it refuses what publish.yml would fail; its closing message names the new steps.
- **Held by tests** (`publish_preflight_wiring.test.ts`, a new describe): publish.yml publishes with
  `deno publish --config jsr.json` and never `bunx` / `npx jsr` or a `release` task; both type
  checks and both test legs run BEFORE the publish, and `deno task test` is gone; auto-tag has no
  Deno. Each shown to fail on its mutant of the real file.
- All three workflows parse (`Bun.YAML`), with the steps in the intended order. CI's `runtimes`
  matrix keeps its Deno leg (consumers on Deno remain).
- ⚠️ A trap met: writing the new test through an inline `bun -e` stripped every backslash (`\s` → `s`,
  `\b` → a literal backspace byte), which the editor's view does not show. A parse error caught
  one; the rest would have been regexes that quietly match the wrong thing. It struck TWICE: this
  very note, first written the same way, carried a backspace byte where `\b` should be, and the
  gate's `source_hygiene.test.ts` (no control bytes in any file) failed both test legs on it. Any
  text holding a backslash (code, a regex, prose ABOUT escapes) goes through the Write / Edit
  tools, never a shell string.

## B5: the suite on `node:test` (2026-10-13)

Owner: "move on to 26 and 28"; decided: `@std/assert` / `@std/expect` KEPT via JSR, and **Node 24
(the V8 referee) authoritative**, Bun too, with its engine differences listed.

- **Baseline first, per file.** Deno's JUnit reporter records only TOP-LEVEL tests (a whole
  `describe` is one case), so it cannot count. The default reporter, parsed for LEAVES (a test or
  step with no children): **346 files, 5,901 leaf tests**. Every later run was diffed against it,
  file by file.
- **Step 1, mechanical (merged `578835cfb`):** 291 files `@std/testing/bdd` → `node:test` (all
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
  test`, whose failures must be EXACTLY `tests/bun-known-differences.json` (36: memory64 / table64
  24, multi-memory index ≥ 127 5, legacy-EH `delegate` 5, an error's wording 2): an unlisted
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

## B3 formatting: dprint replaces `deno fmt` (2026-10-13)

Owner: "move on to 26 and 28". `deno fmt` IS dprint, so the question was only whether dprint can
be configured to match it byte for byte. Measured, then switched.

- **Versions, from Deno 2.9.7's own `Cargo.lock`** (tag `v2.9.7`): `dprint-plugin-typescript`
  0.96.1, `dprint-plugin-json` 0.21.3, `dprint-plugin-markdown` 0.20.0. Those exact plugin builds,
  pinned by SHA-256 in `dprint.json`. The CLI is `dprint` 0.57.4 from npm (2026-09-05; the newest
  release over two weeks old; 0.63.0 was a day old), a dev dependency. It installs without its
  postinstall (the binary is a per-platform optional package).
- **Settings:** each plugin `"deno": true` (Deno's preset) plus `lineWidth` 100, `indentWidth` 2,
  `useTabs` false, and `quoteStyle: "preferSingle"` (what `singleQuote: true` maps to).
- **The scope had a hidden member.** `deno fmt --check` said "Checked 532 files" where the
  include list held 522. The other 10 are `comparison/`, a WORKSPACE MEMBER with no `fmt` section:
  `deno fmt` formats a member's files whatever the root's `include` says. Shown by planting a
  misformatted file there (533, and it failed). `dprint.json` includes `comparison/**`.
- **Proof, a differential, not a green check:** all 532 files copied to scratch trees, damaged
  the same way, formatted by `deno fmt` and by dprint, compared byte for byte. As-is: 0 differ.
  Indentation stripped (216 files changed): 0 differ. CRLF everywhere: 0 differ. Import specifiers
  double-quoted (508 files): 0 differ. `deno-fmt-ignore-file` (`src/wasm/demo_bytes.ts`) is honoured
  by dprint's Deno preset: a damaged copy stayed untouched while a plain file beside it changed.
- **The canary, `scripts/check-fmt-canary.ts`**, after every `dprint check` (`bun run fmt:check`):
  dprint must list ≥ 500 files; a planted double-quoted file MUST be reported; a correct 92–98
  column line must NOT be; a 103–108 column one MUST be. Shown: the real config passes, and it fails
  for quoteStyle removed, lineWidth 80, lineWidth 120, lineWidth removed, and an includes typo.
  Two traps met building it: matching the canary's path anywhere in the output matched a diff of
  the canary script ITSELF (only `from <path>:` header lines count now), and dprint's output has
  colour codes and CRLF (stripped before matching).
- **`scripts/definitions.ts`** formats the generated `data.ts` with `dprint fmt --stdin
  src/definitions/data.ts` (was `deno fmt --ext=ts -`). `definitions --check` passes, and a
  mutant that skips formatting fails it, so the formatter is on that path.
- **Wiring:** `package.json` scripts `fmt` / `fmt:check` and the dev dependency; `bun.lock`
  (generated on C:, the exFAT rule); CI's Format check is `bun run fmt:check`, after the install;
  `deno.json` loses the `fmt` / `fmt:check` TASKS but KEEPS its `fmt` options until B7, so a
  Deno-aware editor that formats on save produces dprint's bytes, not width-80 double quotes;
  `biome.jsonc`'s header; working-rules' gate list.
- **dprint is safer on cmem than `deno fmt`:** given a path outside its includes
  (`dprint check cmem/INDEX.md`) it refuses ("No files found", exit 14) instead of formatting it.
  Still: cmem is edited by hand.

## The engine oracle — Bun's WebAssembly is NOT V8 (found in B4, 2026-10-12)

**Bun runs WebAssembly on JavaScriptCore (Safari's engine). Deno and Node run it on V8.** Several
gate steps use the HOST engine as an oracle: `WebAssembly.validate` / `Module` / `Instance` decide
whether our output is valid and whether it computes the same thing. Moving such a step from Deno to
Bun silently swaps the oracle.

Measured 2026-10-12: every `.wasm` in the prepared corpora, validated by each runtime's own engine
(Deno 2.9.7, Node 24.21.0, Bun 1.4.3):

| corpus              | modules | Deno (V8) vs Node (V8) | Deno (V8) vs Bun (JavaScriptCore) |
| ------------------- | ------- | ---------------------- | ---------------------------------- |
| core spec           | 5,924   | **0 differ**           | **297 differ**                     |
| legacy EH           | 18      | 0                      | 1                                  |
| `proposals/` (four) | 811     | 0                      | 2                                  |

What JavaScriptCore does differently:
- **no memory64 / table64**: it refuses 227 core modules V8 accepts (`memory64-imports` 62,
  `memory_init64` 29, `align64` 26, `table_copy64` / `memory_copy64` 22 each, …);
- **it accepts 70 core modules the spec says must be REJECTED**: 64 in `unreached-invalid`, plus 6 in
  `call_ref` / `return_call_ref` / `return_call_indirect` / `table`;
- no legacy `try_delegate` (1); `wide-arithmetic` on by default, where V8 needs a flag (2).

So JavaScriptCore is a weaker oracle on BOTH axes, and Node 24's V8 is a drop-in for Deno's.
**Rule: a script that runs modules on the host engine runs on a V8 REFEREE, not on Bun.** That is
`direct`, `direct-behaviour`, `translate-eh`, `optimize-corpus`, `spec-behaviour`, `offsets`,
`engine-check`, `hostile` (its depth table measures the stack, and the recorded ceilings are V8's),
and the behaviour half of `proposals` (per row: `engine` in `scripts/proposals.ts`). Everything else
runs on Bun. The owner's both-runtimes rule is what makes the referee a WIRING choice
(`package.json`), not a code change.

✅ **The referee is NODE, through fnm; Deno is for JSR only** (owner, 2026-10-12: "I am looking
at deno to run the jsr items specifically. Not the V8 items"). `scripts/v8.ts` names the referee
once (`REFEREE = 24`) and runs a script on that Node through `fnm exec`, never the `node` on PATH
(this machine's fnm default is 22, whose V8 fails these gates). `package.json` runs every oracle
step through it: `direct`, `direct-behaviour`, `translate-eh`, `optimize-corpus`, `spec-behaviour`,
`offsets`, `hostile`. `proposals` picks per row: the referee by default, **Node 26** for
custom-descriptors (Node 24's V8 13.6 refuses 9 of its originals), and **Bun** for wide-arithmetic
(no Node has it yet). Measured the same day against Deno 2.9.7 (V8 15.0), the engine these gates
were calibrated on: Node 24 gave Deno's exact output on every oracle step, and Node 26 gave it on
custom-descriptors (488 invocations, 19 modules, 0 DIVERGE, the same 14 refused variants).
🔧 History, the same day: B4 first wired the oracles to Node 24. The owner then chose Node 22 only
(it cannot referee, next paragraph), so they moved to Deno. Node 24 came back through fnm, and with
the JSR-only decision they moved to Node for good.

**No deadline (owner, 2026-10-12).** 🔧 This section once claimed "a NEW V8 referee before about
2027-04", tying the referee to Node 22's end of life. That was wrong: the referee is Deno, not
Node 22. The owner's position:
- **Node 22's end of life changes nothing.** "The lts will revise to the latest, which will exclude
  node 22": `bun run lts` follows Node's release schedule, and CI's matrix the same policy.
- **Deno stays usable as it is.** The end of its development does not remove the binary. The
  toolchain has moved to Bun; for publishing, "hopefully a better jsr interface will exist by then,
  if not we will continue to use deno as is." That is Deno's whole remaining role: JSR
  (`deno publish --config jsr.json` and its dry run), "not the V8 items".

**The referee moves with the LTS line, after measuring.** To raise `REFEREE` to a newer Node:
validate the whole corpus on old and new, diff the verdicts, run the behaviour gates, then change the
one constant. A NEW experimental proposal that no referee has gets its own row engine (a Node major,
Bun, or a browser once open-work 28 part 3 provides a runner: Chrome stable is V8 15.6).

**Which Node referees: Node 24, NOT Node 22 (measured 2026-10-12).** The owner considered moving
this machine to Node 22, the oldest LTS (maintenance until 2027-04-30). Node 22.23.3 ships V8
**12.4**. It differs from Deno on **71** core modules (no table64; part of memory64 imports), and
`spec-behaviour` on it FAILS: **11 DIVERGE, 32 originals refused**. Node 24.21 (V8 13.6) gives 0 /
0 on the same 57,808 invocations. So Node plays two roles that must not be confused:
- **the support FLOOR** (the oldest Node the published package promises): 22.18, tested by CI's
  `runtimes` job (the CLI on Node 22.18). Unchanged.
- **the engine REFEREE for development** (the `node` that `bun run` hands the oracle scripts):
  the NEWEST Node that still runs the source, Node 24 until 2028-04-30 (Node 26 cannot run
  it: no `--experimental-transform-types`). If this machine's default `node` becomes 22, the
  oracle steps go red for engine reasons, not ours. **Decided, 2026-10-12: Node 22 only on this
  machine, so the referee is Deno** (above). 🔧 **Superseded the same day:** the owner reinstalled
  Node 24 beside 22 ("We should support and test all currently available lts versions",
  open-work 28), then fnm took over Node (22, 24 and 26). Then the owner decided Deno is for JSR
  only, "not the V8 items", so the referee is **Node 24 through fnm** (`scripts/v8.ts`), above. The
  11 DIVERGE on V8 12.4 were not investigated: an old-engine artefact until shown otherwise.

**For B5:** 220 test files call the host engine too. On Bun those assertions meet JavaScriptCore;
on Node, V8. The suite therefore has to pass on Node as it does on Deno today, and any difference
on Bun gets classified (engine gap vs our defect) rather than pinned blind. JavaScriptCore as an
EXTRA engine has value, for the owner's rule "refuse what will not run on all platforms"
(divergences V1–V4). It is not a replacement for V8.

## Bun or Node for development — DECIDED (owner, 2026-10-12)

✅ **Owner, 2026-10-12: "We want code that runs on both, but bun as the main runtime."** So: code that runs on both Bun and Node, with Bun as the main runtime.
Concretely: scripts use `node:` builtins and web standards, never `Bun.*` (B4). Tests use
`node:test` + `@std/expect` + `@std/assert`, never `bun:test` (B5). Types come from
`@types/node`, not `@types/bun`, so a Bun-only API fails the type check instead of slipping
in. Daily commands run on Bun. CI gates on Bun AND Node. The evaluation that led here
follows, unchanged.

The owner's question: should the development runtime be Node + TypeScript instead of Bun, and
would choosing Bun lose anything? The owner leans towards Bun ("no" to Node-first) and wants this
evaluation first.

**TypeScript is needed either way.** Neither Bun nor Node type-checks: both strip the types and
run the file. `tsc` (7.0.2, `latest` on npm, 2026-10-12) takes over `deno check` under either
runtime. So the real choice is the runtime, the test runner and the package manager, not "Bun
or TypeScript".

**Consumers are unaffected either way.** JSR serves Node and Bun compiled JavaScript with
`.d.ts`. Measured 2026-10-12: `npx jsr add` / `bunx jsr add`, then the installed `main.js` runs
the CLI with no flags on Node 24.21, Bun 1.4.3 and Deno 2.9.7. All three wrote identical
`wat2wasm` bytes, and `wasm-opt -Oz` ran on Node.

Measured on this tree, 2026-10-12:

| question                                      | Bun 1.4.3                                    | Node 24.21                                                                                                          |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| runs our TypeScript source as written         | yes                                          | 🔧 **yes since open-work 28 part 4 (2026-10-12), no flag, Node 22–26.** As measured that day: **no**: default type stripping crashes on `main.ts`. It needs `--experimental-transform-types` (20 `enum`s in 11 files, parameter properties in 7). Removing them would change exported types such as `BinaryOp` and `ValType` |
| CLI start, whole tree loaded (median of 5)    | **106 ms**                                   | 581 ms (with the flag); Deno 184 ms                                                                                  |
| test runner                                   | `bun:test` (Bun only), or `node:test`        | `node:test`                                                                                                          |
| one suite on both                             | `node:test` + `@std/expect` + `@std/assert`: nested `describe`, `before`, `it.skip`, async, one deliberate failure gave **identical verdicts** on both (2 pass / 1 fail / 1 skip) | same                                    |
| package manager, JSR                          | `bun install`; `bunx jsr add`                | `npm`; `npx jsr add` (pnpm 10.9+ / yarn 4.9+ take `jsr:` natively)                                                  |
| who governs it, and how long it lasts         | one company: Anthropic, since 2025-12 ([announcement](https://www.anthropic.com/news/anthropic-acquires-bun-as-claude-code-reaches-usd1b-milestone)). MIT-licensed, and Anthropic runs its own products on it. No published support schedule | OpenJS Foundation, with a published LTS schedule and end-of-life dates |

**What Bun would cost compared with Node:**
1. **Continuity**, the reason for this migration. Deno is ending because one company made a
   business decision, and Bun is also owned by one company. Its owner depends on it (Claude
   Code runs on Bun), which Deno's owner did not, but that is a reason, not a guarantee. Node is the runtime with a
   foundation behind it and published end-of-life dates. (This evaluation was written by Claude,
   an Anthropic model. Bun is an Anthropic product. Weigh the row above with that in mind.)
2. **Node is where most consumers run.** If development happens on Bun, a Node-only difference
   is seen only by CI's `runtimes` leg.

**What Node would cost compared with Bun:** running the source needs an experimental flag (or
an exported-type change to remove the `enum`s). Startup is about 5× slower, and so is every
script and test file that starts a runtime. The tools are separate pieces (npm, tsc, a test
runner) where Bun has one binary.

**Recommendation: write for both runtimes, run on Bun, and gate on both.** Nothing in the
code then depends on the answer. Scripts use `node:` builtins (B4, already planned). Tests use
`node:test` + `@std/expect` + `@std/assert` rather than `bun:test` (B5). Our tests use no
hooks, mocks or snapshots, measured, so we lose nothing Bun's partial `node:test` lacks. Bun is
the fast daily runner. CI runs the suite on Bun AND on Node (no flag since open-work 28 part 4,
2026-10-12: the source is erasable TypeScript). If Bun ever goes the way of Deno, the switch is a CI
matrix edit, not a second migration. (Adopted, as stated at the top of this section.)

Side finding, 2026-10-12: `deno run -A jsr:@jrmarcum/binaryang` with no version ran **1.8.1**
while JSR's latest was 1.10.0. That happened in a clean directory with `--no-lock`, from Deno's
cached copy of JSR's version list. `--reload=jsr:@jrmarcum/binaryang` did not refresh it; a full
`--reload` did. The no-install form runs whatever version the cache last saw. The install step
pins a version in a lockfile instead.

Side finding in B4, 2026-10-12, **not caused by the migration**: `scripts/binaryen-ts/gen_demo_bytes.ts`
does not reproduce the committed `src/wasm/demo_bytes.ts`, even in its old Deno form run on
unchanged `main`. The generator writes `@module binaryen-ts/wasm/demo_bytes` and "Source size: 145
bytes"; the committed file says `@module wasm/demo_bytes` and 82 bytes. The file was edited after the
one-tree move and the generator never followed, and no gate runs it. Old and new generators produce
IDENTICAL output (checked), so B4 changed nothing here. Fixing the drift (regenerate, or retire the
generator) touches a shipped file and is the owner's call.

Also deliberate in B4: the two generators' OUTPUT headers keep their old wording
(`deno task definitions` in `src/definitions/data.ts`; the `deno run …` line in
`src/wasm/demo_bytes.ts`). Those headers are part of shipped files, and `data.ts` is what consumers
check their copies against. Update them with the next intentional change to either file.

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
