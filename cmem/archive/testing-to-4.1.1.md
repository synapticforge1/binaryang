# Testing — closed measurements and finished harness write-ups, to 4.1.1

Retired apparatus, the A3 offsets and diagnostic-usefulness measurements, the spec-harness first-run findings, and the 1.5.5 passes. Moved from `cmem/testing.md` on 2026-11-20 (H38 step 4).

## ✅ The `deno fmt --check` line-ending false alarm is RETIRED

The wabt-ts wing carried an elaborate apparatus for working around it: a `diff` incantation that
strips carriage returns and re-passes the project's formatter options, a scratch-checkout recipe, a
warning that `git archive` applies the same conversion, a rule to copy files aside rather than
`git stash` before revert experiments, and a note that a Python edit must preserve line endings.

**All of it is obsolete here.** `.gitattributes` pins `* text=auto eol=lf`, so `deno fmt --check`
now reports what it means. Its full text keeps those sections as history.

⚠️ **The revert-experiment habit survives the fix and is still worth keeping**: run
`git diff --stat` after any revert experiment. It is one line, and it catches a restore that
silently rewrote a file long before you read the diff. See [best-practices.md](../best-practices.md).

## ⚠️ Every test-file path in the wing full texts is DEAD

The merge normalised the naming from `foo_test.ts` to `foo.test.ts`. **Zero `*_test.ts` files exist;
all 172 are `*.test.ts`** (230 by 2026-09-12, still zero of the old form) — and the two wings
between them contained **58 references to the old form**, every one an unfollowable path.

🔧 The summaries ([wabt-ts.md](../wabt-ts.md), [binaryen-ts.md](../binaryen-ts.md), 2026-09-14) rewrote
every path to today's tree and checked it. The full texts behind their `git show` commands were not
corrected: they are not wrong about _which_ test pins an invariant, but their paths cannot be
copy-pasted. Translate the name, and confirm the file exists before citing it — two of the paths in
this very file were carried over from a wing and had to be corrected the same way.

## ✅ A3 — diagnostic offsets are MEASURED (2026-08-31)

`scripts/measure-diagnostic-offsets.ts` / `deno task offsets`. The axis was UNMEASURED, not clean,
because T13.35's oracle was broken and no replacement was built. This is the replacement.

### Why the first oracle failed, and what replaced it

T13.35 asked _is the reported offset near the corrupted byte?_ — and scored the right answer as
wrong: for a malformed multi-byte construct, reporting the **start of the construct** beats
reporting where the decoder stopped. It flagged 32 cases and every one examined was correct.

The replacement **reports a distribution, not a verdict**, because what the first attempt got wrong
was believing one number could carry the judgement. Method: flip each byte of a valid module,
decode, and record `delta = reportedOffset - corruptedByte`.

### The reading

|                                                           |                         |
| --------------------------------------------------------- | ----------------------- |
| corruptions swept                                         | 196 across five modules |
| rejected                                                  | **195 (99.5%)**         |
| accepted, and V8 accepts too (legal alternative encoding) | 1                       |
| accepted while V8 rejects — **missed rejections**         | **0**                   |

Of the 154 rejections carrying a _specific_ diagnostic: **133 land at the construct**, 21
downstream, 0 upstream.

### Three calibrations the harness needed, each of which changed the answer

1. **`pos` is the position AFTER the failing read**, so a report "at" the corrupted byte lands a
   read-width later. Treating `delta == 0` as the only good answer is T13.35's mistake in new
   clothes; the band is `1..4`.
2. **Corrupting a LENGTH field makes the reader run to end-of-input**, reporting at the buffer end.
   That delta is `length - at` — an artifact of _where_ the corruption sits, carrying nothing about
   diagnostic quality. 21 of 175 were this, and unbucketed they dominated the distribution.
3. 🚨 **Comparing our READER against V8 is an unfair oracle.** V8 decodes _and_ validates; a reader
   that defers a semantic check to the validator is not defective. The first reading claimed
   **twenty** missed rejections. Adding our validator stage dropped it to **five**. **Three quarters
   of that finding was the instrument.**

### What it found

All five survivors were the same field: **the export section accepted any byte as an export kind.**
`readExportSection` did `this.readU8() as ExternalKind` — a cast asserts a fact about the byte
instead of checking it — while the import section beside it had always carried a
`default: unknown import kind` arm. The two dispatches disagreed and only one was wrong.

Fixed, with `tests/wabt-ts/reader/export_kind.test.ts` gating it (verified to fail with the check
removed). Missed rejections **5 → 0**, and the one legal alternative encoding is still accepted.

### The blind spots, stated

- **Five hand-written modules**, not a corpus. It spans single-byte fields, multi-byte LEBs, nested
  control, GC types and element segments — and it is still five.
- **Single-byte corruption only.** Truncation, insertion and multi-byte corruption are unmeasured.
- **`delta` is not correctness.** A negative delta is usually the better diagnostic. The 21
  downstream cases are all body-internal corruption noticed at the section or function end, which is
  explainable rather than obviously wrong — nobody has judged them one at a time.
- **The accepted class outranks the offset numbers**, and the harness says so in its own output.

## ✅ Diagnostic usefulness — MEASURED (2026-09-29, open-work 16)

`scripts/measure-diagnostics.ts` / `deno task diagnostics <prepared spec dir>` (`--templates` lists
every message shape by count). Reported, not gated. The one hardening axis never attempted: not "is
the message the spec's" (wording) or "where does the reader point" (A3), but **can a user act on the
line the CLI prints?**

⚠️ **The lesson: measure what the user READS.** Wording and offsets were both green while every
binary diagnostic printed `file:0:0` — both instruments read the `loc` / `message` FIELDS, and the
renderer threw the offset away between the field and the screen. This instrument renders each
must-reject case through the tool a user would run (`wat2wasm`; `wasm-validate`), with a filename,
exactly as `formatErrors` prints it, and scores the first error line.

| over the spec's 4,654 must-reject cases              | before  | after    |
| ---------------------------------------------------- | ------- | -------- |
| decode diagnostics LOCATED                           | 0%      | 99.6%    |
| validate diagnostics LOCATED                         | 0%      | 98.6%    |
| a PLACEHOLDER subject (`type mismatch in opcode`)    | 420     | 0        |
| malformed binaries reporting more than one error     | 81      | 0        |
| a JS-internal leak / a throw instead of a diagnostic | 0 / 0   | 0 / 0    |
| spec wording agreement (parse · decode · validate)   | 811 · 693 · 2465 | unchanged |

The defects, DG1–DG6 in [divergences.md](../divergences.md): the renderer's location (DG1), the
placeholder subjects (DG2), the reader never stopping at its first error because `stopOnFirstError`
defaulted the wrong way and `wasm-validate` validating a half-decoded module (DG3), `wasm-opt` not
validating its input and so blaming the optimizer (DG4), and the source line + caret the CLI now
prints under a text error. Each fix was inverted alone against `diagnostic_usefulness.test.ts`: 8
mutants, 8 killed, each by its own test. The first fixture for DG3 let its mutant survive — once
the reader stops early, a module truncated after its last body gives the validator nothing to
object to; a cut INSIDE the code section does.

**The blind spots, stated:**

- **Mechanical properties only.** Located / named / clean / alone say a message is usable, not that
  it is the clearest one. `--templates` groups ~4,600 messages into ~200 shapes for a person to read;
  no person has read them yet.
- **40 cases are still unlocated**: `duplicate export` (20) and index-out-of-range on exports — the
  export entries carry no location — plus 3 `unexpected end of binary` at offset 0.
- ~~`wasm-opt` on WAT shows no position for a validation error~~ — ✅ since DG5 closed (the same
  day), a WAT input is validated as text, at `line:col` with the source line.
- **The CLI's flags and usage messages are unmeasured** — only diagnostics on bad modules.

### First run: the must-reject axis came out strong

Fail-loud holds up under a suite designed to attack it.

| axis                           | result                 |
| ------------------------------ | ---------------------- |
| modules ACCEPTED (must accept) | 1951 / 1955 · 99.8%    |
| `assert_invalid` REJECTED      | 2420 / 2422 · 99.9%    |
| malformed BINARY rejected      | 711 / 711 · **100%**   |
| malformed TEXT rejected        | 1156 / 1156 · **100%** |

227 of 257 files; the 30 skipped were GC-proposal files `wast2json` 1.0.41 cannot split (G2, closed
below).

### All six findings closed by ONE fix — `427c18fbb`

SP1–SP4 were one root cause. **`BlockType`'s value case was typed `Type`** — a flat numeric enum
whose values are single wire bytes. A typed reference does not fit: `(ref ht)` encodes as `0x64`
FOLLOWED BY a heap type. The reader took the tag and left the heap index in the instruction stream,
where the next decode step consumed it as an OPCODE:

```
(block (result (ref 0)) (ref.func 0))
  upstream : block (result (ref 0)) / ref.func 0
  ours     : block <type 100> / UNREACHABLE / ref.func
```

🔑 **BYTE EQUALITY IS NOT SEMANTIC EQUALITY, and this is the proof.** It round-tripped
byte-identically — the writer emitted that phantom `unreachable` as the very byte it had been
mis-read from, so the two halves of one gap concealed each other. **The corpus round trip at 421/421
byte-identical, the strongest signal this project had, was blind to an IR containing an instruction
the program does not have.** A phantom `unreachable` makes everything after it dead code, so any
pass reading that IR reasoned about a different program. The spec suite saw the same gap from the
other side: a heap index never stored can never be range-checked, so two INVALID modules were
ACCEPTED, and SP1–SP3's "type mismatch" errors were the missing heap type breaking type-checking
downstream.

| axis                      | after                  |
| ------------------------- | ---------------------- |
| modules ACCEPTED          | 1955 / 1955 · **100%** |
| `assert_invalid` REJECTED | 2422 / 2422 · **100%** |
| malformed BINARY          | 711 / 711 · **100%**   |
| malformed TEXT            | 1156 / 1156 · **100%** |

### SP5 — and the finding as first written was half wrong

It was recorded as "`Features.compactImports` and `.wideArithmetic` are declared but the binary
reader does not implement them" — one claim covering two unrelated situations, and **neither had
been checked**.

- ✅ **`wideArithmetic` is FULLY implemented in wabt-ts** — `i64.add128` / `sub128` / `mul_wide_s` /
  `mul_wide_u` decode, validate, write and round-trip byte-identically.
- ⚠️ **`compactImports` was worse than unimplemented**: declared, settable, returned `true` by
  `allFeatures()`, and read by nothing. Enabling it changed nothing.

Fixed by making the flag TRUTHFUL rather than implementing the proposal, which is not planned — V8
needs `--experimental-wasm-compact-imports` to load such a module at all. The reader names the
proposal instead of `unknown import kind: 127`, and the field says plainly that setting it does
nothing. Kept rather than removed, because `Features` is public surface.

The one real gap it surfaced — wide arithmetic refused by binaryen-ts's binary reader
(`unsupported bulk-memory/table opcode: 0xFC 0x13`) — was assigned to S5 and **dissolved by it**
(re-probed 2026-09-12): `(i64.add128 …)` assembled by upstream `wat2wasm --enable-all` decodes
through binaryen-ts and re-encodes **byte-identically** (40B → 40B). ⚠️ Checked rather than assumed:
a shared KIND does not imply a decoded OPCODE.

🔑 **A feature flag is not an implementation** — the third "declared is not implemented" of that
session, after `ExpressionKind` members with no factory and four stale `not yet supported` blockers.
And about the FINDING: a two-part claim written from one observation. **The half with evidence was
true; the inferred half was false.**

### ✅ G2 — all 257 files run (2026-09-11, `ddfe1a475`)

`spec-prepare` falls back to `wasm-tools json-from-wast` for the 30 files `wast2json` 1.0.41 cannot
split, and the harness reads its command types: `module_definition` (a module's obligation — accept
it), and modules or `assert_invalid` cases given as **TEXT**, where `wast2json` only ever emitted
binaries. A text module is assembled and then decoded and validated, because `wat2wasm` does not
validate.

| axis                      | was (227 files) | now (257 files)        |
| ------------------------- | --------------- | ---------------------- |
| modules ACCEPTED          | 1955 / 1955     | **2248 / 2248 · 100%** |
| `assert_invalid` REJECTED | 2422 / 2422     | **2714 / 2714 · 100%** |
| malformed BINARY          | 711 / 711       | **711 / 711 · 100%**   |
| malformed TEXT            | 1156 / 1156     | **1229 / 1229 · 100%** |

🔑 **The 30 missing files were the least safe thirty to be missing**: they test the GC proposal —
the one thing this toolchain implements and upstream wabt cannot judge at all (G1, G3). The new
ground is 293 must-accept modules, 289 must-reject modules and 73 must-reject texts, and **all of
them passed on the first run.** ⚠️ **"No misses" on brand-new coverage is the shape of a harness
that is NOT RUNNING** — so it was proved otherwise: run over those 30 dirs alone they account for
exactly those counts, and corrupting one accepted module plus making one `assert_invalid` case valid
makes the harness report both.

## The 1.5.5 passes — the code lens, summarized

Seven passes on 2026-09-02; the plan and the lens definitions for 1.5.6 / 1.5.7 are in
[open-work.md](../open-work.md). Full per-pass register: `git show f2ee1a41f:cmem/quality-passes.md`.

**The method that found things here** — greps found NOTHING (no live TODOs; all four "impossible"
comments self-aware). What worked was **strengthening an existing metric**: the corpus asked whether
binaryen-ts re-encodes _without throwing_ (421/421, green for months); asking whether the result
_validates_ read 383/421. 🔑 **Look for a check whose PREDICATE is weaker than its name** —
"round-trips" that only assert no-throw, "agrees" that only compares lengths, counts of files
processed rather than files correct. And when a metric is raised, re-derive every number that
depended on it.

| pass | commit                   | what it found                                                                                                                                                                                                                                             |
| ---- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `eb47a817a`              | memarg alignment is an EXPONENT, and its default was wrong the other way; `return` / `br` kept only their first value; `storeBytes` had drifted from `loadBytes`                                                                                          |
| 2    | `7520be44d`              | `parseElem` was a stub that emptied every function table (still valid, then every `call_indirect` trapped); anonymous functions all synthesized as `$f0`, so `(call 1)` became infinite recursion from valid input                                        |
| 3    | `9b98a2963`, `8ffbae8ee` | two "size deltas" were a **silent miscompile** (a synthetic loop wrapper shadowing the function frame) and **silent data corruption** (a byte string UTF-8 encoded)                                                                                       |
| 4    | `cf2ebc565`              | `memory.init` / `data.drop` and the data count section, done together because either alone is a wrong module; six `ExpressionKind` members had nothing behind them                                                                                        |
| 5    | `ea3c7cf17`              | orphan type entries — the predicate is "does it write a blocktype", not "is it a block"                                                                                                                                                                   |
| 6    | `51f48fcf0`              | C9, one IR gap behind four symptoms: `ElementSegment.mode` — unblocked passive and declarative segments, `table.init`, `elem.drop` and six `0xFC` ops                                                                                                     |
| 7    | `38607ae6c`              | export ORDER, the last byte difference; five never-run probe classes, which found that our linear output could not be re-read (C10, first routed through the bridge `5d95857b8`, superseded by W4's `8033ca3c0`; C10a absorbed into S6 by owner decision) |

| measure             | before       | after pass 7  |
| ------------------- | ------------ | ------------- |
| re-encode validates | 383 / 421    | **421 / 421** |
| byte-identical      | 1 / 421      | **421 / 421** |
| total size delta    | +24107 bytes | **0 bytes**   |

**Lessons it paid for**, beyond the method:

- **A size delta is not a cosmetic finding.** Both "bytes, probably benign" items in pass 3 were
  wrong output; the size was the symptom that was easy to measure. And each hid behind a natural
  fixture — a one-statement loop needs no wrapper, and ASCII round-trips through UTF-8 unchanged.
- **Unexplained is not benign.** C6–C8 stayed open as unexplained size deltas; two of them were the
  miscompile and the corruption.
- **When testing an INDEX path, the fixture must be anonymous** — a probe using named targets came
  back clean, because calls by name never touch the synthesized spelling. The named case is the
  control.
- **An enum member is not evidence of an implementation**, and a **central walker whose `default`
  throws** is what caught every omitted kind.
- **A guard can be holding up code that has never run**: lifting C9's refusal exposed an `flags & 2`
  test that was right only while declarative segments were unreachable.
- **When a test asserts a REFUSAL, write down what stays true once the refusal is lifted** — the
  third time a test pinned a limitation so that removing it read as a regression. The unknown-`0xFC`
  test moved to an unassigned sub-opcode; the passive-segment test now requires the untouched slot
  to TRAP.
- **No check that inspects a SET can see ORDER**: the interface comparison passed 421/421 while
  every function's export landed after every other kind's. It took a byte comparison.
- **A blocker naming a version is a dated assertion, not an invariant** — four stale "binaryen-ts
  v1.0.9 lacks X" blockers made a whole route look impossible, and one refused 417 of 421 modules.

