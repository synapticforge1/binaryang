// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Security review round 1 (2026-11-13), C9: `dst.push(...src)` passes every element as an
// argument, and V8 runs out of call stack at some tens of thousands. The parser spread a block's
// statements into its parent that way, so on Node and Deno one FLAT function of 300,000
// instructions was refused as "nests deeper than this tool can follow"; Bun read it. Fixed as a
// class: every such append in `src/` is `pushAll` (`src/core/arrays.ts`), and this file keeps it
// so. `bun run test` runs this on V8, where the failure shows.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import * as fsx from '../../test_fs.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { formatErrors } from '../../../src/core/error.ts';
import { pushAll, replaceAll } from '../../../src/core/arrays.ts';

/** A call whose arguments include a spread: `f(...x)`, `f(a, ...x)` — not `[...x]` or `{...x}`. */
const CALL_SPREAD =
  /\b(push|unshift|splice|max|min|fromCharCode|fromCodePoint|apply|of)\((?:[^()[\]{}]*?,\s*)?\.\.\./;
/** A line that is all comment: a doc comment's body, or `//`. */
const COMMENT = /^\s*(\*|\/\/|\/\*)/;

describe('C9 — no append by argument spread in src/', () => {
  it('src/ has no `.push(...x)`, `.splice(i, n, ...x)`, `Math.max(...x)` or the like', async () => {
    const offenders: string[] = [];
    let files = 0;
    const walk = async (dir: URL) => {
      for await (const e of fsx.readDir(dir)) {
        const url = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
        if (e.isDirectory) await walk(url);
        else if (e.name.endsWith('.ts')) {
          files++;
          const lines = (await fsx.readTextFile(url)).split('\n');
          lines.forEach((l, i) => {
            if (!COMMENT.test(l) && CALL_SPREAD.test(l)) {
              offenders.push(`${url.pathname.split('/src/')[1]}:${i + 1}: ${l.trim()}`);
            }
          });
        }
      }
    };
    await walk(new URL('../../../src/', import.meta.url));
    assert(files > 100, `scanned only ${files} files`);
    assertEquals(offenders, [], 'use pushAll / replaceAll from src/core/arrays.ts');
  });

  it('the scan sees each form it is meant to', () => {
    for (
      const bad of [
        'a.push(...b);',
        'a.splice(0, a.length, ...b);',
        'Math.max(...xs)',
        'a.push(x, ...b)',
      ]
    ) {
      assert(CALL_SPREAD.test(bad), bad);
    }
    for (
      const ok of [
        '[...a, ...b]',
        'f({ ...o })',
        'out.push({ ...n, values: [], ...(c ? { x } : {}) });',
        'pushAll(a, b)',
        'const [x, ...rest] = a;',
      ]
    ) {
      assert(!CALL_SPREAD.test(ok), ok);
    }
  });

  it('pushAll and replaceAll keep order, take any length, and survive aliasing', () => {
    const big = Array.from({ length: 500_000 }, (_, i) => i);
    const a = [-1];
    pushAll(a, big);
    assertEquals(a.length, 500_001);
    assertEquals([a[0], a[1], a[500_000]], [-1, 0, 499_999]);
    replaceAll(a, [7, 8]);
    assertEquals(a, [7, 8]);
    replaceAll(a, a);
    assertEquals(a, [7, 8]);
  });
});

describe('C9 — a flat function of 300,000 instructions is read on every runtime', () => {
  const body = '(local.set 0 (i32.const 1)) '.repeat(150_000);
  const wat = `(module (func (export "f") (local i32) ${body})
    (func (export "g") (local i32) (block ${body}) (if (i32.const 1) (then ${body}) (else ${body}))))`;

  it('wat2wasm, wasm-validate, wasm2wat and wasm-opt all accept it', async () => {
    const r = wat2wasm(wat);
    assertEquals(r.errors.length, 0, formatErrors(r.errors).slice(0, 300));
    const v = wasmValidate(r.binary);
    assertEquals(v.errors.length, 0, formatErrors(v.errors).slice(0, 300));
    const t = wasm2wat(r.binary);
    assertEquals(t.errors.length, 0, formatErrors(t.errors).slice(0, 300));
    const o = await wasmOpt(r.binary, { optimizeLevel: 1 });
    assert(o instanceof Uint8Array && o.length > 8);
  });
});
