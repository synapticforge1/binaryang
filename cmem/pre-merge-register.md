# The pre-merge register — one document, both sides

Reconciled 2026-08-26, in `binaryang`, before any file moves.

This supersedes two documents as the operational register for the merge:

- `binaryen-ts/cmem/binaryang.md` + `binaryang-kickoff.md` — the plan and the six settled decisions
- `wabt-ts/cmem/pre-merge-known-issues.md` — the 270-line register, measured from the wabt-ts side

**Neither is deleted.** Both remain in their own repos as the origin record, and both travel into
`cmem/` with the trees. This file is where they agree, where they conflict, and what neither saw.

**Why it exists:** the kickoff brief's own instruction — *"reconcile those last two before any file
moves; two views of the same merge is how things get missed twice."* That prediction was correct.
The reconciliation found four conflicts, one unexecuted pre-merge action, and seven findings present
in neither document. Two of the four conflicts are cases where a document contradicts **itself**.

**Status, 2026-08-26:** both blocking items are **closed** — P1 (the requote, `2c41d3d1371`) and
N4 (the version drift, `73ab06cb627`), each fixed in the binaryen-ts repo where they belonged.
**Step 2 is unblocked.** Closed entries are marked, not deleted; see § 8.

**Every number below was re-derived on 2026-08-26**, against `binaryen-ts@db71b066223` and
`wabt-ts@fa9483aa3`, both trees clean. binaryen-ts has since moved to `73ab06cb627`; the two commits
in between are the P1 requote and the N4 fix, and neither changes a count here except the test
total (513 → 514, one new sync test). Where a re-derivation disagrees with a source document, the
source is named and the drift is explained rather than overwritten — a number that moved is
evidence, and the direction it moved in is usually the interesting part.

---

## Status legend

| mark | meaning                                                    |
| ---- | ---------------------------------------------------------- |
| ✅   | verified today, re-derived, holds                          |
| ⚠️   | corrected — a source document is wrong or stale            |
| 🆕   | found during this reconciliation; in neither source        |
| 🔓   | open — needs an owner decision, deliberately not decided here |

---

## 1. Conflicts between the two registers

### C1 ⚠️ `src/` namespacing — wabt-ts's recommendation violates the binding rule

| | |
| --- | --- |
| wabt-ts (B1, G3) | `src/wabt/…` + `src/binaryen/…` |
| binaryen-ts (layout) | `src/wabt-ts/` + `src/binaryen-ts/` |

**Resolved: `src/binaryen-ts/` and `src/wabt-ts/`.** Not a preference — wabt-ts's spelling is the
bare upstream form, which the naming rule in `bridge.md` § "upstream names are reserved" forbids
outright, and which the binaryang README now carries as a MUST from the first commit. `src/binaryen/`
would sit a few directories from `compat/binaryen` meaning the opposite thing, and would imply
binaryang vendors the upstream C++ projects rather than implementing them.

The wabt-ts register was written without sight of that rule. **Its reasoning survives untouched** —
five (four — see C4) directories collide, `src/ir` is the one that matters, and prefixing by origin
keeps every import self-describing. Only the spelling changes. Recording that distinction matters:
the recommendation was right and the name was wrong, which is not the same as the recommendation
being wrong.

### C2 ⚠️ The root export `.` — and an internal contradiction in the binaryen-ts brief

| | |
| --- | --- |
| wabt-ts (B2a, G3) | "`.` resolves to a root that re-exports **both namespaces**" |
| binaryen-ts (step 3) | "**Keep the root narrow** — shared surface only" |
| binaryen-ts (step 3, same paragraph) | "Make **the barrel** the root and move the CLI aside" |

These are three positions, not two, and **the binaryen-ts brief holds two of them at once.**

wabt-ts's barrel is 33 `export *` lines and ships its IR through the root — verified, `src/index.ts`
exports `./ir/ir.ts`, `./ir/ir-util.ts`, `./ir/expr-visitor.ts`. So "make the barrel the root" and
"keep the root narrow" cannot both be executed: promoting that barrel unchanged surfaces wabt's
entire IR at `.`, which is the specific outcome the narrow-root rule exists to prevent, and which
would put all 56 colliding type names on one subpath.

**Resolved in favour of the narrow root** — **owner decision, 2026-08-26: binaryen-ts's is the
correct path, as the one that causes the fewest collisions.** It is also the only one of the three
positions with a measurement behind it (56 collisions); the other two are conveniences.

Concretely:

- `.` becomes a **new, deliberately small** barrel — shared surface only. It is authored, not
  inherited from either side.
- Each IR gets an explicitly-named subpath. Neither may be called `./ir`: with both IRs retained,
  `./ir` reads as "the IR" while meaning one of them — the `src/ir` collision one layer up, which is
  wabt-ts's B2a near-miss and binaryen-ts's `./ir` note saying the same thing from both sides.
- binaryen-ts's CLI root moves aside. ✅ Safe as claimed and verified: `main.ts` has **0** `export`
  statements, so no consumer can be importing values from it today.
- Every other existing subpath name is preserved in the union, so a migrating consumer changes the
  package name and nothing else.

#### 🆕 What the consumers actually import — measured 2026-08-26

Both registers reason about the export map from the two subpath *lists*. Nobody measured the
*demand* side. Across every sibling repo in the ecosystem, exactly **three** subpaths of either
package are imported by anything:

| subpath | imported by | survives the merge? |
| --- | --- | --- |
| `./compat` | **wasmtk**, both packages, under the aliases `binaryen` and `wabt` | changes anyway — becomes `./compat/{binaryen,wabt}` |
| `./ir` | **wabt-ts only** | the dependency is removed by the merge |
| `./encoder` | **wabt-ts only** | the dependency is removed by the merge |

Nothing imports `./binary`, `./passes`, `./api`, `./wasm`, `./wasm-runtime`, `./interop`,
`./tools/wasm-opt`, or any of wabt-ts's six tool subpaths.

This does not make "preserve every subpath name" pointless — it is insurance against JSR consumers
this ecosystem cannot see, and it costs one line each. But it changes what the rule is *for*, and it
means **the narrow root breaks nothing that is actually wired up today.** The only live consumer,
wasmtk, is a two-line import-map change, exactly as both registers predicted.

⚠️ **Correction, both registers:** both quote wasmtk's pin as
`jsr:@jrmarcum/wabt-ts@^1.3.5/compat`. That string is from `wasmtk/scripts/wabt-ts-bug-report.md`, a
document, not an import map. **wasmtk's live `deno.json` pins `@jrmarcum/wabt-ts@1.4.1/compat` and
`@jrmarcum/binaryen-ts@1.5.0/compat`, both exact, no caret.** Note the asymmetry: wasmtk is a full
minor version behind on wabt-ts. That is a fact about the **1.5.1 gate** — "wasmtk builds green
against binaryang alone" is asking it to jump 1.4.1 → 1.5.1 on the wabt side, across a release it
has never built against, at the same time as the merge. If that gate fails, look there before
looking at the merge.

#### The export map

Naming follows one rule, applied consistently: **a subpath is qualified when both sides have the
thing, and bare when only one does.** `./compat/{binaryen,wabt}` is already the settled instance of
it (decision 5); `./ir/{binaryen-ts,wabt-ts}` is the same shape, category first and qualifier second.
The `-ts` suffix is the permitted qualified form under the naming rule — `./compat/binaryen` names
*upstream's* API shape, so it takes the bare form; `./ir/binaryen-ts` names *our* IR, so it does not.

| subpath | resolves to | note |
| --- | --- | --- |
| `.` | authored barrel | narrow; shared surface only |
| `./ir/binaryen-ts` | binaryen-ts's IR | was `./ir` |
| `./ir/wabt-ts` | wabt-ts's IR | was reached through `.` |
| `./compat/binaryen` | upstream `npm:binaryen` API shape | was `./compat` (binaryen-ts) |
| `./compat/wabt` | upstream `wabt.js` API shape | was `./compat` (wabt-ts) |
| `./binary` `./encoder` `./passes` `./api` `./wasm` `./wasm-runtime` `./interop` | binaryen-ts, unchanged | uncontested — wabt-ts exports no counterpart |
| `./tools/wasm-opt` | binaryen-ts, unchanged | |
| `./wat2wasm` `./wasm2wat` `./wasm-validate` `./wasm-objdump` `./wasm-strip` `./wasm2ts` | wabt-ts, unchanged | |

**There is no `./ir`.** Not renamed, not aliased, not deprecated — absent. An alias would resolve to
one of the two and reintroduce exactly the ambiguity the qualification removes, and it would do so
silently, which is worse than the import error a missing subpath produces.

**Two subpaths break, and both were going to break regardless:** `./compat` (two facades, one name —
unavoidable) and `./ir` (contested by the narrow-root decision). Measured above: the only importer of
either that is not one of the two merging repos is wasmtk, on `./compat` alone.

**🆕 The narrow root starts close to empty, and that is the correct starting state.** At merge
time almost nothing is genuinely shared — that is what "two IRs are retained" *means*. So `.` should
not be padded to look substantial. What earns a place in it is governed by the promotion rule, which
makes the root the visible scoreboard of convergence: **the narrow root and the 56-collision count
are the same measurement taken from two directions.** A root that is still empty in a year is not a
broken export map, it is an accurate report.

Precedent, so this is not novel: binaryen-ts's current root already exports nothing at all, and has
shipped that way through 1.5.0.

**What the two registers actually agreed on** and what got lost in the disagreement: wabt-ts framed
this as "a package's public subpaths are not derivable from its file tree," and recorded its own
audit missing the export map as a *lesson* rather than a correction. That framing is the reusable
part and it is kept here. The export map is a **third surface**, independent of both the directory
layout and the tracked-path list, and it is the surface wasmtk actually imports.

### C3 ✅ Publishing model — **DECIDED 2026-08-26: clean break, no shims**

wabt-ts (B3, G3) recommends **one package plus thin re-export shims** under both retired names,
retired on a later major. binaryen-ts's decision 4 settles the version (**1.5.1**, the next version
of two packages both at 1.5.0 — ✅ both `deno.json` files verified at `1.5.0` today) but is silent
on shims.

Not a contradiction — an unadopted recommendation. **Left open for the owner.** The decision is
cheap to defer and expensive to reverse: wasmtk's `@jrmarcum/wabt-ts@1.4.1/compat` breaks on a
rename regardless of version number, and a shim costs one file. Deferring past first publish is what
makes it expensive, so it wants deciding before the 1.5.1 gate, not before the trees move.

⚠️ One input to that decision was weaker than it looked. Both registers argue the shim case from
wasmtk's pin — but wasmtk is the one consumer that is **certainly** a two-line change anyway (see
C2). The real question a shim answers is about JSR consumers neither repo can enumerate.

#### 🆕 The dependency audit — measured 2026-08-26, and it settles it

That "less answerable question" turned out to be answerable, from JSR's own API
(`api.jsr.io/scopes/jrmarcum/packages/<pkg>/dependents`):

| package | JSR dependents |
| --- | --- |
| `@jrmarcum/binaryen-ts` | **`total: 1`** — `@jrmarcum/wasmtk`, across 31 of its versions |
| `@jrmarcum/wabt-ts` | **`total: 1`** — `@jrmarcum/wasmtk`, across 31 of its versions |

**There are no third-party consumers.** The only dependent of either package, anywhere on JSR, is
wasmtk — which is the same owner's project, already planned as a consumer, and already known to be a
two-line import-map change.

Locally the picture matches, with one addition worth recording:

- **Direct:** wasmtk, on `./compat` of both, exact pins (`binaryen-ts@1.5.0`, `wabt-ts@1.4.1`).
- **Transitive:** **LeptonPad**, which never names either package — it runs
  `deno run -A jsr:@jrmarcum/wasmtk modc …` in a build task, **unpinned**, and wasmtk carries both.

⚠️ **The earlier sweep in C2 missed LeptonPad** and concluded "the only live consumer is wasmtk."
The references live in `deno.lock`, and the sweep's include-globs covered `.json`, `.ts` and `.md`
only — a lockfile is neither. Corrected rather than quietly amended, because the lesson is the
reusable part: **a dependency audit that reads import maps and source is measuring declarations, not
dependencies.** The lockfile is where the transitive truth is.

🆕 **wasmtk is a redistributor, not merely a consumer.** Decision 3 says it "stays a consumer," which
is right about the merge and understates its role in the deprecation: every wasmtk user is a
transitive dependent of both packages. So the break is gated on wasmtk shipping a binaryang-based
version — not on anyone reading a deprecation notice.

#### The decision

**Owner, 2026-08-26: a clean break, with terminal pointer releases — no permanent shims.**

1. Evaluate dependents first ✅ *(done above — one, and it is ours)*
2. Publish **binaryen-ts 1.5.1** and **wabt-ts 1.5.1**, each pointing at binaryang for future use
3. **Clean break at binaryang 1.5.2**

⚠️ **This supersedes the shim recommendation previously recorded here, and the audit is why.** The
case for shims rested entirely on insurance against consumers nobody could enumerate. They have now
been enumerated: there are none. Insurance against a measured-empty set is cost without cover, and
two extra published packages to version forever is not a small cost.

✅ **The break is safe because JSR is immutable.** Publishing 1.5.1 does not remove 1.5.0, and no
version is ever deleted — so all 31 existing wasmtk releases keep resolving to the exact
`binaryen-ts` and `wabt-ts` versions they pinned, indefinitely. A clean break strands nobody who is
already working; it only declines to serve *future* resolution of the old names. That is the property
that makes "clean break" the low-risk option here rather than the bold one, and it is worth stating
because the phrase suggests the opposite.

🔓 **Two things still to settle** — see § 9.

### C4 ⚠️ `src/` directory collisions — four, not five

wabt-ts's B1 prose says **FIVE**; its own table immediately below lists **four**. binaryen-ts says
four and flags the discrepancy as unreconciled with "trust neither number without re-running it."

**Re-run today: 4** — `api`, `ir`, `parser`, `tools`. The wabt-ts prose is a miscount against its own
evidence. Non-colliding and movable as-is, ✅ as both registers list them: `bridge`, `core`,
`interp`, `reader`, `validator`, `writer` (wabt-ts); `binary`, `encoder`, `interop`, `passes`,
`wasm` (binaryen-ts).

---

## 2. The pre-merge action that was missing from the plan

### P1 ✅ `fmt.singleQuote` — was absent from the seven steps. **CLOSED 2026-08-26, `2c41d3d1371`**

wabt-ts's G2 records this as **RESOLVED: binaryen-ts adopts `true`**, to be done *in the binaryen-ts
repo, as its own commit, before the merge*, with the reasoning that a whole-file requote landing in
the same diff as thousands of moved lines makes the merge unreviewable.

**Raised here because it had not been done** — `binaryen-ts/deno.json` read `"singleQuote": false`
when this register was written, and the kickoff brief's ordered steps 0–6 did not mention it at all.
So the one action both sides agreed had to happen before the trees move was the one action the
execution plan omitted.

✅ **Closed the same day.** binaryen-ts landed `2c41d3d1371` — *style: fmt.singleQuote true, requote
the tree*. Verified from here: `deno.json` now reads `true`, and the commit is a **pure requote —
104 files, 4,302 insertions against 4,302 deletions, every file balanced**, source and tests, with
nothing else riding along. That is exactly the shape G2 asked for, and the reason it asked.

**Step 2 is unblocked.**

#### Why this entry stays, and why it is the most useful thing in the file

The omission was not wabt-ts's and not an oversight in the abstract. In the binaryen-ts author's own
account: *the requote's absence from the kickoff brief was my omission — I built the sequence from
our plan without reconciling their G2 register first, which is the exact failure the brief warned
about a paragraph earlier.*

That is worth more than the fix. The brief's instruction — *reconcile the two registers before any
file moves; two views of the same merge is how things get missed twice* — was written by the person
who then sequenced seven steps from one view. **The instruction was right and its author did not
follow it, in the same document, one paragraph later.** Not carelessness: the plan felt complete
because it was internally consistent, and internal consistency is precisely what a single view can
never distinguish from completeness.

So this register's existence is not procedural overhead justified by four conflicts and five
findings. It is justified by one: the step that had to happen first was missing from the list of
steps, and no amount of re-reading the list would have surfaced it, because the list was not where
the information lived.

**It must happen before step 2.** Not because reformatting is hard, but because after the trees move
there is no "its own commit" left to put it in — the churn and the move share a diff, permanently.
This project has already watched a line-ending flip turn a 47/10 diff into 1649/1612.

Which side moves is settled by size, not preference: binaryen-ts tracks the smaller tree, so
requoting it is a fraction of the churn, and wabt-ts is already internally consistent at `true`.

**Boundary note:** execution belongs in the binaryen-ts repo. Nothing in binaryang writes into it —
the same boundary the wabt-ts team kept when they drafted a handoff rather than editing binaryen-ts's
tree, and the same one binaryen-ts kept in return. Worth naming, because during a merge the habit of
respecting repo boundaries is the first thing to erode and the last thing anyone notices eroding.

---

## 3. Findings in neither register

Seven. All measured today.

### N1 🆕 The two projects use different test-file naming conventions

| | convention | files |
| --- | --- | --- |
| binaryen-ts | `*_test.ts` | 38 |
| wabt-ts | `*.test.ts` | 130 |

Zero overlap in either direction. Deno's runner discovers both by default, so nothing breaks on day
one — which is exactly why this survives unnoticed until someone writes an `include` glob, a
coverage filter, or a CI shard split for step 5's unified harness. Any of those written for one
convention silently covers half the tree and **reports green on the half it ran**.

Decide it as part of step 5, and if the conventions are unified, do it as its own rename commit for
the same reason as P1.

### N2 🆕 binaryen-ts's `tests/deno.json` workspace member is load-bearing — 424 errors

`binaryen-ts/deno.json` declares `"workspace": ["./tests"]`, and the member exists only to set
`noUncheckedIndexedAccess: false` for the test tree. Its own comment explains why: in `src/`, an
unchecked index that is `undefined` becomes wrong bytes in a `.wasm` file — the project's worst
failure mode; in a test it becomes a failed assertion, which is the test doing its job.

**Measured today, by removing it: 424 type errors** (241 TS2532, 136 TS18048, 24 TS2339, 13 TS2322,
6 TS2345, 4 TS2375/2379). The file's own "~420 edits" estimate re-derives at 424.

wabt-ts has no equivalent member. So the merged workspace must **preserve this member and keep it
scoped to binaryen-ts's tests only** — a wabt-ts test tree silently inheriting
`noUncheckedIndexedAccess: false` would lose a check it currently has and has had all along.

The comment carries a trap worth reproducing verbatim in the merged config, because it is the kind
of thing that looks like it works until you check: *a workspace member INHERITS the root's
`compilerOptions` and merges its own over them, so omitting the key leaves the root's `true` in
force.* It must be stated explicitly as `false`.

### N3 ⚠️🆕 Step 4 is not mechanical — the CLI logic is unexported, and it is Deno-only

The brief says the six wabt-ts tools "each already export a callable entry … so registering them in
the existing dispatcher and deleting the `import.meta.main` blocks is mechanical." **Three things are
wrong with that, and the third inverts the rationale.**

**(a) The exported entries have the wrong signature.** `COMMANDS` is
`Record<string, (args: string[]) => Promise<void>>`. What the tools export are library functions with
domain signatures — `wat2wasm(source, opts) → Wat2WasmResult`, `wasmValidate(…)`, `wasmStrip(binary,
opts) → WasmStripResult`. They are not CLI handlers and cannot be registered as they stand.

**(b) The CLI logic is inside the blocks and is exported nowhere.** Argument parsing, file I/O, exit
codes — all of it lives inside `if (import.meta.main) { … }`. **Deleting those blocks deletes the CLI
behaviour**, unless each is first extracted into a new exported `(args: string[]) => Promise<void>`.
That is six new wrappers, not six registrations. `wasm-validate` is the largest: its block carries
the whole `--enable-<feature>` / `--disable-<feature>` / `--enable-all` surface, added deliberately
when the validator began enforcing the feature set (T13.10), with a code comment explaining that
without those flags a gated validator rejects any GC, SIMD, threads, tail-call or EH module from the
command line with no way to opt in. Dropping that in a "mechanical" edit re-introduces a regression
the project already fixed once.

**(c) `import.meta.main` is the smaller half of the portability problem.** All six blocks use the
`Deno` global — `Deno.args`, `Deno.exit`, `Deno.readFile`, `Deno.writeFile`, `Deno.writeTextFile`,
`Deno.stdout`. Node lacks that global **entirely**, so these blocks are further from cross-runtime
than `import.meta.main` alone would make them. The stated reason for step 4 is preserving
binaryen-ts's documented cross-runtime capability; that reason applies *more* strongly than the
brief argues, not less. 🆕 **See N6:** if the Node floor moves to the current LTS, this
becomes the *only* surviving reason for step 4 — the `import.meta.main` half of the argument
disappears entirely, and this half does not.

The pattern to copy is in the tree already, and it is small: `binaryen-ts/src/tools/wasm-opt.ts`
imports `readFile`/`writeFile` from `node:fs/promises` and `process` from `node:process`, and
declares `export async function main(args: string[] = process.argv.slice(2))`. That signature is
already the `COMMANDS` shape. `main.ts` dispatches on `process.argv.slice(2)` and exits via
`process.exit`.

Also: `cliRead`/`cliWrite` are defined privately and **separately in five of the six tools**. The
extraction is the moment to lift them into one shared cross-runtime helper, rather than porting the
same pair of functions off `Deno` five times.

✅ Verified as documented: binaryen-ts's only two `import.meta.main` mentions in `src/` are comments
in `wasm-opt.ts` explaining the ban. The ban is real and observed.

**Step 4 stays where it is in the order**, and stays forced — the six tools change regardless,
because the cross-runtime guarantee is a published capability. Only the estimate changes.

### N4 ✅ `main.ts` reported the wrong version. **CLOSED 2026-08-26, `73ab06cb627`**

`binaryen-ts/main.ts` line 77: `const VERSION = "1.3.4"`. `deno.json`: `"version": "1.5.0"`. So
`binaryen-ts --version` has been printing `1.3.4` for two minor releases. The comment above it says
*"Keep in sync with `deno.json` `version` (bumped on release)"* — a convention that depends on
someone remembering, and this is what that looks like after they didn't.

✅ **Fixed at the source instead**, in `73ab06cb627`, rather than absorbed into step 4. **Drop it
from the CLI-unification list** — there is nothing left to carry.

⚠️ **And the fix is better than what this register proposed.** The recommendation above was to read
the constant from `deno.json` rather than restate it. That is wrong here, for a reason this document
should have caught given it is the same reason step 4 exists at all: `main.ts` is the CLI entry for
**Node 18** as well as Deno, and importing JSON needs `with { type: "json" }`, which Node 18 lacks.
A runtime read would have traded a cosmetic bug for a real cross-runtime one — breaking the exact
published capability the merge is reorganising the CLI to protect.

What landed closes the drift from two sides without a runtime read: `deno task bump` now rewrites
`main.ts`'s constant alongside `deno.json` and **fails loudly if it cannot find the literal**, so a
rename cannot make the bump silently stop syncing; and `tests/version_sync_test.ts` asserts the two
agree, which catches the case that actually produced this bug — a version set **by hand**, since
`bump` has no minor mode and that is how 1.5.0 shipped. Teeth-verified on their side by reverting
the constant and watching it fail with the real numbers.

🔓 **Still true, and worth knowing:** the fix is on `main` and **not published**. JSR's 1.5.0 still
reports `1.3.4`. It lands in **1.5.1, with the merge** — deliberately not worth a release of its own.
So anyone reading `--version` from the published package during the merge window gets `1.3.4`, and
that is expected rather than a symptom.

The generalisable part, which is why this stays in the file: the original comment said *keep in sync
with `deno.json` by hand*. A convention that depends on someone remembering is not a mechanism, and
this is what one looks like two minor releases after they didn't.

### N5 ⚠️🆕 The licence inventory is off by one on both sides

wabt-ts's B2 says "4 licence files" collide; binaryen-ts says "three LICENSE files". **Three
collide** — `LICENSE`, `LICENSE-APACHE`, `LICENSE-MIT`. `NOTICE.md` is wabt-ts-only and therefore
does not collide; it moves as-is.

More usefully: wabt-ts's section D reads as though binaryen-ts lacks the Apache trail. It does not —
**binaryen-ts tracks `LICENSE-APACHE` and `LICENSE-MIT` too.** ✅ The rest of D holds: only wabt-ts
has `NOTICE.md`, the copyright lines differ in both name form and year (`2026 Jon Marcum` vs
`2024 J.R. Marcum`), per-file attribution headers must survive relocation, and JSR takes a single
SPDX identifier — so it stays `MIT`.

### N6 🔓⚠️ The Node 18 floor is EOL, and it is the stated reason for two decisions

Raised by the owner, 2026-08-26. Both registers, the kickoff brief and every decision below it assume
a **Node 18** floor. Node 18 reached end of life on 2025-04-30 — sixteen months before this merge —
and Node 20 followed on 2026-04-30. Supporting neither is the owner's stated direction: **latest LTS
and up.** Today that is Node 24 (LTS, 24.20.0) with 26.8.0 current.

**Where it came from**, since it was not obvious: it is a **Phase 11 deliverable** in binaryen-ts —
*"Cross-runtime migration + JSR publish hardening — single source tree runs on Deno, Node 18+, Bun,
and modern browsers"* (`README.md`), restated in `cmem/overview.md` as the package's headline support
claim and codified as an architecture rule in `cmem/architecture.md`: *"No `import.meta.main` in
published modules (Node 18 lacks it) — CLI entry is always `main.ts`."* So it is not an arbitrary
floor. It is a published capability, which is exactly why it is load-bearing and why moving it is a
decision rather than a cleanup.

**The project's own infrastructure has already moved.** `binaryen-ts/cmem/publishing.md` records
`checkout@v4 → @v6` as forced by GitHub's **Node 20** runtime deprecation (off 2026-06-02, removed
2026-09-16), with the current action runtime target `node24`. wabt-ts runs its V8 conformance panel
on *Deno / Node 24.19*. Both projects test and build on Node 24 while promising Node 18 in their API
docs.

#### Measured here, 2026-08-26 — not recalled

All three target runtimes, at the versions installed on this machine:

| probe | Node 24.19.0 | Bun 1.4.0 | Deno 2.9.5 |
| --- | --- | --- | --- |
| `import.meta.main` | ✅ `true`, boolean | ✅ `true`, boolean | ✅ `true`, boolean |
| `import(…, { with: { type: 'json' } })` | ✅ works | ✅ works | ✅ works |
| `globalThis.Deno` | ❌ `undefined` | ❌ `undefined` | `object` |

⚠️ **The Bun `import.meta.main` cell was blank in the first version of this entry** — not because it
failed, but because it was never probed. The first pass tested `import.meta.main` on Node only, and
JSON attributes plus the `Deno` global on Node and Bun. Recorded rather than quietly filled in,
because a blank cell in a table headed *measured, not recalled* reads as a negative result, and it
was not one.

⚠️ **That entry then claimed the older Bun was "untested and now untestable here." Both halves were
wrong.** scoop retains previous versions under `scoop/apps/bun/<version>/`, so 1.3.14 was on disk the
whole time — **probed directly: `import.meta.main` is `true` there too.**

**How far back it goes — Bun v0.6.0, 2023-05-16**, which introduces it in a dedicated section of the
release notes, from [PR #2556](https://github.com/oven-sh/bun/pull/2556) merged 2023-04-04. Four
months before Bun 1.0, which is why v1.0.3's notes reference it as already existing rather than
announcing it. **Every Bun 1.x has it; Bun constrains the floor not at all.**

The reusable part, since the same shape appeared twice in two entries: *"we can't test that"* was
asserted rather than checked — once by not probing Bun, once by not looking for the retained install.
A version manager keeping old versions is exactly what makes an untestability claim cheap to
falsify, and cheaper to check than to write down.

**`import.meta.main` is therefore universal across every runtime this project targets**, at current
versions. That is a stronger result than the entry originally reached. It is not that the ban's
premise weakens if the Node floor moves — the premise is **expired on all three runtimes**, and the
only thing still holding it up is the EOL Node 18/20 floor itself.

#### What this changes, and what it does not

**Step 4's stated rationale dies. Step 4's conclusion survives.** The brief frames the CLI
unification as *forced* because "binaryen-ts's cross-runtime guarantee is a published capability and
Node 18 lacks that global." Measured above, `import.meta.main` is available on Node, Bun **and**
Deno at current versions, so that argument is not merely weakened — there is no runtime left for it
to be true of.

**Step 4 remains forced anyway** — for the reason recorded in N3(c), which is now its *only* reason.
The six tools use `Deno.args`, `Deno.exit`, `Deno.readFile`, `Deno.writeFile`, `Deno.writeTextFile`
and `Deno.stdout`, and the `Deno` global is `undefined` on **both** Node and Bun, at any version.
That barrier does not move with the floor. Raising the floor removes the smaller half of the
portability problem and leaves the larger half exactly where it was.

⚠️ So nothing about the plan reopens — but the *argument* in the brief and in
`cmem/architecture.md` needs replacing, or the next person reads a rule whose reason has expired and
cannot tell whether the rule still holds.

**N4's stated rationale dies too. N4's solution should stand.** The fix in `73ab06cb627` keeps the
version literal because `with { type: 'json' }` is unavailable on Node 18. On Node 24 it is
available, verified above. **Do not revisit the fix on that basis.** It stands on reasons the floor
does not touch: `deno task bump` fails loudly if the literal moves, `tests/version_sync_test.ts`
catches a hand-set version — the case that actually caused the bug — and neither needs `deno.json`
to be readable or adjacent in the published package. This is wabt-ts's own rule applying to
binaryen-ts's code: **a stale rationale is worse than no rationale.** The solution is right; the
sentence explaining it is about to become false.

#### The documentation debt is real and it is growing

**21 occurrences of "Node 18" across 12 files** in binaryen-ts — `README.md` ×4, `main.ts` ×3,
`src/tools/wasm-opt.ts` ×3, `tests/version_sync_test.ts` ×2, plus `src/api/index.ts`,
`src/interop/binaryen-js.ts`, `scripts/bump_version.ts` and the `cmem/` files. Every one becomes a
false claim the moment the floor moves.

🆕 **Five of those lines were added today**, by the N4 fix. The rationale is actively propagating into
new code while the constraint behind it is sixteen months expired. That is not a criticism of the
fix — it is the strongest available argument for settling the floor *before* step 4 rather than
after, since step 4 rewrites exactly these files.

#### Why the merge is the cheapest moment to do it

Raising a support floor is a breaking change, and normally that means waiting for a major. binaryang
does not have to wait: it is **already a new package** that consumers must adopt deliberately, with a
migration note they must read to change the package name. Stating the floor once, in that note,
costs nothing. Discovering later that binaryang silently stopped working on an EOL runtime costs a
support thread.

🔓 **Open for the owner:** the floor is a policy call, not a measurement. *Latest LTS and up* means
**Node 24+**. A more conservative **Node 22+** buys the maintenance-LTS line at the cost of keeping
the `import.meta.main` question open **for Node only** — 24 is verified, and the version that
introduced it should be confirmed before 22 is promised. **Bun and Deno constrain nothing** — Bun has
had it since v0.6.0, Deno since long before 2.x. Node is the entire question. The EOL dates above should be confirmed
against Node's published schedule too; they are stated from the release calendar and corroborated by
GitHub's runtime deprecation, not read from it today.

Whatever is chosen, it belongs in the binaryang README beside the version note, because it is the
same kind of claim: something a consumer must know before adopting.

#### 🔓 The Bun floor is a different decision from the Node one

Owner direction, 2026-08-26: pin Bun to **1.4.0**, on the grounds that it is now fully Rust.

✅ **The premise is correct, and worth recording because it is recent enough to be easy to get
wrong:** [Bun 1.4](https://bun.com/blog/bun-v1.4), released **2026-08-20**, is the first release
written in **Rust**; every prior version was Zig. Alongside it: ~5× lower idle CPU, up to 35% less
memory, 2.5× faster Windows startup, and Node-suite compatibility at ~97% for `node:http`, `node:fs`
and `node:stream` — that last number matters here, because this project's Node story is a published
capability.

⚠️ **But the reasoning that justifies the Node floor does not transfer, and it is worth being explicit
about why.** Node 18 and 20 are dropped because they are **end of life** — no security fixes, nobody
should be running them. **Bun 1.3.x is not EOL.** It is the previous stable line, current until six
days ago. Raising the Bun floor is therefore not EOL hygiene; it is choosing to stop supporting users
who have not upgraded yet. That may well be right, but it is a narrower promise made for a different
reason, and filing it under the same heading as the Node decision would hide that.

🔓 **Recommendation, owner to confirm — separate the two things being called "pinning":**

- **CI / test matrix → 1.4.0, yes.** Test against the runtime people will actually be on.
- **Published support floor → hold at 1.3 for one cycle.** A *complete implementation rewrite* is an
  argument for **widening** the test matrix, not narrowing the support floor: as of six days ago
  Bun's runtime is entirely new code, so a behavioural difference between 1.3.x and 1.4.x is far
  likelier than between any two Zig releases. That is precisely when keeping the older line in the
  matrix earns its keep — and it costs nothing here, since scoop already retains 1.3.14 on disk.

Two things cut the other way, recorded so the decision is not made on one-sided evidence: Bun's own
post says Claude Code had been running the Rust port for months before release, so it is not untested
in the wild; and on the one probe this plan actually depends on, `import.meta.main`, **1.3.14 (Zig)
and 1.4.0 (Rust) behave identically** — verified, not assumed.

Whatever is chosen lands in the same README sentence as the Node floor, because it is the same kind
of claim: something a consumer must know before adopting.

### N7 🔓 Runtime-portability rule — no `Deno.*` in shipped source, and `node:` is not the universal answer

Owner direction, 2026-08-26: **avoid Deno-specific functions, for cross-compatibility between Deno,
Node, Bun and the web.** Recorded as a proposed MUST rather than a note, because it has the same
shape as the naming rule — a binding invariant both codebases already half-hold, cheap to check
mechanically, and expensive to restore once violated.

#### The rule is layered, and that is the part worth writing down

**Four targets, not three.** Adding *web* changes the answer, because the portable substitute for a
Deno API is not the same at every layer:

| layer | may use | may not use | why |
| --- | --- | --- | --- |
| **library** — the exported surface | web-standard APIs only | `Deno.*`, `node:*` | must run in a browser |
| **CLI + interop** — `tools/`, `interop/`, `main.ts` | `node:*` builtins | `Deno.*` | not browser code; `node:` works on Deno, Node **and** Bun |

⚠️ **The trap this prevents:** `node:` builtins look like the portable answer, and for the CLI layer
they are — that is exactly why binaryen-ts's `wasm-opt.ts` reads files through `node:fs/promises` and
runs on all three runtimes. But applying the same substitution to **library** code would break the
browser target while feeling like a portability improvement. Porting `Deno.readFile` →
`node:fs/promises` is correct for the six tools **because tools are not browser code**, not because
`node:` is universal. Anyone doing N3's step-4 work mechanically will reach for that substitution;
this is the note that tells them where it stops.

binaryen-ts already documents the boundary at the file that sits on it — `src/interop/binaryen-js.ts`
says *"Node 18+, or Bun. Not available in the browser."*

#### Measured 2026-08-26

| | `Deno.*` | real `node:` imports |
| --- | --- | --- |
| **binaryen-ts** | **0 occurrences** — the ban is real and observed | `main.ts`, `src/tools/wasm-opt.ts`, `src/interop/binaryen-js.ts` — the CLI/interop layer only |
| **wabt-ts** | **53 occurrences on 43 lines**, all 6 files in `src/tools/` | **0** |

So the violation set is exactly wabt-ts's six CLI tools — **this rule and N3 are the same work seen
as policy rather than as a task.** Everything else in both trees already complies, and wabt-ts's
library tree is the stricter of the two: zero `Deno.*` *and* zero `node:`.

#### The check

Mechanical, so the rule survives whoever last read it — wire it into CI beside `fmt`, `lint` and the
naming check:

```sh
# 1. No Deno globals in shipped source. Must be empty.
git ls-files 'src/*.ts' 'main.ts' \
  | xargs -I{} git grep -nE '\bDeno\.[a-zA-Z]' -- {} \
  | grep -vE ':[0-9]+:\s*\*'

# 2. No node: imports outside the CLI/interop layer. Must be empty.
git ls-files 'src/*.ts' | grep -vE '/(tools|interop)/' \
  | xargs -I{} git grep -nE "^\s*(import|const|let)\b.*['\"]node:" -- {}
```

✅ **Both verified against the live trees, 2026-08-26**: binaryen-ts returns 0 and 0; wabt-ts
returns 43 and 0 — the 43 being exactly the six tools' `Deno.readFile` / `Deno.exit` /
`Deno.writeTextFile` lines and nothing else. A check that has never been seen to fire is a claim,
not a gate.

⚠️ **Both greps must exclude JSDoc.** Found the hard way while measuring this entry: a first pass
matched `node:` and reported two wabt-ts *library* modules as violations. They were `const node:
BlockExpr` — a variable named `node` with a type annotation. A second pass matched doc-comment lines
showing consumers `import { writeFile } from "node:fs/promises"`, which is legitimate documentation
of Node usage, not the module's own import. **Neither false positive was a violation, and both would
have been reported as one.** A portability check that cries wolf gets disabled, so it is worth the
extra clause.

#### Status

🔓 Open only in the sense that it is not yet enforced. The rule itself follows from a decision already
made — cross-runtime support is a published capability — and nothing in either tree contests it. It
becomes true automatically when step 4 lands, so the natural sequencing is: **do N3's extraction,
then turn the check on in the same commit**, the way gate 4 already turns on the naming check.

---

## 4. Re-derived numbers

Both source documents say to re-derive before quoting. Done. Most hold; the `cmem/` counts have all
drifted, in the direction that matters.

| claim | source | re-derived 2026-08-26 | |
| --- | --- | --- | --- |
| `src/` LOC · files, binaryen-ts | 23,256 · 38 | 23,256 · 38 | ✅ |
| `src/` LOC · files, wabt-ts | 31,344 · 38 | 31,344 · 38 | ✅ |
| tracked path collisions | 21 | 21 | ✅ |
| `src/` dir collisions | 4 / "five" | **4** | ⚠️ C4 |
| export subpaths (b-ts / w-ts) | 11 / 8 | 11 / 8 | ✅ |
| export subpath collisions | 2 (`.`, `./compat`) | 2 | ✅ |
| naming-rule violations, binaryen-ts | 0 | 0 | ✅ |
| naming-rule violations, wabt-ts | 1 (`src/bridge/binaryen-bridge.ts`) | 1, same file | ✅ |
| `import.meta.main` in wabt-ts published modules | 6 | 6 | ✅ |
| binaryen-ts `src/` under wabt-ts `compilerOptions` | 4 errors, all `exactOptionalPropertyTypes` | **4**, all TS2375/TS2379 | ✅ |
| wabt-ts barrel (`src/index.ts`) | 33 `export *` lines | 33 | ✅ |
| binaryen-ts `main.ts` exports | 0 | 0 | ✅ |
| both packages on JSR | 1.5.0 / 1.5.0 | 1.5.0 / 1.5.0 | ✅ |

**`cmem/` counts — all four figures moved, and the asymmetry moved with them:**

| file (wabt-ts / binaryen-ts) | binaryang.md said | wabt-ts said | today |
| --- | --- | --- | --- |
| `best-practices.md` | 2866 / 287 | 2866 / 166 | **2894 / 294** |
| `bridge.md` | 283 / 269 | 283 / 138 | **283 / 312** |
| `INDEX.md` | 216 / 97 | — | 216 / 100 |
| `overview.md` | 511 / 95 | — | 511 / 95 |
| `testing.md` | 570 / 186 | — | 635 / 186 |
| `publishing.md` | 326 / 193 | — | 335 / 193 |
| `phases.md` | 214 / 167 | — | 214 / 177 |
| `licensing.md` | 49 / 40 | — | 49 / 40 |
| **colliding total** | 5,035 / 1,334 (3.8:1) | — | **5,137 / 1,397 (3.7:1)** |
| **all `cmem/`** | 14,096 / 3,067 | 14,023 / 2,296 | **14,395 / 3,586** |

⚠️ **`bridge.md` has inverted.** Both registers describe binaryen-ts's as the smaller file (269, or
138) and call the pair "near-parity." Today binaryen-ts's is **312 against wabt-ts's 283** — it is
now the larger of the two. It grew by taking on the binding naming rule, which is the single most
consequential paragraph either project wrote this week.

That matters for the `cmem` merge specifically: `bridge.md` was flagged as needing the most
judgement *because* it was two views of one boundary at equal weight, and it still is — but a merger
reaching for "keep the bigger one" now gets the opposite answer than they would have yesterday. It
was never a good heuristic; it is now a demonstrably unstable one.

✅ **`best-practices.md` remains the trap**, at 9.8:1. The instruction stands and is the sharpest
thing in either document: for that file, do **not** pick a surviving vantage point. Both sides
independently derived the same rules — one authoritative enumeration, an exit code is not evidence,
a fixture where both readings pass proves nothing. **For a rule two teams found separately, both
origin stories are the evidence**, and choosing a survivor discards the strongest thing about it.

---

## 5. Carried forward unchanged

These come from the wabt-ts register, are unaffected by the reconciliation, and are **not
re-verified here** — they are wabt-ts-internal measurements and this document does not launder them
into fresh facts. Dates are theirs.

- **A0 — T13.22, the compensating pair: CLOSED before the merge, verified by both sides.** Pin exact
  at `1.5.0`, `buildCatchClause` runs before `ctx.labelStack.push(name)`, gated by
  `tests/bridge/try_table_catch_scope.test.ts` with a numeric probe. Landed `5404946d`, released as
  wabt-ts v1.5.0. **Keep the pin exact until the merge removes the dependency** — not for the
  cancellation, which is gone, but because binaryen-ts's encoder changes what it *requires of
  callers* between versions (T13.47), and an import-surface check cannot see that. ✅ The pin is
  still exact in `wabt-ts/deno.json` today, on `/ir` and `/encoder`.
- **A1 — the bridge's de-coarsening is INCOMPLETE. 3 measured failing shapes** (imported func with a
  `(ref $T)` param; tag with a `(ref $T)` param; global of type `(ref null $T)`). 24 coarsening call
  sites remain, 5 are precise. **No test covers any of them, which is why 28/28 reads as green.**
  Tracked as T13.50 with repros. Survives the merge and lands on the boundary both projects share.
  The third shape is a *different* defect sitting next door — the bridge refuses `ref.null` with a
  user-defined heap type. Do not widen the de-coarsening and assume it went away.
- **A2** — Phase 8 (`wasm2ts`) is a stub that throws. **A3** — diagnostic offset accuracy is
  *unmeasured*, not clean; do not let the merge convert it to "clean" by attrition.
- **A4** — two open questions with the wasmtk team: 373 vs 413 corpus counts (deliberately not
  reconciled — what constitutes "the corpus" is a fact about wasmtk), and legacy EH in wasic, 10
  modules, theirs to migrate.
- **A5 / environment** — `git repack` fails on this exFAT drive
  (`could not write multi-pack-index: Permission denied`). Commits and pushes succeed. Harmless but
  noisy, **and it will look like a merge symptom if nobody wrote it down first.** Its sibling — the
  `safe.directory` requirement — is the same class, and is what step 0 addresses. 🆕 Done for
  binaryang on 2026-08-26: added to the local-disk system gitconfig
  (`…/AppData/Local/Programs/Git/etc/gitconfig`), beside the existing `binaryen-ts` and `wasmtk`
  entries. Every git command in the repo failed before it.
- **G1 — the emitted-byte baseline: DONE.** `scripts/pre-merge-baseline.tsv`, all **421** corpus
  files, length + hash of `wat2wasm` output and hash of `wasm2wat` text, 1,557,602 bytes total.
  Re-run after the merge with `deno run --allow-read scripts/verify-baseline.ts`. **A pure
  relocation MUST report `IDENTICAL`.** It is deliberately **not a test**: it pins output bytes, so a
  genuine encoder improvement is *supposed* to fail it — re-baseline in the same commit and say why.
  Verified in both directions before the merge. This is the strongest single gate the merge has, and
  it exists only because someone captured it while "before" still existed.
- **C3 — `minimumDependencyAge: "0"` is wabt-ts-only**, set deliberately (T13.48) because every
  dependency is our own scope plus `@std`. ✅ still set today. Carry it forward *consciously*: it is
  a supply-chain default being waived, and it will be inherited silently if the merged `deno.json` is
  assembled by union.
- **G2a — the merged repo takes wabt-ts's `compilerOptions`**, measured not preferred. ✅ Re-derived
  today at exactly 4 errors. See N2 for the part it did not measure. `lib` is the one genuine merge
  rather than adoption: `dom` (binaryen-ts) vs `deno.window` (wabt-ts) — **union them and re-check;
  do not pick one blind.**
- **E2 — `CLAUDE.md` does not travel, intentionally.** Gitignored, machine-local, absent from any
  clone. Every top-level section maps onto `cmem/`. Do not spend merge time reconciling it and do
  not go looking for it afterwards. The rule it leaves behind is the one this file follows: project
  knowledge lives in `cmem/`, which survives a clone; machine-local memory holds only what is true
  of the machine.
- **What should NOT be fixed first: A1.** It is real, but the merge makes it strictly *cheaper* —
  the fix needs both type systems visible at once, which is exactly what the merge provides — and it
  **fails loudly** (`unresolved GC function type`), so unlike T13.22 it cannot be made invisible by
  merging. Same for A2 and A3.

---

## 6. The corrected order

Steps unchanged from the kickoff brief except where marked. The ordering rationale is the valuable
part and is preserved.

| # | step | change |
| - | ---- | ------ |
| **0** | Unblock the repo — `safe.directory` | ✅ **done 2026-08-26** |
| **0.5** | **`fmt.singleQuote` → `true` in binaryen-ts, its own commit, in their repo** | ✅ **done 2026-08-26, `2c41d3d1371`** — 104 files, 4,302/4,302, pure. Was agreed, never executed, omitted from the brief (P1). |
| **1** | Write the decisions into the binaryang README — two projects, not three | draft on disk; extend with the six decisions and 1.5.1 |
| **2** | Merge the trees, both histories, into `src/binaryen-ts/` + `src/wabt-ts/` | preserve `tests/deno.json` as a workspace member (N2); rename `binaryen-bridge.ts` → `bridge.ts` |
| **3** | Resolve the export map | ✅ **decided 2026-08-26** — narrow authored root, not wabt's barrel; map drafted in C2; no subpath named `./ir` |
| **4** | Unify the CLI | ⚠️ **six extractions + a `Deno`→`node:` port, not six registrations** (N3). VERSION closed upstream (N4). 🔓 **Settle the Node floor first (N6)** — it rewrites these same files, and the `import.meta.main` rationale expires with it. |
| **5** | Unify the harness | ⚠️ settle the `_test.ts` / `.test.ts` split first (N1) |
| **6** | Merge `cmem` by topic | `bridge.md` has inverted; `best-practices.md` keeps both origin stories |

**Why the order is the order**, since that is what makes it hold under pressure: 0 unblocks
everything. 0.5 and 1 must precede 2 because after the trees move, a requote and a decision record
both land in a diff that no longer has anywhere clean to put them. 2 precedes 3 because the export
map is a third surface that only resolves once the files exist. 4 follows 3 because the dispatcher
registers paths the export map defines. 5 follows 4 because there is no single harness until there
is a single entry point. 6 is last because `cmem` describes the result, and half of what the two
`bridge.md` files say stops being true the moment the boundary they describe stops existing.

### Gates

| after | gate |
| --- | --- |
| 0.5 | ✅ met — one commit, 104 files, insertions equal deletions, nothing else in the diff |
| 2 | **907** tests green · both publish dry-runs clean · **`verify-baseline.ts` reports `IDENTICAL`** |
| 3 | every old subpath still resolves |
| 4 | the naming check returns empty, in CI · **the portability checks return empty (N7)** · all six tools run from `binaryang <tool>` on Deno, Node and Bun |
| 5 | one command runs everything, across both test-file conventions |
| before 1.5.1 | wasmtk builds green against binaryang alone |

⚠️ Gate 2 was **906**; it is **907** now. binaryen-ts went 513 → 514 with `tests/version_sync_test.ts`
(N4). That is arithmetic on each side's reported total, not a run of the merged suite — re-derive it
after step 2 rather than trusting this line, which is the whole point of § 8.

The baseline check is added to gate 2 deliberately. **An exit code is not evidence in this
codebase** — the standing rule from `binaryen-ts/cmem/INDEX.md` § "regression gate", and the reason
it exists is that the behavioural rungs are the ones that catch a valid-but-wrong module. 906 green
tests prove the suites ran; `IDENTICAL` across 421 corpus files and 1,557,602 bytes proves the
relocation changed nothing. Only one of those two is a statement about the merge.

---

## 7. What to watch afterwards

**56 exported type names collide** — `Type`, `ValueType`, `WasmModule`, `Token`, and ~52 expression
nodes. **Zero runtime values collide**, so the ambiguity is compile-time and visible to the checker
rather than silent.

That number is the convergence indicator. It is measurable on demand by diffing exported type
declarations across both `src/` trees, and **it only moves when convergence is real** — which is
what makes it worth having, because two namespaced trees with a working bridge is a **stable**
arrangement. Nothing breaks if convergence never happens. That is what makes the layout safe and
exactly why it needs something pulling the other way.

🔓 **One gap in the promotion rule, found here and left open.** A module earns a common `src/` folder
when nothing in either namespaced tree still imports it from the other side — the import graph
answers it mechanically, and "it felt shared" is not the test. But **the bridge is cross-tree by
definition**, so it is the one module the rule can never promote, while being the module that most
obviously belongs to neither side. wabt-ts's B1 saw this from the other direction and said
`src/bridge` "stays where it is — it is the seam, belonging to neither side," which conflicts with
"each project's structure moves unchanged," since `src/bridge` is currently wabt-ts's.

Not decided here, because it is a layout decision the owner settles and it does not block step 2:
the bridge can move in under `src/wabt-ts/bridge/` and be promoted later without cost. Flagged so it
is not discovered as a surprise the first time someone runs the promotion test and finds the seam
permanently ineligible.

---

## 9. Open questions on the C3 retirement plan

Two, both small, both worth settling before anything is published.

### 9.1 🔓 What "pointing at binaryang" means in the 1.5.1 releases

Two readings, and they are different work:

- **(a) Signpost only** — the 1.5.1 release changes the README to say the project is now binaryang,
  and marks the package deprecated on JSR. No code change; the last real code stays at 1.5.0.
- **(b) Forwarding** — 1.5.1 re-exports binaryang's modules, so old imports keep resolving to live
  code.

**Recommended: (a).** With the dependent set measured at exactly one — wasmtk, which will migrate by
editing two import-map lines rather than by resolving a forward — the code path in (b) would be
written for nobody. (a) is also the honest signal: a package that forwards is still alive, and this
one is not.

One caveat that argues (a) is *sufficient* rather than merely cheaper: LeptonPad reaches both
packages through an **unpinned** `deno run -A jsr:@jrmarcum/wasmtk`, so it follows wasmtk
automatically the moment wasmtk publishes against binaryang. It never needs to see the notice.

### 9.2 🔓 The version ladder — three packages at 1.5.1, or a clean staircase

As stated, binaryang starts at **1.5.1** (decision 4) *and* both predecessors publish **1.5.1** as
their terminal release. That works, but it puts three packages on the same number in the same week,
and it undercuts decision 4's own story — "1.5.1 is the next version after two 1.5.0s" stops being
true once the predecessors themselves ship a 1.5.1.

**Alternative worth a moment:** predecessors terminate at **1.5.1**, binaryang begins at **1.5.2**.
The numbering then tells the whole story without a footnote:

| version | state |
| --- | --- |
| 1.5.0 | two live packages |
| 1.5.1 | two terminal pointers |
| 1.5.2 | one package — binaryang |

This also matches the phrasing of the decision itself, *"a clean break once binaryang 1.5.2 is
published"* — under this ladder 1.5.2 **is** the break rather than the release after it.

⚠️ Flagged rather than adopted: it revises **decision 4**, which is on the settled list, and settled
decisions are not reopened here. Owner's call, and cheap either way — but cheaper before publish
than after.

---

## 8. How to use this file after the merge

Same rule the wabt-ts register set for itself, and it is the right one:

**Do not delete an entry when it is fixed — mark it, with the commit.** The value of this file is
proving what was and was not already broken before the trees became one, and that value is destroyed
by tidying. Once there is no repository boundary left, "it was already like that" is unfalsifiable
unless something wrote it down first.

Re-derive before quoting any number here. Every one carries the date it was measured, not a
guarantee.
