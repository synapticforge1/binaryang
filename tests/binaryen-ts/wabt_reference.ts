// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// wabt-ts's bytes WITHOUT their name section — the reference for comparing what
// binaryen-ts's INTERNAL `parseWat` encodes with what wabt-ts assembles.
// (cmem/names.md, N1.)
//
// Since N1 P2 wabt-ts writes a name section, always. binaryen-ts reads and
// writes one since P4–P5 — but only for a module READ WITH one: `parseWat` is
// binaryen-ts's internal folded-subset parser, deliberately not extended (W4 —
// external WAT goes wabt-ts → bytes → decoder), so what it builds carries no
// name section. What these tests compare — instruction and section encodings —
// the name section does not touch, so the reference leaves it out.
//
// ⚠️ Only for `parseWat` comparisons. A DECODE → ENCODE test must use the full
// `wat2wasm` bytes: binaryen-ts keeps names on that path, and stripping them
// would hide exactly the loss P4–P5 closed (the three that used this until P5 —
// wide arithmetic, multi-memory, extern conversions — went back to `wat2wasm`
// then). Retire this with `parseWat` itself (S6).

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
