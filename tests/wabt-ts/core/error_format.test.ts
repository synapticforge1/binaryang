// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The 4.1.x round 2 review, basic and hardening notes: formatError's 200-character window never
// cuts a surrogate pair, and no user-derived part of a diagnostic is unbounded.

import { after, before, describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ErrorFormat,
  ErrorLevel,
  formatError,
  formatErrors,
  type WabtError,
} from '../../../src/core/error.ts';

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const FACE = '\u{1F600}';

const at = (column: number, endColumn?: number, filename = 'f.wat'): WabtError['loc'] => ({
  filename,
  line: 1,
  column,
  offset: 0,
  ...(endColumn === undefined ? {} : { endColumn }),
});
const err = (loc: WabtError['loc'], message: string): WabtError => ({
  loc,
  message,
  level: ErrorLevel.Error,
});
const long = (loc: WabtError['loc'], line: string) =>
  formatError(err(loc, 'x'), line, ErrorFormat.Long);

describe('the quoted window never cuts a surrogate pair', () => {
  it('astral characters at every offset of the window: no lone surrogate at either edge', () => {
    const line = FACE.repeat(300);
    // The window starts on a low surrogate for an odd column and on a high one for an even one,
    // and ends on each in turn: the cut lands on both halves across the sweep.
    for (let column = 150; column <= 450; column++) {
      const out = long(at(column, column + 2), line);
      assert(!LONE_SURROGATE.test(out), `column ${column}`);
      assertEquals(out.split('\n').length, 3, `column ${column}`);
    }
  });

  it('a window that starts or ends inside a pair drops the half, not the line', () => {
    // Column 202: the window starts at index 101, a low surrogate, and ends at 301.
    const quoted = long(at(202, 204), FACE.repeat(300)).split('\n')[1]!;
    assert(quoted.startsWith('…' + FACE), quoted.slice(0, 8));
    assert(quoted.endsWith(FACE + '…'), 'the cut end is marked, after a whole character');
    assertEquals([...quoted.slice(1, -1)].every((c) => c === FACE), true);
  });

  it('a line of tabs and astral characters keeps its tabs and its caret', () => {
    const line = '\t'.repeat(120) + FACE.repeat(200) + '\t'.repeat(50);
    for (const column of [121, 150, 221, 222, 330]) {
      const out = long(at(column, column + 2), line).split('\n');
      assertEquals(out.length, 3, `column ${column}`);
      assert(!LONE_SURROGATE.test(out.join('\n')), `column ${column}`);
      // The window holds the leading tabs only while it starts inside them.
      if (column <= 150) assert(out[1]!.includes('\t'), `column ${column}: tabs stay`);
    }
    // The caret line is tabs where the quoted text before the token has them.
    const [, quoted, caret] = long(at(121, 123), line).split('\n');
    assert(quoted!.startsWith('…' + '	'.repeat(10)), 'the window starts at the tabs');
    assert(caret!.startsWith(' ' + '	'.repeat(10)), 'the caret keeps a tab under each tab');
  });

  it('a short line is printed exactly as it was (the control)', () => {
    assertEquals(
      long(at(4, 6), 'a' + FACE + 'b\tc'),
      'f.wat:1:4: error: x\na' + FACE + 'b\tc\n  ^^',
    );
  });
});

describe('every user-derived part of a diagnostic is bounded', () => {
  const big = 'a'.repeat(2_000_000);

  it('a quoted 2 MB token keeps its start, its length and the rest of the message', () => {
    const out = formatError(err(at(1), `undefined func "$${big}" in the module`));
    assert(out.length < 1500, `${out.length}`);
    assert(out.includes('(2000001 characters)'), out.slice(0, 400));
    assert(out.endsWith(' in the module'), out.slice(-60));
    assert(out.includes('"$aaaa'), out.slice(0, 100));
  });

  it('every quote style, an unquoted token and a file name', () => {
    for (const q of ['"', "'", '`']) {
      const out = formatError(err(at(1), `bad ${q}${big}${q}`));
      assert(out.length < 1500, `${q}: ${out.length}`);
    }
    const unquoted = formatError(err(at(1), `bad ${big}`));
    assert(unquoted.length < 1500 && unquoted.includes('characters)'), `${unquoted.length}`);
    const named = formatError(err(at(1, undefined, big), 'x'));
    assert(named.length < 1500, `${named.length}`);
  });

  it('a cut never splits a surrogate pair', () => {
    for (const pad of ['', 'b']) {
      const out = formatError(err(at(1), `n ${pad}"${FACE.repeat(500)}"`));
      assert(!LONE_SURROGATE.test(out), pad);
    }
    const plain = formatError(err(at(1), 'z'.repeat(999) + FACE.repeat(50)));
    assert(!LONE_SURROGATE.test(plain), 'the part cap');
  });

  it('formatErrors with 150 such errors stays in the tens of kilobytes', () => {
    const out = formatErrors(Array.from({ length: 150 }, () => err(at(1), `x "${big}"`)));
    assert(out.length < 60_000, `${out.length}`);
    assert(out.endsWith('... 50 more errors'), out.slice(-30));
  });

  it('a message within the bounds is unchanged (the control)', () => {
    const msg = `undefined func "${'a'.repeat(150)}" and 'b' and \`c\``;
    assertEquals(formatError(err(at(1), msg)), `f.wat:1:1: error: ${msg}`);
  });

  describe('through the CLI', () => {
    let dir = '';
    before(() => {
      dir = mkdtempSync(join(tmpdir(), 'binaryang-bound-'));
    });
    after(() => rmSync(dir, { recursive: true, force: true }));
    const cases: [string, () => string][] = [
      ['an unknown $name', () => `(module (func (call $${big})))`],
      [
        'an import field',
        () => `(module (import "m" "${big}" (func)) (export "e" (func $${big})))`,
      ],
      ['an unknown keyword', () => `(module (func ${big}))`],
    ];
    for (const [name, text] of cases) {
      it(`${name} of 2 MB: stderr is a few KB`, () => {
        const file = join(dir, 'big.wat');
        writeFileSync(file, text());
        const r = spawnSync('bun', [resolve('main.ts'), 'wat2wasm', file], {
          encoding: 'utf8',
          timeout: 120_000,
          maxBuffer: 64 * 1024 * 1024,
        });
        assertEquals(r.status, 1);
        assert(r.stderr.length < 4000, `${r.stderr.length} bytes`);
      });
    }
  });
});

describe('round 3: a long file name keeps its position, and the true size bound holds', () => {
  it('the name is cut alone: `:line:col` is still there', () => {
    const out = formatError(err({ ...at(4), line: 3 }, 'm'), undefined, ErrorFormat.Short);
    assertEquals(out, 'f.wat:3:4: error: m');
    const name = 'n'.repeat(5000);
    const cut = formatError(err({ ...at(4, undefined, name), line: 3 }, 'm'));
    assert(cut.endsWith(':3:4: error: m'), cut.slice(-40));
    assert(cut.startsWith('n'.repeat(900)) && cut.includes('(5000 characters)'), cut.slice(0, 60));
    // A binary location: the offset stays too.
    const bin = formatError(err({ filename: name, line: 0, column: 0, offset: 0x25 }, 'm'));
    assert(bin.includes(':0000025: error: m'), bin.slice(0, 80));
  });

  it('the worst case (every character escaped) stays within the stated 1,405,800 + count line', () => {
    const esc = '\x1b'.repeat(5000);
    const loc = { filename: esc, line: 1, column: 300, offset: 0, endColumn: 900 };
    const one = formatError(err(loc, esc), esc, ErrorFormat.Long);
    assert(one.length <= 14_058, `one diagnostic: ${one.length}`);
    // The unescaped parts are 1,000 characters at most, and six times that is what is printed.
    assert(one.length > 12_000, `the measurement is of the worst case: ${one.length}`);
    const all = formatErrors(
      Array.from({ length: 150 }, () => err(loc, esc)),
      ErrorFormat.Long,
      esc,
    );
    const [body, count] = [all.slice(0, all.lastIndexOf('\n')), all.slice(all.lastIndexOf('\n'))];
    assert(body.length <= 1_405_800 + 100, `100 diagnostics: ${body.length}`);
    assert(count.includes('50 more errors'), count);
  });
});
