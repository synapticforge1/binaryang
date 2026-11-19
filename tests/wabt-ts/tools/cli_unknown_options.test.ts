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
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fsx from '../../test_fs.ts';
import { runTsAsync } from '../../run_ts.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';

const main = new URL('../../../main.ts', import.meta.url);
const run = (args: string[]) => runTsAsync(main, args);
// A module with a custom section, so a strip changes its bytes.
const WAT = '(module (func (export "f") (result i32) (i32.const 1)) (@custom "c" "xyz"))';

type Fixture = { dir: string; wasm: string; wat: string; bytes: Uint8Array };

/**
 * Runs `body` with a fresh temp folder holding the module as `in.wasm` and `in.wat`, and removes
 * the folder afterwards, also when `body` fails. 🔧 Review Q-H1 (2026-11-19): `fixture()` made one
 * per test case and never removed it — 387 were left in the system temp on win-x64.
 */
async function withFixture(body: (f: Fixture) => Promise<void> | void): Promise<void> {
  const dir = await fsx.makeTempDir({ prefix: 'binaryang-cli-options-' });
  try {
    const bytes = wat2wasm(WAT).binary!;
    const wasm = join(dir, 'in.wasm');
    const wat = join(dir, 'in.wat');
    writeFileSync(wasm, bytes);
    writeFileSync(wat, WAT);
    await body({ dir, wasm, wat, bytes });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Q-H1 — a fixture folder is removed', () => {
  it('when the test passes, and when it throws', async () => {
    let seen = '';
    await withFixture((f) => {
      seen = f.dir;
      assert(existsSync(f.wasm));
    });
    assert(!existsSync(seen), `left behind: ${seen}`);
    await withFixture((f) => {
      seen = f.dir;
      throw new Error('the body fails');
    }).catch(() => undefined);
    assert(seen !== '' && !existsSync(seen), `left behind after a failure: ${seen}`);
  });
});

describe('code lens 2 — an unknown option is an error, never skipped', () => {
  for (const tool of ['wasm2wat', 'wasm-objdump', 'wasm-strip', 'wat2wasm']) {
    it(`${tool} refuses an unknown option and touches no file`, () =>
      withFixture(async (f) => {
        const input = tool === 'wat2wasm' ? f.wat : f.wasm;
        const r = await run([tool, input, '--not-an-option']);
        assertEquals(r.code, 1, `${tool} exited ${r.code}:\n${r.stdout}${r.stderr}`);
        assert(r.stderr.includes('unknown option --not-an-option'), r.stderr);
        assertEquals([...readFileSync(f.wasm)], [...f.bytes], `${tool} changed its input`);
      }));
  }

  // `-x` was refused here until CL7 (owner, 2026-11-05) made it the details flag, as upstream's.
  it("wasm-objdump -x is upstream's details flag, not the headers", () =>
    withFixture(async (f) => {
      const r = await run(['wasm-objdump', '-x', f.wasm]);
      assertEquals(r.code, 0, r.stderr);
      assert(r.stdout.includes('Section Details:'), r.stdout);
      assert(!r.stdout.includes('Sections:'), r.stdout);
    }));
});

describe('code lens 2 — `--output=FILE`, as upstream spells it', () => {
  it('wasm-strip writes FILE and leaves the input alone', () =>
    withFixture(async (f) => {
      const out = join(f.dir, 'out.wasm');
      const r = await run(['wasm-strip', f.wasm, `--output=${out}`]);
      assertEquals(r.code, 0, r.stderr);
      assert(existsSync(out), 'out.wasm was not written');
      assertEquals([...readFileSync(f.wasm)], [...f.bytes], 'the input was stripped in place');
      assert(readFileSync(out).length < f.bytes.length, 'out.wasm still holds the custom section');
    }));

  it('wasm2wat writes FILE, not stdout', () =>
    withFixture(async (f) => {
      const out = join(f.dir, 'out.wat');
      const r = await run(['wasm2wat', f.wasm, `--output=${out}`]);
      assertEquals(r.code, 0, r.stderr);
      assert(existsSync(out), 'out.wat was not written');
      assertEquals(r.stdout.trim(), '', 'the text went to stdout');
    }));

  it('wat2wasm writes FILE', () =>
    withFixture(async (f) => {
      const out = join(f.dir, 'out.wasm');
      const r = await run(['wat2wasm', f.wat, `--output=${out}`]);
      assertEquals(r.code, 0, r.stderr);
      assert(existsSync(out), 'out.wasm was not written');
    }));

  it('wasm-strip refuses -o with no value', () =>
    withFixture(async (f) => {
      const r = await run(['wasm-strip', f.wasm, '-o']);
      assertEquals(r.code, 1);
      assertEquals([...readFileSync(f.wasm)], [...f.bytes], 'the input was stripped in place');
    }));
});
