# Working rules — how an increment is done here

The owner's standing rules, held across the S6 run. Each was set or reaffirmed after a real slip.
Until 2026-09-14 they lived only in machine-local memory; they moved here because a rule that does
not survive a clone is not a project rule. The lessons behind them are in
[best-practices.md](best-practices.md); this file is the checklist.

## Git

- **Branch, commit, then `git merge --no-ff` to `main`.** Never commit directly to `main` — two
  docs-only commits did, and the owner had the history REWRITTEN so it would be uniform. Docs-only
  changes follow the same rule.
- **Messages go through a file**: `git commit -F <file>` and `git merge --no-ff -F <file>`. Write
  the file with a file-writing tool, never a heredoc or a double-quoted `-m` (see "Do not author
  file CONTENT through a shell heredoc" in [best-practices.md](best-practices.md), which lists all
  four ways a tool here corrupts literal text). ⚠️ `-F -` does not read stdin here.
- **End every message with the attribution line** the session supplies (`Co-Authored-By: …`).
- **Prefer a new commit over `--amend`.**
- **Nothing is pushed** unless the owner says so.
- **`deno.json` stays at the released version** (read it there, and the latest release in
  [publishing.md](publishing.md)'s current-state line — a number quoted here went stale for two
  weeks). The version line is what ARMS a release — `auto-tag` publishes whenever `v<version>` has
  no tag. See [publishing.md](publishing.md); the unreleased changes waiting for it are in
  [unreleased.md](unreleased.md).
- **A re-baseline goes in its OWN commit**:
  `deno run --allow-read --allow-write scripts/wabt-ts/verify-baseline.ts --write`, with the reason
  in the message.

## The gate — on the COMMITTED tree, reading every EXIT CODE

CI's steps first, read from `.github/workflows/ci.yml` rather than from memory of it:

`deno fmt --check` · `deno lint` · `deno task ci` · `deno task naming` · `deno task portability` ·
`deno task baseline` · `deno publish --dry-run --allow-dirty` — and the `runtimes` job's
`scripts/cli-smoke.ts`, run under each runtime it tests (locally:
`deno run -A scripts/cli-smoke.ts
"deno run -A"`, likewise `node --experimental-transform-types …`
and `bun …`; all must print the same hash)

then the project's own: `deno task operators` · `deno task spec <corpus>` ·
`deno task spec-behaviour <corpus>` · `deno task interp <corpus>` · `deno task direct` ·
`deno task direct-behaviour` · `deno task translate-eh <testsuite-main>/legacy <outDir>` ·
`deno task optimize-corpus` · `deno task proposals <testsuite-main> <outDir>` (since 2026-09-29:
`proposals/`, validity and behaviour, V8 experimental flags per `scripts/proposals.ts`; expect every
proposal to hold, custom-page-sizes judged on V8 through `LowerCustomPageSizes` — 31 assertions in 7
worlds, both unlinkables honoured, no pins — [testing.md](testing.md) § "The proposal testsuites").
(`direct` / `direct-behaviour` replaced `bridge` / `bridge-behaviour` when M8e deleted the bridge,
2026-09-18; this list named the old tasks until 2026-09-19.) Expect `direct` **544 / 544** and
`direct-behaviour` **1953 calls / 651 exports, 0 DIVERGE** — the 421 corpus modules plus
`prepare.test.ts`'s 123 (post-M8 fix 7).

- **`deno task spec-behaviour <corpus>` joined the gate 2026-09-28 (owner: "Yes").** It replays the
  spec testsuite's own invocations on the original and on every variant we make (round trip,
  -O1…-Oz, both routes); it is the one step that sees a VALID module computing the wrong thing, and
  found eight defects with every other step green (Q1–Q8). Same prepared corpus as `spec`. Expect
  **1,342 modules, 57,808 invocations (24,151 through v128 wrappers, 53 blind), 0 DIVERGE** — a
  rising `blind` count is a coverage loss worth reading — and NO refusals: `REFUSED_BUDGET` is empty
  since 1.6.0 (its 7 relaxed-SIMD pins were binaryen-ts's decoder's, deleted then, and the variants
  are the one route's round trip and -O1…-Oz). A module that starts being refused FAILS the step
  until it is fixed or pinned with why — that is the ratchet, not a regression.

- **`deno task interp <corpus>` joined the gate 2026-10-07 (owner: "yes on deno task interp").** The
  interpreter (open-work 23, E3) against the testsuite's `assert_return` / `assert_trap` /
  `assert_exhaustion`, the MANIFEST as the oracle. Same prepared corpus as `spec`. The verdict is
  **0 FAIL**; the `stopped` count (what the interpreter cannot run yet, by reason) should only FALL
  as E3's increments land — a rise is a coverage loss to read. At E3a: 15,432 pass, 42,144 stopped;
  at E3b: 25,811 pass, 31,819 stopped; at E3c: 32,618 pass, 25,012 stopped (15 s in the gate
  run, from 3 s at E3b — not yet attributed); at E3d-1: **32,687 pass, 24,961 stopped**.

- ⚠️ **A corpus hash says output CHANGED, not that it is VALID.** Two -O3 defects sat unseen
  (2026-09-14) because optimizer checks hashed the output. `deno task optimize-corpus` optimizes all
  421 modules at `-O1` … `-Oz` and fails on any throw or any module `WebAssembly.validate` rejects.

- ⚠️ **A gate that COMPILES is not a gate that RUNS.** `deno task bridge` read 421/421 for as long
  as the bridge silently dropped every element segment, because an empty table is a valid table.
  `deno task bridge-behaviour` runs both paths in lockstep on identical stubs and compares every
  call plus a memory hash; on the mutant that restores the drop it reports 39 DIVERGE while
  `deno task bridge` still reports 421/421. It calls corpus entry points, which is where the
  coverage is (419 exports) and also why it needs a worker it can kill — one module never returns.
  (Both are history since M8e: `deno task direct` / `direct-behaviour` carry the same pair — one
  compiles and validates, the other RUNS in lockstep — over the prepared tree.)

- ⚠️ **A gate is evidence about what it REACHES.** Not one corpus module has a `(start …)`, so when
  M8e's mutant dropped the start function both direct gates stayed green; only a unit test saw it.
  Since post-M8 fix 7 both also run `prepare.test.ts`'s fixture (`scripts/direct-inputs.ts`), and
  that mutant fails both (`direct`: 3 bytes short; `direct-behaviour`: `f()` 99 vs 0). Before
  trusting a gate for a feature, find an input in it that HAS the feature.

- ⚠️ **Run it after the LAST edit.** If an edit follows the gate, the gate has not run — decision 5
  merged with `deno lint` red that way.
- ⚠️ **Read every step's EXIT CODE.** The naming check is now an exit code too: its TypeScript port
  (2026-09-29) prints each offender AND exits 1. Its shell predecessor always exited 0 and made the
  output the verdict, and a rule that once read it the wrong way round ("prints a filename on
  SUCCESS, read `$?`") hid a real violation (`tests/binaryen-ts/wabt_reference.ts`, from `138148881`
  2026-09-11 until its rename 2026-09-18). The lesson stands for every step: read each exit code —
  `deno lint` was failing on `main` for two commits whose messages reported it green (`456423b54`,
  `cec3a3381`; fixed `fc91cf409`).
- ⚠️ **`deno task test` alone is not the gate** — it runs `--no-check`. `deno task ci` is check +
  test. Dropping `check` left `main` red by CI's standard for 65 unpushed commits (`80a45bffe`).
- **The spec corpus is per-session scratch.** A new session rebuilds it first:
  `deno task spec:prepare <testsuite-main> <outDir>` then `deno task spec <outDir>`, with `<outDir>`
  in the session scratchpad. Source, READ ONLY (a sibling repo):
  `wasmtk/tests/module/wasm_wast/testsuite-main`, absolute path in the private
  `cmem/local/environment.md`. Expect **2248/2248 · 2714/2714 · 711/711 · 1229/1229**; a different
  count means the prepare step, not a regression.
- **`deno task translate-eh`** splits the testsuite's `legacy/` itself (upstream `wast2json`, so it
  needs that installed) into `<outDir>`. Expect **6 modules, 70 / 70 in all three worlds** (legacy,
  translated, translated `-Oz`). It is not in CI: CI has neither the sibling testsuite nor
  `wast2json`.

## Tests, measurements and records

- **Invert every new test or gate** — break the thing on purpose and see it fail FOR THE RIGHT
  REASON. A mutant caught by a different check is a bad mutant; rewrite it.
- **For a change that makes a state UNREPRESENTABLE, the inversion is compile-time**
  (`@ts-expect-error`, checked by `deno task check`).
- **Blast radius of a rename or regrouping: trial it.** Make the change, count `deno check` errors,
  revert, do the other direction. Never grep. And for a new KIND the compiler flags only exhaustive
  switches — read every `default` it does not flag.
- **Every upstream difference gets a classified row** in [divergences.md](divergences.md) before the
  work that found it is called done. Read the rows before porting an upstream pass, "matching
  upstream", or claiming byte-identity.
- **A row's PREMISE is not evidence — re-derive it before acting.** A1 was filed as a probable
  DEFECT ("wasm-tools rejects it, so we are the odd one out"); reading the VENDORED upstream sources
  (`wabt-ts/upstream/src`, `binaryen-ts/upstream/src`, siblings of this repo) flipped it to DESIGN,
  and the real defect was adjacent to the row, not in it.
- **A recorded count is a claim.** Re-derive it, then make it RATCHET (`PHANTOM_BUDGET`,
  `ONE_SIDED_BUDGET` in `deno task operators`) so it cannot silently go stale.
- **A commit message is a claim.** Check a commit's effect with `git show <sha> -- <path>`, not its
  prose. `b8fafaa3f` said "pin npm:binaryen to 132" and its diff left `@*` at 116.0.0.
- **Decide by the worst condition.** For a representation choice, find the worst case on the
  fidelity side and on the optimization side and let the binding one control; when neither binds,
  say so and let cost decide. See [ir-convergence.md](ir-convergence.md) § "The grouping decision".
- **When work completes, summarize it in cmem — do not accumulate it.** A summary names what landed,
  its commits and tags, where the substance now lives, any lesson found nowhere else, and a
  `git show <commit>:<path>` pointer to the text it replaces. Decisions, DESIGN rows, open items and
  triggers are never summarized away. The full policy: [INDEX.md](INDEX.md) § "Cleanup policy".
  **Correct while summarizing, and check the result mechanically** (the wings, 2026-09-14):
  - Before cutting, snapshot the facts: hashes, backticked names, ratios, IDs.
  - Afterwards, prove that every ID cited by code or commits still resolves in cmem, and that every
    section citation matches a heading. Invert that check before trusting it.
  - Read by hand every removed line that marked something open.
  - A summary that repeats a stale claim is worse than the full text, because it looks current.
- **Retargeting a reference is part of removing a doc.** Code, tests and scripts cite cmem by path
  and by § heading. Grep `src/`, `tests/`, `scripts/` and the core for both forms before deleting or
  renaming a cmem file or heading, and update them in the same commit.
- **Nothing private in a committed cmem file** — no local path, account name, token or secret. That
  goes in the gitignored `cmem/local/`, or nowhere.
- **Owner calls stay owner calls.** Where a record says 🗓️ OWNER or "future discussion", gather the
  evidence and stop.

## Tools

- ⚠️ **Never run `deno fmt` on `cmem/`.** `deno.json`'s `fmt.include` leaves `cmem/` out, so the
  gate's `deno fmt --check` never looks at it — but naming a path explicitly overrides the include,
  and `deno fmt cmem/<file>` then REWRAPS the whole file and RENUMBERS its ordered lists. On
  2026-10-07 it turned open-work items 21 / 22 / 24 into 16 / 17 / 18 on `main` (16 and 17 are
  retired numbers) and rewrapped `open-work.md`, `unreleased.md` and `working-rules.md` across
  today's commits (checked: whitespace only apart from the numbers, which were restored by hand).
  Edit cmem by hand, keeping each line under 100 columns.

- **Use the best tool for the job, and check what is available before improvising.** Owner,
  2026-09-02: _"Definitely use the best tool for the job. Especially if you already have it
  available to you. We never want to use a hammer when a screw driver is needed."_ The `Grep` tool
  IS ripgrep; `Read` / `Edit` / `Write` return and match exact text. ⚠️ **This outranks a
  session-level instruction to prefer Bash** — "can accomplish the job" is not "is the right tool";
  when they conflict, follow this and say so. The cost of the substitute was concrete: `grep -A 9`
  truncated at a docstring and hid the `values` field, which is how `br` / `br_if` / `return` were
  wrongly reported "structurally unfoldable".
- **`Grep` over shell `grep`**: no shell escaping layer, `multiline: true` instead of guessing
  `-A N`, `glob:` / `type:` instead of `--include` plus `grep -v` chains. **`Read` over `cat` /
  `sed -n`** whenever the content will be matched against or edited.
- **Never build an exact-match string out of RENDERED output.** Copying indentation from
  `sed 's/^/  /'` into a match string failed about six edits in one session.
- **Throwaway scripts are Deno files in the session scratchpad**, written with a file-writing tool:
  `deno run --allow-read --allow-write script.ts`. There is no working `python` on the development
  machine (details in the private `cmem/local/environment.md`). `sed -i` is fine for one regex on
  one file.
- **After any scripted edit, read back the lines it changed**, and treat "0 replacements" as a
  failure, not a no-op.
- ⚠️ **`cmem/` is outside `deno fmt`'s `include`, and naming a file formats it anyway.** The gate's
  `deno fmt --check` never reads cmem, so nothing requires it to be formatted — and
  [wabt-ts.md](wabt-ts.md) / [binaryen-ts.md](binaryen-ts.md) use long lines by design. 2026-09-14:
  `deno fmt cmem/binaryen-ts.md` rewrapped 862 lines around a 10-line edit (restored before commit).
  Do not run `deno fmt` on a cmem file; check `git diff --stat` against the size of the edit.

### Installed oracles — do not re-ask

| tool                 | version | commands                                                                                                                             |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| upstream wabt        | 1.0.41  | `wat2wasm` · `wasm2wat` · `wasm-validate` · `wasm-interp` · `wast2json` (installed 2026-09-02)                                       |
| upstream binaryen    | 132     | `wasm-opt` · `wasm-as` · `wasm-dis` (installed 2026-09-02)                                                                           |
| wasm-tools           | 1.259.0 | `parse` · `print` · `validate` · `json-from-wast` (installed 2026-09-11) — reaches GC text, label and field names, which wabt cannot |
| `gh`                 | —       | ⬚ NOT installed                                                                                                                      |
| the wider wasmtk set | —       | `.../wasmtk/tests` — 532 `.wat`, 511 `.wasm`, 288 `.wast`                                                                            |

What each oracle can and cannot judge is in [testing.md](testing.md) § "Independent oracles".

## Sibling repositories

All four repos — `binaryang`, the archived `binaryen-ts` and `wabt-ts`, and `wasmtk` — are siblings
in one parent directory (its absolute path is in the private `cmem/local/environment.md`).

- **Nothing is ever written into a sibling repo from this one.** Draft the note in
  [handoffs.md](handoffs.md) and hand it over; fixes land in the repo that owns the file. During a
  merge the habit of respecting repo boundaries is the first thing to erode.
- **Verify a sibling from a scratch COPY**, because `deno` writes `deno.lock` in whatever directory
  it runs in.
- **A sibling may vendor YOUR source.** wasmtk carries `upstream/binaryang/`; measuring "what does
  the consumer use" across its tree counted our own code as theirs and nearly forced a needless
  major version. Exclude vendor directories first.
- **The predecessors are FROZEN** (owner, 2026-09-02): no further change to the `binaryen-ts` or
  `wabt-ts` GitHub repos or JSR packages. Do not re-open their descriptions. The freeze does not
  cover binaryang.
