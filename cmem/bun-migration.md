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
| B3   | **Formatting and lint off Deno.** `deno fmt` IS dprint's TypeScript plugin, so `dprint` with the same settings (`lineWidth` 100, `indentWidth` 2, `singleQuote`) should leave the tree byte-identical. Measure that first: `dprint check` on the current tree must report 0 files. Lint: pick a linter and map Deno's `recommended` rules; record each rule dropped. | `dprint check` 0 diffs; linter green; dropped rules listed                    |
| B4   | ✅ **Built 2026-10-12 on `bun-4-scripts`:** all 51 script files are `node:`-only (no `Deno.*` in code, no `@std` / `jsr:` imports), and the 20 tasks are `package.json` scripts. Bun runs them, except the engine oracles, which run on Node (§ "The engine oracle"); `proposals` picks an engine per proposal. tsc checks `scripts/`. **Differential, old Deno vs new, same inputs:** every output identical, and every corpus tree byte-identical (core 7,422, legacy 29, translate-eh 29, proposals 874 files). Expected differences only: the `bump` usage line; the 4 `proposals` summary lines that now name their engine; `hostile`'s DEPTH table, which measures each runtime's stack (its mutation half is identical). Found: item 27 (an interp defect on `main`) and the gen_demo_bytes drift (below). **Original plan:** **Scripts on `node:` builtins, RUN BY BUN** (owner, 2026-10-12: "All of our scripts will now be run from bun instead of deno"; each `deno task` becomes a `package.json` script run by `bun run`). `Deno.Command` → `node:child_process`, `Deno.args` → `process.argv.slice(2)`, `Deno.exit` → `process.exit`, file I/O → `node:fs`. Not `Bun.*`: `node:` runs on Bun, Deno and Node, so each script can run on Deno and Bun with the outputs diffed, and we are not locked into a new runtime. Corpus scripts first, release scripts last. | each script prints the same thing under `deno run -A` and `bun`                |
| B5   | **Tests on `node:test`, run by both Bun and Node** (§ "Bun or Node", DECIDED 2026-10-12). `@std/testing/bdd` → `node:test`'s `describe` / `it` (required: bdd calls `Deno.test`, finding 3a), `Deno.test` → `test`. `@std/assert` and `@std/expect` STAY, by their bare names through JSR's npm layer (finding 3): fewer lines change, and JSR stays the source of our test dependencies too. The 6 `Deno.permissions` probes go. The 6 `t.step` uses become nested `describe`. **Proof: the per-file test counts match** the last Deno run, and an injected failure fails. | test counts equal; injected-mutant check                                       |
| B6   | **CI and the release path on Bun.** `ci.yml` gates with `setup-bun`; the `runtimes` matrix KEEPS its Deno leg (consumers on Deno remain). `publish.yml` keeps `setup-deno` + `deno publish` for provenance (finding 2). `auto-tag` reads `jsr.json` without Deno. `deno task …` → `bun run …` in the gate list in [working-rules.md](working-rules.md). | one release published from the new path, provenance verified (`rekorLogId`)    |
| B7   | **Delete `deno.json` and `deno.lock`.** `--config jsr.json` comes off the publish commands, since `jsr.json` is then found on its own. `version_sync`'s second test turns into "there is no `deno.json`". `cmem/` updated throughout. | gate green with no `deno.json` in the tree                                     |

**B6 is the only step that is hard to undo**, because a JSR version is immutable. The other
steps can sit on `main` in any order after their predecessor, unreleased, behind the usual merge.

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

✅ **The referee is DENO** (owner, 2026-10-12: this machine ran **Node 22 only** at the time,
chosen over keeping Node 24 beside it; Node 24 came back the same day, through fnm). B4 first wired the oracles to Node 24. Node 24 was then
removed, and Node 22 cannot referee (next paragraph), so `package.json` runs them as
`deno run -A scripts/…`, on Deno 2.9.7's V8 15.0: the engine these gates were calibrated on. The
converted scripts are `node:`-only, and Deno runs them unchanged. `proposals` defaults to Deno, with
wide-arithmetic on Bun (JavaScriptCore has it; V8 has it only from 15.0).

**No deadline (owner, 2026-10-12).** 🔧 This section once claimed "a NEW V8 referee before about
2027-04", tying the referee to Node 22's end of life. That was wrong: the referee is Deno, not
Node 22. The owner's position:
- **Node 22's end of life changes nothing.** "The lts will revise to the latest, which will exclude
  node 22": `bun run lts` follows Node's release schedule, and CI's matrix the same policy.
- **Deno stays usable as it is.** The end of its development does not remove the binary. The
  toolchain has moved to Bun; for publishing, "hopefully a better jsr interface will exist by then,
  if not we will continue to use deno as is." The same holds for the oracle scripts.

**The one thing to watch, with no date:** a frozen Deno's V8 (15.0) ages. If a NEW experimental
WebAssembly proposal enters the `proposals` gate and needs a newer V8, give that row a newer engine
(`engine` in `scripts/proposals.ts`). The options measured: Node 26 (V8 14.6, runs the source since
open-work 28 part 4), Node 24 (13.6, passes the behaviour gate), or a browser (Chrome stable is
V8 15.6, 2026-10-07; open-work 28 part 3 would provide the runner).

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
  open-work 28). Both are now at `scoop/apps/nodejs22` and `nodejs24`. The oracle wiring is still
  Deno, which is green. Moving it back to Node 24, which is green too and outlives Deno, is the
  owner's call; it is a `package.json` edit plus the `proposals` default. The 11 DIVERGE on V8
  12.4 were not investigated: an old-engine artefact until shown otherwise.

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
