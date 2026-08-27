# Outbound handoffs to the sibling projects

Correspondence sent to (or drafted for) the wabt-ts team, kept in the repo because a note that lives
only in a session scratchpad evaporates with the session — and because what we told them, and when,
is part of the record of the boundary.

Both notes below were drafted here and handed to the owner to send; nothing is ever written into
`../wabt-ts/` from this repo.

---

## 1. Multi-value blocks + the `dest` change (sent 2026-08-25, pre-release)

Context: answered their multi-value block report, and disclosed the `try_table` catch-scope change
before a version existed. Their reply confirmed the bad branch — their bridge compensates — and is
recorded in [bridge.md](bridge.md).

# binaryen-ts → wabt-ts: multi-value blocks are fixed, and one thing changed meaning

## Your report was right, including the part you couldn't test

Multi-value block **decoding** was already fixed here — it landed after the `v1.4.3` tag and was
never published, which is why `readBinary` still refused your repro.

The half you flagged as untestable ("a decoder rule with no matching emitter rule hides itself") was
genuinely broken. A multi-result blocktype names a type-section _index_, and our encoder resolved it
against an internal deduplicated table instead of the one it actually emits. Unrelated orderings, so
the index was correct only by coincidence — your exact repro decoded cleanly and re-encoded a block
declaring one result while pushing two.

Both your shapes now work end to end — bare parse→encode, full `-Oz`, and the `/compat` facade
(`readBinary` → `optimize` → `emitBinary`):

- `(module (func (result i32) (block $b (result i32 i32) (i32.const 1) (i32.const 2)) (drop)))`
- the real wasic shape: a 2-param tag → `try_table` catch → 2-value handler block

## Breaking, if you build `TryTableExpr` nodes directly

**`catches[].dest` must now name the ENCLOSING label.**

A `try_table`'s own label is not in scope for its handlers: depth 0 is the immediately enclosing
frame. Our decoder and encoder were _both_ resolving one frame too deep — symmetrically, so
parse→encode round-trips came out byte-identical and the bug was invisible from the binary side. The
IR was wrong, which is what passes read, and what your bridge would have been writing against.

If your bridge currently compensates for the old behaviour by shifting the label, remove the shift.
If it passes the spec-correct label, you're already right and were previously being mis-encoded by
us.

We pinned the semantics against V8 rather than against our own convention: the fixture gives the tag
one value and offers two candidate target blocks taking one and two, so only the correct reading
type-checks. Depth 0 and depth 1 get different verdicts from the engine.

Related, if you generate IR and then run passes: `RemoveUnusedNames` now counts a catch destination
as a label reference. It previously counted only `br`/`br_if`/`br_table`, so it would strip a block
label named solely by a catch — which is exactly the `$__exn_tag` shape, since nothing `br`s to that
block.

## None of this is on JSR yet

Every bit of it — the decode work included — is on `main`, above `v1.4.3`. A consumer installing
from JSR still gets "multi-value block type is not supported". The release is deliberately held
while we finish a bug hunt; you'll get a version number when it goes out.

Nothing to do on your side except the `dest` change above, and only if you construct those nodes
yourself.

---

## 2. v1.5.0 is live, T13.22 actionable (drafted 2026-08-25, post-release)

Context: written once 1.5.0 shipped, with the upgrade-compatibility facts measured rather than
asserted. Retracts my `$__exn_tag` claim and answers their Note 1 (which report it was).

# binaryen-ts 1.5.0 is live — T13.22 is now actionable

## First, a correction I owe you

I told you the coupling meant "1.5.0 cannot ship alone." **That was wrong in direction, and if it
shaped your sequencing, discard it.**

The coupling itself is exactly as you proved it. The conclusion I drew from it was not. You pin an
exact `1.0.9`, so publishing could never touch your builds — and your own note gated your fix on
"the same change as the binaryen-ts upgrade," which means you were waiting for a version to upgrade
_to_. Withholding the release wasn't protecting you; it was the thing keeping you stuck.

The atomic step was always yours, not ours. I've retracted the entry on our side and turned it into
a rule: name _who_ is blocked and _on what_, because a coupling constrains whoever must act
atomically, and that isn't automatically both parties.

## What shipped

`@jrmarcum/binaryen-ts@1.5.0`, with provenance — `rekorLogId 2590420167`, tag `v1.5.0`, commit
`39a76d52686`.

Your original shape table was re-verified against exactly what shipped, each across four paths
(input / bare round-trip / full `-Oz` / the `/compat` facade):

| shape                                          | result |
| ---------------------------------------------- | ------ |
| single-value block                             | ok     |
| multi-value function result                    | ok     |
| `try_table`, single-value handler              | ok     |
| **multi-value block** (your repro)             | ok     |
| **wasic shape: 2-param tag → 2-value handler** | ok     |

## T13.22 — two steps, one commit

Either half alone emits the wrong catch depth, so they can't be split:

1. Move `buildCatchClause` **out of** the `ctx.labelStack.push(name)` in `bridgeExpr`'s `try_table`
   case. Catch targets resolve in the enclosing scope.
2. Bump the pin `1.0.9` → `1.5.0`.

I confirmed the compensation is still present in 1.4.1 before writing this, so nothing has drifted
under you.

## What else is in 1.0.9 → 1.5.0 — this is the part to plan for

That span is four months and most of the project's correctness work, not just the catch scope. Two
things I checked specifically so you don't have to:

- **All 66 names your bridge imports from `/ir` still resolve at 1.5.0.** I diffed your import list
  against the published surface. A sweep in this release _did_ remove four exported symbols
  (`parseWast`, `isAtom`, `assertList`, `materializeFakeGlobals`) — that's what makes it a minor —
  but none are reachable from any `exports` subpath, so they can't be what breaks you.
- **`/encoder` is mapped in your `deno.json` but only referenced in a doc comment**, not imported in
  `src/`. If nothing downstream consumes it, that mapping is free to update or drop.

Behaviourally, the ones most likely to reach your bridge: multi-value blocks now decode _and_
encode; concrete typed references (`(ref $T)` / `(ref null $T)`) are carried end-to-end, which may
mean your `coarsenValueType` at the boundary is doing work it no longer needs to; and several region
bodies (`if` arms, `try` bodies) that previously round-tripped to invalid wasm now don't.

I'd upgrade behind your own differential harness rather than trusting this list.

## Two of your notes need answers from me

**Note 1 — you were looking for the wrong report, which is why the grep came up empty.** It isn't
your 7-finding upstream report (that's UP-1…UP-7). It was a later, separate ask, and it opened by
explicitly excluding try_table: _"one thing, and it isn't try_table."_ Identifying marks: the repro
`(module (func (result i32) (block $b (result i32 i32) (i32.const 1) (i32.const 2)) (drop)))`, the
error `multi-value block type (type index 0) is not supported (at offset 0x3)`, and a four-row shape
table. The "untestable half" was the multi-value **writer**. If it left no trace on your side
either, then your write-it-down rule caught a real instance — it reached us and was never filed.

**Note 3 — you were right, and I've retracted it.** I claimed `RemoveUnusedNames` mattered to you
via the `$__exn_tag` catch-destination shape. Legacy `try`/`catch` has no catch-destination label at
all, so that reasoning never touched your modules, and I've dropped it rather than re-derive from
your frozen snapshot.

The operative instance for legacy EH is **`delegate`**, and this one is verified rather than argued:
revert only the `Try.delegateTarget` line in that pass's collection and a block label named solely
by a `try…delegate` target gets stripped, after which encoding dies with `unresolved branch label`.
V8 accepts the fixture, so it's live code. `rethrow` targets a `try` label, which the pass never
strips — unaffected.

## One last thing, and thank you for it

Your non-discriminating-probe correction — depth 1 and depth 2 both returning 111, only depth 0
differing — is now in our best-practices file, credited to your side. We'd written the same rule
from the other direction the same week (a fixture where both readings pass proves nothing) without
noticing it applied to a probe as much as to a test.
