// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// N1 step P2 (cmem/names.md): the binary writer writes a `name` section, ALWAYS.
//
// It wrote none — `writeDebugNames` was declared and ignored — so every name in
// the source was gone from the bytes: WAT → `wat2wasm` → `wasm2wat` could not
// give back one of the corpus's 63,930 names. The owner's rule: wabt-ts is the
// fidelity half and keeps names.
//
// For the ten kinds upstream writes, the bytes are upstream
// `wat2wasm --debug-names`'s — pinned below from wabt 1.0.41, and measured
// equal on all 421 corpus modules. LABEL and GC FIELD names go beyond upstream
// (FEATURE N2) and are pinned on their own.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasmStrip } from '../../../src/wabt-ts/tools/wasm-strip.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';

const DEC = new TextDecoder();

function leb(b: Uint8Array, p: { i: number }): number {
  let r = 0, shift = 0, x: number;
  do {
    x = b[p.i++]!;
    r += (x & 0x7f) * 2 ** shift;
    shift += 7;
  } while (x & 0x80);
  return r;
}
function str(b: Uint8Array, p: { i: number }): string {
  const n = leb(b, p);
  p.i += n;
  return DEC.decode(b.subarray(p.i - n, p.i));
}

/** Every custom section, in order, as `[name, payload]`. */
function customs(wasm: Uint8Array): [string, Uint8Array][] {
  const out: [string, Uint8Array][] = [];
  const p = { i: 8 };
  while (p.i < wasm.length) {
    const id = wasm[p.i++]!;
    const size = leb(wasm, p);
    const end = p.i + size;
    if (id === 0) {
      const name = str(wasm, p);
      out.push([name, wasm.subarray(p.i, end)]);
    }
    p.i = end;
  }
  return out;
}

/** The single name section's payload; fails if there is not exactly one. */
function namePayload(wasm: Uint8Array): Uint8Array {
  const found = customs(wasm).filter(([n]) => n === 'name');
  assertEquals(found.length, 1, 'expected exactly one name section');
  return found[0]![1];
}

/** Subsections as `[id, rawBytesIncludingHeader]`. */
function subsections(payload: Uint8Array): [number, Uint8Array][] {
  const out: [number, Uint8Array][] = [];
  const p = { i: 0 };
  while (p.i < payload.length) {
    const start = p.i;
    const id = payload[p.i++]!;
    // Two statements: `p.i += leb(payload, p)` reads `p.i` BEFORE `leb`
    // advances it, and drops the size field's own bytes.
    const size = leb(payload, p);
    p.i += size;
    out.push([id, payload.subarray(start, p.i)]);
  }
  return out;
}

/** An indirect name map (labels, fields) decoded: `[outer, [inner, name][]][]`. */
function indirect(payload: Uint8Array, id: number): [number, [number, string][]][] | undefined {
  const sub = subsections(payload).find(([i]) => i === id);
  if (!sub) return undefined;
  const b = sub[1];
  const p = { i: 1 };
  leb(b, p);
  const out: [number, [number, string][]][] = [];
  for (let n = leb(b, p); n > 0; n--) {
    const outer = leb(b, p);
    const inner: [number, string][] = [];
    for (let m = leb(b, p); m > 0; m--) inner.push([leb(b, p), str(b, p)]);
    out.push([outer, inner]);
  }
  return out;
}

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}

const hex = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((x) => parseInt(x, 16)));

// Every kind upstream writes, imports included, named and unnamed mixed; and
// three labels, which upstream does not write.
const PROBE = `(module $mod
  (type $sig (func (param i32) (result i32)))
  (type (func))
  (import "env" "f0" (func $imp_named (param $ip i32)))
  (import "env" "f1" (func (param i32)))
  (import "env" "g" (global $ig i32))
  (import "env" "m" (memory $im 1))
  (import "env" "t" (table $it 1 funcref))
  (import "env" "tag" (tag $itag (param i32)))
  (table $tab 1 funcref)
  (global $glob (mut i32) (i32.const 0))
  (global i32 (i32.const 1))
  (tag $tg)
  (func $named (param $a i32) (param i32) (result i32) (local $x i32) (local i64)
    (block $outer (loop $in (br_if $outer (local.get $a)) (br $in)))
    (if (block (result i32) (i32.const 1)) (then (block $inner)))
    (local.get $x))
  (func (type 1))
  (func $nolocals)
  (func (param i32) (local f32))
  (elem $e func $named)
  (elem func 3)
  (data $d "hi")
  (data "x"))`;

// `wat2wasm --debug-names --enable-exceptions` (wabt 1.0.41) on PROBE: the
// name section's payload, after the section's own name.
const UPSTREAM_PROBE = hex(`
  00 04 03 6d 6f 64 01 1d 03 00 09 69 6d 70 5f 6e 61 6d 65 64 02 05 6e 61 6d 65 64 04 08 6e 6f 6c
  6f 63 61 6c 73 02 17 06 00 01 00 02 69 70 01 00 02 02 00 01 61 02 01 78 03 00 04 00 05 00 04 06
  01 00 03 73 69 67 05 0a 02 00 02 69 74 01 03 74 61 62 06 05 01 00 02 69 6d 07 0b 02 00 02 69 67
  01 04 67 6c 6f 62 08 04 01 00 01 65 09 04 01 00 01 64 0b 0b 02 00 04 69 74 61 67 01 02 74 67`);

describe('the name section, for the kinds upstream writes', () => {
  it("is upstream --debug-names's, byte for byte, once our label subsection is set aside", () => {
    const payload = namePayload(assemble(PROBE));
    const ours = subsections(payload).filter(([id]) => id !== 3).map(([, b]) => [...b]).flat();
    assertEquals(new Uint8Array(ours), UPSTREAM_PROBE);
  });

  it('is written for a module with no names at all — the local subsection, as upstream', () => {
    // `wat2wasm --debug-names` on `(module)`: `02 01 00`, one empty subsection.
    assertEquals([...namePayload(assemble('(module)'))], [0x02, 0x01, 0x00]);
  });

  it('holds a quoted identifier as the name it denotes', () => {
    const p = namePayload(assemble('(module (func $"a b") (func (call $"a b")))'));
    // function subsection: one entry, index 0, "a b"
    assertEquals([...subsections(p)[0]![1]], [0x01, 0x06, 0x01, 0x00, 0x03, 0x61, 0x20, 0x62]);
  });
});

describe('label names (subsection 3) — beyond upstream, FEATURE N2', () => {
  it('are kept, indexed by every label-introducing instruction in BINARY order', () => {
    // The folded `if` writes its condition's `block` first, so the block is
    // label 0 and the unnamed `if` label 1 — a tree walk would say the reverse.
    const p = namePayload(assemble(`(module (func
      (if (block $c (result i32) (i32.const 1)) (then (block $t)))
      (loop $l)))`));
    assertEquals(indirect(p, 3), [[0, [[0, 'c'], [2, 't'], [3, 'l']]]]);
  });

  it('are listed only for functions that have them, at the function INDEX', () => {
    const p = namePayload(assemble(`(module
      (import "e" "i" (func))
      (func (block))
      (func (block $b)))`));
    assertEquals(indirect(p, 3), [[2, [[0, 'b']]]]);
  });

  it('are absent — the section stays upstream-identical — when no label is named', () => {
    assertEquals(indirect(namePayload(assemble('(module (func (block) (loop)))')), 3), undefined);
  });
});

describe('GC field names (subsection 10) — beyond upstream, FEATURE N2', () => {
  it('are kept for struct fields, named ones only', () => {
    const p = namePayload(
      assemble('(module (type $s (struct (field $x i32) (field i64) (field $z f32))))'),
    );
    assertEquals(indirect(p, 10), [[0, [[0, 'x'], [2, 'z']]]]);
  });

  it('are absent when no field is named', () => {
    assertEquals(
      indirect(namePayload(assemble('(module (type (struct (field i32))))')), 10),
      undefined,
    );
  });
});

describe('removing names stays possible, and never duplicates them', () => {
  const named = assemble('(module (func $f) (global $g i32 (i32.const 0)))');

  it('wasm-strip leaves no name section — none is generated in its place', () => {
    const r = wasmStrip(named);
    assert(!hasErrors(r.errors), formatErrors(r.errors));
    assertEquals(customs(r.binary), []);
  });

  it('wasm-strip of some other section keeps the name section, once, verbatim', () => {
    const r = wasmStrip(named, { sections: ['other'] });
    assertEquals([...namePayload(r.binary)], [...namePayload(named)]);
  });

  it('a name section read as raw bytes is written back as it was, not beside a generated one', () => {
    const errors = makeErrorList();
    const m = readBinaryIr(named, errors, { readDebugNames: false });
    assert(!hasErrors(errors), formatErrors(errors));
    assertEquals([...namePayload(writeBinaryIr(m))], [...namePayload(named)]);
  });
});
