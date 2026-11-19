# review-process.md — binaryang's slots in the review standard

Summary: what the workspace's FINAL review standard (`../../workspace/cmem/review-process.md`, letter H37,
2026-11-17) needs to know about binaryang. The standard itself is not copied here: read it there.
Last verified 2026-11-18.

## The words, and the loop

- "review" runs the five required classes (basic, hardening, licensing, security, privacy); a class
  word runs one; "efficiency review" is optional and runs first. The words:
  [working-rules.md](working-rules.md) § "Owner commands".
- Reviewers run on Sonnet (owner, 2026-11-13), read-only, each in its own scratch folder; never
  kill a process by image name (other work on this machine runs node and bun).
- Issues, fixes, rejections and counts: the gitignored `review-issues.md`. A completed review ends
  with the line `review-complete: <sha>` there; `bun run release` refuses without it, or when a
  file other than the release files and `cmem/` changed since that commit.
- Fixes go on a local review branch, merged to `main` when the review completes.

## Private-data paths (never committed; the privacy gate refuses them tracked)

- `cmem/local/` — machine facts (paths, tools, account names).
- `cmem/review-issues.md` — the open review issues.
- `.claude/` — agent settings and sessions.
- `scripts/check-privacy.ts` scans the tracked tree, the built npm package (`--dir dist`) and
  commit messages (`--commits`); `privateFilesTracked` fails the scan if any path above is tracked.

## Reference results (re-derive before quoting; measured 2026-11-18)

- `bun run test` (V8, Node 24): 6765 pass, 0 fail. `bun run test:bun`: 0 fail, the list of
  JavaScriptCore differences EMPTY (`tests/bun-known-differences.json`; 36 until 2026-11-19).
- `bun run baseline`: 421 real-compiler modules byte-identical.
- Spec testsuite (260 `.wast`, from the sibling wasmtk checkout): 2256/2256 accepted, 2714/2714
  invalid rejected, 711/711 malformed binary, 1229/1229 malformed text, no misses.
- `direct`: 544/544 byte-identical to `wat2wasm`; `direct-behaviour`: 1953 calls in 468 of 544
  modules agree (76 not comparable, listed by reason); `optimize-corpus`: 2105 outputs valid;
  `spec-behaviour`: 57,808 invocations; `interp`, `lowering`, `proposals`, `translate-eh`, `hostile`.
- All in one command: `bun run gate` ([scripts/gate.ts](../scripts/gate.ts)).

## Support matrix and platform notes

- [platforms.md](platforms.md).

## Licence inventory and notices

- The project: `LICENSE` (MIT first — JSR reads it), `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE.md`
  (wabt's and binaryen's Apache notices); both ship in the JSR and npm packages.
- Ported files keep their upstream header and name their source; they are rewrites in TypeScript,
  not modified upstream files ([design-decisions.md](design-decisions.md) M6).
- Dependencies: `bun.lock`, all dev-only (0 runtime dependencies in either package).
- Decisions and obligations: [licensing.md](licensing.md).

## Outputs that can carry user facts

- Written modules: names come from the input (name section, WAT identifiers), never from the
  user's machine; no path, username or environment is embedded.
- The `.wit` file beside a bundle's output: names from the inputs.
- Error messages: the input's path as given on the command line, and the failing source line,
  both escaped (`printable`).
- `wasm-objdump`, `wasm-interp`: the module's own names, escaped.
- None reads the environment or makes a network request (README "## Privacy").

## The threat model (what the security class attacks)

- Untrusted INPUT is bytes and text: what the readers and parsers take, and CLI paths.
- A module built or edited through the API is the caller's own code: its bounds stay, but a forged
  module (a copy keeping an original's `loc`/`nodeId`, reused names, getters, Proxies) is not an
  attack (README "Limits on untrusted input").

## Items that do not apply, and why

- Security, "Sandbox boundary (runtimes)": binaryang is no WASI host; the interpreter calls only
  the imports its caller gives it. Its memory and table bounds are hardening items.
- Security, "Exploitable memory corruption": no unsafe, FFI, Zig or C code.
- Security, "Native library loading (loaders)": nothing is downloaded or loaded natively.
- Hardening, "Memory behavior … across FFI": no FFI.
- Licensing, fonts and images: none ship.
