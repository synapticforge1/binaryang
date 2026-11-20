# Testing — independent oracles and byte parity

Summary: what our two implementations cannot judge, the standing oracle results, and the silent-skip lessons. Last verified 2026-11-20.
Main file: [testing.md](testing.md).

## Independent oracles — our two implementations checking each other is blind by construction

⚠️ **Nearly every invariant in this project compares wabt-ts against binaryen-ts — our own two
implementations.** That is excellent at finding disagreements (it found ~20 defects across the 1.5.5
passes) but **blind by construction** to two things: anything both get wrong the same way, and any
input neither of them produces. The tools that reach past it are installed; the list is in
[working-rules.md](working-rules.md) § "Installed oracles".

**Proved on first use.** Against 511 third-party binaries from the wasmtk suite, exactly one failed
— a Go-compiled `strlib.wasm`. The binary reader read an `if`'s blocktype, computed its result type,
and discarded it with a literal `void resultType;`; `makeIf` infers from the arms instead, which is
right until BOTH arms are unreachable. No module in the 421-file corpus has that shape, so no amount
of re-running it would ever have found this (`if_declared_result.test.ts`). It also confirmed
empirically that `blockType`-as-declared is the most load-bearing member of the as-written set
([ir-convergence.md](ir-convergence.md)): its absence emitted an invalid module on real code.

🔑 **Keep reaching for upstream on every byte-level claim.** It paid twice on 2026-09-04: upstream
`wat2wasm` confirmed our multi-memory bytes were right before a defect was diagnosed from them, and
confirmed the wide-arithmetic encoding before binaryen-ts gained it. Our own second implementation
would have agreed with the first and proved nothing.

### Standing results — so a new harness adds an axis rather than repeating one

- **oracle:** upstream `wasm-validate` on our binaries
  - result: 421 / 421
- **oracle:** upstream `wat2wasm` on our FOLDED output
  - result: 421 / 421
- **oracle:** upstream `wat2wasm` on our LINEAR output
  - result: 421 / 421
- **oracle:** 511 foreign `.wasm` read and re-encoded valid
  - result: 511 / 511
- **oracle:** wabt-ts `wat2wasm` bytes == upstream (W5, W6)
  - result: 421 / 421, outside custom sections
- **oracle:** `wasm-tools` on our labels and field names (N2)
  - result: see [names.md](names.md)
- **oracle:** V8, per operator, on the evaluator's numeric core
  - result: 136 / 136 scalar instructions (2026-10-07; one defect found first)
- **oracle:** the spec manifests' `expected` on the interpreter (`deno task interp`)
  - result: 33,268 pass, 0 FAIL, 24,380 stopped (2026-10-07, E3d-2); legacy EH 70 / 70; custom-descriptors 170 / 0 FAIL
- **oracle:** wasmtk's gate on 1.7.1: our `wasmValidate` on every module the spec asserts VALID, 288 files
  - result: **0 rejected** — their guard, inverted by them (`defaultFeatures()` flags 3 valid GC
    modules); they now use our validator as a second `assert_invalid` oracle where V8 cannot judge.
    2026-09-29, [handoffs.md](handoffs.md) § 18

### Byte parity with upstream `wat2wasm` — 146 → 400 → 421 of 421

⚠️ **`--enable-all` makes upstream `wat2wasm` emit bytes NOTHING else reads** — measured 2026-09-19
while pricing `-Oz` sizes. On `11_logging.wat` it writes the **compact import section** form (the
module name once, an empty field name, marker `0x7f`, then a count and the grouped entries) instead
of one entry per import. That form is an unratified proposal: binaryen 132 refuses it
(`compact imports not supported (at 0:95)`, and with `--all-features` the misleading
`bad import kind (at 0:128)`), **V8 refuses it**, and our reader refuses it precisely —
`unknown import kind 0x7f (at offset 0x5f)`, the same offset binaryen names. Our own `wat2wasm`
never emits the form, so our bytes optimize fine where wabt's do not. The lesson for any harness
that chains the oracles: **`wat2wasm --enable-all | wasm-opt` is not a valid pipe** — assemble with
the features the file needs (`--enable-exceptions` etc.), or assemble with ours. A run that skips the
module quietly, as the first size script did, reports a number computed over a corpus it never read.

The byte baseline pins our OWN output, so it was blind to every divergence older than itself;
wabt-ts's parity with upstream `wat2wasm` had never been measured. Measured 2026-09-10 with default
features (`--enable-all` changes what upstream EMITS): **146 of 421 identical** — 242 differed in
the DataCount section alone, the rest in type / function / code / tag sections. Re-measured
precisely the next day: those "other" differences were the 21 exception-handling modules upstream
cannot assemble without `--enable-exceptions`.

| after           | identical, outside custom sections | commit (re-baseline)      |
| --------------- | ---------------------------------- | ------------------------- |
| W6 — DataCount  | 400 / 421                          | `ac0994557` (`79f04adb4`) |
| W5 — type order | **421 / 421**                      | `12d4afc5e` (`68709c2a5`) |

⚠️ **Since S7 (2026-09-19)** "outside custom sections" matters: by default our `wat2wasm` adds a
`binaryang.text-form` section to sources written other than as the plain nested fold — linear, or
any mix (75 of these 421 since the per-instruction record, `1f8e8985f`; 20 when it was per
function) — a DESIGN divergence, owner-decided; `--no-text-form` gives upstream's bytes exactly, so
parity with that flag is 421 / 421 whole-file.

The name sections, compared on their own, are equal on 426/426. Parity is now total on this corpus,
so **any new difference is a regression or a new divergence, and gets a row** in
[divergences.md](divergences.md). Details of both fixes are their rows there; W5's implicit types
are indexed by the PARSER at module end, through a `makeTypeInterner` shared with `synthesizeTypes`.

The upstream-wabt oracle's REACH LIMIT is above ("An oracle that cannot reach the feature must be
SAID to not reach it"); `wasm-tools` 1.259 reaches GC text, labels and field names, and has its own
gaps (divergence G4).

### A SKIPPED test and a NARROW guard fail the same way — silently (2026-09-12)

Found by asking what the suite's "2 ignored" were. **Read what a passing test MEASURES, not what it
is named — and check the ignored count, every time.**

- **`corpus_roundtrip` (91 upstream binaries) had been skipping since the MERGE.** It looked for the
  reading-room clone at `<repo>/upstream/test`, and the clone stayed BESIDE the merged repo, in
  the sibling's `../binaryen-ts/upstream/test`. It then checked both paths (`8f5945b83`); since
  2026-10-26 the clone is in this repo at `upstream/binaryen/` and the test checks only that
  (hidden, it reports a skip — checked).
- **Then it turned out not to guard what its doc claimed**: `summary()` counted 4 of the 9 index
  spaces, so deleting the entire EXPORT section from the encoder still passed it. It now counts
  every space and compares the whole record.
- **The other ignored test was ALSO broken.** The live `npm:binaryen` interop test, gated on
  `BINARYEN_LIVE=1`, had never run — and failed when enabled. Its fixture was LINEAR WAT while
  `deno.lock` resolved `npm:binaryen@116`, whose old s-expression parser reads FOLDED only:
  `parseText` aborts the Emscripten process with `exit(1)`, which poisons the exit code for the NEXT
  live test too. binaryen 132 (the `wasm-opt` on PATH) reads both. Both live tests now run on
  availability rather than an env flag: **1043 passed, 0 ignored** (`b940e6c6b`).
- ⚠️ **A probe that imports `npm:binaryen` from OUTSIDE this project resolves 132** and says linear
  is fine — the probe and the test were both right about different binaryens. Pin the version in the
  probe, or compare `npm:binaryen@116` and `@132` side by side, which is what settled it.
- 🛑 **The follow-up pin commit did the opposite of its message.** `8d9ba0cb9` said `npm:binaryen@*`
  → 132.0.0; its diff deleted the 132 entries and left `@*` → 116.0.0, and the suite stayed green
  only because the same commit made the fixture folded, which 116 also reads. 🔑 **The hole was the
  BARE specifier** — `import('npm:binaryen')` names no version, so the lock may answer anything. The
  version now lives in the SOURCE, `const BINARYEN = 'npm:binaryen@132'`, one constant for the probe
  and both live cases, where Deno enforces it (`9507d78b5`). See
  [best-practices.md](best-practices.md) § "A written result is a CLAIM".

