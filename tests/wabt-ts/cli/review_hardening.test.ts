// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The review of 2026-11-18, hardening class: each fix, through the CLI as a user runs it.

import { after, before, describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { denoCommand } from '../../../scripts/deno.ts';
import { nodeCommand, REFEREE } from '../../../scripts/v8.ts';

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
  // `in.wasm` is made ONCE for the file (the 4.2.0 release gate): rebuilt before a case, its
  // atomic rename could meet an earlier case's child still holding the file open, which Windows
  // refuses. No case writes it; every one only reads it.
  assertEquals(run('wat2wasm', 'a.wat', '-o', 'in.wasm').status, 0);
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
  // win-x64 / win-arm64: the reserved name, any case, and `/dev/null` as NUL — and, as Win32 reads
  // them, with trailing dots or spaces or a colon (4.1.0 notes review: those were refused with
  // EINVAL). Elsewhere `/dev/null` itself. Never a file named NUL, NUL. … left behind.
  const devices = process.platform === 'win32'
    ? ['NUL', 'nul', '/dev/null', 'NUL.', 'nul ', 'NUL:', 'NUL. ']
    : ['/dev/null'];
  const strays = (where: string) => readdirSync(where).filter((n) => /^nul[. :]*$/i.test(n));

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
  // 4.1.0 notes review: a tool's report lines ("wasm-bundle: 1 module", "Wrote WASM: …") went to
  // stdout with the module when the module went there too (`-o -`, and `-o /dev/stdout` once it
  // worked): stdout must hold exactly the module the tool writes to a file; the report goes to stderr.
  it('stdout holds the module alone; the report goes to stderr', () => {
    for (const tool of ['wasm-bundle', 'wasm-opt', 'wasm-ctor-eval']) {
      assertEquals(run(tool, 'in.wasm', '-o', `${tool}.file.wasm`).status, 0, tool);
      const want = [...readFileSync(join(dir, `${tool}.file.wasm`))];
      for (const o of ['-', '/dev/stdout']) {
        const r = spawnSync('bun', [MAIN, tool, 'in.wasm', '-o', o], { cwd: dir, timeout: 60_000 });
        assertEquals(r.status, 0, `${tool} -o ${o}: ${r.stderr.toString()}`);
        assertEquals([...r.stdout], want, `${tool} -o ${o}: stdout is not the module alone`);
      }
      rmSync(join(dir, `${tool}.file.wasm`));
    }
    // wasm-opt's minify map is upstream's stdout output; it must leave stdout to the module.
    const minify = ['wasm-opt', 'in.wasm', '--minify-imports-and-exports', '-o'];
    assertEquals(run(...minify, 'min.wasm').status, 0);
    const want = [...readFileSync(join(dir, 'min.wasm'))];
    for (const o of ['-', '/dev/stdout']) {
      const r = spawnSync('bun', [MAIN, ...minify, o], { cwd: dir, timeout: 60_000 });
      assertEquals(r.status, 0, `minify -o ${o}: ${r.stderr.toString()}`);
      assertEquals([...r.stdout], want, `minify -o ${o}: stdout is not the module alone`);
      assert(r.stderr.toString().includes('"exports"'), `minify -o ${o}: no map on stderr`);
    }
    rmSync(join(dir, 'min.wasm'));
  });
  // 4.1.0 notes review: on linux-x64 `-o /dev/stdout` into a pipe failed (realpath of
  // /proc/self/fd/1, ENOENT); on win-x64 `-o CON` with no console was a bare EINVAL.
  it('the console or standard output, by its device path', () => {
    // Every OS: /dev/stdout and /dev/fd/1 are the process's stdout, written through the stream
    // (a socket or a pipe — as under this runner — cannot be reopened by path on Linux).
    for (const o of ['/dev/stdout', '/dev/fd/1']) {
      const r = spawnSync('bun', [MAIN, 'wat2wasm', 'a.wat', '-o', o], {
        cwd: dir,
        timeout: 60_000,
      });
      assertEquals(r.status, 0, `${o}: ${r.stderr.toString()}`);
      assertEquals([...r.stdout.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d], o);
    }
    if (process.platform === 'win32') {
      // win-x64: with a console the module goes there; without one, a refusal naming the device.
      const r = run('wat2wasm', 'a.wat', '-o', 'CON:');
      assert(
        r.status === 0 || /is the CON device, which cannot be opened here/.test(r.stderr),
        `${r.status}: ${r.stderr}`,
      );
    }
    assertEquals(readdirSync(dir).filter((n) => /^(con|stdout|1)/i.test(n)), []);
  });
});

describe('Q-H2: -o to a FIFO with no reader is refused, not waited on for ever', () => {
  const WASM = [0x00, 0x61, 0x73, 0x6d];
  it('no reader: exit 1 at once, naming the FIFO and why', () => {
    // Windows has no FIFO; its named pipe that is not there is refused at once too (ENOENT).
    const fifo = process.platform === 'win32'
      ? `\\\\.\\pipe\\binaryang-no-such-pipe-${process.pid}`
      : join(dir, 'noreader.fifo');
    if (process.platform !== 'win32') assertEquals(spawnSync('mkfifo', [fifo]).status, 0);
    const t0 = Date.now();
    const r = run('wat2wasm', 'a.wat', '-o', fifo);
    assertEquals(r.status, 1, `${r.stderr} ${r.error}`);
    assert(Date.now() - t0 < 20_000, 'it waited');
    assert(r.stderr.includes(fifo), r.stderr);
    if (process.platform !== 'win32') assert(r.stderr.includes('FIFO with no reader'), r.stderr);
  });
  it('with a reader the module arrives whole (POSIX; the control on Windows is a file)', () => {
    if (process.platform === 'win32') {
      assertEquals(run('wat2wasm', 'a.wat', '-o', 'ctl.wasm').status, 0);
      assertEquals([...readFileSync(join(dir, 'ctl.wasm')).subarray(0, 4)], WASM);
      return;
    }
    const fifo = join(dir, 'reader.fifo');
    assertEquals(spawnSync('mkfifo', [fifo]).status, 0);
    // This process is the reader: a non-blocking read open succeeds with no writer yet.
    const fd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const r = run('wat2wasm', 'a.wat', '-o', fifo);
      assertEquals(r.status, 0, r.stderr);
      const buf = new Uint8Array(4096);
      const n = readSync(fd, buf, 0, buf.length, null);
      assertEquals([...buf.subarray(0, 4)], WASM);
      assert(n > 8, String(n));
    } finally {
      closeSync(fd);
    }
    assert(!statSync(fifo).isFile(), 'the FIFO was replaced by a file');
  });
});

describe('privacy: a path from the command line is printable in every message', () => {
  // 4.1.x review: cliRead / cliWrite and the FIFO hint carried the path raw, and Node's own error
  // text quotes it too (`ENOENT … open '<path>'`), so an ESC in a path acted on the terminal.
  const ESC = '\x1b';
  const bad = `nodir${ESC}[31mRED${ESC}[0m/x.wasm`;
  it('-o a path with ESC: one line, no ESC byte, the escape written out', () => {
    const r = run('wat2wasm', 'a.wat', '-o', bad);
    assertEquals(r.status, 1, r.stderr);
    assert(!r.stderr.includes(ESC), JSON.stringify(r.stderr));
    assert(r.stderr.includes('\\u001b[31mRED'), r.stderr);
    assertEquals(r.stderr.trimEnd().split('\n').length, 1, r.stderr);
  });
  it('an input path with ESC and BEL', () => {
    const r = run('wat2wasm', `no${ESC}]52;c;AAAA\x07.wat`);
    assertEquals(r.status, 1, r.stderr);
    assert(!r.stderr.includes(ESC) && !r.stderr.includes('\x07'), JSON.stringify(r.stderr));
    assert(r.stderr.includes('cannot read'), r.stderr);
  });
  it('a FIFO with no reader: the hint is shell-quoted, exact for any path it can name', () => {
    if (process.platform === 'win32') return; // no FIFO there
    for (const name of ['my fifo', "it's", 'a"b$(x)`y`;z']) {
      const fifo = join(dir, `${name}.fifo`);
      assertEquals(spawnSync('mkfifo', [fifo]).status, 0);
      const r = run('wat2wasm', 'a.wat', '-o', fifo);
      assertEquals(r.status, 1, r.stderr);
      const m = /for example `cat (.*)`\)/.exec(r.stderr);
      assert(m !== null, r.stderr);
      // The shell reads the quoted word back as exactly the path, whatever its bytes.
      const back = spawnSync('bash', ['-c', `printf %s ${m![1]}`], { encoding: 'utf8' });
      assertEquals(back.stdout, fifo, name);
    }
  });
  it('a FIFO whose name has a backslash or a `!`: no example (fish and csh read them)', () => {
    if (process.platform === 'win32') return;
    // Round 2 review: `cat 'a\b'` is not the file in fish, and `!` is history in csh and tcsh.
    for (const name of ['back\\slash', 'bang!', 'a\\!b', "it's\\"]) {
      const fifo = join(dir, `${name}.fifo`);
      assertEquals(spawnSync('mkfifo', [fifo]).status, 0);
      const r = run('wat2wasm', 'a.wat', '-o', fifo);
      assertEquals(r.status, 1, r.stderr);
      assert(r.stderr.includes('FIFO with no reader'), r.stderr);
      assert(!r.stderr.includes('for example'), `${name}: ${r.stderr}`);
    }
    // The control: a name with neither still gets its example.
    const plain = join(dir, 'plain.fifo');
    assertEquals(spawnSync('mkfifo', [plain]).status, 0);
    assert(run('wat2wasm', 'a.wat', '-o', plain).stderr.includes('for example `cat '));
  });
  it('a FIFO whose name has ESC: no ESC byte, and no example command', () => {
    if (process.platform === 'win32') return;
    const fifo = join(dir, `e${ESC}[31mfifo`);
    assertEquals(spawnSync('mkfifo', [fifo]).status, 0);
    const r = run('wat2wasm', 'a.wat', '-o', fifo);
    assertEquals(r.status, 1, r.stderr);
    assert(!r.stderr.includes(ESC), JSON.stringify(r.stderr));
    assert(r.stderr.includes('FIFO with no reader') && !r.stderr.includes('for example'), r.stderr);
  });
});

describe('wat2wasm -o - is standard output, as upstream (wabt 1.0.41) and the other tools', () => {
  it('the bytes on stdout, no file named -; wasm2wat -o - stays a file, as in wabt', () => {
    const r = spawnSync('bun', [MAIN, 'wat2wasm', 'a.wat', '-o', '-'], {
      cwd: dir,
      timeout: 60_000,
    });
    assertEquals(r.status, 0, r.stderr.toString());
    assertEquals([...r.stdout.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d]);
    assert(!existsSync(join(dir, '-')), 'a file named - was made');
    // wabt 1.0.41's wasm2wat writes a FILE named `-` (its help says nothing of stdout there): kept.
    assertEquals(run('wat2wasm', 'a.wat', '-o', 'dash.wasm').status, 0);
    assertEquals(run('wasm2wat', 'dash.wasm', '-o', '-').status, 0);
    assert(readFileSync(join(dir, '-'), 'utf8').includes('(module'));
    rmSync(join(dir, '-'));
  });
});

describe('security note 3: a failed write leaves no temp or empty file (Windows)', () => {
  // Measured (Windows 11 26300, Bun 1.4.4): `-o \\?\…\sub\..\up.txt` left `up.txt.<hex>.tmp` (the
  // temp open normalised the `..`; the rename and the unlink did not), and `-o …\ads.txt:s` left
  // an empty `ads.txt`. Both are refused up front now, with one line, on Bun and on Node.
  const leftovers = (folder: string) => readdirSync(folder).sort();
  for (
    const [rt, command] of [
      ['bun', () => ['bun', [MAIN]] as [string, string[]]],
      ['node', () => nodeCommand(REFEREE, [], MAIN, [])],
    ] as [string, () => [string, string[]]][]
  ) {
    it(`${rt}: a \\\\?\\ path with .., . or an empty segment, and a stream name`, () => {
      const w = join(dir, `q3-${rt}`);
      mkdirSync(join(w, 'sub'), { recursive: true });
      // Not join(): it would resolve the `..` the test is about.
      const verbatim = (rel: string) => `\\\\?\\${w}\\${rel}`;
      const go = (target: string) => {
        const [cmd, head] = command();
        return spawnSync(cmd, [...head, 'wat2wasm', join(dir, 'a.wat'), '-o', target], {
          encoding: 'utf8',
          timeout: 60_000,
        });
      };
      // The control: a plain verbatim path writes its file.
      assertEquals(
        go(process.platform === 'win32' ? verbatim('ok.wasm') : join(w, 'ok.wasm')).status,
        0,
      );
      assertEquals(leftovers(w), ['ok.wasm', 'sub']);
      if (process.platform !== 'win32') return; // the refusals are Windows' own
      const bad: [string, string][] = [
        [verbatim('sub\\..\\up.txt'), "a '..' segment"],
        [verbatim('sub\\.\\dot.txt'), "a '.' segment"],
        [verbatim('sub\\\\dbl.txt'), 'an empty segment'],
        [join(w, 'ads.txt:s'), 'alternate data stream'],
        [verbatim('ads.txt:s'), 'alternate data stream'],
      ];
      for (const [target, why] of bad) {
        const r = go(target);
        assertEquals(r.status, 1, `${target}: ${r.stderr}`);
        assert(r.stderr.includes(why), r.stderr);
        assertEquals(r.stderr.trimEnd().split('\n').length, 1, r.stderr);
        assertEquals(leftovers(w), ['ok.wasm', 'sub'], target);
        assertEquals(leftovers(join(w, 'sub')), [], target);
      }
    });
  }
});

describe('round 2 (security): every `\\\\?\\` shape is refused or writes, and nothing stays behind', () => {
  // Measured (Windows 11 26300, Bun 1.4.4): `\\?\W/sub/../fs.txt` and `\\?\W\sub\x/..\fs2.txt`
  // left `<name>.<hex>.tmp` (the first in W's parent), `\\?\..\x.txt` and `\\?\.\x.txt` failed at
  // the rename, and `\\.\C:\…\x.wasm` was refused as an "alternate data stream". Only `\` was a
  // separator and the first segment after the prefix was never looked at.
  const tree = (root: string) => readdirSync(root, { recursive: true }).map(String).sort();
  for (
    const [rt, command] of [
      ['bun', () => ['bun', [MAIN]] as [string, string[]]],
      ['node', () => nodeCommand(REFEREE, [], MAIN, [])],
    ] as [string, () => [string, string[]]][]
  ) {
    it(`${rt}: refusals leave the tree as it was, writes leave exactly their file`, () => {
      const base = join(dir, `r2-${rt}`);
      const w = join(base, 'w');
      const cwd = join(w, 'cwd');
      mkdirSync(join(w, 'sub'), { recursive: true });
      mkdirSync(cwd);
      const win = process.platform === 'win32';
      const go = (target: string) => {
        const [cmd, head] = command();
        return spawnSync(cmd, [...head, 'wat2wasm', join(dir, 'a.wat'), '-o', target], {
          cwd,
          encoding: 'utf8',
          timeout: 60_000,
        });
      };
      // Not join(): it would resolve the `..` these paths are about.
      const V = '\\\\?\\';
      const rooted = w.slice(2);
      // [target, the file it makes under base, or the refusal's text]
      const writes: [string, string][] = win
        ? [
          [`${w}\\ok1.wasm`, 'w/ok1.wasm'],
          [`${V}${w}\\ok2.wasm`, 'w/ok2.wasm'],
          [`${w}/sub/../mixed.wasm`, 'w/mixed.wasm'],
          [`\\\\.\\${w}\\dev.wasm`, 'w/dev.wasm'],
          [`\\\\.\\${w}\\sub\\..\\dev2.wasm`, 'w/dev2.wasm'],
          [`${rooted}\\root.wasm`, 'w/root.wasm'],
          [`${w.slice(0, 2)}drive-rel.wasm`, 'w/cwd/drive-rel.wasm'],
          [`${w}\\trail.`, 'w/trail.'],
          [`${w}\\trail `, 'w/trail '],
        ]
        : [[join(w, 'ok1.wasm'), 'w/ok1.wasm']];
      for (const [target, made] of writes) {
        const before = tree(base);
        const r = go(target);
        assertEquals(r.status, 0, `${target}: ${r.stderr}`);
        const after = tree(base);
        assertEquals(after.filter((x) => !before.includes(x)).map((x) => x.replaceAll('\\', '/')), [
          made,
        ], target);
        assertEquals(before.filter((x) => !after.includes(x)), [], target);
      }
      if (!win) return; // the refusals and the device namespace are Windows' own
      const bad: [string, string][] = [
        [`${V}${w}/sub/../fs.txt`, 'a `/` in a'],
        [`${V}${w}\\sub\\x/..\\fs2.txt`, 'a `/` in a'],
        [`${V}..\\x.txt`, "a '..' segment"],
        [`${V}.\\x.txt`, "a '.' segment"],
        [`${V}${w}\\sub\\..\\up.txt`, "a '..' segment"],
        [`${V}UNC\\..\\share\\x.txt`, "a '..' segment"],
        [`${V}UNC\\localhost\\.\\x.txt`, "a '.' segment"],
        [`${V}UNC\\localhost\\\\x.txt`, 'an empty segment'],
        [`\\\\.\\${w}\\ads.txt:s`, 'alternate data stream'],
      ];
      for (const [target, why] of bad) {
        const before = tree(base);
        const r = go(target);
        assertEquals(r.status, 1, `${target}: ${r.stderr}`);
        assert(r.stderr.includes(why) || r.stderr.includes('Windows namespace'), r.stderr); // round 7: or the allow-list
        assertEquals(r.stderr.trimEnd().split('\n').length, 1, r.stderr);
        assertEquals(tree(base), before, target);
      }
      // A UNC path to this machine: Node writes it, Bun 1.4.4 cannot open it (ENOENT); either way
      // no temp file stays.
      const unc = `${V}UNC\\localhost\\${w.replace(':', '$')}\\unc.wasm`;
      const before = tree(base);
      const r = go(unc);
      const added = tree(base).filter((x) => !before.includes(x));
      assertEquals(added, r.status === 0 ? ['w\\unc.wasm'] : [], r.stderr);
    });
  }
});

describe('Q-H3: a \\\\?\\ path is the real file it names, even ending in a device name', () => {
  it('writes the file (Windows); a file named nul elsewhere (the control)', () => {
    const sub = join(dir, 'q3');
    mkdirSync(sub);
    if (process.platform === 'win32') {
      for (const name of ['nul', 'CON', 'aux.']) {
        const target = '\\\\?\\' + join(sub, name);
        const r = run('wat2wasm', 'a.wat', '-o', target);
        assertEquals(r.status, 0, `${name}: ${r.stderr}`);
        assert(existsSync(target), `${name}: no file was made`);
        assertEquals([...readFileSync(target).subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d], name);
        rmSync(target);
      }
    } else {
      assertEquals(run('wat2wasm', 'a.wat', '-o', join(sub, 'nul')).status, 0);
      assert(existsSync(join(sub, 'nul')));
    }
  });
});

describe('Q-H4: a write to standard output that fails is a one-line exit 1', () => {
  // The reader is gone before the tool writes (the read end of its stdout pipe is destroyed at
  // once): EPIPE. Through 4.1.2 wasm-bundle, wasm-ctor-eval and wasm-opt wrote `-o -` through an
  // unawaited `stdout.write` with no handler: no message, exit 0 or an unhandled error.
  const cases: [string, string[]][] = [
    ['wat2wasm', ['a.wat']],
    ['wasm2wat', ['in.wasm']],
    ['wasm-bundle', ['in.wasm', '-o', '-']],
    ['wasm-opt', ['in.wasm', '-o', '-']],
    ['wasm-opt', ['a.wat', '-o', '-']],
    ['wasm-ctor-eval', ['in.wasm', '-o', '-']],
    ['wasm-bundle', ['in.wasm', '-o', '/dev/stdout']],
  ];
  // 🔧 Hardening F1 (4.1.x review): Node reports a failed write as an 'error' event too, and with no
  // listener that was a 23-25 line "Unhandled 'error' event" trace, not one line: the cases above
  // only ran on Bun. Every runtime now, Node through fnm and Deno from npm, as a user runs them.
  // From the repository, not the temp folder: `bun run deno` finds its binary from there.
  const here = (a: string) => (a === 'a.wat' || a === 'in.wasm' ? join(dir, a) : a);
  const runtimes: [string, () => [string, string[]]][] = [
    ['bun', () => ['bun', [MAIN]]],
    ['node', () => nodeCommand(REFEREE, [], MAIN, [])],
    ['deno', () => denoCommand(['run', '-A', MAIN])],
  ];
  for (const [rt, command] of runtimes) {
    for (const [tool, args] of rt === 'bun' ? cases : cases.slice(0, 5)) {
      it(`${rt}: ${tool} ${args.join(' ')}: EPIPE`, async () => {
        const [cmd, head] = command();
        const c = spawn(cmd, [...head, tool, ...args.map(here)], {
          cwd: process.cwd(),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        c.stdout.destroy();
        let err = '';
        c.stderr.on('data', (d) => (err += d));
        const status = await new Promise<number | null>((done) => c.on('close', done));
        assertEquals(status, 1, err);
        // `bun run deno` adds a note of its own when deno exits 1; wasm-bundle reports its module
        // count first: the tool's LAST line is the failure, and nothing after it (no stack trace).
        const lines = err.trimEnd().split('\n').filter((l) => !l.startsWith('error: "deno'));
        assert(/^[a-z0-9-]+: cannot write .*EPIPE/.test(lines.at(-1)!), err);
        assert(!/Unhandled|^\s+at /m.test(err), err);
      });
    }
  }
  // A full device, where one exists: ENOSPC, the same one line on every runtime.
  for (const [rt, command] of runtimes) {
    for (
      const [tool, args] of [
        ['wat2wasm', ['a.wat']],
        ['wasm2wat', ['in.wasm']],
        ['wasm-opt', ['in.wasm', '-o', '-']],
        ['wasm2wat', ['in.wasm', '-o', '/dev/stdout']],
      ] as [string, string[]][]
    ) {
      it(`${rt}: ${tool} ${args.join(' ')} > /dev/full (Linux)`, () => {
        // No /dev/full elsewhere: the module the file made is the control there.
        if (process.platform !== 'linux') return assert(existsSync(join(dir, 'in.wasm')));
        const [cmd, head] = command();
        const q = (x: string) => `'${x}'`;
        const r = spawnSync(
          'bash',
          ['-c', `${[cmd, ...head, tool, ...args.map(here)].map(q).join(' ')} > /dev/full`],
          { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000 },
        );
        assertEquals(r.status, 1, r.stderr);
        const lines = r.stderr.trimEnd().split('\n').filter((l) => !l.startsWith('error: "deno'));
        assertEquals(lines.length, 1, r.stderr);
        assert(/^[a-z0-9-]+: cannot write .*(ENOSPC|No space left)/.test(lines[0]!), r.stderr);
      });
    }
  }
});

describe('Q-H4: a stdout closed at start (`>&-`) is refused, a discarded one is not', () => {
  // Bun reopens a closed fd 1 as /dev/null WITH O_CLOEXEC; a stdout the parent discarded (a shell's
  // `>/dev/null`, `<>/dev/null`, Node's or Bun's `stdio: 'ignore'`, Python's DEVNULL) never has it.
  // Node and Deno cannot be told apart in-process (measured, 4.1.0 notes review): only Bun is
  // checked, and only on Linux (/proc); on other systems every case below is the control.
  const sh = (redirect: string, args: string) =>
    spawnSync('bash', ['-c', `bun '${MAIN}' ${args} ${redirect}`], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
    });
  const targets = ['wasm-opt in.wasm -o -', 'wasm-opt in.wasm -o /dev/stdout', 'wat2wasm a.wat'];
  it('closed: one line on stderr and exit 1 (Linux)', () => {
    if (process.platform !== 'linux') return assert(existsSync(join(dir, 'in.wasm')));
    for (const t of targets) {
      const r = sh('>&-', t);
      assertEquals(r.status, 1, `${t}: ${r.stderr}`);
      const lines = r.stderr.trimEnd().split('\n');
      assertEquals(lines.length, 1, r.stderr);
      assert(/standard output is closed/.test(r.stderr), r.stderr);
    }
  });
  it('discarded: exit 0 for every way a parent hands over /dev/null (Linux)', () => {
    for (const t of targets) {
      if (process.platform === 'linux') {
        for (const redirect of ['>/dev/null', '>>/dev/null', '1<>/dev/null']) {
          const r = sh(redirect, t);
          assertEquals(r.status, 0, `${t} ${redirect}: ${r.stderr}`);
        }
      }
      // This runner's own `ignore` (libuv under Node, Bun's spawn under Bun).
      const [tool, ...rest] = t.split(' ');
      const r = spawnSync('bun', [MAIN, tool!, ...rest], {
        cwd: dir,
        stdio: ['ignore', 'ignore', 'pipe'],
        encoding: 'utf8',
        timeout: 60_000,
      });
      assertEquals(r.status, 0, `${t} ignore: ${r.stderr}`);
    }
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
