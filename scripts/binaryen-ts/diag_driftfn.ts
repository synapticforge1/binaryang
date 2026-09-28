/**
 * @module scripts/binaryen-ts/diag_driftfn
 *
 * Find which function(s) change expression count across a parse→encode→reparse
 * round-trip — these are where the encoder emits a byte stream our parser then
 * reconstructs differently (typically via empty-stack nop insertion).
 *
 * Run:
 *   deno run --allow-read scripts/binaryen-ts/diag_driftfn.ts <relpath>
 *
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import { readForPasses } from '../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../src/binaryen-ts/encoder/write-wasm.ts';
import { walkExpression } from '../../src/binaryen-ts/ir/walk.ts';
import type { Expression } from '../../src/binaryen-ts/ir/expressions.ts';

const ROOT = new URL('../../upstream/test/', import.meta.url).pathname.replace(/^\//, '');
const rel = Deno.args[0];
const orig = new Uint8Array(await fs.readFile(ROOT + rel));
const mod1 = readForPasses(orig);
const mod2 = readForPasses(writeWasm(mod1));

function count(e: Expression | null): number {
  if (!e) return 0;
  let n = 0;
  walkExpression(e, () => n++);
  return n;
}

for (let i = 0; i < mod1.functions.length; i++) {
  const c1 = count(mod1.functions[i].body);
  const c2 = count(mod2.functions[i].body);
  if (c1 !== c2) {
    console.log(`defined-fn #${i} (${mod1.functions[i].name}): ${c1} -> ${c2}  (Δ${c2 - c1})`);
  }
}
