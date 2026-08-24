# cmem — Portable Project Memory for binaryen-ts

This folder is the **authoritative, portable project memory** for `binaryen-ts`. It lives inside the
project tree, so it travels with the project (USB drive, clones) and is committed to git — unlike
the legacy `CLAUDE.md`, which is `.gitignore`d and therefore machine-local only.

**Format:** plain Markdown — one focused topic file per domain, so any single concern can be
reviewed and revised without wading through one giant file. Keep files small and single-topic.

This layout mirrors the `cmem/` convention established in the sibling `wasmtk` and `wabt-ts`
projects.

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
hacks; (2) dead code (verify each with a grep before removing); (3) bugs — silently-wrong codegen,
inverted logic, type-inference gaps, off-by-ones; (4) **silent fallbacks** — this project's worst
failure mode: an unresolved name/index/opcode emitting `?? 0`, a bare `nop`, or a guessed default
instead of throwing. Convert each to a typed error (`WasmEncodeError` / `WasmBinaryError` /
`WatParseError` / `TypeError`) per the robustness contract in [correctness.md](correctness.md).
Report `file:line` + severity, fix the safe ones, and verify against the ladder below — **an exit
code is not evidence** here, because every serious bug this project has had produced valid wasm with
the wrong value.

Only defer a fix if the fix itself risks rejecting valid input (owner policy: fix footguns
immediately).

### Trigger — regression gate (binding)

The whole suite is ~2 seconds, so there is no "which suite do I need" calculus — **always run
everything.** The gate that matters is not the suite, it is the ladder past it:
`WebAssembly.compile` validity has never caught a single one of this project's real bugs.

| Rung                    | Command                                                                                 | Catches                                      |
| ----------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| Types                   | `deno task check` (covers `src/`, `main.ts`, AND `tests/`)                              | signature drift, missing enum cases          |
| Suite                   | `deno task test`                                                                        | pinned regressions                           |
| Style                   | `deno fmt` + `deno lint`                                                                | CI parity                                    |
| Behavioural fuzz        | `FUZZ_ITERS=5000 deno test --allow-read --allow-env tests/passes/optimize_fuzz_test.ts` | pass miscompiles                             |
| Behavioural equivalence | `deno run --allow-read --allow-env scripts/equiv_check.ts`                              | `-Oz` semantic divergence on real corpus     |
| Round-trip validity     | `deno run --allow-read --allow-env scripts/verify_roundtrip.ts`                         | parser/encoder corruption on 80 corpus files |
| Manifest                | `deno task publish:dry`                                                                 | JSR/slow-types breakage                      |

**Run the bottom four whenever you touch the parser, the encoder, or a pass** — they are the only
things that see a valid-but-wrong module. The top three alone will happily pass a miscompile.

**The gate is triggered by a CHANGE, not by a batch.** Adding test files that pass as written, with
`src/` untouched, cannot regress anything — don't re-run the corpus harnesses for that.

## Files

| File                               | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [overview.md](overview.md)         | What binaryen-ts is, its optimizer role in the wasmtk/wabt-ts/binaryang toolchain, the two-path optimization pipeline, repo layout, upstream C++ reference tree, core IR invariants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [architecture.md](architecture.md) | Per-subsystem design: WAT parser (3-phase), binary parser, binary encoder, GC/EH/SIMD/tail-call proposals, hybrid mode (3 tiers + binaryen.js interop), WASM-kernel runtime, cross-runtime (`node:` imports) rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [passes.md](passes.md)             | The optimization pass set + pass-runner; per-pass design (Vacuum, OptimizeInstructions, CoalesceLocals + CFG liveness, LocalCSE, Inlining + split/partial + return-call, RemoveUnused*, PickLoadSigns); **Asyncify port ✅ COMPLETE (all 5 stages + the in-wasm `asyncify.*` IMPORT mode 2026-07-08, registered `"Asyncify"`, runnable e2e matches wasm-opt v130; validated on REAL TinyGo goroutine output → `sum: 30`; **liveness-minimized local saving v1.4.2 — frames now smaller than wasm-opt; the nested-goroutine crash was a binary-decoder reorder bug (WT-2k in correctness.md), NOT asyncify**). Flatten pass (--flatten port) + `mapChildrenShallow` fix**                                                                                                                                                                                                                                                                                               |
| [correctness.md](correctness.md)   | **The load-bearing bug log + robustness contract.** Every resolution throws rather than silently miscompiling. The WT-2 differential-equivalence miscompile series (parser + pass correctness), the hardening Tiers 1–4 / A–C, branch-depth corruption, EH/tuple round-trip fixes, the 2026-07-07 four-pass fail-loud audit sweep (20 fixes incl. 6 behavioral miscompiles: the WAT-parser call/global type-inference root cause that fed Asyncify a None-typed local, parseLoop result type, Flatten tee clobber, PickLoadSigns, inlining ref/v128 reset, multi-table/blocktype corruption; v1.3.6). The UP-1…UP-7 series (2026-08-24, wabt-ts upstream findings): UP-1 packed `get` sub-opcode + UP-5 start-section silent drop fixed, UP-7 typed-ref locals fixed as a third wrong-bytes bug; corpus round-trip closure (ref.null heap-type collapse + phantom-pop nop) — 79 exact, 0 drift, 0 validate fails. Each has a regression test — do not silently revert. |
| [testing.md](testing.md)           | How to run `deno task check` / `test` / `ci`; the Deno-only test suite (453 passing, 1 ignored as of 2026-08-24; asyncify COMPLETE incl. the in-wasm asyncify.* IMPORT mode for TinyGo goroutines + liveness-minimized saving + the WT-2k decoder-reorder regression test; +9 flatten; four-pass fail-loud audit sweep — 20 fixes incl. 6 behavioral miscompiles, v1.3.6; +7 from the 2026-07-08 wasmtk-side audit sweep; +2 import-mode tests, see passes.md § "In-wasm asyncify-import mode" + "Audit-hardening"); the seeded differential optimizer fuzzer (`optimize_fuzz_test.ts`) and why behavioral fuzzing exists; **test files are type-checked as of 2026-08-24 — they never were before, by any task**                                                                                                                                                                                                                                                      |
| [phases.md](phases.md)             | Phase delivery status (0–13 + sub-phases + WT-1…WT-2k + the UP-series Tiers 1–3) — condensed table; **no bump/publish until UP-7 (Tier 3) lands**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [publishing.md](publishing.md)     | JSR `@jrmarcum/binaryen-ts`; tag-driven publish + OIDC provenance; `deno task bump` (sub-version-capped-at-9) + `deno task publish` (release driver); the gotchas (publish-guard, stale type-check cache, never `deno publish` locally, submodule remnant, tag-sync, JSR-side provenance recording stopped v1.3.5+)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [licensing.md](licensing.md)       | MIT-primary with Apache-2.0 bonus; `LICENSE`/`LICENSE-MIT`/`LICENSE-APACHE` layout; single-SPDX + full-license-text JSR rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [bridge.md](bridge.md)             | Cross-project architecture (binaryen-ts ↔ wabt-ts ↔ wasmtk); the five agreed decisions; the constructor-API contract for the bridge; the wabt-ts handshake status; the UP-1…UP-7 bridge-gap table (what wabt-ts can now express, and the "do not re-add these" list); the binaryang merger target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Related files outside cmem

- `README.md` — the **public, user-facing** doc for GitHub/JSR. NOT project memory.
- `CLAUDE.md` — legacy exhaustive memory archive (repo root, gitignored, machine-local; auto-loaded
  by Claude Code). The line-by-line historical record; superseded by `cmem/` as the curated source
  of truth.
- `TASKS.md` — granular phase-by-phase task list (gitignored, local-only).
