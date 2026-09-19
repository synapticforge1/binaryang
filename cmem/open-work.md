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

**State, 2026-09-19:** `binaryang@1.5.4` published (score 100, `rekorLogId=2692137018`). `main` is
ahead, unpushed and unbumped, at 1273 tests / 0 ignored, baseline IDENTICAL, spec 100% on four axes,
`direct` 544/544 and `direct-behaviour` 1953 calls agreeing (the bridge and its gates were deleted
2026-09-18), one pack. Re-derive before quoting.

## Start the next session here (handoff, 2026-09-19 — post-M8 fixes, W10b, W11, the cleanup, S7 and S7's mixed form ALL DONE; next: the owner's call)

**Where the work stopped.** `main` is at the merge of S7's mixed form (the reader fix `ab1a211ee`,
code `b366262ce`, re-baseline `cbb2cca20`), clean, nothing pushed, `deno.json` still 1.5.4. **No
branch is open.** The full gate ran on the committed tree `b366262ce` (as on every stage before it;
the re-baseline commit after it reads IDENTICAL) and every step exited 0: fmt, lint, **1273 tests / 0 failed**, naming (no output),
portability, baseline **IDENTICAL**, publish dry-run, operators, spec **2248 · 2714 · 711 · 1229, no
misses**, `direct` **544/544 byte-identical to wat2wasm, valid at every level** (421 corpus + 123 fixture, since fix 7), `direct-behaviour` **1953 calls / 651 exports agree at -O3**, `translate-eh`
**70/70 (and 70/70 at -Oz)**, `optimize-corpus`. Optimizer output: **0 of 2,105** hashes changed by ANY
stage of item 6; `wat2wasm` output 0 of 421. Fix 4 moved folded `wasm2wat` TEXT for 2 of 421
(re-baselined in its own commit, `abd8b7e5d`); bytes and linear text unchanged. Fix 5 changed
parse TREES only: 0 of 2,286 WAT files and 0 of 5,794 round-trip texts moved a byte.

✅ **The naming step is clean again (fixed 2026-09-18, owner-approved).** From `138148881`
(2026-09-11) `check-naming.sh` printed `tests/binaryen-ts/wabt_reference.ts`, a bare `wabt`
component, which CI's step fails on; a misread rule ("prints a filename on SUCCESS — read `$?`") hid
it. The helper is now `nameless_reference.ts`, and [working-rules.md](working-rules.md) says how the
step is judged: by its OUTPUT.

✅ **`corpus_roundtrip.test.ts`'s flaky oracle — fixed 2026-09-18 (`57b16a115`).** It failed twice
(once in M8a3's gate) on binaryen's `lit/control-flow-input.wast.wasm` with input and output
BYTE-IDENTICAL. First recorded as V8 validating lazily; the probe said worse: V8 in **Deno 2.9.7 has
no stable verdict on that binary** (legacy + new EH mixed) — 39 of 40 `WebAssembly.compile` AND
`WebAssembly.validate` calls rejected it — and **two of three probe runs crashed Deno** ("Check failed:
`!job->compile_imports_.empty()`"). No JS oracle can judge it, so the test holds it to byte identity
(`ENGINE_UNSTABLE`). ⚠️ If a Deno upgrade fixes the engine, the set can go; if another binary starts
flaking, probe it the same way before adding it.

⚠️ **The gate needs upstream wabt 1.0.41 on PATH** (`wast2json` for `translate-eh`). A scoop update to
1.0.42 removed the shim on 2026-09-16 and the owner reverted it; a red `translate-eh` saying "Failed
to spawn 'wast2json'" is the environment, not the code.

**S6 step 5 is DONE (2026-09-18):** items 1–5, the expression half, and item 6, the MODULE half (M1–M8e). The bridge is deleted; `prepareForPasses` (names M8c + types M8d) makes a wabt-ts tree ready for binaryen-ts in place, and the `direct` / `direct-behaviour` gates hold it. Scope and every stage's record:
[ir-convergence.md](ir-convergence.md) § "Item 6 — the MODULE half".

**Module ratchet** (`tests/ir/module_convergence.test.ts`; only-wabt-ts / only-binaryen-ts /
typed-differently): M1 **46 / 29 / 15** → **0 / 0 / 0** now — every pair one type, pinned whole-record. The `differ` count ROSE on purpose: a
field that converges in NAME but not yet in TYPE moves from a one-sided list into `differ`, and the
entity collections stay there until the records themselves are one type (M8).

### Done on 2026-09-17 (item 6)

| stage   | merge       | what                                                                                                        |
| ------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| M2h     | `7bcfb4171` | a global's `init` is optional in both — **M2 closed**                                                       |
| const-seq | `0cb37d858` | binaryen-ts reads a constant expression of ANY length: **53 binaries refused → byte-identical**; exposed a silent element-type loss, now refused |
| M3      | `01bc13a72` | segments are wabt-ts's records — element TYPES and entries kept: **348 improved, 175 of them had been re-encoding DIFFERENTLY** |
| M4      | `acd8ceba0` | an import EMBEDS its entity (the union): imported table64 / page size / huge sizes read, **22 more byte-identical**; imports pinned for the first time |
| M5a     | `83156ccff` | type entries keep `sub` and rec groups — **83 binaries were ALL wrong, 68 now byte-identical**              |
| M5b     | `40d1caa60` | the module's table is `types`; a field carries its name — **M5 closed**                                      |
| M6a+M6c | `b3b657ed0` | a function holds its `sig`; locals are ONE named list of slots — and flattening exposed an **OOM** on `binary.41`–`binary.44` (2^32 declared locals), now refused |
| M6b     | `f1c7424ec` | a function's body is a `RegionExpr` — **M6 closed**                                                          |
| M7a+M7b | `5ee759ea8` | the module's collections take binaryen-ts's names; the five `num*Imports` counts are DERIVED                 |
| M7c1    | `803a4a1bf` | the DataCount flag is `hasDataCountSection: boolean` in both (2026-09-18)                                     |
| M7c2    | `3d8c14b83` | the feature flags are gone from both — `hasGC` had silently drifted to "has a type section"; `featuresUsed` was never read (2026-09-18) |
| decision 4 | `ab80982a8` | 🗓️ owner: the one module follows binaryen-ts's naming practice (2026-09-18)                               |
| M7c3a   | `d654da455` | an import's param names and the module's name live on their records, not in `explicitNames` (2026-09-18)   |
| M7c3b b0 | `66ccfe236` | 🗓️ owner: names cover types and fields — binaryen-ts's types and fields always named; `explicitNames` lists the real ones by name (2026-09-18) |
| M7c3b b1a | `5e4a1cbdd` | the name section is its own fact: `hasNameSection` in both; `explicitNames` only says which names are real (2026-09-18) |
| M7c3b b1b | `c5ad07eac` | wabt-ts's reader names every entity, every writer writes only real names; `localNamesListed` → `explicitNames.localsListed` — **M7c CLOSED** (2026-09-18) |
| M7c3c   | `328a6763e` | wabt-ts's reader makes up LABELS too; fixed `--generate-names` dropping an unnamed type's real field names (a b1b bug) (2026-09-18) |
| M8 scope | `68b8194a6` | the bridge's work MEASURED: beyond names / types / labels, three value conventions (2026-09-18) |
| M8a1    | `610dd8e2d` | `align` is BYTES in binaryen-ts too (it held the exponent in a field declared bytes); fixed the compat API's alignment (2026-09-18) |
| decoder OOM | `af7082f4d` | binaryen-ts's decoder refuses 2^32 declared locals instead of running out of memory (M6c's defect, other decoder) (2026-09-18) |
| M8a2    | `cd4937027` | a call's `isReturn` is `true` or absent — `false` unrepresentable (2026-09-18) |
| engine oracle | `57b16a115` | the corpus round trip holds a binary V8 cannot judge stably to byte identity (2026-09-18) |
| M8a3    | (this merge) | a named-type `call_indirect` carries its signature — **M8a closed** (2026-09-18) |
| M8b1 + M8b2 | (this merge) | `start?: Var` in both; packed field types are the binary's codes in both (2026-09-18) |
| M8b3    | (this merge) | a module record's `loc` is optional (`locOf`): every leaf record IS its binaryen-ts partner (2026-09-18) |
| M8b4    | (this merge) | the function record is one type; `typeVar` kept and written back (51 spec binaries now byte-identical); whole-record identity pins (2026-09-18) |
| M8b5    | (this merge) | the module carries the as-written metadata (a pass run clears it); **module ratchet 0 / 0 / 0** (2026-09-18) |
| M8b6    | (this merge) | `WasmModule = Module` — binaryen-ts's module declarations are aliases, their docs kept field by field — **M8b closed** (2026-09-18) |
| M8c     | `62503981a` | `nameReferences`: every reference the bridge named is named on the module, and all 49,335 corpus references agree with the bridge; 2 more bridge defects found (`delegate` one frame too deep, a named `if` losing its label) (2026-09-18) |
| phantom value | `e819a92c3` | a linear `br_if` / `br_on_null` carries no phantom value: an S5 regression (`f27bfd5ca`) no byte gate could see, found by M8d (2026-09-18) |
| call_indirect arity | `9b786de22` | a linear `call_indirect` / `call_ref` takes its signature's arguments: T10.5's other half, found by M8d (2026-09-18) |
| M8d     | `0846a44da` | `deriveTypes`: every node typed by the factories' rules and the decoder's context. Agrees with the bridge except the bridge's `i32` `pop`s, and with the decoder over 2,490 valid spec binaries except the decoder's defects (2026-09-18) |
| M8e     | (this merge) | the bridge goes: `prepareForPasses`; the direct path's bytes ARE `wat2wasm`'s (421/421), its -O3 output behaves the same (1,806 calls); `direct` / `direct-behaviour` gates — **item 6 and S6 step 5 CLOSED** (2026-09-18) |

### Done 2026-09-18 → 2026-09-19 — every item the owner ordered

| item                        | code        | what                                                                                                   |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| post-M8 fix 1               | `ddd5f6163` | `table.get` typed by its table                                                                         |
| post-M8 fix 2               | `4b2488540` | a multi-value `call_indirect` typed by every result                                                   |
| post-M8 fix 3               | `565e7b2c2` | size / grow typed by the memory's / table's address type                                              |
| post-M8 fix 4               | `a82dadf90` | the binary reader: a one-value `br_if` is an operand                                                   |
| post-M8 fix 5               | `89b6a1805` | the WAT parser knows a branch target's arity; the text→optimizer route refuses 109 invalid modules it typed silently |
| post-M8 fix 6               | `653fd3839` | a folded `br_table` no longer DROPS a `(nop)` operand (a byte short of upstream)                       |
| post-M8 fix 7               | `517bf7c89` | `direct` / `direct-behaviour` also run `prepare.test.ts`'s fixture: they now see a start section          |
| post-M8 fix 8               | `dbe986344` | binaryen-ts reads and writes every memory index as a LEB (12 sites, not the 2 listed)                  |
| post-M8 fix 9               | `cf1b50bd8` | a `br_table` holds its carried values, in both front ends (W9 (a))                                    |
| post-M8 fix 10              | `a7915f1e1` | a branch to the function label carries the function's results (W9 (b))                                |
| owner decision (W10)        | `2fdc64ba8` | prefer the MORE ACCURATELY FOLDED form: W10a (keep ours) DESIGN, W10b match upstream                   |
| W10b                        | `cd37142a6` | a transfer is the next instruction's operand, as upstream folds it; fixed with it: `deriveTypes` typed a branch's condition before its values and accepted the invalid `br.6` |
| W11                         | `f2baf2ada` | folded `wasm2wat` folds EVERY instruction kind: 3,174 linear lines in folded output → 0, as upstream   |
| the scheduled cleanup       | `95be871f7` | RemoveUnusedModuleElements's no-op `importedFuncs` set deleted; 0 optimizer outputs moved              |
| S7 (owner: fidelity first)  | `899263b7b` | `wat2wasm` → `wasm2wat` keeps each function's written form: the `binaryang.text-form` section; the optimizer strips it |
| reader: import index space  | `ab1a211ee` | the binary reader looked up an imported function's / tag's signature among ALL imports: after a global import a call read back without operands (found by S7's measurement) |
| S7 mixed form (owner: one-to-one) | `b366262ce` | per INSTRUCTION: linear stays linear, folded folded, a mix the same mix — 2,295,102 instructions' forms reproduced over 1,043 sources; predicted from the wabt-ts reader's tree, skipped (never misapplied) where a tree disagrees |

Records: [ir-convergence.md](ir-convergence.md) § "Post-M8 fixes", § "W10b", § "W11"; each merge
message carries its measurements. Lessons: [best-practices.md](best-practices.md) § "Lessons from
the post-M8 run". **`prepareForPasses` stays internal (owner, 2026-09-18)**, as the bridge was.

### Next, in order

**The owner's call.** S6 step 5 is closed, S7 is done — per instruction since `b366262ce` — and
every ordered item is done. Everything else open is listed below, by kind.

🛑 **NEW, 2026-09-19 — ONE FRONT END** (owner decision): the readers and writers are shared too, not
only the tree. Measured, NOT started: [ir-convergence.md](ir-convergence.md) § "One front end",
with a five-stage plan for the owner to confirm. Found by that measurement, and open:
- ✅ ~~binaryen-ts's decoder MISCOMPILED saturating truncation~~ — FIXED 2026-09-19 (`2ca4513f1`,
  stage 0 of the confirmed plan): 0xFC 0x00–0x07 decoded as the TRAPPING truncations, so `wasm-opt`
  on any binary using them turned a saturated result into a trap (4 of 4 corpus modules; now 0).
  It shipped in 1.5.4 — see unreleased.md.
- ✅ **Stage 1 of the plan** (settle the tree — one node kind per instruction) is DONE but for one
  item: SIMD loads (`f60e4e575`), `defaultInit` and the unreachable `br_if` (`1ffdcb561`); the
  `if`-arm regions of a parametrised `if` are left to stage 2, which settles the block-param
  representation. The two routes' trees now differ only in OPERAND SHAPE —
  ir-convergence.md § "One front end". Next: stage 2 (move binaryen-ts's decoder reshaping into
  `prepareForPasses`), after the pass defect above.
- ✅ ~~`wasm-opt` emits INVALID output for 7 valid spec modules~~ — the DEAD-TAIL family fixed
  (`0498fbbae`, owner: fix it before stage 2): DCE and Vacuum read an `unreachable` TYPE as "control
  stops here", but a node is typed unreachable when any OPERAND is, and it still pushes its own value
  in the bytes. `neverFallsThrough` asks the real question. At -O2 / -Oz, modules optimizing to
  invalid output: 7 → 3 on binaryen-ts's decoder route, 6 → 2 on the reader route. What is left,
  each with its cause, all of it later stages' work:
  - `fac.0`, `if.0` — `PassRunner`'s block-param lowering, on BOTH routes ("not enough arguments on
    the stack for local.set"; "start-arity and end-arity of one-armed if must match"). Stage 2 owns
    block params.
  - `names.2` — binaryen-ts's decode → encode loses an empty export name ("Duplicate export name
    ''"), that route only; it goes when the decoder does (stage 3).
  - at -O3 only, `Inlining` on the reader route: `dynrt_lib_modc`, `Chapter11/vector`, `nop.0`,
    `br.0` ("not enough arguments on the stack for local.set") — operand shape, stage 2's subject.
- binaryen-ts's encoder refuses every module with more than one table (178 valid corpus modules);
  its decoder refuses relaxed SIMD (8).

⚖️ **A cost the owner may want to weigh:** with the record on, `wat2wasm` is ~30% slower over the
corpus (+26–35%), because it reads its own output back to learn what the wabt-ts reader will
predict — the price of exactness by construction. `--no-text-form` is within noise of main.
Nothing is pending on it; it is here so the trade is visible.

**Open, recorded not done** (each in its stage's record in ir-convergence.md):
- ⬚ **the wabt-ts binary reader attaches a multi-value operand's NEIGHBOUR** (DEFECT, trees only;
  found by S7's measurement, 2026-09-19): it pops operand NODES, not values, so in
  `(call $add2 (local.get 0) (call $take2 (call $pair)))` — `$pair` returning two values — the
  `local.get` hangs on `$take2` and `$add2` gets a `pop`. Bytes are right; `wasm2wat --fold` prints
  that wrong nesting (it re-assembles to the same code). Measured: 41 corpus functions where
  binaryen-ts's decoder (which leaves the `pop`) and the reader disagree, every one a `call` of this
  shape. ⚠️ Fixing it changes
  the reader's tree, and S7's prediction IS that tree: entries written before the fix fail their
  hash check and those functions print as predicted — degraded, never wrong. Measure that on the
  corpus before choosing.
- binaryen-ts's decoder reads a `ref.null` / typed element segment but **refuses an element type other
  than `funcref`** until the element model carries it — M3 left this deliberately
- the text format has no spelling for where the `name` section sat (M2f); `wasm2wat` → `wat2wasm` puts it last
- the WAT writer does not print an empty `(offset)` / `(item)` (M2a)
- the raw `metadata.code.*` section's stale offsets after optimization (item 5 (6a)); **W8**
- Asyncify refuses `call_ref` (K1)

**Working method that keeps paying** (the rules in [working-rules.md](working-rules.md) /
[best-practices.md](best-practices.md) — today's evidence):
- **measure on the corpus BEFORE choosing a direction.** Every silent defect this week was found that
  way, not by reading: the table64 narrowing, the element-type loss, the rec-group flattening, the
  name-section move, the locals OOM.
- **after a type change, read every use the compiler CANNOT see** — string interpolation, `as` casts,
  `Record<string, …>` lookups, a byte read and never compared.
- **a blunt regex is a defect generator.** `...body` and `...funcs` (rest/spread) both contain
  `.body` / `.funcs`; a node's `body` is not a function's; a `params:` rewrite hits parameter LISTS.
  Scope every bulk edit to the lines the compiler named, and read the diff.
- **an equivalent mutant is a finding, not a failure** — twice it pointed at dead code.

⚠️ **Carry the L2 discipline into every remaining stage**: when a field loses `null` or `undefined`
from its type, the compiler stops helping (`stringValued === null` is not an error), so list the
null tests first, convert by reading, and mutate each one back — see
[best-practices.md](best-practices.md) § "TypeScript does NOT flag".

---

**History kept here as a pointer only.** The 2026-09-14 memory-work session (merges `cff3284b8` …
`1cbe88be8`), the owner decisions that followed it (release flow, K3, TranslateEH, `call_indirect`'s
`sig`, dead-function removal as upstream, the module half UNIFIED — decision B) and the S6 step 5
narrative that led to M8 are recorded in their topic files: [publishing.md](publishing.md),
[ir-convergence.md](ir-convergence.md), [binaryen-ts.md](binaryen-ts.md),
[unreleased.md](unreleased.md). The block as it stood, with its since-finished "Next" and
"Suggested order": `git show c302bfadd:cmem/open-work.md`.

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

- ✅ **S6 step 5 — the bridge is deleted** (M8e, 2026-09-18): `prepareForPasses` (names M8c, types
  M8d) replaced it, and `deno task direct` / `direct-behaviour` its gates —
  [ir-convergence.md](ir-convergence.md) § "Item 6 — the MODULE half".
- ✅ **S7 — the text-form record** (2026-09-19): per function (`899263b7b`), then per INSTRUCTION —
  a mix stays the same mix (`b366262ce`, owner: "one to one unless it goes through optimization");
  on by default, stripped by the optimizer — [ir-convergence.md](ir-convergence.md) § "S7".
- ✅ **K1 — atomics and `call_ref` in binaryen-ts** — ported 2026-09-16 (S6 step 5 item 5 (5)).
  Left from it: Asyncify refuses `call_ref` (upstream instruments it as an indirect call).
- ⬚ **W8 — wabt-ts drops `(@metadata.code.*)` text annotations** (DEFECT, silent). The `code_metadata`
  node exists and nothing builds it; the binary section round-trips raw. wabt-ts-only (owner, K2).

### Follow-ups kept deliberately behaviour-neutral

- ✅ ~~RemoveUnusedModuleElements's `importedFuncs` set changes nothing~~ — deleted in the scheduled
  cleanup (`95be871f7`); the entry as it stood: `git show 7fa9c8246:cmem/open-work.md`.
- ⬚ `mapExpression` / `walkExpression` visit a branch's condition BEFORE its values — the reverse of
  wasm's evaluation order. Fixing it may move `-Oz` bytes, so it wants its own measured commit.
  ⚠️ It was not only theoretical: `deriveTypes` (order-sensitive) used it, and W10b's nesting made
  the spec's invalid `br.6` pass. `deriveTypes` now orders branch operands itself (`cd37142a6`);
  any OTHER order-sensitive visitor of branches is still exposed.
- ⬚ LocalCSE treats a multi-value `return` as opaque (as it did the `tuple.make`).
- ⬚ **26 node LITERALS in `src/` bypass their factory** and hand-compute its `type` — 17 in
  binaryen-ts's WAT parser, 5 in inlining, 4 in three other passes (re-counted 2026-09-19, was 43 on
  2026-09-14: `grep -rnE "kind: ExpressionKind\.\w+," src` outside `ir/expressions.ts`). The
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
- ⬚ **`scripts/wabt-ts/engine-check.ts` self-tests only the reject direction** (~195–219: a
  known-INVALID module must be refused). No must-ACCEPT module guards an engine that refuses
  everything — the exact failure its Wasmer comment describes (`--enable-all` made every module read
  as rejected).
- ⬚ **Stale source comments** (claim vs artifact; first verified 2026-09-14, ALL seven re-checked
  and still stale 2026-09-19, line numbers current):
  - `src/wabt-ts/ir/ir-util.ts` ~80 / ~91 — the `ModuleContext` doc claims traffic "across
    validator, binary writer, and bridge" (the bridge is deleted); `getExprArity` has no production
    caller ([wabt-ts.md](wabt-ts.md)).
  - `src/wabt-ts/ir/apply-names.ts` ~16 header NOTE still calls the rewriter partial; T13.20 made it
    total.
  - `src/wabt-ts/reader/binary-reader.ts` ~2721–2724 calls the relaxed ternaries "not yet
    distinguishable… a known limitation"; ~2700 decodes them as ternary.
  - `src/binaryen-ts/encoder/wasm-encoder.ts` ~1736–1744 describes "four sites" and
    `sealFrame`-stamped blocks, a mechanism S6 5 removed; so does
    `tests/binaryen-ts/binary/region_body.test.ts` ~152.
  - `src/binaryen-ts/passes/asyncify.ts` ~276 says loads carry no memory index, and ~553 says the
    reader discards the name section; N1 P4 (`138148881`) reads names. Neither limitation re-probed.
  - `src/binaryen-ts/tools/wasm-opt.ts` ~463 says `import.meta.main` is "not yet universal"; the
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
- ⬚ **`wasm2wat` cosmetics** (re-probed 2026-09-19) — ENTITY references print by index (`call 0`,
  `global.set 0`) where upstream prints `call $f` / `global.set $g` from the name section; branch
  LABELS print by name since N8. Folded siblings share a line (`(call 0)) (i32.add`). Text only,
  never bytes ([names.md](names.md)).
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
