# The project — the predecessors' retirement, the merge lessons and the local checkouts

Summary: what must stay true about the frozen predecessors, the lessons the ladder and the merge paid for, and what binaryang took over from their checkouts. Last verified 2026-11-20.
Main file: [project.md](project.md). Moved from it on 2026-11-20 (H38 step 5), unchanged.

## The retirement — complete (2026-09-02)

**What stays true, and must not be "fixed":**

- 🛑 **The predecessors are FROZEN** (owner, 2026-09-02): _"we are not changing either the github
  repo or the jsr any further for the wabt-ts or binaryen-ts projects."_ Their four descriptions
  still present them as live projects — JSR: `binaryen rewritten in typescript`,
  `rewrite of wabt in typescript`; GitHub:
  `Optimizer and compiler/toolchain library for WebAssembly`, `The WebAssembly Binary Toolkit` — an
  accepted cost, not an oversight; the archived banner and README signpost carry the message. **Do
  not re-open it.** The freeze does not cover binaryang.
- ~~🚨 **D4 — never yank anything, ever.**~~ 🔒 **REVERSED by the owner, 2026-10-26** ("I will
  yank them which is fine also"), knowing the cost stated here: yanking is version-level and
  affects RESOLUTION, so it reaches backwards into the 31 published wasmtk versions that ask for
  the predecessors by RANGE (wasmtk 1.10.0: `^1.3.5` / `^1.3.3`, read from JSR's API) — a fresh
  install of those stops resolving; exact-version imports and lockfiles keep working. Current
  wasmtk (3.0.0, on binaryang 2.2.0) and every repo in the workspace import neither package.
  (Before: **archiving is not yanking** — an archived package keeps resolving and only refuses new
  versions; both were archived 2026-09-02.) **Measured 2026-10-28, final:** EVERY version of both
  is yanked — `@jrmarcum/binaryen-ts` 39 of 39, `@jrmarcum/wabt-ts` 32 of 32, 1.5.1 included
  (JSR's API, cache-busted: `latestVersion` null, both archived). Nothing resolves by range any
  more; an EXACT-version import still downloads (JSR keeps yanked versions; `1.5.1_meta.json`
  answers 200). (An earlier read the same day found 12 binaryen-ts versions still live; the owner
  finished the yank.) Both GitHub repos answer 404 and both local checkouts are
  gone (2026-10-28); their histories are in the private bundles (§ "The predecessors' local
  checkouts").
- ⚠️ **`dependentCount` reads 1 on both predecessors and will never reach zero**: wasmtk's earlier
  versions are immutable and still name them. Retirement means _no new dependents_. The only way to
  drive the count down is yanking — see D4.
- ⚠️ **wasmtk pins binaryang EXACTLY**, so no binaryang release reaches them without their own bump.

**Lessons from the ladder**, each also where it belongs:

- **Publish before archive**, on JSR and GitHub — archiving stops new versions and makes a repo
  read-only. And the two predecessors were NOT configured alike (`readmeSource` `readme` vs
  `jsdoc`): do not assume two repos behave alike because they look alike.
- **Only a fresh `DENO_DIR` proves a dependency chain**; `--reload` does not clear a resolved
  version ([best-practices.md](best-practices.md)). A fresh resolution returning an older version
  for minutes after a publish, even with a clean `DENO_DIR`, is **publication propagation** —
  upstream of the client, and it settles on its own. Say which of the two you eliminated.
- **Verifying wasmtk**: its real suite is `tests/*_tests.ts` (16 files), run with `--no-check` (its
  own test files carry pre-existing type errors). A bare `deno test tests/` collects corpus fixture
  `test.js` files instead and reports failures that mean nothing. Run it from a scratch copy.
- **A verification recipe that returns empty is inconclusive, not negative**:
  `deno doc --json
  <entrypoint>` → `nodes[file].module_doc.doc` came back empty for every file
  tried, including one whose module doc JSR demonstrably renders — so it could not confirm a
  signpost before publishing.
- **A summary that improves because a file stopped reporting looks exactly like one that improves
  because a bug was fixed**: wasmtk's `tests/wast_tests.ts` calls `Deno.exit(0)` from pre-test
  output, so whether it counts as a test file varies between runs.

Full ladder, runbooks and verification tables: `git show f2ee1a41f:cmem/transition.md`.

## The merge — how it was prepared (2026-08-26)

**Lessons it paid for** (the general ones are rules in [best-practices.md](best-practices.md)):

- **Internal consistency is not completeness.** The author of "reconcile both registers before any
  file moves" then sequenced the steps from one view, and the one action both sides had agreed must
  happen first was missing — no amount of re-reading the list would have surfaced it, because the
  list was not where the information lived.
- **A dependency audit that reads import maps and source measures DECLARATIONS, not dependencies.**
  The first sweep missed LeptonPad, whose references live in `deno.lock`; the lockfile is where the
  transitive truth is.
- **A subpath LIST is not DEMAND.** Across every sibling repo, only three subpaths of either package
  were imported by anything. The export map is a third surface, independent of the file tree and the
  tracked-path list — and it is the one consumers actually import.
- **"We can't test that" is cheaper to check than to write down**: a Bun cell left blank and then
  called untestable was probed in minutes, from an older install the version manager had kept.
- **A stale rationale is worse than none**: the `import.meta.main` ban's reason (Node 18) expired on
  every runtime while the rule stayed right for another reason (the `Deno` global is absent from
  Node and Bun at every version).

⚠️ The register's own § 8 said entries are marked, never deleted, because "it was already like that"
is unfalsifiable once the boundary is gone. That evidence now lives in git, which is why summarizing
it here loses nothing: the commits above, and the file at `f2ee1a41f`, are the proof.

### The predecessors' local checkouts — what binaryang took over (2026-10-26)

Owner, 2026-10-26: "We need to pull in what we currently do not have. I will be deleting that
repo." Measured before anything was copied: binaryang imports nothing from binaryen-ts or
wabt-ts, neither package depends on them, and every commit this memory cites with `git show` is
on binaryang's own `main`. What existed ONLY in the predecessor checkouts, and where it went:

- **The upstream reference clones** — binaryen (`version_132` + 38) and wabt (`1.0.41` + 68),
  no local edits — now gitignored clones in this repo at `upstream/binaryen/` and
  `upstream/wabt/`, the same commits, origin GitHub, upstream's tags fetched (so `version_133`,
  the optimizer's oracle, can be checked out to read its source). `corpus_roundtrip.test.ts`
  and the 20 diagnostic scripts under `scripts/binaryen-ts/` and `comparison/scripts/` read
  `upstream/binaryen/test` (the scripts had pointed at a path that never existed since the merge).
- **Each predecessor's own git history and 39 tags, under the ORIGINAL ids** — binaryang holds
  the merged content but under ids its H19 purge rewrote. Kept as git bundles of every ref,
  proven by restoring each into an empty repository (refs and ids identical, `fsck` clean), with
  two shallow nested clones that sat inside wabt-ts archived whole; machine-local, in the
  private `cmem/local/`. **The GitHub repos are deleted too** (owner, 2026-10-26: "Yes both the
  local folders and the github repos"), so both were MIRRORED and bundled first: 34 of
  binaryen-ts's GitHub tags named different commits from the local checkout's (rewritten after
  they were pushed), and those are the commits the JSR versions' provenance names. Restored
  into empty repositories, every ref and id equals GitHub's. Neither repo had releases, issues
  or pull requests. ⚠️ After the deletion, the provenance on `@jrmarcum/binaryen-ts` and
  `@jrmarcum/wabt-ts` (JSR, frozen at 1.5.1) links to repositories that no longer exist — the
  commits survive only in those bundles.
- **The gitignored notes archives** (each predecessor's `CLAUDE.md`, binaryen-ts's `TASKS.md`)
  — copied byte for byte into the private `cmem/local/`; they record this machine's paths, so
  they are never committed. The curated memory was already here (`binaryen-ts.md`, `wabt-ts.md`).
- Not kept: binaryen-ts's gitignored `src/wasm/` build output (the `.wat` it was built from is
  binaryang's own, byte-identical).

The local `binaryen-ts` and `wabt-ts` git REMOTES this clone had are REMOVED (2026-10-26), after
checking that every commit their remote-tracking branches named is in a bundle; `origin` is the
only remote. No tracked file in binaryang links to either GitHub repo (`git grep`, checked); the
README's `jsr:@jrmarcum/wabt-ts` is the JSR package, which stays.

