# Open work

> Summary: the open items only, with the standing decisions ("Not tasks, by decision"). Every
> closed, done, superseded or fixed item and every dated "State" paragraph is in
> [archive/open-work-to-4.1.1.md](archive/open-work-to-4.1.1.md). Last verified 2026-11-27.

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

**OPEN — the nesting limit, option 2 (owner, 2026-11-13: "I agree with option 1 now and then
option 2 in the stage by stage plan as described").** Option 1 is DONE on `security-r2`: one
limit, `MAX_NESTING_DEPTH` = 256 (`src/ir/nesting.ts`), measured iteratively and refused in one
message at every entry — the binary reader (bodies and constant expressions), the WAT parser (a
token pre-scan before it recurses, then the built tree exactly), the writers, the passes, the
interpreter and the bundler — and `tests/wabt-ts/parser/nesting_limit.test.ts` holds every stage
at exactly 256 and refuses 257 and 100,000, run locally on Bun 1.4.4, Node 22.18 / 24 / 26 and
Deno (2026-11-13), and in CI on both test legs. Option 1's gaps closed in **4.2.0**: the reader's and
folded parser's double count and every API entry (C-H2…C-H6, `fd51d4644`); an optimizer that
never builds past the limit (C48, `6c5e3c876`, `a388ebe82`). Why 256: the cold capacities measured that day
(Windows, a fresh process per probe) were 425 at the lowest on every V8 runtime (an operand
chain through `wat2wasm` and the writer; blocks through the interpreter ~490) and 5,794+ on Bun;
real code nests 25 (421 real-compiler modules) and 40 (spec). **Option 2, stage by stage, lowest
ceiling first** — each stage made iterative (an explicit stack), its cold capacity re-measured
on every runtime, and the limit raised only to what EVERY stage then holds with margin (the
test's `LOWEST_MEASURED_CAPACITY` and README move with it): (1) folded-WAT parsing and the
writers' operand recursion (425); (2) the interpreter's `exec` (~490); (3) the shared walkers
`walkExpression` / `mapExpression` (86 call sites in 30 files inherit them); (4) the validator,
`wasm2wat`, and the passes with recursion of their own. Browsers (Chrome / Firefox / Safari) are
not measured yet: measure them before raising the limit.

§ The dated State paragraphs and the security-review rounds 1–4 (2026-10-23 to 2026-11-18): moved to [archive/open-work-to-4.1.1.md](archive/open-work-to-4.1.1.md)

§ Closed items 33–49, 53, 54 and the "(Item N closed …)" notes, "Conformance", "The wasmtk thread": moved to [archive/open-work-to-4.1.1.md](archive/open-work-to-4.1.1.md)

**Owner's order (2026-09-28):** defects and gaps first, then optimizer and IR, then re-evaluate.

## Defects and gaps — the owner's first

52. ◐ **Code lens pass 3's recorded findings — FIXED 2026-10-28 but two** (owner: "fix the 52
    and 50 items"; branch `fix/open-50-52`). ✅ (a) the binaryen facade mirrors binaryen.js 132:
    type IDs, Features, `getFeatures()`, shrink default 1, import handles, exnref's ID
    (`a1618195c`, `61541dff2`; every ID old → new in [divergences.md](divergences.md) § "Numeric
    IDs — the register"). ✅ (b) the wabt facade: `validate()`, `toBinary`'s `log`, a gating
    `parseWat` feature bag (`5984b5a79`; ⚠️ wasmtk's one partial bag, CL24). ✅ (c) `wasm-opt`
    judges its output with our validator, not the host engine (`5b1e64999`); MergeLocals,
    SSANoMerge and StackIR fail loudly (`d9c271195`, corpus and six modules unchanged). ✅ (d)
    raw control characters in strings refused (`4b03ff338`); a missing segment offset refused by
    the parser (`23f5d9570`). ✅ (e) `parseS32Literal` / `parseS64Literal` refuse past the range
    (`458af6c10`). **Open:** ⬚ `i64.const(low, high)` (CL19) — the check needed a lint
    suppression and was reverted (`052e8f5fa`; owner: "if it needs an ignore statement it is
    not a fix"): a second parameter (surface gate: MAJOR) or leave it, the owner's to choose.
    **Decided 2026-11-05 (owner): the second parameter**, `high?: never`, throwing. ✅ **LANDED
    2026-11-09 for 3.0.0** (owner: "Land queued, then 3.0.0"; divergence CL19, closed).
    ⬚ LowerBlockParams refuses a `try_table` catch (and a `br_on_*`) to a loop with parameters
    (`lower-block-params.ts:426`): `-O1`, `-O2`, even `--vacuum` exit 1 on a valid module — not
    yet done (a lowering to design: the catch's values must reach the loop's parameters).

51. **The last Deno uses on this machine** (owner, 2026-10-28: "migrating everything to bun").
    Done the same day ([bun-migration.md](bun-migration.md) § "B8"): the publish dry runs,
    `deno doc` (api-surface, the `./ir` test) and the smoke's Deno leg run Deno from npm
    (`bun x deno@2.9.6`), proved with Deno off the PATH; and the `comparison` suite PORTED to
    `node:test` and Bun, no Deno at all (same 24 names and results, scripts' output identical).
    Then (owner: "fix the four files. yes the CI should use npm's deno leg"): the pin is ONE
    constant, `scripts/deno.ts` (`DENO`, `denoCommand`; run as a launcher from command lines), and
    `tests/wabt-ts/scripts/deno_pin.test.ts` refuses a `deno@<version>` anywhere else (a planted
    copy failed it); CI installs no Deno — the gates job's `setup-deno` is gone, and the runtimes
    matrix's Deno leg runs `bun scripts/deno.ts run -A` (cli-smoke itself on Deno, the same hash).
    publish.yml keeps `setup-deno`: its `deno publish` runs directly, for provenance. **Open,
    option only:** `@deno/doc` (WASM) for `deno doc` with no Deno binary, only if every surface hash
    holds.

50. ◐ **Code lens pass 2's recorded findings — FIXED 2026-10-28 but two** (owner: "fix the 52
    and 50 items"). ✅ CL6 `--generate-names` (`efbfc6f8e`), CL8 objdump's rec-group count
    (`ef56a7d32`), CL9 `-S` names (`c246edcc3`), CL10 / CL11 `wasm-interp` (`7170ac901`), CL13
    `wasm-validate` silent (`030ddebb8`), CL14 `wasm2wat` flags and validation (`631055f4f`);
    (b) branch hints on an instruction only (`f27ffb263`); (c) a tag with no type index refused
    (`cd6c5874d`); (d) export errors located, `Export.loc` (`b93cbe456`); (e) 2^63 alignment
    printed exactly (`827178d5b`). **Held for the owner:** ⚖️ CL12 — enforcing wabt's
    bulk-memory → reference-types coupling would reverse the owner's 2026-10-24 ruling ("RECORDED,
    NOT ENFORCED … nothing turns a feature on or off with another"); ⚖️ CL7 — upstream's `-x` is
    details and its `-d` a disassembly binaryang lacks, so matching it changes what our `-d`
    means (a CLI-contract decision), and upstream's details cover every section.
    **Decided 2026-11-05 (owner):** CL12 → DESIGN, the ruling kept, no code. CL7 → upstream's
    flags in two steps: ✅ `-x` / `--details`, `-d` deprecated with a warning, and the printed
    lines upstream's character for character (on `main`, a MINOR); ⬚ the sections not yet printed
    (Table, Memory, Global, Start, Elem, Code, Data, Tag, Custom) — mine; ✅ `-d` as
    `--disassemble`, refused until there is a disassembler — LANDED 2026-11-09 for 3.0.0.

## Optimizer and IR

31. ◐ **Below upstream: work the optimizer.md list with no threshold** (owner, 2026-10-15: "lets
    close out the optimizer.md items", then "Work the list to a target, but remove the 2% limit.
    Lets see how much more than upstream we can actually optimize."). The list is
    [optimizer.md](optimizer.md) § "Open-work 30: the gaps on real compiler output", "What is left"
    (re-ranked after each step), and item 2's "Not built". Method and gate as items 2 and 30: each
    step attributed first, gated and merged on its own, the behaviour gates unchanged, the
    real-compiler six AND the corpus measured. Start: six modules -Oz 145,859 (+4.9% over upstream
    133's 139,020), corpus -Oz 822,964 (+1.60% over 809,986). Progress: optimizer.md § "Open-work
    31". **State 2026-10-20, after step 15 — RELEASED in 1.13.0:** six 140,032 (+0.69% over
    upstream's 139,068; 140,028 before the Local2Stack fix, `065f8dd54`), corpus 811,099
    (+0.14%); -O2 2.1% BELOW upstream. Step 9: the control diff (step 8's "next")
    found upstream's WRITER dropping code after terminators that our DCE never visited (blocks in
    operands) or never judged dead (constructs that never reach their `end`); fixed in DCE. Step
    10: Vacuum moves a named block's head out (upstream merge-blocks; 161 → 16). Step 11:
    CodeFolding folds the tails before a block's branches (code-folding 285 → 0). Step 12:
    SimplifyLocals gives a block its result from sets (simplify-locals 268 → 87; its `if` form
    measured worse, not kept). Step 13: RemoveUnusedBrs drops branches that flow to their target
    (remove-unused-brs 310 → 224; the first gate caught an `unwind.wast` regression, fixed before
    merging). Step 14: RemoveUnusedBrs sends a block's branches to the parent it ends, and merges
    adjacent `br_if`s on `i32.or` (remove-unused-brs 224 → 125). Step 15 (resumed 2026-10-20,
    owner: "lets pickup where we left off", then "yes" to the plan): the new MergeLocals pass —
    ssa-nomerge's top shape was a reused local hiding a copy (merge-locals 72 → 2, ssa-nomerge
    325 → 249); `localGraph` on bitsets, so -Oz time is unchanged; the first gate caught a
    wrong-output defect (a tee copy removed), fixed before merging. Step 8's own six figure
    (141,857) does not reproduce: 141,905 (optimizer.md 🔧). **Next: the ranked passes** (scratch
    `gap/passrank17.log`): ssa-nomerge 249, simplify-locals-nostructure 142, remove-unused-brs
    125, simplify-locals 119. Pushed and released with 1.13.0 (2026-10-20). A new session copies
    the scratch scripts first (cmem/local/environment.md, "Optimizer measurement scripts"; add
    `six-run.ts`, `commit-bisect.ts`, `timeit.ts`'s `LEVEL=`) and re-derives the six / corpus
    baseline before quoting it. **Every step now also runs** `real_compiler_behaviour.test.ts`
    (in `bun run test`): a step that only measures the six never runs them.
    **State 2026-10-22, after step 16 (RELEASED in 1.15.0):** owner, "proceed with item 31";
    the targets are now **output size and output run speed** ("The goal is smaller file and
    faster run"; optimizer time is not one). Step 16, the new SSANoMerge: six 139,857 (+0.57%),
    corpus 811,071 (+0.13%), run speed unchanged (scratch `gap/speed.ts`, V8 and
    JavaScriptCore). **Next** (`gap/passrank19.log`): simplify-locals-nostructure 135,
    simplify-locals 117, remove-unused-brs 109, vacuum 63. **Paused** there (owner: "update the
project memory files, then pause until later today"); resume by attributing
simplify-locals-nostructure per function (`passfn.ts <module> simplify-locals-nostructure`),
after re-deriving the six (138,410 since the 2026-10-26 rebuild of the modules, item 44; 139,857
before it) and corpus (811,071).

## Quality passes — the lens plan (agreed 2026-09-02)

Each round adds a LENS and re-runs every lens below it. Each lens repeats until a pass turns up
nothing new; the re-runs are the point, since fixing a hardening issue can introduce a code issue.
The rounds were named for versions 1.5.6 / 1.5.7 before the releases overtook them, so they keep the
names as labels only.

- **round:** **1.5.5**
  - lenses, in order: code
  - state: ✅ passes 1–7, register empty, converged — [testing.md](testing.md) § "The 1.5.5 passes"
- **round:** **1.5.6**
  - lenses, in order: hardening → then code again
  - state: 13. ◐ passes 1 (the contract) and 2 (the weakest ceiling, ~384 → ~930) DONE 2026-10-09,
    and the fuel question answered by a sound HANG CHECK (2 s); the code lens pass 1 (C1–C17) MERGED
    and CLOSED 2026-10-15, its converging re-run adding no row; open: a hardening re-run until
    clean, then the code lens again; deeper ceilings are the owner's call —
    [hardening.md](hardening.md)
- **round:** **1.5.7**
  - lenses, in order: security → then hardening → then code again
  - state: 14. ⬚ not started

If a finding fits two lenses, file it under the **lowest** one that would have caught it:

| lens          | question                                    | examples from this codebase                                                                                                 |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **code**      | is it WRONG on valid input?                 | wrong bytes, dropped information, logic contradicting its own docs, one fact duplicated in two places that drifted          |
| **hardening** | does it survive HOSTILE or malformed input? | truncated binaries, absurd section counts, deep nesting, a panic where a typed error is the contract, unbounded work        |
| **security**  | can a consequence be EXPLOITED?             | unbounded allocation from an attacker-controlled length, path traversal in a CLI, ReDoS, integer overflow reaching an index |

⚠️ Converging means THESE invariants no longer discriminate, not that no issues remain. Keep a
per-pass record of what each pass looked for and found, or convergence cannot be told apart from
fatigue.

## Repo work

55. ⬚ **D1's rules say the encoding is the key** (workspace letter C52, wasmrt; answered
    2026-11-27). Add to `rules.encoding` in `src/definitions/opcodes.json`: "The entry's unique
    key; `name` is not unique". Data version 1.0.1 → 1.0.2 (rules text and `sha256` only, no
    entry); `bun run definitions` restamps. Promised for the next release.

15. ⬚ **A2 — `wasm2ts` is a stub that throws.** The long-term goal is WASI Preview 1 capable
    TypeScript output. **Blocked, and not close:** as of 2026-09-02 the wasmtk side had a long way
    to go before there is anything to implement against.

## Not tasks, by decision

- **When to release is the owner's call, every time — a standing rule, not a task.** The pattern is
  settled ([publishing.md](publishing.md), current-state line). The bump is never made incidentally,
  because the version line arms a release.
- **`RELEASE_PAT` — not needed** (owner, 2026-09-29). The release pattern always pushes the tag
  itself (8 of 8 unaided). The PAT fixes only the `auto-tag` → dispatch path, which the pattern
  never takes ([publishing.md](publishing.md)).
- **Names under optimization — decided** (owner, 2026-09-29):
  - with `-g`, the local and label names the passes leave are KEPT (N4, DESIGN);
  - export and import names are inviolable, and minification is opt-in with a map;
  - the minified scheme is final: separate import/export sequences were rejected
    ([names.md](names.md)).
- **WASM kernels (binaryen-ts Phase 10) — parked** (owner, 2026-09-29: "we may reevaluate way down
  the road when we start talking about optimization and speed of processing").
  - The code stays as it is: `wasm-runtime.ts`, the demo kernel in `src/wasm/`, the
    published `./wasm` and `./wasm-runtime`. Only a test and a bench call them.
  - What was never built is kernel SELECTION: which optimizer operations are worth moving to wasm.
    The baseline is a ~2–3 ns boundary cost per call (`add_i32` ~3.6 ns as a kernel vs ~0.34 ns in
    TS), so only an operation doing much work per call can pay.
  - **Trigger to reopen:** work on the optimizer's processing speed. Profile the corpus first; a
    kernel is justified only by a hot operation the profile shows.
  - It is not part of the IR merge: the IR is the tree's shape, this is the passes' speed.
  - The doc mapping of `wasm/demo_bytes` to `./wasm` is correct: `./wasm` exports `DEMO_BYTES`
    (checked 2026-09-29).
- (29, npm as a second registry, was PARKED here from 2026-10-13; REOPENED 2026-10-20 — see item
  29 under "Repo work".)
- **`bun lint` / `bun format` in place of Biome / dprint — SHELVED** (owner, 2026-10-15: "We will
  shelve that decision until it become available in a later release"). Merged to Bun's main
  (oven-sh/bun PR #44805) and documented at bun.com/docs/lint, but NOT in Bun 1.4.3, the release
  CI and publish pin (`bun lint` there: `Script not found "lint"`); canary only.
  **Re-measured 2026-10-28 on Bun 1.4.4** (workspace correspondence C21, from s3d-reportcompiler):
  `bun fmt` EXISTS (Prettier-style, `--check`; s3d-reportcompiler adopted it) and `bun lint` still
  does not. The trigger below is unchanged — the lint half; whether the formatter half alone is
  worth deciding now (a `bun fmt` vs dprint byte comparison, below) is the owner's call. Still
  shelved.
  - **Trigger to reopen:** a Bun RELEASE that ships `bun lint` (check its release notes, then
    `bun lint --rules` outside the repo: our `lint` script shadows it inside).
  - **What deciding needs then**, the `bun check` method ([jsr-deno-exit-guide.md](jsr-deno-exit-guide.md)
    § "Type checking: `bun check`"): Biome's recommended preset minus `biome.jsonc`'s eight
    switched-off rules against `bun lint`'s defaults; the six canary rules map to `no-explicit-any`,
    `no-debugger`, `eqeqeq`, `require-await`, `no-var`, `prefer-const`; a run over the tree with
    every difference explained; the canary moved; config in `bunfig.toml`. `bun format` against
    dprint must be byte-identical over the formatted files (dprint reproduces `deno fmt`), or
    one deliberate reformat commit.
- **A local directory path in git history — leave it** (owner, 2026-09-14). The copies in
  `4da931fb7` and `29652f51e` name no account, token or secret, and are not worth a force push. Do
  not re-open.
- **JSR and GitHub descriptions on the predecessors — won't do** (owner, 2026-09-02); they are
  frozen.
- **Converging the two IRs further is not a release task.** It is open-ended by decision 1 and
  tracked by `deno task collisions` ([project.md](project.md)).
- ~~**D4 — never yank, ever**~~ — reversed by the owner 2026-10-26 for the predecessors'
  packages ([project.md](project.md)).
- ~~**The predecessors are frozen**: no change to `binaryen-ts` or `wabt-ts` on GitHub or JSR.~~
  **RETIRED 2026-10-26 (owner):** the local checkouts and the GitHub repos are deleted (404,
  checked 2026-10-28) and EVERY JSR version of both yanked, 1.5.1 included (measured 2026-10-28;
  [project.md](project.md), the reversed D4). Their history and notes
  are in binaryang's private bundles; the upstream reference clones are binaryang's `upstream/`.
