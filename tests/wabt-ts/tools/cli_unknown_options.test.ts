// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 2 (2026-10-28): `wasm2wat`, `wasm-objdump` and `wasm-strip` SKIPPED every
// option they did not recognise. The workspace's CLI contract (S2) says a syntax error in an
// option throws, and here a guess cost data: `wasm-strip in.wasm --output=out.wasm` — upstream's
// documented spelling — stripped `in.wasm` IN PLACE and never wrote `out.wasm`; `wasm2wat
// --output=x.wat` printed to stdout; `wasm-objdump -x` (upstream's details flag) printed the
// headers. Now an unknown option is reported and the tool exits 1 before touching a file, and
// `--output=FILE` is understood by the three wabt tools that write one, as upstream.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fsx from '../../test_fs.ts';
import { runTsAsync } from '../../run_ts.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';

const main = new URL('../../../main.ts', import.meta.url);
const run = (args: string[]) => runTsAsync(main, args);
// A module with a custom section, so a strip changes its bytes.
const WAT = '(module (func (export "f") (result i32) (i32.const 1)) (@custom "c" "xyz"))';

async function fixture(): Promise<{ dir: string; wasm: string; wat: string; bytes: Uint8Array }> {
  const dir = await fsx.makeTempDir({ prefix: 'binaryang-cli-options-' });
  const bytes = wat2wasm(WAT).binary!;
  const wasm = join(dir, 'in.wasm');
  const wat = join(dir, 'in.wat');
  writeFileSync(wasm, bytes);
  writeFileSync(wat, WAT);
  return { dir, wasm, wat, bytes };
}

describe('code lens 2 — an unknown option is an error, never skipped', () => {
  for (const tool of ['wasm2wat', 'wasm-objdump', 'wasm-strip', 'wat2wasm']) {
    it(`${tool} refuses an unknown option and touches no file`, async () => {
      const f = await fixture();
      const input = tool === 'wat2wasm' ? f.wat : f.wasm;
      const r = await run([tool, input, '--not-an-option']);
      assertEquals(r.code, 1, `${tool} exited ${r.code}:\n${r.stdout}${r.stderr}`);
      assert(r.stderr.includes('unknown option --not-an-option'), r.stderr);
      assertEquals([...readFileSync(f.wasm)], [...f.bytes], `${tool} changed its input`);
    });
  }

  it("wasm-objdump refuses -x (upstream's details flag) instead of printing the headers", async () => {
    const f = await fixture();
    const r = await run(['wasm-objdump', '-x', f.wasm]);
    assertEquals(r.code, 1);
    assert(r.stderr.includes('unknown option -x'), r.stderr);
  });
});

describe('code lens 2 — `--output=FILE`, as upstream spells it', () => {
  it('wasm-strip writes FILE and leaves the input alone', async () => {
    const f = await fixture();
    const out = join(f.dir, 'out.wasm');
    const r = await run(['wasm-strip', f.wasm, `--output=${out}`]);
    assertEquals(r.code, 0, r.stderr);
    assert(existsSync(out), 'out.wasm was not written');
    assertEquals([...readFileSync(f.wasm)], [...f.bytes], 'the input was stripped in place');
    assert(readFileSync(out).length < f.bytes.length, 'out.wasm still holds the custom section');
  });

  it('wasm2wat writes FILE, not stdout', async () => {
    const f = await fixture();
    const out = join(f.dir, 'out.wat');
    const r = await run(['wasm2wat', f.wasm, `--output=${out}`]);
    assertEquals(r.code, 0, r.stderr);
    assert(existsSync(out), 'out.wat was not written');
    assertEquals(r.stdout.trim(), '', 'the text went to stdout');
  });

  it('wat2wasm writes FILE', async () => {
    const f = await fixture();
    const out = join(f.dir, 'out.wasm');
    const r = await run(['wat2wasm', f.wat, `--output=${out}`]);
    assertEquals(r.code, 0, r.stderr);
    assert(existsSync(out), 'out.wasm was not written');
  });

  it('wasm-strip refuses -o with no value', async () => {
    const f = await fixture();
    const r = await run(['wasm-strip', f.wasm, '-o']);
    assertEquals(r.code, 1);
    assertEquals([...readFileSync(f.wasm)], [...f.bytes], 'the input was stripped in place');
  });
});
