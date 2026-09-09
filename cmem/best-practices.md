# Best practices — the rules BOTH projects derived independently

Merged topic file (A16). This holds only the **convergent** rules. The full enumerations stay in the
wings — [binaryen-ts/best-practices.md](binaryen-ts/best-practices.md) (294 lines) and
[wabt-ts/best-practices.md](wabt-ts/best-practices.md) (2,894) — and nothing has been deleted from
either.

## Why this file is a selection and not a rewrite

At 9.8:1 this was the trap file of the whole cmem merge. A naive merge reads as wabt-ts's memory
with a few binaryen-ts notes appended, quietly losing the smaller project's reasoning — and the
smaller project is the one that independently _confirmed_ the rules.

The instruction from the pre-merge register inverts the usual framing, and it is the sharpest thing
either side wrote:

> **Do not pick a surviving vantage point.** Both sides independently derived the same rules. For a
> rule two teams found separately, **both origin stories are the evidence**, and choosing a survivor
> discards the strongest thing about it.

So each rule below names **both** derivations. Where a rule cost one project a specific defect, that
defect is the citation.

## 🆕 The convergence is stronger than either side claimed

Measured while merging: **four section titles are identical between the two files**, written
independently by two teams that never compared them.

| binaryen-ts                                           | wabt-ts                                               |
| ----------------------------------------------------- | ----------------------------------------------------- |
| §1 Producer/consumer pairs — the recurring blind spot | §3 Producer/consumer pairs — the recurring blind spot |
| §3 Verifying a change                                 | §1 Verifying a change                                 |
| §4 Investigating a defect                             | §2 Investigating a defect                             |
| §5 Status, scope and memory                           | §5 Recording what you found                           |

Two codebases, two ledgers, no shared document — and the same four headings, in a different order.
That is not style converging; it is the same failure modes teaching the same lessons twice.

---

## The convergent rules

### An exit code is not evidence

**binaryen-ts:** every serious defect it has had produced _valid wasm with the wrong value_;
`WebAssembly.compile` has never caught one. Its regression ladder exists because the behavioural
rungs — fuzzer, `equiv_check`, corpus round-trip — are the only ones that see a valid-but-wrong
module.

**wabt-ts:** reached the same rule from `assert_malformed` conformance, where a harness can score
_better_ while broken, and from **T13.16**, where `wat2wasm` silently deleted an instruction and
emitted a module both engines accept, that runs, and that computes a different answer.

**In binaryang this is now load-bearing at the merge gate itself.** `deno task test` proves the
suites ran; `deno task baseline` proves the emitted bytes did not move. Only the second is a
statement about a relocation, which is why CI runs them as separate steps.

### A green suite is evidence about the tests, not about the code

**binaryen-ts:** neither the `deepCopy` subtree-sharing bug nor the PickLoadSigns miscompile could
have been caught by its fuzzer — measured, not assumed: the fuzz test contains **zero** `makeLoad`
and **zero** `makeBreak` calls, so it cannot construct either shape. Both were found by reading.

**wabt-ts:** "a green gate is a floor, not a result", and **T13.41** — strip scored 272/272 on
inputs that had nothing to strip. An oracle can pass **vacuously**; check the input actually
exercises the behaviour.

**And again during this merge:** `deno test tests/` collected 513 of 908 and exited 0. Half the
suite, reported green, with nothing to distinguish it from the whole suite passing.

### A new test that has never failed has not been shown to test anything

**binaryen-ts:** break the fix, watch it go red, restore — done for the start-section seeding and
the `br_if` cases.

**wabt-ts:** "invert a new guard test before trusting it — and check WHICH steps flip", plus
**T13.44**: deleting the release guard left all 12 of its unit tests passing.

**Paid for three times during this merge**, which is why it leads here rather than sits in a list:

- The corrected naming check was verified to find the known violation _before_ the rename.
- The baseline gate's first inversion **failed to fire** — the probe appended a WAT comment, which
  correctly changes no emitted bytes. A probe that cannot separate the hypothesis from its negation
  proves nothing.
- The re-pointed T13.31 guard's first version **also failed to fire**, because the regex held a
  literal `0x08` byte where `\b` was intended — the exact T13.25 defect this repo already guards
  against.

### One authoritative enumeration; a list written a second time will drift

**binaryen-ts:** exactly one child enumeration, in `walk.ts`, whose `default` throws. Two private
dispatchers had already drifted before anyone noticed — `deepCopy` covered 29 of 79 expression kinds
and returned the rest as-is; PickLoadSigns' walker covered ~15 and could not see a `local.get`
inside a `br`, which made a _use_ invisible rather than neutral and turned `-1` into `255`.
**Falling behind produces SILENCE**, which is why the default must throw and an allow-list must
default conservatively.

**wabt-ts:** "enumerate the family, then ask what each member checks", and "enumerate the SIGNATURE,
not the parameter" — the same rule reached from opcode tables rather than from an IR walker.

### Producer/consumer pairs are the recurring blind spot

Both projects made this their own §1 or §3, independently.

**The general form:** a defect shared by a producer and its consumer is **invisible to their round
trip**. A corpus of your own output cannot test your own output.

**The costliest instance spanned both projects — T13.22.** Two errors that cancelled across a
repository boundary stayed invisible to both sides' tests for four releases. Merging with it live
would not have carried the bug in; it would have made it **permanently invisible**, because there
would have been no boundary left to notice it at.

That is the rule binaryang most needs to keep, because the merge **removed the boundary**. The
protection is gone; only the awareness remains.

### Fix the class, not the instance — then guard the class

**wabt-ts** states it directly.

**binaryen-ts demonstrated it during this merge**, on the `--version` drift: rather than correcting
the constant, it made `deno task bump` rewrite both files and fail loudly if the literal moves, and
added a test that catches a **hand-set** version — the case that actually caused the bug, since
1.5.0 was set by hand.

### A stale rationale is worse than no rationale

**wabt-ts** states it directly.

**Demonstrated twice in one week, both times here.** The `import.meta.main` ban's stated reason —
Node 18 — expired on every supported runtime, while the rule it justified remained correct for an
entirely different reason (the `Deno` global, absent from Node and Bun at every version). And the
version literal's stated reason expired the same way, while the solution stayed right on its own
merits. **A rule outliving its reason is not automatically wrong; it is unverifiable**, and the next
reader cannot tell which.

### Write down the thing you only said out loud

**wabt-ts** states it; **binaryen-ts** reached it as "project knowledge lives in `cmem/`, which
survives a clone; machine-local memory holds only what is true of the machine."

**The merge's own strongest instance:** the requote that both sides had agreed must happen first was
missing from the kickoff brief's seven ordered steps — omitted by the author of the very instruction
that said to reconcile both registers before acting. A plan can feel complete for the same reason it
can be wrong: **internal consistency is not completeness, and one view cannot tell the two apart.**

---

## 🆕 Pin every environment-dependent default in the repository, not on the machine

**Rule: if a tool's behaviour depends on a setting the repository does not carry, the repository is
missing a file.** Line endings were the instance that cost the most; the rule is general.

### The instance

`deno fmt --check` failed locally on 32 files while CI was green on the same commit. The committed
content was never wrong — `git add --renormalize` found nothing to change — and CI had passed
throughout. The divergence was entirely in the **checkout**: Git on Windows defaults
`core.autocrlf=true`, so the working tree got CRLF while the Linux runner got LF.

**Fixed by `.gitattributes` carrying `* text=auto eol=lf`.** `eol=lf` governs checkout as well as
commit, so every clone materialises the bytes CI sees regardless of local config.

⚠️ **Adding the file is not enough.** Attributes apply when a file is written, and Git skips files
whose stat information says they are already current — `git checkout-index -a -f` left all 32
unchanged. The working tree must actually be re-materialised:

```sh
git ls-files -z | xargs -0 rm -f && git checkout -- .
```

Safe only on a clean, committed tree — check `git status` first.

**Verified the hostile way, which is the only verification worth having:** a fresh clone with
`core.autocrlf=true` _explicitly forced on_ still reports `eol: lf` and passes `deno fmt --check`.
Testing it in a repo already configured correctly would have proved nothing.

### Why it kept coming back

**Nothing was broken, so nothing got fixed.** The commit succeeded every time; the warning
(`LF will be replaced by CRLF the next time Git touches it`) scrolled past as noise, and CI stayed
green because the committed content was always correct. A defect that only wastes time, and only
sometimes, has no moment that forces the fix. It surfaced as an hour lost mid-merge.

**The other half of why it persisted: a config change fixes one machine.** `core.autocrlf=false`
locally would have cleared it here and left it waiting for the next clone, the next contributor and
CI's own runner image. Machine-level state is invisible to everyone but its owner, so a fix living
there is indistinguishable from no fix at all.

### The measurement trap this exposed, which is the more portable lesson

Every CR count taken during the investigation was **wrong**, in the direction that confirmed the
theory. `grep -c $'
'` and `od -c | grep -o '
'` both match a literal `r` in a BRE — so files were
reported as full of carriage returns when they held none, and the numbers moved plausibly because
the letter `r` is common.

**Trust the tool that is actually failing.** `deno fmt --check` going from `32 not formatted` to
`Checked 283 files` was the only unambiguous signal in the whole episode. A hand-rolled measurement
built to confirm a hypothesis usually will.

### Applying it beyond line endings

Ask of any tool whose result differs between two machines: **what setting decided that, and is it in
the repo?** Formatter width, lint rules, TypeScript strictness, Node version, test-runner
concurrency. Every one of them has a machine-level default that will silently disagree with CI.

## 🆕 When two paths to the same action disagree, the difference is a FACT — look it up

**Rule: a persistent difference in outcome between two routes has a cause you can read off a field
somewhere. Enumerate what differs between them before theorising about why.** And when a failure
hands you no error message, **obtaining the message is the work** — everything reasoned on top of a
bare exit code is speculation wearing evidence's clothes.

### The instance

Two routes published the same package from the same workflow file:

| route                            | record                  |
| -------------------------------- | ----------------------- |
| `push: tags`                     | 5 successes, 0 failures |
| `auto-tag` → `workflow_dispatch` | 0 successes, 4 failures |

Three of those failures produced only `exit code 1`. Across weeks and three repositories, that
produced a documented conclusion of _"treat this as a correlation, not a cause"_ — epistemically
correct, and it **became a resting place**. The pattern was strong enough to work around and never
strong enough to explain, so nobody explained it.

The fourth attempt surfaced the actual error:

```
Failed to publish @jrmarcum/binaryang@1.5.3
Caused by: ... not authorized as a scope member for this scope. (actorNotScopeMember)
```

**JSR authorises the OIDC token's ACTOR.** One field on the runs API settled it:

| event               | actor                 | result |
| ------------------- | --------------------- | ------ |
| `workflow_dispatch` | `github-actions[bot]` | ❌     |
| `push`              | `jrmarcum`            | ✅     |

Full detail in [publishing.md](publishing.md).

### Identity is a hidden variable in CI, and it is the one nobody lists

When comparing two CI paths, the obvious variables get checked — the YAML, the permissions block,
the runner, the tool version. **Who the run executes as** is rarely on the list, because it is not
written in any file being compared. Here it was the _only_ difference, and it was invisible in the
diff of a workflow that never changed.

Add it to the list. `actor.login` on the runs API, one request.

### One controlled pair beat weeks of accumulated correlation

Nine data points across three repositories and several weeks supported "dispatch is unreliable".
**Two runs minutes apart — same commit, same workflow, same YAML, differing in one field — proved
the mechanism.** Accumulating more observations of a confounded comparison does not converge on a
cause; it converges on confidence in a correlation.

When a pattern is stable enough to work around, that is the moment to spend twenty minutes finding
the mechanism, not the moment to stop.

### What a cause buys that a workaround does not

The correlation supported _"use tag pushes"_. The mechanism additionally established that the fix
must be a PAT **owned by a scope member** — a distinction invisible from the correlation, and one
that would have produced a second identical failure had it been guessed. It also cleared provenance
as a suspect entirely: the publish was rejected at authorisation, so provenance never ran.

**A workaround routes around the unknown; a cause tells you which neighbouring things are also
wrong.**

## 🆕 Do not author file CONTENT through a shell heredoc

**Rule: write files with a file-writing tool. A heredoc is for commands, not content.**

Both repositories hit this in the same week, with different symptoms and one root cause: **the shell
layer collapses backslash escapes before the content is written**, and it silently truncates long
commands.

| symptom                                                                                             | what actually happened                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'\\'` in a JS string became `'\'`                                                                  | the file would not parse — caught immediately, cheap                                                                                                           |
| `grep -c $'\r'` returned large plausible counts on LF-only files                                    | `\r` in a BRE matches a literal `r`. **Every CR measurement taken during the line-ending investigation was wrong, in the direction that confirmed the theory** |
| a 90-line and a 150-line heredoc both died with `unexpected EOF`                                    | the command was truncated before the closing delimiter — nothing to do with quoting, which is where the first hour went                                        |
| wasmtk: `\\0asm` collapsed to `\0asm` and Python wrote a **literal NUL byte** into `.gitattributes` | git reported the file as `Bin 584 -> 2144`. The NUL landed **inside a comment about NUL-byte detection**                                                       |

The last one is the instructive one: the corruption was invisible in the source that produced it,
and the file it corrupted was the file whose job is to prevent that class of corruption.

**Why it stays hidden:** every one of these produces output that looks like a _different_ problem —
a quoting error, a formatting drift, a binary file. None of them announces "your escape sequence was
eaten."

**How to work:** author content with a real file write, then use the shell only to move or append
it. When a shell measurement disagrees with a tool's own verdict, **believe the tool** —
`deno fmt --check` going from `32 not formatted` to `Checked 283 files` was the only unambiguous
signal in the entire line-ending episode, and every hand-rolled measurement around it was noise.

## 🆕 The result gets attributed to whichever property was in view

**Four instances in one week across two repositories, and nobody caught their own.**

| the claim                                              | the property in view                       | what actually governed                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| "`br_on_cast` is one bridge case"                      | the bridge's instruction switch            | three defects in two trees — the encoder wrote typed-ref blocktypes in a form that did not round-trip                             |
| "the defect is a tag with a `(ref $T)` param"          | the param that happened to be in the repro | a conjunction naming neither the tag's types: a struct/array exists in the module, **and** no function shares the tag's signature |
| wasmtk: "`ref.null` marshalling is ~32 assertions"     | where the instruction is **asserted**      | where the value is **used** — `table_fill`/`table_set` pass it as an argument. Delivered 123                                      |
| wasmtk: "audit our fixtures for `(ref $T)` tag params" | the wording they inherited from us         | the check returns no matches and cannot show what it was being asked to show. **A false clearance, one step from being recorded** |

The errors run in both directions — two undershot cost, two undershot reach — so this is not
optimism. **It is that the property you are looking at feels like the property that matters.**

### The detection mechanism is the finding

**Every one was caught by the other party. None by its author.** That is not a comment on care; the
author has already decided which property is salient, which is exactly the decision under review.

Two things follow, and they are cheap:

- **Hand over the CHECK, not the conclusion.** "Audit for `(ref $T)` params" is unfalsifiable by its
  recipient; "the precondition is a struct existing AND no function sharing the signature" can be
  run and disagreed with. A conclusion travels as a claim about the world; a check travels as
  something the other side can execute.
- **Record a negative as a CONDITIONAL, not a clearance.** wasmtk's closing form is the model:
  _wasic emits zero struct and zero array definitions, so conjunct (a) is never satisfied — and the
  day it emits its first struct, both conjuncts go live together and those 11 modules become exposed
  in the same commit._ That is a finding with a trigger attached. "Unaffected" is a finding with an
  expiry date and no alarm.

### Naming it made self-detection possible

One instance **was** caught by its author, and only after the pattern had been written down: a
convert-pair probe reported `bin-roundtrip=OK` and was green for the wrong reason — validity was the
property in view, and the opcode count was what governed. It was checked precisely because the same
trap had just been named twice.

**That is the argument for this section existing.** The pattern is not detectable by being careful;
it is detectable by being enumerable.

## 🆕 A change that silently does nothing is indistinguishable from one that worked

**Rule: make every edit, gate and guard fail loudly when its target is absent.** The expensive
defect is not the wrong change — it is the change that had no effect and reported success.

Both projects hit this repeatedly, from different directions. Gathered because the instances only
look like one class once they are next to each other:

| the no-op                                                            | how it presented                                                                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a string replacement written **without asserting the target exists** | the document's summary table contradicted its own sections for hours. The asserted edits _beside_ it succeeded, so the commit looked complete              |
| a workspace member **omitting** a `compilerOptions` key              | the member inherits the root's value and merges over it, so omission leaves the root setting in force. Looks like it works until you check the error count |
| `git checkout-index -a -f` after adding `.gitattributes`             | attributes apply when a file is written, and Git skips stat-clean files. Zero of 32 were rewritten, with no output                                         |
| a mutating script that **read no arguments at all**                  | `--dry-run` performed a real bump and reported it in the same form a dry run would have used                                                               |
| `deno task test` **enumerating test directories by name**            | moving a suite makes it silently stop running. The whole bridge suite would have gone quiet                                                                |
| deleting a release guard's entire block                              | **all twelve of its logic tests still passed.** The original defect was that the logic was _absent_, not wrong                                             |
| pushing a tag before the branch on a new repo                        | Actions has no workflow registered to match the event against; it passes unmatched. **A silent absence, not an error**                                     |

## Why this class is expensive

Every one produced a **green result**, so nothing prompted a second look. Several sat next to
changes that _did_ work, which is worse than failing alone: the surrounding success is read as
evidence for the whole.

And the counter-instinct is wrong. Care does not help — you cannot notice the absence of an effect
you were not shown. **Structure helps.**

## How to apply

- **Assert the precondition, always.** `assert old in s` before a replace. A replacement that finds
  nothing must raise, never return the input unchanged. This is one line and it would have caught
  the first two rows.
- **Prefer "fail if absent" over "act if present."** The two are identical on the happy path and
  opposite on the one that matters.
- **Enumerate from the source, not by hand.** A directory list, an export list, a set of test paths
  — any hand-maintained enumeration acquires a hole the next time something moves. If a comment
  claims a list is complete, that claim is testable.
- **Omission is not reset.** Wherever config merges (workspace members, layered CI, extended
  tsconfig), write the value out explicitly.
- **Invert the gate.** This is the detection half, already a rule elsewhere: break the thing on
  purpose and confirm the check fires. It is the only way to tell a passing check from a blind one —
  and note `git add --renormalize` reporting no changes was _correct_ here, yet identical in
  appearance to the broken case.

**The related-but-distinct failure** is
[attributing a result to whichever property was in
view](#-the-result-gets-attributed-to-whichever-property-was-in-view) — that one is a wrong
attribution of a real effect; this one is a missing effect reported as success.

## 🆕 `--reload` does not invalidate a resolved VERSION — only a fresh `DENO_DIR` proves a chain

Verifying C3 (does a downstream consumer still pull a retired package?), the same bare specifier
resolved to an **old** version that pulled both retired predecessors. It looked exactly like a live
finding. It was a cached resolution, and the flag everyone reaches for did not clear it:

| attempt                      | outcome                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| bare specifier               | old version → **both retired packages**                                                  |
| `--min-dep-age=0`            | unchanged (and the new version was four days old, so the 24-hour wall was never in play) |
| **`--reload`**               | **unchanged** — module content is reloaded, the version resolution is not                |
| an explicit version or range | correct version → current dependency only                                                |
| **`DENO_DIR=$(mktemp -d)`**  | **correct version → current dependency only**                                            |

**During a retirement this reports the OPPOSITE of the truth in both directions.** It made a
completed migration look incomplete here — and the same cache would let a consumer keep building
against retired packages while every check they ran said the new chain was in place.

**Rule: verify a dependency chain with a fresh `DENO_DIR`, never with `--reload`.** And eliminate in
that order — age policy, then reload, then explicit constraint, then a clean cache — because each
step rules out a different explanation, and stopping early is what turns a cache artifact into a
filed defect.

## 🆕 A test for a fix is not coverage until it FAILS without the fix

Four fixtures for the anonymous-block label defect all passed — and all four still passed with the
fix reverted. They went through `wasm2wat --fold` first, and the writer NAMES a block it emits a
branch to, so the anonymous case the fix addressed never reached the parser. The fixtures exercised
a path adjacent to the defect and nothing in the result said so.

**The check is mechanical and takes one minute:** revert the fix, run the test, confirm it fails,
restore. Do it per fix, not per file — in the same change, reverting the `try` half of the label fix
left all 421 corpus modules passing, which is how it became clear that half had no evidence behind
it and should not be described as a fixed defect.

⚠️ **Two related traps this exposed, both about the fixture rather than the code:**

- **A round trip can normalise away the input you meant to test.** If the pipeline rewrites the
  shape before it reaches the component under test, parse the shape DIRECTLY and keep the round trip
  as a separate integration guard.
- **A fixture can fail for a reason unrelated to the defect.** Declaring any explicit `(type ...)`
  puts our encoder in GC mode, where every function signature must be declared — so a fixture
  declaring only the import's type failed with the _same diagnostic_ from a different section. The
  first reading was that the fix had not worked.

**When a test does not discriminate and cannot cheaply be made to, label it in the file as a guard
rather than as coverage.** Two of these were kept on those terms. What must not happen is a green
suite implying evidence that was never collected.

## 🆕 A "this is unsafe" comment can be wrong about the standard and right about our code

The WAT writer declined to fold any node whose operands were partly stack-sourced, and the comment
explaining why named a specific case: `(i32.store (value))` gives one operand for two slots, and "a
reader assigns it to the FIRST", so the address would be filled with the value.

Half of that was wrong. Folding is defined by UNFOLDING — `(instr a b)` is `a b instr` — so written
operands land in the LAST slots and the stack supplies the leading ones. wabt-ts reads it correctly.

**The other half was right, about a component the comment never mentioned.** binaryen-ts's parser
read that exact text as storing the address at the value: 0 where wabt-ts gives 42. Valid bytes,
wrong program.

**So removing a guard on the grounds that its justification is wrong requires checking every
component the guard was protecting, not just the one the comment argued about.** Measuring the
standard would have licensed the change; measuring our own parser is what caught the miscompile.

⚠️ **Use a NON-COMMUTATIVE operation whenever operand order is what you are testing.** With
`i32.add` every assertion here passes under the reversed reading. `i32.sub` and a 3-argument
subtraction are what made the slots observable.

## 🆕 Changing a field has SIX failure modes the compiler cannot see

**Rule: a type change is not finished when it compiles. Sweep for the six, then let a behavioural
test and a byte gate disagree with you.**

Paid for across S6 step 4 (2026-09-09), converting five field families in binaryen-ts and wabt-ts to
their as-written forms. Every defect below **compiled clean**, and none was found by reading code.

### Scalar → object (a `number` becomes a `Var`)

| what breaks                                        | why the compiler is blind                                      | what caught it                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `a.index === b.index` becomes REFERENCE comparison | both sides are still the same type, so the expression is valid | `SimplifyLocals` silently stopped fusing `set`+`get`→`tee`; a behavioural test                              |
| `` `${e.index}` `` renders `[object Object]`       | **every** object stringifies — there is nothing to diagnose    | `LocalCSE` hashed every `local.get` alike and folded unrelated values. A miscompile, in two separate caches |
| `as any` / `as { name: string }` in a fixture      | the cast is the point; it suppresses exactly this              | 8 asyncify tests, then one more that a sweep for `as any` alone had missed                                  |

⚠️ **Three refinements, each learned the hard way later in the same series:**

- **The silent-`===` risk is specific to SAME-TYPED operands.** `a.index === b.index` (number →
  object, both sides) goes quiet. `e.table === '$t'` (string → object) is a type error, so all seven
  such sites surfaced as `TS2367`. **A string-typed field is materially safer to convert than a
  numeric one** — budget the sweep accordingly.
- **A cast hides EVERY field in its literal, not just the one that failed.** `asyncify.test.ts` was
  fixed once for `index: 0` inside an `as any` tree; its sibling `target: '$sleep'` sat in the same
  literal and broke on the next conversion. When a cast surfaces one wrong field, audit the whole
  object.
- **A CHAIN of structural casts reports only the inconsistency between its LINKS.**
  `body as { table?: string }` then `ci as { table?: Var }` errored only because the two disagreed.
  Update both to the same wrong type — or make the intermediate `unknown` — and the assertion
  compiles while comparing a string to an object forever.

### A field name used as a VALUE leaves the type system entirely

The sixth mode, and the one that survives even a pure rename — where the other five need a type
change to bite.

```ts
for (const k of ['ref', 'index', 'value', 'size']) assert(node[k] !== undefined);
```

A rename cannot touch a string, so this fails at RUNTIME only. Same for a field name in a map key, a
template, or a serialized shape.

🔑 **The through-line for all six: the compiler sees a field name used as SYNTAX.** The moment the
name becomes data, it is outside the type system, and no rename, retype or arm-widening will make it
speak up. Sweep for `'<field>'` as a string literal in tests before believing a rename is done — and
sweep for the PATTERN, not the failures: `wide_arithmetic.test.ts` carries the same construct,
untouched by the rename that exposed it and waiting for the next one.

### Widening a union (adding an arm), which is worse

Adding an arm is **not a type change to existing code at all** — the old arm stays legal, so nothing
the compiler checks changes.

| what breaks                                                          | why the compiler is blind                          | what caught it                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `x.kind === '<existing arm>'` silently NARROWS                       | testing an arm that still exists is still valid    | three sites, including the `(ref null func)` → one-byte `funcref` collapse. Behavioural tests |
| `{ kind: '<existing arm>', … }` literals keep building the OLD shape | the literal is a valid member of the widened union | six sites. **Only `deno task baseline` saw one**; five were latent in validators              |

⚠️ **No rename protects against the union pair.** Renaming a field converts a scalar→object silent
break into a compile error — that is real, and it is why `typeIndex`→`typeVar` and `name`→`var` were
cheaper than `memory`, which kept its name and got no such protection. But the arm being tested or
built still exists under any name.

### How to apply

- **Grep the five patterns before running the suite**, on the changed field: `\.<field> (===|!==)`,
  `\$\{[^}]*\.<field>\}`, `as any` / `as unknown as` / `as \{ <field>:`, `\.kind === '<arm>'`, and
  `\{ kind: '<arm>'`.
- **Give every union arm a CONSTRUCTOR** (`varIndex`, `varName`, `heapAbstract`) and an equality
  helper (`sameVar`, `sameHeap`). A bare literal makes the wrong arm easy to build; a constructor
  makes it hard. Put the failure that motivated the helper in its doc comment.
- **Rename the field when its type changes meaningfully.** It buys the compile error for the
  scalar→object half.
- **Assert the invariant in a test that walks the IR**, not one that checks the sites you happened
  to fix — then confirm it FAILS when the old shape is reintroduced. Both invariant tests written
  here were verified that way.

## 🆕 Let the COMPILER name the sites — and know exactly where it stops

**Rule: for a mechanical type change, drive the edit from the compiler's own error stream rather
than from a search. Then treat everything it cannot see as the real work.**

A name-based search finds what it is looking for, not what is there. It missed a factory reached
through a local alias —

```ts
const make = head === 'array.init_data' ? makeArrayInitData : makeArrayInitElem;
```

— because the name is not at the call site. `deno check` names every site with `file:line:col` plus
a caret run giving the exact token width, so an edit anchored on that is anchored on the compiler's
view instead of a guess. It found 19 test sites a search would have had to guess at.

### The three traps in doing it

- ⚠️ **Compare the two counts.** The first run fixed 11 of 18 and reported success on all 11: the
  script required a `~` run and TypeScript underlines a **single-character** token with `^`. "11
  wrapped" alone reads like a clean pass. **Always print "N of M".**
- ⚠️ **A property assignment underlines the KEY, not the value.** `{ index: e.index }` reports at
  `index`, so a naive wrap produces `{ requireIndex(index, …): e.index }` — a `SyntaxError`, and
  once a file will not parse the check stops reporting anything real. Skip any token followed by
  `:`, and say so in the output.
- ⚠️ **Assert on the command's FAILURE, not on a string in its output.** A loop that counted `TS`
  errors reported "0 errors" for four rounds while a file was syntactically broken.
  `deno task test
  | tail` likewise exits 0 from `tail`.

### Where it stops

`as any`, structural casts, and old-arm literals are invisible to it, as is anything the type
checker cannot reach. **The technique converts everything the compiler can see and nothing it
cannot** — so the sweep above is not optional cleanup, it is the other half of the method.

⚠️ **When a value of the wrong shape reaches an accessor, instrument the accessor to dump the
VALUE.** The stack names only the read site, never where the bad node was built. Dumping it returned
`0` — a number, not a var — which pointed straight at a literal that had bypassed type checking.
Reading more code would not have found it.

## 🆕 A vocabulary must be checked against the SPEC, not against the other half of the repo

**Rule: when two components each hold a copy of an external vocabulary, agreement between them is
not evidence. Check the copy that faces the outside world against the standard.**

binaryen-ts spelled two abstract heap types `ext` / `noext` — binaryen's internal C++ names, which
are not WAT keywords. Because `heapTypeToString` returns the enum VALUE as the keyword, the defect
ran both ways: the parser **rejected** `(ref null extern)`, the spec spelling that every other tool
emits, and the printer **emitted** `(ref null ext)`, which no WAT parser accepts. `exn` / `noexn`
were missing from the parser's map entirely though the enum declared them. Four of twelve broken in
both directions, undetected for the life of the file.

Nothing caught it because nothing asserted on the keyword SET: the round-trip corpus is
binary-sourced, and `deno task baseline` compares our bytes against our own. wabt-ts had the correct
table in `core/types.ts` the whole time, so the two halves disagreed silently — the failure mode a
single repository invites.

### How to apply

- **Type the table with the vocabulary**, so a keyword added to one and not the other does not
  compile: `ReadonlyArray<readonly [AbstractHeap, Type]>`, not `readonly [string, Type]`.
- **Tighten the boundary functions to the union**, not `string` —
  `typeToHeapTypeName(t):
  AbstractHeap | null`. Then a miss means the table is short an entry
  rather than that the caller passed something unexpected.
- **Assert the set is reachable**: a test that every enum member has a keyword catches the
  `exn`/`noexn` shape, where a member exists but no input can produce it.
- ⚠️ **Say out loud when the usual oracle cannot reach the feature.** wabt 1.0.41 has no GC
  heap-type text support (`(ref null any)` → `unexpected token "any"`), the same limitation that
  makes `spec:prepare` skip 30 files — so the spec was the only authority here. A first probe with
  `--enable-all` appeared to show `any` and `eq` rejected too; that was the flags, not the keywords.

## 🆕 A defensive branch carrying a DEFECT NUMBER is evidence — do not delete it as clutter

**Rule: before removing a guard, find its second caller. A comment that names a measured failure is
telling you the guard is load-bearing for a population you are not looking at.**

The encoder's `resolveRef` took a `string` meaning either a `$name` or a numeric index, told apart
by `/^[0-9]+$/`. Converting the node fields to `Var` made that regex look like pure legacy cost, so
it went — and 15 tests failed, three of them named _"encoder — numeric entity references resolve as
indices"_, written for precisely the defect being reintroduced.

Its own comment had recorded the cost in advance: **310 of 421 corpus modules**, because
`(export "f" (func 19))` is legal WAT and our own `wasm2wat` emits the numeric form. The comment was
read, understood, and the mechanism removed anyway — the failure was not missing information.

🔑 **What was actually missed is that the function served TWO populations.** Expression-node
references had been converted and carried their arm; MODULE-level references — exports, `start`,
element-segment functions, `ref.func`, catch tags — were still raw tokens, and a token genuinely can
be either form.

### How to apply

- **"This overload is pure cost" is a claim about every caller.** Enumerate them before acting; the
  one in front of you is not the population.
- **Discrimination does not disappear, it MOVES.** The right destination is the text boundary, where
  it happens once: a `varFromToken()` that reads the token and picks the arm. What was wrong was a
  FIELD carrying both meanings, not the act of telling them apart.
- **A defect number in a comment is a test that already ran.** Treat it as data: it says a
  population exists that broke this before.

## 🆕 Delete the mechanism and its DOCUMENTATION in the same edit

Replacing a function left its old docstring stranded above the next function — twice in one session,
in `binary-writer.ts` and `bridge.ts`, both describing the keyword-lookup design that had just been
removed. A stale rationale is already a rule here; this is the specific way it is created. **When an
edit replaces a body, check what sits immediately above it**, because a docstring is not adjacent to
the thing it documents in any way the tooling understands.

## Where to go for the rest

The wings hold what did not converge, and it is most of the volume:

- [wabt-ts/best-practices.md](wabt-ts/best-practices.md) — ~60 further rules, each paid for by a
  named incident, plus a table of root causes that have **recurred** (with an honest note on that
  table's decaying yield). The first thing a new audit should read.
- [binaryen-ts/best-practices.md](binaryen-ts/best-practices.md) — the IR-walker and pass-authoring
  rules: close the shape not the arm, a placeholder must not be representable as real data, a value
  read and discarded is a decision.
