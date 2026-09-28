/**
 * @module scripts/binaryen-ts/diag_compile
 *
 * Parse + encode a corpus file and run the real WebAssembly.compile() validator
 * on the re-encoded output, reporting the exact validation error.
 *
 * Run:
 *   deno run --allow-read scripts/binaryen-ts/diag_compile.ts <relpath-under-upstream/test>
 *
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import { readForPasses } from '../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../src/binaryen-ts/encoder/write-wasm.ts';

const ROOT = new URL('../../upstream/test/', import.meta.url).pathname.replace(/^\//, '');
const rel = Deno.args[0];
const orig = new Uint8Array(await fs.readFile(ROOT + rel));
const re = writeWasm(readForPasses(orig));
try {
  await WebAssembly.compile(re as BufferSource);
  console.log('OK compiles');
} catch (e) {
  console.log('COMPILE ERR:', (e as Error).message);
}
