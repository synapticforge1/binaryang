# cmem — Portable Project Memory for wabt-ts

This folder is the **authoritative, portable project memory** for `wabt-ts`. It lives inside the
project tree, so it travels with the project (USB drive, clones) and is committed to git — unlike
the legacy `CLAUDE.md`, which is `.gitignore`d and therefore machine-local only.

**Format:** plain Markdown — one focused topic file per domain, so any single concern can be
reviewed and revised without wading through one giant file. Keep files small and single-topic.

This layout mirrors the `cmem/` convention established in the sibling `wasmtk` project.

## Policy (durable)

- **`cmem/` is the single home for ALL project memory.** When the owner (or anyone) says "**update
  the project memory**," that means: update the matching `cmem/` topic file with the latest
  decisions, found bugs, design changes, and current state — then add/refresh its one-line pointer
  in the table below. Convert relative dates to absolute; update existing entries rather than
  duplicating.
- **`README.md` is NOT project memory.** It is the public, user-facing document shipped to GitHub
  and JSR. Keep internal decision logs / bug post-mortems out of it (those live here).
- The legacy `CLAUDE.md` (repo root, gitignored, machine-local) is the auto-loaded historical
  archive and remains the exhaustive line-by-line record; `cmem/` is the curated, portable source of
  truth that supersedes it going forward. When the two disagree, reconcile and prefer `cmem/`.

### The "update the project memory" trigger (binding on every agent)

When the owner says **"update the project memory"** (or any clear synonym — "update memory", "record
this", "remember this for the project"), the required action is:

1. **Revise all relevant `cmem/` files** — fold the latest decisions, found bugs, design changes,
   and current state into the matching topic file(s); refresh the one-line pointer in the Files
   table; convert relative dates to absolute; update existing entries instead of duplicating.
2. **Sync `README.md` where, and only where, the change is user-relevant** — install/usage,
   examples, capability surface, status. Keep internal detail in `cmem/` only.

This is the durable contract for this repo. Any agent reading this file is expected to honor it.

### Trigger — "look for code issues" (binding on every agent)

Comprehensive audit across **both tested AND untested** paths for: (1) workarounds / temporary
hacks; (2) dead code (verify each with a grep); (3) bugs — silently-wrong codegen, inverted logic,
type-inference gaps, scanner off-by-ones; (4) **silent fall-throughs** — the worst failure mode:
unhandled input skipped or padded with a placeholder instead of erroring. Prefer converting
silently-wrong into a hard fail. Report `file:line` + severity, fix the safe ones, keep every gate
green.

**What "audit" means here specifically** — corpus coverage is NOT the tool. Both bugs found this way
(Bug G; the atomic `memidx`) were unreachable by either corpus. Enumerate the TYPE and check the
code against it:

- every `Var`-bearing field of every `Expr` interface vs. the `resolveNames` case that handles it;
- every `ExprVisitorDelegate` hook vs. each walker that must be total (both writers, the validator);
- a family of parallel handlers — **a sibling that does what its neighbour skips is the strongest
  single tell**.

### Trigger — regression gate (binding)

**When a bug is found or fixed, run the whole gate**, which for this repo is:

```sh
deno task check && deno task test && deno fmt --check && deno lint
```

Then **re-measure the conformance metrics that the change could move** — they live outside the test
suite and nothing else will catch a regression in them. The set and their current values are in
[overview.md](overview.md); the harnesses and what each one is blind to are in
[testing.md](testing.md). A parser, reader, writer or validator change can move any of them.

**Measure, do not assume.** "Outlier" is relative to which FILE changed, never absolute. A change
that looks confined to the WAT writer moved the round-trip metric by 80 modules (T10.1).

## Files

| File                                       | What it holds                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [overview.md](overview.md)                 | What wabt-ts is, the long-term wasmtk/wasm2ts goal, **the current conformance state (all five metrics)**, repo layout, the upstream C++ reference tree                                                                                                                                                                                 |
| [runtime-tooling.md](runtime-tooling.md)   | Deno-primary / Bun-secondary; the four load-bearing TS compiler rules (`verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `deno.window` lib); `Result` enum shape; no `Deno.*` in library dirs                                                                                                          |
| [phases.md](phases.md)                     | Phase delivery plan (1–8) with status, the TS↔C++ file mapping per phase, and the per-phase gotchas (IR field names, keyword tokens, fold-form invariants, validator rules, CLI pipeline decisions)                                                                                                                                    |
| [design-decisions.md](design-decisions.md) | Load-bearing invariants that must NOT be silently reverted — performance/singleton invariants + the full bug-fix invariant log (return-values array, f64 bits as bigint, SIMD lane arity, legacy try/catch, statement ordering, resolveNames completeness, GC type encodings, …)                                                       |
| [bridge.md](bridge.md)                     | Phase 7 binaryen bridge — the binaryen-ts constructor API surface, bridge type mapping, post-order traversal constraint, tier-by-tier coverage (A/B/C/D + GC 1–4), and the cumulative gotchas                                                                                                                                          |
| [testing.md](testing.md)                   | How to run the gate; **the five conformance metrics and what each is blind to**; the wasmtk WAT corpus runner and the fact that `tests/wasmtk/` is a FROZEN SNAPSHOT (`PROVENANCE.md`); regression-test placement                                                                                                                      |
| [licensing.md](licensing.md)               | MIT-primary with Apache-2.0 alternative; file layout (`LICENSE` / `LICENSE-MIT` / `LICENSE-APACHE` / `NOTICE.md`); per-file ported-vs-original headers; the no-compound-SPDX rule                                                                                                                                                      |
| [publishing.md](publishing.md)             | JSR package `@jrmarcum/wabt-ts`; tag-driven publish flow (never `deno publish` locally — OIDC provenance); the bump task + sub-version-capped-at-9 rule; CI workflows                                                                                                                                                                  |
| [best-practices.md](best-practices.md)     | **Method rules, each paid for by a real incident here** — parse-count is an upper bound, confirm root causes with repros not error text, producer/consumer order mismatches, invert a new guard test before trusting it, measure severity never inherit it. Structure adopted from the sibling wazmrt project's file of the same name. |
| [tasks.md](tasks.md)                       | **Granular** implementation status, per-file checklists, and the running phase/bug/decision log (relocated from the repo-root `TASKS.md` on 2026-06-09). `phases.md` is the distilled summary; this is the detail.                                                                                                                     |

## Related files outside cmem

- `README.md` — the **public, user-facing** doc for GitHub/JSR. NOT project memory.
- `CLAUDE.md` — legacy exhaustive memory archive (repo root, gitignored, machine-local; auto-loaded
  by Claude Code). The line-by-line historical record; superseded by `cmem/` as the curated source
  of truth.

(The granular task/decision log formerly at the repo-root `TASKS.md` now lives inside this folder as
[tasks.md](tasks.md), so all project memory is in one committed, portable place.)
