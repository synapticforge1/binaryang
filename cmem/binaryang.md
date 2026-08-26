# binaryang — the binaryen-ts + wabt-ts merge

Planning record, 2026-08-25. The merge target repo exists (`github.com/jrmarcum/binaryang`, `main`,
README + MIT LICENSE only). Full plan with the measured numbers:
<https://claude.ai/code/artifact/6c49a3fa-6a44-4356-9474-48e78f6bd43a>

**Scope: two projects, not three.** binaryen-ts and wabt-ts merge; wasmtk stays a consumer. Both
`overview.md` files still say all three — that is now the stale claim, and the binaryang README is
the authority.

## The six settled decisions (owner, 2026-08-25)

| # | Decision                                                                                                                                                                                                                 |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | **Two IRs retained.** They do different jobs and wabt's round-trip fidelity is load-bearing. Converge gradually alongside ongoing work, not as a merge task.                                                             |
| 2 | **Both histories preserved.** `git remote add` + `merge --allow-unrelated-histories` into subdirectories, so both logs survive and `git log --follow` keeps working.                                                     |
| 3 | **wasmtk does not merge.** It is the compiler, not the toolchain library.                                                                                                                                                |
| 4 | **binaryang starts at 1.5.1** — the next version of two packages both sitting at 1.5.0 on JSR (verified). The README must say it supersedes two separate 1.5.0s, or the number implies a patch when it is a repackaging. |
| 5 | **`./compat/binaryen` + `./compat/wabt`**, each keeping its upstream API shape.                                                                                                                                          |
| 6 | **cmem merged by topic**, shared core plus project-specific wings, reassessed once convergence is further along.                                                                                                         |

## Layout

One `main.ts` at the root; `src/binaryen-ts/` and `src/wabt-ts/` holding each project's structure
unchanged; modules promoted into common `src/` folders as they converge.

**Promotion is provable, not asserted:** a module earns a common `src/` folder when nothing in
either namespaced tree still imports it from the other side — the import graph answers that
mechanically. Without the rule, common `src/` becomes the drawer things go in because they felt
shared.

Naming is governed by the BINDING rule in [bridge.md](bridge.md) § "upstream names are reserved".

**Tradeoff to hold in view:** two namespaced trees with a working bridge is a _stable_ arrangement —
nothing breaks if convergence never happens. That is what makes it safe and exactly why it needs
counter-pressure. The 56-collision count below is the number to watch; it is measurable on demand
and only moves when convergence is real.

## What one `main.ts` actually fixes

Not ergonomics — a real incompatibility. The two projects have opposing CLI idioms and only one
survives:

- **binaryen-ts** uses a central `COMMANDS` dispatcher and **bans `import.meta.main` in published
  modules** (Node 18 lacks it; cross-runtime support is a documented capability). The only two
  mentions in its tree are comments explaining the ban.
- **wabt-ts** gates each tool on `import.meta.main` in **six published modules** — `wat2wasm`,
  `wasm2wat`, `wasm-validate`, `wasm-objdump`, `wasm-strip`, `wasm2ts`.

Keeping the cross-runtime guarantee means those six change regardless, and one `main.ts` is how.
Each already exports a callable entry (`wasmValidate`, `wasmObjdump`, `wasmStrip`, …), so
registering them in the existing dispatcher and deleting the `import.meta.main` blocks is mechanical
— and yields the merge's clearest user-facing win: `binaryang wasm-opt`, `binaryang wat2wasm`,
`binaryang wasm-validate` from one entry point.

## Measured, 2026-08-25

| Metric                | binaryen-ts | wabt-ts     |
| --------------------- | ----------- | ----------- |
| `src/` LOC · files    | 23,256 · 38 | 31,344 · 38 |
| tests · test files    | 513 · 37    | 393 · 130   |
| export subpaths       | 11          | 8           |
| `cmem/` lines · files | 3,067 · 11  | 14,096 · 12 |

- **56 exported TYPE names collide**, including `Type`, `ValueType`, `WasmModule`, `Token` and ~52
  expression nodes. **Zero runtime values collide** — the ambiguity is compile-time, visible to the
  checker rather than silent. Measurable on demand by diffing exported type declarations across both
  `src/` trees; it is the cleanest single indicator of convergence progress.
- **21 tracked paths collide**, and they are the ones that define how the repo builds and ships:
  `deno.json`, `deno.lock`, all three `.github/workflows`, `.gitignore`, `README.md`, three LICENSE
  files, eight `cmem/` files, and three identically-named release scripts (`bump_version.ts`,
  `publish.ts`, `version.ts`).
- **4 `src/` directory names collide** — `api`, `ir`, `parser`, `tools` — with different contents.
  The wabt-ts audit says five; unreconciled, so trust neither number without re-running it.
- **No `src/` FILE name collides.** True, and it is the wrong measure — see the correction below.

## Export-map collisions — a third surface

**Two subpaths collide, not one:**

| subpath    | wabt-ts          | binaryen-ts          |
| ---------- | ---------------- | -------------------- |
| `.`        | `./src/index.ts` | `./main.ts`          |
| `./compat` | `wabt-compat.ts` | `binaryen-compat.ts` |

The root resolves cleanly _because_ the two are different kinds of thing: binaryen-ts's is a **CLI
entry with zero exports**, wabt-ts's is a **barrel of 33 `export *` lines**. binaryang's root
becomes the barrel, the CLI moves aside, and nothing can break — no consumer imports values from
binaryen-ts's root today, because it exports none.

**The `./ir` near-miss** (found by the wabt-ts side): `./ir` does not collide _only because wabt-ts
ships its IR through the root_ — `src/index.ts` line 32 is `export * from './ir/ir.ts'`. In a merged
package `./ir` would read as "the IR" while meaning only binaryen-ts's, with wabt's reachable from
the root. Two different IRs under names that both imply there is one. **With both IRs retained, the
root must stay narrow — shared surface only — and each IR needs its own explicitly-named subpath.**

**Old-package compatibility is a separate mechanism from upstream compatibility.** `compat/*`
carries the upstream API shapes; migration from the retired packages is served by _preserving the
existing subpath names_ in the union (`/ir`, `/binary`, `/encoder`, `/passes`, `/interop`, `/wasm`,
`/wasm-runtime`, `/tools/wasm-opt`; `/wat2wasm`, `/wasm2wat`, `/wasm-validate`, `/wasm-objdump`,
`/wasm-strip`, `/wasm2ts`). A migrating consumer then changes the package name and nothing else.

## The cmem merge — one file carries the whole asymmetry

Headline ratio 14,096 : 3,067 overstates it. Across the **eight colliding files** it is 5,035 :
1,334 — **3.8:1** — because the biggest files on each side have no counterpart (`tasks.md` 7,485
lines; our `correctness.md`) and merge by moving, not reconciling.

Per colliding file (wabt-ts / binaryen-ts): `bridge.md` 283/269 · `licensing.md` 49/40 · `phases.md`
214/167 · `publishing.md` 326/193 · `INDEX.md` 216/97 · `testing.md` 570/186 · `overview.md` 511/95
· **`best-practices.md` 2866/287**.

**One file is the trap.** At 10:1, `best-practices.md` is where a naive merge quietly buries the
smaller project's reasoning. Everything else sits between 1:1 and 5:1, and `bridge.md` — flagged as
needing the most judgement — is at near-parity.

For that one file the framing inverts. Both sides independently derived the same rules — one
authoritative enumeration, an exit code is not evidence, a fixture where both readings pass proves
nothing. **For a rule two teams found separately, both origin stories are the evidence.** Choosing a
surviving vantage point there discards the strongest thing about it.

## T13.22 — CLOSED before the merge starts, verified

The compensating pair is gone. wabt-ts's pin is exact `1.5.0`, `buildCatchClause` now runs BEFORE
`ctx.labelStack.push(name)`, and `tests/bridge/try_table_catch_scope.test.ts` gates it — 29 bridge
tests green when run from here. Landed `5404946d`, released as wabt-ts v1.5.0.

Their framing of why the ordering was non-negotiable is better than ours was: merging first would
not have carried the bug in, it would have made it **permanently invisible**, because two errors
that cancel across a repository boundary have no boundary left to be noticed at.

Detail from their code comment worth keeping: with the pin at 1.5.0 and the old ordering, a numeric
`(catch $e 1)` silently encoded depth 0 — bytes V8 accepts, naming the wrong handler — while a named
target threw `unresolved branch label`. Loud one way, silent the other.

## Read their register too

wabt-ts keeps `cmem/pre-merge-known-issues.md` (270 lines), which goes further than our plan on
merge mechanics and carries product issues we had no visibility into — notably **A1: the bridge's
de-coarsening is incomplete, with three measured failing shapes**, which survives the merge and
lands on the boundary both projects share. Their register and our plan should be reconciled into one
document before the trees move.

## Corrections made during this planning round

- **"The file-level merge is genuinely easy" was wrong.** It rested on no `src/` file name colliding
  — true, and the wrong measure. 21 tracked paths collide, and they are the build-and-ship ones.
- **"Drop the `-ts` from the directory names" was wrong**, and retracted. See [bridge.md](bridge.md)
  § "upstream names are reserved".
- **wabt-ts has 8 export subpaths, not the 5 first reported** — the first grep truncated the list,
  which is a small instance of the lesson below.
