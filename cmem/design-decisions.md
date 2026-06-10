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
  (`src/ir/ir-util.ts`). `getFuncSig`/`getTagArity` are O(1) indexed lookups. Do not reintroduce the
  `for (const imp of module.imports)` scan — `getExprArity` runs for every expression during
  validator and writer walks.
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

## Documentation invariant (JSR score)

- **Every entrypoint needs an `@module` JSDoc header; every exported symbol needs a JSDoc comment
  (v1.2.7+).** The 7 subpath entrypoints (`src/index.ts`, the five `src/tools/*.ts`, and
  `src/api/wabt-compat.ts`) each carry `/** @module … */` with a usage example. The full exported
  surface (265 symbols as of v1.2.7) is documented. `deno doc --json src/index.ts` enumerates every
  symbol. Don't add a new export without at least a one-line JSDoc.
