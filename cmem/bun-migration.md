# The Bun migration — moving the toolchain off Deno, keeping JSR (open-work item 26)

Summary: Bun is the main runtime and Node the V8 referee; JSR stays the source. The migration is done; this file holds the decisions and the engine-oracle rule. Last verified 2026-11-20.
Closed history: [archive/bun-migration-to-4.1.1.md](archive/bun-migration-to-4.1.1.md).

**State: DONE — item 26 closed 2026-10-13 (UTC) with the 1.11.0 publish** (B1–B7 all merged;
[open-work.md](open-work.md) item 26, [publishing.md](publishing.md) § "1.11.0"). Deno remains
for the JSR publish only (`deno publish`, `publish:dry`) and the `comparison/` suite. The plan and
findings below are the record as they were written; their "planned" and "not started" lines
predate the work. (This line said "B1 on a branch, nothing started" until 2026-10-22, letter H15.)

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

§ "What does move", § "The plan", § "B6": moved to [archive/bun-migration-to-4.1.1.md](archive/bun-migration-to-4.1.1.md).
§ "Findings", § "B5", § "B7", § "B8": moved to [bun-migration-deno-tests.md](bun-migration-deno-tests.md).
§ "B3 lint", § "B3 formatting": moved to [bun-migration-tooling.md](bun-migration-tooling.md).

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
or TypeScript". 🔧 **Superseded 2026-10-15:** Bun 1.4.3 has its own checker, `bun check`, and it
is now `bun run check`'s; `tsc` stays as `bun run check:tsc`. The measurements and the trap (a
`check` script shadows the built-in) are in [jsr-deno-exit-guide.md](jsr-deno-exit-guide.md)
§ "Type checking: `bun check`".

**Consumers are unaffected either way.** JSR serves Node and Bun compiled JavaScript with
`.d.ts`. Measured 2026-10-12: `npx jsr add` / `bunx jsr add`, then the installed `main.js` runs
the CLI with no flags on Node 24.21, Bun 1.4.3 and Deno 2.9.7. All three wrote identical
`wat2wasm` bytes, and `wasm-opt -Oz` ran on Node.

Measured on this tree, 2026-10-12:

- **question:** runs our TypeScript source as written
  - Bun 1.4.3: yes
  - Node 24.21: 🔧 **yes since open-work 28 part 4 (2026-10-12), no flag, Node 22–26.** As measured
    that day: **no**: default type stripping crashes on `main.ts`. It needs
    `--experimental-transform-types` (20 `enum`s in 11 files, parameter properties in 7). Removing
    them would change exported types such as `BinaryOp` and `ValType`
- **question:** CLI start, whole tree loaded (median of 5)
  - Bun 1.4.3: **106 ms**
  - Node 24.21: 581 ms (with the flag); Deno 184 ms
- **question:** test runner
  - Bun 1.4.3: `bun:test` (Bun only), or `node:test`
  - Node 24.21: `node:test`
- **question:** one suite on both
  - Bun 1.4.3: `node:test` + `@std/expect` + `@std/assert`: nested `describe`, `before`, `it.skip`, async, one deliberate failure gave **identical verdicts** on both (2 pass / 1 fail / 1 skip)
  - Node 24.21: same
- **question:** package manager, JSR
  - Bun 1.4.3: `bun install`; `bunx jsr add`
  - Node 24.21: `npm`; `npx jsr add` (pnpm 10.9+ / yarn 4.9+ take `jsr:` natively)
- **question:** who governs it, and how long it lasts
  - Bun 1.4.3: one company: Anthropic, since 2025-12
    ([announcement](https://www.anthropic.com/news/anthropic-acquires-bun-as-claude-code-reaches-usd1b-milestone)).
    MIT-licensed, and Anthropic runs its own products on it. No published support schedule
  - Node 24.21: OpenJS Foundation, with a published LTS schedule and end-of-life dates

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
- **Windows:** this machine is Windows. `bun` 1.4.4 is installed (measured 2026-11-09; it was
  1.4.3 when this was written, 2026-10-12); confirm CRLF
  handling in `dprint` matches `deno fmt` here ([`local/environment.md`](local/environment.md)).
- **Sibling repos** (wasmtk, wazmrt's TS tooling, the TS loaders) face the same deadline. That
  belongs to the workspace session's [handoffs](../../workspace/cmem/archive/handoffs-to-2026-11-19.md). Nothing is written to
  them from here. wasmtk consumes binaryang from JSR and is unaffected by B1–B7.
