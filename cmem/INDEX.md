# cmem — Portable Project Memory for wabt-ts

This folder is the **authoritative, portable project memory** for `wabt-ts`. It lives inside the
project tree, so it travels with the project (USB drive, clones) and is committed to git — unlike
the legacy `CLAUDE.md`, which is `.gitignore`d and therefore machine-local only.

**Format:** plain Markdown — one focused topic file per domain, so any single concern can be
reviewed and revised without wading through one giant file. Keep files small and single-topic.

This layout mirrors the `cmem/` convention established in the sibling `wasmtk` project.

## Policy (durable)

- **`cmem/` is the single home for ALL project memory.** When the owner (or anyone) says
  "**update the project memory**," that means: update the matching `cmem/` topic file with the
  latest decisions, found bugs, design changes, and current state — then add/refresh its one-line
  pointer in the table below. Convert relative dates to absolute; update existing entries rather
  than duplicating.
- **`README.md` is NOT project memory.** It is the public, user-facing document shipped to GitHub
  and JSR. Keep internal decision logs / bug post-mortems out of it (those live here).
- The legacy `CLAUDE.md` (repo root, gitignored, machine-local) is the auto-loaded historical
  archive and remains the exhaustive line-by-line record; `cmem/` is the curated, portable source
  of truth that supersedes it going forward. When the two disagree, reconcile and prefer `cmem/`.

### The "update the project memory" trigger (binding on every agent)

When the owner says **"update the project memory"** (or any clear synonym — "update memory",
"record this", "remember this for the project"), the required action is:

1. **Revise all relevant `cmem/` files** — fold the latest decisions, found bugs, design changes,
   and current state into the matching topic file(s); refresh the one-line pointer in the Files
   table; convert relative dates to absolute; update existing entries instead of duplicating.
2. **Sync `README.md` where, and only where, the change is user-relevant** — install/usage,
   examples, capability surface, status. Keep internal detail in `cmem/` only.

This is the durable contract for this repo. Any agent reading this file is expected to honor it.

## Files

| File | What it holds |
| --- | --- |
| [overview.md](overview.md) | What wabt-ts is, the long-term wasmtk/wasm2ts goal, repo layout, the upstream C++ reference tree |
| [runtime-tooling.md](runtime-tooling.md) | Deno-primary / Bun-secondary; the four load-bearing TS compiler rules (`verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `deno.window` lib); `Result` enum shape; no `Deno.*` in library dirs |
| [phases.md](phases.md) | Phase delivery plan (1–8) with status, the TS↔C++ file mapping per phase, and the per-phase gotchas (IR field names, keyword tokens, fold-form invariants, validator rules, CLI pipeline decisions) |
| [design-decisions.md](design-decisions.md) | Load-bearing invariants that must NOT be silently reverted — performance/singleton invariants + the full bug-fix invariant log (return-values array, f64 bits as bigint, SIMD lane arity, legacy try/catch, statement ordering, resolveNames completeness, GC type encodings, …) |
| [bridge.md](bridge.md) | Phase 7 binaryen bridge — the binaryen-ts constructor API surface, bridge type mapping, post-order traversal constraint, tier-by-tier coverage (A/B/C/D + GC 1–4), and the cumulative gotchas |
| [testing.md](testing.md) | How to run `deno task check` / `test`; the wasmtk WAT corpus runner (`tests/wasmtk/`); the wasmtk-driven hardening loop; regression-test placement conventions |
| [licensing.md](licensing.md) | MIT-primary with Apache-2.0 alternative; file layout (`LICENSE` / `LICENSE-MIT` / `LICENSE-APACHE` / `NOTICE.md`); per-file ported-vs-original headers; the no-compound-SPDX rule |
| [publishing.md](publishing.md) | JSR package `@jrmarcum/wabt-ts`; tag-driven publish flow (never `deno publish` locally — OIDC provenance); the bump task + sub-version-capped-at-9 rule; CI workflows |
| [tasks.md](tasks.md) | **Granular** implementation status, per-file checklists, and the running phase/bug/decision log (relocated from the repo-root `TASKS.md` on 2026-06-09). `phases.md` is the distilled summary; this is the detail. |

## Related files outside cmem

- `README.md` — the **public, user-facing** doc for GitHub/JSR. NOT project memory.
- `CLAUDE.md` — legacy exhaustive memory archive (repo root, gitignored, machine-local; auto-loaded
  by Claude Code). The line-by-line historical record; superseded by `cmem/` as the curated source
  of truth.

(The granular task/decision log formerly at the repo-root `TASKS.md` now lives inside this folder
as [tasks.md](tasks.md), so all project memory is in one committed, portable place.)
