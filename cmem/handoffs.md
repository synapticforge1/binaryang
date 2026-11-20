# Handoffs — correspondence with the sibling repositories

> Summary: the convention for coordinating with the sibling repositories, and the lessons the
> correspondence paid for. No letter is open; every sent, answered or closed letter is in
> [archive/handoffs-to-4.1.1.md](archive/handoffs-to-4.1.1.md). Last verified 2026-11-20.

**The convention, and it is live:** nothing is ever written into a sibling repository from this one
— not `../binaryen-ts/`, `../wabt-ts/` or `../wasmtk/`. A change another repo owns is drafted here
and handed to the owner to send; the fix lands in the repo that owns the file. binaryen-ts kept that
boundary when it drafted handoffs to wabt-ts instead of editing their tree, and wabt-ts kept it in
return. During a merge the habit of respecting repo boundaries is the first thing to erode and the
last thing anyone notices eroding. New drafts go at the end of this file.

§ The log (§ 1–27, the table; § 3, § 4, § 9, § 10 are its rows): moved to [archive/handoffs-to-4.1.1.md](archive/handoffs-to-4.1.1.md)

§ 26, § 27, § 41, § 43 (and every other "### § N" letter heading, § 15–47): moved to [archive/handoffs-to-4.1.1.md](archive/handoffs-to-4.1.1.md)

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
