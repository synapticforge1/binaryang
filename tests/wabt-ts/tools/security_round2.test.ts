// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Security review round 2 (2026-11-13), the CLI and the text a module's names reach:
//
//   B3  wasm-bundle's `.wit` writer read ANY error as "absent", so a hand-written `.wit` that
//       could not be read was replaced without a word. Now absent means ENOENT only.
//   B4  `wasm-objdump -x` printed 5 raw ESC bytes and a U+202E from one hostile module, and
//       `wasm-interp` echoed an import's name raw: names now print through `core/printable.ts`,
//       as do every diagnostic's message and WIT comments (which let bidi and zero-width
//       characters through).
//   C   `-o ""` wrote wat2wasm's binary to the terminal; the temp file's name reached error
//       messages and added 41 characters of path; a dangling symbolic link as the output was
//       replaced by a file instead of written through.

import { describe, it } from 'node:test';
import { readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { assert, assertEquals, assertRejects } from '@std/assert';
import * as fsx from '../../test_fs.ts';
import { runTsAsync } from '../../run_ts.ts';
import { fsWrite } from '../../../src/cli/io.ts';
import { actsWhenPrinted, printable } from '../../../src/core/printable.ts';
import { formatError, unknownLocation } from '../../../src/core/error.ts';
import { commentSafe, emitWitBeside } from '../../../src/tools/witgen.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { ErrorLevel } from '../../../src/core/error.ts';

const MAIN = new URL('../../../main.ts', import.meta.url);
const isWindows = process.platform === 'win32';
const ESC = String.fromCharCode(0x1b);
const RLO = String.fromCharCode(0x202e);

async function inDir(body: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = await fsx.makeTempDir({ prefix: 'sec-r2-' });
  try {
    await body(dir);
  } finally {
    await fsx.remove(dir, { recursive: true });
  }
}
const rawControls = (b: Uint8Array) => {
  const s = new TextDecoder().decode(b);
  // The tool's own layout uses line ends and a tab (objdump's header, as upstream's).
  return [...s].filter((c) =>
    c !== '\n' && c !== '\r' && c !== '\t' && actsWhenPrinted(c.codePointAt(0)!)
  );
};

describe('security round 2 — printable: what acts when printed is escaped, the rest kept', () => {
  it('escapes C0 / C1 / DEL, line separators, bidi controls, zero-width characters and the BOM', () => {
    for (
      const u of [0x00, 0x0a, 0x1b, 0x7f, 0x85, 0x200b, 0x200e, 0x2028, 0x202e, 0x2066, 0xfeff]
    ) {
      const c = String.fromCodePoint(u);
      assertEquals(printable(`a${c}b`), `a\\u${u.toString(16).padStart(4, '0')}b`, u.toString(16));
    }
  });

  it('leaves every other character, and a backslash unless asked', () => {
    assertEquals(printable('añ€😀 $f a\\b'), 'añ€😀 $f a\\b');
    assertEquals(printable('a\\b', { backslash: true }), 'a\\u005cb');
    assertEquals(printable(`x\ny\tz${ESC}`, { keepLines: true }), 'x\ny\tz\\u001b');
  });

  it('WIT comments use it: bidi and zero-width are escaped there too now', () => {
    assertEquals(commentSafe(`a${RLO}b​c\\`), 'a\\u202eb\\u200bc\\u005c');
  });

  it('every diagnostic: a name in a message cannot drive the terminal; its line breaks stay', () => {
    const out = formatError({
      loc: unknownLocation(),
      level: ErrorLevel.Error,
      message: `unknown import "m.${ESC}[2J"\n  first line kept`,
    });
    assert(!out.includes(ESC), out);
    assert(out.includes('\\u001b[2J'), out);
    assert(out.includes('\n  first line kept'), out);
  });
});

describe("security round 2 — the tools print a hostile module's names inert", () => {
  const HOSTILE = `(module (import "m" "i\\1b[2J" (func)) ` +
    `(func (export "f\\0a\\1b[31mX\\e2\\80\\aeY")))`;

  for (const tool of ['wasm-objdump', 'wasm-interp', 'wasm-validate', 'wasm2wat']) {
    it(`${tool}: no raw ESC, line break inside a name, or bidi override`, async () => {
      await inDir((dir) => {
        writeFileSync(join(dir, 'h.wasm'), wat2wasm(HOSTILE).binary);
        const args = tool === 'wasm-objdump' ? ['-x', 'h.wasm'] : ['h.wasm'];
        const r = spawnSync(process.execPath, [
          MAIN.pathname.replace(/^\/([A-Za-z]:)/, '$1'),
          tool,
          ...args,
        ], {
          cwd: dir,
        });
        const out = new Uint8Array(Buffer.concat([r.stdout, r.stderr]));
        assertEquals(rawControls(out), [], `${tool} printed raw controls`);
        // a forged line would start with the payload after the name's line break
        const lines = new TextDecoder().decode(out).split('\n');
        assert(!lines.some((l) => l.startsWith('[31mX') || l.startsWith(`${ESC}[31mX`)), tool);
      });
    });
  }

  it('wasm-interp RUNNING an export with such a name prints its line inert', async () => {
    await inDir((dir) => {
      const wat =
        '(module (func (export "f\\0a\\1b[31mX\\e2\\80\\aeY") (result i32) (i32.const 7)))';
      writeFileSync(join(dir, 'r.wasm'), wat2wasm(wat).binary);
      const r = spawnSync(
        process.execPath,
        [
          MAIN.pathname.replace(/^\/([A-Za-z]:)/, '$1'),
          'wasm-interp',
          'r.wasm',
          '--run-all-exports',
        ],
        { cwd: dir },
      );
      const out = new Uint8Array(Buffer.concat([r.stdout, r.stderr]));
      assertEquals(r.status, 0, String(r.stderr));
      assertEquals(rawControls(out), []);
      assert(new TextDecoder().decode(out).includes('f\\u000a\\u001b[31mX\\u202eY() => i32:7'));
    });
  });

  it("an ordinary name prints as before (upstream's output unchanged)", async () => {
    await inDir(async (dir) => {
      writeFileSync(join(dir, 'ok.wasm'), wat2wasm('(module (func (export "add")))').binary);
      const r = await runTsAsync(MAIN, ['wasm-objdump', '-x', 'ok.wasm'], { cwd: dir });
      assert(r.stdout.includes('-> "add"'), r.stdout);
    });
  });
});

describe('security round 2 — the .wit beside a bundle', () => {
  it('a hand-written .wit that cannot be READ is not replaced: the failure is said', async (t) => {
    await inDir(async (dir) => {
      const wit = join(dir, 'b.wit');
      writeFileSync(wit, '// written by hand\n');
      const deny = isWindows
        ? spawnSync('icacls', [wit, '/deny', `${process.env['USERNAME']}:(RD)`]).status === 0
        : (spawnSync('chmod', ['000', wit]).status === 0);
      let readable = true;
      try {
        readFileSync(wit);
      } catch {
        readable = false;
      }
      if (!deny || readable) {
        t.skip('cannot make a file unreadable here (root, or no ACL tool)');
        return;
      }
      try {
        await assertRejects(() =>
          emitWitBeside(
            join(dir, 'b.wasm'),
            'package local:b;\n\nworld b {\n  export f: func();\n}\n',
          )
        );
      } finally {
        if (isWindows) spawnSync('icacls', [wit, '/reset']);
        else spawnSync('chmod', ['644', wit]);
      }
      assertEquals(readFileSync(wit, 'utf8'), '// written by hand\n');
    });
  });

  it('an absent .wit is still written', async () => {
    await inDir(async (dir) => {
      const r = await emitWitBeside(
        join(dir, 'b.wasm'),
        '// generated\npackage local:b;\n\nworld b {\n  export f: func();\n}\n',
      );
      assertEquals(r.outcome, 'written');
    });
  });
});

describe('security round 2 — output paths', () => {
  for (const tool of ['wat2wasm', 'wasm2wat', 'wasm-opt', 'wasm-strip']) {
    it(`${tool} -o "" is a refusal, never output to the terminal`, async () => {
      await inDir((dir) => {
        const src = '(module (func (export "f")))';
        writeFileSync(join(dir, 'a.wat'), src);
        writeFileSync(join(dir, 'a.wasm'), wat2wasm(src).binary);
        const input = tool === 'wat2wasm' ? 'a.wat' : 'a.wasm';
        const r = spawnSync(process.execPath, [
          MAIN.pathname.replace(/^\/([A-Za-z]:)/, '$1'),
          tool,
          input,
          '-o',
          '',
        ], {
          cwd: dir,
        });
        assertEquals(r.status, 1, `${tool}: ${r.stderr}`);
        assertEquals(r.stdout.length, 0, `${tool} wrote to stdout`);
        assert(String(r.stderr).includes('the output path is empty'), String(r.stderr));
      });
    });
  }

  it('a failed write names the file asked for, never the temp file', async () => {
    await inDir(async (dir) => {
      const target = join(dir, 'missing', 'out.wasm');
      const e = await assertRejects(() => fsWrite(target, 'x'));
      assert(!/\.tmp\b/.test((e as Error).message), (e as Error).message);
      assert((e as Error).message.includes(target), (e as Error).message);
      assertEquals((e as { code?: string }).code, 'ENOENT');
    });
  });

  it('the temp name adds 13 characters to the target, no more', async () => {
    // A name the file system takes, that 41 more characters would push past its limit.
    await inDir(async (dir) => {
      const name = 'x'.repeat(230);
      await fsWrite(join(dir, name), 'ok');
      assertEquals(readFileSync(join(dir, name), 'utf8'), 'ok');
    });
  });

  it('a dangling symbolic link is written through, to the file it names', async (t) => {
    await inDir(async (dir) => {
      const link = join(dir, 'out.wasm');
      try {
        symlinkSync(join(dir, 'real.wasm'), link, 'file');
      } catch {
        t.skip('no permission to make a symbolic link here');
        return;
      }
      await fsWrite(link, 'new');
      assertEquals(readFileSync(join(dir, 'real.wasm'), 'utf8'), 'new');
      const { lstatSync } = await import('node:fs');
      assert(lstatSync(link).isSymbolicLink(), 'the link was replaced');
      assert(statSync(link).isFile());
    });
  });
});
