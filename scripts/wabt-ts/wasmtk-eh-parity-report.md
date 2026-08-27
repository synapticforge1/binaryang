# Cross-runtime parity for wasic output — two independent asks

**From:** wabt-ts · **Date:** 2026-08-24 · **Status:** measured, reproducible

Follow-up to `scripts/wasmtk-eh-report.md` (the legacy-EH finding you confirmed and queued). Since
then we ran the whole corpus against every runtime installed here, which turned up a **second,
cheaper** portability item that is independent of the EH migration — plus one thing we want to
explicitly ask you **not** to change.

---

## What was measured

All 272 files of `wabt-ts/tests/wasmtk/` compiled by wabt-ts, then loaded by each runtime. Encode is
**272 / 272** — nothing below is a wabt-ts defect.

| runtime                     | loads         | what fails              |
| --------------------------- | ------------- | ----------------------- |
| V8 (Deno / Node 24.19)      | **265 / 272** | 7                       |
| Bun 1.3.14 (JavaScriptCore) | **265 / 272** | the same 7              |
| Wasmtime 47.0.3             | **259 / 272** | those 7 + 6             |
| Wasmer 7.2.1                | **259 / 272** | **exactly the same 13** |
| wazero 1.12.0               | **251 / 272** | those 13 + 8            |

The **7** are the `KNOWN_INVALID` files. **We are not reporting those** — you established they are
fixed in current wasic and our snapshot is frozen at bytes that predate the fix. They appear here
only to explain the arithmetic.

**Wasmer independently reproduces Wasmtime's verdict file-for-file** on the 6
(`legacy_exceptions feature required for try instruction`). That is a second authority agreeing,
from a different codebase, that the legacy encoding is the blocker.

---

## Ask 1 — the `try_table` migration reaches parity (confirming, not new)

> **BLOCKED ON US — read the reply section at the bottom before acting on this.** The claim below
> that "nothing is needed on our side" is true of wabt-ts `main` and FALSE of v1.3.5, which is what
> your `deno.lock` pins: there the binary writer fails every named catch form with `unresolved
> name-var`. Fixed by `d30b8599` (2026-08-21), shipping in v1.4.0. The migration cannot land
> against a released wabt-ts until then.

Already your top item; this just prices it. Four minimal modules, every runtime:

| shape                                 | V8     | Bun    | Wasmtime   | Wasmer     | wazero     |
| ------------------------------------- | ------ | ------ | ---------- | ---------- | ---------- |
| legacy `try`/`catch` — emitted today  | accept | accept | **REJECT** | **REJECT** | REJECT     |
| `try_table`                           | accept | accept | **accept** | **accept** | REJECT     |
| a tag declared, nothing references it | accept | accept | accept     | accept     | **REJECT** |
| no tag section at all                 | accept | accept | accept     | accept     | **accept** |

Row 2 is the answer: `try_table` is accepted by both engines that reject the legacy form, **and
costs nothing on V8/Bun**, which take either. On our snapshot that is 259 → 265, exactly V8's and
Bun's number.

wabt-ts supports `try_table` end to end — parser (folded and linear), binary reader/writer,
validator, WAT writer — so nothing is needed on our side.

> Your correction still stands: the real scope is **10 modules, not 6**; our snapshot is missing
> four. The denominator differs, the conclusion does not.

---

## Ask 2 — `needsExceptionTag` fires without emitting anything (new, cheap)

> **RETRACTED — do not act on this section.** It was derived by grepping our FROZEN snapshot and
> then stated in the present tense about current wasic. It does not reproduce: all five modules
> genuinely throw. wazero stays at 251; the projected 251 → 256 does not happen. See the reply
> section at the bottom.

Five modules in the snapshot declare `$__exn_tag` and **never reference it again** — the string
occurs exactly once, the declaration:

```
15_panic   46_BasicEscapeSeqs   46_HexUnicodeEscapes
46_Phase46Combined              46_TemplateEscapes
```

No `throw`, no `catch`, no `try_table`, and no promise machinery (`grep -ci
promise|reject|async` =
0 in all five). They fail on wazero _purely_ for the tag section, and rows 3 vs 4 above show that is
the whole cost: the same module without a tag section loads.

**The gate is already there and is correct — it is firing without its output.** `src/wasic.ts:20010`
(origin/main, 2026-08-10):

```ts
this.needsExceptionTag ? `  (tag $__exn_tag (export "__exn_tag") (param i32 i32))` : "",
```

and the flag is set at exactly three sites, every one of which also emits WAT:

| line  | trigger                     | also emits               |
| ----- | --------------------------- | ------------------------ |
| 10907 | `throw <expr>`              | `(throw $__exn_tag …)`   |
| 14720 | `try` / `catch` / `finally` | `(catch $__exn_tag …)`   |
| 7870  | `Promise.reject(...)`       | promise runtime + reject |

In these five modules **none of that WAT is present**, so the flag was set and its output was not.
Two candidates we cannot tell apart from WAT alone — the `.ts` sources are not in our snapshot:

1. the `throw`/`catch` lived in code that was ultimately not emitted; or
2. `needsExceptionTag` is a plain instance field (`private needsExceptionTag = false`, line 1600)
   and is **not reset between compilations** — which would explain a tag turning up in
   escape-sequence tests that contain no EH at all.

If (2), the fix is a reset alongside the other per-compilation state. If (1), the flag wants setting
at EMIT time rather than at parse/analysis time.

**Worth ~5 modules on wazero at zero cost, and independent of Ask 1** — it needs no encoding change
and cannot regress the other four runtimes, which accept a stray tag section happily.

---

## Please do NOT drop `(export "__exn_tag")`

We considered suggesting it and then found it is load-bearing — `src/utils.ts:317-333` reads it:

```ts
const tag = wasiInstance?.exports.__exn_tag as ...;
if (tag && err.is(tag)) {
  const ptr = err.getArg(tag, 0), len = err.getArg(tag, 1);
  const msg = new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len));
  rt.stderr.writeSync(... `error: Uncaught (in Wasm) Error: ${msg}\n`);
}
```

An exported tag is the only way JS can obtain a module's `WebAssembly.Tag`, so without it an
uncaught wasic throw degrades from a readable message to an opaque trap. **And it would not buy
anything on wazero regardless — wazero rejects the tag SECTION, not the export.** The two are
independent: keep the export, and fix the flag so the section is absent when nothing uses it.

---

## What neither ask reaches

Three modules genuinely `throw` and so genuinely need a tag — `13_SecureMatrixManagerIntegration`,
`15_Trap-On-Error`, `6b_testing-and-benchmarking`. wazero's **CLI** refuses any tag section
regardless of encoding; its Go embedding API has feature toggles the CLI does not expose. A
wazero-hosted wasic program that uses exceptions needs the embedding API, whichever EH encoding it
emits. Worth knowing before wazero is promised as a target.

Expected end state on our snapshot: Wasmtime/Wasmer **265**, wazero **256**, V8/Bun **265** — with
the residual 7 already fixed on your side.

---

## Reproducing

```sh
# Wasmtime — list the proposals; `-W all-proposals=y` pulls in stack-switching
# and fails on a stock Windows build for reasons unrelated to the module.
wasmtime compile -W gc=y,function-references=y,exceptions=y,memory64=y,\
multi-memory=y,threads=y,relaxed-simd=y,tail-call=y,extended-const=y,\
custom-page-sizes=y,wide-arithmetic=y  mod.wasm -o mod.cwasm

# Wasmer — NOT `--enable-all`, and not these three: --enable-tail-call,
# --enable-multi-memory and --enable-memory64 are accepted as flags and
# implemented by no backend, so any one of them makes the ENGINE refuse every
# module, including `(module (memory 1) (func))`. The error reads exactly like a
# module-level rejection; it cost us a 0/272 run that looked like our bug.
wasmer validate --enable-simd --enable-threads --enable-reference-types \
  --enable-multi-value --enable-bulk-memory --enable-exceptions \
  --enable-relaxed-simd --enable-extended-const --wide-arithmetic  mod.wasm

wazero compile mod.wasm
node -e 'WebAssembly.validate(require("fs").readFileSync("mod.wasm"))'
```

`deno task engine-check <dir-of-wasm>` in wabt-ts runs Wasmtime + V8 + Wasmer with the right flags
and self-tests against a known-invalid module first.

**Caveats on our side, stated so you can discount them:** `tests/wasmtk/` is a frozen 272-file
snapshot (you emit 373 now) with no recorded source commit, so every filename above is _our_ copy
and current wasic may differ. Line numbers are from `origin/main` at 2026-08-10 and drift — the
shapes are `mergeOneWasmImport`, `needsExceptionTag`, and the `utils.ts` uncaught-error path.

---

# Reply received 2026-08-24 — one ask confirmed with a blocker ON US, one retracted

wasmtk checked both asks against **current wasic** rather than accepting them. Both results are
re-verified here.

## Ask 1 — confirmed, and the blocker is ours

> _"'wabt-ts supports `try_table` end to end; nothing needed on our side' isn't true of 1.3.5, which
> is what `deno.lock` pins."_

**They are right, and the report's claim was wrong.** It was measured on `main` and stated in the
present tense about a released version. Re-derived against the v1.3.5 tag in a clean worktree:

| form                    | v1.3.5 (pinned)                       | `main`  |
| ----------------------- | ------------------------------------- | ------- |
| bare `try_table`        | encodes                               | encodes |
| `(catch $tag $lbl)`     | **THROWS** `unresolved name-var "$e"` | encodes |
| `(catch 0 0)` numeric   | encodes                               | encodes |
| `(catch_ref $tag $lbl)` | **THROWS**                            | encodes |
| `(catch_all $lbl)`      | **THROWS** `unresolved name-var "$h"` | encodes |
| `(catch_all_ref $lbl)`  | **THROWS**                            | encodes |
| multi-catch             | **THROWS**                            | encodes |
| legacy `try`/`catch`    | encodes                               | encodes |

Exactly their finding: **at the pinned version wabt-ts can emit only the form Wasmtime refuses.**

**Fixed by `d30b8599` — "Fix packed-type wire bytes, br_table and try_table name resolution",
2026-08-21.** Bisected against its parent `7f84d430` (same day, 17 minutes earlier), which throws on
every named catch form. `resolveNames` was not resolving a `try_table` catch clause's tag or target,
so the binary writer's fail-loud `writeVar` path fired.

**It is UNRELEASED.** `deno.json` still reads `1.3.5`, so the fix exists only on `main`. Verified
end to end on `main`: `catch`, `catch_all` and multi-catch modules are accepted by **Wasmtime, V8
and Wasmer, 3/3, zero disagreements**.

→ **The migration is blocked solely on a wabt-ts version bump.** Nothing else is needed on either
side.

## Ask 2 — RETRACTED, and it was the frozen snapshot again

> _"All five modules genuinely throw, and current wasic emits the throw …
> `tag_occurrences=2 throws=1`."_

**Withdrawn.** The finding was derived by grepping `wabt-ts/tests/wasmtk/*.wat`, which is a **frozen
snapshot with no recorded source commit** — the exact thing `PROVENANCE.md` and our own notes forbid
drawing present-tense wasic conclusions from. Third time this week after the `KNOWN_INVALID` seven
and the 6-vs-10 EH scope, and this one was ours.

Consequences, as they state them and we accept:

- The five modules legitimately need a tag; there is no dead tag to remove.
- **`needsExceptionTag` is not firing spuriously** — the flag is set because there is a throw, and
  the throw is emitted. Both candidate causes we offered are void.
- **The projected wazero 251 → 256 does not happen.** wazero stays at 251, because the modules keep
  their tag and wazero's CLI rejects any tag section — which was our own finding, applied against a
  wrong premise.

Corrected expectation on our snapshot after the EH migration: Wasmtime and Wasmer **265**, V8 and
Bun **265**, wazero **251**. Only the 3-vs-8 split inside wazero's number changes, and only if wasic
ever stops emitting a tag it does not use — which, on current wasic, it does not.

## Both engine-flag traps confirmed as received

Recorded on their side, including `wasmer --enable-all` refusing `(module (memory 1) (func))` with
an error worded as a module rejection.

## Standing correction to our method

Two mirror-image errors in one report, worth stating together because the fix is the same:

- **Ask 2** stated a present-tense fact about wasic from a frozen snapshot.
- **Ask 1** stated a present-tense fact about a RELEASED wabt-ts version from `main`.

Both are "I tested a tree, and reported about a different tree." The rule was already written for
the first direction; it now reads in both: **name the ref you measured, and check it is the ref the
reader will run.**
