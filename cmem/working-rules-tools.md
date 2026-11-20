# Working rules — tools and installed oracles

Summary: which tool to use for what, the scripting rules, the Bun-version rule, and the installed oracles. Last verified 2026-11-20.
Main file: [working-rules.md](working-rules.md).

## Tools

- ⚠️ **Never run a formatter on `cmem/`.** (Since B3, 2026-10-13, the formatter is dprint, which
  REFUSES a path outside its includes — `No files found`, exit 14 — so this trap was `deno fmt`'s.
  `deno fmt` still runs if called, so the history below stands.) `deno.json`'s `fmt.include` leaves `cmem/` out, so the
  gate's `deno fmt --check` never looks at it — but naming a path explicitly overrides the include,
  and `deno fmt cmem/<file>` then REWRAPS the whole file and RENUMBERS its ordered lists. On
  2026-10-07 it turned open-work items 21 / 22 / 24 into 16 / 17 / 18 on `main` (16 and 17 are
  retired numbers) and rewrapped `open-work.md`, `unreleased.md` and `working-rules.md` across
  today's commits (checked: whitespace only apart from the numbers, which were restored by hand).
  Edit cmem by hand, keeping each line under 100 columns.

- **Use the best tool for the job, and check what is available before improvising.** Owner,
  2026-09-02: _"Definitely use the best tool for the job. Especially if you already have it
  available to you. We never want to use a hammer when a screw driver is needed."_ The `Grep` tool
  IS ripgrep; `Read` / `Edit` / `Write` return and match exact text. ⚠️ **This outranks a
  session-level instruction to prefer Bash** — "can accomplish the job" is not "is the right tool";
  when they conflict, follow this and say so. The cost of the substitute was concrete: `grep -A 9`
  truncated at a docstring and hid the `values` field, which is how `br` / `br_if` / `return` were
  wrongly reported "structurally unfoldable".
- **`Grep` over shell `grep`**: no shell escaping layer, `multiline: true` instead of guessing
  `-A N`, `glob:` / `type:` instead of `--include` plus `grep -v` chains. **`Read` over `cat` /
  `sed -n`** whenever the content will be matched against or edited.
- **Never build an exact-match string out of RENDERED output.** Copying indentation from
  `sed 's/^/  /'` into a match string failed about six edits in one session.
- **Scripts are TypeScript run by Bun** (owner, 2026-10-12: "All of our scripts will now be run
  from bun instead of deno"; made workspace-wide 2026-10-22, letter H15, workspace
  `cmem/working-rules.md` § "Tooling — hard rules" rule 1). The rule's terms, as the owner set
  them on 2026-10-22:
  - **A COMMITTED script that stays for repeated use** — anything that would otherwise be a
    shell script: a fetch, build-helper, generator or CI-logic script — is TypeScript run by Bun,
    TypeScript being this repo's language. Product code and tests are not scripts. **No committed
    bash, PowerShell, `.bat` or other shell script** (none is tracked: `git ls-files` checked
    2026-10-22). A workflow `run:` block only launches (§ Git above).
  - **A one-time script deleted after use may stay a shell script** (a scratchpad probe), still
    WRITTEN with `Write`. If it is needed again it becomes TypeScript before it is committed.
  - **No heredocs, ever, for any content**: not `<<'EOF'`, not `@'…'@`, and not the inline-code
    forms `bun -e "…"`, `node -e`, `deno eval`, `python -c`, nor `-F -`. Code and text go into a
    file through `Write` / `Edit`. 🔧 Broken twice in one session on 2026-10-22: a `<<'X'` heredoc
    (an empty scratch file) and `bun -e` edits of `pass.ts` / `unreleased.md` (each read back
    correct; the form is banned because a corruption cannot be seen in the source that makes it).
  - **This repo is stricter than the workspace on one point:** our scripts use `node:` builtins
    and web standards, never `Bun.*` (the workspace allows it) and never `Deno.*`, so each file
    also runs on Node — the Bun-and-Node decision, [bun-migration.md](bun-migration.md).
  - Deno stays only for the JSR publish and the `comparison/` suite; it is not a scripting runtime
    here. There is no working `python` on the development machine (details in the private
    `cmem/local/environment.md`). `sed -i` is fine for one regex on one file.
- **After any scripted edit, read back the lines it changed**, and treat "0 replacements" as a
  failure, not a no-op.
- 🔒 **Every Bun-version notation is the latest INSTALLED Bun** (owner, 2026-11-09, workspace
  letter H31 / `../workspace/cmem/tooling-rules.md` rule 10: "update any notations on bun version
  to the latest installed version always"; "the minimum supported version will be updated to the
  latest version currently installed"). At the first session after the owner installs a newer
  Bun, run `bun --version` (Windows and WSL), run the gate on it, then move every pin
  (`bun-version:` in all three workflows, the CI matrix), the FLOOR (ci.yml's floor leg,
  `main.ts`'s "Bun X+", README's runtime table and floor paragraph, [project.md](project.md)
  § "Runtime floors") and every current-tense "is installed" line; the release that carries a
  raised floor says so. A DATED measurement ("measured on Bun 1.4.3, 2026-10-12") stays as
  written until that test is re-run. 1.4.4 since 2026-11-09.
- ⚠️ **`cmem/` is outside `deno fmt`'s `include`, and naming a file formats it anyway.** The gate's
  `deno fmt --check` never reads cmem, so nothing requires it to be formatted — and
  [wabt-ts.md](wabt-ts.md) / [binaryen-ts.md](binaryen-ts.md) use long lines by design. 2026-09-14:
  `deno fmt cmem/binaryen-ts.md` rewrapped 862 lines around a 10-line edit (restored before commit).
  Do not run `deno fmt` on a cmem file; check `git diff --stat` against the size of the edit.

### Installed oracles — do not re-ask

- **tool:** upstream wabt
  - version: 1.0.41
  - commands: `wat2wasm` · `wasm2wat` · `wasm-validate` · `wasm-interp` · `wast2json` (installed 2026-09-02)
- **tool:** upstream binaryen
  - version: 133
  - commands: `wasm-opt` · `wasm-as` · `wasm-dis` · `wasm-ctor-eval` (installed 2026-09-02 as 132;
    the scoop shim read 133 on 2026-10-08 — its -Oz is 6.5 KB better on the corpus, so a gap figure
    names the version)
- **tool:** wasm-tools
  - version: 1.259.0
  - commands: `parse` · `print` · `validate` · `json-from-wast` (installed 2026-09-11) — reaches GC text, label and field names, which wabt cannot
- **tool:** `gh`
  - version: —
  - commands: ⬚ not installed and never will be (owner, 2026-11-08, § Git above): `git ls-remote`, the REST API
- **tool:** Bun
  - version: 1.4.4
  - commands: Windows and WSL, `bun --version` 2026-11-09 — the version every pin and the floor carry (rule below)
- **tool:** the wider wasmtk set
  - version: —
  - commands: `.../wasmtk/tests` — 532 `.wat`, 511 `.wasm`, 288 `.wast`

What each oracle can and cannot judge is in [testing.md](testing.md) § "Independent oracles".

