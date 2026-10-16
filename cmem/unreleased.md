# Unreleased on `main` — what the next release note must say

**As of 2026-10-15: the last release is `v1.12.1`; on `main` since then, UNRELEASED: the code lens,
round 13, pass 1 (C1–C17, merged from `code-lens-13`), open-work 30's optimizer steps and the
shipped-crash fix, and the browser recipe (docs)** — § "Since 1.12.1" below (check it rather
than trust this line: `git log --oneline v1.12.1..main -- src/ main.ts jsr.json`). Its entries are
Behaviour and Silent fixes, none BREAKING and no new export; the version, and when, are the
owner's call. `jsr.json` reads 1.12.1; the version line arms a release,
so the next bump is the owner's decision, never a side effect of work.

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
Asyncify fix for TinyGo 0.43, the Bun toolchain) or **1.12.0** (the deprecated subpaths and type names removed) or **1.12.1** (Asyncify restores a paused call's operands). The public summary of
each is `CHANGELOG.md` § that version; the full notes as gathered, BREAKING items field by field:
`git show 769b4d3c0:cmem/unreleased.md` (to 1.7.0), this file at `7aa54e95c` (1.7.1 → 1.7.2), at
`fb5068e47` (1.8.0), at `99f2a5b16` (1.8.1), at `82113369e` (1.9.0), at `23b9f36fb` (1.10.0), at `fc021fe08` (1.11.0), at `604b33cf8` (1.12.0), and at `e03d38f33` (1.12.1).

## How to use this file

Add an entry when a change on `main` is one a release note must carry — say which kind:

- ⚠️ **BREAKING** — a removed or renamed export, a changed IR field, a changed default. Makes the
  release a MINOR, typed by hand ([publishing.md](publishing.md) § "`bump` has no minor mode").
- **Behaviour** — output bytes move, or an input is accepted / refused that was not.
- **Silent fix** — was wrong without saying so; say what a user may have shipped.
- **NEW** — an export, a pass, a CLI flag.

⚠️ **wasmtk pins binaryang EXACTLY** and wants each release to say which of their reported items it
contains ([handoffs.md](handoffs.md)).

## Since 1.12.1

- **Behaviour — optimizer output bytes move again** (2026-10-15, open-work 31, in progress;
  [optimizer.md](optimizer.md) § "Open-work 31"): jump threading and RemoveUnusedBrs after
  CodeFolding (`8a91144e0`); two plain memory accesses may change places in the effects analysis
  (`c083bcf97` — a trap's KIND is still never changed); DAE removes a parameter written before it
  is read, to a fixed point (`90d200ec5`); Local2Stack in the writer (`f69843225`). Every
  behaviour gate unchanged. Real compiler output -Oz +4.9% → +2.6% over upstream.
- **NEW (additive) — `Module.optimizeStack`** (`./ir`, optional) and **`WriteBinaryOptions.stackIR`**
  (`f69843225`): an optimizing run at -O3 / -Os / -Oz marks the module, and `writeWasm` then
  leaves a value on the stack instead of a local stored and read straight back. A plain read and
  write changes no byte (the baseline gate holds it).

- **Behaviour — optimizer output bytes move at -O2 and above** (2026-10-15, open-work 30, closed;
  [optimizer.md](optimizer.md) § "Open-work 30: the gaps on real compiler output"): four steps,
  `6958502cc` (OptimizeInstructions: masks a value already fits, `eqz` of an integer comparison,
  a local compared with itself), `a1b07e9f3` (CodeFolding: terminating tails), `a676e31a9`
  (RemoveUnusedModuleElements: a slot of a table only this module sees that no `call_indirect` of
  its signature reaches keeps its slot, not its body), `49c730b76` (**NEW pass**
  `MergeSimilarFunctions`, in the -Oz schedule). Every behaviour gate unchanged. Real compiler
  output -Oz 10.4% → 4.9% over upstream; the corpus 1.86% → 1.60%.
- ⚠️ **Fixed — the optimizer could THROW** (`4a19c39a2`; shipped 1.11.0 – 1.12.1, reproduced on
  the pre-item-30 tree): CodeFolding's structural key wrote a `catch` clause as plain JSON, so a
  legacy `try` ending both arms of an `if` with an `i64.const` in a catch body failed at -O2+ with
  "cannot serialize a BigInt". Loud, never wrong output.

- **Docs — the browser recipe** (2026-10-15, open-work 28.7, the item's close): README § "Optimizing
  in the browser" and `examples/browser-optimize/` (repo only; not in the package), run by
  `bun run browsers` in every browser; the README's footnote that a browser run was "planned" is
  corrected (CI has run one since 2026-10-13). No code in the package changes.

The 1.12.1 notes as gathered are `git show e03d38f33:cmem/unreleased.md`; the public summary is
`CHANGELOG.md` § 1.12.1.

**The code lens, round 13, pass 1** (branch `code-lens-13`, built 2026-10-09 on the 1.10.0-era
tree, MERGED 2026-10-15 — [hardening.md](hardening.md) § "Code lens, pass 1"; the letter is
[handoffs.md](handoffs.md) § 35). Its entries, as gathered then; § 35 was § 28 on the branch,
renumbered at the merge because `main` had used 28–34 for the Asyncify letters:

- ⚠️ **Silent fix — `wasmValidate`'s `result` said `Ok` for an invalid module** (2026-10-09,
  open-work 13, the code lens, [hardening.md](hardening.md) § "Code lens, pass 1"): a check that
  REPORTS without failing — a block type naming a type that is not a function type — left the
  error in `errors` and the result `Ok`; `wasm-validate` printed the error, then "OK", and exited
  **0**. Now `Error` whenever an error-level diagnostic was reported. What a user may have shipped:
  a module V8 refuses, passed by a script that read `result` or the exit status. wasmtk uses
  `wasmValidate` as an ORACLE ([handoffs.md](handoffs.md) § 35): tell them, with how to tell
  whether it touched them (they read `errors` → unaffected).
- **Silent fix — the optimizer made a valid module invalid** (same day, same section): values left
  on the stack before an `unreachable` (valid; the `unreachable` discards them) stood as bare
  statements, and `Inlining` wrapped the code after them in a block → "type mismatch at end of
  end"; a consumer the reader gave a discarded value as an OPERAND (`(i64.add (i32.shl …) (…
  (unreachable)))`) looked live, and `OptimizeInstructions` rewrote it into reachable, invalid
  code. Found only in VALID MUTANTS of producer binaries — no corpus module has the shape. Output
  bytes move only for modules with such dead code; a no-pass read-and-write is byte-exact.
  Measured: wasmtk's 406 producer modules at `-O2` / `-Oz`, 812 outputs byte-identical before and
  after (on `505cf26b4`). A third, ON MAIN BEFORE TOO: the phantom collapse ended a void function
  with a value (`select` over unreachable operands); a valid mutant of `spec/unreached-valid`.
- ⚠️ **Behaviour — the reader refuses malformed heap types it accepted** (2026-10-09, code lens,
  spec mutants against V8): a heap type byte that is not one (`0x7f`); a multi-byte negative heap
  type, also MIS-DECODED before (`(-v) & 0x7f` — a padded `func` read as 0x10, -112 as `func`).
  `wasm-validate` passed both. And a SIMD / atomic sub-opcode ≥ 0x10000, which aliased a real one
  (`(prefix << 16) | op`) and made the validator THROW, is reported as unknown. (The branch also
  refused an unknown SIMD sub-opcode below 0x10000; 1.11.0 shipped that from `main` through
  `isInstrCode`, so the merge kept `main`'s check and dropped the branch's duplicate.) Verdicts on
  the 6,735 original spec + proposal modules are unchanged (same list against V8, before and
  after). Letter § 35 says so.
- **Silent fix — `wasm-interp` defaulted a v128 to `ref.null`** (argument, and a stand-in import's
  result) and stopped valid modules as `invalid`. Now a v128 zero. And it defaulted a
  NON-NULLABLE reference to `ref.null` (results no valid run has): such an export now STOPS.
- ⚠️ **Behaviour — the validator refuses five more invalid / malformed constructs** (`40ef4d615`,
  same method, the re-run): data / element segment flags with an undefined bit; `br_on_cast`
  flags past 3; `br_on_null` / `br_on_non_null` of a non-reference; `br_on_cast(_fail)` of an
  operand not of its source type; `ref.null` of a type index past the section. Verdicts on the
  6,735 original spec + proposal modules unchanged. Letter § 35 says so.
- **Behaviour (hardening, found by the code lens) — a huge count in a tiny malformed module no
  longer keeps the reader busy** (`28f840503`): nine count-driven reading loops ran past the end,
  10–14 s per validation for a one-byte change, hours for 2^32-1; they stop at the first failed
  read, and a local-declaration count larger than the body is refused at once (V8's wording).
  Same verdicts, only fast. Say so in the note: a caller validating untrusted input could be
  held for seconds or hours by a few bytes.
- ⚠️ **Behaviour — two refusals where upstream wabt ACCEPTS** (`ba588040d`, owner: "refuse … if it
  will not run on all platforms"): a typed `select` with no types, and an imported global / table
  whose value type names a type that does not exist. wasm-tools, wasmtime, wasmer, WasmEdge, V8 and
  JavaScriptCore all refuse both ([divergences.md](divergences.md) V1, V2). The `select` form still
  reads and writes back byte for byte (it was written back as `0x1b` before — a byte change for
  that input). Letter § 35 should say so (upstream-wabt users see us stricter).
