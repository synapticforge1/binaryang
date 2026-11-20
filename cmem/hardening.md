# The hardening round — open-work item 13

Summary: the contract every entry point keeps against hostile input, the instruments, and the standing ceilings and fuel decisions. Last verified 2026-11-20.
Pass-by-pass history: [archive/hardening-to-4.1.1.md](archive/hardening-to-4.1.1.md).

**The lens** ([open-work.md](open-work.md) § "Quality passes"): does it survive HOSTILE or
malformed input? Truncated binaries, absurd counts, deep nesting, a panic where a typed error is
the contract, unbounded work. Then the code lens again. The round repeats until a pass finds
nothing. Started 2026-10-09 (owner: "proceed", the agreed order after item 21).

**The contract every pass checks:** given hostile or malformed input, every entry point either
works or answers in its OWN typed way — the reader's `WasmBinaryError`, the writers'
`WasmEncodeError`, a tool's `{ errors, result }`, the interpreter's `Stop` / `Trap`, the bundler's
`BundleError`, the Linking codec's `LinkingFormatError` — and never lets a bare JavaScript error
(`RangeError`, `TypeError`, a plain `Error` in an internal stage's words) escape, or runs away.

**The instruments:** `deno task hostile <corpus dir> [stride]` (`scripts/check-hostile.ts`) — a
depth table (500 … 100,000 nested blocks through every stage) and a mutation fuzz (12 truncations
and 24 byte corruptions per module through the reader, the optimizer + writer, the interpreter, the
bundler and `compat/binaryen`). Reported, not gated; exit 1 on anything untyped or slow. Run it on
wasmtk's `tests/wasi/wasm_wasi` (404 real producer binaries: Rust, Zig, TinyGo, wasic) — the
corpus here is text.

## What the August sweep covered, and what it did not

wabt-ts swept the cheap axes in August (T13.29–T13.38, [wabt-ts.md](wabt-ts.md) § "Robustness and
hardening"): a truncate/corrupt fuzz of its five tools, huge declared counts, 100,000-deep nesting,
size amplification. It predates most of today's surface: the optimizer path (`readForPasses` →
passes → writers), the interpreter, `wasm-ctor-eval`, `wasm-interp`, `wasm-bundle` and its Linking
codec, `compat/binaryen`'s readers. And its depth result had DECAYED — the lesson it recorded
itself ("hardening's cheap axes decay too").

## Pass 2 — 2026-10-09: the weakest ceiling

**Changed:** `ResolveContext.resolveExpr` (`ir/resolve-names.ts`) is now a five-way DISPATCHER;
`block`, `loop`, `if`, `try`, `try_table` moved verbatim into `resolveBlock` … `resolveTryTable`,
and the 700-line switch became `resolveOperator`. Nesting now recurses through small frames.
`baseline` IDENTICAL, suite unchanged.

**Measured** (`scratch hostile/ceiling.ts`; warm = after JIT warm-up by a binary search, cold =
one fresh process per depth — the honest number for a real call):

| stage | before (warm) | after (warm) | before (cold) | after (cold) |
| --- | --- | --- | --- | --- |
| `writeWasm` / `writeWat` | ~384 | ~1,500 / ~1,600 | 300 ✓ 400 ✗ | 700 ✓ 1,000 ✗ |
| `wat2wasm` linear | ~384 | ~1,760 | 300 ✓ 400 ✗ | 700 ✓ 1,000 ✗ |
| `wat2wasm` folded | ~384 | ~930 | 300 ✓ 400 ✗ | 700 ✓ 1,000 ✗ |
| `readForPasses` | ~1,400 | ~1,400 | — | — |
| interpreter | ~1,000 | ~1,000 | — | — |
| `wasm2wat`, validator, optimizer | ~2,000–4,000 | unchanged (noise) | — | — |

The floor across all stages rose from ~384 to ~930 warm (to ~700 cold). Pinned at 600 nested
blocks, cold-safe, in `hostile_input.test.ts` (the unsplit resolver fails it).

**Stopped here, deliberately.** The next ceilings are the folded-text parser, the interpreter's
evaluator and the reader's preparation (`nameReferences` / `deriveTypes` through `ExprVisitor`) —
each its own restructuring of a large recursive function. Real modules peak at depth 25 today; a
large `switch` reaches hundreds. Whether to push every stage past a few thousand is the OWNER's
priority call, not a defect: every stage already refuses beyond its ceiling in its own words.

**The fuel question — answered by a HANG CHECK (owner, 2026-10-09).** The default fuel is
1,000,000,000 instructions; at ~760k instructions/s (a counted loop) or 63k–117k fuel/s (a bare
`(loop (br 0))`), an infinite loop under `wasm-interp` ran 22 minutes to 4 hours before fuel
stopped it. In general no interpreter can know a loop is infinite (the halting problem); a change
in values proves nothing (a counter changes every pass and may never exit). What CAN be proven: a
loop that comes back to its top with the same locals and operand stack, having run nothing that
could change anything else, repeats forever. The owner chose that, "after say 20s minimum
intervals ... the best of fuel and trust but verify": fuel stays the deterministic bound; the check
(`InterpreterOptions.hangCheck`, default 2,000 ms — see below; `wasm-interp --hang-check=SECONDS`,
`--no-hang-check`) samples one loop per interval and stops only on the proof — a `Stop` with the
new reason `hang`. Sound by construction (`HANG_SAFE` lists the instructions that cannot change
state outside the frame; anything else spoils the sample). Measured: 0–5% (noise) while no check is
due; a spin is caught on its second pass once one is; the clock is read every 65,536 instructions,
so a slow branch spin is noticed up to ~1 s late. Tests: `tests/binaryen-ts/interp/hang_check.test.ts`.

**The interval, set from a measurement (owner, 2026-10-09: "I agree" — 20 s → 2 s).** Every call
timed with the check off (scratch `runtime/`):

| workload | calls | mean | median | p99 | p99.9 | max | over 2 s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| the spec testsuite (six corpora) | 58,371 | 0.30 ms | 0.002 ms | 0.13 ms | 7.5 ms | 1.36 s | 0 |
| wasmtk's producer programs (`tests/wasi/wasm_wasi`, every export, stand-in imports) | 588 | 7.0 ms | 0.09 ms | 92 ms | 446 ms | 0.45 s | 0 |

Two more calls ran to fuel (100M instructions, 11–17 s): the Zig `1_fib` programs' `_start` under
stand-in imports — a loop through a host call (likely a read or write retried against a host that
answers zero), which the check cannot prove by design; fuel stops it. **The interval is set from
the TAIL, not the mean:** it decides the check's cost (an interval shorter than a run samples during
ordinary work — at 0 a loop calling a function ran 16× slower) and how soon a stuck loop is
reported, never WHETHER a loop is judged stuck. 2 s sits just above the slowest real run, so no
ordinary run is ever sampled, and a stuck spin is reported in 2–3 s instead of 20.

**Noted, not fixed:** a bare `(loop (br 0))` runs ~10× slower per instruction than a counted loop —
every branch is a thrown JavaScript exception. A speed item for the interpreter, not hardening.

§ "Code lens, pass 2", § "Code lens, pass 3", § "2026-10-12 — open-work 27": moved to [archive/hardening-to-4.1.1.md](archive/hardening-to-4.1.1.md).
