# Publishing & release flow

Published as **`@jrmarcum/wabt-ts`** on JSR. GitHub remote: `github.com/jrmarcum/wabt-ts`.
`deno.json` reads **v1.3.5**; the import map pins binaryen-ts at `^1.0.9` while the checkout is
v1.3.5+ (the caret accepts it — a stale pin, not a break).

## ⚠️ UNRELEASED BREAKING CHANGES — a bump is pending (2026-08-24)

Two changes to an exported type are committed and **not yet published**, so
`deno.json`'s version no longer describes what is on `main`:

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

`README.md` carries a "Breaking change since v1.3.5" section for downstream consumers.

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
2. `deno task publish` runs [scripts/publish.ts]: refuses if the working tree is dirty or the tag
   already exists, then creates and pushes the matching `v<version>` tag (atomic commit + tag +
   push).
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
