# Open work

The single list of what is outstanding. Re-derived against live JSR and GitHub state 2026-08-31; `binaryang@1.5.3` published, score 100.

Kept here rather than in a version scope file because most of it is not scoped to a release yet, and
a list split across three documents is a list nobody reads. Version-specific status stays in
[scope-1.5.2.md](scope-1.5.2.md); the retirement ladder stays in [transition.md](transition.md).

## Owner actions — nothing here is blocked on code

| # | item | note |
| - | ---- | ---- |
| 1 | **Create `RELEASE_PAT`** | Fine-grained, Contents: read/write, **owned by a JSR scope member**. Until it exists every release needs a manual tag re-push — see [publishing.md](publishing.md) § "ROOT CAUSE". |
| 2 | **JSR descriptions on both predecessors** | Still `binaryen rewritten in typescript` / `rewrite of wabt in typescript`. Editable now; first line a consumer sees. |
| 3 | **GitHub descriptions on both predecessors** | Frozen by the archive — needs unarchive → edit → re-archive. Judgement call. |
| 4 | **D2 — JSR `isArchived`** | Deferred by choice. Low-risk: archiving the GitHub repos already removed the publish path. |

## ⚠️ `main` carries an UNRELEASED behaviour change

`deno.json` reads **1.5.3**, which is what is published — correct, and the reason nothing has
auto-published since. But `main` is 13 commits past the `v1.5.3` tag, and **one of them changes
shipped behaviour**: `9b54db228`, the export-kind check found by A3. Twelve are `cmem/` only.

**It is a rejection that did not previously happen.** A consumer feeding binaryang a module with an
out-of-range export kind used to get a decoded module; now they get a diagnostic. That is the
fail-loud contract working, and it is still a behaviour change — the same class wabt-ts recorded
when feature-gating the validator turned silent acceptance into rejection.

**The decision is whether to cut 1.5.4**, and it is not automatic:

- **for** — it is a correctness fix, and a released fix nobody can consume is not a fix;
- **against** — wasmtk pins an exact version and would need their own bump to see it either way,
  and nothing is blocked on it.

Nothing forces the choice today. **What must not happen is the bump being made incidentally**: the
version line is what arms the release, so bumping it "to keep main tidy" publishes. See
[publishing.md](publishing.md).

## Conformance gaps — the wasmtk-ranked list, restated with current status

Ranking agreed in [handoffs.md](handoffs.md); status re-derived 2026-08-31.

| rank | gap | status |
| ---- | --- | ------ |
| 1 | `br_on_cast` (+ `br_on_cast_fail`) | ✅ **shipped in 1.5.3** |
| 3 | `br_on_null` / `br_on_non_null` | ✅ **shipped in 1.5.3** — they rode along with rank 1, as predicted |
| 2 | **The convert pair** — `any.convert_extern` / `extern.convert_any`, ≈49 assertions across `extern.wast` and `ref_test.wast` | ⬚ **open, and it is TWO layers** — see below |
| 4 | The five that unblock nothing for wasmtk | ⬚ open, ranked last on their numbers despite 121 occurrences |
| — | **Exact types** (`(exact $T)`), 116–548 assertions | ⬚ open, ranked last on effort. Parser-gated: `(exact $T)` fails at parse, so it is a type-system change across both trees, not a bridge case |

### The convert pair — measured, not estimated

**Priced by building it**, per the rule the `br_on_cast` miss produced. Probed across all three
layers:

| layer | result |
| ----- | ------ |
| wabt-ts parse → encode → validate | ✅ works |
| binaryen-ts decode → re-encode | ⚠️ **silently drops both opcodes** |
| the bridge | ❌ `expression kind not yet supported` (fail-loud, correct) |

⚠️ **The drop is deliberate, not an oversight.** `src/binaryen-ts/binary/wasm-parser.ts` case
`0x1a`/`0x1b` reads `push(pop()); // identity conversion in IR`. The **value** survives; the **type**
does not, so the encoder cannot re-emit the opcode and it vanishes — the re-encoded module is 2
bytes shorter per conversion.

**Severity: fail-loud downstream, not a miscompile.** In every position where the conversion is
load-bearing for typing, V8 rejects the re-encode with a type error. It is invisible only in the
null-identity case (`any.convert_extern(extern.convert_any(null))`), where dropping both is
coincidentally value-preserving and the module still returns the right answer.

⚠️ **That case is why a validity-only check passes here.** The first probe reported
`bin-roundtrip=OK` and was green for the wrong reason; the opcode count and the byte length are what
exposed it. Any test written for this must assert the opcode survives, not that the module validates.

**So the work is:** a real IR representation in binaryen-ts (node + reader + encoder, replacing the
`push(pop())`) **and** a bridge case. Not "one bridge case" — the same shape as `br_on_cast`, where
the estimate counted only the layer being looked at.

### A defect in its own right, found alongside

The reader errors on an unsupported GC opcode (`unsupported GC opcode: 0xFB 0x..`) but *consumes*
these two. **The fail-loud contract is not being violated by an unknown opcode — it is being
violated by a known one that is deliberately discarded.** Worth an enumeration: are there other
cases in this decoder that consume-and-discard rather than error? The section, export-kind and
import-kind dispatches all carry comments about exactly this shape having bitten before.

## Repo work

- ✅ **A3 — MEASURED 2026-08-31.** `deno task offsets`: 196 corruptions, 195 rejected, **0 missed
  rejections**, 133 of 154 specific diagnostics landing at the construct. It found and fixed a
  fail-loud defect on the way — the export section accepted any byte as an export kind. Reading,
  calibrations and blind spots: [testing.md](testing.md).
- **A2 — `wasm2ts` is a stub that throws.** The long-term goal; deferred pending wasmtk QA/QC.
- ⚠️ **Nothing ships against the bridge — and investigating why found a shipped-tool defect.** See
  the section below; the short form is that the bridge is the MORE capable of two WAT → binaryen
  routes and `wasm-opt` uses the other, which cannot read the WAT our own `wasm2wat` emits.
- ✅ **C3 — LeptonPad's `build:wasm` — VERIFIED 2026-08-31.** Runs; the artifact validates,
  instantiates and computes correctly; resolves `wasmtk@2.0.1 → binaryang@1.5.2` with **neither
  predecessor pulled**. Detail and the caching trap it exposed: [transition.md](transition.md).

## 🚨 `wasm-opt` cannot read the WAT `wasm2wat` writes

Found 2026-08-31 while asking whether the "nothing ships against the bridge" item could be closed.
It could — and the asking turned up a user-facing defect that outranks it.

```sh
binaryang wat2wasm  a.wat  -o a.wasm     # ok
binaryang wasm2wat  a.wasm -o b.wat      # ok — emits LINEAR form
binaryang wasm-opt  b.wat  -o b.wasm -Oz # ✗ uncaught exception + stack trace
binaryang wasm-opt  a.wat  -o c.wasm -Oz # ok — the original FOLDED source
```

**Two defects, and the second is nearly free to fix:**

1. **`src/binaryen-ts/parser/wat-parser.ts` handles only FOLDED s-expression form.** A bare
   instruction sequence — `(func (result i32) i32.const 7)` — fails with
   `unexpected atom in expression: i32.const`. Linear form is the canonical WAT text form and is
   what **our own `wasm2wat` emits**.
2. **`wasm-opt` does not catch the parse failure.** It surfaces as an uncaught exception with a
   stack trace rather than a diagnostic, which violates the fail-loud contract's *readable* half.

⚠️ **This is precisely the shape [testing.md](testing.md) names as needing no oracle** — *a
differential between two spellings of the same thing*, folded versus linear, which must agree by
construction. Nothing tested it, so a broken round trip between two of our own CLI tools went
unnoticed.

### ✅ FIXED 2026-08-31 — the parser dropped inline exports (43% of them)

Found while measuring whether the IR choice costs anything in the shipped wasm. It does not — but
the measurement could not be trusted until this was explained.

`binaryen-ts/parser/wat-parser.ts` does not support the **inline export abbreviation** on non-function
items:

| form | result |
| ---- | ------ |
| `(memory (export "mem") 1)` | **export silently dropped — no diagnostic** |
| `(global $g (export "g") i32 …)` | throws `unknown value type: (export "g")` |
| `(memory 1) (export "mem" (memory 0))` | correct |

Measured over 149 corpus modules: **345 exports via wabt-ts, 196 via binaryen-ts — 43% lost**, and
`memory` in every sampled case. 148 of 149 modules lost at least one.

⚠️ **This is why binaryen-ts's output looked 1.24% SMALLER.** It was not encoding better; it was
emitting less. A size win that is actually data loss is the exact shape a byte-count comparison
cannot distinguish — the export COUNT is what separated them, and the modules still validate,
because a module that fails to export its memory is perfectly valid and merely useless to its host.

**Inline export is the idiomatic form and is what our own `wasm2wat` emits** — `inlineExport`
defaults to `true`. So this compounds the round-trip defect above rather than sitting beside it.

**Ranking:** this outranked the linear-form gap. Linear form fails loudly; this one succeeded and
returned a module missing its exports.

**Fixed.** All four collectors (`memory`, `table`, `tag`, `global`) now consume the abbreviation
through one shared `takeInlineExports` helper, matching what `collectFunc` always did. Corpus
exports **196 → 345 of 345**, export sets identical on 149 of 149 modules, gated by
`tests/binaryen-ts/parser/inline_export.test.ts`.

### ✅ The byte gap is fully explained (2026-08-31), and it was NOT data loss

Chased to the section, then to the byte. Three components, none of them a defect:

| component | cause |
| --------- | ----- |
| **code −3,073** | binaryen-ts run-length-compresses consecutive same-type locals; wabt-ts emitted one group per local. `vec(count, valtype)`, so three i32 locals went out as `3 \| (1,i32)(1,i32)(1,i32)` where `1 \| (3,i32)` says the same thing in 3 bytes instead of 7 |
| **datacount −162** | the section is **optional** unless `memory.init` / `data.drop` reference the data index space. wabt emits it whenever data segments exist; binaryen-ts omits it. Both valid — and binaryen-ts rejects those two instructions outright, loudly, in both its WAT and binary readers, so it can never need the section |
| type +70, data +66 | small, and in the other direction |

**Fixed on the wabt-ts side.** The writer's comment already claimed run-length encoding; only the
loop did not do it. Coalescing recovered **42,437 bytes (2.7%) across the 421-file corpus** —
considerably more than the 3,073 gap that led to it, because binaryen-ts coalesces only partially,
so the gap measured the *difference* in redundancy rather than the total.

⚠️ **This moved the emitted-byte baseline on 398 files**, and came with a deliberate re-baseline in
the same commit: 1,557,602 → 1,515,165 bytes. The baseline is not a test; it pins bytes, so a
genuine encoder improvement is supposed to move it.

⬚ **binaryen-ts could take the same fix** — it carries roughly 5,600 bytes of the same redundancy on
this corpus. Not done; it is an optimisation, not a defect.

### ✅ FIXED 2026-08-31 — inline IMPORTS, the worse half

Same abbreviation family, all five kinds. `(memory (import "m" "a") 1)`, `(table (import …))` and
`(func (import …))` were **silently dropped**; `(global (import …))` threw.

**A dropped import is worse than a dropped export**: it removes an entry from the index space, so
every later function, memory, table or global index shifts by one — a valid module that calls the
wrong function. For `func` the failure was different and louder in hindsight: the import became a
DEFINITION with an empty body, so a declared result had nothing to return
(`expected 1 elements on the stack for fallthru`).

Handled through the same shared helper, now `takeInlineDecorations`, consuming exports and an
optional import in one loop because the spec permits them interleaved.

**Corpus parity, 149 modules:** exports **345 / 345**, imports **250 / 250**, identical sets on
149 of 149 for both.

The regression test asserts the computed VALUE for the index-space case — if the import were lost,
`$two` would move from index 1 to 0 and `call $two` would still be a valid module calling the wrong
function, which no structural assertion catches. Verified by neutering the abbreviation: 6 steps
fail.

## Which answers the bridge question

**The bridge is not redundant duplication. It is the MORE CAPABLE of the two WAT → binaryen routes,
and shipped code uses the other one.**

Measured over 150 corpus files:

| | |
| - | - |
| both routes succeed | 70 — and **0 produce identical bytes** |
| only the shipped parser (`parseWat`) | 52 — the bridge lacks `memory.copy` and the bulk-memory family |
| only the bridge | 4 — the shipped parser cannot read linear form |
| neither | 24 |

So each route covers what the other cannot, they never agree byte-for-byte, and **no test compares
them.**

### The decision this turns into

"Where does the bridge live" is settled ([overview.md](overview.md)). What is open is sharper:
**should `wasm-opt` route `.wat` input through the bridge?** Doing so would fix defect 1 and clear
the bridge item in one move — but it is not a drop-in, because the bridge fails on `memory.copy`,
which the shipped parser handles.

⚠️ **Do not treat "export the bridge" as the way to close this.** Exporting makes `./bridge`
supported public surface on the fastest-moving part of the tree; it would not fix the round trip,
and it would make the duplication permanent rather than resolved.

**It depends on no other task item.** The convert pair and exact types touch the bridge but neither
gates this.

## The wasmtk thread — `handoffs.md` §§ 7–11

| § | content | state |
| - | ------- | ----- |
| 7 | the `br_on_cast` estimate correction — it was three defects, not one | delivered |
| 8 | retraction of the phantom "deps need proper names" finding | delivered |
| 9 | defect 5 is **wider** than we described; the deps unblock; their missing `.gitattributes` | ✅ **closed by them** — they renamed `binaryen` → `binaryen-backend`, widened `.gitattributes`, and closed defect 5 with a conditional |
| 10 | correcting § 9 (they are on **1.5.3**, not 1.5.2); the convert pair priced by building it | ⬚ **awaiting their answer on one question** — though they have now SHIPPED against 1.5.3 as 2.0.2, so the `br_on_cast` queue entry is most likely stale rather than a live failure |
| 11 | adopting their conditional-not-clearance form and their alias invariant | ⬚ outbound |

⚠️ **The one open question is in § 10 and it matters:** their queue still lists `br_on_cast` as
unstarted, but all four `br_on_*` forms shipped in 1.5.3, which they are on. Either that entry
predates their bump, or **our fix does not cover their cases** — we asked for one failing module.
Worth resolving before anyone starts the convert pair.

**Also open, from their side:** their 100 pinned wast failures are described as GC/ref-types
conformance gaps. If any route to us rather than to wasic we want to know which — "now visible
rather than masked" is exactly the condition in which a gap gets attributed to whichever layer
someone is looking at.

## Not tasks, by decision

**Converging the two IRs** — open-ended by decision 1, tracked by `deno task collisions`, not a
release task. **D4 — never yank, ever.**
