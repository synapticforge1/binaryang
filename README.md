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

**Node.js: the floor is the current Node LTS — Node 24 as of 2026-08.**

Stated as a policy rather than a fixed number on purpose, because the number moves: Node 26 becomes
LTS on 2026-10-28. Older lines are not supported, and the reason is that they are gone — **Node 18
reached end of life on 2025-04-30 and Node 20 on 2026-04-30.** Neither receives security fixes.

Note this is a *current-LTS* policy, not an *anything-not-EOL* policy: **Node 22 is in maintenance
until 2027-04-30 and is still not supported here.** Said plainly so the promise is not mistaken for
a wider one.

### What that buys, and why it is in this file

The floor is load-bearing rather than cosmetic. Both predecessor projects banned `import.meta.main`
in published modules because Node 18 lacked it — a rule that shaped the CLI architecture. On the
current floor that constraint is gone: `import.meta.main` is available on Node, Bun **and** Deno.

The constraint that remains, and the one the layout actually answers to:

| layer | may use | may not use |
| ----- | ------- | ----------- |
| **library** — the exported surface | web-standard APIs only | `Deno.*`, `node:*` |
| **CLI and interop** | `node:*` builtins | `Deno.*` |

`node:` builtins are portable across Deno, Node and Bun, which is why the CLI layer may use them.
They are **not** portable to the browser, which is why the library layer may not. A Deno-only global
is never permitted in shipped source: it works on exactly one of the four targets.

Both rules are checked mechanically in CI, beside `fmt` and `lint`.

## The settled decisions

Agreed 2026-08-25, before the first commit of the merge. Recorded here so they are not relitigated
in fragments.

| # | decision | why |
| - | -------- | --- |
| 1 | **Two IRs are retained.** | They do different jobs, and wabt's round-trip fidelity is load-bearing. Convergence is gradual and open-ended, alongside ongoing work — not a merge task. |
| 2 | **Both histories are preserved.** | `git remote add` plus `merge --allow-unrelated-histories` into subdirectories, so both logs survive and `git log --follow` keeps working. |
| 3 | **wasmtk does not merge.** | It is the compiler, not the toolchain library. It stays a consumer. |
| 4 | **Start at 1.5.1.** | The next version of two packages both at 1.5.0. See above — the README must say it supersedes two separate 1.5.0s, or the number implies a patch. |
| 5 | **`./compat/binaryen` and `./compat/wabt`**, each keeping its upstream API shape. | Two different facades cannot share one `./compat` subpath, and both are the migration surface their consumers were told to adopt. |
| 6 | **`cmem/` merges by topic** — shared core, project-specific wings. | Reassessed once convergence is further along. |

Old-package compatibility is a **separate mechanism** from upstream compatibility. `compat/*` carries
the upstream API shapes; migration off the two retired packages is served by preserving their
existing subpath names in the union, so a migrating consumer changes the package name and nothing
else.

## Layout

One `main.ts` at the root. `src/binaryen-ts/` and `src/wabt-ts/` hold each predecessor's structure
unchanged. Modules move into common `src/` folders as they converge.

**Promotion is provable, not asserted.** A module earns a common `src/` folder when nothing in either
namespaced tree still imports it from the other side — the import graph answers that mechanically.
"It felt shared" is not the test. Without the rule, common `src/` becomes the drawer things go in
because they felt shared.

Two namespaced trees with a working bridge is a **stable** arrangement: nothing breaks if convergence
never happens. That is what makes it safe to start this way, and exactly why it needs counter-pressure
— the number to watch is the 56 exported type names that currently collide across the two trees. It
is measurable on demand, and it only moves when convergence is real.

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

There is a second, narrower reason. `compat/binaryen` means *the upstream `npm:binaryen` API shape*.
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
`src/bridge/binaryen-bridge.ts`. It is the bridge *into* the binaryen-ts IR — the qualified sense —
but spelled in the bare form, in the single most load-bearing file the two projects share. Rename it
during the merge; `bridge.ts` is sufficient, since it already lives in `bridge/`.
