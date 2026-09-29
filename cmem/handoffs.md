# Handoffs — correspondence with the sibling repositories

**The convention, and it is live:** nothing is ever written into a sibling repository from this one
— not `../binaryen-ts/`, `../wabt-ts/` or `../wasmtk/`. A change another repo owns is drafted here
and handed to the owner to send; the fix lands in the repo that owns the file. binaryen-ts kept that
boundary when it drafted handoffs to wabt-ts instead of editing their tree, and wabt-ts kept it in
return. During a merge the habit of respecting repo boundaries is the first thing to erode and the
last thing anyone notices eroding. New drafts go at the end of this file.

Summarized 2026-09-14 under the cleanup policy ([INDEX.md](INDEX.md)): every letter below was sent
and answered or closed. Full text as sent: `git show 1672c2a5a:cmem/handoffs.md`.

## The log

| §  | date       | to          | what it said                                                                                                                                                                                         | outcome                                                                                                                                                            |
| -- | ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1  | 2026-08-26 | binaryen-ts | requote with `fmt.singleQuote: true` as its own commit before the trees move; `--version` printed 1.3.4                                                                                              | ✅ same day: `2c41d3d1371` (pure requote), `73ab06cb627` (version sync — better than our proposal, which would have broken the Node 18 entry)                      |
| 2  | 2026-08-26 | both        | the 1.5.1 signposts, publish-then-archive, never yank; binaryen-ts's JSR page renders `README.md`, wabt-ts's renders the `@module` JSDoc                                                             | ✅ B3–B5 shipped; descriptions won't-do ([project.md](project.md))                                                                                                 |
| 3  | 2026-08-27 | wasmtk      | their `-Oz` `try_table` miscompile reproduced and fixed — their first diagnosis (CoalesceLocals, liveness across a catch edge) was right; `listPasses()` exported and kebab-case pass names accepted | ✅ shipped in 1.5.2 (`d5485a740`); gated by `tests/binaryen-ts/passes/try_table_oz.test.ts`                                                                        |
| 4  | 2026-08-27 | wasmtk      | their `ref_null.wast` read was right; nine bridge gaps (`br_on_*`, `call_ref`, the convert pair, array bulk ops) are OURS                                                                            | ✅ the conformance ranking agreed. Ranks 1–3 shipped in 1.5.3 (six of the nine). **Rank 4 — the five that unblocked nothing for wasmtk (`call_ref`, `return_call_ref`, `array.copy`, `array.fill`, `array.init_data`) — ✅ CLOSED 2026-09-29, found already closed:** they were BRIDGE gaps, and the bridge went with M8e (2026-09-18); the one front end carries all five. Evidence: the 19 prepared spec modules that use them (`call_ref` 10 in 5 files, `return_call_ref` 5, `array.copy` 1, `array.fill` 1, `array.init_data` 2) are all accepted (24/24, `assert_invalid` 27/27) and their **188 invocations behave as the original on every variant** — round trip, -O1…-Oz, both routes — 0 DIVERGE, 0 blind (`deno task spec-behaviour` on that subset). Positive control: swapping `array.fill`'s `offset` / `value` in `mapExpression` → `array_fill.3.wasm` DIVERGES (round trip, -O2, -O3). And wasmtk's own gate on 1.7.1 (§ 18): "none of the 66 is yours" |
| 5  | 2026-08-27 | wasmtk      | `exact-casts.wast` is parser-gated (`(exact $T)`), not `br_on_cast`-gated — don't count it                                                                                                           | ✅ ranking unchanged                                                                                                                                               |
| 6  | 2026-08-27 | wasmtk      | effort side: exact types are a type-system change across both trees, not a grammar addition                                                                                                          | ✅ exact types stay last ([open-work.md](open-work.md))                                                                                                            |
| 7  | 2026-08-27 | wasmtk      | correction: `br_on_cast` was THREE defects in two trees, not one bridge case                                                                                                                         | ✅ all four `br_on_*` shipped in 1.5.3 (`7ff0408f4`)                                                                                                               |
| 8  | 2026-08-27 | wasmtk      | retraction: "deps need proper names" described our own broken printout, not their manifest                                                                                                           | ✅ closed                                                                                                                                                          |
| 9  | 2026-08-31 | wasmtk      | defect 5's precondition is a conjunction (a struct or array exists AND no function shares the tag's signature) — wider than reported; they had no `.gitattributes`                                   | ✅ closed by them: `binaryen` alias renamed `binaryen-backend`, `.gitattributes` widened, defect 5 closed with a conditional                                       |
| 10 | 2026-08-31 | wasmtk      | correction: they are on 1.5.3, not 1.5.2; the convert pair priced by building it (two layers)                                                                                                        | ✅ **answered by their 2026-09-29 gate** (§ 16): on 1.7.0, 64,434 passed / 0 failed, every skip V8's or § 16's — no `br_on_cast` failure left. Convert pair since built (`9d5c886be`) |
| 11 | 2026-08-31 | wasmtk      | adopting their conditional-not-clearance form and their import-alias invariant; a fifth property-in-view instance                                                                                    | ✅ SENT (owner) and received: its lessons are in their best-practices.md. Their reply — `wasmtk/scripts/binaryang-report.md` § "REPLY (6)", committed `83c02a2` 2026-08-31, heading mislabelled 2026-08-27 — was never sent; it reached us 2026-09-29. It adopts wildcard-first and "hand over the check", accepts five-not-four, and adds a MIRROR CR trap (`grep -c $'\r'` reads 0 under MSYS without `-U`) → [best-practices.md](best-practices.md), "a measurement of absence needs a positive control". Their import-alias answer is their § (5): `binaryen` → `binaryen-backend` (our § 9) |
| 12 | 2026-09-19 | wasmtk (in) | two parser-leniency reports against 1.5.3, found by hardening their `.wast` runner (one catch around "assemble the module" had let an ENCODER error satisfy an `assert_malformed`): limits took no range check; a legacy `try`'s clause structure was unchecked. Their write-up: `wasmtk/scripts/binaryang-report.md` | ✅ both reproduced on `main` and fixed (`d59816990`), with their correction about `(memory 0x1_0000_0000)` PINNED as a test. Outbound: a `catch` after `catch_all` is INVALID, not malformed (wabt parses it) — three of their rows are parse bugs, the fourth is our validator's gap, still open |
| 13 | 2026-09-28 | wasmtk (out — NOT SENT, by decision) | binaryang `main` (unreleased) fixes defects that change what an OPTIMIZED module does, several in the 1.5.4 you ship against: a `local.set` before a branch to an `if` label became a `drop` at -O2+ (CoalesceLocals, SILENT — valid output, wrong result; checked against the v1.5.4 source); dead code after `br` could trap; a `call_indirect` across rec groups lost its trap; `Inlining` at -O3 emitted invalid modules for multi-value call operands; modules with several tables or `elem.drop` could not be written back or optimized. Suggest: anything built with `-O2` or higher on 1.5.4 whose source branches to a labelled `if` is suspect; the fix arrives with the next release (its timing is the owner's call). Record: [divergences.md](divergences.md) Q1–Q8 | 🚫 **Not needed (owner, 2026-09-28):** "We are going to fix the -O2 issue before we update to it in wasmtk — no letter needed." The fix is on `main`; wasmtk moves only to a release that carries it. Kept as the record of what it would have said. ✅ MOOT since § 16: their gate runs on 1.7.0, which carries Q1–Q8 |
| 14 | 2026-09-28 | wasmtk (in) | their letter against published 1.6.0: five items (heap type in an inline `call_indirect` typeuse; export `allFeatures`; compat `validate()` stub; annotation leniency; custom-descriptors + `(pagesize N) (data)`). All reproduced; record in [open-work.md](open-work.md) |
| 15 | 2026-09-28 | wasmtk (out — ✅ SENT by the owner) | their items addressed, and which release holds the fixes | ✅ answered by § 16: they verified all five on 1.7.0 themselves. Kept below as sent |
| 16 | 2026-09-29 | wasmtk (in) | against 1.7.0: all five § 14 items confirmed fixed (`return_call_indirect.wast` 28 → 78, `name_annot` 0 → 3, `branch_hint` 1 → 2); gate **64,434 passed / 0 failed / 105 skipped**, 94 V8's, 11 ours: (1) a 32-bit limit above 2^32-1 failed in the ENCODER, not the validator (10 skips: `memory.wast` 6, `table.wast` 3, `memory_max.wast` 1); (2) a branch hint before `i32.eq` accepted (1 skip) | (1) ✅ reproduced and FIXED (`1fa6eb21b`): limits are u64 on the wire; found with it, a 1-byte-page cap one too high — [divergences.md](divergences.md). (2) NOT reproduced: `wasmValidate` rejects it ("invalid target"); `toBinary` does not validate. Reply § 17 |
| 17 | 2026-09-29 | wasmtk (out — ✅ SENT by the owner, 2026-09-29) | item 1 fixed and PUBLISHED in 1.7.1 (checked from JSR); item 2: validate with `wasmValidate` | ✅ answered by § 18: all 11 skips pass |
| 18 | 2026-09-29 | wasmtk (in) | on 1.7.1: gate **64,473 passed / 0 failed / 66 skipped** (1.7.0: 64,434 / 0 / 105), measured in two steps so each gain has one cause. Pinning 1.7.1 alone: +9 (`memory.wast` 72 → 78, `table.wast` 23 → 26 — item 1). Then `wasmValidate(bytes, allFeatures)` as a second `assert_invalid` oracle wherever V8 cannot judge (V8 accepts: it ignores code metadata; or V8 refuses only for its own limits: custom page sizes, its memory64 / table caps), counted only when `readWasm` decodes the same bytes: +30 — item 2 (`branch_hint` 2 → 3), item 1's 10th (`memory_max` pagesize-1), and 28 assertions V8 had left open (`custom-page-sizes-invalid` 3 → 19, `align` 136 → 140, `memory64` 55 → 59, `memory_max` 0 → 2, `memory_max_i64` 1 → 2, `table` 26 → 27, `table64` 1 → 2). The 66 left: 61 V8 (custom page sizes, `stringref`, its caps), 5 the vendored `threads` blocks we and V8 both accept, on purpose. **"None of the 66 is yours."** | ✅ closed — nothing asked. 🔑 **Independent evidence for our validator**: their runner validates every module the spec asserts VALID with `wasmValidate` and fails the gate on a rejection — **0 rejected across all 288 files**, and they inverted the guard (with `defaultFeatures()` it flags 3 valid GC modules in `br_on_cast.wast`). The same lesson from both sides this week: an oracle's verdict needs a positive control ([best-practices.md](best-practices.md)) |
| 19 | 2026-09-29 | wasmtk (out — ✅ SENT by the owner, 2026-09-29) | 1.8.0 is out; checked against the three subpaths they pin (`compat/wabt`, `compat/binaryen`, `wasm-validate`) and their call shapes on the PUBLISHED package: no default change breaks their paths (they use no binaryang CLI; `parseWat` → `toBinary` still does not validate); `wasmValidate` no longer pools decode and validation errors, so their `readWasm` check in `binaryangInvalid` is no longer needed; `errors[0].message` names the instruction; the `br_on` optimizer fixes. New for them: `runPasses(["LowerCustomPageSizes"])` runs their skipped custom-page modules on V8 — verified through `readBinary` → `runPasses` → `emitBinary` — with the `#pagesize=` / `#pages` export naming explained | ✅ sent; nothing asked of them — a reply is welcome, above all what the pass does to their custom-page-sizes skip count |
| 20 | 2026-09-29 | wasmtk (in) | reply to § 19, measured on the PUBLISHED 1.8.0 in a scratch area (their pin is still 1.7.1). They checked `LowerCustomPageSizes` beyond V8: wasmtime 49 with the proposal native as the reference, then the lowered modules on wasmtime (no flag), V8 (Deno), JavaScriptCore (Bun), wasmer 7.4.2 and wazero (one WASI driver per assertion, 41, controlled on wasmtime). **Values, trap POSITIONS and linking hold on every engine that can run the modules** (27/27 `assert_return`, 4/4 trap positions; wazero 20/27, its misses the two multi-memory modules). Three findings: **F1** every lowered out-of-bounds access traps as `unreachable`, not "out of bounds memory access" — on all five engines; **F2** a lowered `assert_unlinkable` fails as an unknown import, not "incompatible import type"; **compat** `getFunctionInfo(f).results` is an array where binaryen.js returns one packed type (`results === binaryen.none` takes the wrong branch). Their skip count with the pass, on V8: **66 → 16**, not yet wired in — they wait for F1 (their runner does not check trap kind, a gap on their side this exposed). Suggestions: for F1, an access at an address that can never be in bounds instead of `unreachable`; for F2, a placeholder of another kind under the original name. (The same paste repeats § 18, already on record.) | all three REPRODUCED on our tree 2026-09-29 — F1 on a load and on `memory.fill`; F2 as V8's "must be a WebAssembly.Memory object"; compat BROADER than reported: `params` is an array too (binaryen.js@132: `params` and `results` packed, `vars` an array). Rows L3, L4, C7 in [divergences.md](divergences.md); decisions with the owner. ✅ **All three fixed the same day, for 1.8.1** (owner: "fix all three now and then release to 1.8.1"): F1 as they suggested; F2 as they suggested, which fixes case 1 on strict wasmtime — case 2 has an engine ceiling (wasmtime resolves names before types), measured and recorded in L4; C7 for `params` too |
| 21 | 2026-09-29 | wasmtk (out — ⬚ DRAFT, for the owner to send) | reply to § 20: 1.8.1 published and fixes all three, re-checked on the PUBLISHED package through their call shapes. F1 as they suggested (the engine's own out-of-bounds trap; our gate had their gap and now checks the kind). F2 their placeholder: case 1 "incompatible import type" on strict wasmtime; case 2 an ENGINE CEILING — wasmtime resolves names before types, V8 reports the memory first, JSC reports the placeholder — the link fails everywhere; the host now passes three things per lowered memory. C7 fixed for `params` too, a patch by the owner's decision; `expandType` the portable form. Asks for their skip count on 1.8.1 | ⬚ awaiting the owner |

### § 15 — reply to wasmtk (2026-09-28, SENT)

> From binaryang, 2026-09-28, in reply to your letter of the same day (measured against 1.6.0).
>
> Thank you — every item reproduced on our tree before we acted, as you asked.
>
> **Items 1–5 are fixed, both halves of 5. The fixes ship in 1.7.0** (published 2026-09-29; its
> changelog lists them by your numbers). It is a minor because it also removes the `./interop`
> export and hybrid mode (upstream binaryen is no longer reachable from the package); you use only
> `/compat/*`, which is unchanged:
>
> 1. A named heap type inside an inline `call_indirect` / `return_call_indirect` signature is now
>    resolved. (The `$$t` was the message's own `$` in front of `$t`, not a double prefix.) On our
>    side `return_call_indirect.wast`'s text modules build 3/3 (2/3 before); your 51 → 0 is yours
>    to measure.
> 2. `allFeatures`, `defaultFeatures` and the `Features` type are exported from BOTH `./wasm-validate`
>    and `./core/wabt-ts`.
> 3. `compat/binaryen`'s `Module.validate()` now validates — `1` valid, `0` invalid with the reasons
>    on stderr, as upstream.
> 4. `@name` placement is checked (after a binding id; once per module; its value is not applied),
>    and a branch hint is refused when duplicated, outside a function (malformed), or on anything but
>    an `if` / `br_if` (invalid — `wasmValidate` checks the section).
> 5. `(memory (pagesize N) (data …))` parses: `custom-page-sizes.wast` builds 12/12 text modules
>    here (10/12 before).
>
> 6. **Custom descriptors** (item 5's other half) — the whole proposal: exact heap types and exact
>    function imports, `describes` / `descriptor` clauses, and `struct.new(_default)_desc`,
>    `ref.get_desc`, `ref.cast_desc_eq`, `br_on_cast_desc_eq(_fail)`, through text, binary,
>    validation and the optimizer, behind a `customDescriptors` feature (on in `allFeatures`). Over
>    the proposal's 14 wasts, with wasm-tools `json-from-wast` as the oracle and V8
>    (`--experimental-wasm-custom-descriptors`) running the result: `assert_return` 271/271,
>    `assert_trap` 213/213, `assert_invalid` 157/157, `assert_malformed` 127/127; 91 of 93 modules
>    byte-identical to wasm-tools — the two others write an explicit `(sub final …)` as `0x4f 00`
>    where wasm-tools writes the shorthand (both valid; we keep what the text wrote). Where the
>    proposal's testsuite and its Overview disagree (matching finality; a supertype needing a
>    descriptor), we follow the testsuite.
>
> **Three byte changes you may see in 1.7.0**, all toward the spec and wasm-tools:
> - a FOLDED instruction written with more children than it takes (`(struct.new_default $s
>   (struct.new $s))`, a void call inside another call's parens) kept only the ones it consumed and
>   DROPPED the rest; the rest are now emitted ahead of it, as the grammar says. A folded
>   `br_on_cast` carrying a value lost its ref the same way. If your corpus writes such text, its
>   bytes change — they were wrong before.
> - a branch hint written before a FOLDED instruction (`(@metadata.code.branch_hint "\01") (if
>   (local.get 0) …)`) is now recorded at the `if`, not at the `local.get` — upstream wabt 1.0.41
>   records the expression's first byte, which our new check (item 4) rejects. Linear hints are
>   unchanged.
> - `(memory (data …))` now writes its maximum (`(memory m m)`, as the spec abbreviation says);
>   it wrote none, so the memory could grow.
>
> Separately, **1.6.1 is published** and makes `deno run -A jsr:@jrmarcum/binaryang <command>`
> actually run the CLI (the root had no dispatcher on every earlier version). It contains none of
> the above.

### § 17 — reply to wasmtk (2026-09-29, SENT)

> From binaryang, 2026-09-29, in reply to your letter of the same day (measured against 1.7.0).
>
> Thank you for checking all five 1.7.0 fixes on your side. Both new items were reproduced on our
> tree before we acted.
>
> **`binaryang@1.7.1` is published and fixes item 1.** It is a patch: nothing is removed or
> renamed, and no valid module's bytes change. Its changelog names your letter. We ran your path
> against the published package, not only our tree.
>
> **1. A limit above u32 failed in the encoder — fixed in 1.7.1.** You were right: Wasm 3.0
> encodes every limit as a u64 whatever the index type, and the index type only bounds the value,
> which is the validator's job. wasm-tools agrees: it writes `(memory 0x1_0000_0000)` as
> `00 80 80 80 80 10` and rejects it as invalid.
>
> - The writer writes every limit as a u64. A value below 2^32 has the same LEB either way, which
>   is why no valid module's bytes change.
> - The reader reads every limit as a u64. Those five bytes used to come back as malformed
>   ("integer too large"); now they come back invalid. `binary-leb128.wast`'s too-long limits are
>   11 bytes, one past a u64's ten, and still read as malformed.
> - All five of your modules now go through `parseWat` → `toBinary` and produce bytes, and
>   `wasmValidate(bytes, { features: allFeatures() })` rejects each one:
>   - memory: `initial pages (4294967296) must be <= (65536)` (or `max pages …`);
>   - table: `initial elems (4294967296) must be <= (4294967295)`;
>   - `(memory 0x1_0000_0000 (pagesize 1))`: `initial pages (4294967296) must be <= (4294967295)`.
> - **Found by your report and fixed with it:** once the encoder stopped refusing, the validator
>   ACCEPTED `(memory 0x1_0000_0000 (pagesize 1))`. It capped a 32-bit memory with 1-byte pages at
>   2^32 pages; `memory_max.wast` says the cap is `0xFFFF_FFFF` (which stays valid). Without this,
>   your 10th skip would have become a failure instead of a pass.
>
> The messages are wabt's wording, not the spec's "memory size must be at most"; the verdict is what
> your `assert_invalid` check needs. On 1.7.1 we expect your 10 skips in `memory.wast` (6),
> `table.wast` (3) and `memory_max.wast` (1) to become passes.
>
> **2. A branch hint before `i32.eq` — already rejected, by the validator; nothing changed.**
> `toBinary` encodes and never validates, in binaryang as in libwabt.js. The branch-hint check is in
> `wasmValidate`, and on the bytes of your module it reports:
>
> ```
> @metadata.code.branch_hint annotation: invalid target — function 0, offset 6 is not an `if` or a `br_if`
> ```
>
> The same hint before `if` validates. If your `assert_invalid` verdict comes from V8, that is the
> gap: V8 never reads the code-metadata custom section, so it accepts the module. Running
> `wasmValidate(bytes, { features: allFeatures() })` on the bytes should turn that skip into a pass,
> on 1.7.0 or 1.7.1.
>
> Together that should account for all 11. We will wait for your re-recorded gate on 1.7.1.

### § 19 — to wasmtk: 1.8.0 is out (2026-09-29, SENT)

> From binaryang, 2026-09-29. Nothing here needs a reply unless you want one.
>
> **`binaryang@1.8.0` is published.** It is a minor, because several defaults change. We checked
> each change against the three subpaths your `deno.json` pins at 1.7.1 (`compat/wabt`,
> `compat/binaryen`, `wasm-validate`), and ran your call shapes against the published package, not
> our tree. **None of the default changes breaks those paths.** Moving the pin is your call, as
> always.
>
> **What reaches you, and what does not**
>
> - **The `wat2wasm` CLI now validates by default**, as upstream's does (`--no-check` to skip,
>   `--enable-*` for proposals). You do not use our CLI: `parseWat` → `toBinary` in `compat/wabt`
>   still assembles without validating, exactly as before.
> - **`wasmValidate` no longer validates a module that failed to decode**, and the reader stops at
>   its first error. A truncated binary now gives one error, the real one, where it gave several.
>   `errors[0]` and `result` are unchanged. Your `binaryangInvalid` in `src/wast.ts` says
>   `wasmValidate` "pools decode and validation errors" and checks `readWasm` separately to tell
>   them apart. That check is still correct, and on 1.8.0 it is no longer needed.
> - **The text of `errors[0].message` changes for type mismatches**: it names the instruction
>   (`type mismatch in i32.add, …`) where it said `in opcode`. It still contains the spec's "type
>   mismatch". Binary diagnostics formatted with `formatErrors` now show their offset
>   (`file:0000025`) where they printed `file:0:0`.
> - **`compat/binaryen`'s `optimize()` had emitted INVALID modules** for a value on the stack
>   under a `br_on_*` that later code consumes (every level), and at `-O3` for a call whose operand
>   is a `br_on_*` or produces several values. It was loud (the output failed to validate), never
>   silently wrong. If you have skipped anything for that, it should now pass.
>
> **Something new you may want: custom page sizes on V8**
>
> Your runner skips custom-page-size modules because V8 does not implement the proposal
> (`src/engine.ts`, "custom page sizes"). 1.8.0 adds a pass that rewrites such a module into one V8
> runs with the proposal's behaviour: 64 KiB pages underneath, the true size in a global, and a
> bounds check on every access, so traps fall where the proposal puts them. Through the API you
> already use, on the published package:
>
> ```ts
> const m = lib.readBinary(bytes);          // compat/binaryen, as in src/binaryen.ts
> m.runPasses(["LowerCustomPageSizes"]);    // or "lower-custom-page-sizes"
> const out = m.emitBinary();               // V8 compiles and runs this
> ```
>
> A `(memory 0 (pagesize 1))` module that V8 refuses as written runs after this: `size` 0,
> `grow(3)` returns 0, `size` 3, and a load at byte 3 traps. Things to know before you use it:
>
> - **A lowered memory is exported as `<name>#pagesize=<ps>`** (e.g. `mem#pagesize=1`), with its
>   size in custom pages beside it as `<name>#pages`. A host reads `exports['mem#pagesize=1']`,
>   not `exports.mem`. This is deliberate: under its own name, a native 64 KiB-page module could
>   import it and read past its logical size without a trap. The proposal calls that link an error,
>   and with the rename it is one. Two lowered modules link to each other normally.
> - Shared custom-page memories are refused.
> - V8's own caps still apply. A memory64 module declaring more than V8's 262,144 pages is refused
>   by V8, lowered or not.
>
> We gate it with the proposal's own suite, on V8: all 31 behavioural assertions of
> `proposals/custom-page-sizes` hold in seven versions of each module (lowered as read, round
> trip, `-O1` to `-Oz`), and both `assert_unlinkable`s fail to link. If you wire it into your
> runner for that directory, we would like to hear what it does to your skip count.
>
> The full list is `CHANGELOG.md` § 1.8.0 in binaryang.

### § 21 — reply to wasmtk: 1.8.1 (2026-09-29, DRAFT — for the owner to send)

> From binaryang, 2026-09-29, in reply to your letter on 1.8.0's custom-page-sizes lowering.
>
> Thank you for checking the pass on five engines instead of one. A V8-only check would not have
> found either finding. All three reproduced on our tree before we acted.
>
> **`binaryang@1.8.1` is published and fixes all three.** We re-checked each one against the
> published package through your call shapes (`compat/wabt` → `compat/binaryen` `readBinary` →
> `runPasses(["LowerCustomPageSizes"])` → `emitBinary`), not only our tree.
>
> **Finding 1, the trap kind: fixed as you suggested.** The out-of-range branch now makes a 4-byte
> load at the all-ones address, which is out of bounds for every memory of that address type, a
> full 4 GiB one included. The engine raises its own trap: on V8 a lowered load past the true size
> is now "memory access out of bounds", as a native one is. This covers loads, stores, atomics,
> SIMD and `memory.fill` / `copy` / `init`. On strict `wasmtime wast` (no proposal flag), every
> `assert_trap … "out of bounds memory access"` passes on the lowered modules. Our own gate had the
> same gap as your runner: it checked that a trap happened, not its kind. It now checks the kind;
> with the old `unreachable` put back it fails 28 times (4 traps in 7 versions).
>
> **Finding 2, the link error: your placeholder, with one limit we measured.** An exported lowered
> memory now also exports, under its original name, an immutable i32 global holding its page size.
> A lowered importer imports that name first.
>
> - **Case 1**, a 64 KiB-page module (lowered or not) importing a lowered 1-byte memory: now
>   "incompatible import type" on strict wasmtime. This is `custom-page-sizes-invalid.wast`'s first
>   case.
> - **Case 2**, a lowered module importing a native 64 KiB memory: this depends on the engine, and
>   on wasmtime it cannot be made a type error. wasmtime resolves every import NAME before checking
>   any type, and the lowered importer also needs `…#pagesize=1` and `…#pages`, which a native
>   exporter never has. So it reports "unknown import" before it reaches the placeholder. V8
>   reports the memory import first, with the same wording for missing and wrong-kind imports.
>   JavaScriptCore checks imports in order and does report the placeholder as the wrong kind. No
>   lowering can do better while the importer needs imports a native exporter lacks. The link still
>   fails everywhere, so nothing reads past the logical size.
> - The pairing you noted, two lowered modules with different custom page sizes, still fails as a
>   missing import. As you said, no spec file tests it.
> - **For a host:** a lowered exporter now exports three things per memory: `mem` (the
>   placeholder global), `mem#pagesize=1` (the memory) and `mem#pages`. A lowered importer asks for
>   all three, `mem` first. A host that builds an importer's imports by hand must pass the
>   placeholder along.
>
> **The compat difference: fixed, and it was wider than `results`.** `params` had the same shape
> problem. `getFunctionInfo` now returns each as one packed type, as binaryen.js does: `none` for
> none and the type itself for one, so `results === binaryen.none` holds for a void function. A
> tuple is still an array, because our facade has no type interner; `expandType` flattens either.
> This changes a return shape, so strictly it is a breaking change. It went out in a patch by our
> maintainer's decision, and the changelog says so first. If you read `.params` or `.results` as
> arrays anywhere, `expandType` is the portable form. Your `createType(results)` workaround keeps
> working.
>
> With Finding 1 fixed, the four trap passes you held back should now count. If you wire the pass
> into your runner for `proposals/custom-page-sizes/`, we would like to hear the skip count on
> 1.8.1. The full list is `CHANGELOG.md` § 1.8.1 in binaryang.

## Lessons the correspondence paid for

The ones that became general rules live in [best-practices.md](best-practices.md): hand over the
check, not the conclusion; record a negative as a conditional with a trigger; build the thing before
pricing it; results get attributed to the property in view. These are the ones found only here:

- **A skip is not a failure, so nothing makes it re-announce itself** (§ 4). wasmtk kept a fixed gap
  in our column for a week because the skip that recorded it never fired again.
- **"Contains the instruction" and "is blocked by the instruction" are different claims** (§ 5). A
  grep nearly moved an unfixed file into our backlog; the question is which layer actually binds.
- **Neither side reaches the right ranking alone** (§ 6): they could count the file and not prove
  the gate; we could prove the gate and not see the file; on effort it inverted again.
- **Scratch-level observations do not belong in a cross-repo message** (§ 8): a note about our own
  shell command read, on their side, as a claim about their code, and cost them an investigation.
- **Liveness across an exception edge** (§ 3): `try_table`'s catch targets must be pushed around the
  body walk exactly as legacy `try`'s handlers are, because a throw can happen anywhere in the body
  — the shape differs, the liveness requirement does not.
- **`.gitattributes` goes wildcard-first** (§ 11): `* text=auto eol=lf` leads, so no file type is
  left to `core.autocrlf`; a narrow first glob leaves a hole the next time someone adds an
  extension.
- **Correct your own record before the other side plans against it** (§§ 7, 10): both corrections
  went out before the reader acted, including one that only fixed a version number.
- **A report can carry its own "do not conflate this" clause, and it earns its place** (§ 12). wasmtk
  named the case that LOOKS like their bug and is not — `(memory 0x1_0000_0000)`, 2^32, in range for
  a u64 limit — because treating it as malformed would have re-broken the wasmrt team's correction to
  `proposals/threads/memory.wast`. We turned that paragraph into a test and a mutant, so the
  distinction is now enforced rather than remembered.
- **Two verdicts, not one** (§ 12): their four `try` rows mixed malformed (parse) with invalid
  (validation). Upstream wabt parses `catch` after `catch_all` and the engine rejects it, so only
  three were parser bugs. Asking each oracle per row is what separated them.
