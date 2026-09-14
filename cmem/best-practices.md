# Best practices — the rules paid for, in both projects and since the merge

Merged topic file (A16). It opened holding only the **convergent** rules — the ones both
predecessors derived independently, down to "Write down the thing you only said out loud". Every
section marked 🆕 after that was paid for in binaryang itself, since the merge. The full pre-merge
enumerations stay in the wings — [binaryen-ts/best-practices.md](binaryen-ts/best-practices.md) (294
lines) and [wabt-ts/best-practices.md](wabt-ts/best-practices.md) (2,894) — and nothing has been
deleted from either. The day-to-day checklist these rules produce is
[working-rules.md](working-rules.md).

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
theory. A `grep -c` for a carriage return, and `od -c` piped into a `grep -o` for the same escape,
both ended up matching a literal letter `r` in a BRE — the backslash of the escape was eaten on the
way in — so files were reported as full of carriage returns when they held none, and the numbers
moved plausibly because the letter `r` is common.

🔧 **Corrected 2026-09-14, and the correction is itself the lesson.** This paragraph originally
spelled both commands with their escape sequences. Somewhere between authoring and commit the
backslashes were eaten and each escape became a real line break, so the note explaining escape
corruption was itself corrupted. It now describes the commands in words, the only form that survives
every layer (see "Do not author file CONTENT through a shell heredoc" below).

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

**How to work:** author content with a real file write, then use the shell only to move or append it
(`cat fragment >> target`). When a shell measurement disagrees with a tool's own verdict, **believe
the tool** — `deno fmt --check` going from `32 not formatted` to `Checked 283 files` was the only
unambiguous signal in the entire line-ending episode, and every hand-rolled measurement around it
was noise.

### 🔁 Knowing the rule did not prevent it — four failure modes, one family

Broken again five times on 2026-09-02 **by the author of this rule**, so the trigger is worth
stating in one line: **the moment the content contains a backslash, a heredoc is the wrong tool** —
not "risky", wrong. Even a quoted heredoc (`<<'EOF'`) is unsafe here. Python's own
`SyntaxWarning: invalid escape sequence` fired every time and was not enough of a signal; **treat
that warning as a failed command.** The worst instance: a table row EXPLAINING byte-widening
corruption had its own example escapes eaten. It survived only once rewritten with no escape
characters at all, spelling the bytes out in words ("the single byte F0 became the two bytes C3
B0"). **If a note about escaping cannot survive its own delivery mechanism, describe bytes in
words.**

The family is one thing — **a tool interpreting characters you meant literally** — and it has four
members, each in a different layer:

| mode                                     | the instance                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. backslash escapes eaten               | the table above; the two CR measurements in the line-ending section                                                                                                                                                                                                              |
| 2. long commands TRUNCATED               | `unexpected EOF while looking for matching` on 90- and 150-line heredocs. **If a heredoc fails with unexpected EOF, suspect length before quoting**                                                                                                                              |
| 3. backticks run as COMMAND SUBSTITUTION | 2026-09-04: `git merge -m "... the field is X on both halves ..."` with X in markdown backticks. The shell substituted the empty result, and the merge message shipped with nothing at all where the field's name belonged, between "the operator field is" and "on both halves" |
| 4. a STRING replacement is a template    | 2026-09-10, inside Deno, no shell at all: `text.replaceAll(from, to)` turns `$$` into `$` — see "Let the COMPILER name the sites" below. **Pass a function (`() => to`)**                                                                                                        |

Mode 3 generalises the rule: **any shell string carrying prose destined for a file or a commit
message is single-quoted or delivered by a file** — a double-quoted `-m` is not safe even when a
quoted heredoc would have been. Hence `git commit -F <file>` in
[working-rules.md](working-rules.md). And one inline `deno eval "…"` was mangled by shell quoting
the same week, so: **scripts go in files, always.**

⚠️ **Two different silent failures in one session came from editing docs by script:** the eaten
backslash, and a string-replace that silently matched nothing because `deno fmt` had reflowed the
target paragraph between reading and writing. **Both were caught by re-reading the file, never by
the tooling.** After any scripted doc edit, read back the lines it changed, and audit the diff for
HEAD lines holding `$` sequences that no longer appear verbatim.

## 🆕 The result gets attributed to whichever property was in view

**Four instances in one week across two repositories, and nobody caught their own.** Seven by
2026-09-04 — the later three are below the table.

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

### Three more instances, and what they add (through 2026-09-04)

| the claim                                                                               | the property in view                                                 | what actually governed                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "the convert pair round-trips fine"                                                     | the module **validates**                                             | the opcode was silently dropped — valid, and still correct on the one input tested (the self-caught one above)                                                                                                                                                                       |
| "wasmtk imports our IR in 10 places, so the merge is a 2.0.0 break"                     | matches under wasmtk's directory                                     | every match was inside `wasmtk/upstream/binaryang/` — a **vendored copy of OUR repo** — and they were comments, not imports. wasmtk imports two compat façades and reads no IR field                                                                                                 |
| "binaryen-ts silently rewrites multi-memory to memory 0", then "no — it refuses loudly" | first the missing `memory` field, then the `checkSingleMemory` guard | neither. The reader DESYNCED: bit 6 of the memarg align field means an explicit memidx follows, so the offset byte was consumed as an opcode and became a phantom `unreachable`. **Two wrong descriptions in a row, both from reading code; the truth came from running one module** |

Four rules they add to the two above:

- **Run one input before describing a behaviour.** Reading more code produced a second wrong answer,
  not a right one; one module through the real path settled it in one command.
- **Build the thing before pricing it.** One module through the full path would have shown all three
  `br_on_cast` defects in minutes.
- **A sibling repo may vendor YOUR source.** Exclude vendor directories before measuring "what does
  the consumer use" — the second row above nearly forced a needless major version.
- **Assert the mechanism, not the outcome.** A validity check passes a silently dropped opcode; an
  opcode count does not.

## 🆕 A written result is a CLAIM — compare it to the artifact (2026-09-12)

**Rule: a commit message, a gate report and a recorded count are claims, not evidence. Check the
thing itself — the diff, the exit code, a re-derived number — and prefer a guard that fails over a
note that is true.**

Three landed on `main` stating results the artifact contradicted, all found on one day, all by
finally looking at the artifact:

| the claim                                                       | the artifact                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `b8fafaa3f` "pin npm:binaryen to **132** … exactly one mapping" | its diff DELETED the 132 entries; `@*` stayed **116.0.0** (fixed `dea8ff9cf`)              |
| `456423b54` / `cec3a3381` "Gate: fmt, **lint**, ci …"           | `deno lint` failed on the committed tree, twice, from those commits (fixed `fc91cf409`)    |
| "**27** one-sided kinds outstanding", cited for 8 days          | re-derived: **11**, and none of them a rename (S5, [ir-convergence.md](ir-convergence.md)) |

**Why each survived.** Nothing downstream reads a commit message. The suite was green — but green
says nothing about what it RAN AGAINST: the binaryen tests passed on 116 because the same commit had
switched that fixture to folded WAT, which 116 also accepts. And a stale number and a wrong number
are **cited identically**; neither carries a date or a way to fail.

### How to actually check

- **A commit's effect**: `git show <sha> -- <path>`. Read the diff, not the prose. That very
  commit's own takeaway was "check `git diff deno.lock` after version archaeology" — not applied to
  itself.
- **A gate**: the EXIT CODE, per step. `check-naming.sh` prints a filename on success, which trains
  you to read gate output as prose; that habit is how a non-zero exit passed unnoticed.
- **A pin**: put the version where the tool ENFORCES it. A bare `import('npm:binaryen')` names no
  version, so the lockfile may answer anything; `const BINARYEN = 'npm:binaryen@132'` in the source
  cannot drift. `deno lint`'s `no-unversioned-import` was flagging exactly this.
- **A recorded count**: re-derive it, then make it RATCHET (`PHANTOM_BUDGET`, `ONE_SIDED_BUDGET`).
- **A cached third-party reading**: it is a claim about the past. We told wasmtk they were on
  binaryang 1.5.2, read off JSR's dependency endpoint before 1.5.3 existed and never checked against
  their own report — they were on 1.5.3 (corrected in [handoffs.md](handoffs.md) § 10). **A cached
  third-party reading beat a direct statement from the party itself.** Ask the party.

🔑 **Every one of the three was written down correctly somewhere and still decayed, because prose
has no failure mode.** The related failure in the TEST suite — a skipped test and a narrow guard
fail the same silent way — is in [testing.md](testing.md) § "Independent oracles". The difference
from the section above: that one attributes a real result to the wrong cause; this one never checks
the result.

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

### Refinement: it must fail on the BOUNDARY, not merely go red (S6, 2026-09-09)

A test that fails against the reverted fix has been shown to fail — not to test the right thing. It
could be failing on everything.

`memory64_offset.test.ts` was checked against the truncating encoder: **5 of 7 cases failed, and the
two below 2³² still passed.** That split is the evidence — it shows the test separates the values
the defect affects from the ones it does not. A test where all seven had gone red would have proved
only that something changed.

**Include cases on BOTH sides of the boundary, and read which ones flip.** This is the same
instruction the wabt-ts wing gives for guard tests — "check WHICH steps flip" — applied to a value
range rather than a set of steps.

### Refinement: a fix that NARROWS what a component acts on can make its OLD tests vacuous (S6, 2026-09-10)

A test proven to fail once stays proven only while its input still reaches the logic it guards.
Aligning LocalCSE with upstream's `isRelevant` meant a bare `local.get` is no longer cached — and
**three of its four invalidation regression tests, plus the -Oz fixture test, were built around a
repeated bare `local.get`.** All stayed green, because CSE no longer fired on them at all. With
invalidation disabled outright they STILL passed.

**After narrowing a pass, a parser, or a matcher, re-invert every regression test of that
component** — not just the new one. Here it took one env-guarded early `return` and one run. The
three were rebuilt around a relevant compound and re-verified to fail; the fixture was labelled in
its doc as no longer covering that bug, per the guard-not-coverage rule above.

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

## 🆕 Changing a field has EIGHT failure modes the compiler cannot see

**Rule: a type change is not finished when it compiles. Sweep for the eight, then let a behavioural
test and a byte gate disagree with you.**

(Seven were paid for in S6 step 4; the eighth — a numeric enum accepting the number it replaced — in
Group 2 decision 4. It has its own section below.)

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

### A conditional object SPREAD bypasses excess-property checking

The seventh mode, the only one that corrupts a WRITE, and the only one in this list that changed
emitted bytes.

```ts
...(indexOf(memory) !== 0 ? { memory } : {}),   // after `memory` was renamed to `memidx`
```

TypeScript checks excess properties on a plain object literal — which is why the `array.*`
factories, built from shorthand properties, all failed loudly on their rename. It does **not** check
them through a conditional spread. So after a rename these factories compiled clean while producing
nodes carrying a stray `memory` key and no `memidx` at all, and the encoder read `undefined` and
wrote memory 0.

⚠️ **`deno task baseline` could not see it** — the corpus has no multi-memory modules. A behavioural
test that round-trips `memory.copy` across two memories caught it as a byte difference. That is the
pairing argued for above, working in the direction that is usually the other way round.

**Grep for `\.\.\.\(.*\?\s*\{` in any file that constructs the renamed node.** A spread is the one
write shape that will not tell you.

### A field name used as a VALUE leaves the type system entirely

The sixth mode, and the one that survives even a pure rename — where the other five need a type
change to bite.

```ts
for (const k of ['ref', 'index', 'value', 'size']) assert(node[k] !== undefined);
```

A rename cannot touch a string, so this fails at RUNTIME only. Same for a field name in a map key, a
template, or a serialized shape.

⚠️ **Worse when the string guards a PRESENCE test.** Decision 4 removed `bytes` from Load/Store and
found two:

```ts
nodes.find((n) => n['bytes'] !== undefined)                          // multi_memory.test.ts
if (node.kind === ExpressionKind.Store && node.bytes !== undefined)  // narrow_store_width.test.ts
```

A presence guard converts "the field is gone" into "nothing matched" — an EMPTY result, not an
error. Both tests went red only because something downstream happened to assert non-emptiness
(`assert(store)`, `assertEquals(widths, [1])`). Find nodes by their DISCRIMINANT (`kind`), and when
a walk must read a field, make its absence THROW rather than skip.

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

🛑 **Adding a KIND is the same widening, one level up — and every private `switch` finds it first.**
Decision 5 added `ExpressionKind.Region` for what used to be unnamed wrapper `Block`s. DCE, Vacuum,
LocalCSE, SimplifyLocals and asyncify's flow each handled `Block` and let `default` return anything
else untouched — so every loop, if, try and function body would have quietly stopped being
optimized. The compiler flagged **none** of the five; a test caught one. `walk.ts` was safe only
because its `default` THROWS.

**How to apply:** before adding a kind, list every `switch (x.kind)` outside the central walker and
read each `default` — `throw` is safe, `return x` / `break` / `return false` must be judged one by
one — and grep `kind === <the kind it replaces>` and `kind !== <…>`. Both lists went into the
decision record before the code; the sweep then found exactly what they predicted.

### A numeric ENUM parameter accepts the number it replaced

The eighth mode, and the one that defeats a signature change — the move usually relied on to make
the compiler list every call site.

```ts
makeStore(bytes: 1 | 2 | 4 | 8 | 16, offset, align, ptr, value, memidx?)   // before
makeStore(opcode: Opcode,            offset, align, ptr, value, memidx?)   // after
makeStore(4, offset, align, ptr, value)   // unconverted — COMPILES
```

A numeric enum admits any number literal equal to one of its member values, and `Opcode` has members
at 1, 2, 4, 8 and 16 (`nop`, `block`, `if`, `throw`, `call`) — every width a store can have. So the
old calls type-checked as a request for a store whose opcode was `if`. A `number`-typed argument is
accepted too: asyncify's `makeStore(loadOpBytes(t), …)` passed a width straight into the opcode
slot.

`makeLoad` did NOT hide its sites — its arity changed (7 → 5 arguments), and arity is checked. **The
trial count the compiler gave (54 errors) was therefore complete for loads and blind for stores**,
and the two looked identical in the output: 15 wasm-parser errors, all loads, none of its ten
stores. The tell was an absence — a file with ten store sites reporting zero of them.

**How to apply:** when a parameter's type changes to a numeric enum (or a `number`-backed brand),
either change the ARITY or the POSITION so every old call becomes a type error, or grep every call
site of the function by name — and add a runtime check at construction (`makeStore` now validates
its opcode through `storeShape`), so any site that slipped through fails the first test that reaches
it. **Look at which files report errors, not just how many.**

### How to apply

- **Grep the five patterns before running the suite**, on the changed field: `\.<field> (===|!==)`,
  `\$\{[^}]*\.<field>\}`, `as any` / `as unknown as` / `as \{ <field>:`, `\.kind === '<arm>'`, and
  `\{ kind: '<arm>'`. Plus, for a changed PARAMETER, every call of the function by name when its new
  type is a numeric enum; and `'<field>'` / `\.<field> !== undefined` in tests.
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

### The five traps in doing it

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
  | tail` likewise exits 0 from `tail`. It happened again in decision 5 — "0
  errors (exit 1)" was a `SyntaxError` the error parser did not recognise.
- ⚠️ **A scanner that balances brackets must skip COMMENTS, not just strings.** The decision-5
  wrapper tracked quotes; the apostrophe in `// (otherwise it's a dead drop …)` opened a phantom
  string and the closing paren landed lines away. Restore the files and re-run — a patched-up
  partial result is not trustworthy.
- ⚠️ **`String.replace` / `replaceAll` with a STRING replacement is a template.** `$$` becomes `$`,
  `$&` the match, `` $` `` / `$'` the surrounding text. A replacement holding
  `` `$${ASYNCIFY_START_UNWIND}` `` wrote `` `${ASYNCIFY_START_UNWIND}` `` — a different function
  name, no error, and a test failing far from the cause. **Pass a function (`() => to`)**, which is
  literal; and after any scripted edit, audit the changed files for HEAD lines holding `$` sequences
  that no longer appear verbatim. The same family as the heredoc rule: a tool interpreting
  characters meant literally.

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

## 🆕 Make the defect UNREPRESENTABLE — and find where to do it by its compensating mechanism

**Rule: when a representation can hold an invalid state, change the representation rather than
guarding against the state. The places that need it announce themselves: look for the code that
exists only to compensate.**

Every structural decision in S6 Group 2 went this way, and the finding was the same each time — the
defect had already been caught once, and the fix had been a MECHANISM around the shape rather than a
change to it:

| representation                               | compensating mechanism                                                                | what replaced both                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| parallel `catchTags[]` / `catchBodies[]`     | an encoder length guard, whose comment names the corruption it caught                 | a record per clause — a tag cannot come apart from its body |
| `''` as the `catch_all` tag                  | none — and the parser and encoder had **disagreed** about it (`$__catch_all` vs `''`) | `tag?: Var`; absence IS catch_all                           |
| same                                         | `cfg.ts`: "the two are the same length by construction"                               | the type carries it                                         |
| `RefAsOp`, one member but typed `Opcode`     | an encoder `throw` for every value the type admitted and the kind forbade             | no field: the kind is the operator                          |
| `number` memarg offset                       | the bridge's `throw 'memory64 not supported yet'`                                     | `bigint`, and a `writeU64`                                  |
| a `Var` whose name arm meant keyword OR `$T` | four keyword-table lookups re-deriving which                                          | an `abstract` arm                                           |
| load/store as `bytes` + `signed` (+ type)    | FIVE width tables re-deriving the opcode; two of them INVERSELY rotated               | the opcode on the node, and one table deriving the rest     |
| a store opcode read off its OPERAND's type   | an encoder `throw` for an untyped operand — 5 of the bridge's 24 failures             | same                                                        |
| WAT mnemonic matched by a PATTERN            | none — `f32.load8_s` was accepted and became `f32.load`                               | exact lookup in the same table                              |

🔑 **Each mechanism was correct and each one was the problem.** A guard proves someone met the
invalid state; it does not stop the next author from producing it, and it costs every reader the
reasoning to see why it cannot fire.

### The tells — grep for these

- a length or count check comparing **two collections that are meant to move together**
- a comment saying **"by construction"**, "cannot happen", or "keep indices aligned"
- a **sentinel**: `=== ''`, `=== -1`, `'$__x'`, a well-formed value standing for "none"
- a **`not yet supported` / `unsupported`** throw on a value the type admits
- a field the code **always sets to the same value**, or tests only against one
- a value **re-derived from a DIFFERENT field** at every use (`loadOpcode(e)` switching on `e.type`)
  — each re-derivation is a copy of a table, and copies drift
- a **pattern** (regex, `includes`, `startsWith`) routing input into code that then needs a table —
  the pattern admits whatever it matches, and the table was never asked

### ⚠️ The rule already existed, and the code violated it anyway

`cmem/binaryen-ts/best-practices.md` already says it, reached independently from `funcTypes`: _"Use
a sentinel the domain cannot produce (`null`), or throw — never a well-formed value of the same
type… Then put the sentinel in the TYPE and let the compiler do the audit."_ The `catch_all` `''`
violated that for the life of the file, and a test pinned the violation as a requirement.

**A rule in a wing file is not enforced at the code sites it governs.** Nothing connects them except
someone reading both. That is the argument for the grep list above: it turns a principle into a
search that can be run.

## 🆕 A wrapper that satisfies the type checker is not evidence the value survived

**Rule: when a type is widened, fix the SOURCE of the value. A conversion at the use site that makes
the compiler quiet can carry the exact loss the change existed to remove.**

Converting memarg offsets from `number` to `bigint`, the compiler-driven pass produced — twice —
code that type-checked and preserved the truncation:

```ts
BigInt(bigintOffsetToNumber(ld.offset, 'load')); // bigint → number → bigint, through a check that
// THROWS above MAX_SAFE_INTEGER
BigInt(offset); // ×45, where `offset` came from readU32()
```

Both were right about types and wrong about values. The real fixes were one line each, at the
source: `readMemArg` calls `readU64` — which the reader already had — and the bridge passes the
bigint straight through.

### How to apply

- **After widening, grep for round trips through the old type**: `BigInt(Number(`, `Number(BigInt(`,
  a narrowing helper wrapped in the widening constructor, a `readU32` feeding a `bigint`.
- **Count the wraps.** Forty-five identical wraps of one variable means the variable is wrong, not
  the forty-five sites — the same "fix it upstream of all of them" signal as the memory-index
  conversion, where 50 errors collapsed to one change in `readMemArg`.
- **Prove the value, not the type**: a test that round-trips a value the OLD type could not hold.
  `memory64_offset.test.ts` uses 2³²+8, which `number`-via-`writeU32` maps to 8.

## 🆕 Measure blast radius by TRIALLING the change, not by grepping for the name

**Rule: when direction is decided by cost, get the cost from the compiler. Make the change, count
the errors, revert, and do the same the other way.**

Choosing between two field names, a repo-wide `.field` count said `memory` 20 vs `memidx` 67 — keep
`memory`. Trialling both renames said **10 sites vs 133**, the other way, a 13× difference. The grep
had counted `module.memory`, every memarg's `.offset`, and every unrelated `.memory` in the tree.

The asymmetry was real and explicable once measured: wabt-ts's `memidx` appears in its writers,
validators and name-resolution passes; binaryen-ts's `memory` was read almost only by its encoder.
The two names were never equally entrenched — they only looked it from outside.

### Two refinements from the same work

- **When two fields SWAP names, sequence the passes.** `table.copy` had `source` meaning the source
  TABLE on one side and the source OFFSET operand on the other. Renaming both at once makes every
  `source` site ambiguous — the compiler reports "property does not exist" without saying which was
  meant, and no script can choose. Move one field aside, verify clean, then move the other.
- **Cost does not always get the vote.** wabt-ts had `dst` (a table) beside `dest` (an operand), one
  letter apart; TypeScript itself kept suggesting _"Did you mean to write 'dest'?"_ during the
  rename. That went to the unambiguous names on SAFETY. Blast radius decides ties, and a name that
  invites the wrong field is not a tie.

## 🆕 A reservation in a comment must be checked for supersession before it is foreclosed

`RefAsOp`'s doc said _"the extern conversions are post-MVP and would be added here rather than as
separate expression kinds"_. Dropping the field foreclosed that plan — except the unified IR already
modelled those conversions as their own kinds, so the reservation had been superseded, not merely
left unused.

**Check whether a reserved extension point has been served some other way before removing it — and
say what served it in the comment left behind.** A reader who finds neither the mechanism nor an
explanation will reasonably re-add it, and the reservation will outlive a second design.

## 🆕 The local gate must BE CI's gate — a step only CI runs is a failure deferred to push time

**Rule: run every step CI runs, read from the workflow file, not from memory of it.**

S6 step 4 (`abddf1206`) left two scripts that no longer type-checked. The local gate —
`test · baseline · operators · spec · bridge` — does not run `deno task check`; `ci.yml` does, and
so does `publish.yml`. Nothing had been pushed since, so for 65 commits `main` was red by CI's
standard and green by ours, and **the first push would have failed, and so would the next publish.**

It was found by accident: decision 4's trial type-check included `scripts/`, and ten of its errors
were not decision 4's. They were confirmed pre-existing by running the same check on a `main`
worktree — not by assuming.

### How to apply

- **The gate is `grep -n "run:" .github/workflows/ci.yml`**, plus the project's own gates on top.
  Today that is
  `fmt --check · lint · check · check-naming.sh · check-portability.sh · test ·
  baseline · publish --dry-run`,
  then `operators · spec · bridge`.
- **An unpushed branch is not a tested branch.** The longer `main` runs ahead of `origin`, the more
  a CI-only step is worth running locally.
- **Run it on the tree you COMMIT, after the last edit.** Decision 5 (`365e9277c`) merged with
  `deno lint` red — the region helpers replaced the last `as BlockExpr` cast in `passes.test.ts`
  after the gate had run, and the import stayed. Found a day later by the next gate. If an edit
  follows the gate, the gate has not run.

## 🆕 A node COUNT is behaviour — a representation that adds nodes moves every threshold on it

Inlining decides by size (≤2 always, ≤10 one caller, ≤20 flexible), and size was "nodes
`walkExpression` visits". Decision 5 made every body a region node, which would have added one node
to every function and one per `if` arm — and silently changed which functions inline, with no error
anywhere. `countsTowardSize` counts a region only where upstream's IR has a node (a body of N ≠ 1
instructions), which reproduces the pre-region count exactly.

**Grep for counters over a walk (`size++`, `count++`, `measure…`) whenever a change adds or removes
nodes.** A threshold calibrated against one IR's shape is a claim about that shape.

## 🆕 Before fixing a hypothesis, TEST it — "fidelity binds" was not true

Decision 5's recorded rationale was that a single-expression body loses fidelity. Five probes
against upstream `wat2wasm` said no: source-written unlabeled blocks survived byte-for-byte, because
every parser names every real block. The rationale was overstated — and correcting it changed the
decision (neither pure form won; a new interface did). The measurement that followed found the
fidelity defects that DID exist, in a different place: the decoder invented a `nop` for an empty
body and dropped an explicit empty `else`.

**A recorded reason is a hypothesis until a probe agrees with it.** The probe costs minutes; acting
on a false reason costs the design.

### Refinement: there are TWO upstreams — probe both before attributing a difference (2026-09-10)

The empty-`else` fix was recorded as a divergence "vs wabt". Probing both later: **upstream
`wasm2wat`/`wat2wasm` DROP an explicit empty `else`; upstream `wasm-opt` KEEPS it.** So the
pre-region decoder matched wabt and differed from binaryen, and keeping it is a fidelity choice
(divergence E1), not a return to "what upstream does". Likewise `wasm-opt --vacuum` leaves one `nop`
in an all-nop body, which settled R2 as a real difference rather than an assumed one.

**A divergence row names WHICH upstream, from a probe of each.** The binaryen half is cheap: wrap
the body bytes in a one-function `() -> ()` module, run `wasm-opt in.wasm [flags] -o out.wasm` (no
flags = read → write), and compare the code-section body. Note that `-Oz` deletes an unexported
function outright — export it, or probe a single pass.

## 🆕 Every linear instruction has a folded form — add parentheses (owner rule, 2026-09-10)

**Rule: anything written linearly can be written folded by putting parentheses around the
instruction.** Folded operands are OPTIONAL; whatever an instruction consumes beyond them comes from
the stack. So `i32.add` ≡ `(i32.add)`, and `i32.const 2 i32.add` ≡ `(i32.add (i32.const 2))` when
the other operand is already there. Structured instructions fold the same way: `(block …)`,
`(loop …)`, and `(if bt foldedinstr* (then …) (else …))`, which means `foldedinstr* if bt … end` —
the condition slot holds any number of folded instructions, the last value being the condition.

**"This has no folded form" is therefore never a reason** — not to refuse input, not to justify
dropping part of it, not to rule a feature out of a parser.

The instance: I wrote that the binaryen-ts WAT parser "reads folded form only", so block PARAMETERS
— "by definition a value left on the stack by what came before" — could not be read. The owner
corrected it. Upstream wat2wasm reads all four folded spellings: an input folded before
`(block (param …) …)`, a body consuming it with a partial fold, `if` inputs in the condition slot,
and a loop back-edge. Probing those spellings then found a real defect — wabt-ts's folded `if` kept
only the LAST instruction of its condition slot and silently dropped the input (`c309e57a0`).

### How to apply

- A parser that reads folded form must read EVERY instruction parenthesised with fewer folded
  operands than it consumes, taking the rest from the stack.
- A claim about what text can express is checked against upstream `wat2wasm` before it is written
  down — it is the authority on the text format, and a probe costs a minute.

## 🆕 A pinned list must be a RATCHET, not a ceiling (S6 decision 6A, 2026-09-10)

The operators gate pinned seven phantom kinds and failed on any ADDITION. Decision 6A deleted one,
`TupleExtract` — and the gate stayed green with it still pinned. A ceiling-only budget goes stale
the moment something is fixed, and a stale entry is a hole: that same phantom could come back and
the gate would accept it as "already known".

**Every budget, allowlist, or pinned-failure list fails in BOTH directions** — on an entry that
appears and on an entry that no longer applies. Verify the second check fires by running it once
against the stale list before cleaning the list.

## 🆕 A node LITERAL beside its factory is a second copy of the factory's rules

The WAT parser built `br_if` as `{ kind: Break, type: conditional ? None : Unreachable, … }` while
`makeBreak` — used by the binary decoder for the same instruction — computed the type from the
values. The literal was wrong for every `br_if` that carries a value; the factory never was. It
surfaced only because decision 6A changed the node's fields and the literal stopped compiling.

**The tell is grep-able: `kind: ExpressionKind\.X,` outside `ir/expressions.ts`.** 43 such literals
exist. Each hand-computes a type the factory computes; each is a place the two can disagree. Prefer
the factory; where a literal must stay, the factory's rule is the one to match.

## 🆕 A fixed failure can UNMASK another — predict from counts, then check per file

Decision 4 removed a failure class accounting for 5 of the bridge's 24 failures, and the bridge went
397 → **401**, not 402. A per-file diff against `main` explained it in one line: `59_AsyncClosureCb`
had been failing at ENCODE on the removed class and now got far enough to fail at V8 in the dominant
fallthru class. Not a regression — a second defect the first one had been hiding.

**A pass count is a sum over files; diff the per-file outcomes, not the totals.** "4 fixed, 1 moved
class" and "5 fixed, 1 new regression" produce the same total.

## Where to go for the rest

The wings hold what did not converge, and it is most of the volume:

- [wabt-ts/best-practices.md](wabt-ts/best-practices.md) — ~60 further rules, each paid for by a
  named incident, plus a table of root causes that have **recurred** (with an honest note on that
  table's decaying yield). The first thing a new audit should read.
- [binaryen-ts/best-practices.md](binaryen-ts/best-practices.md) — the IR-walker and pass-authoring
  rules: close the shape not the arm, a placeholder must not be representable as real data, a value
  read and discarded is a decision.
