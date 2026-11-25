# platforms.md — where binaryang runs, and what each platform needs

Summary: the support matrix (workspace review standard, letter H37 § 12) and the notes for each
platform ID that has something to say. Settings stay in the code, each tagged with its platform ID
(search for `win-x64` …). Last verified 2026-11-19.

binaryang ships SOURCE (TypeScript, on JSR and npm): no native build, nothing per platform. So no
glibc or musl target applies (the workspace's Linux baseline is for native builds), and no 32-bit
build is made or claimed.

**Per engine, and `host` per OS** (workspace letter H39, owner, 2026-11-19: "that way we do not
over test something"). What binaryang computes is tested per ENGINE on one machine: V8 (Node,
Deno) and JavaScriptCore (Bun); the runtimes hide the OS and the CPU from pure TypeScript, and
a `.wasm` is the same bytes everywhere. Every OS call is in `src/host.ts`; `bun run portability`
fails on one anywhere else. OS testing concerns `host` alone: on an OS when its machine is at
hand, and again only when `host` or the pinned runtime changes; a release that changed neither
carries the last result. An OS not yet run is checked when met, with `binaryang --self-check`.
Status `runtime`: covered by the runtime and by `host`'s result for that OS.

## Support matrix

| Platform | Status | Target name | Tested on |
| --- | --- | --- | --- |
| win-x64 | tested | n/a (source) | dev machine; `--self-check` 10/10 on Bun, Node 24, Deno 2.9.8 |
| win-arm64 | runtime | n/a (source) | win-x64's `host` result (H39) |
| mac-x64 | pending | n/a (source) | — (the Intel Mac, when it exists) |
| mac-arm64 | runtime | n/a (source) | mac-x64's `host` result once run (pending until then) |
| linux-x64 | tested | n/a (source) | dev machine, Ubuntu under WSL; `--self-check` 10/10 on Bun |
| linux-arm64 | runtime | n/a (source) | linux-x64's `host` result (H39) |

## Runtimes and browsers (the second axis)

| Runtime | Version | win-x64 | linux-x64 |
| --- | --- | --- | --- |
| Bun | 1.4.4, memory64 on (`BUN_JSC_useWasmMemory64=1`) | full suite (both legs) | full Bun leg, corpora |
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
  Where: `src/host.ts` `fsWrite` (review H-2, 2026-11-18).
- **Bun 1.4.4 named pipes** (reported to Bun by the owner, 2026-11-19): a pipe server's `write()`
  chained from a write callback hangs the event loop, and `write()` never returns `false`. The
  endless-device test serves its pipe from Node 24, started directly (killing `fnm exec` leaves
  its node running). Bun READING a pipe is fine. Where: `tests/wabt-ts/tools/cli_file_safety.test.ts`.
- **Deno refuses `writeFile` on a device** (EISDIR: it opens with create / truncate) and accepts
  an `r+` open; Bun and Node accept both. So `-o NUL` failed on Deno through 4.0.0. Found by
  `--self-check` (2026-11-19, Deno 2.9.8). Where: `src/host.ts` `fsWrite`.
- **Case-insensitive paths.** One file may be named in two cases. Where: `src/host.ts`
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

- **Case-insensitive APFS** by default. Where: `src/host.ts` `sameFile`.

## linux-x64

- **Bun and fnm in this WSL, with every current Node LTS line** (fnm 1.39.0; Node v22.23.5,
  v24.22.3 default, v26.13.1; installed 2026-11-20 on the owner's word; `~/.bashrc` loads it, so
  run through `bash -lic`). Deno runs on win-x64 only. A Linux run covers the Bun leg, the V8 leg
  (`bun run test`, the Node 24 referee), `bun run lts` (every current LTS line, the same CLI
  output — first run 2026-11-20: v22, v24, v26 all `7dbdcd45…`, as on win-x64), the byte
  baseline, the spec suite, the interpreter checks and the privacy scan. A line that becomes LTS
  needs `fnm install <major>` here too, or `bun run lts` fails naming it.
- **The reference tools in this WSL** (installed 2026-11-20 on the owner's word, the same versions as
  win-x64, under `~/.local/opt`, on PATH from `~/.bashrc`): binaryen 133 (`wasm-opt`), wabt 1.0.41
  (`wat2wasm`, `wast2json`), wasm-tools 1.263.0 (sha256 checked for the first two; wasm-tools
  publishes none). So a Linux run prepares the spec corpus itself and runs the `wat2wasm` and
  size-ratchet steps. Last full Linux run 2026-11-25 at 977cf27ab: every step passed.
- **A fresh clone has no `upstream/binaryen/test`** (gitignored): corpus_roundtrip fails, by design,
  until it is copied in — `cp -r /mnt/d/…/binaryang/upstream/binaryen/test upstream/binaryen/`
  (2026-11-19). From Git Bash, pass `MSYS_NO_PATHCONV=1` to `wsl -e <cmd> /home/…`, or the
  Linux path is rewritten into a Windows one.
