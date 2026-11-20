# wabt-ts — the load-bearing invariants

Summary: the invariants of wabt-ts that a refactor could silently undo, by subsystem, each with its bug and its test. Last verified 2026-11-20.
Main file: [wabt-ts.md](wabt-ts.md). Moved from it on 2026-11-20 (H38 step 5), unchanged.

## `wabt-ts/design-decisions.md` (1,149 lines) — the load-bearing invariants of wabt-ts, each with its reason and regression test

The wabt-ts rulebook: invariants that a refactor or an upstream port could silently undo, grouped by
subsystem, each naming the bug that paid for it and the test that pins it. Built up from the v1.1.x
bug fixes, a six-round silent-corruption audit (2026-06-09), and the T10/T12/T13 campaigns
(2026-08-24/25). Nearly all of it is live: every cited test still exists under `tests/wabt-ts/`,
and almost none of it is in the core. Each item is compressed hard; the reasoning and the incident
behind it are in the full text.

**Kept.** Unless marked otherwise, `src/` paths are under `src/wabt-ts/`:

### 2026-06-09 silent-corruption audit

Five tests cite this heading: `tests/wabt-ts/audit/silent_corruption_fixes{,_round2,_round3,_round4,_round5}.test.ts`.
The invariants from each round:
- **Round 1** [decision]: the lexer's SIMD opcode values must equal `core/opcode.ts`, which is the source of truth.
  Tag type indices come from the signature and are never hardcoded to 0 (`tagTypeIndex`, `resolveTagSig`).
  The tag-IMPORT decode must consume the attribute byte. SIMD memory decode goes by exact range:
  `0x00-06` load, `07-0a` load_splat, `0b` v128.store, `5c/5d` load_zero. `resolveNames` resolves
  `call_ref`/`return_call_ref` `sigType`. `trunc_sat` is typed via `getMiscOpcodeTypeInfo`. A legacy
  multi-`catch` assigns each body before opening the next. Lane ops are validated per opcode, with the
  lane range-checked. The WAT writer uses the central `naturalAlignForOpcode`. `applyNames` never
  rewrites `local.get` through `funcNames`. Table init exprs (`0x40 0x00 reftype limits expr`) are
  resolved and emitted.
- **Round 2** [decision]: **`writeVar` is fail-loud on a name-form var** (`writer/binary-writer.ts`),
  which is the root of the Bug-G family, so `resolveNames` completeness is load-bearing. `resolveNames`
  walks `simd_lane_op.value`, elem `tableVar` and data `memoryVar`. SIMD reader arity is per opcode
  (`SIMD_UNARY_OPS`; `v128.bitselect` 0x52 is ternary). `load_lane` is `0x54-57` and `store_lane` is
  `0x58-5b`. `parseLimits` detects `i64` (memory64). An unknown `try_table` catch kind fails loud.
- **Round 3** [decision]: the LEB128 decoders reject an over-range terminating byte (`core/leb128.ts`).
  `parseNatText` strips ALL `_`, and a malformed literal is a parse error, never a `?? 0` default. The
  canonical quiet NaN prints as bare `nan`. `varIndexValue` is fail-loud for segment vars. Active
  table-0 elem uses flags 4 only for funcref, else 6. A `declared` data segment throws. Atomic memargs
  use `naturalAlignForOpcode`. `onTag` propagates `Result.Error`. Bridge `replace_lane` throws on a
  missing value.
- **Round 4** [decision]: a tail call's callee results must equal the ENCLOSING function's results
  (`popAndCheckReturnCall`). `return_call_ref` pops the function reference (`onReturnCallRef`).
  `try_table` catch tags are bounds-checked. `onAtomicFence` propagates the error. The lexer is
  fail-loud on an unterminated string, a bare `$`, and an empty `\u{}`.
- **Round 5** [decision]: `generateNames` (`ir/generate-names.ts`) names carry the leading `$`, keep
  a per-namespace prefix (`$fa`), and are disambiguated against user names (`_1`, `_2`…). The permanent
  guard is the `wasm2wat → wat2wasm` re-compile in the round-5 test.
- **Round 6** [baseline]: no new bugs. It added `tests/wabt-ts/wasmtk/roundtrip.test.ts` (wat2wasm → wasm2wat → wat2wasm over
  the corpus) plus a feature-heavy hand battery.
- [correction] Deferred items the rounds left open, as they stand 2026-09-14:
  - Now closed:
    - The named memidx in `writeMemArg` now goes through `requireIndex`.
    - The relaxed-SIMD ternaries decode as ternary: `reader/binary-reader.ts`, the `0x105-0x10c` / `0x113` branch.
    - The try_table catch branch-type check exists (`checkCatchTarget` in `validator/shared-validator.ts`).
    - The table64 text index type is parsed.
    - `assert_trap (module)` has its own kind.
    - `applyNames` totality closed with T13.20.
  - By design: `write_debug_names` is ignored (N1, documented in `api/wabt-compat.ts`).
  - Still true: `parseHexFloat` (`core/literal.ts`) sums `parseInt` parts, which is imprecise. It is
    lexer-level only; the const path uses `parseF64Bits`.
  - Still true: `wasm-objdump -h` only re-sets a default that is already `true`.
  - Still true: the lexer has a dead `isDigit && !readNum()` guard (`parser/wast-lexer.ts`).

**Tables, performance, IR shape**
- [decision] `TEXT_ENCODER`/`TEXT_DECODER` are module-level singletons. Never construct one inside a
  method in `writer/stream.ts`, `writer/wat-writer.ts`, `reader/binary-reader.ts` or
  `parser/lexer-source.ts`. `WatWriter.nameIndexMap` is built once, keyed `"kind:name"`; the old scan
  was quadratic in the export count.
- [decision] **`naturalAlignForOpcode` in `core/opcode.ts` is the only natural-alignment table.** The
  parser stores it when there is no `align=`; the `0` sentinel was removed 2026-09-11, and both
  resolvers throw on a non-power-of-two. A duplicate was deleted twice: the WAT writer's local copy,
  and `getOpcodeNaturalAlign`, which returned 0 for 14 SIMD ops. Writing exponent 0 broke binaryen's
  optimizer. Test: `tests/wabt-ts/tools/wat2wasm.test.ts`.
- [decision] Seven IR-shape choices:
  - `ReturnExpr.values: Expr[]`.
  - f64 bits are `bigint` (`parseF64Bits`), and an integer-form float literal is IEEE-encoded, never stored as raw bits.
  - `SimdLaneOpExpr.value?` is set for replace_lane only.
  - The bare-offset `(elem (i32.const N) $f…)` form is supported.
  - The GC abstract heap types live in the `Type` enum. Extend it; never add a parallel enum.
  - `ref.eq` is CORE `0xd3`, while every other GC op is `0xfb` via `decodeGcOp`.
  - A new ref-typed opcode must not reuse `CompareExpr`.
- [correction] § "GC type-encoding caveats (fixes deferred)" is fully closed:
  - `Type.I8`/`I16` are now `0x78`/`0x77` (`core/types.ts`).
  - `FuncSignature` holds `ValueType[]` (`ir/ir.ts`), so typed refs are precise.
  - binaryen-ts's encoder is 3-way for get/get_s/get_u (`src/binaryen-ts/encoder/wasm-encoder.ts`).
- [correction] "The WAT writer is linear-only" (T10.3, T10.6) is no longer true. `wasm2wat` emits folded
  output by default since 1.5.4 (`--linear` opts out). The rules still hold, but the reason is now "the
  linear path must round-trip too".

**Parser: statements, arity, scope**
- [decision] **Every statement-position push goes through `pushStmt`**, which flushes `ctx.stack` first.
  Otherwise a void call sank past a `return` (v1.3.0; `tests/wabt-ts/parser/stmt_order.test.ts`).
- [decision] An empty-folded op pops its deficit from the stack. The clamp
  `available = Math.min(deficit, ctx.stack.length)` is load-bearing (Bug D and Bug F; `tests/wabt-ts/parser/empty_folded.test.ts`).
- [decision] **`instrInputCount` must equal the operands `buildPlainExpr` reads, and be TOTAL over
  `isPlainInstr`.** `default: 0` is a silent landing pad: the bytes stay right but the IR tree is wrong,
  and the bridge and `wasm2ts` read the tree.
  - Deliberate zeros are listed explicitly (`Rethrow`, `StructNewDefault`); `SimdLaneOp` is routed by opcode.
  - Every member of a `case` group must share one arity. `data.drop`/`elem.drop` sat in the arity-1
    group and silently deleted code (T13.16; `tests/wabt-ts/parser/drop_arity.test.ts`).
  - Verified by the folded/linear differential in `tests/wabt-ts/parser/instr_arity.test.ts` (T13.8, T13.18).
    Add a case for every new operand-taking opcode.
- [decision] `varArityForTok` resolves `call`/`return_call` by signature and `array.new_fixed` by count.
  **Function bodies are parsed after the whole field list** (`pendingBodies`, `pendingTypeUses`), because
  199 of 270 corpus modules have a forward reference (T10.5). A deferred body must be consumed exactly to
  its `)` (`PendingBody.endPos`); otherwise a typo'd instruction is silently deleted. Body diagnostics
  therefore follow later fields' — list order is presentation (T12.9).
- [decision] A synthesized slot-filler is `NopExpr.placeholder`, built only by `operandPlaceholder(loc)`,
  and neither writer emits it (T10.8). A source-written `nop` is kept: eliding it could turn invalid
  input valid (T11).
- [decision] `checkLabelScopes` CHECKS only; resolution stays in `resolveNames`. `try_table` catches
  resolve in the ENCLOSING scope: they are checked before the table's own label is pushed, and a legacy
  `delegate` after it is popped. `delegate` REPLACES `end`, so `onDelegateExpr` fires instead of
  `endTryExpr` (T13.1). Getting this wrong has happened in three layers: T7.6, T9.8, and T13.22 (see pointer).
- [decision] Legacy `try` parses to a real `TryExpr` (v1.2.9). Leading-`nop` placeholders in handlers
  are harmless. `writeCatch` must not walk the handler body, because the visitor owns it (`tests/wabt-ts/parser/legacy_try.test.ts`).
- [decision] Inline exports default ON (upstream `wat-writer.h` defaults off), guarded by an exact
  feasibility test. An inline `(export "n")` is illegal on an import and REORDERS exports, so
  `buildExportMap` falls back to standalone export fields, all-or-nothing per module (T10.1, T10.2).
- [decision] Text rules from T12:
  - A literal is range-checked BEFORE truncation. Ints use the union of the signed and unsigned ranges
    (i32 `[-2^31, 2^32)`, lanes `-128…255`); floats are gated on the literal form
    (`isFiniteLiteralForm`), never on the bits, so `inf` stays legal (T12.1).
  - A digit separator sits between digits.
  - An import after a definition is malformed, detected by `imports.length` growth (T12.2).
  - `align=N` is a power of two at PARSE, while its size limit stays in the validator (T12.3;
    `tests/wabt-ts/parser/align_power_of_two.test.ts`).
  - A lane immediate fits `u8` at parse, and its bound against the lane count is checked in the
    validator. The immediate is required. `laneFits` checks v128 lane values (T12.4, T12.6).
- [decision] Names and tokens:
  - Names are strict UTF-8 in both paths, via `TextDecoder({ fatal: true, ignoreBOM: true })`. Data
    segments are exempt (T12.5).
  - A `$"…"` id is non-empty, with no RAW control characters. `decodeStringToken` and
    `STRICT_NAME_DECODER` live in `core/literal.ts` (T12.7).
  - An annotation is transparent but has a grammar (T12.7).
  - A closing label must match. An inline signature must agree with its `(type $t)`, checked at the
    end via `pendingTypeUses` (T12.7, T12.9).
  - An id binds once per index space (T12.9).
  - A string can continue a token: `$"l"0` is one Reserved token (T12.9).
  - `nan:0x<n>` names the exact mantissa, and the payload is checked against `[1, 2^bits-1]`, not
    masked (T10.4, T12.9). `nan:canonical`/`nan:arithmetic` are allowed only in expected results
    (`allowNanPatterns`, a scoped save/restore flag, because v128 results use them per lane; T12.6).
- [decision] **`TokenType.Reserved` is the unknown-operator signal.** `unknownOperatorText()` and
  `reportUnexpected(fallback)` serve `noProgress`, the post-body leftover check and `expect()`. The phrase
  `unknown operator` is load-bearing: it is spec-matched across 400+ cases. Parser wording agreement
  (816/1229) is a CEILING, not a backlog: about 200 misses are `(i32.const 0x)`, where our "expected i32
  constant" beats the spec's "unknown operator". `Reserved` must not return to
  `token_type_reachability.test.ts`'s allowlist (T13.38).
- [decision] `(assert_trap (module …))` is the distinct kind `assert_trap_module` (`tests/wabt-ts/parser/assert_trap_module.test.ts`).
  A NAMED reference must survive the whole pipeline in every position (T13.7; `tests/wabt-ts/parser/named_refs.test.ts`).

**Names passes**
- [decision] **`resolveNames` is total on TWO axes: every `Var` field AND every `Expr` field against its
  case body.** A sibling case that does what its neighbour skips is the tell. Instances:
  - `call_indirect.typeVar`, Bug G.
  - The atomic `memidx`.
  - The `table.get` index (T13.11; `tests/wabt-ts/ir/table_get_index.test.ts`).
  - The mechanical sweep on 2026-08-25 covered 75 `Expr`-bearing and 64 `Var`-bearing interfaces.
- [decision] **`applyNames`: axis 1 (`Expr` recursion) is GENERIC and axis 2 (`Var` rewriting) is an
  EXPLICIT table.** `segment` is a data index on `memory.init` but an elem index on `table.init`. Label
  and local vars are never rewritten (T13.20; `tests/wabt-ts/ir/apply_names_total.test.ts`).
  [correction] The header NOTE in `ir/apply-names.ts` still calls the rewriter partial and the
  ExprVisitor fold "a tracked follow-up". T13.20 superseded both.
- [decision] `constExprOperands` and `WatWriter.writeInstrHead` are COUPLED; a mismatch emits operands
  twice (`tests/wabt-ts/writer/const_expr_head_coupling.test.ts`). `writeFoldedConstExpr` covers constant
  exprs only and throws on anything else (T10.3).
- [decision] **INTENT blocks** state what joining a group asserts, what breaks in each direction, and
  which gate catches it, or that none does. Never write "what the code does" (T13.19). Live:
  - `instrInputCount`'s `return 1` group — pops exactly one (T13.16); gate `tests/wabt-ts/parser/instr_arity.test.ts`,
    which reads `isPlainInstr`'s case labels (`SimdLaneOp` the one allowlisted exception).
  - `resolveExpr`'s `table.size` arm (`ir/resolve-names.ts`) — every member a LEAF (T13.11).
  - The memarg handler family in `validator/shared-validator.ts` — owes memidx, align, offset, `is64` (T9.6, T9.11, T13.15).
  - The `try_table` block in `src/bridge/bridge.ts`.
  - Coupling gate for the const-expr writer: `tests/wabt-ts/writer/const_expr_head_coupling.test.ts`.

**Encoding and decoding**
- [decision] All four LEB encoders throw on an unrepresentable value (T13.2 unsigned, T13.12 signed),
  and the boundary values are asserted to round-trip. `core/leb128.ts` keeps throwing; the conversion
  to reported errors is at the reader boundary (`readXLeb` plus a backstop in `readBinaryIr`).
- [decision] **The binary-path tools never throw**: `wasm2wat`, `wasmValidate`, `wasmObjdump` and
  `wasmStrip` return `{ errors, result }`. The cursor is parked at end-of-input after an error.
  `wasmStrip` guards its re-encode (T13.29; `tests/wabt-ts/tools/malformed_never_throws.test.ts`).
- [decision] **A reader REPORTS and never resynchronises.** The section bound is checked INSIDE the loop
  via `shortSection()` or `this.err`, never in the loop condition. Huge counts fail fast AND loud (T12.8,
  T13.33; `tests/wabt-ts/reader/section_count_truncation.test.ts`).
- [decision] Reserved bits are checked, not masked: memarg flags `0x80`, the mutability byte, the tag
  attribute byte, and the table-init reserved byte, in the reader as well as the writer (T12.8, T13.5).
- [decision] The memarg alignment is `2 ** alignLog2`, never `1 <<` (T13.26; `tests/wabt-ts/reader/memarg_align_wrap.test.ts`).
- [decision] Two things live in `core/binary.ts`:
  - `sectionOrderRank` is the single copy of the section order. Tag (13) sits between memory and
    global; data-count (12) sits between elem and code.
  - Data-count is required by `memory.init`/`data.drop` and must agree with the data section (T12.8).
- [decision] **Section sizes are MINIMAL.** `reserveU32Leb` takes 5 bytes, then `patchU32Leb` writes
  the minimal encoding and `copyWithin`s the body down.
  - The pair is strictly LIFO — the invariant is written at `reserveU32Leb`: never hold an offset taken
    after a reserve across its patch.
  - Call sites: `writeSection` (`writer/stream.ts`) and `writeFuncBody` (`writer/binary-writer.ts`).
  - Measured (T13.40): the wasmtk corpus went from 628,201 to 607,845 bytes (3.2%, on the old 272 files).
  - Do not reproduce the non-minimal LEBs of crafted `(module binary …)` blobs.
- [decision] **Custom sections keep their input position.** `Custom.precedingSection` is `null` for
  "before all" and `undefined` for unknown, which means append — so hand-built IR is unchanged.
  - `BinaryWriter` walks an `ORDER` table; a new section must call `writeCustomSectionsAfter(id)`.
  - The anchor is a SLOT, so an absent section still keeps relative order (T13.41; `dylink.0` must be first).
- [decision] Limits and page sizes:
  - `Limits.initial`/`max` are `bigint`, a deliberate breaking change: consumers get a compile error
    where the wider range must be handled. The bridge refuses values above 2^53 (`limitToNumber`).
  - Test an optional number with `=== undefined`, because a max of 0 is a max (T13.3).
  - 64-bit limits are u64 on the wire (T13.2).
  - `pageSizeLog2` is legal only in {0, 16}. A non-power-of-two page size is malformed, `(pagesize 2)`
    is invalid, and a test pins each side.
  - The page ceiling is `2^addr_bits / pageSize`.
  - The page-size flag is rejected on a table and written on PRESENCE, so an explicit
    `(pagesize 65536)` round-trips: Wasmtime accepts it, and dropping the bit is the only cross-engine
    lever (T13.4).
- [decision] `synthesizeTypes` never invents a type for an unresolvable reference, and an implicit
  type-use is its own singleton rec group (T13.2). What `wat2wasm` accepts, `wasm2wat` must read back:
  walk both directions when adding an instruction (`i64.add128`, `0xfc 0x13`/`0x14`).
- [decision] **Decoder diagnostics use the spec's vocabulary.** `integer too large` (value bits) and
  `integer representation too long` (byte count) stay distinct; the gate
  `tests/wabt-ts/core/leb128_diagnostics.test.ts` exists to catch the two branches COLLAPSING. Compare a
  header field before reading the next one — magic before version is read (T13.37). Truncation is
  reported as `unexpected end of section or function`.

**Validator**
- [decision] GC operands:
  - Check SHARED HIERARCHY, not subtyping (`popCastOperand`, `topOfAbstract`); `br_on_cast` still needs `isSubtype`.
  - A bare `dropTypes(n)` is an unchecked pop, and a peek is not a check (`ref.as_non_null`).
  - `struct.get`/`array.get` `signed` is a TRI-STATE (undefined/true/false), enforced both ways by `checkPackedAccess` (T13.14).
  - [lesson] When a probe rejects, confirm it rejected for the reason under test.
- [decision] **Every memarg handler honours BOTH `offset` against the index type AND `is64`** (T9.11,
  T13.15; `tests/wabt-ts/validator/simd_lane_index_type.test.ts`). An underscore-prefixed parameter in a
  family of parallel handlers is the tell.
- [decision] `rethrow N` must name a `LabelType.Catch` frame (T13.17; `tests/wabt-ts/validator/rethrow_depth.test.ts`).
  V8 is the only oracle for legacy EH.
- [decision] Subtyping depth is at most 63 and the supertype graph must be acyclic, checked after the
  whole type section (`checkSubtypingDepth`). Mutual REFERENCES inside a rec group are legal (T13.34;
  `tests/wabt-ts/validator/subtype_depth_and_cycles.test.ts`).
- [decision] Prefixes and features:
  - `getOpcodeTypeInfo` needs a branch per PREFIX before the SIMD default (T13.9).
  - The atomic table is derived from a 7-wide cycle.
  - The misc `default:` is all-`Void`, and `onQuaternary` reads its opcode.
  - The wide-arithmetic oracle is Wasmtime `-W wide-arithmetic=y`, because V8 gates the proposal off.
- [decision] **Every `Features` flag gates at the point of use** (`requireFeature`), plus `checkValueType`.
  `gateOpcode` covers relaxed SIMD, wide arithmetic and extended-const. Gating stops exactly at the GC
  set: `funcref`/`externref` are never gated, and `annotations`, `codeMetadata` and `compactImports`
  have no validator surface and stay ungated. The CLI `--enable-*`/`--disable-*` flags must ship in
  the same change (T13.10). Compare `ValueType`s with `valueTypeEquals`, never `===` (T10.7).

**Tools, API, scripts, hygiene**
- [decision] CLI blocks never call `Deno.readFile` and friends directly. They use `cliRead`/`cliWrite`,
  now shared in `src/host.ts`, which print `<tool>: cannot read '<path>': <reason>` and exit 1.
  JSDoc examples keep the bare `Deno.readFile` on purpose (T13.31; `tests/wabt-ts/tools/cli_io_errors.test.ts`).
- [decision] Every `/compat/wabt` failure is an `Error` naming its method. `toBinary` wraps writer
  failures, and a method that can fail says so in its doc (T13.30; `tests/wabt-ts/api/compat_error_shape.test.ts`).
  `wasmStrip`'s `sections` option names what to REMOVE.
- [decision] Rules for `scripts/release/release-guard.ts`:
  - It stays side-effect free.
  - Mutating git calls before the guard are refused unless on the `READ_ONLY` set (`status`,
    `ls-remote`, `rev-parse`, `diff`, `config`, `log`).
  - `deno.json` is matched as an exact path.
  - A local tag is force-written, and a remote tag is refused (T13.43; `tests/wabt-ts/scripts/publish_preflight_wiring.test.ts`).
- [decision] `scripts/wabt-ts/engine-check.ts` gives EVERY engine an explicit proposal list, never
  `--enable-all`. Wasmer 7.2.1 refuses every module once `--enable-tail-call`, `-multi-memory` or
  `-memory64` is on. Read the cause from the `╰─▶` line. [correction] The ledger says Wasmer "now gets
  `--enable-all`"; the script superseded that (`engine-check.ts:131-150`). [baseline] Only Wasmtime
  implements custom page sizes (measured 2026-08-24).
- [decision] No control bytes (TAB, LF and CR excepted), and sentinels are visible strings (T13.25).
  `tests/wabt-ts/audit/source_hygiene.test.ts` scans `src/`, `tests/`, `cmem/` and `README.md` (`.ts`
  and `.md`) and pins `scanned > 100` (T13.28). Every entrypoint has `@module` JSDoc and every export
  has JSDoc.
- [decision] `scripts/` is inside `check`, `lint` and `fmt`, with `scripts/**/*.md` excluded from fmt
  (verified in `deno.json`).

**Already in the core:**
- T13.22 compensating pair, closed pre-merge → cmem/ir-convergence.md § "The bridge and the WAT
  routes into binaryen-ts — history, summarized"; cmem/best-practices.md § "Producer/consumer pairs
  are the recurring blind spot"
- A harness must call `wat2wasm` (T13.39: 449/449 vs the true 2207/2207) → cmem/testing.md § "A harness must call the real entry point"
- The release path's two tests, and the dirty-tree guard → cmem/testing.md § "The release path is tested, and needs two tests"; cmem/publishing.md
- `deno publish --dry-run` is not in `deno task test` → cmem/publishing.md § "`publish:dry` is in CI but NOT in `deno task test`"
- Custom-section TEXT position and minimal LEB re-encoding → cmem/divergences.md rows C2, C4, L1
- Diagnostic wording at close (689/711) → cmem/project.md § "Live gaps carried from the predecessors"
- Legacy EH oracle limits → cmem/testing.md § "A fixture believed valid must be said to an engine"

