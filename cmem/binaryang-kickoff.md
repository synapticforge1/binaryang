# binaryang kickoff brief

The text below is the prompt to hand whoever starts the merge. It is kept in the repo so the brief
and the plan cannot drift apart — if a decision changes, change it here and re-issue.

Companion reading, all in this folder: [binaryang.md](binaryang.md) (the plan and every measured
number), [bridge.md](bridge.md) § "upstream names are reserved" (the binding naming rule),
[handoffs.md](handoffs.md) (what the wabt-ts team has been told).

---

## The prompt

You are starting the **binaryang** merge: `binaryen-ts` and `wabt-ts` become one repository and one
package that replaces both. The target repo already exists at `github.com/jrmarcum/binaryang` and
contains only a README and an MIT LICENSE.

**Read these before touching anything.** They are the plan, and they carry measured numbers you
should not re-derive by guessing:

- `binaryen-ts/cmem/binaryang.md` — the six settled decisions, the layout, every collision count
- `binaryen-ts/cmem/bridge.md` — the cross-project contract, including the BINDING naming rule
- `wabt-ts/cmem/pre-merge-known-issues.md` — their 270-line register; it goes further than our plan
  on merge mechanics and carries product issues we had no visibility into

Reconcile those last two into one register before any file moves. Two views of the same merge is how
things get missed twice.

### Settled — do not relitigate

1. **Two IRs are retained.** They do different jobs and wabt's round-trip fidelity is load-bearing.
   The bridge becomes an internal module. Convergence is gradual and open-ended, not a merge task.
2. **Both histories are preserved** — `git remote add` plus `merge --allow-unrelated-histories` into
   subdirectories, so both logs survive and `git log --follow` keeps working.
3. **wasmtk does not merge.** It stays a consumer. (Both `overview.md` files still say all three
   projects merge; that is stale, and the binaryang README is the authority.)
4. **binaryang starts at 1.5.1** — the next version of two packages that both sit at 1.5.0 on JSR.
   Say in the README that it supersedes two separate 1.5.0s, or the number implies a patch.
5. **`./compat/binaryen` and `./compat/wabt`** keep their upstream API shapes.
6. **cmem merges by topic** — shared core, project-specific wings, reassessed later.

### Layout

One `main.ts` at the root. `src/binaryen-ts/` and `src/wabt-ts/` hold each project's structure
unchanged. Modules move into common `src/` folders as they converge.

**A module earns promotion when nothing in either namespaced tree still imports it from the other
side** — the import graph answers that mechanically. "It felt shared" is not the test.

### MUST — upstream names are reserved

A bare upstream project name (`binaryen`, `wabt`) may appear in a path **only** where upstream
compatibility is the subject: `compat/` and `interop/`. It must never name a directory or module
holding binaryang's own implementation. `src/binaryen-ts/` and `src/wabt-ts/` are the permitted
qualified form — the `-ts` suffix is what distinguishes our port from the project it ports.

binaryang is an original TypeScript implementation, not a vendored copy of the upstream C++
projects, and nothing in the layout may imply otherwise.

Wire the check into CI beside `fmt` and `lint`:

```sh
git ls-files \
  | grep -iE '(^|/)(binaryen|wabt)([-_./]|$)' \
  | grep -viE '(binaryen|wabt)-ts' \
  | grep -viE 'compat|interop'
```

Empty output means it holds. It has exactly one known violation to fix on the way in:
`wabt-ts/src/bridge/binaryen-bridge.ts` — rename to `bridge.ts`, it already lives in `bridge/`.

### Do these first, in order

**0 — Unblock the repo.** `binaryang/` currently fails every git command with
`detected dubious ownership` (FAT32 `D:`). Add the `safe.directory` entry to the local-disk system
gitconfig.

**1 — Write the decisions into the binaryang README.** Including that it is two projects, not three.
A draft is already on disk in the repo, uncommitted.

**2 — Merge the trees with both histories.** Into `src/binaryen-ts/` and `src/wabt-ts/`. One
`deno.json`, one workspace. Source changes limited to import paths.

**3 — Resolve the export map.** It is a **third surface**, independent of the directory layout and
the tracked paths, and both audits missed it. Two subpaths collide:

| subpath    | wabt-ts          | binaryen-ts          |
| ---------- | ---------------- | -------------------- |
| `.`        | `./src/index.ts` | `./main.ts`          |
| `./compat` | `wabt-compat.ts` | `binaryen-compat.ts` |

The root resolves cleanly because the two are different kinds of thing — binaryen-ts's is a CLI
entry with **zero exports**, wabt-ts's is a barrel of 33 `export *` lines. Make the barrel the root
and move the CLI aside; nothing can break, because no consumer imports values from binaryen-ts's
root today.

**Keep the root narrow.** wabt-ts ships its IR through `.` (`src/index.ts` line 32), so a root
barrel spanning both IRs would surface all 56 colliding type names at once, and `./ir` would read as
"the IR" while meaning only binaryen-ts's. Each IR needs its own explicitly-named subpath.

Preserve every other existing subpath name in the union, so a migrating consumer changes the package
name and nothing else.

**4 — Unify the CLI.** wabt-ts gates six published tools on `import.meta.main`; binaryen-ts **bans**
it in published modules because Node 18 lacks it and cross-runtime support is a documented
capability. Those six change regardless of what you decide, so register them in binaryen-ts's
existing `COMMANDS` dispatcher — each already exports a callable entry — and delete the
`import.meta.main` blocks. The payoff is the merge's clearest user-facing win: `binaryang wasm-opt`,
`binaryang wat2wasm`, `binaryang wasm-validate` from one entry point.

**5 — Unify the harness.** One test task, one regression gate, one fuzz + equivalence + corpus
ladder. Read `binaryen-ts/cmem/INDEX.md` § "regression gate" first: an exit code is not evidence in
this codebase, and the behavioural rungs are the ones that catch a valid-but-wrong module.

**6 — Merge cmem by topic.** Eight files collide. The headline 14,096:3,067 ratio is misleading —
across the colliding files it is 3.8:1, and **one file carries almost all of it**
(`best-practices.md` at 2866/287). Everything else is between 1:1 and 5:1; `bridge.md` is at
near-parity. For `best-practices.md` specifically, do not pick a surviving vantage point: both sides
independently derived the same rules, and for a rule two teams found separately **both origin
stories are the evidence**.

### Gates

- After 2: 906 tests green, both publish dry-runs clean.
- After 3: every old subpath still resolves.
- After 4: the naming check returns empty, in CI.
- After 5: one command runs everything.
- Before publishing 1.5.1: wasmtk builds green against binaryang alone.

### What to watch afterwards

**56 exported type names collide** — `Type`, `ValueType`, `WasmModule`, `Token`, and ~52 expression
nodes. Zero runtime values collide, so the ambiguity is compile-time and visible to the checker.

That number is the convergence indicator: measurable on demand by diffing exported type declarations
across both `src/` trees, and it only moves when convergence is real. Two namespaced trees with a
working bridge is a **stable** arrangement — nothing breaks if convergence never happens, which is
what makes it safe and exactly why it needs something pulling the other way.
