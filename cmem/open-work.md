# Open work

**The single list of what is outstanding.** A list split across three documents is a list nobody
reads, so this file holds only open items, each with a pointer to where its record lives. When an
item closes, its record goes to the topic file and its line leaves here.

**Earlier state lines, summarized 2026-10-23** (workspace letter H6, memory conventions: the
status is written once). Six dated "State" paragraphs, 2026-10-09 → 2026-10-22, each superseding
the one above, are folded here; their full text: `git show 4e1c27969:cmem/open-work.md` (lines
7–161). What they recorded, and where it lives now: releases 1.10.0 → 1.14.0 ([publishing.md](publishing.md),
one section per release); the Bun migration, items 26 and 28, `bun check` (merge `f5eb19750`)
([bun-migration.md](bun-migration.md), [run-everywhere.md](run-everywhere.md)); CI fully green
with the Browsers job (2026-10-13, `0e7c5398f`); the code lens pass 1 merged and closed
([hardening.md](hardening.md)); items 30 and 32 closed ([optimizer.md](optimizer.md),
[run-everywhere.md](run-everywhere.md)); the wasmtk Asyncify thread ([handoffs.md](handoffs.md)).

**Later, 2026-10-26: `binaryang@2.2.1` RELEASED** (owner: "we should bump and release the fix
for wasm-strip") — the `wasm-strip` fix on JSR (Rekor `3490805794`) and npm (SLSA provenance),
[publishing.md](publishing.md) § "2.2.1". And the predecessors' local material taken over before
the owner deletes their checkouts: the upstream reference clones are now this repo's gitignored
`upstream/binaryen/` and `upstream/wabt/`, the history bundles and notes are private
([project.md](project.md) § "The predecessors' local checkouts"). The paragraph below otherwise
stands.

**State, 2026-10-26, end of the session (supersedes the paragraph below).** On `main`, pushed:
the **`wasm-strip` fix** (item 45, shipped in 2.2.1 — [unreleased.md](unreleased.md); full gate 29 / 29),
the **benchmark modules rebuilt with no machine path** (item 44; the optimizer's six baseline is
now 138,410 vs upstream 137,621, [optimizer.md](optimizer.md) § "State 2026-10-26"), H27 / H20
recorded, I8 closed, C1 / C2 closed, C9 sent to the workspace (git's `safe.directory` entries name
the old folder). **Open for the owner:** 46 (the old blobs in public history: a second purge and
force-push, or accept). (The item 45 release and C9's config write are done.)
**Next by the owner's order:** 31, from 138,410. The release, 13, 14, 15 and 43 are unchanged.

**State, 2026-10-26, earlier (superseded where the paragraph above differs).** Since 2026-10-24,
memory only, no code: letters H24 (★ 5.2 re-copied) and H22 (the privacy rule's path test) done;
H25 §3(a) measured — no binaryang force-push is pending (the path-bearing commits sat on local
branches never pushed; 398 of them deleted on the owner's word, 2026-10-26, one kept —
[publishing.md](publishing.md) § "Local branches deleted"); the runtimes' § 44 matrices on 2.2.0
read from their records, 0 differences ([handoffs.md](handoffs.md) § 45). All pushed. Later the
same day: H27 (the `synapticforge1` stamp wording, four old-folder prose lines) done, H20 recorded,
I8 closed for all four assemblers (wazmrt's own fix), and the ledger rows binaryang created — C1
(§ 41) and C2 (§ 44) — closed by binaryang as their creator ([handoffs.md](handoffs.md) § "Letters
addressed to binaryang"). Waiting on
the workspace: the canonical ★ 6.1 still cites our pre-purge `b8fafaa3f` (re-copy when it changes).
The release, the open items and the next step below are unchanged.

**State, 2026-10-24, end of the session.** The
last release is **`binaryang@2.2.0`**, on JSR (Rekor `3438521434`) and npm (SLSA provenance) —
CHANGELOG § 2.2.0, [publishing.md](publishing.md) § "2.2.0". Released today: 1.16.0, 1.16.1,
1.17.0, 2.0.0, 2.1.0, 2.2.0. Closed today: 33 (FL1), 34 (the portable profile, its durable checks
and `docs/opcode-guide.md`), 35–42. Letters [handoffs.md](handoffs.md) § 42 (to wasmrt, wazmrt,
wasmtk) and § 44 (to wazmrt, wasmrt) SENT by the owner; § 43 their replies. D3 stays testsuite
messages only (owner: "stay with what we have" — wazmrt's "expected shared memory" class declined;
wazmrt notified by the owner, 2026-10-24). Everything pushed with the 2.2.0 record.

- **Open:** 46 (🗓️ OWNER — the path-bearing benchmark blobs are still in PUBLIC history: a
  second H19 purge and force-push, then the GitHub Support request), 31 (resume as its "State 2026-10-22" paragraph says, from the REBUILT six —
  138,410 since 2026-10-26, [optimizer.md](optimizer.md) § "State 2026-10-26" — and the corpus
  811,071, then attribute simplify-locals-nostructure per function), 13 (a hardening re-run until
  clean, then the code lens), 14 (security, after 13), 15 (blocked on wasmtk), 43 (the kept
  `wip/r15-tree-pass` branch: fold its message into the record, then the owner decides). 44 is
  DONE at HEAD (below); what remains of it is the owner's: the purge of the old blobs from public
  history and the force-push. 45 is FIXED and released in 2.2.1 (2026-10-26).
- **Awaiting replies:** wasmtk's optional answer to § 19. (The runtimes' matrices on 2.2.0
  came back clean — § 45, 2026-10-26.)
- **Before relying on a number in this file, re-derive it** (rule: a written number is a claim
  with a date).

**State, 2026-10-23 (superseded by the paragraph above):** letter H19 is COMPLETE
— the rewritten history is on GitHub — and **`binaryang@1.15.0` is PUBLISHED** on JSR (Rekor
`3423023791`) and npm (SLSA provenance), carrying `SSANoMerge` (open-work 31, step 16) and the
history note (CHANGELOG § 1.15.0; release record [publishing.md](publishing.md) § "1.15.0"). Also
on `main`: `docs/ir-map.html`, a map of the IR's layout for this repo and its siblings, shipped in
neither package. **Open:** 31 (resume at simplify-locals-nostructure), 13, 14, 15.

**Owner's order (2026-09-28):** defects and gaps first, then optimizer and IR, then re-evaluate.

**Cut back to open items on 2026-09-29** (the second time; the first was 2026-09-14). The file had
grown to 1,020 lines of finished stages again. Nothing that later work needs was dropped. Each
removed record went to a topic file, and the full text is one `git show` away:

| closed history                                                           | now in                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| One front end (stages 0–5), R15's design, Q1–Q8, Flatten, `--converge`   | [ir-convergence.md](ir-convergence.md) § "Where it stands" and § "The optimizer after One front end" |
| the minify passes, the owner's naming principle, "is the scheme optimal" | [names.md](names.md) § 1a and § "Does optimization RENAME things"                                    |
| N4 (decided: keep), the Q / W rows                                       | [divergences.md](divergences.md)                                                                     |
| `spec-behaviour`, `ENGINE_UNSTABLE`, the proposal suites                 | [testing.md](testing.md)                                                                             |
| releases 1.6.0 / 1.6.1 / 1.7.0, the release pattern, `RELEASE_PAT`       | [publishing.md](publishing.md), [project.md](project.md) § "Versions"                                |
| wasmtk's letter of 2026-09-28 (items 1–5, 5a)                            | [handoffs.md](handoffs.md) § 14–15, `CHANGELOG.md` § 1.7.0                                           |
| everything else: M-series and post-M8 tables, the pre-bump items         | `git show 3bd64ece7:cmem/open-work.md`                                                               |

## Defects and gaps — the owner's first

48. ✅ **The validator's type-mismatch messages are upstream wabt's** (divergence DG7) — FIXED
    on `main` 2026-10-28 (owner: "fix item 46 and divergence DG7"), to ship in 2.2.2. Every
    signature and stack-end check prints upstream's `PrintStackIfFailedV` words, with upstream's
    descriptions; a missing operand fails like a wrong type; a one-armed `if` is modelled as an
    empty `else` (one message, not two). Measured on 13 shapes against wabt 1.0.41, all equal;
    `tests/wabt-ts/validator/upstream_mismatch_words.test.ts`, red on the old code 11 of 13, 3
    mutants killed (one shows the `if` modelling is load-bearing: without it a one-armed `if`
    with a result is ACCEPTED, the old rule being gone). No verdict changes. Three tests that
    pinned the old words updated. What stays different (positions, five items): divergences.md
    DG7.

47. ✅ **A legacy `delegate`'s label was never checked, and nothing after a `try … delegate` was
    type-checked** — FIXED on `main` 2026-10-28 (owner: "fix C12 and C21"), unreleased
    ([unreleased.md](unreleased.md)). Reported by wasmtk (workspace correspondence C12, its
    2026-10-23 pin letter): its mirror of the soundness guard found `legacy/try_delegate.wast`'s
    `(assert_invalid (module (func (try (do) (delegate 1)))) "unknown label")` accepted, on 1.15.0
    and still on 2.2.0. Reproduced on 2.2.1 against upstream wabt 1.0.41 and wasm-tools 1.262 (both
    refuse; V8 too), and a SECOND defect found in the same function: after popping the `try`,
    `TypeChecker.onDelegate` set the enclosing frame unreachable, so
    `(func (result i32) (try (do) (delegate 0)))` — a function ending with nothing on the stack —
    validated. Both from wabt-ts's first port (`17532ae43`, 2026-05-22), no recorded decision.
    **The fix** is upstream wabt's `TypeChecker::OnDelegate`: look the label up at `depth + 1` (the
    delegate counts from outside its own try) and do not make the frame unreachable. Upstream's
    words come out exactly ("invalid depth: 2 (max 1)"). **Proof:**
    `tests/wabt-ts/validator/delegate_depth.test.ts` — 3 invalid modules (V8 refuses each; ours
    refuses with upstream's words) and 5 valid ones (V8 accepts; ours accepts), RED on the old code
    for the three, green after, on V8 and on Bun; 3 mutants (depth without `+ 1`; the unreachable
    mark restored; `+ 2`, which refuses valid modules) killed, 2 / 1 / 7 failing. Then the full gate
    on the committed tree. **Found on the way, not fixed:** divergence DG7 (the words for a short
    function end differ from upstream's in every function, delegate or not). wasmtk's pinned
    `KNOWN_ACCEPTED_INVALID` entry can go to 0 once it pins the release that carries this.

46. 🗓️ **The old benchmark blobs are still in PUBLIC history — a second H19 purge** (owner,
    2026-10-26: "add the history item on github as an open item"). Item 44 fixed HEAD, but the
    five modules with the owner's machine paths are reachable on GitHub from `f9b74f213`
    (2026-10-13; `modules/{rust-debug,zig-debug,zig-releasefast}.wasm`) and `4dcb140e3`
    (2026-10-22; `modules64/{rust-release-wasm64,zig-releasefast-wasm64}.wasm`) through every
    later commit up to `293e7f401`, and the tags `v1.13.0` … `v2.2.0` carry them (the trees of
    1.13.0 onward include `benches/`). **What it takes** (the H19 template, [publishing.md](publishing.md)
    § "The history purge"): rewrite those blobs in every ref — paths only, the maintainer address
    stays — with a blob-replacement filter (the five path-bearing blobs → the clean 2026-10-26
    bytes, or the same files emptied), keeping every other blob; `--tag-name-filter cat -- --all`;
    verify with the binary-aware scan over every ref (`git log --all -p -- benches` is text-blind:
    check each blob with `git grep -a` per ref, or `git cat-file` + the scan pattern); H16's
    `gc --prune=now`; record the old → new hash map tag by tag (every hash cited since 2026-10-23
    changes AGAIN — wasmtk re-clones `upstream/binaryang` a second time; the workspace and the
    runtimes re-map their citations); force-push with a lease; no publish is triggered (`jsr.json`
    stays 2.2.0 and the tags exist). ⚠️ The released provenance (Rekor, npm attestations) keeps the
    current hashes forever, as the first purge's did. **Then** the GitHub Support request that the
    first purge left with the owner (old commits are still served by hash) — one request can
    name both purges. Alternatively: accept the exposure (user name, toolchain layout, old folder
    name — no secret). **🗓️ OWNER: order the purge, or close as accepted.** The rewrite itself is
    a session's work on the owner's word; the push is the owner's.

45. ✅ **`wasm-strip` re-encoded the sections it keeps** — FIXED on `main` 2026-10-26 (owner:
    "agreed. build it"), SHIPPED in **2.2.1** the same day ([publishing.md](publishing.md)
    § "2.2.1"). Found the same day fixing
    item 44. 🔒 **DECIDED DEFECT (owner, 2026-10-26: "I agree that this is a defect that needs
    correction")**; the owner also confirmed that the minimal re-encoding stays what OPTIMIZING
    does (L1: any pass run goes through the writer), only `wasm-strip` stops re-encoding.
    **The fix:** `src/tools/wasm-strip.ts` still decodes (the `{ binary, errors, result }`
    contract, T13.29's malformed-input tests unchanged), then cuts the custom sections to remove
    out of the input and copies every other byte; the write-back and its fail-loud catch are
    gone. `benches/browser-opt/build.ts` calls the tool instead of its own walk (one
    implementation). **Proof:** `tests/wabt-ts/tools/strip_verbatim.test.ts` — a hand-built
    padded LEB survives; strip-all equals upstream wabt 1.0.41's output by SHA-256 on three LLVM
    modules; `-s name` equals upstream's `-R name` and the module still bundles — all three RED
    on the old path, green on the new; the 8 files that use the tool 112 / 112; the tool's DWARF
    strip reproduces the three committed Zig modules from their pre-fix blobs byte for byte, and
    the old tool does not (the negative control); then the full gate on the committed tree.
    Measurements kept below. Removing only the `.debug_*` sections from zig-debug with our `wasm-strip -s …`
    left 59,154 code bytes of 64,910: every kept section goes through the reader and the writer,
    so LLVM's relocation-padded LEBs come out minimal (divergence L1) and the module is no longer
    the compiler's bytes. Upstream wabt 1.0.41's `wasm-strip` copies every kept section verbatim
    (64,910 → 64,910, measured). Under the fidelity mandate a tool that removes a section leaves
    the rest untouched, so this reads as a DEFECT; the alternative is to call it DESIGN under L1.
    [divergences.md](divergences.md) ST1. The byte-exact removal used for the modules lives in
    `benches/browser-opt/build.ts` (`stripDwarf`) until the fix; since it, `stripDwarf` calls the
    tool.
    **Measured 2026-10-26** (owner: "measure open work item 45 and report"), upstream wabt 1.0.41
    `wasm-strip` against ours, both removing every custom section, on all 13 tracked `.wasm` plus
    the five pre-fix blobs: **14 of 18 differ** — every LLVM-linked Rust and Zig module; the 4
    identical are TinyGo's and Emscripten's, already minimal because wasm-opt ran after their link.
    The difference is ENCODING only: `wasm-tools print` gives the same text for upstream's and ours
    on the four checked (rust-release, zig-debug, rust-release-wasm64, strbin_rust); upstream keeps
    11 / 69 / 37 / 27 padded 5-byte LEBs where ours has 0; every output validates. Ours is a
    canonical re-encoding — idempotent, and ours(upstream's output) = ours(input) on all 18.
    Sizes, upstream → ours: rust-debug 51,752 → 48,040 (−7.2%), rust-release 19,856 → 18,707,
    rust-release-wasm64 24,215 → 21,070 (−13.0%), zig-debug 64,910 → 59,154 (−8.9%),
    zig-releasefast 20,408 → 20,277, strbin_rust 39,191 → 36,308. **Cause**, from the source:
    `src/tools/wasm-strip.ts` is `readBinaryIr` → drop the customs → `writeBinaryIr` (its own doc
    says so); upstream's `wasm-strip.cc` only LOCATES the custom sections with a no-op reader and
    copies every other byte. **Dependents in the repo:** `scripts/cli-smoke.ts` and seven test
    files (`text_form`, `custom_section_position`, `name_section`, `malformed_never_throws`,
    `cli_io_errors`, `help`, `stale_name_section`) — none asserts the re-encoding; `-s name` and
    S7's text-form section stay custom sections under a raw copy, so their semantics hold. No
    sibling calls it (wasmtk and LeptonPad grep clean). **Fix shape, if DEFECT:** walk the section
    table (the 40-line walk `build.ts` `stripDwarf` already does), copy the kept ranges verbatim,
    keep the decode for the `{ binary, errors, result }` contract and the malformed-input tests;
    one new test — a padded-LEB input strips byte-identically to upstream, red on the old path;
    a `src/` change, so the full gate. **Recommendation: DEFECT.** The tool's contract is "remove
    custom sections"; L1's DESIGN covers tools that must re-encode (the round trip, the optimizer),
    not one that removes sections and should touch nothing else — upstream's shape, and the
    fidelity mandate's. **Why the copy matters beyond bytes (measured 2026-10-26, the owner's
    question):** a KEPT custom section may refer to byte offsets inside the sections being
    re-encoded. `wasm-strip -s name` on the bundle fixture `strbin_rust.wasm` (a relocatable
    module: `linking`, `reloc.CODE`, `reloc.DATA`) keeps the reloc sections and re-encodes the
    code (39,191 → 36,308 code bytes), so every relocation now points at the wrong byte — our own
    `wasm-bundle` refuses the result ("R_WASM_MEMORY_ADDR_REL_SLEB at offset 0x14 does not match
    the code … relocations are stale") where it bundles the original. The same holds for kept
    `.debug_line` / `.debug_info` (code offsets) and `sourceMappingURL`-style sections. Upstream's
    raw copy keeps them all valid by construction. So the re-encoding is not only a size
    difference; it silently breaks a section the user asked to keep.

44. ✅ **Five committed benchmark modules embedded the owner's machine paths** — DONE at HEAD
    2026-10-26 (owner: "lets fix 44"); found the same day while closing workspace letter H27.
    `benches/browser-opt/modules/{rust-debug, zig-debug, zig-releasefast}.wasm` (public since
    `f9b74f213`, 2026-10-13) and `modules64/{rust-release-wasm64, zig-releasefast-wasm64}.wasm`
    (`4dcb140e3`, 2026-10-22) carried, in DWARF and in Rust's panic-location strings, the
    user-profile path of the scoop toolchain and AppData (199 hits) and the project tree under the
    old workspace folder name. Every text scan — the rule's `git grep -I`, the H18 / H19 / H25
    `git log -G` — skips binary files, so "HEAD is clean" had been true of text only; the rule
    now has a binary scan ([working-rules.md](working-rules.md) § Records). Never shipped
    (`benches/**` is excluded from the package; npm ships `dist/`). **The fix:** the two wasm32
    Rust modules and the wasm64 one rebuilt with every prefix remapped (`--remap-path-prefix` for
    the home, cargo home, sysroot, temp and repo paths, `-Ztranslate-remapped-path-to-local-path=no`
    so std keeps its `/rustc/<hash>` virtual paths — the data-section hits were panic locations
    rustc had translated back to the local rust-src); the three Zig modules with their `.debug_*`
    custom sections removed byte for byte (Zig has no prefix map; code bytes unchanged); TinyGo
    untouched (`-no-debug`, no hits). `build.ts` now does all three and SCANS every output,
    failing on a machine path. Checked: the binary-aware scan over the whole tree finds nothing;
    every module validates; the four tests that read them pass (34 / 34); the optimizer baseline
    re-derived with a positive control — [optimizer.md](optimizer.md) § "State 2026-10-26": six
    -Oz 138,410 vs upstream 137,621 (+0.57%, the gap unchanged; item 31 resumes from 138,410).
    `results.json` (the 2026-10-22 browser run) and the 28.6 table stay as dated records of the
    old modules. **Left to the owner:** the old blobs are in public history from `f9b74f213` /
    `4dcb140e3` — a second H19 purge (paths only, every ref) and a force-push, or accepting that
    history. Record: [handoffs.md](handoffs.md) § "Letters addressed to binaryang", the H18 entry.

34. ✅ **One opcode profile every widely used engine runs** — DONE 2026-10-24 (owner, 2026-10-23:
    "attempt to create a consolidated opcode set that all can decode and run"). The record is
    [portability.md](portability.md) (decisions 1–8, passes 1–3, the lowerings, the target and D4,
    decision 5, "The committed probe") and [definitions.md](definitions.md) (D1 against the
    specification, D4). The deliverables: `wasm-opt --target portable` and D4; D1's spec check as a
    CI test; the D4 probe (`bun run probe`, local only); and **`docs/opcode-guide.md`**, the
    reference for the other projects (linked from the README; shipped in neither package). The
    final probe run: 513 instructions portable, 29 lowered, 40 excluded, on all 14 engines; tail
    calls portable since 2026-10-24 (owner). **What remains is a letter**: the D2 letter to the
    runtimes (item 40), which can point them at the guide.

42. ✅ **The runtimes' replies to § 42: D2's type rule, five validator defects** — DONE 2026-10-24,
    SHIPPED in 2.2.0 (CHANGELOG § 2.2.0).
    [handoffs.md](handoffs.md) § 43 (received) and § 44 (the reply, SENT by the owner 2026-10-24). Fixed:
    wasmrt's two fuzz inputs (`ref.cast` / `ref.test` / `br_on_cast` naming a type past the section;
    `stringref` validated with no feature); `--disable-mutable-globals` refused nothing (wabt's two
    checks restored); an overlong `call_indirect` table index with reference-types off (the reader
    records the encoding, `FidelityEntry.tableIndexOverlong`); `(ref any)` gated by
    function-references. **The type rule** — owner, 2026-10-24: "wasm-tools' rule" — every reference
    type needs reference-types; `(ref null? $t)` function-references OR gc; non-null func / extern
    function-references; the exn hierarchy exceptions; the GC heap types gc. Stated in D2 2.2.0 as
    `typeRules`, with `encodingRules` for the encoding gates; `tests/definitions/d2_rules.test.ts`
    proves every rule against the validator both ways (four mutants killed, one survivor found
    and closed: the import side of mutable globals had no sample). Record: definitions.md § "D2's
    type and encoding rules". **From § 43, DECIDED:** wazmrt's request for a D3 class "expected shared
    memory" is DECLINED (owner, 2026-10-24: "stay with what we have") — D3 holds only messages the
    spec testsuite writes, and the threads suite never asserts this trap. wazmrt keeps its own
    check (`error.ExpectedSharedMemory`).

41. ✅ **wasmrt's gate rows, and a Wasm 1.0 element segment refused by default** — DONE 2026-10-24,
    SHIPPED in 2.1.0. wasmrt's item 4 also listed binaryang's validator rows its sweep
    found accepted (multi-value, reference-types, the table-initializer form) and two fuzz
    accept-invalid cases. Re-measured on `main`: multi-value already fixed (item 35); the other two
    still open, and FIXED — `funcref` / `externref` as value types need referenceTypes (a funcref
    table and its segment excepted, as in Wasm 1.0), and a table initializer needs
    functionReferences. Fixing them exposed a far larger one: **a funcidx element segment (every
    module with a function table) was INVALID under the default features** — its implied
    `(ref func)` gated as a typed reference, its entries as the `ref.func` instruction. All six real
    Rust / Zig / TinyGo builds failed `wasm-validate` with no flags, in every release checked,
    1.5.3 → 2.0.0; wasm-tools accepts them as Wasm 2.0. Fixed with one rule the writer and validator
    share (`src/ir/elem-form.ts`, internal). Tests `reference_types_gate.test.ts` (17; four mutants
    killed). The residue: divergences.md EF1. **Not reproduced: the two fuzz cases** — wasmrt's
    inputs are not in its record ("func 0 failed to validate"; "invalid value type" at `0x3b`);
    ask for the bytes in the letter.

40. ✅ **`return_call_ref`'s gate and D2's dependency / preset rules** — DONE 2026-10-24, SHIPPED
    in 2.1.0 (CHANGELOG § 2.1.0). wasmrt's item 4 ("binaryang — D1's `return_call_ref`
    feature and D2's missing dependency rules"), relayed by the owner; both runtimes follow D1 / D2
    since contract v33 (v35 current, its `--features` row unchanged). (1) `return_call_ref` needs
    functionReferences only: D1 1.0.1, the validator's inherited tail-call demand dropped (D4 1.1.0
    first listed it excluded for wasmer; the probe then showed wasmer runs every tail call, so tail
    calls became portable — portability.md § "The committed probe"). (2) D2 2.1.0: `requires` (owner, after asking what wasmtime does:
    "recorded only option") and `presets`. Measurements and sources: definitions.md § "D2's
    dependency and preset rules", divergences.md RC1. **The runtimes' answer is SENT**: [handoffs.md](handoffs.md) § 42 (owner:
    "letter sent to each", 2026-10-24, after 2.1.0 was published). Awaiting: wasmrt's two fuzz
    inputs (item 41) and both runtimes' feature matrices once they re-pin to 2.1.0. It also asks wasmrt for item 41's two fuzz inputs.

39. ✅ **DONE on `main` 2026-10-24** (owner: "2.0.0 is accepted"), to ship as 2.0.0: the alias
    gone from D2 (data version 2.0.0), and the alias MECHANISM with it — `cliAliases`, its rule,
    the parser's deprecation path, the help line — since no alias is left to test it (a future
    deprecation brings it back with its tests). The old spelling is an unknown option; README §
    Breaking Changes has the 2.0.0 row. Was: **Remove the deprecated `sat-float-to-int` spelling in the next release** (owner, 2026-10-24:
    "we will remove the deprecated spelling on the next release"; deprecated in 1.17.0, item 33).
    Removing a flag is BREAKING, so **the next release is a MAJOR, 2.0.0** — the compatibility gate
    refuses less (rule: a break is a major). The change: D2 `features.json` drops `cliAliases` for
    `satFloatToInt` (data version 2.0.0: a consumer accepting the old spelling stops), so
    `FeatureFlags` refuses `--enable-/--disable-sat-float-to-int` as unknown and `--help` stops
    listing it; the README's "Deprecated, still accepted" row becomes a Breaking Changes row for
    2.0.0 with its migration; CHANGELOG and the release note say it; consumers generating from D2
    (workspace letter H10) are told. To make when the next release is prepared.

38. ✅ **FIXED 2026-10-24** (owner: "go ahead and perform the fix so that we have no surprise issues
    later"): a shared memory and all 67 atomics run, single-threaded — an atomic access is its plain
    access (the shape from D1's name), misaligned traps "unaligned atomic", then out of bounds, then
    `wait` on an unshared memory "atomic wait on non-shared memory" (wasmtime's order and words,
    measured; the proposal's Overview for the rules). `wait`: not-equal → 1, equal with a timeout →
    2, equal with none → a `hang` Stop (no thread can wake it); `notify` → 0; `fence` a no-op.
    Proven: 179 / 179 threads probes match the engines (2 where they disagree: the interpreter gives
    wasmtime's 1); the threads spec suite 0 → 267 / 267 (the harness gained `spectest.shared_memory`);
    `tests/binaryen-ts/interp/atomics.test.ts` (20, every expectation wasmtime's); 7 mutants killed.
    Was: **binaryang's interpreter refuses every shared memory** (found 2026-10-23, open-work 34 pass 1;
    numbered 2026-10-24 at the owner's word). `src/interp/interpreter.ts:877`: instantiating a
    module with ANY shared memory stops with "unsupported: a shared memory" — even when the export
    run never touches an atomic. So `wasm-interp` and `wasm-ctor-eval` cannot take a threaded build
    (Emscripten `-pthread`, Rust / C with atomics), and the interpreter runs none of the 67 atomic
    probes (reported, not defining). A clean refusal, never a wrong result. NOT affected: the
    optimizer — `Precompute` and `OptimizeInstructions` share only `interp/numeric.ts`, never
    instantiate a module. Single-threaded semantics are small: a shared memory as a plain one,
    atomics as their plain operations, `memory.atomic.notify` → 0 woken, `wait` → "not-equal" or
    "timed-out" (no other thread can wake it). Precedence (2026-10-24): none needed — nothing open
    depends on it.

35. ✅ **The validator enforces `multiValue`** (found 2026-10-23; FIXED 2026-10-24, owner: "on 35
    lets fix that first to conform with upstream"). Upstream measured first on 10 shapes, both
    paths (wabt 1.0.41 `wat2wasm` / `wasm-validate --disable-multi-value`, wasm-tools agreeing):
    the shared validator refuses a function type with several results and a block / loop / if /
    try / try_table with parameters, in wabt's words; `wasm-validate` alone refuses a block type
    ENCODED as a type index ("expected valid block signature type" — wabt's binary reader; its
    `wat2wasm` accepts `(block (type $t))` naming a one-result type, so the text path does too).
    `tests/wabt-ts/validator/multi_value_gate.test.ts` (12 shapes × off / on); 5 mutants killed
    (one survived first: a check refusing EVERY block — two plain-block cases added). On by
    default: nothing changes unless it is switched off.

33. ✅ **FL1 — upstream's feature-flag spelling is refused** — DONE, in two steps. **Today the old
    spelling is GONE**: `--enable-/--disable-sat-float-to-int` is an unknown option, D2 has no
    `cliAliases` field, and `saturating-float-to-int` is the only spelling (D2 2.0.0, binaryang
    2.0.0, item 39). The steps: (1) 1.17.0 renamed it (owner, 2026-10-24: "lets rename binaryang's
    to conform with upstream saturating-float-to-int"), keeping `sat-float-to-int` as a deprecated
    alias in a new `cliAliases` field, D2 1.1.0; (2) 2.0.0 removed the alias and the field (owner:
    "we will remove the deprecated spelling on the next release"; a break, so a major). Found
    2026-10-23 measuring workspace letter H8 / I6: upstream's spelling (wabt 1.0.41, wasm-tools) was
    an unknown flag here, the only spelling of ours wabt lacked; Binaryen 133 says
    `nontrapping-float-to-int`, its own vocabulary. [divergences.md](divergences.md) FL1. 🔧 This
    entry said "kept as a deprecated alias … To build" until 2026-10-24: written at step 1 and not
    brought up to date at step 2 (found by the owner).

36. ✅ **The CLI tools answer `--help`** (owner, 2026-10-24: "add the help to the cli tools and the
    needed information to go with it"). DONE 2026-10-24: all ten commands, in upstream wabt's layout
    (usage, description, examples, every option; `--help` only, as upstream — wabt's `wasm-objdump
    -h` is "headers"), exit 0; `<command> --version` from the dispatcher. One renderer
    (`src/cli/help.ts`); the feature flags from D2. The test RUNS every example the helps print,
    against fixtures — it caught one at once (the fixture, not the example: two inputs exporting the
    same name are refused by default, as documented). 4 mutants killed.

37. ✅ **TinyGo's `memcpy` / `memmove` → `memory.copy`** (decision 5's one candidate). Owner,
    2026-10-24: "if the rewrite … does not change the runtime result, I agree"; measured first
    (−1,489 / −1,087 B against the round-tripped original, 0.98–1.02× speed, the checksum the
    same); then "1 is acceptable" (overlapping `memcpy`, undefined in C, and out-of-bounds copies
    differ) and "exact code match only". BUILT: `src/tools/memcpy-to-bulk-memory.ts`, a `wasm-opt`
    step (`--memcpy-to-bulk-memory`, and under `--target` with -O), not a pass — it matches the
    INPUT's bytes before any runner prepares the tree (a pass's tree no longer encodes to them: the
    first build failed exactly so). Catalogue `src/tools/known-copy-bodies.ts` (3 bodies, generated
    from `benches/browser-opt/modules`); `memmove`'s call immediate masked at the reader's offset.
    Test: the catalogue recognised in TinyGo and nothing in Rust / Zig; one valid byte changed →
    no match; names play no part; the checksum; >1,000 defined calls leave the same memory and
    value. 6 mutants killed.

No defects open. (Item 32 closed 2026-10-22: our OUTPUT runs on JavaScriptCore too — Safari and
Bun, the engine behind 34 of the 36 known Bun differences. Owner: "we should work on item 32
first", then "Trap, as the original", then "we measure each and make the decisions based on the
measurements". Built: `Memory64Lowering` (`--memory64-lowering`, `--table64-lowering` its alias),
sound where upstream's wraps above 2^32; the gate step `bun run lowering` (122 spec modules, 0
diverging on either engine); real compiler output — Rust nightly and Zig wasm64 builds, lowered,
run their workload to the right checksum on JavaScriptCore (`memory64_real_compiler.test.ts`).
Measured, nothing built: legacy-EH `delegate` was already solved by TranslateToExnref (70 / 70);
JavaScriptCore's multi-memory limit is 100 memories and every compiler measured emits one, so no
multi-memory lowering. Emscripten 6.0.13 `-sMEMORY64` (measured once installed): refused as built,
runs lowered — and so does its JS glue, unchanged, memory growth included; committed as test
modules beside the Rust and Zig ones (owner). Every step and number:
[run-everywhere.md](run-everywhere.md) § "Open-work 32". Its number is kept free.)

No defects open before it. (Item 27 closed 2026-10-12: the interpreter's constant-expression evaluator never
checked that an expression left a value, so `(offset nop)` on an unvalidated module escaped as a
bare `TypeError`; now `Stop(invalid)` — [hardening.md](hardening.md) § "2026-10-12 — open-work 27".
Its number is kept free.)

(Item 28 closed 2026-10-15: "runs everywhere" is held by evidence in CI — every export bundles and
loads in a browser, the library runs in seven browsers with the same output as Deno / Node / Bun,
the source runs on every Node LTS with no flag, `wasmOpt` takes bytes, and the browser recipe
(28.7, `examples/browser-optimize/`) runs in every browser. The record, verbatim, and the close:
[run-everywhere.md](run-everywhere.md). Its number is kept free.)

Items 18–20, from wasmtk's § 20, were fixed for 1.8.1 the day they arrived: L3 (a
lowered out-of-bounds access traps as out of bounds), L4 (the placeholder; case 2 at an engine
ceiling) and C7 (`getFunctionInfo` shaped as binaryen.js) — [divergences.md](divergences.md).

Closed 2026-09-29: `array.new_default` defaultability (`1108a5a1f`), empty offsets / items (M2a),
the name section's position (N9, by decision), references by name (N10), folded layout and its label
comments (W18), the diagnostic defects DG1–DG4 found by measuring the old item 16
([testing.md](testing.md) § "Diagnostic usefulness"), and the two that measurement left, numbered 16
and 17 after it: DG5 (`wat2wasm` validates by default, as upstream — owner: "we want to do the
same"; it needed the validator to take labels BY NAME, which it never could) and DG6 (a text
diagnostic at the WORD, not its `(`, underlined as upstream) — [divergences.md](divergences.md). The
CI shell scripts are TypeScript (the old item 17).

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
    upstream's 139,068; 140,028 before the Local2Stack fix, `eb0fff576`), corpus 811,099
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

**Workspace letter H15 (2026-10-22, the scripting rule) — acted on** (owner: "proceed with H15"):
the rule recorded in [working-rules.md](working-rules.md) § Tools (committed repeated-use scripts
are TypeScript on Bun; a one-time script may stay shell, written with `Write`; no committed shell
script — none tracked; no heredocs, `bun -e` / `node -e` included; this repo keeps `node:` only,
stricter than the workspace's `Bun.*`). Nothing to port. The stale lines the letter named were
corrected: [bun-migration.md](bun-migration.md)'s state line (item 26 is done) and
working-rules.md's `deno.json` / `--config jsr.json` / "still `deno task`s" / `deno task ci`
lines. Still open from the workspace for binaryang: H5 (the provenance note), H6 (the
compatibility gate: `api-surface.ts`), H8 (I5–I8 measurements), H12 (reserve `./ts2wasm` in the
exports plan, no code).

**The workspace rules reviewed (2026-10-22, owner: "yes" to two of the findings):** (1) docs land
in the same commit as their code — adopted, [working-rules.md](working-rules.md) § Git; (2) H6's
SemVer half DONE: `bun run bump [patch|minor|major]`, no cap, each version line matched exactly
once, both texts made before either write, each written through a temp file and a rename
(tooling rule 4); `version_bump.test.ts`, 7 mutants killed; one real `bump minor` run (1.14.0 →
1.15.0 in both files, no temp file left) and restored from a copy. Left with the owner: whether
`scripts/spec-prepare.ts:74`'s default (a local drive path, no user name) may stay committed
under the workspace's no-personal-information rule. Noted for the workspace session (not ours to
edit): its § The gate still calls binaryang's naming check a shell script that always exits 0
(✅ corrected there the same day).

**Workspace letter H18 (personal drive paths) — acted on** (owner: "personal drive paths are not to
be public information"): `scripts/spec-prepare.ts`'s default corpus is the sibling wasmtk checkout
resolved from the script's own location (run with no source: 257 / 257 prepared, the same tree);
a test comment's `file:///D:/…` became `<repo>`; four cmem lines naming this machine's drives
reworded; the workspace scan finds nothing; commit messages carry no path. **Not done — letter
H19, the history purge, waits on the owner:** the old path is in public history from
`cebbb1260`, and every commit's author address is the owner's personal one (no local
`user.email`; the noreply address is needed). H19's hazards for this repo: upstream wabt /
binaryen history with third-party authors (rewrite only the owner's address), 375 branches and
21 tags, released provenance pinned to old hashes, wasmtk's `upstream/binaryang` clone.
✅ **H19 DONE the same day** (owner: "start"; "only public facing items"; "items in the public
facing history should be cleaned in the history"): the public history rewritten — 1,761 commits
and 5 tags, the 11,187 upstream commits untouched — verified, cited hashes remapped, local
`user.email` the noreply address. **Paused 2026-10-22 at the owner's word** ("I need to pause
here for today"), in the middle of "update the project memory files, bump the version then push
to github"; ✅ **COMPLETED 2026-10-23** (owner: "continue with H19", then "yes" to the bump):
the 24 public refs force-pushed with a lease each, no publish triggered ([publishing.md](publishing.md)
§ "The history purge", "Pushed"); CI green; `CHANGELOG.md` § 1.15.0 gated and merged; a fresh
clone 17 / 17; **1.15.0 released** on JSR and npm with provenance ([publishing.md](publishing.md)
§ "1.15.0"). The tag-by-tag hash map: [publishing.md](publishing.md) § "The history purge".
**Every commit hash quoted before 2026-10-22 outside this repo (wasmtk's letters, the workspace) is
now an OLD hash.** ✅ wasmtk told to re-clone `upstream/binaryang` (owner, 2026-10-23, with
letter § 41, sent the same day). Left with the owner: a GitHub Support request if the old commits
must stop being served by hash.

(Item 1 closed 2026-09-30: the walkers visit a `br_if` / `br_table`'s values before its condition.
It was a DEFECT, not only an order: `mapWithSequences` keeps, evaluated, what it mapped before an
operand that becomes a never-falling-through sequence, so StripEH ran a builder-made
`br_if $l (throw $e (i32.const 7)) (call $bump)`'s call before the trap — reachable only from trees
built by the API or a pass; the text reader keeps such a `throw` a statement before the branch. The
"may move `-Oz` bytes" premise was measured: 0 of 13,285 optimizer outputs moved (the corpus and
every prepared spec module, at -O1 … -Oz). The hand-written traversals (`deriveTypes`, `phantoms`,
`cfg`, `non-nullable-locals`) already had wasm's order. `branch_operand_order.test.ts`.)

(Item 2 closed 2026-10-08 at **1.86%** of upstream `wasm-opt -Oz` on the corpus — the owner's
≤ 2% — from 13% on 2026-09-19: [optimizer.md](optimizer.md), every step with its commit, the
method, what the last 15 KB is. Its number is kept free.)

(Item 30 closed 2026-10-15 — owner: "Top shapes, then decide": on the six real-compiler modules our
-Oz went from 10.4% to **4.9%** over upstream 133 (zig-debug +31.1% → +14.0%), -O2 from 6.3% to 1.5%,
the corpus -Oz from 1.86% to 1.60%, in four steps: OptimizeInstructions' bit rules, CodeFolding's
terminating tails, RUME's unreachable table slots, MergeSimilarFunctions. On the way, a SHIPPED crash
(1.11.0 – 1.12.1: a legacy `try` ending both arms of an `if` threw at -O2+) was found and fixed.
Gap (a) was the schedule, not a defect. Every step, the defects and what is left, ranked:
[optimizer.md](optimizer.md) § "Open-work 30: the gaps on real compiler output". Its number is
kept free.)

## Conformance

Nothing open. Closed 2026-09-29: item 11 (rank 4 of the wasmtk-ranked list — closed since M8e by the
One front end, never recorded: [handoffs.md](handoffs.md) § 4's outcome) and item 12 (`proposals/`
in the gate, both halves; custom-page-sizes on V8 through `LowerCustomPageSizes`, every assertion of
the suite honoured — [testing.md](testing.md) § "The proposal testsuites",
[divergences.md](divergences.md) L1, L2, P1). Their numbers are kept free.

## Quality passes — the lens plan (agreed 2026-09-02)

Each round adds a LENS and re-runs every lens below it. Each lens repeats until a pass turns up
nothing new; the re-runs are the point, since fixing a hardening issue can introduce a code issue.
The rounds were named for versions 1.5.6 / 1.5.7 before the releases overtook them, so they keep the
names as labels only.

| round     | lenses, in order                            | state                                                                                    |
| --------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **1.5.5** | code                                        | ✅ passes 1–7, register empty, converged — [testing.md](testing.md) § "The 1.5.5 passes" |
| **1.5.6** | hardening → then code again                 | 13. ◐ passes 1 (the contract) and 2 (the weakest ceiling, ~384 → ~930) DONE 2026-10-09, and the fuel question answered by a sound HANG CHECK (2 s); the code lens pass 1 (C1–C17) MERGED and CLOSED 2026-10-15, its converging re-run adding no row; open: a hardening re-run until clean, then the code lens again; deeper ceilings are the owner's call — [hardening.md](hardening.md) |
| **1.5.7** | security → then hardening → then code again | 14. ⬚ not started                                                                        |

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

(Item 29 closed 2026-10-22: binaryang is on npm as `@synapticforge1/binaryang`, JSR staying the
source. Built and proved first (`bun run npm:build` / `npm:prove`, in CI); 1.13.1 published by
hand to create the package, since npm's trusted publisher can only be added to one that exists;
then **1.13.3 by the workflow**, trusted publishing, SLSA provenance read back. The name took two
corrections: the npm scope is the npm org's name, `synapticforge1`, and the GitHub org was renamed
to match. Every step, the owner's settings and what was measured on the way:
[publishing.md](publishing.md) § "npm as a SECOND registry", § "1.13.1", § "1.13.3". Its number is
kept free.)

15. ⬚ **A2 — `wasm2ts` is a stub that throws.** The long-term goal is WASI Preview 1 capable
    TypeScript output. **Blocked, and not close:** as of 2026-09-02 the wasmtk side had a long way
    to go before there is anything to implement against.
43. ⬚ **The one kept local branch, `wip/r15-tree-pass`** (owner, 2026-10-26: "add that to the open
    items list so that it is not forgotten"). The 2026-09-20 first attempt at R15's block-param
    lowering, as a tree pass; it failed 6 of 8 modules and was never merged. R15 landed another way
    (positional, merge `f3008cbd6`). It was kept when the other 398 local branches were deleted
    ([publishing.md](publishing.md) § "Local branches deleted") because two places send readers to
    its commit message for the traps it records: [ir-convergence.md](ir-convergence.md) § R15 and
    `src/passes/lower-block-params.ts:33`. It is local only: never pushed, not in any clone.
    ⚠️ Its id is now `91dfb6cc2` (re-parented 2026-10-26). The pre-purge bundle holds the OLD id,
    `ade9019d6`, with the same patch and message, so the branch's content is backed up, but under
    another id.
    **To close:** (1) fold what the message alone holds into [ir-convergence.md](ir-convergence.md)
    § R15. That is the failures it measured per module and trap 1: `mapExpression` calls back with
    a REBUILT node, so identity survives only for leaves; a lookup by identity never matched, nothing
    was lowered, and the guard loop ran 1,000 times. Trap 2, "a no-op passes every validity test",
    is already in [best-practices.md](best-practices.md). (2) Point both citations at that record
    instead of the branch. (3) The owner decides: delete the branch, or keep it.
(Item 25 closed 2026-10-13: the deprecated IR subpaths and names are removed on `main`, for the next
minor, 1.12.0 — [unreleased.md](unreleased.md), the letter [handoffs.md](handoffs.md) § 32. The
premise "wasmtk does not import the IR subpaths" was checked in their repo before relying on it: true
for their code; only their vendored copy of our old source names them. Its number is kept free.)

(Item 26 closed 2026-10-13 (UTC) with the 1.11.0 publish: the development toolchain moved from Deno
to Bun, JSR kept as the source. B1–B7 are in [bun-migration.md](bun-migration.md); the proof of the
last two, the first publish through the new workflow, recorded provenance, Rekor log id
`3247643457`. Deno remains for `deno publish`, one `deno doc` test and the Deno-run `comparison/`.
Its number is kept free.)

(Item 21 closed 2026-10-09: one `src/` tree by concept, one declaration per name, one IR
subpath — [one-tree.md](one-tree.md): the four phases, the decisions, what the gate found. Its
number is kept free; the follow-up is item 25 above.)

(Item 22 closed 2026-10-08 with the 1.9.0 release and its letter, [handoffs.md](handoffs.md)
§ 26: [definitions.md](definitions.md) — what shipped, the decisions, what the proof found. Its
number is kept free.)

(Item 24 BUILT 2026-10-08 on `main`, unreleased — `wasm-bundle`, `./tools/wasm-bundle`, the
`(@reloc data)` annotation: [bundle.md](bundle.md) — the rules as built, the decisions, what was
measured, the gaps; the letter is [handoffs.md](handoffs.md) § 27. Its number is kept free.)

## The wasmtk thread — [handoffs.md](handoffs.md)

§ 22 (2026-09-30) closed the thread: 1.8.1 pinned, all three fixes hold on five engines, skips 66 →
16 (gate 64,506 / 0 / 16), nothing asked. § 20 was answered in code (items 18–20, 1.8.1) and by
§ 21. § 19 (1.8.0 is out; `LowerCustomPageSizes` offered for the custom-page modules they skip) was
SENT 2026-09-29 and asks nothing — a reply is welcome, above all their custom-page-sizes skip count
with the pass. § 17 (item 1 fixed in 1.7.1) was answered by § 18: on 1.7.1 their gate is 64,473
passed / 0 failed / 66 skipped, all 11 of our skips pass, and "none of the 66 is yours". § 11 was
sent and answered (their reply reached us 2026-09-29) — closed in [handoffs.md](handoffs.md).

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
