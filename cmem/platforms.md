# platforms.md — where binaryang runs, and what each platform needs

Summary: the support matrix (workspace review standard, letter H37 § 12) and the notes for each
platform ID that has something to say. Settings stay in the code, each tagged with its platform ID
(search for `win-x64` …). Last verified 2026-11-18.

binaryang ships SOURCE (TypeScript, on JSR and npm): no native build, nothing per platform. So no
glibc or musl target applies (the workspace's Linux baseline is for native builds), and no 32-bit
build is made or claimed.

## Support matrix

| Platform | Status | Target name | Tested on |
| --- | --- | --- | --- |
| win-x64 | tested | n/a (source) | dev machine |
| win-arm64 | pending | n/a (source) | — (no machine yet) |
| mac-x64 | pending | n/a (source) | — (the Intel Mac, when it exists) |
| mac-arm64 | pending | n/a (source) | — (the arm64 Mac, when it exists) |
| linux-x64 | tested | n/a (source) | dev machine, Ubuntu under WSL |
| linux-arm64 | pending | n/a (source) | — (no machine yet) |

## Runtimes and browsers (the second axis)

| Runtime | Version | win-x64 | linux-x64 |
| --- | --- | --- | --- |
| Bun | 1.4.4 | full suite (both legs) | full Bun leg, corpora |
| Node | 22.18, 24, 26 (LTS lines) | V8 test leg on 24; `lts` on all three | not installed there |
| Deno | 2.9.6 (npm, locked) | CLI smoke, JSR dry run | not installed there |
| Browsers | Chromium, Chrome, Edge, Firefox, Safari | `bun run browsers --require-all` | — |
| Browsers | Brave, Opera | pending (not installed) | — |

## Linux distros (linux-x64)

| Distro | Version | How |
| --- | --- | --- |
| Ubuntu | 26.04.1 LTS | WSL on the dev machine: a fresh clone, its own `bun install` |

## win-x64 / win-arm64

- **Reserved device names.** `CON PRN AUX NUL COM1-9 LPT1-9` (bare, any case) are devices; Bun's
  `writeFile` by the plain name creates a FILE named `NUL` (Windows 11 26300). Written by the
  device path `\\.\NAME`; `/dev/null` maps to NUL. Windows 11 no longer reserves `nul.wasm`.
  Where: `src/cli/io.ts` `fsWrite` (review H-2, 2026-11-18).
- **Case-insensitive paths.** One file may be named in two cases. Where: `src/cli/io.ts`
  `sameFile` (with mac-x64 / mac-arm64).
- **`.exe` on installed tools.** Where: `scripts/check-lint-canary.ts`, `check-fmt-canary.ts`,
  `npm/prove.ts`, `definitions.ts`.
- **No process groups.** A probe's browser helpers are stopped by command line. Where:
  `scripts/probe/engines.ts`.
- **Ctrl-C during `bun run gate`: UNMEASURED.** Bun reports a child's exit code in 8 bits, so a
  console Ctrl-C's 0xC000013A cannot be seen; on linux-x64 a step ended by SIGINT stops the gate
  and removes its temp corpora (measured 2026-11-18). Where: `scripts/gate.ts` (review RB2-1).
- **A shared `node_modules` is per-OS.** Run from the Windows checkout, WSL has only the win32
  Deno binary: a Linux run needs its own clone and `bun install` (measured 2026-11-18).
- **The coalesce budget test under load.** `coalesce_budget.test.ts` "at the budget …" (20 s
  bound) took 20.7 s and 23.6 s inside a busy `bun run gate`. Alone it is 8.6 s, and 8.4 s at the
  round-2 merge `927cd1cdc`: load, not a regression (2026-11-18). The next gate passed 31/31.

## mac-x64 / mac-arm64

- **Case-insensitive APFS** by default. Where: `src/cli/io.ts` `sameFile`.

## linux-x64

- **Only Bun in this WSL.** The V8 test leg and Deno run on win-x64; a Linux run covers the Bun
  leg, the byte baseline, the spec suite, the interpreter checks and the privacy scan.
- **No `wast2json` or `wasm-tools` in this WSL:** `spec-prepare` there skips every file and the spec
  and interpreter checks then pass EMPTY. Prepare the corpus on win-x64 and run the checks on it
  from Linux (done for the 4.0.0 review, 2026-11-18).
