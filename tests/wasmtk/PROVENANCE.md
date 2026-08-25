# `tests/wasmtk/` — what this corpus is, and when it was taken

**This directory is a FROZEN SNAPSHOT of another project's build output, not a live view of it.**
Read that before drawing any conclusion about wasmtk or its wasic compiler from what is in here.

|                                     |                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Source                              | [wasmtk](https://github.com/jrmarcum/wasmtk) — `.wat` emitted by its `wasic` TypeScript→WAT compiler |
| Files here                          | **272**                                                                                              |
| Files wasmtk's current corpus emits | **373** (as of 2026-08-24)                                                                           |
| Snapshot date                       | **2026-05-25 21:50:17 -0400** (recovered 2026-08-25, see below)                                      |
| Source commit                       | **`e147d28`** — wasmtk, 2026-05-25 11:25:15 -0400, "phase 22 stress test bug fixes"                  |
| Captured by                         | wabt-ts `fbafca9e` ("update"), which added 278 `.wat` in one commit; a same-day follow-up removed the 6 `$mathlib_*` pre-link files, leaving 272 |

## The provenance was RECOVERABLE, and the record was wrong about that

**Corrected 2026-08-25**, after the wasmtk team asked twice for a source + date stamp. This file
previously said the snapshot had "accreted file-by-file rather than taken at once" and that its
source commit was unknown. Both were wrong, and neither needed anything the wasmtk team had:

- `git log --diff-filter=A -- tests/wasmtk/*.wat` returns **exactly one commit**. The corpus is a
  single point-in-time capture, not an accretion.
- That commit is dated 2026-05-25 21:50 -0400. In the wasmtk repository the last commit before it
  is `e147d28` (11:25 the same day) and **the next is three days later**, so the window contains
  exactly one candidate.

Caveat worth keeping: this dates the capture, not the compiler. The files were generated from a
wasmtk WORKING TREE at or just after `e147d28`, and could include uncommitted local work. It is a
bound, not a guarantee — but a bound of one commit is not "unknown".

**"We do not know" was never checked.** The claim sat in this file for three months, was repeated
to the wasmtk team, and cost them two requests. The answer was one `git log` invocation in our own
repository.

## Why the provenance is the point

A snapshot answers questions whose answers change over time, and it answers them as of a date it
does not carry. That has now produced **three** wrong claims sent to the wasmtk team, not one:

> **2026-08-24.** We reported seven modules to the wasmtk team as _"genuinely invalid wasm — V8,
> Wasmtime and Wasmer all reject them"_, in the present tense. They rebuilt all seven from current
> wasic: every one is **valid and exits 0 on Wasmtime with correct output**. Verified on this side
> by recompiling them with the checked-out wasmtk (`deno run -A main.ts wasic
> <src>.ts`) — frozen
> bytes INVALID, current bytes valid, all seven.

> **2026-08-24, the EH scope.** We reported the legacy-`try` problem as affecting **6** modules.
> The real scope is **10** — our snapshot is missing four of them.

> **2026-08-24, `needsExceptionTag`.** We reported five modules declaring `$__exn_tag` and never
> using it. Derived by grepping the frozen files; **retracted** — it does not hold against current
wasic.

So `KNOWN_INVALID` in `runner.test.ts` — an assertion deliberately written to go red when wasic is
fixed, forcing the list to shrink — kept passing, because it was re-checking bytes that predate the
fix. **It masked the fix instead of tracking it, which is the inverse of its purpose.**

All three were the same mistake, and all three were caught by the recipient rather than by us. The
corpus is a fixture set that happens to look like evidence.

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
(all seven are fixed upstream) and expect the legacy-EH modules to change shape if wasic has
migrated to `try_table` by then (**10 of them upstream, of which this snapshot holds 6**) (see `scripts/wasmtk-eh-report.md`).
