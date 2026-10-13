/**
 * @module scripts/binaryen-ts/diag_ir
 *
 * Dump the parsed IR tree of one function as an indented s-expression so we can
 * see node kinds and inferred `.type` fields directly.
 *
 * Run:
 *   bun scripts/binaryen-ts/diag_ir.ts <relpath> <funcIndexInDefined>
 *
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import { readForPasses } from '../../src/ir/prepare.ts';

import process from 'node:process';

const ROOT = new URL('../../upstream/test/', import.meta.url).pathname.replace(/^\//, '');
const rel = process.argv.slice(2)[0];
const fnIdx = parseInt(process.argv.slice(2)[1] ?? '0', 10);
const orig = new Uint8Array(await fs.readFile(ROOT + rel));
const mod = readForPasses(orig);
const fn = mod.functions[fnIdx];
console.log(
  `# ${rel} defined-fn #${fnIdx}: ${fn.name} params=${JSON.stringify(fn.sig.params)} results=${
    JSON.stringify(fn.sig.results)
  }`,
);

/** Any IR node: an object with a `kind`. */
const isNode = (v: unknown): v is object =>
  !!v && typeof v === 'object' && !!(v as { kind?: unknown }).kind;

function dump(e: unknown, depth: number): void {
  if (!e || typeof e !== 'object') {
    console.log('  '.repeat(depth) + '<null>');
    return;
  }
  const n = e as {
    readonly [k: string]: unknown;
    readonly kind?: unknown;
    readonly type?: unknown;
  };
  const t = n.type !== undefined ? ` :${JSON.stringify(n.type)}` : '';
  const extra: string[] = [];
  for (const k of ['op', 'name', 'var', 'index', 'label', 'target', 'func']) {
    if (n[k] !== undefined && typeof n[k] !== 'object') extra.push(`${k}=${n[k]}`);
  }
  console.log('  '.repeat(depth) + `${n.kind}${t} ${extra.join(' ')}`);
  // recurse into known child fields
  for (const k of Object.keys(e)) {
    const v = n[k];
    if (isNode(v)) dump(v, depth + 1);
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (isNode(item)) dump(item, depth + 1);
      }
    }
  }
}

dump(fn.body, 0);
