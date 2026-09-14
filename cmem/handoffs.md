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
