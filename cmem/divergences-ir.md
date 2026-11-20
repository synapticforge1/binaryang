# Divergences — DESIGN rows: the IR, the passes and constant folding

Decisions to keep where binaryen-ts represents or processes something differently from upstream binaryen, and the folding rules (R1, R2, E1, E2, B1, V1, S2, K2, K3, H1, U1, R18, F1–F3).
Last verified 2026-11-20. The register, its classes and the checklist are in [divergences.md](divergences.md).

## DESIGN rows

- **id:** R1
  - vs: binaryen
  - what differs: body representation: a `RegionExpr` in every region slot (upstream: `Expression*`, often an unnamed `Block`)
  - class: DESIGN
  - status / authority: S6 decision 5, `b5c7d4b7a`. Passes see one slot; a region is never a branch target
- **id:** R2
  - vs: binaryen
  - what differs: an all-nop body vacuums to an EMPTY region (`00 0b`); upstream `wasm-opt --vacuum` leaves one `nop` (`00 01 0b`) — probed 2026-09-10
  - class: DESIGN
  - status / authority: consequence of R1; the spec allows an empty body, and ours is a byte smaller
- **id:** E1
  - vs: wabt
  - what differs: a binary `if` with an explicit EMPTY `else` (`04 40 … 05 0b`) keeps the `else` through binaryen-ts; wabt's text path drops it
  - class: DESIGN
  - status / authority: fidelity — upstream `wasm-opt` keeps it too (probed). ✅ wabt-ts's BINARY
    path keeps it too since S6 step 5 (d2), `6dca91f64` (`region_slots.test.ts`); upstream wabt's
    reader drops it, `wasm-tools` keeps it. Text still drops it on both halves — text cannot spell
    it, and upstream `wat2wasm` omits `(else)`
- **id:** B1
  - vs: binaryen
  - what differs: block PARAMETERS stay on the node through the fidelity phase; lowered to locals only when optimization starts. Upstream lowers at read time
  - class: DESIGN
  - status / authority: S6 decision 7b(i), `4cae28682`. `PassRunner` lowers first; no pass may see
    `params`. Since R15 (2026-09-28) the lowering is a TREE pass (`lower-block-params.ts`), not a
    re-decode
- **id:** V1
  - vs: binaryen
  - what differs: branch/return values held as a LIST (`values: Expression[]`); upstream uses one `value` + `tuple.make`
  - class: DESIGN
  - status / authority: S6 decision 6A, `fc103dcc8`. No `tuple.make` kind; do not port one back in
- **id:** S2
  - vs: binaryen
  - what differs: a NUMERIC select written typed (`0x1c`) stays typed through binaryen-ts; `wasm-opt` rewrites it `0x1b` (probed)
  - class: DESIGN
  - status / authority: S6 decision 7a, `a7cb89da2` — the declared type is on the node. wabt keeps it too
- **id:** K2
  - vs: binaryen
  - what differs: `code_metadata` — wabt-ts's annotation pseudo-instruction — has no binaryen-ts counterpart
  - class: DESIGN
  - status / authority: 🗓️ OWNER, 2026-09-16: "if we need it for fidelity, we will need it in the
    wabt-ts side only." Measured: the binary `metadata.code.*` section already round-trips
    byte-identically as a raw custom section on BOTH sides; the node is what a TEXT annotation needs
    (W8). So it stays, wabt-ts-only — the one kind in `ONE_SIDED_BUDGET`. 🗓️ OWNER, 2026-09-16:
    binaryen-ts STRIPS it in its optimization runs (`PassRunner`, before the first pass) —
    implemented with the alias, item 5 (6)
- **id:** K3
  - vs: binaryen
  - what differs: the twelve SIMD lane shifts (`i8x16.shl` … `i64x2.shr_u`) are a `binary` in
    binaryen-ts (v128 left, i32 count right); upstream binaryen gives them their own `SIMDShift`
    because its validator requires a `Binary`'s two children to have the SAME type
  - class: DESIGN
  - status / authority: ✅ **MERGED 2026-09-14 (owner decision)** — wabt-ts's and upstream wabt's
    shape; binaryen-ts's own `simd.shift` kind is gone. Decided by the worst-condition method:
    fidelity did not bind, and optimization bound AGAINST the split form, since LocalCSE keys a
    `Binary` and never keyed a `SIMDShift`, while upstream `wasm-opt --local-cse` reuses a shift.
    Gate: `tests/binaryen-ts/binary/simd_shift.test.ts`. **Trigger — do not port over it:**
    upstream's passes read `left->type` / `right->type` in 13 places, all in
    `OptimizeInstructions.cpp`; a port of any must not assume a `binary`'s operands share a type,
    and must match exact opcodes as ours do. Record: [ir-convergence.md](ir-convergence.md) § "K3"
- **id:** H1
  - vs: binaryen
  - what differs: TranslateToExnref (`--translate-to-exnref`) keeps a catch's values ON THE STACK:
    the catch body is spliced in after the block that delivers them, and its `Pop`s consume them; an
    exnref reaches its local as `local.set $exn (pop exnref)`. Upstream stores the payload in a
    scratch local, rewrites each `pop` to a `local.get`, and uses tuple locals plus `tuple.extract`
    for several values or values with an exnref
  - class: DESIGN
  - status / authority: ✅ built 2026-09-14 (owner decision 7). binaryen-ts has no tuple kinds (S6
    6A) and its `Pop` is already the stack placeholder a catch region starts with, so upstream's
    locals would need machinery this IR removed. Behaviour, not bytes, is the authority: `deno task
    translate-eh` (the legacy spec files, 70 / 70 in V8 translated and translated `-Oz`),
    `translate_eh.test.ts` (V8, and wasmtime where installed). **Trigger:** a pass that moves or
    drops a `Pop` outside a catch region's start would break the translated form — the same hazard
    decoded multi-value code already carries. Also resolved in the pass, which upstream's IR settles
    earlier: a `br` to a legacy try's label, and a `delegate` naming a non-try label
    ([binaryen-ts.md](binaryen-ts.md) § "TranslateEH")
- **id:** U1
  - vs: binaryen
  - what differs: a decoded VOID `if` whose arms both end unreachable keeps its declared type
    (`none`), and a decode → encode writes it back as it was. Upstream types it `unreachable`, and
    even `wasm-opt` with NO passes deletes the code after it and writes an extra `unreachable`
    (probed 2026-09-14 on `(block (result i32) (if … (then unreachable) (else unreachable))
    (i32.const 2))`)
  - class: DESIGN
  - status / authority: fidelity binds: 421 / 421 corpus modules stay byte-identical. Our ENCODER
    does follow upstream for a construct a pass typed `unreachable` — it writes the extra
    `unreachable` — so a pass may still leave nothing after one. Both halves in `cc9467e81`, found
    because DCE trusted the old inferred type and failed 30 of 70 legacy EH spec assertions at
    `-Oz`; `unreachable_construct.test.ts`
- **id:** R18
  - vs: binaryen
  - what differs: since 1.6.0 an INVALID module the deleted decoder refused at READ is read
    faithfully by `readForPasses` — the same bytes come back — and refused by the validator: a
    constant expression consuming from beneath a statement, a block type index past the types, a
    struct type used as a function type, an alignment exponent past 8 (refused when WRITTEN,
    `checkForWriting`)
  - class: DESIGN
  - status / authority: One front end: the reader reads what it can hold and repairs nothing;
    validity is the validator's (`wasm-validate`) and the engine's (`wasmOpt` validates its output).
    Upstream `wasm-opt` validates its input. Tests assert "no repair" plus the validator's refusal
- **id:** E2
  - vs: wabt
  - what differs: `writeWat` text of a binary `if` with an explicit EMPTY `else` omits it, so re-assembled bytes lose `05` (`spec/try_table/try_table.1.wasm`)
  - class: DESIGN
  - status / authority: E1's text half, measured again 2026-09-28: valid and equivalent, and text
    cannot spell it without printing `(else)`, which upstream omits. It is one of the two `writeWat`
    re-assembly residuals (the other is binary.55's DataCount); the K4 commit message had attributed
    the residuals to "DataCount or Q9" — this one was neither
- **id:** F1
  - vs: binaryen
  - what differs: a constant fold whose result is an ARITHMETIC NaN is not made:
    `(i32.reinterpret_f32 (f32.add (f32.const nan:0x200001) (f32.const 1)))` stays; upstream
    `wasm-opt --precompute` / `--precompute-propagate` folds it to `i32.const 2143289344` (the
    canonical `0x7fc00000`) — probed 2026-10-07, wasm-opt as installed. The same probe AGREES on the
    rest: a trap stays (`i32.div_s 1 0`), division by a non-zero constant folds, a bit-exact NaN
    folds with its payload (`f32.neg` → `-6291455`), a `select` whose discarded operand traps stays
  - class: DESIGN
  - status / authority: open-work 23, E1 / E2 (2026-10-07): ONE rule, `foldedLiteral` in
    `interp/numeric.ts`, for OptimizeInstructions and Precompute. Why: the spec lets an arithmetic
    operator return ANY arithmetic NaN, an engine propagates payloads, and a folded constant would
    fix bits the program reads back through a reinterpretation — valid either way, but the unfolded
    program keeps the engine's answer. Costs bytes only where a program computes a NaN from
    constants. `fold_through_evaluator.test.ts`, `precompute.test.ts`
- **id:** F2
  - vs: binaryen
  - what differs: constant PROPAGATION through locals is its own pass, `ConstantPropagation`, and
    EVALUATION is `Precompute`; upstream does both in one `precompute-propagate` (and has no pass
    that only propagates). Scheduled in the function passes as ConstantPropagation, Precompute,
    ConstantPropagation, Precompute, then OptimizeInstructions
  - class: DESIGN
  - status / authority: Owner, 2026-10-06: "Constant propagation may go into item 2 now", Precompute
    proper in item 23 — so the two were built apart, on `cfg.ts` and on the evaluator. Propagation
    alone −2.3 KB at -Oz; with Precompute, twice, −4.4 KB more (2026-10-07). `ConstantPropagation`
    takes no upstream pass name because no upstream pass is it; `Precompute` does, and
    `--precompute` resolves to it
- **id:** F3
  - vs: binaryen
  - what differs: `f32x4.relaxed_nmadd` / `f64x2.relaxed_nmadd` are FUSED here (one rounding, exact
    through `bigint` — `fma` in `interp/simd.ts`); upstream's interpreter computes `-(a × b) + c`
    with TWO roundings (`literal.cpp` `nmadd`: "not an actual fused negated multiply implementation,
    but the relaxed spec allows a double rounding"). Both are alternatives the spec lists and the
    suite's `either` accepts; `relaxed_madd` is fused on both sides (`fmaf` / `fma` upstream)
  - class: DESIGN
  - status / authority: 2026-10-08, open-work 23 E3e: one rule for `madd` and `nmadd` (fused, the
    deterministic choice), and a relaxed operator is NEVER folded by a pass, so no program sees the
    choice at compile time; `simd_differential.test.ts` pins the fused result on cases that tell one
    rounding from two
