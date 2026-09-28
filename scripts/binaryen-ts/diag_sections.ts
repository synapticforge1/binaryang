/**
 * @module scripts/binaryen-ts/diag_sections
 *
 * Dump the top-level section list (id + name-for-custom + byte size) of a wasm
 * binary, for the original input and for our parse→encode round-trip output,
 * side by side. Surfaces which sections survive the round-trip — in particular
 * whether custom (e.g. DWARF `.debug_*`) sections are dropped.
 *
 * Run:
 *   deno run --allow-read scripts/binaryen-ts/diag_sections.ts <relpath-under-upstream/test>
 *
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import { readForPasses } from '../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../src/binaryen-ts/encoder/write-wasm.ts';

const SECTION_NAMES: Record<number, string> = {
  0: 'custom',
  1: 'type',
  2: 'import',
  3: 'function',
  4: 'table',
  5: 'memory',
  6: 'global',
  7: 'export',
  8: 'start',
  9: 'element',
  10: 'code',
  11: 'data',
  12: 'datacount',
  13: 'tag',
};

function sections(bytes: Uint8Array): { id: number; label: string; size: number }[] {
  // A section header is an id byte and a u32 LEB size; a custom section's
  // payload starts with its name (binaryen-ts's `BinaryReader` went with its
  // decoder at 1.6.0).
  let p = 8; // magic + version
  const leb = (): number => {
    let r = 0, s = 0, b;
    do {
      b = bytes[p++]!;
      r += (b & 0x7f) * 2 ** s;
      s += 7;
    } while (b & 0x80);
    return r;
  };
  const out: { id: number; label: string; size: number }[] = [];
  while (p < bytes.length) {
    const id = bytes[p++]!;
    const size = leb();
    const bodyStart = p;
    let label = SECTION_NAMES[id] ?? `?${id}`;
    if (id === 0) {
      const nameLen = leb();
      label = `custom:${new TextDecoder().decode(bytes.subarray(p, p + nameLen))}`;
    }
    out.push({ id, label, size });
    p = bodyStart + size;
  }
  return out;
}

const ROOT = new URL('../../upstream/test/', import.meta.url).pathname.replace(/^\//, '');
const rel = Deno.args[0];
const orig = new Uint8Array(await fs.readFile(ROOT + rel));
const reenc = writeWasm(readForPasses(orig));

console.log(`# ${rel}`);
console.log(`# original ${orig.byteLength} B  →  re-encoded ${reenc.byteLength} B`);
console.log();
console.log('ORIGINAL sections:');
let oCustom = 0;
for (const s of sections(orig)) {
  console.log(`  ${s.label.padEnd(22)} ${s.size.toString().padStart(8)} B`);
  if (s.id === 0) oCustom += s.size;
}
console.log(`  (custom-section bytes total: ${oCustom})`);
console.log();
console.log('RE-ENCODED sections:');
for (const s of sections(reenc)) {
  console.log(`  ${s.label.padEnd(22)} ${s.size.toString().padStart(8)} B`);
}
