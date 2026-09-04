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

### Pass 2 — 2026-09-02, `3e808b99b`

Worked the C1–C5 register. **Also did not converge**, but the residue is now characterised rather
than unknown.

**Fixed — C1, C3, and three neighbours the register had not seen:**

| what                                                        | why it mattered                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`parseElem` was a STUB** — _"complex; skip for MVP"_      | not a missing feature but SILENT WRONG BEHAVIOUR: every element segment dropped, so a module's function table re-encoded EMPTY. It still validated — an empty table is valid — and every `call_indirect` then trapped at run time                                                                                                               |
| an **anonymous table** was never registered in `tableNames` | `call_indirect` with no explicit table fell through to a `'$0'` sentinel matching nothing                                                                                                                                                                                                                                                       |
| a numeric function reference rebuilt `$f{n}`                | right only when that function is anonymous. **Third occurrence** of reconstructing a name instead of resolving an index, after the branch labels and the tag references                                                                                                                                                                         |
| `funcIndex` came from `funcNames.size`                      | which counts imports and NAMED definitions only — so **every anonymous function was synthesized as `$f0`**. They collided in the encoder's index map, and `(call 1)` in an all-anonymous module resolved to the first function, which when the caller was also anonymous was the CALLER: **infinite recursion from valid input, no diagnostic** |

⚠️ **That last one was hiding behind the one above it, and a probe using NAMED targets came back
clean.** Calls by name never touch the synthesized spelling. When testing an index path, the fixture
has to be anonymous — the named case is the control, not the test.

**A `ref.null` hole in an element segment is now REFUSED**, not dropped: the IR's `data` is a list
of function names with no way to spell "empty", so dropping one would shift every later entry down
and silently rewire the dispatch table.

### Reclassified

🔧 **C2 is a FEATURE GAP, not a code defect.** `memory.init`, `data.drop`,
`table.init/copy/fill/size/grow` are unimplemented — but every one of them **fails loud**
(`unsupported instruction`), which is the contract. Verified individually. `memory.copy` and
`memory.fill` are implemented and produce correct results. The 1.5.5 lens is "wrong on valid input";
refusing loudly is not wrong.

🔧 **C4 follows C2 and is harmless today.** `datacount` is only _required_ when a bulk-memory op is
present, and those are exactly the ops we refuse. It remains coupled: **whoever implements C2 must
emit `datacount` in the same change.**

🔧 **C5 is downgraded, not closed.** The byte differences are representational so far as measured:
**exports and imports are identical on 421/421**, and the smallest differing module differs only in
inline-vs-standalone export spelling, which is the same module either way. The section-size residue
is not yet explained, so it stays open as C6–C8 rather than being declared benign.

### ⬚ Open after pass 2

| #  | finding                                                                                                                    | state                                    |
| -- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| C2 | bulk-memory and table ops unimplemented                                                                                    | ⬚ feature gap, fails loud — do with C4   |
| C4 | `datacount` not emitted                                                                                                    | ⬚ harmless until C2 lands, then required |
| C6 | **code section is +24107 bytes across 418 modules** (~58 each) — not local-decl coalescing, which binaryen-ts already does | ⬚ unexplained                            |
| C7 | type section +643 bytes across 111 modules                                                                                 | ⬚ unexplained, likely dedup              |
| C8 | data section +432 bytes across 47 modules                                                                                  | ⬚ unexplained                            |

⚠️ **C6–C8 are size deltas, not known defects** — the modules validate, run, and keep their whole
interface. They are open because _unexplained_ is not the same as _benign_, and both C1 and C4 were
found inside exactly this residue.

### Pass 3 — 2026-09-02, `9588504bd` + `ff9a383d2`

Chased C6–C8. **Both turned out to be correctness bugs wearing a size delta as a disguise**, which
is the finding worth keeping from this pass.

| was filed as                       | actually was                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C6** — code section +24107 bytes | a **SILENT MISCOMPILE**. A multi-statement loop body is wrapped by `oneOrTypedBlock` in a synthetic unnamed `Block`. Encoding it emitted a real nested block, and because the wrapper is unnamed it went on the label stack as `''` — the same sentinel as the FUNCTION FRAME — and shadowed it. `(loop $l (nop) (br 1 …))` returned the fallthrough value instead of branching out. Valid module, wrong answer |
| **C8** — data section +432 bytes   | **SILENT DATA CORRUPTION**. `parseData` UTF-8 encoded a BYTE string, so every escape above 0x7f widened into two bytes — the UTF-8 encoding of the character with that code point, so the single byte F0 became the two bytes C3 B0. Floats and packed binary in data segments came out wrong, and the module still validated because data is opaque                                                            |

🔑 **A size delta is not a cosmetic finding.** Both of these were filed as "bytes, probably benign"
and both were wrong output. The size was the _symptom that was easy to measure_, not the defect.
Nothing else had noticed either one.

**Two more instances of the pattern this file already names:**

- C6's rule ALREADY EXISTED — `if` arms and `catch` handlers went through `encodeRegionBody`. `Loop`
  and `try_table` called `encodeExpr` directly and the function body open-coded a third copy. **The
  copies are what let the two omissions look normal.** All four now share the one helper.
- Both defects had a case that hid them: a ONE-statement loop needs no wrapper, and **everything
  ASCII round-trips through UTF-8 unchanged**. A natural fixture for either — a simple loop, a
  readable data string — passes either way.

### Results

| measure                  | pass 1 start           | now              |
| ------------------------ | ---------------------- | ---------------- |
| re-encode validates      | 383 / 421              | **421 / 421**    |
| byte-identical to source | 1 / 421                | **140 / 421**    |
| total size delta         | +24107 (code alone)    | **−176 bytes**   |
| corpus sections lost     | `datacount`, `element` | `datacount` only |

### ⬚ Open after pass 3

| #  | finding                                                                                                 | state                                                                                                                                                                                                                                                         |
| -- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C2 | bulk-memory and table ops unimplemented                                                                 | ⬚ feature gap, fails loud — do with C4                                                                                                                                                                                                                        |
| C4 | `datacount` not emitted (273 modules, −273 bytes)                                                       | ⬚ harmless until C2 lands, then required                                                                                                                                                                                                                      |
| C7 | an **orphan type entry** is appended for a multi-value function's result type (111 modules, +643 bytes) | ⬚ characterised and benign: the entry is unreferenced, appended last so no index shifts, and the module validates and behaves identically. Wasted bytes, not wrong output — but **C6 and C8 were also filed that way**, so it is left open rather than closed |

**Pass 3 did not converge either**, though what remains is now one feature gap (C2/C4) and one
characterised inefficiency (C7), rather than unknowns.

### Pass 4 — 2026-09-02, `c0d79b56d`

**C2 and C4 done together**, which was the point of recording them as coupled.

`memory.init` / `data.drop` are only valid alongside a **data count section**, and it must precede
the code section — a single-pass validator needs the segment count while type-checking those
instructions, which is the entire reason the section exists. Shipping either half alone produces a
wrong module.

**Implemented end to end** — IR interface, factory, encoder case, parser case, and BOTH IR walkers —
for `memory.init`, `data.drop`, `table.size`, `table.grow`, `table.fill`, `table.copy`.

⚠️ **Six of these existed as `ExpressionKind` enum members with nothing behind them** — no
interface, no factory, no encoder case, no parser case. Exactly the shape `TupleExtract` had. **An
enum member is not evidence of an implementation**, and this is the second time that assumption has
cost something here.

🔑 **The central walker caught every omission.** `walkExpression` and `mapExpression` throw on an
unhandled kind rather than defaulting, so each new expression failed loudly until both were
extended. A silent `default:` would have let the ops through with their children invisible to every
pass.

**Declarative and passive ELEMENT segments are now REFUSED rather than dropped.** `ElementSegment`
has no mode field and the encoder writes kind 0 unconditionally, so storing one would emit it as
ACTIVE — writing into the table at instantiation when the source forbade it. ⚠️ Dropping was **worse
than refusing**: `elem
declare` encoded a module that then failed validation downstream with
`undeclared reference to function`. A refusal at the layer that knows why beats a diagnostic three
layers later that names a symptom.

`table.init` and `elem.drop` remain unimplemented and keep failing loud — same IR gap, and honest
about it.

### Results

| measure                  | pass 1 start | after pass 3 | now           |
| ------------------------ | ------------ | ------------ | ------------- |
| re-encode validates      | 383 / 421    | 421 / 421    | **421 / 421** |
| byte-identical to source | 1 / 421      | 140 / 421    | **309 / 421** |
| total size delta         | +24107       | −176         | **+643**      |

The remaining +643 is **exactly C7**, the orphan type entries — the only measured difference left
between our encoder's output and wabt-ts's.

### ⬚ Open after pass 4

| #  | finding                                                                                     | state                                                                                             |
| -- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| C7 | an orphan type entry appended for a multi-value function's result (111 modules, +643 bytes) | ⬚ characterised, benign, unreferenced — but still open                                            |
| C9 | `table.init` / `elem.drop`, and declarative/passive element segments                        | ⬚ **one IR gap, not four findings**: `ElementSegment` has no mode field. All four fail loud today |

### Pass 5 — 2026-09-02, `d706fffa1`

**C7 closed**, and with it the last measured difference between this encoder's output and wabt-ts's.

`collectExprTypes` registered a type for ANY multi-value-typed expression. Only a CONTROL construct
writes a blocktype, and a blocktype above the inline forms is an index into the type section — so
everything else registered an entry nothing could reference.

⚠️ **The case that fired was subtler than "any expression".** A multi-value FUNCTION's body is
wrapped by `oneOrTypedBlock` in a synthetic unnamed `Block` carrying the function's result type.
That wrapper IS a block by kind, but `encodeRegionBody` inlines it, so it never writes a blocktype.
So the predicate is not "is it a block" but **"does it write a blocktype"** — and
`isBlockTypeCarrier` now encodes the same fact `encodeRegionBody` does. They are placed to be read
together: drifting apart gives either a missing type (an unresolvable index) or an orphan one.

### The invariant battery, re-run in full

| invariant                                 | result        |
| ----------------------------------------- | ------------- |
| our assembled bytes validate              | 421 / 421     |
| folded text is a fixpoint                 | 421 / 421     |
| linear text is a fixpoint                 | 421 / 421     |
| binaryen-ts re-encode validates           | 421 / 421     |
| exports + imports preserved               | 421 / 421     |
| every section size matches                | 421 / 421     |
| **re-encode is BYTE-IDENTICAL to source** | **420 / 421** |

The single outlier is `1_helloWorld_wat.wat`, and it differs only in export ORDER — same length,
same exports, every section size equal. Representational, and the interface check covers what would
matter.

### 🔑 Where 1.5.5 stands

**The battery has converged: pass 5 turned up nothing that pass 4 had not already named.** That is a
real milestone and it is NOT the same as "no code issues remain" — it means _these invariants_ no
longer discriminate. Every defect found in passes 1–5 came from strengthening a check or inventing a
new one, so the honest statement is:

> Converged against the invariants listed above. A new probe class could still find something, and
> three of the five passes were opened by exactly that.

⬚ **C9 remains and is a DESIGN decision, not a defect**: `ElementSegment` has no mode field, so
`table.init`, `elem.drop`, and declarative and passive element segments cannot be represented. All
four fail loud. Adding a mode field is an IR change with an encoder change behind it — worth doing
deliberately, not as the tail of a bug hunt.

**Cumulative, passes 1–5:**

| measure             | before       | after         |
| ------------------- | ------------ | ------------- |
| re-encode validates | 383 / 421    | **421 / 421** |
| byte-identical      | 1 / 421      | **420 / 421** |
| total size delta    | +24107 bytes | **0 bytes**   |
| defects fixed       | —            | **13**        |

### Pass 6 — 2026-09-02, `a33c94655`

**C9 closed.** It was ONE IR gap standing behind four symptoms, not four findings — `ElementSegment`
had no mode field, so the encoder wrote kind 0 (active, table 0) unconditionally and passive and
declarative segments could not be represented at all.

Adding `ElementSegment.mode` unblocked every one of them: the WAT parser stores the non-active
modes, the encoder writes the right kind, the BINARY parser reads all four, and `table.init` /
`elem.drop` are implemented end to end. The binary reader also gained the six other `0xFC` ops it
was refusing, so the loop now closes in both directions.

⚠️ **A latent bug surfaced the moment the refusal was lifted.** The binary reader tested for an
explicit table index with `flags & 2`, which would consume an index from a declarative segment
(flags 3), which has none. That expression was correct _only while the refusal made flags 3 and 7
unreachable_. **A guard can be holding up code behind it that has never run.** Removing one means
re-reading what it was gating, not just deleting it.

### 🔁 Four tests pinned the refusals as contracts — two written the day before

`memory.init is rejected`, `a passive segment throws`, and two of my own from the previous commit.
Each was rewritten to assert the CAPABILITY while keeping the property the refusal stood in for:

- an unknown `0xFC` sub-opcode must **still** fail loudly, so that test moved to an unassigned
  sub-opcode rather than being deleted;
- a passive segment must **still not** populate the table at instantiation — checked by executing
  the module and requiring the untouched slot to TRAP.

🔑 **This is the third time in this project a test has pinned a limitation so that removing the
limitation reads as a regression.** The pattern is now frequent enough to name a rule: when a test
asserts that something is REFUSED, write down in the test what would still be true after the refusal
is lifted. The two rewritten here could keep their guarantee precisely because the original comments
said what the refusal was protecting against.

### ⬚ Open after pass 6

**Nothing from the register.** C1–C9 are all closed or reclassified.

|                                   |                               |
| --------------------------------- | ----------------------------- |
| the one non-byte-identical module | export ORDER only — see below |

⚠️ **The export-order difference is now understood** and it is not "declaration order" as an earlier
note said. It is PHASE order: `collectMemory` adds a memory's inline export during the parser's
FIRST pass, while `buildFunc` adds a function's during the THIRD (body building). So a function's
inline export is always emitted after every memory/global/table/tag one, whatever the source order.
Semantically irrelevant — exports are looked up by unique name, and the interface check passes
421/421 — but it is the last byte difference, and it is a one-line-per-site fix (collect a
function's inline exports when the declaration is seen, not when its body is built).

## Where the numbers live

`cmem/open-work.md` holds the release-facing list. This file holds the pass bookkeeping, because
"until no more turn up" needs a record of what each pass looked for and found — otherwise
convergence cannot be distinguished from fatigue.
