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
import process from 'node:process';

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

describe('rounds 3-6: a `\\\\.\\` path with a device name among its names, or a last name ending in . or space', () => {
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
      // Round 4: the same device name written with `/` separators, the `//./` prefix, mixed
      // separators, or a trailing `\` reached the NUL device (exit 0, data lost) past the check.
      const fwd = w.replace(/\\/g, '/');
      for (
        const target of [
          `\\\\.\\${w}/nul`,
          `//./${fwd}/nul`,
          `//./${w}\\nul`,
          `\\\\.\\${w}\\nul\\`,
          `//./${fwd}/COM1`,
          // Round 5: anything between `\\.\` and the drive hid the device name from the check.
          `\\\\.\\\\${w}\\nul`,
          `\\\\.\\.\\${w}\\nul`,
          `\\\\.\\UNC\\localhost\\${w.replace(':', '$')}\\nul`,
          // Round 6: a device as the FIRST or a middle name (Node 24 wrote nothing, exit 0).
          `\\\\.\\NUL\\x.wasm`,
          `\\\\.\\nul\\${w.slice(3)}\\out.wasm`,
          `\\\\.\\${w}\\con\\out.wasm`,
        ]
      ) {
        const before = tree(base);
        const r = go(target);
        assertEquals(r.status, 1, `${target}: ${r.stderr}`);
        // Round 7: some of these are now refused earlier, by the namespace allow-list.
        assert(/device name|Windows namespace/.test(r.stderr), r.stderr);
        assertEquals(tree(base), before, target);
      }
      // Round 5: three leading separators also wrote NUL, exit 0; refused outright.
      {
        const target = `\\\\\\.\\${w}\\nul`;
        const before = tree(base);
        const r = go(target);
        assertEquals(r.status, 1, `${target}: ${r.stderr}`);
        assert(r.stderr.includes('three or more separators'), r.stderr);
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

describe('round 3: an NT-namespace `\\??\\` path is refused, and nothing stays behind', () => {
  for (const [rt, command] of RUNTIMES) {
    it(`${rt}: one line, no file or temp name in the folder or its parents`, () => {
      const base = join(dir, `nt-${rt}`);
      const w = join(base, 'w');
      mkdirSync(join(w, 'sub'), { recursive: true });
      const go = (target: string) => {
        const [cmd, head] = command();
        return spawnSync(cmd, [...head, 'wat2wasm', join(dir, 'a.wat'), '-o', target], {
          cwd: w,
          encoding: 'utf8',
          timeout: 60_000,
        });
      };
      if (!WIN) {
        // The control: elsewhere `\??\x.wasm` is an ordinary file name in the folder.
        const r = go('\\??\\x.wasm');
        assertEquals(r.status, 0, r.stderr);
        assertEquals(tree(w), ['\\??\\x.wasm', 'sub']);
        return;
      }
      // The share form `C$` has no colon, so only the `\??\` rule can stop it.
      const share = w.replace(':', '$');
      const targets = [
        `\\??\\UNC\\localhost\\${share}\\sub\\..\\u8.txt`,
        `\\??\\UNC\\localhost\\${share}\\u9.txt`,
        `\\??\\${w}\\u10.txt`,
        `\\??\\GLOBALROOT\\Device\\HarddiskVolume1\\x.txt`,
        `\\??\\Volume{00000000-0000-0000-0000-000000000000}\\x.txt`,
      ];
      for (const target of targets) {
        const before = tree(dir);
        const r = go(target);
        assertEquals(r.status, 1, `${target}: ${r.stderr}`);
        // Round 7: the namespace allow-list refuses every `\??\` path, before anything else.
        assert(r.stderr.includes('Windows namespace'), r.stderr);
        assertEquals(r.stderr.trimEnd().split('\n').length, 1, r.stderr);
        assertEquals(tree(dir), before, target); // the whole tree, parents included
      }
    });
  }
});

describe('round 5: the device-path check is linear in the path', () => {
  // The trailing-separator regex was quadratic in a long run of separators not at the end: a
  // library caller's path of 300,000 took 30 s (Windows; the command line caps near 32k). On
  // other systems the check does not run, and the same call is the control.
  it('a path of 300,000 separators is refused or fails within a second of CPU', async () => {
    const { fsWrite } = await import('../../../src/host.ts');
    const u0 = process.cpuUsage();
    await fsWrite(`//./${'/'.repeat(300_000)}x`, 'x').catch(() => undefined);
    const u = process.cpuUsage(u0);
    assert((u.user + u.system) / 1000 < 1000, `${(u.user + u.system) / 1000} ms of CPU`);
  });
});

describe('round 7: a Windows namespace path is written only in the allowed forms', () => {
  // Rounds 3-7 each found another spelling that reached a device past a check built for the ones
  // before it (data discarded, exit 0, on one runtime or the other): `\\?\nul\x`, `//?/nul\x`,
  // `\\?\Global\nul`, `\\.\GLOBALROOT\Device\Null\x` (Node), `\??\nul\x` (Bun). fsWrite now
  // writes only an allow-list of forms and refuses the rest before any stat or open. Called in
  // process, on each runtime the suite runs on; on other systems the rule does not apply.
  it('every refused form is refused with the namespace line, and nothing is written', async () => {
    const { fsWrite } = await import('../../../src/host.ts');
    if (!WIN) {
      // The control: no namespace rule applies here, so an ordinary path writes.
      await fsWrite(join(dir, 'ctl.wasm'), 'x');
      assertEquals(readdirSync(dir).includes('ctl.wasm'), true);
      return;
    }
    const B = String.fromCharCode(92);
    const refused = [
      `${B}${B}?${B}nul${B}x`,
      `//?/nul${B}x`,
      `${B}${B}?${B}nul${B}x${B}y`,
      `${B}${B}?${B}Global${B}nul`,
      `${B}${B}?${B}nul`,
      `${B}${B}.${B}GLOBALROOT${B}Device${B}Null${B}x`,
      `${B}${B}?${B}GLOBALROOT${B}Device${B}Null${B}x`,
      `${B}??${B}nul${B}x`,
      `${B}${B}.${B}pipe${B}x`,
    ];
    for (const p of refused) {
      let why = '';
      await fsWrite(p, 'x').catch((e: Error) => why = e.message);
      assert(why.includes('Windows namespace'), `${p}: ${why || 'written'}`);
    }
  });

  it('the allowed forms still write the file they name', async () => {
    const { fsWrite } = await import('../../../src/host.ts');
    const B = String.fromCharCode(92);
    const base = join(dir, 'allow');
    mkdirSync(base, { recursive: true });
    // Off Windows the plain path alone is the control.
    const made = WIN
      ? [
        [`${B}${B}?${B}${base}${B}v.wasm`, 'v.wasm'],
        [`${B}${B}.${B}${base}${B}d.wasm`, 'd.wasm'],
        [join(base, 'p.wasm'), 'p.wasm'],
      ]
      : [[join(base, 'p.wasm'), 'p.wasm']];
    for (const [p] of made) await fsWrite(p!, 'x');
    assertEquals(readdirSync(base).sort(), made.map(([, n]) => n!).sort());
  });
});
