# Known issues recorded BEFORE the binaryang merge (2026-08-25)

Written while wabt-ts and binaryen-ts are still separate repositories, so that
nothing below gets absorbed into "it was already like that" once they are one.

**Everything here was MEASURED from the wabt-ts side today**, against
wabt-ts `3afd6033` (v1.5.0) and binaryen-ts `v1.5.0`. Where an item is a fact
about binaryen-ts that we did not verify ourselves, it says so. That
distinction is not pedantry — reading a frozen copy as live cost three wrong
reports to the wasmtk team this month.

---

## A0. T13.22 — the compensating pair. CONDITION MET before the merge starts

Raised by the binaryen-ts team as the first thing that must not travel into the
merge, and they are right about why: **two errors that cancel across a
repository boundary have no boundary left to be noticed at.** Merged first, it
would have become invisible rather than fixed.

**Already closed, 2026-08-25, before the merge begins.** Verified now, not
recalled:

| | |
| --- | --- |
| pin | `jsr:@jrmarcum/binaryen-ts@1.5.0`, exact |
| bridge ordering | catch clauses built BEFORE `labelStack.push` |
| gate | `tests/bridge/try_table_catch_scope.test.ts`, and its probe is NUMERIC |

Landed as `5404946d`, released as wabt-ts v1.5.0, bridge suite 28/28. Their
instruction — *land the fix and the pin bump before the merge starts* — was
satisfied before the note arrived.

**Keep the pin exact until the merge actually removes the dependency.** Not for
the cancellation, which is gone, but because their encoder changes what it
REQUIRES of callers between versions (T13.47), and an import-surface check
cannot see that.

---

## A. Product issues that SURVIVE the merge

These are real defects. They do not become less real by being in one repo.

### A1. The bridge's de-coarsening is INCOMPLETE — 3 measured failing shapes

> **Tracked as T13.50** in [tasks.md](tasks.md), with repros, the exact call
> sites, acceptance criteria and the gate it needs. Scheduled for AFTER the
> merge, deliberately — see section G.

T13.47 replaced `wabtTypeToValType` (coarsens `(ref $T)` → `structref`) with the
precise `wabtTypeToValueType` at the sites the tests exercised. **24 coarsening
call sites remain; only 5 are precise.** Confirmed still broken:

| shape | result |
| --- | --- |
| imported func with a `(ref $T)` param | `unresolved GC function type: (structref) -> ()` |
| tag with a `(ref $T)` param | `unresolved GC function type: (structref) -> ()` |
| global of type `(ref null $T)` | `Bridge: ref.null with a user-defined heap type is not…` |
| `call_indirect` with `(ref $T)` | OK |

Repro for the first (the others are in the same shape):

```wat
(module
  (type $T (struct (field i32)))
  (import "m" "f" (func $imp (param (ref $T))))
  (func (export "g") (param (ref $T)) (call $imp (local.get 0))))
```

**No test covers any of them**, which is exactly why 28/28 reads as green. The
remaining sites are `addFunctionImport`, `addGlobal`, `addTag`, `addTable`,
locals, and the block/field helpers.

The third row is a DIFFERENT defect that happens to sit next door: the bridge
refuses `ref.null` with a user-defined heap type. Do not fix it by widening the
de-coarsening and assume it went away.

### A2. Phase 8 (`wasm2ts`) is a stub that throws

The project's actual long-term goal — WASI Preview 1 capable TypeScript output —
is unimplemented. Deferred pending wasmtk QA/QC, not blocked by anything here.

### A3. Diagnostic OFFSET accuracy is UNMEASURED

Not clean — **unmeasured**. T13.35's cheap oracle ("the reported offset must not
precede the corrupted byte") is false for every multi-byte construct, and no
replacement was built. T13.37 measured the WORDS against the spec's expected
texts; the positions were never graded. Do not let the merge convert this into
"clean" by attrition.

### A4. Two open questions with the wasmtk team

- **373 vs 413.** They count their live corpus at 373; we generate 413 from the
  same checkout. Deliberately NOT reconciled — which sources constitute "the
  corpus" is a fact about wasmtk.
- **Legacy EH.** wasic emits the superseded `try`/`catch` encoding, which
  Wasmtime and Wasmer both reject. Theirs to migrate; scope is 10 modules, not
  the 6 our old snapshot showed.

### A5. Environment: git repack fails on every commit

`fatal: could not write multi-pack-index: Permission denied` on this exFAT
drive. Commits and pushes succeed; only the geometric repack fails. Harmless but
noisy, and it will look like a merge symptom if nobody writes it down first.

---

## B. Merge-mechanical issues (measured)

### B1. FIVE `src/` directories collide with different contents

The dangerous one. Same path, different meaning:

    src/ir      wabt IR          vs  binaryen IR
    src/parser  wabt WAT parser  vs  binaryen's own
    src/api     compat facade    vs  compat facade
    src/tools   wabt CLI tools   vs  wasm-opt

`src/ir` is the worst: **the bridge exists precisely to translate between these
two IRs.** Merging them into one directory destroys the distinction the whole
project is built on. A namespacing decision is required BEFORE any file moves —
`src/wabt/…` + `src/binaryen/…`, or keep them as separate top-level trees.

Non-colliding, so they can move as-is: `src/bridge`, `src/core`, `src/interp`,
`src/reader`, `src/validator`, `src/writer` (wabt-ts) and `src/binary`,
`src/encoder`, `src/interop`, `src/passes`, `src/wasm` (binaryen-ts).

### B2. 21 tracked paths collide

3 workflows (`auto-tag`, `ci`, `publish`), 4 licence files, `README.md`,
**8 `cmem/` files** (this said 7 until re-counted), `deno.json`, `deno.lock`,
and 3 release scripts (`bump_version`, `publish`, `version`).

**The `cmem/` overlap is the hard one, and it is not concatenation.** Measured:

| | wabt-ts | binaryen-ts |
| --- | --- | --- |
| total `cmem/` lines | **14,023** | 2,296 |
| `tasks.md` | **7,485** | (none) |
| `design-decisions.md` | 1,183 | (none) |
| `best-practices.md` | 2,866 | 166 |
| `bridge.md` | 283 | 138 |

`tasks.md` and `design-decisions.md` have no counterpart and move as-is. The
eight that collide do not: **the two `bridge.md` files describe one boundary
from opposite sides, and will contradict each other the moment that boundary
stops existing.** Neither is wrong today; both go wrong together.

The 6:1 size asymmetry matters too — a naive merge reads as wabt-ts's memory
with binaryen-ts notes appended, quietly losing the smaller project's reasoning.
Merge by TOPIC, deciding per file which vantage point survives; for `bridge.md`,
most of both becomes history that the merge itself invalidates.

### B2a. `exports` subpath collisions — TWO, and this audit missed them

**Found by the binaryen-ts team, not by us.** This audit checked `src/`
directories and tracked file paths and never looked at the `exports` map, which
is a third and separate surface. Recorded as a miss because the lesson is the
reusable part: **a package's public subpaths are not derivable from its file
tree.**

| subpath | wabt-ts | binaryen-ts |
| --- | --- | --- |
| `.` | `./src/index.ts` | `./main.ts` |
| `./compat` | `./src/api/wabt-compat.ts` | `./src/api/binaryen-compat.ts` |

`./compat` is the one that bites: two different facades on one subpath, and both
are the migration surface their consumers were told to adopt. Their proposal —
**`./compat/binaryen` and `./compat/wabt`** — is the obvious pair, and wasmtk
already imports them under the aliases `binaryen` and `wabt`, so its migration
is two lines in an import map.

`.` needs deciding too: one root entry cannot be both.

And a near-miss worth pre-empting: binaryen-ts exports `./ir`, `./encoder`,
`./binary`, `./passes`, `./wasm`, none of which collide today because wabt-ts
ships its IR through `.`. In a merged package `./ir` would READ as "the IR"
while meaning only the binaryen one — the same ambiguity as the `src/ir`
directory collision (B1), one layer up.

### B3. Two JSR packages, two version streams, one publish flow

`@jrmarcum/wabt-ts` and `@jrmarcum/binaryen-ts`, both at **1.5.0** as of today —
a convenient moment to merge, and the reason wabt-ts skipped 1.4.2–1.4.9.

Undecided, and it changes `scripts/publish.ts`: does binaryang publish **one**
package, **two** from a monorepo, or keep publishing both names for
compatibility? Consumers today import `jsr:@jrmarcum/wabt-ts@^1.3.5/compat`
(wasmtk) — a rename is a breaking change for them regardless of version number.

---

## C. Configuration (measured)

### C1. `compilerOptions` differ in 5 of 7 — and the cost is small

| option | wabt-ts | binaryen-ts |
| --- | --- | --- |
| `exactOptionalPropertyTypes` | **true** | unset |
| `noUncheckedIndexedAccess` | **true** | unset |
| `verbatimModuleSyntax` | **true** | unset |
| `noImplicitReturns` | **true** | unset |
| `noFallthroughCasesInSwitch` | **true** | unset |
| `lib` | `ES2022, deno.ns, deno.window` | `deno.ns, esnext, dom` |
| `strict` | true | true |

**Measured:** binaryen-ts's full 38-file `src/` under wabt-ts's options produces
**4 type errors**, all `exactOptionalPropertyTypes` (TS2375 / TS2379). Adopting
the stricter config is therefore cheap — far cheaper than the "13 errors" figure
quoted earlier today, which came from a different setup (their source pulled
through our tests) and should not be used.

`lib` is the one needing thought rather than fixing: `dom` vs `deno.window`.

### C2. `fmt.singleQuote` is opposite

wabt-ts `true`, binaryen-ts `false`. Whichever loses, every file in that half
reformats — one mechanical commit, but it will bury real changes in any diff it
shares. **Do it as its own commit, before or after the merge, never inside it.**

### C3. `minimumDependencyAge: "0"` is wabt-ts-only

Set deliberately (T13.48) because every dependency is our own scope plus `@std`.
Carry it forward consciously; it is a supply-chain default being waived.

---

## D. Licensing (measured)

Both declare **MIT**. Divergences:

- Copyright line: `2026 Jon Marcum` vs `2024 J.R. Marcum` — name form AND year.
- `LICENSE` differs beyond that: wabt-ts's carries a trailing pointer to
  `LICENSE-APACHE`.
- **wabt-ts has `NOTICE.md`; binaryen-ts does not.** wabt-ts is a derivative of
  Apache-2.0 WebAssembly/wabt and carries `LICENSE-APACHE`, `NOTICE.md`, and
  per-file attribution headers to satisfy Section 4.

**The merged repo inherits BOTH upstreams' obligations** (WebAssembly/wabt and
whatever binaryen-ts derives from). Per-file headers must survive the move — a
file relocated from `src/ir/` to `src/wabt/ir/` keeps its header. JSR accepts a
single SPDX identifier and **rejects compound expressions**, so it stays `MIT`.

---

## E. What the merge actually RESOLVES

Worth recording so the benefit is not forgotten mid-pain:

- **The T13.22 class cannot recur** — but only because the instance was fixed
  FIRST (A0). Merging with it live would have hidden it permanently, which is
  the binaryen-ts team's point and the reason ordering matters here at all.
- **The T13.22 class cannot recur.** Two errors that cancel across a repository
  boundary were invisible to both sides' tests for four releases. In one repo,
  one test run sees both halves.
- **The exact-pin rationale evaporates.** No version to pin, no
  `minimumDependencyAge` question for this dependency, no 24-hour adoption gap.
- **`/encoder` mapped-but-unimported** and the 11 test files that do import it
  stop being a cross-repo coupling.
- **A1 becomes cheap to finish.** De-coarsening needs both type systems visible
  at once, which is exactly what the merge provides.

---

## G. Do these BEFORE the merge starts

The test for "before" is narrow: **does the merge make it harder, invisible, or
unverifiable?** Everything else is cheaper afterwards and should wait.

### G1. Baseline the emitted bytes — DONE

`scripts/pre-merge-baseline.tsv` records, for all **421** corpus files, the
length and hash of the `wat2wasm` output and the hash of the `wasm2wat` text.
**1,557,602 bytes total.** Re-run after the merge:

```sh
deno run --allow-read scripts/verify-baseline.ts
```

A pure relocation of files MUST report `IDENTICAL`. Anything else is a
behaviour change that needs a reason.

**Why it had to be now:** every conformance harness this project relies on
lives in a session scratchpad, not the repo — deliberately, because they are
cheaper to rewrite than maintain. That trade is fine while the tree is stable
and wrong across a move-refactor, because a harness rewritten AFTER the merge
has nothing to compare against. The manifest is the part that had to be
captured while "before" still existed.

Verified in both directions: it reports `IDENTICAL` on the current tree and
exits 1 naming the file when a single byte-count or hash is altered.

**It is NOT a test**, deliberately. It pins output bytes, so a genuine encoder
improvement is supposed to fail it — the minimal section-size fix (T13.40)
changed every byte in the corpus. Re-baseline in the same commit as such a
change and say why.

### G2. `fmt.singleQuote` — RESOLVED: binaryen-ts adopts `true`

Reformat in the SOURCE repo, as its own commit, before the merge. Done during
it, a whole-file requote lands in the same diff as thousands of moved lines and
makes the merge unreviewable — this project has already watched a line-ending
flip turn a 47/10 diff into 1649/1612.

**Which side moves is settled by size, not preference:** binaryen-ts tracks
**125** files against wabt-ts's **635**. Requoting the smaller tree is ~1/5 the
churn, and wabt-ts is already internally consistent at `singleQuote: true`.

**Execution belongs in the binaryen-ts repo**, and nothing here writes into it —
the same boundary they kept when they drafted their handoff rather than editing
our tree. One commit on their side: `deno fmt` after flipping the flag.

### G2a. `compilerOptions` — RESOLVED: the merged repo takes wabt-ts's

Measured, not preferred: binaryen-ts's full 38-file `src/` under wabt-ts's
options produces **4 type errors**, all `exactOptionalPropertyTypes`. The
reverse — relaxing to their config — silently discards
`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noImplicitReturns` and
`noFallthroughCasesInSwitch` across 635 files, and those four have each caught
real defects in this project's history.

Four errors is the whole price. `lib` is the one genuine merge rather than
adoption: `dom` (theirs) vs `deno.window` (ours) — union them and re-check,
do not pick one blind.

### G3. Three decisions — RECOMMENDED, owner to confirm

The merge cannot be sequenced without these. Recommendations with the reasoning,
so confirming is cheap and disagreeing is informed.

**B1 — `src/` namespacing → `src/wabt/…` and `src/binaryen/…`.**
Five directories collide and `src/ir` is the one that matters: the bridge exists
to translate BETWEEN those two IRs, so a single `src/ir` erases the distinction
the project is built on. Prefixing by origin keeps every import self-describing
and makes the eventual convergence explicit work rather than an accident.
`src/bridge` stays where it is — it is the seam, belonging to neither side.

**B2a — `./compat/wabt` + `./compat/binaryen`**, as binaryen-ts proposed.
`.` resolves to a root that re-exports both namespaces; the two current roots
(`src/index.ts` and `main.ts`) cannot both keep it. wasmtk already imports under
the aliases `binaryen` and `wabt`, so its migration is two import-map lines.

**B3 — publish ONE package, keep both old names as thin re-export shims.**
A rename breaks `jsr:@jrmarcum/wabt-ts@^1.3.5/compat` (wasmtk) regardless of
version number, and shims cost one file each. Retire them on a later major once
consumers have moved — the shim is what makes that a choice rather than a
deadline.

### What should NOT be fixed first

**A1, the incomplete de-coarsening.** It is a real defect, and the merge makes
it strictly cheaper: the fix needs both type systems visible at once, which is
precisely what the merge provides. It also **fails loudly** — `unresolved GC
function type` — so unlike T13.22 it cannot become invisible by being merged.
The repros in A1 keep it actionable.

Same for **A2** (Phase 8) and **A3** (diagnostic offsets): unaffected by the
merge in either direction.

## E2. `CLAUDE.md` does NOT travel, and that is intentional

The repo root carries a 1,780-line `CLAUDE.md` which is **gitignored** — machine-local, absent
from any clone, and gone the moment the merge produces a new tree. It says so itself at the top:
*"this file is the gitignored, machine-local ARCHIVE; `cmem/` is the committed source of truth."*

Checked before writing this off: every top-level section of it maps onto `cmem/` topic files. Do
not spend merge time reconciling it, and do not go looking for it afterwards.

**One genuine gap was found and closed (2026-08-25):** the `deno fmt` CRLF verification
technique — the `git -c core.autocrlf=false --work-tree=<scratch> checkout` recipe, why
`git archive` cannot substitute, the index-rewrite side effect, and the rule that Python edits
must preserve line endings — existed ONLY in machine-local memory. It is now in
`cmem/testing.md`. Two sibling notes (exFAT `safe.directory`, the multi-pack-index repack
failure) are genuinely MACHINE-level and correctly stay outside the repo.

**The rule the merge should carry forward:** project knowledge lives in `cmem/`, which survives a
clone. Machine-local memory holds only what is true of the machine.

## F. How to use this file after the merge

Each item above is either closed by the merge (section E) or still open. **Do
not delete an entry when it is fixed — mark it, with the commit.** The value of
this file is proving what was and was not already broken, and that value is
destroyed by tidying.

Re-derive before quoting any number here. Every one was measured on 2026-08-25
and carries that date, not a guarantee.
