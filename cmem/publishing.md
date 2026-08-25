# Publishing & release flow

Published as **`@jrmarcum/wabt-ts`** on JSR. GitHub remote: `github.com/jrmarcum/wabt-ts`.
**v1.4.0 is PUBLISHED** (2026-08-25T00:06Z), with OIDC provenance —
`rekorLogId 2582221500`, doc score 100, GitHub Release `wabt-ts v1.4.0` created.
The version was set by hand: `deno task bump` would have produced 1.3.6 under the
sub-version-capped-at-9 rule, and this release breaks an exported type twice, so it took the
minor. The import map still pins binaryen-ts at `^1.0.9` while the checkout is v1.3.5+ (the
caret accepts it — a stale pin, not a break).

## SHIPPED in v1.4.1 (2026-08-25) — fifteen user-visible fixes

Published to JSR with OIDC provenance (rekor `2589519728`), attributed to the OWNER
rather than `github-actions[bot]` — **the tag came from a human `deno task publish`,
which is what avoids the `actorNotScopeMember` trap below**. Roughly 60 seconds from
tag push to live.

<!-- The count in this heading is DERIVED and has gone stale twice. It read "five"
     while the table held twelve, was corrected, and then read "twelve" while the
     table held fifteen. Re-derive it, never quote it:
     `grep -cE '^\| \*{0,2}T13.*\| \*\*yes' cmem/publishing.md`
     (The first version of that command returned 0 — it skipped one table cell where
     there are two before the verdict. A documented command that silently returns
     nothing is worse than no command: run it before you write it down, and again
     when you next rely on it.) -->

T13.11, T13.14, T13.15, T13.16, T13.20, T13.26, T13.29, T13.30, T13.31, T13.33,
T13.34, T13.40 and T13.41 changed BEHAVIOUR; T13.37 and T13.38 changed only error
WORDING. **T13.40 changed the BYTES every module encodes to** (3.2% smaller), so a
consumer pinning an output hash sees it move. **T13.16 emitted wrong code and T13.26
silently repaired an invalid module into a valid different one** — those two were the
argument for shipping rather than accumulating more, and they are the reason anyone
still on 1.4.0 should move.

**Nothing is unreleased on `main` as of 2026-08-25.** The one deliberately unfixed item
is T13.22 (bridge `try_table` catch scope), which has no published entrypoint and is
coupled to the binaryen-ts bump — see [bridge.md](bridge.md).

The table below is the release CONTENTS. It is kept because
*an unreleased fix is indistinguishable from an absent one downstream* — and because
each row names the v1.4.0 behaviour a consumer still pinned there is exposed to.

| id | change | user-visible? |
| --- | --- | --- |
| T13.11 | `resolveNames` never walked `table.get`'s index, so `(table.get $t (global.get $g))` and `(table.get $t (call $f))` **failed to encode at all** | **yes — valid WAT was rejected** |
| T13.12 | The two SIGNED LEB encoders wrapped out-of-range input instead of throwing | only via a hand-built IR through `writeBinaryIr`; unreachable from WAT |
| T13.13 | `named_refs` guard gained its operand axis; 2 of its own fixtures were invalid wasm; V8-validity now asserted | no — tests only |
| T13.14 | `wasmValidate` ACCEPTED twelve invalid GC shapes that V8 and Wasmtime both reject — cross-hierarchy `ref.test` / `ref.cast`, `array.len` on a non-array, unchecked `ref.i31` / `i31.get_*` / `ref.is_null` / `ref.as_non_null` operands, and all four illegal packed-field signedness combinations | **yes — a caller relying on the validator was told invalid modules were fine** |
| **T13.16** | **`wat2wasm` SILENTLY DELETED an instruction**: a value-producing expression immediately before `data.drop` / `elem.drop` was swallowed and discarded, so `(call $bump) (data.drop $d)` emitted a module both engines accept, that runs, and that computes a different answer | **yes — WRONG CODE EMITTED, no diagnostic** |
| T13.15 | SIMD lane memory ops ignored the memory's index type: on a 64-bit memory a valid i64 address was rejected and an invalid i32 one accepted | **yes — valid memory64 input was refused** |
| T13.17 | `rethrow` ignored its depth, so a rethrow with no enclosing catch validated | only for legacy EH, which neither Wasmtime nor Wasmer will run at all |
| T13.18 | Removed a dead, never-called duplicate alignment table (`getOpcodeNaturalAlign`); made `instrInputCount` total over the instruction tokens and added a gate test | **no** — the removed symbol was not re-exported from the package root, and the arity entries make explicit what `default: return 0` already produced |
| T13.19 | Tranche-ledger documentation; INTENT blocks on three code sections | **no** — comments and `cmem/` only, nothing executable touched |
| T13.20 | `applyNames` left 50 of 87 expression kinds unwalked, so naming came out silently inconsistent | **yes, but narrowly** — `applyNames` is published from the package root and used by no internal pipeline, so only a consumer calling it directly (say, applying a parsed name section) saw it. `/compat.applyNames()` calls `generateNames` and is unaffected |
| T13.21 | Two coupled WAT-writer switches, now notated and gated | **no** — they had not drifted; the change is comments plus a test |
| T13.22 | Bridge `try_table` catch-scope off-by-one, diagnosed and **deliberately unfixed** | **no** — the bridge is a dev-only dependency with no published entrypoint, and the defect is currently cancelled. Must land with the binaryen-ts bump |
| T13.24 | The bridge pushed no label frame for `if`; every `br` inside one was off by one | **no** — dev-only dependency, no published entrypoint reaches the bridge |
| T13.25 | A NUL byte made a source file invisible to grep; sentinel fixed and the tree gated | **no** — a string-literal constant and a new test; nothing observable changes |
| T13.41 | `wasm-strip` with `sections` removed the named custom sections and **relocated every survivor to the end of the module**, because the writer emitted all custom sections in one block and the IR recorded no position | **yes** — a module whose `dylink.0` section must come FIRST came back with it last, which a dynamic linker will not load. Default strip (remove everything) was never affected |
| T13.40 | Every section header was written with a padded 5-byte size LEB, because the back-patch reservation was never collapsed. Upstream wabt canonicalises by default and that half was not ported | **yes — every binary we emit shrinks**, 3.2% on the 272-file wasmtk WASI corpus (628,201 -> 607,845 bytes). Output stays valid and semantically identical; only the encoding gets smaller. A consumer comparing output HASHES will see them change |
| T13.38 | A misspelled or nonexistent instruction — the most common mistake in hand-written WAT — was reported as `unexpected ( in function body`, as `expected ), got (`, or by leaking the internal token-class name `Reserved`. None of them named the instruction | **yes, in wording** — `wat2wasm` and everything above it now report `unknown operator "i32.load32"`. Accept/reject is unchanged; a consumer matching on the old strings will see different text |
| T13.37 | Decoder error MESSAGES realigned to the spec's vocabulary: the two LEB faults the spec names separately (`integer too large` vs `integer representation too long`) had shared one message, and a 4-byte file with a bad magic number was reported as ending unexpectedly because the version was read before the magic was compared | **yes, but only in wording** — every entrypoint accepts and rejects exactly the same inputs (all conformance metrics unmoved). A consumer MATCHING ON ERROR TEXT will see different strings: `LEB128 u32 overflow` and `LEB128 sequence is truncated` no longer appear. Nothing documented promised those strings, and no test asserted on them |
| T13.36 | Fourth hardening pass | **no** — no defects found; nothing changed |
| T13.35 | Third hardening pass | **no** — no defects found; nothing changed |
| T13.34 | `wasmValidate` accepted GC modules with a subtyping chain deeper than 63 or a supertype cycle | **yes** — modules reported valid that neither Wasmtime nor V8 will load |
| T13.33 | `wasm2wat` / `wasm-validate` accepted a module whose type-section count outran its entries, decoding it to a DIFFERENT module (zero types) | **yes** — a malformed binary was reported valid and disassembled as though the missing types never existed |
| T13.32 | Lexer token-reachability enumeration and gate | **no** — no defects found; a test only |
| T13.31 | The five CLI shims dumped an uncaught Deno stack trace on a bad path | **yes** — `deno run -A jsr:@jrmarcum/wabt-ts/wasm-validate <typo>` printed Deno internals plus our absolute source path instead of one line, and leaked local paths into anything the user pasted into a bug report |
| T13.30 | `/compat.toBinary` threw an undocumented, differently-shaped error | **yes, and on the migration surface** — `/compat` is what wasmtk consumes as `import wabt from "wabt"`. A module from `readWasm` of a corrupt-but-decodable binary failed here with the writer's raw internal string; it now names itself and the docs say it throws |
| T13.29 | `wasm2wat` / `wasm-validate` / `wasm-objdump` / `wasm-strip` threw uncaught `RangeError` on malformed input instead of returning `{ errors, result }` | **yes** — any consumer feeding untrusted or truncated wasm to a published tool got a crash where the documented contract promises a reported error |
| T13.28 | Control bytes repaired in `cmem/`; hygiene gate widened; a stale perf rationale corrected | **no** — documentation and a test only |
| T13.27 | Audit pass over the binary reader and `wasm-strip` | **no** — no defects found; nothing changed |
| T13.26 | `wasm2wat` / `wasm-validate` accepted a module with a wrapped alignment exponent, and the round trip REPAIRED it into a valid one | **yes** — `wasmValidate` returned Ok on modules V8 and Wasmtime reject, and `wasm2wat` of such a module produced text that re-encodes to a DIFFERENT, valid program |
| T13.23 | `@jrmarcum/binaryen-ts` pinned EXACTLY (was `^1.0.9` held only by the lockfile) | **no** — nothing a consumer resolves changes. `wat2wasm` / `wasm2wat` / `wasm-validate` / `wasm-objdump` / `wasm-strip` / `/compat` are pure wabt-ts and never pull binaryen-ts; the pin governs a dev-only dependency reached by no published entrypoint |

**T13.16 changes the release calculus and should be treated as the reason to
ship.** T13.11 and T13.15 are "valid input rejected" — loud, self-announcing,
and impossible to mistake for correct output. T13.14 and T13.17 are "invalid
input accepted" — silent, but a consumer only loses a safety net it should not
have been relying on alone. **T13.16 is neither: it emitted WRONG CODE from
valid input.** The module compiles, validates, loads on every engine, runs, and
returns a different answer than the source says. There is no downstream check
that catches that, because every check that exists says the module is fine.

None of the five has been reported, and the shapes explain why — `table.get`,
these GC forms, memory64 SIMD lane ops and a stacked value before `data.drop` are
all absent from the wasmtk corpus. That bounds the blast radius; it does not
bound the severity. **An unreleased fix is indistinguishable from an absent one
downstream**, and for T13.16 the absent one means a consumer can ship a wasm
binary that quietly does the wrong thing.

**T13.14 tightens the validator, so check it against the v1.4.0 precedent.** It
is NOT the same class of break as T13.10: that one made previously-ACCEPTED
modules fail because a feature flag started being honoured, and it was called
out as breaking. This rejects only modules that were already invalid — no engine
loads any of them — so no working input changes behaviour. The measurement backs
that rather than the reasoning: **449 / 449 V8-accepted spec modules still
validate (zero false rejects), re-run with the three edited files reverted to
confirm the baseline was 449 and not an artefact of the new code**, and the
wasmtk corpus is unchanged at 265 / 272 (the 7 are the known stale-snapshot
`KNOWN_INVALID` files).

Under the sub-version-capped-at-9 rule `deno task bump` gives **1.4.1**, which is
right: no exported type changes, and no behavioural change to any input that
previously worked CORRECTLY — T13.16 changes what is emitted for
`(call $f) (data.drop $d)`, but the previous output was wrong code, not a
behaviour anything could have depended on. Nothing here breaks `/compat`, which exposes neither `Limits`
nor the IR — and note `/compat` does not expose `wasmValidate` either, so T13.14
cannot reach wasmtk through it at all.

**`README.md` carries a "What changed in v1.4.1" section describing these**, retitled
from "Unreleased (fixed on `main`, not yet published)" when v1.4.1 shipped on
2026-08-25. Each entry still names the **v1.4.0** behaviour so anyone pinned there
can see the exposure, and gives the v1.4.0 workaround for the `table.get` case (write
the inner reference numerically — verified against a reverted tree, not assumed).

**AT BUMP TIME that section must be folded into a released-version heading**, the
way "Breaking change since v1.3.5" describes v1.4.0. Leaving it saying "not yet
published" after publishing is the same failure the release rule already names, in
reverse: a shipped fix that still reads as absent. The workaround paragraph should
go at the same time — it is advice for a version nobody should still be on.

## v1.4.0 — what it carries, and who was waiting on it (2026-08-25)

**wasmtk's exception-handling migration was blocked solely on this release, and
is now unblocked.** `try_table` catch clauses with NAMED tags or labels do not
encode at v1.3.5 — `resolveNames` did not resolve them, so the writer's
fail-loud `writeVar` fires. Fixed by **`d30b8599` (2026-08-21)**. At the pinned
version wabt-ts could emit only the EH form Wasmtime and Wasmer refuse.

Their words: *"we pin it the moment it ships — the migration is written and
blocked solely on this."* Their range is `^1.3.5`, which accepts 1.4.0, so the
pin moves on their next resolve — no action needed from them beyond that.

**An unreleased fix is indistinguishable from an absent one downstream** — that
is the whole reason this release existed.

The tag push is the OWNER's action and MUST come from a human: `deno task publish`
commits `deno.json` if it is still dirty, tags, and pushes both. Never
`deno publish` locally — and never rely on the auto-tag path, for the reason
below.

**`deno task publish` commits `deno.json` AND NOTHING ELSE, so it refuses to run on a
dirty tree (T13.43).** That guard was added 2026-08-25 after this file was found
claiming it in one place and describing the opposite in another — while the tree
held 56 dirty paths and 15 unreleased user-visible fixes. Without it the flow
`deno task bump && deno task publish` commits a bare version bump, tags THAT, and
publishes a release containing none of the work. **A JSR version is immutable**, so
the only remedy would have been to burn the next number.

## `auto-tag.yml` CAN TAG BUT CANNOT PUBLISH (2026-08-24)

**Do not release by pushing `main` and letting the safety net do the rest.** It
tags correctly and then fails at the last step:

```
error: Failed to publish @jrmarcum/wabt-ts@1.4.0
Caused by: The actor that this request was authenticated for is not authorized
as a scope member for this scope. (actorNotScopeMember)
```

`auto-tag.yml` creates the tag as `github-actions[bot]` and dispatches
`publish.yml` with `gh workflow run` under `GITHUB_TOKEN`, so the OIDC actor
presented to JSR is the BOT. JSR authorizes the triggering user against scope
membership, and a bot is not a member. Every one of the 28 published versions
went the other way — `deno task publish` pushes the tag from a dev machine with
a PAT, so `publish.yml` fires on `push: tags` with the owner as actor.
`publish.yml`'s own header says this ("developer pushes are authenticated with a
PAT ... without going through the auto-tag detour"); the trap is that
`auto-tag.yml`'s header describes itself as closing that gap, and it only closes
half of it.

**Recovery when it happens — nothing is lost, and do NOT re-cut the version.**
The tag is correct and points at the right commit. Re-trigger `publish.yml` as a
human: Actions → "Publish to JSR" → Run workflow → ref `vX.Y.Z`. A `workflow_dispatch`
sets the actor to whoever clicked. **Re-running the failed run is not reliable** —
a re-run keeps the original `github.actor`, which is the bot that just failed.
The git-side alternative is `git push origin :refs/tags/vX.Y.Z` then
`git push origin vX.Y.Z`, which re-fires `push: tags` under the owner's
credentials.

The durable fix is a PAT secret for `auto-tag.yml`, or accepting that the safety
net only tags. Until one of those, **the tag push is the release trigger, and it
has to come from a human**.

## BREAKING CHANGES IN THIS RELEASE

Two changes to an exported type, plus one behavioural:

- **`Limits.initial` / `Limits.max` are `bigint`**, not `number` (T13.3). The fields are u64 for a
  64-bit memory or table, and a JS number is exact only to 2^53 — so a limit near the top of its
  range was silently ROUNDED and could not be encoded.
- **`Limits.pageSize` → `Limits.pageSizeLog2`** (T13.4). The wire field is the LOG2; the old name
  said bytes while the reader and writer both passed the raw value through.

Both breaks are deliberate: a consumer reading either as a number gets a compile error at the one
site that has to handle the wider range. Precedent — T7.4's `ValueType` and T12.6's
`WastAction.args`.

**They do NOT reach wasmtk.** wasmtk maps `"wabt"` to `jsr:@jrmarcum/wabt-ts@^1.3.5/compat`, and
the `/compat` facade exposes `wabt()`, `WabtModule`, `WasmModule`, `Features` and the option types —
no `Limits`, no IR. Verified by replaying their current call sites from `origin/main`. The caret
range accepts the release.

**A third, BEHAVIOURAL break in the same release:** `wasmValidate` / `validateModule` now enforce
the `Features` set (T13.10). Nine proposals used to be accepted regardless of the flag, so a caller
passing `defaultFeatures()` and feeding it a GC, threads, memory64, tail-call or EH module will now
get a rejection where it previously got success. That is the option finally working, but it IS a
behaviour change and belongs in the release notes. `wasm-validate` gained
`--enable-<feature>` / `--disable-<feature>` / `--enable-all` alongside it, because a gated
validator with no way to opt in would reject most modern wasm.

`README.md` carries a "Breaking change since v1.3.5" section for downstream consumers, including
the `features` example every caller now has to write.

## `deno publish --dry-run` is in CI but NOT in `deno task test`

It runs the **slow-types** check, which `deno task check` does not. Moving
`STRICT_NAME_DECODER` into `src/core/literal.ts` (T12.7) made it public API without an explicit
type annotation — a `missing-explicit-type` error that **339 passing tests and three full metric
runs never saw**, and that would have gone red on push.

**Run `deno task publish:dry` whenever a change ADDS or MOVES an exported symbol**, not only when
publishing. It is also what backs the Node compatibility claim: Node cannot run the sources
directly (`--experimental-strip-types` rejects `enum`), so the supported path is the transpiled JSR
package, and slow types are what make that transpilation possible.

## Never run `deno publish` locally

JSR provenance requires the GitHub Actions OIDC token. A local `deno publish` would succeed but
produce a release with **no provenance**, breaking the chain for that version. The only safe local
invocation is `deno task publish:dry` (`deno publish --dry-run --allow-dirty`) — it never uploads.

## Tag-driven publish flow

1. Bump `version` in `deno.json` and commit on `main` (use `deno task bump` — see the version rule
   below).
2. `deno task publish` runs [scripts/publish.ts]: **refuses if any path other than `deno.json` is
   dirty — untracked files included — and refuses if the tag already exists ON THE REMOTE**; then
   creates and pushes the matching `v<version>` tag (atomic commit + tag + push). A LOCAL tag is
   still force-written on purpose, so a run that died after tagging can be retried. The guards are
   `scripts/release-guard.ts`, tested in `tests/scripts/release_guard.test.ts` — `publish.ts`
   itself pushes at IMPORT time and so can never be imported by a test.
3. `.github/workflows/publish.yml` fires on the tag push — verifies the tag matches `deno.json`,
   type-checks, tests, then calls `deno publish` **directly inside the Actions runner** (a subprocess
   invocation would break JSR OIDC) so JSR stamps OIDC provenance, and finally creates a matching
   GitHub Release with auto-generated notes.

`.github/workflows/auto-tag.yml` is a safety-net workflow.

## Version rule — sub-version-capped-at-9

The minor/patch sub-version is capped at 9 before rolling over:
`1.0.9 → 1.1.0 → … → 1.2.7 → 1.2.8 → 1.2.9 → 1.3.0`. The `deno task bump` helper enforces this.
Mirrors the binaryen-ts release pattern.

## CI

`.github/workflows/ci.yml` runs `deno fmt --check`, `deno lint`, `deno task check`, `deno task test`,
and `deno publish --dry-run` on every push and PR to `main`.

## Repo hygiene (2026-05-25)

- `CLAUDE.md` and `TASKS.md` are **git-ignored** (local working notes, not published); JSR's
  `publish.include` allowlist already excluded them. By contrast, `cmem/` is **committed** portable
  memory that should travel with the repo — it is the shared source of truth that supersedes the
  gitignored `CLAUDE.md`. (It need not be in the JSR publish set; it is repo documentation, not
  shipped package source.)
- The repo was detached from the WebAssembly/wabt fork network on GitHub (Settings → Leave fork
  network).
- All three submodules (`upstream/`, `binaryen-ts/`, `wasmtk/`) were removed from git tracking; their
  working trees are kept as plain (.gitignored) directories cloned from the same URLs. Update with
  `git submodule update --remote <name>` style re-clones.
- Past commits referencing `CLAUDE.md` / `TASKS.md` were purged via `git filter-repo` (force-push) so
  public history is clean.

## Remote CLI usage

```sh
deno run -A jsr:@jrmarcum/wabt-ts/wat2wasm input.wat -o output.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm2wat input.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm-validate input.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm-objdump -d input.wasm
deno run -A jsr:@jrmarcum/wabt-ts/wasm-strip input.wasm -o stripped.wasm
```
