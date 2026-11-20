# Leaving Deno, staying on JSR — what binaryang built: runtime, type check, engines, the web

The Bun-and-Node runtime, `bun check`, the engine referee, the Node LTS lines, erasable TypeScript,
and the browser check. Split from [jsr-deno-exit-guide.md](jsr-deno-exit-guide.md) on 2026-11-20
(H38 step 5). Last verified 2026-11-20.

## 5a. What binaryang built for Bun, Node LTS and the web: copy these (2026-10-12)

Each item names the binaryang file to read (`../binaryang/…` from a sibling; read it, do not
write to it) and what was measured. All of it is on binaryang's `main`.

### Bun as the main runtime, code that runs on Node too

- **Scripts are `package.json` scripts run by `bun run`**, written on `node:` builtins and web
  standards only, never `Bun.*` / `Deno.*`. A script then also runs on Node and on Deno, so it can
  be checked against its old Deno version before Deno goes. binaryang did exactly that for all 51
  script files: identical output, and byte-identical corpus trees (`scripts/`,
  `package.json`).
- **Traps met converting `Deno.*` to `node:`.** Every one changed behaviour silently:
  - `Deno.readFile` returns a fresh `Uint8Array`, and `readFile` a pooled `Buffer` (its `.slice()` is
    a view): copy it, `new Uint8Array(await readFile(p))`;
  - `Deno.readDir` entries have `isFile` as a property, Node's `Dirent` as a method;
  - `Deno.Command`'s `env` MERGES with the environment, and `node:child_process`'s REPLACES it.
    Spread `process.env`, or the child cannot even find `deno` / `git`;
  - self-spawning with `Deno.execPath()`: use `process.execPath` PLUS `process.execArgv`, so Node
    keeps its flags;
  - `-e` with top-level await is not portable (Node's `-e` is CommonJS): run a one-line `.mjs`;
  - the web `Worker` does not exist on Node: use `node:worker_threads`, which all three run;
  - `async` functions whose `await` became `spawnSync` fail `deno lint`'s `require-await`;
  - `deno fmt <dir>` / `deno lint <dir>` do NOT apply `deno.json`'s include list. Run the bare
    command the gate runs.
- **The type check reads `tsconfig.json`**, with `types: ["node"]` (not `bun`, so a Bun-only API
  fails the check) and `@types/node` pinned to the published Node FLOOR (so an API newer than the
  floor fails too); `bun run check`. The checker was `tsc` 7.0.2 until 2026-10-15 and is now
  `bun check` (below).
- **`bun install` cannot write `bun.lock` on an exFAT drive** (no atomic rename). Generate the
  lockfile on NTFS and copy it back; a lockfile holds no paths.

### Type checking: `bun check`

2026-10-15. Bun 1.4.3 added `bun check`, its built-in checker
([release notes](https://bun.sh/blog/bun-v1.4.3#other-improvements),
[docs](https://bun.com/docs/runtime/check)): a port of typescript-go that reads `tsconfig.json`,
reports the same errors as `tsc` and passes TypeScript 7.0.2's conformance suite, per Bun. It only
checks: no JavaScript or `.d.ts` output, no language server (editors keep TypeScript), and no
`typescript` package needed. binaryang switched to it on 2026-10-15 (owner: "yes make the
change"). What binaryang measured before switching, on its four projects (src, scripts/binaryen-ts,
tests, tests/binaryen-ts; 158 + 107 + 319 + 257 files as each project counts them):

- **Same verdict on the clean tree:** 0 errors from both.
- **Same errors on a PLANTED fault** (the positive control: zero from both proves little). Two
  faults in `src/ir/derive-types.ts`, a constructor parameter property under `erasableSyntaxOnly`
  and a `string` assigned to a `number`: both reported the same three errors (TS1294, TS2322,
  TS2663) at the same lines and columns with the same text. Only the path differed: `bun check`
  printed it absolute because it ran from outside the repo.
- **Speed:** each project 210–280 ms against `tsc`'s 470–560 ms, about 2× (Bun claims 3–6× on large
  projects; these are small).

How to adopt it, and the trap:

- ⚠️ **A `package.json` script named `check` SHADOWS the built-in.** In the project directory,
  `bun check` runs that script (`bun check --help` printed `tsc`'s help); outside it, the checker.
  `bun --check` reaches the checker, but `bun --check -p x` reads `-p` as Bun's "print". Inside
  the `check` script itself `bun check` IS the checker (Bun's docs say so; measured: no
  recursion). On a Bun without the checker (before 1.4.3) such a script calls itself forever, so
  pin Bun ≥ 1.4.3 everywhere it runs (binaryang's CI and publish pin `1.4.4` since 2026-11-09:
  the latest installed Bun, workspace letter H31).
- One `-p` per project: binaryang's script is
  `bun check -p tsconfig.json && bun check -p scripts/binaryen-ts/tsconfig.json && …` (or `-b`
  with `references`). `bun check` exits 1 on an error AND when it finds nothing to check, so a job
  in the wrong directory fails rather than passing.
- Keep `tsc` as a second opinion until the new checker has a record: binaryang kept `typescript`
  7.0.2 and a `check:tsc` script on the same four projects, not in CI. A disagreement between them
  is a bug in Bun (Bun's own words), settled by `tsc`. Diff them with
  `bun check --no-pretty > bun.txt` against `tsc --noEmit --pretty false > tsc.txt`.
- **`bun lint` and `bun format` are NOT in Bun 1.4.3** (canary only on 2026-10-15, though
  bun.com/docs/lint documents them). binaryang shelved replacing Biome and dprint until a release
  ships them (owner, 2026-10-15); the plan for then is binaryang's open-work.md, "Not tasks, by
  decision". A `lint` script shadows `bun lint` the same way `check` shadows `bun check`.

### The engine referee: Bun's WebAssembly is not V8

Bun runs WebAssembly on JavaScriptCore (F10). Any script or test that JUDGES a module with the
host engine must run on a current V8. binaryang's measurements on the spec corpora:

| engine | vs Deno 2.9.7 (V8 15.0) | behaviour gate |
| --- | --- | --- |
| Node 26 (V8 14.6) | whole corpus not measured | custom-descriptors: equal to Deno (488 invocations, 0 DIVERGE) |
| Node 24 (V8 13.6) | 0 of 6,753 differ | passes |
| Node 22 (V8 12.4) | 71 core differ (no table64) | FAILS (11 DIVERGE, 32 refused) |
| Bun 1.4.3 (JavaScriptCore) | 300 differ (no memory64; accepts 70 invalid) | not used |
| Chrome 156 (V8 15.6) | not measured | the newest V8 anywhere |

Experimental proposals need an engine that HAS them, and no single one has all of them.
binaryang picks an engine per proposal (`scripts/proposals.ts` `engine` / `node`):
custom-descriptors on Node 26 (V8 14.6), wide-arithmetic on Bun (JavaScriptCore has it by default),
the rest on the referee. Its oracle scripts run on **Node 24 through fnm**, named once in
`scripts/v8.ts`; each was measured equal to Deno 2.9.7's results. **Deno is kept for JSR only**
(owner, 2026-10-12: "I am looking at deno to run the jsr items specifically. Not the V8 items"):
`deno publish` stays ("hopefully a better jsr interface will exist by then, if not we will continue
to use deno as is"). Node 22's end of life only drops it from the LTS list, which follows the
schedule. There is no deadline.

**Who runs what in binaryang (2026-10-12), the shape to copy:**

| role | runtime | how |
| --- | --- | --- |
| JSR: `deno publish --config jsr.json`, its dry run | **Deno** | the only Deno role kept long term ("the jsr items") |
| type check, tests, formatting | Deno for now | `deno check` / `test` / `fmt`, until binaryang's B3 / B5 move them |
| engine-oracle scripts (behaviour, validity, optimizer corpus, hostile) | **Node 24** (the V8 referee) | `bun scripts/v8.ts <script>`: one constant, run through `fnm exec`, never PATH's `node` |
| a proposal the referee lacks | Node 26 (custom-descriptors), Bun (wide-arithmetic) | a per-row `engine` / `node` in `scripts/proposals.ts` |
| everything else (scripts, the type check — `bun check` since 2026-10-15, `tsc` before — the browser and LTS checks) | **Bun** | `bun run <name>` from `package.json` |

fnm holds every Node in play (binaryang's machine: 22, 24, 26), so a script names its major and
never depends on fnm's default (which was 22 there, whose V8 fails these gates). Raising the
referee is a one-line change in `scripts/v8.ts`, after validating the whole corpus on the new
Node and running the behaviour gates.

### Every current Node LTS line, supported and tested

Owner, 2026-10-12: "We should support and test all currently available lts versions."
- **Which lines: Node's own release schedule**,
  `https://raw.githubusercontent.com/nodejs/Release/main/schedule.json`: LTS started, end of
  life not reached. Never a hand-kept list. On 2026-10-12 that is 22 "Jod" and 24 "Krypton".
- **CI:** an `actions/setup-node` matrix with the floor (binaryang: 22.18, for the
  `import.meta.main` backport) plus the latest of each LTS line (`.github/workflows/ci.yml`,
  `runtimes`). binaryang's legs: 22.18, latest 22, latest 24, and latest 26 ahead of its LTS on
  2026-10-28. All invoke plain `node` with NO flag, since its source is erasable TypeScript.
- **Locally: `bun run lts`** (`scripts/check-lts.ts`) reads the schedule, runs the CLI smoke test
  on each line through `fnm exec --using=<major>` (fnm, so nothing switches globally and no path
  is machine-specific), and requires one output hash. A line fnm has not installed FAILS,
  naming `fnm install <n>`; it is never skipped.
- ⚠️ **Node 26 becomes LTS on 2026-10-28, and it REMOVED `--experimental-transform-types`.** Node
  then only strips types: TypeScript with `enum`s, constructor parameter properties or
  namespaces does not run on it from source. JSR's compiled JavaScript does. If your tests or
  scripts run your TypeScript source on Node, either make it erasable-only (`erasableSyntaxOnly`)
  before then, or test Node 26 against the compiled package. wasmtk has `enum`s in 28 files.
  **binaryang did the first, the same day (next subsection).**

### Erasable TypeScript: how binaryang removed `enum`s and parameter properties (2026-10-12)

- **Find them:** TypeScript ≥ 5.8's `erasableSyntaxOnly` (7.0.2 has it) lists every construct
  Node's type stripping refuses. binaryang had 49: 29 constructor parameter properties and 20
  `enum`s (19 exported). Then switch the option ON in `tsconfig.json` and `deno.json`.
- **Parameter properties → `declare readonly x: T;` + `this.x = x;`** in the constructor, after
  `super(...)` when there is one. `declare` emits no field, so the property appears exactly when
  the parameter property made it: same order, same JSON. Plain fields would change property order.
  Watch for a JSDoc in front of the parameter, and for `=>` in a type (a naive parse reads it as a
  default value).
- **`enum` → three erasable declarations** that keep every use working:
  `export const X = { A: 0, … } as const;` (the value),
  `export type X = (typeof X)[keyof typeof X];` (the type), and
  `export declare namespace X { type A = typeof X.A; … }` (each member as a type, `let r: X.A`).
  Proven on tsc 7, `deno check`, `deno lint`, Bun, Node 22/26 and JSR's slow-types check.
  Compute every value (implicit numbering!) and CHECK it against the old enum object at runtime:
  binaryang's 572 members all matched.
- **What breaks, and what it exposes:** reverse lookup (`X[0]` → name) is gone, and so is
  `0 in X` (binaryang had one such site; every export read as "unknown"). Numbers no longer pass
  where `X` is expected. `let r = X.A` now infers the literal `X.A` (annotate `let r: X = X.A`).
  Where a numeric enum was used as "any number" (binaryang's `Opcode` across the IR, for
  prefixed values that are not members), say so honestly: the TYPE `X = number`, with a comment.
  It is a type-level breaking change, so it belongs in a minor release.

### The web: every export must LOAD in a browser

- **The trap, measured in binaryang: 15 of 22 exports would not even bundle for a browser**,
  while the README said "modern browsers". Each CLI module imported `node:process` at the TOP for
  its `main()`, and library modules imported those CLI modules, so a pure function like
  `wat2wasm()` became unloadable. A per-file portability rule ("no `node:` outside the CLI
  layer") stayed green, because it never followed imports.
- **The fix, with the API unchanged** (`src/host.ts`):
  - `cliProcess()`: `globalThis.process`, read when a CLI function RUNS (Deno, Node and Bun all
    have it; a browser gets a clear error);
  - `cliExit(code): never`, a named call. TypeScript does not treat `cliProcess().exit()` as
    ending the code path;
  - `fsRead` / `fsWrite`: `await import('node:fs/promises')` inside the function;
  - a pure `baseName()` in place of `node:path`'s `basename` for library code;
  - `import type … from 'node:…'` is fine, because it is erased.
- **Two checks, both needed:**
  - `scripts/check-browser.ts` (`bun run browser`, in CI) bundles every export in `jsr.json` with
    `bun build --target=browser --external 'node:*'` and fails on a bundle that does not build or
    imports `node:` at the top level. A deferred `import('node:…')` is allowed.
    ⚠️ **`--external 'node:*'` is REQUIRED** (found 2026-10-12, after this guide first went out).
    Without it Bun's browser target silently STUBS `node:fs` and `node:fs/promises` as
    `(() => ({}))`: every function undefined, exit 0, no warning, and the import gone from the
    output. It also polyfills `node:path` outright. So a used, top-level
    `import { readFileSync } from 'node:fs'` in a library file PASSED the bundle check while it
    would throw in a browser. binaryang showed it with that mutant, then fixed the check: the same
    mutant now fails 4+ exports, and a `node:path` one fails 14 of 22. **If you copied the check
    before this note, add the flag.**
  - `scripts/check-portability.ts`: no top-level runtime `node:` import ANYWHERE in shipped
    source, CLI included. Why both: a bundler DROPS an unused import, so the bundle check cannot
    see one, but JSR's compiled JavaScript KEEPS it, and a page loading the package without a
    bundler fails on it. This source-level rule also caught the stubbed `node:fs` mutant that the
    flagless bundle check missed: run BOTH.
  - Each check was shown to fail on a real regression. Not every mutant is one: `void process`
    is dropped by the bundler, and a `node:process` import with no default export fails the
    build loudly, so neither exercises the stub path. **Test the bundle check with a used
    `node:fs` import.**
- **Give pages bytes-in, bytes-out APIs.** binaryang's `wasmOpt` took a file path (it read with
  `node:fs`); it now also takes a `Uint8Array`. Look for path-only entry points in your exports.
- **Still planned in binaryang:** a real headless-browser run of the library (bundling proves the
  exports LOAD, not that they RUN).
- **universal-wasm-loader IS a browser loader**, so `check-browser.ts` applies to it as it stands.
  wasmtk's published code calls `Deno.*`, so it needs the runtime port of § 6 first.

