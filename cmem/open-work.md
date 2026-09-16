# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

Rewritten 2026-09-14 as outstanding-only. It had grown to 912 lines, most of them CLOSED history;
that history now lives in its topic files — nothing was dropped:

| closed history                                                  | now in                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| the spec-testsuite harness, SP1–SP5, G2, the feature-set lesson | [testing.md](testing.md)                                   |
| the IR convergence record and status, S1–S7                     | [ir-convergence.md](ir-convergence.md)                     |
| every upstream difference, open and closed                      | [divergences.md](divergences.md)                           |
| names (N1 and its release items)                                | [names.md](names.md)                                       |
| everything on `main` awaiting a release note                    | [unreleased.md](unreleased.md)                             |
| the WAT routes, the folded-writer ladder, the bridge question   | [ir-convergence.md](ir-convergence.md)                     |
| the retirement (D2 / D3, the frozen predecessors)               | [project.md](project.md)                                   |
| the 1.5.5 quality passes                                        | [testing.md](testing.md)                                   |
| releases, 1.5.4, `RELEASE_PAT`'s root cause                     | [publishing.md](publishing.md)                             |
| the wasmtk correspondence                                       | [handoffs.md](handoffs.md)                                 |
| the predecessors' wings (T-ids, UP-n, WT-n, invariants → tests) | [wabt-ts.md](wabt-ts.md), [binaryen-ts.md](binaryen-ts.md) |
| the 2026-09-14 memory consolidation                             | [INDEX.md](INDEX.md) § "Cleanup policy"                    |

**State, 2026-09-14:** `binaryang@1.5.4` published (score 100, `rekorLogId=2692137018`). `main` is
ahead, unpushed and unbumped, at 1043 tests / 0 ignored, baseline IDENTICAL, spec 100% on four axes,
bridge 421/421 (was 401 until 2026-09-15), one pack. Re-derive before quoting.

## Start the next session here (handoff, 2026-09-15 — paused mid-stage)

**Where the work stopped.** `main` is at `1a7b04145`, clean, nothing pushed, `deno.json` still
1.5.4. The full gate ran on that committed tree and every step passed: fmt, lint, 1164 tests / 0
failed, naming, portability, baseline **IDENTICAL**, publish dry-run, operators, spec (no misses),
`bridge` **421/421**, `bridge-behaviour` **1806/1806** across 602 exports, `translate-eh` (every
assertion holds in every world, 19 `assert_invalid`/`assert_malformed` skipped), `optimize-corpus`
(every level of every module encodes and validates).

S6 step 5's expression ratchet stood at **65 identical / 1 types / 7 names** (**68 / 5 / 1** after items 1–4 below, 2026-09-16). Nine stages landed
on 2026-09-15 (A, A2, A3, B, V1–V4, S1–S3, L1, B1–B3, C1, L2). **No branch is open** — the next
sub-stage was branched and the branch deleted unused, so start from `main`.

### Tomorrow's list, in order

1. ✅ **Block family (b) — the catch records. DONE 2026-09-16** (`e9f6721e4`, `11e632b8e`). The
   try_table clause is `{ tag?, target, isRef }` on both sides (`CatchKind` deleted); both IRs name
   the pair `Catch` / `TableCatch`. Trials, mutants and inversions:
   [ir-convergence.md](ir-convergence.md) § "Stage (b) — the catch records". Ratchet unmoved.
2. ✅ **Block family (c) — the block TYPE. DONE 2026-09-16** (`38a47be36` c1, `f4e04989f` c2, plus
   defects `1d8a72be3` and `0f2e32bd5`). wabt-ts's carriers own their entry values
   (`params: { types, values }`) and hold their signature (`type`) with the written index
   (`typeIndex?`); `blockType` and its fidelity entry are gone; the validator holds signature and
   index to each other. Ratchet **65 / 5 / 3**. Record: [ir-convergence.md](ir-convergence.md) §
   "Stage (c) — the block type".
3. ✅ **Block family (d) — the bodies. DONE 2026-09-16** (`ddc45cbb1` d1, `e9c029ffb` d2). A block's
   list is `children`; every region slot holds a `RegionExpr`, `ifFalse` is `RegionExpr | null`
   (an explicit empty `else` now survives wabt-ts's binary round trip — divergence E1). Ratchet
   **66 / 6 / 2**. Record: [ir-convergence.md](ir-convergence.md) § "Stage (d) — the bodies".
4. ✅ **Item 4 DONE 2026-09-16** (`eec6912fd` (b), `34901c5fc` (a)). wabt-ts's `ValueType` is a value
   type (`StorageType` for fields) — and the narrowing found wabt-ts ACCEPTING invalid local / param /
   block types, now rejected as upstream does; `call_indirect`'s type is `typeVar?: Var` in both IRs
   (owner, A). `ref.null` stays deferred to item 5 (premise re-read, unchanged). Ratchet
   **68 / 5 / 1**. Record: [ir-convergence.md](ir-convergence.md) § "Item 4 — value types,
   `call_indirect`, and `ref.null`". Open from it: divergence **W7** (a bare `ref` before a type
   keyword parses; upstream rejects).
5. Then the node base (`readonly`, `loc` required against optional, literal against enum `kind`,
   `type` required on some binaryen kinds), the one-sided kinds (atomics, `call_ref`,
   `code_metadata`), the alias, and the type-derivation pass
   (`inferBinaryType` / `inferUnaryType`) carried forward out of the bridge — which is also where
   `ref.null`'s heap type gets an explicit field (Group 3: not before `type` is derived).
6. **Then the MODULE half — decided: B, unify, no shim** (owner, 2026-09-15). `Module` against
   `WasmModule`, on the expression half's terms; the bridge is deleted outright. ⚠️ Includes
   `Func.body`: still `Expr[]` on wabt-ts, a `RegionExpr` on binaryen-ts (decision 5 covers the
   function body; stage (d2) deferred it here). 16 test files,
   `scripts/check-bridge-corpus.ts` and `scripts/check-bridge-behaviour.ts` come out with it.

⚠️ **Carry the L2 discipline into every remaining stage**: when a field loses `null` or `undefined`
from its type, the compiler stops helping (`stringValued === null` is not an error), so list the
null tests first, convert by reading, and mutate each one back — see
[best-practices.md](best-practices.md) § "TypeScript does NOT flag".

---

The 2026-09-14 session was **memory work, not code**. `src/` behaviour is unchanged (baseline
IDENTICAL after every merge), and the full gate passed on the committed tree at `1cbe88be8`.

| merge       | what landed                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cff3284b8` | machine-local memory moved into cmem; machine facts in the PRIVATE, gitignored `cmem/local/` (history rewritten before any push, so they never entered it); open-work cut to open items |
| `6e5e1b72c` | `scope-1.5.2.md` retired into a summary; the cleanup policy recorded ([INDEX.md](INDEX.md) § "Cleanup policy")                                                                          |
| `1672c2a5a` | eight cmem references in code that used wabt-ts's pre-merge paths fixed                                                                                                                 |
| `de803de12` | core consolidated by topic, 19 files → 13                                                                                                                                               |
| `9758fc736` | code path references follow binaryang's layout (193 unresolved → 69, all by design); `git gc --prune=now`                                                                               |
| `1cbe88be8` | both wings corrected and summarized: 26 files / 16,805 lines → [wabt-ts.md](wabt-ts.md) + [binaryen-ts.md](binaryen-ts.md), 1,662 lines; the findings below were added to this file     |

**Later the same day, the owner decided four rows.** Two landed as code:

- **Decision 6, the release flow** — `deno task bump` then `deno task release` now works as
  documented, because `RELEASE_FILES` is one list ([publishing.md](publishing.md) § "The flow").
- **K3, merged** — `simd.shift` is a `binary` ([ir-convergence.md](ir-convergence.md) § "K3").

The other two went to an options review. **TranslateEH (row 7) was then decided — implement — and
built:** `TranslateToExnref`, 70 / 70 legacy spec assertions through it
([binaryen-ts.md](binaryen-ts.md) § "TranslateEH"). Building it found and fixed two silent
miscompiles elsewhere (see [unreleased.md](unreleased.md)) and found a third — `-Oz` on legacy EH
failing 30 of 70 spec assertions — which the owner had fixed next (`959954015`: DCE trusted an
`if` typed unreachable that wasm validates as void; divergence U1). **`call_indirect`'s `sig`
(row 3) was then decided — A, binaryen-ts takes `sig` — and done** (`b034cedb1`,
[ir-convergence.md](ir-convergence.md) § "Group 3"). No owner decision is pending in the table
below except the standing ones (1, 4, 5). **The non-nullable-local probe then ran** and found the
fixup reachable through Flatten; it is built (`135a81f99`, [binaryen-ts.md](binaryen-ts.md)).
Checking it found `-O3` unable to encode three recursive corpus modules, which the owner had fixed
next (`426e78eb8`: Inlining removed a recursive callee it had counted as fully consumed). The
owner then aligned dead-function removal with upstream (option B, `909c2fc54`, divergence I1
retired): RemoveUnusedModuleElements where upstream schedules it, Inlining removing only what it
inlined. Measuring that found Inlining's `-O3` output invalid on 16 corpus modules, fixed as
upstream behaves (a multi-value callee's wrapper typed with its whole result type); the corpus's
optimized output is now validated at every level by `deno task optimize-corpus`.

**2026-09-15, before step 5, by owner decision** ("so we can measure the difference before and after
the bridge is ineffective, and prior to the full delete"): the bridge was dropping every element
segment and every start function, SILENTLY. Fixed (`031100942`), so bridged output can be run at
all. Then `deno task bridge-behaviour` was built (`30acce91a`) and the pre-step-5 baseline taken —
**1806 calls across 602 exports, 420 of 421 modules agreeing, 0 divergences**
([ir-convergence.md](ir-convergence.md) § "Step 5"). `deno task bridge` had read 421/421 through
both defects, because it compiles what the bridge builds and never runs it.

**S6 step 5 STARTED 2026-09-15** ([ir-convergence.md](ir-convergence.md) § "Step 5"). A
compile-time ratchet (`tests/ir/expr_convergence.test.ts`) measured the two expression types at 34
identical / 14 types / 25 names; stage A (six renames, `4d39bea0e`) and stage B (optionality,
`19b7186fe`) took it to **52 / 5 / 16**, byte-identical and 1806/1806 behaviourally throughout. Two
defects fixed on the way (a plain `struct.get` decoded as `get_u`; `(memory.size $b)` asking memory
0). **Owner, 2026-09-15:** (a) locals are `var` (done, 55 / 5 / 13); (b) C — the bridge's MODULE
half is decided AFTER one `Expression` and one value-type representation exist, with measured sizes.
✅ **(b) RESOLVED the same day, ahead of the sizes: B — UNIFY `Module`, do not keep a shim**
(owner: *"on Item 2 we want to unify not keep a small shim."*). The module half is a full
unification of `Module` and `WasmModule` on the expression half's terms, and the bridge is deleted
outright; A (a thin adapter) is off the table and the size measurement is now only a record.
**Value types DONE the same day (stages V1–V4):** one representation in shape, value and type —
scalars are wabt-ts's `Type` members (`ValType` a const subset), heap types `HeapTypeRef`, a ref
type `{ heapType, nullable }`. ⚠️ Several are PUBLIC and breaking — [unreleased.md](unreleased.md).
**Stages S1–S3, L1, B1–B3, A3, C1 and L2 then took it to 65 / 1 / 7** — labels as `Var`,
`br_table`/`br_on`, `array.init_*`, constants as BITS (four defects, three of them run-time
observable), and a carrier's own label as `label: string`.
**Next:** the block family's three remaining fields — the catch records, the block TYPE
(`blockType` against `type` + `params` + `typeIndex`), and the bodies (`Expr[]` against
`RegionExpr`) — then `call_indirect`'s type use, `select.resultType`, `ref.null` (deferred by
Group 3 to type derivation), the node base (`readonly`, `loc`, literal vs enum `kind`), the
one-sided kinds, the alias, and the type-derivation pass. Then the MODULE half, by decision B. 🔑 Not a choice: one `Expression` needs one VALUE-TYPE
representation, because 12 wabt-ts node fields and binaryen-ts's `type` / `FuncSignature` embed
each side's own — so value types are the next stage whichever way (b) goes.

**Suggested order:**

1. **S6 step 5 — delete the bridge.** Both acceptances are now in hand and neither can carry the
   step: `deno task bridge` 421/421 (`ed38c084f`) and `deno task bridge-behaviour` 1806/1806
   (`30acce91a`), both green BEFORE the unification. Step 5's job is therefore not to turn a gate
   green but to keep both green while one `Expression` replaces two — and to carry the bridge's
   type derivation (`inferBinaryType` / `inferUnaryType`) forward as a pass. The 20 old bridge
   misses were one `call_indirect` signature bug, and the stale `ref.as_non_null` refusal was NOT
   among them (checked 2026-09-15: 18 were "fallthru", 2 were operand-type mismatches).
2. The cheap cleanups: the stale-comment list and `engine-check.ts`'s must-accept self-test.

## Owner actions — nothing here is blocked on code

| # | item                            | note                                                                                                                                                                                                                                                                                                                                             |
| - | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | **Create `RELEASE_PAT`**        | Fine-grained, Contents: read/write, **owned by a JSR scope member**. Until it exists every DISPATCHED release needs a manual tag re-push — [publishing.md](publishing.md) § "ROOT CAUSE". A developer tag push works unaided (1.5.4)                                                                                                             |
| 4 | **Names under optimization**    | 🗓️ future discussion (owner, 2026-09-10), not scheduled, not to be decided unilaterally: how binaryen-ts's OPTIMIZATION treats internal vs exported names, vs upstream (which under `-g` keeps only surviving functions' names). N4 is provisional until then. Export and import names stay inviolable (pinned)                                  |
| 5 | **When to release**             | the next bump is the owner's decision, and several changes are API-visible — [unreleased.md](unreleased.md). **The bump must never be made incidentally**: the version line is what arms a release                                                                                                                                               |

~~A local directory path in git history~~ — 🛑 CLOSED as leave-it (owner, 2026-09-14). Committed
cmem no longer carries it: the absolute paths are in the private `cmem/local/environment.md`. The
copies in `b472b4aa4` (pushed 2026-09-03) and `df3659840` stay: a directory layout with no account,
token or secret is not worth a force push. Do not re-open.

~~JSR and GitHub descriptions on both predecessors~~ — 🛑 CLOSED as won't-do (owner, 2026-09-02);
the predecessors are frozen. Do not re-open ([project.md](project.md)).

## IR convergence — next steps

Status table and full record: [ir-convergence.md](ir-convergence.md) § "Where it stands".

- ⬚ **S6 step 5 — delete the bridge**, carrying its type derivation forward as a pass. Its
  acceptance (`deno task bridge` 421/421) was **met on 2026-09-15 ahead of the step**
  (`ed38c084f`): C10a's 20 remaining modules had one cause, a `call_indirect` signature the bridge
  never resolved. So the gate now starts green and can only say the step did not break it —
  [ir-convergence.md](ir-convergence.md) § "Step 5".
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
- ⬚ **LocalCSE is an allow-list of kinds** and is opaque to everything it does not list — e.g. an
  expression under `extract_lane` (or any other SIMD kind) is never reused, where upstream
  `--local-cse` reuses it. Found scoping K3. K3 fixed the shift itself, which is now a `binary`, but
  not what sits beneath an unlisted kind: the K3 test's first fixture tripped on exactly this. How
  much of the size gap to upstream it explains is unmeasured.
- ⬚ **LocalCSE runs after SimplifyLocals and CoalesceLocals at -Oz**, so the tee it adds is never
  cleaned up: +4 bytes on a repeated binary (measured scoping K3, 2026-09-14).
- ⬚ **binaryen-ts could run-length-compress its locals** as wabt-ts now does — roughly 5,600 bytes
  of that redundancy on the corpus. An optimisation, not a defect
  ([ir-convergence.md](ir-convergence.md)).

## Open defects and gaps

- ⬚ **K4 — `Module.toWat()` prints invalid WAT** (public `./api`), and `optimize(…, hybridMode)`
  feeds it to `wasm-opt` — [divergences.md](divergences.md).
- ⬚ **`scripts/release/` runs no cold type check before the tag push**, so a stale type cache is
  caught only by `publish.yml` after the tag is public — and it wants a fresh `DENO_DIR`, not
  `--reload` ([binaryen-ts.md](binaryen-ts.md) § `binaryen-ts/publishing.md`). Release tooling, so
  the owner's call. (Its neighbour, the bump-then-release refusal, was fixed under owner decision 6
  — [publishing.md](publishing.md) § "The flow".)
- ⬚ **binaryen-ts's WAT parser has no multi-memory support** (measured 2026-09-15). An explicit
  memory index on `memory.size`/`grow`/`fill`/`copy` or a load/store is REFUSED — loud, not silent.
  `memory.size` was the silent exception (it ignored `$b` and asked memory 0) until S6 step 5 stage
  B4; `tests/binaryen-ts/parser/explicit_memory_index.test.ts` pins all five as refusals. wabt-ts's
  parser and both binary paths handle multi-memory. A capability gap in one front door, not a
  defect.
- ⬚ **Multiple tables are refused at encode** (`checkSingleTable`, `wasm-encoder.ts` ~1151; elem and
  `call_indirect` encode against table 0). A loud gap, not a silent one — the decoder already
  resolves `call_indirect`'s table index. The day it is lifted, both encoders must thread the real
  index.
- ⬚ **`src/bridge/bridge.ts:1190-1194` refuses `ref.as_non_null`** because "binaryen-ts v1.0.9 has
  no makeRefAsNonNull factory"; the factory exists since UP-4 (`f664ba579`). A stale blocker, moot
  if S6 step 5 deletes the bridge — check whether it is among the bridge's 20 refusals first.
- ⬚ **`scripts/wabt-ts/engine-check.ts` self-tests only the reject direction** (~195–219: a
  known-INVALID module must be refused). No must-ACCEPT module guards an engine that refuses
  everything — the exact failure its Wasmer comment describes (`--enable-all` made every module read
  as rejected).
- ⬚ **Stale source comments** (claim vs artifact; each verified 2026-09-14):
  - `src/wabt-ts/ir/ir-util.ts` — the `ModuleContext` class doc and the field comment at 86–90 claim
    validator/writer traffic; `getExprArity` has no production caller ([wabt-ts.md](wabt-ts.md)).
  - `src/wabt-ts/ir/apply-names.ts` header NOTE still calls the rewriter partial; T13.20 made it
    total.
  - `src/wabt-ts/reader/binary-reader.ts` ~2572 calls relaxed ternaries a known limitation; they
    decode as ternary.
  - `src/binaryen-ts/encoder/wasm-encoder.ts` ~1594–1605 describes "four sites" and
    `sealFrame`-stamped blocks, a mechanism S6 5 removed; so does the header of
    `tests/binaryen-ts/binary/region_body.test.ts` ("three of these thirteen" fail on a revert of
    `encodeRegionBody`).
  - `src/binaryen-ts/passes/asyncify.ts` ~263 says loads carry no memory index, and ~541–545 says
    the reader discards the name section; N1 P4 (`138148881`) reads names. Neither limitation
    re-probed.
  - `src/binaryen-ts/tools/wasm-opt.ts` ~461–463 says `import.meta.main` is "not yet universal"; the
    Node 22.18 floor has it.
  - `tests/wabt-ts/tools/cli_io_errors.test.ts:27` says `deno task test` runs `--allow-read` only.
- ⬚ **Minor, wabt-ts**: `parseHexFloat` (`core/literal.ts`) sums `parseInt` parts, imprecise but
  lexer-level only (the const path uses `parseF64Bits`); `wasm-objdump -h` only re-sets a default
  that is already `true`; the lexer's `isDigit && !readNum()` guard is dead.
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
  Someone who knows the intent should confirm (recorded in 1.5.2's scope, summarized in
  [project.md](project.md)).

## Conformance gaps — the wasmtk-ranked list

Ranking agreed in [handoffs.md](handoffs.md). Ranks 1–3 shipped (`br_on_cast` and `br_on_*` in
1.5.3; the convert pair `9d5c886be`, unreleased — divergence X1).

| rank | gap                                                | status                                                                                                                                       |
| ---- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 4    | the five that unblock nothing for wasmtk           | ⬚ open, ranked last on their numbers despite 121 occurrences                                                                                 |
| —    | **exact types** (`(exact $T)`), 116–548 assertions | ⬚ open, ranked last on effort. Parser-gated: `(exact $T)` fails at parse, so it is a type-system change across both trees, not a bridge case |

## Quality passes — 1.5.6 / 1.5.7

The plan, agreed 2026-09-02. Each version adds a LENS and re-runs every lens below it, and each lens
repeats until a pass turns up nothing new — the re-runs are the point, since fixing a hardening
issue can introduce a code issue:

| version   | lenses, in order                            | state                                                                                    |
| --------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **1.5.5** | code                                        | ✅ passes 1–7, register empty, converged — [testing.md](testing.md) § "The 1.5.5 passes" |
| **1.5.6** | hardening → then code again                 | ⬚ not started                                                                            |
| **1.5.7** | security → then hardening → then code again | ⬚ not started                                                                            |

Without definitions 1.5.6 just repeats 1.5.5. If a finding fits two lenses, file it under the
**lowest** one that would have caught it:

| lens          | question                                    | examples from this codebase                                                                                                 |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **code**      | is it WRONG on valid input?                 | wrong bytes, dropped information, logic contradicting its own docs, one fact duplicated in two places that drifted          |
| **hardening** | does it survive HOSTILE or malformed input? | truncated binaries, absurd section counts, deep nesting, a panic where a typed error is the contract, unbounded work        |
| **security**  | can a consequence be EXPLOITED?             | unbounded allocation from an attacker-controlled length, path traversal in a CLI, ReDoS, integer overflow reaching an index |

⚠️ Converging means THESE invariants no longer discriminate, not that no issues remain. Keep a
per-pass record — what each pass looked for and found — or convergence cannot be told apart from
fatigue.

## Repo work

- ⬚ **A2 — `wasm2ts` is a stub that throws.** The long-term goal (WASI Preview 1 capable TypeScript
  output). **Blocked, and not close**: as of 2026-09-02 the wasmtk side has a long way to go before
  there is anything to implement against.
- ⬚ **Phase 10 kernel selection** — a live gap carried from binaryen-ts, not re-checked since the
  merge ([project.md](project.md)).
- ⬚ **Diagnostic usefulness** ("is the message actionable?") is the one hardening axis never
  attempted; offsets (A3) and wording are measured ([wabt-ts.md](wabt-ts.md) §
  `wabt-ts/testing.md`).

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
  `deno task collisions` ([project.md](project.md)). The S series is the work.
- **D4 — never yank, ever** ([project.md](project.md)).
- **The predecessors are frozen** — no change to `binaryen-ts` or `wabt-ts` on GitHub or JSR.
