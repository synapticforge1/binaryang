// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// wabt-ts's bytes WITHOUT their name section — the reference that binaryen-ts
// ENCODINGS are compared against. N1 interim (cmem/names.md).
//
// Since N1 P2 wabt-ts writes a name section, always. binaryen-ts neither reads
// one nor writes one until P4/P5, so every byte comparison between the two
// failed on the name section alone. What these tests compare — instruction and
// section encodings — the name section does not touch, so the reference leaves
// it out.
//
// ⚠️ DELETE WITH P5, and point every user back at `wat2wasm`. Once binaryen-ts
// writes names, its output carries a name section and the comparisons against
// this reference fail; that is this narrowing announcing it is over. Do not
// silence it by stripping binaryen-ts's side too — that would hide the very
// loss P4/P5 exist to close. (The decode → encode users feed the stripped bytes
// IN, so they keep passing after P5; names.md's P5 row lists this file so it is
// not left behind.)

import { wat2wasm } from '../../src/wabt-ts/tools/wat2wasm.ts';
import type { Wat2WasmOptions, Wat2WasmResult } from '../../src/wabt-ts/tools/wat2wasm.ts';

function leb(b: Uint8Array, p: { i: number }): number {
  let r = 0;
  for (let shift = 0;; shift += 7) {
    const x = b[p.i++]!;
    r += (x & 0x7f) * 2 ** shift;
    if ((x & 0x80) === 0) return r;
  }
}

/**
 * `binary` with its `name` custom section cut out, byte for byte — nothing
 * re-encoded, so every other byte is the writer's own.
 */
export function withoutNameSection(binary: Uint8Array): Uint8Array {
  const keep: Uint8Array[] = [binary.subarray(0, 8)];
  const p = { i: 8 };
  while (p.i < binary.length) {
    const start = p.i;
    const id = binary[p.i++]!;
    const size = leb(binary, p);
    const end = p.i + size;
    let isName = false;
    if (id === 0) {
      const q = { i: p.i };
      const n = leb(binary, q);
      isName = new TextDecoder().decode(binary.subarray(q.i, q.i + n)) === 'name';
    }
    if (!isName) keep.push(binary.subarray(start, end));
    p.i = end;
  }
  const out = new Uint8Array(keep.reduce((n, k) => n + k.length, 0));
  let o = 0;
  for (const k of keep) {
    out.set(k, o);
    o += k.length;
  }
  return out;
}

/** `wat2wasm`, with the name section cut out of the binary. See the file header. */
export function wabtReference(wat: string, opts: Wat2WasmOptions = {}): Wat2WasmResult {
  const r = wat2wasm(wat, opts);
  return r.binary.length === 0 ? r : { ...r, binary: withoutNameSection(r.binary) };
}
