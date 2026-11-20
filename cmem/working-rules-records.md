# Working rules — tests, measurements and records

Summary: the rules for tests, claims, records, privacy, reviews and where project knowledge lives. Last verified 2026-11-20.
Main file: [working-rules.md](working-rules.md).

## Tests, measurements and records

- **Invert every new test or gate** — break the thing on purpose and see it fail FOR THE RIGHT
  REASON. A mutant caught by a different check is a bad mutant; rewrite it.
- **For a change that makes a state UNREPRESENTABLE, the inversion is compile-time**
  (`@ts-expect-error`, checked by `deno task check`).
- **Blast radius of a rename or regrouping: trial it.** Make the change, count `bun run check`
  errors (`deno check` before B7), revert, do the other direction. Never grep for the COST. And for
  a new KIND the compiler flags only exhaustive switches — read every `default` it does not flag.
- **Grep for tells and sweeps; trial the compiler for cost** (drift B5, 2026-10-23). The two rules
  do not conflict: [best-practices.md](best-practices.md)'s "grep for these tells" rules FIND
  places (a pattern known to be wrong, every site a sweep must visit), while the rule above
  MEASURES how much a change breaks, which a grep for the name cannot see (§ "Measure blast radius
  by TRIALLING the change").
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
  prose. `8d9ba0cb9` said "pin npm:binaryen to 132" and its diff left `@*` at 116.0.0.
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
- **Nothing private in ANY committed file or commit message** — no token or secret, no account
  name, no email address, and **no absolute path on the owner's machines** (owner, 2026-10-22:
  "personal drive paths are not to be public information"; workspace `cmem/working-rules.md`
  § Records, letter H18): not a user-profile path, and not a project or tool location either (a
  drive path, scoop, AppData), nor which drive holds what. (Examples here are described, not
  written out, so the scan below stays empty.) Committed files use repo- or sibling-relative
  paths (`new URL('../../wasmtk/…', import.meta.url)`), an environment variable, or a placeholder
  (`<repo>`, `<scratchpad>`); the real path goes in the gitignored `cmem/local/`, or nowhere.
  **The test is "is it machine-specific?", not "is it absolute?"** (owner, 2026-10-23; workspace
  `../workspace/cmem/working-rules.md` § Records, letter H22; recorded here 2026-10-26). NOT public: any path
  that records the owner's own machine layout — a user profile, the project tree, another drive,
  a scoop or AppData install, a scratchpad or session id. FINE: repo- or sibling-relative paths,
  environment variables, placeholders, and a CONVENTION path that names nothing about one machine
  and works on any comparable host (the workspace's example: a fixed cache directory such as
  `C:\zig-cache\<repo>`). Tool settings that record paths (`.claude/settings.local.json`, IDE
  workspace files) are never tracked.
  Scan before committing: `git grep -I -n -i -E '[A-Za-z]:[\\/]+(Programs|Users|scoop|tools)[\\/]|/[a-z]/(Programs|Users)/'`,
  **and the same pattern over BINARIES: `git grep -c -a -i -E '…'`** (2026-10-26: `-I` skips
  binary files, and five committed benchmark `.wasm` under `benches/browser-opt/` carried the
  owner's profile and project paths in their debug info, public since 2026-10-13, unseen by every
  text scan — open-work 44. A compiler's debug build embeds the build machine's paths; strip or
  remap them before committing a module.)
  A hit is a CANDIDATE, judged by the test above — remove what records this machine; do not scrub
  a convention path. 🔧 `scripts/spec-prepare.ts` held an absolute default corpus path from
  `cebbb1260` until 2026-10-22; the public history was purged of it (letter H19, 2026-10-23).
  **The one exception — the maintainer contact email** (owner, 2026-10-23, widened 2026-10-26):
  a publishing project may carry ONE contact email in the manifest field its registry reads, and
  it may be the git author / committer address. Nowhere else — not in `cmem/`, README text,
  issues or scripts; memory calls it "the maintainer address" and never writes it. binaryang
  commits with the noreply address (§ Git); either is allowed, so no change is required. A
  history purge rewrites paths and other personal facts, not that address.
- **Owner calls stay owner calls.** Where a record says 🗓️ OWNER or "future discussion", gather the
  evidence and stop.
- **Every numeric-ID difference is written down, old → new, with its authority** (owner,
  2026-10-28: "make notations for differences in IDs from here on out. it will be very important
  when we start making changes to meet wasm specification documents"). A library's type IDs or
  feature bits, an opcode, a kind, a section id — any enum value that crosses a boundary — goes in
  [divergences.md](divergences.md) § "Numeric IDs — the register", in the same commit series as
  the change or the measurement. `api-surface.json` does NOT catch it (it hashes a constant's type,
  not its value). The same section's "Overlaps with the specification" lists what must match the
  spec documents and what was measured against them (owner, the same day: "If there are any other
  overlapping items, that should match the spec also, lets note those also"); keep its rows
  current. The precedent is D1's opcodes, re-derived from the spec ([definitions.md](definitions.md)).
- **A change that needs an ignore statement is not a fix** (owner, 2026-10-28: "if it needs an
  ignore statement it is not a fix"). No `biome-ignore`, `@ts-ignore`, `eslint-disable` or other
  suppression to get a change through lint or the type checker: change the design, or leave the
  item OPEN and give the owner the options with their costs. (`052e8f5fa` reverted the one that
  was made.) This is about suppressing a check to pass it; a test's `@ts-expect-error` that
  ASSERTS a state is unrepresentable (the compile-time inversion above) is an assertion, not a
  suppression.
- **Follow upstream, unless it confuses something already in the project** (owner, 2026-11-05,
  CL7: `wasm-objdump -d` vs `-x`). Where binaryang differs from wabt / binaryen.js, upstream is the
  default — but a shipped flag or signature has users, and a silent change of meaning is worse
  than the divergence. Before proposing the change, search binaryang and every sibling repo for
  callers and report them. If it breaks a shipped meaning, stage it: upstream's form now with the
  old one deprecated (a MINOR), the breaking part queued in [unreleased.md](unreleased.md)
  § "Queued for the next MAJOR" (as for CL7 and `i64.const(value, high?: never)`).
- **Reviewers run on Sonnet** (owner, 2026-11-13: "please specify the use of sonnet model agents
  for the reviewers"). Every reviewer agent of a "review", "security review" or "hardening review"
  (workspace `review-process.md`, letter H35) is launched with `model: sonnet`, every round; the
  re-verification and the fixes stay with the main session.
- **Reviews follow the workspace FINAL standard** (owner, 2026-11-17; letter H37;
  `../../workspace/cmem/review-process.md`): five required classes before every release, in order — basic,
  hardening, licensing, security, privacy — after an optional efficiency review. One agent per class
  for the first review (the class's item list word for word, its severity floor, the scope); the
  main agent triages, then fixes ALL of one class together, class by class; a NEW agent per class
  re-reviews only the fixes and the code they affect; the first empty re-review ends it, then the
  full suite once per platform that has a machine. Issues live in the gitignored
  `cmem/review-issues.md`; a completed review is recorded with `bun run review:record <commit>`
  (`cmem/local/review-complete`, one hash), which `bun run release` requires. binaryang's slots: [review-process.md](review-process.md).
  (binaryang's 2026-11-15 trial rules fed this standard and are superseded by it: design-decisions
  M5.)
- **The threat model** (owner, 2026-11-15, agreeing): untrusted INPUT is bytes and text — what
  the reader and the parsers take. A module built or edited through the API is the CALLER'S
  OWN CODE: the refusals and bounds binaryang has for it stay, but a review does not treat a
  forged module (a spread copy keeping an original's `loc`/`nodeId`, reused names, getters,
  Proxies) as an attack to be hunted. Stated in README "Limits on untrusted input".
- 🔒 **Everything about this project is kept IN this project's folder, never only on the machine**
  (owner, 2026-11-13: "all information related to this project shall be stored in this project
  folder, and not stored on this machine so that maximum project portability is achieved"). Rules,
  decisions, state and records go in `cmem/` (private facts in the gitignored `cmem/local/`); a
  script kept for reuse goes in `scripts/`. Nothing the project depends on lives in an agent's
  per-machine memory or a temp folder: a one-time script in a scratch folder is fine only while it
  is used, and anything worth keeping from it moves into the repo. The four rules held in the
  session's machine memory until then (this list's numeric-ID, ignore-statement, upstream and
  Sonnet rules) are here, and that copy was deleted the same day.

