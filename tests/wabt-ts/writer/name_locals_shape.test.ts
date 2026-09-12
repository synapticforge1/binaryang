// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// N6 (cmem/divergences.md): the `name` section's LOCAL subsection (id 2) lists
// the functions the section it was read from listed — not always every one.
//
// 🔧 Both writers listed every function, imports included, which is upstream
// `wat2wasm --debug-names`'s shape and right for a module we assembled. Every
// real producer — clang, rustc, zig — lists only the functions that HAVE a
// named local, so re-encoding one gained entries it never had. Measured over
// 376 real WASI binaries: 9 of the 9 carrying a name section differed by those
// bytes and nothing else. After this, 374 of 376 are byte-identical through
// BOTH halves; the two left are L1 (relocation-padded LEBs re-encode minimally,
// as upstream normalizes too).
//
// Three shapes, and they are different bytes:
//   - no record (text, hand-built)     → every function, upstream's shape
//   - a set                            → exactly those, even if it is empty
//   - the section had no subsection 2  → write none

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
/** wabt-ts read → write. */
function rewrite(b: Uint8Array): Uint8Array {
  const errors = makeErrorList();
  const m = readBinaryIr(b, errors, { readDebugNames: true });
  if (hasErrors(errors)) throw new Error(formatErrors(errors));
  return writeBinaryIr(m);
}
/** The `name` section's payload, after its own name. */
function namePayload(b: Uint8Array): Uint8Array | null {
  for (let i = 8; i < b.length;) {
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    const end = i + size;
    if (id === 0 && b[i] === 4 && new TextDecoder().decode(b.subarray(i + 1, i + 5)) === 'name') {
      return b.subarray(i + 5, end);
    }
    i = end;
  }
  return null;
}
/** Its subsections, as `id:size` — the shape, not the names. */
function subsections(b: Uint8Array): string[] {
  const p = namePayload(b);
  if (p === null) return [];
  const out: string[] = [];
  for (let i = 0; i < p.length;) {
    const id = p[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = p[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    out.push(`${id}:${size}`);
    i += size;
  }
  return out;
}
/** The function indices the local subsection lists. */
function localsListed(b: Uint8Array): number[] | null {
  const p = namePayload(b);
  if (p === null) return null;
  for (let i = 0; i < p.length;) {
    const id = p[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = p[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    const end = i + size;
    if (id === 2) {
      const out: number[] = [];
      const u32 = (): number => {
        let v = 0;
        for (let s = 0;; s += 7) {
          const x = p[i++]!;
          v += (x & 0x7f) * 2 ** s;
          if ((x & 0x80) === 0) return v;
        }
      };
      for (let n = u32(); n > 0; n--) {
        out.push(u32());
        for (let k = u32(); k > 0; k--) {
          u32();
          i += u32();
        }
      }
      return out;
    }
    i = end;
  }
  return null;
}

const enc = new TextEncoder();
/** A `name` section holding exactly `subs`, framed as the custom section it is. */
const nameSection = (subs: number[][]): number[] => {
  const body = [4, ...enc.encode('name'), ...subs.flat()];
  return [0, body.length, ...body];
};
/** Subsection 1: function `idx` is named `n`. */
const funcNames = (list: [number, string][]): number[] => {
  const body = [list.length, ...list.flatMap(([i, n]) => [i, n.length, ...enc.encode(n)])];
  return [1, body.length, ...body];
};
/** Subsection 2: these functions, each with these local names. */
const localNames = (list: [number, [number, string][]][]): number[] => {
  const body = [
    list.length,
    ...list.flatMap((
      [i, inner],
    ) => [i, inner.length, ...inner.flatMap(([j, n]) => [j, n.length, ...enc.encode(n)])]),
  ];
  return [2, body.length, ...body];
};
/** Two functions taking an i32; only the second's param is named. */
const mk = (subs: number[][]): Uint8Array =>
  new Uint8Array([
    ...[0, 0x61, 0x73, 0x6d, 1, 0, 0, 0],
    ...[1, 5, 1, 0x60, 1, 0x7f, 0],
    ...[3, 3, 2, 0, 0],
    ...[10, 9, 2, 3, 0, 0x01, 0x0b, 3, 0, 0x01, 0x0b],
    ...subs.flat(),
  ]);

describe("N6 — a producer's name section keeps its shape", () => {
  // clang's shape: function 1 is the only one with a named local, and the only
  // one the local subsection lists.
  const PRODUCER = mk([
    nameSection([
      funcNames([[0, 'a'], [1, 'b']]),
      localNames([[1, [[0, 'p']]]]),
    ]),
  ]);

  it('the fixture is valid, and lists only function 1', () => {
    assert(WebAssembly.validate(PRODUCER as BufferSource));
    assertEquals(localsListed(PRODUCER), [1]);
  });

  it('wabt-ts read → write keeps that shape, byte for byte', () => {
    assert(same(rewrite(PRODUCER), PRODUCER), hex(rewrite(PRODUCER)));
  });

  it('binaryen-ts decode → encode keeps it too', () => {
    assert(same(encodeWasm(parseWasm(PRODUCER)), PRODUCER), hex(encodeWasm(parseWasm(PRODUCER))));
  });

  it('the names still arrive — the shape is all that changed', () => {
    const m = parseWasm(PRODUCER);
    assertEquals(m.functions.map((f) => f.name), ['$a', '$b']);
    assertEquals(m.functions[1]!.locals[0]!.name, '$p');
  });

  it('the module records which functions were listed', () => {
    const errors = makeErrorList();
    assertEquals([...readBinaryIr(PRODUCER, errors, { readDebugNames: true }).localNamesListed!], [
      1,
    ]);
  });
});

describe('N6 — the other two shapes', () => {
  it('a section with NO local subsection gains none', () => {
    const noLocals = mk([nameSection([funcNames([[0, 'a']])])]);
    assertEquals(subsections(noLocals), ['1:4']);
    assertEquals(subsections(rewrite(noLocals)), subsections(noLocals));
    assertEquals(subsections(encodeWasm(parseWasm(noLocals))), subsections(noLocals));
  });

  it('a local subsection that lists NOBODY is not the same as none', () => {
    // `02 01 00` — an empty vec, which is what upstream writes for a module
    // with no functions. It must survive as itself, not collapse to "absent".
    const empty = mk([nameSection([funcNames([[0, 'a']]), localNames([])])]);
    assertEquals(subsections(empty), ['1:4', '2:1']);
    assertEquals(subsections(rewrite(empty)), subsections(empty));
    assertEquals(subsections(encodeWasm(parseWasm(empty))), subsections(empty));
  });

  it('with no record — text — every function is listed, as upstream does', () => {
    // The rule wat2wasm output depends on: upstream `--debug-names` lists every
    // function, imports included, even with no named locals.
    const bytes = assemble('(module (import "a" "b" (func)) (func) (func (param $p i32)))');
    assertEquals(localsListed(bytes), [0, 1, 2]);
  });

  it('and that text output still round-trips through both halves', () => {
    const bytes = assemble('(module (import "a" "b" (func)) (func (param $p i32) (local $q i64)))');
    assert(same(rewrite(bytes), bytes), hex(rewrite(bytes)));
    assert(same(encodeWasm(parseWasm(bytes)), bytes), hex(encodeWasm(parseWasm(bytes))));
  });
});

describe('N6 — what the record does NOT do', () => {
  it('a listed function with no named local keeps its empty entry', () => {
    // Upstream's shape for a function it names but whose locals it does not:
    // the entry is there, with a zero-length vec.
    const bytes = mk([
      nameSection([funcNames([[0, 'a']]), localNames([[0, []], [1, [[0, 'p']]]])]),
    ]);
    assertEquals(localsListed(bytes), [0, 1]);
    assert(same(rewrite(bytes), bytes), hex(rewrite(bytes)));
    assert(same(encodeWasm(parseWasm(bytes)), bytes), hex(encodeWasm(parseWasm(bytes))));
  });

  it('a name a pass removes leaves the section, listed or not', () => {
    // binaryen-ts keys the record by NAME, so an index never shifts onto
    // someone else's entry.
    const PRODUCER = mk([
      nameSection([funcNames([[0, 'a'], [1, 'b']]), localNames([[1, [[0, 'p']]]])]),
    ]);
    const m = parseWasm(PRODUCER);
    m.functions.splice(0, 1); // drop `$a`
    const out = encodeWasm(m);
    assertEquals(localsListed(out), [0]); // `$b`, now index 0
  });
});
