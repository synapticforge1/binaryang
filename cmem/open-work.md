# Open work

The single list of what is outstanding, as of 2026-08-27, `binaryang@1.5.3` published.

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

## Conformance gaps — the wasmtk-ranked list, restated with current status

Ranking agreed in [handoffs.md](handoffs.md); status re-derived 2026-08-27.

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

- **A3 — diagnostic offset accuracy is UNMEASURED, not clean.** The cheap oracle was false for every
  multi-byte construct and no replacement was built. Needs a measurement before it needs a fix.
  See [testing.md](testing.md) § "Three states, not two".
- **A2 — `wasm2ts` is a stub that throws.** The long-term goal; deferred pending wasmtk QA/QC.
- **Nothing ships against the bridge.** No `src/` file imports it and it has no export-map entry.
  Recorded deliberately unresolved in [overview.md](overview.md) — exporting it makes `./bridge`
  supported public surface on the fastest-moving part of the tree.
- **C3 — confirm LeptonPad's `build:wasm` still runs.** Expected no-op; unverified, and should not
  be recorded as done.

## Outbound to wasmtk — drafted in `handoffs.md`, not yet sent

§ 7 (the `br_on_cast` estimate correction), § 8 (the retracted phantom finding), § 9 (defect 5 is
wider; the deps-naming unblock; their missing `.gitattributes`).

## Not tasks, by decision

**Converging the two IRs** — open-ended by decision 1, tracked by `deno task collisions`, not a
release task. **D4 — never yank, ever.**
