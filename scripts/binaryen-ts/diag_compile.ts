/**
 * @module scripts/binaryen-ts/diag_compile
 *
 * Parse + encode a corpus file and run the real WebAssembly.compile() validator
 * on the re-encoded output, reporting the exact validation error.
 *
 * Run:
 *   deno run -A scripts/binaryen-ts/diag_compile.ts <relpath-under-upstream/test>
 *
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import { readForPasses } from '../../src/ir/prepare.ts';
import { writeWasm } from '../../src/ir/write-wasm.ts';

import process from 'node:process';

const ROOT = new URL('../../upstream/test/', import.meta.url).pathname.replace(/^\//, '');
const rel = process.argv.slice(2)[0];
const orig = new Uint8Array(await fs.readFile(ROOT + rel));
const re = writeWasm(readForPasses(orig));
try {
  await WebAssembly.compile(re as BufferSource);
  console.log('OK compiles');
} catch (e) {
  console.log('COMPILE ERR:', (e as Error).message);
}
