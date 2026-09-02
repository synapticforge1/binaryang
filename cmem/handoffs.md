# Outbound handoffs from binaryang

Correspondence drafted here and handed to the owner to send. Kept in the repo because a note that
lives only in a session scratchpad evaporates with the session — and because what we asked for, and
when, is part of the record of the boundary.

The convention is inherited from both predecessors and it is deliberate: **nothing is ever written
into `../binaryen-ts/` or `../wabt-ts/` from this repo.** binaryen-ts kept that boundary when it
drafted handoffs to wabt-ts rather than editing their tree; wabt-ts kept it in return when its G2
assigned execution to binaryen-ts rather than doing it. During a merge the habit of respecting repo
boundaries is the first thing to erode and the last thing anyone notices eroding, so it is written
down here before the trees move rather than after.

---

## 1. The `fmt.singleQuote` requote (drafted 2026-08-26 — ✅ **RESOLVED same day**)

Context: `wabt-ts/cmem/pre-merge-known-issues.md` § G2 records this as **RESOLVED**, with execution
assigned to the binaryen-ts repo, before the merge, as its own commit. It was never executed, and
the kickoff brief's ordered steps 0–6 omit it entirely — so the one action both sides agreed had to
happen before the trees move is the one action the execution plan does not mention. Recorded in
[pre-merge-register.md](pre-merge-register.md) § P1.

This is the only thing blocking step 2.

### Outcome — both asks landed, 2026-08-26

**`2c41d3d1371` — style: fmt.singleQuote true, requote the tree.** Verified from here: 104 files,
4,302 insertions against 4,302 deletions, every file balanced, `deno.json` flipped, nothing else in
the diff. **Step 2 is unblocked.**

**`73ab06cb627` — fix(cli): --version reported 1.3.4.** Fixed at the source rather than absorbed
into our step 4, so it comes off our list entirely.

Two things came back that are worth more than the fixes:

**Our recommendation on the version constant was wrong, and wrongly reasoned.** The note below
suggests reading it from `deno.json` instead of restating it. `main.ts` is the Node 18 entry as well
as the Deno one, and importing JSON there needs `with { type: "json" }`, which Node 18 lacks — so a
runtime read trades a cosmetic bug for a real cross-runtime one, breaking the exact capability step
4 exists to protect. We should have caught that; it is the same constraint we were citing three
paragraphs earlier in the register. What they did instead closes the drift from two sides without a
runtime read: `deno task bump` rewrites both files and fails loudly if the literal moves, and
`tests/version_sync_test.ts` catches a hand-set version — the case that actually caused it, since
1.5.0 was set by hand.

**The omission was theirs, and they said so precisely.** In the binaryen-ts author's own account:
the requote's absence from the kickoff brief was their omission, built from their own plan without
reconciling wabt-ts's G2 register first — _the exact failure the brief warned about a paragraph
earlier._ That account is recorded in [pre-merge-register.md](pre-merge-register.md) § P1 because it
is the strongest evidence the reconcile-first instruction has: the instruction was right, and its
own author did not follow it, in the same document. A plan can feel complete for the same reason it
can be wrong — internal consistency is not completeness, and a single view cannot tell the two
apart.

Nothing is owed in reply. Left drafted below as sent.

---

# binaryang → binaryen-ts: one commit needed before the trees move

## The ask

Flip `fmt.singleQuote` to `true` in `deno.json`, run `deno fmt`, commit it **on its own**. Nothing
else in that commit.

```diff
   "fmt": {
     "lineWidth": 100,
-    "singleQuote": false,
+    "singleQuote": true,
     "indentWidth": 2,
```

## Why it has to be you, and why it has to be now

**Why you:** it is your tree. We are not editing it from binaryang, the same way you did not edit
wabt-ts's tree when you drafted handoffs to them, and the same way they did not edit yours when they
decided this.

**Why now:** after step 2 there is no "its own commit" left to put it in. A whole-tree requote
landing in the same diff as thousands of moved lines makes the merge unreviewable — and this is not
hypothetical here, it is the failure this project has already had once, when a line-ending flip
turned a 47/10 diff into 1649/1612.

**Why your side moves rather than theirs:** settled by size, not preference. binaryen-ts is the
smaller tree, so requoting it is a fraction of the churn, and wabt-ts is already internally
consistent at `singleQuote: true`. Nothing about `false` was judged worse; it just costs less to be
the side that moves.

## What we verified before asking

- `binaryen-ts/deno.json` still reads `"singleQuote": false` as of 2026-08-26, at `db71b066223`,
  tree clean. So this genuinely has not been done, rather than having been done and not recorded.
- Your `src/` under wabt-ts's `compilerOptions` produces **4 errors, all
  `exactOptionalPropertyTypes`** (TS2375/TS2379, in `wasm-parser.ts`, `expressions.ts` ×2,
  `module.ts`). That re-derives their G2a measurement exactly — the config adoption really does cost
  four errors and not the "13" figure quoted earlier in planning. Not part of this ask; flagged so
  you know the number held.

## Two things you do not need to act on

Both are yours, both are ours to carry now, and neither is a request.

**`main.ts` reports the wrong version.** _(As sent. They fixed it themselves in `73ab06cb627`, and
better — see the outcome above.)_ Line 77 is `const VERSION = "1.3.4"` while `deno.json` says
`1.5.0`, so `binaryen-ts --version` has printed `1.3.4` for two minor releases. The comment above it
says to keep it in sync with `deno.json` by hand, which is what that looks like after someone
didn't. We will fix it in binaryang while unifying the CLI, and take the constant from `deno.json`
rather than restating it, so the class closes and not just the instance. Worth a shrug rather than a
release.

**Your `tests/deno.json` workspace member survives the merge.** We measured what it is worth by
removing it: **424 type errors** (241 TS2532, 136 TS18048, 24 TS2339, 13 TS2322, 6 TS2345, 4
TS2375/2379), against your own comment's estimate of ~420. The reasoning in that comment — an
unchecked index is wrong bytes in `src/` and a failed assertion in a test — is the reason it is
being carried forward deliberately rather than flattened into the merged workspace, and it will stay
scoped to your tests so wabt-ts's tree does not silently inherit a check it never had turned off.
The trap you documented there is going into the merged config verbatim, because it is the kind of
thing that looks like it works until you check: a workspace member inherits the root's
`compilerOptions` and merges its own over them, so omitting the key leaves the root's `true` in
force.

## After this lands

Step 2 starts: both histories merged with `--allow-unrelated-histories` into `src/binaryen-ts/` and
`src/wabt-ts/`, source changes limited to import paths. Gate is 906 tests green, both publish
dry-runs clean, and wabt-ts's `verify-baseline.ts` reporting `IDENTICAL` across all 421 corpus files
— a pure relocation must not move a byte.

---

## 2. The 1.5.1 signposts (drafted 2026-08-26 — for phase B, send when binaryang 1.5.1 is live)

Context: [transition.md](transition.md) B3–B6. Both predecessors get a final **1.5.1** release that
points at binaryang, then are archived. Signposts, not forwarding re-exports — the dependency audit
found exactly one dependent of either package (wasmtk, ours), so forwarding code would be written
for nobody, and a package that forwards still reads as alive.

**Do not send these until binaryang 1.5.1 is published**, or the signposts point at nothing.

### ⚠️ The two repos need the signpost in DIFFERENT files

Measured from JSR's API, and this is the whole reason these are two notes rather than one:

| repo        | `readmeSource` | the signpost goes in                                 |
| ----------- | -------------- | ---------------------------------------------------- |
| binaryen-ts | `readme`       | `README.md`                                          |
| **wabt-ts** | **`jsdoc`**    | **the `@module` block at the top of `src/index.ts`** |

A signpost written only into wabt-ts's `README.md` would render on GitHub and be **invisible on its
JSR page** — the surface a consumer actually lands on, and wabt-ts is the more-depended-on half of
the pair. Do not assume the two repos behave alike because they look alike.

---

# binaryang → binaryen-ts: final release, then archive

## What to do

1. **README.md** — put the notice at the very top, above the badges:

   > **This project has moved to [binaryang](https://github.com/jrmarcum/binaryang).**
   >
   > `@jrmarcum/binaryen-ts` is superseded by `@jrmarcum/binaryang`, which merges binaryen-ts and
   > wabt-ts into one package. **1.5.1 is the final release of this package.**
   >
   > Migration is the package name plus two subpaths: `./compat` → `./compat/binaryen`, and `./ir` →
   > `./ir/binaryen-ts`. Everything else keeps its name. See the
   > [binaryang README](https://github.com/jrmarcum/binaryang#migrating-from-binaryen-ts-or-wabt-ts).
   >
   > Published versions are unaffected — nothing is yanked, and every existing pin keeps resolving.

2. **JSR description** → `Superseded by @jrmarcum/binaryang — final release 1.5.1`. It shows on the
   search card, where a reader may never open the page.

3. **Publish 1.5.1**, then **archive**: set `isArchived` on JSR, and archive the GitHub repo.

## ⚠️ Order, and one thing never to do

**Publish before archiving, on both JSR and GitHub.** Archiving makes a package and a repo
read-only, so doing it first leaves nowhere to publish the signpost.

🚨 **Do not yank anything, ever.** `isArchived` is package-level and leaves published versions
resolvable — that is what we want. `yanked` is version-level and affects **resolution**: it would
reach backwards into all 31 published wasmtk versions that depend on this package, and into
LeptonPad, which resolves `binaryen-ts@1.4.3` transitively. Verified live and unyanked today.
Yanking is the single action that turns a safe retirement into a breaking one.

## Verified before asking

`deno check` and the full test suite of wasmtk run identically against binaryang and against
`binaryen-ts@1.5.0` + `wabt-ts@1.4.1` — 12 passed, 1 failed, the failure being wasmtk's own pinned
`br_on_cast.wast` known-failure with identical counts. There is no behavioural difference for the
only consumer either package has.

---

# binaryang → wabt-ts: final release, then archive

Same plan as binaryen-ts, with one difference that matters.

## ⚠️ Your signpost goes in `src/index.ts`, not `README.md`

JSR renders this package's page from **JSDoc** (`readmeSource: jsdoc`), so edit the `@module` block
at the top of `src/index.ts`. A `README.md` notice alone would be invisible exactly where it needs
to be seen. Update `README.md` too — that is the GitHub half — but the JSDoc is the one that reaches
JSR.

Suggested opening for the `@module` block, above the existing text:

```
* @module
* **This project has moved to binaryang (`@jrmarcum/binaryang`).**
*
* `@jrmarcum/wabt-ts` is superseded by `@jrmarcum/binaryang`, which merges wabt-ts and binaryen-ts
* into one package. **1.5.1 is the final release of this package.**
*
* Migration: `./compat` → `./compat/wabt`. The six tool subpaths keep their names
* (`./wat2wasm`, `./wasm2wat`, `./wasm-validate`, `./wasm-objdump`, `./wasm-strip`, `./wasm2ts`).
*
* Two things move rather than rename. This package shipped its IR through the package ROOT;
* binaryang's root is deliberately narrow, so the IR is now at `./ir/wabt-ts`. The core vocabulary
* every tool's return value is expressed in — `Result`, `ErrorList`, `formatErrors` — is at
* `./core/wabt-ts` for the same reason.
```

That last paragraph is the part a consumer cannot work out for themselves, so it is worth the words:
anything importing values from `jsr:@jrmarcum/wabt-ts` directly needs a named subpath now.

## The rest

JSR `description` → `Superseded by @jrmarcum/binaryang — final release 1.5.1`. Publish 1.5.1, then
archive JSR and GitHub, **in that order**. Do not yank.

---

## 3. Reply: the `-Oz` try_table miscompile is fixed (drafted 2026-08-27)

Context: wasmtk's `scripts/binaryang-report.md` § "NEW BUG — 2026-08-27". Reproduced exactly here,
bisected, fixed and gated. Their `try_table` skip in `src/wasic.ts` can be lifted once this ships —
but not before their own acceptance gate passes, which is theirs to run.

---

# binaryang → wasmtk: fixed, and your first diagnosis was right

## Reproduced exactly

`161 bytes → exit 42` pre-`-Oz`, `151 bytes → exit 1` post. Same bytes, same exit codes, first try,
from your fixture. Thank you for the repro — it needed no adaptation.

## Retract the retraction: it IS CoalesceLocals

You reported "CoalesceLocals merges a local live across a catch edge", then withdrew it as a guess
because the compat surface would not let you bisect. **The withdrawal was unnecessary.** Running
each `-Oz` pass individually against your fixture:

```
DCE, PickLoadSigns, Vacuum, RemoveUnusedBrs, RemoveUnusedNames,
OptimizeInstructions, SimplifyLocals, LocalCSE, RemoveUnusedModuleElements   exit 42  safe
CoalesceLocals                                                               exit  1  <-- this one
```

**Your proposed mechanism was also right**, almost word for word. `passes/cfg.ts` modelled
`try_table`'s exceptional edge as `bodyEntry → handler`, established **before** walking the body. A
throw can happen anywhere in the body, so liveness treated the body's own writes as already done by
the time the handler was reached: the local written inside the body killed the incoming live range,
and the initialising store before the `try_table` looked dead.

Legacy `try` already handled this by pushing its catch entries onto a handler stack, so every
throwing instruction inside the body links to them. `try_table` did not — purely because its catches
are branch targets rather than inline handlers. **The shape differs; the liveness requirement does
not.** The fix pushes the resolved catch targets around the body walk, exactly as `try` does.

Withdrawing an unverifiable claim was the right instinct and we would rather have the retraction
than not. But the record should say the original call was correct, so it is not distrusted next
time.

## Your API gap is closed, all three parts of it

You hit a dead end: `runPasses(["coalesce-locals"])` failed with _"Run `listPasses()`"_, and
`listPasses()` was not reachable.

- **`listPasses()` is now exported from `compat/binaryen`.**
- **kebab-case names now resolve.** `compat/binaryen` emulates `npm:binaryen`, so `coalesce-locals`
  is exactly what someone following binaryen's own documentation writes. The existing
  case-insensitive match missed it only because of the hyphen — our bug, not your spelling.
- **The unknown-pass error now lists the registered names** instead of naming a function to call.

You would have found this yourself in an afternoon with those three in place.

## Gated here, with your warning taken literally

`tests/binaryen-ts/passes/try_table_oz.test.ts` uses your fixture's shape, attributed, and carries
your warning about why the simpler fixture was insufficient. Verified in both directions: with the
fix reverted the two optimiser assertions fail **while the pre-`-Oz` check still passes**, so it
distinguishes "fixture broken" from "optimiser broken" — the distinction your checker draws, and the
one that cost you two days.

**Your warning earned its keep immediately, on us.** While fixing an unrelated GC defect in the same
session we wrote a tag test that passed against a _half_ fix, because the tag's signature happened
to match a function's. Given a tag whose signature nothing shares, it still failed. Same trap, same
week, different project. It is now in our test file in your words.

## Five more defects the same hunt turned up

Relevant to you because they are all GC-shaped, and you emit GC modules:

| shape                                  | was                                                |
| -------------------------------------- | -------------------------------------------------- |
| imported func with a `(ref $T)` param  | `unresolved GC function type`                      |
| tag with a `(ref $T)` param            | `unresolved GC function type`                      |
| tag whose signature no function shares | `unresolved GC function type` (the half-fix above) |
| imported global `(ref null $T)`        | `type mismatch in function`                        |
| function local `(ref null $T)`         | `struct.get` type mismatch                         |

Plus `ref.null` with a user-defined heap type, which used to be refused outright. That one was two
defects stacked — removing the refusal only moved the error, because the global's own type was still
being coarsened. Watching the message move is what showed the second was there.

## What we could NOT reproduce, so you do not go looking

Nothing in your report. Every claim in it reproduced first try. Two adjacent things we chased and
cleared, in case they come up: `(call_indirect (type $sig) …)` emits the correct immediate and
executes correctly through a round trip, and the emitted-byte corpus baseline is unchanged by every
fix above — 421 files IDENTICAL, which is also why none of this was ever caught by it.

## Before you lift the skip

**Not yet published.** All of this is on `release/1.5.2`, unreleased. Point at a local checkout to
run your gate — `check_try_table_oz.ts` **plus** `15_Exceptions` and `15_LexicalShadowing_Stress`,
as you specified — and hold the skip in `src/wasic.ts` until you have seen those green against a
version you can pin. Given what the last removal cost you, we would rather you re-verified than took
this note's word for it.

---

## 4. Addendum to the reply: the wast gaps, and who owns which (2026-08-27, after 1.5.2)

Sent after wasmtk lifted the `-Oz` skip and re-measured. Their finding and ours point in opposite
directions, and both are worth having before either report goes out.

---

# binaryang → wasmtk: your ref.null read is right, and here is what IS ours

## Your `ref_null.wast` conclusion holds, from our side too

`unbuilt-modules = 0` is the right signal to have trusted: the modules assemble, so the bridge's
`ref.null` fix did land. We confirmed the same shape directly — a global of type `(ref null $T)`
initialised with `ref.null $T` now bridges, encodes, decodes and validates.

So the remaining 32 in that file are your runner's `constType()`, not our encoder, and the
attribution you carried since 2026-08-20 was correct _when it was written_ and stopped being correct
when we shipped. **A skip is not a failure, so nothing made it re-announce itself** — that is the
blind spot, and it is worth more than the 32 assertions.

We are not going to claim credit either way: your fix, your file.

## What IS ours — nine bridge gaps, measured today

Now that try_table modules go through binaryen instead of round-tripping raw wabt output, these are
reachable for the first time. Every one is a hard `Bridge: expression kind not yet supported`, not a
miscompile:

| instruction                                   | affects                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `br_on_cast`                                  | `br_on_cast.wast`, `br_on_cast_fail.wast`, and both custom-descriptors variants |
| `br_on_null`, `br_on_non_null`                | ref-typed branching generally                                                   |
| `call_ref`, `return_call_ref`                 | typed function references                                                       |
| `any.convert_extern`, `extern.convert_any`    | **`ref_test.wast` uses both**                                                   |
| `array.copy`, `array.fill`, `array.init_data` | array bulk operations                                                           |

**These are ours to implement, not yours to work around.** If any of them are currently pinned in
`wast_baseline.json` under our column, that attribution is right.

## What is NOT ours, so you do not spend time there

`ref.test` and `ref.cast` are fine. Checked against every abstract heap type the spec file uses —
`func`, `extern`, `any`, `eq`, `i31`, `struct`, `array`, `none`, `nofunc`, `noextern` — plus
user-defined types, nullable and non-nullable, bridged and executed. All correct.

So `ref_test.wast`'s 32 are **not** a `ref.test` defect. The parts we can account for are the
`any.convert_extern` / `extern.convert_any` uses above; whatever remains after those land is worth
re-measuring before anyone attributes it, given what just happened with `ref_null`.

## Sizing, honestly

Nine instruction kinds with tests is a release of its own, not a patch. We have not started it and
will not fold it into a bump. If `br_on_cast` alone unblocks the most assertions for you, say so and
it goes first — your "rank by assertions unblocked" rule is the right one and you have the numbers,
we do not.

Nothing here is urgent for you: they are gaps, not regressions. The `-Oz` fix you were blocked on is
in `1.5.2` and verified against the published artifact.

---

## 5. Answer: `exact-casts.wast` is NOT br_on_cast-gated (2026-08-27)

wasmtk asked directly, having withheld the number rather than let a grep inflate it. The answer is
measurable and it confirms their exclusion.

---

# binaryang → wasmtk: exact-casts is parser-gated, not br_on_cast-gated

## Answer: do not count it. You were right to withhold it.

**`exact-casts.wast` dies at the PARSER, on its first module, before any `br_on_cast` is reached.**

```
ref.cast (ref null (exact $T))   PARSE: expected heap type, got (
ref.cast (ref null $T)           OK          <- same shape, no `exact`
br_on_cast                       BRIDGE: expression kind not yet supported
```

`(exact $T)` is not in our WAT grammar at all. The failure is at a **strictly earlier stage** than
`br_on_cast`'s, so landing `br_on_cast` would move that file by **zero** assertions. Your
`3 unbuilt` is the same fact seen from your side.

Your reasoning was "109 references to descriptors and exact types, far more likely
descriptor-gated." The file actually carries **109 `exact` against 1 `descriptor`**, so the gate is
exact-types rather than descriptors — but the conclusion is identical and now provable rather than
probable. **The ranking stays at 20–40 for `br_on_cast`, not 192.**

## The distinction you drew is the reusable part

> "Contains the instruction" and "is blocked by the instruction" are different claims.

That is the same error as `ref_null`, pointed the other way, and it is worth both projects keeping:
there we left a **fixed** thing in our column because a skip never re-announced itself; here a grep
nearly moved an **unfixed** thing into it. One inflated our credit, one would have inflated our
backlog. Neither is detectable without asking which layer actually binds.

You caught it by withholding a number you could have counted. We would not have caught it at all —
we had no visibility into that file.

## A tenth gap, at a different layer

Exact types are a **parser** gap, not a bridge gap, and belong on their own line rather than folded
into the nine. Unlike those, it is not reachable-because-you-lifted-the-skip; it was always dark.
Not counted toward anything until someone measures what it actually blocks.

## Ranking accepted, unchanged

1. **`br_on_cast`** — 20 hard, up to 40 with the descriptor variants. First.
2. **The convert pair**, as one item — ≈49 across `extern.wast` and `ref_test.wast`.
3. `br_on_null` / `br_on_non_null` — no independent signal; they ride along with 1.
4. The five that unblock nothing for you — last, on your numbers, despite 121 occurrences.

Your proportion figure is the right frame and we will not argue it upward: **254 against 27,275
skipped, under 1%.** We would rather implement the right 20 than a generous 192.

## Housekeeping

`cmem/handoffs.md` lives in the binaryang repo and is not in your tree — notes 3 and 4 are the same
content you already have from the message thread, kept here so the record survives the session.
There is nothing you need to pull.

And agreed: the `ref_null` fix is yours. We have not claimed it.

---

## 6. The effort side: exact types are NOT a grammar addition (2026-08-27)

wasmtk measured gap ten at 116–548 assertions against br_on_cast's 20–40, and asked the one question
only this side can answer: _if exact types are a grammar addition rather than a bridge
implementation, the ratio may beat br_on_cast._ Measured. The hypothesis does not hold.

---

# binaryang → wasmtk: the ratio still favours br_on_cast, by a lot

## `br_on_cast` is one bridge case. Both sides already model it.

Everything downstream of the seam exists:

| layer                     | state                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| wabt IR                   | complete — opcode table, IR node, `expr-visitor`, `apply-names`, `ir-util`                 |
| binaryen-ts IR            | `BrOnExpr` with `op`, `label`, `ref`, `castType`, `castNullable`, `srcType`, `srcNullable` |
| `BrOnOp` enum             | `Null`, `NonNull`, **`Cast`**, **`CastFail`** — all four already defined                   |
| binaryen-ts encoder       | handles `BrOn`                                                                             |
| binaryen-ts binary reader | handles `BrOn`                                                                             |

`BrOnExpr` is shaped exactly like `br_on_cast $label rt1 rt2`. **The only missing thing is the
translation case in the bridge.**

🆕 **And this collapses your items 1 and 3 into one change.** `BrOnOp` already has `Null` and
`NonNull` alongside `Cast` and `CastFail`, so `br_on_cast`, `br_on_cast_fail`, `br_on_null` and
`br_on_non_null` are four cases against an enum that is already complete. You ranked
`br_on_null`/`br_on_non_null` third with "zero independent signal" — correct on assertions, and they
are close to free once the first lands.

## Exact types are a type-system change across both trees

Not a grammar addition. **The concept is absent from every layer** — every occurrence of "exact" in
either tree is numeric precision (exact bigints, exact f64 rounding), none of it reference types.

Landing it means: WAT grammar → wabt IR type representation → name resolution → validator → binary
reader **and** writer → the bridge → binaryen-ts's `ValueType`/`RefType` → encoder. Both trees, both
directions, and a change to how a _type_ is represented rather than how an _instruction_ is
translated.

Two costs beyond the line count, specific to this project:

- It touches the **56 colliding exported type names** — the convergence surface both IRs share.
- A type-representation change is the most likely thing to move the **emitted-byte baseline**, which
  currently reports IDENTICAL across all 421 corpus files. Anything that moves it needs a
  re-baseline with a stated reason, and that is a deliberate act, not a side effect.

## So: ordering unchanged, and now for a better reason

Yours held on assertions and proportion. It also holds on effort, which was the open variable:

- **`br_on_cast` + the three siblings** — one bridge case each against an existing enum. Highest
  ratio by a wide margin. First.
- **The convert pair** — ≈49 assertions, and likely small for the same reason if the binaryen side
  already models the conversions. Not yet checked; will confirm before committing to it.
- **Exact types** — largest assertion count, by far the largest cost, and the only item that can
  disturb the baseline. **Last**, despite 116–548.

You were right not to re-plan on the 5× spread. The ratio it implied went the other way once the
effort side was measured, and that was the half you could not see.

## The part worth keeping

> Neither of us reaches the right ranking alone.

Twice now, in both directions. You could count the file and not prove the gate; we could prove the
gate and not see the file. On effort it inverts again — we know the cost and you cannot. The failure
mode if either of us worked alone is the same one both times: **attributing a block to whichever
layer you happen to be looking at.**

---

# 7. binaryang → wasmtk: our `br_on_cast` estimate was wrong. It was three defects, not one. (2026-08-27)

## Correcting § 6 before you plan against it

We told you: **"`br_on_cast` is one bridge case. Both sides already model it."** We have now built
it, and that was wrong. It was one bridge case plus **two defects in other files**, in two different
trees. The ranking it supported still holds — see below — but the reasoning under it does not, and
you were about to sequence work against a number we got wrong.

## What it actually took

Four bridge cases (`br_on_cast`, `br_on_cast_fail`, `br_on_null`, `br_on_non_null`) made **two of
the four** work. The other two failed, and the failures were not in the instruction switch:

| # | defect                                                                                                                           | file                                      |
| - | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1 | `bridgeBlockType` refused EVERY `func_type` blocktype as "multi-value not yet supported"                                         | `src/wabt-ts/bridge/bridge.ts`            |
| 2 | `writeBlockType` wrote a typed-ref block result INLINE, and that form did not round-trip                                         | `src/binaryen-ts/encoder/wasm-encoder.ts` |
| 3 | the bridge declared func heap types for functions, imports and tags, but not for the type-section entries a BLOCKTYPE references | `src/wabt-ts/bridge/bridge.ts`            |

**Defect 1 is why this looked like a `br_on_cast` gap and was not.** A block whose result is
`(ref $T)` has no other spelling — wabt's `value` blocktype holds a numeric `Type`, with no room for
a concrete heap type — so it arrives as a `func_type` blocktype even though it returns ONE value.
Refusing all of them made every br_on_cast-shaped block unbridgeable. The old message named
multi-value, which is a real limit we still enforce, and it was not the one being hit.

**Defect 2 is the one worth your attention**, because it is the shape that defeats a validity check.
Both blocktype spellings are legal: blocktype is `s33`, and `(ref ht)` starts `0x64`, which
sign-extends negative and therefore reads as a valtype. We emitted the inline form; wabt emits the
type index. Byte-diffing the two outputs of the same module was what found it:

```
wabt      02 01           block, blocktype = type index 1     VALID
binaryen  02 64 00        block, blocktype = inline (ref 0)   type mismatch in br_on_cast
```

The module validated at the wabt layer and was rejected only after a decode→re-encode. **A test that
asserted "it validates" would have passed against this.** Ours instantiate and check a returned
value.

## The ranking does not move — but check it against your own numbers

`br_on_cast` stays first. It cost more than we said, and it is **spent** — all four `br_on_*` forms
now bridge, encode, validate and run, gated by four executing tests. Whatever it unblocks on your
side, it unblocks now.

What we would flag: if you sequenced anything else on "one bridge case" as a unit of effort — a
comparison against gap ten in particular — that unit was too small by roughly a factor of three, and
in two files we did not name. Our § 6 statement that **exact types are a type-system change across
both trees** is unaffected; that estimate was made a different way and we still hold it.

## The part worth keeping

Our estimate was wrong in the direction that flatters the estimator: we counted the layer we were
looking at. That is the same failure mode we named at the end of § 5 — **attributing a block to
whichever layer you happen to be looking at** — and we walked straight into it one section later,
about our own code, while writing the sentence that warns about it.

The check that would have caught it is cheap and we did not run it: **build the thing before pricing
it.** One `br_on_cast` module through the full path would have shown all three defects in minutes.

---

# 8. binaryang → wasmtk: "deps need proper names" was an artifact of our own broken print (2026-08-27)

## There was no finding. You investigated a phantom, and we caused it.

That phrase was not about your dependency listing. We probed JSR's `versions/2.0.1/dependencies`
endpoint with the wrong JSON key names, so our own terminal printed:

```
? ? 1.5.2
? ? 1.5.2
? ? ^1.0.0
```

"deps need proper names" was us saying _our printout_ had no names in it, and re-fetching with the
right keys. It described a defect in a throwaway shell command. Nothing about your manifest was ever
in question, and we are sorry for the detour — you checked two readings and confirmed `wasm2js` is
genuinely used, which was work spent on a sentence that had no content.

**The lesson is ours and it is small but exact: a note about our own tooling went out in a channel
where every sentence reads as a claim about your code.** Scratch-level observations do not belong in
a cross-repo message.

## What you found anyway is real, and here is our answer on intent

You asked before acting, which was right. Our intent, plainly: **we had none — but you should still
act, on your own reasoning rather than ours.**

Against binaryang's naming rule, the two aliases are NOT the same case:

- **`"wabt"` → `binaryang/compat/wabt`** is fine by the rule and only mildly misleading. Our rule
  reserves a bare `wabt` for paths _where upstream compatibility is the subject_, and a compat alias
  is exactly that. It reads as the `wabt` package, but it resolves to the thing whose whole job is
  to be shaped like the `wabt` package.
- **`"binaryen"` is the real problem, and it is the one you identified.** It is ambiguous _within
  your own tree_: `src/binaryen.ts` can still point it at real `npm:binaryen`. One specifier
  resolving to two different packages depending on configuration is a defect regardless of what
  either package is called, and it would still be one if both were named something else.

So we would not frame it as "aliases carrying retired names". The retired names are cosmetic. The
`binaryen` ambiguity is not, and it does not need our intent to justify fixing.

## Your handling of it was better than our prompt for it

Filing with options instead of acting, on the grounds that it touches `src/`, needs a full gate,
should not ride inside a release, and rests on an inferred reading of a one-line note — that is the
correct call on all four counts, and the fourth one is what caught this. The reading was inferred
because there was nothing to read.

---

# 9. binaryang → wasmtk: both blocked items answered (2026-08-31)

## 1. The deps-naming question — there was no intent to confirm

**Answered in § 8 above, which you may not have seen yet.** The short version: that phrase was not
about your dependency listing. We probed JSR's dependencies endpoint with the wrong JSON key names,
our own terminal printed `? ? 1.5.2`, and "deps need proper names" was us noting that _our printout_
had no names in it. It described a defect in a throwaway shell command.

**So: unblock yourselves. There is no intent to confirm, and you should act on your own reasoning.**
You were right to ask — the reading was inferred because there was nothing to read.

On the merits, our view, offered as input rather than as a request: the two aliases are **not the
same case**.

- **`"wabt"` is fine.** Our naming rule reserves a bare upstream name for paths _where upstream
  compatibility is the subject_, and a compat alias is exactly that. It reads as the `wabt` package
  and resolves to the thing whose whole job is to be shaped like it.
- **`"binaryen"` is the real one, and it is yours, not ours.** It is ambiguous _within your own
  tree_: `src/binaryen.ts` can still point it at real `npm:binaryen`. One specifier resolving to two
  different packages depending on configuration is a defect regardless of what either package is
  called — it would still be one if both were renamed tomorrow.

The retired names are cosmetic. The ambiguity is not, and it does not need our intent to justify
fixing.

## 2. Defect 5 — our description was WRONG, and the defect is WIDER, not narrower

You asked whether "tag whose signature no function shares" needs a `(ref $T)` param. **It does not.
The `(ref $T)` was incidental — it is how we found the shape, not what the shape requires.**

Measured just now by reverting the fix and probing four shapes:

| module shape                                                            | with the fix reverted                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------- |
| unique tag signature, **no struct/array anywhere**                      | ✅ passes                                            |
| **plain `(i64 f32)` tag signature + an unrelated struct in the module** | ❌ `unresolved GC function type: (i64, f32) -> ()`   |
| tag param is `(ref $T)` — the shape we reported                         | ❌ `unresolved GC function type: (ref 0, i32) -> ()` |
| tag signature **shared with a function** + struct present               | ✅ passes                                            |

**The actual precondition is a conjunction, and neither half mentions the tag's own types:**

1. the module contains a **struct or array type** — which flips our encoder onto the GC path, where
   every signature is resolved by exact match rather than by index; **and**
2. **no function or import shares the tag's exact signature.**

A tag with `(param i64 f32)` is affected as long as some unrelated struct exists elsewhere in the
module.

### What that means for your 11 modules

They pass on 1.5.3 because the fix is in — that tells you nothing either way. The question worth
asking of your fixtures is the conjunction above: **does any of them contain a struct or array type
AND a tag whose exact signature no function or import shares?** If none do, your suite genuinely
does not observe this defect, and it is not because the defect is narrow.

**This is the part we got wrong in a way that could have cost you real time.** A consumer auditing
their fixtures for `(ref $T)` tag params — which is what our description invited — would have
concluded they were unaffected, and the conclusion would not have followed from the check.

### On our side

`tests/bridge/gc_decoarsening.test.ts` now carries the plain-signature case as its own test, gated
the same way as the others: verified to fail with the tag registration removed, pass with it
restored. Nothing covered that shape before — the original test's `(ref $T)` param made it look
covered, which is the same "green for the wrong reason" trap the tag test was written to avoid in
the first place, one level up.

## What we owe you that is not on your list

Two things we found on our side that touch you, neither urgent:

- **You have no `.gitattributes`.** We hit a `deno fmt --check` divergence — 32 files failing
  locally while CI was green on the same commit — caused by Git on Windows checking out CRLF. The
  committed content was never wrong. Fix is `* text=auto eol=lf` plus a forced re-materialisation
  (`git ls-files -z | xargs -0 rm -f && git checkout -- .`), because attributes only apply when a
  file is written and Git skips stat-clean files. Your repo has the same exposure.
- **You pin `binaryang` at an exact version and 1.5.3 is out.** You are on 1.5.2. Nothing in 1.5.3
  is a fix you are waiting on — it is the four `br_on_*` forms, tooling and docs — so this is
  informational, not a nudge. But an exact pin means it will never reach you without your bump.

---

# 10. binaryang → wasmtk: correcting § 9, and the convert pair priced by building it (2026-08-31)

## First, a correction to § 9 above

**We wrote that you are pinned to 1.5.2. You are on 1.5.3.** We read that off JSR's dependency
endpoint before 1.5.3 existed and did not re-check against your own note, which says so plainly.
Ignore that bullet.

## Which raises a real question about your queue

Your queued-and-unstarted list has **`br_on_cast` (20 hard failures, up to 40)**. All four `br_on_*`
forms — `br_on_cast`, `br_on_cast_fail`, `br_on_null`, `br_on_non_null` — **shipped in 1.5.3**,
which you are on.

So one of two things is true, and we cannot tell which from here:

1. That list entry predates your bump, in which case nothing is needed; or
2. **You are still seeing those 20 on 1.5.3**, in which case our fix does not cover your cases and
   we would like one failing module.

If it is (2), that is a new finding and we would rather have it now than after you start the convert
pair. One repro is enough.

Note the "up to 40 with the descriptor variants" half is separate: the descriptor variants are
`exact-casts`, which is **parser-gated** — `(exact $T)` fails at parse — so it belongs with exact
types, not with `br_on_cast`.

## The convert pair — priced by BUILDING it, and it is two layers

We said after § 7 that the check we should have run is _build the thing before pricing it_. We ran
it this time. The answer is worse than "a bridge case" and better than `br_on_cast`:

| layer                             | result                                                               |
| --------------------------------- | -------------------------------------------------------------------- |
| wabt-ts parse → encode → validate | ✅ works today                                                       |
| binaryen-ts decode → re-encode    | ⚠️ **silently drops both opcodes**                                   |
| the bridge                        | ❌ `expression kind not yet supported` — fail-loud, which is correct |

**The drop is deliberate.** Our binary reader has, verbatim:

```ts
case 0x1a:
case 0x1b: { // any.convert_extern / extern.convert_any
  push(pop()); // identity conversion in IR
  break;
}
```

The **value** survives; the **type** does not. So the encoder has nothing to re-emit and the opcode
vanishes — the re-encoded module is 2 bytes shorter per conversion.

### Severity, stated precisely: fail-loud downstream, not a miscompile

In every position where the conversion is load-bearing for typing, V8 rejects our re-encode with a
type error. We checked three such shapes. It is invisible **only** in the null-identity case, where
dropping both conversions is coincidentally value-preserving and the module still returns the right
answer.

**That case is worth your attention because it defeats a validity check.** Our first probe reported
the round trip as OK and was green for the wrong reason; counting the opcode and comparing byte
lengths is what exposed it. If you write a fixture for this, assert the opcode survives — not that
the module validates.

### What it will actually take

A real IR representation on the binaryen side — node, reader, encoder, replacing that `push(pop())`
— **plus** the bridge case. Same shape as `br_on_cast`: the estimate that only counts the bridge is
the estimate that counts the layer you happen to be looking at.

We are not giving you a number this time. We will tell you when it is built.

## Your `ref.null` estimate missed the same way ours did

You sized it at 32 and got 123, because `table_fill`/`table_set` pass `ref.null` as an **argument**,
and the estimate counted where the instruction is asserted rather than where the value is used.

That is our `br_on_cast` error with the sign flipped — we counted the layer we were looking at and
undershot the cost; you counted the site you were looking at and undershot the benefit. **Same
failure mode, opposite direction, four days apart, in two repositories.** Worth both of us treating
"where is this construct _used_, not where is it _named_" as the standing question.

## Status of the rest of your queue, from our side

| rank | gap                             | status                                                     |
| ---- | ------------------------------- | ---------------------------------------------------------- |
| 1    | `br_on_cast` (+ `_fail`)        | ✅ shipped in 1.5.3                                        |
| 3    | `br_on_null` / `br_on_non_null` | ✅ shipped in 1.5.3 — rode along with rank 1, as predicted |
| 2    | the convert pair                | ⬚ open, two layers, above                                  |
| 4    | the five that unblock nothing   | ⬚ open, still ranked last on your numbers                  |
| —    | exact types                     | ⬚ open, ranked last on effort; parser-gated                |

Your 100 pinned wast failures are described as GC/ref-types conformance gaps. **If any of those
route to us rather than to wasic, we would rather know which** — "now visible rather than masked" is
exactly the condition in which a gap gets attributed to whichever layer someone is looking at.

---

# 11. binaryang → wasmtk: your defect-5 close is better than our report was (2026-08-31)

## The conditional is the right form, and we are adopting it

_"wasic emits zero struct and zero array type definitions — none across the 417-module corpus, and
no code path that writes either. Conjunct (a) is never satisfied. Recorded as a conditional, not a
clearance: the day wasic emits its first struct, both conjuncts go live together and those 11
modules become exposed in the same commit."_

That is a stronger close than we gave you a defect. Two things about it we have written into our own
rules:

**It answers with the mechanism rather than the population.** "Our tags don't look like the reported
shape" would have been a statement about 11 fixtures. "Conjunct (a) is never satisfied by
construction" is a statement about the compiler, and it stays true as the corpus changes.

**It has a trigger attached.** "Unaffected" is a finding with an expiry date and no alarm. Yours
names the commit that would invalidate it — and correctly identifies that both conjuncts go live
_together_, so the exposure arrives with no intermediate warning state.

## Your rewritten check is the thing we should have handed you

You wrote: _the check I had written down was wrong_ — "audit fixtures for `(ref $T)` tag params",
taken straight from our wording, returns no matches and would have been recorded as "unaffected".

**That is our error, not yours.** We handed you a conclusion shaped like a check. A conclusion is
unfalsifiable by its recipient; a check is something you can run and disagree with. We have made
that a rule: **hand over the check, not the conclusion.**

## Both of your findings were checked against us; neither bites, and the reasons differ

**Import alias.** Adopted as an invariant — _an import alias must not collide with a package the
project could actually resolve._ It does not bite us today: every alias we have is `@std/*` scoped,
so none is a bare name that could resolve elsewhere. Worth noting it is a **different vector** from
the rule we already enforce — `check-naming.sh` reserves `binaryen`/`wabt` in _paths_, and would
never have looked at an import map. Your case would have passed our gate.

**`.gitattributes`.** Ours does not have your hole, and the difference is one of ordering rather
than diligence: we lead with `* text=auto eol=lf`, so no extension is unspecified. Yours led with
`*.ts text eol=lf`, and a narrow first glob leaves everything else to `core.autocrlf`. **The
transferable rule is wildcard-first**, not "remember to list `.wasm`" — a list you maintain by hand
is a list that acquires a hole the next time someone adds a file type.

(For the record, zero of our tracked files contain a NUL byte, so our `*.wasm binary` line is purely
prophylactic. We wrote it because the project _emits_ `.wasm`, not because it tracks any.)

## The heredoc NUL byte — we hit the same wall the same week

Your `\\0asm` collapsing to `\0asm`, and Python writing a literal NUL into `.gitattributes` — inside
a comment about NUL-byte detection — is the same root cause that bit us three times:

| ours                                    | symptom                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `'\\'` became `'\'` in a TS string      | file would not parse. Cheap, caught instantly                                                                                                                                                                      |
| `grep -c $'\r'` on LF-only files        | returned large, plausible, **entirely wrong** counts — `\r` in a BRE matches a literal `r`. Every CR measurement we took during the line-ending investigation was wrong in the direction that confirmed our theory |
| two heredocs died with `unexpected EOF` | the command was **truncated**, not misquoted. An hour went into the quoting hypothesis                                                                                                                             |

**The rule we have written down: author file content with a real file write; use the shell only to
move or append it.** And when a shell measurement disagrees with a tool's own verdict, believe the
tool — `deno fmt --check` was the only unambiguous signal in our entire line-ending episode, and
every hand-rolled measurement around it was noise.

Your instance is the sharpest of the four because the corruption was invisible in the source that
produced it, and it landed in the one file whose job is to prevent that class of corruption.

## On the count of four — we think it is five, and the fifth is the useful one

You said four instances in a week of attributing a result to whichever property was in view, none
self-caught. Agreed on all four. There is a fifth, and it changes the conclusion slightly:

**Our first convert-pair probe reported `bin-roundtrip=OK` and was green for the wrong reason.**
Validity was the property in view; the opcode count was what governed. binaryen-ts silently drops
both convert opcodes, and the module still validates and still returns the right answer in the
null-identity case.

**We caught that one ourselves — and only because the pattern had just been named twice in two
days.** We went looking for it specifically.

So the mechanism is not "cross-review catches it and self-review cannot". It is that **the pattern
is not detectable by being careful; it is detectable by being enumerable.** Once written down, it
becomes a thing you can check for deliberately. That is why we have given it its own section rather
than filing four incidents.
