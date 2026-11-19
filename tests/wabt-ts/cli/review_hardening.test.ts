// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The review of 2026-11-18, hardening class: each fix, through the CLI as a user runs it.

import { after, before, describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { denoCommand } from '../../../scripts/deno.ts';

const MAIN = resolve('main.ts');
let dir = '';
const run = (...args: string[]) =>
  spawnSync('bun', [MAIN, ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
const enc = new TextEncoder();

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'binaryang-review-h-'));
  writeFileSync(
    join(dir, 'a.wat'),
    '(module (func (export "f") (param i32) (result i32) (local.get 0)))',
  );
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('H-1: a .wat that is not UTF-8 is refused where it stands', () => {
  const bad = new Uint8Array([
    ...enc.encode('(module (memory 1) (data (i32.const 0) "a'),
    0xff,
    ...enc.encode('b"))'),
  ]);
  for (const tool of ['wat2wasm', 'wasm-opt']) {
    it(`${tool} refuses a raw 0xFF in a string, located, and writes nothing`, () => {
      writeFileSync(join(dir, 'nd.wat'), bad);
      const r = run(tool, 'nd.wat', '-o', `${tool}-nd.wasm`);
      assertEquals(r.status, 1, r.stderr);
      assert(
        r.stderr.includes('nd.wat:1:40') && r.stderr.includes('malformed UTF-8 encoding'),
        r.stderr,
      );
      assert(!existsSync(join(dir, `${tool}-nd.wasm`)));
    });
    it(`${tool} reads a file with a leading BOM as the same module`, () => {
      writeFileSync(
        join(dir, 'bom.wat'),
        new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('(module)')]),
      );
      writeFileSync(join(dir, 'plain.wat'), '(module)');
      assertEquals(run(tool, 'bom.wat', '-o', 'bom.wasm').status, 0);
      assertEquals(run(tool, 'plain.wat', '-o', 'plain.wasm').status, 0);
      assertEquals([...readFileSync(join(dir, 'bom.wasm'))], [
        ...readFileSync(join(dir, 'plain.wasm')),
      ]);
    });
  }
  it('wasm-interp refuses it too', () => {
    writeFileSync(join(dir, 'nd.wat'), bad);
    assertEquals(run('wasm-interp', 'nd.wat').status, 1);
  });
});

describe('H-2: the null device is the device, on every OS', () => {
  // win-x64 / win-arm64: the reserved name, any case, and `/dev/null` as NUL. Elsewhere `/dev/null`
  // itself. Never a file named NUL left behind.
  const devices = process.platform === 'win32' ? ['NUL', 'nul', '/dev/null'] : ['/dev/null'];
  const strays = (where: string) => readdirSync(where).filter((n) => /^nul$/i.test(n));

  it('-o to the null device succeeds and leaves no file', () => {
    for (const o of devices) assertEquals(run('wat2wasm', 'a.wat', '-o', o).status, 0, o);
    assertEquals(strays(dir), []);
  });
  // 🔧 Deno refused the device's `writeFile` (EISDIR) through 4.0.0; Bun, above, never did. The
  // repo's own Deno (npm, `scripts/deno.ts`), so this runs wherever `bun install` ran.
  it('on Deno too', () => {
    const repo = resolve('.');
    for (const o of devices) {
      const [cmd, args] = denoCommand(['run', '-A', MAIN, 'wat2wasm', join(dir, 'a.wat'), '-o', o]);
      const r = spawnSync(cmd, args, { cwd: repo, encoding: 'utf8', timeout: 60_000 });
      assertEquals(r.status, 0, `${o}: ${r.stderr}`);
    }
    assertEquals(strays(dir), []);
    assertEquals(strays(repo), []);
  });
  // 🔧 Through 4.0.0 `wasm-bundle -o NUL` wrote a FILE named `NUL.wit` beside its output (Windows),
  // and `-o /dev/null` tried `/dev/null.wit` (Linux): no `.wit` beside a device (4.1.0 notes review).
  it('wasm-bundle to the null device writes no .wit beside it', () => {
    assertEquals(run('wat2wasm', 'a.wat', '-o', 'in.wasm').status, 0);
    for (const o of devices) {
      const r = run('wasm-bundle', 'in.wasm', '-o', o);
      assertEquals(r.status, 0, `${o}: ${r.stderr}`);
      assert(!/could not write the \.wit/.test(r.stderr), `${o}: ${r.stderr}`);
    }
    assertEquals(readdirSync(dir).filter((n) => /\.wit$/i.test(n)), []);
  });
  it('and to a file it still writes the .wit (the control)', () => {
    assertEquals(run('wasm-bundle', 'in.wasm', '-o', 'bundled.wasm').status, 0);
    assert(readdirSync(dir).includes('bundled.wit'), readdirSync(dir).join(', '));
    rmSync(join(dir, 'bundled.wit'));
  });
});

describe('H-3: a folder that refuses new files, around a writable output', () => {
  it('the output is overwritten in place', () => {
    const sub = join(dir, 'locked');
    spawnSync(
      process.platform === 'win32' ? 'cmd' : 'mkdir',
      process.platform === 'win32' ? ['/c', 'mkdir', sub] : [sub],
    );
    writeFileSync(join(sub, 'x.wasm'), 'old');
    const lock = () =>
      process.platform === 'win32'
        ? spawnSync('icacls', [sub, '/deny', '*S-1-1-0:(AD,WD)'], { encoding: 'utf8' })
        : chmodSync(sub, 0o555);
    const unlock = () =>
      process.platform === 'win32'
        ? spawnSync('icacls', [sub, '/remove:d', '*S-1-1-0'], { encoding: 'utf8' })
        : chmodSync(sub, 0o755);
    lock();
    try {
      const r = run('wat2wasm', 'a.wat', '-o', join(sub, 'x.wasm'));
      assertEquals(r.status, 0, r.stderr);
    } finally {
      unlock();
    }
    assert(
      readFileSync(join(sub, 'x.wasm')).subarray(0, 4).every((b, i) =>
        b === [0, 0x61, 0x73, 0x6d][i]
      ),
    );
  });
});

describe('H-4: -o with no file is refused', () => {
  for (const tool of ['wasm-bundle', 'wasm-ctor-eval']) {
    it(tool, () => {
      const r = run(tool, 'a.wat', '-o');
      assertEquals(r.status, 1, r.stderr);
      assert(r.stderr.includes('-o needs a file'), r.stderr);
      assert(!existsSync(join(dir, 'bundle.wasm')) && !existsSync(join(dir, 'output.wasm')));
    });
  }
});

describe('S-1 (security): the failing source line is printable, not raw', () => {
  it('ESC and BEL on the line do not reach stderr; the caret still points at the token', () => {
    writeFileSync(join(dir, 'e.wat'), '(module (func $x\u001b]52;c;ZXZpbA==\u0007 ) junk)');
    const r = run('wat2wasm', 'e.wat', '-o', 'e.wasm');
    assertEquals(r.status, 1);
    assert(!r.stderr.includes('\u001b') && !r.stderr.includes('\u0007'), JSON.stringify(r.stderr));
    const lines = r.stderr.split(/\r?\n/);
    // the error at `junk` (others point at the escaped ESC and BEL, each under its own token)
    const at = lines.findIndex((l) => l.includes('unknown operator "junk"')) + 1;
    assert(at > 0, r.stderr);
    // the caret line sits under `junk` in the PRINTABLE line
    assertEquals(lines[at + 1]!.indexOf('^'), lines[at]!.indexOf('junk'));
  });
});

describe('RH-1: a quoted module keeps its exact bytes, so malformed UTF-8 is refused when lexed', () => {
  it('(module quote "…\\ff…") — `bytes` holds 0xFF; lexing them refuses it; `source` shows U+FFFD', async () => {
    const { parseWastScript } = await import('../../../src/parser/wast-parser.ts');
    const { LexerSource } = await import('../../../src/parser/lexer-source.ts');
    const { parseWatModule } = await import('../../../src/parser/wast-parser.ts');
    const { formatErrors } = await import('../../../src/core/error.ts');
    const script =
      '(assert_malformed (module quote "(module (memory 1) (data (i32.const 0) \\22\\ff\\22))") "x")';
    const parsed = parseWastScript(new LexerSource(script, 'q.wast')) as {
      script: {
        commands: { scriptModule?: { kind: string; bytes?: Uint8Array; source?: string } }[];
      };
    };
    const quoted = parsed.script.commands.find((c) => c.scriptModule?.kind === 'quote')!
      .scriptModule!;
    assert(quoted.bytes!.includes(0xff), 'the exact byte');
    assert(quoted.source!.includes('�'), 'the decoded view');
    const { errors } = parseWatModule(new LexerSource(quoted.bytes!, 'quoted'));
    assert(formatErrors(errors).includes('malformed UTF-8 encoding'), formatErrors(errors));
  });
});

describe('H-5: --argument must match the export', () => {
  it('--argument without --run-export is refused, not ignored (RH-2)', () => {
    const r = run('wasm-interp', 'a.wat', '--argument=1');
    assertEquals(r.status, 1);
    assert(r.stderr.includes('--argument needs --run-export'), r.stderr);
  });
  it('a missing argument takes its default, by design (open-work 13)', () => {
    const r = run('wasm-interp', 'a.wat', '--run-export=f');
    assertEquals(r.status, 0, r.stderr);
    assert(r.stdout.includes('f(i32:0) => i32:0'), r.stdout);
  });
  it('an extra argument is refused, not ignored', () => {
    const r = run('wasm-interp', 'a.wat', '--run-export=f', '--argument=1', '--argument=2');
    assertEquals(r.status, 1);
    assert(r.stderr.includes('takes 1 argument; 2 given'), r.stderr);
  });
  it('the right count runs', () => {
    const r = run('wasm-interp', 'a.wat', '--run-export=f', '--argument=7');
    assertEquals(r.status, 0, r.stderr);
    assert(r.stdout.includes('i32:7'), r.stdout);
  });
});
