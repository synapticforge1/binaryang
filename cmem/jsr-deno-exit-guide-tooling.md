# Leaving Deno, staying on JSR — what binaryang built: lint, format, tests, deno.json, no installed Deno

Biome and the tsc lint flags, dprint, `node:test`, deleting `deno.json`, Deno from npm, and the
traps s3d-reportcompiler measured. Split from [jsr-deno-exit-guide.md](jsr-deno-exit-guide.md) on
2026-11-20 (H38 step 5). Last verified 2026-11-20.

## 5a. What binaryang built for Bun, Node LTS and the web: copy these (2026-10-12)

Each item names the binaryang file to read (`../binaryang/…` from a sibling; read it, do not
write to it) and what was measured. All of it is on binaryang's `main`.

### Lint off Deno: Biome and the tsc lint flags (2026-10-13)

Full record: binaryang `cmem/bun-migration.md` § "B3 lint". What carries over:
- **tsc lint flags** (the `@tsconfig/strictest` set): `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `allowUnreachableCode: false`,
  `allowUnusedLabels: false`, `noUncheckedSideEffectImports`. Put them in `deno.json` too while
  `deno check` still covers your tests, all except `noUncheckedSideEffectImports`, which Deno 2.9.7
  ignores with a warning on every run. `const _x: never = e` counts as unused; write
  `e satisfies never;`.
- **Biome, pinned exact**, linter only (formatter and import sorting off unless you decide
  otherwise). Count the recommended set's findings per rule first, then decide each rule.
  ⚠️ **`useLiteralKeys` contradicts `noPropertyAccessFromIndexSignature`**: switch it off if you use
  that flag. `deno-lint-ignore X` comments become `biome-ignore lint/<group>/<rule>: <reason>` (a
  reason is required). **Better: fix them instead.** binaryang converted 21, then removed all 22
  (2026-10-13): untyped test tree walkers became one walker typed by `kind` (see binaryang's
  `tests/expr_walk.ts`, and `Extract` misses a member with two kinds), generic printers took
  `unknown`, and `WebAssembly.Exception` / `Tag` ARE typed in TypeScript 7 and Deno, so
  `WebAssembly as any` is unnecessary. The types then found an invalid IR shape and a dead branch
  that `any` had hidden. Once the last suppression is gone, the lint canary is your only guard
  against `"preset": "none"`.
- **`useAwait` and `noVar` are NOT in Biome's recommended preset** (deno's `require-await` and
  `no-var` were): enable them. `useConst` is in it.
- ⚠️ **`biome migrate` (2.5.14) rewrote `"recommended": true` as `"preset": "none"`**, which silences
  every rule. Write `"preset": "recommended"` yourself. **Make the check automatic, not a
  reminder:** binaryang's `scripts/check-lint-canary.ts` runs after every lint, lints a snippet built
  to break six rules from a TEMPORARY file under `src/` through the project's config, and fails
  unless all fire. It must be a real file: `--stdin-file-path` reports no diagnostics in 2.5.14.
  It must not be gitignored, because Biome honours `.gitignore`.

### Formatting off Deno: dprint, byte for byte (2026-10-13)

`deno fmt` IS dprint, so dprint can match it exactly. binaryang did it with 0 differing bytes.
- **Take the plugin versions from YOUR Deno's `Cargo.lock`** (`raw.githubusercontent.com/denoland/deno/v<version>/Cargo.lock`, the
  `dprint-plugin-typescript` / `-json` / `-markdown` entries), and pin those builds from
  `plugins.dprint.dev` by SHA-256. For Deno 2.9.7: 0.96.1 / 0.21.3 / 0.20.0.
- Each plugin gets `"deno": true` plus your `fmt` options; `singleQuote: true` is
  `quoteStyle: "preferSingle"`. `deno-fmt-ignore-file` is honoured by the Deno preset.
- ⚠️ **Count your scope first.** `deno fmt` formats a WORKSPACE MEMBER's files even when the
  root's `fmt.include` leaves them out (binaryang: 532 checked, 522 in the include list, the rest
  `comparison/`). Compare dprint's `output-file-paths` count with `deno fmt --check`'s
  "Checked N files" before anything else.
- **Prove it by differential:** copy the in-scope files to two scratch trees, damage them the same
  way (strip indentation, CRLF, double quotes), format one with each tool, compare bytes.
- **Add a canary** (binaryang's `scripts/check-fmt-canary.ts`): a planted misformat must be
  reported, the line width checked from both sides, and a minimum file count, so an `includes`
  typo cannot pass by checking nothing.
- Keep `deno.json`'s `fmt` options until `deno.json` goes, for editors that format on save
  with Deno.

### Tests off Deno: `node:test`, per-file counts, a known-differences list (2026-10-13)

binaryang's B5, for your packages (its bun-migration.md § "B5" has the detail):
- **Count first, per file, by LEAF test.** Deno's JUnit reporter lists only top-level tests (a
  `describe` is one case); parse the default reporter for tests and steps with no children.
- **Deno runs `node:test`.** Convert `@std/testing/bdd` → `node:test` (`describe`, `it`) and
  `Deno.test` → `test` first, and `deno test` keeps running the suite with identical counts, so
  the switch can go in steps, green after each. `{ ignore }` is `{ skip }`.
- **Keep `@std/assert` / `@std/expect`** if you like, as `package.json` aliases to
  `npm:@jsr/std__assert@<ver>` with `@jsr:registry=https://npm.jsr.io` in `.npmrc` (they then
  depend on JSR at test time).
- **`Deno.*` in tests:** one small module with the same names on `node:fs` turns the port into a
  rename. A child process of "this runtime": `deno run -A` / `node file.ts` / `bun file.ts`.
- **Which engine judges:** if tests use `WebAssembly`, Bun (JavaScriptCore) differs from V8; run
  the verdict on Node, and Bun against a committed list checked BOTH ways (unlisted failure fails,
  passing listed entry fails).
- **Guard "ran nothing":** require every tracked test file to have run a test. In node's JUnit a
  file with no tests still appears, as one case named by its path; node also writes raw `>` in
  attribute values.

### Deleting deno.json: what binaryang's B7 found (2026-10-13)

- **`deno publish` then finds `jsr.json` by itself**, and `--config jsr.json` comes off. Prove the
  package did not change: compare the dry run's file list with the one from before (binaryang: the
  same 122 files).
- ⚠️ **It then type-checks with your `tsconfig.json`'s compilerOptions, but does NOT load the
  `@types/node` that config names.** Anything only `@types/node` declares fails the publish check
  (binaryang: `import.meta.main`; fixed with `(import.meta as { main?: boolean }).main`).
- **Keep a COLD pre-tag check:** with no `deno check`, the Deno type check left is the one inside
  `deno publish`, so run `deno publish --dry-run` in an empty `DENO_DIR` before tagging.
- ⚠️ **With no `deno.json`, `deno check --doc` loads no manifest**, so a JSDoc example that
  imports the package by its own NAME fails (TS2307, three of them in S3D's CI). Passing
  `--config jsr.json` to THAT command only fixes it. That is safe: a type check fails loudly,
  unlike `deno publish` (F1's caveat). Measured by S3D (C26). binaryang's examples import full
  `jsr:` specifiers and it runs no `deno check --doc`, so it was not re-measured here.
- **A Deno-run side suite needs its own config.** binaryang's `comparison/` (Deno, `npm:binaryen`)
  had silently broken when `package.json` and `node_modules` arrived: Deno resolved `npm:` from
  node_modules and refused what was not listed. A standalone `deno.json` with
  `"nodeModulesDir": "none"`, its own import map and lock fixed it. (Superseded 2026-10-28: the
  suite was PORTED off Deno instead — § 5a "No installed Deno", step 4.)
- Pin the absence: a test that fails if `deno.json` comes back, since with it `deno publish`
  would silently publish from it again.

### No installed Deno: Deno from npm, one pin (2026-10-28)

**What it is for.** After steps 2–7, Deno is still the AUTHORITY wherever JSR is the question:
`deno publish`'s type check, `deno doc`'s view of the exports, a Deno user's run. It need not be a
tool anyone installs. binaryang did this 2026-10-28 (owner: "migrating everything to bun"); its
record is [bun-migration.md](bun-migration.md) § "B8", and every step below was measured on
Windows 11, Bun 1.4.4, Node 24, Deno 2.9.6 from npm against 2.9.8 installed.

1. **One module holds the pin.** binaryang's `scripts/deno.ts` exports `DENO = 'deno@2.9.6'` and
   `denoCommand(args)` → `['bun', ['x', DENO, ...args]]`. When run as a file it launches Deno
   with its arguments (`bun scripts/deno.ts publish --dry-run --allow-dirty`), so `package.json`
   scripts and CI name no version. Code that spawns Deno imports `denoCommand`. A test reads every
   tracked file and refuses `deno@<digit>` anywhere but the pin (binaryang:
   `tests/wabt-ts/scripts/deno_pin.test.ts`). A copy planted in `package.json` failed it. Pin an
   EXACT version at least two weeks old: `deno doc`'s output can feed snapshot hashes.
2. **Replace each Deno call and prove the output is the same.**
   - `deno publish --dry-run`: the type check runs (every export is listed as `Check`).
   - `deno doc --json` over all 19 entry points: byte-identical (3,676,250 B) to the installed
     Deno's, with the same 62 warnings.
   - The CLI smoke on Deno: the same output hash.

   Run the three through `bun x` and compare each with the installed Deno's result.
3. **Prove "none installed" by REMOVING Deno, not by trusting it.** A PATH filter that drops
   folders named `deno` misses a scoop or volta shim folder, where `deno.exe` sits beside `bun.exe`.
   binaryang copied every shim except Deno's into a scratch folder and put that in place of the
   shim folder. `command -v deno` then found nothing, and the full gate ran green (29 / 29). A
   Windows path starting `C:` breaks a POSIX PATH (the colon), so use the `/c/...` form.
4. **A side suite that imports `npm:` packages is a port, not a swap.** **Bun 1.4.4 resolves no
   `npm:` specifier**, measured: `import('npm:binaryen@116.0.0')` → "Cannot find package".
   binaryang's `comparison/` suite did it this way:
   - Each `npm:x@v` became a real dependency in a `package.json` of the suite's own, with its own
     lockfile (two versions of one package: `"binaryen": "132.0.0"` and `"binaryen-116":
     "npm:binaryen@116.0.0"`). The root's install stays small (each binaryen is 25 MB).
   - `Deno.test` → `node:test`, with `t.step` becoming a nested `describe`. `Deno.Command`, the
     temp files and `Deno.args` / `Deno.exit` → `node:` builtins.
   - `deno check` → `bun check -p <suite>/tsconfig.json`, extending the root's strictness. That
     found one property access the old Deno config had allowed.
   - The tests run on the V8 referee, so the engine stayed the one Deno used.

   **Proof:** the same test names and results as Deno's last run; scripts' stdout and files
   byte-identical; and a planted wrong expectation fails the step.
5. **CI.** Drop `setup-deno` from every job but the publish workflow. A runtime-matrix Deno leg
   becomes `setup: bun`, with the invocation `bun scripts/deno.ts run -A`. The smoke script and
   the CLI still run ON Deno, so the leg still tests what it tested. Pin the decision in the guard
   test: `ci.yml` has no `setup-deno`, and `publish.yml` does.
6. **What stays:** the publish workflow's `setup-deno` + direct `deno publish` (F2: provenance
   through a subprocess has failed silently before, and `bun x` is a subprocess too). That is
   JSR's tooling, until JSR ships a publisher without Deno.
7. **Options, not taken by binaryang:**
   - `@deno/doc` on JSR (deno_doc as WASM, 0.210.0) answers `deno doc` with no Deno binary at
     all. Its JSON is the library's, not the CLI's, so check first that every snapshot built from
     it comes out unchanged.
   - **An API surface read from tsc's emitted `.d.ts`** (S3D's `scripts/compat.ts`, C26). It
     named the same 69 symbols, kinds and exports as `deno doc --json`, with no Deno at all
     (measured by S3D). For binaryang it would mean re-baselining `api-surface.json`, whose
     hashes come from `deno doc`'s JSON.
8. **The stricter road** (S3D, C26): Deno only on GitHub's runners, and none at all on the
   development machine, not even `bun x deno`. It trades the local cold dry run and `deno doc`
   for CI's.

### Six traps s3d-reportcompiler measured on steps 2–4 (workspace correspondence C21, 2026-10-26)

s3d-reportcompiler is the first package with dependencies to take these steps; its record is
`../S3D-ReportCompiler/cmem/bun-migration.md` (steps 2–4), `known-issues.md` #27–#30. Each line
says whether binaryang RE-MEASURED it (2026-10-28: Deno 2.9.8, Bun 1.4.4, Node 22.23 / 24.21 /
26.12, Windows 11) or only READ it.

1. **With no `tasks` in `deno.json`, `deno task <name>` runs the `package.json` script of that
   name.** Re-measured: a `deno.json` holding only `fmt` and a `package.json` script `release`
   — `deno task release` ran the script. S3D's probe of "does the old name still resolve?" ran its
   REAL release. → Once step 4 moves the tasks out, never probe a task name you would not run.
2. **`Deno.readTextFile` KEEPS a leading BOM**, and so does `readFile(p, 'utf8')` from `node:fs`
   — on Deno, Bun and Node alike; `new TextDecoder().decode(…)` DROPS it. Re-measured on all three
   (BOM + `A` read back as `feff 41` / `feff 41` / `41`). → A port of `Deno.readTextFile` is
   `readFile(p, 'utf8')`, not a `TextDecoder` over the bytes (S3D's first port lost 3 bytes); this
   adds to step 4's `readFile`-returns-a-pooled-`Buffer` trap.
3. **Bun 1.4.4 ships `bun fmt`** (Prettier-style; JS/TS, CSS, HTML, JSON, YAML, Markdown;
   `--check`), and **`bun lint` is still absent** (`Script not found "lint"`). Re-measured.
   Bare `bun fmt` formats EVERY supported file, so name the paths in the script (S3D's scope
   would otherwise have rewritten `cmem/` and byte-checked HTML). binaryang's own move to
   `bun lint` / `bun format` stays SHELVED by the owner until a Bun release ships `bun lint`
   (binaryang `open-work.md` § Not tasks); the formatter half is now available, the lint half not.
4. **Biome's binaries are OPTIONAL, per-platform dependencies**: with `.npmrc` `omit=optional`,
   npm installs a `@biomejs/biome` wrapper with no binary (`Cannot find module
   '@biomejs/cli-win32-x64/biome.exe'`); `bunx @biomejs/biome@<pin>` works. Read, not
   re-measured: binaryang omits nothing optional and its `cli-win32-x64` is installed.
5. **npm 12 refuses the alias `npx jsr add` installs.** Node 24.21 bundles npm 12.2.0 (Node 22.23:
   npm 10.9.9; Node 26.12: npm 11.20.0). Re-measured, and NARROWER than first reported: a direct
   `npm install @jsr/jrmarcum__binaryang` from `npm.jsr.io` works on npm 12; `npx jsr add
   @jrmarcum/binaryang`, which installs the alias `@jrmarcum/binaryang@npm:@jsr/…`, fails with
   `Refusing to fetch "@jrmarcum/binaryang@https://npm.jsr.io/…tgz"`. `npm_config_allow_remote=all`,
   or `allow-remote=all` in the project `.npmrc`, lets it through (re-measured; the installed CLI
   runs); npm 10 needs neither. → binaryang's README carries this note since 2026-10-28; every
   package whose README says `npx jsr add` needs it. ⚠️ Probe in a folder with its OWN
   `package.json`: without one, npm adopts the nearest parent project (here it wrote into a
   project in the user's home folder — undone with `npm uninstall`).
6. **`deno publish` of a version that already exists SKIPS with exit 0**, so a re-run tag
   workflow carries on past the publish step. Read, not re-measured (it needs a real re-publish).
   For binaryang's `publish.yml`, by reading: until 2026-11-09 the next step, `gh release
   create`, failed on the release that exists, so a re-run stopped LOUD there and the npm job
   (`needs: publish`) did not start. Since then (letters H30 / H32) the page is its own `release`
   job, which treats an existing page as done. Since the restructure the same day (open-work
   54) no job relies on that skip: `jsr` asks JSR first and does not run `deno publish` for a
   version JSR has, `npm` asks npm and does not run `npm publish` for one npm serves, so every
   job of a re-run completes only what is missing ([publishing.md](publishing.md) § "The publish
   workflow's jobs"). Check a workflow's steps AFTER the publish for what a re-run does — and,
   for a package that publishes from CI with OIDC, **which jobs hold `id-token: write` and what
   they run**: the token is the publishing credential (S3D's finding, C30).

