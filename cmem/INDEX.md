# INDEX: binaryang

Read STATE.md first. Open another file only when the task matches its line. A file named
`<subject>-<part>.md` is a split of `<subject>.md`, which links it; `archive/` holds closed items.

- [STATE.md](STATE.md): every session, first — where the project stands
- [working-rules.md](working-rules.md): before the first commit or command of a session
- [open-work.md](open-work.md): when choosing the next item or picking one up
- [design-decisions.md](design-decisions.md): when a change touches a recorded decision
- [unreleased.md](unreleased.md): when a change lands on `main`, and when writing a release note
- [review-process.md](review-process.md): during a review — binaryang's slots in the standard
- [platforms.md](platforms.md): when a change is platform-specific, or recording a platform run
- [release.md](release.md): only when releasing; holds the Release History
- [publishing.md](publishing.md): when the release workflow or provenance changes
- [testing.md](testing.md): before running or adding tests, gates or corpora
- [divergences.md](divergences.md): before refactoring, optimizing or porting a pass
- [ir-convergence.md](ir-convergence.md): when working on the IR or the one front end
- [hardening.md](hardening.md): when a change meets malformed input, limits or a refusal
- [optimizer.md](optimizer.md): when comparing the optimizer with upstream `wasm-opt`
- [interpreter.md](interpreter.md): when working on the interpreter, `wasm-interp` or ctor-eval
- [bundle.md](bundle.md): when working on `wasm-bundle`
- [names.md](names.md): when a change touches internal names (N1)
- [definitions.md](definitions.md): when working on `./definitions` (D1–D4)
- [portability.md](portability.md): when a change touches the portable profile or engine floors
- [run-everywhere.md](run-everywhere.md): when a change touches the runtimes or browsers it runs on
- [one-tree.md](one-tree.md): when a change touches the `src/` layout or the IR subpath
- [bun-migration.md](bun-migration.md): when a change touches Bun, Node or the V8 referee
- [licensing.md](licensing.md): during a licensing review, or when adding a dependency
- [project.md](project.md): when a question is about scope, floors or reserved subpaths
- [handoffs.md](handoffs.md): when writing or reading a letter to a sibling repo
- [jsr-deno-exit-guide.md](jsr-deno-exit-guide.md): only for the other `@jrmarcum` JSR packages
- [wabt-ts.md](wabt-ts.md): when code, a test or a commit cites a T-id or UP-n
- [binaryen-ts.md](binaryen-ts.md): when code or a test cites a WT-n or a binaryen-ts invariant
- [best-practices.md](best-practices.md): binaryang's own lessons; read a rule a task cites
- [best-practices-shared.md](best-practices-shared.md): the workspace's 28 ★ rules, copied (H38)
- `archive/`: closed items and history, by file, to 4.1.1; read only when asked
- `local/`: private machine facts, gitignored; never given to a reviewer
