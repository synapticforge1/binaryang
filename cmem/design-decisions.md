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

## Documentation invariant (JSR score)

- **Every entrypoint needs an `@module` JSDoc header; every exported symbol needs a JSDoc comment
  (v1.2.7+).** The 7 subpath entrypoints (`src/index.ts`, the five `src/tools/*.ts`, and
  `src/api/wabt-compat.ts`) each carry `/** @module … */` with a usage example. The full exported
  surface (265 symbols as of v1.2.7) is documented. `deno doc --json src/index.ts` enumerates every
  symbol. Don't add a new export without at least a one-line JSDoc.
