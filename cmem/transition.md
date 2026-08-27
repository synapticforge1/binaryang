# The transition — scope and ordered work

Scoped 2026-08-26. Forward-looking execution list; the reasoning behind each decision lives in
[pre-merge-register.md](pre-merge-register.md) and is not repeated here.

**30 items across 4 phases and 5 entities** — A:17, B:6, C:3, D:4. Everything below is either done,
or gated on something named.

---

## Scope — what moves, what ends, what does nothing

| entity          | fate               | action needed                                                           |
| --------------- | ------------------ | ----------------------------------------------------------------------- |
| **binaryang**   | the merged project | the whole of phase A, then 1.5.1 and 1.5.2                              |
| **binaryen-ts** | ends at a signpost | 1.5.1 signpost → archive                                                |
| **wabt-ts**     | ends at a signpost | 1.5.1 signpost → archive                                                |
| **wasmtk**      | stays a consumer   | two import-map lines, then republish                                    |
| **LeptonPad**   | **nothing**        | invokes `jsr:@jrmarcum/wasmtk` unpinned as a CLI; follows automatically |

**The whole blast radius is three packages deep and one branch wide:** binaryang → wasmtk →
LeptonPad. Measured, not assumed — `binaryen-ts` and `wabt-ts` each report exactly **1** JSR
dependent (wasmtk), and **wasmtk itself reports 0**. There is no fan-out to discover.

## The version ladder

| version   | binaryen-ts | wabt-ts  | binaryang                       |
| --------- | ----------- | -------- | ------------------------------- |
| 1.5.0     | live        | live     | —                               |
| **1.5.1** | signpost    | signpost | **first merged release**        |
| **1.5.2** | —           | —        | **the break — binaryang alone** |

---

## Phase A — the merge (all in binaryang)

Blocked by nothing. P1 and N4 are closed upstream.

| #       | item                                                                                                                       | notes                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **A1**  | Merge both histories into `src/binaryen-ts/` + `src/wabt-ts/`                                                              | `--allow-unrelated-histories`; source changes limited to import paths                                                          |
| **A2**  | Preserve binaryen-ts's `tests/deno.json` workspace member, **scoped to its tests only**                                    | worth 424 type errors; state `noUncheckedIndexedAccess: false` explicitly — omitting the key leaves the root's `true` in force |
| **A3**  | Rename `wabt-ts/src/bridge/binaryen-bridge.ts` → `bridge.ts`                                                               | the naming rule's one known violation                                                                                          |
| **A4**  | One `deno.json`, one workspace                                                                                             | carry `minimumDependencyAge: "0"` forward **consciously** — it is a waived supply-chain default                                |
| **A5**  | Adopt wabt-ts's `compilerOptions`                                                                                          | costs exactly 4 errors, all `exactOptionalPropertyTypes`                                                                       |
| **A6**  | **Union the `lib` arrays** — `dom` + `deno.window` — and re-check                                                          | the one genuine merge rather than adoption; do not pick one blind                                                              |
| **A7**  | Drop the `jsr:@jrmarcum/binaryen-ts@1.5.0` pin from wabt-ts's imports                                                      | the dependency the merge removes; this is what closes T13.47's exact-pin rationale                                             |
| **A8**  | Export map — narrow authored root; `./ir/{binaryen-ts,wabt-ts}`; `./compat/{binaryen,wabt}`; every other subpath preserved | **no `./ir`**, not even as an alias                                                                                            |
| **A9**  | CLI: extract six `(args) => Promise<void>` entries from the `import.meta.main` blocks                                      | they do **not** exist yet — the exported functions are library calls                                                           |
| **A10** | CLI: port `Deno.*` → `node:*` in those six                                                                                 | 53 occurrences on 43 lines                                                                                                     |
| **A11** | CLI: lift the five duplicated `cliRead`/`cliWrite` into one shared cross-runtime helper                                    | do it once, not five times                                                                                                     |
| **A12** | CLI: register in `COMMANDS`, delete the `import.meta.main` blocks                                                          | preserve `wasm-validate`'s `--enable-*` feature surface (T13.10)                                                               |
| **A13** | Harness: one test task; settle `_test.ts` (38) vs `.test.ts` (130)                                                         | zero overlap today; any glob written for one silently covers half                                                              |
| **A14** | CI: naming check + **both N7 portability checks**                                                                          | verified to fire: 0/0 on binaryen-ts, 43/0 on wabt-ts                                                                          |
| **A15** | CI: runtime matrix at the floors — Node 22.18.0 + 24, Bun 1.4.0, Deno                                                      | the floors are a promise; a promise wants a job                                                                                |
| **A16** | `cmem/` merge by topic                                                                                                     | `best-practices.md` keeps **both** origin stories; `bridge.md` has inverted (312 vs 283)                                       |
| **A17** | README migration note — the old→new subpath mapping                                                                        | the two breaks are `./compat` and `./ir`                                                                                       |

### Gate A → B

- **907 tests green** _(513 + 393 + 1 new sync test; re-derive, do not trust the arithmetic)_
- Both publish dry-runs clean
- **`verify-baseline.ts` reports `IDENTICAL`** across all 421 corpus files / 1,557,602 bytes
- Naming + portability checks return empty
- All six tools run as `binaryang <tool>` on Deno, Node **and** Bun

> The baseline is the one that matters. Green tests prove the suites ran; `IDENTICAL` proves the
> relocation changed nothing. **An exit code is not evidence in this codebase.**

---

## Phase B — 1.5.1

| #      | item                                                               | owner       | notes                                                                                                                                         |
| ------ | ------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** | Verify wasmtk builds green against binaryang **before** publishing | wasmtk      | ⚠️ it is a full minor behind on wabt (`1.4.1`), so this jumps two releases at once. **If this fails, look here before looking at the merge.** |
| **B2** | Publish **binaryang 1.5.1**                                        | binaryang   | must exist before the signposts point at it                                                                                                   |
| **B3** | binaryen-ts 1.5.1 signpost → **`README.md`**                       | binaryen-ts | `readmeSource: readme`                                                                                                                        |
| **B4** | wabt-ts 1.5.1 signpost → **the `@module` JSDoc in `src/index.ts`** | wabt-ts     | ⚠️ `readmeSource: jsdoc` — **a README-only edit is invisible on wabt-ts's JSR page**                                                          |
| **B5** | GitHub signpost on both repo READMEs                               | both        | the GitHub half; distinct from the JSR half                                                                                                   |
| **B6** | Point both JSR `description` fields at binaryang                   | both        | shows on the search card, where a reader may never open the page                                                                              |

---

## Phase C — consumer migration

| #      | item                                                            | owner     | notes                                                                                            |
| ------ | --------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| **C1** | Swap two import-map lines to `binaryang/compat/{binaryen,wabt}` | wasmtk    | it already aliases them as `binaryen` and `wabt`, so nothing else moves                          |
| **C2** | Publish wasmtk                                                  | wasmtk    | **this is what actually retires the old packages** — every wasmtk user is a transitive dependent |
| **C3** | Confirm LeptonPad's `build:wasm` task still runs                | LeptonPad | expected: no change; it resolves wasmtk unpinned                                                 |

---

## Phase D — the break, 1.5.2

| #      | item                                  | notes                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | Publish **binaryang 1.5.2**           | binaryang alone from here                                                                                                                                                                                                                                                   |
| **D2** | Set `isArchived` on both JSR packages | ⚠️ **after** B3/B4 — archiving blocks publishing                                                                                                                                                                                                                            |
| **D3** | Archive both GitHub repos             | ⚠️ **after** the 1.5.1 tags — an archived repo is read-only                                                                                                                                                                                                                 |
| **D4** | **Do not yank anything, ever**        | 🚨 yanking is version-level and affects **resolution**. It would reach backwards into all 31 published wasmtk versions and into LeptonPad's transitive `binaryen-ts@1.4.3` / `wabt-ts@1.3.5`. **This is the single action that converts a safe break into a breaking one.** |

### Why the break is safe

JSR never deletes versions. Publishing 1.5.1 does not remove 1.5.0, and archiving leaves published
versions resolvable. **Everyone already working keeps working**; the break only declines to serve
_future_ resolution of the old names. "Clean break" sounds like the bold option and is the
conservative one — provided D4 holds.

---

## Ordering constraints — the four that actually bite

1. **Publish before archive**, on both JSR and GitHub. Reversed, there is nowhere left to publish.
2. **binaryang 1.5.1 before the signposts.** They point at it.
3. **wasmtk republishes before the old packages are retired in practice.** It is a redistributor,
   not merely a consumer — decision 3 is right about the merge and understates this.
4. **Never yank.** See D4.

---

## Still open

| item                       | blocking? | note                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The promotion-rule gap** | no        | a module is promoted when nothing in either tree imports it across the boundary — but the **bridge is cross-tree by definition**, so the rule can never promote the one module that most obviously belongs to neither side. Decide where `src/bridge` lives; it can move in under `src/wabt-ts/bridge/` and be promoted later at no cost. |
| Signpost wording           | no        | drafted as handoffs when phase B is reached, not now — they would go stale                                                                                                                                                                                                                                                                |

✅ **Closed by the not-EOL policy:** the "what happens when Node 26 becomes LTS on 2026-10-28"
question. Under a lifecycle rule, **nothing happens** — Node 22 stays supported because it is still
alive. The next event that moves a floor is **Node 22's EOL on 2027-04-30**, when the floor becomes
24. That is a calendar item, not a decision.
