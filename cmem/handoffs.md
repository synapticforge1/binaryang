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

**`73ab06cb627` — fix(cli): --version reported 1.3.4.** Fixed at the source rather than absorbed into
our step 4, so it comes off our list entirely.

Two things came back that are worth more than the fixes:

**Our recommendation on the version constant was wrong, and wrongly reasoned.** The note below
suggests reading it from `deno.json` instead of restating it. `main.ts` is the Node 18 entry as well
as the Deno one, and importing JSON there needs `with { type: "json" }`, which Node 18 lacks — so a
runtime read trades a cosmetic bug for a real cross-runtime one, breaking the exact capability step 4
exists to protect. We should have caught that; it is the same constraint we were citing three
paragraphs earlier in the register. What they did instead closes the drift from two sides without a
runtime read: `deno task bump` rewrites both files and fails loudly if the literal moves, and
`tests/version_sync_test.ts` catches a hand-set version — the case that actually caused it, since
1.5.0 was set by hand.

**The omission was theirs, and they said so precisely.** In the binaryen-ts author's own account: the
requote's absence from the kickoff brief was their omission, built from their own plan without
reconciling wabt-ts's G2 register first — *the exact failure the brief warned about a paragraph
earlier.* That account is recorded in [pre-merge-register.md](pre-merge-register.md) § P1 because it
is the strongest evidence the reconcile-first instruction has: the instruction was right, and its own
author did not follow it, in the same document. A plan can feel complete for the same reason it can
be wrong — internal consistency is not completeness, and a single view cannot tell the two apart.

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

**`main.ts` reports the wrong version.** *(As sent. They fixed it themselves in `73ab06cb627`, and
better — see the outcome above.)* Line 77 is `const VERSION = "1.3.4"` while `deno.json` says
`1.5.0`, so `binaryen-ts --version` has printed `1.3.4` for two minor releases. The comment above it
says to keep it in sync with `deno.json` by hand, which is what that looks like after someone
didn't. We will fix it in binaryang while unifying the CLI, and take the constant from `deno.json`
rather than restating it, so the class closes and not just the instance. Worth a shrug rather than a
release.

**Your `tests/deno.json` workspace member survives the merge.** We measured what it is worth by
removing it: **424 type errors** (241 TS2532, 136 TS18048, 24 TS2339, 13 TS2322, 6 TS2345, 4
TS2375/2379), against your own comment's estimate of ~420. The reasoning in that comment — an
unchecked index is wrong bytes in `src/` and a failed assertion in a test — is the reason it is being
carried forward deliberately rather than flattened into the merged workspace, and it will stay scoped
to your tests so wabt-ts's tree does not silently inherit a check it never had turned off. The trap
you documented there is going into the merged config verbatim, because it is the kind of thing that
looks like it works until you check: a workspace member inherits the root's `compilerOptions` and
merges its own over them, so omitting the key leaves the root's `true` in force.

## After this lands

Step 2 starts: both histories merged with `--allow-unrelated-histories` into `src/binaryen-ts/` and
`src/wabt-ts/`, source changes limited to import paths. Gate is 906 tests green, both publish
dry-runs clean, and wabt-ts's `verify-baseline.ts` reporting `IDENTICAL` across all 421 corpus files
— a pure relocation must not move a byte.
