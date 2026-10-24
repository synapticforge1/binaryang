// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Every command answers `--help` and `--version` (open-work 36; owner, 2026-10-24: "add the help to
// the cli tools and the needed information to go with it"), in upstream wabt's layout. And every
// EXAMPLE a help prints is run, against fixtures with the file names the examples use: an example
// that does not work is worse than none.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { FEATURE_DEFINITIONS } from '../../../src/definitions/mod.ts';

const MAIN = fileURLToPath(new URL('../../../main.ts', import.meta.url));
const COMMANDS = [
  'wat2wasm',
  'wasm2wat',
  'wasm-validate',
  'wasm-objdump',
  'wasm-strip',
  'wasm-opt',
  'wasm-ctor-eval',
  'wasm-interp',
  'wasm-bundle',
  'wasm2ts',
];
const cli = (args: string[], cwd?: string) =>
  spawnSync(process.execPath, [MAIN, ...args], { cwd, encoding: 'utf8', timeout: 120_000 });
const VERSION = /^binaryang \d+\.\d+\.\d+$/;

describe('every command answers --help and --version', () => {
  for (const c of COMMANDS) {
    it(c, () => {
      const h = cli([c, '--help']);
      expect(h.status).toBe(0);
      expect(h.stdout.startsWith(`usage: ${c} `)).toBe(true);
      for (const part of ['\nexamples:\n', '\noptions:\n', '--help ', '--version ']) {
        expect(h.stdout).toContain(part);
      }
      const v = cli([c, '--version']);
      expect(v.status).toBe(0);
      expect(v.stdout.trim()).toMatch(VERSION);
    });
  }

  it('the tools that validate list every D2 feature, as the switch away from its default', () => {
    for (const c of ['wat2wasm', 'wasm-validate']) {
      const out = cli([c, '--help']).stdout;
      for (const f of FEATURE_DEFINITIONS.entries) {
        expect(out).toContain(`${f.defaultOn ? '--disable-' : '--enable-'}${f.cli} `);
      }
      // The spelling removed in 2.0.0 is not offered (open-work 39).
      expect(out).not.toContain('sat-float-to-int ');
    }
  });
});

describe('every example a help prints runs', () => {
  // The files the examples name: add.wat, add.wasm, test.wasm, in.wasm, a.wasm, b.wasm.
  const dir = mkdtempSync(join(tmpdir(), 'binaryang-help-'));
  const ADD =
    '(module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)' +
    ' (func (export "answer") (result i32) i32.const 42))';
  const CTOR = '(module (memory (export "memory") 1) (global $g (mut i32) (i32.const 0))' +
    ' (func (export "_initialize") (global.set $g (i32.const 7))) (func (export "get") (result i32) global.get $g))';
  const bin = (wat: string) => wat2wasm(wat, { textForm: false }).binary;
  writeFileSync(join(dir, 'add.wat'), ADD);
  writeFileSync(join(dir, 'add.wasm'), bin(ADD));
  writeFileSync(join(dir, 'test.wasm'), bin(ADD));
  writeFileSync(join(dir, 'in.wasm'), bin(CTOR));
  writeFileSync(join(dir, 'a.wasm'), bin('(module (func (export "f") (result i32) i32.const 1))'));
  // A name of its own: two inputs exporting the same name are refused by default, as documented.
  writeFileSync(join(dir, 'b.wasm'), bin('(module (func (export "g") (result i32) i32.const 2))'));

  for (const c of COMMANDS) {
    const examples = cli([c, '--help']).stdout.split('\n')
      .filter((l) => l.startsWith('  $ '))
      .map((l) => l.slice(4).trim().split(/\s+/));
    it(`${c}: ${examples.length} example(s)`, () => {
      expect(examples.length).toBeGreaterThan(0);
      for (const [tool, ...args] of examples) {
        expect(tool).toBe(c);
        const r = cli([c, ...args], dir);
        // wasm2ts says it is not implemented, and exits 1: its example says so too.
        expect(`${c} ${args.join(' ')}: exit ${r.status}`).toBe(
          `${c} ${args.join(' ')}: exit ${c === 'wasm2ts' ? 1 : 0}`,
        );
      }
    });
  }

  it('cleanup', () => rmSync(dir, { recursive: true, force: true }));
});
