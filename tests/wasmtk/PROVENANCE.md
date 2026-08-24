# `tests/wasmtk/` — what this corpus is, and when it was taken

**This directory is a FROZEN SNAPSHOT of another project's build output, not a live view of it.**
Read that before drawing any conclusion about wasmtk or its wasic compiler from what is in here.

|                                     |                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Source                              | [wasmtk](https://github.com/jrmarcum/wasmtk) — `.wat` emitted by its `wasic` TypeScript→WAT compiler |
| Files here                          | **272**                                                                                              |
| Files wasmtk's current corpus emits | **373** (as of 2026-08-24)                                                                           |
| Snapshot date                       | unknown — accreted file-by-file rather than taken at once                                            |
| Source commit                       | **unknown** — see below                                                                              |

## Why the missing provenance is the point

Files were added here one at a time as wasic surfaced new shapes, so there is no single commit this
corresponds to. That was invisible for as long as nobody asked a question whose answer changes over
time — and then it produced a wrong claim in a bug report we sent upstream:

> **2026-08-24.** We reported seven modules to the wasmtk team as _"genuinely invalid wasm — V8,
> Wasmtime and Wasmer all reject them"_, in the present tense. They rebuilt all seven from current
> wasic: every one is **valid and exits 0 on Wasmtime with correct output**. Verified on this side
> by recompiling them with the checked-out wasmtk (`deno run -A main.ts wasic
> <src>.ts`) — frozen
> bytes INVALID, current bytes valid, all seven.

So `KNOWN_INVALID` in `runner.test.ts` — an assertion deliberately written to go red when wasic is
fixed, forcing the list to shrink — kept passing, because it was re-checking bytes that predate the
fix. **It masked the fix instead of tracking it, which is the inverse of its purpose.**

wasmtk hit the same pattern independently within the same week (a frozen vendored
`proposals/threads/` snapshot read as a live signal). Neither was carelessness: **a snapshot is
indistinguishable from current data unless something records its provenance.** Hence this file.

## Rules

1. **Never state a present-tense fact about wasic from these files.** They support "this input shape
   once existed and our toolchain handles it", which is what a fixture corpus is for. They do not
   support "wasic emits X" or "wasic has bug Y".
2. **Re-derive before reporting upstream.** Rebuild from the wasmtk checkout first; see below.
3. **Stamp any refresh** — update the table above with the wasmtk commit and date, in the same
   change that moves the files.

## Refreshing

wasmtk's corpus is a build artifact, not committed, so it has to be regenerated:

```sh
cd wasmtk
deno run -A main.ts wasic tests/wasi/wasm_wasi/<name>.ts -o <out>/<name>.wasm
# ... writes <name>.wat alongside; that is what belongs here
```

A full refresh is 373 modules and moves the WASI round-trip denominator, so it is its own change
with its own re-measurement — not a drive-by. When it happens, expect `KNOWN_INVALID` to empty out
(all seven are fixed upstream) and expect the six legacy-EH modules to change shape if wasic has
migrated to `try_table` by then (see `scripts/wasmtk-eh-report.md`).
