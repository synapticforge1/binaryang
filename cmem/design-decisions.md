# Load-bearing design decisions & invariants

Invariants and codegen rules that are easy to break in a refactor and must NOT be silently
reverted. Each has a regression test; reintroducing the old shape defeats the design. The
exhaustive line-by-line version is in the legacy `CLAUDE.md`.

## Performance invariants (2026-05-25 audit — do not regress)

- **`TextEncoder`/`TextDecoder` are module-level singletons** in `src/writer/stream.ts`,
  `src/writer/wat-writer.ts`, `src/reader/binary-reader.ts`, `src/parser/lexer-source.ts`. Both are
  stateless under `.encode()`/`.decode()`. Never write `new TextEncoder()`/`new TextDecoder()`
  inside a method body in these files — reuse the file-level `TEXT_ENCODER`/`TEXT_DECODER` const.
- **`ModuleContext` builds `funcSigsByIndex` + `tagArityByIndex` once** in its constructor
  (`src/ir/ir-util.ts`). `getFuncSig`/`getTagArity` are O(1) indexed lookups rather than a
  `for (const imp of module.imports)` scan.
  **CORRECTED 2026-08-25 (T13.28): the justification recorded here was wrong.** It read
  "`getExprArity` runs for every expression during validator and writer walks", and
  `getExprArity` has **no production caller at all** — only one test in
  `tests/audit/silent_corruption_fixes.test.ts`. `ModuleContext.getFuncSig` / `getTagArity` have
  none either; `binary-reader.ts` uses its own free function of the same name. Only `WatWriter`
  extends `ModuleContext`, and it never calls any of the three. So this is **not a hot path** and
  nobody should defend it as one. All three are kept because `ir-util.ts` is re-exported from
  `src/index.ts` and removing them is a breaking API change — unlike `getOpcodeNaturalAlign`
  (T13.18) and `Validator.refNullType`, which were internal and were deleted. The class's own doc
  comment still claims it is "reused across validator, binary writer, and bridge"; that is false
  and is the kind of stale claim T13.24's rule is about.
- **`WatWriter` builds `nameIndexMap` once** in its constructor (`src/writer/wat-writer.ts`).
  `resolveVarIndex` is an O(1) `Map.get` keyed by `"kind:name"`. The previous two-pass linear scan
  grew quadratically with export count.
- **No `const w = this;` aliasing** in `WatWriter` delegate methods (the `no-this-alias` lint blocks
  it). The arrow fns in `makeDelegate()` already capture `this`; just write `this.foo()`.
- **`naturalAlignForOpcode(op)` in `src/core/opcode.ts` is the canonical per-opcode natural-alignment
  lookup** (~80 entries: core loads/stores + SIMD memory + atomics). The binary writer's `writeMemArg`
  uses it to fill the right LEB exponent when the IR carries `align = 0` (the parser's sentinel for
  "no explicit `align=N`"). The bridge's `alignBytesToExponent` calls it too. Don't duplicate the
  table — extend the central one. Writing `align = 0` as the exponent silently broke binaryen's
  optimizer (it reads the field as a hard constraint and bailed on rewrites → OOB at runtime);
  regression in `tests/tools/wat2wasm.test.ts`.

## IR-shape correctness invariants

- **`ReturnExpr.values: Expr[]`, not `value?: Expr`.** A multi-value `return` pushes N values; the IR
  captures them in stack order. The single-`value` shape silently dropped all but the first operand.
  Parser, binary reader, expr-visitor, and bridge all walk the full array.
- **f64 const bits are `bigint`, not `number`.** Split into `parseF32Bits()` (number) and
  `parseF64Bits()` (bigint) in `src/parser/wast-parser.ts`. Reassembling f64 bits as
  `(hi * 2^32) + lo` lost precision above 2^53. Also: integer literals like `f64.const 1` must be
  IEEE-754-encoded via `setFloat64`, NOT stored as the raw bit pattern (raw → subnormals:
  `f64.const 1` → 5e-324). Module-level `F32_BUF`/`F64_BUF` DataViews avoid per-call allocation.
- **`SimdLaneOpExpr.value?: Expr`** is set for `*.replace_lane`, undefined for `*.extract_lane`. The
  old IR had only `operand`, dropping the scalar replacement value. Parser routes per-opcode arity
  via `instrInputCountForTok` + `isReplaceLaneOpcode` (extract=1, replace=2). Binary reader pops two
  operands for replace_lane. Bridge dispatches to `makeSIMDExtract`/`makeSIMDReplace`.
- **`(elem (i32.const N) $f1 $f2)` is the bare-offset elem form** — `parseElemModuleField` falls
  through to a `peek()===Lpar && peek(1)!==Item` branch calling `parseOffsetExpr`. Wasic emits this
  for every active table segment; without the fallthrough the parser chokes.
- **GC abstract heap types live in the `Type` enum, not a separate enum (v1.1.9).** `AnyRef` (0x6e),
  `EqRef` (0x6d), `I31Ref` (0x6c), `StructRef` (0x6b), `ArrayRef` (0x6a), `NullRef` (0x71),
  `NullFuncRef` (0x73), `NullExternRef` (0x72) sit alongside the MVP ref types in
  `src/core/types.ts`. All eight parse as plain value types and map through the bridge type-map.
  Extend `Type` — don't add a parallel "GC types" enum.

## Parser statement / operand ordering invariants

- **A value-producing instruction at statement position is committed via `pushStmt`, which flushes
  the operand stack first — never push to `ctx.stmts` directly (Bug, v1.3.0).** The parser keeps
  `ctx.stack` (operands a later instr might consume) and `ctx.stmts` (committed statements).
  `instrProducesValue` returns true for `call` (arity unknown without the signature), so every call
  lands on `ctx.stack`. A void call at statement position is never consumed and lingered until the
  block's end-of-body `flushStack`, which appends leftovers AFTER every following statement — so
  `(call $f …) (local.set …) (return X)` sank the call past the `return` into dead code and its side
  effect never ran. Fix: `pushStmt(ctx, expr)` drains `ctx.stack` into `ctx.stmts` (preserving order)
  before committing each statement. ALL statement-position pushes (folded + linear plain instrs, and
  every void block/loop/if/try/try_table) go through `pushStmt`. Regression:
  `tests/parser/stmt_order.test.ts`.
- **Empty-folded ops consume preceding stack values, but only what's available (Bug D + Bug F,
  v1.1.7).** `parseFoldedInstr` falls back to popping from `ctx.stack` when a folded plain instr has
  fewer inline sub-exprs than the opcode's input count, so `(i32.const 5) (local.set $x)` works like
  the linear form. Critical for wasic's multi-value receive idiom
  `(call $two_returns) (local.set $b) (local.set $a)`. For variable-arity opcodes
  (`call`/`return`/`br`/`br_table`/`throw`) with no children, the parser drains the surrounding
  stack. **The `available = Math.min(deficit, ctx.stack.length)` clamp is load-bearing** — without it
  ops with optional operands (`br_if`/`br` `value`) misroute their single inline child into the
  optional slot and pad the required slot with Nop; since `resolveNames` doesn't recurse into
  `BrIf.value`, name-vars inside silently emitted as index 0 (Bug F). Regressions:
  `tests/parser/empty_folded.test.ts`.
- **`instrInputCount` arities must match `buildPlainExpr`'s `opN()` consumption.** The fallback
  popping is driven by `instrInputCountForTok(tok)`; an entry that disagrees with how `buildPlainExpr`
  reads operands drops operands (too low) or pulls bogus nops (too high). Bug D exposed pre-existing
  mismatches: `SimdShuffleOp` listed at 3 (real 2), `SimdStoreLane` at 4 (real 2), `SimdLoadLane`
  missing (real 2). When adding an opcode to `buildPlainExpr`, audit its `opN()` calls and add a
  matching `instrInputCount` entry.

## resolveNames completeness

- **`resolveNames` must resolve every name-bearing immediate, not just the obvious ones (Bug G,
  v1.2.0).** `call_indirect` carries a `typeVar` (function-type index) besides its `table` var.
  Pre-v1.2.0 `resolveNames` skipped `typeVar`, so `(call_indirect (type $name) …)` with a
  named-but-not-first type kept the name-var unresolved and the writer's `writeVar` fallback emitted
  index 0. Now a `resolveTypeVar` helper (paralleling `resolveFuncVar`/`resolveGlobalVar`) is wired
  into `call_indirect`/`return_call_indirect`. When adding any IR variant whose immediates reference
  type/func/global/table/tag/field, ensure `resolveNames` walks every one — **the binary writer
  treats any unresolved name-var as index 0** (fail-silent → fail-loud is the goal; see
  cross-project footgun policy).

- **A `case` grouped with a LEAF must actually be a leaf (T13.11, 2026-08-25).** `table.get` sat on
  the same `case` label as `table.size` and inherited its "resolve the table var, spread `...e`,
  done" body — but `table.size` has no sub-expressions and `table.get` carries the element `index`.
  So any name-var inside the index was never walked, and since `writeVar` is fail-loud now the whole
  module failed to encode: `(table.get $t (global.get $g))` and `(table.get $t (call $f))` both died
  with `unresolved name-var`. Its sibling `table.set`, three lines below in the same switch, resolved
  both of its operands correctly — **a sibling that does what its neighbour skips remains the
  strongest single tell.** Regression: `tests/ir/table_get_index.test.ts`.
- **`resolveNames` completeness has TWO axes, and the `Var` audit only covers one.** The standing
  rule above is about name-bearing IMMEDIATES (`Var` fields). This bug was a `Expr` field — a
  sub-expression that was never recursed into — so the `Var`-only audit came back clean while the
  bug was live. Audit both: every `Var`-typed field vs. its case body, AND every `Expr`-typed field
  vs. its case body. Run mechanically over `ir.ts` on 2026-08-25, the `Expr` axis reported exactly
  one miss across all 75 sub-expression-bearing interfaces (this one) and the `Var` axis reported
  none across all 64.

## Legacy exception handling

- **Legacy `(try (do body) (catch $tag handler)* (catch_all handler)? (delegate $target)?)` parses to
  a real `TryExpr` with full dispatch (v1.2.9).** Superseded by `try_table`, but wasic still emits
  this for every TypeScript try/catch/throw. Both the folded form and the linear
  `try … catch … end` / `try … delegate $l` form build a `TryExpr` (`body` + `Catch[]` + optional
  `delegate`). The binary writer emits the `try`/`catch`/`catch_all`/`delegate`/`end` opcode edges.
  `resolveNames` resolves each catch's `tag` (tag scope), the optional `delegate` (label, against the
  **outer** scope after the try's own label is popped), and `rethrow` `depth` (label).
  **Handler bodies emit a leading `nop` before each stack-consuming op:** a folded `(local.set $x)`
  with no inline operand gets a `Nop` placeholder because at parse time the catch body stack is
  empty, but the runtime's `catch` edge pushes the tag's params, so `local.set` consumes them and the
  `nop` is harmless. Earlier code coerced the whole thing to a `BlockExpr`, merging handler instrs
  into the body and dropping dispatch edges → V8 rejected it ("not enough arguments on the stack for
  local.set"). A latent WAT-*writer* bug also surfaced: `writeCatch` wrote the handler body AND the
  ExprVisitor's `try` case walked `c.body` again — duplicating every handler instr in `wasm2wat`
  output; fixed by dropping the body walk from `writeCatch` (the visitor owns it). Regressions:
  `tests/parser/legacy_try.test.ts`. The linear `try_table` form is still a stub (skips catch
  immediates to `end`); the folded `try_table` form has full support.

## GC type-encoding caveats (flagged, fixes deferred)

These are known discrepancies that don't escape through the bridge (binaryen-ts re-encodes its own
way) but would make wabt-ts's **standalone** binary writer wrong. Tracked for the typed-ref IR
refactor.

- **Typed-ref IR is loose: `(ref $T)` / `(ref null $T)` coarsen to `Type.StructRef`** in `Type[]`
  slots (v1.2.3+). The flat `FuncSignature.params: Type[]` can't carry a heap-type index. The parser
  recognizes the syntax but stores `Type.StructRef` as placeholder; the writer emits structref bytes,
  so V8 rejects binaries with typed-ref params through this path. GC Tier 2–4 tests verify binary
  encoding rather than V8 round-trip. Proper fix: `FuncSignature.params: ValueType[]` where
  `ValueType = Type | { kind:'ref', heapType, nullable }` — a significant cascade through validator,
  reader/writer, WAT writer, bridge.
- **`Type.I8 = 0x7a` / `I16 = 0x79` disagree with the spec wire encoding (0x78 / 0x77).** The enum
  values match the unsigned-byte reading of the MVP LEB encodings but the GC packed types extend the
  sequence to 0x78 (i8=-8) / 0x77 (i16=-9). Doesn't escape (binaryen-ts emits 0x78/0x77 directly);
  wabt-ts's own writer would emit wrong bytes for packed fields. Fix: change the enum values, then
  run the full suite to surface call sites using the old values as opaque tokens. Exposure:
  `tests/bridge/gc_tier2.test.ts`.
- **GC opcodes split between core single-byte and `PREFIX_GC = 0xfb` (v1.1.9).** `ref.eq` is
  `Opcode.RefEq = 0xd3` — a CORE single-byte opcode (legacy from reference-types). Every other GC
  instruction (`struct.*`/`array.*`/`ref.i31`/`i31.get_*`/`ref.test`/`ref.cast`/`br_on_cast`) uses
  the 0xfb group with sub-opcodes in `GcOpcode`. The binary reader handles `Opcode.RefEq` in the main
  switch; everything else routes through `decodeGcOp` via the `PREFIX_GC` case. Don't move ref.eq
  into the 0xfb path. (A latent reader bug here built a `CompareExpr` instead of `RefEqExpr`; fixed —
  new ref-typed opcodes must not reuse `CompareExpr`.)
- **binaryen-ts encoder collapses `struct.get_u`→0x02 and `array.get_u`→0x0b** (`signed ?
  signed-opcode : base-opcode`), so non-packed `get` and `get_u` are indistinguishable on the wire.
  Functionally harmless (V8 recovers signedness from the packed field type). wabt-ts's own writer is
  spec-correct (3-way); the bridge routes via binaryen-ts so its output is 2-way. Bridge tests assert
  what the bridge emits, not what wabt-ts standalone would.

## 2026-06-09 silent-corruption audit (Critical + High fixes)

A six-subsystem audit found a cluster of silent-wrong-output bugs (the fail-loud footgun class).
All fixed with regression tests in `tests/audit/silent_corruption_fixes.test.ts`. The invariants:

- **The WAT lexer's SIMD opcode values must equal the canonical `opcode.ts` table.** A whole block
  of f32x4/f64x2 float opcodes had drifted (e.g. `f32x4.div` emitted `0xeb` instead of `0xe7`;
  `f32x4.ceil` `0xe7` instead of `0x67`), and `f64x2.pmin/pmax` collided with
  `f64x2.convert_low_i32x4_s/u`. `opcode.ts` is the source of truth; lex values were realigned to it.
  (Cross-check helper: parse both files and compare — the relaxed-SIMD ops 0x100–0x113 are absent
  from `opcode.ts`'s name table, a cosmetic objdump gap, not an encoding bug.)
- **Tag type indices are resolved from the signature, never hardcoded to 0** — both the binary
  writer (`tagTypeIndex`, fail-loud if no matching `(func (param …))` type) and the validator
  (`resolveTagSig`, for imported tags too). **The binary reader's tag-IMPORT decode must consume the
  attribute byte (0x00) before the type index** (surfaced by the fix's round-trip test) — it read
  the index starting at the attribute, so every imported tag resolved to type 0 and following bytes
  misaligned. The defined-tag section reader already did this correctly.
- **SIMD memory opcodes decode by exact range:** `0x00-0x06` = loads, `0x07-0x0a` = `load_splat`
  (NOT plain `load`), `0x0b` = `v128.store` (2 pops, void — NOT `load_zero`; the zero-extending
  loads are `0x5c`/`0x5d`). Consumers switch on the IR kind, so the kind must be right.
  (Still-open follow-up: the reader's `0x62-0x7b` + general SIMD fallback assumes *binary* arity and
  mis-decodes the many unary SIMD ops — popcnt/all_true/bitmask/ceil/floor/trunc/nearest/abs/neg/
  sqrt/extend/convert/trunc_sat. Needs a per-opcode SIMD arity table; flagged High.)
- **`resolveNames` resolves `call_ref` / `return_call_ref` `sigType`** (and walks their args+callee).
  Same Bug-G class as `call_indirect.typeVar` — any name-bearing immediate left unresolved is
  emitted as index 0.
- **`trunc_sat` (`i*.trunc_sat_f*`, misc-prefixed `0xfc0X`) is type-validated via
  `getMiscOpcodeTypeInfo`.** `getOpcodeTypeInfo` now routes `(opcode >>> 8) === PREFIX_MISC` to it;
  previously these fell through to the SIMD `(v128,v128)→v128` default, so wrong-typed operands
  validated clean.
- **Legacy multi-`catch` decode assigns each catch's flushed body before opening the next** (mirrors
  `catch_all` / the `End` finalizer). The old code discarded every catch body except the last.
- **SIMD lane ops validate per-opcode:** `extract_lane` pops v128 / pushes the lane scalar type;
  `replace_lane` pops [v128, scalar] / pushes v128; the lane immediate is range-checked against the
  shape's lane count. `getExprArity` for `simd_lane_op` is 2 when `value` is set (replace), else 1.
- **The WAT writer uses the central `naturalAlignForOpcode` from `core/opcode.ts`** — never a local
  copy. The deleted local duplicate covered only core load/stores (`default: 1`), so SIMD memargs
  printed a spurious/wrong `align=`. (Same duplicate-table regression class as the perf invariants.)
- **`applyNames` does not rewrite `local.get`'s var** (locals aren't in the function-name space; the
  per-function `localNames` map isn't populated). The old code routed it through `funcNames`, so a
  local index colliding with a named func index was renamed to that function.
- **Table initializer expressions (`(table … init …)` / the binary `0x40` form) are resolved
  (`resolveModule` walks `table.init`) and emitted (the binary writer writes the `0x40 0x00 reftype
  limits init_expr` shape).** The reader already decoded the form; the writer silently dropped it.

### Round 2 (second sweep) — more of the same class

Regression tests in `tests/audit/silent_corruption_fixes_round2.test.ts`.

- **`writeVar` is FAIL-LOUD on a name-form var** (`src/writer/binary-writer.ts`) — it throws instead
  of emitting index 0. This is the *root* of the Bug-G family; the sibling `writeHeapType` was
  already fail-loud and its comment referenced `writeVar`'s silent fallback, which had never been
  fixed. Consequence: every `resolveNames` gap now surfaces as a hard throw at encode time instead of
  silently-wrong wasm — so resolveNames completeness is load-bearing (the 272-file wasmtk corpus
  passes, proving real modules fully resolve). NOTE: `writeMemArg` keeps its own inline `:0` for
  `memidx` (not via `writeVar`), so a *named* non-zero memory in a load/store memarg is still a
  latent silent-0 — exotic multi-memory only; harden if it ever surfaces.
- **`resolveNames` walks `simd_lane_op.value`** (the replace_lane scalar) and resolves
  `elemSegment.tableVar` / `dataSegment.memoryVar` in `resolveModule`. Globals/funcs/tables are NOT
  resolved at parse time (only locals are), so a `(global.get $g)` inside a replace_lane value, or a
  `(elem (table $t1) …)` / `(data (memory $m1) …)` on a named non-zero table/memory, previously
  leaked a name-var to the writer.
- **SIMD reader operand arity is per-opcode, not "assume binary" (`decodeSimdOp`).** Module-level
  `SIMD_UNARY_OPS` set drives 1-pop decoding; `v128.bitselect` (0x52) is the lone non-relaxed
  ternary (3 pops); everything else is binary. The old code popped 2 for every arith/convert op,
  corrupting the stack for all unary SIMD (abs/neg/sqrt/ceil/floor/trunc/nearest/popcnt/all_true/
  bitmask/extend/extadd_pairwise/trunc_sat/convert/not/any_true/demote/promote). **Also the lane
  load/store ranges were wrong:** load_lane is `0x54-0x57`, store_lane is `0x58-0x5b` (the old code
  used `0x54-0x5b` for load — swallowing the stores — and `0x5e-0x61` for store, which are actually
  the unary demote/promote/abs/neg). Known remaining limitation: genuinely-ternary *relaxed*-SIMD
  ops (`0x105-0x10c`, `0x113`) still decode as binary because the `(prefix<<8)|sub` opcode encoding
  collides for `sub >= 0x100` (flagged in `opcode.ts`).
- **`parseLimits` detects the `i64`/`i32` index type** for the memory64 proposal (`(memory i64 N)`).
  The old code matched `TokenType.I64X2` (a SIMD shape token that can never appear there) and always
  returned `is64: false`, so memory64 from text silently lost its 64-bit flag. (Table64 from text —
  where the index type precedes the reftype — is a separate, still-open narrow gap.)
- **The binary reader fails loud on an unknown `try_table` catch-kind byte** instead of defaulting to
  `Catch` without reading the tag varint (which desynced the byte stream). The outer `this.ok()`
  guard halts decoding once the error is recorded.
- **Dead code removed:** `WastParser.ok()` (unused), `TypeEntry`'s `tailcallTarget?` field (never set
  or read), and `WatWriter`'s five unused `*Imports: Import[]` fields (the inline-import path is a
  no-op). `Func.tailcall` and `Module.featuresUsed` are inert/write-only but kept (documented
  placeholders / plausibly-public IR surface).

### Round 3 (third sweep) — core encoding + remaining backlog

Regressions in `tests/audit/silent_corruption_fixes_round3.test.ts`.

- **LEB128 decoders reject out-of-range encodings** (`src/core/leb128.ts`). `decodeU32Leb128` already
  validated its 5th byte, but `decodeU64Leb128` / `decodeS32Leb128` / `decodeS64Leb128` silently
  truncated an over-range terminating byte via `asUintN`/`asIntN`/`| 0`. They now throw: u64 rejects a
  10th byte with bits 1-6 set; s32/s64 require the terminating byte to be a proper sign-extension
  (bits all-0 or all-1).
- **`parseNatText` strips ALL digit separators** (`text.replace(/_/g, '')`). The old
  `replace('_', '')` removed only the first underscore, so any literal with ≥2 separators
  (`1_000_000`) threw → `null` → callers silently defaulted to index/value **0**. The remaining
  `?? 0` / `?? 0n` index-default sites (`parseRefImmediate` type index, `i8x16.shuffle` lanes,
  `parseSimdLane`) now emit a parse error on a malformed literal instead of defaulting to 0.
- **Canonical quiet NaN prints as bare `nan`** (`printF32Literal` / `printF64Literal`). The f32
  `payload === 0 ? '200000'` fallback re-parsed to a DIFFERENT NaN (`0x7fc00000` → `0x7fe00000`)
  because the parser re-adds the quiet bit; bare `nan` round-trips. (f64 happened to round-trip by
  coincidence; made consistent.)
- **Binary-writer segment encoding hardened.** New `varIndexValue(v, label)` helper (fail-loud sibling
  of `writeVar`) replaces the inline `kind === 'index' ? value : 0` fallbacks for elem `tableVar` /
  data `memoryVar` — an unresolved name-var there silently retargeted the segment to table/memory 0.
  Active table-0 elem segments use flags 4 (which carries **no** reftype byte) only when the element
  type is funcref; a non-funcref (e.g. externref) segment now uses flags 6 so the reftype survives. A
  `declared`-kind **data** segment (meaningless — declared is elem-only) now throws instead of being
  silently re-encoded as passive.
- **WAT writer atomic memargs use `naturalAlignForOpcode(e.opcode)`**, not a hardcoded `1` — so an
  atomic op at its natural alignment no longer prints a spurious `align=` (and notify uses the
  central table via its fixed opcode). Restores the central-natural-align invariant for atomics.
- **`onTag` propagates `Result.Error`** when a tag signature has results (was adding the error to the
  list but returning `Result.Ok`). **Bridge `replace_lane`** throws on a missing scalar `value`
  instead of fabricating a `nop`. **`parseRefType`** drops the dead `isNull ? Type.FuncRef :
  Type.FuncRef` ternaries (the flat `Type` enum can't carry nullability — documented typed-ref-loose
  limitation; the ternaries implied otherwise).
- **`applyNames` partial-recursion gap documented + `call_indirect.typeVar` rewritten.** The
  expression-var rewriter's `default` doesn't descend into every composite node, so a name-bearing
  var under an unhandled node stays index-form. This is **fidelity-only** (output stays valid as
  numeric indices) and `applyNames` is not wired into any tool pipeline (`wasm2wat` uses
  `generateNames`); the docstring no longer overstates coverage, and the `typeVar` immediate (mirror
  of the resolveNames Bug-G fix) is now rewritten. Folding `applyNames` onto `ExprVisitor` to walk
  every child is the tracked follow-up.

**Verified clean this round:** `expr-visitor` walks every child of every variant; the bridge has no
silent-wrong case (all gaps are fail-loud throws); tool pipelines (wat2wasm/wasm2wat/validate/strip)
are correctly ordered; no new dead code beyond what round 2 removed. **Still-open / deferred:**
`assert_trap (module …)` mislabeled `assert_invalid` (wast-script only; needs a command-type change);
`wasm-objdump -h` no-op; `wabt-compat` `write_debug_names` ignored (documented); the `applyNames`
ExprVisitor rewrite; `parseHexFloat` full-mantissa precision (lexer-level; const path uses the
dedicated `parseF64Bits`).

### Round 4 (fourth sweep) — validator soundness + lexer fail-loud

Targeted the less-reviewed lexer internals and deeper validator logic. Regressions in
`tests/audit/silent_corruption_fixes_round4.test.ts`.

- **`return_call` / `return_call_indirect` / `return_call_ref` result-type soundness**
  (`type-checker.ts popAndCheckReturnCall`). A tail call returns the callee's results directly to the
  caller's caller, so the callee result types must match the ENCLOSING FUNCTION's result types — a
  type-vector comparison against `getFuncLabel().resultTypes`, NOT a `checkSignature` peek of the
  operand stack (which holds only the already-popped params). The old peek let a tail call to a
  wrong-result-type function validate clean.
- **`return_call_ref` pops the function reference** (new `TypeChecker.onReturnCallRef`, mirroring
  `onCallRef`). The old path routed through `onReturnCall`, leaving the ref operand on the stack —
  an off-by-one for every `return_call_ref`.
- **`try_table` catch tag immediates are bounds-checked** (`onTryTableCatch` + the validator's
  `beginTryTableExpr` now walks `e.catches`). An out-of-range tag in a catch clause previously
  validated clean. (Remaining gap: the catch branch-target *type* reconciliation against the labeled
  block type — the flat operand model doesn't carry the tag's params into the target check.)
- **`onAtomicFence` propagates `Result.Error`** for a non-zero consistency model (same fix family as
  `onTag` — error was recorded but the node returned Ok).
- **Lexer fail-loud:** an unterminated string at EOF now records an error (was a silent bare EOF);
  a bare `$` with no idchars errors as an empty identifier (was a `Var` with text `"$"`); `\u{}` with
  no hex digits errors (was silently U+0000).
- **Dead code removed:** `TypeChecker.typeStackSize()` / `isUnreachable()` and
  `SharedValidator.endTryTable()` (the try_table label closes via `onEnd`). These had been flagged in
  round 1 but not actually removed until now.

**Verified clean this round:** token classification (value-type vs refkind payloads), number/escape
lexing aside from the gaps above, `matchStr` rewind, comment nesting, sign+inf/nan paths; validator
error-propagation (all other `printError` sites fold into the Result), begin/end label pairing, no
silent-accept switch defaults. **Still-open / minor:** lexer accepts trailing/consecutive
underscores (value still correct) and has a dead `isDigit && !readNum()` guard in `getNumberToken`;
`LexerSource.slice`/`size`/`isEof`/`peek(offset)` are unused but public API; plus the carry-over
deferred items (`assert_trap (module)` mislabel, `wasm-objdump -h`, `wabt-compat write_debug_names`,
the `applyNames` ExprVisitor rewrite, `try_table` catch branch-type reconciliation).

### Round 5 (fifth sweep) — generateNames produced invalid WAT

Targeted the least-reviewed files. One HIGH-severity bug + two related issues, all in
`src/ir/generate-names.ts`. Regression in `tests/audit/silent_corruption_fixes_round5.test.ts`.

- **Synthetic names MUST carry the leading `$`.** `make()` returned `${prefix}${index}` (`f0`, `g0`,
  `t0`, `B0`) with no `$`. The binary reader and WAT parser store names WITH the `$`, and the WAT
  writer emits them verbatim ("s must begin with '$'"), so `wasm2wat` of any nameless module (the
  common case) emitted `(func f0 …)` — **invalid WAT that does not round-trip** through `wat2wasm`
  (`expected (, got <token>`). Four prior passes missed it because no test round-tripped
  `wasm2wat → wat2wasm`; round 5 added that guard. Fixed: `make()` prepends `$`.
- **Alpha-name mode dropped the per-namespace prefix** — `indexToAlphaName(index)` alone made func 0,
  global 0, type 0 all `a`. Now `$` + prefix + alpha (`$fa`), so namespaces don't collapse.
- **No disambiguation against user names.** A module that names func 1 `$f0` (legal) while func 0 is
  unnamed would give two `$f0` funcs (duplicate binding / invalid WAT). `run()` now seeds a
  per-namespace `used` set from existing names and `uniqueName()` appends `_1`, `_2`, … until unique.

The existing `generateNames` unit tests in `tests/ir/ir.test.ts` had **codified the buggy bare
names** (`f0`/`g0`/`a`); updated to the correct `$f0`/`$g0`/`$fa`. The new round-5 test asserts the
`wasm2wat` disassembly of a nameless module re-compiles cleanly (the permanent guard for this whole
class) plus the collision-disambiguation case.

**Verified clean this round:** `core/binary.ts` (section IDs / external kinds / magic constants),
`core/feature.ts` (defaults), the `binary-reader-ir`/`-nop` shims, `apply-names` on the wrong-map
axis (every rewritten var uses the correct map), the GC decode paths (`decodeGcOp` struct/array/i31/
ref.test/ref.cast opcodes + pop orders) and the bridge GC type-lookup helpers.

### Round 6 (sixth sweep) — structural round-trip coverage, no new bugs

Rather than more static review (diminishing returns after five passes), this pass added the
property-test coverage that surfaces the round-5 class structurally: a `wat2wasm → wasm2wat →
wat2wasm` round-trip over all 272 wasmtk corpus modules (`tests/wasmtk/roundtrip.test.ts`) plus a
hand battery of feature-heavy modules (SIMD unary/binary/lane/store/splat/convert, trunc_sat,
atomics, multi-value, legacy try, memory64, tag import, v128 const). **All round-trip clean** — no
new bugs. This is strong evidence the `wasm2wat` output path is sound after the round-5 fix.

Lone known parser-completeness gap noted (NOT a silent-corruption bug — input is rejected, not
mis-compiled): the `(elem (offset) <reftype> (ref.null …))` elem-with-explicit-reftype item syntax
isn't parsed. Tracked with the other deferred parser-feature gaps.

## Documentation invariant (JSR score)

- **Every entrypoint needs an `@module` JSDoc header; every exported symbol needs a JSDoc comment
  (v1.2.7+).** The 7 subpath entrypoints (`src/index.ts`, the five `src/tools/*.ts`, and
  `src/api/wabt-compat.ts`) each carry `/** @module … */` with a usage example. The full exported
  surface (265 symbols as of v1.2.7) is documented. `deno doc --json src/index.ts` enumerates every
  symbol. Don't add a new export without at least a one-line JSDoc.

## Invariants added 2026-08-24 (T10 close-out + the post-campaign audit)

Full detail and the incident behind each: [tasks.md](tasks.md).

- **The inline `(export "n")` abbreviation is not always faithful (T10.1 / T10.2).** Illegal on an
  IMPORT, and it RE-ORDERS the export section, which is observable through
  `WebAssembly.Module.exports()`. `buildExportMap` tests both up front and falls back to standalone
  fields. The order test is exact: under full inlining the emitted sequence is a STABLE SORT by
  item-visit position, so it is the identity exactly when those positions are non-decreasing.
  All-or-nothing per module — standalone exports are written after every item.
- **A variable-arity opcode must not drain the operand stack (T10.5).** `varArityForTok` resolves
  `call` / `return_call` against the callee's signature and `array.new_fixed` against its immediate
  count. **Function BODIES are parsed after the whole module field list** so a body sees signatures
  declared later — 199 of 270 corpus modules have a forward reference. `br`, `return`, `throw`,
  `call_indirect`, `call_ref` and `struct.new` still drain.
- **A synthesized operand slot-filler is not an instruction (T10.8).** `NopExpr.placeholder`, built
  only by `operandPlaceholder(loc)`; **neither writer emits one**. Build every slot-filler through
  that helper — there are ~110 construction sites, and the 13 in `buildPlainExpr`'s `op0()`…`op4()`
  were worth 45 of 60 affected files on their own. The marker is what keeps this inside the T11
  no-repair rule.
- **The WAT writer is linear, but a few grammar slots need FOLDED output (T10.3).**
  `writeFoldedConstExpr` covers CONSTANT expressions only — a set the spec closes — and takes each
  instruction's own text from the ordinary delegate, so no immediate formatting is duplicated.
  Anything it cannot express THROWS.
- **A parser branch that only handles the FOLDED form is a round-trip hole (T10.6)**, because the
  WAT writer is linear-only. `try_table`'s linear branch was a stub that skipped its catch clauses
  AND its body. Grep for other "linear form is a stub" comments.
- **A `ValueType` is compared with `valueTypeEquals`, never `===` (T10.7)** — it is a number OR an
  object. And a fail-loud path is only as useful as what it prints: this one rendered params with
  `(p as number).toString(16)`, i.e. `[object Object]`.
- **`nan:0x<n>` names the mantissa EXACTLY (T10.4).** Bare `nan` is the canonical quiet NaN and
  nothing else. There were TWO NaN parsers and the printer was the inverse of the one nothing
  called.
- **`resolveNames` must resolve EVERY Var on a node, and a sibling case is the tell.**
  `atomic_rmw_cmpxchg` / `atomic_wait` carried `memidx` through unresolved while four sibling
  atomics resolved it, so a named multi-memory atomic silently hit the WRONG memory. Found by
  auditing the type, not a corpus.
- **Every memarg handler checks `offset` against the memory's index type (T9.11)** — not just
  `onLoad` / `onStore`. Ten handlers declared the parameter and ignored it; four were false-accepts.
- **`instrInputCount` must have an entry for every token `buildPlainExpr` reads operands for.** The
  `default: return 0` is silent: the LINEAR form pops nothing and every operand becomes a
  placeholder, while the FOLDED form still works off its inline children. `TokenType.Quaternary`
  (`i64.add128` / `i64.sub128`) was the third instance after two SIMD ones. **The bytes can still be
  correct** — `pushStmt` flushes the orphaned operands in order and a placeholder emits nothing — so
  no metric catches it; what breaks is the IR TREE, which is what the bridge and `wasm2ts` read.
- **What `wat2wasm` accepts, `wasm2wat` must be able to read back.** The lexer mapped
  `i64.add128` / `i64.sub128` to `TokenType.Quaternary` while the binary reader had no case for
  `0xfc 0x13` / `0x14`, so our own front end produced modules our own back end rejected with
  `unknown misc opcode: 19`. When adding an instruction, walk BOTH directions of the pipeline.
- **Every LEB encoder rejects what it cannot represent — all FOUR of them (T13.12, 2026-08-25).**
  `encodeU32Leb128` and `encodeU64Leb128` were hardened for T11/T13 and throw a `RangeError`; the
  two SIGNED encoders beside them were left on `value | 0` / `BigInt.asIntN(64, value)`, which wrap
  — 2^31 encodes as -2^31, 2^63 as -2^63 — i.e. they silently returned the encoding of a DIFFERENT
  value. All four throw now. Nothing reaches it from WAT (the parser normalises an i32 literal into
  signed range before the IR sees it and rejects anything outside), but `writeBinaryIr` is a
  published entrypoint, so a hand-built IR could get a silently different module back. **The
  boundary values themselves are asserted to still round-trip**, so the check cannot degrade into a
  blanket refusal.

## Dependency pinning (T13.23, 2026-08-25)

- **`@jrmarcum/binaryen-ts` is pinned EXACTLY (`@1.0.9`, no caret) and that is a CORRECTNESS pin,
  not a compatibility one.** The bridge is bug-compatible with 1.0.9's `try_table` catch scope
  (T13.22); a newer release breaks the cancellation. It was `^1.0.9` with only `deno.lock` holding
  the actual version while JSR already carried 1.4.3, so a `deno cache --reload` could have floated
  it with no commit and nothing to review. **Do not restore the caret** until the coordinated fix
  lands — see the ⚠ block at the top of [bridge.md](bridge.md).

## CLI shims guard their file I/O (T13.31, 2026-08-25)

- **No `if (import.meta.main)` block calls `Deno.readFile` / `writeFile` / `writeTextFile`
  directly.** Each tool defines `cliRead` / `cliWrite`, which print
  `<tool>: cannot read '<path>': <reason>` and `Deno.exit(1)`. A bare call throws an uncaught
  `NotFound` / `IsADirectory` that Deno renders as a stack trace naming its own internals and the
  ABSOLUTE PATH of our source — the wrong output for a user typo, and it leaks local paths into
  anything pasted into a bug report. All five tools did this, in both failure modes. Same rule as
  T13.29 / T13.30, one layer further out. **The doc-comment examples above each main block still
  show bare `Deno.readFile` and should** — those illustrate LIBRARY usage, where the caller owns
  its own I/O. Gated by `tests/tools/cli_io_errors.test.ts`, whose source half runs under the
  suite's `--allow-read`.

## `/compat` error shape (T13.30, 2026-08-25)

- **Every `/compat` failure is an `Error` that NAMES the method it came from.** Its three failure
  paths must agree: `parseWat` and `readWasm` throw `new Error(formatErrors(errors))`, and
  `toBinary` wraps the fail-loud binary writer as
  `toBinary: the module could not be encoded: …` rather than propagating the writer's raw internal
  string. A caller writes one `catch`; two shapes make the useful errors indistinguishable from the
  useless ones. **A method that can fail says so in its doc comment** — `toBinary`'s did not, and it
  is reachable with no caller mistake, because decoding does not check what encoding requires
  (index validity is the validator's job). `/compat` is the wasmtk-facing migration surface, so this
  matters more than the CLI equivalents. Regression: `tests/api/compat_error_shape.test.ts`.

## The binary path never throws (T13.29, 2026-08-25)

- **`wasm2wat` / `wasmValidate` / `wasmObjdump` / `wasmStrip` return `{ errors, result }` and must
  never throw**, whatever bytes they are given. This is T7.1's parser-robustness rule applied to the
  binary front door, which it had never covered. **`core/leb128.ts` still throws and must keep
  throwing** — it is a pure decoder and the WAT parser and bridge depend on that; the conversion
  belongs at the READER boundary, in the four `readXLeb` helpers, plus a backstop `try/catch` in
  `readBinaryIr` because one unconverted throw in 3000 lines reproduces the whole defect. The
  converting helpers park the cursor at end-of-input so a caller ignoring the error flag cannot
  spin. **`wasmStrip` additionally guards its RE-ENCODE**: a module can decode cleanly and still be
  un-encodable (index validity is the validator's job), and the binary writer is deliberately
  fail-loud (T10.7) — the tool catches, the writer does not soften. Regression:
  `tests/tools/malformed_never_throws.test.ts`.

## The subtyping graph is bounded and acyclic (T13.34, 2026-08-25)

- **A type's subtyping DEPTH (its ancestor count) may not exceed 63**, and **the supertype graph
  must be ACYCLIC**. Both are enforced by Wasmtime and V8; we checked neither, so a 2000-deep chain
  and `$a <: $b <: $a` both validated clean. The depth cap is a GC-proposal implementation limit
  that makes a subtype check O(1). `SharedValidator.checkSubtypingDepth` does both — the walk must
  detect cycles to terminate anyway, so reporting them is free. It runs AFTER the whole type section
  is registered, because a type may legally name a supertype declared later in its own rec group,
  and it memoises so a long chain stays linear.
- **Cycles in the SUPERTYPE graph are illegal; mutual REFERENCES between types are not.** A rec
  group whose members hold fields of each other's types is the entire point of rec groups. Do not
  let a cycle check conflate the two — the regression test pins the legal case alongside the
  illegal ones. Regression: `tests/validator/subtype_depth_and_cycles.test.ts`.

## A declared count must match what follows (T13.33, 2026-08-25)

- **Every section reader checks the section bound INSIDE its loop and REPORTS**, via
  `shortSection()` or `this.err`. Putting `this.pos < end` in the loop CONDITION instead makes
  running out of input indistinguishable from finishing normally — `readTypeSection` did that in
  both of its loops, so `(type count 4294967295)` with no entries decoded to zero types and
  validated clean while V8 rejects it. Ten of the eleven readers had it right; copy them.
  Regression: `tests/reader/section_count_truncation.test.ts`.
- **Enormous declared counts must fail FAST and LOUDLY — both halves.** A 14-byte module declaring
  4.29 billion entries must neither loop nor allocate before checking the remaining input (all
  eleven sections already bail in 0 ms, and a test step pins that), and must not bail silently,
  which was the bug. Fast-and-silent looks identical to correct from the outside.

## Decoder must not normalise (T13.26, 2026-08-25)

- **A memarg alignment exponent is `2 ** alignLog2`, never `1 << alignLog2`.** JS shift operands are
  taken mod 32, so exponent 32 wrapped to align 1 and 33 to align 2 — a *smaller* alignment than
  natural, which `checkAlign` accepts. V8 and Wasmtime both reject those modules, and `wasm2wat`
  printed the result as `align=1` so re-encoding produced a VALID, different program. **That is T11
  through the decoder**: the rule "the pipeline must never turn invalid input into valid output"
  binds the reader as much as the encoder. Regression:
  `tests/reader/memarg_align_wrap.test.ts`.
- **When a value comes out of a bit operation, probe the OPERATION's boundaries, not the domain's.**
  Alignment reviewers think 1/2/4/8/16 and "something huge"; every one of those was either valid or
  rejected. Exponents 31 and 63 wrap NEGATIVE and were rejected by accident, so a large-value spot
  check gave the right answer for the wrong reason. The live range was 32..62, which nothing about
  alignment suggests.

## Source hygiene (T13.25, 2026-08-25)

- **No control bytes in any `.ts` under `src/` or `tests/`** — TAB, LF and CR excepted. This is not
  style: a NUL makes grep classify the file as BINARY, so it prints `Binary file … matches` INSTEAD
  of the match lines and the file drops silently out of every grep-driven sweep — while the sweep
  still reports clean. Every enumeration in this project's audit definition is grep- or
  regex-driven, so one invisible byte narrows the population all of them measure. It happened to
  `binaryen-bridge.ts` (our own `IF_FRAME` sentinel) and cost an alignment sweep its validity.
  **Sentinel values must be visible strings** — `'<if-frame>'` is as collision-proof as `'\0if'`
  was, since real labels always begin with `$`. Gated by `tests/audit/source_hygiene.test.ts`,
  which also pins its own scanned-file count so a broken walk cannot pass as a clean tree.

## Bridge label frames (T13.24, 2026-08-25)

- **Every construct that is a branch target in wasm needs a frame on `ctx.labelStack`, labeled or
  not.** `if` pushed none, so every `br` inside one resolved one frame too shallow — `br 0` silently
  retargeted the enclosing block (valid module, different answer) and `br 1` rejected valid input.
  The case DID reject a *labeled* `if` with a comment explaining why, which is what made it read as
  covered: **the comment answered the question that was asked, and nobody asked about the unlabeled
  case.** A sentinel `IF_FRAME` is now pushed after the condition is bridged (the condition is
  evaluated before the if is entered, so a `br` in it targets the enclosing scope), and
  `resolveLabel` THROWS if a target lands on it — binaryen-ts cannot express a branch to an
  unlabeled `if`, and resolving to the enclosing block is the silent wrong answer. **The default of
  "not pushing" is never right**; when adding a construct, push the frame and decide explicitly what
  a branch TO it does. Regression: `tests/bridge/label_frames.test.ts`.

## try_table catch scope — the third layer (T13.22, 2026-08-25)

- **`try_table` catch targets resolve in the ENCLOSING scope, in EVERY layer — and the bridge is
  the third layer to get it wrong.** Fixed in the parser (T7.6), reintroduced in the validator
  (T9.8), and now found in `src/bridge/binaryen-bridge.ts`, which pushes the try_table's own label
  before resolving `tt.catches`. `resolveNames` is the reference implementation: it resolves the
  catches, THEN pushes. **The bridge is deliberately NOT fixed yet** — its error cancels a matching
  one in binaryen-ts 1.0.9, so applying it alone emits catch depth 2 where 1 is correct. It is
  coupled to the dependency bump; see the ⚠ section at the top of [bridge.md](bridge.md), which is
  the file anyone changing the pin will open.
- **The bridge belongs in every layer-sweep even though it ships to nobody.** No published
  entrypoint reaches it, which is why it was skipped in both earlier sweeps of this exact rule.
  That is an argument about fix PRIORITY, not about whether to look.

## Validator operand checks (T13.14, 2026-08-25)

- **A GC instruction must check WHICH reference it got, not merely that it got one.**
  `popAnyRef` in `type-checker.ts` answers "is this SOME reference" and nothing more. Used alone it
  made `ref.test` / `ref.cast` / `array.len` accept an operand from an unrelated hierarchy —
  `ref.test (ref null any) (local.get $funcref)`, `array.len` on a `(ref $struct)` — all of which V8
  and Wasmtime 47.0.3 reject. `array.len` now pops against `(ref null array)`; the two cast
  instructions go through `popCastOperand`. **The rule is SHARED HIERARCHY, not subtyping**: both
  engines accept a WIDENING cast, so a subtype test in either direction is wrong in the other
  direction. `topOfAbstract()` names the root of each of the four hierarchies (`any` / `func` /
  `extern` / `exn`) for exactly this comparison; it is NOT a substitute for `isSubtype`, which
  `br_on_cast` still needs. Keep both.

- **A bare `dropTypes(n)` in an instruction handler is an unchecked pop.** `onRefI31`, `onI31Get`
  and `onRefIsNull` each popped one operand with no type check at all, so `ref.i31` accepted an i64
  and `ref.is_null` accepted an i32. Use `popAndCheck1Type` (or `popAnyRef` where any reference
  really is legal) — `dropTypes` alone is for operands whose type has already been checked, and a
  new handler that reaches for it is almost always a missing check.

- **PEEKING an operand is not CHECKING it (`ref.as_non_null`).** It read `peekType(0)` to compute
  its result type and then dropped unconditionally; `nonNullable()` returns a non-reference
  unchanged, so an i32 was popped and pushed straight back. It only ever LOOKED rejected because
  the fixtures had a declared result type that disagreed — make the result agree with the wrong
  operand and it validates clean. **When a probe rejects, confirm it rejected for the reason you
  are testing**: that fixture had two reasons to fail and the check being audited was not one of
  them.

- **`struct.get` / `array.get` signedness is a TRI-STATE and is load-bearing.** `signed` is
  `undefined` for the plain spelling, `true` for `_s`, `false` for `_u` — the encoding both writers
  already read. `_s`/`_u` are legal only on a PACKED (`i8` / `i16`) field or element and are
  REQUIRED there; the plain form is legal only on an unpacked one. `checkPackedAccess` enforces both
  directions for structs and arrays. Previously `onStructGet` declared the flag as `_signed` and
  dropped it and `onArrayGet` did not take it at all, so all four illegal combinations validated —
  the same shape as T9.11's ten unused `offset` parameters, and **an underscore-prefixed parameter
  in one of a family of parallel handlers stays the strongest single tell.**

- **A memarg handler follows the memory's INDEX TYPE, and that is a separate
  parameter from the offset (T13.15, 2026-08-25).** `onSimdLoadLane` /
  `onSimdStoreLane` hard-coded the address operand as i32 while declaring and
  dropping `is64`, so on a 64-bit memory a correct i64 address was REJECTED and
  an incorrect i32 one accepted. `onLoadSplat` / `onLoadZero` in the same file
  get it right (`is64Memory ? _I64 : _I32`) and `SharedValidator` was already
  passing the right value to all four. **T9.11 fixed `offset` for this same pair
  of handlers and left `is64` behind** — the two parameters travel together and a
  new memory op must honour BOTH. Regression:
  `tests/validator/simd_lane_index_type.test.ts`.

- **`rethrow N` must name a CATCH frame (T13.17, 2026-08-25).** The depth is a
  label reference like a `br` target, but not every label is a legal target:
  `rethrow` re-raises the exception caught by the Nth enclosing catch, so the
  frame it names must have `labelType === LabelType.Catch`, which `onCatch`
  already sets. Unchecked, `(func (rethrow 0))` with no `try` anywhere
  validated. Note legacy EH cannot be cross-checked against Wasmtime or Wasmer
  — neither will run `try` at all — so V8 is the only oracle available for this
  family and any test here must say so. Regression:
  `tests/validator/rethrow_depth.test.ts`.

## Parser arity invariants

- **`instrInputCount` must equal the number of operands `buildPlainExpr`
  actually reads, and a zero-operand instruction grouped with one-operand
  siblings DELETES code (T13.16, 2026-08-25).** `data.drop` / `elem.drop` are
  `[] -> []` — the segment is an immediate — but sat in the arity-1 group beside
  `table.get` / `ref.test` / `memory.grow`. `parseFoldedInstr`'s deficit fill
  popped a value from the surrounding scope and `buildPlainExpr` had no slot for
  it, so the expression was **silently discarded**: `(call $bump) (data.drop $d)`
  emitted a module both engines accept, that runs, and that computes a different
  answer. Same class as the v1.3.0 statement-ordering bug, same structure as
  T13.11 (a `case` label shared with instructions that do not match).
  **When adding an opcode to `buildPlainExpr`, count its `opN()` calls and add
  the matching `instrInputCount` entry — and when adding one to an existing
  `case` group, check every member of that group has the same arity.** The
  mechanical form of this check (declared arity vs max `opN()` per case) is in
  the audit definition in [INDEX.md](INDEX.md). Regression:
  `tests/parser/drop_arity.test.ts`.

- **`instrInputCount` must be TOTAL over `isPlainInstr`, and `default: return 0` is a silent
  landing pad (T13.18, 2026-08-25).** A token with no entry does not fail — it silently becomes
  zero-arity, the linear-form parser pops nothing, and every operand becomes a placeholder. That
  has already cost one bug (`Quaternary` / wide arithmetic: the BYTES came out right because
  `pushStmt` flushes operands in order and a placeholder emits nothing, but the **IR TREE was
  wrong**, which is what the bridge and `wasm2ts` read), and T13.16 was its inverse. **A deliberate
  zero and a forgotten one must not look the same**, so `Rethrow` and `StructNewDefault` are listed
  explicitly rather than left to fall through. `SimdLaneOp` is the one legitimate absence: its
  arity depends on the OPCODE (extract_lane 1, replace_lane 2), which a TokenType-keyed table
  cannot express, so `instrInputCountForTok` routes it before the table is consulted. The gate is
  `tests/parser/instr_arity.test.ts` (T13.18), which reads `isPlainInstr`'s labels out of the
  parser source and fails if any lacks an entry — adding an instruction without one is now red
  immediately instead of a quietly wrong tree.

## Name-pass and writer invariants (T13.20 / T13.21, 2026-08-25)

- **`applyNames` is total on the same two axes as `resolveNames`, and axis 1 is GENERIC.**
  Recursion into `Expr`-typed fields walks every field whatever the node kind, so it cannot miss
  one — a hand-written per-kind list is what let 50 of 87 kinds go unwalked, producing WAT where a
  `global.get` at statement position was named and the identical reference inside `memory.fill` was
  not. Axis 2 (rewriting `Var` immediates) stays an EXPLICIT table on purpose: which name space a
  var belongs to cannot be read off the field name — `segment` is a data index on `memory.init` and
  an elem index on `table.init` — and inferring it would silently retarget a reference, which is
  Bug G. **LABEL and LOCAL vars are deliberately never rewritten**: `labelNames` is per-function and
  this pass has no function context, and rewriting a local index through `funcNames` is a bug this
  pass has already shipped once. Regression: `tests/ir/apply_names_total.test.ts`.

- **`constExprOperands` and `WatWriter.writeInstrHead` are COUPLED; adding an operand-bearing case
  to one obliges the other.** `writeFoldedConstExpr` calls `writeInstrHead` only for kinds with
  operands, then writes those operands itself. A kind with operands but no head-writer case falls to
  a `default` that renders the instruction AND its operands, so they are emitted twice — and the
  result REPARSES as a different module. Same shape as the `writeCatch` duplication (T10.6). Neither
  signature shows the coupling, so both carry INTENT blocks and
  `tests/writer/const_expr_head_coupling.test.ts` reads both switches out of the source and fails on
  drift.

- **A partial switch over expression kinds is safe or not according to the DIRECTION of its
  `default`.** Enumerated across `src/` (T13.21): `isConstExpr` rejects on sight and the binaryen
  bridge throws, so neither can be silently wrong however few cases it lists; `applyNames` returned
  the node unchanged and `writeInstrHead` fell back to a plausible render, and both were silently
  wrong. **Read the `default` before the case count** — it, not coverage, decides whether a gap
  matters.

## Code-comment convention: INTENT blocks (T13.19, 2026-08-25)

- **A section whose MEMBERSHIP carries an invariant must state that invariant at the section.**
  Applies to any multi-label `case` group, family of parallel handlers, opcode-keyed table, or
  `default:` arm with an entry condition — anywhere joining the group asserts something the type
  checker cannot verify. The block states what joining asserts (in the group's own terms), what
  breaks in each direction where the directions differ, and which gate catches it — or explicitly
  that none does. Live at three sites, each of which has already been joined wrongly by a locally
  reasonable edit: `instrInputCount` and `resolveExpr` (T13.11 / T13.16) and the memarg handler
  family in `shared-validator.ts` (T9.6 / T9.11 / T13.15). **Do not replace these with comments
  describing what the code does** — the code says that already and such a comment goes stale; the
  point is to record the constraint the code cannot express. Rationale and the general form:
  [best-practices.md](best-practices.md).

## Removed 2026-08-25

- **`getOpcodeNaturalAlign`** (`validator/type-checker.ts`) — a second, parallel natural-alignment
  lookup beside the canonical `naturalAlignForOpcode` in `core/opcode.ts`, which the performance
  invariants above explicitly say must not be duplicated. Exported, never called, and **silently
  incomplete**: it returned `0` — *"no alignment constraint"* — for all 14 SIMD splat / lane / zero
  memory ops that the canonical table knows. Since every live call site guards on `natAlign > 0`, a
  future caller reaching for this one would have skipped alignment checking on exactly those
  opcodes, which is the T9.6 / T9.11 gap for the third time. Verified never to CONTRADICT the
  canonical table on a real memory opcode, and not re-exported from the package root, so removing
  it is not an API change. Same shape and same call as `Validator.refNullType` below.

## Removed 2026-08-24

- **`Validator.refNullType`** — uncalled dead code, and the coarsening helper T9.3 replaced. It
  collapsed `ref.null $T` to the abstract supertype of its type entry, sat directly below the live
  call site (which correctly passes a precise `ValueType`), and carried an inviting doc comment. The
  same shape as binaryen-ts's UP-7; a future edit could have re-wired to it.
- **A misc-prefixed opcode is never SIMD, and `onQuaternary` must read its opcode.**
  `getMiscOpcodeTypeInfo`'s `default:` returned `(v128,v128,v128) → v128`, and `onQuaternary`
  hard-coded the same shape while ignoring the opcode. Both were dormant until wide arithmetic
  became decodable, and then the validator REJECTED every well-typed `i64.add128` / `i64.sub128` /
  `i64.mul_wide_*` module. All four now carry real type info (`[i64,i64] → [i64,i64]` and
  `[i64×4] → [i64,i64]`), with the SECOND result pushed by the `onBinary` / `onQuaternary` special
  cases because `OpcodeTypeInfo` carries only one. The misc `default:` is all-`Void` — inert — not a
  SIMD signature. **V8 cannot arbitrate this**: it gates the proposal off, so agreement stays green
  either way. Wasmtime with `-W wide-arithmetic=y` is the oracle, and it agrees.
- **`(assert_trap (module …))` is NOT `assert_invalid`.** It asserts the module is well-formed and
  VALID and traps on INSTANTIATION; `assert_invalid` asserts it fails validation. The parser
  reported the module form as `assert_invalid`, so 54 valid modules polluted that metric's
  population and correctly accepting them scored as misses (2664/2737 → 2664/2683, 73 → 19). There
  is now a distinct `assert_trap_module` command kind. Regression:
  `tests/parser/assert_trap_module.test.ts`.
- **A deferred function body must be consumed EXACTLY to its closing `)`.** `PendingBody.endPos`
  records it and `parsePendingBodies` reports anything left over. Deferring the body parse (T10.5)
  removed the error path that used to catch an unparseable body — the enclosing `expect(Rpar)` —
  because the cursor is now restored unconditionally. Without the check, an unknown or misspelled
  instruction was silently DELETED and `wat2wasm` returned Ok. `parseInstrList` returns `Result.Ok`
  regardless of why its loop stopped, so this check is the only thing standing between a typo and a
  silently empty function body.
- **A digit separator must sit BETWEEN digits** (`num ::= d | num '_'? d`). `readNum` /
  `readHexNum` leave a malformed `_` UNCONSUMED so `getNumberToken`'s existing
  trailing-id-char fallback turns the literal into a Reserved token. Consuming it unconditionally
  made `1_`, `1__2`, `0x1_` and `1_.0` lex as valid numbers.
- **A constant literal is RANGE-CHECKED before it is truncated or rounded (T12.1).** The legal
  integer span is the UNION of the signed and unsigned ranges — `[-2^31, 2^32)` for i32 — because
  the text format lets a 32-bit value be written either way; `BigInt.asIntN` alone silently
  truncated `(i32.const 0x100000000)` to `0`. For floats, a FINITE literal that rounds to infinity
  is out of range, so the check is gated on the literal FORM (`isFiniteLiteralForm`), never on the
  resulting bits — gating on bits rejects a legitimate `inf`. Both produced modules V8 accepts and
  RUNS with a different value.
- **An import may not follow a DEFINITION (T12.2).** Imports occupy the low indices of every index
  space, so a late one renumbers everything already written. `parseModuleFieldList` watches whether
  `module.imports.length` GREW after each field — not whether the `import` keyword appeared —
  because the inline abbreviation `(func $g (import "m" "g"))` is an import too. Accepting these
  silently reordered the module: `call 0` meant the defined function in source and the import after
  our reorder, and V8 ran it happily.
- **`align=N` must be a POWER OF TWO, checked at PARSE time (T12.3).** The text grammar says so,
  which makes anything else malformed. Unchecked, the raw value flowed into a flooring `log2`, so
  `align=3` was emitted as `align=2` — and the optimizer treats the alignment as a hard constraint.
  `align=0` is rejected for the same reason plus a second one: 0 is `parseAlignOpt`'s "no `align=`
  given" sentinel, so an explicit zero was indistinguishable from writing nothing. **The SIZE rule
  stays in the validator** — `align` not exceeding natural alignment is a validity question, and
  `align=8` on an `i32.load` must parse and then fail validation.
- **A SIMD lane immediate must fit `u8`; being below the lane COUNT is the validator's job
  (T12.4).** The immediate is one byte on the wire, so 256+ is MALFORMED, while 16..255 fits the
  byte and is INVALID — the spec gives them different messages and they must fail in different
  layers. Unchecked, 256 truncated to lane 0. **`v128.const` lane VALUES are range-checked the same
  way** via `laneFits`, over the UNION of the signed and unsigned ranges (an i8 lane may be written
  -128..255); `BigInt.asIntN` alone wrapped `-129` to `127`, flipping the sign of every lane.
- **A wasm NAME must be valid UTF-8, in BOTH paths (T12.5).** `parseQuotedText` (text) and
  `readName` (binary) decode through a strict `TextDecoder({ fatal: true })`; a lenient decoder
  substitutes U+FFFD and silently renames an import or export. **Data segments are exempt** —
  arbitrary bytes, `(data "\0cf")` is legal — which is why only `parseQuotedText` is checked and
  `parseTextList` is not. **Both strict decoders MUST pass `ignoreBOM: true`**: without it a leading
  U+FEFF in a name is stripped rather than kept as a character (T7.13), which drops V8-valid to
  256/257.
- **A lane op's immediate is REQUIRED, and `nan:canonical` / `nan:arithmetic` are result PATTERNS,
  not literals (T12.6).** `parseSimdLane` returned 0 for a missing immediate, so a lane op written
  without one compiled as lane 0. The NaN patterns silently became the canonical bit pattern in a
  real `f32.const`. **The NaN rule is CONTEXTUAL** — a v128 expected-result may carry them per lane
  (`(v128.const f32x4 nan:canonical …)` is legal), and those lanes share `parseF32Bits` with
  instruction consts, so a global rejection costs eight SIMD files from parse-clean. The scoped
  `allowNanPatterns` flag is set only inside `parseExpectedConst` and is saved/restored.
- **An annotation is TRANSPARENT, not unparsed (T12.7).** `(@id …)` still has a grammar: the id is
  required and adjacent to the `@`, and the body is a TOKEN sequence, so only characters that can
  appear in WAT source may appear in it. Skipping it at the character level accepted `(@)`,
  `(@ x)`, `(@"")` and any control byte. STRINGS and COMMENTS inside an annotation stay skipped
  whole and unchecked — annotations.wast asserts both as valid.
- **A repeated closing label must MATCH, and an inline signature beside a `(type $t)` must AGREE
  (T12.7).** Both were consumed and discarded, so a typo'd `end $l` named another block and
  `(func (type $sig) (result i32))` against `(type $sig (func))` emitted a signature the source
  never wrote. Reading the inline part instead of skipping it also recovers the ORDER rule
  (`(result …)` then `(param …)` is malformed) and the no-NAMED-param rule for block and
  `call_indirect` type uses — a skip can see neither. `parseFuncSignature` still allows names,
  because a real `(func (param $x i32) …)` needs them.
- **A QUOTED identifier is a name (T12.7).** `$"…"` and an annotation's quoted id obey the T12.5
  UTF-8 rule, must be non-empty, and may not contain RAW control characters — checked on the
  SOURCE text, not the decoded bytes, because an escaped tab is a legal spelling while a literal
  tab byte is not. `decodeStringToken` and `STRICT_NAME_DECODER` live in `src/core/literal.ts` so
  the lexer and parser share one rule.
- **A binary reader must REPORT, not resynchronise (T12.8).** Skipping an unknown section id,
  realigning to `sectionEnd` when a section's contents disagreed with its declared size, and
  guarding entry loops with `this.pos < end` all produced a DIFFERENT module instead of an error —
  two code sections decoded to the second one's bodies, and a section claiming more entries than it
  held simply produced fewer. A count is part of the encoding, and a body ends with an explicit
  `end`.
- **A mask and a `!== 0` are discards too (T12.8).** `alignFlags & 0x3f` turned memarg flags 0x80
  into alignment exponent 0, and `readU8() !== 0` made every non-zero mutability byte MUTABLE.
  Reserved bits have to be CHECKED, not masked off.
- **The section order is not numeric id order (T12.8).** Tag is id 13 but sits between memory and
  global; data-count is id 12 but sits between elem and code. `sectionOrderRank` in
  `src/core/binary.ts` is the single copy of that order, and `writeBinaryIr` emits the same one.
- **The data-count section is load-bearing (T12.8).** `memory.init` and `data.drop` require it —
  the code section is decoded before the data section, so it is the only way to know a data index
  is in range at that point — and when present it must agree with the data section's count.
- **An identifier is bound ONCE per index space, and the space spans imports and definitions
  (T12.9).** Name lookup scans for the first match, so a duplicate did not collide — it was
  unreachable, and the module quietly referred to the wrong item. Locals are scoped per function
  (params and locals share one space) and struct fields per type.
- **A NaN payload must be CHECKED, not masked (T12.9).** The field is 23 bits for f32 and 52 for
  f64, and a payload of 0 is not a NaN at all: `nan:0x0` masked to a clear mantissa and emitted
  INFINITY. Widening the mask is what the earlier 0x3fffff fix did, and it left this case open —
  the range is `[1, 2^mantBits - 1]`.
- **A token ends at the first character that cannot continue it, and a STRING can continue one
  (T12.9).** `$"l"0` and `data"a"` are each one RESERVED token. Stopping at the closing quote left
  the remainder in the stream, so `(br_table $"l"0)` gained a second target and `(data"a")` parsed
  as a data segment.
- **A type use may refer FORWARD, so its check belongs at the end of the field list (T12.9).**
  `pendingTypeUses` defers the T12.7 restatement comparison until the whole module is known;
  checking at the point of use silently skipped every forward reference. A type use with NO inline
  signature is deliberately left to the validator — `(func (type 4))` is `assert_invalid`, not
  `assert_malformed`.
- **A branch to an out-of-scope label is the PARSER's error (T13.1).** `checkLabelScopes` in
  `wast-parser.ts` runs per function body and CHECKS ONLY — no `Var` is rewritten, so resolution
  stays in `resolveNames` for IR that never came from text. A `try_table`'s catch targets are
  checked BEFORE its own label is pushed and a legacy `try`'s delegate AFTER it is popped, because
  both name the enclosing scope. **`delegate` REPLACES `end`**, so `ExprVisitor` fires
  `onDelegateExpr` INSTEAD of `endTryExpr` — a delegate that pops only in `endTryExpr` leaks the
  label into everything that follows.
- **`encodeU32Leb128` / `encodeU64Leb128` fail loud instead of wrapping (T13.2).**
  `let v = value >>> 0` was the entire range check, so 2^32 encoded as 0 — which is how
  `(memory 0x1_0000_0000)` was emitted as `(memory 0)` and accepted by every engine. `wat2wasm`
  catches the throw and REPORTS it: a fail-loud encoder is right, a throw escaping a tool is not.
- **A 64-bit memory's or table's limits are u64 on the wire (T13.2).** Writing them as u32
  truncated every size above 2^32, so the validator's page bound never saw the value it exists to
  reject. Fixing it exposed the converse in `onTable`, which capped elements at 2^32-1 regardless
  of index type — the bound follows the INDEX TYPE.
- **`synthesizeTypes` must not invent a type for a reference that does not resolve (T13.2).**
  `ensureTypeFor` APPENDS a matching entry when none exists, so pointing an unresolvable type-use
  at it produced a valid module aimed at a different type. Keep the index the source wrote and let
  the validator report it.
- **An implicit type-use is its own SINGLETON rec group (T13.2).** Type identity is compared up to
  the rec group, so a `(func)` inside a multi-member `(rec …)` is a different type and must not be
  reused for an inline signature. A singleton `(rec (type …))` stays reusable — it encodes
  differently from a bare `(type …)` but denotes the same type.
- **`Limits.initial` / `max` are `bigint` (T13.3).** They were `number`, exact only to 2^53, and
  the field is u64 for a 64-bit memory or table — so `0xffff_ffff_ffff_ffff` was ROUNDED to 2^64 on
  the way in and a module the spec calls valid could not be encoded at all. A BREAKING change to an
  exported type, on purpose: a consumer reading it as a number gets a compile error at the site
  that has to handle the wider range. The bridge converts at its own boundary (binaryen-ts takes
  `number`) and REFUSES above 2^53 rather than rounding. `checkLimits`'s `number` twin is gone with
  it — one rule, one copy.
- **A maximum of ZERO is a maximum (T13.3).** `if (limits.isShared && !limits.max)` also fired on
  `0`, so `(memory 0 0 shared)` was reported as having no maximum at all. Test an optional numeric
  field with `=== undefined`.
- **`deno publish --dry-run` is in CI but NOT in `deno task test`.** T12.7's move of
  `STRICT_NAME_DECODER` into `src/core/literal.ts` made it public API without an explicit type,
  which is a slow-types error; 339 passing tests and three full metric runs never saw it. Run the
  dry-run whenever a change adds or moves an EXPORTED symbol.
- **Custom page sizes: `Limits.pageSizeLog2`, and only 1 and 65536 are legal (T13.4).** The wire
  field is the LOG2, so the IR holds the log2 — the old `pageSize` was documented as bytes while
  the reader and writer passed the raw value through, and the WAT writer printed `(pagesize 16)`
  for a standard memory. **The legal set is {0, 16}, NOT every power of two**: the field is already
  a log2, so a power-of-two test accepts the fourteen sizes between. A non-power-of-two has no log2
  and is MALFORMED at parse; an encodable-but-illegal one is INVALID at validation.
- **A memory's page ceiling is `2^addr_bits / pageSize`, not a constant (T13.4).** It was 65536 —
  the quotient for 64 KiB pages, with the division already done — so a 32-bit memory with 1-byte
  pages could not declare more than 65536 of them. Saturate for the 64-bit/1-byte case, where every
  u64 page count fits.
- **A TABLE has no page size, and the flag bit is rejected on one rather than ignored (T13.4).**
  Whether the bit is legal is a property of the POSITION, so `readLimits` takes a parameter: after
  the fact an explicit log2 of 16 is indistinguishable from no flag at all.
- **`engine-check` must give EVERY engine its proposal flags — an EXPLICIT list, never the blanket
  one.** Wasmtime got a list and Wasmer got nothing, so the engine kept for divergence was the only
  one on defaults. The first fix used `--enable-all`, which is the same trap the script's header
  already warns about for `-W all-proposals=y`, made a second time: it makes Wasmer 7.2.1 refuse
  EVERY module, `(module (memory 1) (func))` included, with "No backends support the required
  features". Bisected, three switches do that alone — `--enable-tail-call`, `--enable-multi-memory`
  and `--enable-memory64` are accepted as flags and implemented by NO backend, so one of them makes
  the ENGINE unsupported regardless of input, and a whole corpus reads 0/272 as if it were our bug.
  The list now opens only the gates Wasmer can open, and its cause is read from the `╰─▶`
  continuation line rather than the "failed to validate <path>" heading.
- **Only Wasmtime implements custom page sizes** (measured 2026-08-24). V8 has no flag,
  Bun/JSC and wazero reject the limits byte, and Wasmer parses it with `--enable-all` and then says
  "No backends support the required features". A byte-paged memory is a different memory TYPE, so
  no encoding choice makes it portable; the only lever is that an explicit `(pagesize 65536)` could
  be emitted without the flag bit, which we decline in favour of round-trip fidelity.
- **The page-size flag is written on PRESENCE, not on `!== 16` (T13.4).** An explicitly encoded
  `pagesize 65536` must come back out as one — Wasmtime accepts it, and collapsing it into the
  default changes the bytes. A runtime can afford that collapse; a format tool with a round-trip
  metric cannot.
- **A tag's ATTRIBUTE byte is 0x00 and a table init form's RESERVED byte is 0x00, in the reader as
  well as the writer (T13.5).** Both were `readU8()` with the result discarded, in three places
  (tag section, tag import, `0x40` table form), so any value decoded to the same module. The binary
  writer already emitted 0x00 at all three and said so in a comment — a one-sided rule, which no
  metric can catch: round-trip never produces the bad byte, and the spec suite has no case for it.
- **`instrInputCount` is verified by a folded/linear DIFFERENTIAL, not by reading it (T13.8).**
  `AtomicStore`, `AtomicRmw` and `AtomicRmwCmpxchg` were each listed one too high; the linear parser
  popped a placeholder into the address slot, the real operand went unconsumed, and a placeholder
  emits nothing — so `wasm2wat` output of any atomic store/RMW module was **rejected by V8**. The
  invariant had been written down since Bug D and never checked mechanically.
  `tests/parser/instr_arity.test.ts` writes each instruction folded, disassembles to linear and
  re-encodes: the two halves of the parser check each other, no oracle needed. Add a case for every
  new opcode that takes operands.
- **A NAMED reference must survive the whole pipeline, in every position (T13.7).** Parse-clean sees
  only the parser and round-trip never exercises a name at all (`wasm2wat` emits numeric vars), so
  "the parser accepts it, `resolveNames` misses it, the writer throws" is invisible to every metric.
  `tests/parser/named_refs.test.ts` covers 64 positions; 21 of them fail at v1.3.5.
- **`getOpcodeTypeInfo` needs a branch per PREFIX, and the SIMD fallthrough hides a missing one
  (T13.9).** There was a `PREFIX_MISC` branch and no `PREFIX_THREADS` one, so every atomic was
  type-checked as `(v128,v128)→v128` and REJECTED. Any new prefix group must get its own branch
  before the SIMD default, and the atomic table is DERIVED from a 7-wide cycle rather than written
  out, because a sixty-entry hand copy is what drifted for SIMD.
- **Every `Features` flag GATES, via `SharedValidator.requireFeature` (T13.10).** Nine used to be
  inert — a caller could switch `gc` off and validate a GC module. Gate at the point of USE, never
  from a post-hoc scan, so an imported 64-bit memory is caught like a defined one. **Three
  proposals have no hook to hang a gate on** — relaxed SIMD and wide arithmetic are ordinary
  arithmetic nodes distinguished only by opcode, and extended-const only by `inInitExpr` — so
  `gateOpcode` keys on opcode range and initializer context. A new proposal needs a gate at BOTH
  levels or it ships unrefusable.
- **Gating requires CLI flags in the same change.** `wasm-validate` now takes
  `--enable-<feature>` / `--disable-<feature>` / `--enable-all`; without them a gated validator
  rejects most modern wasm with no way to opt in, which is worse than the bug.

## Decoder error messages use the SPEC's vocabulary, and the two LEB faults stay distinct

Reader and `src/core/leb128.ts` diagnostics are worded to match the error texts
the WebAssembly spec testsuite's `assert_malformed` commands expect. This is not
cosmetic: those strings are the only oracle we have for whether we reject a
module **for the right reason**, and they are what the eighth conformance metric
measures (689 / 711 as of 2026-08-25, T13.37).

Two rules that a later edit can silently undo:

- **`integer too large` and `integer representation too long` are different
  faults and must keep different messages.** The first is a terminating byte
  carrying value bits beyond the target width; the second is an encoding that
  runs past the maximum byte count. Each decoder — u32, u64, s32, s64 — has both
  branches and has always had them; for four releases both threw
  `LEB128 <w> overflow`, discarding at the point of reporting a distinction the
  code had already made. Merging them back rejects the same inputs, moves no
  metric, and is invisible to everything except
  `tests/core/leb128_diagnostics.test.ts`.
- **Compare a header field before reading the next one.** `readModule` read the
  magic, read the version, then compared the magic — so a 4-byte input failed on
  the version read and was reported as `unexpected end of binary` when its magic
  was wrong. Ordering a read before the check that guards it turns "you gave me
  the wrong kind of file" into "your file is too short".

The generic truncation message is `unexpected end of section or function`, which
contains the spec's shorter `unexpected end` as a substring so it satisfies both
spellings. That deliberately drops the old hint about WHICH decoder failed; the
error's byte offset already points at the LEB, so the hint was redundant, and
the spec's wording is what a wasm developer is looking for.

## `TokenType.Reserved` is the parser's unknown-operator signal — do not let a site swallow it

The lexer emits `Reserved` for a word it does not recognise **and for no other
reason**. That makes it a reliable oracle: a Reserved token is by definition not
a valid anything, so naming it in a diagnostic is correct wherever it appears,
and a site that reports something else about it is reporting the wrong thing.

`unknownOperatorText()` in `src/parser/wast-parser.ts` returns its source text —
looking one token past a `(`, because the folded form `(i32.load32 …)` puts the
operator there and the token the parser is sitting on is the paren.
`reportUnexpected(fallback)` prefers it over the positional message. Three sites
route through it: `noProgress`, the leftover-input check after a function body,
and `expect()`.

Before this (T13.38), a misspelled instruction — the most common mistake in
hand-written WAT — produced `unexpected ( in function body` (blames a
parenthesis), `expected ), got (` (mentions nothing relevant), or
`unexpected Reserved in function body` (**leaks an internal token-class name to
the author**). None named the operator.

Two rules follow:

- **A new error site that can face a Reserved token should call
  `reportUnexpected`, not `this.error` directly.** The fallback string stays
  whatever is right for the site; the helper only overrides when the offending
  token really is an unrecognised word.
- **The phrase `unknown operator` is load-bearing, not stylistic.** The spec
  testsuite matches it as a substring across 400+ cases. Rewording it silently
  drops the parser's diagnostic-wording metric.

**Do not chase that metric to 100%.** About 200 of the remaining misses are
inputs like `(i32.const 0x)` — a malformed hex literal that the spec's reference
implementation also calls `unknown operator`, because its lexer reserves the
token too. We say `expected i32 constant`, which is strictly more useful. The
metric measures agreement with the reference implementation, not quality, and
the last stretch is bought by making messages worse.

## A conformance harness calls `wat2wasm`; it does not rebuild the pipeline

`wat2wasm` is **parse → resolveNames → synthesizeTypes → writeBinaryIr**, and
`synthesizeTypes` is not optional — it back-fills the type section for every
inline-declared signature. A harness that encodes a parsed module with
`resolveNames` + `writeBinaryIr` emits dangling type indices for almost every
module.

That is exactly what the scratch harnesses did until 2026-08-25 (T13.39), which
made the validator reject nearly everything for a fault the harness had created,
and dropped every valid module out of the denominator through a
`catch { continue; }`. Agreement read `449 / 449` where the truth was
**2207 / 2207**.

It survived because **the output looked right**. `assert_invalid` scores by
counting rejections, so a harness that breaks every module scores *better*, and
`2673 / 2678` is a plausible, publishable-looking number. Of the harnesses in
use, only `corpus.ts` was correct — and it is the only one that called
`wat2wasm` rather than reassembling it.

## Section sizes are encoded MINIMALLY, and the reserve/patch pair is LIFO

`reserveU32Leb` (`src/writer/stream.ts`) reserves the maximum u32 LEB width — 5
bytes — for a size that is not known until the body has been written.
`patchU32Leb` then writes the **minimal** encoding and `copyWithin`s the body
down over the bytes the size did not need.

It wrote a fixed-width 5-byte LEB and left the padding until T13.40. That is
legal, and every engine accepts it, which is why it survived: it made every
section header **4 bytes larger than necessary** in every binary the writer has
produced, and it meant a minimally-encoded input could never be reproduced
byte-for-byte. Upstream wabt canonicalises by default
(`canonicalize_lebs = true`); this half of the port was missing. Removing the
padding took the 272-file wasmtk WASI corpus from 628,201 to 607,845 bytes.

**The invariant that makes the shift legal: the pair is strictly LIFO-scoped.**
Everything written between a `reserveU32Leb` and its `patchU32Leb` is the body
being measured, and the patch MOVES that body. So:

- **Never hold an offset taken AFTER a `reserveU32Leb` across its
  `patchU32Leb`** — the shift invalidates it.
- Offsets taken BEFORE the reserve are safe, because a shift only ever moves
  bytes that come after it. This is what makes nesting work: a function body
  patches before the code section that contains it, and the code section's own
  `sizePos` is at a lower offset than anything the inner patch moves.

Two call sites rely on this — `writeSection` in `stream.ts` and `writeFuncBody`
in `binary-writer.ts`. A third would need the same discipline.

**Do not "fix" the remaining round-trip differences against crafted binaries.**
A `(module binary …)` blob may legally use a non-minimal LEB or the explicit
element-segment flags where the abbreviated form means the same thing. The text
format records neither, so a text round trip cannot restore them. Reproducing
those bytes would mean carrying encoding trivia through the IR, and emitting
non-minimal output again.

## Custom sections keep the position they had in the input

`Custom.precedingSection` records the known section a custom section followed:
`null` if it came before any of them, `undefined` if the position is unknown
(IR built by hand). The binary reader stamps it; `BinaryWriter.write()` walks an
explicit `ORDER` table and emits each anchor's customs immediately after that
section, appending unanchored ones last.

Before this (T13.41) `writeCustomSections()` emitted them all in one block at
the end. Custom sections may legally appear anywhere, so the output was valid —
but it meant **`wasm-strip` relocated every section it was asked to keep**, and
position is load-bearing for at least one real one: the dynamic-linking
convention requires **`dylink.0` to be first**.

Rules for anything touching this:

- **A new module-level section must call `writeCustomSectionsAfter(id)` after
  writing itself**, or customs anchored to it silently fall through to the next
  anchor. The `ORDER` table exists so that pairing is one line and hard to
  forget; do not go back to a bare sequence of `writeXSection()` calls.
- **`undefined` must keep meaning "append at the end."** Hand-built IR and the
  bridge construct `Custom` without a position, and giving them a default anchor
  would move sections nobody asked to move — the exact defect, inverted.
- The anchor is a SLOT, not an offset: if the anchored section is not emitted
  (an empty type section, say), the customs still land in the right relative
  place. `custom.wast` depends on this — it interleaves customs between ten
  empty sections.

## `wasmStrip`'s `sections` option names what to REMOVE

Not what to keep. Everything else is retained, in its original position. The
implementation's local was called `keep` and used as `!keep.has(name)`; it is
now `remove`, with an INTENT block, because a reader trusting the old name would
invert the condition and turn the tool into its opposite.

## The release preflight lives in `scripts/release-guard.ts`, not in `publish.ts`

`scripts/publish.ts` stages, tags and pushes **at import time** — it is top-level
script code — so importing it performs a release, and nothing can test it. That
is why it went four releases with a documented safety contract it did not
implement (T13.43).

The decisions are therefore pure and separate:

- `releaseBlockers(porcelain)` — the `git status --porcelain` lines that would
  be LEFT OUT of the release. Everything except `deno.json`, because
  `publish.ts` stages exactly that one file. **Untracked files count**: a new
  source file that was never committed is absent from the tag while every local
  check still passes, because it is sitting on disk.
- `statusPath(line)` — the path from a porcelain line, taking the NEW name of a
  rename.

Rules:

- **Keep new preflight logic in `release-guard.ts`.** Anything added directly to
  `publish.ts` is untestable by construction, which is the exact defect.
- **`release-guard.ts` must stay side-effect free** — no `Deno.Command`, no
  `Deno.exit`, no top-level `await`. That is what keeps it importable by a
  test, and it is gated: `tests/scripts/publish_preflight_wiring.test.ts`
  fails if any of the three appears.
- **A git subcommand added to `publish.ts` is MUTATING unless allowlisted.**
  The same gate extracts every `['git', <sub>]` call in source order and
  refuses anything before the guard that is not in its READ_ONLY set
  (`status`, `ls-remote`, `rev-parse`, `diff`, `config`, `log`). Adding a
  read-only call means adding it there, deliberately.
- **The `deno.json` exclusion is an exact path match**, never a substring —
  `deno.json.bak` and `scripts/deno.json` must still block.
- **The guards run before any mutation.** `publish.ts` refuses and exits 1
  having staged nothing; a guard that runs after `git add` leaves the tree in a
  state the user did not ask for.
- A **local** tag is still force-written on purpose (retry safety after a run
  that died between tagging and pushing). A **remote** tag is refused: it has
  already triggered `publish.yml`, so that version is either live on JSR —
  immutable — or failed for a reason a re-push will not change.

## `scripts/` is inside the gate

`deno task check`, `deno lint` and `deno fmt` all cover `src/`, `tests/` **and
`scripts/`**. Until 2026-08-25 they listed only the first two, so the six files
that bump versions, cut releases and generate opcode tables were type-checked by
nothing. Markdown under `scripts/` is excluded from `fmt` — those are reports
already sent upstream, and reformatting them creates churn in a diff someone
else has read.
