# Divergences from upstream wabt and binaryen — the register

The register of every difference between binaryang and upstream wabt / binaryen, with its class. Open and
intended rows are here (features, oracle gaps, rulings kept); the DESIGN rows are split by subject.
Last verified 2026-11-20.

Owner direction, 2026-09-10: binaryang will necessarily diverge from both upstreams — it is building
features they have not (GC text, and more to come), and S6 makes design choices neither made.
**Every divergence is tracked here, classified, and consulted before any refactoring or
optimization** — especially once the initial goals are met and the code base starts being reshaped.

## Why a register, and not notes where each was found

A divergence has two opposite failure modes, and a scattered note cannot prevent either:

- **An INTENDED divergence gets "fixed" back to upstream.** A later refactor or a freshly ported
  upstream pass sees binaryang doing something upstream does not, and "corrects" it — silently
  removing a feature or a fidelity guarantee.
- **A DEFECT gets mistaken for an intended one** and is never fixed, because "we diverge there
  anyway".

And upstream stops being an oracle exactly where we diverge. A byte-level claim that normally leans
on upstream `wat2wasm` / `wasm-opt` must say so when it cannot — see ORACLE GAP below.

## Classes

| class          | meaning                                                                        | what a change must do                                              |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **FEATURE**    | we support something upstream does not                                         | keep it; test against the spec, not upstream                       |
| **DESIGN**     | we represent or process something differently, on purpose, with a recorded why | keep it unless the why is re-decided; do not port upstream over it |
| **ORACLE GAP** | upstream cannot judge this input at all                                        | name the authority actually used (the spec, V8, our own harness)   |
| **DEFECT**     | we differ and should not — open until fixed, then kept here as history         | fix it; pin it with a test whose expected bytes are upstream's     |

**Rule for every probe against upstream:** a difference is not done until it has a row here with a
class. "Valid either way" is not a class.

## Where the rows are

- DESIGN rows, the IR, the passes and constant folding: [divergences-ir.md](divergences-ir.md)
- DESIGN rows, the text format, names and custom sections: [divergences-text.md](divergences-text.md)
- DESIGN rows, validation, engines and the library facades; the numeric-ID register; the spec overlaps: [divergences-conformance.md](divergences-conformance.md)
- Open defect rows (T2, CL7–CL11, CL14, CL19): [divergences-open.md](divergences-open.md)
- Closed defect rows and the closed table: [archive/divergences-to-4.1.1.md](archive/divergences-to-4.1.1.md)

§ Numeric IDs — the register: moved to [divergences-conformance.md](divergences-conformance.md)
§ Overlaps with the specification — what must match it: moved to [divergences-conformance.md](divergences-conformance.md)
§ Closed — defects that were divergences, kept as history: moved to [archive/divergences-to-4.1.1.md](archive/divergences-to-4.1.1.md)
§ X1 — the convert pair, summarized: moved to [archive/divergences-to-4.1.1.md](archive/divergences-to-4.1.1.md)

## Open and intended (features, oracle gaps, rulings kept)

- **id:** G1
  - vs: wabt
  - what differs: GC text syntax — `(ref null any)`, `(sub …)`, heap-type keywords. wabt 1.0.41 has none
  - class: FEATURE
  - status / authority: the spec is the authority; upstream `wat2wasm` cannot be consulted (G2)
- **id:** G3
  - vs: wabt
  - what differs: any GC-typed WAT probe: upstream rejects with "unexpected token" — a missing feature, not a verdict
  - class: ORACLE GAP
  - status / authority: read the error TEXT; use V8 for behaviour; **`wasm-tools` (1.259) parses GC text** — the assembly oracle now
- **id:** G4
  - vs: wasm-tools
  - what differs: `wasm-tools parse` writes NO field names for structs in an explicit `(rec …)` group, cannot parse legacy-EH `(try (do …))`, and lists no import param names
  - class: ORACLE GAP
  - status / authority: probed 2026-09-11. Where wasm-tools is silent, compare against upstream wabt or cross-read our bytes (`wasm-tools print`)
- **id:** N2
  - vs: both
  - what differs: LABEL names (subsection 3) and GC FIELD names (10) are written and read; upstream `wat2wasm --debug-names` writes neither
  - class: FEATURE
  - status / authority: owner 2026-09-11. ✅ wabt-ts writes (P2 `49e717aac`), reads (P3 `4a88e547c`); ✅ binaryen-ts (P4–P5 `8c2d0be3d`)
- **id:** N8
  - vs: wabt
  - what differs: `wasm2wat` prints a branch whose TARGET LABEL has a name BY NAME — `br $outer` —
    where upstream prints the depth, `br 1 (;@1;)`; it keeps the depth where a nearer label shares
    the name and the name would retarget the branch
  - class: FEATURE
  - status / authority: N2's consequence, 2026-09-11: upstream wabt does not read label names at
    all, so it has none to print. **`wasm-tools print` does exactly this** and is the oracle.
    Corpus: 415 text hashes moved, **0 byte hashes** — re-baselined in its own commit. ⚠️ Those 415
    are all the BINARY-derived case (the baseline's text columns come from `wasm2wat(binary)`),
    where the name is unambiguously right. ✅ The text→text consequence is CLOSED (2026-09-11): only
    the caller knows whether an index carries a spelling, so `wasm2wat` opts in via
    `WriteWatOptions.namedLabelTargets` and a text-parsing caller does not. It was live in the
    public compat API — `parseWat(…).toText()` turned `(block $b (br 0))` into `(br $b)` — though no
    corpus module exercises the class (17 files hold 2,090 authored numeric labels, 0 of them at a
    named block)
- **id:** L1
  - vs: binaryen / V8
  - what differs: `LowerCustomPageSizes` (`wasm-opt --lower-custom-page-sizes`): no upstream pass
    lowers custom page sizes; this one makes a custom-page module run on an engine without the
    proposal (V8 15.0) — 64 KiB pages, a `<memory>#pages` global, explicit bounds checks
  - class: FEATURE
  - status / authority: 2026-09-29, owner: "we want V8 to be able to run it … the whole point of
    wasmtk". Judged against the proposal's own assertions on V8 (`check-lowered-page-sizes.ts`, 7
    worlds). `lower_custom_page_sizes.test.ts`
- **id:** W16
  - vs: wabt
  - what differs: a code-metadata hint written before a FOLDED instruction —
    `(@metadata.code.branch_hint "\01") (if (local.get 0) …)` — is recorded at that instruction's
    own opcode (the `if`); upstream wabt 1.0.41 records the folded expression's FIRST byte (the
    condition's `local.get`). A LINEAR hint (`local.get 0 (@…) if`) is identical to upstream
  - class: DEFECT (upstream's) — we follow wasm-tools
  - status / authority: 2026-09-28 (`b11716fe6`, wasmtk item 4): branch-hint validation (a hint must
    target `if` / `br_if`) rejected wabt's offsets for the testsuite's own `nested` module.
    wasm-tools 1.259 measured: 3 / 7 where wabt writes 1 / 5; 5 where wabt writes 3 for a folded
    `br_if`. The parser marks the form (`CodeMetadataExpr.onHead`), the writer takes the target's
    own callback. `code_metadata.test.ts` (one entry moved 3 → 5), `annotation_placement.test.ts`
- **id:** DG7
  - vs: wabt
  - what differs: a function body that ends with too few values: ours says `type mismatch in
    function, expected 1 elements on the stack but got 0` (text `1:9`, the `func`); upstream wabt
    1.0.41 says `type mismatch in implicit return, expected [i32] but got []` (text `1:15`, the
    body's end), on both the text and the binary path
  - class: DEFECT (cosmetic)
  - status / authority: Found 2026-10-28 fixing C12 (open-work 47), measured on `(module (func
    (result i32)))` — no `delegate` involved, so it is its own row. The verdict is the same (both
    refuse). ✅ **WORDS FIXED 2026-10-28** (owner: "fix … divergence DG7"; open-work 48): the type
    checker prints upstream's `PrintStackIfFailedV` messages word for word — `type mismatch in
    <desc>, expected [<types>] but got [<types>]` (as many actual values as expected, up to 4 when
    none, `... ` for a deeper stack) and `type mismatch at end of <desc>, …`; upstream's
    descriptions (`implicit return` / `function`, `initializer expression`, `block` / `loop` / `if`
    / `` `if true` branch `` / `` `if false` branch `` / `try` / `try catch` / `try table`); a
    missing operand fails the same check a wrong type does (one message, not "expected 2 elements on
    the stack but got 1"); and a one-armed `if` is modelled as an empty `else`, as upstream's
    `OnEnd` does, replacing the validator's own rule (which reported it in other words and then
    AGAIN at the function end). A function-end error is reported at the body's last instruction
    (upstream's `body_end`). 13 shapes measured against wabt 1.0.41 `wasm-validate`, all equal
    (`upstream_mismatch_words.test.ts`; red on the old code 11 of 13; 3 mutants killed). **Kept, as
    the residue (not words):** (1) binary OFFSETS — upstream reports where an instruction finished
    being read, ours where it starts, in every binary diagnostic; (2) a BLOCK-end error's position —
    upstream points at the `end`, which our IR does not record (a new public IR field would); (3) an
    empty body's TEXT column (upstream's function location is the token after `func`, ours `func`);
    (4) the instruction-specific checks of the reference instructions (`popAnyRef`,
    `br_on_non_null`, `ref.eq` …) keep their own words; (5) after an operand underflow ours reports
    a second error at the function end where upstream reports one — measured before this change too
- **id:** F4
  - vs: wabt, wasm-tools
  - what differs: an integer-spelled `f32.const` in HEX near an f32 midpoint: upstream wabt 1.0.41
    and wasm-tools both TRUNCATE (`0x6736246` = 108,225,094 → 108,225,088, where 108,225,096 is 2
    away and 108,225,088 is 6; `0x7b3561402`, `0x13ca0fd01` likewise); ours rounds to nearest, ties
    to even
  - class: ORACLE GAP
  - status / authority: found 2026-10-28 fixing the double rounding (code lens pass 3, open-work
    53): on 2,000 literals ours equals an independent single rounding every time (`Math.fround`
    below 2^53, `decimalToBits` above); the decimal spellings agree across all three. The authority
    is IEEE round-to-nearest; `f32_integer_literal.test.ts` pins the hex cases to it, not to an
    oracle

**N1 — names** (found 2026-09-10, BUILT in both halves 2026-09-11; merged `b9ee4fb75`, `6dc071475`).
Its owner decisions — wabt-ts ALWAYS keeps names, reading and writing without optimization keeps
them over both upstreams' defaults, optimized output follows `debugInfo`, export and import names
are the inviolable interface — and its measurements live in [names.md](names.md); the rows that
remain are N2–N8. **wabt-ts's byte parity with upstream `wat2wasm`** (146 → 400 → 421 of 421, via W6
and W5) is in [testing.md](testing.md) § "Byte parity with upstream `wat2wasm`". Full prose as it
stood: `git show f2ee1a41f:cmem/divergences.md`.

## When refactoring or optimizing — the checklist

1. **Before porting or re-porting an upstream pass**, read the DESIGN rows it touches (R1, R2, E1,
   B1, V1, S2): upstream's code assumes its own IR, and a faithful port of it can silently undo
   ours.
2. **Before "matching upstream" to shave bytes or simplify**, check the row is not DESIGN or
   FEATURE.
3. **Before claiming "byte-identical to upstream"**, check the ORACLE GAP rows — for GC it cannot
   be.
4. **A new difference found by any probe gets a row** before the work that found it is called done.
5. **A row's PREMISE is not evidence — re-derive it before acting on it.** A1 said "we accept
   `(array (field …))`, wasm-tools rejects it, binaryen accepts it", which implied we were the odd
   one out; it was filed a probable DEFECT. Reading the VENDORED upstream sources —
   `wabt-ts/upstream/src` and `binaryen-ts/upstream/src`, both in the sibling repos — showed
   upstream wabt parses an array's element with the same `ParseField` as a struct's, id and all. The
   classification flipped DEFECT → DESIGN, and the real defect was ADJACENT to the row (the dropped
   `id`), not in it. Rows carry what someone believed when they wrote them; the vendored sources and
   the spec text carry what is so.
