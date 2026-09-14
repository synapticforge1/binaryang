# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

Rewritten 2026-09-14 as outstanding-only. It had grown to 912 lines, most of them CLOSED history;
that history now lives in its topic files — nothing was dropped:

| closed history                                                  | now in                                 |
| --------------------------------------------------------------- | -------------------------------------- |
| the spec-testsuite harness, SP1–SP5, G2, the feature-set lesson | [testing.md](testing.md)               |
| the IR convergence record and status, S1–S7                     | [ir-convergence.md](ir-convergence.md) |
| every upstream difference, open and closed                      | [divergences.md](divergences.md)       |
| names (N1 and its release items)                                | [names.md](names.md)                   |
| everything on `main` awaiting a release note                    | [unreleased.md](unreleased.md)         |
| the WAT routes, the folded-writer ladder, the bridge question   | [text-routes.md](text-routes.md)       |
| the retirement (D2 / D3, the frozen predecessors)               | [transition.md](transition.md)         |
| the 1.5.5 quality passes                                        | [quality-passes.md](quality-passes.md) |
| releases, 1.5.4, `RELEASE_PAT`'s root cause                     | [publishing.md](publishing.md)         |
| the wasmtk correspondence                                       | [handoffs.md](handoffs.md)             |

**State, 2026-09-14:** `binaryang@1.5.4` published (score 100, `rekorLogId=2692137018`). `main` is
ahead, unpushed and unbumped, at 1043 tests / 0 ignored, baseline IDENTICAL, spec 100% on four axes,
bridge 401/421. Re-derive before quoting.

## Owner actions — nothing here is blocked on code

| # | item                         | note                                                                                                                                                                                                                                                                                                            |
| - | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **Create `RELEASE_PAT`**     | Fine-grained, Contents: read/write, **owned by a JSR scope member**. Until it exists every DISPATCHED release needs a manual tag re-push — [publishing.md](publishing.md) § "ROOT CAUSE". A developer tag push works unaided (1.5.4)                                                                            |
| 2 | **K3 — `simd.shift`**        | 🗓️ scoped 2026-09-14; recommendation MERGE into `binary`. [ir-convergence.md](ir-convergence.md) § "K3"                                                                                                                                                                                                         |
| 3 | **`call_indirect`'s `sig`**  | 🗓️ Group 3's one tie where cost (11 vs 16, convert wabt-ts) and structure (`FuncSignature` is wabt-ts's house concept) point opposite ways — [ir-convergence.md](ir-convergence.md) § "Group 3"                                                                                                                 |
| 4 | **Names under optimization** | 🗓️ future discussion (owner, 2026-09-10), not scheduled, not to be decided unilaterally: how binaryen-ts's OPTIMIZATION treats internal vs exported names, vs upstream (which under `-g` keeps only surviving functions' names). N4 is provisional until then. Export and import names stay inviolable (pinned) |
| 5 | **When to release**          | the next bump is the owner's decision, and several changes are API-visible — [unreleased.md](unreleased.md). **The bump must never be made incidentally**: the version line is what arms a release                                                                                                              |

~~JSR and GitHub descriptions on both predecessors~~ — 🛑 CLOSED as won't-do (owner, 2026-09-02);
the predecessors are frozen. Do not re-open ([transition.md](transition.md)).

## IR convergence — next steps

Status table and full record: [ir-convergence.md](ir-convergence.md) § "Where it stands".

- ⬚ **S6 step 5 — delete the bridge**, carrying its type derivation forward as a pass. Acceptance:
  `deno task bridge` 401/421 → **421/421**. It absorbs C10a (the 24 modules the bridge
  mistranslates, owner decision 2026-09-02); if S6 is abandoned, C10a comes back.
- ⬚ **S7 — the linear-form marker.** Independent of the rest. ⚠️ Changed by C3: binaryen-ts now
  keeps custom sections, so S7 must strip its own marker deliberately when optimization runs.
- ⬚ **K1 — atomics and `call_ref` in binaryen-ts** (DEFECT, port gap). The decoder refuses them
  loudly; pinned by `PHANTOM_BUDGET` and `ONE_SIDED_BUDGET`.

### Follow-ups kept deliberately behaviour-neutral

- ⬚ `mapExpression` / `walkExpression` visit a branch's condition BEFORE its values — the reverse of
  wasm's evaluation order. Fixing it may move `-Oz` bytes, so it wants its own measured commit.
- ⬚ LocalCSE treats a multi-value `return` as opaque (as it did the `tuple.make`).
- ⬚ **43 node LITERALS in `src/` bypass their factory** and hand-compute its `type` — 29 in the WAT
  parser, 7 in inlining (count: `grep "kind: ExpressionKind\.X,"` outside `ir/expressions.ts`). The
  `br_if` one was wrong. The rest want a sweep comparing each literal's type to the factory's.
- ⬚ **LocalCSE is an allow-list of kinds** and is opaque to everything it does not list — e.g. a
  shift under `extract_lane` is never reused, where upstream `--local-cse` reuses it (found scoping
  K3). How much of the size gap to upstream it explains is unmeasured.
- ⬚ **LocalCSE runs after SimplifyLocals and CoalesceLocals at -Oz**, so the tee it adds is never
  cleaned up: +4 bytes on a repeated binary (measured scoping K3, 2026-09-14).
- ⬚ **binaryen-ts could run-length-compress its locals** as wabt-ts now does — roughly 5,600 bytes
  of that redundancy on the corpus. An optimisation, not a defect
  ([text-routes.md](text-routes.md)).

## Open defects and gaps

- ⬚ **K4 — `Module.toWat()` prints invalid WAT** (public `./api`), and `optimize(…, hybridMode)`
  feeds it to `wasm-opt` — [divergences.md](divergences.md).
- ⬚ **T2** — "binaryen-ts's encoder derives the type-section order" is NOT reproducible on decode →
  encode; open until reproduced with a case on whatever path was measured.
- ⬚ **E1 unification** — wabt-ts drops an explicit empty `else` where binaryen-ts keeps it; unify in
  S6.
- ⬚ **Does the decoder consume-and-discard anywhere else?** The convert pair was a KNOWN opcode
  deliberately discarded (`push(pop())`), not an unknown one refused — so the fail-loud contract can
  be violated by a known opcode. Worth an enumeration of the decoder's dispatches; the section,
  export-kind and import-kind dispatches all carry comments about this shape having bitten before.
- ⬚ **`assert_return` / `assert_trap` are not run** — 55,993 behavioural spec assertions, skipped
  deliberately so the first harness measured the must-reject axis. Needs an invoke harness; worth
  doing, second ([testing.md](testing.md)).
- ⬚ **N4** — under `-O2 -g` we keep the local and label names passes leave; upstream drops them.
  Provisional, pending owner action 4.
- ⬚ **`wasm2wat` cosmetics** — entity and branch references print by index (`call 0`) where upstream
  prints `call $foo`; folded siblings share a line. Text only, never bytes ([names.md](names.md)).
- ⬚ **Doc references mapped on plausibility**: `binaryen-ts/parser/tokenizer`, `parser/wat-parser`
  and `wasm/demo_bytes` named subpaths that never existed and were pointed at `./api` and `./wasm`.
  Someone who knows the intent should confirm ([scope-1.5.2.md](scope-1.5.2.md)).

## Conformance gaps — the wasmtk-ranked list

Ranking agreed in [handoffs.md](handoffs.md). Ranks 1–3 shipped (`br_on_cast` and `br_on_*` in
1.5.3; the convert pair `9d5c886be`, unreleased — divergence X1).

| rank | gap                                                | status                                                                                                                                       |
| ---- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 4    | the five that unblock nothing for wasmtk           | ⬚ open, ranked last on their numbers despite 121 occurrences                                                                                 |
| —    | **exact types** (`(exact $T)`), 116–548 assertions | ⬚ open, ranked last on effort. Parser-gated: `(exact $T)` fails at parse, so it is a type-system change across both trees, not a bridge case |

## Quality passes — 1.5.6 / 1.5.7

The three-version plan: **1.5.5** code issues (passes 1–7 done, register EMPTY, converged against
the invariant battery), **1.5.6** hardening then code again, **1.5.7** security then hardening then
code again — each lens repeated until a pass turns up nothing new. ⬚ 1.5.6 and 1.5.7 not started. ⚠️
Converging means THESE invariants no longer discriminate, not that no issues remain. Lens
definitions, method and register: [quality-passes.md](quality-passes.md).

## Repo work

- ⬚ **A2 — `wasm2ts` is a stub that throws.** The long-term goal (WASI Preview 1 capable TypeScript
  output). **Blocked, and not close**: as of 2026-09-02 the wasmtk side has a long way to go before
  there is anything to implement against.
- ⬚ **TranslateEH** (binaryen-ts) and **Phase 10 kernel selection** — live gaps carried from the
  predecessors, not re-checked since the merge ([phases.md](phases.md)).

## The wasmtk thread — `handoffs.md` §§ 7–11

| §  | content                                                                        | state                                                                                                                                                                          |
| -- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7  | the `br_on_cast` estimate correction — three defects, not one                  | delivered                                                                                                                                                                      |
| 8  | retraction of the phantom "deps need proper names" finding                     | delivered                                                                                                                                                                      |
| 9  | defect 5 is **wider** than described; the deps unblock; `.gitattributes`       | ✅ **closed by them** — they renamed `binaryen` → `binaryen-backend`, widened `.gitattributes`, and closed defect 5 with a conditional                                         |
| 10 | correcting § 9 (they are on **1.5.3**); the convert pair priced by building it | ⬚ **awaiting their answer on one question** — though they have SHIPPED against 1.5.3 as 2.0.2, so the `br_on_cast` queue entry is most likely stale rather than a live failure |
| 11 | adopting their conditional-not-clearance form and their alias invariant        | ⬚ outbound                                                                                                                                                                     |

⚠️ **The one open question is in § 10 and it matters:** their queue still lists `br_on_cast` as
unstarted, but all four `br_on_*` forms shipped in 1.5.3, which they are on. Either that entry
predates their bump, or **our fix does not cover their cases** — we asked for one failing module.
Resolve it before anyone starts on their queue.

**Also open, from their side:** their 100 pinned wast failures are described as GC/ref-types
conformance gaps. If any route to us rather than to wasic we want to know which — "now visible
rather than masked" is exactly the condition in which a gap gets attributed to whichever layer
someone is looking at.

## Not tasks, by decision

- **Converging the two IRs is not a release task** — open-ended by decision 1, tracked by
  `deno task collisions` ([overview.md](overview.md)). The S series is the work.
- **D4 — never yank, ever** ([transition.md](transition.md)).
- **The predecessors are frozen** — no change to `binaryen-ts` or `wabt-ts` on GitHub or JSR.
