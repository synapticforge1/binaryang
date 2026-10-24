# The portable opcode set — a guide for the other projects

What to emit, accept and test so a WebAssembly module runs, with the same behaviour, on every
widely used engine. Written for the projects that produce, run or load modules (wasmtk and its
`wasic`, wasmrt, wazmrt, rsxtk, the universal loaders); binaryang is the source of the data and the
tool that applies it.

**Status (2026-10-24).** This describes **binaryang 2.2.0**: D1 data 1.0.1, D2 2.2.0, D4 1.1.0, the
engines measured 2026-10-24. 2.0.0 carried D1 1.0.0, D2 2.0.0 and D4 1.0.0, which still excluded
tail calls (see [What changed](#what-changed)). Pin the version you read; the data says its own
version in `dataVersion`.

## The rule

> A module is **portable** when every instruction and encoding it uses is in the *portable* tier
> of D4's `portable` profile. A *lowered* one is made portable by the pass D4 names. An
> *excluded* one makes the module engine-specific.

`wasm-opt --target portable` applies exactly this: it lowers what can be lowered, refuses what
cannot (naming every such feature with the engines that refuse it), and checks its own output
against the profile again.

```sh
npx @synapticforge1/binaryang wasm-opt in.wasm --target portable -Oz -o out.wasm
```

## The defining engines

Fourteen, chosen as the most widely used by browser and runtime use (owner decision). Standalone
runtimes are measured at their maximum switches, JavaScript engines and browsers at their defaults.

| kind | engines (build measured) |
| --- | --- |
| runtimes | wasmtime 50.0.0 · wasmer 7.5.0 · WasmEdge 0.18.1 · wazero 1.12.0 (compiler and interpreter) |
| JavaScript | Node 24.21.0 · Deno 2.9.8 (V8) · Bun 1.4.4 (JavaScriptCore) |
| browser engines | Playwright Chromium 153 · Firefox 155 · WebKit 26.6 |
| stock browsers | Chrome 156 · Edge 156 · Firefox 158 · Firefox ESR 153 |

Safari is represented by WebKit; the browser floor is current Chrome / Edge, Firefox current and
ESR 153, and Safari 18.4+ (owner decision 8), which the portable tier fits.

## The tiers

582 instructions (D1). **513 portable, 29 lowered, 40 excluded.** By D2 feature:

| feature (D2 `cli`) | instructions | tier | how / refused by |
| --- | ---: | --- | --- |
| core (Wasm 1.0) | 172 | portable | |
| `mutable-globals`, `multi-value`, `extended-const`, `annotations`, `code-metadata` | 0 | portable | encodings, not instructions |
| `sign-extension` | 5 | portable | |
| `saturating-float-to-int` | 8 | portable | |
| `bulk-memory` | 7 | portable | |
| `reference-types` | 9 | portable | |
| `simd` | 236 | portable | |
| `threads` | 67 | portable | see [Atomics in a browser](#atomics-in-a-browser) |
| `function-references` | 5 | portable | except `br_on_non_null` (below) |
| `tail-call` | 2 (+ `return_call_ref`) | portable | since 2026-10-24 |
| `exceptions` | 8 | portable: `try_table`, `throw`, `throw_ref` | legacy `try` / `catch` / `catch_all` / `rethrow` / `delegate`: **lowered** by `TranslateToExnref` (refused by wasmtime, WasmEdge, wazero) |
| `memory64` (and table64) | 0 | **lowered** — `Memory64Lowering` | refused by Bun, wasmer, wazero |
| `custom-page-sizes` | 0 | **lowered** — `LowerCustomPageSizes` | refused by every engine but wasmtime and Firefox |
| `wide-arithmetic` | 4 | **lowered** — `WideArithmeticLowering` | refused by V8 (Node, Deno, Chromium, Chrome, Edge), Firefox ESR, WebKit, WasmEdge, wasmer, wazero |
| `relaxed-simd` | 20 | **lowered** — `RelaxedSimdLowering` | refused by wasmer, wazero; elsewhere results vary by hardware |
| `gc` | 32 | **excluded** | wasmer, wazero |
| `multi-memory` | 0 | **excluded** | wazero |
| `custom-descriptors` | 7 | **excluded** | every engine at its defaults |
| `compact-imports` | 0 | **excluded** | binaryang cannot read it yet |

Instruction-level exceptions (D4 `opcodes`): **`br_on_non_null` is excluded** (wasmer refuses it,
though the rest of `function-references` is portable); the five legacy exception instructions are
lowered, as above.

`return_call_ref` belongs to **`function-references`** in D1 (the proposal that defines it), not
to `tail-call`. A tool that gates it by tail-call refuses modules every other tool accepts.

### What a lowering costs

Behaviour is the same; size and speed are not always. Relaxed SIMD is lowered to the
specification's deterministic profile, measured on Node, Bun and wasmtime (a loop of nothing but
the one instruction): swizzle and laneselect the same; madd / nmadd, q15mulr and the truncations up
to about 2.3×; the dot products about 1.7–4.3×; min / max about 3.4–4.7× (binaryang's README,
"Making a module run without relaxed SIMD"). A program pays that only on its share of these
instructions. The memory64 lowering is sound above 2^32, where upstream Binaryen's wraps.

## For each kind of project

**A producer** (a compiler, `wasic`): emit only portable instructions, or emit what is natural and
run `--target portable` last. GC, multi-memory, custom descriptors and `br_on_non_null` have no
lowering: a module that needs them is engine-specific, and the target says which engines refuse it.

**A runtime** (wasmrt, wazmrt): since contract v33 the meaning of `--features` comes from D1 and D2:

- **Gate each instruction by its own D1 `feature`**, and nothing else. `return_call_ref` needs
  `function-references`; `memory.copy` needs `bulk-memory`.
- **Spell features as D2's `cli`** (`saturating-float-to-int`, not `sat-float-to-int`, which
  binaryang 2.0.0 removed).
- **D2 `requires` is recorded, not enforced** (owner, 2026-10-24). It lists the prerequisites a
  proposal states (`function-references` → `reference-types`; `gc` → `reference-types`,
  `function-references`; `relaxed-simd` → `simd`; `custom-descriptors` → `gc`), but no feature
  turns another on or off and no feature set is refused. So with `gc` on and
  `function-references` off, `call_ref` is refused and a GC struct is accepted — as wasmtime and
  wasm-tools do.
- **Gate each TYPE by D2 `typeRules`** (D2 2.2.0; wasm-tools' rule, owner 2026-10-24). Every
  reference type needs `reference-types`; `(ref null? $t)` needs `function-references` OR `gc` (so
  with `gc` on and `function-references` off, a function returning `(ref $s)` is valid);
  `(ref func)` / `(ref extern)` need `function-references`; the exn types `exceptions`; any / eq /
  i31 / struct / array / none / nofunc / noextern `gc`, nullable or not; `stringref` nothing
  enables. `needs` is a list of groups, every group needing at least one of its features.
- **Gate each ENCODING by D2 `encodingRules`**: importing or exporting a mutable global
  (`mutable-globals`), a `call_indirect` table index longer than the single byte `0x00`
  (`reference-types`), more than one table or memory, a table initializer, multi-value, a shared
  or 64-bit memory, a custom page size, struct / array definitions, tags. binaryang's tests prove
  each rule against its validator in both directions.
- **D2 `presets`** name the specification's releases: `wasm1`, `wasm2` (binaryang's default set),
  `wasm3`, and `all`. Each lists exactly the features on.

**A loader** (the universal loaders): a module that passed `--target portable` needs no feature
detection on any defining engine. Without the target, refuse or feature-detect by the D4 table
above, not by engine name.

## Behaviour to know

### Atomics in a browser

`memory.atomic.wait32` / `wait64` trap on a browser page's **main thread** — Chrome, Edge,
Chromium: "Atomics.wait cannot be called in this context"; WebKit reports it, wrongly, as "Out of
bounds memory access" (Bun, the same engine outside a page, waits). Wait from a worker. Firefox,
the runtimes and the JavaScript engines wait on the main thread.

### Results the specification leaves open

- **Relaxed SIMD** gives hardware-dependent results by design — measured: WasmEdge differs from the
  rest on `relaxed_swizzle`, `relaxed_trunc_f32x4_s` and the dot products; on
  `relaxed_trunc_f32x4_u` the V8 family and WebKit / Firefox disagree. This is why it is lowered.
- **A NaN's sign and payload** from arithmetic is not fixed: `f32x4.sqrt` of a negative lane gave
  one bit pattern on every engine and another in two interpreters. Compare NaNs as NaN.

### Edges every engine agrees on

Measured on 210 failure paths, all matching the specification: integer division by zero and
`INT_MIN / -1` trap, `rem_s` of `INT_MIN % -1` is 0; truncation traps on NaN and out of range,
`trunc_sat` clamps; every access one byte past a one-page memory traps; atomics wider than a byte
trap when unaligned; bulk operations that straddle the end trap — and **a zero-length
`memory.fill` / `memory.copy` exactly at the end does not**, while one past the end does.

## Where the facts come from, and how they stay true

- **D1 against the specification.** Every D1 opcode and name is attested by the specification's
  own sources (WebAssembly/spec's instruction index, and the threads, wide-arithmetic,
  custom-descriptors and legacy exception-handling proposals): 582 of 582. A committed snapshot of
  those facts, with each source's commit and licence, is checked by binaryang's tests on every CI
  run (`tests/definitions/spec_opcodes.test.ts`; `bun run spec-opcodes refresh <dir>` when the
  specification moves).
- **D4 measured, not written.** `bun run probe <work dir>` (binaryang, local only: it needs the
  engines installed) builds 785 modules — one per typed instruction, hand-written ones for the rest
  and for the encoding features, and the 210 failure paths — runs them on all fourteen engines,
  runs their `--target portable` outputs too, and compares everything with D4. Exit 0 means D4
  holds. Run it when an engine releases.

## What changed

| | binaryang 2.0.0 | binaryang 2.1.0 / 2.2.0 |
| --- | --- | --- |
| D1 `return_call_ref` | feature `tailCall` | feature `functionReferences` (D1 1.0.1, 2.1.0) |
| D2 | names only | + `requires` (recorded only) and `presets` (D2 2.1.0); + `typeRules` and `encodingRules` (D2 2.2.0) |
| D4 tail calls | excluded, "refused by wasmer" | **portable**: wasmer runs them; the old measurement passed it `--enable-tail-call`, a switch wasmer refuses itself |
| D4 `probes` | relaxedSimd 40, wideArithmetic 8 | 20 and 4 (a re-run was counted twice) |
| D4 `measured` | 2026-10-23 | 2026-10-24 (every engine re-run; Edge 156) |

## Reading the data

TypeScript, from JSR (`@jrmarcum/binaryang`) or npm (`@synapticforge1/binaryang`):

```ts
import { FEATURE_DEFINITIONS, OPCODE_DEFINITIONS, profileDefinition } from '@jrmarcum/binaryang/definitions';

const portable = profileDefinition('portable')!;
const tier = new Map(portable.features.map((f) => [f.feature, f.tier]));
const listed = new Map(portable.opcodes.map((o) => [o.name, o.tier]));
const tierOf = (name: string) => {
  const d = OPCODE_DEFINITIONS.entries.find((e) => e.name === name)!;
  return listed.get(name) ?? (d.feature === null ? 'portable' : tier.get(d.feature));
};
tierOf('return_call_ref'); // 'portable'
```

Any other language: the same data as JSON, `src/definitions/opcodes.json` (D1), `features.json`
(D2), `profiles.json` (D4), each with a `rules` object saying what every field means and a
`sha256` over its canonical content.
