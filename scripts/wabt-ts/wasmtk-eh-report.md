# Ready-to-send prompt for the wasmtk team — wasic emits the _legacy_ exception-handling proposal

Written 2026-08-24 from the wabt-ts side. Mirrors the direction of
`wasmtk/scripts/wabt-ts-bug-report.md`, which came the other way on 2026-07-02.

Everything below was measured, not inferred. Paste from the horizontal rule down.

> **Answered 2026-08-24 — confirmed, with three corrections and one retraction against us.** The
> body below has been corrected in place; see "What came back" at the end for what we got wrong and
> why. The finding itself stands: wasmtk reproduced it, verified both load-bearing premises
> independently, and has the `try_table` migration queued as their top item with the Wasmtime gate
> alongside it.

---

## Prompt

You are working in the **wasmtk** repo. This is a bug report from the sibling **wabt-ts** project,
which uses wasmtk's `tests/wasmtk/` WAT corpus (272 files, 270 of them importing
`wasi_snapshot_preview1`) as its real-world conformance yardstick.

Please read this, confirm it against the code, and record it in `cmem/compiler-bugs.md` per that
file's convention. The fix is in `src/wasic.ts`; it is well bounded and there is a proven target.

### The finding

**wasic emits the superseded _legacy_ exception-handling proposal for every TypeScript `try` /
`catch` / `finally` / `throw`. Wasmtime cannot run it, and Wasmtime is the primary WASI Preview 1
and Preview 2 host.**

**Ten** corpus modules are affected. Six are visible in our copy — which is a frozen 272-file
snapshot; wasmtk's live corpus is 373, and they identified four more:

```
15_Exceptions                             56_AsyncReject         (wasmtk-side)
15_IdiomaticCatch_Stress                  60_AsyncAll            (wasmtk-side)
15_LexicalShadowing_Stress                64_ReportModuleTryCatch (wasmtk-side)
15_TestCase1-NestedEscalation             64_ReportThrowTemplate (wasmtk-side)
15_recover
18_Multi-ScopeScaleAndMemoryLongevityTest
```

Wasmtime 47.0.3 rejects each at compile time:

```
Error: failed to compile: wasm[0]::function[10]
Caused by:
    0: WebAssembly translation error
    1: Invalid input WebAssembly code at offset 823:
       legacy_exceptions feature required for try instruction
```

### Three things that make this worth acting on rather than filing

**1. It is not a feature gate you can switch on.** Unlike the `multiple memories` / `memory64` /
`gc` rejections seen elsewhere in this corpus, `wasmtime -W` has **no `legacy-exceptions` option at
all** — only `exceptions`, which is the _standard_ proposal (`try_table` / `exnref`). Wasmtime 47
does not implement legacy EH in any configuration.

**2. V8 accepts it, which is exactly why nobody noticed.** Both projects' harnesses used V8 as the
oracle, and V8 still supports legacy EH. The wasmtk suite passes and the wabt-ts corpus gate passes.
Putting the corpus to **Wasmtime and Wasmer as well** is what surfaced it — the standing rule on the
wabt-ts side is now "three engines, Wasmtime decides."

**3. It is not a wabt-ts bug and not a round-trip artifact.** wabt-ts supports legacy `try` end to
end _because_ wasic emits it (parser, binary reader/writer, validator, WAT writer). All six modules
round-trip **byte-identically** through `wat2wasm → wasm2wat → wat2wasm`. They go in rejected by
Wasmtime and come out rejected by Wasmtime. Nothing downstream changes them.

### The fix: emit `try_table` instead

Verified on this machine — both forms compiled with wabt-ts, then put to Wasmtime 47.0.3 and V8
(deno 2.9.5 / v8 15.0.245.2):

| shape                                            | wabt-ts | V8     | **Wasmtime** |
| ------------------------------------------------ | ------- | ------ | ------------ |
| legacy `(try (do …) (catch $tag …))`             | valid   | accept | **REJECT**   |
| legacy `(try (do …) (catch_all … (rethrow 0)))`  | valid   | accept | **REJECT**   |
| `try_table` + `(catch $tag $h)`                  | valid   | accept | **accept**   |
| `try_table` + `(catch_all_ref $h)` + `throw_ref` | valid   | accept | **accept**   |

**Wasmtime accepts the `try_table` forms with no `-W` flags at all** — `exceptions` is on by default
in 47.0.3. Both `try_table` forms also round-trip byte-identically through wabt-ts, so the toolchain
is ready for them today.

wasic emits **two** legacy shapes, so the migration surface is smaller than we first said
(`src/wasic.ts` — the doc block at ~107–111, and the emitter at **14749 / 14756 / 14772 / 14774**):

| wasic emits today                        | replace with                                     |
| ---------------------------------------- | ------------------------------------------------ |
| `(try (do B) (catch $__exn_tag H))`      | `try_table` + `(catch $__exn_tag $h)`            |
| `(try (do B) (catch_all H (rethrow 0)))` | `try_table` + `(catch_all_ref $h)` + `throw_ref` |

A bare `(catch_all H)` with no `rethrow` — which an earlier draft of this report listed as a third
shape — is **never emitted**: `catch_all` is generated only inside the `hasFinally` branch and
always carries `(rethrow 0)`. Corpus-verified by wasmtk: 2 occurrences, both with rethrow.

**No `delegate`** — wasic never emits it, so nothing needs an equivalent for it. `rethrow` appears
in two corpus files (`15_Exceptions`, `15_TestCase1-NestedEscalation`), both via the `finally` path.

**The one structural change:** in legacy `try`, a catch clause is an inline _handler_. In
`try_table`, a catch clause is a _branch target_ — the handler body moves out of the try into an
enclosing block, and the tag's params arrive as that block's results. So:

```wat
;; today — wasic output
(try
  (do (call $mayThrow))
  (catch $__exn_tag
    (local.set $e_len)
    (local.set $e_ptr)))
```

```wat
;; try_table equivalent — Wasmtime accepts this
(block $done
  (block $h (result i32 i32)          ;; the tag's (param i32 i32)
    (try_table (catch $__exn_tag $h)
      (call $mayThrow))
    (br $done))                        ;; no throw: skip the handler
  (local.set $e_len)                   ;; handler, now outside the try
  (local.set $e_ptr))
```

And the `finally` / rethrow path, where `catch_all_ref` binds the exception so `throw_ref` can
re-throw it (this is what replaces `rethrow N`):

```wat
;; today — wasic output
(try
  (do (call $mayThrow))
  (catch_all
    (global.set $ran (i32.const 1))    ;; finally body
    (rethrow 0)))
```

```wat
;; try_table equivalent — Wasmtime accepts this
(block $done
  (block $h (result exnref)
    (try_table (catch_all_ref $h)
      (call $mayThrow))
    (br $done))
  (global.set $ran (i32.const 1))      ;; finally body
  (throw_ref))                          ;; re-throw the captured exception
```

Note the `finally` semantics need the body run on the non-throwing path too — that is unchanged from
today, it just moves to the `$done` side.

### One caveat, stated so it is not a surprise

**Wasmer 7.2.1 runs neither form.** With `--enable-all` it reports _"No backends support the
required features"_ for legacy AND `try_table` alike — its compiler backends have no EH support at
all. So migrating fixes Wasmtime and does not change Wasmer. That is not a regression and not a
reason to wait; Wasmtime is the host the WASI target names.

### What to do

1. Confirm the three emission sites in `src/wasic.ts` and the shapes above.
2. Migrate the emitter to `try_table` / `throw_ref`.
3. Re-run the wasmtk suite, and **add Wasmtime to the gate** for the EH tests — V8 alone cannot see
   this class of problem.
4. Record it in `cmem/compiler-bugs.md`, including the "V8 accepted it, which is why it hid" note;
   that is the reusable part.

Ping the wabt-ts side when the corpus is regenerated and it will re-run the three-engine panel
(`deno task engine-check <dir-of-wasm>`) to confirm.

### Related — RETRACTED 2026-08-24

An earlier version of this report listed seven modules as _"genuinely invalid wasm — V8, Wasmtime
and Wasmer all reject them"_, in the present tense:

```
19_NestedDiscriminantUnions   19_VariantMaximumMemoryAlignment   3_enums
32_BasicDiscUnion             32_DiscUnionMixed                  32_Phase32Combined
5e_MixedSignatures
```

**That was wrong, and wasmtk was right to push back.** They rebuilt all seven from current wasic:
every one is valid and exits 0 on Wasmtime with correct output. We re-derived it on this side rather
than take it on trust — recompiled each from the wasmtk checkout with
`deno run -A main.ts wasic <src>.ts`, then validated both sets:

|                          | frozen snapshot | rebuilt from current wasic |
| ------------------------ | --------------- | -------------------------- |
| all seven, V8            | INVALID         | **valid**                  |
| all seven, our validator | INVALID         | **valid**                  |
| spot-checked on Wasmtime | —               | **exit 0, correct output** |

The cause is ours: `tests/wasmtk/` is a **frozen 272-file snapshot** of wasmtk's build output with
no recorded provenance, and our `KNOWN_INVALID` assertion — written deliberately to go red when
wasic is fixed, so the list would shrink — kept passing because it was re-checking bytes that
predate the fix. **It masked the fix instead of tracking it, the inverse of its purpose.**

Fixed on our side: `tests/wasmtk/PROVENANCE.md` now records what the directory is, when it was
taken, that it is 272 files against wasmtk's current 373, and the rule that no present-tense claim
about wasic may be derived from it. The full refresh is queued as its own change.

wasmtk named the general pattern in their reply, and it is worth keeping: **both projects hit it
inside a week** — they had a frozen vendored `proposals/threads/` snapshot read as a live signal; we
had this. Neither was carelessness. A snapshot is indistinguishable from current data unless
something records its provenance.

---

## What came back (2026-08-24)

wasmtk confirmed the finding and corrected us four times. Recorded here so the exchange is legible
to whoever reads this next:

|                  |                                                                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confirmed**    | Reproduced exactly. They verified both of our load-bearing premises independently rather than trusting them — `wasmtime -W help` offers only `exceptions[=y\|n]`, and a hand-written `try_table` module runs with no `-W` flags. |
| **Correction 1** | Scope is **10 modules, not 6** — our corpus copy is frozen at 272 files, theirs is 373.                                                                                                                                          |
| **Correction 2** | **Two** shapes need migrating, not three — bare `catch_all` without `rethrow` is never emitted.                                                                                                                                  |
| **Correction 3** | Line refs `~13976/13992/13994` were stale; actual sites are **14749 / 14756 / 14772 / 14774**. Our doc-block ref was exact.                                                                                                      |
| **Retraction**   | The seven `KNOWN_INVALID` modules are fixed — see above.                                                                                                                                                                         |

They accepted the "V8-only gate" lesson as theirs and queued **"add Wasmtime to the EH gate" with
the migration rather than after it**, on the reasoning that migrating alone fixes the instance and
leaves the blind spot — and noted `wasmtk wast` has the same V8-only shape. They did not do the
migration inside the review: it is a codegen change with a real structural component, so it goes in
its own reviewed change. It is now the top item in their `next-work.md`.

Two of their process points are worth adopting here, not just noting:

- **They regenerated the corpus before testing against another runtime**, per their own
  `cmem/testing.md`, and it changed the outcome of half the report. We did not, which is exactly how
  the retracted section happened.
- **They verified our premises instead of trusting them.** Both held. That is the same discipline as
  this project's "measure severity, never inherit it", applied to an incoming report rather than an
  outgoing one.
