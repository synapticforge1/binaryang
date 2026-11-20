# Bun migration — closed history, to 4.1.1

The finished steps of the Bun migration (item 26, closed 2026-10-13): the Deno-surface measurement, the plan table, the B3 lint adjustment log and suppression removal, B6. Moved from `cmem/bun-migration.md` on 2026-11-20 (H38 step 4).

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

## The plan — each step is one branch, gated, merged `--no-ff`

| step | what                                                                                                                                                                                                                    | done when                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| B1   | **`jsr.json` is the one package manifest.** `deno.json` loses `name` / `version` / `license` / `exports` / `publish`. The bump, release driver, entry check, `RELEASE_FILES`, the three workflows and `version_sync` read `jsr.json`. `version_sync` also fails if `deno.json` names the package again. | ✅ on `bun-1-jsr-manifest`, gate below                                         |
| B2   | **Bun project files next to Deno's.** ✅ Built 2026-10-12 on `bun-2-project-files`: `package.json` (private; dev dependencies `typescript` 7.0.2 and `@types/node` ~22.18, the Node floor; script `check`), `tsconfig.json` (deno.json's strictness flags, `types: ["node"]` so a Bun-only API fails), `bun.lock`, and a CI step `bun install --frozen-lockfile && bun run check`. **Scope, by decision:** `tsc` checks the SHIPPED code (`main.ts`, `src/`), 0 errors in 668 ms, and an injected `TS2322` fails it. tests/, scripts/ and comparison/ still use Deno globals; each joins `include` as B4 / B5 converts it, with its own `tsconfig` for the 3 `noUncheckedIndexedAccess: false` members. `.npmrc` / `@std` aliases and `dprint` / a linter come with B3 and B5, when something first needs them. `version_sync` also refuses `name` / `version` / `exports` / `bin` in `package.json`. ⚠️ On this machine's exFAT drive `bun install` cannot write `bun.lock` (`local/environment.md`). | ✅ `tsc` and `deno check` both green on the same commit                       |
| B3   | **Formatting and lint off Deno.** ✅ **LINT half done 2026-10-13 (owner: "add the tsc lint flags and use Biome to replace deno lint")**, see § "B3 lint: Biome and the tsc lint flags" below. ✅ **FORMATTING half done 2026-10-13 (owner: "move on to 26 and 28")**: dprint 0.57.4 replaces `deno fmt`, with the plugins Deno 2.9.7 bundles; byte-identical on the tree and on three damaged copies of it. See § "B3 formatting: dprint replaces deno fmt". (Biome's formatter stays OFF; it is a different style.) | lint: ✅; fmt: ✅ `dprint check` 0 diffs, differential 0 |
| B4   | ✅ **Built 2026-10-12 on `bun-4-scripts`:** all 51 script files are `node:`-only (no `Deno.*` in code, no `@std` / `jsr:` imports), and the 20 tasks are `package.json` scripts. Bun runs them, except the engine oracles, which run on Node (§ "The engine oracle"); `proposals` picks an engine per proposal. tsc checks `scripts/`. **Differential, old Deno vs new, same inputs:** every output identical, and every corpus tree byte-identical (core 7,422, legacy 29, translate-eh 29, proposals 874 files). Expected differences only: the `bump` usage line; the 4 `proposals` summary lines that now name their engine; `hostile`'s DEPTH table, which measures each runtime's stack (its mutation half is identical). Found: item 27 (an interp defect on `main`) and the gen_demo_bytes drift (below). **Original plan:** **Scripts on `node:` builtins, RUN BY BUN** (owner, 2026-10-12: "All of our scripts will now be run from bun instead of deno"; each `deno task` becomes a `package.json` script run by `bun run`). `Deno.Command` → `node:child_process`, `Deno.args` → `process.argv.slice(2)`, `Deno.exit` → `process.exit`, file I/O → `node:fs`. Not `Bun.*`: `node:` runs on Bun, Deno and Node, so each script can run on Deno and Bun with the outputs diffed, and we are not locked into a new runtime. Corpus scripts first, release scripts last. | each script prints the same thing under `deno run -A` and `bun`                |
| B5   | ✅ **DONE 2026-10-13** (§ "B5: the suite on node:test"): 346 files on `node:test`, Deno.* gone from tests, `bun run test` (Node 24, the verdict) and `bun run test:bun` (Bun, 36 listed JavaScriptCore differences) in CI. As planned: **Tests on `node:test`, run by both Bun and Node** (§ "Bun or Node", DECIDED 2026-10-12). `@std/testing/bdd` → `node:test`'s `describe` / `it` (required: bdd calls `Deno.test`, finding 3a), `Deno.test` → `test`. `@std/assert` and `@std/expect` STAY, by their bare names through JSR's npm layer (finding 3): fewer lines change, and JSR stays the source of our test dependencies too. **Decided 2026-10-13 (owner):** `@std/assert` / `@std/expect` are KEPT via JSR (the same "leave it on JSR until necessary" stance as open-work 29; vendoring is the fallback), and **Node 24, the V8 referee, is AUTHORITATIVE for the suite** (220 test files use the host engine), with Bun also running it as a portability leg and a measured, listed set of JavaScriptCore-only differences. The 6 `Deno.permissions` probes go. The 6 `t.step` uses become nested `describe`. **Proof: the per-file test counts match** the last Deno run, and an injected failure fails. | ✅ per-file counts equal (346 files, 5,901 leaves); an injected failure fails both legs |
| B6   | ✅ **DONE and PROVEN 2026-10-13: the 1.11.0 publish, provenance recorded (Rekor `3247643457`)** (§ "B6"; owner: "proceed with B6"). As planned: **CI and the release path on Bun.** `ci.yml` gates with `setup-bun`; the `runtimes` matrix KEEPS its Deno leg (consumers on Deno remain). `publish.yml` keeps `setup-deno` + `deno publish` for provenance (finding 2). `auto-tag` reads `jsr.json` without Deno. `deno task …` → `bun run …` in the gate list in [working-rules.md](../working-rules.md). | one release published from the new path, provenance verified (`rekorLogId`)    |
| B7   | ✅ **DONE 2026-10-13** (§ "B7"; owner: "proceed with item 26"). As planned: **Delete `deno.json` and `deno.lock`.** `--config jsr.json` comes off the publish commands, since `jsr.json` is then found on its own. `version_sync`'s second test turns into "there is no `deno.json`". `cmem/` updated throughout. | gate green with no `deno.json` in the tree                                     |

**B6 is the only step that is hard to undo**, because a JSR version is immutable. The other
steps can sit on `main` in any order after their predecessor, unreleased, behind the usual merge.

## B3 lint: Biome and the tsc lint flags (2026-10-13) — adjustment log and the 22 suppressions

**Every adjustment, where it landed (2026-10-13; owner: "make sure to add all of these adjustment
notations to the bun migration file"):**
- **`package.json`:** dev dependency `@biomejs/biome` 2.5.14 (exact). Script `lint` = `biome lint
  --error-on-warnings && bun scripts/check-lint-canary.ts`. The version came from the npm
  registry's own release dates, because `npm` left PATH with scoop's Node: 2.5.15 was 12 days
  old, under the two-week rule. `bun.lock` was generated on an NTFS disk and copied back, because the
  working disk's exFAT cannot take Bun's lockfile rename (`cmem/local/environment.md`).
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

## B6: the release path off Deno, except the publish (2026-10-13; PROVEN by 1.11.0, 2026-10-13)

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

