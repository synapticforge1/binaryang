# Unreleased on `main` — what the next release note must say

**As of 2026-10-23 (UTC): the last release is `v1.15.0`, on JSR and npm, both with provenance;
nothing user-visible is unreleased on `main`** (check it rather than trust this line: `git log
--oneline v1.15.0..main -- src/ main.ts jsr.json README.md`). `jsr.json` reads 1.15.0; the
version line arms a release, so the next bump is the owner's decision, never a side effect of
work.

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
first at -O3 / -Os / -Oz; the note that the history was rewritten, letter H19). The public summary of each is
`CHANGELOG.md` § that version; the full notes as gathered, BREAKING items field by field:
`git show 3bd64ece7:cmem/unreleased.md` (to 1.7.0), this file at `706dac230` (1.7.1 → 1.7.2), at
`575edc0fb` (1.8.0), at `a547a9533` (1.8.1), at `b536bc2be` (1.9.0), at `48586b485` (1.10.0), at
`fd5e96acf` (1.11.0), at `a86765385` (1.12.0), at `a8c264620` (1.12.1), at `65b16f99e`
(1.13.0), at `710592f53` (1.13.1), at `ee59fad76` (1.13.2), at `225f76a8a` (1.13.3), and at
`7ebcee3ad` (1.14.0), and at `ae9e87162` (1.15.0).

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

## Since 1.15.0

- **NEW pass — `WideArithmeticLowering`** (`--wide-arithmetic-lowering`; open-work 34, owner
  decision 2): the four wide-arithmetic instructions → `i64` arithmetic through one helper per
  instruction used. Opt-in; no default pipeline includes it; no other output moves. The gate's
  floor: MINOR ("pass WideArithmeticLowering added"). [portability.md](portability.md) § "The
  wide-arithmetic lowering".
- **NEW pass — `RelaxedSimdLowering`** (`--relaxed-simd-lowering`; open-work 34, owner decision 2,
  and the spec's deterministic profile as the semantics, owner 2026-10-23): the 20 relaxed-SIMD
  instructions → plain SIMD-128 with the profile's result; one helper for the dot products. Opt-in;
  no default pipeline includes it; no other output moves. The gate's floor: MINOR. README §
  "Making a module run without relaxed SIMD". [portability.md](portability.md) § "The relaxed-SIMD
  lowering".
- **README correction**: multi-memory runs on Bun's JavaScriptCore but ships in Safari only as
  Technology Preview (MDN browser-compat-data 8.1.7).

- **README — a Breaking Changes table** (2026-10-23, workspace letter H6, rule 4): the three past
  breaks (1.6.0, 1.7.0, 1.12.0) with their migrations. The README ships in both packages. Repo
  only, not shipped: the compatibility gate itself (`api-surface.json`, the bump's floor, the tag
  check, the previous-release tests) — [publishing.md](publishing.md) § "The compatibility gate".

- **Licensing — Binaryen attribution** (2026-10-23, [licensing.md](licensing.md) § "CORRECTED"):
  `NOTICE.md` attributes both upstreams; 30 files carry a `Ported from` / `Based on
  WebAssembly/binaryen` header — then, by the owner's "full attribution", 29 more (Binaryen by
  lineage or same-named component, and wabt's command-line tools): 86 of 119 `src/` files. Comments and the NOTICE only — no code, no output change. The
  published packages change (the NOTICE, and the headers in the shipped sources), so the next
  release note says it. `CHANGELOG.md` § Unreleased.
