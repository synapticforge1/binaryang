# wabt-ts — the gate, the conformance metrics and the invariant-to-test map

Summary: the wabt-ts conformance baselines at campaign close, the hardening axes, which test pins which invariant, and the TS to C++ map. Last verified 2026-11-20.
Main file: [wabt-ts.md](wabt-ts.md). Moved from it on 2026-11-20 (H38 step 5), unchanged.

## `wabt-ts/testing.md` (642 lines) — the wabt-ts gate, conformance metrics, hardening axes and test placement

Covered the gate and its CRLF `fmt` workaround, the byte baseline, the wasmtk corpus and its
snapshot rule, the enumeration frontier and hardening axes, and the conformance metrics with their
blind spots. Also the four corpus-free test shapes, the three-engine rule, the fixture convention,
and ~200 lines of per-invariant test placement. Most of the method merged into the core. What is
left is the metric snapshot, the axis states and the placement map.

**Kept**
- [baseline] **Conformance metrics, at campaign close 2026-08-25** (the first seven closed
  2026-08-24). This is a snapshot from scratchpad harnesses outside `deno task test`, over the
  257-file spec testsuite. The file says "nine" metrics, but the table has 13 rows. The current
  in-repo instrument → cmem/testing.md § "The spec-testsuite harness — the must-REJECT axis".

| metric | value | blind to |
| --- | --- | --- |
| parse-clean | 257/257 | a file that parses, then encodes to bytes V8 rejects |
| V8-valid | 2119/2120 | a decoder that REORDERS a module (T9.1); an encoder that truncates into range (until T13.2) |
| validator agreement | 2119/2119 | false ACCEPTS — it counts only false rejections. T13.14 found 12 with every metric green. Counter: a hand-built invalid corpus |
| `assert_invalid` | 2683/2683 | a permissive validator vs a REWRITTEN module (T13.2); the denominator is whatever the classifier hands it (2737 → 2683) |
| round-trip byte-identical | 2119/2119 | a consistently wrong opcode mapping (reader and writer agree) |
| execution | 23,077/23,077 | host imports, v128, NaN payloads, `ref.func` args (29,544 skipped) |
| `assert_malformed` | 1229/1229 quoted · 711/711 binary | the accepting direction, and WHY we reject; probe position changes the number (1227 → 1229, T13.1) |
| binary → IR → binary | 30/88 | text round trips drop custom sections before the writer (T13.41); all 58 settle on pass 2 |
| round-trip FIDELITY | 2119/2119 | input is our own output, so a difference is our bug. **Never sum with the next row**: summed, it read 2124/2207 and hid T13.40 |
| round-trip of crafted bytes | 27/88 | non-minimal LEBs and elem-flag choices the text cannot record; 88/88 is not the goal |
| diagnostic wording — reader | 689/711 | the error OFFSET; inputs with no expected string; message quality (T13.37) |
| diagnostic wording — validator | 2446/2683 | same (T13.38); 0 false accepts |
| diagnostic wording — parser | 816/1229 | same (T13.38); ~200 misses are `(i32.const 0x)`, where OUR message is better — a ceiling, not a backlog |

- [correction] **A different instrument, not comparable with the table.** The scratch harnesses
  skipped `synthesizeTypes` until T13.39. Corrected, over 2207 modules rather than 2120: agreement
  2207/2207, `assert_invalid` 2694/2694, round-trip 2124/2207. "83 differences are non-minimal LEBs"
  was wrong: 22 were our own 5-byte section-size padding (T13.40). Every historical `assert_invalid`
  denominator /2737 carries +54 `assert_trap (module)` pollution — its deltas are valid, its
  absolutes are not.
- [baseline] **Hardening axes (T13.33–T13.38).** CLEAN: huge declared counts (4,294,967,295
  declared; 11 sections bail in 0 ms), deep nesting (100 000 blocks / 60 000 operands, no stack
  overflow), complexity (~2× per doubling; 5 module shapes and 4 string/name series), type-graph
  recursion (a 2000-deep subtype chain in ~12 ms), size amplification, string/name scaling, text
  round-trip convergence (272/272 at iteration 1), gate vacuity. Diagnostic OFFSET: measured since →
  cmem/testing.md § "✅ A3 — diagnostic offsets are MEASURED (2026-08-31)". Diagnostic usefulness
  ("is the message actionable?"): **not attempted** → cmem/open-work.md.
- [baseline] **The enumeration frontier has been EMPTY since T13.32** — the cheap axes are spent,
  not the code clean. Swept: `resolveNames` (both axes), `applyNames`, `generateNames`,
  `expr-visitor`, validator operand/memarg checks, `instrInputCount`, WAT-writer const-expr
  coupling, bridge label frames/alignment, `binary-reader.ts`, `wasm-strip`, the CLI shims,
  `wasm-objdump`'s `sectionMeta`, and the release path. The next audit should invent a new axis or
  state a lower yield.
- [correction] **The corpus is 421 files: 413 generated from wasic + 8 non-wasic fixtures**, and all
  421 encode, validate and round-trip since T13.46. wasmtk counts its live corpus at **373**; this
  is deliberately NOT reconciled (A4, above).
- [correction] **`cli_io_errors.test.ts`'s behavioural half now runs:** `deno task test` grants `--allow-run --allow-write` and reports 0 ignored. The wing's "1 ignored by design" is stale.
- [reference] **Invariant → test.** Paths are under `tests/wabt-ts/` unless stated. All 55 tests exist.

- **test(s):** `tools/wat2wasm.test.ts` · `reader/binary-reader.test.ts`
  - pins: natural alignment when `align=` is omitted · a function import beside a defined function (`readCodeSection` off-by-one)
- **test(s):** `parser/stmt_order.test.ts` · `parser/empty_folded.test.ts`
  - pins: statement order (`pushStmt` flush, void call before `return`) · Bug D multi-value receive, Bug F `br_if` global resolution
- **test(s):** `parser/legacy_try.test.ts` · `parser/wide_arithmetic.test.ts`
  - pins: legacy try: parse shapes, V8 throw/catch/rethrow, no duplication · wide-arithmetic end to end (Wasmtime-verified), lexer-vs-reader sweep
- **test(s):** `writer/tag_type_index.test.ts` · `writer/nan_payload.test.ts`
  - pins: T10.7 tag type matched by `valueTypeEquals` · T10.4 exact NaN mantissa; `return_call_indirect` keeps its table
- **test(s):** `parser/linear_try_table.test.ts` · `writer/table_init.test.ts`
  - pins: T10.6 linear `try_table` keeps catches and body · T10.3 table initializer written folded; inexpressible ones throw
- **test(s):** `writer/operand_placeholder.test.ts` · `parser/call_arity.test.ts`
  - pins: T10.8 placeholder never written, T11 no-repair guards · T10.5 linear `call` pops only the callee's arity
- **test(s):** `writer/export_order.test.ts` · `validator/memarg_offset.test.ts`
  - pins: T10.1/T10.2 inline `(export)` only when faithful · T9.11 every memarg handler checks `offset` against the index type
- **test(s):** `tests/bridge/tier_b`, `tier_c`, `tier_d`, `gc_tier1`–`4` `.test.ts`
  - pins: bridge coverage; GC tiers check encoding only (no engine call, verified)
- **test(s):** `api/wabt_compat.test.ts` · `api/compat_error_shape.test.ts`
  - pins: wasmtk's exact `/compat` call patterns (now `./compat/wabt`) · T13.30 errors name their origin, fuzz population pinned (`threw > 50`)
- **test(s):** `audit/silent_corruption_fixes.test.ts` · `_round2.test.ts`
  - pins: 2026-06-09 audit rounds 1–2 → § "2026-06-09 silent-corruption audit" above
- **test(s):** `audit/source_hygiene.test.ts`
  - pins: T13.25/T13.28 no control bytes in `src`, `tests`, `cmem`, `README.md`; population pinned (`scanned > 100`)
- **test(s):** `parser/label_scope.test.ts` · `parser/custom_page_sizes.test.ts`
  - pins: T13.1 out-of-scope branch targets, incl. catch/`delegate` scopes · T13.4 `(pagesize N)`, log2 encoding, gate (no metric reaches it)
- **test(s):** `ir/limits_bigint.test.ts` · `writer/no_repair.test.ts`
  - pins: T13.3 64-bit limits at full width end to end · T13.2 no truncation; a bad type index stays bad; no rec-group borrowing
- **test(s):** `validator/feature_gates.test.ts` · `validator/atomics.test.ts`
  - pins: T13.10 each proposal rejected without its flag, message names it · T13.9 all 67 atomic opcodes vs V8, round trip, width pinning
- **test(s):** `parser/named_refs.test.ts` · `ir/table_get_index.test.ts`
  - pins: T13.7+T13.13: 64 name POSITIONS and 69 OPERANDS (decoy at 0), V8 must accept · T13.11 `resolveNames` walks `table.get`'s index
- **test(s):** `core/leb128.test.ts` (signed block) · `core/opcode_tables.test.ts`
  - pins: T13.12 all four LEB encoders reject what they cannot represent · T13.6 lexer⇄printer name symmetry, natural alignment
- **test(s):** `validator/subtype_depth_and_cycles.test.ts`
  - pins: T13.34 depth ≤ 63 pinned on both sides (64 ok, 65 not); acyclic supertypes; mutually referencing rec groups stay legal
- **test(s):** `reader/section_count_truncation.test.ts` · `parser/token_type_reachability.test.ts`
  - pins: T13.33 count must match entries; no hang on 2^32−1 · T13.32 every `TokenType` emitted or allowlisted with a reason
- **test(s):** `tools/cli_io_errors.test.ts` · `tools/malformed_never_throws.test.ts`
  - pins: T13.31 CLI I/O errors reported (source gate + behavioural half) · T13.29 585 malformed inputs × 4 tools: never throw, still REPORTED
- **test(s):** `reader/memarg_align_wrap.test.ts` · `tests/bridge/label_frames.test.ts`
  - pins: T13.26 alignment exponent cannot wrap (32/33 flip on revert) · T13.24 the `if` frame; step 1 guards the guard
- **test(s):** `ir/apply_names_total.test.ts` · `writer/const_expr_head_coupling.test.ts`
  - pins: T13.20 `applyNames` total on both axes · T13.21 `constExprOperands` ⇄ `writeInstrHead` in sync (read from source)
- **test(s):** `parser/instr_arity.test.ts` · `parser/drop_arity.test.ts`
  - pins: T13.8 folded vs linear, 74 instrs; T13.18 `isPlainInstr` ⊆ `instrInputCount` · T13.16 `data.drop`/`elem.drop` take no operand
- **test(s):** `validator/simd_lane_index_type.test.ts` · `validator/rethrow_depth.test.ts`
  - pins: T13.15 lane ops follow the index type (`load8_splat` control) · T13.17 `rethrow N` names an enclosing catch; V8-only
- **test(s):** `validator/gc_operand_checks.test.ts`
  - pins: T13.14 15 invalid GC shapes vs V8; 14 valid ones stay valid (shared hierarchy, not subtyping)
- **test(s):** `reader/reserved_bytes.test.ts` · `reader/binary_malformed.test.ts`
  - pins: T13.5 tag attribute and table-init reserved bytes · T12.8 section id/order/size, counts, closing `end`, data count
- **test(s):** `parser/annotation_lexing.test.ts` · `parser/type_use_and_label.test.ts`
  - pins: T12.7 annotation characters, required id · T12.7 repeated labels match; an inline signature agrees with its type, is not re-interned
- **test(s):** `parser/lane_and_nan_context.test.ts` · `parser/name_utf8.test.ts`
  - pins: T12.6 lane immediates required, NaN patterns per-lane only · T12.5 names valid UTF-8 in both paths; a BOM stays a character (T7.13)
- **test(s):** `parser/simd_lane_range.test.ts` · `parser/align_power_of_two.test.ts`
  - pins: T12.4 lane fits `u8` (malformed), 16..255 is a validation error · T12.3 non-power-of-two `align` malformed, oversized invalid
- **test(s):** `parser/import_order.test.ts` · `parser/const_range.test.ts`
  - pins: T12.2 no import after a definition; 7 legal orders guarded · T12.1 integers range-checked; a finite float rounding to inf is out of range
- **test(s):** `wasmtk/runner.test.ts` · `roundtrip.test.ts` · `provenance.test.ts`
  - pins: corpus forward; reverse (the disassembly re-compiles); the snapshot stamp

**Already in the core**
- Running; `publish:dry` for moved exports; the test tree → cmem/testing.md § "Running", § "Test tree"
- The CRLF `fmt` apparatus is retired; `git diff --stat` after a revert → cmem/testing.md § "✅ The `deno fmt --check` line-ending false alarm is RETIRED"
- `scripts/wabt-ts/verify-baseline.ts` (`deno task baseline`) → cmem/testing.md § "Proving a refactor changed nothing: `deno task baseline`"
- The snapshot rule → cmem/testing.md § "The wasmtk corpus is a SNAPSHOT, and that has cost real credibility"; harness, axis, fixture and V8-only-oracle rules → § "The convergent testing philosophy"
- Release guard, two tests (`tests/wabt-ts/scripts/`); CI → cmem/testing.md § "The release path is tested, and needs two tests", § "CI gate"

## `wabt-ts/phases.md` (209 lines) — wabt-ts phase plan, campaign snapshot, TS ↔ C++ map, per-phase gotchas

Phase status: wabt-ts Phases 1–6.2 were complete. wabt-ts Phase 7 (the bridge) was "in progress,
pinned to binaryen-ts 1.5.0"; it is now internal, and S6 deletes it. wabt-ts Phase 8 (`wasm2ts`) was
pending. The file also held release highlights 1.1.9–1.3.5, the campaign table, T13 at a glance, the
porting map and gotchas. The gotchas were partly overtaken by the S-series IR changes; only those
verified against today's code are kept.

**Kept**
- [reference] **TS ↔ C++ map for `src/wabt-ts/`**, from each file's own `Original source:` header. C++ paths are under `WebAssembly/wabt/`, checked in the local clone.

- **TS (`src/wabt-ts/…`):** `core/types.ts` · `core/error.ts`
  - C++ (`WebAssembly/wabt/…`): `include/wabt/base-types.h`, `include/wabt/type.h` · `include/wabt/error.h`, `include/wabt/error-formatter.h`
- **TS (`src/wabt-ts/…`):** `core/binary.ts` · `core/result.ts` · `reader/binary-reader-nop.ts`
  - C++ (`WebAssembly/wabt/…`): `include/wabt/binary.h` · `include/wabt/result.h` · `include/wabt/binary-reader-nop.h`
- **TS (`src/wabt-ts/…`):** `core/opcode.ts` · `core/feature.ts` · `parser/token.ts`
  - C++ (`WebAssembly/wabt/…`): `include/wabt/opcode.{h,def}` · `include/wabt/feature.{h,def}` · `include/wabt/token.{h,def}`
- **TS (`src/wabt-ts/…`):** `core/leb128.ts` · `core/literal.ts`
  - C++ (`WebAssembly/wabt/…`): `include/wabt/leb128.h` + `src/leb128.cc` · `include/wabt/literal.h` + `src/literal.cc`
- **TS (`src/wabt-ts/…`):** `ir/{ir,ir-util,expr-visitor,apply-names,resolve-names,generate-names}.ts`
  - C++ (`WebAssembly/wabt/…`): `include/wabt/<same>.h` + `src/<same>.cc`
- **TS (`src/wabt-ts/…`):** `reader/binary-reader.ts` · `reader/binary-reader-ir.ts`
  - C++ (`WebAssembly/wabt/…`): `include/wabt/binary-reader.h` + `src/binary-reader.cc` (and `binary-reader-ir`) · `include/wabt/binary-reader-ir.h` + `src/binary-reader-ir.cc`
- **TS (`src/wabt-ts/…`):** `writer/{binary-writer,stream,wat-writer}.ts` · `parser/{lexer-source,wast-lexer,wast-parser}.ts`
  - C++ (`WebAssembly/wabt/…`): `include/wabt/<same>.h` + `src/<same>.cc`
- **TS (`src/wabt-ts/…`):** `validator/{type-checker,shared-validator,validator}.ts`
  - C++ (`WebAssembly/wabt/…`): `src/<same>.cc` + `include/wabt/<same>.h`
- **TS (`src/wabt-ts/…`):** `tools/{wat2wasm,wasm2wat,wasm-validate,wasm-objdump,wasm-strip}.ts`
  - C++ (`WebAssembly/wabt/…`): behavioural counterparts of `src/tools/<same>.cc`; MIT headers (original code)
- **TS (`src/wabt-ts/…`):** `ir/synthesize-types.ts`, `ir/fidelity.ts`, `core/custom-placement.ts`, `reader/name-section.ts`, `api/wabt-compat.ts`, `tools/wasm2ts.ts`
  - C++ (`WebAssembly/wabt/…`): no C++ counterpart (MIT)

- [reference] **Gotchas verified today.** `func` lexes to `TokenType.Func` (refkind `FuncRef`), not
  `TokenType.Function`. Never `export *` from `token.ts` in `index.ts`: its `LiteralType` collides
  with `literal.ts`. `parseFoldedInstr` consumes immediates before sub-expressions. Locals resolve
  at parse time (`localScope` / `resolveLocal`), so `resolveNames` owns locals only for binary-read
  or hand-built IR. The validator is three layers (TypeChecker ← SharedValidator ← Validator);
  `beginFunction` does NOT push params, and errors route through `setErrorCallback`.
  `AtomicNotifyExpr` has no `opcode` field (`AtomicWaitExpr` does). `wasm-objdump` counts come from
  module arrays, not `SectionMeta.count`.
- [correction] **CLI pipelines.** `wat2wasm` = `parseWatModule` → `resolveNames` →
  **`synthesizeTypes`** → `writeBinaryIr` (the wing omits `synthesizeTypes`). `wasm2wat` runs
  `generateNames` **only on request** (`--generate-names`). `wasm-strip` is unchanged:
  `readBinaryIr({readDebugNames:false})` → clear `module.customs` → write.
- [correction] **The wing's "IR field names" list is stale; read `ir/ir.ts`.** Atomic kinds are now dotted (`'atomic.notify'`), and `IfExpr` has `ifTrue`/`ifFalse`, not `then_`/`else_`.

**Already in the core**
- Sub-version capped at 9 → cmem/project.md § "Versions"; "Phase N" ambiguity → § "\"Phase N\" is ambiguous here, permanently"
- A snapshot column headed "now"; re-derive a count from its table → cmem/project.md § "Live gaps carried from the predecessors"
- `/compat` mirrors `npm:wabt`, now `./compat/wabt` → cmem/project.md § "Settled decisions" (decision 5)

