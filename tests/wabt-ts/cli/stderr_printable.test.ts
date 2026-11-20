// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Round 2 review (security, privacy): what a command line puts in a CLI message cannot act on the
// terminal or forge a line of the tool's own output, in ANY tool and ANY message.

import { after, before, describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ErrorFormat,
  ErrorLevel,
  formatError,
  formatErrors,
  type Location,
  type WabtError,
} from '../../../src/core/error.ts';

const MAIN = resolve('main.ts');
const ESC = '\x1b';
// A forged line: after the break it would be a line of the tool's own report.
const FORGED = 'FORGED: ok all fine';
const TOOLS = [
  'wat2wasm',
  'wasm2wat',
  'wasm-validate',
  'wasm-objdump',
  'wasm-strip',
  'wasm-interp',
  'wasm-bundle',
  'wasm-ctor-eval',
  'wasm-opt',
];
let dir = '';
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'binaryang-stderr-'));
  writeFileSync(join(dir, 'a.wat'), '(module (func (export "f") (result i32) (i32.const 1)))');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) =>
  spawnSync('bun', [MAIN, ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });

/** Nothing in `stderr` acts on a terminal or starts a forged line. */
function assertInert(stderr: string, what: string) {
  assert(!/[\x00-\x08\x0b-\x1f\x7f]/.test(stderr), `${what}: a control byte reached stderr`);
  assert(!/^FORGED/m.test(stderr), `${what}: a forged line\n${stderr}`);
}

describe('every CLI message is printable, one line where it is one message', () => {
  for (const tool of TOOLS) {
    it(`${tool}: an unknown option, a missing input, a bad output path`, () => {
      const cases: [string, string[]][] = [
        ['unknown option', [tool, join(dir, 'a.wat'), `--bad${ESC}[2Jopt`]],
        ['unknown option with a line break', [tool, join(dir, 'a.wat'), `--bad\n${FORGED}`]],
        ['missing input', [tool, join(dir, `no${ESC}pe.wasm`)]],
        ['missing input with a line break', [tool, join(dir, `no\r\n${FORGED}.wasm`)]],
        ['missing input, -o', [tool, join(dir, `no${ESC}.wasm`), '-o', join(dir, `o${ESC}.out`)]],
      ];
      for (const [what, args] of cases) {
        const r = run(...args);
        assertInert(r.stderr, `${tool} ${what}`);
        assert(r.status !== 0, `${tool} ${what}: exit ${r.status}`);
        if (what !== 'missing input, -o' && !what.includes('line break')) {
          assert(r.stderr.includes('\\u001b'), `${tool} ${what}: the escape is written out`);
        }
      }
      // The message that names a path is ONE line, so nothing after the break can pass as the
      // tool's own: `tool: cannot read '<path>': ENOENT …` is a single line.
      const r = run(tool, join(dir, `no\n${FORGED}.wasm`));
      const named = r.stderr.split('\n').filter((l) => l.includes('\\u000a'));
      assert(named.length >= 1, r.stderr);
    });
  }

  it('an option value echoed in a message is escaped too', () => {
    const E = `${ESC}[2J\n${FORGED}`;
    const cases: string[][] = [
      ['wasm-interp', join(dir, 'a.wat'), `--fuel=${E}`],
      ['wasm-interp', join(dir, 'a.wat'), `--hang-check=${E}`],
      ['wasm-ctor-eval', join(dir, 'a.wat'), `--fuel=${E}`],
      ['wasm-bundle', join(dir, 'a.wat'), `--on-conflict=${E}`],
      ['wasm-bundle', join(dir, 'a.wat'), '--alias', E],
      ['wasm-bundle', join(dir, 'a.wat'), `--unmarked=${E}`],
      ['wasm-strip', join(dir, 'a.wasm'), `-s${E}`],
    ];
    for (const args of cases) {
      const r = run(...args);
      assertInert(r.stderr, args.join(' '));
      assert(r.status !== 0, `${args.join(' ')}: exit ${r.status}`);
      assertEquals(r.stderr.includes('\\u001b'), true, `${args.join(' ')}: ${r.stderr}`);
    }
  });

  it('an unknown command (main.ts) is escaped', () => {
    const r = run(`nosuch${ESC}[2J\n${FORGED}`);
    assertInert(r.stderr, 'unknown command');
    assertEquals(r.status, 1);
    assert(r.stderr.includes('\\u001b'), r.stderr);
  });
});

describe('a diagnostic keeps its own layout and nothing else', () => {
  const at = (filename: string, line = 1, column = 1, endColumn?: number): Location => ({
    filename,
    line,
    column,
    offset: 0,
    ...(endColumn === undefined ? {} : { endColumn }),
  });
  const err = (loc: Location, message: string): WabtError => ({
    loc,
    message,
    level: ErrorLevel.Error,
  });

  it('a file name and a message with line breaks stay on the one line', () => {
    const e = err(at(`a\n${FORGED}`, 0, 0), `bad name "x\r\n${FORGED}"`);
    const out = formatError(e);
    assertEquals(out.split('\n').length, 1, out);
    assert(!out.includes('\r'), out);
    assert(out.includes('\\u000a') && out.includes('\\u000d'), out);
  });

  it('the long layout is three lines however the source and message are broken', () => {
    const e = err(at(`f\n${FORGED}`, 1, 3, 6), `m\n${FORGED}`);
    const out = formatError(e, `ab\rcd ef\tg`, ErrorFormat.Long);
    const lines = out.split('\n');
    assertEquals(lines.length, 3, out);
    assert(lines.every((l) => !l.startsWith('FORGED')), out);
    assert(lines[1]!.includes('\t'), 'a tab in the source stays');
  });

  it('formatErrors: every entry keeps to its own lines', () => {
    const out = formatErrors([
      err(at('a', 0, 0), `x\n${FORGED}`),
      err(at('b', 0, 0), `y\n${FORGED}`),
    ]);
    assertEquals(out.split('\n').length, 2, out);
  });
});

describe('a path with a line break cannot forge a tool line', () => {
  it('wat2wasm names it on one line', () => {
    const r = run('wat2wasm', join(dir, `x\nwat2wasm: ok: all fine\n`));
    const lines = r.stderr.trimEnd().split('\n');
    assertEquals(lines.length, 1, r.stderr);
    assert(lines[0]!.startsWith("wat2wasm: cannot read '"), r.stderr);
    assert(lines[0]!.includes('\\u000a'), r.stderr);
  });
});
