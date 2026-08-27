# binaryang

This project merges `wabt-ts` and `binaryen-ts` into one repository and one congruent code base that
replaces both.

Congruence is the destination, not the entry condition: both IRs are retained on purpose at the
start, because they do different jobs and wabt's round-trip fidelity matters on its own terms. They
converge gradually, alongside ongoing work.

## Two projects, not three

binaryang is `binaryen-ts` + `wabt-ts`. **`wasmtk` does not merge** — it is the compiler, not the
toolchain library, and it stays a consumer of binaryang.

Older notes in both predecessor repos say all three projects merge. That claim is stale, and this
README is the authority.

## Versioning

**binaryang starts at 1.5.1.**

It is not a patch. It is the next version of **two** packages that both sat at 1.5.0 on JSR —
`@jrmarcum/binaryen-ts` and `@jrmarcum/wabt-ts` — collapsed into one. The version number is
continuous with each predecessor's; the package is not. Read `1.5.1` as "the release after both
1.5.0s", not as a bugfix on either.

## Runtime support

binaryang runs on **Deno, Node.js, Bun, and modern browsers** from a single source tree. That is a
tested capability, not an aspiration — it is the reason the CLI is one dispatcher rather than six
runtime-gated entry points.

| runtime      | floor       | why that floor                        |
| ------------ | ----------- | ------------------------------------- |
| **Node.js**  | **22.18.0** | everything older is end of life       |
| **Bun**      | **1.4.0**   | the Zig → Rust rewrite; see below     |
| **Deno**     | 2.x         |                                       |
| **browsers** | modern      | the library surface only, not the CLI |

### Node.js — the rule is "not end of life"

Every Node line older than 22 is gone: **18 ended 2025-04-30 and 20 ended 2026-04-30**, and no
odd-numbered line survives. Node 22 is in maintenance until 2027-04-30, so it is supported.

**The floor is 22.18.0 rather than 22.0**, and the patch matters: `import.meta.main` was added in
Node 24.2.0 and backported to the v22 line in **22.18.0** (2025-07-31). Node 22.0–22.17 lack it, so
"Node 22" would be a promise this project cannot keep.

This is a lifecycle rule, not a "latest LTS" rule. When Node 26 becomes LTS on 2026-10-28 nothing
here changes: 22 is still supported because it is still alive.

### Bun — the rule is different, on purpose

**Bun 1.4.0 is the first release written in Rust**; every earlier version was Zig. The floor sits on
that boundary so binaryang never spans two different implementations of the same runtime.

Bun 1.3 is **not** end of life — under the Node rule it would be supported. It is excluded anyway,
and this is the one place where the two runtimes are governed differently. Stated plainly rather
than buried, because an unexplained exception looks like an oversight.

### What that buys, and why it is in this file### What that buys, and why it is in this file

The floors are load-bearing rather than cosmetic. Both predecessor projects banned
`import.meta.main` in published modules because Node 18 lacked it — a rule that shaped the CLI
architecture. On these floors that constraint is gone: `import.meta.main` is available on every
supported version of Node, Bun and Deno.

The constraint that remains, and the one the layout actually answers to:

| layer                              | may use                | may not use        |
| ---------------------------------- | ---------------------- | ------------------ |
| **library** — the exported surface | web-standard APIs only | `Deno.*`, `node:*` |
| **CLI and interop**                | `node:*` builtins      | `Deno.*`           |

`node:` builtins are portable across Deno, Node and Bun, which is why the CLI layer may use them.
They are **not** portable to the browser, which is why the library layer may not. A Deno-only global
is never permitted in shipped source: it works on exactly one of the four targets.

Both rules are checked mechanically in CI, beside `fmt` and `lint`.

## The settled decisions

Agreed 2026-08-25, before the first commit of the merge. Recorded here so they are not relitigated
in fragments.

| # | decision                                                                          | why                                                                                                                                                       |
| - | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **Two IRs are retained.**                                                         | They do different jobs, and wabt's round-trip fidelity is load-bearing. Convergence is gradual and open-ended, alongside ongoing work — not a merge task. |
| 2 | **Both histories are preserved.**                                                 | `git remote add` plus `merge --allow-unrelated-histories` into subdirectories, so both logs survive and `git log --follow` keeps working.                 |
| 3 | **wasmtk does not merge.**                                                        | It is the compiler, not the toolchain library. It stays a consumer.                                                                                       |
| 4 | **Start at 1.5.1.**                                                               | The next version of two packages both at 1.5.0. See above — the README must say it supersedes two separate 1.5.0s, or the number implies a patch.         |
| 5 | **`./compat/binaryen` and `./compat/wabt`**, each keeping its upstream API shape. | Two different facades cannot share one `./compat` subpath, and both are the migration surface their consumers were told to adopt.                         |
| 6 | **`cmem/` merges by topic** — shared core, project-specific wings.                | Reassessed once convergence is further along.                                                                                                             |

Old-package compatibility is a **separate mechanism** from upstream compatibility. `compat/*`
carries the upstream API shapes; migration off the two retired packages is served by preserving
their existing subpath names in the union, so a migrating consumer changes the package name and
nothing else.

## Layout

One `main.ts` at the root. `src/binaryen-ts/` and `src/wabt-ts/` hold each predecessor's structure
unchanged. Modules move into common `src/` folders as they converge.

**Promotion is provable, not asserted.** A module earns a common `src/` folder when nothing in
either namespaced tree still imports it from the other side — the import graph answers that
mechanically. "It felt shared" is not the test. Without the rule, common `src/` becomes the drawer
things go in because they felt shared.

Two namespaced trees with a working bridge is a **stable** arrangement: nothing breaks if
convergence never happens. That is what makes it safe to start this way, and exactly why it needs
counter-pressure — the number to watch is the 56 exported type names that currently collide across
the two trees. It is measurable on demand, and it only moves when convergence is real.

## Migrating from `binaryen-ts` or `wabt-ts`

binaryang supersedes both. Change the package name; two subpaths also change, and everything else
keeps its name so the rest of a migration is a find-and-replace.

### The two that change

| was                                          | now                                   | why                                                                             |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `@jrmarcum/binaryen-ts/compat`               | `@jrmarcum/binaryang/compat/binaryen` | two different upstream facades cannot share one subpath                         |
| `@jrmarcum/wabt-ts/compat`                   | `@jrmarcum/binaryang/compat/wabt`     | "                                                                               |
| `@jrmarcum/binaryen-ts/ir`                   | `@jrmarcum/binaryang/ir/binaryen-ts`  | with both IRs retained, `./ir` would read as "the IR" while meaning one of them |
| wabt IR, previously via the package **root** | `@jrmarcum/binaryang/ir/wabt-ts`      | the root is now narrow — see below                                              |

**There is deliberately no `./ir`.** Not renamed, not aliased, not deprecated — absent. An alias
would resolve to one of the two IRs silently, which is worse than the import error a missing subpath
gives you.

### The root is narrow, and starts empty

`@jrmarcum/wabt-ts` shipped its IR through the package root. binaryang's root exports only what is
genuinely shared by both halves, and at 1.5.1 that is nothing — which is what "two IRs are retained"
means at the export surface, not an oversight. Import from the named subpaths instead.

Modules arrive at the root as convergence makes them genuinely common, which makes it the visible
scoreboard: the narrow root and the 56 colliding type names are the same measurement from two
directions.

### Everything else keeps its name

`./api` `./binary` `./encoder` `./passes` `./interop` `./wasm` `./wasm-runtime` `./tools/wasm-opt`
(from binaryen-ts) and `./wat2wasm` `./wasm2wat` `./wasm-validate` `./wasm-objdump` `./wasm-strip`
`./wasm2ts` (from wabt-ts).

### The CLI is now one entry point

```sh
binaryang wasm-opt | wat2wasm | wasm2wat | wasm-validate | wasm-objdump | wasm-strip | wasm2ts
```

The six WABT tools were previously separate published entry points that self-executed via
`import.meta.main`. They are now registered in one dispatcher, which is what lets them run on Node
and Bun rather than Deno alone.

### Retirement

`@jrmarcum/binaryen-ts` and `@jrmarcum/wabt-ts` each get a final **1.5.1** release pointing here,
then stop. **Already-published versions keep resolving forever** — JSR never deletes a version, and
nothing is yanked — so pinned consumers are not stranded. Only new resolution of the old names goes
away.

## MUST: upstream names are reserved

**A bare upstream project name — `binaryen`, `wabt` — may appear in a path ONLY where upstream
compatibility is the subject: `compat/` and `interop/`. It must never name a directory or module
holding binaryang's own implementation.**

This is binding from the first commit, not a preference to weigh against convenience.

### Why

binaryang is an original TypeScript implementation. It is not a vendored copy of the upstream
Binaryen or WABT projects, and nothing in its layout may imply otherwise. A directory called
`src/binaryen/` makes a claim about provenance that is not true, and it makes it silently, to every
reader who never opens the file.

There is a second, narrower reason. `compat/binaryen` means _the upstream `npm:binaryen` API shape_.
A `src/binaryen/` holding our optimizer would put the same word on our code and on theirs a few
directories apart, in one repository — leaving the reader no way to tell which sense is meant.

Both predecessor projects already held this invariant without writing it down. Every path in either
repo containing a bare upstream name refers to upstream:

| path                         | refers to                          |
| ---------------------------- | ---------------------------------- |
| `src/api/binaryen-compat.ts` | the `npm:binaryen` API shape       |
| `src/interop/binaryen-js.ts` | the bridge to upstream binaryen.js |
| `src/api/wabt-compat.ts`     | the wabt.js API shape              |
| `upstream/`                  | the literal upstream C++ clone     |

Own code has always lived under functional names — `ir`, `encoder`, `passes`, `parser`, `validator`,
`writer`.

### Where own code goes

Functional names, as both predecessors already do.

During convergence, code may sit under the **porting project** that produced it — `src/binaryen-ts/`
and `src/wabt-ts/`. The `-ts` suffix is exactly what distinguishes our port from the project it
ports, so the qualified form is permitted where the bare form is not. Those directories are expected
to shrink as modules are promoted into common `src/` folders, and eventually to disappear.

A module earns promotion to a common `src/` folder when nothing in either namespaced tree still
imports it from the other side — a property the import graph answers mechanically. "It felt shared"
is not the test.

### The check

Mechanical, so the rule outlives whoever last read this file:

```sh
git ls-files \
  | grep -iE '(^|/)(binaryen|wabt)([-_./]|$)' \
  | grep -viE '(binaryen|wabt)-ts' \
  | grep -viE 'compat|interop'
```

Empty output means the rule holds. Wire it into CI beside `fmt` and `lint`, where it costs nothing
and cannot rot.

### One known violation, to fix on the way in

Running the check against the two predecessors today: binaryen-ts is clean; wabt-ts has
`src/bridge/binaryen-bridge.ts`. It is the bridge _into_ the binaryen-ts IR — the qualified sense —
but spelled in the bare form, in the single most load-bearing file the two projects share. Rename it
during the merge; `bridge.ts` is sufficient, since it already lives in `bridge/`.
