# Best practices: tools, shells and file changes

Rules about shells, formatters, linters, renames and other tooling that changes files or hides failures. Last verified 2026-11-20. The other rules are in [best-practices.md](best-practices.md).

## 🆕 Do not author file CONTENT through a shell heredoc

**Rule: write files with a file-writing tool. A heredoc is for commands, not content.**

Both repositories hit this in the same week, with different symptoms and one root cause: **the shell
layer collapses backslash escapes before the content is written**, and it silently truncates long
commands.

- **symptom:** `'\\'` in a JS string became `'\'`
  - what actually happened: the file would not parse — caught immediately, cheap
- **symptom:** `grep -c $'\r'` returned large plausible counts on LF-only files
  - what actually happened: `\r` in a BRE matches a literal `r`. **Every CR measurement taken during the line-ending investigation was wrong, in the direction that confirmed the theory**
- **symptom:** a 90-line and a 150-line heredoc both died with `unexpected EOF`
  - what actually happened: the command was truncated before the closing delimiter — nothing to do with quoting, which is where the first hour went
- **symptom:** wasmtk: `\\0asm` collapsed to `\0asm` and Python wrote a **literal NUL byte** into `.gitattributes`
  - what actually happened: git reported the file as `Bin 584 -> 2144`. The NUL landed **inside a comment about NUL-byte detection**

The last one is the instructive one: the corruption was invisible in the source that produced it,
and the file it corrupted was the file whose job is to prevent that class of corruption.

**Why it stays hidden:** every one of these produces output that looks like a _different_ problem —
a quoting error, a formatting drift, a binary file. None of them announces "your escape sequence was
eaten."

**How to work:** author content with a real file write, then use the shell only to move or append it
(`cat fragment >> target`). When a shell measurement disagrees with a tool's own verdict, **believe
the tool** — `deno fmt --check` going from `32 not formatted` to `Checked 283 files` was the only
unambiguous signal in the entire line-ending episode, and every hand-rolled measurement around it
was noise.

**The mirror trap, from wasmtk's reply to § 11 (their report § (6), `7ac7fbf5` (was `83c02a2`, C49), written 2026-08-31,
heading mislabelled 2026-08-27; reached us 2026-09-29).** Ours read HIGH; theirs reads LOW, from a
nearly identical command. Against `LICENSE-APACHE`, 184 real CRs: `grep -c '\r'` → 140 (our BRE
case); `grep -c $'\r'` → **0**, because GNU grep under MSYS strips CR in text mode; `grep -cU $'\r'`
→ 184. Ours would have confirmed a CRLF theory, theirs an "everything is clean LF" one — neither
looks wrong. **Their rule, adopted: a measurement of ABSENCE needs a positive control.** Run it
first on a file known to contain the thing; if the method cannot see a known positive, every
negative it produced is worthless. (It applies well beyond line endings: a grep that finds "no
callers", a scan that finds "no opcode", a gate that finds "no divergence" — see
[testing.md](testing.md) § "Invert every gate before trusting it", the same idea for a gate.)
🔁 **Three more the same day, each found only because a mutant SURVIVED:** a duplicate-name guard
test that read the module WITHOUT its names, so nothing was named with or without the guard
(`7539689e5`); a "declarations stay on one line" test whose one-leaf fixture fits one line whatever
the writer does (`33ec4a28a`); and a gate step whose `sh.exe` had no `grep` on its PATH, which can
report "no violation" with its tools missing. The fix each time is the same: first assert the
positive case, then the absence.

**🔁 Again on 2026-09-19, twice, in throwaway scripts:** a heredoc'd measurement script lost the
backslashes in its regexes (`Unterminated regexp literal`), and a `sed` that generated a mutant
script turned `\n` escapes into real newlines, breaking both mutants silently until they reported
"0 occurrences". Both were rewritten with the file-writing tool and ran first time. The rule holds
for scratch files too.

### 🔁 Knowing the rule did not prevent it — four failure modes, one family

Broken again five times on 2026-09-02 **by the author of this rule**, so the trigger is worth
stating in one line: **the moment the content contains a backslash, a heredoc is the wrong tool** —
not "risky", wrong. Even a quoted heredoc (`<<'EOF'`) is unsafe here. Python's own
`SyntaxWarning: invalid escape sequence` fired every time and was not enough of a signal; **treat
that warning as a failed command.** The worst instance: a table row EXPLAINING byte-widening
corruption had its own example escapes eaten. It survived only once rewritten with no escape
characters at all, spelling the bytes out in words ("the single byte F0 became the two bytes C3
B0"). **If a note about escaping cannot survive its own delivery mechanism, describe bytes in
words.**

The family is one thing — **a tool interpreting characters you meant literally** — and it has four
members, each in a different layer:

- **mode:** 1. backslash escapes eaten
  - the instance: the table above; the two CR measurements in the line-ending section
- **mode:** 2. long commands TRUNCATED
  - the instance: `unexpected EOF while looking for matching` on 90- and 150-line heredocs. **If a heredoc fails with unexpected EOF, suspect length before quoting**
- **mode:** 3. backticks run as COMMAND SUBSTITUTION
  - the instance: 2026-09-04: `git merge -m "... the field is X on both halves ..."` with X in
    markdown backticks. The shell substituted the empty result, and the merge message shipped with
    nothing at all where the field's name belonged, between "the operator field is" and "on both
    halves"
- **mode:** 4. a STRING replacement is a template
  - the instance: 2026-09-10, inside Deno, no shell at all: `text.replaceAll(from, to)` turns `$$` into `$` — see "Let the COMPILER name the sites" below. **Pass a function (`() => to`)**

Mode 3 generalises the rule: **any shell string carrying prose destined for a file or a commit
message is single-quoted or delivered by a file** — a double-quoted `-m` is not safe even when a
quoted heredoc would have been. Hence `git commit -F <file>` in
[working-rules.md](working-rules.md). And one inline `deno eval "…"` was mangled by shell quoting
the same week, so: **scripts go in files, always.** ⚠️ Broken again 2026-09-28 (a memory edit by
`deno eval "…"`): bash ran every backticked name in the replacement text as a COMMAND (`deno task
spec` among them, harmlessly) and the file lost those words. Caught by reading the output,
reverted with `git checkout`, redone from a script file. A probe that only READS may be inline;
anything that WRITES is a file.

⚠️ **`deno fmt` is for what `fmt.include` names — never `cmem/`** (2026-09-28): `deno fmt` given
three cmem paths by name reflowed them whole (815 lines in, 714 out), burying a 76-line edit. The
gate's `fmt --check` never looks at cmem/, so nothing would have caught it; the diff's size did.
Undone WITHOUT discarding work: the formatted copies backed up first, the files written back from
`HEAD`, the edits re-applied. Check `git diff --stat` after any tool that writes docs.

⚠️ **Two more the same day, both in mutant runs:**
- `deno test --filter '<an it() name>'` under `@std/testing/bdd` matches NO test — an `it` is a
  STEP of its `describe`, and the filter matches test names — and a run of nothing exits **0**. Two
  real mutants read MISSED until the whole file ran and caught both. Run the file, and print which
  steps failed, so a green run shows what it ran.
- `sed -i` on a scratch SCRIPT (to change its output line) wrote a raw newline and escapes into a
  template literal; the script died at parse. It failed safe — before mutating anything — but it is
  the same rule: a script is edited with Edit, or rewritten whole.
- And a number typed from memory into a test's expected values (`1e39` as f64) failed at once:
  every expected value is MEASURED first — the probe that found the defect prints them.

⚠️ **Two different silent failures in one session came from editing docs by script:** the eaten
backslash, and a string-replace that silently matched nothing because `deno fmt` had reflowed the
target paragraph between reading and writing. **Both were caught by re-reading the file, never by
the tooling.** After any scripted doc edit, read back the lines it changed, and audit the diff for
HEAD lines holding `$` sequences that no longer appear verbatim.

## 🆕 Lessons from the lint migration (Bun migration B3, 2026-10-13)

### A suppression hides more than the rule it names — fix it, then see what the types find

The 21 `noExplicitAny` suppressions in tests and scripts each looked reasonable ("test code reads
untyped IR"). Typing them instead (owner: "I am hoping that the issues … are either corrected or
addressed in other ways") found what `any` had hidden: a test that built a function body as a
`block` (a body is a region: invalid IR the pass under test tolerated), a lookup of a node kind
that no longer exists (`'br_on_null'`, the dead half of a `??`), and expected values whose `kind`
had widened to `string`. None of it showed in a passing suite. **How to apply:** before
converting a suppression, delete it and look at what fires; prefer one TYPED helper over many
untyped copies (`tests/expr_walk.ts`); count a suppression as unmeasured code, not as handled.

### "Not in the type files" is not "not in the compiler" — settle a type question by compiling

The session told the owner `WebAssembly.Exception` / `Tag` had no types (no `getArg` in any
`.d.ts` under `node_modules` or in `deno types`). Wrong: TypeScript 7 builds its standard library
into the compiler, and both checkers accepted a three-line probe. **How to apply:** answer "does
the checker know X" with a probe file that uses X, run through the real checker, plus a negative
control (a deliberate error) proving the check runs. A probe can lie too: one `@ts-expect-error`
went unused because a union-typed `const` is narrowed by its initializer, so the "wider" value was
already narrow. Use a function parameter for "is A assignable to B", and make every expected error
show that it bites.

### Naming a file to a tool overrides the tool's scope — a failure there is not the gate's

`deno fmt --check cmem/bun-migration.md` reported "not formatted"; the gate's `deno fmt --check`
never looks at `cmem/`, and running `deno fmt` on the file to "fix" it reflowed the whole file
(526 lines changed; undone). The same holds for linters and checkers given explicit paths. **How
to apply:** check a file the way the gate does (no path, or only paths inside its include); before
acting on a failure for an explicit path, confirm the path is in the tool's scope
(`fmt.include`, `files.includes`).

## 🆕 Lessons from B5–B7 and wasmtk's Asyncify report (2026-10-13)

### A crash in a port can be the SYMPTOM of a divergence — compare the rule before patching the site

wasmtk's TinyGo 0.43 module crashed `Asyncify` in Flatten ("unresolved call target"). The first
patch, giving Flatten the missing types, made the crash go away and the output run correctly.
Reading upstream's `Asyncify.cpp` then showed the real defect one level up: upstream's propagation
stops at the bottom-most runtime, ours did not, so we instrumented a function upstream never
touches. The crash was only where the divergence became visible. **How to apply:** when a port
fails where upstream does not, find the upstream rule that decides the failing case and compare it
line by line BEFORE settling for a fix at the crash site; keep the site fix too only if upstream
would also survive that path.

### A rename "in comments" that runs over whole files rewrites code too

`deno task <name>` → `bun run <name>` was meant for comments; one hit was a string inside an
assertion, `not.toContain('deno task test')`, which then FORBADE the step it guarded. The targeted
test run had come before the rename; the full gate caught it. **How to apply:** a mechanical rename
touches comment lines only, or its non-comment hits are listed (`git show | grep -v` comment
prefixes) and read one by one before committing.

### Text holding a backslash never goes through a shell string

Code, a regex, or prose ABOUT escapes, written through an inline `bun -e` / heredoc, lost every
backslash: `\s` became `s`, `\b` a literal backspace byte the editor does not show. It struck
twice in one day, the second time in the note describing the first; `source_hygiene.test.ts` (no
control bytes) caught it. **How to apply:** such text goes through the Write / Edit tools; a scratch
file then spliced in by a script is fine, a string literal in a shell command is not.

### A suite outside the gate breaks unseen — keep it in the LOCAL full gate

`comparison/` (Deno, `npm:binaryen`) is outside CI by design (it needs upstream tools). It broke
when B2 added `package.json` and `node_modules` (Deno then resolved `npm:` there) and stayed broken
until B7, a day later, because nothing ran it. **How to apply:** a suite kept out of CI for cause
still runs in the local `--full` gate (it does now), so a change that breaks it is seen the same
day.

### Deleting a config changes what the tools read in its place

With `deno.json` gone, `deno publish` type-checked with `tsconfig.json`'s compilerOptions, but not
the `@types/node` they name, and `import.meta.main` failed the publish check that had passed the
day before. **How to apply:** after removing a config, run every tool that read it (here the
publish dry run, cold), and prove the output did not change (the same 122 files).

### A fuzz that classes outcomes by TYPE cannot see a wrong answer — ask the code question of every valid mutant

The hostile fuzz asked "typed or untyped?" of 2,030 mutants and was clean. The same mutants asked
"is it valid (ours and V8)? then does every stage take it, and is the optimizer's output valid?"
found three defects in one evening (open-work 13, code lens, 2026-10-09): the validator's
`result` said Ok for an invalid module, and two optimizer miscompiles of valid input. A typed
refusal of VALID input passes a hardening fuzz by construction. **How to apply:** a mutation run
reports two things: the contract (typed or not) and, for each mutant an independent oracle calls
valid, the code lens (every stage works, output valid).

### A record keyed by node identity dies at the first rebuild

`deriveTypes` records `pop` origins and discarded values by node; `mapWithSequences` copies
every node above what it replaces. After a collapse ran, the new drop step dropped a bare
`local.get` (a leaf, never copied) and missed the `i64.extend` beside it (copied): no error, just
less done. The `pop` origins have the same exposure in any function the phantom collapse touched
(read from the code, not observed). **How to apply:**
after any rewrite that rebuilds, derive again; or mark the nodes BEFORE the rewrite with
something the copies carry (a symbol key survives a spread) and replace every marked node.

### An inversion is undone from a backup, never from git

Restoring a sabotaged file with `git checkout --` restored the COMMITTED version and wiped the
uncommitted fix with the sabotage (2026-10-09; recovered from a copy taken first by luck).
**How to apply:** copy the file aside before sabotaging, restore from the copy, and grep the
restored file for both the sabotage (0) and the fix (> 0).

### `deno fmt <path>` formats a file the include list leaves out

`CHANGELOG.md` is outside `fmt.include`; formatting it by name rewrapped every earlier entry. Same
trap as cmem. **How to apply:** run `deno fmt` with no path, or only on paths under `include`.

### One second oracle is an opinion — ask the panel, and qualify each column first

V8 alone flagged dozens of "disagreements" that were V8's own feature gaps and limits, and it
ACCEPTS things five other engines refuse. Asking every validator and engine on the machine
settled each case in one table ([hardening.md](hardening.md) § "The oracle panel"). Two of the
eight columns were wrong at first — wasmtime's `all-proposals` and wasmer's `--enable-all` made
them refuse VALID modules. **How to apply:** before reading a tool's verdict on the disputed
input, show it accepts every valid original; then judge by the owner's rule (refuse what will
not run everywhere), not by any single engine.

### A job that prints only at the end cannot be told from a hung one

The all-corpus throw-check ran an hour with nothing to show; it was stuck in C15's loop, and
nothing distinguished "slow" from "stuck" until it was rerun with a progress file and a per-input
timer — which then named the slow inputs in a minute. **How to apply:** any run longer than a
few minutes writes a progress line per unit and logs any unit over a threshold. And stopping a
process inside a `cmd1; cmd2; echo exit >> log` chain lets the chain run on: the next step wrote
into the log being read.

### A hand-counted section size is a guess — build fixtures with computed sizes

Four hand-written binary fixtures in one evening had a wrong section or body size, and each
first read as a validator result ("length out of bounds"). **How to apply:** compute sizes in the
fixture helper, or assert the fixture's CONTROL (a valid neighbour accepted by V8) before the
case under test.

### `deno test --filter` takes a substring, or a regex between slashes

`--filter "a|b"` matched nothing and printed "0 passed, 0 failed": an inversion that ran no test
reads like one that passed. **How to apply:** `--filter "/a|b/"`, and read the passed count.

### Whether a tool has a feature is a claim with a date — ask the installed binary, outside the project

2026-10-15, twice in one hour. "There is no `bun check`" was said from memory; Bun 1.4.3, installed
here, had shipped one. Then the reverse: bun.com/docs/lint documents `bun lint` under a 1.4.3
banner, and the 1.4.3 binary has none (canary only). Docs can run ahead of a release, and memory
behind it. **How to apply:** before saying a tool has or lacks a feature, run it: `<tool> <cmd>
--help` on the installed version, plus its release notes. Run it from OUTSIDE the project (next
lesson).

### A project script shadows a runtime's own subcommand

In binaryang, `bun check --help` printed `tsc`'s help, because `package.json` has a `check` script
and Bun runs a script before a built-in of the same name; `bun lint` does the same with our `lint`
script. A test of the built-in inside the repo measured our script. **How to apply:** test a
runtime's built-in from a scratch directory with no `package.json`. Inside a script of the same
name the built-in is meant (Bun's docs), but on an older runtime without it the script calls
itself: pin the version that has it.

### Porting a Deno script to `node:fs`: a `Buffer`'s `.slice()` is a VIEW

`Deno.readFileSync` returns a `Uint8Array`, whose `.slice()` copies. `readFileSync` from `node:fs`
returns a `Buffer`, whose `.slice()` shares memory. The code lens's mutation instruments do
`const m = b.slice(); m[at] = v;` and would have corrupted every later mutant of the same
original, silently (2026-10-15, caught while porting). **How to apply:** wrap at the read,
`new Uint8Array(readFileSync(p))`, in any port that mutates bytes; then run a positive control.

### A long-lived branch can bring back a fix `main` made another way

`code-lens-13` sat unmerged from 2026-10-09 to 2026-10-15. Its C6 refused an unknown SIMD sub-opcode
through `extendedOpcodeName`, and `main` had meanwhile shipped the same refusal in 1.11.0 through
`isInstrCode`. Git merged both without a conflict. The branch's copy was not harmless: a gap in
the NAME table would have refused a real instruction that `main`'s check accepts. The same branch
had a letter numbered § 28, which `main` had used for another thread. **How to apply:** before
merging an old branch, list every fix it makes and check whether `main` already makes it, not
only the hunks git marks. Keep one check per fact. Renumber records the branch created.

### A filter that matches nothing reads like "not yet" — check the key before waiting on it

1.14.0, 2026-10-22: the CI waiter was given a SHORT commit sha. GitHub's `actions/runs?head_sha=`
matches only a full sha, so every poll listed no runs, and a waiter that prints each run as it
finishes printed nothing: indistinguishable from CI still running, until the owner asked "is it
hung?". CI had been green for minutes. The same shape as `--filter "a|b"` above. **How to apply:**
a script that waits on a filter rejects a key in the wrong form up front (the waiter now demands
40 hex digits), and prints what it SEES each poll ("0 runs"), not only what finishes.

### A script that does not parse its flags takes them as arguments

The same release: `gate.ts --help` (to read its usage) took `--help` as its scratch PATH, ran the
whole gate and wrote `--help/gate-logs/` into the repo. Nothing showed until `bun run release`
refused the dirty tree. The release guard caught it; a plain commit would have committed it.
**How to apply:** read a scratch script's header instead of probing it with `--help`; give every
positional-argument script a guard that refuses a leading `-` and unknown flags.
