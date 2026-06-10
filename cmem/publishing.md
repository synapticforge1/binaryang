# Publishing & release flow

Published as **`@jrmarcum/wabt-ts`** on JSR. GitHub remote: `github.com/jrmarcum/wabt-ts`. Current
version: **v1.3.0** (binaryen-ts pinned at v1.0.9).

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
