# Unreleased on `main` — what the next release note must say

**As of 2026-10-07: `main` = `v1.8.1` plus everything under "Since 1.8.1" below — UNRELEASED, NOT
PUSHED** (check it rather than trust this line:
`git log --oneline v1.8.1..main -- src/ main.ts
deno.json`). It adds an export (`./definitions`), so
the next release is a MINOR, 1.9.0 — typed by hand ([publishing.md](publishing.md) § "`bump` has no
minor mode"). The owner's order: the wasmtk list (open-work 22, 24) and the remaining items before
publishing. `deno.json` reads 1.8.1; the version line arms a release, so the bump is the owner's
decision, never a side effect of work.

**Folded away** under the cleanup policy ([INDEX.md](INDEX.md)): every entry this file held since
1.5.4 shipped — in **1.6.0** (One front end, `./binary` and `./encoder` removed, the IR record
changes, the post-M8 and Q1–Q8 fixes, S7), **1.6.1** (the CLI from JSR), **1.7.0** (`./interop`
removed, wasmtk's items 1–5 with custom descriptors, `--converge`, the minify passes, Flatten
complete), **1.7.1** (u64 limits and the 1-byte-page cap), **1.7.2** (`wasm2wat` text as upstream /
wasm-tools: N10, W18, M2a; `array.new_default` defaultability) or **1.8.0** (diagnostics DG1–DG6,
the `wat2wasm` CLI validating by default, the reader stopping at its first error, Q10–Q13,
`LowerCustomPageSizes` with its `#pagesize=` exports, `wasm-opt` validating its input) or **1.8.1**
(wasmtk's § 20: L3 trap kind, L4 placeholder, C7 `getFunctionInfo` shape). The public summary of
each is `CHANGELOG.md` § that version; the full notes as gathered, BREAKING items field by field:
`git show 769b4d3c0:cmem/unreleased.md` (to 1.7.0), this file at `7aa54e95c` (1.7.1 → 1.7.2), at
`fb5068e47` (1.8.0), and at `99f2a5b16` (1.8.1).

## How to use this file

Add an entry when a change on `main` is one a release note must carry — say which kind:

- ⚠️ **BREAKING** — a removed or renamed export, a changed IR field, a changed default. Makes the
  release a MINOR, typed by hand ([publishing.md](publishing.md) § "`bump` has no minor mode").
- **Behaviour** — output bytes move, or an input is accepted / refused that was not.
- **Silent fix** — was wrong without saying so; say what a user may have shipped.
- **NEW** — an export, a pass, a CLI flag.

⚠️ **wasmtk pins binaryang EXACTLY** and wants each release to say which of their reported items it
contains ([handoffs.md](handoffs.md)).

## Since 1.8.1

- **Silent fix — the WAT parser put a folded instruction's missing operands in the wrong slots**
  (open-work 10): `(i32.const 10) (nop) (select (i32.const 20) (local.get 0))` built a `select` with
  value and condition swapped; also a `throw` of a param-less tag took a value it should leave, and
  a multi-result folded child shifted its siblings. The bytes `wat2wasm` writes were right; the TREE
  was not, so anything optimizing straight from parsed text (the direct path) could compute a
  different result — measured for the `select` case at -O2.
- **Behaviour — `Asyncify` accepts `call_ref`** (open-work 8): instrumented as an indirect call, as
  upstream does; it refused the module before. `return_call_ref` is still refused.
- **Behaviour — `LocalCSE` rewritten** (open-work 3–5): it reuses any repeated expression that only
  reads (loads, `memory.size`, global reads) or may trap, along straight-line code, until something
  writes what it reads; it reused only constants, locals, globals and non-trapping arithmetic within
  one block before. Corpus −3.0 KB at -Os / -Oz, −3.1 KB at -O2, −3.2 KB at -O3; behaviour
  unchanged.
- **NEW / Behaviour — `ConstantPropagation` pass** (open-work 2, 2026-10-07): a `local.get` whose
  only reaching value is one constant becomes that constant (copies followed, a declared local's
  zero counted; numeric and `v128` only; no evaluation — that is item 23). Scheduled at -O2 and up
  after OptimizeInstructions, with OptimizeInstructions again. Corpus −2.3 KB at -O2 / -Os / -Oz,
  −3.4 KB at -O3; -O1 unchanged; behaviour unchanged.
- **Behaviour — `Vacuum` splices an unnamed block into its sequence; `RemoveUnusedBrs` turns a
  block whose only branch is a leading `br_if` to itself into an `if`; NEW pass `CodeFolding`**
  (open-work 2, 6a / 6b / 6c, 2026-10-08): the loop shape `(block $out (loop $in (br_if $out c)
  …))` becomes `(loop $in (if (i32.eqz c) …))`; what both arms of an `if` end with is written
  once after it. `CodeFolding` runs at -O2 and above (the function passes). Corpus -Oz 847,329 →
  836,929 (−10,400), -O2 / -O3 likewise, -O1 unmoved; behaviour unchanged (the gates).
- **NEW — `wasm-ctor-eval` and `wasm-interp`** (open-work 23, E4, 2026-10-08): two CLI commands
  and two subpaths, `./tools/wasm-ctor-eval` (`ctorEval(module, options)`) and
  `./tools/wasm-interp` (`interpModule(module, options)`), on the interpreter. `wasm-ctor-eval` runs
  the start function and `--ctors` at build time and writes memory (packed data segments) and
  globals back; a constructor cut at a host call keeps its remaining code; `--kept-exports`,
  `--ignore-external-input`, `-S`, `-o`. Opt-in, never part of `-O`; run `-Oz` after it. Measured
  on the corpus: −54 KB on top of `-Oz` (6.4%). `wasm-interp`: `--run-all-exports`,
  `--run-export=NAME` with `--argument=V`, `--dummy-import-func`.
- **Silent fix — the optimizer could make an INVALID module (or a wrong one) of a binaryen-written
  body** (open-work 23, E4, 2026-10-08): where a value sat on the stack beneath a two-result call
  whose first result a later instruction took (`i32.const; call $two; local.set; local.tee …`),
  the spill before the passes replaced the deeper value's `pop` with a `local.get` while the
  tuple's `pop` stayed, and the `local.get` pushed its value on top of what the `local.tee` was to
  take: V8 refused the output (`local.tee[0] expected type f64, found local.get of type i32`), or,
  where the types coincided, it computed with the wrong value. A pop that stays now keeps every
  pop evaluated before it. Found on upstream `wasm-ctor-eval`'s output; corpus bytes unmoved.
- **Behaviour — `OptimizeInstructions` and `Precompute` fold `v128` constant expressions**
  (open-work 23, E3e, 2026-10-08): every SIMD operator of constants becomes its value, through the
  one evaluator; never a relaxed-SIMD operator (the engine picks its result), never a vector with
  a NaN lane from float arithmetic. Corpus: not one byte moved at any level.
- **NEW / Behaviour — `Precompute` pass** (open-work 23, E2, 2026-10-07): an expression whose value
  is known becomes it — a tree of constants; an `if` / `select` / `br_if` / `br_table` with a
  constant condition takes its arm (a `select`'s other operand only when it has no effect and cannot
  trap). On the evaluator, under the same fold rule as OI (never a trap; a NaN only from a bit-exact
  operator). In the function passes at -O2 and up, twice with ConstantPropagation. Corpus −4.4 KB at
  -O2 / -Os / -Oz, −6.0 KB at -O3; -O1 unchanged; behaviour unchanged.
- **Behaviour — `OptimizeInstructions` folds through the evaluator** (open-work 23, E1, 2026-10-07):
  every scalar operator now folds — floats, division, conversions — through one numeric core
  (`interp/numeric.ts`, V8-checked on all 136 scalar instructions); never a trap, and a NaN only
  from a bit-exact operator. It folded integers only before. Corpus −2.5 KB at -O2 / -Os / -Oz, −4.4
  KB at -O3; behaviour unchanged. **NEW export** `makeConst(literal)` in `./ir/binaryen-ts` (the
  `*.const` node for any scalar or `v128` Literal). `interp/numeric.ts` itself is NOT exported yet —
  its public shape waits for E3 / E4.
- **Behaviour — `wat2wasm` no longer reads its own output back** to predict text forms: −12% time on
  the corpus, bytes identical.
- **NEW — `./definitions`** (open-work 22; wasmtk's H10): the shared definitions for other projects
  to generate their copies from — D2, the WebAssembly feature / proposal list, and D3, the spec
  testsuite's trap / exhaustion vocabulary with its prefix rule — each with `dataVersion` and a
  content `sha256`; `verdictClass()`, `featuresForSuite()`; the JSON sources ship in the package
  (`src/definitions/*.json`). A new export: the release is a MINOR. And D1, the instruction table:
  582 entries — encoding, immediates, natural alignment, fixed stack signature, gating feature,
  class — each proved against binaryang's reader, writer and validator; `OPCODE_DEFINITIONS`,
  `opcodeKey()`, `opcodeDefinition()`. binaryang's own opcode name table is now built from it.
- **Behaviour — the validator gates five more features** (open-work 22): with `simd`,
  `signExtension`, `satFloatToInt`, `bulkMemory` or `referenceTypes` turned OFF, their instructions
  are now refused (`… not allowed: enable the <feature> feature`); they validated before. Only a
  caller that turns one of these default-on features off sees a change.
- **Silent fix — `i64.add128` / `i64.sub128` accepted a wrong-typed FIRST operand** (open-work 22):
  the type checker checked three of the four and dropped the first unchecked.
- **Behaviour — `delegate`, `catch_all` and `try_table` have names** where printing an opcode showed
  `<opcode:0x1f>` (diagnostics, `wasm-objdump`).

- **Silent fix — the tree walkers visit a branch's values before its condition** (open-work 1):
  `mapExpression`, `walkExpression`, `visitChildren`, `mapChildrenShallow` and `mapWithSequences`
  took a `br_if` / `br_table`'s condition first, the reverse of wasm. For a tree built by the
  builder API or a pass with a payload-carrying `throw` among a branch's values, StripEH ran the
  condition before the trap. A module read from text or binary never has that shape; no optimizer
  output moves (0 of 13,285 measured).
- **Behaviour — `CoalesceLocals` coalesces copies** (open-work 2, step 1), as upstream's: a copy
  (`local.set x (local.get y)`) no longer makes x and y interfere, a variable may share a
  parameter's slot, and a copy onto itself is removed. Optimized output moves at `-O2` and above:
  the corpus is −4,675 bytes at -O2, −22,699 at -O3, −6,171 at -Os / -Oz; behaviour unchanged (the
  spec and corpus behaviour gates).
- **NEW / Behaviour — `RemoveUnusedTypes`** (open-work 6; 2, step 2), last at every `-O` level:
  types nothing refers to are removed and every reference renumbered, as upstream's writer leaves
  them out. The corpus is −10.3 KB at -O1 / -O2 / -Os / -Oz, −12.5 KB at -O3. A plain read and write
  keeps the type section as it was.
- **Silent fix — `OptimizeInstructions` folded `i64.extend8_s` / `i64.extend16_s` of a constant
  wrong above 2^53** (open-work 2, step 3a): the fold went through a JS number, which rounds away
  the low bits it extends. Valid output, wrong value; only a module holding such a constant operand,
  at `-O2` and above.
- **Behaviour — `OptimizeInstructions` covers more** (open-work 2, step 3a): a store's conversion or
  mask folded into the store, an extend of a load into the extending load, `if (eqz c)` arms
  swapped, `eqz(eqz x)` in a condition, the constants of an add / sub tree gathered into one. Corpus
  −9.8 KB at -O2 / -Os / -Oz, −26.5 KB at -O3; behaviour unchanged (the spec and corpus behaviour
  gates).
- **Behaviour — `SimplifyLocals` sinks a set into the get that reads it** (open-work 2, step 3b),
  along straight-line code, past whatever its effects may pass; the only read becomes the value
  itself, otherwise a `local.tee`. It merged only an adjacent set and get before. Corpus −14.2 KB at
  -O2 / -Os / -Oz, −20.7 KB at -O3; behaviour unchanged (the spec and corpus behaviour gates, the
  optimizer fuzzer). Internal: a shared effect analysis, `ir/effects.ts` (not a subpath).
- **Behaviour — `RemoveUnusedBrs` covers more** (open-work 2, step 3c): a `return` ending a function
  body becomes its value, a cheap `if` with a numeric result becomes a `select`, `if (c) br` becomes
  `br_if`. Corpus −2.1 KB at -O2 / -Os / -Oz, −3.0 KB at -O3; behaviour unchanged.
- **Behaviour — the default `-O` schedule re-runs passes** (open-work 2, step 4a): CoalesceLocals
  again after SimplifyLocals / LocalCSE at -O2 and above, and SimplifyLocals after Inlining at -O3.
  Corpus −2.9 KB at -O2 / -Os / -Oz, −8.3 KB at -O3.
- **NEW / Behaviour — `DeadArgumentElimination`** (open-work 2, step 4b), at -O2 and above before
  the function passes: a function reached only by direct calls loses a parameter nothing reads, or
  one every call passes the same constant. Corpus −5.3 KB at -O2 / -Os / -Oz, −7.6 KB at -O3. The
  pass name is accepted by `runPasses` / `wasm-opt` like the others.
- **Silent fix — Inlining caught an exception a tail call throws past a `try`** (open-work 2, step
  5): a `return_call` inside a `try` was inlined, so the callee's throw, which the tail call takes
  out of the frame, was caught there and the function returned normally. At `-O3` in 1.8.1 (the only
  level that inlined); spec legacy `try_catch.wast` / `try_delegate.wast`. A module combining
  exceptions and tail calls, optimized at -O3, may be affected.
- **Behaviour — Inlining at upstream's rules and schedule** (open-work 2, step 5): it now runs at
  `-O2`, `-Os` and `-Oz` too, after the function passes and followed by them again; a function with
  one caller is inlined at any size (was ≤ 10 nodes; `--pass-arg
  one-caller-inline-max-size@N`
  limits it); at `-O3` a function with several callers only when it has no calls AND no loops (it
  took either). Corpus −8.7 KB at -O2, −4.8 KB at -Os / -Oz, **−180.6 KB (−17%) at -O3**.
