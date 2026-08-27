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
`core.autocrlf=true` *explicitly forced on* still reports `eol: lf` and passes `deno fmt --check`.
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
theory. `grep -c $''` and `od -c | grep -o ''` both match a literal `r` in a BRE — so files
were reported as full of carriage returns when they held none, and the numbers moved plausibly
because the letter `r` is common.

**Trust the tool that is actually failing.** `deno fmt --check` going from `32 not formatted` to
`Checked 283 files` was the only unambiguous signal in the whole episode. A hand-rolled measurement
built to confirm a hypothesis usually will.

### Applying it beyond line endings

Ask of any tool whose result differs between two machines: **what setting decided that, and is it in
the repo?** Formatter width, lint rules, TypeScript strictness, Node version, test-runner
concurrency. Every one of them has a machine-level default that will silently disagree with CI.

## Where to go for the rest

The wings hold what did not converge, and it is most of the volume:

- [wabt-ts/best-practices.md](wabt-ts/best-practices.md) — ~60 further rules, each paid for by a
  named incident, plus a table of root causes that have **recurred** (with an honest note on that
  table's decaying yield). The first thing a new audit should read.
- [binaryen-ts/best-practices.md](binaryen-ts/best-practices.md) — the IR-walker and pass-authoring
  rules: close the shape not the arm, a placeholder must not be representable as real data, a value
  read and discarded is a decision.
