# Publishing — JSR provenance

Merged topic file, **partial**. This covers provenance only. The rest of the release process is
still wing-scoped in [binaryen-ts/publishing.md](binaryen-ts/publishing.md) and
[wabt-ts/publishing.md](wabt-ts/publishing.md), because the two release scripts are not yet
reconciled and a merged document would describe a flow that does not exist. See
[INDEX.md](INDEX.md).

## The one thing to understand

**Provenance fails silently, and a green publish run is not proof.**

`deno publish` skips attestation **non-fatally** when it cannot mint or submit the GitHub OIDC
token. The run succeeds, the version publishes, the release is created, and provenance is simply
absent. JSR versions are immutable, so by the time anyone notices, it cannot be fixed for that
version.

**The only evidence is JSR's `rekorLogId`**:

```sh
curl -s -H 'Accept: application/json' \
  https://api.jsr.io/scopes/jrmarcum/packages/<name>/versions/<version> | grep rekorLogId
```

`.github/workflows/publish.yml` polls exactly that as its **last** step and fails the job when it
comes back null. Last, deliberately: the version exists either way, so failing there surfaces the
problem loudly without blocking the publish or the GitHub release.

⚠️ **The OIDC availability step is NOT that evidence.** It checks a prerequisite — whether
`ACTIONS_ID_TOKEN_REQUEST_URL`/`_TOKEN` reached the runner. wasmtk got **ten releases of false
assurance** from exactly that step: it emitted no warning and provenance was absent anyway. It is
kept because when it _does_ fail it names the cause immediately (org/enterprise Actions OIDC
policy), which is otherwise invisible.

## Do not "fix" provenance by editing the YAML

Measured 2026-08-26: **binaryen-ts's `publish.yml` is byte-identical at `v1.4.3` (no provenance) and
at `v1.5.0` (provenance).** Same `id-token: write`, same direct `deno publish`. The workflow is not
the variable, and editing permissions or restructuring the job is motion without effect.

The structural requirements are already met and worth stating once so they are not re-litigated:

- `permissions: id-token: write` (plus `contents: write` for checkout and the GitHub Release)
- `deno publish` called **directly**, never through `deno task publish` — the task wraps a script
  that spawns `deno publish` via `Deno.Command`, and OIDC detection does not propagate into the
  subprocess
- no `--token` / `DENO_AUTH_TOKEN` (their presence disables OIDC), and no `--no-provenance`
- the JSR package linked to the GitHub repo — ✅ verified for `@jrmarcum/binaryang`

⚠️ The inherited version of this comment cited **wasmtk** as precedent for calling `deno publish`
directly. wasmtk has **no provenance on any published version**, so it was never evidence for
anything. Corrected rather than repeated.

## Measured history, 2026-08-26

Read from the JSR API across the scope. This is the useful part, because it shows the failure is
**intermittent and per-package**, not a setting anyone got wrong:

| package         | provenance                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **wabt-ts**     | present on 1.5.0 (2026-08-26), 1.4.1, 1.4.0, 1.3.5, 1.3.4, and back to 1.2.7 — **one isolated gap at 1.3.3 (2026-06-10)** |
| **binaryen-ts** | present at 1.3.1–1.3.3, then **dark from 1.3.5 (2026-06-10) through 1.4.3 (2026-07-09)**, recovered at 1.5.0 (2026-08-25) |
| **wasmtk**      | last attested release **1.11.2 (2026-07-03)**; dark ever since, including 2.0.0                                           |

Two things follow that neither project had established:

🆕 **Provenance works on this account and scope right now.** Two packages were attested on
2026-08-25 and 2026-08-26. Whatever broke wasmtk is not a global JSR or GitHub change — which is the
leading hypothesis in `wasmtk/cmem/design-decisions.md` ("remaining suspects: JSR-side or
GitHub-side changes in the 2026-07-03 → 07-09 window"). That window is refuted by these dates, and
it is worth telling them, because it is an open investigation that has already ruled out the Deno
version.

🆕 **Both siblings lost provenance on the same day — 2026-06-10.** wabt-ts at 1.3.3 and binaryen-ts
at 1.3.5. wabt-ts recovered on its next release; binaryen-ts stayed dark for a month. A shared
single-day failure across two independent repos reads as transient infrastructure, not configuration
— and binaryen-ts's month-long tail then looks like nobody re-checked, rather than like a second
cause.

## `--allow-slow-types` was removed

binaryen-ts passed `--allow-slow-types` because `interop/binaryen-js.ts`'s `BinaryenInterop.create`
does a runtime-configurable `await import(path)`, which JSR cannot statically resolve.

**Measured 2026-08-26: the merged tree passes the slow-types check without it.** Keeping it is not
neutral — JSR's own warning says a slow-types package ships **no `.d.ts` for Node users**, and Node
support is one of binaryang's published capabilities.

It also closed a gate mismatch: CI's dry-run ran `deno publish --dry-run --allow-dirty` while the
real publish ran `deno publish --allow-slow-types`, so the gate was verifying a different
configuration from the one that ships. They now run the same command.

## The verification step was tested against both sides

Not assumed to work. Its logic was run against four real published versions before being wired in:

|                     |                         |
| ------------------- | ----------------------- |
| `wabt-ts@1.5.0`     | PASS — Rekor 2603257282 |
| `binaryen-ts@1.5.0` | PASS — Rekor 2590420167 |
| `binaryen-ts@1.4.3` | FAIL — no provenance    |
| `wasmtk@2.0.0`      | FAIL — no provenance    |

A check that has only ever been seen to pass is a claim, not a gate.
