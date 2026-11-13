// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Security review round 1 (2026-11-13), the CLI's files, one class:
//
//   A1  `wat2wasm a.wat -o a.wat` replaced the source with its own binary and exited 0; so did
//       wasm2wat, wasm-bundle (an input named as the output), and wasm-opt through a case variant
//       on Windows. A tool whose output changes the format now refuses an output that IS an input:
//       same device and inode, so a case variant, a hard link or a junction all count.
//   B5  wasm-opt, wasm-bundle and wasm-ctor-eval wrote with a bare fsWrite, so a bad output path
//       was an uncaught stack trace naming our absolute source paths. Now `tool: cannot write`.
//   B6  writes were in place: a failure part-way left half a module. Now a fresh file beside the
//       target, renamed over it.
//   C11 no input size cap. Now 1 GiB, and a device is read only up to it.
//   B4  an export name with a line break wrote its own line of WIT.

import { describe, it } from 'node:test';
import { chmodSync, linkSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { assert, assertEquals, assertRejects } from '@std/assert';
import * as fsx from '../../test_fs.ts';
import { runTsAsync } from '../../run_ts.ts';
import { fsRead, fsWrite, sameFile } from '../../../src/cli/io.ts';
import { commentSafe, witFromModule } from '../../../src/tools/witgen.ts';
import { readWat } from '../../../src/tools/read-wat.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';

const MAIN = new URL('../../../main.ts', import.meta.url);
const WAT = '(module (func (export "f") (result i32) (i32.const 1)))\n';
const isWindows = process.platform === 'win32';

function cli(args: string[], cwd: string) {
  return runTsAsync(MAIN, args, { cwd });
}
function looksLikeStackTrace(s: string): boolean {
  return /Uncaught/.test(s) || /^\s+at /m.test(s);
}
async function inDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsx.makeTempDir({ prefix: 'cli-safety-' });
  try {
    await body(dir);
  } finally {
    await fsx.remove(dir, { recursive: true });
  }
}
/** A file system that ignores case here: the same file under another case exists. */
function caseInsensitive(dir: string): boolean {
  try {
    statSync(join(dir, 'A.WAT'));
    return true;
  } catch {
    return false;
  }
}
async function same(path: string, bytes: Uint8Array): Promise<boolean> {
  const now = await fsx.readFile(path);
  return now.length === bytes.length && now.every((b, i) => b === bytes[i]);
}

describe('security round 1 — a tool that changes the format never writes over its input', () => {
  const refusals: [string, (dir: string) => { args: string[]; victim: string }][] = [
    [
      'wat2wasm a.wat -o a.wat',
      () => ({ args: ['wat2wasm', 'a.wat', '-o', 'a.wat'], victim: 'a.wat' }),
    ],
    ['wat2wasm a.wat -o <hard link to a.wat>', (dir) => {
      linkSync(join(dir, 'a.wat'), join(dir, 'link.wat'));
      return { args: ['wat2wasm', 'a.wat', '-o', 'link.wat'], victim: 'a.wat' };
    }],
    [
      'wasm2wat a.wasm -o a.wasm',
      () => ({ args: ['wasm2wat', 'a.wasm', '-o', 'a.wasm'], victim: 'a.wasm' }),
    ],
    [
      'wasm-opt a.wat -o a.wat (binary over text)',
      () => ({ args: ['wasm-opt', 'a.wat', '-o', 'a.wat'], victim: 'a.wat' }),
    ],
    [
      'wasm-opt a.wasm -S -o a.wasm (text over binary)',
      () => ({ args: ['wasm-opt', 'a.wasm', '-S', '-o', 'a.wasm'], victim: 'a.wasm' }),
    ],
    [
      'wasm-ctor-eval a.wat -o a.wat',
      () => ({ args: ['wasm-ctor-eval', 'a.wat', '-o', 'a.wat'], victim: 'a.wat' }),
    ],
    [
      'wasm-bundle a.wasm b.wasm -o b.wasm',
      () => ({
        args: [
          'wasm-bundle',
          'a.wasm',
          'b.wasm',
          '--on-conflict=prefix',
          '-o',
          'b.wasm',
          '--no-wit',
        ],
        victim: 'b.wasm',
      }),
    ],
  ];
  for (const [name, setup] of refusals) {
    it(`refuses ${name}, and the input is untouched`, async () => {
      await inDir(async (dir) => {
        await fsx.writeTextFile(join(dir, 'a.wat'), WAT);
        const bin = wat2wasm(new TextEncoder().encode(WAT)).binary;
        await fsx.writeFile(join(dir, 'a.wasm'), bin);
        await fsx.writeFile(join(dir, 'b.wasm'), bin);
        const { args, victim } = await setup(dir);
        const before = await fsx.readFile(join(dir, victim));
        const r = await cli(args, dir);
        assertEquals(r.code, 1, `${name} exited ${r.code}:\n${r.stderr}`);
        assert(/is the input/.test(r.stderr), `${name} did not say why:\n${r.stderr}`);
        assert(!looksLikeStackTrace(r.stderr), r.stderr);
        assert(await same(join(dir, victim), before), `${name} changed ${victim}`);
      });
    });
  }

  it('refuses a case variant of the input where the file system ignores case', async (t) => {
    await inDir(async (dir) => {
      await fsx.writeTextFile(join(dir, 'a.wat'), WAT);
      if (!caseInsensitive(dir)) {
        t.skip('this file system tells A.WAT from a.wat');
        return;
      }
      const r = await cli(['wat2wasm', 'a.wat', '-o', 'A.WAT'], dir);
      assertEquals(r.code, 1, r.stderr);
      assertEquals(await fsx.readTextFile(join(dir, 'a.wat')), WAT);
    });
  });

  it('still rewrites in place in the same format (wasm-opt a.wasm -o a.wasm, as upstream)', async () => {
    await inDir(async (dir) => {
      await fsx.writeFile(join(dir, 'a.wasm'), wat2wasm(new TextEncoder().encode(WAT)).binary);
      const r = await cli(['wasm-opt', 'a.wasm', '-O1', '-o', 'a.wasm'], dir);
      assertEquals(r.code, 0, r.stderr);
      const out = await fsx.readFile(join(dir, 'a.wasm'));
      assertEquals([...out.subarray(0, 4)], [0, 0x61, 0x73, 0x6d]);
    });
  });

  it('writes to a different file as before', async () => {
    await inDir(async (dir) => {
      await fsx.writeTextFile(join(dir, 'a.wat'), WAT);
      const r = await cli(['wat2wasm', 'a.wat', '-o', 'b.wasm'], dir);
      assertEquals(r.code, 0, r.stderr);
      assertEquals(await fsx.readTextFile(join(dir, 'a.wat')), WAT);
    });
  });
});

describe('security round 1 — a bad output path is a one-line refusal, not a stack trace', () => {
  for (const tool of ['wasm-opt', 'wasm-ctor-eval', 'wasm-bundle']) {
    it(`${tool}`, async () => {
      await inDir(async (dir) => {
        await fsx.writeTextFile(join(dir, 'a.wat'), WAT);
        const r = await cli([tool, 'a.wat', '-o', join(dir, 'no', 'such', 'out.wasm')], dir);
        assertEquals(r.code, 1, r.stderr);
        assert(!looksLikeStackTrace(r.stderr), `${tool} dumped a stack trace:\n${r.stderr}`);
        assert(r.stderr.includes(`${tool}: cannot write`), `${tool} did not say so:\n${r.stderr}`);
      });
    });
  }
});

describe('security round 1 — fsWrite replaces a file whole, never in place', () => {
  it("a new file takes the old one's place (a new inode), leaving no temporary file", async () => {
    await inDir(async (dir) => {
      const path = join(dir, 'out.wasm');
      await fsx.writeTextFile(path, 'old contents');
      const before = statSync(path, { bigint: true }).ino;
      await fsWrite(path, 'new');
      assertEquals(await fsx.readTextFile(path), 'new');
      // An in-place write keeps the inode; this is how "never half a module" shows from outside.
      assert(statSync(path, { bigint: true }).ino !== before, 'written in place, not replaced');
      assertEquals(fsx.readDirSync(dir).map((e) => e.name), ['out.wasm']);
    });
  });

  it('a write that fails part-way leaves the old file whole and no temporary file', async () => {
    await inDir(async (dir) => {
      const path = join(dir, 'out.wasm');
      await fsx.writeTextFile(path, 'old contents');
      // Data that fails after the first bytes are written: the runtime has created the file by
      // then (Bun, Node and Deno, measured 2026-11-13), as a full disk would leave it.
      function* failing() {
        yield new Uint8Array([0, 0x61, 0x73, 0x6d]);
        throw new Error('the disk is full');
      }
      await assertRejects(() => fsWrite(path, failing() as never), Error, 'the disk is full');
      assertEquals(await fsx.readTextFile(path), 'old contents');
      assertEquals(fsx.readDirSync(dir).map((e) => e.name), ['out.wasm']);
    });
  });

  it('a write into a missing directory fails and leaves nothing', async () => {
    await inDir(async (dir) => {
      await assertRejects(() => fsWrite(join(dir, 'missing', 'out.wasm'), 'x'));
      assertEquals(fsx.readDirSync(dir).length, 0);
    });
  });

  it('keeps the permission bits of the file it replaces', async (t) => {
    if (isWindows) {
      t.skip('Windows has no POSIX permission bits');
      return;
    }
    await inDir(async (dir) => {
      const path = join(dir, 'tool.wasm');
      await fsx.writeTextFile(path, 'old');
      chmodSync(path, 0o640);
      await fsWrite(path, 'new');
      assertEquals(statSync(path).mode & 0o777, 0o640);
    });
  });

  it('writes through a symbolic link to the file it names', async (t) => {
    await inDir(async (dir) => {
      const real = join(dir, 'real.wasm');
      await fsx.writeTextFile(real, 'old');
      try {
        symlinkSync(real, join(dir, 'link.wasm'), 'file');
      } catch {
        t.skip('no permission to make a symbolic link here');
        return;
      }
      await fsWrite(join(dir, 'link.wasm'), 'new');
      assertEquals(await fsx.readTextFile(real), 'new');
      assertEquals(
        (await import('node:fs')).lstatSync(join(dir, 'link.wasm')).isSymbolicLink(),
        true,
      );
    });
  });
});

describe('security round 1 — fsRead refuses what is not a module-sized file', () => {
  it('refuses a file over the limit, by its size', async () => {
    await inDir(async (dir) => {
      const path = join(dir, 'big.wasm');
      await fsx.writeFile(path, new Uint8Array(11));
      await assertRejects(() => fsRead(path, 10), Error, 'over the 10-byte input limit');
      assertEquals((await fsRead(path, 11)).length, 11);
    });
  });

  it('reads an endless device only up to the limit', async (t) => {
    if (isWindows) {
      t.skip('no /dev/zero on Windows');
      return;
    }
    await assertRejects(() => fsRead('/dev/zero', 100_000), Error, 'input limit');
  });

  it('refuses a directory', async () => {
    await inDir(async (dir) => {
      await assertRejects(() => fsRead(dir));
    });
  });

  it('sameFile: one file under two names, two files, and a name that does not exist', async () => {
    await inDir(async (dir) => {
      await fsx.writeTextFile(join(dir, 'a'), 'x');
      await fsx.writeTextFile(join(dir, 'b'), 'x');
      linkSync(join(dir, 'a'), join(dir, 'h'));
      assertEquals(await sameFile(join(dir, 'a'), join(dir, 'h')), true);
      assertEquals(await sameFile(join(dir, 'a'), join(dir, 'b')), false);
      assertEquals(await sameFile(join(dir, 'a'), join(dir, 'none')), false);
    });
  });
});

describe("security round 1 — a module's names cannot write WIT through a comment", () => {
  it('a line break in an export name stays inside the comment', () => {
    const m = readWat(
      '(module (func (export "x\\0a  export evil: func() -> s32;") (result i32) (i32.const 1)))',
    );
    const wit = witFromModule(m, 'out');
    assert(!/^ {2}export evil/m.test(wit), `the name wrote a line of WIT:\n${wit}`);
    assert(wit.includes('// skipped export x\\u000a  export evil'), wit);
  });

  it("a host import's module and field are escaped too", () => {
    const m = readWat('(module (import "env\\0d\\0a}" "f\\e2\\80\\a8g" (func)))');
    const wit = witFromModule(m, 'out');
    assert(wit.includes('env\\u000d\\u000a}.f\\u2028g'), wit);
  });

  it('commentSafe escapes the backslash, so an escape cannot be forged, and leaves the rest', () => {
    assertEquals(commentSafe('a\\u000ab'), 'a\\u005cu000ab');
    assertEquals(commentSafe('añ€😀'), 'añ€😀');
    assertEquals(commentSafe('\u0085\u007f'), '\\u0085\\u007f');
  });
});
