// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The 4.1.x round 2 review, basic and hardening notes: formatError's 200-character window never
// cuts a surrogate pair, and no user-derived part of a diagnostic is unbounded.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { ErrorFormat, ErrorLevel, formatError, type WabtError } from '../../../src/core/error.ts';

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
      long(at(3, 5), 'a' + FACE + 'b\tc'),
      'f.wat:1:3: error: x\na' + FACE + 'b\tc\n  ^^',
    );
  });
});
