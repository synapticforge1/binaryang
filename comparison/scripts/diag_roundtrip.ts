// Diagnostic: imports upstream binaryen (comparison/package.json) as a trusted disassembler.

/**
 * @module scripts/binaryen-ts/diag_roundtrip
 *
 * General per-file round-trip diagnostic. Parses a .wasm with binaryen-ts,
 * re-encodes, then disassembles BOTH the original and the re-encoded output
 * with upstream binaryen.js. Reports per-function WAT and the first diverging
 * function so the offending construct can be read directly.
 *
 * Run:
 *   bun scripts/v8.ts comparison/scripts/diag_roundtrip.ts <relpath-under-upstream/binaryen/test>
 *
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import process from 'node:process';

import upstream from 'binaryen-116';
import { readForPasses } from '../../src/ir/prepare.ts';
import { writeWasm } from '../../src/ir/write-wasm.ts';

const ROOT = new URL('../../upstream/binaryen/test/', import.meta.url).pathname.replace(/^\//, '');
const rel = process.argv[2] ?? 'fib-dbg.wasm';

function emitText(bytes: Uint8Array): string {
  const u = upstream as unknown as Record<string, unknown>;
  const mod = (u['readBinary'] as (b: Uint8Array) => unknown)(bytes);
  const m = mod as Record<string, unknown>;
  (m['setFeatures'] as (n: number) => void)((u['Features'] as Record<string, number>)['All']);
  const txt = (m['emitText'] as () => string)();
  (m['dispose'] as () => void)();
  return txt;
}

const original = new Uint8Array(await fs.readFile(ROOT + rel));
const mod = readForPasses(original);
const reEncoded = writeWasm(mod);

console.log(`# ${rel}: original=${original.byteLength}B re-encoded=${reEncoded.byteLength}B`);

let origText = '';
try {
  origText = emitText(original);
} catch (e) {
  console.log('Upstream rejected ORIGINAL (!):', (e as Error).message);
  process.exit(1);
}

let reText = '';
let reError = '';
try {
  reText = emitText(reEncoded);
} catch (e) {
  reError = (e as Error).message;
}

const outDir = new URL('./_diffs/', import.meta.url).pathname.replace(/^\//, '');
await fs.mkdir(outDir, { recursive: true }).catch(() => {});
const base = rel.replace(/[\\/]/g, '_');
await fs.writeFile(outDir + base + '.orig.wat', origText);
console.log(`wrote ${outDir}${base}.orig.wat`);

if (reError) {
  console.log(`\nUpstream REJECTED re-encoded output: ${reError}`);
  console.log('(cannot disassemble invalid output; inspect orig WAT to find the construct)');
} else {
  await fs.writeFile(outDir + base + '.reenc.wat', reText);
  console.log(`wrote ${outDir}${base}.reenc.wat`);
  // first diverging line
  const a = origText.split('\n'), b = reText.split('\n');
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].trim() !== b[i].trim()) {
      console.log(`\nFirst diverging line ${i}:\n  orig: ${a[i].trim()}\n  re  : ${b[i].trim()}`);
      break;
    }
  }
}
