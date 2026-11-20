// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Round 3 review (security, privacy): a STATUS line on stdout (`Wrote WASM: <path>`, a ctor-eval
// progress line, a bundle report line) holds a path, a ctor name or an export name from the
// command line or the module; printed raw an ESC in it acted on the terminal. Every such line goes
// through `cliInfo` (`src/host.ts`). The tool's own two-line messages keep their lines.

import { after, before, describe, it } from 'node:test';
import { assert } from '@std/assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { actsWhenPrinted } from '../../../src/core/printable.ts';

const MAIN = resolve('main.ts');
const WIN = process.platform === 'win32';
// A file name can hold these on this OS: Windows refuses every control character below U+0020.
const ODD = WIN ? '\u202e\u200b' : '\x1b[2J\r\u202e';
const ESC = '\x1b';
let dir = '';
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'binaryang-stdout-'));
  writeFileSync(join(dir, 'a.wat'), '(module (func (export "f") (result i32) (i32.const 1)))');
  // The export names carry an ESC through the WAT escape `\1b`.
  const named = String
    .raw`(module (memory 1) (func (export "f\1b[2Jx") (result i32) (i32.const 1)))`;
  writeFileSync(join(dir, 'b1.wat'), named);
  writeFileSync(join(dir, 'b2.wat'), named);
  writeFileSync(join(dir, 'p.wat'), '(module (func (export "f") (param i32)))');
  writeFileSync(join(dir, 'c.wat'), String.raw`(module (func $s (export "f\1b[2Jx")) (start $s))`);
  writeFileSync(join(dir, `i${ODD}.wat`), '(module (memory 1) (func (export "g")))');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) =>
  spawnSync('bun', [MAIN, ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });

/** Nothing in `stdout` acts on a terminal: only the line breaks that end a line. */
function assertInert(stdout: string, what: string) {
  for (const c of stdout) {
    const u = c.codePointAt(0)!;
    assert(c === '\n' || !actsWhenPrinted(u), `${what}: raw U+${u.toString(16)} on stdout`);
  }
}

describe('a status line on stdout is printable', () => {
  const cases: [string, string[], string][] = [
    ['wasm-opt, -o path', ['wasm-opt', 'a.wat', '-O1', '-o', `o${ODD}.wasm`], 'Wrote WASM: o'],
    [
      'wasm-opt, -o path, .wat name',
      ['wasm-opt', 'a.wat', '-O1', '-o', `o${ODD}.wat`],
      'Wrote WASM: o',
    ],
    ['wasm-ctor-eval, ctor name', [
      'wasm-ctor-eval',
      'c.wat',
      `--ctors=f${ESC}[2Jx`,
      '-o',
      'o.wasm',
    ], 'trying to eval f'],
    ['wasm-ctor-eval, -o path', ['wasm-ctor-eval', 'c.wat', '-o', `o${ODD}.wasm`], 'Wrote WASM: o'],
    ['wasm-bundle, conflicting export', [
      'wasm-bundle',
      'b1.wat',
      'b2.wat',
      '--on-conflict=prefix',
      '--unmarked=guess',
      '-o',
      'o.wasm',
    ], 'conflict "f'],
    ['wasm-bundle, -o path', ['wasm-bundle', 'a.wat', '-o', `o${ODD}.wasm`], 'Wrote WASM: o'],
    [
      'wasm-bundle, input path',
      ['wasm-bundle', `i${ODD}.wat`, '--unmarked=guess', '-o', 'o.wasm'],
      'no linking section',
    ],
  ];
  for (const [what, args, mustHave] of cases) {
    it(what, () => {
      const r = run(...args);
      assert(r.status === 0, `${what}: exit ${r.status}\n${r.stderr}`);
      assert(r.stdout.includes(mustHave), `${what}: the line is there\n${r.stdout}`);
      assertInert(r.stdout, what);
    });
  }

  it("the tool's own two-line message keeps its two lines, on stdout and on stderr", () => {
    const want =
      '  ...stopping due to params\n  RECOMMENDATION: consider --ignore-external-input\n';
    // The module to a file: the report is on stdout.
    const file = run('wasm-ctor-eval', 'p.wat', '--ctors=f', '-o', 'o.wasm');
    assert(file.stdout.includes(want), `stdout: ${JSON.stringify(file.stdout)}`);
    assert(!file.stdout.includes('\\u000a'), 'no escaped line break on stdout');
    // The module to stdout (-o -): the report is on stderr, the module alone on stdout.
    const pipe = run('wasm-ctor-eval', 'p.wat', '--ctors=f', '-o', '-');
    assert(pipe.stderr.includes(want), `stderr: ${JSON.stringify(pipe.stderr)}`);
    assert(!pipe.stderr.includes('\\u000a'), 'no escaped line break on stderr');
  });

  it('the module on stdout is untouched: the report goes to stderr', () => {
    const r = run('wasm-opt', 'a.wat', '-O1', '-o', '-');
    assert(r.status === 0, r.stderr);
    assert(r.stdout.startsWith('\0asm'), 'the module bytes, alone on stdout');
  });
});
