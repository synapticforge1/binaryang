# Bun migration — lint and formatting tools (Biome, tsc flags, dprint)

Summary: why Biome and dprint are configured as they are, and the canaries that keep them honest. Last verified 2026-11-20.
The main file is [bun-migration.md](bun-migration.md); the Deno role, the test runner and B7/B8 are in [bun-migration-deno-tests.md](bun-migration-deno-tests.md).

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

- **rule:** `noNonNullAssertion`
  - sites: 1,510
  - decision, and why: off: `x[0]!` is the idiom `noUncheckedIndexedAccess` produces; `deno lint` never banned it
- **rule:** `useLiteralKeys`
  - sites: 458
  - decision, and why: off: CONTRADICTS `noPropertyAccessFromIndexSignature` (it wants `obj.key`, tsc wants `obj['key']`)
- **rule:** `useTemplate`
  - sites: 154
  - decision, and why: off: style; `deno lint` never had it
- **rule:** `useIterableCallbackReturn`
  - sites: 24
  - decision, and why: off: expression-bodied `forEach` callbacks, style
- **rule:** `noVoidTypeReturn`
  - sites: 22
  - decision, and why: off: `if (…) return this.shortSection();`, a deliberate early return
- **rule:** `noExplicitAny`
  - sites: 21
  - decision, and why: ON (deno's `no-explicit-any`): the 21 `deno-lint-ignore` comments became
    `biome-ignore` with a reason. With them removed, Biome reports exactly those 21 and nothing else
    (owner asked to see it). **All 21 then FIXED in the code, 2026-10-13** (below)
- **rule:** `noAssignInExpressions`
  - sites: 19
  - decision, and why: off: the memo idiom `map.set(k, s = new Set())`; deno's `no-cond-assign` only covered conditions
- **rule:** `noImplicitAnyLet`
  - sites: 15
  - decision, and why: off: TS types an unannotated `let` from its assignments; tsc's noImplicitAny reports a true implicit any
- **rule:** `useSimpleNumberKeys`
  - sites: 9
  - decision, and why: off: wants opcode keys like `0xfc` in decimal
- **rule:** `useImportType`
  - sites: 6
  - decision, and why: fixed (Biome's safe fix): imports used only as types became `import type`
- **rule:** `useOptionalChain`
  - sites: 6
  - decision, and why: off: the rewrite turns `boolean` into `boolean \| undefined` (Biome calls it unsafe)
- **rule:** `noShadowRestrictedNames`
  - sites: 2
  - decision, and why: fixed: locals `valueOf` → `valueOfExpr`, `escape` → `markEscaped`
- **rule:** `noCommaOperator`, `noUselessStringRaw`, `useFlatMap`, `useRegexLiterals`, `noGlobalIsFinite`, `noPrototypeBuiltins`
  - sites: 1–2 each
  - decision, and why: fixed (`Number.isFinite`, `Object.hasOwn`, `flatMap`, a regex literal, …)
- **rule:** `noUnusedVariables`
  - sites: 1
  - decision, and why: fixed: `funcImportIdx` in `validator.ts`, incremented but never read (tsc counts `x++` as a read)
- **rule:** `noApproximativeNumericConstant`
  - sites: 1
  - decision, and why: was `biome-ignore` (the test's `3.14159` is WAT input, not π); the test now uses `3.25`, 2026-10-13

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
  (generated on an NTFS disk, the exFAT rule); CI's Format check is `bun run fmt:check`, after the install;
  `deno.json` loses the `fmt` / `fmt:check` TASKS but KEEPS its `fmt` options until B7, so a
  Deno-aware editor that formats on save produces dprint's bytes, not width-80 double quotes;
  `biome.jsonc`'s header; working-rules' gate list.
- **dprint is safer on cmem than `deno fmt`:** given a path outside its includes
  (`dprint check cmem/INDEX.md`) it refuses ("No files found", exit 14) instead of formatting it.
  Still: cmem is edited by hand.

