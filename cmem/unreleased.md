# Unreleased on `main` — what the next release note must say

**As of 2026-10-28 (UTC): the last release is `v2.2.2`, on JSR and npm, both with provenance;
code lens passes 2 and 3, and open-work 50 and 52, are unreleased on `main` — at least a MINOR**
(below; check it rather than trust this line:
`git log --oneline v2.2.2..main -- src/ main.ts jsr.json README.md`). `jsr.json` reads 2.2.2; the
version line arms a release, so the next bump is the owner's decision, never a side effect of work.

**Unreleased — open-work 50 and 52, fixed** (2026-10-28, owner: "fix the 52 and 50 items"). The
surface gate says **at least a MINOR**: new CLI options and library options and exports. Several
lines change what a script or a consumer sees, so the note should say so plainly:

- **Behaviour (CLI output) — upstream's forms:**
  - `wasm-validate` prints nothing on success, and no `INVALID` line after errors: scripts must
    read the exit code.
  - `wasm-interp` prints integers unsigned (`i32:4294967295`). `--run-all-exports` runs only the
    exports that take no arguments. An import nothing supplies is refused before anything runs
    ("error initializing module: invalid import …", exit 1).
  - `--generate-names` uses upstream wabt's names: `$env.imp`, export names, `$p0` / `$l2`,
    labels `$B` / `$L` / `$I` / `$T`.
  - `wasm-opt <pass> -S` keeps the names.
  - `wasm-objdump` counts the type section in rec groups.
- **Behaviour (refuses more):**
  - `wasm2wat` VALIDATES by default with upstream's default features. It takes the feature
    flags and `--no-check`; an invalid module, or a feature outside the defaults without its
    flag, is now refused where it printed.
  - A raw control character inside a WAT string is refused (the spec's rule).
  - A segment with no offset is refused by the parser.
  - A branch hint must point at a real `if` / `br_if`.
  - A library-built tag with no type index is refused.
- **Behaviour (library):**
  - The binaryen facade's type IDs, Features bits, a new module's features (MVP) and the default
    shrink level (1) are binaryen.js 132's. Code comparing NUMBERS sees new values; every
    change is in the ID register.
  - `getFunction` returns imports, and `getFeatures()` exists.
  - The wabt facade gains `validate()` and `toBinary().log`. Its `parseWat` feature bag GATES:
    a partial bag means upstream's defaults plus those keys. wasmtk's `wasmbundle.ts:370` passes
    `{ exceptions: true }`.
  - `wasm2wat()` takes `validate` / `features`, and `Export` gains `loc`.
- **Silent fix:**
  - `wasm-opt` judges its output with our validator: a valid memory64 module optimizes on Bun.
  - MergeLocals, SSANoMerge and StackIR no longer hide a failure.
  - A 2^63 alignment prints exactly.

**Unreleased — code lens pass 3** (open-work 53, [hardening.md](hardening.md) § "Code lens, pass
3"). Two of these change what OPTIMIZED code computes, so the release note should lead with them:

- **Silent fix — `-O2` / `-Oz` / `--inlining` (and `-O3` for two forms) inlined a callee's tail
  call so that it returned from the CALLER**, skipping the rest of the caller; a void one could
  write an invalid module. **What a user may have shipped:** an optimized module whose code
  after a call to a tail-calling function never ran — re-optimize it. (P3.4)
- **Silent fix — SimplifyLocals moved a local write past a call that may throw inside a `try`**,
  so the catch saw the old value (`--simplify-locals`, `-O2`, `-O3`, `-Oz`). **What a user may
  have shipped:** an optimized module with exception handling whose handler read a stale local —
  re-optimize it. (P3.5)
- **Silent fix — `wat2wasm` wrote the wrong value for an integer-spelled `f32.const` of more than
  53 bits** (`f32.const 18014399583223809`), and refused one just below FLT_MAX's rounding
  midpoint. Rounded once now; a hex integer near a midpoint is rounded to nearest, where upstream
  wabt and wasm-tools truncate (divergence F4). (P3.1)
- **Behaviour (accepts more):** a `memory.copy` between a 64- and a 32-bit memory (P3.2); `-O2`
  and up on a callee that branches to its own frame, which they refused (P3.6); a table's linear
  initializer, `(table 1 funcref ref.null func)` (P3.12).
- **Behaviour (output):** `wasm-ctor-eval` no longer writes invalid modules (a null in a
  non-nullable local; renumbered data segments) and removes an empty constructor's export (P3.7);
  `./api`'s `if` / `block` are typed from their contents, so a value-producing one is valid
  (P3.9); binaryen facade `align` 0 is natural alignment (P3.3); wabt facade
  `toText({ foldExprs: false })` is linear, and an explicit `foldExprs: true` now forces folding
  where it printed each function as written (P3.11); an empty `(rec)` group is kept, in text and
  in bytes, where it was dropped — the type section's group count changes for such a module
  (P3.13).
- **Behaviour (refuses more):** `wasm-interp --argument` and `--fuel` (and `wasm-ctor-eval
  --fuel`) refuse what they cannot read — they guessed (P3.8); the typed form `f32:8` is taken.
- **Diagnostics:** an unknown local is `undefined local variable "$x"`, as upstream (P3.10).

**Unreleased — code lens pass 2** (open-work 49, [hardening.md](hardening.md) § "Code lens, pass
2"). The compatibility floor decides the bump; all five read as patch-level fixes, but CL2 makes
a command line that used to run now exit 1:

- **Behaviour (refuses more) — an unknown CLI option is an error** in `wasm-strip`, `wasm2wat`
  and `wasm-objdump` (CL2): each SKIPPED it before. The dangerous case: `wasm-strip in.wasm
  --output=out.wasm`, upstream's spelling, stripped `in.wasm` IN PLACE and never wrote
  `out.wasm`. Now `--output=FILE` works in `wat2wasm`, `wasm2wat` and `wasm-strip`,
  `--section=NAME` in `wasm-strip`, and `-o` / `-s` with no value is refused. **For a script:** a
  flag these tools never had (`wasm2wat --disable-simd`, `wasm-objdump -x`) now exits 1 instead
  of being ignored — divergence CL14 for `wasm2wat`'s missing feature flags.
- **Behaviour (refuses more) + Silent fix — a `struct.new_desc` descriptor in a constant
  expression must be constant** (CL1): only the fields were checked. No valid module changes.
- **Behaviour (refuses more) — the writer refuses a memarg alignment exponent ≥ 64** (CL4), which
  the binary's flags field cannot hold; it was written anyway, as bytes that do not say it.
- **Behaviour (output) — `wasm-interp` prints a float result with its sign and NaN payload**
  (CL5): `-0` was printed `0`, and every NaN alike; now `-0` and `nan:0x<payload>` (`-` when the
  sign bit is set).
- **Behaviour (diagnostics only) — SIMD lane, load-lane, store-lane and shuffle mismatches name
  the instruction** (CL3), in upstream wabt's words.
- **No behaviour:** comments corrected in eleven files; dead internal code removed (nothing on
  the published surface; `api-surface.json` unchanged).

**Shipped in 2.2.2** (kept here until the next release; CHANGELOG § 2.2.2 is the public note):

- **Behaviour (refuses more) + Silent fix — the validator checks a legacy `delegate`.**
  `wasm-validate`, `wasmValidate` and `wat2wasm` (which validates by default) accepted a
  `delegate` naming a label that does not exist (`(func (try (do) (delegate 1)))`), and checked
  NOTHING after a `try … delegate`: `(func (result i32) (try (do) (delegate 0)))`, a function
  ending with an empty stack, validated. Both are refused now, the first in upstream wabt's words
  (`invalid depth: 2 (max 1)`); upstream wabt, wasm-tools and V8 refuse both. **What a user may
  have shipped:** a module with legacy exception handling that binaryang called valid and an
  engine refuses — re-validate it. Modules that were valid stay valid. Shipped as a PATCH (owner:
  "release the delegate fix as 2.2.2"; the compatibility floor said patch). Reported by
  wasmtk (C12). `wasm-bundle`'s doc also gains the address-0 caveat (no behaviour change).
- **Behaviour (diagnostics only) — validation errors read as upstream wabt's** (open-work 48,
  divergence DG7, 2026-10-28). Every type-mismatch message now uses upstream's words: `type
  mismatch in implicit return, expected [i32] but got []` where binaryang said `type mismatch in
  function, expected 1 elements on the stack but got 0`; `type mismatch at end of block, expected
  [] but got [i32, i32]` where it said `type mismatch at end of end`; `type mismatch in drop,
  expected [any] but got []`; a one-armed `if` with a result is reported once, as `` type mismatch
  in `if false` branch ``, not twice. A function-end error points at the body's last
  instruction. No module changes verdict. **For a consumer that matches message TEXT:** the old
  wordings are gone; every message still starts `type mismatch` (D3, `./definitions`' verdict
  data, holds trap messages only and is untouched).
- **Docs — the README's JSR install note for npm 12** (C21, 2026-10-28): npm 12.2.0, bundled with
  Node 24.21, refuses the alias `npx jsr add` installs; the README now says so and gives the
  `.npmrc` line (`allow-remote=all`) that lets it through, or the npm package instead. Measured.

**Repo-only since 2.2.0 (nothing in either package; no release-note line):** the benchmark
modules rebuilt with no machine path (open-work 44, the optimizer's six baseline moved —
[optimizer.md](optimizer.md) § "State 2026-10-26"); the upstream reference clones moved into the
repo's gitignored `upstream/` ([project.md](project.md) § "The predecessors' local checkouts");
the second history purge (open-work 46, [publishing.md](publishing.md) § "The second purge");
no installed Deno needed to develop or release (open-work 51, [bun-migration.md](bun-migration.md)
§ "B8", 2026-10-28: Deno from npm, `bun x deno@2.9.6`).

**Folded away** under the cleanup policy ([INDEX.md](INDEX.md)): every entry this file held since
1.5.4 shipped — in **1.6.0** (One front end, `./binary` and `./encoder` removed, the IR record
changes, the post-M8 and Q1–Q8 fixes, S7), **1.6.1** (the CLI from JSR), **1.7.0** (`./interop`
removed, wasmtk's items 1–5 with custom descriptors, `--converge`, the minify passes, Flatten
complete), **1.7.1** (u64 limits and the 1-byte-page cap), **1.7.2** (`wasm2wat` text as upstream /
wasm-tools: N10, W18, M2a; `array.new_default` defaultability) or **1.8.0** (diagnostics DG1–DG6,
the `wat2wasm` CLI validating by default, the reader stopping at its first error, Q10–Q13,
`LowerCustomPageSizes` with its `#pagesize=` exports, `wasm-opt` validating its input) or **1.8.1**
(wasmtk's § 20: L3 trap kind, L4 placeholder, C7 `getFunctionInfo` shape) or **1.9.0** (the
interpreter and its tools, `./definitions`, the optimizer within 2%) or **1.10.0** (`wasm-bundle`,
`(@reloc data)`, the `.wit` beside the bundle) or **1.11.0** (`./ir`, browser-loadable exports,
the enums as const objects, `Opcode` as the 582 instructions, the reserved-SIMD reader fix, the
Asyncify fix for TinyGo 0.43, the Bun toolchain) or **1.12.0** (the deprecated subpaths and type
names removed) or **1.12.1** (Asyncify restores a paused call's operands) or **1.13.0** (the code
lens C1–C17 — `wasmValidate`'s `result`, the reader's malformed heap types and runaway counts,
five more refusals, two where upstream wabt accepts; open-work 30 and 31 steps 1–15, the
optimizer within 0.7% of upstream -Oz on real compiler output and below it at -O2; the passes
`MergeLocals`, `PrecomputePropagate`, `MergeSimilarFunctions`; `Module.optimizeStack`; the
CodeFolding crash shipped 1.11.0 – 1.12.1; the browser recipe) or **1.13.1** (the repository moved
to `synapticforge1/binaryang`; docs only) or **1.13.2** (the README for both registries; on JSR
without provenance, its publish failed after the upload) or **1.13.3** (1.13.2 again, with
provenance on JSR and, the first workflow publish there, on npm) or **1.14.0** (`Memory64Lowering`
with table64 in the same pass, sound above 2^32 where upstream's wraps; the README's "Making a
module run on Safari and Bun"; the multi-memory limit corrected to 100) or **1.15.0** (`SSANoMerge`
first at -O3 / -Os / -Oz; the note that the history was rewritten, letter H19) or **1.16.0**
(`wasm-opt --target portable` and D4; `WideArithmeticLowering`, `RelaxedSimdLowering`; the README's
Breaking Changes table and Safari corrections; Binaryen attribution; the compatibility gate's
first release) or **1.16.1** (no package change: the release tooling checked on a real bump) or
**1.17.0** (every command's `--help`; `--memcpy-to-bulk-memory`; `saturating-float-to-int`, the old
spelling deprecated, D2 1.1.0; multi-value off enforced; the relaxed-SIMD cost in the README) or
**2.0.0** (BREAKING: `sat-float-to-int` removed with `cliAliases`, D2 2.0.0; the interpreter runs
shared memory and atomics) or **2.1.0** (every module with a function table valid under the
default features; `return_call_ref` under function references, D1 1.0.1; two validator feature
checks; D2 `requires` and `presets`, 2.1.0; tail calls portable, D4 1.1.0) or **2.2.0** (the
reference-type rule as wasm-tools has it; four validator gaps; D2 `typeRules` / `encodingRules`,
2.2.0) or **2.2.1** (`wasm-strip` copies the sections it keeps, as upstream; a partial strip of
a relocatable or DWARF module had left stale offsets). The public summary of each is
`CHANGELOG.md` § that version; the full notes as gathered, BREAKING items field by field:
`git show 3bd64ece7:cmem/unreleased.md` (to 1.7.0), this file at `706dac230` (1.7.1 → 1.7.2), at
`575edc0fb` (1.8.0), at `a547a9533` (1.8.1), at `b536bc2be` (1.9.0), at `48586b485` (1.10.0), at
`fd5e96acf` (1.11.0), at `a86765385` (1.12.0), at `926d3e4e3` (1.12.1), at `9d065cf17`
(1.13.0), at `09e0c7d9d` (1.13.1), at `b86b1b66a` (1.13.2), at `5d812889a` (1.13.3), and at
`99c60dee0` (1.14.0), at `bc97aa573` (1.15.0), at `d81463f32` (1.16.0), at `e19525bb0`
(1.17.0), at `0ee193d95` (2.0.0), at `e3af69711` (2.1.0), at `7e1e272e8` (2.2.0), and at `59ba8fde2` (2.2.1).

## How to use this file

Add an entry when a change on `main` is one a release note must carry — say which kind:

- ⚠️ **BREAKING** — a removed or renamed export, a changed IR field, a changed default. Under the
  workspace's SemVer rule a break is a MAJOR; the level is the OWNER's call (1.12.0 removed the
  deprecated subpaths as a minor, the owner's choice). `bun run bump minor` / `major` set it
  ([publishing.md](publishing.md) § "Version rule — sub-version capped at 9", now retired).
- **Behaviour** — output bytes move, or an input is accepted / refused that was not.
- **Silent fix** — was wrong without saying so; say what a user may have shipped.
- **NEW** — an export, a pass, a CLI flag.

⚠️ **wasmtk pins binaryang EXACTLY** and wants each release to say which of their reported items it
contains ([handoffs.md](handoffs.md)).

## Since 2.2.0

Nothing yet.
