# Overview

`wabt-ts` is a **TypeScript port of [WebAssembly/wabt](https://github.com/WebAssembly/wabt)**, the
C++ WebAssembly binary toolkit. It is forked from upstream wabt and being ported to native
TypeScript for integration with the **wasmtk** project.

## Goal

wasmtk currently shells out to the compiled wabt binary for `wat2wasm` and `wasm2wat`. The
TypeScript port removes the binary dependency and unlocks new tools — most notably `wasm2ts`.

**Long-term goal:** progressively compile pure-compute wasmtk modules to WebAssembly, using
`wasm2ts` output as the TypeScript-side integration layer. End state: a wasmtk where all practical
modules run as wasm with fully-typed TypeScript interfaces.

wasmtk uses a **Deno backend**. All design decisions favor Deno compatibility and clean TypeScript
public APIs. See [runtime-tooling.md](runtime-tooling.md).

## Conformance state (2026-08-24) — re-measure before quoting

Seven metrics over the 257-file WebAssembly spec testsuite
(`wasmtk/tests/module/wasm_wast/testsuite-main/`). **All seven are exhausted as of 2026-08-24.** Detail, method and
the harnesses: [tasks.md](tasks.md), [testing.md](testing.md).

| metric              | what it answers                                      | value                                                              |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| parse-clean         | files `parseWastScript` accepts                      | **257 / 257**                                                      |
| V8-valid            | files whose every module encodes to wasm V8 accepts  | **256 / 257** (2119 / 2120 modules) — the 1 is a 2^48-page `memory i64`, which **Wasmtime accepts** and V8 rejects on its own implementation limit. It used to pass only because the encoder truncated it (T13.2) |
| validator agreement | modules V8 accepts that `wasmValidate` also accepts  | **2119 / 2119**                                                    |
| `assert_invalid`    | modules the spec calls invalid that we reject        | **2683 / 2683**                                                    |
| round-trip          | `binary → wasm2wat → wat2wasm` byte-identical        | **2119 / 2119**                                                    |
| execution           | spec `assert_return` assertions our output satisfies | **23,077 / 23,077**                                                |
| `assert_malformed`  | text or bytes the spec says must FAIL TO PARSE that we reject | **1229 / 1229** quoted · **711 / 711** binary                       |

Against the wasmtk WASI corpus (`tests/wasmtk/`, a FROZEN 272-file snapshot — see
`tests/wasmtk/PROVENANCE.md`): encode **270 / 270**, round-trip **270 / 270**.

**Each metric was blind to bugs the others caught**, which is the campaign's most reusable finding —
see [best-practices.md](best-practices.md). The newest two exist because the others could not see
their failure modes: **execution** because the rest check bytes or acceptance and
none runs an instruction, and **`assert_malformed`** because every other metric
measures the REJECTING direction or our own output.

**Two of them cannot be pushed higher, and both numbers are honest rather than
short.** The 19 `assert_invalid` misses closed only once we stopped REPAIRING
those modules (T13.2), and V8-valid went DOWN in the same change — a 2^48-page
`memory i64` had been passing because the encoder truncated it. Wasmtime, the
authority, accepts what we now emit.

## Current state (2026-08-24)

**Tranche 13 is complete; every conformance metric is exhausted.** What it
changed, beyond the numbers:

- **The encoder no longer repairs invalid input.** `encodeU32Leb128` began
  `let v = value >>> 0`, which WAS the range check — 2^32 encoded as 0. That,
  plus `synthesizeTypes` inventing a type for an unresolvable type-use and
  reusing a rec-group member for an implicit one, is what the last 19
  `assert_invalid` misses actually were: not a permissive validator, but our own
  pipeline rewriting the module before anything validated it (T13.2).
- **`Limits.initial` / `max` are `bigint`** and **`Limits.pageSize` is now
  `pageSizeLog2`** — two BREAKING changes to an exported type, both deliberate.
  See [publishing.md](publishing.md); they are unreleased.
- **Custom page sizes work end to end** (T13.4) — parser, reader, writer,
  validator, feature gate. The proposal had a flag, an IR field and half a
  decoder, and no rule enforced anywhere.
- **An out-of-scope branch target is now the parser's error** (T13.1), so the
  quoted `assert_malformed` number no longer depends on where the probe sits.
- **Every `Features` flag now GATES** (T13.10). Nine of twenty-one were inert —
  a caller could switch `gc` off and validate a GC module. Gating covers types
  as well as instructions, and `wasm-validate` gained
  `--enable-<feature>` / `--disable-<feature>` / `--enable-all` in the same
  change, because a gated validator without flags rejects most modern wasm.
- **Two atomic bugs, in a proposal no metric can see** (T13.8, T13.9). The
  arity table was one too high for atomic store / rmw / cmpxchg, so `wasm2wat`
  output of any such module was **rejected by V8**; and the validator had no
  `PREFIX_THREADS` branch, so every atomic was type-checked as
  `(v128,v128)→v128` and **falsely rejected**. See the blind spot below.
- **Three reserved bytes were read and discarded** (T13.5) — the tag attribute
  in both paths and the table init form's marker; **the opcode-name and
  natural-alignment tables were audited against the lexer's own population**
  (T13.6); and a `$name` was checked in all 64 grammar positions (T13.7), where
  21 fail at v1.3.5.
- **Cross-runtime reality is measured, not assumed** — Wasmtime, V8, Bun/JSC,
  Wasmer and wazero, over the whole WASI corpus. The matrix and what each
  runtime refuses are in [tasks.md](tasks.md); the short version is that only
  Wasmtime implements custom page sizes, and wazero's CLI refuses any module
  carrying a tag section.

### The blind spot the metrics cannot cover

**The 257-file testsuite snapshot contains NO atomics** — no `atomic.wast`, no
shared-memory file, not one `atomic.load` / `store` / `rmw`. The whole threads
proposal sits outside the population every metric measures, and two real bugs
lived there undisturbed. A corpus-shaped metric is only as complete as its
corpus: **the proposals the corpus lacks ARE the blind spot**, and that list is
worth producing before trusting "all seven green".

The tests added for this reason need neither a corpus nor an oracle, and each
found something the seven metrics could not — see [testing.md](testing.md):
folded-vs-linear (arity), named-vs-numeric references, every atomic opcode
against V8, and the feature gates.

**Open, and not ours to fix:** wasmtk's legacy-EH emission — Wasmtime and Wasmer
both reject it, file for file, and `try_table` reaches parity. Written up in
`scripts/wasmtk-eh-parity-report.md`, together with a RETRACTED second finding
(an "unused `$__exn_tag`") that came from grepping the frozen snapshot and does
not hold against current wasic.

## Repo layout

```text
wabt-ts/
├── upstream/              ← original wabt C++ source (reference only, not built)
│   ├── src/ include/      ← C++ source + headers — open alongside the .ts when porting
│   └── test/ docs/ …
├── src/                   ← TypeScript source (this project)
│   ├── core/              ← Phase 1: types, opcodes, leb128, literals, errors, result
│   ├── ir/                ← Phase 2: Expr union, visitor, apply/resolve/generate-names
│   ├── reader/            ← Phase 3: binary reader → IR
│   ├── writer/            ← Phase 3+4: binary writer, stream, WAT pretty-printer
│   ├── parser/            ← Phase 4: lexer-source, wast-lexer, token, wast-parser
│   ├── validator/         ← Phase 5: type-checker, shared-validator, validator
│   ├── bridge/            ← Phase 7: binaryen-bridge, type-map
│   ├── api/               ← wabt-compat facade (jsr:.../compat)
│   ├── tools/             ← Phase 6 CLI tools (only place Deno.* I/O is allowed)
│   └── index.ts           ← public API surface for wasmtk
├── tests/                 ← core/ reader/ writer/ parser/ validator/ bridge/ tools/ api/ wasmtk/ fixtures/
├── binaryen-ts/           ← peer-project submodule (bridge target; read-only reference)
├── wasmtk/                ← consumer submodule (reference for wasm2ts reverse-compilation)
├── deno.json              ← Deno config, import map, tasks
├── package.json           ← Bun config (no tsconfig.json / vitest.config.ts — deleted)
└── cmem/                  ← this portable project-memory folder
```

The original wabt C++ source is preserved in `upstream/` as reference — open it alongside the
corresponding `.ts` file when porting, or diff against it when pulling upstream changes. The
per-phase TS↔C++ file mapping lives in [phases.md](phases.md).

## Sibling projects

- **binaryen-ts** — TypeScript port of binaryen; the optimize/encode back end. wabt-ts calls its
  constructor API directly through the Phase 7 bridge. See [bridge.md](bridge.md). The two will
  eventually merge into **binaryang**.
- **wasmtk** — the consumer; compiles TypeScript → WAT today, and is the reference for the planned
  `wasm2ts` reverse compiler (Phase 8).

## Production pipeline (binaryang cross-project)

```text
validate(wabt-ts) → strip(wabt-ts) → bridge → optimize(binaryen-ts) → encode(binaryen-ts)
```

binaryen-ts is the canonical encoder for _optimized_ wasm; wabt-ts's encoder serves format tools
(`wasm2wat`/`wat2wasm` round-trips, strip, validate). wabt-ts's WAT parser is the front door for all
external `.wat` input.
