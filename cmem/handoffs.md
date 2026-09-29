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
| 4  | 2026-08-27 | wasmtk      | their `ref_null.wast` read was right; nine bridge gaps (`br_on_*`, `call_ref`, the convert pair, array bulk ops) are OURS                                                                            | ✅ the conformance ranking agreed                                                                                                                                  |
| 5  | 2026-08-27 | wasmtk      | `exact-casts.wast` is parser-gated (`(exact $T)`), not `br_on_cast`-gated — don't count it                                                                                                           | ✅ ranking unchanged                                                                                                                                               |
| 6  | 2026-08-27 | wasmtk      | effort side: exact types are a type-system change across both trees, not a grammar addition                                                                                                          | ✅ exact types stay last ([open-work.md](open-work.md))                                                                                                            |
| 7  | 2026-08-27 | wasmtk      | correction: `br_on_cast` was THREE defects in two trees, not one bridge case                                                                                                                         | ✅ all four `br_on_*` shipped in 1.5.3 (`7ff0408f4`)                                                                                                               |
| 8  | 2026-08-27 | wasmtk      | retraction: "deps need proper names" described our own broken printout, not their manifest                                                                                                           | ✅ closed                                                                                                                                                          |
| 9  | 2026-08-31 | wasmtk      | defect 5's precondition is a conjunction (a struct or array exists AND no function shares the tag's signature) — wider than reported; they had no `.gitattributes`                                   | ✅ closed by them: `binaryen` alias renamed `binaryen-backend`, `.gitattributes` widened, defect 5 closed with a conditional                                       |
| 10 | 2026-08-31 | wasmtk      | correction: they are on 1.5.3, not 1.5.2; the convert pair priced by building it (two layers)                                                                                                        | ⬚ **one question awaiting their answer** — is `br_on_cast` still failing for them on 1.5.3? ([open-work.md](open-work.md)); convert pair since built (`9d5c886be`) |
| 11 | 2026-08-31 | wasmtk      | adopting their conditional-not-clearance form and their import-alias invariant; a fifth property-in-view instance                                                                                    | ⬚ outbound                                                                                                                                                         |
| 12 | 2026-09-19 | wasmtk (in) | two parser-leniency reports against 1.5.3, found by hardening their `.wast` runner (one catch around "assemble the module" had let an ENCODER error satisfy an `assert_malformed`): limits took no range check; a legacy `try`'s clause structure was unchecked. Their write-up: `wasmtk/scripts/binaryang-report.md` | ✅ both reproduced on `main` and fixed (`d59816990`), with their correction about `(memory 0x1_0000_0000)` PINNED as a test. Outbound: a `catch` after `catch_all` is INVALID, not malformed (wabt parses it) — three of their rows are parse bugs, the fourth is our validator's gap, still open |
| 13 | 2026-09-28 | wasmtk (out — NOT SENT, by decision) | binaryang `main` (unreleased) fixes defects that change what an OPTIMIZED module does, several in the 1.5.4 you ship against: a `local.set` before a branch to an `if` label became a `drop` at -O2+ (CoalesceLocals, SILENT — valid output, wrong result; checked against the v1.5.4 source); dead code after `br` could trap; a `call_indirect` across rec groups lost its trap; `Inlining` at -O3 emitted invalid modules for multi-value call operands; modules with several tables or `elem.drop` could not be written back or optimized. Suggest: anything built with `-O2` or higher on 1.5.4 whose source branches to a labelled `if` is suspect; the fix arrives with the next release (its timing is the owner's call). Record: [divergences.md](divergences.md) Q1–Q8 | 🚫 **Not needed (owner, 2026-09-28):** "We are going to fix the -O2 issue before we update to it in wasmtk — no letter needed." The fix is on `main`; wasmtk moves only to a release that carries it. Kept as the record of what it would have said |
| 14 | 2026-09-28 | wasmtk (in) | their letter against published 1.6.0: five items (heap type in an inline `call_indirect` typeuse; export `allFeatures`; compat `validate()` stub; annotation leniency; custom-descriptors + `(pagesize N) (data)`). All reproduced; record in [open-work.md](open-work.md) |
| 15 | 2026-09-28 | wasmtk (out — ⬚ DRAFT, below, for the owner to send) | their items addressed, and which release holds the fixes |

### § 15 — draft reply to wasmtk (2026-09-28)

> From binaryang, 2026-09-28, in reply to your letter of the same day (measured against 1.6.0).
>
> Thank you — every item reproduced on our tree before we acted, as you asked.
>
> **Items 1–5 are fixed, both halves of 5. The fixes ship in 1.7.0** (not yet published; its
> changelog will list them by your numbers). It is a minor because it also removes the `./interop`
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
