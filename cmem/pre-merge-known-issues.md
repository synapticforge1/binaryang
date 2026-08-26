# Known issues recorded BEFORE the binaryang merge (2026-08-25)

Written while wabt-ts and binaryen-ts are still separate repositories, so that
nothing below gets absorbed into "it was already like that" once they are one.

**Everything here was MEASURED from the wabt-ts side today**, against
wabt-ts `3afd6033` (v1.5.0) and binaryen-ts `v1.5.0`. Where an item is a fact
about binaryen-ts that we did not verify ourselves, it says so. That
distinction is not pedantry — reading a frozen copy as live cost three wrong
reports to the wasmtk team this month.

---

## A. Product issues that SURVIVE the merge

These are real defects. They do not become less real by being in one repo.

### A1. The bridge's de-coarsening is INCOMPLETE — 3 measured failing shapes

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
**7 `cmem/` files** — including `cmem/bridge.md`, which describes the SAME
coupling from opposite sides — `deno.json`, `deno.lock`, and 3 release scripts
(`bump_version`, `publish`, `version`).

The `cmem/` overlap needs a real decision, not a concatenation: both files are
correct from their own vantage point and contradict each other in emphasis.

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

## F. How to use this file after the merge

Each item above is either closed by the merge (section E) or still open. **Do
not delete an entry when it is fixed — mark it, with the commit.** The value of
this file is proving what was and was not already broken, and that value is
destroyed by tidying.

Re-derive before quoting any number here. Every one was measured on 2026-08-25
and carries that date, not a guarantee.
