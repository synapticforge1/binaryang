# Testing

Merged topic file (§2.2). Supersedes `binaryen-ts/testing.md` and `wabt-ts/testing.md` as the
statement of how binaryang is tested. The per-invariant detail — which regression test pins which
bug — is in [wabt-ts.md](wabt-ts.md) and [binaryen-ts.md](binaryen-ts.md).

Unblocked by §2.1: until `scripts/release/` existed this file would have described two release
gates.

Summary: how the suite runs, the test tree, the corpora, the behavioural harnesses, the release path and the CI gate. Last verified 2026-11-20.
Closed measurements and retired apparatus:
[archive/testing-to-4.1.1.md](archive/testing-to-4.1.1.md). Rules:
[testing-philosophy.md](testing-philosophy.md); oracles: [testing-oracles.md](testing-oracles.md);
spec harness: [testing-spec-harness.md](testing-spec-harness.md),
[testing-spec-interp.md](testing-spec-interp.md).

## Running

**Since Bun migration B5 (2026-10-13)** the suite runs on `node:test` ([bun-migration.md](bun-migration.md) § "B5"):

```sh
bun run test           # node --test on Node 24, the V8 referee: THE verdict (5,902 leaf tests, 2026-10-13)
bun run test:bun       # the same files on Bun; its failures must be exactly tests/bun-known-differences.json
bun run check          # `bun check` over src/, scripts/ and tests/ (four tsconfigs; tsc until 2026-10-15)
bun run check:tsc      # tsc 7.0.2 on the same four: the second opinion, not in CI
bun run browsers       # the library in REAL browsers (open-work 28.3): the installed ones here; CI requires all
```

In a test, a file or a temp dir is `tests/test_fs.ts` (`fsx.readTextFile`, `fsx.makeTempDir`, …; no
`Deno.*`), and the CLI as a child process is `tests/run_ts.ts` (`runTsAsync(main, [tool, …])`). Deno
runs `node:test` too, but deno.json and its `test` task are gone (B7); `bun run comparison` was the
last Deno-run suite, and runs on Node since 2026-10-28 (open-work 51, below).

The Deno-era commands, kept for the record:

```sh
deno task check        # type-check src/ + main.ts + tests/ + scripts/
deno task test         # the full suite — 1265 tests / 0 ignored (2026-09-19); 1043 (2026-09-12); was 912 tests / 3153 steps / 2 ignored (2026-08-27)
deno task fmt:check    # format
deno lint
deno task ci           # check + test
deno task publish:dry  # JSR manifest + slow-types, WITHOUT publishing
deno task baseline     # emitted-byte baseline — IDENTICAL, or exit 1 naming the files
deno task collisions   # convergence indicator (reported, never gated)
```

⚠️ **A count in prose goes stale silently.** The wabt-ts wing carried three successive test counts,
one of which went stale the same day it was written. Treat the number above as the date it carries;
`bun run test`'s own summary is the only current answer (`deno task test | tail -1` until B5).

**`publish:dry` belongs in the gate whenever a change ADDS or MOVES an exported symbol.** It is the
only step running JSR's slow-types check — moving one constant into another file made it public API
without an explicit type, and 339 passing tests plus three metric runs never saw it.

## Test tree

`tests/binaryen-ts/` · `tests/wabt-ts/` · `tests/ir/` · `tests/definitions/` (2026-10-13; `tests/bridge/`
went with the bridge), each mirroring its `src/` counterpart.

⚠️ **`bun run test` enumerates those directories by name** (`TEST_DIRS` in `scripts/test.ts`; the
`deno task test` task did the same until B5). A new top-level test directory will not run until it
is added there — `tests/bridge/` needed exactly that when the bridge moved, and the whole bridge
suite would have gone quiet without it.

**Finding IR nodes in a test: `tests/expr_walk.ts`** (2026-10-13). `allOf(root, kind)` /
`firstOf(root, kind)` walk the tree by STRUCTURE (not the IR's own visitor, so a test does not lean
on the code it checks) and return `ExprOf<K>`, the `W.Expr` member(s) whose `kind` includes `K` —
typed, so a test reading a field the node does not have fails `deno check`. Use it instead of a
local walker returning `any`; five such copies were folded into it ([bun-migration.md](bun-migration.md)
§ "The 22 suppressions, removed"). Not a test file, so no task lists it; `deno check` covers it.

### `noUncheckedIndexedAccess` is ON at the root, OFF in `tests/binaryen-ts/`

In `src/` an unchecked index that turns out to be `undefined` becomes wrong bytes in a `.wasm` —
this project's worst failure mode. In a test it becomes a failed assertion, which is the test
working. `tests/binaryen-ts/tsconfig.json` exists only to turn it back off (a `deno.json`
workspace member until B7).

⚠️ **Omitting the key does not reset it.** The child config inherits the root's `compilerOptions`
and merges its own over them, so an omitted override looks like it works right up until you check
the error count and find it unchanged. It must be written out as `false`.

The asymmetry is not repo-wide: `tests/wabt-ts/`, `tests/ir/` and `tests/definitions/` run under
the strict flag (`tests/tsconfig.json`), as does `scripts/release/`. Only the tree that would have needed ~420 `!` edits
opted out.

## Proving a refactor changed nothing: `deno task baseline`

`scripts/wabt-ts/pre-merge-baseline.tsv` records, per corpus file, the byte length and hash of
`wat2wasm` output and the hash of `wasm2wat` text — **421 files, 1,557,602 bytes**.

**It is deliberately not a test.** It pins emitted bytes, so a genuine encoder improvement is
_supposed_ to fail it. In the gate, the right answer would become "relax the assertion", which is
how a baseline stops meaning anything. **Re-baseline in the same commit as such a change, and say
why in the message.**

Verified in both directions, which is the standing rule for any check: `IDENTICAL` on an unchanged
tree, exit 1 naming the file when one byte-count or hash is altered.

## The corpora, and what each is for

- **corpus:** `upstream/binaryen/test`
  - what: binaryen's own suite, for parse→encode→parse
  - state: the reading-room clone, IN this repo since 2026-10-26 at `upstream/binaryen/`
    (gitignored; beside `upstream/wabt/`), pulled in from the frozen binaryen-ts checkout before it
    was deleted — the same commit, `version_132` + 38, with upstream's tags fetched (`version_133`
    available). The test FAILS when it is absent, saying how to get it (no skips, owner 2026-11-19;
    it skipped before); the 20 diagnostic scripts under `scripts/binaryen-ts/` and
    `comparison/scripts/` read the same path. 🔧 It had silently skipped from the merge until
    2026-09-12 — see "Independent oracles" below
- **corpus:** `tests/wabt-ts/wasmtk/`
  - what: 421 real-world WAT files from wasmtk
  - state: present; the runner picks up any file dropped in, and a reverse-direction runner asserts the disassembly re-compiles

### The wasmtk corpus is a SNAPSHOT, and that has cost real credibility

Stamped and gated — `provenance.test.ts` fails if the source commit, date or file count stops
matching. **It has still produced three wrong reports to the wasmtk team, all caught by them rather
than by us.**

**Rule: regenerate from the wasmtk checkout before validating against another runtime or stating
anything about wasic.** The snapshot supports _"our toolchain handles this shape"_. It does not
support _"wasic emits X"_ or _"wasic has bug Y"_ — we made exactly that claim about seven modules
already fixed upstream.

## The behavioural harnesses

**`tests/binaryen-ts/passes/optimize_fuzz.test.ts`** — every optimizer bug in the WT series was a
_behavioural_ miscompile: valid wasm, wrong value, which validity checks never catch. Seeded,
deterministic, CI-safe; bisects the pipeline to name the first offending pass.

⚠️ **Its reach is narrower than it looks.** Measured: zero `makeLoad`, zero `makeBreak`, no SIMD or
GC nodes — so it could not have constructed either defect from the duplicate-dispatcher sweep.
**Grep the harness for the node kinds it emits before assuming it covers a new construct.**

**`corpus_roundtrip.test.ts` holds one binary to byte identity instead of an engine verdict**
(`ENGINE_UNSTABLE`, `420a948aa`, 2026-09-18): V8 in Deno 2.9.7 has no stable verdict on binaryen's
`lit/control-flow-input.wast.wasm` (legacy + new EH mixed) — 39 of 40 `compile` / `validate` calls
rejected it, and two of three probe runs crashed Deno (`!job->compile_imports_.empty()`). If a Deno
upgrade fixes the engine the set can go; if another binary starts flaking, probe it the same way
before adding it.

**`scripts/binaryen-ts/equiv_check.ts`** — not a test, a script. Two stubbed instances driven by the
same call sequence stay bit-identical iff optimisation preserved semantics. Surfaced six miscompiles
a validity-only benchmark had called "valid".

## The release path is tested, and needs two tests

`scripts/release/publish.ts` **cannot be imported by a test** — it stages, tags and pushes at import
time. Its decisions therefore live in `scripts/release/release-guard.ts`.

**Both tests are needed.** `release_guard.test.ts` covers the LOGIC;
`publish_preflight_wiring.test.ts` covers the WIRING — that `publish.ts` imports and calls the
guard, that it exits rather than warns, that no mutating git subcommand runs before it, and that
`scripts/` stays in the gate. Deleting the guard block leaves all twelve logic tests passing, which
is exactly what the original defect was: **the logic was absent, not wrong.**

## CI gate

The step list is in [working-rules.md](working-rules.md) § "The gate", read from
`.github/workflows/ci.yml` — not repeated here, because a copy here is what went stale (drift
B1, 2026-09-20: this section listed `deno task test` while the rules required `deno task ci`).
Three jobs: **Gates** (format, lint, `bun run check`, `bun run test` and `test:bun`, the binding
rules, browser bundles, baseline, `publish:dry`, the npm proof), **Browsers** (the library in
every browser), and a CLI matrix on Deno, Node 22.18 (the floor), Node 22, 24 and 26, and Bun 1.4.4
(the floor, the latest installed Bun — workspace letter H31; 1.4.0 until 2026-11-09).

**Test files ARE type-checked** (`bun run check` covers `tests/` with its own two tsconfigs), and
that was once a real gap: `deno task test` ran `--no-check` and `check` once covered only `src/`, so test files were type-checked by no task at all. Closing it
surfaced seven latent type errors, one a genuinely wrong fixture that passed anyway because it
asserted a throw that fires regardless of its arguments. **When adding a task that validates
something, check what it actually walks.**

`scripts/` is in the gate too. Until it was added, the file that publishes immutable artifacts was
type-checked by nothing.

🛑 **And then a local gate dropped it again.** The S6 verification list was
`test · baseline · operators · spec · bridge` — no `check`, and `test` runs `--no-check`. So
`290faadcd` left two `scripts/` files uncompiled, and `main` stayed red by CI's standard for 65
unpushed commits. **Run the whole gate — today `bun run check` AND `bun run test` at least, never
the tests alone** (`deno task ci` was the Deno-era form), and see
[best-practices.md](best-practices.md) "The local gate must BE CI's gate".

## Where the per-invariant detail lives

- **[binaryen-ts.md](binaryen-ts.md) § `binaryen-ts/testing.md`** — the region matrix, the corpus
  round-trip design points, the fuzzer's hazard list, and regression-test placement per invariant.
- **[wabt-ts.md](wabt-ts.md) § `wabt-ts/testing.md`** — the conformance metrics (13 rows) with their
  blind-spot column, the hardening-axis table, the enumeration frontier, and the invariant → test
  placement table.

⚠️ **The conformance metric tables from the wabt-ts wing are a SNAPSHOT at campaign close, not a
current reading.** They were headed "now" until someone noticed — a header that silently becomes
false. The harnesses are the only current answer, and they live in a session scratchpad, not the
repo.

Moved sections (pointers):
- § "The `deno fmt --check` line-ending false alarm is RETIRED", § "Every test-file path in the wing
  full texts is DEAD", § "A3 — diagnostic offsets are MEASURED (2026-08-31)" (with § "What it
  found"), § "Diagnostic usefulness", § "The 1.5.5 passes": moved to
  [archive/testing-to-4.1.1.md](archive/testing-to-4.1.1.md).
- § "The convergent testing philosophy" and every rule under it ("Every metric is blind to
  something", "A harness must call the real entry point", "Print what a harness SKIPS", "Four tests
  that need neither a corpus nor an oracle", "Every test has an AXIS", "A fixture believed valid
  must be said to an engine", "A crashed run is not a green run", "Invert every gate before trusting
  it", "Three states, not two"): moved to [testing-philosophy.md](testing-philosophy.md).
- § "Independent oracles", § "Byte parity with upstream `wat2wasm`": moved to [testing-oracles.md](testing-oracles.md).
- § "The spec-testsuite harness", § "Behaviour — `assert_return` / `assert_trap`": moved to [testing-spec-harness.md](testing-spec-harness.md).
- § "The proposal testsuites", § "The interpreter against the MANIFESTS", § "The comparison suite": moved to [testing-spec-interp.md](testing-spec-interp.md).
