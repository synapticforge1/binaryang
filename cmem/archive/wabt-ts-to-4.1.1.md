# wabt-ts memory — closed history, to 4.1.1

The History blocks of the wabt-ts sections (tasks, design-decisions, pre-merge-known-issues, runtime-tooling, best-practices, overview, testing, phases, publishing), the deleted bridge (its section and its invariants) and the licensing section, which is wholly in the core. Moved from `cmem/wabt-ts.md` on 2026-11-20 (H38 step 4); the live notes start at [wabt-ts.md](../wabt-ts.md).


## `wabt-ts/tasks.md` — history, summarized

**History, summarized:**
- 2026-05-21 → 05-28: wabt-ts Phases 1–6 (core, IR as discriminated union, single-class binary reader,
  linear WAT writer, three-layer validator, CLI tools), 6.1 (CI, lint 71→0, perf invariants), 6.2 (release
  flow, first JSR publish); Phase 7 bridge MVP and Tiers A–D; 26 wasmtk-driven latent bugs v1.0.3→v1.3.1
  (folded immediates, local names, `flushStack` order, `synthesizeTypes`, SIMD name-table regen via
  `scripts/wabt-ts/gen_simd_opcode_table.ts` + `audit_opcodes.ts`, f64 integer literals, Bug D/F/G, legacy
  `TryExpr`, statement sinking past `return`, hex-float parsed as 0). Phase 1 integration 38/38 at 1.1.8.
- 2026-06-09: two-round silent-corruption audit (~18 fixes; `writeVar` fail-loud) → § "2026-06-09
  silent-corruption audit" below; regressions `tests/wabt-ts/audit/silent_corruption_fixes*.test.ts`.
- 2026-08-20: parse gap scoped (120/257, 19 repro-confirmed causes, calibrated tranche projections T1–T6).
- 2026-08-21: T1–T4, T7 blind spot (parse metric cannot see encode), typed-ref refactor, multi-value branches,
  T5/T6/T8, T9.1–T9.10, T11; Wasmtime made authority (`97e96699e`); WASI p1 goal measured (1/270 round-trip).
- 2026-08-24: T10 closed (2120/2120, WASI 270/270), execution metric, T9.11, post-campaign audit (wide
  arithmetic both ways, dead `Validator.refNullType`), `assert_malformed` metric and T12 (666 → 1229/1229,
  711/711), T13.1–T13.10; UP-1…UP-7 filed and answered; 1.4.0 (`3e1a2331d`).
- 2026-08-25: post-1.4.0 enumeration and hardening passes T13.11–T13.44 (`aabdcde21`), provenance and corpus
  refresh T13.45/T13.46; 1.4.1.
- 2026-08-26: 1.5.0 upgrade T13.47 (`15cce7426`), T13.48, pre-merge audit T13.49, T13.50 scoped; merge.

Full text: `git show 62c65a9db:cmem/wabt-ts/tasks.md`


## `wabt-ts/design-decisions.md` — the deleted bridge's invariants

**Bridge** (`src/bridge/bridge.ts`, formerly `binaryen-bridge.ts`; ✅ DELETED 2026-09-18, S6 step 5 M8e — the entries below are its history)
- [decision] **Every branch-target construct pushes a label frame** on `ctx.labelStack`: `block`, `loop`,
  `if`, `try_table`, and legacy `try` if it is ever bridged — "not pushing" is never right. An unlabeled
  `if` pushes `IF_FRAME = '<if-frame>'`, and `resolveLabel` throws on it (T13.24; `tests/bridge/label_frames.test.ts`).
  [lesson] The bridge belongs in every layer sweep even though nothing publishes it.
- [decision] Use `wabtTypeToValueType` (`bridge.ts`, keeps refs concrete) wherever a type crosses into
  binaryen-ts. `wabtTypeToValType` (`src/bridge/type-map.ts`) coarsens, and is only for callers that
  want the abstract type.
- [decision] Func heap types are declared per signature ONLY when a struct or array type exists, and are
  APPENDED after them. Otherwise non-GC modules switch onto the GC path (T13.47).


## `wabt-ts/design-decisions.md` — history, summarized

**History, summarized:**
- v1.1.7–v1.3.0: Bugs D, F and G, the `pushStmt` fix, legacy EH (v1.2.9), and GC types in `Type` (v1.1.9).
- 2026-05-25: the performance audit. 2026-06-09: six audit rounds, where rounds 2 and 4 removed dead code
  (`WastParser.ok`, `TypeEntry.tailcallTarget`, `typeStackSize`, `SharedValidator.endTryTable`, and others).
- 2026-08-24 (T10, T12, T13.1–T13.10): removed `Validator.refNullType`, which had the same shape as
  binaryen-ts UP-7. 2026-08-25 (T13.11–T13.47): removed `getOpcodeNaturalAlign`. The `@jrmarcum/binaryen-ts@1.0.9`
  exact pin (T13.23) is gone, because the dependency is in-repo since the merge.

Full text: `git show 62c65a9db:cmem/wabt-ts/design-decisions.md`


## `wabt-ts/pre-merge-known-issues.md` — history, summarized

**History, summarized:** written 2026-08-25 against wabt-ts `673349a0` (v1.5.0) and binaryen-ts
v1.5.0. G1 was verified in both directions that day. G3's three recommendations were adopted with
one respelling (`src/wabt-ts/`) and one reversal (no shims). Its § F ("mark entries, never delete")
is superseded by the cleanup policy: git holds the evidence.

Full text: `git show 62c65a9db:cmem/wabt-ts/pre-merge-known-issues.md`


## `wabt-ts/runtime-tooling.md` — history, summarized

**History, summarized:** the Bun 1.3.14 smoke test was byte-identical to Deno (2026-08-24).
`tsconfig`/`vitest` were deleted early in wabt-ts. [correction] Two statements are superseded. First,
"only `src/tools` may use `Deno.*`": tools now use `node:*` via `src/host.ts` (N3). Second, the
`@jrmarcum/binaryen-ts@1.0.9` pin: the T13.22 cancellation was fixed pre-merge (`15cce742`, pin moved
to 1.5.0), and the dependency was removed by the merge.

Full text: `git show 62c65a9db:cmem/wabt-ts/runtime-tooling.md`


## `wabt-ts/best-practices.md` — history, summarized

**History, summarized:** §1–§5 from T7–T11; ranking T10 (2026-08-24); audits T12–T13.28; robustness
T13.29–37; release guard T13.43–44; last T13.45–47 (binaryen-ts 1.5.0). Correction chain T13.36→37.

Full text: `git show 62c65a9db:cmem/wabt-ts/best-practices.md`


## `wabt-ts/overview.md` — history, summarized

**History, summarized:** the campaign closed 2026-08-24 with seven metrics exhausted. T13 ran through T13.47 on 2026-08-25, and 1.4.1 shipped fifteen of its fixes. The wasmtk corpus grew from 272 to 421 files (T13.46), and `KNOWN_INVALID` emptied. In T13.25/T13.28, a NUL and then `\b` bytes made files binary to grep and silently shrank audit sweeps; that is now gated (`source_hygiene.test.ts`, below).

Full text: `git show 62c65a9db:cmem/wabt-ts/overview.md`


## `wabt-ts/testing.md` — history, summarized

**History, summarized:** test counts went 146 → 381 → 393 (2026-08-25), and every one went stale. The hardening loop with wasmtk began at wasmtk Phase 1, 38/38 against wabt-ts 1.1.8 (2026-05-28).

Full text: `git show 62c65a9db:cmem/wabt-ts/testing.md`


## `wabt-ts/phases.md` — history, summarized

**History, summarized:** the campaign (to 2026-08-24) took parse-clean from 107 to 257/257, `assert_invalid` from 2395/2737 to 2664/2683, and wasmtk round-trip from 1/270 to 270/270. Its load-bearing changes were T7.4, T9.1–T9.4, T11 and T10.x, and three items were misdiagnosed until re-measured (T10.5, T10.6, T10.8). Releases: 1.1.9–1.2.5 GC tiers, 1.2.9 legacy try, 1.3.0 statement order, 1.3.4/1.3.5 const bugs, 1.4.0 T13.1–T13.10, 1.4.1 fifteen T13 fixes. T13 recorded T13.1–T13.50 and 8 hardening passes (1/2/0/0/2/2/2/2).

Full text: `git show 62c65a9db:cmem/wabt-ts/phases.md`

## `wabt-ts/bridge.md` (273 lines) — wabt-ts Phase 7: the wabt IR → binaryen-ts bridge

Covered the bridge's shape, the binaryen-ts 1.0.9 constructor surface, type mapping, tier coverage and gotchas. Also the T13.22 catch-scope coupling and its coordinated release, T13.24 label frames, and the UP-1..UP-7 binaryen-ts gaps. **The bridge is still live** (`src/bridge/bridge.ts`, 14 test files in `tests/bridge/`) until S6 step 5 deletes it.

### Why direct recursion

`bridgeToBinaryen(module)` is a **post-order recursive walk** over the wabt IR that calls binaryen-ts constructors directly. [decision] **Not delegate-driven.** binaryen-ts constructors are bottom-up: leaves are built first and passed into parents, so a recursive `bridgeExpr` falls out naturally. A delegate/visitor walk would have to maintain its own operand stack to rebuild the tree — strictly more complex, with no benefit. (The old CLAUDE.md "ExprVisitorDelegate" note was wrong.)

**The design constraint that makes it work:** wabt-ts IR nodes support clean post-order recursion — no parent context needed to resolve a child, no upward references. The same reasoning is in `src/bridge/bridge.ts`'s module doc.

### Tier coverage

About 60 expression kinds plus the module surface, tested in `tests/bridge/`:
- **Tier A** — core compute and control flow: locals/globals, unary/compare/convert, return, drop, nop, unreachable, block, loop, if, br, br_if, br_table (`tier_a.test.ts`)
- **Tier B** — call, call_indirect, select, load, store, memory.size, memory.grow (`tier_b.test.ts`)
- **Tier C** (`tier_c.test.ts`) — ref.null / ref.func / ref.is_null; SIMD basics (v128.const, splat, lane arithmetic, extract/replace_lane, shuffle); SIMD memory (load_splat / load_zero / load_lane / store_lane, via `simdLoadOpForOpcode`); EH (tags, throw, throw_ref, `try_table` with `buildCatchClause` over the four catch clauses)
- **Tier D** — memory and table exports; active and passive data segments via `bridgeDataSegment` (`tier_d.test.ts`)
- **GC tiers** (`gc_tier1`–`4.test.ts`) — Tier 1 i31, ref.eq; Tier 2 struct.\*, with `addHeapType` up front and `BridgeCtx.heapTypeIdx`; Tier 3 array.\*; Tier 4 ref.test / ref.cast

The wing's "`br_on_cast` deferred" is stale: it landed in T5.3 and is tested in `tests/bridge/br_on_cast.test.ts`.

**Kept**
- [decision] **`limitToNumber` THROWS above 2^53 rather than rounding** a wabt `bigint` limit into binaryen-ts's `number`. Any new limit-taking call must go through it (T13.3).
- [reference] **Gotchas still true in code.**
  - `makeI64Const` takes a `bigint`.
  - `makeBlock`/`makeIf` infer their type from the last child, so use `withDeclaredType`.
  - There is no `makeCompare` or `makeConvert`.
  - Alignment is bytes in wabt-ts and an exponent in binaryen-ts (`alignBytesToExponent`); treating 0 as exponent 0 once broke the optimizer.
  - `synthesizeAnonymousNames` fills in `$F0`/`$G0`/`$T0`/`$M0`/`$E0`; new item kinds need the same treatment.
  - Memory imports use the `memoryNames` slot.
  - f32/f64 consts reinterpret raw bits as floats.
- [correction] **Labeled `if`s no longer throw.** The wing says the bridge throws on any labeled `if`. Today a labeled `if` carries its name, and only a branch *targeting* an unlabeled `if` throws (`IF_FRAME = '<if-frame>'`, T13.24; it was a NUL sentinel before T13.25).
- [lesson] **Two errors that cancel are invisible to every test that checks final bytes.** T13.22 was the third instance of the T7.6/T9.8 off-by-one. Keep `try_table_catch_scope.test.ts`, and keep its probe NUMERIC: a named target cannot see the bug.

**Already in the core**
- T13.22 closed pre-merge; T13.50/A1 de-coarsening (1.5.2); the move to `src/bridge/`; not exported → cmem/ir-convergence.md § "The bridge and the WAT routes into binaryen-ts — history, summarized"
- An exact pin vs a caret plus lockfile; who a coupling blocks → cmem/project.md § "Live gaps carried from the predecessors"; acceptance 401/421 → 421/421 → cmem/ir-convergence.md § "Step 5 — delete the bridge, and carry its type derivation forward"

**History, summarized**
- **T13.22 / T13.23 / T13.47 (2026-08-25):** the pin was made exact; then the fix and the bump landed in one commit, `15cce742`; bridge tests went from 16/28 to 28/28. Versions 1.4.1/1.4.2 in that story are binaryen-ts's, not wabt-ts's.
- **UP-1..UP-7:** binaryen-ts gaps. UP-5 (start funcidx discarded) failed silently; UP-1 (`struct.get_u`) failed loudly. Detail is in `wabt-ts/tasks.md` and `scripts/wabt-ts/binaryen-ts-upstream-report.md`.

Full text: `git show 62c65a9db:cmem/wabt-ts/bridge.md`


## `wabt-ts/publishing.md` — history, summarized

**History, summarized:** 1.4.0 (2026-08-25, rekor 2582221500) unblocked wasmtk's EH migration (`4edabfb1`). 1.4.1 (rekor 2589519728) came from an owner-pushed tag. 1.5.0 (rekor 2603257282) changed only `src/bridge/`. On 2026-05-25 the repo left the fork network, and `git filter-repo` purged CLAUDE.md/TASKS.md from history.

Full text: `git show 62c65a9db:cmem/wabt-ts/publishing.md`

## `wabt-ts/licensing.md` (51 lines) — wabt-ts's MIT-primary / Apache-2.0 arrangement

Covered the MIT declaration with an Apache-2.0 alternative, the licence files, the no-compound-SPDX rule (v1.0.2), and per-file headers. All of it merged into the core, which extends it to both upstreams. **Kept:** nothing beyond the core.

**Already in the core:** the whole file, including the header templates and the SPDX lesson → cmem/licensing.md § "Per-file headers", § "JSR rejects on two conditions, and both still apply". **History:** the file layout was adopted at v1.0.2 (2026-05-25).

Full text: `git show 62c65a9db:cmem/wabt-ts/licensing.md`


## `wabt-ts/INDEX.md` — full text


Full text: `git show 62c65a9db:cmem/wabt-ts/INDEX.md`
