# Project overview

Merged topic file (A16 / 1.5.2). Supersedes `binaryen-ts/overview.md` and `wabt-ts/overview.md`,
which stay in the wings as the origin record.

⚠️ **Both wing files are stale and must not be quoted**: each still says all _three_ projects merge.
They predate the decision that wasmtk stays a consumer. That is the reason this file was authored
rather than merged.

This file holds the **internal** picture — scope, decisions, layout, the binding rules. The
`README.md` is the user-facing document and is published to JSR as the package's front page; it
deliberately carries none of this.

## Scope: two projects, not three

binaryang is `binaryen-ts` + `wabt-ts`. **`wasmtk` does not merge** — it is the compiler, not the
toolchain library, and it stays a consumer.

That distinction understates one thing worth keeping in view: **wasmtk is a redistributor, not
merely a consumer.** It is the only JSR dependent either predecessor ever had, and every wasmtk user
is a transitive dependent of both. So the retirement completes when wasmtk republishes, not when the
signposts go up.

## The settled decisions

Agreed 2026-08-25, before the first commit of the merge.

| # | decision                                                                          | why                                                                                                                                                       |
| - | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **Two IRs are retained.**                                                         | They do different jobs, and wabt's round-trip fidelity is load-bearing. Convergence is gradual and open-ended, alongside ongoing work — not a merge task. |
| 2 | **Both histories are preserved.**                                                 | `git remote add` plus `merge --allow-unrelated-histories` into subdirectories, so both logs survive and `git log --follow` keeps working.                 |
| 3 | **wasmtk does not merge.**                                                        | It stays a consumer.                                                                                                                                      |
| 4 | **Start at 1.5.1.**                                                               | The next version of two packages both at 1.5.0 — continuous with each predecessor's number, not a patch on either.                                        |
| 5 | **`./compat/binaryen` and `./compat/wabt`**, each keeping its upstream API shape. | Two different facades cannot share one `./compat` subpath, and both are the migration surface their consumers were told to adopt.                         |
| 6 | **`cmem/` merges by topic** — shared core, project wings.                         | Reassessed as convergence proceeds. See [INDEX.md](INDEX.md).                                                                                             |

✅ Decision 2 was verified rather than assumed, and the recipe matters: `merge -s ours` plus
`read-tree --prefix` preserves history in the DAG but yields **0** commits from `git log --follow`,
because the files first appear at their new paths _in the merge commit_ and there is no rename to
detect. Relocating on a staging branch and merging that gives 19 and 24 commits respectively. Both
"preserve history"; only one keeps it followable, which is the half that is actually useful.

## Layout

One `main.ts` at the root. `src/binaryen-ts/` and `src/wabt-ts/` hold each predecessor's structure.
Modules move into common `src/` folders as they converge.

**Promotion is provable, not asserted.** A module earns a common `src/` folder when nothing in
either namespaced tree still imports it from the other side — the import graph answers that
mechanically. "It felt shared" is not the test. Without the rule, common `src/` becomes the drawer
things go in because they felt shared.

🔓 **The rule has one standing exception, and it is the bridge.** Decided 2026-08-27: the bridge
lives at **`src/bridge/`**, and the tests at `tests/bridge/`.

The promotion rule's _test_ — nothing in either tree imports it across the boundary — is a **proxy**
for its _intent_, which is "this module belongs to neither side". The bridge satisfies the intent
maximally and fails the proxy by construction, because being cross-tree is the entire job. That is
the exception being recorded: **when the proxy and the intent disagree, the intent governs, and the
disagreement gets written down here.** One module qualifies today. A second one would be a sign the
rule needs rewriting, not a second exception.

It sat in `src/wabt-ts/bridge/` for no reason but provenance, and the location was actively
misleading: it imports from wabt-ts 9 times and binaryen-ts 3, so the path asserted an ownership the
imports contradict.

⚠️ **A separate finding, surfaced by asking where it belongs and NOT fixed by moving it: nothing
ships against the bridge.** No file under `src/` imports it, and it has no export-map entry — it is
reached only by tests. The seam between the two IRs, which is what makes "one package, two IRs" more
than a directory arrangement, is currently unreachable by any consumer.

Recorded rather than resolved, because exporting it is a public-API decision with its own cost:
`./bridge` would be a supported subpath, and the bridge is the part of the tree most likely to
change as convergence proceeds. Do not quietly export it to close the gap.

**Two namespaced trees with a working bridge is a _stable_ arrangement** — nothing breaks if
convergence never happens. That is what makes it safe to start this way, and exactly why it needs
counter-pressure.

## The convergence indicator

**56 exported type names collide** across the two trees. Zero runtime values collide, so the
ambiguity is compile-time and visible to the checker rather than silent.

✅ Re-derived 2026-08-27: still 56 — and the **counting rule is `type` + `interface` + `enum`,
exported, both `src/` trees**. That rule was never written down, and it matters: the same tree
yields 55 without `enum`, 56 with, and 58 if classes are counted. A metric whose method is unpinned
cannot be compared across time. Scripting it is a 1.5.2 item.

It only moves when convergence is real, which is what makes it worth having.

## The binding rules

Two, both enforced in CI, both with their full reasoning elsewhere:

- **Upstream names are reserved** — a bare `binaryen` or `wabt` may name a path only where upstream
  compatibility is the subject (`compat/`, `interop/`). `scripts/check-naming.sh`. Full rule and the
  reason the original one-liner silently stopped working at the merge: [bridge.md](bridge.md).
- **Runtime portability, layered** — no `Deno.*` in shipped source; `node:` builtins confined to the
  CLI/interop layer, because they are portable across Deno/Node/Bun but not to the browser.
  `scripts/check-portability.sh`. The layering is summarised for contributors in the README's
  runtime section, since it constrains any code a contributor writes.

## Where the rest lives

|                                              |                                                |
| -------------------------------------------- | ---------------------------------------------- |
| what was true before the merge               | [pre-merge-register.md](pre-merge-register.md) |
| the execution list and the retirement ladder | [transition.md](transition.md)                 |
| the current release's scope                  | [scope-1.5.2.md](scope-1.5.2.md)               |
| the seam between the two IRs                 | [bridge.md](bridge.md)                         |
| JSR provenance, and why it fails silently    | [publishing.md](publishing.md)                 |
| rules both projects derived independently    | [best-practices.md](best-practices.md)         |
