# The project — what binaryang is, what was decided, and how it got here

Consolidated 2026-09-14 from four files under the cleanup policy ([INDEX.md](INDEX.md)): the
internal overview, the delivery status, the retirement ladder, and the pre-merge register. Decisions
and binding rules are kept in full; completed work is summarized. The full text of each, as it
stood: `git show 1672c2a5a:cmem/<file>` for `overview.md`, `phases.md`, `transition.md` and
`pre-merge-register.md`.

The `README.md` is the user-facing document, published to JSR as the package's front page; it
deliberately carries none of this.

## Scope: two projects, not three

binaryang is `binaryen-ts` + `wabt-ts`. **`wasmtk` does not merge** — it is the compiler, not the
toolchain library, and it stays a consumer. It is also a **redistributor**: the only JSR dependent
either predecessor ever had, so every wasmtk user was a transitive dependent of both, and the
retirement completed when wasmtk republished — not when the signposts went up.

## Settled decisions

### The six agreed before the first merge commit (2026-08-25)

| # | decision                                                                          | why                                                                                                                                                       |
| - | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **Two IRs are retained.**                                                         | They do different jobs, and wabt's round-trip fidelity is load-bearing. Convergence is gradual and open-ended, alongside ongoing work — not a merge task. |
| 2 | **Both histories are preserved.**                                                 | `git remote add` plus `merge --allow-unrelated-histories` into subdirectories, so both logs survive and `git log --follow` keeps working.                 |
| 3 | **wasmtk does not merge.**                                                        | It stays a consumer.                                                                                                                                      |
| 4 | **Start at 1.5.1.**                                                               | The next version of two packages both at 1.5.0 — continuous with each predecessor's number, not a patch on either.                                        |
| 5 | **`./compat/binaryen` and `./compat/wabt`**, each keeping its upstream API shape. | Two different facades cannot share one `./compat` subpath, and both are the migration surface their consumers were told to adopt.                         |
| 6 | **`cmem/` merges by topic** — shared core, project wings.                         | Reassessed as convergence proceeds; see [INDEX.md](INDEX.md).                                                                                             |

✅ Decision 2 was verified, and the recipe matters: `merge -s ours` plus `read-tree --prefix`
preserves history in the DAG but yields **0** commits from `git log --follow`, because the files
first appear at their new paths in the merge commit. Relocating on a staging branch and merging that
gives 19 and 24 commits respectively. Both "preserve history"; only one keeps it followable.

### Decided at the pre-merge reconciliation (2026-08-26)

- **`src/binaryen-ts/` and `src/wabt-ts/`**, not wabt-ts's proposed `src/binaryen/` + `src/wabt/`:
  the bare upstream spelling is forbidden by the naming rule below. wabt-ts's reasoning survived —
  four directories collide (`api`, `ir`, `parser`, `tools`), and prefixing by origin keeps imports
  self-describing; only the spelling changed.
- **A narrow, authored root export** (owner: binaryen-ts's path, "the one that causes the fewest
  collisions"), not wabt-ts's 33-line barrel, which would have put its whole IR — and all 56
  colliding type names — on `.`. Each IR gets a qualified subpath: `./ir/binaryen-ts`,
  `./ir/wabt-ts`. **There is no `./ir`** — not renamed, not aliased: an alias would resolve to one
  of the two and reintroduce the ambiguity silently. The naming rule for subpaths: **qualified when
  both sides have the thing, bare when only one does**; `./compat/binaryen` names upstream's API
  shape (bare), `./ir/binaryen-ts` names ours (the `-ts` qualifier). Every other predecessor subpath
  was preserved. The narrow root starts near empty on purpose — **it and the collision count are the
  same measurement of convergence, taken from two directions.**
- **A clean break with signpost releases — no re-export shims** (owner). Decided on a measurement:
  JSR's dependents API (`api.jsr.io/scopes/jrmarcum/packages/<pkg>/dependents`) showed exactly one
  dependent of either package, wasmtk (across 31 versions), plus LeptonPad transitively. Insurance
  against a measured-empty set is cost without cover. The break is safe because **JSR never deletes
  a version**: every existing wasmtk release keeps resolving what it pinned; the break only declines
  future resolution of the old names.
- **Runtime floors — Node 22.18.0 and Bun 1.4.0**, for two DIFFERENT reasons, recorded as such:
  - **Node: not end-of-life is the policy** (owner corrected "latest LTS" to that intent). Read from
    `nodejs/Release/schedule.json` on 2026-08-26: nothing before v22 is alive (v18 EOL 2025-04-30,
    v20 2026-04-30; v22 EOL 2027-04-30). The floor carries the minor because `import.meta.main` was
    BACKPORTED to v22 in **22.18.0** (2025-07-31, from nodejs/node PR #57804, commit `430e66b9b8` in
    `CHANGELOG_V22.md`) — "Node 22+" would admit 22.0–22.17, which lack it. 📅 **Calendar, not
    decisions**: Node 26 becoming LTS on 2026-10-28 changes nothing; the floor next moves to 24 at
    Node 22's EOL, 2027-04-30.
  - **Bun: 1.4.0, a deliberate EXCEPTION to not-EOL** (owner). Bun 1.3.x is not end-of-life; it is
    excluded because 1.4.0 (2026-08-20) is the first release written in Rust, and supporting 1.3
    would mean owning behaviour on two separate runtime implementations. Kept against it for the
    record: on `import.meta.main`, 1.3.14 (Zig) and 1.4.0 (Rust) behave identically. An exception
    with its reason attached is a decision; the same exception without one is a bug in the policy.
  - JSON import attributes were verified on Node 24, Bun and Deno but not on 22.18; nothing in the
    tree depends on them.
- **Adopt wabt-ts's `compilerOptions`** (measured at exactly 4 errors in binaryen-ts's `src/`), with
  `lib` as the one real merge — `dom` + `deno.window`, unioned. binaryen-ts's test workspace member
  that turns `noUncheckedIndexedAccess` off is preserved and scoped to its tests
  ([testing.md](testing.md)).
- **`minimumDependencyAge: "0"` is carried consciously** — a supply-chain default waived, because
  every dependency is our own scope plus `@std`. It must not be inherited silently by a union.

## Layout and the promotion rule

One `main.ts` at the root; `src/binaryen-ts/` and `src/wabt-ts/` hold each predecessor's structure,
and modules move into common `src/` folders as they converge. **Promotion is provable, not
asserted**: a module earns a common folder when nothing in either namespaced tree still imports it
from the other side — the import graph answers that. "It felt shared" is not the test.

🔓 **One standing exception: the bridge**, at `src/bridge/` (decided 2026-08-27; tests at
`tests/bridge/`). The rule's test is a proxy for its intent — "this module belongs to neither side".
The bridge satisfies the intent maximally and fails the proxy by construction, because being
cross-tree is its job. **When the proxy and the intent disagree, the intent governs, and the
disagreement is written down.** A second exception would be a sign the rule needs rewriting. (S6
deletes the bridge — [ir-convergence.md](ir-convergence.md).)

Two namespaced trees with a working bridge is a _stable_ arrangement — nothing breaks if convergence
never happens — which is what made it safe to start this way, and why it needs counter-pressure.

## Binding rules — enforced in CI

### Upstream names are reserved

**A bare upstream project name (`binaryen`, `wabt`) may appear in a path ONLY where upstream
compatibility is the subject — `compat/` and `interop/`. It must never name a directory or module
holding binaryang's own implementation.** Agreed 2026-08-25, binding from the first commit, carried
in the README. The qualified form (`src/binaryen-ts/`) is permitted: the `-ts` suffix is what
distinguishes our port from the project it ports. Why it is a must: breaking it puts the same word
on our code and theirs, and invites the reader to assume binaryang vendors the upstream projects
rather than implementing them — a claim about provenance that must not be made by accident.

**The check is `scripts/check-naming.sh`.** ⚠️ Its original one-liner silently stopped working at
the merge: it ended with `grep -viE '(binaryen|wabt)-ts'`, which matches anywhere in the path, so
once `src/binaryen-ts/` existed it discarded every file in both trees and returned empty on a tree
that still held the known violation. The replacement strips the permitted components and tests what
remains, verified to find the violation (`binaryen-bridge.ts`, renamed `bridge.ts` at A3) before the
rename and nothing after. **A rule whose check cannot fail is decorative.**

**An import ALIAS must not shadow a resolvable package** (adopted from wasmtk, 2026-08-31). The
naming check looks at paths, never an import map: wasmtk aliased `"binaryen"` to their compat facade
while the same specifier could resolve real `npm:binaryen` — one alias, two packages by
configuration. It does not bite binaryang (every alias is `@std/*`), and it is recorded because this
project's natural aliases are exactly the two reserved names. **The hazard is not the name, it is
the ambiguity.**

### Runtime portability, layered

Owner direction 2026-08-26: avoid Deno-specific functions, for Deno, Node, Bun **and the web**. Four
targets make the rule layered, and the layers are the part worth keeping:

| layer                                               | may use                | may not use        | why                                                       |
| --------------------------------------------------- | ---------------------- | ------------------ | --------------------------------------------------------- |
| **library** — the exported surface                  | web-standard APIs only | `Deno.*`, `node:*` | must run in a browser                                     |
| **CLI + interop** — `tools/`, `interop/`, `main.ts` | `node:*` builtins      | `Deno.*`           | not browser code; `node:` works on Deno, Node **and** Bun |

⚠️ **`node:` looks like the portable answer and is not, for library code** — porting `Deno.readFile`
to `node:fs/promises` was right for the six CLI tools because tools are not browser code. **The
check is `scripts/check-portability.sh`**, and both of its greps must exclude JSDoc: a first pass
flagged `const node: BlockExpr` and a doc comment showing consumers a `node:` import — neither a
violation. A portability check that cries wolf gets disabled.

## The convergence indicator

**56 exported type names collide** across the two trees (`Type`, `ValueType`, `WasmModule`, `Token`,
and ~52 expression nodes); zero runtime values collide, so the ambiguity is compile-time. The
**counting rule is `type` + `interface` + `enum`, exported, both `src/` trees** — the same tree
gives 55 without `enum` and 58 with classes, and a metric whose method is unpinned cannot be
compared across time. `class` is excluded with a reason: a class is a runtime value, and folding it
in would hide the day one collides. Scripted as `deno task collisions`
(`scripts/count-collisions.ts`, 1.5.3), reported into CI's summary and deliberately ungated. It only
moves when convergence is real.

## "Phase N" is ambiguous here, permanently

The predecessors numbered phases independently and the numbers collide on live topics: Phase 4 is
core optimisation passes in binaryen-ts and WAT text format in wabt-ts; Phase 7 is the GC proposal
and the binaryen bridge; **Phase 8 is shipped EH support in binaryen-ts and the unimplemented
`wasm2ts` stub in wabt-ts.** The histories are frozen and cannot be renumbered without breaking
their link to the commits. **Rule: never write a bare phase number** — write `binaryen-ts Phase 8`.

## Versions

**Sub-version capped at 9**: `1.0.9 → 1.1.0`, `1.9.9 → 2.0.0`, major uncapped. Both predecessors
adopted it independently; enforced by `deno task bump`. ⚠️ **`bump` has no minor mode** — a
non-patch release is typed by hand ([publishing.md](publishing.md)).

| version   | what it carried                                                                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.5.1** | the merge itself, plus the signpost releases of both predecessors — published 2026-08-27 with provenance (`rekorLogId=2618802426`)                                                                                                                                                                                   |
| **1.5.2** | merge `6ee0eef1d`, tag → `740fbb119`: bridge de-coarsening (`50a959baa`), the `-Oz` `try_table` miscompile (`d5485a740`), the `compat/binaryen` pass API, a user-facing README (`9083abdab`). Shipped ahead of the ladder because wasmtk was blocked on the miscompile                                               |
| **1.5.3** | merge `1e1479f3f`, tag → `384f37ecc`: release trigger (`74bee7522`), all four `br_on_*` forms (`7ff0408f4`), one `scripts/release/` (`b955443a6`), the convergence indicator (`71d7772a0`), the bridge at `src/bridge/` (`e76e2b7ca`), the last ten symbols documented (`6d118b33e`), `.gitattributes` (`ec3a07de0`) |
| **1.5.4** | `wasm2wat` emits FOLDED output by default (`--linear` opts out), and the export-kind rejection found by A3 — published 2026-09-02 (`rekorLogId=2692137018`)                                                                                                                                                          |

Both predecessors ended at a terminal **1.5.1**. `main` is ahead of 1.5.4 —
[unreleased.md](unreleased.md). The 1.5.2 scope's full text:
`git show cff3284b8:cmem/scope-1.5.2.md`.

Two lessons from the 1.5.2 scope that live only here:

- **Merge duplicated tooling as a UNION, not a pick.** Each predecessor's release scripts held a
  guard the other lacked — wabt-ts's `--dry-run` and `release-guard.ts`, binaryen-ts's `main.ts`
  version rewrite — so choosing either would have silently dropped one.
- **Never give a branch the same name as a tag**: `release/1.5.2`, not `v1.5.2`, so `git checkout`
  cannot be ambiguous between `refs/heads` and `refs/tags`. Likewise the task is `release`, not
  `publish`, one keystroke from the unrelated `publish:dry`.

## The retirement — complete (2026-09-02)

**Summary.** Scoped 2026-08-26 as 30 items over four phases: **A** the merge (17 items, complete
2026-08-26, gate: 908 tests, baseline IDENTICAL over 421 files / 1,557,602 bytes, the six tools
byte-identical on Deno, Node and Bun); **B** binaryang 1.5.1 plus signpost releases of both
predecessors; **C** consumer migration; **D** the break at 1.5.2 and archiving. The whole blast
radius was measured, not assumed: **binaryang → wasmtk → LeptonPad**, with each predecessor
reporting exactly one JSR dependent.

| step | what                                           | result                                                                                                                                                     |
| ---- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | wasmtk green against binaryang, control-first  | ✅ 2026-08-26 — identical to the control against the old pins, including the pinned `br_on_cast.wast` known failure                                        |
| B2   | binaryang 1.5.1                                | ✅ 2026-08-27, with provenance                                                                                                                             |
| B3–5 | signposts                                      | ✅ binaryen-ts `4bf1726f200` (in `README.md`); wabt-ts `b6d1d4354` (in the `@module` JSDoc of `src/index.ts` — its JSR page renders JSDoc, not the README) |
| B6   | point the four descriptions at binaryang       | 🛑 **CLOSED as won't-do** (owner, 2026-09-02)                                                                                                              |
| C1–2 | wasmtk swaps two import-map lines, republishes | ✅ wasmtk 2.0.1 (2026-08-27) depends on binaryang for both compat paths and neither predecessor; 2.0.2 (2026-08-31, `rekorLogId=2666522017`) on 1.5.3      |
| C3   | LeptonPad's `build:wasm` still runs            | ✅ 2026-08-31 — the artifact validates, instantiates and computes; no predecessor pulled                                                                   |
| D2   | JSR `isArchived` on both                       | ✅ 2026-09-02, verified live                                                                                                                               |
| D3   | archive both GitHub repos                      | ✅ 2026-08-27                                                                                                                                              |

**What stays true, and must not be "fixed":**

- 🛑 **The predecessors are FROZEN** (owner, 2026-09-02): _"we are not changing either the github
  repo or the jsr any further for the wabt-ts or binaryen-ts projects."_ Their four descriptions
  still present them as live projects — JSR: `binaryen rewritten in typescript`,
  `rewrite of wabt in typescript`; GitHub:
  `Optimizer and compiler/toolchain library for WebAssembly`, `The WebAssembly Binary Toolkit` — an
  accepted cost, not an oversight; the archived banner and README signpost carry the message. **Do
  not re-open it.** The freeze does not cover binaryang.
- 🚨 **D4 — never yank anything, ever.** Yanking is version-level and affects RESOLUTION: it would
  reach backwards into all 31 published wasmtk versions and LeptonPad's transitive
  `binaryen-ts@1.4.3` / `wabt-ts@1.3.5` pins. **Archiving is not yanking** — an archived package
  keeps resolving and only refuses new versions. Yanking is the one action that converts this safe
  break into a breaking one.
- ⚠️ **`dependentCount` reads 1 on both predecessors and will never reach zero**: wasmtk's earlier
  versions are immutable and still name them. Retirement means _no new dependents_. The only way to
  drive the count down is yanking — see D4.
- ⚠️ **wasmtk pins binaryang EXACTLY**, so no binaryang release reaches them without their own bump.

**Lessons from the ladder**, each also where it belongs:

- **Publish before archive**, on JSR and GitHub — archiving stops new versions and makes a repo
  read-only. And the two predecessors were NOT configured alike (`readmeSource` `readme` vs
  `jsdoc`): do not assume two repos behave alike because they look alike.
- **Only a fresh `DENO_DIR` proves a dependency chain**; `--reload` does not clear a resolved
  version ([best-practices.md](best-practices.md)). A fresh resolution returning an older version
  for minutes after a publish, even with a clean `DENO_DIR`, is **publication propagation** —
  upstream of the client, and it settles on its own. Say which of the two you eliminated.
- **Verifying wasmtk**: its real suite is `tests/*_tests.ts` (16 files), run with `--no-check` (its
  own test files carry pre-existing type errors). A bare `deno test tests/` collects corpus fixture
  `test.js` files instead and reports failures that mean nothing. Run it from a scratch copy.
- **A verification recipe that returns empty is inconclusive, not negative**:
  `deno doc --json
  <entrypoint>` → `nodes[file].module_doc.doc` came back empty for every file
  tried, including one whose module doc JSR demonstrably renders — so it could not confirm a
  signpost before publishing.
- **A summary that improves because a file stopped reporting looks exactly like one that improves
  because a bug was fixed**: wasmtk's `tests/wast_tests.ts` calls `Deno.exit(0)` from pre-test
  output, so whether it counts as a test file varies between runs.

Full ladder, runbooks and verification tables: `git show 1672c2a5a:cmem/transition.md`.

## The merge — how it was prepared (2026-08-26)

**Summary.** Before any file moved, the two predecessors' pre-merge registers were reconciled into
one (the kickoff brief: _"two views of the same merge is how things get missed twice"_). It found
four conflicts — two of them a document contradicting itself — one agreed pre-merge action missing
from the plan, and seven findings in neither register. Its decisions are above; its measurements
were re-derived against `binaryen-ts@db71b066223` and `wabt-ts@fa9483aa3`. Full text:
`git show 1672c2a5a:cmem/pre-merge-register.md`.

| item | outcome                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1   | `fmt.singleQuote` requote in binaryen-ts, its own commit BEFORE the move — `2c41d3d1371`, 104 files, 4,302 / 4,302, pure. Agreed by both sides, omitted from the plan              |
| N1   | two test-file conventions (`_test.ts` 38 / `.test.ts` 130) — moot: the merge unified them (230 `.test.ts`, 0 `_test.ts`)                                                           |
| N3   | "unify the CLI" was not mechanical: six extractions plus a `Deno` → `node:` port (53 `Deno.*` on 43 lines), preserving `wasm-validate`'s `--enable-*` surface (T13.10)             |
| N4   | binaryen-ts `--version` printed `1.3.4` for two minor releases — fixed at source, `73ab06cb627`: `bump` rewrites `main.ts` and fails loudly; a sync test catches hand-set versions |
| G1   | the emitted-byte baseline, captured while "before" still existed — [testing.md](testing.md)                                                                                        |
| A0   | T13.22, the compensating pair across the repository boundary — closed BEFORE the merge, which would otherwise have made it permanently invisible ([bridge.md](bridge.md))          |

**Lessons it paid for** (the general ones are rules in [best-practices.md](best-practices.md)):

- **Internal consistency is not completeness.** The author of "reconcile both registers before any
  file moves" then sequenced the steps from one view, and the one action both sides had agreed must
  happen first was missing — no amount of re-reading the list would have surfaced it, because the
  list was not where the information lived.
- **A dependency audit that reads import maps and source measures DECLARATIONS, not dependencies.**
  The first sweep missed LeptonPad, whose references live in `deno.lock`; the lockfile is where the
  transitive truth is.
- **A subpath LIST is not DEMAND.** Across every sibling repo, only three subpaths of either package
  were imported by anything. The export map is a third surface, independent of the file tree and the
  tracked-path list — and it is the one consumers actually import.
- **"We can't test that" is cheaper to check than to write down**: a Bun cell left blank and then
  called untestable was probed in minutes, from an older install the version manager had kept.
- **A stale rationale is worse than none**: the `import.meta.main` ban's reason (Node 18) expired on
  every runtime while the rule stayed right for another reason (the `Deno` global is absent from
  Node and Bun at every version).

⚠️ The register's own § 8 said entries are marked, never deleted, because "it was already like that"
is unfalsifiable once the boundary is gone. That evidence now lives in git, which is why summarizing
it here loses nothing: the commits above, and the file at `1672c2a5a`, are the proof.

## Live gaps carried from the predecessors

| gap                                                   | where                          | state                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **`wasm2ts` is a stub that throws** (wabt-ts Phase 8) | `src/wabt-ts/tools/wasm2ts.ts` | the long-term goal — WASI Preview 1 capable TypeScript output; blocked on wasmtk ([open-work.md](open-work.md), A2)                             |
| **TranslateEH**                                       | binaryen-ts                    | a live gap, scoped 2026-08-24 — `binaryen-ts/correctness.md` § "TranslateEH"; not re-checked since the merge                                    |
| **Phase 10 kernel selection**                         | binaryen-ts                    | deferred until real-corpus profiling; single-op dispatch regresses                                                                              |
| **Diagnostic wording**                                | wabt-ts                        | at close: reader 689/711, validator 2446/2683, parser 816/1229 — none at ceiling; much of the parser's remainder is where OUR message is better |

Closed since the merge: custom-section preservation (C3, `4c162c584`) and diagnostic offset accuracy
(A3, measured 2026-08-31 — [testing.md](testing.md)).

Two lessons the phase records paid for:

- **A snapshot column headed "now" silently becomes false.** wabt-ts's conformance table carried a
  `now` header over a campaign-close reading. Head it `at close <date>`; and **re-derive a count
  from its own table** — the same file said "all five metrics" above a seven-row table.
- **A coupling constrains whoever must act atomically — which is not automatically both parties.**
  binaryen-ts recorded "1.5.0 cannot ship alone" because the wabt-ts bridge compensated for its
  `try_table` bug; but wabt-ts pinned an exact version, so publishing broke nothing, and withholding
  the release was what kept them stuck. Name who is blocked and on what.

## Where the rest lives

| what                                          | where                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| what is outstanding                           | [open-work.md](open-work.md)                                                  |
| what is on `main` but unreleased              | [unreleased.md](unreleased.md)                                                |
| the IR convergence, S1–S7                     | [ir-convergence.md](ir-convergence.md)                                        |
| every divergence from upstream                | [divergences.md](divergences.md)                                              |
| provenance and the release process            | [publishing.md](publishing.md)                                                |
| how binaryang is tested                       | [testing.md](testing.md)                                                      |
| the rules paid for, and the working checklist | [best-practices.md](best-practices.md) · [working-rules.md](working-rules.md) |
| licensing                                     | [licensing.md](licensing.md)                                                  |
