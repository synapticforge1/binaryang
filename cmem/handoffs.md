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
