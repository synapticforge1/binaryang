// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Round 3 review (security, basic), Windows path namespaces in `fsWrite`, through the CLI as a user
// runs it, on Bun and on Node. The shapes are Windows' own; elsewhere the control is that an
// ordinary file called `nul` is written.

import { after, before, describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nodeCommand, REFEREE } from '../../../scripts/v8.ts';

const MAIN = resolve('main.ts');
const WIN = process.platform === 'win32';
let dir = '';
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'binaryang-r3paths-'));
  writeFileSync(join(dir, 'a.wat'), '(module (func (export "f") (result i32) (i32.const 1)))');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const RUNTIMES: [string, () => [string, string[]]][] = [
  ['bun', () => ['bun', [MAIN]]],
  ['node', () => nodeCommand(REFEREE, [], MAIN, [])],
];
const tree = (root: string) => readdirSync(root, { recursive: true }).map(String).sort();

describe('round 3: a `\\\\.\\X:\\...` path whose last name is a device name or ends in . or space', () => {
  for (const [rt, command] of RUNTIMES) {
    it(`${rt}: refused with one accurate line, no file, no device write`, () => {
      const base = join(dir, `dev-${rt}`);
      const w = join(base, 'w');
      mkdirSync(w, { recursive: true });
      const go = (target: string) => {
        const [cmd, head] = command();
        return spawnSync(cmd, [...head, 'wat2wasm', join(dir, 'a.wat'), '-o', target], {
          cwd: w,
          encoding: 'utf8',
          timeout: 60_000,
        });
      };
      if (!WIN) {
        // The control: nothing here is a device, so `nul` is a file like any other.
        const r = go(join(w, 'nul'));
        assertEquals(r.status, 0, r.stderr);
        assertEquals(tree(w), ['nul']);
        return;
      }
      for (
        const last of ['nul', 'NUL', 'con', 'COM1', 'nul.', 'nul ', 'nul.txt.', 'trail.', 'trail ']
      ) {
        const target = `\\\\.\\${w}\\${last}`;
        const before = tree(base);
        const r = go(target);
        assertEquals(r.status, 1, `${target}: ${r.stderr}`);
        assert(r.stderr.includes('device name'), r.stderr);
        assertEquals(r.stderr.trimEnd().split('\n').length, 1, r.stderr);
        assertEquals(tree(base), before, target);
      }
      // What still writes: an ordinary last name in the device namespace, the plain path of a
      // device name (the device, as documented), and a plain trailing-dot name.
      for (const [target, made] of [[`\\\\.\\${w}\\nul.wasm`, ['nul.wasm']], [`${w}\\nul`, []]]) {
        const before = tree(base);
        const r = go(target as string);
        assertEquals(r.status, 0, `${target}: ${r.stderr}`);
        const added = tree(base).filter((x) => !before.includes(x)).map((x) =>
          x.replace('w\\', '')
        );
        assertEquals(added, made, target as string);
      }
    });
  }
});
