# Testing — the spec-testsuite harness (must-reject, behaviour, wast2json)

Summary: how the spec testsuite is run, what the feature set must be, and what each axis covers. Last verified 2026-11-20.
Main file: [testing.md](testing.md).

## The spec-testsuite harness — the must-REJECT axis

**Owner-assigned 2026-09-02, built `cebbb1260`**: `deno task spec:prepare` then `deno task spec`.
Moved here from `open-work.md` on 2026-09-14, where it had been recorded while it was the open item.

The source is 257 `.wast` files in the sibling wasmtk checkout, at
`wasmtk/tests/module/wasm_wast/testsuite-main` (its absolute path on the development machine is in
the private `cmem/local/environment.md`). ⚠️ **READ ONLY**: it is a sibling repo, so never write
there; copy to scratch if a tool might. Rebuilding the corpus each session:
[working-rules.md](working-rules.md).

🔑 **It tests an axis nothing here had EVER tested: whether we correctly REJECT.** Every invariant
before it asked "do we accept valid input correctly" — and a tool that accepts everything scores
perfectly on all of them. The suite contains **4,654 must-reject cases**:

| assertion              | count     | what it demands                           |
| ---------------------- | --------- | ----------------------------------------- |
| `assert_return`        | 52,591    | the module runs and returns a given value |
| `assert_trap`          | 4,977     | it traps                                  |
| **`assert_invalid`**   | **2,714** | the module **must fail validation**       |
| **`assert_malformed`** | **1,940** | the text **must fail to parse**           |
| `assert_unlinkable`    | 200       | instantiation must fail                   |

`wast2json` splits each file into modules plus a JSON manifest of its assertions — that is the way
in; do not hand-parse `.wast`.

### ⚠️ The feature set IS the design, and it was wrong twice first

- **`--enable-all` is wrong**: it changes what `wast2json` EMITS, not just what it permits. It
  produced compact-imports binaries (import kind `0x7F`) that are not standard wasm — V8 rejects
  them outright — and the harness reported **58 false "valid module REJECTED"** findings.
- **the DEFAULT set is also wrong**: only 157 of 257 files convert, silently dropping SIMD, GC,
  threads and tail calls. That reads as a pass because the failures never enter the corpus.
- **the validator needs its features passed too**: the very first run used the default set and
  reported **464 false rejections**, every one a post-MVP proposal the suite exercises on purpose.

**A corpus built with the wrong flags measures the flags, not the code.** All three configurations
are recorded in `scripts/spec-prepare.ts`.

### ✅ Behaviour — `assert_return` / `assert_trap` (was "Not yet covered"; covered since 2026-09-28)

`assert_return` / `assert_trap` — 55,993 behavioural assertions, skipped deliberately so the first
pass measured the axis nothing else measures. 🔧 **2026-09-28: they were run, as a DIFFERENTIAL, and
it found eight defects every gate had passed** (Q1–Q8 in [divergences.md](divergences.md), among
them a silent -O2 miscompile shipped in 1.5.4). For every spec `module` with invocations after it,
the ORIGINAL bytes are instantiated with inert import stubs and each `invoke` replayed; the same
replay on a plain decode → encode and on -O1…-Oz, both routes, must give the same outcome — a value
compared by bits, or a trap. The original run in V8 is the oracle, so the manifests' `expected`
values are not needed — and ours never decide them.

✅ **Now `deno task spec-behaviour <outDir>`** (2026-09-28; `scripts/check-spec-behaviour.ts`, the
check in `scripts/spec-behaviour/differential.ts`), over the corpus `deno task spec:prepare` writes.
On `main` today (2026-09-28 late): **1,342 modules with invocations, 57,808 invocations (24,151
through v128, 53 blind), 16,062 variants compared, 0 divergences, in ~8 s**. Its verdict: exit 1 on a DIVERGE (an outcome differs, or the engine refuses
our bytes) or a module that does not terminate; a variant our pipeline REFUSES (throws — loud, not
a miscompile) is allowed only for a module pinned by name in `REFUSED_BUDGET`, a ratchet like
`PHANTOM_BUDGET`. (It held 7 relaxed-SIMD modules on route A, binaryen-ts's decoder; route A left
with that decoder in 1.6.0, and the budget now holds only the `--flatten` pins below.)
⚠️ Nothing in the gate checks the manifests' own EXPECTED values — the differential needs none,
and the SIMD oracle check (24,110 / 24,115, below) was a one-off. Optional, not scheduled.

**Variants since 2026-09-28 (9 per module):** round trip; -O1, -O2, -O3, -Os, -Oz; `-Oz --converge`;
`--flatten` alone; and "minify through its map" — `…-and-modules` minification where the HOST
supplies its imports and calls its exports by the map's new names (spectest imports get the values
of the names they had), so a wrong map over self-consistent bytes DIVERGEs (two mutants, caught).
An instantiation failure is compared with the import's names removed from the message. Measured
2026-09-28: 12,061 variants, 0 DIVERGE. `REFUSED_BUDGET` is keyed by **(module, variant)** —
`'<module> <variant>'` — and holds the 17 `--flatten` refusals of `br_on_*` / `try_table`
(upstream's Flatten refuses both); a pin can no longer hide another variant refusing the same
module. Inverted: one pin removed → exit 1.

- **Inverted twice**: Q1's miscompile restored → exit 1, with DIVERGEs (`align.106`'s
  `i32_align_switch` gave 0 for 23 at -O2+ — Q1 reached further than `if.0`) and hangs;
  the multiple-tables guard restored → exit 1, 161 modules NEWLY refused.
- ⚠️ **It stops after 3 modules that do not terminate.** The first inversion ran for 20 minutes and
  12,500 CPU-seconds: a miscompiled loop never ends, `worker.terminate()` cannot interrupt a
  synchronous wasm loop, and every hang left a spinning thread behind. After the first hang the
  verdict is already a failure; the report says how many modules were NOT run.
- Its blind spots: an invocation of a NAMED module (another module's) is skipped; imports are inert
  stand-ins, so behaviour that depends on a real import is compared only as far as the stand-in
  goes (the same stand-ins on every side); a trap is compared by class, not message.
- 🔧 **v128 — the blind spot nobody had listed (closed 2026-09-28, pre-bump item 6, `e0edf13b0`).**
  The JS API cannot pass or receive a `v128`, so every SIMD invocation threw a TypeError on the
  original AND on every variant — and "agreed" without running: **24,151 of the 57,808**. A writer
  miscompile planted on purpose (`replace_lane` writing lane `^ 1`; `i8x16.shuffle` reversed) passed
  with 0 DIVERGE. Now `scripts/spec-behaviour/v128.ts` appends a wrapper per such export — each
  vector as two `i64` lanes, rebuilt with `i64x2.splat` / `replace_lane`, split with
  `extract_lane` — to the BYTES, the original's and each variant's alike, after the variant is made;
  hand-written, so the toolchain under test builds none of it, and nothing is renumbered. The same
  two miscompiles now fail (5 and 4 modules). The signature is the manifest's (arguments; an
  `assert_return`'s expected types, borrowed by an `assert_trap` of the same export).
  - **The wrappers were checked against an oracle that owes nothing to our code**: the ORIGINAL,
    through them, against the manifests' own expected lanes — **24,110 of 24,115** match. The 5
    others pass a signalling-NaN f32/f64 SCALAR, whose payload a JS number cannot carry — the
    existing scalar path's limit (same on every side), not the wrapper's.
  - What JS still cannot call is now COUNTED as **`blind`: 53** (a TypeError on the original),
    reported in the summary rather than agreeing unseen.
  - `spec_behaviour_v128.test.ts`; 6 mutants of the index arithmetic, all caught.

### ⚠️ `allFeatures` is not neutral once a feature CHANGES a verdict (2026-09-28)

Custom descriptors (5a) relaxes `br_on_cast`'s `rt2 <: rt1` to "one hierarchy" — the first feature
here that makes invalid code valid rather than only permitting new code. With it in `allFeatures`,
the gate's `spec` step dropped to **2708 / 2714** assert_invalid (six `br_on_cast(_fail).wast`
modules). The top-level suite is written against the core rules; the proposal's own copies carry
the relaxed ones. `scripts/spec-testsuite.ts` now runs `{ ...allFeatures(), customDescriptors:
false }` → 2714 / 2714. **A future proposal that changes a verdict joins that exclusion**, with its
own suite run under it.

### Do we need upstream `wast2json`? (measured 2026-09-28)

Two uses, both in this repo (the workspace's other repos only mention it). **`spec-prepare`**:
`wasm-tools` 1.259 `json-from-wast` split **all 257** top-level files on its own — `wast2json` is
not needed there (the fallback already exists for 30; the command types differ, and the harness
already reads wasm-tools'). **`translate-eh`**: `wasm-tools` fails all four `legacy/` files
("unknown operator" — it no longer parses `try` / `catch` / `delegate`), so `wast2json` is the only
external splitter for them. Dropping it means splitting those four with our own
`parseWastScript` (not independent of what is tested — but V8, not we, judges the result) or
retiring them.

🗓️ **OWNER, 2026-09-28: KEEP `wast2json` — for `translate-eh`.** Its value is the coverage of the
translate-to-exnref pass (then `-Oz`) on the legacy files, which nothing else has: wasmtk's gate
runs those four files too (its own splitter, no `wast2json`; baselined 15 / 10 / 39 / 25 passes,
0 skips) but only AS WRITTEN — never translated — and through its pinned binaryang, not `main`.
Nothing binaryang ships runs `wast2json` (no reference in `src/`). Checked the same day against 5a
and the decommission: `translate-eh` needed no change (its import was rewritten by the relocation;
gate exit 0).

**And `wasm-tools`? (measured 2026-09-28)** Nothing binaryang ships runs it: `src/` and `main.ts`
spawn no subprocess at all. The ONE place it is executed is `spec-prepare`'s fallback
(`scripts/spec-prepare.ts:119`) for the 30 GC-proposal files `wast2json` 1.0.41 cannot split —
corpus PREPARATION, run when the corpus is (re)built; `deno task spec` reads the prepared output.
Every other mention (~60, in `src/` and `tests/`) is a comment or a test's EXPECTED bytes citing
wasm-tools as the reference — measured once, hard-coded, no tool at run time. The custom-descriptors
harness that used it was scratch, not in the repo. So: not needed for binaryang to work; needed to
re-prepare the spec corpus's GC files (and for any future proposal harness).

