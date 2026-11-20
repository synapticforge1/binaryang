# Best practices: lessons from the evaluator work

Lessons from constant propagation and the evaluator, and from the 1.16.x releases (open-work 2 / 23
/ 34 / 44 / 45). Last verified 2026-11-20. The other rules are in
[best-practices.md](best-practices.md).

## 🆕 Lessons from constant propagation and the evaluator (open-work 2 / 23, 2026-10-07)

### Two measurements do not add unless the passes are independent

On 2026-10-06 "propagation is ~7.7 KB" was derived as `precompute-propagate` (−11,135) minus
`precompute` (−3,392), and the owner approved building it on that price. Built, propagation was
worth 2.3 KB: what `precompute-propagate` saves beyond `precompute` is mostly EVALUATION that
propagation ENABLES, not propagation. Re-measured on the new output, the same upstream pass still
saved 9.5 KB, all of it evaluation. **How to apply:** price a pass by building the smallest
version of it and measuring, or by an upstream pass that does ONLY that; a difference of two
composite passes prices their interaction too. Say so when an estimate a decision rests on turns
out wrong ([optimizer.md](optimizer.md) records it).

### An oracle suite has blind spots too — a mutant that survives it names one

Twice a mutant survived the WHOLE spec testsuite (57,630 assertions) and every existing test: an
interpreter that ignored a block's parameter count, and one that never dropped an active data
segment. Both wrong states are invisible until a later read crosses them — a value BELOW the
parameters read after the block, a `memory.init` from the segment after instantiation. **How to
apply:** mutation-test against the strongest oracle too, not only unit tests; when a mutant
survives it, the test that kills it is the one the suite lacks — add it, and record that the suite
missed it.

### A harness without a limit is a harness a wrong loop hangs

The first mutant run against the spec harness hung for 10 minutes on a `br_table` mutant that made
a loop dispatch forever; killing it would have left the mutated file in place (the restore was in
a `finally` that never ran). **How to apply:** every harness that RUNS code gets fuel or a timeout,
and running out is a FAIL where the suite promises termination; every mutant runner backs up the
file first and checks the restore byte for byte.

### "Cannot go on" is not a result — and it taints what it touched

The interpreter has two exits that must never be confused: a `Trap` is the program's behaviour; a
`Stop` (a host call not given, an instruction not run yet, fuel) is a statement about the
interpreter. A consumer that evaluates at compile time keeps the code as it was on a Stop. And
ANY Stop part way — a module being set up (`linking.wast`), a setup action (`ref_eq.wast`'s
`init`, after which 40 assertions compared nulls) — can leave SHARED state short of the spec's:
every instance sharing state with it is unreliable thereafter. The first version of the rule
covered instantiation only; the second case found the gap at the next increment. **How to
apply:** count Stops by reason as coverage, never as passes; propagate them to everything that
shares state with the stopped unit; a "result ignored" step (a bare action) is still a step whose
failure to finish matters.

### A test must read where the two implementations DIFFER

A non-overlap-safe `table.copy` passed a unit test of overlapping copies, because the test read
the slot that a correct copy and a naive forward copy both leave the same; only the spec suite
killed it. **How to apply:** for each behaviour, work out the input and the OBSERVATION point
at which the wrong implementation and the right one part — then read there. A test that reads
where they agree is green for both.

### State kept per INSTANCE is tested under RECURSION

The interpreter keeps the exceptions legacy `catch` bodies are handling on one stack per
instance; `rethrow $l` searches it by label. A mutant that searched outermost-first passed every
unit test and both spec corpora, because only recursion puts two entries with the same label on
that stack at once. **How to apply:** for state that outlives a frame (a handler stack, a cache,
a per-instance counter), write the test where the same code is active twice — a recursive call
from inside the construct.

### A test module the engine REFUSES is not a test — check that the kill is real

Two "kills" in E3d-1 were the test failing to compile, not the mutant being caught: one WAT gave
`catch_all` a target expecting a value; one mixed legacy and new exception handling, which V8
refuses in one module. The test helper does not validate (`wat2wasm`'s library default), so the
first sign was V8's `CompileError`. **How to apply:** a mutant is killed only if the test PASSES
on the real code and fails on the mutant; read the failure message, not only the exit code.

### An operand a node CARRIES but the code ignores is a guess — make it stop

`struct.new` / `ref.cast` / `br_on` carry an optional descriptor operand (custom descriptors).
The interpreter, written for the core spec, ignored the field and ran `ref.cast_desc_eq` as a
plain cast: 85 FAILs on the custom-descriptors corpus, none on the core suite, which never
exercises the field. The same corpus showed a reference to an imported function typed by the
IMPORTER's declaration instead of being the exporter's function. **How to apply:** for each
node kind a component handles, list every optional field and either implement it or make its
presence a Stop; and run the corpora BEYOND the core suite — here the proposal one found both
defects while the core suite was green (the earlier lesson, "an optional field is invisible to
the compiler", from the runtime side).

### An evaluated NaN is the engine's to choose — fold it only where the spec fixes the bits

The spec lets an arithmetic operator return ANY arithmetic NaN; engines propagate payloads; a
constant fixes the bits, and a program can read them back through a reinterpretation. Only
`abs` / `neg` / `copysign` / reinterpretations fix a NaN's bits. Upstream folds them all (F1,
measured). And JS numbers can carry a NaN's payload through `Math.ceil` and a `DataView`, so
"canonical" must be WRITTEN, not assumed — `f64.ceil` of a signalling NaN came back signalling.
**How to apply:** one fold rule for every folding pass (`foldedLiteral`); test NaNs by bits.

### A formatter run on a file the gate excludes rewrites it unseen — and renumbers IDs

`deno fmt cmem/<file>` rewrapped three cmem files across a day's commits and renumbered
`open-work.md`'s ordered list — items 21 / 22 / 24 became 16 / 17 / 18, two of them retired
numbers — while `deno fmt --check` stayed green, because `cmem/` is outside `fmt.include` and the
check never looked. Found only by a whitespace-insensitive diff against the day's first version.
**How to apply:** never format cmem ([working-rules.md](working-rules.md) § "Tools"); when a tool
touches a document whose numbers are IDs, compare the IDs before and after.

### A fixture the ignore rules swallowed — green here, red on every clone

1.10.0's first push was red on CI's Test step. The `wasm-bundle` fixtures are producer output
(rustc, zig) committed as binaries, and the repo-wide `*.wasm` in `.gitignore` kept them out of
the commit without a word: `git add <folder>` added the sources and the README and skipped the
rest. Every local run, the full 21-step gate included, read the files from this disk and passed.
**How to apply:** after adding a binary fixture, `git ls-files <folder>` must list it (or
`git check-ignore -v <file>` must say nothing); before a release, run the suite from a fresh clone
of the commit — `git -c safe.directory=<repo>/.git clone <repo> <scratch>` on this disk — because
that is the only tree that sees what CI sees.

### The last line of a tool's output is not its verdict — read the exit code

On 2026-10-09 three local "lint is clean" checks read `deno lint | tail -1`, which prints `Checked
N files` LAST even when it has just listed problems; the gate then failed on lint. A summary line is
a count of what was looked at, not a judgement of it. **How to apply:** gate every tool by its EXIT
CODE (`cmd >/dev/null; echo $?`), and read output only to find out why.

### A step that ran nothing passes — make "nothing" a failure

All day on 2026-10-09 the gate's `interp` step was handed the wrong folder for the legacy corpus
(`translate-eh`'s flat output, not a `spec:prepare`d corpus) and reported "pass 0, FAIL 0, stopped
0": green. Nothing was broken (70 / 0 / 0 once found), but the evidence was empty. **How to apply:**
a harness counts what it RAN, and a corpus with zero assertions fails the step; when a gate's
number drops to zero, it is a finding, not a pass.

### A limit measured warm is not the limit a user meets — pin the cold one

Stack-depth ceilings found by a binary search (many calls, JIT-warmed) were about TWICE the ceilings
of one fresh call: name resolution "~1,500" warm, 700 cold. A test pinned at the warm number failed
on a cold run. **How to apply:** measure a limit the way it is used — one fresh process per sample —
and pin a test below the COLD number; report both, labelled.

### Set an interval from the tail, not the mean

The hang check's interval was chosen from measured run times: means of 0.3 ms and 7 ms, but a
slowest legitimate run of 1.36 s. An interval near the mean would sample during ordinary work (16×
slower in the worst case); one above the tail costs ordinary runs nothing. **How to apply:** when a
setting trades cost against latency, read the distribution's tail (p99, max), and say which number
was used and why.

### A mutant must exercise the path the check guards — otherwise it proves the wrong thing

`check-browser.ts` was "proven" by restoring an old tool that imported `node:process`: the browser
build FAILED, the check went red, and it was called sound (2026-10-12). But Bun's browser target
handles builtins differently: `node:process` has no default-export stub, so it fails loudly, while
`node:fs` is silently STUBBED (`(() => ({}))`, exit 0, the import gone from the output). A used
top-level `node:fs` import passed the check. The owner found it the same day; the source-level
portability rule had caught it all along. An earlier mutant, `void process`, was dropped by the
bundler and proved nothing either. **How to apply:** list the ways the guarded thing can go wrong,
and make one mutant per WAY, not per symptom. When a check depends on a tool's behaviour (a
bundler, a compiler), test the tool's quiet path, not just its loud one.

### An exit code at the end of a pipeline belongs to the last command

A gate "passed" that never ran (2026-10-12): a Windows path (`C:/…`) prepended to PATH in Git Bash
broke PATH (the colon is its separator), `node` was not found, the runner died with 127, and a
trailing `cut` returned 0. Only two of the gate's lines were in its log, left over from an earlier
run. **How to apply:** judge a gate by ITS printed steps and its own exit code, never by a pipeline's.
Make a runner refuse to start when a prerequisite (the expected `node`) is missing, and use POSIX
paths (`/c/…`) on PATH in Git Bash.

🔁 **It recurred the next day (2026-10-13)**, in an ad-hoc command:
`deno fmt --check <files> | tail -1 && git add -A && git commit …`. The check failed, `tail`
returned 0, and the commit went in. (That failure was itself false: the file named was outside
`fmt.include`; see the formatter lesson above.) **How to apply, sharper:** never put a check
before `&&` through a pipe. Run it alone, `cmd >/dev/null 2>&1; echo "exit $?"`, read the code,
and only then run the next step.

### A numeric `enum` lets any number through — converting it exposes the lies

Converting the 20 enums to const objects (open-work 28 part 4) turned three typing lies into
errors: `Opcode` used across the IR for `(prefix << 16) | sub` values that are not members; a
`ReadonlySet<NameSectionSubsection>` holding unknown ids; and `exp.kind in ExternalKind`, which
only worked through the enum's reverse keys and broke every export. That last one passed both type
checkers, and only the CLI smoke test caught it. **How to apply:** after removing a permissive
type, run the BEHAVIOUR gates, not only the checkers. Search for reflective uses (`in X`,
`Object.keys/values/entries(X)`, `X[expr]`) of the thing changed. Where "any number" was the real
contract, say so in the type (`number`, with the reason), instead of casting at each use.

### An engine is an oracle only after you measure it against the one you trusted

Moving scripts to Bun would have swapped the WebAssembly ORACLE: Bun runs JavaScriptCore, which
differed from Deno's V8 on 300 of 6,753 corpus modules (no memory64; accepts 70 invalid modules).
Node 22's V8 12.4 failed the behaviour gate outright, and Node 24's V8 13.6 agreed on all 6,753.
None of that showed until each engine validated the same corpus. **How to apply:** before a gate
that judges with the host engine changes runtime or version, validate the whole corpus on old and
new and diff the verdicts. Record which engine referees, and when that engine reaches end of life.

## 🆕 Lessons from open-work 34 and releases 1.16.0 / 1.16.1 (2026-10-23 – 24)

### A switch's NAME is not its semantics — check an oracle against the spec before it referees

The agreed oracle for the relaxed-SIMD lowering was wasmtime's `-W relaxed-simd-deterministic`.
Measured first on 68 edge cases against the spec's own definitions (prose AND SpecTec), it was NOT
the spec's deterministic profile: it fuses madd and does not wrap the dot-add's i16 intermediate
(15 of 20 instructions matched). Had it refereed, a correct lowering would have "failed" on 9 lanes,
or a wrong one been written to match it. **How to apply:** before an engine judges, run it on the
edge inputs where the definitions differ and compare with the definition itself; where they part,
the definition is the oracle (an independent reading of it, in its own code).

### A probe's TAG is a claim about the module — print the module before blaming the tool

`run4` held the LOWERED wide-arithmetic modules, still tagged `wideArithmetic`. The feature
detector found no wide arithmetic in them, which read as a validator defect — until the module was
printed: a `call` to a helper, no `add128`. **How to apply:** when a tool disagrees with a label,
look at the artifact the label describes before suspecting the tool.

### A test module must be valid in the ORIGINAL — run it unlowered first

The lowering-order test stored 8 bytes into a 3-byte memory: the original trapped, and so did both
lowered orders, which looked like the passes failing. **How to apply:** a positive control for
every hand-written probe: the original must give the intended value before a transform is judged.

### Compare against the set that DEFINES the verdict, and report the rest separately

The portable-target corpus first showed "183 modules off" — every one an interpreter (wabt's trap
format, binaryang's shared-memory gap), which owner decision 1 says are reported, not defining.
Judged on the 15 defining executors: 772 / 774, the 2 a browser policy the originals shared.
**How to apply:** decide the denominator before reading the result; print what was excluded.

### A gate's first REAL use is its real test — simulate the event it guards before relying on it

The compatibility gate passed every inverted case and a dry bump, yet went red on the first real
bump (1.16.0): the root usage text NAMES the version, so a bump read as "usage text changed" —
every bump would have. The dry runs never changed the version line. 1.16.1 was released to prove
the fix on a real bump. **How to apply:** exercise a release gate on the exact edit it will see
(change the version locally, run the CI step) before the release depends on it; and know which
workflow a check gates — the publish was never at risk (publish.yml runs only `--release-check`).

### Never change the working tree while a gate runs IN it

2026-10-24: with the full gate running on item 35's commit, a branch switch (to start item 33)
changed every file under it — the run would have checked a mix of two trees. It was stopped and
re-run whole; the tree was checked clean first. **How to apply:** while a gate runs, do only
read-only work in that tree, or work in a separate clone (on C:, since D: is exFAT); print the
commit before and after a gate run, so a moved HEAD is visible in its log.

### A library's default is not its CLI's — a test must ask for what the CLI does

`wat2wasm()` validates only with `validate: true`; the CLI validates by default. The multi-value
test first called the library without it, so the text path validated nothing and seven cases read
as "binaryang accepts" — while the CLI refused them. **How to apply:** before asserting a tool's
verdict through its library, check the library's defaults against the CLI's.

### Two orders that behave the same are not the same — measure the choice

Memory64Lowering then LowerCustomPageSizes gave 640 bytes; the other order 789, the same behaviour.
The order was a guess until measured, and the owner's targets include size. **How to apply:** when
an order or a choice is free for correctness, measure it against the targets before fixing it.

### A harness's switch can be the thing refused — run the subject bare before blaming it

The probe handed wasmer `--enable-tail-call` for every tail-call module, and D4 excluded tail calls
as "refused by wasmer" for a day. wasmer refuses that SWITCH (even on a module with only `call`)
and runs every tail call without it. **How to apply:** before recording that an engine refuses a
feature, run the module with no feature switches at all; a refusal that moves with the switch is
the harness's.

### Test what users get by DEFAULT, on real input — an all-features gate cannot see it

Every gate passed `allFeatures()`, and so did wasmtk; `wasm-validate` with no flags called every real
Rust, Zig and TinyGo build INVALID, in every release from 1.5.3 to 2.0.0 (open-work 41). The same
blind spot as T13.10, from the other side: there a gate was inert, here a gate was wrong, and only
the default configuration showed either. **How to apply:** for every default a user runs (a CLI
with no flags, a library call with no options), keep a test that runs real compiler output through
it — `reference_types_gate.test.ts` now does, on the six builds in `benches/`.

## 🆕 Lessons from open-work 44 and 45 (2026-10-26)

### A text scan is evidence about text files; a compiler's debug build embeds the machine's paths

Every privacy scan — the rule's `git grep -I`, the history purge's `git log -G` — skipped binary
files, so "HEAD is clean" held for text only while five committed benchmark modules carried the
owner's profile and project paths in DWARF and in Rust's panic locations, public for two weeks
(open-work 44). **How to apply:** scan binaries too (`git grep -a`); build committed modules with
path remapping (Rust `--remap-path-prefix` plus `-Ztranslate-remapped-path-to-local-path=no`) or
their debug sections removed, and make the build script refuse an output that still has a path.

### A tool that removes something must copy the rest — a re-encoding breaks what refers to bytes

`wasm-strip` decoded the module and wrote it back. The printed code was identical, so every check
that compared text passed, but the bytes were re-encoded, and a KEPT section that names code
offsets (`reloc.CODE`) went stale: `wasm-bundle` refused the stripped module (open-work 45).
Upstream copies. **How to apply:** for a tool whose job is to remove or add one part, the oracle is
"the input minus that part, byte for byte" — test it against upstream's bytes by hash, and keep the
re-encoding to tools whose job is to rewrite (the optimizer, L1).
