// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.31 — every CLI shim dumped a Deno stack trace on a mistyped filename.
//
// The `if (import.meta.main)` blocks in `src/tools/*.ts` are published
// entrypoints — `deno run -A jsr:@jrmarcum/wabt-ts/wasm-validate module.wasm` is
// in the README. Each read its input with a bare `await Deno.readFile(path)`, so
// a missing file or a directory escaped as an uncaught exception:
//
//     error: Uncaught (in promise) NotFound: The system cannot find the file
//     specified. (os error 2): readfile 'nosuchfile.wasm'
//         const binary = await Deno.readFile(input);
//         at async Object.readFile (ext:deno_fs/30_fs.js:1:9754)
//         at async file:///D:/…/src/tools/wasm-validate.ts:150:20
//
// Five tools, both failure modes, ten for ten — a wall of Deno internals plus
// the absolute path of our own source, in response to a typo, and local paths
// leaked into whatever the user pastes into a bug report.
//
// Same rule as T13.29 ("report, do not throw") and T13.30 ("name the origin"),
// one layer further out. The library functions were fixed first because they
// are the API; the CLI is what a person actually touches.
//
// ## Why this file has two halves
//
// `deno task test` runs `deno test --allow-read`, so a subprocess test cannot
// run in the normal gate — and a test that always skips protects nothing.
// Broadening the whole suite to `-A` for one file is the wrong trade, so:
//
//   1. a SOURCE gate that needs only `--allow-read` and therefore always runs —
//      no `import.meta.main` block may call `Deno.readFile` / `writeFile` /
//      `writeTextFile` directly, which is where a regression would be
//      reintroduced;
//   2. the BEHAVIOURAL checks, which spawn the real CLIs and are skipped
//      (loudly, not silently) when `run` permission is absent.
//
// The source gate is the one that holds the line day to day; the behavioural
// half is what proved the fix and what will catch a helper that stops working.
//
// ## Updated for binaryang (merge item A9-A12)
//
// The architecture underneath this test changed; its INTENT did not, so the
// mechanism was re-pointed rather than the test deleted.
//
//   then                          now
//   `if (import.meta.main)` block  exported `main(args)`, registered in COMMANDS
//   helpers defined per tool       imported from `src/cli/io.ts`, one copy
//   `deno run tool.ts <args>`      `main.ts <tool> <args>`
//   `Deno.readFile` etc.           `node:fs/promises`, behind the same helpers
//
// The failure it guards is unchanged: a mistyped filename must produce a
// one-line `tool: cannot read '<path>': ...`, never a runtime stack trace with
// our absolute source paths in it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

const TOOLS = ['wat2wasm', 'wasm2wat', 'wasm-validate', 'wasm-objdump', 'wasm-strip'];

// ---------------------------------------------------------------------------
// 1. Source gate — always runs
// ---------------------------------------------------------------------------

describe('T13.31 — no CLI block does unguarded file I/O', () => {
  it('routes every main-block read and write through the cli* helpers', async () => {
    const offenders: string[] = [];
    let scanned = 0;

    for (const tool of TOOLS) {
      const url = new URL(`../../../src/wabt-ts/tools/${tool}.ts`, import.meta.url);
      const src = await Deno.readTextFile(url);
      const at = src.search(/export (async )?function main\(/);
      assert(at !== -1, `${tool}: no exported main() entry`);
      scanned++;

      // Only the CLI block matters. The doc comments above it deliberately show
      // `await Deno.readFile(...)` as the LIBRARY usage example, and that is
      // correct — a library caller owns its own I/O.
      const main = src.slice(at);
      // Deno.* is banned tree-wide now (scripts/check-portability.sh), so the way
      // this regresses is a direct node:fs call instead of the guarded helper.
      for (const m of main.matchAll(/(?<![A-Za-z])(readFile|writeFile|writeTextFile)\(/g)) {
        offenders.push(`${tool}: unguarded ${m[1]} in main()`);
      }
      for (const _ of main.matchAll(/(?<![A-Za-z])Deno\./g)) {
        offenders.push(`${tool}: Deno global in main() — works on 1 of 4 runtimes`);
      }
    }

    assertEquals(scanned, TOOLS.length, 'the scan did not reach every tool');
    assert(
      offenders.length === 0,
      `a bad path here becomes an uncaught Deno stack trace for the user; ` +
        `use cliRead / cliWrite:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('each tool imports the shared guarded helpers', async () => {
    for (const tool of TOOLS) {
      const url = new URL(`../../../src/wabt-ts/tools/${tool}.ts`, import.meta.url);
      const src = await Deno.readTextFile(url);
      // A11 lifted five byte-identical private copies into one shared module.
      // The gate above passes vacuously if a tool does no I/O at all, so pin
      // that each one still reaches for the helper.
      assert(
        /import \{[^}]*cliRead[^}]*\} from '\.\.\/\.\.\/cli\/io\.ts'/.test(src),
        `${tool}: does not import cliRead from src/cli/io.ts — the gate above would pass vacuously`,
      );
      // The message must name the tool, or the user cannot tell what failed.
      assert(
        new RegExp(`cliRead\\('${tool}'`).test(src) || src.includes(`'${tool}'`),
        `${tool}: cliRead is not called with its own name`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Behavioural checks — need `run`; skipped loudly without it
// ---------------------------------------------------------------------------

const canRun = (await Deno.permissions.query({ name: 'run' })).state === 'granted' &&
  (await Deno.permissions.query({ name: 'write' })).state === 'granted';

async function runCli(tool: string, args: string[]): Promise<{ code: number; err: string }> {
  // Through the unified dispatcher, which is now the only way in: the tools no
  // longer self-execute, which is the whole point of A9-A12.
  const entry = new URL('../../../main.ts', import.meta.url);
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', '--quiet', entry.pathname, tool, ...args],
    stdout: 'piped',
    stderr: 'piped',
  });
  const { code, stderr } = await cmd.output();
  return { code, err: new TextDecoder().decode(stderr) };
}

/** Deno renders an uncaught throw with an `Uncaught` banner and `at ` frames. */
function looksLikeStackTrace(s: string): boolean {
  return /Uncaught/.test(s) || /^\s+at /m.test(s);
}

describe('T13.31 — the CLIs actually report I/O failures', { ignore: !canRun }, () => {
  for (const tool of TOOLS) {
    it(`${tool} reports a missing input file`, async () => {
      const { code, err } = await runCli(tool, ['definitely-not-here.wasm']);
      assertEquals(code, 1, `${tool} should exit 1`);
      assert(
        !looksLikeStackTrace(err),
        `${tool} dumped a stack trace for a missing file:\n${err.slice(0, 400)}`,
      );
      assert(
        err.includes(tool) && /cannot read/.test(err),
        `${tool} did not name itself and the failure:\n${err.slice(0, 200)}`,
      );
    });

    it(`${tool} reports a directory given as input`, async () => {
      const dir = await Deno.makeTempDir();
      try {
        const { code, err } = await runCli(tool, [dir]);
        assertEquals(code, 1);
        assert(
          !looksLikeStackTrace(err),
          `${tool} dumped a stack trace for a directory:\n${err.slice(0, 400)}`,
        );
      } finally {
        await Deno.remove(dir);
      }
    });
  }

  it('reports an unwritable output path without a stack trace', async () => {
    const dir = await Deno.makeTempDir();
    try {
      const wat = `${dir}/in.wat`;
      await Deno.writeTextFile(wat, '(module (func))');
      const { code, err } = await runCli('wat2wasm', [wat, '-o', `${dir}/nope/out.wasm`]);
      assertEquals(code, 1);
      assert(!looksLikeStackTrace(err), `stack trace on write failure:\n${err.slice(0, 400)}`);
      assert(/cannot write/.test(err), `did not name the write failure:\n${err.slice(0, 200)}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it('still succeeds on a valid input', async () => {
    // The guard against over-correcting: exiting 1 on everything would satisfy
    // every assertion above.
    const dir = await Deno.makeTempDir();
    try {
      const wat = `${dir}/ok.wat`;
      const wasm = `${dir}/ok.wasm`;
      await Deno.writeTextFile(wat, '(module (func (export "f") (result i32) (i32.const 42)))');

      const enc = await runCli('wat2wasm', [wat, '-o', wasm]);
      assertEquals(enc.code, 0, `wat2wasm failed on valid input: ${enc.err}`);
      assert((await Deno.stat(wasm)).size > 8, 'wat2wasm produced no output');

      for (const tool of ['wasm2wat', 'wasm-validate', 'wasm-objdump']) {
        const r = await runCli(tool, [wasm]);
        assertEquals(r.code, 0, `${tool} failed on a valid module: ${r.err}`);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
