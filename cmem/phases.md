# Phase delivery plan & per-phase gotchas

## Status (deno.json at v1.4.0, published 2026-08-25; binaryen-ts pinned v1.0.9)

> Everything through **T13.10** is RELEASED as of v1.4.0 — the 2026-06-09
> silent-corruption audit, the whole post-v1.3.5 conformance campaign, and the
> `try_table` named-catch fix wasmtk was blocked on. See
> [publishing.md](publishing.md) for what the release breaks,
> [design-decisions.md](design-decisions.md) and [tasks.md](tasks.md) for the detail.
>
> **UNRELEASED on `main` as of 2026-08-25: T13.11, T13.12, T13.13.** A post-release
> audit pass — `resolveNames` skipping `table.get`'s index (valid WAT that failed to
> encode), the two signed LEB encoders still repairing out-of-range input, and the
> named-reference guard gaining its second axis plus V8-validity assertions. **T13.11
> is a user-visible bug fix**, so it wants a release; the tranche numbering continues
> past the v1.4.0 line and "T13" no longer means "shipped".

| Phase | Scope                    | Status          | Notes                                                                           |
| ----- | ------------------------ | --------------- | ------------------------------------------------------------------------------- |
| 1     | Core Infrastructure      | **complete**    | types, opcodes, LEB128, literals, errors — 31 tests                             |
| 2     | IR Layer                 | **complete**    | Expr union (50+ variants), ExprVisitor, apply/resolve/generate-names — 39 tests |
| 3     | Binary Round-trip        | **complete**    | `readBinaryIr` + `writeBinaryIr` — 40 total                                     |
| 4     | WAT Text Format          | **complete**    | lexer, parser, WAT printer — 86 tests; completes wat2wasm + wasm2wat            |
| 5     | Validator                | **complete**    | type-checker, shared-validator, validator — 87 tests                            |
| 6     | CLI Tool Wrappers        | **complete**    | wat2wasm, wasm2wat, wasm-validate, wasm-objdump, wasm-strip                     |
| 6.1   | Pre-publish housekeeping | **complete**    | JSR/CI hardening; 71→0 lint; codec singletons + index-map caches                |
| 6.2   | Release-flow alignment   | **complete**    | `deno task bump`; atomic commit+tag+push; first JSR publish                     |
| 7     | binaryen Bridge          | **in progress — ⚠ RELEASE BLOCKER on the next binaryen-ts bump** | ~60 expr kinds + module surface. The bridge is **bug-compatible with binaryen-ts 1.0.9's `try_table` catch scope** (T13.22): its own off-by-one cancels theirs, so the pin is EXACT and upgrading requires the paired fix in the same commit. binaryen-ts have gated their 1.5.0 on it. Read the ⚠ block at the top of [bridge.md](bridge.md) before touching the pin |
| 8     | wasm2ts                  | pending         | wasm→TypeScript AOT transpiler; deferred pending wasmtk QA/QC                   |

Versioning uses the **sub-version-capped-at-9 rule**: 1.0.9 → 1.1.0 → … → 1.2.9 → 1.3.0.

Recent release highlights:

- **v1.1.9–v1.2.5** shipped all four GC tiers (i31+ref.eq; struct.\*; array.\*; ref.test/ref.cast).
- **v1.2.7** reached 100% JSR doc-quality score.
- **v1.2.9** fixed legacy try/catch encoding (real `TryExpr`, not block coercion) — unblocks wasmtk
  Phase 15 exception suite.
- **v1.3.0** fixed a statement-ordering bug where a folded value-producing statement (esp. a void
  `call`) sank past a following `(return …)` into dead code — general
  `sideEffectingCall();
  return X;` correctness fix; also removed 5 dead private methods.
- **v1.3.4 / v1.3.5** closed the three spec-testsuite const bugs surfaced by wasmtk's runner:
  `br_if` / `br_table` branch-value mis-encoding, hex-float truncation instead of
  round-to-nearest-even, and decimal→f32 DOUBLE rounding.

## Post-v1.3.5 conformance campaign — COMPLETE 2026-08-24, SHIPPED in v1.4.0

A sustained pass over the 257-file spec testsuite. **All SEVEN metrics below were exhausted at
campaign close** (this line read "all five" over a seven-row table for some time — re-derive a
count from its own table, do not quote it). An eighth metric was added later; see
[overview.md](overview.md) for the current table and [tasks.md](tasks.md) for the
tranche-by-tranche log.

| metric                        | campaign start | at close 2026-08-24 |
| ----------------------------- | -------------- | ------------------- |
| parse-clean                   | 107 / 257      | **257 / 257**       |
| fully V8-valid                | 180 / 257      | **257 / 257**       |
| validator agreement           | 1702 / 2120    | **2120 / 2120**     |
| `assert_invalid` rejected     | 2395 / 2737†   | **2664 / 2683**     |
| round-trip byte-identical     | 1942 / 2105    | **2120 / 2120**     |
| wasmtk WASI corpus round-trip | 1 / 270        | **270 / 270**       |
| execution (new)               | —              | **23,077 / 23,077** |

That right-hand column is a SNAPSHOT at campaign close, not a current reading — it was headed
"now" until 2026-08-25, which is a header that silently becomes false. `overview.md` carries the
current figures, and the harnesses are the only real answer.

Load-bearing changes: the typed-ref IR refactor (T7.4); a `pushStmt` for the binary reader that
stopped `wasm2wat` silently REORDERING a program (T9.1); feature-gating the validator and reviving
its entire SIMD opcode table, dead since T7.7 (T9.2); moving the validator onto `ValueType` with
real GC subtyping (T9.3/.4); stopping the pipeline rewriting an invalid element segment into a valid
one (T11); and the whole of T10 — export order, `call` arity, operand placeholders, table
initializers, linear `try_table`, tag-type identity and NaN payloads.

**Two findings outlive the numbers.** Each metric was blind to bugs the others caught, and three
tranche items were MISDIAGNOSED in the ledger until re-measured (T10.5 filed against the reader when
the cause was the parser; T10.6 filed as a Nop problem when it was a parser stub; T10.8 not filed at
all yet 45 of 60 affected files). See [best-practices.md](best-practices.md).

**Integration milestone (2026-05-28):** wasmtk Phase 1 suite passes 38/38 against
`@jrmarcum/wabt-ts@1.1.8`. The wasmtk-driven hardening loop (real module shape surfaces a wabt-ts
bug → fix at root cause + add regression test) is the design, not a transitional phase — see
[testing.md](testing.md).

**Migration milestone — `/compat` (v1.2.1):** `jsr:@jrmarcum/wabt-ts/compat`
([src/api/wabt-compat.ts]) mirrors `npm:wabt` (libwabt.js) public API shape — default export is the
async `wabt()` factory → `Promise<WabtModule>` with `parseWat`/`readWasm`; the returned `WasmModule`
carries `toBinary`/`toText`/`applyNames`/`destroy`. Error semantics match upstream. After an
import-map entry `"wabt": "jsr:@jrmarcum/wabt-ts@^1.2.1/compat"`, existing `import wabt from "wabt"`
source compiles unchanged.

## Post-v1.4.0 audit and hardening — ONGOING (2026-08-25)

Not a phase. A repeating two-lens pass over code that was already green, run
after v1.4.0 shipped: **enumeration** (*what is wrong with this code?* — walk a
type or axis exhaustively rather than a corpus) and **hardening** (*what would
an adversary or an accident do to this?*). Tranche T13; the tranche-by-tranche
log, the numbering procedure and the method rules are in
[tasks.md](tasks.md) and [best-practices.md](best-practices.md).

State as of 2026-08-25:

| | |
| --- | --- |
| findings recorded | T13.1 – T13.44 |
| **unreleased and user-visible** | **15** — see [publishing.md](publishing.md), which lists them and the command to re-derive the count |
| deliberately unfixed | 1 (T13.22 — the bridge defect currently cancels a matching one in binaryen-ts 1.0.9; must land with the dependency bump) |
| enumeration frontier | **empty** since T13.32 — meaning the cheap axes are spent, NOT that the code is clean |
| hardening passes | 8, findings 1 / 2 / 0 / 0 / 2 / 2 / 2 / 2 |

Two of the unreleased twelve are the argument for cutting 1.4.1 rather than
accumulating more: **T13.16** emitted wrong code (an instruction silently
deleted), and **T13.26** silently repaired a malformed module into a valid,
different one.

The eighth conformance metric — **diagnostic wording** — came out of this work
(T13.37/T13.38) and now covers three populations: reader **689 / 711**,
validator **2446 / 2683**, parser **816 / 1229**. None is at ceiling, and the
parser's remainder is largely cases where OUR message is the better one. It grades error MESSAGES
against the text each `assert_malformed` case expects, an answer key that had
been sitting unread in the testsuite for the whole campaign. See
[testing.md](testing.md).

## TS ↔ C++ file mapping (open the C++ alongside when porting)

**Phase 1 — Core** (`src/core/`): `types.ts`←base-types.h/type.h · `binary.ts`←binary.h ·
`opcode.ts`←opcode.{h,cc} · `leb128.ts`←leb128.{h,cc} · `literal.ts`←literal.{h,cc} ·
`feature.ts`←feature.{h,cc} · `error.ts`←error.h/error-formatter.h · `result.ts`←result.h

**Phase 2 — IR** (`src/ir/`): `ir.ts`←ir.{h,cc} · `ir-util.ts`←ir-util.{h,cc} ·
`expr-visitor.ts`←expr-visitor.{h,cc} · `apply-names.ts` · `resolve-names.ts` · `generate-names.ts`

**Phase 3 — Binary** (`src/reader/`,`src/writer/`): `binary-reader.ts` · `binary-reader-ir.ts` ·
`binary-reader-nop.ts` · `binary-writer.ts` · `stream.ts`←stream.{h,cc}

**Phase 4 — WAT** (`src/parser/`,`src/writer/`): `lexer-source.ts` · `wast-lexer.ts` · `token.ts` ·
`wast-parser.ts` · `wat-writer.ts`

**Phase 5 — Validator** (`src/validator/`): `type-checker.ts` · `shared-validator.ts` ·
`validator.ts`. Entry point: `validateModule(module, errors, opts?)`.

**Phase 6 — Tools** (`src/tools/`): each is a library fn + `if (import.meta.main)` CLI block.
`wat2wasm(src, opts)` · `wasm2wat(binary, opts)` · `wasmValidate(binary, opts)` ·
`wasmObjdump(binary, opts)` · `wasmStrip(binary, opts)` · `wasm2ts.ts` (stub — throws, Phase 8).

## Per-phase gotchas

### Phase 4 — IR field names (verify against `ir.ts`; they differ from intuition)

- `Import`: `module` + `field` (not `moduleName`/`fieldName`)
- `Global.mutable` (not `isMut`); `Table` has required `init: Expr[]`
- `Module.dataSegments` / `Module.elemSegments` (not `.data`/`.elems`)
- `DataSegment.memoryVar` / `ElemSegment.tableVar`; `ElemSegment.elemExprs: Expr[][]`
- `IfExpr` uses `then_` / `else_`
- `LoadExpr.offset` / `StoreExpr.offset` / atomic mem offsets: **`bigint`**
- atomic expr kinds use underscores: `atomic_load`, `atomic_store`, `atomic_rmw`,
  `atomic_rmw_cmpxchg`, `atomic_wait`, `atomic_notify`, `atomic_fence`
- `AtomicFenceExpr.consistencyModel: number` required (use 0)
- `SimdShuffleOpExpr.kind = 'simd_shuffle'`; `.lanes` is `Uint8Array`
- `SimdLoadLaneExpr`/`SimdStoreLaneExpr`: operand field is `vec` (not `value`)
- `Func.typeVar: Var` required (use `varIndex(0)` when no explicit type); `Func.tailcall: boolean`
  required (`false` unless tail-call); `LocalDecl` is only `{ type; count }` — no name
- `result.ts` exports `combineResults` (not `combine`)

### Phase 4 — keyword token mapping

`func` (WAT keyword) → `TokenType.Func` (refkind, `refType=Type.FuncRef`), **not**
`TokenType.Function`. Module-field switches must include `case TokenType.Func:` alongside
`TokenType.Function`. `funcref`/`externref` → `TokenType.ValueType`. `function` →
`TokenType.Function` (bare keyword, unused in normal WAT).

### Phase 4 — index.ts note

`token.ts` exports its own `LiteralType` conflicting with `literal.ts`'s. Do **not** `export *` from
`token.ts` in `index.ts`. Public API exports only `lexer-source.ts` and `wast-parser.ts`
(`parseWatModule`/`parseWastScript`).

### Phase 4 — fold-form invariants (post-2026-05-25)

- `parseFoldedInstr` consumes immediates BEFORE sub-expressions: dry-runs `buildPlainExpr` with
  empty operands to advance the lexer past immediates, loops over `(`-prefixed sub-exprs, then
  rewinds and re-invokes `buildPlainExpr` with real operands. New opcodes work in folded form
  automatically if they follow "consume immediates inline, then plug operands via op0()/op1()/…".
- Function-local names are resolved at parse time via `localScope: Map<string, number>` (from
  `parseFuncSignature` bindings + `(local $name type)` decls). `local.get`/`set`/`tee` call
  `this.resolveLocal(v)` before building IR. Downstream `resolveNames` no longer handles local refs
  for WAT-sourced modules (but still owns it for binary-reader / manual IR).

### Phase 5 — validator architecture & rules

Three layers: **TypeChecker** (operand/label stack mechanics) ← **SharedValidator** (module state,
index resolution, errors) ← **Validator** (IR walk via `ExprVisitorDelegate`).

- The operand stack is **empty** at function-body entry — params are locals, not stack values.
  `TypeChecker.beginFunction(params, results)` stores params in the label but does NOT
  `pushTypes(params)`.
- `ValidateOptions` must be `import type` in `validator.ts`.
- `AtomicNotifyExpr` has **no `opcode` field** (unlike `AtomicWaitExpr`). Pass `(0xfe << 8) | 0x00`
  to `sv.onAtomicNotify`.
- TypeChecker errors route through `setErrorCallback`; SharedValidator wraps into
  `addError(errors, currentLoc, msg)`.

### Phase 6 — CLI pipeline decisions

- **wat2wasm**: `parseWatModule` → `resolveNames` (name Vars → index Vars; **required** before
  encoding) → `writeBinaryIr`.
- **wasm2wat**: `readBinaryIr({readDebugNames:true})` → `generateNames` → `writeWatModule`. No
  `applyNames` — the reader sets `func.name` etc. directly.
- **wasm-validate**: `readBinaryIr` → `validateModule`, sharing one `ErrorList`.
- **wasm-strip**: `readBinaryIr({readDebugNames:false})` (keeps name section in `module.customs`) →
  clear `module.customs` → `writeBinaryIr`. `opts.sections` restricts to named ones.
- **wasm-objdump**: `readBinaryIr({readDebugNames:true})` → render `module.sectionMeta`. Counts
  derived from module arrays; `SectionMeta.count` is always 0.
