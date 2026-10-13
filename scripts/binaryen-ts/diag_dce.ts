/**
 * @module scripts/binaryen-ts/diag_dce
 *
 * Dump _fib's IR before and after the DCE pass, side by side, to see exactly
 * which expressions DCE removes.
 *
 * Run: bun scripts/binaryen-ts/diag_dce.ts
 *
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import { readForPasses } from '../../src/ir/prepare.ts';
import { createPass, PassRunner } from '../../src/passes/pass.ts';
import process from 'node:process';
import '../../src/passes/index.ts';

const ROOT = new URL('../../upstream/test/', import.meta.url).pathname.replace(/^\//, '');
const orig = new Uint8Array(await fs.readFile(ROOT + 'fib-dbg.wasm'));

/** Any IR node: an object with a `kind`. */
const isNode = (v: unknown): v is object =>
  !!v && typeof v === 'object' && !!(v as { kind?: unknown }).kind;

function dump(e: unknown, depth: number, out: string[]): void {
  if (!e || typeof e !== 'object') return void out.push('  '.repeat(depth) + '<null>');
  const n = e as {
    readonly [k: string]: unknown;
    readonly kind?: unknown;
    readonly type?: unknown;
  };
  const t = n.type !== undefined ? `:${JSON.stringify(n.type)}` : '';
  const extra: string[] = [];
  for (const k of ['op', 'name', 'var', 'index']) {
    if (n[k] !== undefined && typeof n[k] !== 'object') extra.push(`${k}=${n[k]}`);
  }
  out.push('  '.repeat(depth) + `${n.kind}${t} ${extra.join(' ')}`);
  for (const k of Object.keys(e)) {
    const v = n[k];
    if (isNode(v)) dump(v, depth + 1, out);
    else if (Array.isArray(v)) {
      for (const it of v) if (isNode(it)) dump(it, depth + 1, out);
    }
  }
}

const before = readForPasses(orig);
const fibBefore = before.functions.find((f) => f.name === '$func5')!;
const a: string[] = [];
dump(fibBefore.body, 0, a);

const passName = process.argv.slice(2)[0] ?? 'DCE';
const after = readForPasses(orig);
new PassRunner(after, { optimizeLevel: 2, shrinkLevel: 2 }).addPass(createPass(passName)).run();
const fibAfter = after.functions.find((f) => f.name === '$func5')!;
const b: string[] = [];
dump(fibAfter.body, 0, b);

console.log(`# _fib IR — before (${a.length} nodes) | after ${passName} (${b.length} nodes)`);
const n = Math.max(a.length, b.length);
for (let i = 0; i < n; i++) {
  const mark = (a[i] ?? '') === (b[i] ?? '') ? '  ' : '* ';
  console.log(`${mark}${(a[i] ?? '').padEnd(40)} | ${b[i] ?? ''}`);
}
