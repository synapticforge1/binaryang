# Unreleased on `main` — what the next release note must say

**As of 2026-11-09 (UTC): the last release is `v3.0.1`, on JSR only** (Rekor `3770874199`),
after 3.0.0, also JSR only: npm got neither ([publishing.md](publishing.md) § "3.0.0",
§ "3.0.1"). Owner: "Release 3.0.2, tarball path" — the next release is **3.0.2**, a PATCH, so
npm gets the 3.x line. (Check: `git log --oneline v3.0.1..main -- src/ main.ts jsr.json README.md`.)

**Unreleased — 3.0.2** (no package change; the same code as 3.0.0 and 3.0.1):

- **For npm users:** 3.0.2 is the first 3.x on npm; npm has no 3.0.0 or 3.0.1. Its notes are
  3.0.0's (CHANGELOG § 3.0.0) — the breaks included, for anyone coming from npm's 2.2.2.
- **Repo-only:** `registry.ts npm-tarball` hands `npm publish` an ABSOLUTE path (npm read
  `npm-pack/x.tgz` as a GitHub shorthand); a test holds it. Since 3.0.0 also: `npm-build`
  creates the `npm pack` destination; `previous-tests.ts` runs the old tests in a git work tree;
  `publish.ts` prints the five jobs.

**Shipped in 3.0.1** (JSR only): nothing new in the package — 3.0.0 again, for npm, which it did
not reach. CHANGELOG § 3.0.1.

**Shipped in 3.0.0** (JSR only; CHANGELOG § 3.0.0 is the public note): the binaryen facade's
binaryen.js 132 numbers, `i64.const` refusing `(low, high)`, `wasm-objdump -d` refused, Bun 1.4.4
the minimum, `wasm2wat` validating, unknown options refused, the `parseWat` feature bag; the two
optimizer fixes (tail-call inlining, SimplifyLocals in a `try`) and the integer-spelled
`f32.const`; upstream wabt's output in `wasm-validate`, `wasm-objdump -x`, `wasm-interp`,
`--generate-names`; code lens passes 2 and 3, open-work 50 and 52, CL7. The full notes as
gathered: `git show 1222e78d5:cmem/unreleased.md`.

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
a relocatable or DWARF module had left stale offsets) or **2.2.2** (the legacy `delegate`
checked; type-mismatch messages as upstream wabt's; the npm 12 install note) or **3.0.0** and **3.0.1**
(above, until 3.0.2 ships). The public summary of each is
`CHANGELOG.md` § that version; the full notes as gathered, BREAKING items field by field:
`git show 3bd64ece7:cmem/unreleased.md` (to 1.7.0), this file at `706dac230` (1.7.1 → 1.7.2), at
`575edc0fb` (1.8.0), at `a547a9533` (1.8.1), at `b536bc2be` (1.9.0), at `48586b485` (1.10.0), at
`fd5e96acf` (1.11.0), at `a86765385` (1.12.0), at `926d3e4e3` (1.12.1), at `9d065cf17`
(1.13.0), at `09e0c7d9d` (1.13.1), at `b86b1b66a` (1.13.2), at `5d812889a` (1.13.3), and at
`99c60dee0` (1.14.0), at `bc97aa573` (1.15.0), at `d81463f32` (1.16.0), at `e19525bb0`
(1.17.0), at `0ee193d95` (2.0.0), at `e3af69711` (2.1.0), at `7e1e272e8` (2.2.0), at `59ba8fde2` (2.2.1),
at `88a0e7c6f` (2.2.2), and at `1222e78d5` (3.0.0).

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

## Since 3.0.0

The 3.0.1 entry above.
