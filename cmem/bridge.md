# The bridge — now an internal seam

Merged topic file (A16). Supersedes `binaryen-ts/bridge.md` (312 lines) and `wabt-ts/bridge.md`
(283) for day-to-day reading; both stay in the wings as the origin record, and for this file in
particular the wings are worth keeping, because most of what they contain is **history the merge
itself invalidated**.

## What the merge changed

`src/wabt-ts/bridge/bridge.ts` translates the wabt-ts IR into the binaryen-ts IR. It used to be a
**package boundary**; it is now an **internal module**. Both IRs are retained deliberately — they do
different jobs and wabt's round-trip fidelity is load-bearing — so the seam does not go away. What
goes away is everything that existed only because the seam crossed a repository:

| gone with the merge                                       | why                               |
| --------------------------------------------------------- | --------------------------------- |
| The exact pin `jsr:@jrmarcum/binaryen-ts@1.5.0`           | there is no version to pin        |
| `minimumDependencyAge` for that dependency                | not a dependency                  |
| The 24-hour JSR adoption gap                              | no publish between the two halves |
| Coordinated release sequencing across two repos           | one repo, one release             |
| Import-surface diffs as an upgrade proxy                  | both sides type-check together    |
| `/encoder` mapped-but-unimported as a cross-repo coupling | a relative import                 |

✅ Verified at A7: the JSR pin is gone and the 15 cross-tree imports are relative paths. That commit
is where the two projects stopped being two packages.

⚠️ **The two wing files will contradict each other, and both are right about yesterday.** They
describe one boundary from opposite sides, and the register predicted they would "go wrong together"
the moment the boundary stopped existing. That is now what has happened. Read them as history, not
as instructions.

## BINDING — upstream names are reserved

**A bare upstream project name (`binaryen`, `wabt`) may appear in a path ONLY where upstream
compatibility is the subject — `compat/` and `interop/`. It must never name a directory or module
holding binaryang's own implementation.**

Agreed 2026-08-25, binding from the first commit, and carried in the README.

**Why it is a must, not a preference.** Both codebases already held this invariant without writing
it down: every path in either repo containing a bare upstream name referred to _upstream_
(`api/binaryen-compat.ts`, `interop/binaryen-js.ts`, `api/wabt-compat.ts`, `upstream/`), while own
code always lived under functional names — `ir`, `encoder`, `passes`, `parser`, `validator`,
`writer`. Breaking it would put the same word on our code and on theirs inside one repository, and
would invite the reader to assume binaryang vendors the upstream projects rather than implementing
them — a claim about provenance that must not be made by accident.

**The qualified form is permitted.** `src/binaryen-ts/` and `src/wabt-ts/` are fine: the `-ts`
suffix is exactly what distinguishes our port from the project it ports.

**The check is `scripts/check-naming.sh`, wired into CI.**

⚠️ **The original one-liner silently stopped working at the merge, and this is the part worth
remembering.** It ended with `grep -viE '(binaryen|wabt)-ts'` to allow the qualified form. That
exclusion matches anywhere in the path — so once `src/binaryen-ts/` and `src/wabt-ts/` existed it
discarded **every file in both trees**, and returned empty on a tree that still contained the known
violation. A rule whose check cannot fail is not enforced, it is decorative. The replacement strips
the permitted components and tests what remains, and was verified to find the violation before the
rename and nothing after it.

**The one known violation is fixed (A3):** `binaryen-bridge.ts` → `bridge.ts`, 14 references
updated. It was the bridge _into_ the binaryen-ts IR — the qualified sense — spelled in the bare
form, in the most load-bearing file the two projects shared.

## Design constraints that survive

**Direct recursion, not delegate-driven.** The bridge walks the wabt IR directly rather than through
the expression-visitor delegate. See `wabt-ts/bridge.md` § "Why direct recursion" for the reasoning;
it is unaffected by the merge.

**The bridge keeps its OWN label stack, and it has diverged twice.** Both divergences were real
defects (T13.22 being the notorious one). This is the single most defect-prone part of the seam, and
the reason its tests are the ones to run first after touching either IR's control flow.

**Tier coverage:** ~60 expression kinds plus the module surface. `wabt-ts/bridge.md` § "Tier
coverage" holds the enumeration.

## The de-coarsening — CLOSED in 1.5.2

**A1 / T13.50 is fixed.** All three shapes wabt-ts measured before the merge, plus three more found
by review of the fix itself:

| shape                                  | was                                                |
| -------------------------------------- | -------------------------------------------------- |
| imported func with a `(ref $T)` param  | `unresolved GC function type`                      |
| tag with a `(ref $T)` param            | `unresolved GC function type`                      |
| tag whose signature no function shares | `unresolved GC function type` — the half-fix below |
| imported global `(ref null $T)`        | `type mismatch in function`                        |
| function local `(ref null $T)`         | `struct.get` type mismatch                         |
| global `(ref null $T)` + `ref.null $T` | refused outright, then a type mismatch             |

⚠️ **Two lessons worth more than the fix.**

The last row was **two defects stacked**. Removing the `ref.null` refusal only MOVED the error to
`type mismatch in function`, because the global's own type was still coarsened. The register warned
not to assume widening the de-coarsening fixed `ref.null`; it cuts the other way too. Watching the
error message move is what showed the second was there.

The tag row was **green for the wrong reason** first time. The fix made the converter precise but
never registered tag signatures as func heap types, so `gcFuncTypeIndex` resolved a tag only when a
function happened to share its signature — which is exactly what the first test did. A tag with a
unique signature still threw. Same trap wasmtk documented about their own fixture, hit here within
the week.

Gated by `tests/wabt-ts/bridge/gc_decoarsening.test.ts`, all six shapes, each seen to fail first.

### Historical — the shapes as originally reported

**A1 / T13.50 — de-coarsening was INCOMPLETE. Three measured failing shapes:**

| shape                                 | result                                                   |
| ------------------------------------- | -------------------------------------------------------- |
| imported func with a `(ref $T)` param | `unresolved GC function type: (structref) -> ()`         |
| tag with a `(ref $T)` param           | `unresolved GC function type: (structref) -> ()`         |
| global of type `(ref null $T)`        | `Bridge: ref.null with a user-defined heap type is not…` |

T13.47 replaced the coarsening `wabtTypeToValType` with the precise `wabtTypeToValueType` only at
the sites the tests exercised. **24 coarsening call sites remain; 5 are precise.** No test covers
any of the three shapes, which is exactly why the bridge suite reads as green.

The third row is a **different** defect sitting next door — the bridge refuses `ref.null` with a
user-defined heap type. Do not fix it by widening the de-coarsening and assume it went away.

**The merge makes this cheaper, which is why it was deliberately not done first**: the fix needs
both type systems visible at once, and that is precisely what one repo provides. It also **fails
loudly**, so unlike T13.22 it cannot be made invisible by merging.

## T13.22 — closed before the merge, and why the ordering mattered

The compensating pair is gone: the pin was exact, `buildCatchClause` now runs **before**
`ctx.labelStack.push(name)`, and `tests/wabt-ts/bridge/try_table_catch_scope.test.ts` gates it with
a **numeric** probe.

The framing is the part to keep. Merging first would not have carried the bug in — it would have
made it **permanently invisible**, because two errors that cancel across a repository boundary have
no boundary left to be noticed at. With the pin at 1.5.0 and the old ordering, a numeric
`(catch $e 1)` silently encoded depth 0 — bytes V8 accepts, naming the wrong handler — while a named
target threw `unresolved branch label`. Loud one way, silent the other.

That is the general shape to watch for now that there is no boundary: **a defect shared by a
producer and its consumer is invisible to their round trip.**

## Working with what is left of the seam

The bridge is the one module the promotion rule can never promote: a module earns a common `src/`
folder when nothing in either namespaced tree still imports it across the boundary, and the bridge
is cross-tree _by definition_. 🔓 Where `src/wabt-ts/bridge/` finally lives is an open layout
question — it can stay where it is and be promoted later at no cost.
