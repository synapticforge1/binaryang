# Divergences from upstream wabt and binaryen — the register

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

## Open and intended

| id | vs         | what differs                                                                                                                                                              | class      | status / authority                                                                                                                                |
| -- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 | wabt       | GC text syntax — `(ref null any)`, `(sub …)`, heap-type keywords. wabt 1.0.41 has none                                                                                    | FEATURE    | the spec is the authority; upstream `wat2wasm` cannot be consulted (G2)                                                                           |
| G2 | wabt       | `wast2json` 1.0.41 cannot split 30 GC-proposal spec files; `deno task spec` skips them                                                                                    | ORACLE GAP | still untested by the harness. ⬚ CLOSEABLE: `wasm-tools json-from-wast` splits all 30 (287 modules, 289 `assert_invalid`, 73 `assert_malformed`)  |
| G3 | wabt       | any GC-typed WAT probe: upstream rejects with "unexpected token" — a missing feature, not a verdict                                                                       | ORACLE GAP | read the error TEXT; use V8 for behaviour; **`wasm-tools` (1.259) parses GC text** — the assembly oracle now                                      |
| G4 | wasm-tools | `wasm-tools parse` writes NO field names for structs in an explicit `(rec …)` group, cannot parse legacy-EH `(try (do …))`, and lists no import param names               | ORACLE GAP | probed 2026-09-11. Where wasm-tools is silent, compare against upstream wabt or cross-read our bytes (`wasm-tools print`)                         |
| R1 | binaryen   | body representation: a `RegionExpr` in every region slot (upstream: `Expression*`, often an unnamed `Block`)                                                              | DESIGN     | S6 decision 5, `7f3ec1d6e`. Passes see one slot; a region is never a branch target                                                                |
| R2 | binaryen   | an all-nop body vacuums to an EMPTY region (`00 0b`); upstream `wasm-opt --vacuum` leaves one `nop` (`00 01 0b`) — probed 2026-09-10                                      | DESIGN     | consequence of R1; the spec allows an empty body, and ours is a byte smaller                                                                      |
| E1 | wabt       | a binary `if` with an explicit EMPTY `else` (`04 40 … 05 0b`) keeps the `else` through binaryen-ts; wabt's text path drops it                                             | DESIGN     | fidelity — upstream `wasm-opt` keeps it too (probed). ⬚ wabt-ts drops it: unify in S6                                                             |
| B1 | binaryen   | block PARAMETERS stay on the node through the fidelity phase; lowered to locals only when optimization starts. Upstream lowers at read time                               | DESIGN     | S6 decision 7b(i), `02d77f533`. `PassRunner` lowers first; no pass may see `params`                                                               |
| V1 | binaryen   | branch/return values held as a LIST (`values: Expression[]`); upstream uses one `value` + `tuple.make`                                                                    | DESIGN     | S6 decision 6A, `2b5850a8a`. No `tuple.make` kind; do not port one back in                                                                        |
| S2 | binaryen   | a NUMERIC select written typed (`0x1c`) stays typed through binaryen-ts; `wasm-opt` rewrites it `0x1b` (probed)                                                           | DESIGN     | S6 decision 7a, `7171b8b38` — the declared type is on the node. wabt keeps it too                                                                 |
| T1 | wabt       | `call_indirect (type $b)` re-encodes naming an identical `$a` (first structural match) through binaryen-ts                                                                | DEFECT     | ⬚ form only — probed: behaviour preserved even with non-final/final GC types; decision 7c                                                         |
| T2 | wabt       | binaryen-ts's encoder DERIVES the type-section order when no type is declared (signatures, tags, then expression uses), reordering input                                  | DEFECT     | ⬚ form only; decision 7c territory with T1. Measured by the type-order probe, 2026-09-10                                                          |
| W4 | wabt       | binaryen-ts's own `parseWat` is a FOLDED SUBSET: no multi-operand stack sources, stack conditions, block params, or bare linear form                                      | DESIGN     | owner 2026-09-10: external WAT goes wabt-ts → bytes → decoder (`e18d9f09a`); `parseWat` internal only                                             |
| N2 | both       | LABEL names (subsection 3) and GC FIELD names (10) are written and read; upstream `wat2wasm --debug-names` writes neither                                                 | FEATURE    | owner 2026-09-11. ✅ wabt-ts writes (P2 `ab9d48b1e`), reads (P3 `b76dde783`); ⬚ binaryen-ts (P4–P5)                                               |
| N3 | wabt       | `wasm2wat` prints a name that is not all idchars QUOTED (`$"foo bar"`); upstream substitutes `_`, renaming it (`$foo_bar`)                                                | DESIGN     | fidelity, N1 P3: the text must hold the name the binary did. binaryen prints the same quoted form                                                 |
| N4 | binaryen   | after passes with `-g`, binaryen-ts keeps the LOCAL and LABEL names the passes leave; upstream `wasm-opt -O2 -g` drops every local name (params too) and writes no labels | DESIGN     | provisional (N1 P5, 2026-09-11): "follow `-g`" was decided, what `-g` keeps after optimization was not — the owner's future discussion settles it |
| C2 | wabt       | the WAT writer prints custom sections as `(@custom …)`, which the parser cannot read: `wasm2wat` → `wat2wasm` DROPS every custom section                                  | DEFECT     | ⬚ found 2026-09-11 (N1 P3). Upstream reads and writes `@custom` only with `--enable-annotations`                                                  |
| A1 | wasm-tools | wabt-ts ACCEPTS `(array (field (mut i8)))`; the GC text grammar is `(array fieldtype)`. wasm-tools rejects it, binaryen accepts it, the testsuite has no case             | DEFECT     | ⬚ probable — found 2026-09-11 probing field names. Confirm against the spec text before fixing; the must-reject axis                              |

**N1 — NAMES are lost at three hops** (found 2026-09-10, from the W4 route; owner: "so that this is
not skipped"). **SCOPED 2026-09-11 in [names.md](names.md)**: 63,930 source names in the corpus (the
scope first estimated ~43,000), 2 survived our round trip; the wabt-ts reader had never read one (a
slice bug); upstream itself does not write LABEL names, so keeping them is a FEATURE beyond
upstream; a six-step plan. **BUILT, both halves (2026-09-11).** wabt-ts (P1–P3): WAT → `wat2wasm` →
`wasm2wat` keeps 63,930 / 63,930 and is a byte fixed point on all 421 modules. binaryen-ts (P4–P6):
our named bytes decode and re-encode byte-identically 421/421, and `$foo` survives WAT → wabt-ts →
bytes → binaryen-ts:

| hop                   | today                                                                                                   | upstream                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| wabt-ts binary writer | ✅ writes one by default (P2); its ten kinds byte-equal to upstream's on 426/426; `wasm-strip` opts out | wat2wasm writes one with `--debug-names`   |
| wabt-ts reader        | ✅ reads all twelve subsections (P3); keeps the section raw when the module cannot hold it exactly      | wasm2wat reads it                          |
| binaryen-ts decoder   | ✅ reads it FIRST, one name table per namespace (P4); 8,298 / 8,298 upstream-named functions            | wasm-opt always reads it                   |
| binaryen-ts encoder   | ✅ writes the REAL names only (`explicitNames`, P5); after passes only under `debugInfo`                | wasm-opt writes it with `-g` (`debugInfo`) |

✅ **Not in N1: the module INTERFACE.** Export and import names live in the export and import
sections, not the `name` section, and survive the route and -Oz exactly — including aliases and a
late `(export …)` field (probed against upstream wat2wasm). Owner: an exported name must absolutely
be preserved, or it is name mangling — pinned by `wat_input.test.ts`, verified to fail when one
export name is altered. N1 is the INTERNAL identifiers: `$internal_name` comes back `$func1`.

🛑 **Owner decision, 2026-09-10 — names are KEPT BY DEFAULT in the fidelity phase, over both
upstreams' defaults.** Upstream loses them unless asked (probed):

| upstream                         | `name` section out | names read back                                     |
| -------------------------------- | ------------------ | --------------------------------------------------- |
| `wat2wasm` (default)             | no                 | none                                                |
| `wat2wasm --debug-names`         | yes                | functions and locals                                |
| `wasm-opt`, no flags — NO passes | **no**             | none — even a plain round trip strips them          |
| `wasm-opt -O2` / `-O2 -g` / `-g` | no / yes / yes     | none / SURVIVING functions only (locals gone) / all |

- **Reading and writing without optimization** — our `wat2wasm`, decode → encode, `wasm-opt` with no
  passes: names are preserved. DESIGN vs both upstreams: our fidelity requirement dictates over
  their default. Byte parity with upstream is then measured against `wat2wasm --debug-names`.
- 🛑 **wabt-ts ALWAYS keeps names** (owner, 2026-09-10, refining the above) — not a default with an
  opt-out flag. It is the fidelity half and never optimizes, so the rule is absolute: **WAT →
  `wat2wasm` → `wasm2wat` must reconstitute the WAT, names included.** That round trip is N1's
  acceptance criterion for the wabt-ts half. Removing names is a separate, explicit act —
  `wasm-strip` — never a mode of the fidelity tools.
- **Optimization**: once passes run there is no original to be faithful to (the two-phase rule), so
  optimized output follows a `-g`-style option (`PassOptions.debugInfo`), as upstream does. Its
  DEFAULT was not separately decided; off, as upstream, until the owner says otherwise.

N1 is CLOSED as a defect: both halves keep names in the fidelity phase. What remains of it is N4 —
which names optimized output keeps under `-g`, the owner's future discussion.

⚠️ **The three are coupled to decision 7b(i)**: `lowerBlockParams` re-decodes `encodeWasm(module)`
and refuses a module whose names no longer match its own bytes. Once the decoder reads real names,
an encoder that drops them makes every NAMED module with block parameters fail that check — so the
decoder and encoder halves land together, with the lowering re-encode keeping names.

The name section follows the code section, so the decoder must SCAN for it first (the bytes are in
memory) and name entities before any body refers to them — and uniquify duplicate or clashing names,
as upstream binaryen does. (`writeDebugNames`, the flag that promised a feature and did nothing, is
now implemented and defaults to true — P2.)

**wabt-ts vs upstream wat2wasm, byte for byte, on the 421-file corpus: 146 identical** (measured
2026-09-10, default features — `--enable-all` changes what upstream EMITS). 242 differ in the
DataCount section alone (W6); ~33 more in type / function / code / tag sections, consistent with W5.
Never measured before: the corpus baseline pins wabt-ts's OWN output, so any divergence older than
the baseline is invisible to it.

✅ **After W6 (2026-09-11): 400 / 421 identical**, custom sections aside (their name sections are
426/426 equal on their own). Re-measured precisely: the first count was 148 with default features,
and the "other" differences were the 21 exception-handling modules upstream cannot assemble without
`--enable-exceptions`. With it, those 21 differ ONLY in the type, function and tag sections — W5 is
21 modules, nothing else is left.

✅✅ **After W5 (2026-09-11): 421 / 421 identical** — wabt-ts's `wat2wasm` output equals upstream's
on the whole corpus outside the custom sections, and the name sections are equal on their own. The
parity the baseline could never see (it pins our OWN output) is now total on this corpus; any new
difference is a regression or a new divergence, and gets a row.

## Closed — defects that were divergences, kept as history

Each is pinned by a test whose expected output is upstream's (or V8's, where upstream cannot reach).

| vs       | what differed                                                                               | fixed       | pinned by                     |
| -------- | ------------------------------------------------------------------------------------------- | ----------- | ----------------------------- |
| wabt     | binaryen-ts WAT accepted nonexistent memory mnemonics (`f32.load8_s` → `f32.load`, …)       | `006326af7` | `memory_mnemonics.test.ts`    |
| wabt     | binaryen-ts WAT wrapped out-of-range `i32.const`, rejected unsigned-range `i64.const`       | `a73daee32` | `int_literal_range.test.ts`   |
| binaryen | i64 narrow stores encoded at the wrong width (cancelled by an inverse decoder rotation)     | `b8b3150db` | `narrow_store_width.test.ts`  |
| both     | binary round trip invented a `nop` in an empty body (both upstreams keep it empty)          | `365e9277c` | `region_fidelity.test.ts`     |
| binaryen | binary round trip dropped an explicit empty `else` (`wasm-opt` keeps it; see E1)            | `365e9277c` | `region_fidelity.test.ts`     |
| wabt     | binaryen-ts WAT dropped values from a multi-value `br_table` (V8 rejected)                  | `87e5766c3` | `branch_values.test.ts`       |
| wabt     | binaryen-ts did not decode typed select `0x1c`, and could not emit a reference-typed select | `b64b2e144` | `typed_select.test.ts`        |
| wabt     | W2: binaryen-ts WAT ignored `(func (type $a))`; threw for undeclared signatures             | `152d0ed76` | `type_use.test.ts`            |
| wabt     | W3: binaryen-ts WAT rejected `(type $t)` on block / loop / if (with params it is now B1)    | `152d0ed76` | `type_use.test.ts`            |
| both     | X1: decoder DROPPED `any.convert_extern` / `extern.convert_any`; V8 rejected the output     | `9d5c886be` | `extern_convert.test.ts`      |
| wabt     | W1: binaryen-ts WAT emitted an `else` for an empty `(else)`; `wat2wasm` omits it            | `ce77680de` | `region_fidelity.test.ts`     |
| binaryen | C1: LocalCSE cached a bare `local.get` / constant; upstream `isRelevant` excludes both      | `5b0cf25c6` | `passes.test.ts` (-Oz −3.9%)  |
| wabt     | S1: a numeric typed select re-encoded untyped through binaryen-ts (now S2, vs binaryen)     | `7171b8b38` | `typed_select.test.ts`        |
| wabt     | wabt-ts's folded `if` DROPPED every condition-slot instruction but the last (its inputs)    | `c309e57a0` | `folded_block_params.test.ts` |
| wabt     | wabt-ts's text path printed `align=0` for every natural alignment (a parser sentinel)       | `b8e5aaff3` | `align_natural.test.ts`       |
| wabt     | `wasm2wat` invented `$f0`/`$t0`/… ALWAYS; upstream only with `--generate-names` (N1 P3)     | `b76dde783` | `name_section_read.test.ts`   |
| binaryen | N1: binaryen-ts's decoder skipped the name section and its encoder wrote none               | `138148881` | `binary/names.test.ts`        |
| binaryen | every imported memory decoded as `mem0`, colliding with the first defined one               | `138148881` | `binary/names.test.ts`        |
| binaryen | a `throw` / `catch` of an IMPORTED tag decoded with NO payload (tag-index-space mixup)      | `874caf068` | `imported_tag.test.ts`        |
| wabt     | W6: DataCount written whenever data existed; upstream only when code names a data segment   | `cb474baaa` | `data_count.test.ts`          |
| wabt     | W5: implicit types out of upstream's text order — changed what `(func (type N))` meant      | `bd327efe7` | `implicit_type_order.test.ts` |
| both     | a single typed-ref block result interned a func type (spec + wasm-tools: inline `64 ht`)    | `bd327efe7` | `implicit_type_order.test.ts` |
| wabt     | an implicit signature reused the LAST equal explicit type; upstream the first               | `bd327efe7` | `implicit_type_order.test.ts` |

W3 with block PARAMETERS: the binary path keeps them since B1, and external WAT with them reaches
binaryen-ts through wabt-ts since W4's route. Only binaryen-ts's internal `parseWat` still refuses
them, loudly.

**The front-door decision behind W4** (owner, 2026-09-10): the end state is WAT → wabt-ts parser →
wabt-ts binary writer → bytes → binaryen-ts decoder. So binaryen-ts's WAT parser is not a second
front end to be completed — it is internal, and a candidate for retirement once S6 unifies the tree.
Do not invest in its stack-form support ("Stage 1" in ir-convergence is superseded). C1's pin is
upstream's rule, not upstream's bytes: the test FAILS against the pre-fix pass, and the three
invalidation tests it had made vacuous were rebuilt and verified to FAIL with invalidation disabled.

## When refactoring or optimizing — the checklist

1. **Before porting or re-porting an upstream pass**, read the DESIGN rows it touches (R1, R2, E1,
   B1, V1, S2): upstream's code assumes its own IR, and a faithful port of it can silently undo
   ours.
2. **Before "matching upstream" to shave bytes or simplify**, check the row is not DESIGN or
   FEATURE.
3. **Before claiming "byte-identical to upstream"**, check the ORACLE GAP rows — for GC it cannot
   be.
4. **A new difference found by any probe gets a row** before the work that found it is called done.
