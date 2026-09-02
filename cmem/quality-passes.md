# Quality passes — 1.5.5, 1.5.6, 1.5.7

A three-version plan, agreed 2026-09-02. Each version adds a LENS and re-runs every lens below it,
and each lens repeats until a pass turns up nothing new:

| version   | lenses, in order                            |
| --------- | ------------------------------------------- |
| **1.5.5** | code                                        |
| **1.5.6** | hardening → then code again                 |
| **1.5.7** | security → then hardening → then code again |

The re-runs are the point: fixing a hardening issue can introduce a code issue, so the lower lenses
are not "already done".

## What separates the three lenses

Without definitions, 1.5.6 just repeats 1.5.5. These are the working ones — if a finding fits two,
file it under the **lowest** lens that would have caught it.

| lens          | question                                    | examples from this codebase                                                                                                 |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **code**      | is it WRONG on valid input?                 | wrong bytes, dropped information, logic contradicting its own docs, one fact duplicated in two places that drifted          |
| **hardening** | does it survive HOSTILE or malformed input? | truncated binaries, absurd section counts, deep nesting, a panic where a typed error is the contract, unbounded work        |
| **security**  | can a consequence be EXPLOITED?             | unbounded allocation from an attacker-controlled length, path traversal in a CLI, ReDoS, integer overflow reaching an index |

## ⚠️ The method that actually finds things here

Grep for suspicious patterns found **nothing** on the first 1.5.5 pass: no live TODOs, and all four
"impossible"/"cannot happen" comments were self-aware. This codebase is disciplined in the ways that
greps detect.

**What worked was strengthening an existing metric.** The corpus check asked whether binaryen-ts
re-encodes _without throwing_ — 421/421, green for months. Asking instead whether the result
**validates** read 383/421. Same corpus, same code, three real defects.

🔑 **So the highest-yield move is to look for a check whose PREDICATE is weaker than its name
suggests.** "Round-trips" that only assert no-throw. "Agrees" that only compares lengths. A count of
files processed rather than files correct.

Corollary: when a metric is raised, re-derive every number that depended on it rather than carrying
it forward.

## 1.5.5 — code

### Pass 1 — 2026-09-02, `e662bd099`

**Method:** a battery of corpus invariants, three of which had never been run.

| invariant                                         | result                   |
| ------------------------------------------------- | ------------------------ |
| our assembled bytes are a valid module            | 421/421 ✅               |
| folded text is a fixpoint (disasm → asm → disasm) | 421/421 ✅               |
| linear text is a fixpoint                         | 421/421 ✅               |
| binaryen-ts re-encode **validates**               | **383/421 → 421/421** 🔧 |

**Fixed — three defects, all in the binaryen-ts WAT parser:**

1. **memarg alignment is an EXPONENT, not a byte count.** `align=N` in text is a byte count; the IR
   and binary hold log2 of it. `i64.store align=4` encoded 4 — sixteen bytes — and was rejected by
   every engine. 5 parse sites.
2. **the alignment DEFAULT was wrong the other way.** Absent `align=`, WAT means natural alignment;
   the parser used 0. ⚠️ That half produces a **valid** module, so only a byte comparison catches it
   — and `i32.store8` hides it by having a natural alignment of 1, which is what the wrong default
   was.
3. **`return` and `br` carried only their FIRST value.** Multi-value targets lost the rest silently.
   `TupleMake` is the container and needed no new machinery.
4. **`storeBytes` had drifted from `loadBytes`** — missing the `v128` line, so `v128.store` fell
   through to 4.

### ⬚ Pass 1 findings NOT yet fixed

Found by probing beyond the corpus. None are exercised by the 421 modules, which is why the corpus
is green and these are still open.

| #  | finding                                                                                                                                                                                                                                                   | evidence                                                 |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| C1 | **`elem declare func $f` is dropped**, so a later `ref.func` is rejected: _"undeclared function reference"_. The module still VALIDATES when nothing uses the ref, which is why it hid.                                                                   | 45 corpus modules lose an `element` section on re-encode |
| C2 | **`memory.init` / `data.drop` are unsupported** by the WAT parser — _"unsupported instruction"_. Bulk-memory ops.                                                                                                                                         | direct probe                                             |
| C3 | **`call_indirect (type $t)` with an implicit table 0** fails with _"unresolved call_indirect table reference"_; the table defaults to 0 when unnamed.                                                                                                     | direct probe                                             |
| C4 | **the `datacount` section is dropped** on re-encode (273 corpus modules). Legal when no bulk-memory op uses it — but it becomes a correctness bug the moment C2 is fixed.                                                                                 | section-inventory diff                                   |
| C5 | **binaryen-ts's re-encode is byte-identical to source on only 1/421.** Two encoders may legitimately differ, but this has never been characterised, so it could be hiding loss that validation does not catch. C1 and C4 were both found inside this gap. | section-inventory diff                                   |

⚠️ **C4 and C2 are coupled**: `datacount` is only _required_ when a bulk-memory op is present, so
dropping it is currently harmless precisely because C2 means we cannot parse those ops at all.
Fixing C2 without C4 would produce invalid modules. Fix them together.

**Pass 1 is NOT complete** — a pass ends when it turns up nothing new, and this one ended with five
open findings.

## Where the numbers live

`cmem/open-work.md` holds the release-facing list. This file holds the pass bookkeeping, because
"until no more turn up" needs a record of what each pass looked for and found — otherwise
convergence cannot be distinguished from fatigue.
