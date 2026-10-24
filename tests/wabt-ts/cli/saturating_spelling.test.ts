// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 33 / FL1 (owner, 2026-10-24: "lets rename binaryang's to conform with upstream
// saturating-float-to-int"): the flag is spelled as upstream wabt 1.0.41 and wasm-tools spell it —
// through the CLIs themselves. The old spelling, deprecated in 1.17.0, is gone in 2.0.0 (open-work
// 39; owner: "we will remove the deprecated spelling on the next release", "2.0.0 is accepted").

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('../../../main.ts', import.meta.url));
const cli = (args: string[]) => spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8' });

describe('--disable-saturating-float-to-int, as upstream', () => {
  const dir = mkdtempSync(join(tmpdir(), 'binaryang-sat-'));
  const wat = join(dir, 'sat.wat');
  writeFileSync(wat, '(module (func (param f32) (result i32) local.get 0 i32.trunc_sat_f32_s))');

  it("upstream's spelling switches the feature off: the module is refused, no warning", () => {
    const r = cli([
      'wat2wasm',
      wat,
      '--disable-saturating-float-to-int',
      '-o',
      join(dir, 'a.wasm'),
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain('deprecated');
    expect(r.stderr).not.toContain('unknown option');
  });

  it('the old spelling is refused as an unknown option', () => {
    const r = cli(['wat2wasm', wat, '--disable-sat-float-to-int', '-o', join(dir, 'b.wasm')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('wat2wasm: unknown option --disable-sat-float-to-int');
  });

  it('with neither, the module assembles', () => {
    expect(cli(['wat2wasm', wat, '-o', join(dir, 'c.wasm')]).status).toBe(0);
  });

  it('cleanup', () => rmSync(dir, { recursive: true, force: true }));
});
