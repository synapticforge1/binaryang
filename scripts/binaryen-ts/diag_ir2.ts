/**
 * @module scripts/binaryen-ts/diag_ir2
 *
 * Dump the IR of one function BOTH from the original parse and from a
 * parse→encode→reparse round-trip, side by side, so encoder-introduced drift
 * is visible directly.
 *
 * Run:
 *   bun scripts/binaryen-ts/diag_ir2.ts <relpath> <definedFnIndex>
 *
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import { readForPasses } from '../../src/ir/prepare.ts';
import { writeWasm } from '../../src/ir/write-wasm.ts';

import process from 'node:process';

const ROOT = new URL('../../upstream/test/', import.meta.url).pathname.replace(/^\//, '');
const rel = process.argv.slice(2)[0];
const fnIdx = parseInt(process.argv.slice(2)[1] ?? '0', 10);
const orig = new Uint8Array(await fs.readFile(ROOT + rel));
const mod1 = readForPasses(orig);
const mod2 = readForPasses(writeWasm(mod1));

/** Any IR node: an object with a `kind`. */
const isNode = (v: unknown): v is object =>
  !!v && typeof v === 'object' && !!(v as { kind?: unknown }).kind;

function dump(e: unknown, depth: number, out: string[]): void {
  if (!e || typeof e !== 'object') {
    out.push('  '.repeat(depth) + '<null>');
    return;
  }
  const n = e as {
    readonly [k: string]: unknown;
    readonly kind?: unknown;
    readonly type?: unknown;
  };
  const t = n.type !== undefined ? `:${JSON.stringify(n.type)}` : '';
  const extra: string[] = [];
  for (const k of ['op', 'name', 'var', 'index', 'target', 'func']) {
    if (n[k] !== undefined && typeof n[k] !== 'object') extra.push(`${k}=${n[k]}`);
  }
  out.push('  '.repeat(depth) + `${n.kind}${t} ${extra.join(' ')}`);
  for (const k of Object.keys(e)) {
    const v = n[k];
    if (isNode(v)) dump(v, depth + 1, out);
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (isNode(item)) dump(item, depth + 1, out);
      }
    }
  }
}

const a: string[] = [], b: string[] = [];
dump(mod1.functions[fnIdx].body, 0, a);
dump(mod2.functions[fnIdx].body, 0, b);

console.log(`# ${rel} defined-fn #${fnIdx}  (orig ${a.length} lines | reparsed ${b.length} lines)`);
const n = Math.max(a.length, b.length);
for (let i = 0; i < n; i++) {
  const mark = (a[i] ?? '') === (b[i] ?? '') ? '  ' : '* ';
  console.log(`${mark}${(a[i] ?? '').padEnd(46)} | ${b[i] ?? ''}`);
}
