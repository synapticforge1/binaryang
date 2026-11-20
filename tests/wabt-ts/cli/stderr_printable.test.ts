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
        ['missing input', [tool, join(dir, `no${ESC}pe.wasm`)]],
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
