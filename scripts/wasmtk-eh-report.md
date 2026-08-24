# Ready-to-send prompt for the wasmtk team — wasic emits the _legacy_ exception-handling proposal

Written 2026-08-24 from the wabt-ts side. Mirrors the direction of
`wasmtk/scripts/wabt-ts-bug-report.md`, which came the other way on 2026-07-02.

Everything below was measured, not inferred. Paste from the horizontal rule down.

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

Six corpus modules are affected — exactly the six that contain a `(try …)`:

```
15_Exceptions
15_IdiomaticCatch_Stress
15_LexicalShadowing_Stress
15_TestCase1-NestedEscalation
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

wasic emits exactly **three** legacy constructs, so the migration surface is small (`src/wasic.ts` —
the doc block at ~107–111 and the emitter at ~13976, ~13992, ~13994):

| wasic emits today                        | replace with                                     |
| ---------------------------------------- | ------------------------------------------------ |
| `(try (do B) (catch $__exn_tag H))`      | `try_table` + `(catch $__exn_tag $h)`            |
| `(try (do B) (catch_all H))`             | `try_table` + `(catch_all $h)`                   |
| `(try (do B) (catch_all H (rethrow 0)))` | `try_table` + `(catch_all_ref $h)` + `throw_ref` |

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

### Related, separate, still open

Seven other corpus modules are **genuinely invalid wasm** — a function falls through without
producing its declared result — and **V8, Wasmtime and Wasmer all reject them**:

```
19_NestedDiscriminantUnions   19_VariantMaximumMemoryAlignment   3_enums
32_BasicDiscUnion             32_DiscUnionMixed                  32_Phase32Combined
5e_MixedSignatures
```

No overlap with the six above. They are listed in `KNOWN_INVALID` in wabt-ts's
`tests/wasmtk/runner.test.ts` and asserted to _stay_ invalid, so that list shrinks as wasic is fixed
instead of silently masking a regression. Reported previously; repeated here because it is the same
channel and the same root cause pattern (a codegen path no engine will run).
